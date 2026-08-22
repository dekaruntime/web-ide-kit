#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const cwd = process.env.INIT_CWD || process.cwd()
const sourceDir = path.join(cwd, 'node_modules', 'monaco-editor', 'min', 'vs')
const targetDir = path.join(cwd, 'public', 'monaco-editor', 'min', 'vs')

if (!fs.existsSync(sourceDir)) {
  console.error(`[copy-monaco] monaco-editor assets not found at ${sourceDir}`)
  console.error(`[copy-monaco] make sure monaco-editor is installed in your project`)
  process.exit(1)
}

fs.rmSync(targetDir, { recursive: true, force: true })
fs.mkdirSync(targetDir, { recursive: true })
fs.cpSync(sourceDir, targetDir, { recursive: true, dereference: true })

console.log(`[copy-monaco] copied ${sourceDir} -> ${targetDir}`)
