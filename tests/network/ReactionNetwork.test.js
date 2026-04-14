import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReactionNetwork } from '../../src/network/ReactionNetwork.js';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/index.js';

describe('ReactionNetwork', () => {
  it('addMolecule deduplicates identically built molecules leveraging Canonical SMILES', () => {
    const network = new ReactionNetwork();

    const m1 = parseSMILES('C');
    const m2 = parseSMILES('C');

    assert.notEqual(m1, m2); // independent memory instances

    const node1 = network.addMolecule(m1);
    const node2 = network.addMolecule(m2);

    assert.equal(node1, node2);
    assert.equal(network.moleculeNodes.size, 1);
    assert.equal(network._smilesIndex.size, 1);
  });

  it('addReaction constructs bipartite layout and synchronously blasts projected UI links via event dispatch', () => {
    const network = new ReactionNetwork();

    let linkCounter = 0;
    let rxnCounter = 0;

    network.on('linkAdded', data => {
      linkCounter++;
      assert.equal(data.delta, '+O2 -H4'); // CH4 -> CO2
      assert.deepEqual(data.conditions, { enzyme: 'Magic' });
    });

    network.on('reactionAdded', _data => {
      rxnCounter++;
    });

    const ch4 = parseSMILES('C');
    const co2 = parseSMILES('O=C=O');

    const rxn = network.addReaction([ch4], [co2], { enzyme: 'Magic' });

    assert.equal(linkCounter, 1);
    assert.equal(rxnCounter, 1);

    const rNode1 = network.moleculeNodes.get(network._smilesIndex.get(toCanonicalSMILES(ch4)));
    const pNode1 = network.moleculeNodes.get(network._smilesIndex.get(toCanonicalSMILES(co2)));

    assert.ok(rNode1.consumedIn.includes(rxn.id));
    assert.ok(pNode1.producedBy.includes(rxn.id));
  });

  it('executeReactionTemplate handles structural execution gracefully', () => {
    const network = new ReactionNetwork();
    const ch4 = parseSMILES('C');
    const rxns = network.executeReactionTemplate([ch4], '[C:1]>>[C:1]=O', { enzyme: 'TemplateMaster' });

    assert.ok(Array.isArray(rxns));
  });

  it('removeMolecule explicitly cascades ensuring flawless memory garbage collection for orphaned hubs', () => {
    const network = new ReactionNetwork();
    const ch4 = parseSMILES('C');
    const co2 = parseSMILES('O=C=O');
    network.addReaction([ch4], [co2]);

    assert.equal(network.reactionNodes.size, 1);
    assert.equal(network.moleculeNodes.size, 2);

    network.removeMolecule(ch4);

    assert.equal(network.moleculeNodes.size, 1); // C is gone
    assert.equal(network.reactionNodes.size, 0); // CO2 incoming rxn deleted due to orphan cascade
  });

  it('findShortestPathway maps accurate traversal layers', () => {
    const network = new ReactionNetwork();
    const m1 = parseSMILES('C');
    const m2 = parseSMILES('CC');
    const m3 = parseSMILES('CCC');

    network.addReaction([m1], [m2]);
    network.addReaction([m2], [m3]);

    const path = network.findShortestPathway(m1, m3);
    assert.equal(path.length, 5); // Mol, Rxn, Mol, Rxn, Mol
    assert.equal(path[0].molecule.getName(), m1.getName());
    assert.equal(path[4].molecule.getName(), m3.getName());
  });

  it('findSynthesisRoutes computes exhaustive synthesis paths', () => {
    const network = new ReactionNetwork();
    const m1 = parseSMILES('C');
    const m2 = parseSMILES('CC');

    network.addReaction([m1], [m2]);

    const backwardPaths = network.findSynthesisRoutes(m2);
    assert.equal(backwardPaths.length, 1);
    assert.equal(backwardPaths[0].length, 3); // M1 -> Rxn -> M2

    assert.equal(backwardPaths[0][2].molecule.getName(), m2.getName());
  });

  it('toJSON and fromJSON preserve deep mathematical references cleanly', () => {
    const network = new ReactionNetwork();
    network.addReaction([parseSMILES('C')], [parseSMILES('O')]);

    const dump = network.toJSON();

    const network2 = new ReactionNetwork();
    network2.fromJSON(dump);

    assert.equal(network2.moleculeNodes.size, 2);
    assert.equal(network2.reactionNodes.size, 1);
    assert.equal(network2._moleculeCounter, 2);
    assert.equal(network2._reactionCounter, 1);

    const sourceNodes = network.exportDirectedGraph({ flatten: true });
    const reloadedNodes = network2.exportDirectedGraph({ flatten: true });

    assert.equal(sourceNodes.links.length, reloadedNodes.links.length);
  });
});
