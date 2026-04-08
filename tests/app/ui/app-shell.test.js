import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initAppShell } from '../../../src/app/ui/app-shell.js';

describe('initAppShell', () => {
  it('registers global bridges, handles resize, and bootstraps the initial molecule', () => {
    const records = [];
    const listeners = new Map();
    const win = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      }
    };
    const plotEl = {
      classes: new Set(),
      classList: {
        toggle: className => {
          if (plotEl.classes.has(className)) {
            plotEl.classes.delete(className);
            return false;
          }
          plotEl.classes.add(className);
          return true;
        },
        contains: className => plotEl.classes.has(className)
      }
    };
    const labelToggleEl = {
      classes: new Set(),
      classList: {
        toggle: (className, force) => {
          if (force) {
            labelToggleEl.classes.add(className);
            return true;
          }
          labelToggleEl.classes.delete(className);
          return false;
        }
      }
    };

    const shell = initAppShell({
      win,
      dom: {
        getPlotElement: () => plotEl,
        getLabelToggleElement: () => labelToggleEl
      },
      history: {
        undo: () => {
          records.push(['undo']);
        },
        redo: () => {
          records.push(['redo']);
        }
      },
      exportActions: {
        copyForcePng: () => {
          records.push(['copyForcePng']);
        },
        copyForceSvg: () => {
          records.push(['copyForceSvg']);
        },
        copySvg2d: () => {
          records.push(['copySvg2d']);
        },
        savePng2d: () => {
          records.push(['savePng2d']);
        }
      },
      options: {
        open: () => {
          records.push(['openOptionsModal']);
        }
      },
      navigation: {
        cleanLayout2d: () => {
          records.push(['cleanLayout2d']);
        },
        cleanLayoutForce: () => {
          records.push(['cleanLayoutForce']);
        },
        toggleMode: () => {
          records.push(['toggleMode']);
        }
      },
      selection: {
        togglePanMode: () => {
          records.push(['togglePanMode']);
        },
        toggleSelectMode: () => {
          records.push(['toggleSelectMode']);
        },
        toggleDrawBondMode: () => {
          records.push(['toggleDrawBondMode']);
        },
        handleDrawBondButtonClick: () => {
          records.push(['handleDrawBondButtonClick']);
        },
        openDrawBondDrawer: () => {
          records.push(['openDrawBondDrawer']);
        },
        closeDrawBondDrawer: () => {
          records.push(['closeDrawBondDrawer']);
        },
        toggleEraseMode: () => {
          records.push(['toggleEraseMode']);
        },
        setChargeTool: tool => {
          records.push(['setChargeTool', tool]);
        },
        setDrawElement: el => {
          records.push(['setDrawElement', el]);
        },
        setDrawBondType: type => {
          records.push(['setDrawBondType', type]);
        }
      },
      editing: {
        deleteSelection: () => {
          records.push(['deleteSelection']);
        }
      },
      state: {
        hasLoadedInput: () => true,
        getMode: () => 'force'
      },
      view: {
        handleForceResize: () => {
          records.push(['handleForceResize']);
        },
        handle2DResize: () => {
          records.push(['handle2DResize']);
        }
      },
      input: {
        parseSmiles: value => {
          records.push(['parseSmiles', value]);
        },
        parseInchi: value => {
          records.push(['parseInchi', value]);
        },
        parseInput: value => {
          records.push(['parseInput', value]);
        },
        setInputFormat: (fmt, options = {}) => {
          records.push(['setInputFormat', fmt, options]);
        },
        renderExamples: () => {
          records.push(['renderExamples']);
        },
        pickRandomMolecule: () => {
          records.push(['pickRandomMolecule']);
        },
        getCanonicalMol: () => ({ id: 'mol' }),
        toSmiles: mol => `smiles:${mol.id}`,
        toInchi: mol => `inchi:${mol.id}`,
        takeInputFormatSnapshot: payload => {
          records.push(['takeInputFormatSnapshot', payload]);
        }
      },
      initialState: {
        getInitialSmiles: () => 'CCO',
        setInputValue: value => {
          records.push(['setInputValue', value]);
        },
        syncCollectionPicker: value => {
          records.push(['syncCollectionPicker', value]);
        }
      }
    });

    shell.bootstrap();
    listeners.get('resize')();
    win.undoAction();
    win.redoAction();
    win.copyForcePng();
    win.copyForceSvg();
    win.copySvg2d();
    win.savePng2d();
    win.openOptionsModal();
    win.toggleLabels();
    win.cleanLayout2d();
    win.cleanLayoutForce();
    win.togglePanMode();
    win.toggleSelectMode();
    win.toggleDrawBondMode();
    win.handleDrawBondButtonClick();
    win.openDrawBondDrawer();
    win.closeDrawBondDrawer();
    win.toggleEraseMode();
    win.setChargeTool('positive');
    win.setDrawElement('N');
    win.setDrawBondType('dash');
    win.toggleMode();
    win._parseSmiles('CCN');
    win._parseInchi('InChI=1S/CH4/h1H4');
    win._parseInput('CCO');
    win._setInputFormat('inchi', { preserveSelection: true });
    win._renderExamples();
    win._pickRandomMolecule();
    win._takeInputFormatSnapshot({ foo: 'bar' });
    win.deleteSelection();

    assert.equal(win._getMolSmiles(), 'smiles:mol');
    assert.equal(win._getMolInchi(), 'inchi:mol');
    assert.equal(plotEl.classes.has('labels-hidden'), true);
    assert.equal(labelToggleEl.classes.has('active'), false);
    assert.deepEqual(records, [
      ['renderExamples'],
      ['setInputValue', 'CCO'],
      ['syncCollectionPicker', 'CCO'],
      ['parseSmiles', 'CCO'],
      ['handleForceResize'],
      ['undo'],
      ['redo'],
      ['copyForcePng'],
      ['copyForceSvg'],
      ['copySvg2d'],
      ['savePng2d'],
      ['openOptionsModal'],
      ['cleanLayout2d'],
      ['cleanLayoutForce'],
      ['togglePanMode'],
      ['toggleSelectMode'],
      ['toggleDrawBondMode'],
      ['handleDrawBondButtonClick'],
      ['openDrawBondDrawer'],
      ['closeDrawBondDrawer'],
      ['toggleEraseMode'],
      ['setChargeTool', 'positive'],
      ['setDrawElement', 'N'],
      ['setDrawBondType', 'dash'],
      ['toggleMode'],
      ['parseSmiles', 'CCN'],
      ['parseInchi', 'InChI=1S/CH4/h1H4'],
      ['parseInput', 'CCO'],
      ['setInputFormat', 'inchi', { preserveSelection: true }],
      ['renderExamples'],
      ['pickRandomMolecule'],
      ['takeInputFormatSnapshot', { foo: 'bar' }],
      ['deleteSelection']
    ]);
  });

  it('skips resize work without an active molecule and routes 2D resize to the 2D handler', () => {
    const listeners = new Map();
    const records = [];
    const win = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      }
    };
    const shell = initAppShell({
      win,
      dom: {
        getPlotElement: () => ({ classList: { toggle() {}, contains() { return false; } } }),
        getLabelToggleElement: () => ({ classList: { toggle() {} } })
      },
      history: { undo() {}, redo() {} },
      exportActions: { copyForcePng() {}, copyForceSvg() {}, copySvg2d() {}, savePng2d() {} },
      options: { open() {} },
      navigation: { cleanLayout2d() {}, cleanLayoutForce() {}, toggleMode() {} },
      selection: {
        togglePanMode() {},
        toggleSelectMode() {},
        toggleDrawBondMode() {},
        handleDrawBondButtonClick() {},
        openDrawBondDrawer() {},
        closeDrawBondDrawer() {},
        toggleEraseMode() {},
        setDrawElement() {},
        setDrawBondType() {}
      },
      editing: { deleteSelection() {} },
      state: {
        hasLoadedInput: () => false,
        getMode: () => '2d'
      },
      view: {
        handleForceResize: () => {
          records.push('force');
        },
        handle2DResize: () => {
          records.push('2d');
        }
      },
      input: {
        parseSmiles() {},
        parseInchi() {},
        parseInput() {},
        setInputFormat() {},
        renderExamples() {},
        pickRandomMolecule() {},
        getCanonicalMol: () => null,
        toSmiles: () => '',
        toInchi: () => '',
        takeInputFormatSnapshot() {}
      },
      initialState: {
        getInitialSmiles: () => 'CCO',
        setInputValue() {},
        syncCollectionPicker() {}
      }
    });

    listeners.get('resize')();
    assert.deepEqual(records, []);

    shell.handleResize = listeners.get('resize');
    const shell2 = initAppShell({
      win: {
        addEventListener(type, handler) {
          listeners.set(`second:${type}`, handler);
        }
      },
      dom: {
        getPlotElement: () => ({ classList: { toggle() {}, contains() { return false; } } }),
        getLabelToggleElement: () => ({ classList: { toggle() {} } })
      },
      history: { undo() {}, redo() {} },
      exportActions: { copyForcePng() {}, copyForceSvg() {}, copySvg2d() {}, savePng2d() {} },
      options: { open() {} },
      navigation: { cleanLayout2d() {}, cleanLayoutForce() {}, toggleMode() {} },
      selection: {
        togglePanMode() {},
        toggleSelectMode() {},
        toggleDrawBondMode() {},
        handleDrawBondButtonClick() {},
        openDrawBondDrawer() {},
        closeDrawBondDrawer() {},
        toggleEraseMode() {},
        setDrawElement() {},
        setDrawBondType() {}
      },
      editing: { deleteSelection() {} },
      state: {
        hasLoadedInput: () => true,
        getMode: () => '2d'
      },
      view: {
        handleForceResize: () => {
          records.push('force');
        },
        handle2DResize: () => {
          records.push('2d');
        }
      },
      input: {
        parseSmiles() {},
        parseInchi() {},
        parseInput() {},
        setInputFormat() {},
        renderExamples() {},
        pickRandomMolecule() {},
        getCanonicalMol: () => null,
        toSmiles: () => '',
        toInchi: () => '',
        takeInputFormatSnapshot() {}
      },
      initialState: {
        getInitialSmiles: () => 'CCO',
        setInputValue() {},
        syncCollectionPicker() {}
      }
    });

    listeners.get('second:resize')();
    assert.deepEqual(records, ['2d']);
    assert.equal(typeof shell2.bootstrap, 'function');
  });
});
