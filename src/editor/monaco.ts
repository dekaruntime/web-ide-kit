'use client';

import { DEKASCRIPT_LANGUAGE_ID } from './lsp';

type MonacoTheme = {
  base: string;
  inherit: boolean;
  rules: Array<{ token: string; foreground: string; fontStyle?: string }>;
  colors: Record<string, string>;
};

type MonacoLanguageApi = {
  getLanguages(): Array<{ id: string }>;
  register(language: { id: string; extensions: string[] }): void;
  setMonarchTokensProvider(languageId: string, provider: unknown): void;
};

const docsDarkTheme: MonacoTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '64748b' },
    { token: 'keyword', foreground: '38bdf8', fontStyle: 'bold' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: 'fbbf24' },
    { token: 'type', foreground: 'c084fc', fontStyle: 'italic' },
    { token: 'function', foreground: '60a5fa' },
    { token: 'variable', foreground: 'e2e8f0' },
    { token: 'identifier', foreground: 'e2e8f0' },
    { token: 'delimiter', foreground: '94a3b8' },
    { token: 'operator', foreground: 'f472b6' },
  ],
  colors: {
    'editor.background': '#14151a',
    'editor.foreground': '#f1f5f9',
    'editor.lineHighlightBackground': '#1a1b21',
    'editorLineNumber.foreground': '#475569',
    'editorLineNumber.activeForeground': '#94a3b8',
  },
};

const docsLightTheme: MonacoTheme = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7280' },
    { token: 'keyword', foreground: '2563eb', fontStyle: 'bold' },
    { token: 'string', foreground: '15803d' },
    { token: 'number', foreground: 'b45309' },
    { token: 'type', foreground: '7c3aed', fontStyle: 'italic' },
    { token: 'function', foreground: '1d4ed8' },
    { token: 'variable', foreground: '111827' },
    { token: 'identifier', foreground: '111827' },
    { token: 'delimiter', foreground: '6b7280' },
    { token: 'operator', foreground: 'c026d3' },
  ],
  colors: {
    'editor.background': '#f8f6ee',
    'editor.foreground': '#111827',
    'editor.lineHighlightBackground': '#f1ede0',
    'editorLineNumber.foreground': '#9ca3af',
    'editorLineNumber.activeForeground': '#6b7280',
  },
};

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    require: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monaco: any;
    monacoLoaded?: boolean;
    monacoLoading?: boolean;
    monacoDocsTheme?: boolean;
    MonacoEnvironment?: {
      getWorkerUrl(workerId: string, label: string): string;
    };
  }
}

/**
 * Absolute URL for the monaco assets the consumer serves from
 * `public/monaco-editor/min/vs` (copied there by `copy-deka-monaco`).
 *
 * Root-relative paths like `/monaco-editor/min/vs` only resolve on the main
 * thread, where `document.baseURI` supplies a base. Monaco forwards the same
 * string into its workers, and inside `WorkerGlobalScope` there is no document
 * and no base — `fetch('/monaco-editor/...')` throws `Failed to parse URL`
 * and the AMD loader retries in a loop (hundreds of thousands of suppressed
 * console errors per page load). Everything monaco touches must be absolute.
 */
export function monacoAssetsBase(): string {
  return `${window.location.origin}/monaco-editor/min/vs`;
}

const monacoWorkerPaths: Record<string, string> = {
  typescript: 'language/typescript/tsWorker.js',
  javascript: 'language/typescript/tsWorker.js',
  json: 'language/json/jsonWorker.js',
  css: 'language/css/cssWorker.js',
  scss: 'language/css/cssWorker.js',
  less: 'language/css/cssWorker.js',
  html: 'language/html/htmlWorker.js',
  handlebars: 'language/html/htmlWorker.js',
  razor: 'language/html/htmlWorker.js',
};

/**
 * Install `MonacoEnvironment.getWorkerUrl` before monaco loads. It returns a
 * blob-shim URL: the worker script sets an absolute `baseUrl` for the AMD
 * loader and then `importScripts()` the absolute worker file URL. Blob URLs
 * inherit the page origin, so the import is same-origin today and still works
 * if the assets later move to a separate host.
 */
