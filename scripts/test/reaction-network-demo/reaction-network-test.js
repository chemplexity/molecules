import { ReactionNetwork } from '../../../src/network/index.js';
import { parseSMILES } from '../../../src/io/index.js';
import { reactionTemplates } from '../../../src/smirks/index.js';
import { buildTemplatePrefilterEntries, summarizeMoleculeFeatures, templateCouldMatchFeatures } from './template-prefilter.js';

// Parse process arguments securely
const seedSmiles = process.argv[2] || 'C';
const maxDepth = parseInt(process.argv[3] || '5', 10);
const flatten = process.argv[4] === 'true';
const maxNodes = parseInt(process.argv[5] || '100', 10);

const network = new ReactionNetwork();
const moleculeFeatureCache = new Map();
let prefilterSkipCount = 0;

// Track which molecules have already been queued as reactants
const processedSmiles = new Set();
// Track which (reactant_canon, template_name) pairs have been attempted — prevents
// re-executing the identical reaction on the same molecule at a later BFS depth.
const attemptedReactions = new Set();

const seedMolecule = parseSMILES(seedSmiles);
const seedNode = network.addMolecule(seedMolecule);
console.log(`\x1b[32m[+]\x1b[0m Seed Molecule Registered: ${seedNode.canonicalSmiles} [ID: ${seedNode.id}]`);

let currentQueue = [{ node: seedNode, depth: 0 }];

console.log(`\x1b[36mStarting Network Generation...\x1b[0m`);
console.log(`Seed: ${seedSmiles} | Max Depth: ${maxDepth} | Max Nodes: ${maxNodes} | Flatten: ${flatten}`);
console.log('--------------------------------------------------');

const templateEntries = buildTemplatePrefilterEntries(Object.values(reactionTemplates));
const featuresForNode = node => {
  if (!moleculeFeatureCache.has(node.id)) {
    moleculeFeatureCache.set(node.id, summarizeMoleculeFeatures(node.molecule));
  }
  return moleculeFeatureCache.get(node.id);
};

// Core Generation Engine
const globalPrintedIds = new Set([seedNode.id]);

while (currentQueue.length > 0) {
  const nextQueue = [];

  for (const { node, depth } of currentQueue) {
    if (depth >= maxDepth) {
      continue;
    }

    // Hard cap — prevents combinatorial explosion from bidirectional template pairs
    if (network.moleculeNodes.size >= maxNodes) {
      console.log(`\x1b[33m[!]\x1b[0m Node cap reached (${maxNodes}). Stopping BFS.`);
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

      // Skip if this exact (molecule, template) pair has already been executed
      const attemptKey = `${canon}||${template.name}`;
      if (attemptedReactions.has(attemptKey)) {
        continue;
      }
      attemptedReactions.add(attemptKey);

      let createdReactions = [];
      try {
        createdReactions = network.executeReactionTemplate([node.molecule], template.smirks, { templateName: template.name });
      } catch (e) {
        continue;
      }

      for (const rxn of createdReactions) {
        // Instantly print the reaction FIRST!
        console.log(`\x1b[35m[⚡]\x1b[0m Reaction Executed: ${template.name} (${rxn.reactants.join(' + ')} -> ${rxn.products.join(' + ')}) [ID: ${rxn.id}]`);

        for (const prodId of rxn.products) {
          const prodMolNode = network.moleculeNodes.get(prodId);
          if (!prodMolNode) {
            continue;
          }
          const prodCanon = prodMolNode.canonicalSmiles;

          if (!globalPrintedIds.has(prodId)) {
            globalPrintedIds.add(prodId);
            console.log(`\x1b[32m[+]\x1b[0m Molecule Discovered: ${prodCanon} [ID: ${prodId}]`);

            if (!processedSmiles.has(prodCanon)) {
              nextQueue.push({ node: prodMolNode, depth: depth + 1 });
            }
          } else {
            console.log(`\x1b[33m[!]\x1b[0m Duplicate Structure Skipped: ${prodCanon} [Merged -> ${prodId}]`);
          }
        }
      }
    }
  }

  currentQueue = nextQueue;
}

console.log('--------------------------------------------------');
console.log(`\x1b[36mGeneration Complete.\x1b[0m`);
console.log(`Total Molecules: ${network.moleculeNodes.size}`);
console.log(`Total Reactions: ${network.reactionNodes.size}`);
console.log(`Template prefilter skips: ${prefilterSkipCount}`);
console.log('\nFinal Graph Export Dump:');

// Flatten securely routes the true bipartite topology into generic D3 visual outputs natively!
console.log(JSON.stringify(network.exportDirectedGraph({ flatten }), null, 2));
