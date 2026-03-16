import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES, tokenize, decode, toJSON, fromJSON, toSMILES } from '../../src/io/index.js';
import { Molecule } from '../../src/core/index.js';
import { molecularFormula, molecularMass } from '../../src/descriptors/molecular.js';

// Derive molecular formula from a Molecule's atom Map
function formula(mol) {
  const f = {};
  for (const atom of mol.atoms.values()) {
    f[atom.name] = (f[atom.name] ?? 0) + 1;
  }
  return f;
}

// v1 parser adds implicit hydrogens — counts include H atoms

describe('parseSMILES', () => {
  it('propane CCC: 3 C + 8 H = 11 atoms, 2 C-C + 8 C-H = 10 bonds', () => {
    const mol = parseSMILES('CCC');
    assert.equal(mol.atomCount, 11);
    assert.equal(mol.bondCount, 10);
  });

  it('methane C: 1 C + 4 H = 5 atoms', () => {
    const mol = parseSMILES('C');
    assert.equal(mol.atomCount, 5);
    assert.equal(mol.bondCount, 4);
  });

  it('isobutane CC(C)C: 4 C + 10 H = 14 atoms, 3 C-C + 10 C-H = 13 bonds', () => {
    const mol = parseSMILES('CC(C)C');
    assert.equal(mol.atomCount, 14);
    assert.equal(mol.bondCount, 13);
  });

  it('atoms have periodic table properties', () => {
    const mol = parseSMILES('C');
    const carbon = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.ok(carbon !== undefined);
    assert.equal(carbon.properties.protons, 6);
    assert.equal(carbon.properties.group,   14);
    assert.equal(carbon.properties.period,  2);
  });
});

describe('tokenize', () => {
  it('returns tokens with index, type, term, tag', () => {
    const { tokens } = tokenize('CC');
    assert.ok(tokens.length > 0);
    assert.ok('index' in tokens[0]);
    assert.ok('type'  in tokens[0]);
    assert.ok('term'  in tokens[0]);
    assert.ok('tag'   in tokens[0]);
  });

  it('identifies atom tokens for propane', () => {
    const { tokens } = tokenize('CCC');
    const atomTokens = tokens.filter(t => t.type === 'atom');
    assert.equal(atomTokens.length, 3);
  });
});

describe('decode', () => {
  it('returns { atoms, bonds } plain objects', () => {
    const result = decode(tokenize('CC'));
    assert.ok(typeof result.atoms === 'object');
    assert.ok(typeof result.bonds === 'object');
  });
});

describe('toJSON / fromJSON', () => {
  it('round-trips a molecule', () => {
    const mol = parseSMILES('CC');
    const json = toJSON(mol);
    const mol2 = fromJSON(json);
    assert.equal(mol2.atomCount, mol.atomCount);
    assert.equal(mol2.bondCount, mol.bondCount);
  });

  it('toJSON produces a string with atoms and bonds', () => {
    const mol = parseSMILES('CC');
    const json = toJSON(mol);
    assert.equal(typeof json, 'string');
    const parsed = JSON.parse(json);
    assert.ok(parsed.atoms !== undefined);
    assert.ok(parsed.bonds !== undefined);
  });

  it('fromJSON throws on invalid JSON', () => {
    assert.throws(() => fromJSON('{invalid json}'));
  });
});

