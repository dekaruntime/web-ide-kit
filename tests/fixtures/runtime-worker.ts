import { WORKER_SCRIPT } from '../../src/runtime/sandbox';

// Execute the actual browser Worker payload in a separate Web Worker realm.
(0, eval)(WORKER_SCRIPT);
postMessage({ ready: true });
