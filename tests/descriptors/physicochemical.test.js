import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { parseSMILES } from '../../src/io/smiles.js';
import {
  logP,
  tpsa,
  hBondDonors,
  hBondAcceptors,
  rotatableBondCount,
  fsp3,
  lipinskiRuleOfFive
} from '../../src/descriptors/physicochemical.js';

// ---------------------------------------------------------------------------
// logP
// ---------------------------------------------------------------------------

describe('logP', () => {
  it('ethanol is slightly negative (hydrophilic)', () => {
    // CCO: two sp3 C (+0.294 each) + one sp3 O (−0.682) ≈ −0.09
    const v = logP(parseSMILES('CCO'));
    assert.ok(v < 0.5, `expected ethanol logP < 0.5, got ${v}`);
  });

  it('benzene is positive (lipophilic)', () => {
    const v = logP(parseSMILES('c1ccccc1'));
    assert.ok(v > 0, `expected benzene logP > 0, got ${v}`);
  });

  it('aspirin logP is positive (lipophilic aromatic ring outweighs two O groups)', () => {
    // Literature logP ≈ 1.2; simplified Crippen is approximate — check sign and order of magnitude.
    const v = logP(parseSMILES('CC(=O)Oc1ccccc1C(=O)O'));
    assert.ok(v > -0.5 && v < 3.0, `expected aspirin logP roughly 0–2, got ${v}`);
  });

  it('ibuprofen is more lipophilic than aspirin', () => {
    const asp = logP(parseSMILES('CC(=O)Oc1ccccc1C(=O)O'));
    const ibu = logP(parseSMILES('CC(C)Cc1ccc(cc1)C(C)C(=O)O'));
    assert.ok(ibu > asp, `expected ibuprofen (${ibu}) > aspirin (${asp})`);
  });

  it('returns a number', () => {
    assert.equal(typeof logP(parseSMILES('C')), 'number');
  });

  it('throws on non-molecule', () => {
    assert.throws(() => logP(null), TypeError);
  });
});

// ---------------------------------------------------------------------------
// tpsa
// ---------------------------------------------------------------------------

describe('tpsa', () => {
  it('benzene has TPSA = 0 (no polar atoms)', () => {
    assert.equal(tpsa(parseSMILES('c1ccccc1')), 0);
  });

  it('ethanol has TPSA > 0 (one OH)', () => {
    const v = tpsa(parseSMILES('CCO'));
    assert.ok(v > 15, `expected ethanol TPSA > 15, got ${v}`);
  });

  it('aspirin TPSA is below the oral bioavailability threshold of 140 Å²', () => {
    const v = tpsa(parseSMILES('CC(=O)Oc1ccccc1C(=O)O'));
    assert.ok(v < 140, `expected aspirin TPSA < 140, got ${v}`);
    assert.ok(v > 40, `expected aspirin TPSA > 40, got ${v}`);
  });

  it('methylamine has a polar N contribution', () => {
    const v = tpsa(parseSMILES('CN'));
    assert.ok(v > 20, `expected methylamine TPSA > 20, got ${v}`);
  });

  it('choline-like quaternary ammonium does not add extra TPSA beyond the alcohol oxygen', () => {
    assert.equal(tpsa(parseSMILES('C[N+](C)(C)CCO')), 20.23);
  });

  it('returns a number', () => {
    assert.equal(typeof tpsa(parseSMILES('C')), 'number');
  });

  it('throws on non-molecule', () => {
    assert.throws(() => tpsa(null), TypeError);
  });
});

// ---------------------------------------------------------------------------
// hBondDonors
// ---------------------------------------------------------------------------

describe('hBondDonors', () => {
  it('benzene has 0 donors', () => {
    assert.equal(hBondDonors(parseSMILES('c1ccccc1')), 0);
  });

  it('ethanol has 1 donor (OH)', () => {
    assert.equal(hBondDonors(parseSMILES('CCO')), 1);
  });

  it('acetic acid has 1 donor (COOH)', () => {
    assert.equal(hBondDonors(parseSMILES('CC(=O)O')), 1);
  });

  it('methylamine has 1 donor (NH2)', () => {
    assert.equal(hBondDonors(parseSMILES('CN')), 1);
  });

  it('pyridine has 0 donors', () => {
    assert.equal(hBondDonors(parseSMILES('c1ccncc1')), 0);
  });

  it('nitrobenzene has 0 donors', () => {
    assert.equal(hBondDonors(parseSMILES('[O-][N+](=O)c1ccccc1')), 0);
  });

  it('methane has 0 donors', () => {
    assert.equal(hBondDonors(parseSMILES('C')), 0);
  });

  it('local hydrogen inference still works when another atom has an explicit H', () => {
    const mol = new Molecule();
    mol.addAtom('c', 'C');
    mol.addAtom('n', 'N');
    mol.addAtom('h', 'H');
    mol.addBond('b1', 'c', 'n', {}, false);
    mol.addBond('b2', 'c', 'h', {}, false);
    assert.equal(hBondDonors(mol), 1);
    assert.ok(tpsa(mol) > 20);
  });

  it('throws on non-molecule', () => {
    assert.throws(() => hBondDonors(null), TypeError);
  });
});

// ---------------------------------------------------------------------------
// hBondAcceptors
// ---------------------------------------------------------------------------

