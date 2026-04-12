/** @module tests/layoutv2/support/molecules */

import { Molecule } from '../../../src/core/index.js';
import { parseSMILES } from '../../../src/io/smiles.js';

/**
 * Creates a simple linear chain of identical atoms.
 * @param {number} length - Atom count.
 * @param {string} [element] - Element symbol for each atom.
 * @returns {Molecule} Chain molecule.
 */
export function makeChain(length, element = 'C') {
  const molecule = new Molecule();
  for (let index = 0; index < length; index++) {
    molecule.addAtom(`a${index}`, element);
  }
  for (let index = 0; index < length - 1; index++) {
    molecule.addBond(`b${index}`, `a${index}`, `a${index + 1}`, {}, false);
  }
  return molecule;
}

/**
 * Creates an ethane fixture.
 * @returns {Molecule} Ethane-like chain.
 */
export function makeEthane() {
  return makeChain(2);
}

/**
 * Creates two disconnected ethane fragments.
 * @returns {Molecule} Disconnected two-fragment alkane fixture.
 */
export function makeDisconnectedEthanes() {
  const molecule = new Molecule();
  molecule.addAtom('a0', 'C');
  molecule.addAtom('a1', 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addAtom('c0', 'C');
  molecule.addAtom('c1', 'C');
  molecule.addBond('d0', 'c0', 'c1', {}, false);
  return molecule;
}

/**
 * Creates a cyclohexane fixture.
 * @returns {Molecule} Cyclohexane ring.
 */
export function makeCyclohexane() {
  const molecule = new Molecule();
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  for (let index = 0; index < 6; index++) {
    molecule.addBond(`b${index}`, `a${index}`, `a${(index + 1) % 6}`, {}, false);
  }
  return molecule;
}

/**
 * Creates a simple macrocycle fixture.
 * @param {number} [size] - Ring size.
 * @returns {Molecule} Macrocycle ring.
 */
export function makeMacrocycle(size = 12) {
  const molecule = new Molecule();
  for (let index = 0; index < size; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  for (let index = 0; index < size; index++) {
    molecule.addBond(`b${index}`, `a${index}`, `a${(index + 1) % size}`, {}, false);
  }
  return molecule;
}

/**
 * Creates a simple macrocycle with one exocyclic carbon substituent.
 * @param {number} [size] - Ring size.
 * @returns {Molecule} Macrocycle with a pendant carbon.
 */
export function makeMacrocycleWithSubstituent(size = 12) {
  const molecule = makeMacrocycle(size);
  molecule.addAtom(`a${size}`, 'C');
  molecule.addBond(`b${size}`, 'a0', `a${size}`, {}, false);
  return molecule;
}

/**
 * Creates a macrocycle with alternating methyl substituents.
 * @param {number} [size] - Ring size.
 * @returns {Molecule} Macrocycle with alternating exocyclic carbons.
 */
export function makeAlternatingMethylMacrocycle(size = 12) {
  const molecule = makeMacrocycle(size);
  let substituentIndex = 0;
  for (let ringIndex = 0; ringIndex < size; ringIndex += 2) {
    const atomId = `m${substituentIndex++}`;
    molecule.addAtom(atomId, 'C');
    molecule.addBond(`mb${ringIndex}`, `a${ringIndex}`, atomId, {}, false);
  }
  return molecule;
}

/**
 * Creates a benzene fixture.
 * @returns {Molecule} Aromatic six-membered ring.
 */
export function makeBenzene() {
  const molecule = new Molecule();
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`a${index}`, 'C', { aromatic: true });
  }
  for (let index = 0; index < 6; index++) {
    molecule.addBond(`b${index}`, `a${index}`, `a${(index + 1) % 6}`, { aromatic: true }, false);
  }
  return molecule;
}

/**
 * Creates a methylbenzene fixture.
 * @returns {Molecule} Aromatic ring with a methyl substituent.
 */
export function makeMethylbenzene() {
  const molecule = makeBenzene();
  molecule.addAtom('a6', 'C');
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  return molecule;
}

/**
 * Creates an ethylbenzene fixture.
 * @returns {Molecule} Aromatic ring with an ethyl substituent.
 */
export function makeEthylbenzene() {
  const molecule = makeBenzene();
  molecule.addAtom('a6', 'C');
  molecule.addAtom('a7', 'C');
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a7', {}, false);
  return molecule;
}

/**
 * Creates a butylbenzene fixture.
 * @returns {Molecule} Aromatic ring with a butyl substituent.
 */
