import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { compileAtomExpr } from '../../src/smarts/primitives.js';
import { parseSMARTS } from '../../src/smarts/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the first non-H atom from a SMILES string. */
function firstAtom(smiles) {
  const mol = parseSMILES(smiles);
  const atom = [...mol.atoms.values()].find(a => a.name !== 'H');
  return { atom, mol };
}

/** Compiles an expression and tests it against the first atom of `smiles`. */
function test(expr, smiles) {
  const { atom, mol } = firstAtom(smiles);
  return compileAtomExpr(expr)(atom, mol);
}

// ---------------------------------------------------------------------------
// Wildcard
// ---------------------------------------------------------------------------

describe('compileAtomExpr — wildcard', () => {
  it('* matches carbon', () => assert.equal(test('*', 'C'), true));
  it('* matches nitrogen', () => assert.equal(test('*', 'N'), true));
  it('* matches oxygen', () => assert.equal(test('*', 'O'), true));
});

// ---------------------------------------------------------------------------
// Element symbols
// ---------------------------------------------------------------------------

describe('compileAtomExpr — element symbol', () => {
  it('C matches carbon', () => assert.equal(test('C', 'CC'), true));
  it('N matches nitrogen', () => assert.equal(test('N', 'N'), true));
  it('C does not match nitrogen', () => assert.equal(test('C', 'N'), false));
  it('O matches oxygen', () => assert.equal(test('O', 'O'), true));
  it('Cl matches chlorine', () => {
    const mol = parseSMILES('CCl');
    const cl = [...mol.atoms.values()].find(a => a.name === 'Cl');
    assert.equal(compileAtomExpr('Cl')(cl, mol), true);
  });
  it('Br matches bromine', () => {
    const mol = parseSMILES('CBr');
    const br = [...mol.atoms.values()].find(a => a.name === 'Br');
    assert.equal(compileAtomExpr('Br')(br, mol), true);
  });
});

// ---------------------------------------------------------------------------
// Aromaticity: a / A
// ---------------------------------------------------------------------------

describe('compileAtomExpr — aromaticity primitives', () => {
  it('a matches aromatic carbon in benzene', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('a')(atom, mol), true);
  });

  it('a does not match aliphatic carbon', () => assert.equal(test('a', 'CC'), false));

  it('A matches aliphatic carbon', () => assert.equal(test('A', 'CC'), true));

  it('A does not match aromatic carbon', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('A')(atom, mol), false);
  });
});

// ---------------------------------------------------------------------------
// Atomic number (#n)
// ---------------------------------------------------------------------------

describe('compileAtomExpr — atomic number #n', () => {
  it('#6 matches carbon', () => assert.equal(test('#6', 'CC'), true));
  it('#6 does not match nitrogen', () => assert.equal(test('#6', 'N'), false));
  it('#7 matches nitrogen', () => assert.equal(test('#7', 'N'), true));
  it('#8 matches oxygen', () => assert.equal(test('#8', 'O'), true));
});

// ---------------------------------------------------------------------------
// Formal charge
// ---------------------------------------------------------------------------

describe('compileAtomExpr — formal charge', () => {
  it('+1 matches [NH4+]', () => {
    const mol = parseSMILES('[NH4+]');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('+1')(atom, mol), true);
  });

  it('+ (any positive) matches [NH4+]', () => {
    const mol = parseSMILES('[NH4+]');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('+')(atom, mol), true);
  });

  it('+1 does not match neutral N', () => assert.equal(test('+1', 'N'), false));

  it('-1 matches [OH-]', () => {
    const mol = parseSMILES('[OH-]');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('-1')(atom, mol), true);
  });

  it('- (any negative) matches [OH-]', () => {
    const mol = parseSMILES('[OH-]');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('-')(atom, mol), true);
  });

  it('-1 does not match neutral O', () => assert.equal(test('-1', 'O'), false));
});

describe('compileAtomExpr — bracket hydrogen semantics', () => {
  it('[H] matches elemental hydrogen, not hetero atoms with one H', () => {
    const h2 = parseSMILES('[H][H]');
    const h = [...h2.atoms.values()].find(a => a.name === 'H');
    assert.equal(compileAtomExpr('H')(h, h2), true);

    const hydroxide = parseSMILES('[OH-]');
    const o = [...hydroxide.atoms.values()].find(a => a.name === 'O');
    assert.equal(compileAtomExpr('H')(o, hydroxide), false);
  });

  it('[H+] matches proton via element + charge semantics', () => {
    const proton = parseSMILES('[H+]');
    const h = proton.atoms.values().next().value;
    assert.equal(compileAtomExpr('H+')(h, proton), true);
  });
});

// ---------------------------------------------------------------------------
// Degree (D)
// ---------------------------------------------------------------------------

describe('compileAtomExpr — degree D', () => {
  it('D1 matches terminal carbon of ethane', () => {
    const mol = parseSMILES('CC');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('D1')(atom, mol), true);
  });

  it('D3 matches the branch carbon of propane (center)', () => {
    // propane: C-C-C, center has D2 not D3
    const mol = parseSMILES('CC(C)C'); // isobutane center = D3
    const center = [...mol.atoms.values()].find(a => {
      let cnt = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const [x, y] = b.atoms;
        const nb = mol.atoms.get(x === a.id ? y : x);
        if (nb && nb.name !== 'H') {
          cnt++;
        }
      }
      return cnt === 3;
    });
    assert.ok(center, 'isobutane has a D3 center');
    assert.equal(compileAtomExpr('D3')(center, mol), true);
  });

  it('D matches as D1 by default', () => {
    const mol = parseSMILES('CC');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('D')(atom, mol), true);
  });
});

// ---------------------------------------------------------------------------
// Ring membership (R)
// ---------------------------------------------------------------------------

