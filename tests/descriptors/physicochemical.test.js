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
  ringCount,
  aromaticRingCount,
  stereocenters,
  veberRules,
  lipinskiRuleOfFive
} from '../../src/descriptors/physicochemical.js';

function sortedIds(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

function ringAtomSets(mol) {
  return mol
    .getRings()
    .map(ring => sortedIds(ring))
    .sort((a, b) => a.length - b.length || a.join('\u0000').localeCompare(b.join('\u0000')));
}

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
    assert.deepEqual(hBondDonors(parseSMILES('c1ccccc1')), { count: 0, atoms: [] });
  });

  it('ethanol has 1 donor (OH)', () => {
    const mol = parseSMILES('CCO');
    const oxygenId = [...mol.atoms.values()].find(atom => atom.name === 'O').id;
    assert.deepEqual(hBondDonors(mol), { count: 1, atoms: [oxygenId] });
  });

  it('acetic acid has 1 donor (COOH)', () => {
    const mol = parseSMILES('CC(=O)O');
    const donorId = [...mol.atoms.values()].find(atom => atom.name === 'O' && atom.getHydrogenNeighbors(mol).length > 0).id;
    assert.deepEqual(hBondDonors(mol), { count: 1, atoms: [donorId] });
  });

  it('methylamine has 1 donor (NH2)', () => {
    const mol = parseSMILES('CN');
    const nitrogenId = [...mol.atoms.values()].find(atom => atom.name === 'N').id;
    assert.deepEqual(hBondDonors(mol), { count: 1, atoms: [nitrogenId] });
  });

  it('pyridine has 0 donors', () => {
    assert.deepEqual(hBondDonors(parseSMILES('c1ccncc1')), { count: 0, atoms: [] });
  });

  it('nitrobenzene has 0 donors', () => {
    assert.deepEqual(hBondDonors(parseSMILES('[O-][N+](=O)c1ccccc1')), { count: 0, atoms: [] });
  });

  it('methane has 0 donors', () => {
    assert.deepEqual(hBondDonors(parseSMILES('C')), { count: 0, atoms: [] });
  });

  it('local hydrogen inference still works when another atom has an explicit H', () => {
    const mol = new Molecule();
    mol.addAtom('c', 'C');
    mol.addAtom('n', 'N');
    mol.addAtom('h', 'H');
    mol.addBond('b1', 'c', 'n', {}, false);
    mol.addBond('b2', 'c', 'h', {}, false);
    assert.deepEqual(hBondDonors(mol), { count: 1, atoms: ['n'] });
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
    assert.deepEqual(hBondAcceptors(parseSMILES('c1ccccc1')), { count: 0, atoms: [] });
  });

  it('ethanol has 1 acceptor (O)', () => {
    const mol = parseSMILES('CCO');
    const oxygenId = [...mol.atoms.values()].find(atom => atom.name === 'O').id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [oxygenId] });
  });

  it('acetic acid has 1 acceptor (carbonyl O only)', () => {
    const mol = parseSMILES('CC(=O)O');
    const acceptorId = [...mol.atoms.values()].find(atom => atom.name === 'O' && atom.getHydrogenNeighbors(mol).length === 0).id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [acceptorId] });
  });

  it('pyridine has 1 acceptor (N)', () => {
    const mol = parseSMILES('c1ccncc1');
    const nitrogenId = [...mol.atoms.values()].find(atom => atom.name === 'N').id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [nitrogenId] });
  });

  it('aniline has 1 acceptor (N)', () => {
    const mol = parseSMILES('Nc1ccccc1');
    const nitrogenId = [...mol.atoms.values()].find(atom => atom.name === 'N').id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [nitrogenId] });
  });

  it('pyrrole has 0 acceptors', () => {
    assert.deepEqual(hBondAcceptors(parseSMILES('[nH]1cccc1')), { count: 0, atoms: [] });
  });

  it('ammonium has 0 acceptors', () => {
    assert.deepEqual(hBondAcceptors(parseSMILES('[NH4+]')), { count: 0, atoms: [] });
  });

  it('quaternary ammonium alcohol has 1 acceptor (the alcohol oxygen)', () => {
    const mol = parseSMILES('C[N+](C)(C)CCO');
    const oxygenId = [...mol.atoms.values()].find(atom => atom.name === 'O').id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [oxygenId] });
  });

  it('acetamide has 1 acceptor (carbonyl O only)', () => {
    const mol = parseSMILES('CC(=O)NC');
    const oxygenId = [...mol.atoms.values()].find(atom => atom.name === 'O').id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [oxygenId] });
  });

  it('counts both guanidine NH atoms as acceptors in the arginine side chain case', () => {
    const mol = parseSMILES('N[C@@H](CCCNC(N)=N)C(=O)O');
    const acceptors = hBondAcceptors(mol);
    assert.equal(acceptors.count, 5);
    assert.ok(acceptors.atoms.includes('N7'));
    assert.ok(acceptors.atoms.includes('N9'));
  });

  it('nitrobenzene has 2 acceptors (the two oxygens)', () => {
    const mol = parseSMILES('[O-][N+](=O)c1ccccc1');
    const oxygenIds = sortedIds([...mol.atoms.values()].filter(atom => atom.name === 'O').map(atom => atom.id));
    assert.deepEqual(hBondAcceptors(mol), { count: 2, atoms: oxygenIds });
  });

  it('thioethers count as sulfur acceptors', () => {
    const mol = parseSMILES('CSC');
    const sulfurId = [...mol.atoms.values()].find(atom => atom.name === 'S').id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [sulfurId] });
  });

  it('trialkyl phosphines count as phosphorus acceptors', () => {
    const mol = parseSMILES('P(C)(C)C');
    const phosphorusId = [...mol.atoms.values()].find(atom => atom.name === 'P').id;
    assert.deepEqual(hBondAcceptors(mol), { count: 1, atoms: [phosphorusId] });
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
    assert.deepEqual(rotatableBondCount(parseSMILES('CC')), { count: 0, bonds: [] });
  });

  it('propane has 0 rotatable bonds (both C-C bonds are terminal)', () => {
    assert.deepEqual(rotatableBondCount(parseSMILES('CCC')), { count: 0, bonds: [] });
  });

  it('butane has 1 rotatable bond (central C-C)', () => {
    const mol = parseSMILES('CCCC');
    const bondIds = sortedIds([...mol.bonds.values()].filter(bond => bond.isRotatable(mol)).map(bond => bond.id));
    assert.deepEqual(rotatableBondCount(mol), { count: 1, bonds: bondIds });
  });

  it('pentane has 2 rotatable bonds', () => {
    const mol = parseSMILES('CCCCC');
    const bondIds = sortedIds([...mol.bonds.values()].filter(bond => bond.isRotatable(mol)).map(bond => bond.id));
    assert.deepEqual(rotatableBondCount(mol), { count: 2, bonds: bondIds });
  });

  it('benzene has 0 rotatable bonds (aromatic)', () => {
    assert.deepEqual(rotatableBondCount(parseSMILES('c1ccccc1')), { count: 0, bonds: [] });
  });

  it('cyclohexane ring bonds are not rotatable', () => {
    assert.deepEqual(rotatableBondCount(parseSMILES('C1CCCCC1')), { count: 0, bonds: [] });
  });

  it('amide C-N bonds are not counted as rotatable', () => {
    assert.deepEqual(rotatableBondCount(parseSMILES('CC(=O)NC')), { count: 0, bonds: [] });
  });

  it('throws on non-molecule', () => {
    assert.throws(() => rotatableBondCount(null), TypeError);
  });
});

