import { parentPort, workerData } from 'node:worker_threads';
import { generateNetwork } from './network-generator.js';

try {
  const data = generateNetwork(
    workerData.smiles,
    workerData.depth,
    workerData.flatten,
    workerData.maxNodes,
    workerData.scaffolds,
    workerData.decoratedScaffolds,
    workerData.extendedScaffolds,
    workerData.hideSimpleScaffolds,
    workerData.bondLength
  );
  parentPort.postMessage({ ok: true, data });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  });
}
