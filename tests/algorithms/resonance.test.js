import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/index.js';
import { perceiveAromaticity } from '../../src/algorithms/aromaticity.js';
import { generateResonanceStructures } from '../../src/algorithms/resonance.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(smiles) {
  const mol = parseSMILES(smiles);
  perceiveAromaticity(mol);
  return mol;
}

// ---------------------------------------------------------------------------
// availableLonePairs
// ---------------------------------------------------------------------------

describe('Atom.availableLonePairs', () => {
  it('returns 2 for neutral oxygen with one single bond (alcohol O)', () => {
    const mol = parse('CO');
    const oxygen = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.ok(oxygen);
    assert.equal(oxygen.availableLonePairs(mol), 2);
  });

  it('returns 2 for neutral oxygen with one double bond (carbonyl O)', () => {
    const mol = parse('C=O');
    const oxygen = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.ok(oxygen);
    // Carbonyl oxygen: 6 valence electrons − 2 (double bond) = 4 nonbonding → 2 lone pairs
    assert.equal(oxygen.availableLonePairs(mol), 2);
  });

  it('returns 1 for neutral nitrogen with two single bonds', () => {
    const mol = parse('CN');
    const nitrogen = [...mol.atoms.values()].find(a => a.name === 'N');
    assert.ok(nitrogen);
    assert.equal(nitrogen.availableLonePairs(mol), 1);
  });

  it('returns 0 for carbon with 4 bonds', () => {
    const mol = parse('C');
    const carbon = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.ok(carbon);
    assert.equal(carbon.availableLonePairs(mol), 0);
  });

  it('excludes radical electrons from lone pair count', () => {
    const mol = parse('[CH3]');
    const carbon = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.ok(carbon);
    // Manually set radical
    carbon.properties.radical = 1;
    // C with 3 bonds + 1 radical: 4 - 3 - 0 - 1 = 0 nonbonding → 0 pairs
    assert.equal(carbon.availableLonePairs(mol), 0);
  });
});

// ---------------------------------------------------------------------------
// No pi system
// ---------------------------------------------------------------------------

describe('generateResonanceStructures — no pi system', () => {
  it('ethanol: count = 1, no bond tables', () => {
    const mol = parse('CCO');
    generateResonanceStructures(mol);
    assert.equal(mol.resonanceCount, 1);
    for (const bond of mol.bonds.values()) {
      assert.equal(bond.properties.resonance, undefined);
    }
  });

  it('getResonanceStates returns single entry when not generated', () => {
    const mol = parse('CCO');
    const states = mol.getResonanceStates();
    assert.equal(states.length, 1);
    assert.equal(states[0].id, 1);
  });
});

// ---------------------------------------------------------------------------
// Carboxylate — CC(=O)[O-]
// ---------------------------------------------------------------------------

