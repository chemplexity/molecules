// Diagnostic snapshots for core-structures-review.md at b7ad456.
// Run: node docs/reviews/core-structures-repros.mjs
// Assertions document current defects; convert them to desired-behavior tests
// when implementing fixes. Only in-memory diagnostic molecules are mutated.
import assert from 'node:assert/strict';
import { Atom } from '../../src/core/Atom.js';
import { Molecule, assignCIPRanks } from '../../src/core/Molecule.js';
import { parseSMILES } from '../../src/io/smiles.js';
import { toJSON, fromJSON } from '../../src/io/json.js';
import { generateResonanceStructures } from '../../src/algorithms/resonance.js';
import { createMoleculeFragment, instantiateMoleculeFragment } from '../../src/core/support/molecule-fragment.js';

function record(id, observed) {
  console.log(JSON.stringify({ id, observed }));
}
function graph(edges) {
  const m = new Molecule();
  for (const id of new Set(edges.flat())) m.addAtom(id, 'C', {}, { recompute: false });
  edges.forEach(([a, b], i) => m.addBond(`b${i}`, a, b, {}, false));
  return m;
}

const edges = [
  [1, 0],
  [3, 1],
  [4, 1],
  [5, 0],
  [6, 1],
  [7, 5],
  [4, 3],
  [6, 0],
  [7, 0],
  [7, 3],
  [7, 4]
].map(pair => pair.map(String));
const cage = graph(edges);
assert.equal(cage.atomCount, 7);
assert.equal(cage.bondCount, 11);
assert.ok([...cage.atoms.values()].every(a => a.getDegree() <= 4));
assert.equal(cage.getComponents().length, 1);
assert.equal(cage.getRings().length, 4);
record('C1-incomplete-cycle-basis', { atoms: 7, bonds: 11, expectedRank: 5, actualRings: cage.getRings(), edges });

const ring = graph([
  ['a0', 'a1'],
  ['a1', 'a2'],
  ['a2', 'a0']
]);
ring.getRings();
assert.equal(ring.bonds.get('b0').isInRing(ring), true);
ring.setRingFill(['a0', 'a1', 'a2'], { color: '#f00' });
const version = ring._topologyVersion;
ring.resetIds();
assert.equal(ring._topologyVersion, version);
assert.equal(ring.bonds.get('0').isInRing(ring), false);
assert.ok(
  ring
    .getRings()
    .flat()
    .every(id => !ring.atoms.has(id))
);
record('C2-reset-stale-caches', { atomIds: [...ring.atoms.keys()], cachedRings: ring.getRings(), firstBondInRing: ring.bonds.get('0').isInRing(ring), ringFills: ring.getRingFills() });
ring.getRings().length = 0;
assert.equal(ring.getRings().length, 0);
record('C2-mutable-ring-cache', { ringsAfterMutatingGetterResult: ring.getRings() });

const update = graph([['a', 'b']]);
const updatedBond = update.bonds.get('b0');
updatedBond.setAromatic(true);
assert.throws(() => updatedBond.setOrder(-1), RangeError);
update.updateBond('b0', { order: -1 });
assert.equal(updatedBond.getOrder(), -1);
assert.equal(updatedBond.properties.aromatic, true);
assert.throws(() => update.updateBond('b0', { kind: 'ionic', stereo: 'bad' }), RangeError);
assert.equal(updatedBond.getKind(), 'ionic');
record('C3-update-validation-and-atomicity', updatedBond.properties);
const invalidAtom = update.atoms.get('a');
invalidAtom.setCharge(NaN);
assert.ok(Number.isNaN(invalidAtom.getCharge()));
record('C3-charge-validation', { acceptsNaN: Number.isNaN(invalidAtom.getCharge()) });

const stale = parseSMILES('CC');
stale.atoms.get('C1').setCharge(1);
assert.equal(stale.getCharge(), 1);
assert.equal(stale.properties.charge, 0);
stale.assignHybridizations();
stale.updateBond('0', { order: 3 });
assert.equal(stale.atoms.get('C1').getHybridization(), 'sp3');
record('C4-stale-derived-state', {
  liveCharge: stale.getCharge(),
  storedCharge: stale.properties.charge,
  bondOrder: stale.bonds.get('0').getOrder(),
  storedHybridization: stale.atoms.get('C1').getHybridization()
});

const res = parseSMILES('[O-]C=O');
generateResonanceStructures(res);
res.setResonanceState(2);
const oxygens = [...res.atoms.values()].filter(a => a.name === 'O');
assert.ok(oxygens.some(a => a.properties.electrons !== a.properties.protons - a.getCharge()));
record(
  'C4-resonance-electron-drift',
  oxygens.map(a => ({ id: a.id, charge: a.getCharge(), storedElectrons: a.properties.electrons, electronsFromCharge: a.properties.protons - a.getCharge() }))
);
res.updateBond('1', { order: 3 });
assert.equal(res.resonanceCount, 2);
res.setResonanceState(1);
assert.equal(res.bonds.get('1').getOrder(), 1);
record('C4-resonance-overwrites-edit', { editedOrder: 3, orderAfterSelectingStoredState: res.bonds.get('1').getOrder() });
res.setResonanceState(NaN);
assert.ok(Number.isNaN(res.properties.resonance.currentState));
record('C3-resonance-index-validation', { acceptsNaNStateIndex: true });

