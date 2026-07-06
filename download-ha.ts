#!/usr/bin/env -S node --use-system-ca --experimental-strip-types

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  configId: (state: HassState) => string | undefined
  configPath: (id: string) => string
}

const DOMAINS: Domain[] = [
  {
    prefix: 'automation.',
    outputDir: 'automations',
    scope: 'automation',
    configId: s => s.attributes?.id,
    configPath: id => `config/automation/config/${id}`
  },
  {
    prefix: 'script.',
    outputDir: 'scripts',
    scope: 'script',
    configId: s => s.entity_id.slice('script.'.length),
    configPath: id => `config/script/config/${id}`
  }
]

interface HassState {
  entity_id: string
  attributes: { id?: string }
}

interface Category {
  category_id: string
  name: string
}

interface EntityEntry {
  entity_id: string
  categories?: Record<string, string>
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

function fetchCategories(scopes: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let ws = new WebSocket(WS)
    let seq = 0
    let pending: Record<number, { type: string; scope?: string }> = {}
    let byScope: Record<string, Record<string, string>> = {}
    let entityCategory: Record<string, { scope: string; id: string }> = {}
    let got = 0
    let expected = scopes.length + 1

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
      } else if (msg.type === 'result') {
        let req = pending[msg.id]!
        if (!msg.success) {
          reject(new Error(`WebSocket request ${req.type} failed`))
          return
        }
        if (req.type === 'config/category_registry/list') {
          let map = (byScope[req.scope!] ||= {})
          for (let c of msg.result as Category[]) map[c.category_id] = c.name
        } else {
          for (let e of msg.result as EntityEntry[]) {
            for (let [scope, id] of Object.entries(e.categories ?? {})) {
              if (id) entityCategory[e.entity_id] = { scope, id }
            }
          }
        }
        if (++got === expected) {
          ws.close()
          let byEntity: Record<string, string> = {}
          for (let [entity, { scope, id }] of Object.entries(entityCategory)) {
            let name = byScope[scope]?.[id]
            if (name) byEntity[entity] = name
          }
          resolve(byEntity)
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
  categoryByEntity: Record<string, string>
): Promise<void> {
  let items = states
    .filter(s => s.entity_id.startsWith(domain.prefix))
    .map(s => ({ entityId: s.entity_id, id: domain.configId(s) }))
    .filter((a): a is { entityId: string; id: string } => Boolean(a.id))

  if (!items.length) {
    console.info(`No UI-managed ${domain.outputDir} found.`)
    return
  }

  let groups: Record<string, unknown[]> = {}
  for (let { entityId, id } of items) {
    let category = categoryByEntity[entityId] || UNCATEGORIZED
    let config
    try {
      config = await api<Record<string, unknown>>(domain.configPath(id))
    } catch {
      console.error(`  ! skipped ${entityId} (not editable)`)
      continue
    }
    delete config.id
    if (typeof config.description === 'string' && !config.description.trim()) {
      delete config.description
    }
    ;(groups[category] ||= []).push(config)
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

try {
  console.info(`Fetching entities from ${HOST} ...`)
  let states = await api<HassState[]>('states')
  let categoryByEntity = await fetchCategories(DOMAINS.map(d => d.scope))
  for (let domain of DOMAINS) {
    await download(domain, states, categoryByEntity)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
