import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { parseSMILES } from '../../src/io/index.js';
import { molecularFormula, molecularMass } from '../../src/descriptors/molecular.js';

const EPS = 0.01; // tolerance in g/mol

describe('molecularFormula', () => {
  it('methane C: { C:1, H:4 }', () => {
    assert.deepEqual(molecularFormula(parseSMILES('C')), { C: 1, H: 4 });
  });

  it('propane CCC: { C:3, H:8 }', () => {
    assert.deepEqual(molecularFormula(parseSMILES('CCC')), { C: 3, H: 8 });
  });

  it('benzene c1ccccc1: { C:6, H:6 }', () => {
    assert.deepEqual(molecularFormula(parseSMILES('c1ccccc1')), { C: 6, H: 6 });
  });

  it('empty molecule returns {}', () => {
    assert.deepEqual(molecularFormula(new Molecule()), {});
  });

  it('manually built propane without H: { C:3 }', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    assert.deepEqual(molecularFormula(mol), { C: 3 });
  });
});

describe('molecularMass', () => {
  it('methane C ≈ 16.043 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('C')) - 16.043) < EPS);
  });

  it('water O ≈ 18.015 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('O')) - 18.015) < EPS);
  });

  it('ammonia N ≈ 17.031 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('N')) - 17.031) < EPS);
  });

  it('ethanol CCO ≈ 46.069 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('CCO')) - 46.069) < EPS);
  });

  it('propane CCC ≈ 44.097 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('CCC')) - 44.097) < EPS);
  });

  it('benzene c1ccccc1 ≈ 78.114 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('c1ccccc1')) - 78.114) < EPS);
  });

  it('cyclohexane C1CCCCC1 ≈ 84.162 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('C1CCCCC1')) - 84.162) < EPS);
  });

  it('ethylene C=C ≈ 28.054 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('C=C')) - 28.054) < EPS);
  });

  it('acetylene C#C ≈ 26.038 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('C#C')) - 26.038) < EPS);
  });

  it('isobutane CC(C)C ≈ 58.123 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('CC(C)C')) - 58.123) < EPS);
  });

  it('returns 0 for empty molecule', () => {
    assert.equal(molecularMass(new Molecule()), 0);
  });

  it('manually built single C atom uses elements table', () => {
    const mol = new Molecule();
    mol.addAtom('C1', 'C');
    // C: 6 protons + 6.0107 neutrons = 12.0107
    assert.ok(Math.abs(molecularMass(mol) - 12.0107) < 1e-6);
  });

  it('13C isotope isobutane C[13CH](C)C ≈ 59.116 g/mol', () => {
    assert.ok(Math.abs(molecularMass(parseSMILES('C[13CH](C)C')) - 59.116) < EPS);
  });

  it('result is rounded to 4 decimal places', () => {
    const mass = molecularMass(parseSMILES('C'));
    assert.equal(mass, Math.round(mass * 10000) / 10000);
  });
});
