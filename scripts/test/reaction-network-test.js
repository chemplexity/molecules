import { ReactionNetwork } from '../../src/network/index.js';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/index.js';
import { reactionTemplates } from '../../src/smirks/index.js';

// Parse process arguments securely 
const seedSmiles = process.argv[2] || 'C';
const maxDepth = parseInt(process.argv[3] || '5', 10);
const flatten = process.argv[4] === 'true';

const network = new ReactionNetwork();

// Intercept graph mutation streams directly from the core
const processedSmiles = new Set();
const seedMolecule = parseSMILES(seedSmiles);
const seedNode = network.addMolecule(seedMolecule);
console.log(`\x1b[32m[+]\x1b[0m Seed Molecule Registered: ${toCanonicalSMILES(seedNode.molecule)} [ID: ${seedNode.id}]`);

let currentQueue = [{ molecule: seedNode.molecule, depth: 0 }];

console.log(`\x1b[36mStarting Network Generation...\x1b[0m`);
console.log(`Seed: ${seedSmiles} | Max Depth: ${maxDepth} | Flatten: ${flatten}`);
console.log('--------------------------------------------------');

const templates = Object.values(reactionTemplates);

// Core Generation Engine
let globalPrintedIds = new Set([currentQueue[0].molecule.id]);

while (currentQueue.length > 0) {
    const nextQueue = [];

    for (const { molecule, depth } of currentQueue) {
        if (depth >= maxDepth) continue;

        const canon = toCanonicalSMILES(molecule);
        if (processedSmiles.has(canon)) continue;
        processedSmiles.add(canon);
        
        for (const template of templates) {
            let createdReactions = [];
            try {
                 createdReactions = network.executeReactionTemplate(
                     [molecule], 
                     template.smirks, 
                     { templateName: template.name }
                 );
            } catch (e) {
                continue;
            }
            
            for (const rxn of createdReactions) {
                // Instantly print the reaction FIRST!
                console.log(`\x1b[35m[⚡]\x1b[0m Reaction Executed: ${template.name} (${rxn.reactants.join(' + ')} -> ${rxn.products.join(' + ')}) [ID: ${rxn.id}]`);
                
                for (const prodId of rxn.products) {
                    const prodMolNode = network.moleculeNodes.get(prodId);
                    if (!prodMolNode) continue;
                    const prodCanon = toCanonicalSMILES(prodMolNode.molecule);
                    
                    if (!globalPrintedIds.has(prodId)) {
                        globalPrintedIds.add(prodId);
                        console.log(`\x1b[32m[+]\x1b[0m Molecule Discovered: ${prodCanon} [ID: ${prodId}]`);
                        
                         if (!processedSmiles.has(prodCanon)) {
                             nextQueue.push({ molecule: prodMolNode.molecule, depth: depth + 1 });
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
console.log('\nFinal Graph Export Dump:');

// Flatten securely routes the true bipartite topology into generic D3 visual outputs natively!
console.log(JSON.stringify(network.exportDirectedGraph({ flatten }), null, 2));
