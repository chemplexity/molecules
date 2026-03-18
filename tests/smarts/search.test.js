import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { findSMARTS, matchesSMARTS, firstSMARTS, parseSMARTS } from '../../src/smarts/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mol(smiles) {
  return parseSMILES(smiles).stripHydrogens();
}

function collectAll(gen) {
  const out = [];
  for (const m of gen) {
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// matchesSMARTS — basic functional groups
// ---------------------------------------------------------------------------

describe('matchesSMARTS — functional groups', () => {
  it('hydroxyl [OH] found in methanol', () => {
    // Methanol has explicit H; use non-stripped
    const m = parseSMILES('CO');
    assert.equal(matchesSMARTS(m, '[OH]'), true);
  });

  it('carbonyl [C]=O found in acetaldehyde', () => {
    assert.equal(matchesSMARTS(mol('CC=O'), '[C]=[O]'), true);
  });

  it('carbonyl not found in ethane', () => {
    assert.equal(matchesSMARTS(mol('CC'), '[C]=[O]'), false);
  });

  it('nitrogen found in methylamine', () => {
    assert.equal(matchesSMARTS(mol('CN'), '[N]'), true);
  });

  it('carboxylic acid pattern found in acetic acid', () => {
    // [CX3](=O)[OH] — but we need H on the OH, use non-stripped
    const m = parseSMILES('CC(=O)O');
    assert.equal(matchesSMARTS(m, '[C](=O)[OH]'), true);
  });

  it('carboxylic acid pattern not found in methyl acetate (no OH)', () => {
    // methyl acetate CC(=O)OC — O has no H
    const m = parseSMILES('CC(=O)OC');
    assert.equal(matchesSMARTS(m, '[C](=O)[OH]'), false);
  });
});

// ---------------------------------------------------------------------------
// matchesSMARTS — aromatic patterns
// ---------------------------------------------------------------------------

describe('matchesSMARTS — aromatic patterns', () => {
  it('bare c (aromatic C) found in benzene', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), 'c'), true);
  });

  it('bare c NOT found in cyclohexane', () => {
    assert.equal(matchesSMARTS(mol('C1CCCCC1'), 'c'), false);
  });

  it('benzene ring c1ccccc1 found in benzene', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), 'c1ccccc1'), true);
  });

  it('benzene ring found in naphthalene', () => {
    assert.equal(matchesSMARTS(mol('c1ccc2ccccc2c1'), 'c1ccccc1'), true);
  });

  it('benzene ring NOT found in cyclohexane', () => {
    assert.equal(matchesSMARTS(mol('C1CCCCC1'), 'c1ccccc1'), false);
  });

  it('[#6;a] (aromatic carbon by atomic number) found in benzene', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[#6;a]'), true);
  });

  it('[#6;A] (aliphatic carbon) NOT found in benzene', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[#6;A]'), false);
  });
});

// ---------------------------------------------------------------------------
// matchesSMARTS — bond primitives
// ---------------------------------------------------------------------------

describe('matchesSMARTS — explicit bond primitives', () => {
  it('C=C found in ethene', () => {
    assert.equal(matchesSMARTS(mol('C=C'), 'C=C'), true);
  });

  it('C=C NOT found in ethane', () => {
    assert.equal(matchesSMARTS(mol('CC'), 'C=C'), false);
  });

  it('C#C found in acetylene', () => {
    assert.equal(matchesSMARTS(mol('C#C'), 'C#C'), true);
  });

  it('C~C (any bond) found in both ethane and ethene', () => {
    assert.equal(matchesSMARTS(mol('CC'), 'C~C'), true);
    assert.equal(matchesSMARTS(mol('C=C'), 'C~C'), true);
  });

  it('aromatic bond c:c found in benzene', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), 'c:c'), true);
  });
});

// ---------------------------------------------------------------------------
// matchesSMARTS — ring atoms [R]
// ---------------------------------------------------------------------------

describe('matchesSMARTS — ring atoms', () => {
  it('[R] found in cyclohexane', () => {
    assert.equal(matchesSMARTS(mol('C1CCCCC1'), '[R]'), true);
  });

  it('[R] NOT found in propane', () => {
    assert.equal(matchesSMARTS(mol('CCC'), '[R]'), false);
  });

  it('[C;R] (ring carbon) found in cyclopropane', () => {
    assert.equal(matchesSMARTS(mol('C1CC1'), '[C;R]'), true);
  });

  it('[C;!R] (non-ring carbon) found in propane', () => {
    assert.equal(matchesSMARTS(mol('CCC'), '[C;!R]'), true);
  });

  it('[C;!R] NOT found in cyclopropane (all carbons are in ring)', () => {
    assert.equal(matchesSMARTS(mol('C1CC1'), '[C;!R]'), false);
  });
});

// ---------------------------------------------------------------------------
// matchesSMARTS — charge queries
// ---------------------------------------------------------------------------

