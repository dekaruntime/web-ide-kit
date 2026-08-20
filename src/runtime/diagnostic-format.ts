import type { CompilerDiagnostic } from './runtime'

function severityLabel(severity: CompilerDiagnostic['severity']): string {
  switch (severity) {
    case 'error':
      return 'Error'
    case 'warning':
      return 'Warning'
    case 'info':
      return 'Info'
    default:
      return 'Diagnostic'
  }
}

function severityEmoji(severity: CompilerDiagnostic['severity']): string {
  switch (severity) {
    case 'error':
      return '❌'
    case 'warning':
      return '⚠️'
    case 'info':
      return 'ℹ️'
    default:
      return ''
  }
}

/**
 * Format a compiler diagnostic in a Rust/Gleam-style block:
 *
 * Error
 * ❌ Invalid Import
 *
 * ┌─ handler.ts:1:26
 * │
 *   1 │ import { serve } from 'deka/invalid';
 *     │                          ^^^^^^^^^^^^ Module 'deka/invalid' not found
 * │
 * = help: Available modules: deka, deka/router, deka/sqlite
 * │
 * └─
 */
export function formatDiagnostic(diagnostic: CompilerDiagnostic, source?: string): string {
  if (diagnostic.rendered) {
    return diagnostic.rendered
  }

  const label = severityLabel(diagnostic.severity)
  const emoji = severityEmoji(diagnostic.severity)
  const codeLine = emoji && diagnostic.code ? `${emoji} ${diagnostic.code}` : diagnostic.code || ''

  const parts: string[] = []
  parts.push(label)
  if (codeLine) {
    parts.push(codeLine)
  }
  parts.push('')

  const file = diagnostic.file || 'unknown'
  const line = diagnostic.line ?? 1
  const column = diagnostic.column ?? 1
  parts.push(`┌─ ${file}:${line}:${column}`)
  parts.push('│')

  const lineStr = String(line)
  const gutterWidth = Math.max(2, lineStr.length) + 1
  const sourcePrefix = `${lineStr.padStart(gutterWidth, ' ')} │ `
  const caretPrefix = `${' '.repeat(gutterWidth)} │ `

  const sourceLine = source && diagnostic.line ? source.split('\n')[diagnostic.line - 1] : undefined

  if (sourceLine !== undefined) {
    parts.push(`${sourcePrefix}${sourceLine}`)

    const caretStart = diagnostic.column ?? 1
    const caretEnd = diagnostic.endColumn ?? caretStart + 1
    const caretCount = Math.max(1, caretEnd - caretStart)
    const carets = '^'.repeat(caretCount)

    parts.push(`${caretPrefix}${' '.repeat(caretStart)}${carets} ${diagnostic.message}`)
  } else {
    parts.push(`${caretPrefix}${diagnostic.message}`)
  }

  parts.push('│')
  if (diagnostic.help) {
    parts.push(`= help: ${diagnostic.help}`)
    parts.push('│')
  }
  parts.push('└─')

  return parts.join('\n')
}
