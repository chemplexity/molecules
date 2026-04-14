import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/smiles.js';
import { extractMurckoScaffold } from '../../src/algorithms/scaffold.js';

describe('Murcko Scaffold Extraction', () => {
  it('should strip acyclic chains from a single ring', () => {
    const mol = parseSMILES('CC1CCCCC1CCC');
    const scaffold = extractMurckoScaffold(mol);
    assert.equal(toCanonicalSMILES(scaffold), 'C1CCCCC1');
  });

  it('should preserve linker chains between two rings', () => {
    const mol = parseSMILES('CC1CCCCC1CCC2CCCCC2CCC');
    const scaffold = extractMurckoScaffold(mol);
    assert.equal(toCanonicalSMILES(scaffold), 'C1CCC(CC1)CCC2CCCCC2');
  });

  it('should reduce a completely acyclic molecule to an empty graph', () => {
    const mol = parseSMILES('CCCCCC');
    const scaffold = extractMurckoScaffold(mol);
    assert.equal(toCanonicalSMILES(scaffold), '');
  });

  it('should strip complex functional groups from ring systems', () => {
    const mol = parseSMILES('O=C(O)c1ccccc1Cl');
    const scaffold = extractMurckoScaffold(mol);
    assert.equal(toCanonicalSMILES(scaffold), 'c1ccccc1');
  });
});
