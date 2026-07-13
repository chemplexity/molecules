/* eslint jsdoc/require-jsdoc: off */
/* global console, URL */
/**
 * @file Reaction Network Viewer Server.
 *
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
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { exampleMoleculeComplex } from '../../../examples/example-molecules-complex.js';
import { parseSMILES } from '../../../src/io/index.js';
import { ReactionNetwork, ScaffoldNetwork } from '../../../src/network/index.js';
import { reactionTemplates } from '../../../src/smirks/index.js';

const PORT = 3737;
let activeGeneration = null;
let generationCounter = 0;

const ATOMIC_NUMBER_TO_ELEMENT = new Map([
  [1, 'H'],
  [5, 'B'],
  [6, 'C'],
  [7, 'N'],
  [8, 'O'],
  [9, 'F'],
  [14, 'Si'],
  [15, 'P'],
  [16, 'S'],
  [17, 'Cl'],
  [35, 'Br'],
  [53, 'I']
]);

const AROMATIC_ORGANIC = new Map([
  ['b', 'B'],
  ['c', 'C'],
  ['n', 'N'],
  ['o', 'O'],
  ['p', 'P'],
  ['s', 'S']
]);

const ORGANIC_SYMBOLS = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I', 'Si']);

function normalizeElement(symbol) {
  if (!symbol) {
    return null;
  }
  if (AROMATIC_ORGANIC.has(symbol)) {
    return AROMATIC_ORGANIC.get(symbol);
  }
  if (symbol.length === 1) {
    return symbol.toUpperCase();
  }
  return `${symbol[0].toUpperCase()}${symbol.slice(1).toLowerCase()}`;
}

function parseAtomPrimitive(text) {
  const atomicNumberMatch = text.match(/^#(\d+)/);
  if (atomicNumberMatch) {
    const element = ATOMIC_NUMBER_TO_ELEMENT.get(Number(atomicNumberMatch[1])) ?? null;
    return element ? { element, aromatic: false } : null;
  }

  const symbolMatch = text.match(/^(Cl|Br|Si|[BCNOPSFIbcnops])/);
  if (!symbolMatch) {
    return null;
  }

  const raw = symbolMatch[1];
  const aromatic = AROMATIC_ORGANIC.has(raw);
  const element = normalizeElement(raw);
  return element && ORGANIC_SYMBOLS.has(element) ? { element, aromatic } : null;
}

function stripAtomMap(atomText) {
  return atomText.replace(/:\d+\b/g, '');
}

function splitTopLevelAlternatives(atomText) {
  const alternatives = [];
  let current = '';
  let depth = 0;

  for (const ch of atomText) {
    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      alternatives.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  alternatives.push(current);
  return alternatives;
}

function leadingPrimitiveText(atomText) {
  const match = atomText.match(/^(#[0-9]+|Cl|Br|Si|[BCNOPSFIbcnops])/);
  return match?.[1] ?? null;
}

function extractBracketAtomBodies(smarts) {
  const bodies = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < smarts.length; i++) {
    const ch = smarts[i];
    if (ch === '[') {
      if (depth === 0) {
        start = i + 1;
      }
      depth++;
      continue;
    }
    if (ch === ']' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        bodies.push(smarts.slice(start, i));
        start = -1;
      }
    }
  }

  return bodies;
}

function stripBracketAtoms(smarts) {
  let result = '';
  let depth = 0;

  for (const ch of smarts) {
    if (ch === '[') {
      depth++;
      continue;
    }
    if (ch === ']' && depth > 0) {
      depth--;
      continue;
    }
    if (depth === 0) {
      result += ch;
    }
  }

  return result;
}

function collectBracketAtomRequirements(atomText, requirements) {
  const body = stripAtomMap(atomText.trim());

  if (body.includes('$(') || body.includes('!')) {
    const leading = leadingPrimitiveText(body);
    if (leading) {
      const primitive = parseAtomPrimitive(leading);
      if (primitive?.aromatic) {
        requirements.aromaticElements.add(primitive.element);
      } else if (primitive?.element) {
        requirements.elements.add(primitive.element);
      }
    }
    return;
  }

  const qualifierStart = body.search(/[;&]/);
  const atomExpression = qualifierStart === -1 ? body : body.slice(0, qualifierStart);
  const rawAlternatives = splitTopLevelAlternatives(atomExpression);
  const alternatives = rawAlternatives.map(part => parseAtomPrimitive(part)).filter(Boolean);
  if (alternatives.length >= 2 && alternatives.length === rawAlternatives.length) {
    const aromaticAlternatives = alternatives.filter(alt => alt.aromatic);
    const plainAlternatives = alternatives.filter(alt => !alt.aromatic);

    if (plainAlternatives.length > 1) {
      requirements.elementAnySets.push(new Set(plainAlternatives.map(alt => alt.element)));
    }
    if (aromaticAlternatives.length > 1) {
      requirements.aromaticElementAnySets.push(new Set(aromaticAlternatives.map(alt => alt.element)));
    }
    return;
  }

  const leading = leadingPrimitiveText(body);
  if (!leading) {
    return;
  }
  const primitive = parseAtomPrimitive(leading);
  if (primitive?.aromatic) {
    requirements.aromaticElements.add(primitive.element);
  } else if (primitive?.element) {
    requirements.elements.add(primitive.element);
  }
}

function collectBareAtomRequirements(reactantSmarts, requirements) {
  const bare = stripBracketAtoms(reactantSmarts);
  const atomMatches = bare.matchAll(/Cl|Br|Si|[BCNOPSFIbcnops]/g);
  for (const match of atomMatches) {
    const primitive = parseAtomPrimitive(match[0]);
    if (primitive?.aromatic) {
      requirements.aromaticElements.add(primitive.element);
    } else if (primitive?.element) {
      requirements.elements.add(primitive.element);
    }
  }
}

function summarizeMoleculeFeatures(molecule) {
  const features = {
    elements: new Set(),
    aromaticElements: new Set(),
    hasDoubleBond: false,
    hasTripleBond: false,
    hasAromaticBond: false
  };

  for (const atom of molecule.atoms.values()) {
    features.elements.add(atom.name);
    if (atom.properties.aromatic) {
      features.aromaticElements.add(atom.name);
    }
  }

  for (const bond of molecule.bonds.values()) {
    const order = bond.properties.localizedOrder ?? bond.properties.order ?? 1;
    if (bond.properties.aromatic || order === 1.5) {
      features.hasAromaticBond = true;
      continue;
    }
    if (order >= 3) {
      features.hasTripleBond = true;
    } else if (order >= 2) {
      features.hasDoubleBond = true;
    }
  }

  return features;
}

function inferTemplateRequirements(templateOrSmirks) {
  const smirks = typeof templateOrSmirks === 'string' ? templateOrSmirks : (templateOrSmirks?.smirks ?? '');
  const reactantSmarts = smirks.split('>>')[0] ?? '';
  const requirements = {
    elements: new Set(),
    aromaticElements: new Set(),
    elementAnySets: [],
    aromaticElementAnySets: [],
    hasDoubleBond: false,
    hasTripleBond: false,
    hasAromaticBond: false
  };

  const bracketAtomBodies = extractBracketAtomBodies(reactantSmarts);
  for (const atomBody of bracketAtomBodies) {
    collectBracketAtomRequirements(atomBody, requirements);
  }
  collectBareAtomRequirements(reactantSmarts, requirements);

  const bareBonds = stripBracketAtoms(reactantSmarts);
  requirements.hasDoubleBond = bareBonds.includes('=');
  requirements.hasTripleBond = bareBonds.includes('#');
  requirements.hasAromaticBond = bareBonds.includes(':') || requirements.aromaticElements.size > 0 || requirements.aromaticElementAnySets.length > 0;

  return requirements;
}

function templateCouldMatchFeatures(requirements, features) {
  for (const element of requirements.elements) {
    if (!features.elements.has(element)) {
      return false;
    }
  }

  for (const element of requirements.aromaticElements) {
    if (!features.aromaticElements.has(element)) {
      return false;
    }
  }

  for (const elementSet of requirements.elementAnySets) {
    if (![...elementSet].some(element => features.elements.has(element))) {
      return false;
    }
  }

  for (const elementSet of requirements.aromaticElementAnySets) {
    if (![...elementSet].some(element => features.aromaticElements.has(element))) {
      return false;
    }
  }

  if (requirements.hasDoubleBond && !features.hasDoubleBond) {
    return false;
  }
  if (requirements.hasTripleBond && !features.hasTripleBond) {
    return false;
  }
  if (requirements.hasAromaticBond && !features.hasAromaticBond) {
    return false;
  }

  return true;
}

function buildTemplatePrefilterEntries(templates) {
  return templates.map(template => ({
    template,
    requirements: inferTemplateRequirements(template)
  }));
}

function normalizeDemoBondLength(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1.5;
  }
  return Math.min(2.5, Math.max(0.5, numeric));
}

function generateMoleculePreview(seedSmiles, { bondLength = 1.5 } = {}) {
  const network = new ReactionNetwork();
  network.addMolecule(parseSMILES(seedSmiles));
  return network.exportDirectedGraph({ flatten: true, bondLength: normalizeDemoBondLength(bondLength) });
}

function generateNetwork(seedSmiles, maxDepth, flatten, maxNodes, scaffolds, decoratedScaffolds, extendedScaffolds, hideSimpleScaffolds, bondLength = 1.5) {
  const network = new ReactionNetwork();
  const processedSmiles = new Set();
  const attemptedReactions = new Set();
  const moleculeFeatureCache = new Map();
  let prefilterSkipCount = 0;

  const seedMolecule = parseSMILES(seedSmiles);
  const seedNode = network.addMolecule(seedMolecule);

  let currentQueue = [{ node: seedNode, depth: 0 }];
  const globalPrintedIds = new Set([seedNode.id]);
  const templateEntries = buildTemplatePrefilterEntries(Object.values(reactionTemplates));

  const featuresForNode = node => {
    if (!moleculeFeatureCache.has(node.id)) {
      moleculeFeatureCache.set(node.id, summarizeMoleculeFeatures(node.molecule));
    }
    return moleculeFeatureCache.get(node.id);
  };

  generationLoop: while (currentQueue.length > 0) {
    const nextQueue = [];

    for (const { node, depth } of currentQueue) {
      if (depth >= maxDepth) {
        continue;
      }

      if (network.moleculeNodes.size >= maxNodes) {
        break generationLoop;
      }

      const canon = node.canonicalSmiles;
      if (processedSmiles.has(canon)) {
        continue;
      }
      processedSmiles.add(canon);

      const features = featuresForNode(node);
      for (const { template, requirements } of templateEntries) {
        if (!templateCouldMatchFeatures(requirements, features)) {
          prefilterSkipCount++;
          continue;
        }

        const attemptKey = `${canon}||${template.name}`;
        if (attemptedReactions.has(attemptKey)) {
          continue;
        }
        attemptedReactions.add(attemptKey);

        let createdReactions;
        try {
          createdReactions = network.executeReactionTemplate([node.molecule], template.smirks, { templateName: template.name });
        } catch {
          continue;
        }

        for (const rxn of createdReactions) {
          for (const prodId of rxn.products) {
            const prodMolNode = network.moleculeNodes.get(prodId);
            if (!prodMolNode) {
              continue;
            }
            const prodCanon = prodMolNode.canonicalSmiles;

            if (!globalPrintedIds.has(prodId)) {
              globalPrintedIds.add(prodId);
              if (!processedSmiles.has(prodCanon)) {
                nextQueue.push({ node: prodMolNode, depth: depth + 1 });
              }
            }
          }
        }
      }
    }

    currentQueue = nextQueue;
  }

  console.log(`[DIAG] Template prefilter skipped ${prefilterSkipCount} template attempts.`);
  console.log('\n[DIAG] Molecule index after BFS:');
  const seenSmiles = new Map();
  for (const [id, node] of network.moleculeNodes) {
    const s = node.canonicalSmiles;
    if (!seenSmiles.has(s)) {
      seenSmiles.set(s, []);
    }
    seenSmiles.get(s).push(id);
  }
  let dupeCount = 0;
  for (const [s, ids] of seenSmiles) {
    if (ids.length > 1) {
      console.log(`  [DUPE] "${s}" stored as ${ids.join(', ')}`);
      dupeCount++;
    } else {
      console.log(`  [OK]   ${ids[0]}: "${s}"`);
    }
  }
  if (dupeCount === 0) {
    console.log('  No duplicates detected.');
  }
  console.log(`  Total nodes: ${network.moleculeNodes.size}, unique SMILES: ${seenSmiles.size}\n`);
  const normalizedBondLength = normalizeDemoBondLength(bondLength);

  if (scaffolds) {
    const scafNet = new ScaffoldNetwork(network, {
      preserveExocyclicMultipleBonds: decoratedScaffolds,
      preserveLargeSubstituentBackbones: extendedScaffolds,
      minSubstituentHeavyAtoms: 4,
      minScaffoldHeavyAtoms: hideSimpleScaffolds ? 2 : 1
    });
    return scafNet.exportHierarchicalGraph(network.exportDirectedGraph({ flatten, bondLength: normalizedBondLength }), { bondLength: normalizedBondLength });
  }

  return network.exportDirectedGraph({ flatten, bondLength: normalizedBondLength });
}

function runGenerationJob(params) {
  if (activeGeneration) {
    const error = new Error('Another generation is already running.');
    error.statusCode = 409;
    return Promise.reject(error);
  }

  const id = ++generationCounter;
  const worker = new Worker(new URL(import.meta.url), { workerData: params });
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

if (!isMainThread) {
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
} else {
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
}
