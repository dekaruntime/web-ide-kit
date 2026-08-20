import { VirtualFs } from './fs';

export interface GlobalsOptions {
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
  cwd?: string;
  env?: Record<string, string>;
  fs?: VirtualFs;
}

// Capture pristine host globals before Deka wraps anything.
// These are the launch-tier globals listed in RFD 21.
const hostFetch = fetch;
const hostJSON = JSON;
const hostURL = URL;
const hostURLSearchParams = URLSearchParams;
const hostTextEncoder = TextEncoder;
const hostTextDecoder = TextDecoder;
const hostBlob = Blob;
const hostFormData = FormData;
const hostHeaders = Headers;
const hostRequest = Request;
const hostResponse = Response;
const hostAtob = atob;
const hostBtoa = btoa;
const hostStructuredClone = structuredClone;
const hostCrypto = crypto;
const hostSetTimeout = setTimeout;
const hostSetInterval = setInterval;
const hostClearTimeout = clearTimeout;
const hostClearInterval = clearInterval;
const hostQueueMicrotask = queueMicrotask;

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function err(error: unknown): { ok: false; error: unknown } {
  return { ok: false, error };
}

function wrapConstructorResult<C extends new (...args: any[]) => any>(
  Ctor: C
): (...args: ConstructorParameters<C>) =>
  | { ok: true; value: InstanceType<C> }
  | { ok: false; error: unknown } {
  return (...args) => {
    try {
      return ok(new Ctor(...args));
    } catch (error) {
      return err(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Deka UI Component runtime
// ---------------------------------------------------------------------------
// Canonical implementation lives in the runtime test harness
// (runtime/tests/runtime-suite/runtime-globals.mjs). The tour host installs the
// same surface into globalThis.deka.ui so compiled DekaScript can use signals,
// state stores, Suspense, ErrorBoundary, server rendering, hydration, and
// islands.

const Fragment = Symbol.for('deka.ui.Fragment');

interface ComponentNode {
  tag: string | ((props: any) => any) | symbol;
  props: Record<string, unknown>;
  children: unknown[];
  __componentNode: true;
  toString(): string;
}

interface RendererContext {
  mode: 'sync' | 'async';
  boundaryId: number;
  boundaries: Array<{
    id: string;
    state: 'resolved' | 'pending' | 'rejected';
    fallback: unknown;
    promise: Promise<unknown> | null;
  }>;
  suspenseStack: Array<{ id: string; fallback: unknown }>;
  errorStack: Array<{ fallback: unknown }>;
}

function isComponentNode(value: unknown): value is ComponentNode {
  return value != null && typeof value === 'object' && (value as ComponentNode).__componentNode === true;
}

function normalizeJsxChildren(children: unknown): unknown[] {
  if (children == null) return [];
  if (Array.isArray(children)) {
    const out: unknown[] = [];
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

function createComponentNode(tag: ComponentNode['tag'], props: Record<string, unknown> | null): ComponentNode {
  const { children, ...rest } = (props ?? {}) as Record<string, unknown>;
  const normalizedChildren = normalizeJsxChildren(children);
  const node: ComponentNode = {
    tag,
    props: Object.freeze(rest) as Record<string, unknown>,
    children: Object.freeze(normalizedChildren) as unknown[],
    __componentNode: true,
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
  return Object.freeze(node) as ComponentNode;
}

function uiJsx(tag: ComponentNode['tag'], props: Record<string, unknown> | null): ComponentNode {
  return createComponentNode(tag, props);
}

function uiJsxs(tag: ComponentNode['tag'], props: Record<string, unknown> | null): ComponentNode {
  return createComponentNode(tag, props);
}

function Suspense(props: Record<string, unknown> | null): ComponentNode {
  return createComponentNode(Suspense, props);
}
(Suspense as any).__dekaTag = 'Suspense';

function ErrorBoundary(props: Record<string, unknown> | null): ComponentNode {
  return createComponentNode(ErrorBoundary, props);
}
(ErrorBoundary as any).__dekaTag = 'ErrorBoundary';

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return value != null && typeof value === 'object' && typeof (value as Promise<unknown>).then === 'function';
}

function isResultErr(value: unknown): boolean {
  return (
    value != null &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).__enum === 'Result' &&
    (value as Record<string, unknown>).__case === 'Err'
  );
}

function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64Encode(str: string): string {
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

function base64Decode(str: string): string {
  if (typeof hostAtob === 'function') return hostAtob(str);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const map: Record<string, number> = {};
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

function extractDirectives(props: Record<string, unknown> | null | undefined): { rest: Record<string, unknown>; directives: string[] } {
  const rest: Record<string, unknown> = {};
  const directives: string[] = [];
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key.startsWith('client:') && value !== false && value != null) {
      directives.push(key.slice(7));
    } else {
      rest[key] = value;
    }
  }
  return { rest, directives };
}

function renderAttributes(props: Record<string, unknown> | null | undefined): string {
  const attrs: string[] = [];
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === true) {
      attrs.push(` ${escapeHtml(key)}`);
    } else if (value === false || value == null) {
      // omitted boolean/falsy attribute
    } else {
      attrs.push(` ${escapeHtml(key)}="${escapeHtml(value)}"`);
    }
  }
  return attrs.join('');
}

// Forward a `class` prop from a function-component caller onto the root HTML
// element returned by that component. This makes utility-CSS scanning work for
// components like `<Card class="bg-blue-300" />` without requiring every
// component to manually thread `class` through its root node.
function forwardClass(html: string, className: unknown): string {
  if (!className || typeof html !== 'string' || html[0] !== '<') return html;
  const escaped = String(className)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  return html.replace(/^<([^\s>\/]+)((?:\s[^>]*)?)(\/?>)/, (m, tag, attrs, close) => {
    // If the component already placed a class on its root, assume it handled
    // the prop explicitly and do not duplicate it.
    if (/\sclass\s*=/.test(attrs)) return m;
    return `<${tag}${attrs} class="${escaped}"${close}`;
  });
}

function renderFallbackSync(fallback: unknown, error: unknown, ctx: RendererContext): string {
  let node = fallback;
  if (typeof fallback === 'function') {
    try {
      node = error === undefined ? (fallback as () => unknown)() : (fallback as (error: unknown) => unknown)(error);
    } catch (_) {
      return '';
    }
  }
  if (node == null || typeof node === 'boolean') return '';
  if (isComponentNode(node)) return renderNodeSync(node, ctx);
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node));
  return escapeHtml(String(node));
}

async function renderFallbackAsync(fallback: unknown, error: unknown, ctx: RendererContext): Promise<string> {
  let node = fallback;
  if (typeof fallback === 'function') {
    try {
      node = error === undefined ? (fallback as () => unknown)() : (fallback as (error: unknown) => unknown)(error);
    } catch (_) {
      return '';
    }
  }
  if (node == null || typeof node === 'boolean') return '';
  if (isComponentNode(node)) return await renderNodeAsync(node, ctx);
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node));
  return escapeHtml(String(node));
}

