import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { parseSMILES } from '../../src/io/index.js';
import { validateValence } from '../../src/validation/valence.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a molecule with a central atom bonded to `n` carbon neighbours.
 * @param {string} centerSymbol - Element symbol of the center atom.
 * @param {number} n - Number of carbon neighbours to add.
 * @param {object} [centerProps] - Optional properties for the center atom.
 * @returns {object} The constructed molecule.
 */
function buildWithNBonds(centerSymbol, n, centerProps = {}) {
  const mol = new Molecule();
  mol.addAtom('center', centerSymbol, centerProps);
  for (let i = 0; i < n; i++) {
    mol.addAtom(`c${i}`, 'C');
    mol.addBond(null, 'center', `c${i}`, { order: 1 }, false); // skip implicit-H adjustment
  }
  return mol;
}

/**
 * Return warnings only for the atom with id 'center'.
 * @param {object} mol - The molecule graph.
 * @returns {Array} Array of validation warnings for the center atom.
 */
function centerWarnings(mol) {
  return validateValence(mol).filter(w => w.atomId === 'center');
}

// ---------------------------------------------------------------------------
// Valid molecules — no warnings
// ---------------------------------------------------------------------------

describe('validateValence — valid molecules', () => {
  it('methane C produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('C')), []);
  });

  it('ethane CC produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('CC')), []);
  });

  it('ethylene C=C produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('C=C')), []);
  });

  it('acetylene C#C produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('C#C')), []);
  });

  it('ammonia N produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('N')), []);
  });

  it('water O produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('O')), []);
  });

  it('benzene c1ccccc1 produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('c1ccccc1')), []);
  });

  it('the reported cannabinoid example produces no warnings', () => {
    const smiles = 'Oc1c(c(O)cc(c1)CCCCC)[C@@H]2\\C=C(/CC[C@H]2\\C(=C)C)C';
    assert.deepEqual(validateValence(parseSMILES(smiles)), []);
  });

  it('pyridine c1ccncc1 produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('c1ccncc1')), []);
  });

  it('2-methylimidazole Cc1cncn1 produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('Cc1cncn1')), []);
  });

  it('imidazole c1cn[nH]c1 produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('c1cn[nH]c1')), []);
  });

  it('fused 5+6 ring with single unsubstituted ring-N produces no warnings', () => {
    // The n in c1cnc2ccccc12 is the sole ambiguous N in the 5-membered ring (no H,
    // no exocyclic bonds); it should be promoted to pyrrole-like (2π) to satisfy
    // Hückel and be marked aromatic, preventing a false valence warning.
    const smiles = 'NC(=O)[C@@H](Cc1cnc2ccccc12)NC(=O)[C@@H](CCCC1=CC=CC=C1)C[P@@](O)(=O)[C@@H](CC1=CC=CC=C1)NC(=O)OCC1=CC=CC=C1';
    assert.deepEqual(validateValence(parseSMILES(smiles)), []);
  });

  it('ammonium [NH4+] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[NH4+]')), []);
  });

  it('hydroxide [OH-] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[OH-]')), []);
  });

  it('oxonium [OH3+] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[OH3+]')), []);
  });

  it('phosphoric acid P(=O)(O)(O)O produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('P(=O)(O)(O)O')), []);
  });

  it('dimethyl sulfoxide CS(=O)C produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('CS(=O)C')), []);
  });

  it('sulfuric acid OS(=O)(=O)O produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('OS(=O)(=O)O')), []);
  });

  it('chloromethane CCl produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('CCl')), []);
  });

  it('isolated bromide [Br-] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[Br-]')), []);
  });

  it('nitrobenzene [O-][N+](=O)c1ccccc1 produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[O-][N+](=O)c1ccccc1')), []);
  });

  it('borane [BH3] produces no warnings', () => {
    // Bracket notation fixes the H count at 3, matching B's trivalent chemistry
    assert.deepEqual(validateValence(parseSMILES('[BH3]')), []);
  });

  it('tetrahydroborate [BH4-] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[BH4-]')), []);
  });

  it('empty molecule returns empty array', () => {
    assert.deepEqual(validateValence(new Molecule()), []);
  });

  it('isolated ion [Na+] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[Na+]')), []);
  });

  it('carbocation [CH3+] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[CH3+]')), []);
  });

  it('carbanion [CH3-] produces no warnings', () => {
    assert.deepEqual(validateValence(parseSMILES('[CH3-]')), []);
  });

  it('ammine platinum complexes do not flag neutral donor nitrogens as over-bonded', () => {
    assert.deepEqual(validateValence(parseSMILES('[NH3][Pt]([NH3])(Cl)Cl')), []);
  });

  it('methyl radical is valid when the radical count is explicit', () => {
    const mol = buildWithNBonds('C', 3, { radical: 1 });
    assert.equal(centerWarnings(mol).length, 0);
  });

  it('hydroxyl radical is valid when the radical count is explicit', () => {
    const mol = buildWithNBonds('O', 1, { radical: 1 });
    assert.equal(centerWarnings(mol).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Invalid molecules — expected warnings
// ---------------------------------------------------------------------------

describe('validateValence — over-bonded carbon', () => {
  it('C with 5 single bonds produces exactly one warning', () => {
    const mol = buildWithNBonds('C', 5);
    const ws = centerWarnings(mol);
    assert.equal(ws.length, 1);
    assert.equal(ws[0].element, 'C');
    assert.equal(ws[0].bondOrder, 5);
    assert.deepEqual(ws[0].allowed, [4]);
  });

  it('C with 6 single bonds produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('C', 6));
    assert.equal(ws.length, 1);
    assert.equal(ws[0].bondOrder, 6);
  });

  it('neutral C with 2 single bonds now produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('C', 2));
    assert.equal(ws.length, 1);
    assert.deepEqual(ws[0].allowed, [4]);
  });

  it('neutral C with 0 bonds now produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('C', 0));
    assert.equal(ws.length, 1);
    assert.deepEqual(ws[0].allowed, [4]);
  });
});

