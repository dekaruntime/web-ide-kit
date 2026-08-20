/**
 * Browser-facing seam for the shared DekaScript LSP Worker.
 *
 * The diagnostics Worker consumes the reviewed WASM contract from
 * dekaruntime/deka#38. Artifact absence remains a no-op state so a tour can
 * boot before the post-merge pinned artifact is available; invalid artifacts
 * are reported as errors and are never silently accepted.
 */
export const DEKASCRIPT_LANGUAGE_ID = 'dekascript';

let lspWorkerPath = '/tour/deka-diagnostics-worker.js';

/**
 * Configure the URL/path used to instantiate the DekaScript diagnostics Worker.
 * Call once during app initialization before creating any LSP bridge.
 */
export function setLspWorkerPath(path: string) {
  lspWorkerPath = path;
}

export function getLspWorkerPath(): string {
  return lspWorkerPath;
}

export interface LspPosition {
  /** Zero-based, following the Language Server Protocol. */
  line: number;
  /** Zero-based UTF-16 offset, following the Language Server Protocol. */
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4;

export interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: LspDiagnosticSeverity;
  source?: string;
  code?: string | number;
}

export interface LspDiagnosticsMessage {
  type: 'diagnostics';
  uri: string;
  /** Matches the submitted document version when the Worker provides it. */
  version?: number;
  diagnostics: LspDiagnostic[];
}

export interface LspDocumentUpdate {
  uri: string;
  languageId: typeof DEKASCRIPT_LANGUAGE_ID;
  text: string;
  version: number;
}

export interface DekaScriptLspWorkerBridge {
  updateDocument(document: LspDocumentUpdate): void;
  onDiagnostics(listener: (message: LspDiagnosticsMessage) => void): () => void;
  dispose(): void;
}

export interface DekaScriptWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type DekaScriptWorkerFactory = () => DekaScriptWorkerLike | null;

/**
 * Parses only the diagnostics message shape the browser is prepared to render.
 * Future Worker event handlers should use this before forwarding data to Monaco.
 */
export function parseLspDiagnosticsMessage(value: unknown): LspDiagnosticsMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type !== 'diagnostics' || typeof message.uri !== 'string' || !Array.isArray(message.diagnostics)) {
    return null;
  }
  if (message.version !== undefined && (!Number.isSafeInteger(message.version) || (message.version as number) < 0)) return null;

  const diagnostics = message.diagnostics.flatMap((diagnostic): LspDiagnostic[] => {
    if (!diagnostic || typeof diagnostic !== 'object') return [];
    const item = diagnostic as Record<string, unknown>;
    const range = parseRange(item.range);
    if (!range || typeof item.message !== 'string') return [];
    const severity = item.severity;
    if (severity !== undefined && severity !== 1 && severity !== 2 && severity !== 3 && severity !== 4) return [];
    if (item.source !== undefined && typeof item.source !== 'string') return [];
    if (item.code !== undefined && typeof item.code !== 'string' && typeof item.code !== 'number') return [];
    return [{
      range,
      message: item.message,
      severity,
      source: item.source as string | undefined,
      code: item.code as string | number | undefined,
    }];
  });

  return { type: 'diagnostics', uri: message.uri, version: message.version as number | undefined, diagnostics };
}

function parseRange(value: unknown): LspRange | null {
  if (!value || typeof value !== 'object') return null;
  const range = value as Record<string, unknown>;
  const start = parsePosition(range.start);
  const end = parsePosition(range.end);
  if (!start || !end) return null;
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
    return null;
  }
  return { start, end };
}

function parsePosition(value: unknown): LspPosition | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as Record<string, unknown>;
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character)) return null;
  if ((position.line as number) < 0 || (position.character as number) < 0) return null;
  return { line: position.line as number, character: position.character as number };
}

/**
 * Used only when Workers are unavailable. A served-but-invalid artifact is
 * deliberately not treated as this fallback; the real worker reports it.
 */
class NoopDekaScriptLspWorkerBridge implements DekaScriptLspWorkerBridge {
  updateDocument(document: LspDocumentUpdate) {
    void document;
  }

  onDiagnostics(listener: (message: LspDiagnosticsMessage) => void) {
    void listener;
    return () => {};
  }

  dispose() {}
}

class BrowserDekaScriptLspWorkerBridge implements DekaScriptLspWorkerBridge {
  private readonly listeners = new Set<(message: LspDiagnosticsMessage) => void>();

  constructor(private readonly worker: DekaScriptWorkerLike) {
    worker.onmessage = ({ data }) => {
      const parsed = parseLspDiagnosticsMessage(data);
      if (parsed) this.listeners.forEach((listener) => listener(parsed));
      else if (isWorkerFailure(data)) console.error(`DekaScript diagnostics worker: ${data.message}`);
    };
    worker.onerror = (event) => console.error(`DekaScript diagnostics worker failed: ${event.message}`);
  }

  updateDocument(document: LspDocumentUpdate) {
    this.worker.postMessage({ type: 'update', document });
  }

  onDiagnostics(listener: (message: LspDiagnosticsMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.listeners.clear();
    this.worker.terminate();
  }
}

function isWorkerFailure(value: unknown): value is { type: 'error'; message: string } {
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).type === 'error' && typeof (value as Record<string, unknown>).message === 'string');
}

function createBrowserWorker(): DekaScriptWorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(lspWorkerPath, { type: 'module', name: 'deka-diagnostics' });
}

export function createDekaScriptLspWorkerBridge(factory: DekaScriptWorkerFactory = createBrowserWorker): DekaScriptLspWorkerBridge {
  const worker = factory();
  return worker ? new BrowserDekaScriptLspWorkerBridge(worker) : new NoopDekaScriptLspWorkerBridge();
}

interface MonacoModel {
  getValue(): string;
}

interface MonacoMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  source?: string;
  code?: string;
}

interface MonacoDiagnosticsApi {
  MarkerSeverity: { Error: number; Warning: number; Info: number; Hint: number };
  editor: { setModelMarkers(model: MonacoModel, owner: string, markers: MonacoMarker[]): void };
}

const markerSeverityByLspSeverity = (monaco: MonacoDiagnosticsApi, severity: LspDiagnosticSeverity | undefined) => {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 4: return monaco.MarkerSeverity.Hint;
    default: return monaco.MarkerSeverity.Info;
  }
};

/** Maps structured LSP diagnostics onto the supplied Monaco model only. */
export class DekaScriptDiagnosticsAdapter {
  constructor(
    private readonly monaco: MonacoDiagnosticsApi,
    private readonly owner = 'dekascript-lsp'
  ) {}

  apply(model: MonacoModel, diagnostics: LspDiagnostic[]) {
    this.monaco.editor.setModelMarkers(
      model,
      this.owner,
      diagnostics.map((diagnostic) => ({
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
        message: diagnostic.message,
        severity: markerSeverityByLspSeverity(this.monaco, diagnostic.severity),
        source: diagnostic.source,
        code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
      }))
    );
  }

  clear(model: MonacoModel) {
    this.monaco.editor.setModelMarkers(model, this.owner, []);
  }
}
