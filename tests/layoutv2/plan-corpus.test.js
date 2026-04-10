import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { runPipeline } from '../../src/layoutv2/pipeline.js';

const PLAN_CORPUS = Object.freeze([
  { name: 'hexane', smiles: 'CCCCCC' },
  { name: '2-methylpentane', smiles: 'CCCC(C)C' },
  { name: 'neopentane', smiles: 'CC(C)(C)C' },
  { name: 'hex-1-yne', smiles: 'CCCCC#C' },
  { name: 'phenylacetylene', smiles: 'C#Cc1ccccc1' },
  { name: 'acrylonitrile', smiles: 'C=CC#N' },
  { name: 'propa-1,2-diene', smiles: 'C=C=C' },
  { name: 'hexa-2,3-diene', smiles: 'CCC=C=CC' },
  { name: 'buta-1,3-diene', smiles: 'C=CC=C' },
  { name: '(E)-stilbene', smiles: 'C(/C=C/c1ccccc1)c1ccccc1' },
  { name: 'benzaldehyde', smiles: 'O=Cc1ccccc1' },
  { name: 'cinnamaldehyde', smiles: 'O=C/C=C/c1ccccc1' },
  { name: 'cyclopentane', smiles: 'C1CCCC1' },
  { name: 'cyclohexane', smiles: 'C1CCCCC1' },
  { name: 'benzene', smiles: 'c1ccccc1' },
  { name: 'naphthalene', smiles: 'c1ccc2ccccc2c1' },
  { name: 'anthracene', smiles: 'c1ccc2cc3ccccc3cc2c1' },
  { name: 'pyrene', smiles: 'c1cc2ccc3cccc4ccc(c1)c2c34' },
  { name: 'fluorene', smiles: 'c1ccc2c(c1)Cc1ccccc1-2' },
  { name: 'indane', smiles: 'C1Cc2ccccc2C1' },
  { name: 'tetralin', smiles: 'C1CCc2ccccc2C1' },
  { name: 'chromane', smiles: 'C1CCOc2ccccc21' },
  { name: 'norbornane', smiles: 'C1CC2CCC1C2' },
  { name: 'adamantane', smiles: 'C1C2CC3CC1CC(C2)C3' },
  { name: 'bicyclo[2.2.2]octane', smiles: 'C1CC2CCC1CC2' },
  { name: 'cubane', smiles: 'C12C3C4C1C5C4C3C25' },
  { name: 'spiro[4.5]decane', smiles: 'C1CCCCC11CCCC1' },
  { name: 'spiro[4.4]nonane', smiles: 'C1CCCC11CCCC1' },
  { name: 'cyclododecane', smiles: 'C1CCCCCCCCCCC1' },
  { name: 'oxacyclohexadecane', smiles: 'C1CCCCCCCCCCCCCCO1' },
  { name: 'cyclotetracosane', smiles: 'C1CCCCCCCCCCCCCCCCCCCCCCC1' },
  { name: 'testosterone', smiles: 'C[C@]12CC[C@H]3[C@@H](CC=C4C[C@@H](O)CC[C@]34C)[C@@H]1CC[C@@H]2=O' },
  { name: 'cholesterol', smiles: 'C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C' },
  { name: 'steroid test molecule', smiles: 'C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O' },
  { name: 'cisplatin', smiles: '[NH3][Pt]([NH3])(Cl)Cl' },
  { name: 'thiophene', smiles: 'c1ccsc1' },
  { name: 'pyridine', smiles: 'c1ccncc1' },
  { name: 'indole', smiles: 'c1ccc2[nH]ccc2c1' },
  { name: 'quinoline', smiles: 'c1ccc2ncccc2c1' },
  { name: 'purine', smiles: 'c1ncc2[nH]cnc2n1' },
  { name: 'benzimidazole', smiles: 'c1ccc2[nH]cnc2c1' }
]);

describe('layoutv2/plan-corpus', () => {
  it('keeps the implementation-plan corpus audit-clean', () => {
    const failures = [];

    for (const entry of PLAN_CORPUS) {
      const result = runPipeline(parseSMILES(entry.smiles), { suppressH: true });
      if (!result.metadata.audit.ok) {
        failures.push({
          name: entry.name,
          smiles: entry.smiles,
          audit: result.metadata.audit
        });
      }
    }

    assert.deepEqual(failures, []);
  });
});
