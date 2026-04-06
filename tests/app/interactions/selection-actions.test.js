import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSelectionActions } from '../../../src/app/interactions/selection.js';

function makeButton() {
  const classes = new Set();
  return {
    classList: {
      add(token) {
        classes.add(token);
      },
      remove(token) {
        classes.delete(token);
      },
      toggle(token, force) {
        if (force === undefined) {
          if (classes.has(token)) {
            classes.delete(token);
          } else {
            classes.add(token);
          }
          return;
        }
        if (force) {
          classes.add(token);
        } else {
          classes.delete(token);
        }
      },
      contains(token) {
        return classes.has(token);
      }
    }
  };
}

describe('createSelectionActions', () => {
  it('toggleDrawBondMode deactivates other tool modes and rerenders', () => {
    let selectMode = true;
    let drawBondMode = false;
    let eraseMode = true;
    let drawBondElement = 'N';
    const calls = [];
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      erase: makeButton(),
      N: makeButton()
    };

    const actions = createSelectionActions({
      state: {
        viewState: {
          getMode: () => '2d'
        },
        documentState: {
          getMol2d: () => ({ id: 'mol' })
        },
        overlayState: {
          getSelectMode: () => selectMode,
          setSelectMode: value => {
            selectMode = value;
          },
          getDrawBondMode: () => drawBondMode,
          setDrawBondMode: value => {
            drawBondMode = value;
          },
          getEraseMode: () => eraseMode,
          setEraseMode: value => {
            eraseMode = value;
          },
          getDrawBondElement: () => drawBondElement,
          setDrawBondElement: value => {
            drawBondElement = value;
          },
          getSelectedAtomIds: () => new Set(),
          getSelectedBondIds: () => new Set(),
          setErasePainting() {}
        }
      },
      renderers: {
        draw2d() {
          calls.push('draw2d');
        },
        applyForceSelection() {
          calls.push('applyForceSelection');
        }
      },
      view: {
        clearPrimitiveHover() {
          calls.push('clearPrimitiveHover');
        }
      },
      drawBond: {
        cancelDrawBond() {
          calls.push('cancelDrawBond');
        }
      },
      actions: {
        deleteSelection() {
          calls.push('deleteSelection');
        }
      },
      dom: {
        panButton: buttons.pan,
        selectButton: buttons.select,
        drawBondButton: buttons.draw,
        eraseButton: buttons.erase,
        getElementButton: element => buttons[element] ?? null
      }
    });

    actions.toggleDrawBondMode();

    assert.equal(drawBondMode, true);
    assert.equal(selectMode, false);
    assert.equal(eraseMode, false);
    assert.equal(buttons.draw.classList.contains('active'), true);
    assert.equal(buttons.erase.classList.contains('active'), false);
    assert.equal(buttons.N.classList.contains('active'), true);
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'draw2d']);
  });

  it('setDrawElement activates draw-bond mode when needed', () => {
    let drawBondMode = false;
    let drawBondElement = 'C';
    const calls = [];
    const actions = createSelectionActions({
      state: {
        viewState: {
          getMode: () => 'force'
        },
        documentState: {
          getMol2d: () => null
        },
        overlayState: {
          getSelectMode: () => false,
          setSelectMode() {},
          getDrawBondMode: () => drawBondMode,
          setDrawBondMode: value => {
            drawBondMode = value;
          },
          getEraseMode: () => false,
          setEraseMode() {},
          getDrawBondElement: () => drawBondElement,
          setDrawBondElement: value => {
            drawBondElement = value;
          },
          getSelectedAtomIds: () => new Set(),
          getSelectedBondIds: () => new Set(),
          setErasePainting() {}
        }
      },
      renderers: {
        draw2d() {},
        applyForceSelection() {
          calls.push('applyForceSelection');
        }
      },
      view: {
        clearPrimitiveHover() {
          calls.push('clearPrimitiveHover');
        }
      },
      drawBond: {
        cancelDrawBond() {
          calls.push('cancelDrawBond');
        }
      },
      actions: {
        deleteSelection() {}
      },
      dom: {
        panButton: makeButton(),
        selectButton: makeButton(),
        drawBondButton: makeButton(),
        eraseButton: makeButton(),
        getElementButton: () => null
      }
    });

    actions.setDrawElement('O');

    assert.equal(drawBondElement, 'O');
    assert.equal(drawBondMode, true);
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'applyForceSelection']);
  });
});
