#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT = 'automations.yml'
const HOST = 'https://domovoy.local'

// HTTP goes through `curl` so it trusts the custom CA of domovoy.local
function api(path) {
  return execSync(
    `curl -fsS -m 30 ` +
      `-H "Authorization: Bearer $HOMEASSISTANT_TOKEN" ` +
      `-H "Content-Type: application/json" ` +
      JSON.stringify(`${HOST}/api/${path}`),
    {
      env: {
        ...process.env,
        HOMEASSISTANT_TOKEN: process.env.HOMEASSISTANT_TOKEN
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }
  )
}

// Non-"plain-safe" strings are quoted (single by default, double when they hold a
// single quote or need escapes). YAML 1.1 footguns (bools, null, numbers,
// sexagesimal times like "10:00:00", ISO dates) are quoted so they stay strings.

let NUM =
  /^[-+]?(\.inf|\.nan|0x[0-9a-fA-F]+|0o[0-7]+|\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)$/
let SEXA = /^[-+]?\d[\d_]*(:[0-5]?\d)+(\.\d*)?$/
let TS =
  /^\d{4}-\d\d?-\d\d?(([Tt]|[ \t]+)\d\d?:\d\d?:\d\d?(\.\d*)?([ \t]*(Z|[-+]\d\d?(:\d\d)?))?)?$/
let CTRL = /[\u0000-\u001f\u007f]/
let RESERVED = new Set(['null', '~', 'true', 'false', 'yes', 'no', 'on', 'off'])

function plainOk(s) {
  if (s === '' || s !== s.trim()) return false
  if (RESERVED.has(s.toLowerCase())) return false
  if (NUM.test(s) || SEXA.test(s) || TS.test(s)) return false
  if (CTRL.test(s) || s.includes('\t')) return false
  if ('!&*?|>@`"\'%#,[]{}'.includes(s[0])) return false
  if ('-:'.includes(s[0]) && (s.length === 1 || s[1] === ' ')) return false
  if (s.includes(': ') || s.endsWith(':') || s.includes(' #')) return false
  return true
}

function scalar(v) {
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

let isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v)
let lines = []

function renderDict(node, indent, first) {
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

function renderList(node, indent) {
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

function toYaml(data) {
  lines.length = 0
  if (Array.isArray(data)) renderList(data, 0)
  else if (isMap(data)) renderDict(data, 0)
  else lines.push(scalar(data))
  return lines.join('\n') + (lines.length ? '\n' : '')
}

try {
  console.error(`Fetching automation list from ${HOST} ...`)

  let ids = JSON.parse(api('states'))
    .filter(
      s =>
        typeof s.entity_id === 'string' && s.entity_id.startsWith('automation.')
    )
    .map(s => s.attributes && s.attributes.id)
    .filter(Boolean)

  if (!ids.length) {
    console.error('No automations found (or none are UI-managed).')
    process.exit(1)
  }

  let configs = []
  for (let id of ids) {
    configs.push(JSON.parse(api(`config/automation/config/${id}`)))
    console.error(`  - ${id}`)
  }

  writeFileSync(join(import.meta.dirname, OUTPUT), toYaml(configs))
  console.log(`Saved ${configs.length} automation(s) to ${OUTPUT}`)
} catch (err) {
  console.error(err.message || String(err))
  process.exit(1)
}
