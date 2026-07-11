import test from 'node:test';
import assert from 'node:assert';
import { ReactionNetwork } from '../../src/network/ReactionNetwork.js';
import { ScaffoldNetwork } from '../../src/network/ScaffoldNetwork.js';
import { parseSMILES } from '../../src/io/index.js';

function svgLines(svg) {
  return svg?.match(/<line[^>]+>/g) ?? [];
}

test('ScaffoldNetwork groups common scaffolds correctly', () => {
  const reactionNetwork = new ReactionNetwork();

  // Create three molecules.
  // 1. Benzene (scaffold: c1ccccc1)
  const benzene = parseSMILES('c1ccccc1');
  // 2. Toluene (scaffold: c1ccccc1)
  const toluene = parseSMILES('Cc1ccccc1');
  // 3. Phenol (scaffold: c1ccccc1)
  const phenol = parseSMILES('Oc1ccccc1');
  // 4. Methane (no scaffold)
  const methane = parseSMILES('C');
  // 5. Ethane (no scaffold)
  const ethane = parseSMILES('CC');
  // 6. Pyridine (another scaffold: c1ccccn1)
  const pyridine = parseSMILES('c1ccccn1');

  reactionNetwork.addMolecule(benzene);
  reactionNetwork.addMolecule(toluene);
  reactionNetwork.addMolecule(phenol);
  reactionNetwork.addMolecule(methane);
  reactionNetwork.addMolecule(ethane);
  reactionNetwork.addMolecule(pyridine);

  // Benzene + Methane -> Toluene
  reactionNetwork.addReaction([benzene, methane], [toluene]);

  // Toluene -> Phenol (fake reaction for testing inner-scaffold transformations)
  reactionNetwork.addReaction([toluene], [phenol]);

  // Benzene -> Pyridine (inter-scaffold)
  reactionNetwork.addReaction([benzene], [pyridine]);

  const scaffoldNetwork = new ScaffoldNetwork(reactionNetwork);
  scaffoldNetwork.sync();

  // Scaffolds expected:
  // 1. c1ccccc1 (Benzene, Toluene, Phenol)
  // 2. c1ccncc1 (Pyridine)
  // 3. C (Methane)
  // 4. CC (Ethane)

  assert.strictEqual(scaffoldNetwork.scaffoldNodes.size, 4, 'Should have exactly 4 scaffold nodes');

  let benzeneScaffoldNode = null;
  let pyridineScaffoldNode = null;
  let methaneScaffoldNode = null;
  let ethaneScaffoldNode = null;

  for (const node of scaffoldNetwork.scaffoldNodes.values()) {
    if (node.smiles === 'c1ccccc1') {
      benzeneScaffoldNode = node;
    } else if (node.smiles === 'c1ccncc1') {
      pyridineScaffoldNode = node;
    } else if (node.smiles === 'C') {
      methaneScaffoldNode = node;
    } else if (node.smiles === 'CC') {
      ethaneScaffoldNode = node;
    }
  }

  assert.ok(benzeneScaffoldNode);
  assert.ok(pyridineScaffoldNode);
  assert.ok(methaneScaffoldNode);
  assert.ok(ethaneScaffoldNode);

  assert.strictEqual(benzeneScaffoldNode.moleculeIds.length, 3, 'Benzene scaffold should have 3 molecules');
  assert.strictEqual(pyridineScaffoldNode.moleculeIds.length, 1, 'Pyridine scaffold should have 1 molecule');
  assert.strictEqual(methaneScaffoldNode.moleculeIds.length, 1, 'Methane scaffold should have 1 molecule');
  assert.strictEqual(ethaneScaffoldNode.moleculeIds.length, 1, 'Ethane scaffold should have 1 molecule');

  // Verify reactions
  // The reactions are:
  // Rxn 1: [Benzene, Methane] -> [Toluene]
  // Scaffold Rxn 1: [c1ccccc1, ACYCLIC] -> [c1ccccc1]

  // Rxn 2: [Toluene] -> [Phenol]
  // Scaffold Rxn 2: [c1ccccc1] -> [c1ccccc1]

  // Rxn 3: [Benzene] -> [Pyridine]
  // Scaffold Rxn 3: [c1ccccc1] -> [c1ccccn1]

  assert.strictEqual(scaffoldNetwork.scaffoldReactionNodes.size, 3, 'Should have exactly 3 scaffold reactions');

  const selfTransforms = scaffoldNetwork.getSelfTransformations();
  assert.strictEqual(selfTransforms.length, 1, 'Should have 1 self transformation (c1ccccc1 -> c1ccccc1)');

  assert.strictEqual(selfTransforms[0].reactants[0], benzeneScaffoldNode.id);
  assert.strictEqual(selfTransforms[0].products[0], benzeneScaffoldNode.id);
});

test('ScaffoldNetwork groups charged and neutral variants under the same scaffold entity', () => {
  const reactionNetwork = new ReactionNetwork();
  const benzene = parseSMILES('c1ccccc1');
  const chargedBenzene = parseSMILES('[c+]1ccccc1');

  reactionNetwork.addMolecule(benzene);
  reactionNetwork.addMolecule(chargedBenzene);

  const scaffoldNetwork = new ScaffoldNetwork(reactionNetwork);
  scaffoldNetwork.sync();

  assert.strictEqual(scaffoldNetwork.scaffoldNodes.size, 1, 'charge-only scaffold variants should collapse');
  const [scaffoldNode] = scaffoldNetwork.scaffoldNodes.values();
  assert.strictEqual(scaffoldNode.smiles, 'c1ccccc1');
  assert.strictEqual(scaffoldNode.moleculeIds.length, 2);
});