export function makeButylbenzene() {
  const molecule = makeBenzene();
  molecule.addAtom('a6', 'C');
  molecule.addAtom('a7', 'C');
  molecule.addAtom('a8', 'C');
  molecule.addAtom('a9', 'C');
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a7', {}, false);
  molecule.addBond('b8', 'a7', 'a8', {}, false);
  molecule.addBond('b9', 'a8', 'a9', {}, false);
  return molecule;
}

/**
 * Creates a phenylacetylene fixture.
 * @returns {Molecule} Aromatic ring with a linear ethynyl substituent.
 */
export function makePhenylacetylene() {
  const molecule = makeBenzene();
  molecule.addAtom('a6', 'C');
  molecule.addAtom('a7', 'C');
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a7', { order: 3 }, false);
  return molecule;
}

/**
 * Creates a methyl-naphthalene fixture.
 * @returns {Molecule} Fused aromatic system with a methyl substituent.
 */
export function makeMethylnaphthalene() {
  const molecule = makeNaphthalene();
  molecule.addAtom('a10', 'C');
  molecule.addBond('b11', 'a0', 'a10', {}, false);
  return molecule;
}

/**
 * Creates a but-2-yne fixture.
 * @returns {Molecule} Four-carbon internal alkyne.
 */
export function makeBut2Yne() {
  const molecule = new Molecule();
  molecule.addAtom('a0', 'C');
  molecule.addAtom('a1', 'C');
  molecule.addAtom('a2', 'C');
  molecule.addAtom('a3', 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a1', 'a2', { order: 3 }, false);
  molecule.addBond('b2', 'a2', 'a3', {}, false);
  return molecule;
}

/**
 * Creates a dimethyl sulfone fixture.
 * @returns {Molecule} Sulfone with two methyl substituents.
 */
export function makeDimethylSulfone() {
  const molecule = new Molecule();
  molecule.addAtom('c0', 'C');
  molecule.addAtom('s0', 'S');
  molecule.addAtom('o0', 'O');
  molecule.addAtom('o1', 'O');
  molecule.addAtom('c1', 'C');
  molecule.addBond('b0', 'c0', 's0', {}, false);
  molecule.addBond('b1', 's0', 'o0', { order: 2 }, false);
  molecule.addBond('b2', 's0', 'o1', { order: 2 }, false);
  molecule.addBond('b3', 's0', 'c1', {}, false);
  return molecule;
}

/**
 * Creates a biphenyl fixture.
 * @returns {Molecule} Two directly linked benzene rings.
 */
export function makeBiphenyl() {
  const molecule = makeBenzene();
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`b${index}`, 'C', { aromatic: true });
  }
  for (let index = 0; index < 6; index++) {
    molecule.addBond(`bb${index}`, `b${index}`, `b${(index + 1) % 6}`, { aromatic: true }, false);
  }
  molecule.addBond('link', 'a0', 'b0', {}, false);
  return molecule;
}

/**
 * Creates a bibenzyl fixture.
 * @returns {Molecule} Two benzene rings linked by an ethyl bridge.
 */
export function makeBibenzyl() {
  const molecule = makeBenzene();
  molecule.addAtom('c0', 'C');
  molecule.addAtom('c1', 'C');
  molecule.addBond('bc0', 'a0', 'c0', {}, false);
  molecule.addBond('bc1', 'c0', 'c1', {}, false);
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`b${index}`, 'C', { aromatic: true });
  }
  for (let index = 0; index < 6; index++) {
    molecule.addBond(`bb${index}`, `b${index}`, `b${(index + 1) % 6}`, { aromatic: true }, false);
  }
  molecule.addBond('link', 'c1', 'b0', {}, false);
  return molecule;
}

/**
 * Creates a naphthalene fixture.
 * @returns {Molecule} Fused aromatic bicyclic system.
 */
export function makeNaphthalene() {
  const molecule = new Molecule();
  for (let index = 0; index < 10; index++) {
    molecule.addAtom(`a${index}`, 'C', { aromatic: true });
  }
  molecule.addBond('b0', 'a0', 'a1', { aromatic: true }, false);
  molecule.addBond('b1', 'a1', 'a2', { aromatic: true }, false);
  molecule.addBond('b2', 'a2', 'a3', { aromatic: true }, false);
  molecule.addBond('b3', 'a3', 'a4', { aromatic: true }, false);
  molecule.addBond('b4', 'a4', 'a5', { aromatic: true }, false);
  molecule.addBond('b5', 'a5', 'a0', { aromatic: true }, false);
  molecule.addBond('b6', 'a4', 'a6', { aromatic: true }, false);
  molecule.addBond('b7', 'a6', 'a7', { aromatic: true }, false);
  molecule.addBond('b8', 'a7', 'a8', { aromatic: true }, false);
  molecule.addBond('b9', 'a8', 'a9', { aromatic: true }, false);
  molecule.addBond('b10', 'a9', 'a5', { aromatic: true }, false);
  return molecule;
}