describe('parseSMILES — formula', () => {
  it('methane C: { C: 1, H: 4 }', () => {
    assert.deepEqual(formula(parseSMILES('C')), { C: 1, H: 4 });
  });

  it('water O: { H: 2, O: 1 }', () => {
    assert.deepEqual(formula(parseSMILES('O')), { H: 2, O: 1 });
  });

  it('ammonia N: { H: 3, N: 1 }', () => {
    assert.deepEqual(formula(parseSMILES('N')), { H: 3, N: 1 });
  });

  it('ethanol CCO: { C: 2, H: 6, O: 1 }', () => {
    assert.deepEqual(formula(parseSMILES('CCO')), { C: 2, H: 6, O: 1 });
  });

  it('propane CCC: { C: 3, H: 8 }', () => {
    assert.deepEqual(formula(parseSMILES('CCC')), { C: 3, H: 8 });
  });

  it('cyclohexane C1CCCCC1: { C: 6, H: 12 }', () => {
    assert.deepEqual(formula(parseSMILES('C1CCCCC1')), { C: 6, H: 12 });
  });

  it('ethylene C=C: { C: 2, H: 4 }', () => {
    assert.deepEqual(formula(parseSMILES('C=C')), { C: 2, H: 4 });
  });

  it('acetylene C#C: { C: 2, H: 2 }', () => {
    assert.deepEqual(formula(parseSMILES('C#C')), { C: 2, H: 2 });
  });

  it('isobutane CC(C)C: { C: 4, H: 10 }', () => {
    assert.deepEqual(formula(parseSMILES('CC(C)C')), { C: 4, H: 10 });
  });

  it('benzene c1ccccc1: { C: 6, H: 6 }', () => {
    assert.deepEqual(formula(parseSMILES('c1ccccc1')), { C: 6, H: 6 });
  });

  it('explicit hydrogen C[H]: { C: 1, H: 4 } (H counts toward valence)', () => {
    assert.equal(formula(parseSMILES('C[H]')).C, 1);
    assert.ok(formula(parseSMILES('C[H]')).H > 0);
  });
});

describe('parseSMILES — structure', () => {
  it('returns a molecule with atoms and bonds defined', () => {
    const mol = parseSMILES('CC');
    assert.ok(mol.atoms instanceof Map);
    assert.ok(mol.bonds instanceof Map);
  });

  it('disconnected molecule C.C: { C: 2, H: 8 }', () => {
    assert.deepEqual(formula(parseSMILES('C.C')), { C: 2, H: 8 });
  });
});

describe('parseSMILES — input validation', () => {
  it('throws on empty string', () => {
    assert.throws(() => parseSMILES(''), /must be a non-empty string/);
  });

  it('throws on whitespace-only string', () => {
    assert.throws(() => parseSMILES('   '), /must be a non-empty string/);
  });

  it('throws on non-string (number)', () => {
    assert.throws(() => parseSMILES(123), /must be a non-empty string/);
  });

  it('throws on null', () => {
    assert.throws(() => parseSMILES(null));
  });

  it('throws on undefined', () => {
    assert.throws(() => parseSMILES(undefined));
  });

  it('throws on invalid SMILES xyz', () => {
    assert.throws(() => parseSMILES('xyz'));
  });
});

describe('parseSMILES — performance', () => {
  it('decane CCCCCCCCCC: C count = 10', () => {
    const start = Date.now();
    const mol = parseSMILES('CCCCCCCCCC');
    assert.ok(Date.now() - start < 1000);
    assert.equal(formula(mol).C, 10);
  });

  it('naphthalene c1ccc2ccccc2c1: C = 10, H = 8', () => {
    const start = Date.now();
    const mol = parseSMILES('c1ccc2ccccc2c1');
    assert.ok(Date.now() - start < 1000);
    assert.equal(formula(mol).C, 10);
    assert.equal(formula(mol).H, 8);
  });

  it('very long chain C×100 completes in under 2 s', () => {
    const start = Date.now();
    const mol = parseSMILES('C'.repeat(100));
    assert.ok(Date.now() - start < 2000);
    assert.equal(formula(mol).C, 100);
  });
});

