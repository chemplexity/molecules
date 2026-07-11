/**
 * Reaction Network Viewer Server
 *
 * Accepts GET /generate?smiles=...&depth=3&flatten=true&maxNodes=100
 * Returns the exported D3 graph JSON.
 *
 * Usage:
 *   node scripts/test/reaction-network-demo/server.js
 *   Then open scripts/test/reaction-network-demo/viewer.html in a browser.
 */

import http from 'http';
import { Worker } from 'node:worker_threads';
import { exampleMoleculeComplex } from '../../../examples/example-molecules-complex.js';
import { generateMoleculePreview, normalizeDemoBondLength } from './network-generator.js';

const PORT = 3737;
let activeGeneration = null;
let generationCounter = 0;

function runGenerationJob(params) {
  if (activeGeneration) {
    const error = new Error('Another generation is already running.');
    error.statusCode = 409;
    return Promise.reject(error);
  }

  const id = ++generationCounter;
  const worker = new Worker(new URL('./network-generation-worker.js', import.meta.url), { workerData: params });
  const job = { id, worker, cancelled: false, settled: false };
  activeGeneration = job;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (activeGeneration?.id === id) {
        activeGeneration = null;
      }
    };

    worker.once('message', message => {
      if (job.settled) {
        return;
      }
      job.settled = true;
      cleanup();
      if (message?.ok) {
        resolve(message.data);
      } else {
        reject(new Error(message?.error || 'Generation worker failed.'));
      }
    });

    worker.once('error', error => {
      if (job.settled) {
        return;
      }
      job.settled = true;
      cleanup();
      reject(error);
    });

    worker.once('exit', code => {
      if (job.settled) {
        return;
      }
      job.settled = true;
      cleanup();
      const error = new Error(job.cancelled ? 'Generation cancelled.' : `Generation worker exited with code ${code}.`);
      error.statusCode = job.cancelled ? 499 : 500;
      reject(error);
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/cancel-generation') {
    if (!activeGeneration) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cancelled: false }));
      return;
    }

    const job = activeGeneration;
    job.cancelled = true;
    await job.worker.terminate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cancelled: true, id: job.id }));
    return;
  }

  if (url.pathname === '/random-smiles') {
    const index = Math.floor(Math.random() * exampleMoleculeComplex.length);
    const smiles = exampleMoleculeComplex[index];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ smiles, index, count: exampleMoleculeComplex.length }));
    return;
  }

  if (url.pathname === '/preview') {
    const smiles = url.searchParams.get('smiles') || 'C';
    const bondLength = normalizeDemoBondLength(url.searchParams.get('bondLength'));
    try {
      const data = generateMoleculePreview(smiles, { bondLength });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      console.error(`[✗] Preview error:`, e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname !== '/generate') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error:
          'Not found. Use GET /generate?smiles=...&depth=3&flatten=true&maxNodes=100&scaffolds=true&decoratedScaffolds=true&extendedScaffolds=true&hideSimpleScaffolds=true&bondLength=1.5, GET /preview?smiles=...&bondLength=1.5, GET /random-smiles, or GET /cancel-generation'
      })
    );
    return;
  }

  const smiles = url.searchParams.get('smiles') || 'C';
  const depth = parseInt(url.searchParams.get('depth') || '3', 10);
  const flatten = url.searchParams.get('flatten') === 'true';
  const maxNodes = parseInt(url.searchParams.get('maxNodes') || '100', 10);
  const scaffolds = url.searchParams.get('scaffolds') !== 'false';
  const decoratedScaffolds = url.searchParams.get('decoratedScaffolds') !== 'false';
  const extendedScaffolds = url.searchParams.get('extendedScaffolds') !== 'false';
  const hideSimpleScaffolds = url.searchParams.get('hideSimpleScaffolds') !== 'false';
  const bondLength = normalizeDemoBondLength(url.searchParams.get('bondLength'));

  console.log(
    `[→] Generating: smiles=${smiles} depth=${depth} flatten=${flatten} maxNodes=${maxNodes} scaffolds=${scaffolds} decoratedScaffolds=${decoratedScaffolds} extendedScaffolds=${extendedScaffolds} hideSimpleScaffolds=${hideSimpleScaffolds} bondLength=${bondLength}`
  );

  try {
    const data = await runGenerationJob({ smiles, depth, flatten, maxNodes, scaffolds, decoratedScaffolds, extendedScaffolds, hideSimpleScaffolds, bondLength });
    console.log(`[✓] Done: ${data.nodes.length} nodes, ${data.links.length} links`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error(`[✗] Error:`, e.message);
    res.writeHead(e.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Reaction Network Server running at http://localhost:${PORT}`);
  console.log(`Open scripts/test/reaction-network-demo/viewer.html in your browser.`);
});