describe('matchesSMARTS — charge primitives', () => {
  it('[+1] found in [NH4+]', () => {
    assert.equal(matchesSMARTS(mol('[NH4+]'), '[+1]'), true);
  });

  it('[+] found in [NH4+]', () => {
    assert.equal(matchesSMARTS(mol('[NH4+]'), '[+]'), true);
  });

  it('[-1] found in [OH-]', () => {
    assert.equal(matchesSMARTS(mol('[OH-]'), '[-1]'), true);
  });

  it('[+1] NOT found in neutral methane', () => {
    assert.equal(matchesSMARTS(mol('C'), '[+1]'), false);
  });
});

// ---------------------------------------------------------------------------
// matchesSMARTS — wildcard
// ---------------------------------------------------------------------------

describe('matchesSMARTS — wildcard *', () => {
  it('bare * matches any atom', () => {
    assert.equal(matchesSMARTS(mol('C'), '*'), true);
    assert.equal(matchesSMARTS(mol('N'), '*'), true);
    assert.equal(matchesSMARTS(mol('[Na+]'), '*'), true);
  });

  it('[*] matches any atom', () => {
    assert.equal(matchesSMARTS(mol('C'), '[*]'), true);
  });
});

// ---------------------------------------------------------------------------
// findSMARTS — count of matches
// ---------------------------------------------------------------------------

describe('findSMARTS — match counts', () => {
  it('C in propane yields 3 matches (one per carbon)', () => {
    assert.equal(collectAll(findSMARTS(mol('CCC'), 'C')).length, 3);
  });

  it('C=C in butadiene yields 4 directed matches (2 bonds × 2 dirs)', () => {
    // butadiene: C=CC=C — 2 double bonds, each yields 2 directed matches
    const results = collectAll(findSMARTS(mol('C=CC=C'), 'C=C'));
    assert.equal(results.length, 4);
  });

  it('c in benzene yields 6 matches', () => {
    assert.equal(collectAll(findSMARTS(mol('c1ccccc1'), 'c')).length, 6);
  });
});

// ---------------------------------------------------------------------------
// firstSMARTS
// ---------------------------------------------------------------------------

describe('firstSMARTS', () => {
  it('returns a Map when found', () => {
    const m = firstSMARTS(mol('CCC'), 'C');
    assert.ok(m instanceof Map);
    assert.equal(m.size, 1);
  });

  it('returns null when not found', () => {
    assert.equal(firstSMARTS(mol('CCC'), 'N'), null);
  });
});

// ---------------------------------------------------------------------------
// parseSMARTS — structure of the query molecule
// ---------------------------------------------------------------------------

describe('parseSMARTS — query molecule structure', () => {
  it('single atom query has 1 atom and 0 bonds', () => {
    const q = parseSMARTS('C');
    assert.equal(q.atoms.size, 1);
    assert.equal(q.bonds.size, 0);
  });

  it('two-atom query has 2 atoms and 1 bond', () => {
    const q = parseSMARTS('CC');
    assert.equal(q.atoms.size, 2);
    assert.equal(q.bonds.size, 1);
  });

  it('ring query c1ccccc1 has 6 atoms and 6 bonds', () => {
    const q = parseSMARTS('c1ccccc1');
    assert.equal(q.atoms.size, 6);
    assert.equal(q.bonds.size, 6);
  });

  it('branch query C(C)C has 3 atoms and 2 bonds', () => {
    const q = parseSMARTS('C(C)C');
    assert.equal(q.atoms.size, 3);
    assert.equal(q.bonds.size, 2);
  });

  it('bracket atom [NH2] has _predicate set', () => {
    const q = parseSMARTS('[NH2]');
    const atom = q.atoms.values().next().value;
    assert.equal(typeof atom._predicate, 'function');
  });
});

// ---------------------------------------------------------------------------
// Molecule instance methods
// ---------------------------------------------------------------------------

describe('Molecule SMARTS instance methods', () => {
  it('mol.matchesSMARTS(smarts) returns true when found', () => {
    assert.equal(mol('c1ccccc1').matchesSMARTS('c'), true);
  });

  it('mol.matchesSMARTS(smarts) returns false when not found', () => {
    assert.equal(mol('CCC').matchesSMARTS('N'), false);
  });

  it('mol.firstSMARTS(smarts) returns Map or null', () => {
    const m = mol('CC').firstSMARTS('C');
    assert.ok(m instanceof Map);
    assert.equal(mol('CC').firstSMARTS('N'), null);
  });

  it('mol.findSMARTS(smarts) is iterable', () => {
    const gen = mol('CC').findSMARTS('C');
    assert.equal(typeof gen[Symbol.iterator], 'function');
    assert.equal(collectAll(gen).length, 2);
  });

  it('mol.querySMARTS(smarts) returns an array', () => {
    const result = mol('CCC').querySMARTS('C');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 3);
  });
});

// ---------------------------------------------------------------------------
// OR and complex expressions
// ---------------------------------------------------------------------------

