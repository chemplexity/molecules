import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppShellDeps } from '../../../../src/app/ui/deps/app-shell-deps.js';

describe('createAppShellDeps', () => {
  it('builds the app shell dependency bridge from live callbacks', () => {
    const deps = createAppShellDeps({
      win: { id: 'window' },
      dom: {
        getPlotElement: () => 'plot',
        getLabelToggleElement: () => 'labelToggle'
      },
      history: {
        undo: () => 'undo',
        redo: () => 'redo'
      },
      exportActions: {
        copyForcePng: () => 'copyForcePng',
        copyForceSvg: () => 'copyForceSvg',
        copySvg2d: () => 'copySvg2d',
        savePng2d: () => 'savePng2d'
      },
      options: {
        open: () => 'open'
      },
      navigation: {
        cleanLayout2d: () => 'cleanLayout2d',
        cleanLayoutForce: () => 'cleanLayoutForce',
        toggleMode: () => 'toggleMode'
      },
      selection: {
        togglePanMode: () => 'togglePanMode',
        toggleSelectMode: () => 'toggleSelectMode',
        toggleDrawBondMode: () => 'toggleDrawBondMode',
        handleDrawBondButtonClick: () => 'handleDrawBondButtonClick',
        openDrawBondDrawer: () => 'openDrawBondDrawer',
        closeDrawBondDrawer: () => 'closeDrawBondDrawer',
        toggleEraseMode: () => 'toggleEraseMode',
        setChargeTool: value => `setChargeTool:${value}`,
        setDrawElement: value => `setDrawElement:${value}`,
        setDrawBondType: value => `setDrawBondType:${value}`
      },
      editing: {
        deleteSelection: () => 'deleteSelection'
      },
      state: {
        hasLoadedInput: () => true,
        getMode: () => '2d'
      },
      view: {
        handleForceResize: () => 'handleForceResize',
        handle2DResize: () => 'handle2DResize'
      },
      input: {
        parseSmiles: value => `parseSmiles:${value}`,
        parseInchi: value => `parseInchi:${value}`,
        parseInput: value => `parseInput:${value}`,
        setInputFormat: value => `setInputFormat:${value}`,
        renderExamples: () => 'renderExamples',
        pickRandomMolecule: () => 'pickRandomMolecule',
        getCanonicalMol: () => 'canonicalMol',
        toSmiles: value => `toSmiles:${value}`,
        toInchi: value => `toInchi:${value}`,
        takeInputFormatSnapshot: value => `takeInputFormatSnapshot:${value}`
      },
      initialState: {
        getInitialSmiles: () => 'CCO',
        setInputValue: value => `setInputValue:${value}`,
        syncCollectionPicker: value => `syncCollectionPicker:${value}`
      }
    });

    assert.equal(deps.win.id, 'window');
    assert.equal(deps.dom.getPlotElement(), 'plot');
    assert.equal(deps.history.undo(), 'undo');
    assert.equal(deps.exportActions.copyForceSvg(), 'copyForceSvg');
    assert.equal(deps.options.open(), 'open');
    assert.equal(deps.navigation.toggleMode(), 'toggleMode');
    assert.equal(deps.selection.setChargeTool('positive'), 'setChargeTool:positive');
    assert.equal(deps.selection.setDrawElement('N'), 'setDrawElement:N');
    assert.equal(deps.selection.setDrawBondType('dash'), 'setDrawBondType:dash');
    assert.equal(deps.editing.deleteSelection(), 'deleteSelection');
    assert.equal(deps.state.hasLoadedInput(), true);
    assert.equal(deps.view.handle2DResize(), 'handle2DResize');
    assert.equal(deps.input.toSmiles('mol'), 'toSmiles:mol');
    assert.equal(deps.initialState.getInitialSmiles(), 'CCO');
  });
});
