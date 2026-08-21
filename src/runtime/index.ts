export {
  setCompilerArtifactPath,
  getCompilerArtifactPath,
  type CompilerDiagnostic,
  type CompileResult,
  type RunResult,
  type SandboxRunResult,
  normalizeDiagnostics,
  compileDeka,
  compileDekaWithWasm,
  type FormatResult,
  formatDekaJs,
  formatDekaDs,
  formatRawJs,
  runDekaJsDirect,
  runDekaJs,
  resetDekaCompilerCacheForTests,
} from './runtime';

export { createGlobals, type GlobalsOptions } from './globals';
export { VirtualFs, type VirtualFile } from './fs';
export {
  getSharedSandbox,
  terminateSharedSandbox,
  DekaSandbox,
  type SandboxRunResult as WorkerSandboxRunResult,
} from './sandbox';
export { formatDiagnostic } from './diagnostic-format';
export {
  compileDekaProject,
  runDekaProject,
  type CompileProjectResult,
  type RunProjectResult,
} from './modules';
export {
  DEKA_COMPILER_MIN_ABI_VERSION,
  type CompilerArtifactManifest,
  validateCompilerArtifactManifest,
} from './compiler-artifact';
