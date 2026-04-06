import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInputFlowDeps } from '../../../src/app/core/input-flow-deps.js';

describe('createInputFlowDeps', () => {
  it('groups the input-flow dependency bridges without changing behavior', () => {
    const records = [];
    const deps = createInputFlowDeps({
      state: {
        getInputMode: () => 'smiles',
        setInputMode: value => records.push(['setInputMode', value]),
        getCurrentSmiles: () => 'CCO',
        setCurrentSmiles: value => records.push(['setCurrentSmiles', value]),
        getCurrentInchi: () => 'InChI=1S/...',
        setCurrentInchi: value => records.push(['setCurrentInchi', value]),
        getCurrentMol: () => 'force-mol',
        setCurrentMol: value => records.push(['setCurrentMol', value]),
        getMol2d: () => 'mol2d',
        setMol2d: value => records.push(['setMol2d', value]),
        getMode: () => '2d',
        clear2dDerivedState: () => records.push(['clear2dDerivedState']),
        clearSelection: () => records.push(['clearSelection']),
        clearHovered: () => records.push(['clearHovered']),
        clearForceRenderCaches: () => records.push(['clearForceRenderCaches']),
        resetValenceWarnings: () => records.push(['resetValenceWarnings'])
      },
      dom: {
        getInputElement: () => ({ value: 'CCO' }),
        setInputFormatButtons: fmt => records.push(['setInputFormatButtons', fmt]),
        setInputLabel: text => records.push(['setInputLabel', text])
      },
      history: {
        takeSnapshot: options => records.push(['takeSnapshot', options])
      },
      snapshot: {
        capture: options => ({ captured: options })
      },
      molecule: {
        getMolSmiles: () => 'CCO',
        getMolInchi: () => 'InChI=1S/...'
      },
      collection: {
        getInputValue: fmt => (fmt === 'inchi' ? 'InChI=1S/...' : 'CCO'),
        syncPickerForInputValue: value => records.push(['syncPickerForInputValue', value])
      },
      examples: {
        render: () => records.push(['renderExamples'])
      },
      parsers: {
        parseSMILES: value => ({ smiles: value }),
        parseINCHI: value => ({ inchi: value }),
        detectChemicalStringFormat: value => value
      },
      overlays: {
        hasReactionPreview: () => false,
        clearReactionPreviewState: () => records.push(['clearReactionPreviewState'])
      },
      renderers: {
        renderMol: () => records.push(['renderMol'])
      },
      highlights: {
        clear: () => records.push(['clearHighlightState'])
      },
      force: {
        clearIfActive: () => records.push(['clearForceIfActive'])
      },
      analysis: {
        updatePanels: (mol, options) => records.push(['updatePanels', mol, options]),
        clearSummary: () => records.push(['clearSummary'])
      }
    });

    assert.equal(deps.state.getInputMode(), 'smiles');
    assert.equal(deps.molecule.getMolSmiles(), 'CCO');
    assert.equal(deps.collection.getInputValue('inchi'), 'InChI=1S/...');
    assert.deepEqual(deps.snapshot.capture({ foo: 'bar' }), { captured: { foo: 'bar' } });

    deps.dom.setInputFormatButtons('inchi');
    deps.examples.render();
    deps.force.clearIfActive();

    assert.deepEqual(records, [
      ['setInputFormatButtons', 'inchi'],
      ['renderExamples'],
      ['clearForceIfActive']
    ]);
  });
});
