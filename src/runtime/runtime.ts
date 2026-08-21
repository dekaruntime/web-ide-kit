import { createGlobals } from './globals';
import { VirtualFs } from './fs';
import { getSharedSandbox, type SandboxRunResult } from './sandbox';
import {
  type CompilerArtifactManifest,
  validateCompilerArtifactManifest,
} from './compiler-artifact';

let dekaCompilerArtifactPath = '/tour/deka-compiler-artifact.json';

/**
 * Configure the URL/path used to fetch the Deka compiler artifact manifest.
 * Call once during app initialization before invoking any compile/format/run
 * function. Relative paths resolve against the current window origin.
 */
export function setCompilerArtifactPath(path: string) {
  dekaCompilerArtifactPath = path;
}

export function getCompilerArtifactPath(): string {
  return dekaCompilerArtifactPath;
}

export interface CompilerDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
  file?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  help?: string;
  /** Pre-formatted diagnostic text produced by the runtime's formatter. */
  rendered?: string;
}

export interface CompileResult {
  ok: boolean;
  js?: string;
  error?: string;
  warnings: string[];
  diagnostics: CompilerDiagnostic[];
  compiler?: CompilerArtifactManifest['compiler'];
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  html?: string;
}

export type { SandboxRunResult };

export interface WasmExports {
  memory: WebAssembly.Memory;
  deka_compiler_alloc: (size: number) => number;
  deka_compiler_free: (ptr: number, size: number) => void;
  deka_compiler_compile: (
    sourcePtr: number,
    sourceLen: number,
    filenamePtr: number,
    filenameLen: number,
    modePtr: number,
    modeLen: number
  ) => number;
  deka_compiler_format_js: (sourcePtr: number, sourceLen: number) => number;
  deka_compiler_format_ds: (sourcePtr: number, sourceLen: number) => number;
  deka_compiler_project_new: () => number;
  deka_compiler_project_free: (projectId: number) => void;
  deka_compiler_project_write: (
    projectId: number,
    pathPtr: number,
    pathLen: number,
    sourcePtr: number,
    sourceLen: number
  ) => void;
  deka_compiler_project_compile: (projectId: number) => number;
  deka_compiler_project_read: (projectId: number, pathPtr: number, pathLen: number) => number;
}