/**
 * Creates a naphthalene-to-benzene linked fixture.
 * @returns {Molecule} Mixed fused-plus-isolated aromatic system.
 */
export function makeNaphthylbenzene() {
  const molecule = makeNaphthalene();
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`b${index}`, 'C', { aromatic: true });
  }
  for (let index = 0; index < 6; index++) {
    molecule.addBond(`bb${index}`, `b${index}`, `b${(index + 1) % 6}`, { aromatic: true }, false);
  }
  molecule.addBond('link', 'a0', 'b0', {}, false);
  return molecule;
}

/**
 * Creates a large multi-block aromatic fixture with two long alkyl linkers.
 * @returns {Molecule} Three benzene rings linked by two octyl chains.
 */
export function makeLargePolyaryl() {
  const molecule = makeBenzene();
  for (let index = 0; index < 8; index++) {
    molecule.addAtom(`c${index}`, 'C');
  }
  molecule.addBond('bc0', 'a0', 'c0', {}, false);
  for (let index = 0; index < 7; index++) {
    molecule.addBond(`bc${index + 1}`, `c${index}`, `c${index + 1}`, {}, false);
  }
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`b${index}`, 'C', { aromatic: true });
  }
  for (let index = 0; index < 6; index++) {
    molecule.addBond(`bb${index}`, `b${index}`, `b${(index + 1) % 6}`, { aromatic: true }, false);
  }
  molecule.addBond('link0', 'c7', 'b0', {}, false);
  for (let index = 0; index < 8; index++) {
    molecule.addAtom(`d${index}`, 'C');
  }
  molecule.addBond('bd0', 'b3', 'd0', {}, false);
  for (let index = 0; index < 7; index++) {
    molecule.addBond(`bd${index + 1}`, `d${index}`, `d${index + 1}`, {}, false);
  }
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`e${index}`, 'C', { aromatic: true });
  }
  for (let index = 0; index < 6; index++) {
    molecule.addBond(`eb${index}`, `e${index}`, `e${(index + 1) % 6}`, { aromatic: true }, false);
  }
  molecule.addBond('link1', 'd7', 'e0', {}, false);
  return molecule;
}

/**
 * Creates a simple spiro system fixture.
 * @returns {Molecule} Two five-membered rings sharing one atom.
 */
