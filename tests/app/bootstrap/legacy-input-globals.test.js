import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initLegacyInputGlobals } from '../../../src/app/bootstrap/legacy-input-globals.js';

describe('initLegacyInputGlobals', () => {
  it('binds the legacy global input bridges and example getter', () => {
    const calls = [];
    const win = {
      _setInputFormat: (fmt, options) => calls.push(['setInputFormat', fmt, options]),
      _renderExamples: () => calls.push(['renderExamples']),
      _pickRandomMolecule: () => calls.push(['pickRandomMolecule']),
      _parseInput: value => calls.push(['parseInput', value])
    };
    const examples = [{ name: 'ethanol', smiles: 'CCO' }];

    initLegacyInputGlobals({
      win,
      exampleMolecules: examples
    });

    win.setInputFormat('inchi', { preserveSelection: true });
    win.renderExamples();
    win.pickRandomMolecule();
    win.parseInput('CCO');

    assert.equal(win._getExampleMolecules(), examples);
    assert.deepEqual(calls, [
      ['setInputFormat', 'inchi', { preserveSelection: true }],
      ['renderExamples'],
      ['pickRandomMolecule'],
      ['parseInput', 'CCO']
    ]);
  });
});