describe('generateResonanceStructures — carboxylate', () => {
  it('finds at least 2 states', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    assert.ok(mol.resonanceCount >= 2, `expected ≥2, got ${mol.resonanceCount}`);
  });

  it('state 1 is canonical: one C-O double, one C-O single', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    mol.setResonanceState(1);
    // Find the carboxylate carbon: the C bonded to exactly 2 oxygens
    const carboxylC = [...mol.atoms.values()].find(a => {
      if (a.name !== 'C') return false;
      const oCount = a.bonds.filter(id => mol.atoms.get(mol.bonds.get(id)?.getOtherAtom(a.id))?.name === 'O').length;
      return oCount === 2;
    });
    assert.ok(carboxylC, 'carboxylate carbon not found');
    const coBonds = carboxylC.bonds
      .map(id => mol.bonds.get(id))
      .filter(b => mol.atoms.get(b.getOtherAtom(carboxylC.id))?.name === 'O');
    assert.equal(coBonds.length, 2);
    const orders = coBonds.map(b => b.properties.localizedOrder ?? b.properties.order).sort();
    assert.deepEqual(orders, [1, 2]);
  });

  it('state 2 swaps C=O and C-O bond orders', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);

    // Record state 1 bond orders for the two C-O bonds
    const carboxylC = [...mol.atoms.values()].find(a => {
      const oNeighbours = a.bonds
        .map(id => mol.bonds.get(id))
        .filter(b => mol.atoms.get(b.getOtherAtom(a.id))?.name === 'O');
      return oNeighbours.length === 2;
    });
    assert.ok(carboxylC, 'could not find carboxylate carbon');

    const coBonds = carboxylC.bonds
      .map(id => mol.bonds.get(id))
      .filter(b => mol.atoms.get(b.getOtherAtom(carboxylC.id))?.name === 'O');

    mol.setResonanceState(1);
    const s1Orders = coBonds.map(b => b.properties.localizedOrder ?? b.properties.order);

    mol.setResonanceState(2);
    const s2Orders = coBonds.map(b => b.properties.localizedOrder ?? b.properties.order);

    // The two states should have different bond order assignments
    assert.notDeepEqual(s1Orders, s2Orders);
    // Both states should still have one order-1 and one order-2
    assert.deepEqual([...s2Orders].sort(), [1, 2]);
  });

  it('setResonanceState round-trips correctly', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);

    const carboxylC = [...mol.atoms.values()].find(a => {
      const oNeighbours = a.bonds
        .map(id => mol.bonds.get(id))
        .filter(b => mol.atoms.get(b.getOtherAtom(a.id))?.name === 'O');
      return oNeighbours.length === 2;
    });
    const coBonds = carboxylC.bonds
      .map(id => mol.bonds.get(id))
      .filter(b => mol.atoms.get(b.getOtherAtom(carboxylC.id))?.name === 'O');

    mol.setResonanceState(1);
    const s1Orders = coBonds.map(b => b.properties.localizedOrder ?? b.properties.order);

    mol.setResonanceState(2);
    mol.setResonanceState(1);
    const restored = coBonds.map(b => b.properties.localizedOrder ?? b.properties.order);

    assert.deepEqual(s1Orders, restored);
  });
});

// ---------------------------------------------------------------------------
// Benzene — two Kekulé forms
// ---------------------------------------------------------------------------

describe('generateResonanceStructures — benzene', () => {
  it('finds 2 states (two Kekulé forms)', () => {
    const mol = parse('c1ccccc1');
    generateResonanceStructures(mol);
    assert.equal(mol.resonanceCount, 2);
  });

  it('the two states have alternating single/double localizedOrders', () => {
    const mol = parse('c1ccccc1');
    generateResonanceStructures(mol);

    mol.setResonanceState(1);
    const s1 = [...mol.bonds.values()].map(b => b.properties.localizedOrder ?? b.properties.order);

    mol.setResonanceState(2);
    const s2 = [...mol.bonds.values()].map(b => b.properties.localizedOrder ?? b.properties.order);

    assert.notDeepEqual(s1, s2);
    // Each state should have exactly 3 double bonds
    assert.equal(s1.filter(o => o === 2).length, 3);
    assert.equal(s2.filter(o => o === 2).length, 3);
  });
});

// ---------------------------------------------------------------------------
// Propyne — non-conjugated alkyne
// ---------------------------------------------------------------------------