export interface WasmCompiler {
  exports: WasmExports;
  compiler?: CompilerArtifactManifest['compiler'];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let compilerPromise: Promise<WasmCompiler> | null = null;

function toDiagnostic(error: string): CompilerDiagnostic {
  return { severity: 'error', message: error };
}

export function normalizeDiagnostics(value: unknown): CompilerDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((diagnostic) => {
    if (!diagnostic || typeof diagnostic !== 'object') return [];
    const raw = diagnostic as Record<string, unknown>;
    if (typeof raw.message !== 'string') return [];
    const severity = raw.severity === 'error' || raw.severity === 'warning' || raw.severity === 'info'
      ? raw.severity
      : 'info';
    return [{
      severity,
      message: raw.message,
      code: typeof raw.code === 'string' ? raw.code : undefined,
      file: typeof raw.file === 'string' ? raw.file : typeof raw.filename === 'string' ? raw.filename : undefined,
      line: typeof raw.line === 'number' ? raw.line : typeof raw.start_line === 'number' ? raw.start_line : undefined,
      column: typeof raw.column === 'number' ? raw.column : typeof raw.start_column === 'number' ? raw.start_column : undefined,
      endLine: typeof raw.endLine === 'number' ? raw.endLine : typeof raw.end_line === 'number' ? raw.end_line : undefined,
      endColumn: typeof raw.endColumn === 'number' ? raw.endColumn : typeof raw.end_column === 'number' ? raw.end_column : undefined,
      help: typeof raw.help === 'string' ? raw.help : undefined,
      rendered: typeof raw.rendered === 'string' ? raw.rendered : undefined,
    }];
  });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getCompilerBaseUrl(): string | URL {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  // Non-browser environments (e.g. Bun/Node build scripts) pass an absolute URL
  // via setCompilerArtifactPath. Fall back to the configured path itself so the
  // relative artifact file resolves against the manifest URL.
  if (dekaCompilerArtifactPath.startsWith('http://') || dekaCompilerArtifactPath.startsWith('https://')) {
    return dekaCompilerArtifactPath;
  }
  throw new Error('Deka compiler artifact path must be absolute when running outside a browser');
}

async function loadDekaCompiler(): Promise<WasmCompiler> {
  const manifestResponse = await fetch(dekaCompilerArtifactPath, { cache: 'no-cache' });
  if (!manifestResponse.ok) {
    throw new Error(`Failed to fetch Deka compiler manifest: ${manifestResponse.status} ${manifestResponse.statusText}`);
  }

  const manifest = validateCompilerArtifactManifest(await manifestResponse.json());
  const wasmUrl = new URL(manifest.artifact.file, new URL(dekaCompilerArtifactPath, getCompilerBaseUrl()));
  const wasmResponse = await fetch(wasmUrl);
  if (!wasmResponse.ok) {
    throw new Error(`Failed to fetch Deka compiler: ${wasmResponse.status} ${wasmResponse.statusText}`);
  }

  const bytes = await wasmResponse.arrayBuffer();
  const actualChecksum = await sha256(bytes);
  if (actualChecksum !== manifest.artifact.sha256) {
    throw new Error('Deka compiler checksum does not match its artifact manifest');
  }

  const wasmModule = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(wasmModule, {});
  return { exports: instance.exports as unknown as WasmExports, compiler: manifest.compiler };
}

export function getDekaCompiler(): Promise<WasmCompiler> {
  compilerPromise ??= loadDekaCompiler();
  return compilerPromise;
}

export function resetDekaCompilerCacheForTests() {
  compilerPromise = null;
}

export async function compileDeka(
  source: string,
  filename: string
): Promise<CompileResult> {
  try {
    const compiler = await getDekaCompiler();
    return compileWithDekaAbi(compiler, source, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, warnings: [], diagnostics: [toDiagnostic(message)] };
  }
}

/** Test-only direct artifact entrypoint; production loads the verified manifest. */
export async function compileDekaWithWasm(
  source: string,
  filename: string,
  wasmUrl: string
): Promise<CompileResult> {
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Failed to fetch Deka compiler: ${response.status} ${response.statusText}`);
    const bytes = await response.arrayBuffer();
    const wasmModule = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(wasmModule, {});
    return compileWithDekaAbi({ exports: instance.exports as unknown as WasmExports }, source, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, warnings: [], diagnostics: [toDiagnostic(message)] };
  }
}

export interface FormatResult {
  ok: boolean;
  code?: string;
  error?: string;
}

export async function formatDekaJs(source: string): Promise<FormatResult> {
  try {
    const compiler = await getDekaCompiler();
    return formatWithDekaAbi(compiler, source, 'js');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function formatDekaDs(source: string): Promise<FormatResult> {
  try {
    const compiler = await getDekaCompiler();
    return formatWithDekaAbi(compiler, source, 'ds');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function formatWithDekaAbi(
  compiler: WasmCompiler,
  source: string,
  language: 'js' | 'ds'
): FormatResult {
  const exports = compiler.exports;
  const allocate = exports.deka_compiler_alloc;
  const free = exports.deka_compiler_free;

  const sourceBytes = textEncoder.encode(source);
  const sourcePtr = allocate(sourceBytes.length);

  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(sourceBytes, sourcePtr);

  const resultPtr =
    language === 'js'
      ? exports.deka_compiler_format_js(sourcePtr, sourceBytes.length)
      : exports.deka_compiler_format_ds(sourcePtr, sourceBytes.length);

  const resultView = new DataView(exports.memory.buffer);
  const jsonPtr = resultView.getUint32(resultPtr, true);
  const jsonLen = resultView.getUint32(resultPtr + 4, true);

  const jsonBytes = new Uint8Array(exports.memory.buffer, jsonPtr, jsonLen);
  const jsonText = textDecoder.decode(jsonBytes);

  let parsed: Partial<FormatResult> & { output?: { code?: string }; diagnostics?: unknown };
  try {
    parsed = JSON.parse(jsonText) as Partial<FormatResult>;
  } catch {
    const error = `Deka compiler returned invalid JSON: ${jsonText}`;
    return { ok: false, error };
  }

  free(resultPtr, 8 + jsonLen);
  free(sourcePtr, sourceBytes.length);

  const diagnostics = normalizeDiagnostics(parsed.diagnostics);
  const error = parsed.error ?? diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message;
  return {
    ok: parsed.ok ?? false,
    code: parsed.output?.code,
    error,
  };
}

/**
 * The public tour consumes only the neutral Deka browser ABI.
 */
function compileWithDekaAbi(
  compiler: WasmCompiler,
  source: string,
  filename: string
): CompileResult {
  const exports = compiler.exports;
  const allocate = exports.deka_compiler_alloc;
  const free = exports.deka_compiler_free;

  const sourceBytes = textEncoder.encode(source);
  const filenameBytes = textEncoder.encode(filename);
  const modeBytes = textEncoder.encode('deka');

  const sourcePtr = allocate(sourceBytes.length);
  const filenamePtr = allocate(filenameBytes.length);
  const modePtr = allocate(modeBytes.length);

  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(sourceBytes, sourcePtr);
  memory.set(filenameBytes, filenamePtr);
  memory.set(modeBytes, modePtr);

  const resultPtr = exports.deka_compiler_compile(
    sourcePtr,
    sourceBytes.length,
    filenamePtr,
    filenameBytes.length,
    modePtr,
    modeBytes.length
  );

  // WasmResult is { ptr: u32, len: u32 } in little-endian.
  const resultView = new DataView(exports.memory.buffer);
  const jsonPtr = resultView.getUint32(resultPtr, true);
  const jsonLen = resultView.getUint32(resultPtr + 4, true);

  const jsonBytes = new Uint8Array(exports.memory.buffer, jsonPtr, jsonLen);
  const jsonText = textDecoder.decode(jsonBytes);

  let parsed: Partial<CompileResult> & {
    output?: { code?: string };
    diagnostics?: unknown;
    metadata?: { compiler?: { name?: string; version?: string; source_commit?: string } };
  };
  try {
    parsed = JSON.parse(jsonText) as Partial<CompileResult>;
  } catch {
    const error = `Deka compiler returned invalid JSON: ${jsonText}`;
    return { ok: false, error, warnings: [], diagnostics: [toDiagnostic(error)], compiler: compiler.compiler };
  }

  // Free the contiguous result block (WasmResult header + JSON payload).
  free(resultPtr, 8 + jsonLen);
  free(sourcePtr, sourceBytes.length);
  free(filenamePtr, filenameBytes.length);
  free(modePtr, modeBytes.length);

  const diagnostics = normalizeDiagnostics(parsed.diagnostics);
  const error = parsed.error ?? diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message;
  return {
    ok: parsed.ok ?? false,
    js: parsed.output?.code ?? parsed.js,
    error,
    warnings: parsed.warnings ?? [],
    diagnostics: diagnostics.length > 0 ? diagnostics : (error ? [toDiagnostic(error)] : []),
    compiler: compiler.compiler,
  };
}

function stripModuleMetadata(jsCode: string): string {
  return jsCode
    .replace(/^export const \w+ = [^;]+;\n?/gm, '')
    .replace(/^export \{[\s\S]*?\};\n?/gm, '')
    .replace(/^export async function \w+[\s\S]*$/m, '')
    .replace(/^import .*component\/core.*;\n?/m, '');
}

/**
 * Strip the demand-driven runtime prelude from emitted JS so the RAW panel can
 * show just the transpiled user code. The prelude consists of header comments,
 * build-mode exports, globalThis polyfill installs, the safe-globals IIFE, the
 * deka runtime object, and the JSX helper aliases generated by the browser
 * compiler. Everything after that boundary is kept, including struct-method
 * registrations and any top-level wrapper.
 */
const RAW_USER_CODE_MARKER = '// --- deka:user-code ---';

/**
 * Strip the demand-driven runtime prelude from emitted JS so the RAW panel can
 * show just the transpiled user code.
 *
 * Modern compilers emit a stable boundary marker (`// --- deka:user-code ---`)
 * between the prelude and the user program. When that marker is present we
 * split on it directly. Older compilers (and any prelude variants that predate
 * the marker) fall back to the heuristic pattern matcher.
 */
export function formatRawJs(jsCode: string): string {
  const markerIndex = jsCode.indexOf(RAW_USER_CODE_MARKER);
  if (markerIndex !== -1) {
    const afterMarker = jsCode.slice(markerIndex + RAW_USER_CODE_MARKER.length);
    const trimmed = afterMarker.replace(/^\n+/, '');
    return trimmed.replace(/\n+$/, '');
  }

  const lines = jsCode.split('\n');
  const kept: string[] = [];
  let foundUserCode = false;
  let skippingMultiLine = false;
  let braceDepth = 0;

  const isPreludeStart = (trimmed: string): boolean =>
    trimmed === '' ||
    trimmed.startsWith('//') ||
    /^export const \w+ = /.test(trimmed) ||
    /^globalThis\./.test(trimmed) ||
    /^const __DekaUnsafeGlobals=/.test(trimmed) ||
    /^const __deka=/.test(trimmed) ||
    /^const deka=/.test(trimmed) ||
    /^const jsx = globalThis\.jsx;\s*$/.test(trimmed) ||
    /^const jsxs = globalThis\.jsxs;\s*$/.test(trimmed) ||
    /^import .*component\/core.*;\s*$/.test(trimmed);

  const countBraces = (text: string): number => {
    let depth = 0;
    for (const ch of text) {
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
    }
    return depth;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!foundUserCode) {
      if (!skippingMultiLine && isPreludeStart(trimmed)) {
        // The safe-globals IIFE and deka runtime object are emitted as single
        // minified statements that span multiple lines. Track brace depth so we
        // consume the whole statement before resuming.
        if (
          /^globalThis\./.test(trimmed) ||
          /^const __DekaUnsafeGlobals=/.test(trimmed) ||
          /^const __deka=/.test(trimmed) ||
          /^const deka=/.test(trimmed)
        ) {
          skippingMultiLine = true;
          braceDepth = countBraces(trimmed);
          if (braceDepth > 0 || !trimmed.endsWith(';')) {
            continue;
          }
          skippingMultiLine = false;
        }
        continue;
      }
      if (skippingMultiLine) {
        braceDepth += countBraces(trimmed);
        if (braceDepth <= 0 && trimmed.endsWith(';')) {
          skippingMultiLine = false;
        }
        continue;
      }
      foundUserCode = true;
    }
    kept.push(line);
  }
  // Trim trailing blank lines while preserving internal spacing.
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
    kept.pop();
  }
  return kept.join('\n');
}

