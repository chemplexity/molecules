import { ReactionNetwork, ScaffoldNetwork } from '../../../src/network/index.js';
import { parseSMILES } from '../../../src/io/index.js';
import { reactionTemplates } from '../../../src/smirks/index.js';
import { buildTemplatePrefilterEntries, summarizeMoleculeFeatures, templateCouldMatchFeatures } from './template-prefilter.js';

export function normalizeDemoBondLength(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1.5;
  }
  return Math.min(2.5, Math.max(0.5, numeric));
}

export function generateMoleculePreview(seedSmiles, { bondLength = 1.5 } = {}) {
  const network = new ReactionNetwork();
  network.addMolecule(parseSMILES(seedSmiles));
  return network.exportDirectedGraph({ flatten: true, bondLength: normalizeDemoBondLength(bondLength) });
}

export function generateNetwork(seedSmiles, maxDepth, flatten, maxNodes, scaffolds, decoratedScaffolds, extendedScaffolds, hideSimpleScaffolds, bondLength = 1.5) {
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

  while (currentQueue.length > 0) {
    const nextQueue = [];

    for (const { node, depth } of currentQueue) {
      if (depth >= maxDepth) {
        continue;
      }

      if (network.moleculeNodes.size >= maxNodes) {
        currentQueue = [];
        break;
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

        let createdReactions = [];
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
