import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/smiles.js';
import { extractMurckoScaffold } from '../../src/algorithms/scaffold.js';
import { renderMolSVG } from '../../src/layout/render2d.js';

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

  it('should strip complex functional groups from ring systems', () => {
    const mol = parseSMILES('O=C(O)c1ccccc1Cl');
    const scaffold = extractMurckoScaffold(mol);
    assert.equal(toCanonicalSMILES(scaffold), 'c1ccccc1');
  });

  it('can preserve exocyclic multiple-bond heteroatoms directly attached to retained scaffold atoms', () => {
    const ringKetone = extractMurckoScaffold(parseSMILES('O=C1CCCCC1'), { preserveExocyclicMultipleBonds: true });
    const aldehydeSideChain = extractMurckoScaffold(parseSMILES('O=Cc1ccccc1'), { preserveExocyclicMultipleBonds: true });
    const diarylKetone = extractMurckoScaffold(parseSMILES('O=C(c1ccccc1)c1ccccc1'), { preserveExocyclicMultipleBonds: true });

    assert.equal(toCanonicalSMILES(ringKetone), 'C1CCC(CC1)=O');
    assert.equal(toCanonicalSMILES(aldehydeSideChain), 'c1ccccc1');
    assert.equal(toCanonicalSMILES(diarylKetone), 'c1ccc(cc1)C(c2ccccc2)=O');
  });

  it('should strip stereochemistry from pruned ring scaffolds', () => {
    const mol = parseSMILES('C[C@H]1CCCC[C@H]1O');
    const scaffold = extractMurckoScaffold(mol);
    const rendered = renderMolSVG(scaffold.clone());

    assert.equal(toCanonicalSMILES(scaffold), 'C1CCCCC1');
    assert.equal([...scaffold.atoms.values()].some(atom => atom.getChirality()), false);
    assert.equal([...scaffold.bonds.values()].some(bond => bond.properties.stereo || bond.properties.display?.as), false);
    assert.equal(rendered?.svgContent.includes('<tspan>H</tspan>'), false);
  });

  it('should not invent scaffold stereo hydrogens after side-chain removal', () => {
    const mol = parseSMILES('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    const scaffold = extractMurckoScaffold(mol);
    const rendered = renderMolSVG(scaffold.clone());

    assert.equal([...scaffold.atoms.values()].some(atom => atom.getChirality()), false);
    assert.equal([...scaffold.bonds.values()].some(bond => bond.properties.stereo || bond.properties.display?.as), false);
    assert.equal(rendered?.svgContent.includes('<tspan>H</tspan>'), false);
  });
});
