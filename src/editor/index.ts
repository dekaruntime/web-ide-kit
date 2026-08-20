export {
  DEKASCRIPT_LANGUAGE_ID,
  setLspWorkerPath,
  getLspWorkerPath,
  type LspPosition,
  type LspRange,
  type LspDiagnosticSeverity,
  type LspDiagnostic,
  type LspDiagnosticsMessage,
  type LspDocumentUpdate,
  type DekaScriptLspWorkerBridge,
  type DekaScriptWorkerLike,
  type DekaScriptWorkerFactory,
  parseLspDiagnosticsMessage,
  createDekaScriptLspWorkerBridge,
  DekaScriptDiagnosticsAdapter,
} from './lsp';

export {
  ensureDocsTheme,
  ensureDekaScriptLanguage,
  getDocsThemeName,
  getMonacoLanguage,
  ensureMonacoLoaded,
  waitForMonacoReady,
} from './monaco';
