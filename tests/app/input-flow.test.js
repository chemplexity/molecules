import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInputFlowManager } from '../../src/app/core/input-flow.js';

function makeManager(overrides = {}) {
  let inputMode = overrides.inputMode ?? 'smiles';
  let currentSmiles = overrides.currentSmiles ?? null;
  let currentInchi = overrides.currentInchi ?? null;
  let currentMol = overrides.currentMol ?? null;
  let mol2d = overrides.mol2d ?? null;
  const inputEl = { value: overrides.inputValue ?? '' };
  const calls = [];

  const manager = createInputFlowManager({
    state: {
      getInputMode: () => inputMode,
      setInputMode: value => {
        inputMode = value;
      },
      getCurrentSmiles: () => currentSmiles,
      setCurrentSmiles: value => {
        currentSmiles = value;
      },
      getCurrentInchi: () => currentInchi,
      setCurrentInchi: value => {
        currentInchi = value;
      },
      getCurrentMol: () => currentMol,
      setCurrentMol: value => {
        currentMol = value;
      },
      getMol2d: () => mol2d,
      setMol2d: value => {
        mol2d = value;
      },
      getMode: () => overrides.mode ?? '2d',
      clear2dDerivedState: () => {
        calls.push(['clear2dDerivedState']);
      },
      clearSelection: () => {
        calls.push(['clearSelection']);
      },
      clearHovered: () => {
        calls.push(['clearHovered']);
      },
      clearForceRenderCaches: () => {
        calls.push(['clearForceRenderCaches']);
      },
      resetValenceWarnings: () => {
        calls.push(['resetValenceWarnings']);
      }
    },
    dom: {
      getInputElement: () => inputEl,
      setInputFormatButtons: fmt => {
        calls.push(['setInputFormatButtons', fmt]);
      },
      setInputLabel: text => {
        calls.push(['setInputLabel', text]);
      }
    },
    history: {
      takeSnapshot: options => {
        calls.push(['takeSnapshot', options]);
      }
    },
    snapshot: {
      capture: options => {
        calls.push(['captureSnapshot', options]);
        return overrides.capturedSnapshot ?? { id: 'snapshot-1' };
      }
    },
    molecule: {
      getMolSmiles: () => overrides.molSmiles ?? 'CCO',
      getMolInchi: () => overrides.molInchi ?? 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3'
    },
    collection: {
      getInputValue: fmt => {
        calls.push(['getCollectionInputValue', fmt]);
        return overrides.collectionInputValue ?? '';
      },
      syncPickerForInputValue: value => {
        calls.push(['syncPickerForInputValue', value]);
      }
    },
    examples: {
      render: () => {
        calls.push(['renderExamples']);
      }
    },
    parsers: {
      parseSMILES: value => overrides.parseSMILES?.(value) ?? { atoms: new Map([['a1', {}]]) },
      parseINCHI: value => overrides.parseINCHI?.(value) ?? { atoms: new Map([['a1', {}]]) },
      detectChemicalStringFormat: value => overrides.detectChemicalStringFormat?.(value) ?? null
    },
    overlays: {
      hasReactionPreview: () => overrides.hasReactionPreview ?? false,
      clearReactionPreviewState: () => {
        calls.push(['clearReactionPreviewState']);
      }
    },
    renderers: {
      renderMol: (mol, options = {}) => {
        calls.push(['renderMol', mol, options]);
      },
      clearScene: () => {
        calls.push(['clearScene']);
      }
    },
    highlights: {
      clear: () => {
        calls.push(['clearHighlights']);
      }
    },
    force: {
      clearIfActive: () => {
        calls.push(['clearForceIfActive']);
      }
    },
    analysis: {
      updatePanels: (mol, options = {}) => {
        calls.push(['updatePanels', mol, options]);
      },
      clearSummary: () => {
        calls.push(['clearSummary']);
      }
    }
  });

  return {
    manager,
    calls,
    inputEl,
    getState: () => ({
      inputMode,
      currentSmiles,
      currentInchi,
      currentMol,
      mol2d
    })
  };
}

describe('createInputFlowManager', () => {
  it('records undo history when switching input format', () => {
    const { manager, calls, inputEl, getState } = makeManager({
      inputMode: 'smiles',
      inputValue: 'CCO'
    });

    manager.setInputFormat('inchi');

    assert.deepEqual(calls[0], [
      'takeSnapshot',
      {
        clearReactionPreview: false,
        documentState: {
          currentSmiles: 'CCO',
          currentInchi: 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3',
          inputMode: 'smiles',
          inputValue: 'CCO'
        }
      }
    ]);
    assert.equal(getState().inputMode, 'inchi');
    assert.equal(inputEl.value, 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');
  });

  it('captures the previous document state before loading a new SMILES', () => {
    const { manager, calls, getState } = makeManager({
      inputMode: 'smiles',
      currentSmiles: 'CCO',
      currentInchi: null,
      currentMol: { id: 'old-mol' },
      capturedSnapshot: { id: 'previous-snapshot' }
    });

    manager.parseAndRenderSmiles('CCC');

    assert.deepEqual(calls.slice(0, 3), [
      [
        'captureSnapshot',
        {
          documentState: {
            currentSmiles: 'CCO',
            currentInchi: 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3',
            inputMode: 'smiles',
            inputValue: 'CCO'
          }
        }
      ],
      ['clearReactionPreviewState'],
      [
        'takeSnapshot',
        {
          clearReactionPreview: false,
          snapshot: { id: 'previous-snapshot' }
        }
      ]
    ]);
    assert.equal(getState().currentSmiles, 'CCC');
    assert.equal(getState().currentInchi, null);
  });

  it('auto-switches to InChI mode before parsing detected InChI input', () => {
    const { manager, calls, getState } = makeManager({
      inputMode: 'smiles',
      inputValue: 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3',
      detectChemicalStringFormat: () => 'inchi'
    });

    manager.parseInputWithAutoFormat('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');

    assert.equal(getState().inputMode, 'inchi');
    assert.deepEqual(
      calls.filter(([name]) => name === 'renderMol').length,
      1
    );
  });

  it('captures the previous InChI document state before auto-switching pasted SMILES input', () => {
    const previousInchi = 'InChI=1S/C5H12/c1-4-5(2)3/h5H,4H2,1-3H3';
    const { manager, calls } = makeManager({
      inputMode: 'inchi',
      inputValue: previousInchi,
      currentSmiles: null,
      currentInchi: previousInchi,
      currentMol: { id: 'old-mol' },
      molInchi: previousInchi,
      capturedSnapshot: { id: 'previous-snapshot' },
      detectChemicalStringFormat: () => 'smiles'
    });

    manager.parseInputWithAutoFormat('CCC');

    assert.deepEqual(calls.slice(0, 5), [
      [
        'captureSnapshot',
        {
          documentState: {
            currentSmiles: 'CCO',
            currentInchi: previousInchi,
            inputMode: 'inchi',
            inputValue: previousInchi
          }
        }
      ],
      ['setInputFormatButtons', 'smiles'],
      ['setInputLabel', 'Input SMILES notation...'],
      ['syncPickerForInputValue', 'CCC'],
      ['renderExamples']
    ]);
    assert.deepEqual(
      calls.find(([name]) => name === 'takeSnapshot'),
      ['takeSnapshot', { clearReactionPreview: false, snapshot: { id: 'previous-snapshot' } }]
    );
  });
});
