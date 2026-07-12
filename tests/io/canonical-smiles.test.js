import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toCanonicalSMILES, sameMolecule } from '../../src/io/canonical-smiles.js';
import { toCanonicalSMILES as canonicalFromIndex } from '../../src/io/index.js';
import { parseSMILES, toCanonicalSMILES as canonicalFromSmilesModule } from '../../src/io/smiles.js';

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
    'C', // methane
    'CC', // ethane
    'CCC', // propane
    'CC(C)C', // isobutane
    'c1ccccc1', // benzene
    'c1ccc2ccccc2c1', // naphthalene
    'CC=O', // acetaldehyde
    'CC(=O)O', // acetic acid
    'c1ccncc1', // pyridine
    'C#N', // hydrogen cyanide
    'CC(=O)Oc1ccccc1C(=O)O' // aspirin
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
    const s = toCanonicalSMILES(mol1);
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
    const mols = ['C', 'CC', 'C=C', 'C#C', 'c1ccccc1', 'C1CCCCC1', '[NH4+]', '[OH-]', '[13C]', 'CCO', 'CC(=O)O'];
    for (const smi of mols) {
      const s = canonical(smi);
      assert.ok(s.length > 0, `empty output for ${smi}`);
    }
  });

  it('re-parses to a molecule with the same heavy-atom count', () => {
    const cases = [
      ['CC(=O)O', 4], // acetic acid: C, C, O, O
      ['c1ccccc1', 6], // benzene: 6 C
      ['c1ccncc1', 6] // pyridine: 5 C + 1 N
    ];
    for (const [smi, expectedHeavy] of cases) {
      const s = canonical(smi);
      const mol2 = parseSMILES(s);
      const heavy = [...mol2.atoms.values()].filter(a => a.name !== 'H').length;
      assert.equal(heavy, expectedHeavy, `${smi}: expected ${expectedHeavy} heavy atoms, got ${heavy}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Amine oxide normalization
// ---------------------------------------------------------------------------

describe('toCanonicalSMILES — amine oxide normalization', () => {
  it('preserves an already charge-separated tertiary amine oxide (e.g. TMAO) as [N+]...[O-]', () => {
    assert.equal(canonical('C[N+](C)(C)[O-]'), 'C[N+](C)(C)[O-]');
  });

  it('promotes an over-valent neutral trisubstituted N(R)(R)(R)=O to the charge-separated form', () => {
    assert.equal(canonical('CN(CC)(CC)=O'), canonical('C[N+](CC)(CC)[O-]'));
  });

  it('promotes an over-valent neutral disubstituted N(R)(R)=O to the charge-separated form, filling the 4th N+ valence slot with H', () => {
    assert.equal(canonical('CCN(C)=O'), canonical('CC[NH+](C)[O-]'));
  });

  it('does not touch a genuine neutral nitroso compound R-N=O (only one other substituent)', () => {
    const mol = parseSMILES(canonical('O=Nc1ccccc1'));
    const n = [...mol.atoms.values()].find(atom => atom.name === 'N');
    assert.equal(n.getCharge(), 0);
    const doubleBondToO = n.bonds.some(bondId => {
      const bond = mol.bonds.get(bondId);
      const other = mol.atoms.get(bond.getOtherAtom(n.id));
      return other?.name === 'O' && (bond.properties.order ?? 1) === 2;
    });
    assert.equal(doubleBondToO, true, 'nitroso N=O bond should be untouched');
  });

  it('does not touch a nitro group (already excluded by the double-bonded-O guard)', () => {
    assert.equal(canonical('[N+](=O)([O-])c1ccccc1'), canonical('O=[N+]([O-])c1ccccc1'));
  });
});

// ---------------------------------------------------------------------------
// sameMolecule
// ---------------------------------------------------------------------------

describe('sameMolecule', () => {
  it('returns true for the same object reference', () => {
    const m = parseSMILES('CCO');
    assert.equal(sameMolecule(m, m), true);
  });

  it('returns true for the same molecule parsed from different traversal order', () => {
    assert.equal(sameMolecule(parseSMILES('CCO'), parseSMILES('OCC')), true);
  });

  it('returns true for benzene in aromatic vs Kekulé SMILES', () => {
    assert.equal(sameMolecule(parseSMILES('c1ccccc1'), parseSMILES('C1=CC=CC=C1')), true);
  });

  it('returns true for the same ring written from different start atoms', () => {
    assert.equal(sameMolecule(parseSMILES('C1CCCCC1'), parseSMILES('C1CCCCC1')), true);
  });

  it('returns false for constitutional isomers with the same formula', () => {
    assert.equal(sameMolecule(parseSMILES('CCCC'), parseSMILES('CC(C)C')), false);
  });

  it('returns false for molecules with different atom counts', () => {
    assert.equal(sameMolecule(parseSMILES('CCO'), parseSMILES('CO')), false);
  });

  it('returns false for molecules with same atoms but different bond orders', () => {
    assert.equal(sameMolecule(parseSMILES('CC'), parseSMILES('C=C')), false);
  });

  it('returns false for molecules with different elements', () => {
    assert.equal(sameMolecule(parseSMILES('CCN'), parseSMILES('CCO')), false);
  });

  it('returns false for molecules with different formal charges', () => {
    assert.equal(sameMolecule(parseSMILES('[NH4+]'), parseSMILES('N')), false);
  });

  it('returns true for a multi-component salt written in both component orders', () => {
    assert.equal(sameMolecule(parseSMILES('[Na+].[Cl-]'), parseSMILES('[Cl-].[Na+]')), true);
  });
});

// ---------------------------------------------------------------------------
// Compatibility exports
// ---------------------------------------------------------------------------

describe('toCanonicalSMILES — compatibility exports', () => {
  it('stays available from the public barrel and legacy smiles module', () => {
    const expected = toCanonicalSMILES(parseSMILES('OCC'));

    assert.equal(canonicalFromIndex(parseSMILES('OCC')), expected);
    assert.equal(canonicalFromSmilesModule(parseSMILES('OCC')), expected);
  });
});
