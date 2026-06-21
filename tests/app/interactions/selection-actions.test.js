import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSelectionActions } from '../../../src/app/interactions/selection.js';

function makeButton() {
  const classes = new Set();
  const styleProperties = new Map();
  return {
    innerHTML: '',
    style: {
      setProperty(name, value) {
        styleProperties.set(name, value);
      },
      getPropertyValue(name) {
        return styleProperties.get(name) ?? '';
      }
    },
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

function makeNode(initial = {}) {
  const node = {
    ...makeButton(),
    children: [],
    dataset: {},
    hidden: false,
    listeners: new Map(),
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    dispatch(type) {
      this.listeners.get(type)?.({ target: this });
    },
    dispatchEvent(type, event = {}) {
      this.listeners.get(type)?.({ target: this, ...event });
    },
    contains(target) {
      return target === this || this.children.includes(target);
    },
    ...initial
  };
  return node;
}

function makeDocumentWithListeners() {
  const listeners = new Map();
  return {
    createElement() {
      return makeNode({ hidden: false });
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      listeners.set(
        type,
        list.filter(current => current !== handler)
      );
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) {
        handler(event);
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.length ?? 0;
    }
  };
}

function makeColorInput(value = '#3366ff') {
  const listeners = new Map();
  const properties = new Map();
  return {
    value,
    style: {
      backgroundColor: '',
      setProperty(name, nextValue) {
        properties.set(name, nextValue);
      },
      getPropertyValue(name) {
        return properties.get(name) ?? '';
      }
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchInput(nextValue) {
      this.value = nextValue;
      listeners.get('input')?.();
    }
  };
}

function makeRangeInput(value = '1') {
  return makeColorInput(value);
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

  it('handleDrawBondButtonClick returns to pan mode when draw bond mode is already active', () => {
    let drawBondMode = true;
    const calls = [];
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      erase: makeButton()
    };
    buttons.draw.classList.add('active');

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
          getChargeTool: () => null,
          setChargeTool() {},
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
        getChargeToolButton: () => null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null
      }
    });

    actions.handleDrawBondButtonClick();

    assert.equal(drawBondMode, false);
    assert.equal(buttons.pan.classList.contains('active'), true);
    assert.equal(buttons.draw.classList.contains('active'), false);
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'draw2d']);
  });

  it('setRingTemplateSize activates ring-template mode and closes its drawer', () => {
    let selectMode = true;
    let drawBondMode = true;
    let ringTemplateMode = false;
    let ringTemplateSize = 6;
    let eraseMode = false;
    let chargeTool = null;
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      ring: makeButton(),
      erase: makeButton(),
      positive: makeButton(),
      negative: makeButton(),
      ring5: makeButton(),
      benzene: makeButton()
    };
    buttons.ring5.innerHTML = '<svg data-ring="5"></svg>';
    buttons.benzene.innerHTML = '<svg data-ring="benzene"></svg>';
    const drawTools = makeButton();
    drawTools.classList.add('ring-template-drawer-open');
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
          getRingTemplateMode: () => ringTemplateMode,
          setRingTemplateMode: value => {
            ringTemplateMode = value;
          },
          getRingTemplateSize: () => ringTemplateSize,
          setRingTemplateSize: value => {
            ringTemplateSize = value;
          },
          getEraseMode: () => eraseMode,
          setEraseMode: value => {
            eraseMode = value;
          },
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getPaintMode: () => false,
          setPaintMode() {},
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
        draw2d() {},
        applyForceSelection() {}
      },
      view: {
        clearPrimitiveHover() {}
      },
      drawBond: {
        cancelDrawBond() {}
      },
      actions: {
        deleteSelection() {}
      },
      dom: {
        panButton: buttons.pan,
        selectButton: buttons.select,
        drawBondButton: buttons.draw,
        ringTemplateButton: buttons.ring,
        drawTools,
        eraseButton: buttons.erase,
        getStyleBrushButtons: () => [],
        getPaintColorSelectors: () => [],
        getPaintBrushSizeSelectors: () => [],
        getPaintOpacitySelectors: () => [],
        getPaintToolButtons: () => [],
        getChargeToolButton: tool => (tool === 'positive' ? buttons.positive : buttons.negative),
        getElementButton: () => makeButton(),
        getBondDrawTypeButton: () => makeButton(),
        getRingTemplateSizeButton: size => (size === 5 ? buttons.ring5 : size === 'benzene' ? buttons.benzene : makeButton())
      }
    });

    actions.setRingTemplateSize(5);

    assert.equal(ringTemplateMode, true);
    assert.equal(ringTemplateSize, 5);
    assert.equal(selectMode, false);
    assert.equal(drawBondMode, false);
    assert.equal(buttons.ring.classList.contains('active'), true);
    assert.equal(buttons.ring5.classList.contains('active'), true);
    assert.equal(buttons.ring.innerHTML, '<svg data-ring="5"></svg>');
    assert.equal(drawTools.classList.contains('ring-template-drawer-open'), false);
    assert.equal(drawTools.classList.contains('drawer-hover-suppressed'), true);

    drawTools.classList.add('ring-template-drawer-open');
    drawTools.classList.remove('drawer-hover-suppressed');
    actions.setRingTemplateSize('benzene');

    assert.equal(ringTemplateMode, true);
    assert.equal(ringTemplateSize, 'benzene');
    assert.equal(buttons.ring.classList.contains('active'), true);
    assert.equal(buttons.ring5.classList.contains('active'), false);
    assert.equal(buttons.benzene.classList.contains('active'), true);
    assert.equal(buttons.ring.innerHTML, '<svg data-ring="benzene"></svg>');
    assert.equal(drawTools.classList.contains('ring-template-drawer-open'), false);
    assert.equal(drawTools.classList.contains('drawer-hover-suppressed'), true);
  });

  it('handleRingTemplateButtonClick mirrors line drawer click behavior without latching or suppressing hover', () => {
    let selectMode = true;
    let drawBondMode = false;
    let ringTemplateMode = false;
    let eraseMode = false;
    let chargeTool = null;
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      ring: makeButton(),
      erase: makeButton(),
      ring6: makeButton()
    };
    buttons.ring6.innerHTML = '<svg data-ring="6"></svg>';
    const drawTools = makeButton();
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
          getRingTemplateMode: () => ringTemplateMode,
          setRingTemplateMode: value => {
            ringTemplateMode = value;
          },
          getRingTemplateSize: () => 6,
          setRingTemplateSize() {},
          getEraseMode: () => eraseMode,
          setEraseMode: value => {
            eraseMode = value;
          },
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getPaintMode: () => false,
          setPaintMode() {},
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
        draw2d() {},
        applyForceSelection() {}
      },
      view: {
        clearPrimitiveHover() {}
      },
      drawBond: {
        cancelDrawBond() {}
      },
      actions: {
        deleteSelection() {}
      },
      dom: {
        panButton: buttons.pan,
        selectButton: buttons.select,
        drawBondButton: buttons.draw,
        ringTemplateButton: buttons.ring,
        drawTools,
        eraseButton: buttons.erase,
        getStyleBrushButtons: () => [],
        getPaintColorSelectors: () => [],
        getPaintBrushSizeSelectors: () => [],
        getPaintOpacitySelectors: () => [],
        getPaintToolButtons: () => [],
        getChargeToolButton: () => null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null,
        getRingTemplateSizeButton: size => (size === 6 ? buttons.ring6 : null)
      }
    });

    actions.handleRingTemplateButtonClick();

    assert.equal(ringTemplateMode, true);
    assert.equal(selectMode, false);
    assert.equal(buttons.ring.classList.contains('active'), true);
    assert.equal(buttons.ring.innerHTML, '<svg data-ring="6"></svg>');
    assert.equal(drawTools.classList.contains('ring-template-drawer-open'), false);
    assert.equal(drawTools.classList.contains('drawer-hover-suppressed'), false);
  });

  it('closeRingTemplateDrawer clears open and hover-suppressed drawer state', () => {
    const drawTools = makeButton();
    drawTools.classList.add('ring-template-drawer-open');
    drawTools.classList.add('drawer-hover-suppressed');
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
          getDrawBondMode: () => false,
          setDrawBondMode() {},
          getRingTemplateMode: () => true,
          setRingTemplateMode() {},
          getRingTemplateSize: () => 6,
          setRingTemplateSize() {},
          getEraseMode: () => false,
          setEraseMode() {},
          getChargeTool: () => null,
          setChargeTool() {},
          getPaintMode: () => false,
          setPaintMode() {},
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
        draw2d() {},
        applyForceSelection() {}
      },
      view: {
        clearPrimitiveHover() {}
      },
      drawBond: {
        cancelDrawBond() {}
      },
      actions: {
        deleteSelection() {}
      },
      dom: {
        panButton: makeButton(),
        selectButton: makeButton(),
        drawBondButton: makeButton(),
        ringTemplateButton: makeButton(),
        drawTools,
        eraseButton: makeButton(),
        getStyleBrushButtons: () => [],
        getPaintColorSelectors: () => [],
        getPaintBrushSizeSelectors: () => [],
        getPaintOpacitySelectors: () => [],
        getPaintToolButtons: () => [],
        getChargeToolButton: () => null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null,
        getRingTemplateSizeButton: () => null
      }
    });

    actions.closeRingTemplateDrawer();

    assert.equal(drawTools.classList.contains('ring-template-drawer-open'), false);
    assert.equal(drawTools.classList.contains('drawer-hover-suppressed'), false);
  });

  it('togglePaintMode toggles active paint buttons and the plot cursor class', () => {
    let selectMode = true;
    let drawBondMode = false;
    let eraseMode = true;
    let paintMode = false;
    let paintTool = 'brush';
    let paintColor = '#3366ff';
    let paintBrushSize = 12;
    let paintOpacity = 1;
    let chargeTool = 'positive';
    const calls = [];
    const buttons = {
      pan: makeButton(),
      select: makeButton(),
      draw: makeButton(),
      erase: makeButton(),
      paint2d: makeButton(),
      paintForce: makeButton(),
      brush2d: makeButton(),
      brushForce: makeButton(),
      bucket2d: makeButton(),
      bucketForce: makeButton(),
      eraser2d: makeButton(),
      eraserForce: makeButton(),
      color2d: makeColorInput(),
      colorForce: makeColorInput(),
      brushSize2d: makeRangeInput(),
      brushSizeForce: makeRangeInput(),
      opacity2d: makeRangeInput(),
      opacityForce: makeRangeInput(),
      positive: makeButton()
    };
    buttons.brush2d.innerHTML = '<svg>brush</svg>';
    buttons.bucket2d.innerHTML = '<svg>bucket</svg>';
    buttons.eraser2d.innerHTML = '<svg>eraser</svg>';
    const paintSettingEvents = [];
    const plotElement = {
      ...makeButton(),
      dispatchEvent(event) {
        paintSettingEvents.push(event.type);
        return true;
      }
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
          getPaintMode: () => paintMode,
          setPaintMode: value => {
            paintMode = value;
          },
          getPaintTool: () => paintTool,
          setPaintTool: value => {
            paintTool = value;
          },
          getPaintColor: () => paintColor,
          setPaintColor: value => {
            paintColor = value;
          },
          getPaintBrushSize: () => paintBrushSize,
          setPaintBrushSize: value => {
            paintBrushSize = value;
          },
          getPaintOpacity: () => paintOpacity,
          setPaintOpacity: value => {
            paintOpacity = value;
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
          setErasePainting(value) {
            calls.push(['setErasePainting', value]);
          }
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
        plotElement,
        getStyleBrushButtons: () => [buttons.paint2d, buttons.paintForce],
        getPaintColorSelectors: () => [buttons.color2d, buttons.colorForce],
        getPaintBrushSizeSelectors: () => [buttons.brushSize2d, buttons.brushSizeForce],
        getPaintOpacitySelectors: () => [buttons.opacity2d, buttons.opacityForce],
        getPaintToolButtons: tool => {
          if (tool === 'brush') {
            return [buttons.brush2d, buttons.brushForce];
          }
          if (tool === 'bucket') {
            return [buttons.bucket2d, buttons.bucketForce];
          }
          if (tool === 'eraser') {
            return [buttons.eraser2d, buttons.eraserForce];
          }
          return [];
        },
        getChargeToolButton: tool => buttons[tool] ?? null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null
      }
    });

    actions.togglePaintMode();

    assert.equal(paintMode, true);
    assert.equal(buttons.paint2d.innerHTML, '<svg>brush</svg>');
    assert.equal(buttons.paintForce.innerHTML, '<svg>brush</svg>');
    assert.equal(selectMode, false);
    assert.equal(drawBondMode, false);
    assert.equal(eraseMode, false);
    assert.equal(chargeTool, null);
    assert.equal(buttons.paint2d.classList.contains('active'), true);
    assert.equal(buttons.paintForce.classList.contains('active'), true);
    assert.equal(buttons.brush2d.classList.contains('active'), true);
    assert.equal(buttons.brushForce.classList.contains('active'), true);
    assert.equal(buttons.bucket2d.classList.contains('active'), false);
    assert.equal(buttons.bucketForce.classList.contains('active'), false);
    assert.equal(buttons.eraser2d.classList.contains('active'), false);
    assert.equal(buttons.eraserForce.classList.contains('active'), false);
    assert.equal(buttons.color2d.value, '#3366ff');
    assert.equal(buttons.colorForce.style.backgroundColor, 'rgba(51, 102, 255, 1)');
    assert.equal(buttons.color2d.style.getPropertyValue('--paint-color'), '#3366ff');
    assert.equal(buttons.color2d.style.getPropertyValue('--paint-swatch-color'), 'rgba(51, 102, 255, 1)');
    assert.equal(buttons.brushSize2d.value, '12');
    assert.equal(buttons.brushSizeForce.value, '12');
    assert.equal(buttons.opacity2d.value, '1');
    assert.equal(buttons.opacityForce.value, '1');
    assert.equal(buttons.opacity2d.style.getPropertyValue('--paint-opacity'), '1');
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /%233366ff/);
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /width='24' height='24'/);
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /r='11'/);
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /fill-opacity='1'/);
    assert.equal(plotElement.classList.contains('paint-mode-cursor'), true);
    assert.equal(buttons.pan.classList.contains('active'), false);

    buttons.color2d.dispatchInput('#ff6633');

    assert.equal(paintColor, '#ff6633');
    assert.equal(buttons.color2d.value, '#ff6633');
    assert.equal(buttons.colorForce.value, '#ff6633');
    assert.equal(buttons.colorForce.style.backgroundColor, 'rgba(255, 102, 51, 1)');
    assert.equal(buttons.colorForce.style.getPropertyValue('--paint-swatch-color'), 'rgba(255, 102, 51, 1)');
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /%23ff6633/);
    assert.equal(paintSettingEvents.at(-1), 'molecules:paint-settings-changed');

    buttons.brushSize2d.dispatchInput('18');

    assert.equal(paintBrushSize, 18);
    assert.equal(buttons.brushSize2d.value, '18');
    assert.equal(buttons.brushSizeForce.value, '18');
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /width='36' height='36'/);
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /r='17'/);
    assert.equal(paintSettingEvents.at(-1), 'molecules:paint-settings-changed');

    buttons.opacity2d.dispatchInput('0.4');

    assert.equal(paintOpacity, 0.4);
    assert.equal(buttons.opacity2d.value, '0.4');
    assert.equal(buttons.opacityForce.value, '0.4');
    assert.equal(buttons.opacityForce.style.getPropertyValue('--paint-opacity'), '0.4');
    assert.equal(buttons.color2d.style.backgroundColor, 'rgba(255, 102, 51, 0.4)');
    assert.equal(buttons.colorForce.style.getPropertyValue('--paint-swatch-color'), 'rgba(255, 102, 51, 0.4)');
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /fill-opacity='0.4'/);
    assert.equal(paintSettingEvents.at(-1), 'molecules:paint-settings-changed');

    actions.setPaintTool('bucket');

    assert.equal(paintTool, 'bucket');
    assert.equal(buttons.paint2d.innerHTML, '<svg>bucket</svg>');
    assert.equal(buttons.paintForce.innerHTML, '<svg>bucket</svg>');
    assert.equal(buttons.brush2d.classList.contains('active'), false);
    assert.equal(buttons.brushForce.classList.contains('active'), false);
    assert.equal(buttons.bucket2d.classList.contains('active'), true);
    assert.equal(buttons.bucketForce.classList.contains('active'), true);
    assert.equal(buttons.eraser2d.classList.contains('active'), false);
    assert.equal(buttons.eraserForce.classList.contains('active'), false);
    assert.equal(buttons.paint2d.classList.contains('paint-eraser-tool'), false);
    assert.equal(paintSettingEvents.at(-1), 'molecules:paint-settings-changed');

    actions.setPaintTool('eraser');

    assert.equal(paintTool, 'eraser');
    assert.equal(buttons.paint2d.innerHTML, '<svg>eraser</svg>');
    assert.equal(buttons.paintForce.innerHTML, '<svg>eraser</svg>');
    assert.equal(buttons.brush2d.classList.contains('active'), false);
    assert.equal(buttons.bucket2d.classList.contains('active'), false);
    assert.equal(buttons.eraser2d.classList.contains('active'), true);
    assert.equal(buttons.eraserForce.classList.contains('active'), true);
    assert.equal(buttons.paint2d.classList.contains('paint-eraser-tool'), true);
    assert.equal(buttons.paintForce.classList.contains('paint-eraser-tool'), true);
    assert.match(plotElement.style.getPropertyValue('--paint-mode-cursor'), /fill='none'/);

    actions.togglePaintMode();

    assert.equal(paintMode, false);
    assert.equal(buttons.paint2d.classList.contains('active'), false);
    assert.equal(buttons.paintForce.classList.contains('active'), false);
    assert.equal(buttons.paint2d.innerHTML, '<svg>eraser</svg>');
    assert.equal(buttons.paintForce.innerHTML, '<svg>eraser</svg>');
    assert.equal(buttons.brush2d.classList.contains('active'), false);
    assert.equal(buttons.brushForce.classList.contains('active'), false);
    assert.equal(buttons.bucket2d.classList.contains('active'), false);
    assert.equal(buttons.bucketForce.classList.contains('active'), false);
    assert.equal(buttons.eraser2d.classList.contains('active'), false);
    assert.equal(buttons.eraserForce.classList.contains('active'), false);
    assert.equal(plotElement.classList.contains('paint-mode-cursor'), false);
    assert.equal(buttons.pan.classList.contains('active'), true);

    actions.setPaintTool('bucket');

    assert.equal(paintMode, true);
    assert.equal(paintTool, 'bucket');
    assert.equal(buttons.pan.classList.contains('active'), false);
    assert.equal(buttons.paint2d.classList.contains('active'), true);
    assert.equal(buttons.bucket2d.classList.contains('active'), true);
    assert.equal(buttons.paint2d.classList.contains('paint-eraser-tool'), false);
    assert.equal(plotElement.classList.contains('paint-mode-cursor'), true);
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

  it('periodic table picker selects any supported element for drawing', () => {
    let drawBondMode = false;
    let chargeTool = null;
    let drawBondElement = 'C';
    const calls = [];
    const periodicButton = makeButton();
    periodicButton.getBoundingClientRect = () => ({ top: 300, left: 512, width: 32, height: 32, bottom: 332 });
    const periodicPopover = makeNode({ hidden: true });
    periodicPopover.getBoundingClientRect = () => ({ width: 497, height: 297 });
    const periodicGrid = makeNode();
    const doc = {
      defaultView: {
        innerWidth: 1000,
        innerHeight: 700
      },
      addEventListener() {},
      createElement() {
        return makeNode({ hidden: false });
      }
    };
    const actions = createSelectionActions({
      document: doc,
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
          getRingTemplateMode: () => false,
          setRingTemplateMode() {},
          getEraseMode: () => false,
          setEraseMode() {},
          getPaintMode: () => false,
          setPaintMode() {},
          getChargeTool: () => chargeTool,
          setChargeTool: value => {
            chargeTool = value;
          },
          getDrawBondElement: () => drawBondElement,
          setDrawBondElement: value => {
            drawBondElement = value;
          },
          getDrawBondType: () => 'single',
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
        getPeriodicTableButton: () => periodicButton,
        getPeriodicTablePopover: () => periodicPopover,
        getPeriodicTableGrid: () => periodicGrid,
        getElementButton: element => periodicGrid.children.filter(child => child.dataset.periodicElement === element),
        getBondDrawTypeButton: () => null
      }
    });

    actions.openPeriodicTablePicker();
    const ironButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'Fe');
    const carbonButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'C');
    const deuteriumButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'D');
    const lanthanumButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'La');
    const actiniumButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'Ac');
    const magnesiumButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'Mg');
    const rutherfordiumButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'Rf');
    const preview = periodicGrid.children.find(child => child.className === 'periodic-element-preview');
    const columnLabels = periodicGrid.children.filter(child => child.className === 'periodic-table-column-label');
    const rowLabels = periodicGrid.children.filter(child => child.className === 'periodic-table-row-label');

    assert.equal(periodicPopover.hidden, false);
    assert.equal(periodicPopover.style.getPropertyValue('--periodic-table-popover-top'), '8px');
    assert.equal(periodicPopover.style.getPropertyValue('--periodic-table-popover-left'), '279.5px');
    assert.equal(periodicGrid.children.length, 144);
    assert.equal(columnLabels.length, 18);
    assert.equal(rowLabels.length, 7);
    assert.equal(columnLabels[0].textContent, '1');
    assert.equal(columnLabels[17].textContent, '18');
    assert.equal(columnLabels[0].style.gridRow, '1');
    assert.equal(columnLabels[0].style.gridColumn, '2');
    assert.equal(rowLabels[0].textContent, '1');
    assert.equal(rowLabels[6].textContent, '7');
    assert.equal(rowLabels[0].style.gridRow, '2');
    assert.equal(rowLabels[0].style.gridColumn, '1');
    assert.ok(ironButton);
    assert.ok(carbonButton);
    assert.ok(lanthanumButton);
    assert.ok(actiniumButton);
    assert.equal(deuteriumButton, undefined);
    assert.equal(carbonButton.title, 'C (Carbon)');
    assert.equal(carbonButton.style.backgroundColor, '#333333');
    assert.equal(carbonButton.style.color, '#ffffff');
    assert.ok(preview);
    assert.equal(preview.hidden, true);
    assert.equal(preview.style.gridRow, '2 / span 3');
    assert.equal(preview.style.gridColumn, '8 / span 3');
    assert.equal(ironButton.style.gridRow, '5');
    assert.equal(ironButton.style.gridColumn, '9');
    assert.equal(lanthanumButton.style.gridRow, '10');
    assert.equal(lanthanumButton.style.gridColumn, '5');
    assert.equal(lanthanumButton.classList.contains('periodic-f-block-cell'), true);
    assert.equal(actiniumButton.style.gridRow, '11');
    assert.equal(actiniumButton.style.gridColumn, '5');

    ironButton.dispatch('mouseenter');

    assert.equal(preview.hidden, false);
    assert.equal(preview.dataset.periodicElement, 'Fe');
    assert.equal(preview.__periodicPreviewNumber.textContent, '26');
    assert.equal(preview.__periodicPreviewSymbol.textContent, 'Fe');
    assert.equal(preview.__periodicPreviewName.textContent, 'Iron');
    assert.equal(preview.__periodicPreviewWeight.textContent, '55.845');

    ironButton.dispatch('mouseleave');

    assert.equal(preview.hidden, true);

    rutherfordiumButton.dispatch('mouseenter');

    assert.equal(preview.__periodicPreviewName.textContent, 'Rutherfordium');
    assert.equal(preview.__periodicPreviewName.style.fontSize, '8px');

    rutherfordiumButton.dispatch('mouseleave');

    magnesiumButton.dispatch('mouseenter');

    assert.equal(preview.__periodicPreviewName.textContent, 'Magnesium');
    assert.equal(preview.__periodicPreviewName.style.fontSize, '9px');

    magnesiumButton.dispatch('mouseleave');

    ironButton.dispatch('click');

    assert.equal(drawBondElement, 'Fe');
    assert.equal(drawBondMode, true);
    assert.equal(periodicPopover.hidden, true);
    assert.equal(periodicButton.classList.contains('active'), true);
    assert.equal(ironButton.classList.contains('active'), true);
    assert.deepEqual(calls, ['cancelDrawBond', 'clearPrimitiveHover', 'applyForceSelection']);
  });

  it('periodic table popout can be dragged without stealing element clicks', () => {
    let drawBondMode = false;
    let drawBondElement = 'C';
    const periodicButton = makeButton();
    const periodicPopover = makeNode({ hidden: true });
    const periodicGrid = makeNode();
    const doc = makeDocumentWithListeners();
    const actions = createSelectionActions({
      document: doc,
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
          getRingTemplateMode: () => false,
          setRingTemplateMode() {},
          getEraseMode: () => false,
          setEraseMode() {},
          getPaintMode: () => false,
          setPaintMode() {},
          getChargeTool: () => null,
          setChargeTool() {},
          getDrawBondElement: () => drawBondElement,
          setDrawBondElement: value => {
            drawBondElement = value;
          },
          getDrawBondType: () => 'single',
          getSelectedAtomIds: () => new Set(),
          getSelectedBondIds: () => new Set(),
          setErasePainting() {}
        }
      },
      renderers: {
        draw2d() {},
        applyForceSelection() {}
      },
      view: {
        clearPrimitiveHover() {}
      },
      drawBond: {
        cancelDrawBond() {}
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
        getPeriodicTableButton: () => periodicButton,
        getPeriodicTablePopover: () => periodicPopover,
        getPeriodicTableGrid: () => periodicGrid,
        getElementButton: element => periodicGrid.children.filter(child => child.dataset.periodicElement === element),
        getBondDrawTypeButton: () => null
      }
    });

    actions.openPeriodicTablePicker();
    const ironButton = periodicGrid.children.find(child => child.dataset.periodicElement === 'Fe');

    periodicPopover.dispatchEvent('pointerdown', {
      clientX: 100,
      clientY: 80
    });
    let movePrevented = false;
    doc.dispatch('pointermove', {
      clientX: 125,
      clientY: 92,
      preventDefault() {
        movePrevented = true;
      }
    });

    assert.equal(movePrevented, true);
    assert.equal(periodicPopover.style.getPropertyValue('--periodic-table-drag-x'), '25px');
    assert.equal(periodicPopover.style.getPropertyValue('--periodic-table-drag-y'), '12px');
    assert.equal(periodicPopover.classList.contains('periodic-table-dragging'), true);

    doc.dispatch('pointerup', {});

    assert.equal(periodicPopover.classList.contains('periodic-table-dragging'), false);
    assert.equal(doc.listenerCount('pointermove'), 0);

    periodicPopover.dispatchEvent('pointerdown', {
      target: ironButton,
      clientX: 125,
      clientY: 92
    });
    ironButton.dispatch('click');

    assert.equal(drawBondElement, 'Fe');
    assert.equal(drawBondMode, true);
    assert.equal(periodicPopover.style.getPropertyValue('--periodic-table-drag-x'), '25px');
    assert.equal(periodicPopover.style.getPropertyValue('--periodic-table-drag-y'), '12px');
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

  it('closes opened tool drawers on outside pointer interaction', () => {
    let pointerDownHandler = null;
    const drawTools = makeButton();
    const actions = createSelectionActions({
      document: {
        addEventListener(type, handler) {
          if (type === 'pointerdown') {
            pointerDownHandler = handler;
          }
        }
      },
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
          getDrawBondMode: () => true,
          setDrawBondMode() {},
          getEraseMode: () => false,
          setEraseMode() {},
          getChargeTool: () => null,
          setChargeTool() {},
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
        draw2d() {},
        applyForceSelection() {}
      },
      view: {
        clearPrimitiveHover() {}
      },
      drawBond: {
        cancelDrawBond() {}
      },
      actions: {
        deleteSelection() {}
      },
      dom: {
        panButton: makeButton(),
        selectButton: makeButton(),
        drawBondButton: makeButton(),
        drawTools,
        eraseButton: makeButton(),
        getChargeToolButton: () => null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null
      }
    });

    actions.openDrawBondDrawer();
    actions.openRingTemplateDrawer();
    pointerDownHandler({
      target: {
        closest: () => null
      }
    });

    assert.equal(drawTools.classList.contains('drawer-open'), false);
    assert.equal(drawTools.classList.contains('ring-template-drawer-open'), false);
  });

  it('keeps an opened bond drawer open while the pointer interaction stays inside draw tools', () => {
    let pointerDownHandler = null;
    const drawTools = makeButton();
    const actions = createSelectionActions({
      document: {
        addEventListener(type, handler) {
          if (type === 'pointerdown') {
            pointerDownHandler = handler;
          }
        }
      },
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
          getDrawBondMode: () => true,
          setDrawBondMode() {},
          getEraseMode: () => false,
          setEraseMode() {},
          getChargeTool: () => null,
          setChargeTool() {},
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
        draw2d() {},
        applyForceSelection() {}
      },
      view: {
        clearPrimitiveHover() {}
      },
      drawBond: {
        cancelDrawBond() {}
      },
      actions: {
        deleteSelection() {}
      },
      dom: {
        panButton: makeButton(),
        selectButton: makeButton(),
        drawBondButton: makeButton(),
        drawTools,
        eraseButton: makeButton(),
        getChargeToolButton: () => null,
        getElementButton: () => null,
        getBondDrawTypeButton: () => null
      }
    });

    actions.openDrawBondDrawer();
    pointerDownHandler({
      target: {
        closest: selector => (selector === '#draw-tools' ? {} : null)
      }
    });

    assert.equal(drawTools.classList.contains('drawer-open'), true);
  });
});