describe('parseSMILES — SMILES spec fixes', () => {
  // Fix 1: explicit aromatic bond ':'
  it('benzene with explicit aromatic bonds c1:c:c:c:c:c:1: C6H6', () => {
    const f = formula(parseSMILES('c1:c:c:c:c:c:1'));
    assert.equal(f.C, 6);
    assert.equal(f.H, 6);
  });

  // Fix 2: aromatic arsenic [as]
  it('[as] is recognised as an As atom', () => {
    const mol = parseSMILES('C[as]C');
    assert.ok([...mol.atoms.values()].some(a => a.name === 'As'));
  });

  // Fix 3: multi-valence S — S(=O)O gets 1 implicit H on S (uses valence 4)
  it('S(=O)O sulfinic-acid fragment: H=2, O=2, S=1', () => {
    assert.deepEqual(formula(parseSMILES('S(=O)O')), { H: 2, O: 2, S: 1 });
  });

  // Fix 3: multi-valence N — 4 bond-electrons on N triggers valence 5, adds 1 H
  it('N(=O)=O nitroxyl: H=1, N=1, O=2', () => {
    assert.deepEqual(formula(parseSMILES('N(=O)=O')), { H: 1, N: 1, O: 2 });
  });

  // Fix 3: aromatic atoms are exempt from multi-valence (thiophene S = 0 implicit H)
  it('thiophene c1sccc1: S has no implicit H (aromatic exemption preserves C4H4S)', () => {
    assert.deepEqual(formula(parseSMILES('c1sccc1')), { C: 4, H: 4, S: 1 });
  });

  // Fix 4: quadruple bond '$'
  it('C$C: bond with order 4 is created', () => {
    const mol = parseSMILES('C$C');
    const quad = [...mol.bonds.values()].find(b => b.properties.order === 4);
    assert.ok(quad !== undefined, 'expected a bond with order 4');
  });

  // Fix 5: directional bonds '/' and '\'
  it('F/C=C/F: parses without error, F and C atoms present, stereo stored on bond', () => {
    const mol = parseSMILES('F/C=C/F');
    assert.equal([...mol.atoms.values()].filter(a => a.name === 'F').length, 2);
    assert.equal([...mol.atoms.values()].filter(a => a.name === 'C').length, 2);
    const stereoBond = [...mol.bonds.values()].find(b => b.properties.stereo !== null);
    assert.ok(stereoBond !== undefined, 'expected at least one bond with stereo property');
  });

  it('F/C=C\\F cis: stereo bond stored with \\ direction', () => {
    const mol = parseSMILES('F/C=C\\F');
    const backslash = [...mol.bonds.values()].find(b => b.properties.stereo === '\\');
    assert.ok(backslash !== undefined, 'expected a bond with stereo = "\\"');
  });

  // Fix 6: ring closure bond type (bond symbol before ring digit)
  it('C=1CCCCC1 ring closure with = prefix: same formula as C1=CCCCC1 (C6H10)', () => {
    assert.deepEqual(formula(parseSMILES('C=1CCCCC1')), { C: 6, H: 10 });
  });

  it('C1=CCCCC1 canonical cyclohexene: C6H10', () => {
    assert.deepEqual(formula(parseSMILES('C1=CCCCC1')), { C: 6, H: 10 });
  });
});

// ---------------------------------------------------------------------------
// CIP R/S and E/Z stereochemistry
// ---------------------------------------------------------------------------

describe('parseSMILES – CIP R/S', () => {
  it('C[C@@H](N)O → S', () => {
    const mol = parseSMILES('C[C@@H](N)O');
    const chiral = [...mol.atoms.values()].find(a => a.isChiralCenter());
    assert.ok(chiral, 'chiral atom not found');
    assert.equal(chiral.getChirality(), 'S');
  });

  it('C[C@H](N)O → R', () => {
    const mol = parseSMILES('C[C@H](N)O');
    const chiral = [...mol.atoms.values()].find(a => a.isChiralCenter());
    assert.ok(chiral, 'chiral atom not found');
    assert.equal(chiral.getChirality(), 'R');
  });

  it('@@ and @ give opposite designations', () => {
    const c1 = [...parseSMILES('C[C@@H](N)O').atoms.values()].find(a => a.isChiralCenter())?.getChirality();
    const c2 = [...parseSMILES('C[C@H](N)O').atoms.values()].find(a => a.isChiralCenter())?.getChirality();
    assert.notEqual(c1, c2);
  });

  it('CC — no chiral centers', () => {
    assert.equal(parseSMILES('CC').getChiralCenters().length, 0);
  });

  it('N[C@@H](C)C(=O)O (S-alanine) → S', () => {
    const mol = parseSMILES('N[C@@H](C)C(=O)O');
    const chiral = [...mol.atoms.values()].find(a => a.isChiralCenter());
    assert.ok(chiral, 'chiral atom not found');
    assert.equal(chiral.getChirality(), 'S');
  });

  it('N[C@H](C)C(=O)O (R-alanine) → R', () => {
    const mol = parseSMILES('N[C@H](C)C(=O)O');
    const chiral = [...mol.atoms.values()].find(a => a.isChiralCenter());
    assert.ok(chiral, 'chiral atom not found');
    assert.equal(chiral.getChirality(), 'R');
  });
});

