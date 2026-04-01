import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessChemicalStringFormat,
  detectChemicalStringFormat
} from '../../src/io/index.js';

describe('guessChemicalStringFormat', () => {
  it('returns smiles for valid-looking SMILES', () => {
    assert.equal(guessChemicalStringFormat('CCO'), 'smiles');
  });

  it('returns inchi for InChI-prefixed input', () => {
    assert.equal(guessChemicalStringFormat('InChI=1S/CH4/h1H4'), 'inchi');
  });

  it('returns inchi for malformed InChI input because it is only a guess', () => {
    assert.equal(guessChemicalStringFormat('InChI=not-real'), 'inchi');
  });

  it('returns null for invalid non-InChI junk', () => {
    assert.equal(guessChemicalStringFormat('xyz'), null);
  });
});

describe('detectChemicalStringFormat', () => {
  it('returns smiles for valid SMILES', () => {
    assert.equal(detectChemicalStringFormat('CCO'), 'smiles');
  });

  it('returns inchi for valid InChI', () => {
    assert.equal(detectChemicalStringFormat('InChI=1S/CH4/h1H4'), 'inchi');
  });

  it('accepts lowercase inchi prefix during detection', () => {
    assert.equal(detectChemicalStringFormat('inchi=1S/CH4/h1H4'), 'inchi');
  });

  it('returns inchi for malformed InChI input by default', () => {
    assert.equal(detectChemicalStringFormat('InChI=not-real'), 'inchi');
  });

  it('returns null for malformed InChI input when validate=true', () => {
    assert.equal(detectChemicalStringFormat('InChI=not-real', { validate: true }), null);
  });

  it('returns null for invalid non-InChI junk', () => {
    assert.equal(detectChemicalStringFormat('xyz'), null);
  });

  it('returns null for obviously malformed SMILES-like input by default', () => {
    assert.equal(detectChemicalStringFormat('C1CC'), null);
  });

  it('uses parser-backed validation for SMILES when validate=true', () => {
    assert.equal(detectChemicalStringFormat('CCO', { validate: true }), 'smiles');
  });

  it('returns null for empty input', () => {
    assert.equal(detectChemicalStringFormat('   '), null);
  });
});