describe('compileAtomExpr — ring R', () => {
  it('R matches atom in benzene ring', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('R')(atom, mol), true);
  });

  it('R does not match terminal carbon of propane', () => {
    const mol = parseSMILES('CCC');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('R')(atom, mol), false);
  });
});

// ---------------------------------------------------------------------------
// Logical operators
// ---------------------------------------------------------------------------

describe('compileAtomExpr — NOT', () => {
  it('!C does not match carbon', () => assert.equal(test('!C', 'CC'), false));
  it('!C matches nitrogen', () => assert.equal(test('!C', 'N'), true));
  it('!!C matches carbon (double negation)', () => assert.equal(test('!!C', 'CC'), true));
});

describe('compileAtomExpr — OR', () => {
  it('C,N matches carbon', () => assert.equal(test('C,N', 'CC'), true));
  it('C,N matches nitrogen', () => assert.equal(test('C,N', 'N'), true));
  it('C,N does not match oxygen', () => assert.equal(test('C,N', 'O'), false));
});

describe('compileAtomExpr — AND (low precedence ;)', () => {
  it('C;A matches aliphatic carbon', () => assert.equal(test('C;A', 'CC'), true));
  it('C;A does not match aromatic carbon', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('C;A')(atom, mol), false);
  });
});

describe('compileAtomExpr — precedence', () => {
  it('C,N;!R — C OR (N AND not-ring), not (C OR N) AND not-ring', () => {
    // Aliphatic ring carbon: C=true, !R=false → C OR (N;!R)=true, but (C,N);!R=false
    // This distinguishes the two possible precedence parsings.
    const mol = parseSMILES('C1CCCCC1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('C,N;!R')(atom, mol), true);
  });

  it('C,N;!R — aliphatic C matches (C branch of OR)', () => {
    assert.equal(test('C,N;!R', 'CC'), true);
  });
});

// ---------------------------------------------------------------------------
// Valence (v) and connectivity (X)
// ---------------------------------------------------------------------------

describe('compileAtomExpr — valence v and connectivity X', () => {
  it('v4 matches carbon in methane (valence 4 with H present)', () => {
    // Use non-stripped methane so H bonds are present
    const mol = parseSMILES('C');
    const atom = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(compileAtomExpr('v4')(atom, mol), true);
  });

  it('X4 matches carbon in methane (connectivity 4 with H)', () => {
    const mol = parseSMILES('C');
    const atom = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(compileAtomExpr('X4')(atom, mol), true);
  });

  it('X2 matches carbonyl carbon in CO2 (2 bonds, no H)', () => {
    const mol = parseSMILES('O=C=O');
    const atom = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(compileAtomExpr('X2')(atom, mol), true);
  });
});

// ---------------------------------------------------------------------------
// R<n> ring count
// ---------------------------------------------------------------------------

describe('compileAtomExpr — R0 / R1 / R2', () => {
  it('R0 matches non-ring atom in propane', () => {
    const mol = parseSMILES('CCC');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('R0')(atom, mol), true);
  });

  it('R0 does not match ring atom in benzene', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('R0')(atom, mol), false);
  });

  it('R1 matches atom in benzene (in exactly one ring)', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('R1')(atom, mol), true);
  });

  it('R2 matches bridgehead atom in naphthalene', () => {
    const mol = parseSMILES('c1ccc2ccccc2c1');
    // bridgehead atoms have exactly 3 heavy-atom neighbors
    const bridgehead = [...mol.atoms.values()].find(a => {
      let cnt = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const [x, y] = b.atoms;
        const nb = mol.atoms.get(x === a.id ? y : x);
        if (nb && nb.name !== 'H') {
          cnt++;
        }
      }
      return cnt === 3;
    });
    assert.ok(bridgehead, 'naphthalene has a bridgehead atom');
    assert.equal(compileAtomExpr('R2')(bridgehead, mol), true);
  });
});

// ---------------------------------------------------------------------------
// r<n> ring size
// ---------------------------------------------------------------------------

describe('compileAtomExpr — r<n> ring size', () => {
  it('r6 matches benzene atom (6-membered ring)', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('r6')(atom, mol), true);
  });

  it('r6 does not match cyclopentane atom', () => {
    const mol = parseSMILES('C1CCCC1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('r6')(atom, mol), false);
  });

  it('r5 matches cyclopentane atom', () => {
    const mol = parseSMILES('C1CCCC1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('r5')(atom, mol), true);
  });

  it('r3 matches cyclopropane atom', () => {
    const mol = parseSMILES('C1CC1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('r3')(atom, mol), true);
  });

  it('r (bare) matches any ring atom', () => {
    const mol = parseSMILES('C1CCCCC1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('r')(atom, mol), true);
  });

  it('r (bare) does not match non-ring atom', () => {
    const mol = parseSMILES('CCC');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('r')(atom, mol), false);
  });
});

// ---------------------------------------------------------------------------
// $() recursive SMARTS
// ---------------------------------------------------------------------------

describe('compileAtomExpr — $() recursive SMARTS', () => {
  it('$([R]) matches ring atom in benzene', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('$([R])', { parseFn: parseSMARTS })(atom, mol), true);
  });

  it('$([R]) does not match non-ring atom in propane', () => {
    const mol = parseSMILES('CCC');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('$([R])', { parseFn: parseSMARTS })(atom, mol), false);
  });

  it('$([C]) matches carbon via recursive SMARTS', () => {
    const mol = parseSMILES('CC');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('$([C])', { parseFn: parseSMARTS })(atom, mol), true);
  });

  it('without parseFn, $() always returns false', () => {
    const mol = parseSMILES('c1ccccc1');
    const atom = mol.atoms.values().next().value;
    assert.equal(compileAtomExpr('$([R])')(atom, mol), false);
  });
});
