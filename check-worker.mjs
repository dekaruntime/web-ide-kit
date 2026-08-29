import { WORKER_SCRIPT } from './dist/runtime/sandbox.js';
import fs from 'node:fs';

fs.writeFileSync('/tmp/materialized-worker.js', WORKER_SCRIPT);
console.log('--- materialized worker source ---');
WORKER_SCRIPT.split('\n').forEach((line, i) => {
  if (line.includes('echo = (message)') || (line.includes('io') && line.includes('echo')) || line.includes('import')) {
    console.log(`${i + 1}: ${JSON.stringify(line)}`);
  }
});
console.log('--- parse materialized worker ---');
try {
  new Function(WORKER_SCRIPT);
  console.log('OK');
} catch (e) {
  console.log('ERROR:', e.message);
  console.log('At line:', e.lineNumber);
  const lines = WORKER_SCRIPT.split('\n');
  for (let i = Math.max(0, e.lineNumber - 5); i < Math.min(lines.length, e.lineNumber + 5); i++) {
    console.log(`${i + 1}: ${JSON.stringify(lines[i])}`);
  }
  process.exit(1);
}
