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
  Уведомления: 'notifications'
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

interface Registry {
  categoryByEntity: Record<string, string>
  uniqueIdByEntity: Record<string, string>
  entities: EntityEntry[]
  areaById: Record<string, string>
  deviceArea: Record<string, string>
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
          for (let a of msg.result as Area[]) areaById[a.area_id] = a.name
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
          resolve({
            categoryByEntity,
            uniqueIdByEntity,
            entities,
            areaById,
            deviceArea
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
  return base + '.yml'
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
      id: registry.uniqueIdByEntity[s.entity_id] ?? s.attributes?.id
    }))
    .filter((a): a is { entityId: string; id: string } => Boolean(a.id))

  if (!items.length) {
    console.info(`No UI-managed ${domain.outputDir} found.`)
    return
  }

  let groups: Record<string, unknown[]> = {}
  for (let { entityId, id } of items) {
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
    let entry =
      alias === undefined
        ? { id: entityId, ...rest }
        : { id: entityId, alias, ...rest }
    ;(groups[category] ||= []).push(entry)
    console.error(`  - [${category}] ${entityId}`)
  }

  let dir = join(import.meta.dirname, domain.outputDir)
  mkdirSync(dir, { recursive: true })
  for (let f of readdirSync(dir)) {
    if (f.endsWith('.yml')) rmSync(join(dir, f))
  }

  let count = 0
  for (let [category, configs] of Object.entries(groups)) {
    writeFileSync(join(dir, fileName(category)), toYaml(configs))
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
            reject(new Error('WebSocket request lovelace/dashboards/list failed'))
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
          console.error(
            styleText('red', `  ! skipped dashboard ${req.name} (yaml mode)`)
          )
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
    if (f.endsWith('.yml')) rmSync(join(dir, f))
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

function writeEntities(states: HassState[], registry: Registry): void {
  let metaById: Record<string, EntityEntry> = {}
  for (let e of registry.entities) metaById[e.entity_id] = e

  let areas: Record<string, Record<string, string>> = {}
  for (let s of states) {
    if (EXCLUDE_ENTITIES.some(re => re.test(s.entity_id))) continue
    let meta = metaById[s.entity_id]
    if (isNoise(meta)) continue

    let areaId =
      meta?.area_id ??
      (meta?.device_id ? registry.deviceArea[meta.device_id] : undefined)
    let area = (areaId && registry.areaById[areaId]) || NO_AREA

    let a = s.attributes
    let parts = [a.friendly_name ?? s.entity_id]
    if (s.state.length <= 40) {
      parts.push(
        a.unit_of_measurement ? `${s.state} ${a.unit_of_measurement}` : s.state
      )
    }
    if (a.device_class) parts.push(a.device_class)
    ;(areas[area] ||= {})[s.entity_id] = parts.join(' · ')
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
  writeFileSync(join(dir, 'entities.yml'), header + toYaml(sorted))

  let count = Object.values(sorted).reduce(
    (n, m) => n + Object.keys(m).length,
    0
  )
  console.log(`Saved ${count} entities to home/entities.yml`)
}

try {
  console.info(`Fetching entities from ${HOST} …`)
  let states = await api<HassState[]>('states')
  let registry = await fetchRegistry(DOMAINS.map(d => d.scope))
  for (let domain of DOMAINS) {
    await download(domain, states, registry)
  }
  writeEntities(states, registry)
  await downloadDashboards()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
