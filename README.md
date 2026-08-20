# @dekaruntime/web-ide-kit

Shared runtime, editor, and UI components for DekaScript web IDEs.

Published to npm as `@dekaruntime/web-ide-kit`.

## Usage

Install from npm:

```bash
bun add @dekaruntime/web-ide-kit
```

If you are using Next.js, keep it in `transpilePackages` so JSX is processed correctly:

```ts
transpilePackages: ['@dekaruntime/web-ide-kit'],
```

## Configurable seams

### Compiler artifact path

```ts
import { setCompilerArtifactPath } from '@dekaruntime/web-ide-kit/runtime';
setCompilerArtifactPath('/tour/deka-compiler-artifact.json');
```

### LSP worker path

```ts
import { setLspWorkerPath } from '@dekaruntime/web-ide-kit/editor';
setLspWorkerPath('/tour/deka-diagnostics-worker.js');
```

## Exports

- `@dekaruntime/web-ide-kit/runtime` — Deka compiler/runtime client, sandbox, diagnostics, artifact validation.
- `@dekaruntime/web-ide-kit/editor` — Monaco helpers and DekaScript LSP bridge.
- `@dekaruntime/web-ide-kit/ui` — Shared React components (Button, ConsolePanel, TourOutputPanel, RawPanel, EditorPanel).
