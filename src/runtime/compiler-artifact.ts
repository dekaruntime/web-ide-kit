// Minimum ABI version the website requires. The pinned artifact in public/tour
// is kept current by scripts/sync-deka-wasm-from-r2.ts; we gate on
// backwards-compatible ABI, not a specific source revision.
export const DEKA_COMPILER_MIN_ABI_VERSION = 2;

export interface CompilerArtifactManifest {
  schemaVersion: 1;
  compiler: {
    name: 'deka-browser-compiler';
    version: string;
    sourceCommit: string;
    abiVersion: number;
  };
  producer: {
    schemaVersion: 1;
    target: 'wasm32-unknown-unknown';
    cargoLockSha256: string;
  };
  artifact: { file: string; sha256: string; bytes: number };
}

export function validateCompilerArtifactManifest(value: unknown): CompilerArtifactManifest {
  const manifest = value as Partial<CompilerArtifactManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.compiler?.name !== 'deka-browser-compiler' ||
    (manifest.compiler.abiVersion ?? 0) < DEKA_COMPILER_MIN_ABI_VERSION ||
    !manifest.compiler.version ||
    !manifest.compiler.sourceCommit ||
    manifest.producer?.schemaVersion !== 1 ||
    manifest.producer.target !== 'wasm32-unknown-unknown' ||
    !/^[a-f0-9]{64}$/.test(manifest.producer.cargoLockSha256 ?? '') ||
    !/^deka_compiler\.wasm$/.test(manifest.artifact?.file ?? '') ||
    !/^[a-f0-9]{64}$/.test(manifest.artifact?.sha256 ?? '') ||
    !Number.isSafeInteger(manifest.artifact?.bytes) ||
    (manifest.artifact?.bytes ?? 0) <= 0
  ) {
    throw new Error('Invalid or incompatible Deka compiler artifact manifest');
  }
  return manifest as CompilerArtifactManifest;
}