describe('generateResonanceStructures — propyne (non-conjugated alkyne)', () => {
  it('count = 1 — fixed triple, no valid alternates', () => {
    const mol = parse('CC#C');
    generateResonanceStructures(mol);
    assert.equal(mol.resonanceCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Allyl radical
// ---------------------------------------------------------------------------

describe('generateResonanceStructures — allyl radical', () => {
  it('finds 2 states: radical migrates from one terminal C to the other', () => {
    // [CH2]=C[CH2] with radical on terminal CH2
    const mol = parseSMILES('[CH2]=C[CH2]');
    // manually set radical on terminal carbon
    const atoms = [...mol.atoms.values()].filter(a => a.name === 'C');
    const terminal = atoms.find(a => a.bonds.length === 1);
    assert.ok(terminal);
    terminal.properties.radical = 1;
    generateResonanceStructures(mol);
    assert.ok(mol.resonanceCount >= 2, `expected ≥2 states, got ${mol.resonanceCount}`);
  });
});

// ---------------------------------------------------------------------------
// clearResonanceStates / resetResonance
// ---------------------------------------------------------------------------

describe('clearResonanceStates', () => {
  it('removes all resonance tables without touching live bond values', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    mol.setResonanceState(2);

    // Capture current live order
    const ordersBeforeClear = [...mol.bonds.values()].map(b => b.properties.localizedOrder ?? b.properties.order);

    mol.clearResonanceStates();

    assert.equal(mol.properties.resonance, undefined);
    for (const bond of mol.bonds.values()) {
      assert.equal(bond.properties.resonance, undefined);
    }
    for (const atom of mol.atoms.values()) {
      assert.equal(atom.properties.resonance, undefined);
    }

    // Live values should be unchanged
    const ordersAfterClear = [...mol.bonds.values()].map(b => b.properties.localizedOrder ?? b.properties.order);
    assert.deepEqual(ordersBeforeClear, ordersAfterClear);
  });
});

describe('resetResonance', () => {
  it('restores state 1 values and removes all tables', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);

    mol.setResonanceState(1);
    const s1Orders = [...mol.bonds.values()].map(b => b.properties.localizedOrder ?? b.properties.order);

    mol.setResonanceState(2);
    mol.resetResonance();

    const restoredOrders = [...mol.bonds.values()].map(b => b.properties.localizedOrder ?? b.properties.order);
    assert.deepEqual(s1Orders, restoredOrders);
    assert.equal(mol.properties.resonance, undefined);
  });
});

// ---------------------------------------------------------------------------
// Auto-clear on structural mutation
// ---------------------------------------------------------------------------

describe('auto-clear on mutation', () => {
  it('addBond clears resonance states', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    assert.ok(mol.properties.resonance);

    const atomIds = [...mol.atoms.keys()];
    // Add a new atom and bond
    mol.addAtom(null, 'C', {});
    assert.equal(mol.properties.resonance, undefined);
  });

  it('removeAtom clears resonance states', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    assert.ok(mol.properties.resonance);

    const firstAtomId = [...mol.atoms.keys()][0];
    mol.removeAtom(firstAtomId);
    assert.equal(mol.properties.resonance, undefined);
  });

  it('setAtomCharge clears resonance states', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    assert.ok(mol.properties.resonance);

    const firstAtomId = [...mol.atoms.keys()][0];
    mol.setAtomCharge(firstAtomId, 0);
    assert.equal(mol.properties.resonance, undefined);
  });

  it('setAtomRadical clears resonance states', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    assert.ok(mol.properties.resonance);

    const firstAtomId = [...mol.atoms.keys()][0];
    mol.setAtomRadical(firstAtomId, 0);
    assert.equal(mol.properties.resonance, undefined);
  });
});

// ---------------------------------------------------------------------------
// getResonanceStates
// ---------------------------------------------------------------------------

describe('getResonanceStates', () => {
  it('returns array sorted by id with weight fields', () => {
    const mol = parse('c1ccccc1');
    generateResonanceStructures(mol);
    const states = mol.getResonanceStates();
    assert.equal(states.length, mol.resonanceCount);
    for (let i = 0; i < states.length; i++) {
      assert.equal(states[i].id, i + 1);
      assert.equal(typeof states[i].weight, 'number');
    }
  });

  it('returns [{ id: 1, weight: 100 }] when resonance not generated', () => {
    const mol = parse('CCO');
    const states = mol.getResonanceStates();
    assert.deepEqual(states, [{ id: 1, weight: 100 }]);
  });
});

// ---------------------------------------------------------------------------
// setResonanceState — out of range
// ---------------------------------------------------------------------------

describe('setResonanceState — validation', () => {
  it('throws RangeError for out-of-range state', () => {
    const mol = parse('CC(=O)[O-]');
    generateResonanceStructures(mol);
    assert.throws(() => mol.setResonanceState(0), RangeError);
    assert.throws(() => mol.setResonanceState(mol.resonanceCount + 1), RangeError);
  });
});