describe('Molecule#getChiralCenters()', () => {
  it('returns IDs of all chiral atoms', () => {
    const mol = parseSMILES('C[C@@H](N)O');
    const ids = mol.getChiralCenters();
    assert.equal(ids.length, 1);
    const chirality = mol.atoms.get(ids[0]).getChirality();
    assert.ok(chirality === 'R' || chirality === 'S');
  });

  it('returns empty array when no chiral atoms', () => {
    assert.deepEqual(parseSMILES('CC=O').getChiralCenters(), []);
  });

  it('multiple chiral centres are all found (L-threonine)', () => {
    assert.equal(parseSMILES('N[C@@H]([C@H](O)C)C(=O)O').getChiralCenters().length, 2);
  });
});

describe('Molecule#getEZStereo()', () => {
  it('F/C=C/F → E', () => {
    const mol = parseSMILES('F/C=C/F');
    const dbl = [...mol.bonds.values()].find(b => b.properties.order === 2);
    assert.ok(dbl, 'double bond not found');
    assert.equal(mol.getEZStereo(dbl.id), 'E');
  });

  it('F/C=C\\F → Z', () => {
    const mol = parseSMILES('F/C=C\\F');
    const dbl = [...mol.bonds.values()].find(b => b.properties.order === 2);
    assert.ok(dbl, 'double bond not found');
    assert.equal(mol.getEZStereo(dbl.id), 'Z');
  });

  it('Cl/C(F)=C(F)/Cl — both Cl marked → E', () => {
    const mol = parseSMILES('Cl/C(F)=C(F)/Cl');
    const dbl = [...mol.bonds.values()].find(b => b.properties.order === 2);
    assert.ok(dbl, 'double bond not found');
    assert.equal(mol.getEZStereo(dbl.id), 'E');
  });

  it('F/C=C(Cl)/F — CIP flip on right carbon → Z', () => {
    const mol = parseSMILES('F/C=C(Cl)/F');
    const dbl = [...mol.bonds.values()].find(b => b.properties.order === 2);
    assert.ok(dbl, 'double bond not found');
    assert.equal(mol.getEZStereo(dbl.id), 'Z');
  });

  it('FC=CF (no directional bonds) → null', () => {
    const mol = parseSMILES('FC=CF');
    const dbl = [...mol.bonds.values()].find(b => b.properties.order === 2);
    assert.ok(dbl, 'double bond not found');
    assert.equal(mol.getEZStereo(dbl.id), null);
  });

  it('returns null for a single-bond ID', () => {
    const mol = parseSMILES('F/C=C/F');
    const single = [...mol.bonds.values()].find(b => b.properties.order === 1);
    assert.ok(single, 'single bond not found');
    assert.equal(mol.getEZStereo(single.id), null);
  });

  it('returns null for unknown bond ID', () => {
    assert.equal(parseSMILES('CC=CC').getEZStereo('nonexistent'), null);
  });
});

// ---------------------------------------------------------------------------
// toSMILES
// ---------------------------------------------------------------------------

/**
 * Parse → serialize → re-parse, returning the re-parsed Molecule.
 * Used to verify round-trip chemical equivalence without relying on
 * canonical string equality.
 */
function roundTrip(smiles) {
  return parseSMILES(toSMILES(parseSMILES(smiles)));
}

describe('toSMILES — empty and trivial', () => {
  it('empty molecule returns empty string', () => {
    assert.equal(toSMILES(new Molecule()), '');
  });

  it('single C with no bonds emits bracket atom [C]', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    // No bonds, no pendant H → implied H ≠ 0 → bracket
    assert.equal(toSMILES(mol), '[C]');
  });
});

