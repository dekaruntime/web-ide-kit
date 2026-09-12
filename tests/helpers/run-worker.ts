import type { RunOptions, RunResult } from '../../src/runtime/runtime';

export async function withWorker<T>(body: (run: (code: string, options?: RunOptions) => Promise<RunResult>) => Promise<T>): Promise<T> {
  const worker = new Worker(new URL('../fixtures/runtime-worker.ts', import.meta.url).href);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker startup timed out')), 4000);
      worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
      worker.onmessage = () => { clearTimeout(timeout); resolve(); };
    });
    return await body((jsCode, options = {}) => new Promise<RunResult>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker timed out')), 4000);
      worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
      worker.onmessage = ({ data }) => { clearTimeout(timeout); resolve(data); };
      worker.postMessage({ id: 1, jsCode, ...options });
    }));
  } finally {
    worker.terminate();
  }
}

export function runWorker(jsCode: string, options: RunOptions = {}): Promise<RunResult> {
  return withWorker(run => run(jsCode, options));
}
