import { getDekaCompiler, type WasmCompiler, type WasmExports } from './runtime';
import { runDekaJsDirect, type RunResult } from './runtime';

export interface CompileProjectResult {
  ok: boolean;
  modules: Record<string, { code: string }>;
  diagnostics: Array<{
    severity: 'error' | 'warning' | 'info';
    message: string;
    code?: string;
    file?: string;
    line?: number;
    column?: number;
  }>;
}

export interface RunProjectResult extends RunResult {
  compileResult: CompileProjectResult;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function writeString(exports: WasmExports, text: string): number {
  const bytes = textEncoder.encode(text);
  const ptr = exports.deka_compiler_alloc(bytes.length);
  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(bytes, ptr);
  return ptr;
}

function readWasmResult(exports: WasmExports, resultPtr: number): { ptr: number; len: number } {
  const view = new DataView(exports.memory.buffer);
  return {
    ptr: view.getUint32(resultPtr, true),
    len: view.getUint32(resultPtr + 4, true),
  };
}

function freeResult(exports: WasmExports, resultPtr: number, jsonLen: number) {
  exports.deka_compiler_free(resultPtr, 8 + jsonLen);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Compile a multi-file DekaScript project using the WASM compiler's project-mode
 * ABI. Only relative `./foo.ds` imports are supported in this first phase.
 */
export async function compileDekaProject(
  files: Record<string, string>
): Promise<CompileProjectResult> {
  const compiler = await getDekaCompiler();
  const exports = compiler.exports;

  const projectId = exports.deka_compiler_project_new();
  if (projectId === 0) {
    return {
      ok: false,
      modules: {},
      diagnostics: [{ severity: 'error', message: 'failed to create compiler project' }],
    };
  }

  try {
    for (const [path, source] of Object.entries(files)) {
      const pathPtr = writeString(exports, normalizePath(path));
      const sourcePtr = writeString(exports, source);
      exports.deka_compiler_project_write(
        projectId,
        pathPtr,
        textEncoder.encode(normalizePath(path)).length,
        sourcePtr,
        textEncoder.encode(source).length
      );
      exports.deka_compiler_free(pathPtr, textEncoder.encode(normalizePath(path)).length);
      exports.deka_compiler_free(sourcePtr, textEncoder.encode(source).length);
    }

    const resultPtr = exports.deka_compiler_project_compile(projectId);
    const { ptr: jsonPtr, len: jsonLen } = readWasmResult(exports, resultPtr);
    const jsonBytes = new Uint8Array(exports.memory.buffer, jsonPtr, jsonLen);
    const jsonText = textDecoder.decode(jsonBytes);
    freeResult(exports, resultPtr, jsonLen);

    let parsed: Partial<CompileProjectResult>;
    try {
      parsed = JSON.parse(jsonText) as Partial<CompileProjectResult>;
    } catch {
      return {
        ok: false,
        modules: {},
        diagnostics: [{ severity: 'error', message: `invalid project compile JSON: ${jsonText}` }],
      };
    }

    return {
      ok: parsed.ok ?? false,
      modules: parsed.modules ?? {},
      diagnostics: parsed.diagnostics ?? [],
    };
  } finally {
    exports.deka_compiler_project_free(projectId);
  }
}

/**
 * Run a multi-file DekaScript project in the direct (non-Worker) sandbox.
 *
 * Each compiled module is wrapped in a factory function. The loader resolves
 * relative imports by matching the specifier to the module registry built from
 * the compiler output.
 */
export async function runDekaProject(
  entryPath: string,
  files: Record<string, string>
): Promise<RunProjectResult> {
  const compileResult = await compileDekaProject(files);
  if (!compileResult.ok || Object.keys(compileResult.modules).length === 0) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: compileResult.diagnostics.find((d) => d.severity === 'error')?.message ?? 'project compilation failed',
      compileResult,
    };
  }

  const normalizedEntry = normalizePath(entryPath);
  if (!compileResult.modules[normalizedEntry]) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: `entry module '${entryPath}' not found in compiled project`,
      compileResult,
    };
  }

  const moduleEntries = Object.entries(compileResult.modules).map(([path, module]) => {
    const safePath = JSON.stringify(path);
    const escapedCode = module.code
      .replace(/`/g, '\\`')
      .replace(/\${/g, '\\${');
    return `  ${safePath}: function(exports, __dekaRequire, module) {\n${escapedCode}\n}`;
  });

  const loader = `
const __dekaModules = {\n${moduleEntries.join(',\n')}\n};\n
const __dekaCache = new Map();\n
function __dekaResolve(spec, currentPath) {\n  if (!spec.startsWith('./') && !spec.startsWith('../')) {\n    return spec;\n  }\n  const base = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : '';\n  let parts = (base + spec).split('/').filter(Boolean);\n  let resolved = [];\n  for (const part of parts) {\n    if (part === '..') {\n      resolved.pop();\n    } else if (part !== '.') {\n      resolved.push(part);\n    }\n  }\n  return resolved.join('/');\n}\n
function __dekaRequire(spec, currentPath) {\n  const normalized = __dekaResolve(spec, currentPath || ${JSON.stringify(normalizedEntry)});\n  if (__dekaCache.has(normalized)) return __dekaCache.get(normalized);\n  const factory = __dekaModules[normalized];\n  if (!factory) {\n    throw new Error('Module not found: ' + spec + ' (resolved to ' + normalized + ')');\n  }\n  const module = { exports: {} };\n  factory(module.exports, (s) => __dekaRequire(s, normalized), module);\n  __dekaCache.set(normalized, module.exports);\n  return module.exports;\n}\n
__dekaRequire(${JSON.stringify(normalizedEntry)});\n`;

  const runResult = await runDekaJsDirect(loader);
  return {
    ...runResult,
    compileResult,
  };
}
