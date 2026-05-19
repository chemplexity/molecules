import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { analyzeRings, detectRingSystems, findSharedAtoms, getRingAtomIds } from '../../../../src/layout/engine/topology/ring-analysis.js';
import { computeCanonicalAtomRanks } from '../../../../src/layout/engine/topology/canonical-order.js';
import { makeNaphthalene } from '../support/molecules.js';

const GLYCOPEPTIDE_MACROCYCLE_SMILES =
  'C[NH2+][C@@H](CC(C)C)C(=O)N[C@@H]1[C@H](O)C2=CC=C(OC3=CC4=CC(OC5=CC=C(C=C5Cl)[C@@H](O[C@H]5C[C@@](C)([NH3+])[C@H](O)[C@@H](C)O5)[C@H]5NC(=O)[C@H](NC(=O)[C@H]4NC(=O)[C@@H](CC(N)=O)NC1=O)C1=CC=C(O)C(=C1)C1=C(O)C=C(O)C=C1[C@@H](NC5=O)C(O)=O)=C3O[C@H]1O[C@@H](CO)[C@H](O)[C@@H](O)[C@@H]1O[C@@H]1C[C@](C)([NH3+])[C@@H](O)[C@H](C)O1)C(Cl)=C2';

function ringIncludesAdjacentBond(ring, firstAtomId, secondAtomId) {
  const firstIndex = ring.atomIds.indexOf(firstAtomId);
  if (firstIndex === -1) {
    return false;
  }
  return ring.atomIds[(firstIndex + 1) % ring.atomIds.length] === secondAtomId || ring.atomIds[(firstIndex - 1 + ring.atomIds.length) % ring.atomIds.length] === secondAtomId;
}

describe('layout/engine/topology/ring-analysis', () => {
  it('finds shared atoms between ring atom lists', () => {
    assert.deepEqual(findSharedAtoms(['a0', 'a1', 'a2'], ['a3', 'a1', 'a2']), ['a1', 'a2']);
  });

  it('groups related rings into ring systems by shared atoms', () => {
    const systems = detectRingSystems([
      ['a0', 'a1', 'a2'],
      ['a2', 'a3', 'a4'],
      ['b0', 'b1', 'b2']
    ]);
    assert.equal(systems.length, 2);
    assert.deepEqual(systems[0].ringIds, [0, 1]);
    assert.deepEqual(systems[1].ringIds, [2]);
  });

  it('adapts molecule rings into deterministic ring and ring-system descriptors', () => {
    const molecule = makeNaphthalene();
    const analysis = analyzeRings(molecule, computeCanonicalAtomRanks(molecule));
    assert.equal(analysis.rings.length, 2);
    assert.equal(analysis.ringSystems.length, 1);
    assert.equal(analysis.rings[0].size, 6);
    assert.equal(analysis.rings[0].aromatic, true);
    assert.deepEqual(analysis.ringSystems[0].ringIds, [0, 1]);
    assert.equal(typeof analysis.rings[0].signature, 'string');
  });

  it('supplements ring descriptors for ring bonds omitted by basis perception', () => {
    const molecule = parseSMILES(GLYCOPEPTIDE_MACROCYCLE_SMILES);
    const analysis = analyzeRings(molecule, computeCanonicalAtomRanks(molecule));
    const supplementalClosureRing = analysis.rings.find(ring => ring.supplemental === true && ring.size === 16 && ringIncludesAdjacentBond(ring, 'C36', 'C53'));

    assert.ok(supplementalClosureRing, 'expected a supplemental macrocycle through C36-C53');
    assert.ok(
      analysis.ringSystems.some(ringSystem => ringSystem.ringIds.includes(supplementalClosureRing.id)),
      'expected the supplemental closure to participate in ring-system analysis'
    );
  });

  it('keeps raw ring access behind the adapter helper', () => {
    const molecule = makeNaphthalene();
    const rings = getRingAtomIds(molecule);

    assert.equal(rings.length, 2);
    assert.equal(Array.isArray(rings[0]), true);
  });
});
