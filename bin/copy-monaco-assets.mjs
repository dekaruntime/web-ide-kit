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

// Fail loudly if any file the loader will request at runtime is missing.
// A tree that copies "successfully" without these 404s into HTML in the
// browser and surfaces as a script/worker parse error, which is invisible
// to every check that doesn't make a real HTTP request.
const required = [
  'loader.js',
  'editor/editor.main.js',
  'editor/editor.worker.js',
  'language/typescript/tsWorker.js',
  'language/json/jsonWorker.js',
  'language/css/cssWorker.js',
  'language/html/htmlWorker.js',
]
const missing = required.filter((file) => !fs.existsSync(path.join(targetDir, file)))
if (missing.length > 0) {
  console.error(`[copy-monaco] copied tree is missing files the loader requests:`)
  for (const file of missing) console.error(`[copy-monaco]   public/monaco-editor/min/vs/${file}`)
  process.exit(1)
}

console.log(`[copy-monaco] copied ${sourceDir} -> ${targetDir}`)