export function makeSpiro() {
  const molecule = new Molecule();
  for (let index = 0; index < 9; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a1', 'a2', {}, false);
  molecule.addBond('b2', 'a2', 'a3', {}, false);
  molecule.addBond('b3', 'a3', 'a4', {}, false);
  molecule.addBond('b4', 'a4', 'a0', {}, false);
  molecule.addBond('b5', 'a4', 'a5', {}, false);
  molecule.addBond('b6', 'a5', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a7', {}, false);
  molecule.addBond('b8', 'a7', 'a8', {}, false);
  molecule.addBond('b9', 'a8', 'a4', {}, false);
  return molecule;
}

/**
 * Creates a norbornane-like bridged fixture.
 * @returns {Molecule} Bridged bicyclic system.
 */
export function makeNorbornane() {
  const molecule = new Molecule();
  for (let index = 0; index < 7; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  molecule.addBond('b0', 'a0', 'a2', {}, false);
  molecule.addBond('b1', 'a2', 'a3', {}, false);
  molecule.addBond('b2', 'a3', 'a1', {}, false);
  molecule.addBond('b3', 'a0', 'a4', {}, false);
  molecule.addBond('b4', 'a4', 'a5', {}, false);
  molecule.addBond('b5', 'a5', 'a1', {}, false);
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a1', {}, false);
  return molecule;
}

/**
 * Creates a bicyclo[2.2.2]-style bridged fixture.
 * @returns {Molecule} Bridged bicyclic cage.
 */
export function makeBicyclo222() {
  const molecule = new Molecule();
  for (let index = 0; index < 8; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  molecule.addBond('b0', 'a0', 'a2', {}, false);
  molecule.addBond('b1', 'a2', 'a3', {}, false);
  molecule.addBond('b2', 'a3', 'a1', {}, false);
  molecule.addBond('b3', 'a0', 'a4', {}, false);
  molecule.addBond('b4', 'a4', 'a5', {}, false);
  molecule.addBond('b5', 'a5', 'a1', {}, false);
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a7', {}, false);
  molecule.addBond('b8', 'a7', 'a1', {}, false);
  return molecule;
}

/**
 * Creates an adamantane cage fixture.
 * @returns {Molecule} Bridged tricyclic adamantane scaffold.
 */
export function makeAdamantane() {
  const molecule = new Molecule();
  for (let index = 0; index < 10; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a0', 'a5', {}, false);
  molecule.addBond('b2', 'a1', 'a2', {}, false);
  molecule.addBond('b3', 'a1', 'a8', {}, false);
  molecule.addBond('b4', 'a2', 'a3', {}, false);
  molecule.addBond('b5', 'a3', 'a4', {}, false);
  molecule.addBond('b6', 'a3', 'a9', {}, false);
  molecule.addBond('b7', 'a4', 'a5', {}, false);
  molecule.addBond('b8', 'a5', 'a6', {}, false);
  molecule.addBond('b9', 'a6', 'a7', {}, false);
  molecule.addBond('b10', 'a7', 'a8', {}, false);
  molecule.addBond('b11', 'a7', 'a9', {}, false);
  return molecule;
}

/**
 * Creates a disconnected salt-pair fixture.
 * @returns {Molecule} Sodium chloride-like disconnected pair.
 */
export function makeSaltPair() {
  const molecule = new Molecule();
  molecule.addAtom('na', 'Na', { charge: 1 });
  molecule.addAtom('cl', 'Cl', { charge: -1 });
  return molecule;
}

/**
 * Creates a minimal organometallic fixture.
 * @returns {Molecule} Small metal-ligand graph.
 */
export function makeOrganometallic() {
  const molecule = new Molecule();
  molecule.addAtom('ru', 'Ru', { charge: 2 });
  molecule.addAtom('n1', 'N');
  molecule.addAtom('c1', 'C');
  molecule.addBond('b0', 'ru', 'n1', { kind: 'coordinate' }, false);
  molecule.addBond('b1', 'n1', 'c1', {}, false);
  return molecule;
}

/**
 * Creates a simple bis-ligated organometallic fixture.
 * @returns {Molecule} Small metal-ligand graph with two coordinate ligands.
 */
export function makeBisLigatedOrganometallic() {
  const molecule = new Molecule();
  molecule.addAtom('ru', 'Ru', { charge: 2 });
  molecule.addAtom('n1', 'N');
  molecule.addAtom('c1', 'C');
  molecule.addAtom('n2', 'N');
  molecule.addAtom('c2', 'C');
  molecule.addBond('b0', 'ru', 'n1', { kind: 'coordinate' }, false);
  molecule.addBond('b1', 'n1', 'c1', {}, false);
  molecule.addBond('b2', 'ru', 'n2', { kind: 'coordinate' }, false);
  molecule.addBond('b3', 'n2', 'c2', {}, false);
  return molecule;
}

/**
 * Creates a simple four-coordinate platinum complex fixture.
 * @returns {Molecule} Pt center with two ammine and two chloride ligands.
 */
export function makeSquarePlanarPlatinumComplex() {
  return parseSMILES('[Pt](Cl)(Cl)(N)N');
}

/**
 * Creates a generic four-coordinate nickel complex fixture.
 * @returns {Molecule} Ni center with two ammine and two chloride ligands.
 */
export function makeFourCoordinateNickelComplex() {
  return parseSMILES('[Ni](Cl)(Cl)(N)N');
}

/**
 * Creates a simple four-coordinate zinc complex fixture.
 * @returns {Molecule} Zn center with two ammine and two chloride ligands.
 */
export function makeProjectedTetrahedralZincComplex() {
  return parseSMILES('[Zn](Cl)(Cl)(N)N');
}

/**
 * Creates a simple six-coordinate cobalt complex fixture.
 * @returns {Molecule} Co center with six monodentate ammine ligands.
 */
export function makeProjectedOctahedralCobaltComplex() {
  return parseSMILES('[Co+3](N)(N)(N)(N)(N)N');
}

/**
 * Creates a small explicit-hydrogen fixture for atom-model tests.
 * @returns {Molecule} Carbon with oxygen and explicit hydrogen.
 */
export function makeHydrogenatedCarbon() {
  const molecule = new Molecule();
  molecule.addAtom('c0', 'C', { charge: -1, radical: 1, reaction: { atomMap: 7 } });
  molecule.addAtom('o0', 'O');
  molecule.addAtom('h0', 'H');
  molecule.addBond('b0', 'c0', 'o0', {}, false);
  molecule.addBond('b1', 'c0', 'h0', {}, false);
  return molecule;
}

/**
 * Creates a hand-built bridged ring-connection fixture plus explicit ring list.
 * @returns {{molecule: Molecule, rings: {id: number, atomIds: string[]}[]}} Bridged connection fixture.
 */
export function makeBridgedConnectionFixture() {
  const molecule = makeUnmatchedBridgedCage();
  return {
    molecule,
    rings: [
      { id: 0, atomIds: ['a0', 'a2', 'a1', 'a3'] },
      { id: 1, atomIds: ['a0', 'a4', 'a1', 'a5'] }
    ]
  };
}

/**
 * Creates a small bridged cage that is intentionally not in the template set.
 * @returns {Molecule} Unmatched bridged cage.
 */
export function makeUnmatchedBridgedCage() {
  const molecule = new Molecule();
  for (let index = 0; index < 6; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  molecule.addBond('b0', 'a0', 'a2', {}, false);
  molecule.addBond('b1', 'a2', 'a1', {}, false);
  molecule.addBond('b2', 'a1', 'a3', {}, false);
  molecule.addBond('b3', 'a3', 'a0', {}, false);
  molecule.addBond('b4', 'a0', 'a4', {}, false);
  molecule.addBond('b5', 'a4', 'a1', {}, false);
  molecule.addBond('b6', 'a1', 'a5', {}, false);
  molecule.addBond('b7', 'a5', 'a0', {}, false);
  return molecule;
}

/**
 * Creates a small tetrahedral stereocenter with one hidden hydrogen.
 * @returns {Molecule} Chiral tetrahedral test fixture.
 */
export function makeHiddenHydrogenStereocenter() {
  const molecule = new Molecule();
  molecule.addAtom('c0', 'C', { chirality: 'R' });
  molecule.addAtom('f0', 'F');
  molecule.addAtom('cl0', 'Cl');
  molecule.addAtom('br0', 'Br');
  molecule.addAtom('h0', 'H');
  molecule.atoms.get('h0').visible = false;
  molecule.addBond('b0', 'c0', 'f0', {}, false);
  molecule.addBond('b1', 'c0', 'cl0', {}, false);
  molecule.addBond('b2', 'c0', 'br0', {}, false);
  molecule.addBond('b3', 'c0', 'h0', {}, false);
  return molecule;
}

/**
 * Creates an alkene with explicit E stereochemistry.
 * @returns {Molecule} E-alkene fixture.
 */
export function makeEAlkene() {
  return parseSMILES('F/C=C/F');
}

/**
 * Creates the large explicit-hydrogen peptide-like fixture from the bug corpus.
 * @returns {Molecule} Large mixed peptide-like component with many visible participants.
 */
export function makeLargeExplicitHydrogenPeptide() {
  return parseSMILES(
    'CC\\C=C\\CC(=O)N[C@@H](CC1=CC=C(O)C=C1)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(O)=O)C(=O)N[C@@H](C)C(=O)N[C@@H](C(C)CC)C(=O)N[C@@H](CC1=CC=CC=C1)C(=O)N[C@@H](C(C)O)C(=O)N[C@@H](CC(N)=O)C(=O)N[C@@H](CO)C(=O)N[C@@H](CC1=CC=C(O)C=C1)C(=O)N[C@@H](CCCNC(N)=N)C(=O)N[C@@H](CCCCN)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](CC(C)C)C(=O)NCC(=O)N[C@@H](CCC(N)=O)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CO)C(=O)N[C@@H](C)C(=O)N[C@@H](CCCNC(N)=N)C(=O)N[C@@H](CCCCN)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CCC(N)=O)C(=O)N[C@@H](CC(O)=O)C(=O)N[C@@H](C(C)CC)C(=O)N[C@@H](CCSC)C(=O)N[C@@H](CO)C(=O)N[C@@H](CCCNC(N)=N)C(=O)N[C@@H](CCC(N)=O)C(=O)N[C@@H](CCC(N)=O)C(=O)NCC(=O)N[C@@H](CCC(N)=O)C(=O)N[C@@H](CO)C(=O)N[C@@H](CC(N)=O)C(=O)N[C@@H](CCC(N)=O)C(=O)N[C@@H](CCCNC(N)=N)C(=O)NCC(=O)N[C@@H](C)C(=O)N[C@@H](CCCNC(N)=N)C(=O)N[C@@H](C)C(=O)N[C@@H](CCCNC(N)=N)C(=O)N[C@@H](CC(C)C)C(N)=O'
  );
}