describe('matchesSMARTS — complex expressions', () => {
  it('[C,N] matches carbon in ethane', () => {
    assert.equal(matchesSMARTS(mol('CC'), '[C,N]'), true);
  });

  it('[C,N] matches nitrogen in methylamine', () => {
    assert.equal(matchesSMARTS(mol('CN'), '[C,N]'), true);
  });

  it('[!#6] (not carbon) found in pyridine (has N)', () => {
    assert.equal(matchesSMARTS(mol('c1ccncc1'), '[!#6]'), true);
  });

  it('[!#6] NOT found in benzene (all C)', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[!#6]'), false);
  });

  it('[#6;a] aromatic carbon found in toluene ring', () => {
    assert.equal(matchesSMARTS(mol('Cc1ccccc1'), '[#6;a]'), true);
  });

  it('[D3] branch point found in isobutane', () => {
    assert.equal(matchesSMARTS(mol('CC(C)C'), '[D3]'), true);
  });

  it('[D3] NOT found in propane (max degree 2)', () => {
    assert.equal(matchesSMARTS(mol('CCC'), '[D3]'), false);
  });
});

// ---------------------------------------------------------------------------
// R<n> ring count
// ---------------------------------------------------------------------------

describe('matchesSMARTS — R<n> ring count', () => {
  it('[R0] (not in ring) found in propane', () => {
    assert.equal(matchesSMARTS(mol('CCC'), '[R0]'), true);
  });

  it('[R0] NOT found in benzene (all atoms in ring)', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[R0]'), false);
  });

  it('[R1] found in benzene (each atom in exactly one ring)', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[R1]'), true);
  });

  it('[R2] found in naphthalene bridgehead (atom in two rings)', () => {
    // naphthalene: bridgehead carbons are each in 2 rings
    assert.equal(matchesSMARTS(mol('c1ccc2ccccc2c1'), '[R2]'), true);
  });

  it('[R2] NOT found in benzene (each atom in only one ring)', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[R2]'), false);
  });
});

// ---------------------------------------------------------------------------
// r<n> ring size
// ---------------------------------------------------------------------------

describe('matchesSMARTS — r<n> ring size', () => {
  it('[r6] found in benzene (6-membered ring)', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[r6]'), true);
  });

  it('[r6] NOT found in cyclopentane (5-membered ring)', () => {
    assert.equal(matchesSMARTS(mol('C1CCCC1'), '[r6]'), false);
  });

  it('[r5] found in cyclopentane', () => {
    assert.equal(matchesSMARTS(mol('C1CCCC1'), '[r5]'), true);
  });

  it('[r3] found in cyclopropane', () => {
    assert.equal(matchesSMARTS(mol('C1CC1'), '[r3]'), true);
  });

  it('[r5] found in indene ring system (has 5-membered ring)', () => {
    // indene: c1ccc2cccc2c1 — fused 6+5 ring
    assert.equal(matchesSMARTS(mol('C1=CC2=CC=CC=C2C1'), '[r5]'), true);
  });

  it('[r] (bare, any ring) found in cyclohexane', () => {
    assert.equal(matchesSMARTS(mol('C1CCCCC1'), '[r]'), true);
  });

  it('[r] NOT found in propane', () => {
    assert.equal(matchesSMARTS(mol('CCC'), '[r]'), false);
  });
});

// ---------------------------------------------------------------------------
// @ ring bond
// ---------------------------------------------------------------------------

describe('matchesSMARTS — @ ring bond', () => {
  it('C@C (ring bond) found in cyclohexane', () => {
    assert.equal(matchesSMARTS(mol('C1CCCCC1'), 'C@C'), true);
  });

  it('C@C NOT found in propane (no ring bonds)', () => {
    assert.equal(matchesSMARTS(mol('CCC'), 'C@C'), false);
  });

  it('c@c found in benzene', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), 'c@c'), true);
  });
});

// ---------------------------------------------------------------------------
// $() recursive SMARTS
// ---------------------------------------------------------------------------

describe('matchesSMARTS — $() recursive SMARTS', () => {
  it('[$([R])] matches ring atom (same as [R])', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[$([R])]'), true);
    assert.equal(matchesSMARTS(mol('CCC'), '[$([R])]'), false);
  });

  it('[$([CX4])] matches sp3 carbon in ethane', () => {
    // CX4 = carbon with 4 connections (including H)
    const m = parseSMILES('CC'); // keep H
    assert.equal(matchesSMARTS(m, '[$([CX4])]'), true);
  });

  it('[$([c]1[c][c][c][c][c]1)] phenyl fragment found in benzene', () => {
    assert.equal(matchesSMARTS(mol('c1ccccc1'), '[$([c]1ccccc1)]'), true);
  });

  it('[$([c]1[c][c][c][c][c]1)] NOT found in cyclohexane', () => {
    assert.equal(matchesSMARTS(mol('C1CCCCC1'), '[$([c]1ccccc1)]'), false);
  });
});
