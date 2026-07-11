import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReactionNetwork } from '../../src/network/ReactionNetwork.js';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/index.js';
import { renderMolSVG } from '../../src/layout/render2d.js';
import { reactionTemplates } from '../../src/smirks/index.js';

describe('ReactionNetwork', () => {
  it('addMolecule deduplicates identically built molecules leveraging Canonical SMILES', () => {
    const network = new ReactionNetwork();

    const m1 = parseSMILES('C');
    const m2 = parseSMILES('C');

    assert.notEqual(m1, m2); // independent memory instances

    const node1 = network.addMolecule(m1);
    const node2 = network.addMolecule(m2);

    assert.equal(node1, node2);
    assert.equal(node1.canonicalSmiles, 'C');
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

  it('exports molecule thumbnails with transparent atom labels for network viewers', () => {
    const network = new ReactionNetwork();
    network.addMolecule(parseSMILES('CO'));
    network.addMolecule(parseSMILES('[NH4+]'));

    const graph = network.exportDirectedGraph({ flatten: true });
    const moleculeNode = graph.nodes.find(node => node.type === 'molecule' && /<tspan>(?:OH|HO)<\/tspan>/.test(node.svg ?? ''));
    const chargedNode = graph.nodes.find(node => node.type === 'molecule' && /class="atom-charge-ring"/.test(node.svg ?? ''));

    assert.ok(moleculeNode?.svg, 'expected exported molecule SVG');
    assert.doesNotMatch(moleculeNode.svg, /fill="white" rx="2"/);
    assert.match(moleculeNode.svg, /text-anchor="middle" dominant-baseline="middle" alignment-baseline="middle"><tspan>(?:OH|HO)<\/tspan><\/text>/);
    assert.ok(chargedNode?.svg, 'expected exported charged molecule SVG');
    assert.match(chargedNode.svg, /class="atom-charge-ring"[^>]+fill="none"/);
  });

  it('exports molecule thumbnails using the requested render bond length', () => {
    const network = new ReactionNetwork();
    network.addMolecule(parseSMILES('CCCCCCCC'));

    const compact = network.exportDirectedGraph({ flatten: true, bondLength: 0.5 }).nodes[0];
    const expanded = network.exportDirectedGraph({ flatten: true, bondLength: 2.5 }).nodes[0];

    assert.ok(expanded.width > compact.width, 'expected larger bond length to increase thumbnail width');
  });

  it('executeReactionTemplate preserves displayed stereo hydrogens on unchanged centers', () => {
    const network = new ReactionNetwork();
    const seed = parseSMILES('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    const rxns = network.executeReactionTemplate([seed], reactionTemplates.alkeneHydrogenation.smirks, { enzyme: 'H2' });

    assert.ok(rxns.length >= 2, 'expected both alkene hydrogenation sites to generate products');

    for (const rxn of rxns) {
      for (const productId of rxn.products) {
        const product = network.moleculeNodes.get(productId)?.molecule;
        assert.ok(product, `expected product molecule ${productId}`);

        const displayedTypes = [...product.bonds.values()]
          .filter(bond => bond.properties.display?.as && bond.atoms.some(atomId => product.atoms.get(atomId)?.name === 'H'))
          .map(bond => bond.properties.display.as);

        assert.ok(displayedTypes.length >= 2, 'expected inherited displayed stereochemical hydrogens');
        assert.deepEqual(new Set(displayedTypes), new Set(['wedge']));

        const renderedClone = product.clone();
        renderMolSVG(renderedClone);
        const renderedTypes = [...renderedClone.bonds.values()]
          .filter(bond => bond.properties.display?.as && bond.atoms.some(atomId => renderedClone.atoms.get(atomId)?.name === 'H'))
          .map(bond => bond.properties.display.as);

        assert.deepEqual(renderedTypes, displayedTypes);
      }
    }
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
    assert.deepEqual(
      dump.moleculeNodes.map(([, node]) => node.smiles).sort(),
      ['C', 'O']
    );

    const network2 = new ReactionNetwork();
    network2.fromJSON(dump);

    assert.equal(network2.moleculeNodes.size, 2);
    assert.equal(network2.reactionNodes.size, 1);
    assert.equal(network2._moleculeCounter, 2);
    assert.equal(network2._reactionCounter, 1);
    assert.deepEqual(
      [...network2.moleculeNodes.values()].map(node => node.canonicalSmiles).sort(),
      ['C', 'O']
    );

    const sourceNodes = network.exportDirectedGraph({ flatten: true });
    const reloadedNodes = network2.exportDirectedGraph({ flatten: true });

    assert.equal(sourceNodes.links.length, reloadedNodes.links.length);
  });
});
