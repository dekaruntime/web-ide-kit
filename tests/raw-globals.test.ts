import { describe, expect, test } from 'bun:test';
import { runDekaJsDirect } from '../src/runtime/runtime';

import { runWorker } from './helpers/run-worker';

// Reduced emitted-JS shapes from deka#904's 2026-09-12 evidence table.
// The compiler owns the branded Result boundary around raw host calls.
const prelude = `
  const Result = {
    Ok: value => ({ __enum: 'Result', __case: 'Ok', value }),
    Err: error => ({ __enum: 'Result', __case: 'Err', error }),
  };
  const Option = {
    Some: value => ({ __enum: 'Option', __case: 'Some', value }),
    None: { __enum: 'Option', __case: 'None' },
  };
  function emittedUnsafe(body) {
    try { return Result.Ok(body()); } catch (error) { return Result.Err(error); }
  }
`;

const fixtures = [
  {
    name: 'data-types-json-static-roundtrip',
    code: `
      function parseJSON$User(s) {
        try {
          const v = JSON.parse(s);
          return Result.Ok({
            name: v.name == null ? Option.None : Option.Some(v.name),
            missing: v.missing == null ? Option.None : Option.Some(v.missing),
            count: v.count == null ? Option.None : Option.Some(v.count),
          });
        } catch (error) { return Result.Err(error); }
      }
      const decoded = parseJSON$User(JSON.stringify({ name: '', missing: null, count: 0 }));
      const u = decoded.value;
      console.log(decoded.__case, u.name.__case, JSON.stringify(u.name.value),
        u.missing.__case, u.count.__case, u.count.value);
    `,
    stdout: 'Ok Some "" None Some 0\n',
  },
  {
    name: 'error-globals-json-parse',
    code: `const r = emittedUnsafe(() => JSON.parse('{"x":1}')); console.log(r.value.x);`,
    stdout: '1\n',
  },
  {
    name: 'unsafe-textdecoder-roundtrip',
    code: `const r = emittedUnsafe(() => new TextDecoder().decode(new TextEncoder().encode('cafe')));
      console.log(r.__case, r.value);`,
    stdout: 'Ok cafe\n',
  },
  {
    name: 'unsafe-textencoder-encode',
    code: `const r = emittedUnsafe(() => new TextEncoder().encode('hi'));
      const b = r.value; console.log(b.length + ':' + b[0] + ':' + b[1]);`,
    stdout: '2:104:105\n',
  },
  {
    name: 'unsafe-unsafe-json-parse-err',
    code: `const r = emittedUnsafe(() => JSON.parse('invalid json'));
      console.log(r.__case, r.error instanceof SyntaxError, r.error.message.length > 0);`,
    stdout: 'Err true true\n',
  },
  {
    name: 'unsafe-unsafe-json-parse-ok',
    code: `const r = emittedUnsafe(() => JSON.parse('{"x":1}'));
      console.log(r.__case === 'Ok' ? 'ok: ' + r.value.x : 'err');`,
    stdout: 'ok: 1\n',
  },
  {
    name: 'unsafe-unsafe-url-ok',
    code: `const r = emittedUnsafe(() => { const u = new URL('https://example.com/path'); return u.href; });
      console.log(r.__case === 'Ok' ? 'ok: ' + r.value : 'err');`,
    stdout: 'ok: https://example.com/path\n',
  },
];

for (const [name, run] of [['main runtime', runDekaJsDirect], ['Worker', runWorker]] as const) {
  describe(name, () => {
    for (const fixture of fixtures) {
      test(fixture.name, async () => {
        const result = await run(prelude + fixture.code);
        expect(result.ok).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe(fixture.stdout);
      });
    }

    test('raw JSON.parse throws through the runtime boundary', async () => {
      const result = await run(`JSON.parse('invalid json'); console.log('unreachable');`);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.stdout).toBe('');
    });

    test('global names retain raw identity and expose no Result envelopes', async () => {
      const result = await run(`
        for (const key of ['JSON', 'URL', 'TextEncoder', 'TextDecoder']) {
          if (globalThis[key] !== unsafe[key]) throw new Error(key + ' was wrapped');
        }
        for (const value of [JSON.parse('{"x":1}'), new URL('https://example.com'),
            new TextEncoder(), new TextDecoder()]) {
          if ('ok' in value) throw new Error('Result envelope leaked');
        }
        console.log('raw');
      `);
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.stdout).toBe('raw\n');
    });
  });
}
