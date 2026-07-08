#!/usr/bin/env -S node --experimental-strip-types

import { globSync, readFileSync } from 'node:fs'
import { parseAllDocuments } from 'yaml'

let files = globSync(['**/*.yaml'], {
  exclude: ['node_modules/**']
}).sort()

let failed = false
for (let file of files) {
  let src = readFileSync(file, 'utf8')
  for (let doc of parseAllDocuments(src)) {
    for (let err of doc.errors) {
      failed = true
      console.error(`${file}: ${err.message.trim()}`)
    }
  }
}

if (failed) process.exit(1)
console.log(`Checked ${files.length} YAML file(s)`)