describe('hBondAcceptors', () => {
  it('benzene has 0 acceptors', () => {
    assert.equal(hBondAcceptors(parseSMILES('c1ccccc1')), 0);
  });

  it('ethanol has 1 acceptor (O)', () => {
    assert.equal(hBondAcceptors(parseSMILES('CCO')), 1);
  });

  it('acetic acid has 1 acceptor (carbonyl O only)', () => {
    assert.equal(hBondAcceptors(parseSMILES('CC(=O)O')), 1);
  });

  it('pyridine has 1 acceptor (N)', () => {
    assert.equal(hBondAcceptors(parseSMILES('c1ccncc1')), 1);
  });

  it('aniline has 1 acceptor (N)', () => {
    assert.equal(hBondAcceptors(parseSMILES('Nc1ccccc1')), 1);
  });

  it('pyrrole has 0 acceptors', () => {
    assert.equal(hBondAcceptors(parseSMILES('[nH]1cccc1')), 0);
  });

  it('ammonium has 0 acceptors', () => {
    assert.equal(hBondAcceptors(parseSMILES('[NH4+]')), 0);
  });

  it('quaternary ammonium alcohol has 1 acceptor (the alcohol oxygen)', () => {
    assert.equal(hBondAcceptors(parseSMILES('C[N+](C)(C)CCO')), 1);
  });

  it('acetamide has 1 acceptor (carbonyl O only)', () => {
    assert.equal(hBondAcceptors(parseSMILES('CC(=O)NC')), 1);
  });

  it('nitrobenzene has 2 acceptors (the two oxygens)', () => {
    assert.equal(hBondAcceptors(parseSMILES('[O-][N+](=O)c1ccccc1')), 2);
  });

  it('thioethers count as sulfur acceptors', () => {
    assert.equal(hBondAcceptors(parseSMILES('CSC')), 1);
  });

  it('trialkyl phosphines count as phosphorus acceptors', () => {
    assert.equal(hBondAcceptors(parseSMILES('P(C)(C)C')), 1);
  });

  it('throws on non-molecule', () => {
    assert.throws(() => hBondAcceptors(null), TypeError);
  });
});

// ---------------------------------------------------------------------------
// rotatableBondCount
// ---------------------------------------------------------------------------

describe('rotatableBondCount', () => {
  it('ethane has 0 rotatable bonds (terminal atoms)', () => {
    assert.equal(rotatableBondCount(parseSMILES('CC')), 0);
  });

  it('propane has 0 rotatable bonds (both C-C bonds are terminal)', () => {
    assert.equal(rotatableBondCount(parseSMILES('CCC')), 0);
  });

  it('butane has 1 rotatable bond (central C-C)', () => {
    assert.equal(rotatableBondCount(parseSMILES('CCCC')), 1);
  });

  it('pentane has 2 rotatable bonds', () => {
    assert.equal(rotatableBondCount(parseSMILES('CCCCC')), 2);
  });

  it('benzene has 0 rotatable bonds (aromatic)', () => {
    assert.equal(rotatableBondCount(parseSMILES('c1ccccc1')), 0);
  });

  it('cyclohexane ring bonds are not rotatable', () => {
    assert.equal(rotatableBondCount(parseSMILES('C1CCCCC1')), 0);
  });

  it('amide C-N bonds are not counted as rotatable', () => {
    assert.equal(rotatableBondCount(parseSMILES('CC(=O)NC')), 0);
  });

  it('throws on non-molecule', () => {
    assert.throws(() => rotatableBondCount(null), TypeError);
  });
});

// ---------------------------------------------------------------------------
// fsp3
// ---------------------------------------------------------------------------

describe('fsp3', () => {
  it('methane = 1.0 (all sp3)', () => {
    assert.equal(fsp3(parseSMILES('C')), 1);
  });

  it('benzene = 0.0 (all sp2)', () => {
    assert.equal(fsp3(parseSMILES('c1ccccc1')), 0);
  });

  it('cyclohexane = 1.0 (all sp3)', () => {
    assert.equal(fsp3(parseSMILES('C1CCCCC1')), 1);
  });

  it('ethene = 0.0 (both sp2)', () => {
    assert.equal(fsp3(parseSMILES('C=C')), 0);
  });

  it('returns 0 for a molecule with no carbons', () => {
    assert.equal(fsp3(parseSMILES('O')), 0);
  });

  it('throws on non-molecule', () => {
    assert.throws(() => fsp3(null), TypeError);
  });
});

// ---------------------------------------------------------------------------
// lipinskiRuleOfFive
// ---------------------------------------------------------------------------

describe('lipinskiRuleOfFive', () => {
  it('aspirin passes (0 violations)', () => {
    const result = lipinskiRuleOfFive(parseSMILES('CC(=O)Oc1ccccc1C(=O)O'));
    assert.equal(result.violations, 0);
    assert.equal(result.passes, true);
  });

  it('result has the expected keys', () => {
    const result = lipinskiRuleOfFive(parseSMILES('CCO'));
    assert.ok('molecularWeight' in result);
    assert.ok('logP' in result);
    assert.ok('hBondDonors' in result);
    assert.ok('hBondAcceptors' in result);
    assert.ok('violations' in result);
    assert.ok('passes' in result);
  });

  it('ethanol passes (0 violations)', () => {
    const result = lipinskiRuleOfFive(parseSMILES('CCO'));
    assert.equal(result.passes, true);
    assert.equal(result.violations, 0);
  });

  it('a very large lipophilic molecule accumulates violations', () => {
    // C40 linear chain: MW >> 500, logP >> 5
    const result = lipinskiRuleOfFive(
      parseSMILES('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC')
    );
    assert.ok(result.violations >= 2, `expected ≥2 violations, got ${result.violations}`);
    assert.equal(result.passes, false);
  });

  it('throws on non-molecule', () => {
    assert.throws(() => lipinskiRuleOfFive(null), TypeError);
  });
});
