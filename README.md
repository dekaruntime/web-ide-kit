# @dekaruntime/web-ide-kit

Shared runtime, editor, and UI components for DekaScript web IDEs.

This package is consumed as a git submodule so it never needs to be published to npm.

## Usage

Add the submodule in a consumer repo:

```bash
git submodule add https://github.com/dekaruntime/web-ide-kit.git vendor/web-ide-kit
```

Reference it from `package.json`:

```json
"@dekaruntime/web-ide-kit": "file:./vendor/web-ide-kit"
```

Add it to `transpilePackages` in `next.config.ts`:

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
