import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInputControls } from '../../src/app/interactions/input-controls.js';

function createElement(initial = {}) {
  const listeners = new Map();
  return {
    value: initial.value ?? '',
    innerHTML: initial.innerHTML ?? '',
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      const handler = listeners.get(type);
      if (handler) {
        handler(event);
      }
    }
  };
}

describe('createInputControls', () => {
  it('clears the collection picker when typed input no longer matches the selected entry', () => {
    const inputEl = createElement({ value: 'CCO' });
    const collectionSelectEl = createElement({ value: 'ethanol' });
    const examplesEl = createElement();

    const controls = createInputControls({
      data: {
        exampleMolecules: [],
        randomMolecule: [],
        moleculeCatalog: [
          {
            id: 'cat',
            name: 'Alcohols',
            molecules: [{ id: 'ethanol', name: 'ethanol', smiles: 'CCO', inchi: 'inchi-ethanol' }]
          }
        ]
      },
      state: {
        getInputMode: () => 'smiles'
      },
      dom: {
        getInputElement: () => inputEl,
        getCollectionSelectElement: () => collectionSelectEl,
        getExamplesElement: () => examplesEl
      },
      actions: {
        parseInput: () => {},
        parseInputWithAutoFormat: () => {}
      }
    });

    controls.bind();
    inputEl.dispatch('input', { target: { value: 'CCC' } });

    assert.equal(collectionSelectEl.value, '');
  });

  it('renders example links and a random link for the active input mode', () => {
    const inputEl = createElement();
    const collectionSelectEl = createElement();
    const examplesEl = createElement();

    const controls = createInputControls({
      data: {
        exampleMolecules: [{ name: 'ethanol', smiles: 'CCO', inchi: 'inchi-ethanol' }],
        randomMolecule: [],
        moleculeCatalog: []
      },
      state: {
        getInputMode: () => 'inchi'
      },
      dom: {
        getInputElement: () => inputEl,
        getCollectionSelectElement: () => collectionSelectEl,
        getExamplesElement: () => examplesEl
      },
      actions: {
        parseInput: () => {},
        parseInputWithAutoFormat: () => {}
      }
    });

    controls.renderExamples();

    assert.match(examplesEl.innerHTML, /inchi-ethanol/);
    assert.match(examplesEl.innerHTML, /pickRandomMolecule/);
  });

  it('parses pasted text immediately through the shared input flow', () => {
    const inputEl = createElement({ value: 'InChI=1S/example' });
    inputEl.selectionStart = 0;
    inputEl.selectionEnd = inputEl.value.length;
    const collectionSelectEl = createElement();
    const examplesEl = createElement();
    const calls = [];

    const controls = createInputControls({
      data: {
        exampleMolecules: [],
        randomMolecule: [],
        moleculeCatalog: []
      },
      state: {
        getInputMode: () => 'inchi'
      },
      dom: {
        getInputElement: () => inputEl,
        getCollectionSelectElement: () => collectionSelectEl,
        getExamplesElement: () => examplesEl
      },
      actions: {
        parseInput: () => {},
        parseInputWithAutoFormat: value => {
          calls.push(value);
        }
      }
    });

    controls.bind();
    inputEl.dispatch('paste', {
      target: inputEl,
      clipboardData: {
        getData: type => (type === 'text/plain' ? 'CCC' : '')
      },
      preventDefault: () => {
        calls.push('preventDefault');
      }
    });

    assert.equal(inputEl.value, 'CCC');
    assert.deepEqual(calls, ['CCC', 'preventDefault']);
  });
});