function handleRenderErrorSync(error: unknown, ctx: RendererContext): string {
  const stack = ctx.errorStack || [];
  if (stack.length === 0) {
    throw error;
  }
  const boundary = stack[stack.length - 1];
  return renderFallbackSync(boundary.fallback, error, ctx);
}

async function handleRenderErrorAsync(error: unknown, ctx: RendererContext): Promise<string> {
  const stack = ctx.errorStack || [];
  if (stack.length === 0) {
    throw error;
  }
  const boundary = stack[stack.length - 1];
  return await renderFallbackAsync(boundary.fallback, error, ctx);
}

function handlePendingSync(promise: Promise<unknown>, ctx: RendererContext): string {
  const stack = ctx.suspenseStack || [];
  if (stack.length === 0) {
    // No Suspense ancestor: drop the async work for the sync server pass.
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

async function handlePendingAsync(promise: Promise<unknown>, ctx: RendererContext): Promise<unknown> {
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

function renderChildrenSync(children: unknown, ctx: RendererContext): string {
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

async function renderChildrenAsync(children: unknown, ctx: RendererContext): Promise<string> {
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

function renderNodeSync(node: unknown, ctx: RendererContext): string {
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
    const id = `S:${++ctx.boundaryId}`;
    const fallback = (props as Record<string, unknown> | undefined)?.fallback;
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
    ctx.errorStack.push({ fallback: (props as Record<string, unknown> | undefined)?.fallback });
    try {
      const html = renderChildrenSync(children, ctx);
      ctx.errorStack.pop();
      return html;
    } catch (error) {
      ctx.errorStack.pop();
      return renderFallbackSync((props as Record<string, unknown> | undefined)?.fallback, error, ctx);
    }
  }

  if (typeof tag === 'function') {
    const { rest, directives } = extractDirectives(props);
    let result: unknown;
    try {
      result = tag({ ...rest, children });
    } catch (error) {
      return handleRenderErrorSync(error, ctx);
    }

    if (isPromiseLike(result)) {
      return handlePendingSync(result, ctx);
    }

    if (isResultErr(result)) {
      return handleRenderErrorSync((result as Record<string, unknown>).error ?? new Error(String(result)), ctx);
    }

    const html = forwardClass(renderNodeSync(result, ctx), rest.class);
    if (directives.length === 0) return html;

    const islandName = tag.name || 'Anonymous';
    const directive = directives[0];
    const serializedProps = hostJSON.stringify(rest);
    return `<!--deka-island start:${base64Encode(islandName)} directive:${base64Encode(directive)} props:${base64Encode(serializedProps)}-->${html}<!--deka-island end:${base64Encode(islandName)}-->`;
  }

  if (typeof tag === 'string') {
    const { rest, directives } = extractDirectives(props);
    const attrs = renderAttributes(rest);
    const childHtml = renderChildrenSync(children, ctx);
    let markerAttrs = '';
    for (const directive of directives) {
      markerAttrs += ` data-client-${escapeHtml(directive)}`;
    }
    if (childHtml === '' && voidElements.has(tag)) {
      return `<${tag}${attrs}${markerAttrs} />`;
    }
    return `<${tag}${attrs}${markerAttrs}>${childHtml}</${tag}>`;
  }

  return '';
}

async function renderNodeAsync(node: unknown, ctx: RendererContext): Promise<string> {
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
    const id = `S:${++ctx.boundaryId}`;
    const fallback = (props as Record<string, unknown> | undefined)?.fallback;
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
    ctx.errorStack.push({ fallback: (props as Record<string, unknown> | undefined)?.fallback });
    try {
      const html = await renderChildrenAsync(children, ctx);
      ctx.errorStack.pop();
      return html;
    } catch (error) {
      ctx.errorStack.pop();
      return await renderFallbackAsync((props as Record<string, unknown> | undefined)?.fallback, error, ctx);
    }
  }

  if (typeof tag === 'function') {
    const { rest, directives } = extractDirectives(props);
    let result: unknown;
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
      return await handleRenderErrorAsync((result as Record<string, unknown>).error ?? new Error(String(result)), ctx);
    }

    const html = forwardClass(await renderNodeAsync(result, ctx), rest.class);
    if (directives.length === 0) return html;

    const islandName = tag.name || 'Anonymous';
    const directive = directives[0];
    const serializedProps = hostJSON.stringify(rest);
    return `<!--deka-island start:${base64Encode(islandName)} directive:${base64Encode(directive)} props:${base64Encode(serializedProps)}-->${html}<!--deka-island end:${base64Encode(islandName)}-->`;
  }

  if (typeof tag === 'string') {
    const { rest, directives } = extractDirectives(props);
    const attrs = renderAttributes(rest);
    const childHtml = await renderChildrenAsync(children, ctx);
    let markerAttrs = '';
    for (const directive of directives) {
      markerAttrs += ` data-client-${escapeHtml(directive)}`;
    }
    if (childHtml === '' && voidElements.has(tag)) {
      return `<${tag}${attrs}${markerAttrs} />`;
    }
    return `<${tag}${attrs}${markerAttrs}>${childHtml}</${tag}>`;
  }

  return '';
}

function createRendererContext(mode: 'sync' | 'async'): RendererContext {
  return {
    mode,
    boundaryId: 0,
    boundaries: [],
    suspenseStack: [],
    errorStack: [],
  };
}

function renderToString(node: unknown): { html: string; boundaries: RendererContext['boundaries'] } {
  const ctx = createRendererContext('sync');
  const html = renderNodeSync(node, ctx);
  return { html, boundaries: ctx.boundaries };
}

async function renderToStringAsync(node: unknown): Promise<{ html: string; boundaries: RendererContext['boundaries'] }> {
  const ctx = createRendererContext('async');
  const html = await renderNodeAsync(node, ctx);
  return { html, boundaries: ctx.boundaries };
}

function hydrate(_component: unknown, targetElement: unknown): { islands: Array<{ name: string; directive: string; props: unknown }>; dispose(): void } {
  if (targetElement == null) {
    throw new TypeError('deka.ui.hydrate requires a target element');
  }

  const html =
    typeof targetElement === 'string'
      ? targetElement
      : typeof (targetElement as { innerHTML?: string }).innerHTML === 'string'
        ? (targetElement as { innerHTML: string }).innerHTML
        : '';

  const islands: Array<{ name: string; directive: string; props: unknown }> = [];
  const markerRe = /<!--deka-island start:([A-Za-z0-9+/=]+) directive:([A-Za-z0-9+/=]+) props:([A-Za-z0-9+/=]+)-->/g;
  let match: RegExpExecArray | null;
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

const signalContextStack: Array<{ execute(): void; onCleanup(cleanup: () => void): void }> = [];

function getCurrentSignalContext(): { execute(): void; onCleanup(cleanup: () => void): void } | null {
  return signalContextStack[signalContextStack.length - 1] || null;
}

function createSignal<T>(initialValue: T): [() => T, (nextValue: T) => void] {
  let value = initialValue;
  const subscribers = new Set<{ execute(): void; onCleanup(cleanup: () => void): void }>();

  function read(): T {
    const ctx = getCurrentSignalContext();
    if (ctx) {
      subscribers.add(ctx);
      ctx.onCleanup(() => {
        subscribers.delete(ctx);
      });
    }
    return value;
  }

  function write(nextValue: T): void {
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

function createEffect(fn: () => unknown | (() => void)): () => void {
  let userCleanup: (() => void) | undefined;
  const dependencyCleanups = new Set<() => void>();

  const context = {
    execute,
    onCleanup(cleanup: () => void) {
      dependencyCleanups.add(cleanup);
    },
  };

  function execute(): void {
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
        // User cleanup errors are intentionally swallowed so a misbehaving
        // cleanup does not prevent the effect from re-subscribing.
      }
    }

    signalContextStack.push(context);
    try {
      const maybeCleanup = fn();
      if (typeof maybeCleanup === 'function') {
        userCleanup = maybeCleanup as () => void;
      }
    } finally {
      signalContextStack.pop();
    }
  }

  execute();

  return function dispose(): void {
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

function createMemo<T>(fn: () => T): () => T {
  const [getValue, setValue] = createSignal<T | undefined>(undefined);
  createEffect(() => {
    setValue(fn());
  });
  return getValue as () => T;
}

// ---------------------------------------------------------------------------
// Zustand-style state store primitive
// ---------------------------------------------------------------------------

function createState<T extends Record<string, unknown>, A extends Record<string, (state: T, ...args: any[]) => T>>(
  initialState: T,
  actions: A = {} as A
): (() => T) & { [K in keyof A]: (...args: Parameters<A[K]> extends [T, ...infer R] ? R : never) => void } {
  const [getState, setState] = createSignal<T>(initialState);

  function useStore(): T {
    return getState();
  }

  for (const key of Object.keys(actions)) {
    const action = actions[key];
    (useStore as any)[key] = function storeAction(...args: any[]) {
      setState(action(getState(), ...args));
    };
  }

  return useStore as any;
}

const State = Object.freeze({
  create: createState,
});

// ---------------------------------------------------------------------------
// Legacy top-level JSX shims
// ---------------------------------------------------------------------------
// These keep source compiled by older compiler slices working. The current
// compiler emits deka.ui.jsx/deka.ui.jsxs for ComponentNode-based JSX; older
// output calls the bare jsx/jsxs globals directly and expects string HTML.

function renderJsxChildren(children: unknown): string {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(renderJsxChildren).join('');
  return String(children ?? '');
}

function jsx(type: string | ((props: Record<string, unknown>) => unknown) | symbol, props: Record<string, unknown> | null): string {
  const resolvedProps = props ?? {};
  if (type === Fragment) {
    return renderJsxChildren(resolvedProps.children);
  }
  if (typeof type === 'function') {
    const result = (type as (props: Record<string, unknown>) => unknown)(resolvedProps);
    if (isComponentNode(result)) {
      return renderToString(result).html;
    }
    return String(result ?? '');
  }
  const { children, ...attributes } = resolvedProps;
  const attrs = Object.entries(attributes)
    .map(([key, value]) => {
      if (value === true) return ` ${key}`;
      if (value === false || value == null) return '';
      const escaped = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return ` ${key}="${escaped}"`;
    })
    .join('');
  const childHtml = renderJsxChildren(children);
  const tagName = String(type);
  return childHtml === '' ? `<${tagName}${attrs} />` : `<${tagName}${attrs}>${childHtml}</${tagName}>`;
}

function jsxs(type: string | ((props: Record<string, unknown>) => unknown) | symbol, props: Record<string, unknown> | null): string {
  return jsx(type, props);
}

/**
 * Build the global object injected into compiled DekaScript JS.
 *
 * Mirrors the runtime surface the compiler emits calls against:
 * - `__dekaPrint` for `echo` / plain output
 * - `console.log` / `console.error` for diagnostics
 * - `process.env` / `process.cwd()` for environment hooks
 * - `__dekaFs` for module file lookups
 * - `deka.unsafe` / `deka.panic` for the unsafe boundary
 * - `deka.ui.*` for the Component runtime (signals, state, JSX, SSR, hydration)
 * - `unsafe.*` for raw, unwrapped host globals
 * - safe wrappers for the launch-tier host APIs (fetch, JSON.parse, timers,
 *   constructors that throw, etc.)
 */
export function createGlobals(options: GlobalsOptions): Record<string, unknown> {
  const {
    stdout,
    stderr,
    cwd = '/',
    env = {},
    fs = new VirtualFs(),
  } = options;

  function format(args: unknown[]): string {
    return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  }

  const deka = {
    unsafe: <T>(
      tryFn: () => T,
      catchFn?: (error: unknown) => T,
      finallyFn?: () => void
    ): T => {
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

    panic: (message: unknown): never => {
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

  function wrapTimer(timer: any) {
    return (
      handler: any,
      delay?: number,
      ...args: any[]
    ): any => {
      const wrapped =
        typeof handler === 'function'
          ? (...timerArgs: any[]) => {
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

  function wrapMicrotask(task: typeof hostQueueMicrotask) {
    return (callback: () => void) => {
      return task(() => {
        try {
          callback();
        } catch (error) {
          deka.panic(error);
        }
      });
    };
  }

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

  const safeFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<{ ok: true; value: Response } | { ok: false; error: unknown }> => {
    try {
      return ok(await hostFetch(input, init));
    } catch (error) {
      return err(error);
    }
  };

  const safeJSON = {
    parse: (text: string): { ok: true; value: unknown } | { ok: false; error: unknown } => {
      try {
        return ok(hostJSON.parse(text));
      } catch (error) {
        return err(error);
      }
    },
    stringify: hostJSON.stringify.bind(hostJSON),
  };

  return {
    __dekaPrint: (value: unknown) => {
      stdout.write(String(value));
    },

    console: {
      log: (...args: unknown[]) => stdout.write(format(args) + '\n'),
      info: (...args: unknown[]) => stdout.write(format(args) + '\n'),
      warn: (...args: unknown[]) => stderr.write(format(args) + '\n'),
      error: (...args: unknown[]) => stderr.write(format(args) + '\n'),
    },

    process: {
      env,
      cwd: () => cwd,
    },

    __dekaFs: {
      readFile: (path: string) => fs.readFile(path),
      exists: (path: string) => fs.exists(path),
      writeFile: (path: string, content: string) => fs.writeFile(path, content),
      isDirectory: (path: string) => fs.isDirectory(path),
    },

    deka,

    Option: Object.freeze({
      Some: (value: unknown) => Object.freeze({ __enum: "Option", __case: "Some", value }),
      None: Object.freeze({ __enum: "Option", __case: "None" }),
    }),

    Result: Object.freeze({
      Ok: (value: unknown) => Object.freeze({ __enum: "Result", __case: "Ok", value }),
      Err: (error: unknown) => Object.freeze({ __enum: "Result", __case: "Err", error }),
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

    Math,
    Array,
    Object,
    Date,
    Map,
    Set,

    jsx,
    jsxs,
  };
}
