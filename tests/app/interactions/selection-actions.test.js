import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSelectionActions } from '../../../src/app/interactions/selection.js';

function makeButton() {
  const classes = new Set();
  return {
    innerHTML: '',
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
  it('togglePanMode exits charge mode and marks pan active', () => {
    let selectMode = false;
    let drawBondMode = false;
    let eraseMode = false;
    let chargeTool = 'positive';
    const calls = [];
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      erase: makeButton(),
      positive: makeButton(),
      negative: makeButton()
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
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getDrawBondElement: () => 'C',
          setDrawBondElement() {},
          getDrawBondType: () => 'single',
          setDrawBondType() {},
          getSelectedAtomIds: () => new Set(),
          getSelectedBondIds: () => new Set(),
          setErasePainting() {}
        }
      },
      renderers: {
        draw2d() {
          calls.push('draw2d');
        },
        applyForceSelection() {}
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
        panButton: buttons.pan,
        selectButton: buttons.select,
        drawBondButton: buttons.draw,
        drawTools: makeButton(),
        eraseButton: buttons.erase,
        getChargeToolButton: tool => buttons[tool] ?? null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null
      }
    });

    actions.togglePanMode();

    assert.equal(selectMode, false);
    assert.equal(drawBondMode, false);
    assert.equal(eraseMode, false);
    assert.equal(chargeTool, null);
    assert.equal(buttons.pan.classList.contains('active'), true);
    assert.equal(buttons.positive.classList.contains('active'), false);
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'draw2d']);
  });

  it('toggleDrawBondMode deactivates other tool modes and rerenders', () => {
    let selectMode = true;
    let drawBondMode = false;
    let eraseMode = true;
    let chargeTool = null;
    let drawBondElement = 'N';
    let drawBondType = 'single';
    const calls = [];
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      erase: makeButton(),
      N: makeButton(),
      single: makeButton()
    };
    buttons.single.innerHTML = '<svg>single</svg>';

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
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getDrawBondElement: () => drawBondElement,
          setDrawBondElement: value => {
            drawBondElement = value;
          },
          getDrawBondType: () => drawBondType,
          setDrawBondType: value => {
            drawBondType = value;
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
        drawTools: makeButton(),
        eraseButton: buttons.erase,
        getElementButton: element => buttons[element] ?? null,
        getBondDrawTypeButton: type => buttons[type] ?? null
      }
    });

    actions.toggleDrawBondMode();

    assert.equal(drawBondMode, true);
    assert.equal(selectMode, false);
    assert.equal(eraseMode, false);
    assert.equal(buttons.draw.classList.contains('active'), true);
    assert.equal(buttons.erase.classList.contains('active'), false);
    assert.equal(buttons.N.classList.contains('active'), true);
    assert.equal(buttons.single.classList.contains('active'), true);
    assert.equal(buttons.draw.innerHTML, '<svg>single</svg>');
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'draw2d']);
  });

  it('setDrawElement activates draw-bond mode when needed', () => {
    let drawBondMode = false;
    let chargeTool = null;
    let drawBondElement = 'C';
    let drawBondType = 'single';
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
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getDrawBondElement: () => drawBondElement,
          setDrawBondElement: value => {
            drawBondElement = value;
          },
          getDrawBondType: () => drawBondType,
          setDrawBondType: value => {
            drawBondType = value;
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
        drawTools: makeButton(),
        eraseButton: makeButton(),
        getElementButton: () => null,
        getBondDrawTypeButton: () => null
      }
    });

    actions.setDrawElement('O');

    assert.equal(drawBondElement, 'O');
    assert.equal(drawBondMode, true);
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'applyForceSelection']);
  });

  it('setDrawBondType enables draw mode, marks the active option, updates the main button icon, and closes the drawer', () => {
    let drawBondMode = false;
    let chargeTool = null;
    let drawBondType = 'single';
    const drawTools = makeButton();
    const dashButton = makeButton();
    const drawBondButton = makeButton();
    dashButton.innerHTML = '<svg>dash</svg>';
    const calls = [];
    const actions = createSelectionActions({
      state: {
        viewState: {
          getMode: () => '2d'
        },
        documentState: {
          getMol2d: () => ({ id: 'mol' })
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
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getDrawBondElement: () => 'C',
          setDrawBondElement() {},
          getDrawBondType: () => drawBondType,
          setDrawBondType: value => {
            drawBondType = value;
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
        applyForceSelection() {}
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
        drawBondButton,
        drawTools,
        eraseButton: makeButton(),
        getElementButton: () => null,
        getBondDrawTypeButton: type => (type === 'dash' ? dashButton : null)
      }
    });

    drawTools.classList.add('drawer-open');
    actions.setDrawBondType('dash');

    assert.equal(drawBondType, 'dash');
    assert.equal(drawBondMode, true);
    assert.equal(drawTools.classList.contains('drawer-open'), false);
    assert.equal(drawTools.classList.contains('drawer-hover-suppressed'), true);
    assert.equal(dashButton.classList.contains('active'), true);
    assert.equal(drawBondButton.innerHTML, '<svg>dash</svg>');
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'draw2d']);
  });

  it('setChargeTool activates the requested charge tool and clears other modes', () => {
    let selectMode = true;
    let drawBondMode = true;
    let eraseMode = true;
    let chargeTool = null;
    const calls = [];
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      erase: makeButton(),
      positive: makeButton(),
      negative: makeButton()
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
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getDrawBondElement: () => 'C',
          setDrawBondElement() {},
          getDrawBondType: () => 'single',
          setDrawBondType() {},
          getSelectedAtomIds: () => new Set(),
          getSelectedBondIds: () => new Set(),
          setErasePainting() {}
        }
      },
      renderers: {
        draw2d() {
          calls.push('draw2d');
        },
        applyForceSelection() {}
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
        panButton: buttons.pan,
        selectButton: buttons.select,
        drawBondButton: buttons.draw,
        drawTools: makeButton(),
        eraseButton: buttons.erase,
        getChargeToolButton: tool => buttons[tool] ?? null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null
      }
    });

    actions.setChargeTool('positive');

    assert.equal(selectMode, false);
    assert.equal(drawBondMode, false);
    assert.equal(eraseMode, false);
    assert.equal(chargeTool, 'positive');
    assert.equal(buttons.positive.classList.contains('active'), true);
    assert.equal(buttons.pan.classList.contains('active'), false);
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'draw2d']);
  });
});
