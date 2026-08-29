import type { RunResult } from './runtime';

export interface SandboxRunResult extends RunResult {
  html?: string;
}

interface PendingRun {
  resolve: (value: SandboxRunResult) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const RUN_TIMEOUT_MS = 5000;

/** @internal Exported only for build-time regression tests. */
export const WORKER_SCRIPT = `
function normalizePath(path) {
  return String(path || '').replace(/\\\\/g, '/').replace(/\\/+/g, '/');
}

function createVirtualFs(snapshot) {
  const files = new Map();
  const dirs = new Set(['/']);
  if (snapshot && typeof snapshot === 'object') {
    for (const [path, content] of Object.entries(snapshot.files || {})) {
      files.set(normalizePath(path), { content: String(content), isDirectory: false });
    }
    for (const path of (snapshot.dirs || [])) {
      dirs.add(normalizePath(path));
    }
  }
  return {
    readFile(path) {
      const file = files.get(normalizePath(path));
      return file && !file.isDirectory ? file.content : undefined;
    },
    exists(path) {
      return files.has(normalizePath(path)) || dirs.has(normalizePath(path));
    },
    writeFile(path, content) {
      files.set(normalizePath(path), { content: String(content), isDirectory: false });
    },
    isDirectory(path) {
      return dirs.has(normalizePath(path));
    },
  };
}

function createGlobals(options) {
  // Capture pristine Worker globals before Deka installs any wrappers.
  const hostFetch = self.fetch;
  const hostJSON = self.JSON;
  const hostURL = self.URL;
  const hostURLSearchParams = self.URLSearchParams;
  const hostTextEncoder = self.TextEncoder;
  const hostTextDecoder = self.TextDecoder;
  const hostBlob = self.Blob;
  const hostFormData = self.FormData;
  const hostHeaders = self.Headers;
  const hostRequest = self.Request;
  const hostResponse = self.Response;
  const hostAtob = self.atob;
  const hostBtoa = self.btoa;
  const hostStructuredClone = self.structuredClone;
  const hostCrypto = self.crypto;
  const hostSetTimeout = self.setTimeout;
  const hostSetInterval = self.setInterval;
  const hostClearTimeout = self.clearTimeout;
  const hostClearInterval = self.clearInterval;
  const hostQueueMicrotask = self.queueMicrotask;

  const stdout = { write: (value) => { self.__dekaStdout.push(String(value)); } };
  const stderr = { write: (value) => { self.__dekaStderr.push(String(value)); } };
  const cwd = options.cwd || '/';
  const env = options.env || {};
  const fs = createVirtualFs(options.fs);

  function format(args) {
    return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  }

  function resultOk(value) {
    return { ok: true, value };
  }

  function resultErr(error) {
    return { ok: false, error };
  }

  function wrapConstructorResult(Ctor) {
    return function(...args) {
      try {
        return resultOk(new Ctor(...args));
      } catch (error) {
        return resultErr(error);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Deka UI Component runtime
  // ---------------------------------------------------------------------------

  const Fragment = Symbol.for('deka.ui.Fragment');

  function isComponentNode(value) {
    return value != null && typeof value === 'object' && value.__componentNode === true;
  }

  function normalizeJsxChildren(children) {
    if (children == null) return [];
    if (Array.isArray(children)) {
      const out = [];
      for (const child of children) {
        if (Array.isArray(child)) {
          for (const inner of normalizeJsxChildren(child)) {
            out.push(inner);
          }
        } else if (child != null) {
          out.push(child);
        }
      }
      return out;
    }
    return [children];
  }

  function createComponentNode(tag, props) {
    const { children, ...rest } = props ?? {};
    const normalizedChildren = normalizeJsxChildren(children);
    const node = {
      tag,
      props: Object.freeze(rest),
      children: Object.freeze(normalizedChildren),
      toString() {
        return renderNodeSync(this, createRendererContext('sync'));
      },
    };
    Object.defineProperty(node, '__componentNode', {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return Object.freeze(node);
  }

  function uiJsx(tag, props) {
    return createComponentNode(tag, props);
  }

  function uiJsxs(tag, props) {
    return createComponentNode(tag, props);
  }

  function Suspense(props) {
    return createComponentNode(Suspense, props);
  }
  Suspense.__dekaTag = 'Suspense';

  function ErrorBoundary(props) {
    return createComponentNode(ErrorBoundary, props);
  }
  ErrorBoundary.__dekaTag = 'ErrorBoundary';

  function isPromiseLike(value) {
    return value != null && typeof value === 'object' && typeof value.then === 'function';
  }

  function isResultErr(value) {
    return (
      value != null &&
      typeof value === 'object' &&
      value.__enum === 'Result' &&
      value.__case === 'Err'
    );
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function base64Encode(str) {
    if (typeof hostBtoa === 'function') return hostBtoa(str);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let output = '';
    for (let i = 0; i < str.length; i += 3) {
      const a = str.charCodeAt(i);
      const b = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      const c = i + 2 < str.length ? str.charCodeAt(i + 2) : 0;
      const triple = (a << 16) | (b << 8) | c;
      output += alphabet[(triple >> 18) & 63];
      output += alphabet[(triple >> 12) & 63];
      output += i + 1 < str.length ? alphabet[(triple >> 6) & 63] : '=';
      output += i + 2 < str.length ? alphabet[triple & 63] : '=';
    }
    return output;
  }

  function base64Decode(str) {
    if (typeof hostAtob === 'function') return hostAtob(str);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const map = {};
    for (let i = 0; i < alphabet.length; i++) map[alphabet[i]] = i;
    const cleaned = str.replace(/=+$/, '');
    let output = '';
    for (let i = 0; i < cleaned.length; i += 4) {
      const a = map[cleaned[i]] || 0;
      const b = cleaned[i + 1] in map ? map[cleaned[i + 1]] : 0;
      const c = cleaned[i + 2] in map ? map[cleaned[i + 2]] : 0;
      const d = cleaned[i + 3] in map ? map[cleaned[i + 3]] : 0;
      const triple = (a << 18) | (b << 12) | (c << 6) | d;
      output += String.fromCharCode((triple >> 16) & 255);
      if (i + 2 < cleaned.length) output += String.fromCharCode((triple >> 8) & 255);
      if (i + 3 < cleaned.length) output += String.fromCharCode(triple & 255);
    }
    return output;
  }

  function extractDirectives(props) {
    const rest = {};
    const directives = [];
    for (const [key, value] of Object.entries(props ?? {})) {
      if (key.startsWith('client:') && value !== false && value != null) {
        directives.push(key.slice(7));
      } else {
        rest[key] = value;
      }
    }
    return { rest, directives };
  }

  function renderAttributes(props) {
    const attrs = [];
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value === true) {
        attrs.push(' ' + escapeHtml(key));
      } else if (value === false || value == null) {
        // omitted boolean/falsy attribute
      } else {
        attrs.push(' ' + escapeHtml(key) + '="' + escapeHtml(value) + '"');
      }
    }
    return attrs.join('');
  }

  function renderFallbackSync(fallback, error, ctx) {
    let node = fallback;
    if (typeof fallback === 'function') {
      try {
        node = error === undefined ? fallback() : fallback(error);
      } catch (_) {
        return '';
      }
    }
    if (node == null || typeof node === 'boolean') return '';
    if (isComponentNode(node)) return renderNodeSync(node, ctx);
    if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node));
    return escapeHtml(String(node));
  }

  async function renderFallbackAsync(fallback, error, ctx) {
    let node = fallback;
    if (typeof fallback === 'function') {
      try {
        node = error === undefined ? fallback() : fallback(error);
      } catch (_) {
        return '';
      }
    }
    if (node == null || typeof node === 'boolean') return '';
    if (isComponentNode(node)) return await renderNodeAsync(node, ctx);
    if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node));
    return escapeHtml(String(node));
  }

  function handleRenderErrorSync(error, ctx) {
    const stack = ctx.errorStack || [];
    if (stack.length === 0) {
      throw error;
    }
    const boundary = stack[stack.length - 1];
    return renderFallbackSync(boundary.fallback, error, ctx);
  }

  async function handleRenderErrorAsync(error, ctx) {
    const stack = ctx.errorStack || [];
    if (stack.length === 0) {
      throw error;
    }
    const boundary = stack[stack.length - 1];
    return await renderFallbackAsync(boundary.fallback, error, ctx);
  }

  function handlePendingSync(promise, ctx) {
    const stack = ctx.suspenseStack || [];
    if (stack.length === 0) {
      return '';
    }
    const boundary = stack[stack.length - 1];
    const record = ctx.boundaries.find((b) => b.id === boundary.id);
    if (record) {
      record.promise = promise;
      record.state = 'pending';
    }
    return renderFallbackSync(boundary.fallback, undefined, ctx);
  }

  async function handlePendingAsync(promise, ctx) {
    const stack = ctx.suspenseStack || [];
    if (stack.length === 0) {
      try {
        return await promise;
      } catch (error) {
        return await handleRenderErrorAsync(error, ctx);
      }
    }
    const boundary = stack[stack.length - 1];
    const record = ctx.boundaries.find((b) => b.id === boundary.id);
    if (record) {
      record.promise = promise;
      record.state = 'pending';
    }
    try {
      const value = await promise;
      if (record) record.state = 'resolved';
      return value;
    } catch (error) {
      if (record) record.state = 'rejected';
      throw error;
    }
  }

  function renderChildrenSync(children, ctx) {
    if (children == null) return '';
    if (Array.isArray(children)) {
      let out = '';
      for (const child of children) {
        out += renderNodeSync(child, ctx);
      }
      return out;
    }
    return renderNodeSync(children, ctx);
  }

  async function renderChildrenAsync(children, ctx) {
    if (children == null) return '';
    if (Array.isArray(children)) {
      let out = '';
      for (const child of children) {
        out += await renderNodeAsync(child, ctx);
      }
      return out;
    }
    return await renderNodeAsync(children, ctx);
  }

  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);

  function renderNodeSync(node, ctx) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') {
      return escapeHtml(String(node));
    }
    if (Array.isArray(node)) {
      let out = '';
      for (const child of node) {
        out += renderNodeSync(child, ctx);
      }
      return out;
    }
    if (!isComponentNode(node)) {
      return escapeHtml(String(node));
    }

    const { tag, props, children } = node;

    if (tag === Fragment) {
      return renderChildrenSync(children, ctx);
    }

    if (tag === Suspense) {
      const id = 'S:' + (++ctx.boundaryId);
      const fallback = props?.fallback;
      ctx.boundaries.push({ id, state: 'resolved', fallback: null, promise: null });
      ctx.suspenseStack = ctx.suspenseStack || [];
      ctx.suspenseStack.push({ id, fallback });
      try {
        const html = renderChildrenSync(children, ctx);
        ctx.suspenseStack.pop();
        return html;
      } catch (error) {
        ctx.suspenseStack.pop();
        return handleRenderErrorSync(error, ctx);
      }
    }

    if (tag === ErrorBoundary) {
      ctx.errorStack = ctx.errorStack || [];
      ctx.errorStack.push({ fallback: props?.fallback });
      try {
        const html = renderChildrenSync(children, ctx);
        ctx.errorStack.pop();
        return html;
      } catch (error) {
        ctx.errorStack.pop();
        return renderFallbackSync(props?.fallback, error, ctx);
      }
    }

    if (typeof tag === 'function') {
      const { rest, directives } = extractDirectives(props);
      let result;
      try {
        result = tag({ ...rest, children });
      } catch (error) {
        return handleRenderErrorSync(error, ctx);
      }

      if (isPromiseLike(result)) {
        return handlePendingSync(result, ctx);
      }

      if (isResultErr(result)) {
        return handleRenderErrorSync(result.error ?? new Error(String(result)), ctx);
      }

      const html = renderNodeSync(result, ctx);
      if (directives.length === 0) return html;

      const islandName = tag.name || 'Anonymous';
      const directive = directives[0];
      const serializedProps = hostJSON.stringify(rest);
      return '<!--deka-island start:' + base64Encode(islandName) + ' directive:' + base64Encode(directive) + ' props:' + base64Encode(serializedProps) + '-->' + html + '<!--deka-island end:' + base64Encode(islandName) + '-->';
    }

    if (typeof tag === 'string') {
      const { rest, directives } = extractDirectives(props);
      const attrs = renderAttributes(rest);
      const childHtml = renderChildrenSync(children, ctx);
      let markerAttrs = '';
      for (const directive of directives) {
        markerAttrs += ' data-client-' + escapeHtml(directive);
      }
      if (childHtml === '' && voidElements.has(tag)) {
        return '<' + tag + attrs + markerAttrs + ' />';
      }
      return '<' + tag + attrs + markerAttrs + '>' + childHtml + '</' + tag + '>';
    }

    return '';
  }

  async function renderNodeAsync(node, ctx) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') {
      return escapeHtml(String(node));
    }
    if (Array.isArray(node)) {
      let out = '';
      for (const child of node) {
        out += await renderNodeAsync(child, ctx);
      }
      return out;
    }
    if (!isComponentNode(node)) {
      return escapeHtml(String(node));
    }

    const { tag, props, children } = node;

    if (tag === Fragment) {
      return await renderChildrenAsync(children, ctx);
    }

    if (tag === Suspense) {
      const id = 'S:' + (++ctx.boundaryId);
      const fallback = props?.fallback;
      ctx.boundaries.push({ id, state: 'resolved', fallback: null, promise: null });
      ctx.suspenseStack = ctx.suspenseStack || [];
      ctx.suspenseStack.push({ id, fallback });
      try {
        const html = await renderChildrenAsync(children, ctx);
        ctx.suspenseStack.pop();
        return html;
      } catch (error) {
        ctx.suspenseStack.pop();
        return await handleRenderErrorAsync(error, ctx);
      }
    }

    if (tag === ErrorBoundary) {
      ctx.errorStack = ctx.errorStack || [];
      ctx.errorStack.push({ fallback: props?.fallback });
      try {
        const html = await renderChildrenAsync(children, ctx);
        ctx.errorStack.pop();
        return html;
      } catch (error) {
        ctx.errorStack.pop();
        return await renderFallbackAsync(props?.fallback, error, ctx);
      }
    }

    if (typeof tag === 'function') {
      const { rest, directives } = extractDirectives(props);
      let result;
      try {
        result = tag({ ...rest, children });
      } catch (error) {
        return await handleRenderErrorAsync(error, ctx);
      }

      if (isPromiseLike(result)) {
        try {
          result = await handlePendingAsync(result, ctx);
        } catch (error) {
          return await handleRenderErrorAsync(error, ctx);
        }
      }

      if (isResultErr(result)) {
        return await handleRenderErrorAsync(result.error ?? new Error(String(result)), ctx);
      }

      const html = await renderNodeAsync(result, ctx);
      if (directives.length === 0) return html;

      const islandName = tag.name || 'Anonymous';
      const directive = directives[0];
      const serializedProps = hostJSON.stringify(rest);
      return '<!--deka-island start:' + base64Encode(islandName) + ' directive:' + base64Encode(directive) + ' props:' + base64Encode(serializedProps) + '-->' + html + '<!--deka-island end:' + base64Encode(islandName) + '-->';
    }

    if (typeof tag === 'string') {
      const { rest, directives } = extractDirectives(props);
      const attrs = renderAttributes(rest);
      const childHtml = await renderChildrenAsync(children, ctx);
      let markerAttrs = '';
      for (const directive of directives) {
        markerAttrs += ' data-client-' + escapeHtml(directive);
      }
      if (childHtml === '' && voidElements.has(tag)) {
        return '<' + tag + attrs + markerAttrs + ' />';
      }
      return '<' + tag + attrs + markerAttrs + '>' + childHtml + '</' + tag + '>';
    }

    return '';
  }

  function createRendererContext(mode) {
    return {
      mode,
      boundaryId: 0,
      boundaries: [],
      suspenseStack: [],
      errorStack: [],
    };
  }

  function renderToString(node) {
    const ctx = createRendererContext('sync');
    const html = renderNodeSync(node, ctx);
    return { html, boundaries: ctx.boundaries };
  }

  async function renderToStringAsync(node) {
    const ctx = createRendererContext('async');
    const html = await renderNodeAsync(node, ctx);
    return { html, boundaries: ctx.boundaries };
  }

  function hydrate(_component, targetElement) {
    if (targetElement == null) {
      throw new TypeError('deka.ui.hydrate requires a target element');
    }

    const html =
      typeof targetElement === 'string'
        ? targetElement
        : typeof targetElement.innerHTML === 'string'
          ? targetElement.innerHTML
          : '';

    const islands = [];
    const markerRe = /<!--deka-island start:([A-Za-z0-9+/=]+) directive:([A-Za-z0-9+/=]+) props:([A-Za-z0-9+/=]+)-->/g;
    let match;
    while ((match = markerRe.exec(html)) !== null) {
      try {
        islands.push({
          name: base64Decode(match[1]),
          directive: base64Decode(match[2]),
          props: hostJSON.parse(base64Decode(match[3])),
        });
      } catch {
        // Ignore malformed markers.
      }
    }

    return {
      islands,
      dispose() {
        // No-op cleanup in the stub.
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Signal-based reactivity primitives
  // ---------------------------------------------------------------------------

  const signalContextStack = [];

  function getCurrentSignalContext() {
    return signalContextStack[signalContextStack.length - 1] || null;
  }

  function createSignal(initialValue) {
    let value = initialValue;
    const subscribers = new Set();

    function read() {
      const ctx = getCurrentSignalContext();
      if (ctx) {
        subscribers.add(ctx);
        ctx.onCleanup(() => {
          subscribers.delete(ctx);
        });
      }
      return value;
    }

    function write(nextValue) {
      if (Object.is(value, nextValue)) {
        return;
      }
      value = nextValue;
      const snapshot = Array.from(subscribers);
      for (const ctx of snapshot) {
        ctx.execute();
      }
    }

    return [read, write];
  }

  function createEffect(fn) {
    let userCleanup;
    const dependencyCleanups = new Set();

    const context = {
      execute,
      onCleanup(cleanup) {
        dependencyCleanups.add(cleanup);
      },
    };

    function execute() {
      for (const cleanup of dependencyCleanups) {
        cleanup();
      }
      dependencyCleanups.clear();

      if (typeof userCleanup === 'function') {
        const previousCleanup = userCleanup;
        userCleanup = undefined;
        try {
          previousCleanup();
        } catch (error) {
          // User cleanup errors are intentionally swallowed.
        }
      }

      signalContextStack.push(context);
      try {
        const maybeCleanup = fn();
        if (typeof maybeCleanup === 'function') {
          userCleanup = maybeCleanup;
        }
      } finally {
        signalContextStack.pop();
      }
    }

    execute();

    return function dispose() {
      for (const cleanup of dependencyCleanups) {
        cleanup();
      }
      dependencyCleanups.clear();
      if (typeof userCleanup === 'function') {
        const cleanup = userCleanup;
        userCleanup = undefined;
        cleanup();
      }
    };
  }

  function createMemo(fn) {
    const [getValue, setValue] = createSignal(undefined);
    createEffect(() => {
      setValue(fn());
    });
    return getValue;
  }

  // ---------------------------------------------------------------------------
  // Zustand-style state store primitive
  // ---------------------------------------------------------------------------

  function createState(initialState, actions) {
    actions = actions || {};
    const [getState, setState] = createSignal(initialState);

    function useStore() {
      return getState();
    }

    for (const key of Object.keys(actions)) {
      const action = actions[key];
      useStore[key] = function storeAction(...args) {
        setState(action(getState(), ...args));
      };
    }

    return useStore;
  }

  const State = Object.freeze({
    create: createState,
  });

  // ---------------------------------------------------------------------------
  // Legacy top-level JSX shims
  // ---------------------------------------------------------------------------

  function renderJsxChildren(children) {
    if (children == null) return '';
    if (typeof children === 'string' || typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(renderJsxChildren).join('');
    return String(children ?? '');
  }

  function jsx(type, props) {
    const resolvedProps = props ?? {};
    if (type === Fragment) {
      return renderJsxChildren(resolvedProps.children);
    }
    if (typeof type === 'function') {
      const result = type(resolvedProps);
      if (isComponentNode(result)) {
        return renderToString(result).html;
      }
      return String(result ?? '');
    }
    const { children, ...attributes } = resolvedProps;
    const attrs = Object.entries(attributes)
      .map(([key, value]) => {
        if (value === true) return ' ' + key;
        if (value === false || value == null) return '';
        const escaped = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return ' ' + key + '="' + escaped + '"';
      })
      .join('');
    const childHtml = renderJsxChildren(children);
    return childHtml === '' ? '<' + type + attrs + ' />' : '<' + type + attrs + '>' + childHtml + '</' + type + '>';
  }

  function jsxs(type, props) {
    return jsx(type, props);
  }

  const deka = {
    unsafe: function(tryFn, catchFn, finallyFn) {
      try {
        return tryFn();
      } catch (error) {
        if (typeof catchFn === 'function') {
          return catchFn(error);
        }
        throw error;
      } finally {
        if (typeof finallyFn === 'function') {
          finallyFn();
        }
      }
    },
    panic: function(message) {
      throw new Error(String(message));
    },
    ui: Object.freeze({
      jsx: uiJsx,
      jsxs: uiJsxs,
      Fragment,
      Suspense,
      ErrorBoundary,
      renderToString,
      renderToStringAsync,
      hydrate,
      signal: createSignal,
      effect: createEffect,
      memo: createMemo,
      State,
      createSignal,
      createEffect,
      createMemo,
      createState,
    }),
  };

  const unsafeGlobals = {
    fetch: hostFetch,
    JSON: hostJSON,
    URL: hostURL,
    URLSearchParams: hostURLSearchParams,
    TextEncoder: hostTextEncoder,
    TextDecoder: hostTextDecoder,
    Blob: hostBlob,
    FormData: hostFormData,
    Headers: hostHeaders,
    Request: hostRequest,
    Response: hostResponse,
    atob: hostAtob,
    btoa: hostBtoa,
    structuredClone: hostStructuredClone,
    crypto: hostCrypto,
    setTimeout: hostSetTimeout,
    setInterval: hostSetInterval,
    clearTimeout: hostClearTimeout,
    clearInterval: hostClearInterval,
    queueMicrotask: hostQueueMicrotask,
  };

  function safeFetch(input, init) {
    return hostFetch(input, init).then(resultOk, resultErr);
  }

  const safeJSON = {
    parse: function(text) {
      try {
        return resultOk(hostJSON.parse(text));
      } catch (error) {
        return resultErr(error);
      }
    },
    stringify: hostJSON.stringify,
  };

  function wrapTimer(timer) {
    return function(handler, delay, ...args) {
      const wrapped = typeof handler === 'function'
        ? function(...timerArgs) {
            try {
              handler(...timerArgs);
            } catch (error) {
              deka.panic(error);
            }
          }
        : handler;
      return timer(wrapped, delay, ...args);
    };
  }

  function wrapMicrotask(task) {
    return function(callback) {
      return task(function() {
        try {
          callback();
        } catch (error) {
          deka.panic(error);
        }
      });
    };
  }

  return {
    __dekaPrint: (value) => {
      stdout.write(String(value));
    },

    console: {
      log: (...args) => stdout.write(format(args) + '\\n'),
      info: (...args) => stdout.write(format(args) + '\\n'),
      warn: (...args) => stderr.write(format(args) + '\\n'),
      error: (...args) => stderr.write(format(args) + '\\n'),
    },

    process: {
      env,
      cwd: () => cwd,
    },

    __dekaFs: {
      readFile: (path) => fs.readFile(path),
      exists: (path) => fs.exists(path),
      writeFile: (path, content) => fs.writeFile(path, content),
      isDirectory: (path) => fs.isDirectory(path),
    },

    deka,

    Option: Object.freeze({
      Some: (value) => Object.freeze({ __enum: "Option", __case: "Some", value }),
      None: Object.freeze({ __enum: "Option", __case: "None" }),
    }),

    Result: Object.freeze({
      Ok: (value) => Object.freeze({ __enum: "Result", __case: "Ok", value }),
      Err: (error) => Object.freeze({ __enum: "Result", __case: "Err", error }),
    }),

    unsafe: unsafeGlobals,

    fetch: safeFetch,
    JSON: safeJSON,
    URL: wrapConstructorResult(hostURL),
    URLSearchParams: wrapConstructorResult(hostURLSearchParams),
    TextEncoder: wrapConstructorResult(hostTextEncoder),
    TextDecoder: wrapConstructorResult(hostTextDecoder),
    Blob: wrapConstructorResult(hostBlob),
    FormData: wrapConstructorResult(hostFormData),
    Headers: wrapConstructorResult(hostHeaders),
    Request: wrapConstructorResult(hostRequest),
    Response: wrapConstructorResult(hostResponse),

    atob: hostAtob,
    btoa: hostBtoa,
    structuredClone: hostStructuredClone,
    crypto: hostCrypto,

    setTimeout: wrapTimer(hostSetTimeout),
    setInterval: wrapTimer(hostSetInterval),
    clearTimeout: hostClearTimeout,
    clearInterval: hostClearInterval,
    queueMicrotask: wrapMicrotask(hostQueueMicrotask),

    Math: self.Math,
    Array: self.Array,
    Object: self.Object,
    Date: self.Date,
    Map: self.Map,
    Set: self.Set,

    jsx,
    jsxs,
  };
}

function transformStaticImportsToDynamic(jsCode) {
  return jsCode
    .split('\\n')
    .map((line) => {
      const trimmed = line.trim();
      const leadingWhitespace = line.match(/^\\s*/)?.[0] ?? '';

      const sideEffectMatch = trimmed.match(/^import\\s+["']([^"']+)["']\\s*;?$/);
      if (sideEffectMatch) {
        return leadingWhitespace + 'await import("' + sideEffectMatch[1] + '");';
      }

      const namedMatch = trimmed.match(/^import\\s*\\{\\s*(.*?)\\s*\\}\\s*from\\s*["']([^"']+)["']\\s*;?$/);
      if (namedMatch) {
        const specifiers = namedMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
        const mapped = specifiers.map((spec) => {
          const aliasMatch = spec.match(/^(\\w+)\\s+as\\s+(\\w+)$/);
          if (aliasMatch) {
            return aliasMatch[1] + ': ' + aliasMatch[2];
          }
          return spec;
        });
        return leadingWhitespace + 'const { ' + mapped.join(', ') + ' } = await import("' + namedMatch[2] + '");';
      }

      const namespaceMatch = trimmed.match(/^import\\s*\\*\\s*as\\s+(\\w+)\\s+from\\s*["']([^"']+)["']\\s*;?$/);
      if (namespaceMatch) {
        return leadingWhitespace + 'const ' + namespaceMatch[1] + ' = await import("' + namespaceMatch[2] + '");';
      }

      const defaultMatch = trimmed.match(/^import\\s+(\\w+)\\s+from\\s*["']([^"']+)["']\\s*;?$/);
      if (defaultMatch) {
        return leadingWhitespace + 'const { default: ' + defaultMatch[1] + ' } = await import("' + defaultMatch[2] + '");';
      }

      return line;
    })
    .join('\\n');
}

self.onmessage = async (event) => {
  const { id, jsCode, cwd, env, fs } = event.data || {};
  self.__dekaStdout = [];
  self.__dekaStderr = [];

  const executable = transformStaticImportsToDynamic(
    String(jsCode)
      .replace(/^export const \\w+ = [^;]+;\\n?/gm, '')
      .replace(/^export async function \\w+[\\s\\S]*$/m, '')
      .replace(new RegExp('^import .*component/core.*;\\n?', 'm'), '')
  );

  const globals = createGlobals({ cwd, env, fs });
  const allKeys = Object.keys(globals);
  const values = Object.values(globals);
  const READ_ONLY_GLOBALS = new Set(['crypto']);
  // The compiler now emits Result, Option, Ok, Err, Some and None as local
  // prelude consts inside the generated IIFE. Installing them as globals here
  // would reference them before their const declarations and hit the temporal
  // dead zone in strict mode, so exclude them from global installs.
  const COMPILER_EMITTED_PRELUDE = new Set(['Result', 'Option', 'Ok', 'Err', 'Some', 'None']);
  const globalInstalls = allKeys
    .filter((key) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && !READ_ONLY_GLOBALS.has(key) && key !== 'deka' && !COMPILER_EMITTED_PRELUDE.has(key))
    .map((key) => 'globalThis.' + key + ' = ' + key + ';')
    .join('\\n');

  // Pass every global as a function parameter so the generated install string
  // and emitted code can reference them directly (e.g. process, console).
  const localKeys = allKeys;
  const localValues = values;

  function finish(ok, error) {
    const stdout = self.__dekaStdout.join('');
    const stderr = self.__dekaStderr.join('');
    const response = self.__phpxCurrentResponse ?? self.__dekaCurrentResponse;
    const html = (typeof response === 'object' && response)
      ? String(response.body || '')
      : '';
    self.postMessage({ id, ok, stdout, stderr, html, error });
  }

  try {
    // Install deka outside the async IIFE. The latest compiler emits a
    // const deka = globalThis.deka = {...} prelude that merges with the
    // host-provided deka.ui, so globalThis.deka must already be set before
    // the emitted prelude runs. Installing it inside the IIFE would hit the
    // temporal dead zone of the compiler's own const deka declaration.
    const dekaInstall = 'globalThis.deka = deka;';
    const fn = new Function(
      ...localKeys,
      \`\${dekaInstall}\\nreturn (async () => {\\n"use strict";\\n\${globalInstalls}\\n\${executable}\\n})();\`
    );
    await fn(...localValues);
    finish(true, undefined);
  } catch (error) {
    finish(false, error instanceof Error ? error.message : String(error));
  }
};
`;

function createWorkerBlobUrl(): string {
  const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

export class DekaSandbox {
  private worker: Worker;
  private pending = new Map<string, PendingRun>();
  private idCounter = 0;
  private blobUrl: string;

  constructor() {
    this.blobUrl = createWorkerBlobUrl();
    this.worker = new Worker(this.blobUrl, { type: 'classic' });
    this.worker.onmessage = (event: MessageEvent<SandboxRunResult & { id: string }>) => {
      const { id, ...result } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timeoutId);
      pending.resolve(result as SandboxRunResult);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'Sandbox worker error';
      this.rejectAllPending(new Error(message));
    };
  }

  run(
    jsCode: string,
    options: { cwd?: string; env?: Record<string, string>; fs?: { files: Record<string, string>; dirs: string[] } } = {}
  ): Promise<SandboxRunResult> {
    const id = `run-${++this.idCounter}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        this.recreateWorker();
        reject(new Error(`Sandbox run timed out after ${RUN_TIMEOUT_MS}ms`));
      }, RUN_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeoutId });
      this.worker.postMessage({
        id,
        jsCode,
        cwd: options.cwd ?? '/tour',
        env: options.env ?? {},
        fs: options.fs ?? { files: {}, dirs: ['/'] },
      });
    });
  }

  private recreateWorker() {
    this.rejectAllPending(new Error('Sandbox worker reset'));
    this.worker.terminate();
    URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = createWorkerBlobUrl();
    this.worker = new Worker(this.blobUrl, { type: 'classic' });
    this.worker.onmessage = (event: MessageEvent<SandboxRunResult & { id: string }>) => {
      const { id, ...result } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timeoutId);
      pending.resolve(result as SandboxRunResult);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'Sandbox worker error';
      this.rejectAllPending(new Error(message));
    };
  }

  terminate() {
    this.rejectAllPending(new Error('Sandbox terminated'));
    this.worker.terminate();
    URL.revokeObjectURL(this.blobUrl);
  }

  private rejectAllPending(reason: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}

let sharedSandbox: DekaSandbox | null = null;

export function getSharedSandbox(): DekaSandbox {
  if (!sharedSandbox) {
    sharedSandbox = new DekaSandbox();
  }
  return sharedSandbox;
}

export function terminateSharedSandbox() {
  if (sharedSandbox) {
    sharedSandbox.terminate();
    sharedSandbox = null;
  }
}
