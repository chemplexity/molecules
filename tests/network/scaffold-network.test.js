import test from 'node:test';
import assert from 'node:assert';
import { ReactionNetwork } from '../../src/network/ReactionNetwork.js';
import { ScaffoldNetwork } from '../../src/network/ScaffoldNetwork.js';
import { parseSMILES } from '../../src/io/index.js';

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