/**
 * Execute compiled DekaScript JS in a sandboxed function scope.
 *
 * Globals are injected as local identifiers so emitted code can reference
 * `__dekaPrint`, `console`, `process`, and `__dekaFs` directly. stdout/stderr
 * are captured into separate buffers and returned.
 *
 * This is the direct (non-Worker) path. Browser calls use the isolated Worker.
 */
export async function runDekaJsDirect(
  jsCode: string,
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const globals = createGlobals({
    stdout: { write: (value: string) => stdout.push(value) },
    stderr: { write: (value: string) => stderr.push(value) },
    cwd: options.cwd,
    env: options.env,
    fs: new VirtualFs(),
  });

  const allKeys = Object.keys(globals);
  const executable = stripModuleMetadata(jsCode);

  // Pass every supplied global as a function parameter so generated code uses
  // the captured console and process rather than the host environment.
  const localKeys = allKeys;
  const localValues = localKeys.map((key) => globals[key]);
  const READ_ONLY_GLOBALS = new Set(['crypto']);
  const installedKeys = allKeys.filter((key) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && !READ_ONLY_GLOBALS.has(key));
  const hostGlobals = globalThis as Record<string, unknown>;
  const previousGlobals = new Map(
    installedKeys.map((key) => [key, { exists: key in hostGlobals, value: hostGlobals[key] }])
  );

  // Reset the response object so each run starts clean. The emitted prelude
  // lazily initializes it, and frontmatter templates explicitly overwrite it.
  (globalThis as any).__dekaCurrentResponse = undefined;

  try {
    const globalInstalls = installedKeys
      .filter((key) => key !== 'deka')
      .map((key) => `globalThis.${key} = ${key};`)
      .join('\n');
    // Install deka outside the async IIFE. The latest compiler emits
    // `const deka = globalThis.deka = { ...globalThis.deka, ...__deka, ui: {...} }`
    // so the host-provided deka.ui must already be on globalThis.deka before
    // the emitted prelude runs. Installing it inside the IIFE would hit the
    // temporal dead zone of the compiler's own `const deka` declaration.
    const dekaInstall = 'globalThis.deka = deka;';
    const fn = new Function(
      ...localKeys,
      `${dekaInstall}\nreturn (async () => {\n"use strict";\n${globalInstalls}\n${executable}\n})();`
    );
    await fn(...localValues);

    const response = (globalThis as any).__phpxCurrentResponse ?? (globalThis as any).__dekaCurrentResponse;
    const html =
      typeof response === 'object' && response !== null
        ? String(response.body || '')
        : '';

    return {
      ok: true,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      html,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    for (const key of installedKeys) {
      const previous = previousGlobals.get(key)!;
      if (previous.exists) {
        hostGlobals[key] = previous.value;
      } else {
        delete hostGlobals[key];
      }
    }
  }
}

/**
 * Execute compiled DekaScript JS inside an isolated Web Worker sandbox.
 *
 * The Worker is created from a blob URL and runs the emitted JS in a context
 * with no access to the DOM, localStorage, cookies, or the parent window.
 * Communication happens strictly through `postMessage`. stdout/stderr are
 * captured inside the Worker and posted back.
 */
export async function runDekaJs(
  jsCode: string,
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<SandboxRunResult> {
  const sandbox = getSharedSandbox();
  return sandbox.run(jsCode, {
    cwd: options.cwd ?? '/tour',
    env: options.env ?? {},
    fs: { files: {}, dirs: ['/'] },
  });
}
