# Agent guidance for `web-ide-kit`

## Runners: always self-hosted

All GitHub Actions workflows in this repo must run on self-hosted runners. The only exception is the npm publish workflow, because **npm Trusted Publishing / OIDC does not support self-hosted runners yet**.

- Default for small/test jobs: `[self-hosted, macOS, ARM64]` (bugsy).
- Platform-specific builds should use the existing runner labels in the repo, e.g.:
  - `[self-hosted, macos, arm64]`
  - `[self-hosted, linux, x64]`
  - `[self-hosted, macos, x64]`
- Do not use `ubuntu-latest`, `macos-latest`, or `windows-latest` unless you are explicitly fixing the npm publish exception.

## Publishing

- Bump `version` in `package.json` for every release.
- Ensure `repository.url` in `package.json` matches the public GitHub repo; npm provenance validation requires it.
- The publish workflow uses the `publish` environment and GitHub OIDC to authenticate with npm. Do not add an `NPM_TOKEN` secret to the workflow; the environment handles trusted publishing.
- Merging to `main` triggers the publish workflow. It will skip if the version is already on npm.

## Consumers

Sites that depend on this package should install it from npm (`@dekaruntime/web-ide-kit`), not via a git submodule or a `vendor/` directory. Update consumers and remove vendored copies after each publish.
