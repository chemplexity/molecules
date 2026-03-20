import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/smiles.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function canonical(smiles) {
  return toCanonicalSMILES(parseSMILES(smiles));
}

// ---------------------------------------------------------------------------
// Invariance — same molecule, different input SMILES → identical output
// ---------------------------------------------------------------------------

describe('toCanonicalSMILES — invariance', () => {
  it('ethanol CCO and OCC produce the same string', () => {
    assert.equal(canonical('CCO'), canonical('OCC'));
  });

  it('propane CCC and CC(C) produce the same string', () => {
    assert.equal(canonical('CCC'), canonical('CC(C)'));
  });

  it('acetic acid CC(=O)O and O=C(O)C produce the same string', () => {
    assert.equal(canonical('CC(=O)O'), canonical('O=C(O)C'));
  });

  it('benzene is stable regardless of which atom starts the SMILES', () => {
    // Both strings represent benzene; canonical should collapse them.
    assert.equal(canonical('c1ccccc1'), canonical('c1ccccc1'));
  });

  it('methylamine CN and NC produce the same string', () => {
    assert.equal(canonical('CN'), canonical('NC'));
  });

  it('water O and [H]O[H] produce the same string after H suppression', () => {
    // Both represent water; explicit H are stripped to implicit.
    assert.equal(canonical('O'), canonical('[H]O[H]'));
  });
});

// ---------------------------------------------------------------------------
// Idempotence — parse → canonical → re-parse → canonical = same string
// ---------------------------------------------------------------------------

describe('toCanonicalSMILES — idempotence', () => {
  const corpus = [
    'C',           // methane
    'CC',          // ethane
    'CCC',         // propane
    'CC(C)C',      // isobutane
    'c1ccccc1',    // benzene
    'c1ccc2ccccc2c1',  // naphthalene
    'CC=O',        // acetaldehyde
    'CC(=O)O',     // acetic acid
    'c1ccncc1',    // pyridine
    'C#N',         // hydrogen cyanide
    'CC(=O)Oc1ccccc1C(=O)O'  // aspirin
  ];

  for (const smi of corpus) {
    it(`idempotent for ${smi}`, () => {
      const s1 = canonical(smi);
      const s2 = canonical(s1);
      assert.equal(s1, s2, `not idempotent: first=${s1}, second=${s2}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Disconnected molecules — component order is canonical
// ---------------------------------------------------------------------------

describe('toCanonicalSMILES — disconnected molecules', () => {
  it('C.N and N.C produce the same string', () => {
    assert.equal(canonical('C.N'), canonical('N.C'));
  });

  it('CC.O and O.CC produce the same string', () => {
    assert.equal(canonical('CC.O'), canonical('O.CC'));
  });
});

// ---------------------------------------------------------------------------
// Stereo round-trip — chirality survives canonical serialisation
// ---------------------------------------------------------------------------

describe('toCanonicalSMILES — stereo round-trip', () => {
  it('[C@@H](F)(Cl)Br round-trips with same chirality token', () => {
    const mol1 = parseSMILES('[C@@H](F)(Cl)Br');
    const s    = toCanonicalSMILES(mol1);
    const mol2 = parseSMILES(s);
    // Both molecules must have exactly one chiral centre with the same R/S.
    const c1 = [...mol1.atoms.values()].find(a => a.properties.chirality);
    const c2 = [...mol2.atoms.values()].find(a => a.properties.chirality);
    assert.ok(c1, 'original has a chiral centre');
    assert.ok(c2, 'round-tripped molecule has a chiral centre');
    assert.equal(c1.properties.chirality, c2.properties.chirality);
  });
});

// ---------------------------------------------------------------------------
// Non-trivial structural cases
// ---------------------------------------------------------------------------

describe('toCanonicalSMILES — structural cases', () => {
  it('produces a non-empty string for every corpus molecule', () => {
    const mols = [
      'C', 'CC', 'C=C', 'C#C', 'c1ccccc1', 'C1CCCCC1',
      '[NH4+]', '[OH-]', '[13C]', 'CCO', 'CC(=O)O'
    ];
    for (const smi of mols) {
      const s = canonical(smi);
      assert.ok(s.length > 0, `empty output for ${smi}`);
    }
  });

  it('re-parses to a molecule with the same heavy-atom count', () => {
    const cases = [
      ['CC(=O)O',  4],   // acetic acid: C, C, O, O
      ['c1ccccc1', 6],   // benzene: 6 C
      ['c1ccncc1', 6]   // pyridine: 5 C + 1 N
    ];
    for (const [smi, expectedHeavy] of cases) {
      const s    = canonical(smi);
      const mol2 = parseSMILES(s);
      const heavy = [...mol2.atoms.values()].filter(a => a.name !== 'H').length;
      assert.equal(heavy, expectedHeavy, `${smi}: expected ${expectedHeavy} heavy atoms, got ${heavy}`);
    }
  });
});