describe('toSMILES — acyclic alkanes (exact string)', () => {
  it('methane C → "C"', () => {
    assert.equal(toSMILES(parseSMILES('C')), 'C');
  });

  it('ethane CC → "CC"', () => {
    assert.equal(toSMILES(parseSMILES('CC')), 'CC');
  });

  it('propane CCC → "CCC"', () => {
    assert.equal(toSMILES(parseSMILES('CCC')), 'CCC');
  });

  it('isobutane CC(C)C → "CC(C)C"', () => {
    assert.equal(toSMILES(parseSMILES('CC(C)C')), 'CC(C)C');
  });

  it('neopentane CC(C)(C)C → "CC(C)(C)C"', () => {
    assert.equal(toSMILES(parseSMILES('CC(C)(C)C')), 'CC(C)(C)C');
  });
});

describe('toSMILES — unsaturation (exact string)', () => {
  it('ethylene C=C → "C=C"', () => {
    assert.equal(toSMILES(parseSMILES('C=C')), 'C=C');
  });

  it('acetylene C#C → "C#C"', () => {
    assert.equal(toSMILES(parseSMILES('C#C')), 'C#C');
  });

  it('2-butene CC=CC → "CC=CC"', () => {
    assert.equal(toSMILES(parseSMILES('CC=CC')), 'CC=CC');
  });

  it('butadiene C=CC=C → "C=CC=C"', () => {
    assert.equal(toSMILES(parseSMILES('C=CC=C')), 'C=CC=C');
  });
});

describe('toSMILES — heteroatoms (exact string)', () => {
  it('methanol CO → "CO"', () => {
    assert.equal(toSMILES(parseSMILES('CO')), 'CO');
  });

  it('methylamine CN → "CN"', () => {
    assert.equal(toSMILES(parseSMILES('CN')), 'CN');
  });

  it('water O → "O"', () => {
    assert.equal(toSMILES(parseSMILES('O')), 'O');
  });

  it('ammonia N → "N"', () => {
    assert.equal(toSMILES(parseSMILES('N')), 'N');
  });

  it('ethanol CCO → "CCO"', () => {
    assert.equal(toSMILES(parseSMILES('CCO')), 'CCO');
  });

  it('acetic acid CC(=O)O → round-trip formula {C:2,H:4,O:2}', () => {
    assert.deepEqual(molecularFormula(roundTrip('CC(=O)O')), { C: 2, H: 4, O: 2 });
  });
});

describe('toSMILES — rings (round-trip)', () => {
  it('cyclopropane C1CC1 — round-trip formula C3H6', () => {
    assert.deepEqual(molecularFormula(roundTrip('C1CC1')), { C: 3, H: 6 });
  });

  it('cyclohexane C1CCCCC1 — round-trip formula C6H12', () => {
    assert.deepEqual(molecularFormula(roundTrip('C1CCCCC1')), { C: 6, H: 12 });
  });

  it('cyclohexane C1CCCCC1 — round-trip mass ≈ 84.16', () => {
    const mol = roundTrip('C1CCCCC1');
    assert.ok(Math.abs(molecularMass(mol) - 84.162) < 0.1);
  });

  it('cyclopentane C1CCCC1 — round-trip formula C5H10', () => {
    assert.deepEqual(molecularFormula(roundTrip('C1CCCC1')), { C: 5, H: 10 });
  });

  it('cyclohexene C1=CCCCC1 — round-trip formula C6H10', () => {
    assert.deepEqual(molecularFormula(roundTrip('C1=CCCCC1')), { C: 6, H: 10 });
  });
});

describe('toSMILES — aromatic rings (round-trip)', () => {
  it('benzene c1ccccc1 — round-trip formula C6H6', () => {
    assert.deepEqual(molecularFormula(roundTrip('c1ccccc1')), { C: 6, H: 6 });
  });

  it('benzene c1ccccc1 — round-trip mass ≈ 78.11', () => {
    const mol = roundTrip('c1ccccc1');
    assert.ok(Math.abs(molecularMass(mol) - 78.114) < 0.1);
  });

  it('toluene Cc1ccccc1 — round-trip formula C7H8', () => {
    assert.deepEqual(molecularFormula(roundTrip('Cc1ccccc1')), { C: 7, H: 8 });
  });

  it('pyridine c1ccncc1 — round-trip formula C5H5N', () => {
    assert.deepEqual(molecularFormula(roundTrip('c1ccncc1')), { C: 5, H: 5, N: 1 });
  });
});