describe('validateValence — nitrogen parity violation', () => {
  it('N with 4 bonds and charge 0 produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('N', 4));
    assert.equal(ws.length, 1);
    assert.equal(ws[0].element, 'N');
    assert.equal(ws[0].bondOrder, 4);
    assert.deepEqual(ws[0].allowed, [3]);
  });

  it('N with 4 bonds and charge +1 produces no warning', () => {
    const mol = buildWithNBonds('N', 4, { charge: 1 });
    assert.equal(centerWarnings(mol).length, 0);
  });

  it('N with 3 bonds and charge 0 produces no warning', () => {
    const mol = buildWithNBonds('N', 3);
    assert.equal(centerWarnings(mol).length, 0);
  });
});

describe('validateValence — oxygen', () => {
  it('O with 3 bonds and charge 0 produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('O', 3));
    assert.equal(ws.length, 1);
    assert.equal(ws[0].element, 'O');
    assert.deepEqual(ws[0].allowed, [2]);
  });

  it('O with 3 bonds and charge +1 produces no warning', () => {
    const mol = buildWithNBonds('O', 3, { charge: 1 });
    assert.equal(centerWarnings(mol).length, 0);
  });

  it('O with 4 bonds and charge 0 produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('O', 4));
    assert.equal(ws.length, 1);
  });

  it('O with 2 bonds and radical 1 produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('O', 2, { radical: 1 }));
    assert.equal(ws.length, 1);
    assert.deepEqual(ws[0].allowed, [1]);
  });
});

describe('validateValence — hydrogen', () => {
  it('H with 2 bonds produces a warning', () => {
    const mol = new Molecule();
    mol.addAtom('h0', 'H');
    mol.addAtom('c0', 'C');
    mol.addAtom('c1', 'C');
    mol.addBond(null, 'h0', 'c0', { order: 1 }, false);
    mol.addBond(null, 'h0', 'c1', { order: 1 }, false);
    const ws = validateValence(mol).filter(w => w.atomId === 'h0');
    assert.equal(ws.length, 1);
    assert.equal(ws[0].bondOrder, 2);
    assert.deepEqual(ws[0].allowed, [1]);
  });
});