test('ScaffoldNetwork can filter out one-heavy-atom simple scaffolds', () => {
  const reactionNetwork = new ReactionNetwork();

  reactionNetwork.addMolecule(parseSMILES('C'));
  reactionNetwork.addMolecule(parseSMILES('Cl'));
  reactionNetwork.addMolecule(parseSMILES('[H]Cl'));
  reactionNetwork.addMolecule(parseSMILES('CC'));

  const scaffoldNetwork = new ScaffoldNetwork(reactionNetwork, { minScaffoldHeavyAtoms: 2 });
  scaffoldNetwork.sync();
  const scaffoldSmiles = new Set([...scaffoldNetwork.scaffoldNodes.values()].map(node => node.smiles));

  assert.strictEqual(scaffoldNetwork.scaffoldNodes.size, 1);
  assert.deepStrictEqual(scaffoldSmiles, new Set(['CC']));
});

test('ScaffoldNetwork can separate decorated carbonyl scaffolds when configured', () => {
  const reactionNetwork = new ReactionNetwork();
  const cyclohexane = parseSMILES('C1CCCCC1');
  const cyclohexanone = parseSMILES('O=C1CCCCC1');

  reactionNetwork.addMolecule(cyclohexane);
  reactionNetwork.addMolecule(cyclohexanone);

  const strictScaffoldNetwork = new ScaffoldNetwork(reactionNetwork);
  strictScaffoldNetwork.sync();
  assert.strictEqual(strictScaffoldNetwork.scaffoldNodes.size, 1);

  const decoratedScaffoldNetwork = new ScaffoldNetwork(reactionNetwork, { preserveExocyclicMultipleBonds: true });
  decoratedScaffoldNetwork.sync();
  const scaffoldSmiles = new Set([...decoratedScaffoldNetwork.scaffoldNodes.values()].map(node => node.smiles));

  assert.strictEqual(decoratedScaffoldNetwork.scaffoldNodes.size, 2);
  assert.ok(scaffoldSmiles.has('C1CCCCC1'));
  assert.ok(scaffoldSmiles.has('C1CCC(CC1)=O'));
});

test('ScaffoldNetwork exports scaffold thumbnails using the requested render bond length', () => {
  const reactionNetwork = new ReactionNetwork();
  reactionNetwork.addMolecule(parseSMILES('C1CCCCC1CCC2CCCCC2'));

  const scaffoldNetwork = new ScaffoldNetwork(reactionNetwork);
  scaffoldNetwork.sync();
  const compact = scaffoldNetwork.exportDirectedGraph({ bondLength: 0.5 }).nodes[0];
  const expanded = scaffoldNetwork.exportDirectedGraph({ bondLength: 2.5 }).nodes[0];

  assert.ok(expanded.width > compact.width, 'expected larger bond length to increase scaffold thumbnail width');
});

test('ScaffoldNetwork renders scaffold thumbnails from representative molecule geometry', () => {
  const reactionNetwork = new ReactionNetwork();
  reactionNetwork.addMolecule(parseSMILES('CC1C=CCC1'));

  const baseGraph = reactionNetwork.exportDirectedGraph({ flatten: true });
  const scaffoldNetwork = new ScaffoldNetwork(reactionNetwork);
  scaffoldNetwork.sync();
  const graph = scaffoldNetwork.exportHierarchicalGraph(baseGraph);

  const moleculeNode = graph.nodes.find(node => node.type === 'molecule');
  const scaffoldNode = graph.nodes.find(node => node.type === 'scaffold');

  assert.ok(moleculeNode?.svg, 'expected molecule thumbnail');
  assert.ok(scaffoldNode?.svg, 'expected scaffold thumbnail');
  assert.deepStrictEqual(svgLines(scaffoldNode.svg).slice(0, 3), svgLines(moleculeNode.svg).slice(0, 3));
});

test('ScaffoldNetwork can retain substantial substituent backbones when configured', () => {
  const reactionNetwork = new ReactionNetwork();
  reactionNetwork.addMolecule(parseSMILES('CCC(CC(CC1C(C)[NH+]=C(C)N1CCO)O)O'));

  const strictScaffoldNetwork = new ScaffoldNetwork(reactionNetwork, { autoSync: false });
  strictScaffoldNetwork.sync();
  const extendedScaffoldNetwork = new ScaffoldNetwork(reactionNetwork, { autoSync: false, preserveLargeSubstituentBackbones: true });
  extendedScaffoldNetwork.sync();

  assert.deepStrictEqual(new Set([...strictScaffoldNetwork.scaffoldNodes.values()].map(node => node.smiles)), new Set(['C1=NCCN1']));
  assert.deepStrictEqual(new Set([...extendedScaffoldNetwork.scaffoldNodes.values()].map(node => node.smiles)), new Set(['CCC(CC(CC1CN=CN1)O)O']));
});