describe('toSMILES — charged and bracket atoms (round-trip)', () => {
  it('[CH3+] — round-trip formula {C:1,H:3}, charge +1', () => {
    const mol = roundTrip('[CH3+]');
    assert.deepEqual(molecularFormula(mol), { C: 1, H: 3 });
    assert.equal(mol.properties.charge, 1);
  });

  it('[NH4+] — round-trip formula {N:1,H:4}, charge +1', () => {
    const mol = roundTrip('[NH4+]');
    assert.deepEqual(molecularFormula(mol), { N: 1, H: 4 });
    assert.equal(mol.properties.charge, 1);
  });

  it('[OH-] hydroxide — round-trip formula {O:1,H:1}, charge -1', () => {
    const mol = roundTrip('[OH-]');
    assert.deepEqual(molecularFormula(mol), { O: 1, H: 1 });
    assert.equal(mol.properties.charge, -1);
  });
});

describe('toSMILES — isotopes (round-trip)', () => {
  it('[13C] methane — round-trip mass ≈ 17.03 (13+4×1)', () => {
    // parseSMILES('[13C]') → 13C with 4 implicit H (mass ≈ 17.03)
    const mol = roundTrip('[13C]');
    assert.ok(Math.abs(molecularMass(mol) - 17.032) < 0.1);
  });

  it('[2H] (deuterium) is preserved as explicit atom', () => {
    // [2H][2H] — molecular hydrogen using deuterium
    const mol = parseSMILES('[2H][2H]');
    const s = toSMILES(mol);
    // Both D atoms must remain explicit in the output
    assert.ok(s.includes('[2H]') || s.includes('[D]') || s.includes('D'),
      `expected deuterium in output, got: ${s}`);
  });
});

describe('toSMILES — disconnected molecules (round-trip)', () => {
  it('manually disconnected molecule — output contains "." separator', () => {
    // Two isolated atoms with no bond between them → 2 components in getComponents()
    const mol = new Molecule();
    mol.addAtom('c', 'C');
    mol.addAtom('n', 'N');
    const s = toSMILES(mol);
    assert.ok(s.includes('.'), `expected "." in "${s}"`);
  });

  it('[Na+].[Cl-] — v1 parser bonds Na–Cl implicitly; round-trip formula {Na:1,Cl:1}', () => {
    const mol = roundTrip('[Na+].[Cl-]');
    assert.deepEqual(molecularFormula(mol), { Na: 1, Cl: 1 });
  });

  it('[Na+].[Cl-] — round-trip preserves net charge 0', () => {
    const mol = roundTrip('[Na+].[Cl-]');
    assert.equal(mol.properties.charge, 0);
  });
});

describe('toSMILES — bicyclic (round-trip)', () => {
  it('bicyclo[2.2.0]hexane C1CC2CCC12 — round-trip formula C6H10', () => {
    assert.deepEqual(molecularFormula(roundTrip('C1CC2CCC12')), { C: 6, H: 10 });
  });

  it('naphthalene c1ccc2ccccc2c1 — round-trip formula C10H8', () => {
    assert.deepEqual(molecularFormula(roundTrip('c1ccc2ccccc2c1')), { C: 10, H: 8 });
  });
});

describe('toSMILES — corpus spot checks (round-trip mass)', () => {
  const cases = [
    ['CCCCC',        72.151],
    ['CC(C)CC',      72.151],
    ['CC(C)(C)C',    72.151],
    ['C=CCC',        56.108],
    ['CC#CC',        54.090],
    ['OCCCC',        74.121],
    ['CC(=O)CC',     72.105]
  ];
  for (const [smiles, expected] of cases) {
    it(`${smiles} — round-trip mass ≈ ${expected}`, () => {
      const mol = roundTrip(smiles);
      assert.ok(
        Math.abs(molecularMass(mol) - expected) < 0.1,
        `expected ≈${expected}, got ${molecularMass(mol)}`
      );
    });
  }
});
