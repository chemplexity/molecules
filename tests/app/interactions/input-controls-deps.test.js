import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInputControlsDeps } from '../../../src/app/interactions/input-controls-deps.js';

describe('createInputControlsDeps', () => {
  it('groups input-controls dependencies without changing the exposed shape', () => {
    const inputElement = { value: 'CCO' };
    const selectElement = { value: 'benzene' };
    const examplesElement = { innerHTML: '' };
    const records = [];

    const deps = createInputControlsDeps({
      data: {
        exampleMolecules: [{ name: 'ethanol', smiles: 'CCO' }],
        randomMolecule: [{ smiles: 'CCC' }],
        moleculeCatalog: [{ id: 'catalog', molecules: [] }]
      },
      state: {
        getInputMode: () => 'smiles'
      },
      dom: {
        getInputElement: () => inputElement,
        getCollectionSelectElement: () => selectElement,
        getExamplesElement: () => examplesElement
      },
      actions: {
        parseInput: value => records.push(['parseInput', value]),
        parseInputWithAutoFormat: value => records.push(['parseInputWithAutoFormat', value])
      }
    });

    assert.equal(deps.state.getInputMode(), 'smiles');
    assert.equal(deps.dom.getInputElement(), inputElement);
    assert.equal(deps.dom.getCollectionSelectElement(), selectElement);
    assert.equal(deps.dom.getExamplesElement(), examplesElement);
    assert.deepEqual(deps.data.exampleMolecules, [{ name: 'ethanol', smiles: 'CCO' }]);

    deps.actions.parseInput('CCO');
    deps.actions.parseInputWithAutoFormat('InChI=1S/...');

    assert.deepEqual(records, [
      ['parseInput', 'CCO'],
      ['parseInputWithAutoFormat', 'InChI=1S/...']
    ]);
  });
});
