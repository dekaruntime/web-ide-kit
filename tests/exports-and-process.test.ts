import { describe, expect, test } from 'bun:test';
import { runDekaJs, runDekaJsDirect, type RunResult } from '../src/runtime/runtime';
import { terminateSharedSandbox } from '../src/runtime/sandbox';
import { withWorker, runWorker } from './helpers/run-worker';

const noProcess = `
console.log(typeof process, typeof globalThis.process, 'process' in globalThis);
try { process.cwd(); } catch (error) { console.log(error instanceof ReferenceError ? 'not-installed' : 'wrong-error'); }
`;

function expectOutput(result: RunResult, stdout: string) {
  expect(result.ok).toBe(true);
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(stdout);
}

for (const [name, run] of [['main runtime', runDekaJsDirect], ['Worker', runWorker]] as const) {
  describe(name, () => {
    test('functions-exported-const-in-function-body retains the binding', async () => {
      expectOutput(await run(`export const base = 10;
function addBase(n) { return base + n; }
console.log(addBase(5));`), '15\n');
    });

    test('modules-export-async-fn preserves functions and all trailing statements', async () => {
      expectOutput(await run(`export async function later(n) { return n; }
function plain() { return 2; }
console.log(await later(7));
console.log(plain());
export async function last() { return 3; }
if (await last() !== 3) throw new Error('second export lost');`), '7\n2\n');
    });

    test('export lists are stripped identically', async () => {
      expectOutput(await run(`const n = 4;
export { n };
console.log(n);`), '4\n');
    });

    test('no grant leaves process not installed', async () => {
      expectOutput(await run(noProcess), 'undefined undefined false\nnot-installed\n');
    });

    test('cwd and env values do not implicitly grant access', async () => {
      expectOutput(await run(noProcess, { cwd: '/private', env: { SECRET: 'value' }, envGranted: false }),
        'undefined undefined false\nnot-installed\n');
      expectOutput(await run(noProcess, { cwd: '/private', env: { SECRET: 'value' } }),
        'undefined undefined false\nnot-installed\n');
    });

    test('an explicit env grant exposes the supplied cwd and env', async () => {
      expectOutput(await run(`console.log(process.cwd(), process.env.EXAMPLE, process === globalThis.process);`,
        { envGranted: true, cwd: '/granted', env: { EXAMPLE: 'yes' } }), '/granted yes true\n');
    });
  });
}

test('reused Worker revokes process after a granted run', async () => {
  await withWorker(async run => {
    expectOutput(await run('console.log(process.cwd());', { envGranted: true, cwd: '/granted' }), '/granted\n');
    expectOutput(await run(noProcess), 'undefined undefined false\nnot-installed\n');
  });
});

test('direct runtime restores host process after success and failure', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'process');
  for (const envGranted of [false, true]) {
    await runDekaJsDirect('console.log("ok");', { envGranted });
    expect(Object.getOwnPropertyDescriptor(globalThis, 'process')).toEqual(before);
    const result = await runDekaJsDirect('throw new Error("failure");', { envGranted });
    expect(result.ok).toBe(false);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'process')).toEqual(before);
  }
});

test('runDekaJs forwards grants through the public sandbox API', async () => {
  try {
    expectOutput(await runDekaJs(noProcess), 'undefined undefined false\nnot-installed\n');
    expectOutput(await runDekaJs('console.log(process.cwd());', { envGranted: true, cwd: '/public-api' }),
      '/public-api\n');
    expectOutput(await runDekaJs(noProcess), 'undefined undefined false\nnot-installed\n');
  } finally {
    terminateSharedSandbox();
  }
});

// wik#13: plain `export function` (what DS `export fn` emits) must strip in
// both paths — the async-only lookahead let it reach the Worker as a syntax
// error ("Unexpected token 'export'", live on deka.gg/tour).
for (const [label, run] of [['main runtime', runDekaJsDirect], ['Worker', runWorker]] as const) {
  test(`plain export function strips and stays callable (${label})`, async () => {
    const result = await run(
      `export function plain(n) { return n + 1; }\nconsole.log(plain(6));\n`
    )
    expect(result.ok).toBe(true)
    expect(result.stdout.trim()).toBe('7')
  })
}
