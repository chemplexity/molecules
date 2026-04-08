import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES, toSMILES } from '../../src/io/index.js';
import { perceiveAromaticity, refreshAromaticity } from '../../src/algorithms/aromaticity.js';
import { kekulize } from '../../src/layout/mol2d-helpers.js';
import { matchesSMARTS } from '../../src/smarts/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse SMILES and run perceiveAromaticity.
 * @param {string} smiles - The SMILES string.
 * @returns {object} The molecule with aromaticity perceived.
 */
function parse(smiles) {
  const mol = parseSMILES(smiles);
  perceiveAromaticity(mol);
  return mol;
}

// ---------------------------------------------------------------------------
// Benzene — canonical SMILES-aromatic input
// ---------------------------------------------------------------------------

describe('perceiveAromaticity — benzene (SMILES aromatic)', () => {
  it('returns one aromatic ring of 6 atoms', () => {
    const mol = parseSMILES('c1ccccc1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 1);
    assert.equal(rings[0].length, 6);
  });

  it('all 6 carbons are marked aromatic', () => {
    const mol = parseSMILES('c1ccccc1');
    perceiveAromaticity(mol);
    for (const atom of mol.atoms.values()) {
      if (atom.name === 'C' || atom.name === 'c') {
        assert.equal(atom.properties.aromatic, true);
      }
    }
  });

  it('all 6 ring bonds are marked aromatic', () => {
    const mol = parseSMILES('c1ccccc1');
    perceiveAromaticity(mol);
    for (const bond of mol.bonds.values()) {
      const [a1, a2] = bond.atoms.map(id => mol.atoms.get(id));
      if (a1 && a2 && a1.name !== 'H' && a2.name !== 'H') {
        assert.equal(bond.properties.aromatic, true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Kekulé benzene (explicit alternating double bonds)
// ---------------------------------------------------------------------------

describe('perceiveAromaticity — Kekulé benzene', () => {
  it('perceives benzene from Kekulé SMILES C1=CC=CC=C1', () => {
    const mol = parseSMILES('C1=CC=CC=C1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 1);
    assert.equal(rings[0].length, 6);
  });

  it('all 6 ring carbons are marked aromatic after Kekulé perception', () => {
    const mol = parseSMILES('C1=CC=CC=C1');
    perceiveAromaticity(mol);
    const ringC = [...mol.atoms.values()].filter(a => a.name === 'C');
    assert.equal(ringC.length, 6);
    for (const atom of ringC) {
      assert.equal(atom.properties.aromatic, true, `${atom.id} not aromatic`);
    }
  });
});

// ---------------------------------------------------------------------------
// Non-aromatic rings
// ---------------------------------------------------------------------------

describe('perceiveAromaticity — non-aromatic rings', () => {
  it('cyclohexane (no pi bonds) → 0 aromatic rings', () => {
    const mol = parseSMILES('C1CCCCC1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 0);
  });

  it('cyclohexane ring atoms are NOT marked aromatic', () => {
    const mol = parseSMILES('C1CCCCC1');
    perceiveAromaticity(mol);
    for (const atom of mol.atoms.values()) {
      assert.equal(atom.properties.aromatic ?? false, false);
    }
  });

  it('cyclopentadiene (4 pi electrons, antiaromatic) → 0 aromatic rings', () => {
    // C1=CC=CC1 — 4 π electrons (4n, n=1), antiaromatic
    const mol = parseSMILES('C1=CC=CC1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Heteroaromatic rings
// ---------------------------------------------------------------------------

describe('perceiveAromaticity — heteroaromatics', () => {
  it('pyridine c1ccncc1 → 1 aromatic ring', () => {
    const mol = parseSMILES('c1ccncc1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 1);
  });

  it('pyrrole c1cc[nH]c1 → 1 aromatic ring', () => {
    const mol = parseSMILES('c1cc[nH]c1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 1);
  });

  it('furan c1ccoc1 → 1 aromatic ring', () => {
    const mol = parseSMILES('c1ccoc1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 1);
  });

  it('thiophene c1ccsc1 → 1 aromatic ring', () => {
    const mol = parseSMILES('c1ccsc1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Fused rings
// ---------------------------------------------------------------------------

describe('perceiveAromaticity — fused rings (naphthalene)', () => {
  it('naphthalene c1ccc2ccccc2c1 → 2 aromatic rings', () => {
    const mol = parseSMILES('c1ccc2ccccc2c1');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 2);
  });

  it('all 10 ring carbons are marked aromatic', () => {
    const mol = parseSMILES('c1ccc2ccccc2c1');
    perceiveAromaticity(mol);
    const heavy = [...mol.atoms.values()].filter(a => a.name !== 'H');
    assert.equal(heavy.length, 10);
    for (const atom of heavy) {
      assert.equal(atom.properties.aromatic, true, `${atom.id} not aromatic`);
    }
  });
});

// ---------------------------------------------------------------------------
// SMARTS matching after perceiveAromaticity
// ---------------------------------------------------------------------------

describe('perceiveAromaticity — SMARTS matching after perception', () => {
  it('Kekulé benzene matches c1ccccc1 after perceiveAromaticity', () => {
    const mol = parse('C1=CC=CC=C1');
    assert.equal(matchesSMARTS(mol, 'c1ccccc1'), true);
  });

  it('cyclohexane does NOT match c1ccccc1 even after perceiveAromaticity', () => {
    const mol = parse('C1CCCCC1');
    assert.equal(matchesSMARTS(mol, 'c1ccccc1'), false);
  });

  it('pyridine matches [a]1[a][a][a][a][a]1', () => {
    const mol = parse('c1ccncc1');
    assert.equal(matchesSMARTS(mol, '[a]1[a][a][a][a][a]1'), true);
  });

  it('furan matches [a]1[a][a][a][a]1 (5-membered aromatic)', () => {
    const mol = parse('c1ccoc1');
    assert.equal(matchesSMARTS(mol, '[a]1[a][a][a][a]1'), true);
  });
});

describe('refreshAromaticity — graph edits', () => {
  it('dearomatizes a broken benzene fragment before hydrogen repair', () => {
    const mol = parseSMILES('c1ccccc1');
    kekulize(mol);

    const deletedCarbon = [...mol.atoms.values()].find(atom => atom.name === 'C');
    assert.ok(deletedCarbon);

    const deletedHydrogenIds = deletedCarbon
      .getNeighbors(mol)
      .filter(atom => atom.name === 'H')
      .map(atom => atom.id);
    const affectedHeavyIds = new Set(
      deletedCarbon
        .getNeighbors(mol)
        .filter(atom => atom.name !== 'H')
        .map(atom => atom.id)
    );

    mol.removeAtom(deletedCarbon.id);
    for (const hId of deletedHydrogenIds) {
      mol.removeAtom(hId);
    }

    refreshAromaticity(mol, { preserveKekule: true });
    mol.repairImplicitHydrogens(affectedHeavyIds);

    assert.equal(toSMILES(mol), 'C=CC=CC');
    assert.deepEqual(mol.getFormula(), { C: 5, H: 8 });
    assert.equal([...mol.atoms.values()].filter(atom => atom.properties.aromatic).length, 0);
    assert.equal([...mol.bonds.values()].filter(bond => bond.properties.aromatic).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Hypoxanthine — 6-membered ring should NOT be aromatic
// ---------------------------------------------------------------------------

describe('perceiveAromaticity — hypoxanthine fused ring SMILES', () => {
  it('detects only the 5-membered imidazole ring as aromatic', () => {
    const mol = parseSMILES('O=c1nc[nH]c2[nH]cnc12');
    const rings = perceiveAromaticity(mol);
    assert.equal(rings.length, 1, 'expected exactly 1 aromatic ring');
    assert.equal(rings[0].length, 5, 'the aromatic ring should be 5-membered');
  });

  it('6-membered ring atoms (not shared with 5-membered ring) are NOT aromatic', () => {
    const mol = parseSMILES('O=c1nc[nH]c2[nH]cnc12');
    perceiveAromaticity(mol);
    // The carbonyl carbon and its direct neighbours are exclusively in the
    // 6-membered ring and must NOT be marked aromatic after perception.
    // atoms that neighbour the exocyclic oxygen are exclusively 6-membered ring atoms
    const oAtom = [...mol.atoms.values()].find(a => a.name === 'O');
    const carbonylC = oAtom ? mol.atoms.get(mol.bonds.get([...oAtom.bonds][0]).getOtherAtom(oAtom.id)) : null;
    assert.ok(carbonylC, 'carbonyl carbon should exist');
    assert.equal(carbonylC.properties.aromatic ?? false, false, 'carbonyl C must not be aromatic');
  });

  it('bonds exclusive to the 6-membered ring are NOT marked aromatic', () => {
    const mol = parseSMILES('O=c1nc[nH]c2[nH]cnc12');
    perceiveAromaticity(mol);
    const oAtom = [...mol.atoms.values()].find(a => a.name === 'O');
    const carbonylCId = mol.bonds.get([...oAtom.bonds][0]).getOtherAtom(oAtom.id);
    // All bonds incident to the carbonyl carbon (excluding the C=O bond itself)
    // that go to another ring atom should NOT be aromatic.
    for (const bId of mol.atoms.get(carbonylCId).bonds) {
      const bond = mol.bonds.get(bId);
      const otherId = bond.getOtherAtom(carbonylCId);
      if (mol.atoms.get(otherId)?.name !== 'O') {
        assert.equal(bond.properties.aromatic ?? false, false, `bond ${bId} should not be aromatic`);
      }
    }
  });
});
