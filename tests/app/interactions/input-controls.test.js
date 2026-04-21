import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInputControls } from '../../../src/app/interactions/input-controls.js';

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

  it('cycles through the random molecule pool before repeating entries', () => {
    const inputEl = createElement();
    const collectionSelectEl = createElement();
    const examplesEl = createElement();
    const records = [];
    const originalRandom = Math.random;

    Math.random = () => 0;

    try {
      const controls = createInputControls({
        data: {
          exampleMolecules: [],
          randomMolecule: [{ smiles: 'A' }, { smiles: 'B' }, { smiles: 'C' }],
          moleculeCatalog: []
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
          parseInput: value => {
            records.push(value);
          },
          parseInputWithAutoFormat: () => {}
        }
      });

      controls.pickRandomMolecule();
      controls.pickRandomMolecule();
      controls.pickRandomMolecule();
      controls.pickRandomMolecule();

      assert.equal(new Set(records.slice(0, 3)).size, 3);
      assert.equal(records[3], records[0]);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('uses the InChI-capable random pool without repeating entries before it is exhausted', () => {
    const inputEl = createElement();
    const collectionSelectEl = createElement();
    const examplesEl = createElement();
    const records = [];
    const originalRandom = Math.random;

    Math.random = () => 0;

    try {
      const controls = createInputControls({
        data: {
          exampleMolecules: [],
          randomMolecule: [{ smiles: 'A' }, { smiles: 'B', inchi: 'InChI=1S/B' }, { smiles: 'C', inchi: 'InChI=1S/C' }],
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
          parseInput: value => {
            records.push(value);
          },
          parseInputWithAutoFormat: () => {}
        }
      });

      controls.pickRandomMolecule();
      controls.pickRandomMolecule();
      controls.pickRandomMolecule();

      assert.deepEqual(new Set(records.slice(0, 2)).size, 2);
      assert.deepEqual(records[2], records[0]);
      assert.ok(records.every(value => value.startsWith('InChI=1S/')));
    } finally {
      Math.random = originalRandom;
    }
  });

  it('cycles bug verification molecules in source order and wraps back to the start', () => {
    const inputEl = createElement();
    const collectionSelectEl = createElement();
    const examplesEl = createElement();
    const records = [];

    const controls = createInputControls({
      data: {
        exampleMolecules: [],
        randomMolecule: [],
        bugMolecules: ['bug-0', 'bug-1', 'bug-2'],
        moleculeCatalog: []
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
        parseInputWithAutoFormat: value => {
          records.push(value);
        }
      }
    });

    controls.pickBugVerificationMolecule();
    controls.pickBugVerificationMolecule();
    controls.pickBugVerificationMolecule();
    controls.pickBugVerificationMolecule();

    assert.deepEqual(records, ['bug-0', 'bug-1', 'bug-2', 'bug-0']);
    assert.equal(inputEl.value, 'bug-0');
  });
});