const left = parseSMILES('CC');
const right = parseSMILES('CC');
right.bonds.get('0').properties.display = { as: 'wedge', centerId: 'C1', manual: true };
const merged = left.merge(right);
const displayBond = [...merged.bonds.values()].find(b => b.properties.display);
assert.deepEqual(displayBond.atoms, ['C3', 'C4']);
assert.equal(displayBond.properties.display.centerId, 'C1');
assert.equal(displayBond.atoms.includes(displayBond.properties.display.centerId), false);
record('C5-merge-reference-remapping', { endpoints: displayBond.atoms, display: displayBond.properties.display });

const pair = graph([['a', 'b,c']]);
pair.addAtom('a,b', 'C');
pair.addAtom('c', 'C');
assert.equal(pair.getBond('a,b', 'c'), pair.bonds.get('b0'));
assert.throws(() => pair.addBond('other', 'a,b', 'c', {}, false), /already exists/);
record('C5-pair-key-collision', { queried: ['a,b', 'c'], returnedEndpoints: pair.getBond('a,b', 'c').atoms });

const copySource = parseSMILES('CC');
copySource.tags.push({ nested: { value: 1 } });
copySource.clone().tags[0].nested.value = 2;
assert.equal(copySource.tags[0].nested.value, 2);
record('C6-clone-tag-alias', { sourceTagAfterEditingClone: copySource.tags[0] });
const sourceAtom = copySource.atoms.get('C1');
sourceAtom.setHybridization('sp2');
sourceAtom.properties.custom = { value: 7 };
const fragment = createMoleculeFragment(copySource);
assert.deepEqual(fragment.atoms.find(a => a.id === 'C1').properties.custom, { value: 7 });
const pasted = instantiateMoleculeFragment(fragment);
const pastedAtom = pasted.mol.atoms.get(pasted.atomIdMap.get('C1'));
assert.equal(pastedAtom.getHybridization(), null);
assert.equal(pastedAtom.properties.custom, undefined);
record('C6-fragment-property-loss', { sourceHybridization: 'sp2', pastedHybridization: pastedAtom.getHybridization(), customPropertySurvived: Object.hasOwn(pastedAtom.properties, 'custom') });

const jsonSource = parseSMILES('C');
jsonSource.atoms.get('C1').setCharge(1);
const jsonResult = fromJSON(toJSON(jsonSource));
assert.equal(jsonResult.getCharge(), 1);
assert.equal(jsonResult.properties.charge, 0);
record('C6-serialized-stale-aggregates', { liveCharge: jsonResult.getCharge(), storedCharge: jsonResult.properties.charge });

const boron = new Molecule();
boron.addAtom('B', 'B');
boron.addAtom('C', 'C');
boron.addBond('b', 'B', 'C');
const b = boron.atoms.get('B');
assert.equal(b.getValence(boron), 3);
assert.equal(b.getHydrogenNeighbors(boron).length, 2);
assert.equal(b.implicitHydrogenCount(boron), 2);
assert.equal(b.isSaturated(boron), false);
record('C7-inconsistent-hydrogen-policy', {
  valenceAfterAutomaticHydrogens: b.getValence(boron),
  attachedHydrogens: b.getHydrogenNeighbors(boron).length,
  additionalHydrogensReported: b.implicitHydrogenCount(boron),
  saturated: b.isSaturated(boron)
});
const oxygen = new Atom('O', 'O', { charge: -1 }).resolveElement();
assert.equal(oxygen.properties.electrons, 8);
record('C7-resolve-element-overwrites-electrons', { charge: oxygen.getCharge(), protons: oxygen.properties.protons, electrons: oxygen.properties.electrons });
const isotopic = parseSMILES('[C@]([H])([2H])(F)Cl');
const center = isotopic.atoms.get('C1');
const ranks = assignCIPRanks(
  center.id,
  center.getNeighbors(isotopic).map(a => a.id),
  isotopic
);
assert.equal(new Set(ranks).size, 4);
assert.equal(center.getChirality(), 'S');
assert.equal(center.isChiralCenter(isotopic), false);
record('C7-stereo-implementation-disagreement', { assignedChirality: center.getChirality(), distinctRanks: ranks, graphBasedEligibility: center.isChiralCenter(isotopic) });

const unplaced = new Molecule();
const placed = unplaced.addAtom('placed', 'C');
unplaced.addAtom('unplaced', 'C');
placed.x = 10;
placed.y = 10;
const positionFragment = createMoleculeFragment(unplaced);
assert.deepEqual(positionFragment.center, { x: 5, y: 5, z: 0 });
record('C8-null-coordinate-coercion', { actualCenter: positionFragment.center, onlyPlacedAtom: { x: 10, y: 10 } });

const long = new Molecule();
for (let i = 0; i < 8000; i++) long.addAtom(String(i), 'C', {}, { recompute: false });
for (let i = 1; i < 8000; i++) long.addBond(String(i), String(i - 1), String(i), {}, false);
let ringError = null;
try {
  long.bonds.get('1').isInRing(long);
} catch (error) {
  ringError = `${error.name}: ${error.message}`;
}
// Stack limits differ by runtime; record rather than require this failure.
record('C9-recursive-traversal-limit', { atoms: long.atomCount, error: ringError });

assert.throws(() => new Molecule().matchesSMARTS('C'), /_smartsMatches is not a function/);
record('C10-core-only-smarts', { error: '_smartsMatches is not a function' });
