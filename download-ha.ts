#!/usr/bin/env -S node --use-system-ca --experimental-strip-types

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { styleText } from 'node:util'

const HOST = 'https://domovoy.local'
const WS = 'wss://domovoy.local/api/websocket'
const UNCATEGORIZED = 'Прочее'

const SLUGS: Record<string, string> = {
  Прочее: 'other',
  Свет: 'light',
  Уведомления: 'notifications',
  Режимы: 'modes',
  Климат: 'climate',
  Шторы: 'cover',
  Вентиляция: 'ventilation',
  Андрей: 'andrey'
}

interface Domain {
  prefix: string
  outputDir: string
  scope: string
  configPath: (id: string) => string
}

const DOMAINS: Domain[] = [
  {
    prefix: 'automation.',
    outputDir: 'automations',
    scope: 'automation',
    configPath: id => `config/automation/config/${id}`
  },
  {
    prefix: 'script.',
    outputDir: 'scripts',
    scope: 'script',
    configPath: id => `config/script/config/${id}`
  }
]

interface HassState {
  entity_id: string
  state: string
  attributes: {
    id?: string
    friendly_name?: string
    unit_of_measurement?: string
    device_class?: string
  }
}

interface Category {
  category_id: string
  name: string
}

interface EntityEntry {
  entity_id: string
  unique_id?: string
  platform?: string
  config_entry_id?: string | null
  entity_category?: string | null
  area_id?: string | null
  device_id?: string | null
  disabled_by?: string | null
  hidden_by?: string | null
  categories?: Record<string, string>
}

interface Area {
  area_id: string
  name: string
  icon?: string | null
}

interface Device {
  id: string
  area_id?: string | null
}

interface Dashboard {
  id: string
  url_path: string | null
  title?: string
  mode: string
}

interface DashboardConfig {
  name: string
  config: Record<string, unknown>
}

