/**
 * Reaction Network Viewer Server
 * 
 * Accepts GET /generate?smiles=...&depth=3&flatten=true&maxNodes=100
 * Returns the exported D3 graph JSON.
 * 
 * Usage:
 *   node scripts/test/server.js
 *   Then open scripts/test/viewer.html in a browser.
 */

import http from 'http';
import { ReactionNetwork } from '../../src/network/index.js';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/index.js';
import { reactionTemplates } from '../../src/smirks/index.js';

const PORT = 3737;

function generateNetwork(seedSmiles, maxDepth, flatten, maxNodes) {
    const network = new ReactionNetwork();
    const processedSmiles = new Set();
    const attemptedReactions = new Set();

    const seedMolecule = parseSMILES(seedSmiles);
    const seedNode = network.addMolecule(seedMolecule);

    let currentQueue = [{ molecule: seedNode.molecule, depth: 0 }];
    const globalPrintedIds = new Set([seedNode.id]);
    const templates = Object.values(reactionTemplates);

    while (currentQueue.length > 0) {
        const nextQueue = [];

        for (const { molecule, depth } of currentQueue) {
            if (depth >= maxDepth) continue;

            if (network.moleculeNodes.size >= maxNodes) {
                currentQueue = [];
                break;
            }

            const canon = toCanonicalSMILES(molecule);
            if (processedSmiles.has(canon)) continue;
            processedSmiles.add(canon);

            for (const template of templates) {
                const attemptKey = `${canon}||${template.name}`;
                if (attemptedReactions.has(attemptKey)) continue;
                attemptedReactions.add(attemptKey);

                let createdReactions = [];
                try {
                    createdReactions = network.executeReactionTemplate(
                        [molecule],
                        template.smirks,
                        { templateName: template.name }
                    );
                } catch {
                    continue;
                }

                for (const rxn of createdReactions) {
                    for (const prodId of rxn.products) {
                        const prodMolNode = network.moleculeNodes.get(prodId);
                        if (!prodMolNode) continue;
                        const prodCanon = toCanonicalSMILES(prodMolNode.molecule);

                        if (!globalPrintedIds.has(prodId)) {
                            globalPrintedIds.add(prodId);
                            if (!processedSmiles.has(prodCanon)) {
                                nextQueue.push({ molecule: prodMolNode.molecule, depth: depth + 1 });
                            }
                        }
                    }
                }
            }
        }

        currentQueue = nextQueue;
    }

    // ── Diagnostic: dump all stored molecule SMILES to detect dedup failures ──
    console.log('\n[DIAG] Molecule index after BFS:');
    const seenSmiles = new Map();
    for (const [id, node] of network.moleculeNodes) {
        const s = toCanonicalSMILES(node.molecule);
        if (!seenSmiles.has(s)) seenSmiles.set(s, []);
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
    if (dupeCount === 0) console.log('  No duplicates detected.');
    console.log(`  Total nodes: ${network.moleculeNodes.size}, unique SMILES: ${seenSmiles.size}\n`);

    return network.exportDirectedGraph({ flatten });
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname !== '/generate') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use GET /generate?smiles=...&depth=3&flatten=true&maxNodes=100' }));
        return;
    }

    const smiles = url.searchParams.get('smiles') || 'C';
    const depth = parseInt(url.searchParams.get('depth') || '3', 10);
    const flatten = url.searchParams.get('flatten') === 'true';
    const maxNodes = parseInt(url.searchParams.get('maxNodes') || '100', 10);

    console.log(`[→] Generating: smiles=${smiles} depth=${depth} flatten=${flatten} maxNodes=${maxNodes}`);

    try {
        const data = generateNetwork(smiles, depth, flatten, maxNodes);
        console.log(`[✓] Done: ${data.nodes.length} nodes, ${data.links.length} links`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    } catch (e) {
        console.error(`[✗] Error:`, e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
});

server.listen(PORT, () => {
    console.log(`Reaction Network Server running at http://localhost:${PORT}`);
    console.log(`Open scripts/test/viewer.html in your browser.`);
});