export function installMonacoEnvironment() {
  if (typeof window === 'undefined' || window.MonacoEnvironment) return;
  window.MonacoEnvironment = {
    getWorkerUrl(_workerId: string, label: string) {
      const relative = monacoWorkerPaths[label] ?? 'editor/editor.worker.js';
      const workerUrl = `${monacoAssetsBase()}/${relative}`;
      const bootstrap = [
        `self.MonacoEnvironment = { baseUrl: ${JSON.stringify(`${monacoAssetsBase()}/`)} };`,
        `importScripts(${JSON.stringify(workerUrl)});`,
      ].join('\n');
      return URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
    },
  };
}

export function ensureDocsTheme() {
  if (!window.monaco || window.monacoDocsTheme) return;
  window.monaco.editor.defineTheme('docs-dark', docsDarkTheme);
  window.monaco.editor.defineTheme('docs-light', docsLightTheme);
  window.monacoDocsTheme = true;
}

export function ensureDekaScriptLanguage(monaco: { languages: MonacoLanguageApi }) {
  if (monaco.languages.getLanguages().some((language) => language.id === DEKASCRIPT_LANGUAGE_ID)) {
    return;
  }
  monaco.languages.register({ id: DEKASCRIPT_LANGUAGE_ID, extensions: ['.ds'] });
  monaco.languages.setMonarchTokensProvider(DEKASCRIPT_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\b(let|const|function|return|if|else|for|while|import|export|type|interface|async|await|struct|fn|enum|match|mut|embed)\b/, 'keyword'],
        [/[A-Z][\\w$]*/, 'type'],
        [/[a-zA-Z_$][\\w$]*/, 'identifier'],
        [/\d+(\.\d+)?/, 'number'],
        [/["`']/, { token: 'string', next: '@string' }],
      ],
      string: [[/[^\\"`']+/, 'string'], [/\\./, 'string.escape'], [/["`']/, { token: 'string', next: '@pop' }]],
    },
  });
}

export function getDocsThemeName() {
  if (typeof document === 'undefined') return 'docs-dark';
  return document.documentElement.classList.contains('dark') ? 'docs-dark' : 'docs-light';
}

const languageMap: Record<string, string> = {
  bash: 'shell',
  sh: 'shell',
  shell: 'shell',
  zsh: 'shell',
  powershell: 'powershell',
  ps1: 'powershell',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  markdown: 'markdown',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  env: 'ini',
  dotenv: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  php: 'php',
  phpx: 'php',
  dekascript: 'dekascript',
  ds: 'dekascript',
  python: 'python',
  py: 'python',
  text: 'plaintext',
  txt: 'plaintext',
  plaintext: 'plaintext',
};

export function getMonacoLanguage(raw: string) {
  return languageMap[raw.toLowerCase()] || 'plaintext';
}

export function ensureMonacoLoaded() {
  if (typeof window === 'undefined') return;
  if (window.monaco || window.monacoLoading) return;

  window.monacoLoading = true;

  installMonacoEnvironment();

  const loaderScript = document.createElement('script');
  loaderScript.src = `${monacoAssetsBase()}/loader.js`;

  loaderScript.onload = () => {
    window.require.config({
      paths: { vs: monacoAssetsBase() }
    });

    window.require(['vs/editor/editor.main'], () => {
      ensureDocsTheme();
      ensureDekaScriptLanguage(window.monaco);
      window.monacoLoaded = true;
      window.monacoLoading = false;
      window.dispatchEvent(new Event('deka:monaco-ready'));
    });
  };

  loaderScript.onerror = () => {
    window.monacoLoading = false;
  };

  document.head.appendChild(loaderScript);
}

export function waitForMonacoReady() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.monacoLoaded) {
    ensureDocsTheme();
    return Promise.resolve();
  }

  ensureMonacoLoaded();

  return new Promise<void>((resolve) => {
    const handler = () => {
      window.removeEventListener('deka:monaco-ready', handler);
      resolve();
    };
    window.addEventListener('deka:monaco-ready', handler);
  });
}