describe('validateValence — phosphorus and sulfur (expanded octet)', () => {
  it('P with 5 bonds (pentavalent) produces no warning', () => {
    const mol = buildWithNBonds('P', 5);
    assert.equal(centerWarnings(mol).length, 0);
  });

  it('P with 6 bonds produces a warning', () => {
    // ec = 5 − 0 = 5 (odd), cap = 8 → allowed odd ≤ 5: [1, 3, 5]; 6 is even → flagged
    const ws = centerWarnings(buildWithNBonds('P', 6));
    assert.equal(ws.length, 1);
  });

  it('S with 6 bonds produces no warning', () => {
    // ec = 6 (even), cap = 8 → allowed evens ≤ 6: [0, 2, 4, 6]
    const mol = buildWithNBonds('S', 6);
    assert.equal(centerWarnings(mol).length, 0);
  });

  it('S with 7 bonds produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('S', 7));
    assert.equal(ws.length, 1);
  });
});

describe('validateValence — heavier halogens stay monovalent by default', () => {
  it('Br with 1 bond produces no warning', () => {
    const mol = buildWithNBonds('Br', 1);
    assert.equal(centerWarnings(mol).length, 0);
  });

  it('Br with 5 bonds produces a warning', () => {
    const ws = centerWarnings(buildWithNBonds('Br', 5));
    assert.equal(ws.length, 1);
    assert.deepEqual(ws[0].allowed, [1]);
  });
});

describe('validateValence — transition metals are skipped', () => {
  it('Fe(II) produces no warnings', () => {
    const mol = new Molecule();
    mol.addAtom('fe', 'Fe', { charge: 2 });
    assert.deepEqual(validateValence(mol), []);
  });

  it('Cu(II) with bonds produces no warnings', () => {
    const mol = buildWithNBonds('Cu', 4);
    assert.equal(centerWarnings(mol).length, 0);
  });
});

describe('validateValence — warning object shape', () => {
  it('warning has atomId, element, charge, radical, bondOrder, allowed, reason, message', () => {
    const mol = buildWithNBonds('C', 5);
    const [w] = validateValence(mol);
    assert.equal(typeof w.atomId, 'string');
    assert.equal(typeof w.element, 'string');
    assert.equal(typeof w.charge, 'number');
    assert.equal(typeof w.radical, 'number');
    assert.equal(typeof w.bondOrder, 'number');
    assert.ok(Array.isArray(w.allowed));
    assert.equal(typeof w.reason, 'string');
    assert.equal(typeof w.message, 'string');
    assert.ok(w.message.includes('C'));
    assert.ok(w.message.includes('5'));
  });

  it('reason and message include allowed bond orders', () => {
    const mol = buildWithNBonds('C', 5);
    const [w] = validateValence(mol);
    assert.ok(w.reason.includes('4'));
    assert.ok(w.message.includes('4'));
  });
});

describe('validateValence — multiple violations in one molecule', () => {
  it('both over-bonded atoms appear in the warnings', () => {
    const mol = new Molecule();
    mol.addAtom('bad1', 'C');
    mol.addAtom('bad2', 'C');
    // Give each overvalent carbon 5 unique neighbours
    for (let i = 0; i < 5; i++) {
      mol.addAtom(`nb1_${i}`, 'C');
      mol.addAtom(`nb2_${i}`, 'C');
      mol.addBond(null, 'bad1', `nb1_${i}`, { order: 1 }, false);
      mol.addBond(null, 'bad2', `nb2_${i}`, { order: 1 }, false);
    }
    const ws = validateValence(mol);
    assert.ok(
      ws.some(w => w.atomId === 'bad1'),
      'bad1 should be flagged'
    );
    assert.ok(
      ws.some(w => w.atomId === 'bad2'),
      'bad2 should be flagged'
    );
  });
});