async function api<T>(path: string): Promise<T> {
  let res = await fetch(`${HOST}/api/${path}`, {
    headers: {
      'Authorization': `Bearer ${process.env.HOMEASSISTANT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) {
    throw new Error(`GET /api/${path} failed: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function apiSend<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let res = await fetch(`${HOST}/api/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.HOMEASSISTANT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) {
    throw new Error(`${method} /api/${path} failed: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

interface Registry {
  categoryByEntity: Record<string, string>
  uniqueIdByEntity: Record<string, string>
  entities: EntityEntry[]
  areas: Area[]
  areaById: Record<string, string>
  deviceArea: Record<string, string>
  entityArea: Record<string, string>
}

function fetchRegistry(scopes: string[]): Promise<Registry> {
  return new Promise((resolve, reject) => {
    let ws = new WebSocket(WS)
    let seq = 0
    let pending: Record<number, { type: string; scope?: string }> = {}
    let byScope: Record<string, Record<string, string>> = {}
    let entityCategory: Record<string, { scope: string; id: string }> = {}
    let uniqueIdByEntity: Record<string, string> = {}
    let entities: EntityEntry[] = []
    let areas: Area[] = []
    let areaById: Record<string, string> = {}
    let deviceArea: Record<string, string> = {}
    let got = 0
    let expected = scopes.length + 3

    let send = (type: string, scope?: string) => {
      let id = ++seq
      pending[id] = { type, scope }
      ws.send(JSON.stringify({ id, type, ...(scope && { scope }) }))
    }

    ws.onmessage = (ev: MessageEvent) => {
      let msg = JSON.parse(ev.data)
      if (msg.type === 'auth_required') {
        ws.send(
          JSON.stringify({
            type: 'auth',
            access_token: process.env.HOMEASSISTANT_TOKEN
          })
        )
      } else if (msg.type === 'auth_invalid') {
        reject(new Error('WebSocket auth failed: check HOMEASSISTANT_TOKEN'))
      } else if (msg.type === 'auth_ok') {
        for (let scope of scopes) send('config/category_registry/list', scope)
        send('config/entity_registry/list')
        send('config/area_registry/list')
        send('config/device_registry/list')
      } else if (msg.type === 'result') {
        let req = pending[msg.id]!
        if (!msg.success) {
          reject(new Error(`WebSocket request ${req.type} failed`))
          return
        }
        if (req.type === 'config/category_registry/list') {
          let map = (byScope[req.scope!] ||= {})
          for (let c of msg.result as Category[]) map[c.category_id] = c.name
        } else if (req.type === 'config/area_registry/list') {
          for (let a of msg.result as Area[]) {
            areas.push(a)
            areaById[a.area_id] = a.name
          }
        } else if (req.type === 'config/device_registry/list') {
          for (let d of msg.result as Device[]) {
            if (d.area_id) deviceArea[d.id] = d.area_id
          }
        } else {
          for (let e of msg.result as EntityEntry[]) {
            entities.push(e)
            if (e.unique_id) uniqueIdByEntity[e.entity_id] = e.unique_id
            for (let [scope, id] of Object.entries(e.categories ?? {})) {
              if (id) entityCategory[e.entity_id] = { scope, id }
            }
          }
        }
        if (++got === expected) {
          ws.close()
          let categoryByEntity: Record<string, string> = {}
          for (let [entity, { scope, id }] of Object.entries(entityCategory)) {
            let name = byScope[scope]?.[id]
            if (name) categoryByEntity[entity] = name
          }
          let entityArea: Record<string, string> = {}
          for (let e of entities) {
            let areaId =
              e.area_id ?? (e.device_id ? deviceArea[e.device_id] : undefined)
            if (areaId) entityArea[e.entity_id] = areaId
          }
          resolve({
            categoryByEntity,
            uniqueIdByEntity,
            entities,
            areas,
            areaById,
            deviceArea,
            entityArea
          })
        }
      }
    }
    ws.onerror = () => reject(new Error(`Cannot connect to ${WS}`))
  })
}

const NUM =
  /^[-+]?(\.inf|\.nan|0x[0-9a-fA-F]+|0o[0-7]+|\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)$/
const SEXA = /^[-+]?\d[\d_]*(:[0-5]?\d)+(\.\d*)?$/
const TS =
  /^\d{4}-\d\d?-\d\d?(([Tt]|[ \t]+)\d\d?:\d\d?:\d\d?(\.\d*)?([ \t]*(Z|[-+]\d\d?(:\d\d)?))?)?$/
const CTRL = /[\u0000-\u001f\u007f]/
const RESERVED = new Set([
  'null',
  '~',
  'true',
  'false',
  'yes',
  'no',
  'on',
  'off'
])

function plainOk(s: string): boolean {
  if (s === '' || s !== s.trim()) return false
  if (RESERVED.has(s.toLowerCase())) return false
  if (NUM.test(s) || SEXA.test(s) || TS.test(s)) return false
  if (CTRL.test(s) || s.includes('\t')) return false
  if ('!&*?|>@`"\'%#,[]{}'.includes(s[0]!)) return false
  if ('-:'.includes(s[0]!) && (s.length === 1 || s[1] === ' ')) return false
  if (s.includes(': ') || s.endsWith(':') || s.includes(' #')) return false
  return true
}

function scalar(v: unknown): string {
  if (v === null) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return v > 0 ? '.inf' : v < 0 ? '-.inf' : '.nan'
    return String(v)
  }
  let s = String(v)
  if (plainOk(s)) return s
  if (CTRL.test(s) || s.includes("'")) return JSON.stringify(s)
  return `'${s}'`
}

let isMap = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
let lines: string[] = []

function renderDict(
  node: Record<string, unknown>,
  indent: number,
  first?: string
) {
  let pad = '  '.repeat(indent)
  Object.entries(node).forEach(([k, val], i) => {
    let p = i === 0 && first !== undefined ? first : pad
    let key = scalar(String(k))
    if (isMap(val)) {
      if (Object.keys(val).length) {
        lines.push(`${p}${key}:`)
        renderDict(val, indent + 1)
      } else {
        lines.push(`${p}${key}: {}`)
      }
    } else if (Array.isArray(val)) {
      if (val.length) {
        lines.push(`${p}${key}:`)
        renderList(val, indent + 1)
      } else {
        lines.push(`${p}${key}: []`)
      }
    } else {
      lines.push(`${p}${key}: ${scalar(val)}`)
    }
  })
}

function renderList(node: unknown[], indent: number) {
  let pad = '  '.repeat(indent)
  for (let item of node) {
    if (isMap(item)) {
      if (Object.keys(item).length) renderDict(item, indent + 1, `${pad}- `)
      else lines.push(`${pad}- {}`)
    } else if (Array.isArray(item)) {
      if (item.length) {
        lines.push(`${pad}-`)
        renderList(item, indent + 1)
      } else {
        lines.push(`${pad}- []`)
      }
    } else {
      lines.push(`${pad}- ${scalar(item)}`)
    }
  }
}

function toYaml(data: unknown): string {
  lines.length = 0
  if (Array.isArray(data)) renderList(data, 0)
  else if (isMap(data)) renderDict(data, 0)
  else lines.push(scalar(data))
  return lines.join('\n') + (lines.length ? '\n' : '')
}

function fileName(category: string): string {
  let base =
    SLUGS[category] || category.replace(/[/\\\u0000-\u001f]/g, '_').trim()
  return base + '.yaml'
}

async function download(
  domain: Domain,
  states: HassState[],
  registry: Registry
): Promise<void> {
  let items = states
    .filter(s => s.entity_id.startsWith(domain.prefix))
    .map(s => ({
      entityId: s.entity_id,
      id: registry.uniqueIdByEntity[s.entity_id] ?? s.attributes?.id,
      friendlyName: s.attributes?.friendly_name
    }))
    .filter(
      (
        a
      ): a is {
        entityId: string
        id: string
        friendlyName: string | undefined
      } => Boolean(a.id)
    )
    .sort((a, b) => a.entityId.localeCompare(b.entityId))

  if (!items.length) {
    console.info(`No UI-managed ${domain.outputDir} found.`)
    return
  }

  let groups: Record<string, unknown[]> = {}
  for (let { entityId, id, friendlyName } of items) {
    let category = registry.categoryByEntity[entityId] || UNCATEGORIZED
    let config
    try {
      config = await api<Record<string, unknown>>(domain.configPath(id))
    } catch {
      console.error(styleText('red', `  ! skipped ${entityId} (not editable)`))
      continue
    }
    delete config.id
    if (typeof config.description === 'string' && !config.description.trim()) {
      delete config.description
    }
    let { alias, ...rest } = config
    if (
      typeof alias === 'string' &&
      friendlyName !== undefined &&
      alias !== friendlyName
    ) {
      console.error(
        styleText(
          'red',
          `  ! ${entityId} alias "${alias}" differs from name "${friendlyName}"`
        )
      )
    }
    let room = registry.entityArea[entityId]
    let entry =
      alias === undefined
        ? { id: entityId, ...(room && { room }), ...rest }
        : { id: entityId, alias, ...(room && { room }), ...rest }
    ;(groups[category] ||= []).push(entry)
    console.error(`  - [${category}] ${entityId}`)
  }

  let dir = join(import.meta.dirname, domain.outputDir)
  mkdirSync(dir, { recursive: true })
  for (let f of readdirSync(dir)) {
    if (f.endsWith('.yaml')) rmSync(join(dir, f))
  }

  let count = 0
  for (let [category, configs] of Object.entries(groups)) {
    let yaml = configs.map(config => toYaml([config])).join('\n')
    writeFileSync(join(dir, fileName(category)), yaml)
    count += configs.length
  }

  let names = Object.keys(groups).length
  console.log(
    `Saved ${count} ${domain.outputDir} to ${names} file(s) in ${domain.outputDir}/`
  )
}

function fetchDashboards(): Promise<DashboardConfig[]> {
  return new Promise((resolve, reject) => {
    let ws = new WebSocket(WS)
    let seq = 0
    let pending: Record<number, { type: string; name?: string }> = {}
    let results: DashboardConfig[] = []
    let expected = Infinity
    let got = 0

    let send = (
      payload: { type: string; url_path?: string | null },
      name?: string
    ) => {
      let id = ++seq
      pending[id] = { type: payload.type, name }
      ws.send(JSON.stringify({ id, ...payload }))
    }

    ws.onmessage = (ev: MessageEvent) => {
      let msg = JSON.parse(ev.data)
      if (msg.type === 'auth_required') {
        ws.send(
          JSON.stringify({
            type: 'auth',
            access_token: process.env.HOMEASSISTANT_TOKEN
          })
        )
      } else if (msg.type === 'auth_invalid') {
        reject(new Error('WebSocket auth failed: check HOMEASSISTANT_TOKEN'))
      } else if (msg.type === 'auth_ok') {
        send({ type: 'lovelace/dashboards/list' })
      } else if (msg.type === 'result') {
        let req = pending[msg.id]!
        if (req.type === 'lovelace/dashboards/list') {
          if (!msg.success) {
            reject(
              new Error('WebSocket request lovelace/dashboards/list failed')
            )
            return
          }
          let dashboards = msg.result as Dashboard[]
          let targets = [
            { name: 'overview', url_path: null },
            ...dashboards
              .filter(d => d.url_path !== 'map')
              .map(d => ({
                name: d.url_path ?? d.id,
                url_path: d.url_path
              }))
          ]
          expected = targets.length
          for (let t of targets) {
            send({ type: 'lovelace/config', url_path: t.url_path }, t.name)
          }
        } else if (msg.success) {
          results.push({
            name: req.name!,
            config: msg.result as Record<string, unknown>
          })
          if (++got === expected) {
            ws.close()
            resolve(results)
          }
        } else {
          if (++got === expected) {
            ws.close()
            resolve(results)
          }
        }
      }
    }
    ws.onerror = () => reject(new Error(`Cannot connect to ${WS}`))
  })
}

async function downloadDashboards(): Promise<void> {
  let items = await fetchDashboards()
  let dir = join(import.meta.dirname, 'dashboard')
  mkdirSync(dir, { recursive: true })
  for (let f of readdirSync(dir)) {
    if (f.endsWith('.yaml')) rmSync(join(dir, f))
  }
  for (let { name, config } of items) {
    writeFileSync(join(dir, fileName(name)), toYaml(config))
    console.error(`  - ${name}`)
  }
  console.log(`Saved ${items.length} dashboard(s) to dashboard/`)
}

const NO_AREA = 'Без области'

const EXCLUDE_ENTITIES = [
  /^conversation\./,
  /^update\./,
  /^device_tracker\./,
  /^automation\./,
  /^todo\./,
  /^tts\./,
  /\.halva/,
  /zigbee2mqtt_bridge/,
  /backup/,
  /^sensor\.petlibro_/
]

function isNoise(meta: EntityEntry | undefined): boolean {
  return Boolean(
    meta?.disabled_by ||
    meta?.hidden_by ||
    meta?.entity_category === 'diagnostic' ||
    meta?.entity_category === 'config'
  )
}

// Sensors created from a user-defined template helper, not from a device
function isCustomSensor(entityId: string, meta: EntityEntry | undefined): boolean {
  return /^(binary_)?sensor\./.test(entityId) && meta?.platform === 'template'
}

function isInput(entityId: string): boolean {
  return entityId.startsWith('input_')
}

function describe(s: HassState): string {
  let a = s.attributes
  let parts = [a.friendly_name ?? s.entity_id]
  if (s.state.length <= 40) {
    parts.push(
      a.unit_of_measurement ? `${s.state} ${a.unit_of_measurement}` : s.state
    )
  }
  if (a.device_class) parts.push(a.device_class)
  return parts.join(' · ')
}

function writeEntities(states: HassState[], registry: Registry): void {
  let metaById: Record<string, EntityEntry> = {}
  for (let e of registry.entities) metaById[e.entity_id] = e

  let areas: Record<string, Record<string, string>> = {}
  for (let s of states) {
    if (EXCLUDE_ENTITIES.some(re => re.test(s.entity_id))) continue
    let meta = metaById[s.entity_id]
    if (isNoise(meta)) continue
    if (isInput(s.entity_id) || isCustomSensor(s.entity_id, meta)) continue

    let areaId =
      meta?.area_id ??
      (meta?.device_id ? registry.deviceArea[meta.device_id] : undefined)
    let area = (areaId && registry.areaById[areaId]) || NO_AREA
    ;(areas[area] ||= {})[s.entity_id] = describe(s)
  }

  let order = (x: string, y: string) =>
    x === NO_AREA ? 1 : y === NO_AREA ? -1 : x.localeCompare(y)
  let sorted: Record<string, Record<string, string>> = {}
  for (let area of Object.keys(areas).sort(order)) {
    let inner: Record<string, string> = {}
    for (let id of Object.keys(areas[area]!).sort())
      inner[id] = areas[area]![id]!
    sorted[area] = inner
  }

  let header =
    '# Auto-generated by download-ha.ts\n' +
    '# Important home entities grouped by area\n' +
    '# Format: entity_id: "friendly name · current value · device_class"\n\n'
  let dir = join(import.meta.dirname, 'home')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'entities.yaml'), header + toYaml(sorted))

  let count = Object.values(sorted).reduce(
    (n, m) => n + Object.keys(m).length,
    0
  )
  console.log(`Saved ${count} entities to home/entities.yaml`)
}

function writeDump(file: string, entries: unknown[], label: string): void {
  let dir = join(import.meta.dirname, 'home')
  mkdirSync(dir, { recursive: true })
  let yaml = entries.map(entry => toYaml([entry])).join('\n')
  writeFileSync(join(dir, file), yaml)
  console.log(`Saved ${entries.length} ${label} to home/${file}`)
}

function writeRooms(registry: Registry): void {
  let entries = registry.areas
    .map(a => ({ id: a.area_id, name: a.name, ...(a.icon && { icon: a.icon }) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  writeDump('rooms.yaml', entries, 'rooms')
}

// UI input helpers list their config by their original object id (unique_id),
// which stays fixed even after the entity is renamed to an English entity_id.
function writeInputs(
  helpers: InputHelper[],
  registry: Registry
): void {
  let entityByUnique: Record<string, string> = {}
  for (let e of registry.entities) {
    if (e.platform?.startsWith('input_') && e.unique_id) {
      entityByUnique[`${e.platform}.${e.unique_id}`] = e.entity_id
    }
  }

  let entries = helpers
    .map(({ domain, item }) => {
      let { id, name, ...rest } = item
      let entityId = entityByUnique[`${domain}.${id}`] ?? `${domain}.${id}`
      let room = registry.entityArea[entityId]
      return {
        id: entityId,
        ...(name !== undefined && { name }),
        ...(room && { room }),
        ...rest
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  writeDump('inputs.yaml', entries, 'input helpers')
}

function writeSensors(
  templates: TemplateSensor[],
  states: HassState[],
  registry: Registry
): void {
  let entityByEntry: Record<string, string> = {}
  for (let e of registry.entities) {
    if (e.config_entry_id) entityByEntry[e.config_entry_id] = e.entity_id
  }
  let nameById: Record<string, string> = {}
  for (let s of states) {
    if (s.attributes.friendly_name) nameById[s.entity_id] = s.attributes.friendly_name
  }

  let entries = templates
    .map(({ entryId, config }) => {
      let entityId = entityByEntry[entryId]
      if (!entityId || !/^(binary_)?sensor\./.test(entityId)) return null
      let name = nameById[entityId]
      let room = registry.entityArea[entityId]
      return {
        id: entityId,
        ...(name !== undefined && { name }),
        ...(room && { room }),
        ...config
      }
    })
    .filter((e): e is { id: string } & Record<string, unknown> => e !== null)
    .sort((a, b) => a.id.localeCompare(b.id))

  writeDump('sensors.yaml', entries, 'custom sensors')
}

interface InputHelper {
  domain: string
  item: { id: string; name?: string } & Record<string, unknown>
}

interface TemplateSensor {
  entryId: string
  config: Record<string, unknown>
}

interface SchemaField {
  name?: string
  type?: string
  schema?: SchemaField[]
  description?: { suggested_value?: unknown }
}

function fetchInputHelpers(domains: string[]): Promise<InputHelper[]> {
  return new Promise((resolve, reject) => {
    if (!domains.length) {
      resolve([])
      return
    }
    let ws = new WebSocket(WS)
    let seq = 0
    let pending: Record<number, string> = {}
    let out: InputHelper[] = []
    let got = 0

    let send = (domain: string) => {
      let id = ++seq
      pending[id] = domain
      ws.send(JSON.stringify({ id, type: `${domain}/list` }))
    }

    ws.onmessage = (ev: MessageEvent) => {
      let msg = JSON.parse(ev.data)
      if (msg.type === 'auth_required') {
        ws.send(
          JSON.stringify({
            type: 'auth',
            access_token: process.env.HOMEASSISTANT_TOKEN
          })
        )
      } else if (msg.type === 'auth_invalid') {
        reject(new Error('WebSocket auth failed: check HOMEASSISTANT_TOKEN'))
      } else if (msg.type === 'auth_ok') {
        for (let d of domains) send(d)
      } else if (msg.type === 'result') {
        let domain = pending[msg.id]!
        if (msg.success) {
          for (let item of msg.result as InputHelper['item'][]) {
            out.push({ domain, item })
          }
        }
        if (++got === domains.length) {
          ws.close()
          resolve(out)
        }
      }
    }
    ws.onerror = () => reject(new Error(`Cannot connect to ${WS}`))
  })
}

// UI template helpers keep their config in the config entry, which the API
// hides. An options flow echoes the current values back as suggested_value.
function collectSuggested(
  schema: SchemaField[],
  out: Record<string, unknown>
): void {
  for (let field of schema) {
    if (field.type === 'expandable' && field.schema) {
      collectSuggested(field.schema, out)
    } else if (field.name) {
      let value = field.description?.suggested_value
      if (value !== undefined && value !== '') out[field.name] = value
    }
  }
}

async function fetchTemplateSensors(): Promise<TemplateSensor[]> {
  let entries = await api<{ entry_id: string; domain: string }[]>(
    'config/config_entries/entry'
  )
  let result: TemplateSensor[] = []
  for (let entry of entries) {
    if (entry.domain !== 'template') continue
    try {
      let flow = await apiSend<{ flow_id: string; data_schema: SchemaField[] }>(
        'POST',
        'config/config_entries/options/flow',
        { handler: entry.entry_id }
      )
      let config: Record<string, unknown> = {}
      collectSuggested(flow.data_schema, config)
      await apiSend('DELETE', `config/config_entries/options/flow/${flow.flow_id}`)
      result.push({ entryId: entry.entry_id, config })
    } catch {
      console.error(styleText('red', `  ! skipped template ${entry.entry_id}`))
    }
  }
  return result
}

try {
  console.info(`Fetching entities from ${HOST} …`)
  let states = await api<HassState[]>('states')
  let registry = await fetchRegistry(DOMAINS.map(d => d.scope))
  for (let domain of DOMAINS) {
    await download(domain, states, registry)
  }
  writeEntities(states, registry)
  writeRooms(registry)

  let inputDomains = [
    ...new Set(
      registry.entities
        .filter(e => e.platform?.startsWith('input_'))
        .map(e => e.platform!)
    )
  ]
  writeInputs(await fetchInputHelpers(inputDomains), registry)
  writeSensors(await fetchTemplateSensors(), states, registry)

  await downloadDashboards()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