// ---------------------------------------------------------------------------
// ring descriptors / stereocenters / Veber
// ---------------------------------------------------------------------------

describe('ringCount', () => {
  it('returns count plus ring atom ids for benzene', () => {
    const mol = parseSMILES('c1ccccc1');
    assert.deepEqual(ringCount(mol), {
      count: 1,
      atoms: ringAtomSets(mol)
    });
  });

  it('returns two rings for naphthalene', () => {
    const result = ringCount(parseSMILES('c1ccc2ccccc2c1'));
    assert.equal(result.count, 2);
    assert.equal(result.atoms.length, 2);
  });
});

describe('aromaticRingCount', () => {
  it('returns aromatic ring atom ids for benzene', () => {
    const mol = parseSMILES('c1ccccc1');
    assert.deepEqual(aromaticRingCount(mol), {
      count: 1,
      atoms: ringAtomSets(mol)
    });
  });
});

describe('stereocenters', () => {
  it('returns count plus atom ids for defined stereocenters', () => {
    const mol = parseSMILES('N[C@@H](C)C(=O)O');
    assert.deepEqual(stereocenters(mol), {
      count: 1,
      atoms: sortedIds(mol.getChiralCenters())
    });
  });

  it('returns empty details for achiral molecules', () => {
    assert.deepEqual(stereocenters(parseSMILES('CC')), { count: 0, atoms: [] });
  });
});

describe('veberRules', () => {
  it('uses the detailed rotatable bond count internally', () => {
    const result = veberRules(parseSMILES('CCCC'));
    assert.equal(result.rotatableBonds, 1);
    assert.equal(result.passes, true);
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
    const result = lipinskiRuleOfFive(parseSMILES('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'));
    assert.ok(result.violations >= 2, `expected ≥2 violations, got ${result.violations}`);
    assert.equal(result.passes, false);
  });

  it('throws on non-molecule', () => {
    assert.throws(() => lipinskiRuleOfFive(null), TypeError);
  });
});
