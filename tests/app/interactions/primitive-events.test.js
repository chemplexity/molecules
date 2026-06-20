import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitiveEventHandlers } from '../../../src/app/interactions/primitive-events.js';

function makeSvgElement(tagName) {
  const element = {
    tagName,
    attributes: new Map(),
    children: [],
    parentNode: null,
    ownerDocument: null,
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    appendChild(child) {
      child.parentNode = this;
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
      return child;
    },
    remove() {
      if (!this.parentNode) {
        return;
      }
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    },
    querySelector(selector) {
      const [tag, className] = selector.startsWith('.') ? [null, selector.slice(1)] : selector.split('.');
      const matches = node => {
        const tagMatches = !tag || node.tagName === tag;
        const classes = (node.getAttribute?.('class') ?? '').split(/\s+/);
        return tagMatches && (!className || classes.includes(className));
      };
      const visit = node => {
        for (const child of node.children ?? []) {
          if (matches(child)) {
            return child;
          }
          const nested = visit(child);
          if (nested) {
            return nested;
          }
        }
        return null;
      };
      return visit(this);
    }
  };
  return element;
}

function makeSvgRoot() {
  const documentMock = {
    createElementNS(_namespace, tagName) {
      const element = makeSvgElement(tagName);
      element.ownerDocument = documentMock;
      return element;
    }
  };
  const root = makeSvgElement('g');
  root.ownerDocument = documentMock;
  return root;
}

function svgLineLength(line) {
  const x1 = Number(line.getAttribute('x1'));
  const y1 = Number(line.getAttribute('y1'));
  const x2 = Number(line.getAttribute('x2'));
  const y2 = Number(line.getAttribute('y2'));
  return Math.hypot(x2 - x1, y2 - y1);
}

function makeContext(overrides = {}) {
  let drawBondMode = false;
  let eraseMode = false;
  let erasePainting = false;
  let selectMode = false;
  let chargeTool = null;
  let paintMode = false;
  let paintTool = 'brush';
  let paintColor = '#3366ff';
  let paintOpacity = 1;
  let ringTemplateMode = false;
  let ringTemplateSize = 6;
  let drawBondType = 'triple';
  let mode = 'force';
  let selectionValenceTooltipAtomId = null;
  let primitiveHoverSuppressed = false;
  const hoveredAtomIds = new Set();
  const hoveredBondIds = new Set();
  const calls = [];

  const context = {
    state: {
      viewState: {
        getMode: () => mode
      },
      documentState: overrides.documentState ?? {
        getCurrentMol: () => overrides.currentMol ?? null,
        getMol2d: () => overrides.mol2d ?? null
      },
      overlayState: {
        getDrawBondMode: () => drawBondMode,
        getEraseMode: () => eraseMode,
        getErasePainting: () => erasePainting,
        getSelectMode: () => selectMode,
        getPaintMode: () => paintMode,
        getPaintTool: () => paintTool,
        getPaintColor: () => paintColor,
        getPaintOpacity: () => paintOpacity,
        getRingTemplateMode: () => ringTemplateMode,
        getRingTemplateSize: () => ringTemplateSize,
        getChargeTool: () => chargeTool,
        getHoveredAtomIds: () => hoveredAtomIds,
        getHoveredBondIds: () => hoveredBondIds
      }
    },
    selection: {
      handle2dPrimitiveClick(...args) {
        calls.push(['handle2dPrimitiveClick', ...args]);
      },
      handle2dComponentDblClick(...args) {
        calls.push(['handle2dComponentDblClick', ...args]);
      },
      handleForcePrimitiveClick(...args) {
        calls.push(['handleForcePrimitiveClick', ...args]);
      },
      handleForceComponentDblClick(...args) {
        calls.push(['handleForceComponentDblClick', ...args]);
      }
    },
    overlays: {
      isReactionPreviewEditableAtomId: () => true
    },
    drawBond: {
      hasDrawBondState: () => false,
      start(...args) {
        calls.push(['start', ...args]);
      },
      previewBond(...args) {
        calls.push(['previewBond', ...args]);
      },
      clearArtifacts() {
        calls.push(['clearArtifacts']);
      },
      resetHover() {
        calls.push(['resetHover']);
      },
      getElement: () => 'N',
      getType: () => drawBondType
    },
    actions: {
      promoteBondOrder(...args) {
        calls.push(['promoteBondOrder', ...args]);
      },
      eraseItem(...args) {
        calls.push(['eraseItem', ...args]);
      },
      changeAtomCharge(...args) {
        calls.push(['changeAtomCharge', ...args]);
      },
      paintStyleTargets(...args) {
        calls.push(['paintStyleTargets', ...args]);
      },
      placeRingTemplate(...args) {
        calls.push(['placeRingTemplate', ...args]);
      },
      replaceForceHydrogenAtom(...args) {
        calls.push(['replaceForceHydrogenAtom', ...args]);
      }
    },
    view: {
      showPrimitiveHover(...args) {
        calls.push(['showPrimitiveHover', ...args]);
      },
      isPrimitiveHoverSuppressed: () => primitiveHoverSuppressed,
      setPrimitiveHoverSuppressed(value) {
        primitiveHoverSuppressed = value;
        calls.push(['setPrimitiveHoverSuppressed', value]);
      },
      clearPrimitiveHover() {
        calls.push(['clearPrimitiveHover']);
      },
      refreshSelectionOverlay() {
        calls.push(['refreshSelectionOverlay']);
      },
      isDrawBondHoverSuppressed: () => false
    },
    tooltip: {
      showDelayed(...args) {
        calls.push(['showDelayed', ...args]);
      },
      showImmediate(...args) {
        calls.push(['showImmediate', ...args]);
      },
      move(...args) {
        calls.push(['move', ...args]);
      },
      hide() {
        calls.push(['hide']);
      }
    },
    tooltipState: {
      getSelectionValenceTooltipAtomId: () => selectionValenceTooltipAtomId,
      setSelectionValenceTooltipAtomId: value => {
        selectionValenceTooltipAtomId = value;
        calls.push(['setSelectionValenceTooltipAtomId', value]);
      }
    },
    options: {
      getRenderOptions: () => ({ showAtomTooltips: true })
    },
    formatters: {
      atomTooltipHtml: () => 'atom-tooltip',
      bondTooltipHtml: () => 'bond-tooltip'
    },
    pointer: () => [10, 20],
    dom: {
      gNode: () => ({})
    }
  };

  const mergedView = { ...context.view, ...(overrides.view ?? {}) };
  const mergedPlot = { ...(context.plot ?? {}), ...(overrides.plot ?? {}) };
  Object.assign(context, overrides);
  context.view = mergedView;
  if (Object.keys(mergedPlot).length > 0) {
    context.plot = mergedPlot;
  }
  return {
    context,
    calls,
    setDrawBondMode: value => {
      drawBondMode = value;
    },
    setEraseMode: value => {
      eraseMode = value;
    },
    setErasePainting: value => {
      erasePainting = value;
    },
    setSelectMode: value => {
      selectMode = value;
    },
    setChargeTool: value => {
      chargeTool = value;
    },
    setPaintMode: value => {
      paintMode = value;
    },
    setPaintTool: value => {
      paintTool = value;
    },
    setPaintColor: value => {
      paintColor = value;
    },
    setPaintOpacity: value => {
      paintOpacity = value;
    },
    setRingTemplateMode: value => {
      ringTemplateMode = value;
    },
    setRingTemplateSize: value => {
      ringTemplateSize = value;
    },
    setDrawBondType: value => {
      drawBondType = value;
    },
    setMode: value => {
      mode = value;
    },
    setPrimitiveHoverSuppressed: value => {
      primitiveHoverSuppressed = value;
    }
  };
}

describe('createPrimitiveEventHandlers', () => {
  it('routes atom clicks to anchored ring template placement in ring-template mode', () => {
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext();
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    };

    handlers.handle2dAtomClick(event, 'a1');
    handlers.handleForceAtomClick(event, { id: 'a2', name: 'C' }, { id: 'mol' });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, [
      ['showPrimitiveHover', ['a1'], []],
      ['placeRingTemplate', 5, 10, 20, { anchorAtomId: 'a1' }],
      ['showPrimitiveHover', ['a2'], []],
      ['placeRingTemplate', 5, 10, 20, { anchorAtomId: 'a2' }]
    ]);
  });

  it('routes bond clicks to bond-anchored ring template placement in ring-template mode', () => {
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext();
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    };

    handlers.handle2dBondClick(event, 'b1');

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, [
      ['showPrimitiveHover', [], ['b1']],
      ['placeRingTemplate', 6, 10, 20, { anchorBondId: 'b1', autoFuseBondPositionReuse: true }]
    ]);
  });

  it('ignores product-side atom clicks in reaction preview ring-template mode', () => {
    const { context, calls, setMode, setRingTemplateMode } = makeContext({
      overlays: {
        isReactionPreviewEditableAtomId: atomId => atomId !== 'product-a1'
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;

    handlers.handle2dAtomClick(
      {
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        }
      },
      'product-a1'
    );

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, []);
  });

  it('ignores product-side bond clicks in reaction preview ring-template mode', () => {
    const productBond = { id: 'product-b1', atoms: ['product-a1', 'product-a2'] };
    const { context, calls, setMode, setRingTemplateMode } = makeContext({
      mol2d: {
        bonds: new Map([[productBond.id, productBond]])
      },
      overlays: {
        isReactionPreviewEditableAtomId: atomId => !atomId.startsWith('product-')
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;

    handlers.handle2dBondClick(
      {
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        }
      },
      productBond.id
    );

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, []);
  });

  it('routes force bond clicks to bond-anchored ring template placement for heavy-atom bonds', () => {
    const { context, calls, setRingTemplateMode, setRingTemplateSize } = makeContext();
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);
    const molecule = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }],
        ['h1', { id: 'h1', name: 'H' }]
      ]),
      bonds: new Map([
        ['b1', { id: 'b1', atoms: ['a1', 'a2'] }],
        ['b2', { id: 'b2', atoms: ['a1', 'h1'] }]
      ])
    };

    handlers.handleForceBondClick({ preventDefault() {}, stopPropagation() {} }, 'b1', molecule);
    handlers.handleForceBondClick({ preventDefault() {}, stopPropagation() {} }, 'b2', molecule);

    assert.deepEqual(calls, [
      ['showPrimitiveHover', [], ['b1']],
      ['placeRingTemplate', 5, 10, 20, { anchorBondId: 'b1', autoFuseBondPositionReuse: true }]
    ]);
  });

  it('commits anchored ring template placement on mouseup and uses snapped drag orientation', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [10, 20];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(4);
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    };

    handlers.handle2dAtomMouseDownDrawBond(event, 'a1');
    const initialPreview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(initialPreview);
    assert.equal(initialPreview.children.length, 4);
    assert.deepEqual(calls, [
      ['showPrimitiveHover', ['a1'], []],
      ['showPrimitiveHover', ['a1'], []]
    ]);
    assert.equal(typeof listeners.get('mousemove'), 'function');
    assert.equal(typeof listeners.get('mouseup'), 'function');

    pointer = [10, 80];
    listeners.get('mousemove')({ preventDefault() {} });
    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    assert.equal(preview.children.length, 4);
    assert.equal(preview.children.every(child => child.tagName === 'line' && child.getAttribute('class') === 'bond'), true);
    assert.equal(preview.querySelector('polygon'), null);
    listeners.get('mouseup')({
      preventDefault() {},
      stopPropagation() {}
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(listeners.has('mousemove'), false);
    assert.equal(listeners.has('mouseup'), false);
    const placement = calls.find(call => call[0] === 'placeRingTemplate');
    assert.ok(placement);
    assert.equal(placement[1], 4);
    assert.equal(placement[2], 10);
    assert.equal(placement[3], 20);
    assert.equal(placement[4].anchorAtomId, 'a1');
    assert.equal(placement[4].anchorForceCenterAngle, Math.PI / 2);
    assert.equal(placement[4].anchorCenterAngle, -Math.PI / 2);
  });

  for (const modifierKey of ['ctrlKey', 'metaKey']) {
    it(`commits anchored ring template placement with free rotation when ${modifierKey} is held`, () => {
      const listeners = new Map();
      const svgRoot = makeSvgRoot();
      const documentMock = {
        addEventListener(type, handler) {
          listeners.set(type, handler);
        },
        removeEventListener(type, handler) {
          if (listeners.get(type) === handler) {
            listeners.delete(type);
          }
        }
      };
      let pointer = [10, 20];
      const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
        document: documentMock,
        pointer: () => pointer,
        dom: {
          gNode: () => svgRoot
        }
      });
      setMode('2d');
      setRingTemplateMode(true);
      setRingTemplateSize(4);
      const handlers = createPrimitiveEventHandlers(context);

      handlers.handle2dAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, 'a1');
      pointer = [50, 50];
      listeners.get('mousemove')({ preventDefault() {}, [modifierKey]: true });
      listeners.get('mouseup')({
        preventDefault() {},
        stopPropagation() {}
      });

      const freeAngle = Math.atan2(30, 40);
      const placement = calls.find(call => call[0] === 'placeRingTemplate');
      assert.ok(placement);
      assert.equal(placement[4].anchorAtomId, 'a1');
      assert.equal(placement[4].anchorForceCenterAngle, freeAngle);
      assert.equal(placement[4].anchorCenterAngle, -freeAngle);
    });
  }

  it('uses the rendered 2D atom center as the ring rotation pivot and final anchor', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [12, 18];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      constants: {
        scale: 60
      },
      helpers: {
        get2DAtomById: atomId => ({ id: atomId, x: 1, y: 2 }),
        toSelectionSVGPt2d: () => ({ x: 40, y: 50 })
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, 'a1');
    pointer = [110, 50];
    listeners.get('mousemove')({ preventDefault() {} });

    const firstLine = svgRoot.querySelector('g.ring-template-preview')?.querySelector('line.bond');
    assert.ok(firstLine);
    assert.equal(firstLine.getAttribute('x1'), '40');
    assert.equal(firstLine.getAttribute('y1'), '50');
    assert.equal(Math.round(svgLineLength(firstLine)), 90);

    listeners.get('mouseup')({
      preventDefault() {},
      stopPropagation() {}
    });

    const placement = calls.find(call => call[0] === 'placeRingTemplate');
    assert.ok(placement);
    assert.equal(placement[2], 40);
    assert.equal(placement[3], 50);
  });

  it('highlights existing atoms and bonds that an atom-anchored ring preview will fuse with', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [0, 0];
    const atomA = { id: 'a1', name: 'C', x: 0, y: 0 };
    const atomB = { id: 'a2', name: 'C', x: 90, y: 0 };
    const bond = { id: 'b1', atoms: ['a1', 'a2'] };
    const mol = {
      atoms: new Map([
        ['a1', atomA],
        ['a2', atomB]
      ]),
      bonds: new Map([['b1', bond]]),
      getBond(atomIdA, atomIdB) {
        return (atomIdA === 'a1' && atomIdB === 'a2') || (atomIdA === 'a2' && atomIdB === 'a1') ? bond : null;
      }
    };
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      constants: {
        scale: 60
      },
      mol2d: mol,
      helpers: {
        get2DAtomById: atomId => mol.atoms.get(atomId),
        toSelectionSVGPt2d: atom => ({ x: atom.x, y: atom.y })
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, 'a1');
    pointer = [60, 104];
    listeners.get('mousemove')({ preventDefault() {} });

    assert.deepEqual(calls.at(-1), ['showPrimitiveHover', ['a1', 'a2'], ['b1']]);
  });

  it('previews atom-anchored benzene double bonds using the fused bond phase', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [0, 0];
    const atomA = { id: 'a1', name: 'C', x: 0, y: 0 };
    const atomB = { id: 'a2', name: 'C', x: 90, y: 0 };
    const bond = { id: 'b1', atoms: ['a1', 'a2'], properties: { localizedOrder: 2 } };
    const mol = {
      atoms: new Map([
        ['a1', atomA],
        ['a2', atomB]
      ]),
      bonds: new Map([['b1', bond]]),
      getBond(atomIdA, atomIdB) {
        return (atomIdA === 'a1' && atomIdB === 'a2') || (atomIdA === 'a2' && atomIdB === 'a1') ? bond : null;
      }
    };
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      constants: {
        scale: 60
      },
      mol2d: mol,
      helpers: {
        get2DAtomById: atomId => mol.atoms.get(atomId),
        toSelectionSVGPt2d: atom => ({ x: atom.x, y: atom.y })
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize('benzene');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, 'a1');
    pointer = [60, 104];
    listeners.get('mousemove')({ preventDefault() {} });

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    const doubleLines = preview.children.filter(child => child.tagName === 'line' && child.getAttribute('class') === 'bond ring-template-double-bond');
    assert.equal(doubleLines.length, 3);
    const hasSharedEdgeDouble = doubleLines.some(line => {
      const y1 = Number(line.getAttribute('y1'));
      const y2 = Number(line.getAttribute('y2'));
      return Math.abs(y1 - y2) < 1e-6 && Math.abs((y1 + y2) / 2) <= 6;
    });
    assert.equal(hasSharedEdgeDouble, true);
  });

  it('previews force ring templates with final-style links and carbon nodes', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [10, 20];
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, { id: 'a1' });
    pointer = [70, 20];
    listeners.get('mousemove')({ preventDefault() {} });

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    const lines = preview.children.filter(child => child.tagName === 'line');
    const circles = preview.children.filter(child => child.tagName === 'circle');
    assert.equal(lines.length, 5);
    assert.equal(circles.length, 4);
    assert.equal(lines.every(line => line.getAttribute('class') === 'link'), true);
    assert.equal(Math.round(svgLineLength(lines[0])), 53);
    assert.equal(circles.every(circle => circle.getAttribute('class') === 'node' && circle.getAttribute('fill')), true);
    assert.equal(preview.querySelector('polygon'), null);
  });

  it('previews benzene as a six-member ring while committing the benzene template key', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [10, 20];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize('benzene');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, { id: 'a1' });
    pointer = [70, 20];
    listeners.get('mousemove')({ preventDefault() {} });

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    const lines = preview.children.filter(child => child.tagName === 'line');
    assert.equal(lines.length, 9);
    assert.equal(lines.filter(line => line.getAttribute('class') === 'link ring-template-double-bond').length, 3);
    assert.equal(preview.children.filter(child => child.tagName === 'circle').length, 5);

    listeners.get('mouseup')({
      preventDefault() {},
      stopPropagation() {}
    });
    const placement = calls.find(call => call[0] === 'placeRingTemplate');
    assert.ok(placement);
    assert.equal(placement[1], 'benzene');
    assert.equal(placement[4].anchorAtomId, 'a1');
  });

  it('previews bond-anchored benzene without a double bond on the shared edge', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const pointer = [50, 20];
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize('benzene');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dBondMouseDownRingTemplate(
      { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} },
      'b1',
      { x: 10, y: 20 },
      { x: 100, y: 20 },
      ['a1', 'a2']
    );

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    const doubleLines = preview.children.filter(child => child.tagName === 'line' && child.getAttribute('class') === 'bond ring-template-double-bond');
    assert.equal(doubleLines.length, 3);
    const hasSharedEdgeDouble = doubleLines.some(line => {
      const y1 = Number(line.getAttribute('y1'));
      const y2 = Number(line.getAttribute('y2'));
      return Math.abs(y1 - y2) < 1e-6 && Math.abs((y1 + y2) / 2 - 20) <= 6;
    });
    assert.equal(hasSharedEdgeDouble, false);
  });

  it('previews bond-anchored benzene double bonds using the anchor bond phase', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const pointer = [50, 20];
    const mol2d = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }]
      ]),
      bonds: new Map([
        ['b1', { id: 'b1', atoms: ['a1', 'a2'], properties: { order: 1.5, aromatic: true, localizedOrder: 2 } }]
      ])
    };
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      mol2d,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize('benzene');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dBondMouseDownRingTemplate(
      { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} },
      'b1',
      { x: 10, y: 20 },
      { x: 100, y: 20 },
      ['a1', 'a2']
    );

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    const doubleLines = preview.children.filter(child => child.tagName === 'line' && child.getAttribute('class') === 'bond ring-template-double-bond');
    assert.equal(doubleLines.length, 3);
    const hasSharedEdgeDouble = doubleLines.some(line => {
      const y1 = Number(line.getAttribute('y1'));
      const y2 = Number(line.getAttribute('y2'));
      return Math.abs(y1 - y2) < 1e-6 && Math.abs((y1 + y2) / 2 - 20) <= 6;
    });
    assert.equal(hasSharedEdgeDouble, true);
  });

  it('previews two benzene double bonds when fused double bonds keep every ring carbon sp2', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const pointer = [50, 20];
    const mol2d = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }],
        ['x1', { id: 'x1', name: 'C' }],
        ['x2', { id: 'x2', name: 'C' }]
      ]),
      bonds: new Map([
        ['b1', { id: 'b1', atoms: ['a1', 'a2'], properties: { order: 1.5, aromatic: true, localizedOrder: 1 } }],
        ['b2', { id: 'b2', atoms: ['a1', 'x1'], properties: { order: 1.5, aromatic: true, localizedOrder: 2 } }],
        ['b3', { id: 'b3', atoms: ['a2', 'x2'], properties: { order: 1.5, aromatic: true, localizedOrder: 2 } }]
      ])
    };
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      mol2d,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize('benzene');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dBondMouseDownRingTemplate(
      { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} },
      'b1',
      { x: 10, y: 20 },
      { x: 100, y: 20 },
      ['a1', 'a2']
    );

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    const doubleLines = preview.children.filter(child => child.tagName === 'line' && child.getAttribute('class') === 'bond ring-template-double-bond');
    assert.equal(doubleLines.length, 2);
  });

  it('previews three benzene double bonds instead of leaving one fused ring carbon sp3', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const pointer = [50, 20];
    const mol2d = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }],
        ['x1', { id: 'x1', name: 'C' }],
        ['x2', { id: 'x2', name: 'C' }]
      ]),
      bonds: new Map([
        ['b1', { id: 'b1', atoms: ['a1', 'a2'], properties: { order: 1.5, aromatic: true, localizedOrder: 1 } }],
        ['b2', { id: 'b2', atoms: ['a1', 'x1'], properties: { order: 1.5, aromatic: true, localizedOrder: 2 } }],
        ['b3', { id: 'b3', atoms: ['a2', 'x2'], properties: { order: 1.5, aromatic: true, localizedOrder: 1 } }]
      ])
    };
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      mol2d,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize('benzene');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dBondMouseDownRingTemplate(
      { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} },
      'b1',
      { x: 10, y: 20 },
      { x: 100, y: 20 },
      ['a1', 'a2']
    );

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(preview);
    const doubleLines = preview.children.filter(child => child.tagName === 'line' && child.getAttribute('class') === 'bond ring-template-double-bond');
    assert.equal(doubleLines.length, 3);
  });

  it('does not highlight incidental single force atom-pivot overlaps in the preview', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [10, 20];
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['f1', { id: 'f1', name: 'C' }]
      ]),
      bonds: new Map(),
      getBond() {
        return null;
      }
    };
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      currentMol: mol,
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        getForceNodes: () => [
          { id: 'a1', name: 'C', x: 10, y: 20 },
          { id: 'f1', name: 'C', x: 36.65, y: -26.16 }
        ]
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, { id: 'a1', x: 10, y: 20 });
    pointer = [70, 20];
    listeners.get('mousemove')({ preventDefault() {} });

    assert.deepEqual(calls.at(-1), ['showPrimitiveHover', ['a1'], []]);
  });

  it('commits 2D bond-anchored ring templates on mouseup after bond mousedown preview', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [50, 20];
    const fusedAtom = { id: 'f1', name: 'C', x: 145, y: 97.94228634059948 };
    const mol2d = {
      atoms: new Map([
        ['f1', fusedAtom]
      ]),
      bonds: new Map()
    };
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      mol2d,
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        toSelectionSVGPt2d: atom => ({ x: atom.x, y: atom.y })
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;
    let stoppedImmediate = false;

    const handled = handlers.handle2dBondMouseDownRingTemplate(
      {
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
        stopImmediatePropagation() {
          stoppedImmediate = true;
        }
      },
      'b1',
      { x: 10, y: 20 },
      { x: 100, y: 20 },
      ['a1', 'a2']
    );

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.equal(handled, true);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(stoppedImmediate, true);
    assert.deepEqual(calls, [['showPrimitiveHover', ['a1', 'a2'], ['b1']]]);
    assert.ok(preview);
    const lines = preview.children.filter(child => child.tagName === 'line');
    assert.equal(lines.length, 6);
    assert.equal(lines.every(line => line.getAttribute('class') === 'bond'), true);
    assert.equal(lines[0].getAttribute('x1'), '10');
    assert.equal(lines[0].getAttribute('y1'), '20');
    assert.equal(lines[0].getAttribute('x2'), '100');
    assert.equal(lines[0].getAttribute('y2'), '20');
    assert.equal(typeof listeners.get('mousemove'), 'function');
    assert.equal(typeof listeners.get('mouseup'), 'function');

    preview.remove();
    pointer = [50, 90];
    listeners.get('mousemove')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    let movedPreview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(movedPreview);
    let movedLines = movedPreview.children.filter(child => child.tagName === 'line');
    assert.ok(Number(movedLines[1].getAttribute('y2')) > 20);
    assert.deepEqual(calls.at(-1), ['showPrimitiveHover', ['a1', 'a2', 'f1'], ['b1']]);

    pointer = [50, -50];
    listeners.get('mousemove')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    movedPreview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(movedPreview);
    movedLines = movedPreview.children.filter(child => child.tagName === 'line');
    assert.ok(Number(movedLines[1].getAttribute('y2')) < 20);

    listeners.get('mouseup')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.equal(svgRoot.querySelector('g.ring-template-preview'), null);
    assert.deepEqual(calls.at(-1), ['placeRingTemplate', 6, 50, -50, { anchorBondId: 'b1', anchorBondSide: -1, allowBondPositionReuse: true }]);

    handlers.handle2dBondClick({ preventDefault() {}, stopPropagation() {} }, 'b1');
    assert.equal(calls.filter(call => call[0] === 'placeRingTemplate').length, 1);
  });

  it('pans the viewport to keep an offscreen ring-template preview visible', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const zoomTransforms = [];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => [290, 60],
      dom: {
        gNode: () => svgRoot
      },
      plot: {
        getSize: () => ({ width: 300, height: 220 })
      },
      view: {
        getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
        makeZoomIdentity: (x, y, k) => ({ x, y, k }),
        setZoomTransform(transform) {
          zoomTransforms.push(transform);
          calls.push(['setZoomTransform', transform]);
        }
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handle2dBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      'b-edge',
      { x: 250, y: 70 },
      { x: 310, y: 70 },
      ['a1', 'a2']
    );

    assert.equal(handled, true);
    assert.ok(svgRoot.querySelector('g.ring-template-preview'));
    assert.equal(zoomTransforms.length, 1);
    assert.ok(zoomTransforms[0].x < 0, 'expected preview viewport pan to shift left');
    assert.equal(zoomTransforms[0].k, 1);
    assert.deepEqual(calls.at(-1), ['showPrimitiveHover', ['a1', 'a2'], ['b-edge']]);
  });

  it('fits the ring-template preview together with the existing molecule when panning alone would hide atoms', () => {
    const svgRoot = makeSvgRoot();
    const mol2d = {
      atoms: new Map([
        ['left', { id: 'left', name: 'C', x: 0, y: 70 }]
      ]),
      bonds: new Map()
    };
    const zoomTransforms = [];
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      mol2d,
      pointer: () => [290, 60],
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        toSelectionSVGPt2d: atom => ({ x: atom.x, y: atom.y })
      },
      plot: {
        getSize: () => ({ width: 300, height: 220 })
      },
      view: {
        getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
        makeZoomIdentity: (x, y, k) => ({ x, y, k }),
        setZoomTransform(transform) {
          zoomTransforms.push(transform);
        }
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handle2dBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      'b-edge',
      { x: 250, y: 70 },
      { x: 310, y: 70 },
      ['a1', 'a2']
    );

    assert.equal(handled, true);
    assert.equal(zoomTransforms.length, 1);
    assert.ok(zoomTransforms[0].k < 1, 'expected preview plus molecule fit to zoom out when panning cannot keep both visible');
    assert.ok(zoomTransforms[0].x > 0, 'expected the existing left-side molecule atom to remain inside the viewport');
  });

  it('keeps horizontal placement stable when only vertical ring-template fitting needs zoom', () => {
    const svgRoot = makeSvgRoot();
    const mol2d = {
      atoms: new Map([
        ['top', { id: 'top', name: 'C', x: 130, y: -130 }],
        ['bottom', { id: 'bottom', name: 'C', x: 130, y: 130 }]
      ]),
      bonds: new Map()
    };
    const zoomTransforms = [];
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      mol2d,
      pointer: () => [130, -120],
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        toSelectionSVGPt2d: atom => ({ x: atom.x, y: atom.y })
      },
      plot: {
        getSize: () => ({ width: 320, height: 180 })
      },
      view: {
        getZoomTransform: () => ({ x: 20, y: 120, k: 1 }),
        makeZoomIdentity: (x, y, k) => ({ x, y, k }),
        setZoomTransform(transform) {
          zoomTransforms.push(transform);
        }
      }
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handle2dBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      'b-top',
      { x: 100, y: -130 },
      { x: 160, y: -130 },
      ['a1', 'a2']
    );

    assert.equal(handled, true);
    assert.equal(zoomTransforms.length, 1);
    assert.ok(zoomTransforms[0].k < 1, 'expected vertical overflow to reduce zoom');

    const beforeCenterX = 20 + 130;
    const afterCenterX = zoomTransforms[0].x + 130 * zoomTransforms[0].k;
    assert.ok(Math.abs(afterCenterX - beforeCenterX) < 1, 'expected vertical fit not to introduce horizontal drift');
  });

  it('rechecks force ring-template preview fitting after force nodes move', () => {
    const listeners = new Map();
    const rafCallbacks = [];
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let transform = { x: 0, y: 0, k: 1 };
    const nodes = [
      { id: 'a1', name: 'C', x: 80, y: 70 },
      { id: 'a2', name: 'C', x: 120, y: 70 }
    ];
    const zoomTransforms = [];
    const { context, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => [100, 95],
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        getForceNodes: () => nodes
      },
      timers: {
        requestAnimationFrame(callback) {
          rafCallbacks.push(callback);
          return rafCallbacks.length;
        },
        cancelAnimationFrame() {}
      },
      constants: {
        forceBondLength: 41
      },
      plot: {
        getSize: () => ({ width: 220, height: 160 })
      },
      view: {
        getZoomTransform: () => transform,
        makeZoomIdentity: (x, y, k) => ({ x, y, k }),
        setZoomTransform(nextTransform) {
          transform = nextTransform;
          zoomTransforms.push(nextTransform);
        }
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handleForceBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      {
        id: 'b1',
        source: nodes[0],
        target: nodes[1]
      }
    );

    assert.equal(handled, true);
    assert.ok(svgRoot.querySelector('g.ring-template-preview'));
    assert.ok(rafCallbacks.length > 0);
    const initialTransformCount = zoomTransforms.length;
    const initialX = transform.x;

    nodes[1].x = 250;
    rafCallbacks.shift()();

    assert.equal(zoomTransforms.length, initialTransformCount + 1);
    assert.ok(transform.x < initialX, 'expected follow-up force fit to pan after node movement');
  });

  it('commits force bond-anchored ring templates on mouseup after bond mousedown preview', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [30, 20];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        getForceNodes: () => [
          { id: 'a1', name: 'C', x: 10, y: 20 },
          { id: 'a2', name: 'C', x: 51, y: 20 }
        ]
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;
    let stoppedImmediate = false;

    const handled = handlers.handleForceBondMouseDownRingTemplate(
      {
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
        stopImmediatePropagation() {
          stoppedImmediate = true;
        }
      },
      {
        id: 'b1',
        source: { id: 'a1', name: 'C', x: 10, y: 20 },
        target: { id: 'a2', name: 'C', x: 51, y: 20 }
      }
    );

    const preview = svgRoot.querySelector('g.ring-template-preview');
    assert.equal(handled, true);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(stoppedImmediate, true);
    assert.deepEqual(calls, [['showPrimitiveHover', ['a1', 'a2'], ['b1']]]);
    assert.ok(preview);
    const lines = preview.children.filter(child => child.tagName === 'line');
    const circles = preview.children.filter(child => child.tagName === 'circle');
    assert.equal(lines.length, 5);
    assert.equal(circles.length, 3);
    assert.equal(lines[0].getAttribute('class'), 'link');
    assert.equal(Math.round(svgLineLength(lines[0])), 53);
    assert.equal(circles.every(circle => circle.getAttribute('class') === 'node'), true);
    assert.equal(typeof listeners.get('mousemove'), 'function');

    preview.remove();
    pointer = [30, 70];
    listeners.get('mousemove')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    let movedPreview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(movedPreview);
    let movedLines = movedPreview.children.filter(child => child.tagName === 'line');
    assert.ok(Number(movedLines[1].getAttribute('y2')) > 20);

    pointer = [30, -30];
    listeners.get('mousemove')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    movedPreview = svgRoot.querySelector('g.ring-template-preview');
    assert.ok(movedPreview);
    movedLines = movedPreview.children.filter(child => child.tagName === 'line');
    assert.ok(Number(movedLines[1].getAttribute('y2')) < 20);

    listeners.get('mouseup')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.equal(svgRoot.querySelector('g.ring-template-preview'), null);
    assert.deepEqual(calls.at(-1), ['placeRingTemplate', 5, 30, -30, { anchorBondId: 'b1', anchorBondSide: -1, allowBondPositionReuse: true }]);

    handlers.handleForceBondClick({ preventDefault() {}, stopPropagation() {} }, 'b1', {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }]
      ]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]])
    });
    assert.equal(calls.filter(call => call[0] === 'placeRingTemplate').length, 1);
  });

  it('highlights stationary force bond-ring auto-fuse atoms and bonds in the preview', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }],
        ['f1', { id: 'f1', name: 'C' }]
      ]),
      bonds: new Map([
        ['b1', { id: 'b1', atoms: ['a1', 'a2'] }],
        ['b2', { id: 'b2', atoms: ['a2', 'f1'] }]
      ]),
      getBond(atomIdA, atomIdB) {
        return [...this.bonds.values()].find(
          bond => (bond.atoms[0] === atomIdA && bond.atoms[1] === atomIdB) || (bond.atoms[0] === atomIdB && bond.atoms[1] === atomIdA)
        ) ?? null;
      }
    };
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      currentMol: mol,
      document: documentMock,
      pointer: () => [30, 20],
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        getForceNodes: () => [
          { id: 'a1', name: 'C', x: 10, y: 20 },
          { id: 'a2', name: 'C', x: 51, y: 20 },
          { id: 'f1', name: 'C', x: 73.62, y: 70.69 }
        ]
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handleForceBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      {
        id: 'b1',
        source: { id: 'a1', name: 'C', x: 10, y: 20 },
        target: { id: 'a2', name: 'C', x: 51, y: 20 }
      }
    );

    assert.equal(handled, true);
    assert.deepEqual(calls.at(-1), ['showPrimitiveHover', ['a1', 'a2', 'f1'], ['b1', 'b2']]);
  });

  it('does not highlight stationary force bond-ring incidental atom overlaps', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }],
        ['f1', { id: 'f1', name: 'C' }]
      ]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]]),
      getBond(atomIdA, atomIdB) {
        return [...this.bonds.values()].find(
          bond => (bond.atoms[0] === atomIdA && bond.atoms[1] === atomIdB) || (bond.atoms[0] === atomIdB && bond.atoms[1] === atomIdA)
        ) ?? null;
      }
    };
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      currentMol: mol,
      document: documentMock,
      pointer: () => [30, 20],
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        getForceNodes: () => [
          { id: 'a1', name: 'C', x: 10, y: 20 },
          { id: 'a2', name: 'C', x: 51, y: 20 },
          { id: 'f1', name: 'C', x: 73.62, y: 70.69 }
        ]
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handleForceBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      {
        id: 'b1',
        source: { id: 'a1', name: 'C', x: 10, y: 20 },
        target: { id: 'a2', name: 'C', x: 51, y: 20 }
      }
    );

    assert.equal(handled, true);
    assert.deepEqual(calls.at(-1), ['showPrimitiveHover', ['a1', 'a2'], ['b1']]);
  });

  it('lets stationary force bond-ring commits auto-pick the fused side', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const pointer = [30, 20];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        getForceNodes: () => [
          { id: 'a1', name: 'C', x: 10, y: 20 },
          { id: 'a2', name: 'C', x: 51, y: 20 },
          { id: 'f1', name: 'C', x: 78.3, y: 66.9 }
        ]
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handleForceBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      {
        id: 'b1',
        source: { id: 'a1', name: 'C', x: 10, y: 20 },
        target: { id: 'a2', name: 'C', x: 51, y: 20 }
      }
    );

    assert.equal(handled, true);
    listeners.get('mouseup')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });

    assert.deepEqual(calls.at(-1), ['placeRingTemplate', 5, 30, 20, { anchorBondId: 'b1', anchorBondSide: -1, autoFuseBondPositionReuse: true }]);
  });

  it('commits force bond-ring placement on the last rendered preview side', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [30, 20];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      helpers: {
        getForceNodes: () => [
          { id: 'a1', name: 'C', x: 10, y: 20 },
          { id: 'a2', name: 'C', x: 51, y: 20 }
        ]
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);

    const handled = handlers.handleForceBondMouseDownRingTemplate(
      {
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      },
      {
        id: 'b1',
        source: { id: 'a1', name: 'C', x: 10, y: 20 },
        target: { id: 'a2', name: 'C', x: 51, y: 20 }
      }
    );

    assert.equal(handled, true);
    pointer = [30, 70];
    listeners.get('mousemove')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });

    pointer = [30, -30];
    listeners.get('mouseup')({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });

    assert.deepEqual(calls.at(-1), ['placeRingTemplate', 5, 30, -30, { anchorBondId: 'b1', anchorBondSide: 1, allowBondPositionReuse: true }]);
  });

  it('uses the rendered force atom center as the ring rotation pivot and final anchor', () => {
    const listeners = new Map();
    const svgRoot = makeSvgRoot();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    let pointer = [10, 20];
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock,
      pointer: () => pointer,
      dom: {
        gNode: () => svgRoot
      },
      constants: {
        forceBondLength: 41
      }
    });
    setMode('force');
    setRingTemplateMode(true);
    setRingTemplateSize(5);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, { id: 'a1', name: 'C', x: 80, y: 90 });
    pointer = [150, 90];
    listeners.get('mousemove')({ preventDefault() {} });

    const firstLine = svgRoot.querySelector('g.ring-template-preview')?.querySelector('line.link');
    assert.ok(firstLine);
    assert.equal(firstLine.getAttribute('x1'), '80');
    assert.equal(firstLine.getAttribute('y1'), '90');
    assert.equal(Math.round(svgLineLength(firstLine)), 53);

    listeners.get('mouseup')({
      preventDefault() {},
      stopPropagation() {}
    });

    const placement = calls.find(call => call[0] === 'placeRingTemplate');
    assert.ok(placement);
    assert.equal(placement[2], 80);
    assert.equal(placement[3], 90);
  });

  it('suppresses the follow-up click after a ring template mouseup commit', () => {
    const listeners = new Map();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const { context, calls, setMode, setRingTemplateMode, setRingTemplateSize } = makeContext({
      document: documentMock
    });
    setMode('2d');
    setRingTemplateMode(true);
    setRingTemplateSize(6);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseDownDrawBond({ preventDefault() {}, stopPropagation() {} }, 'a1');
    listeners.get('mouseup')({
      preventDefault() {},
      stopPropagation() {}
    });
    handlers.handle2dAtomClick({ preventDefault() {}, stopPropagation() {} }, 'a1');

    assert.equal(calls.filter(call => call[0] === 'placeRingTemplate').length, 1);
    assert.deepEqual(calls.at(-1), ['placeRingTemplate', 6, 10, 20, { anchorAtomId: 'a1' }]);
  });

  it('routes 2D atom and bond clicks to paint styling in brush mode', () => {
    const { context, calls, setMode, setPaintMode, setPaintColor, setPaintOpacity } = makeContext();
    setMode('2d');
    setPaintMode(true);
    setPaintColor('#ff6633');
    setPaintOpacity(0.45);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomClick({}, 'a1');
    handlers.handle2dBondClick({}, 'b1');

    assert.deepEqual(calls, [
      ['paintStyleTargets', ['a1'], [], { color: '#ff6633', opacity: 0.45 }],
      ['paintStyleTargets', [], ['b1'], { color: '#ff6633', opacity: 0.45 }]
    ]);
  });

  it('routes force atom and bond clicks to paint styling only for the brush tool', () => {
    const { context, calls, setPaintMode, setPaintTool } = makeContext();
    const handlers = createPrimitiveEventHandlers(context);
    const molecule = {
      atoms: new Map([['a1', { id: 'a1', name: 'C' }]]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]])
    };

    setPaintMode(true);
    handlers.handleForceAtomClick({}, { id: 'a1', name: 'C' }, molecule);
    handlers.handleForceBondClick({}, 'b1', molecule);
    setPaintTool('bucket');
    handlers.handleForceAtomClick({}, { id: 'a2', name: 'C' }, molecule);

    assert.deepEqual(calls, [
      ['paintStyleTargets', ['a1'], [], { color: '#3366ff', opacity: 1 }],
      ['paintStyleTargets', [], ['b1'], { color: '#3366ff', opacity: 1 }],
      ['handleForcePrimitiveClick', {}, ['a2'], []]
    ]);
  });

  it('routes atom and bond clicks to style clearing in paint eraser mode', () => {
    const { context, calls, setMode, setPaintMode, setPaintTool } = makeContext();
    setMode('2d');
    setPaintMode(true);
    setPaintTool('eraser');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomClick({}, 'a1');
    handlers.handle2dBondClick({}, 'b1');

    assert.deepEqual(calls, [
      ['paintStyleTargets', ['a1'], [], null],
      ['paintStyleTargets', [], ['b1'], null]
    ]);
  });

  it('routes force bond click to bond promotion in draw-bond mode', () => {
    const { context, calls, setDrawBondMode } = makeContext();
    setDrawBondMode(true);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceBondClick({}, 'b1', {
      bonds: new Map()
    });

    assert.deepEqual(calls, [['promoteBondOrder', 'b1', { drawBondType: 'triple' }]]);
  });

  it('previews and commits the draw-bond mouseup state when holding a 2D bond', () => {
    const listeners = new Map();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };
    const { context, calls, setMode, setDrawBondMode, setDrawBondType } = makeContext({
      document: documentMock
    });
    setMode('2d');
    setDrawBondMode(true);
    setDrawBondType('single');
    const handlers = createPrimitiveEventHandlers(context);
    const event = {
      currentTarget: { ownerDocument: documentMock },
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    };
    const bond = { id: 'b1', properties: { order: 1 } };

    assert.equal(handlers.handle2dBondMouseDownDrawBond(event, bond, { x: 10, y: 20 }, { x: 70, y: 20 }), true);
    assert.equal(typeof listeners.get('mouseup'), 'function');
    assert.deepEqual(calls, [
      ['clearArtifacts'],
      ['previewBond', { x: 10, y: 20 }, { x: 70, y: 20 }, { drawBondType: 'double', sourceElement: event.currentTarget }]
    ]);

    listeners.get('mouseup')({
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    handlers.handle2dBondClick({}, 'b1');

    assert.equal(listeners.has('mouseup'), false);
    assert.deepEqual(calls, [
      ['clearArtifacts'],
      ['previewBond', { x: 10, y: 20 }, { x: 70, y: 20 }, { drawBondType: 'double', sourceElement: event.currentTarget }],
      ['clearArtifacts'],
      ['promoteBondOrder', 'b1', { drawBondType: 'single' }]
    ]);
  });

  it('previews explicit draw-bond type when holding a 2D bond', () => {
    const listeners = new Map();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener() {}
    };
    const { context, calls, setMode, setDrawBondMode, setDrawBondType } = makeContext({
      document: documentMock
    });
    setMode('2d');
    setDrawBondMode(true);
    setDrawBondType('triple');
    const handlers = createPrimitiveEventHandlers(context);
    const event = {
      currentTarget: { ownerDocument: documentMock },
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    };

    handlers.handle2dBondMouseDownDrawBond(
      event,
      { id: 'b1', properties: { order: 1 } },
      { x: 10, y: 20 },
      { x: 70, y: 20 }
    );

    assert.deepEqual(calls, [
      ['clearArtifacts'],
      ['previewBond', { x: 10, y: 20 }, { x: 70, y: 20 }, { drawBondType: 'triple', sourceElement: event.currentTarget }]
    ]);
  });

  it('previews a held 2D bond even if the view mode is not the strict 2d token', () => {
    const listeners = new Map();
    const documentMock = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener() {}
    };
    const { context, calls, setMode, setDrawBondMode, setDrawBondType } = makeContext({
      document: documentMock
    });
    setMode('line');
    setDrawBondMode(true);
    setDrawBondType('single');
    const handlers = createPrimitiveEventHandlers(context);
    const event = {
      currentTarget: { ownerDocument: documentMock },
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    };

    assert.equal(
      handlers.handle2dBondMouseDownDrawBond(
        event,
        { id: 'b1', properties: { order: 1 } },
        { x: 10, y: 20 },
        { x: 70, y: 20 }
      ),
      true
    );

    assert.deepEqual(calls, [
      ['clearArtifacts'],
      ['previewBond', { x: 10, y: 20 }, { x: 70, y: 20 }, { drawBondType: 'double', sourceElement: event.currentTarget }]
    ]);
  });

  it('routes force hydrogen click in draw-bond mode to element replacement', () => {
    const { context, calls, setDrawBondMode } = makeContext();
    setDrawBondMode(true);
    const handlers = createPrimitiveEventHandlers(context);

    let stopped = false;
    const molecule = { id: 'mol' };
    handlers.handleForceAtomClick(
      {
        stopPropagation() {
          stopped = true;
        }
      },
      { id: 'a1', name: 'H' },
      molecule
    );

    assert.equal(stopped, true);
    assert.deepEqual(calls, [['replaceForceHydrogenAtom', 'a1', molecule]]);
  });

  it('shows immediate valence-warning tooltip for 2D atoms in select mode', () => {
    const { context, calls, setSelectMode, setMode } = makeContext();
    setMode('2d');
    setSelectMode(true);
    const handlers = createPrimitiveEventHandlers(context);
    const atom = { id: 'a1' };
    const mol = { id: 'mol' };

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, atom, mol, { message: 'warn' });

    assert.deepEqual(calls, [
      ['showPrimitiveHover', ['a1'], []],
      ['setSelectionValenceTooltipAtomId', 'a1'],
      ['showImmediate', 'atom-tooltip', { clientX: 5, clientY: 6 }]
    ]);
  });

  it('shows immediate valence-warning tooltip for 2D atoms in ring-template mode', () => {
    const { context, calls, setRingTemplateMode, setMode } = makeContext();
    setMode('2d');
    setRingTemplateMode(true);
    const handlers = createPrimitiveEventHandlers(context);
    const atom = { id: 'a1' };
    const mol = { id: 'mol' };

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, atom, mol, { message: 'warn' });

    assert.deepEqual(calls, [
      ['showPrimitiveHover', ['a1'], []],
      ['setSelectionValenceTooltipAtomId', 'a1'],
      ['showImmediate', 'atom-tooltip', { clientX: 5, clientY: 6 }]
    ]);
  });

  it('keeps normal 2D atom tooltips suppressed in ring-template mode without a valence warning', () => {
    const { context, calls, setRingTemplateMode, setMode } = makeContext();
    setMode('2d');
    setRingTemplateMode(true);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'a1' }, { id: 'mol' }, null);

    assert.deepEqual(calls, [['showPrimitiveHover', ['a1'], []]]);
  });

  it('shows immediate valence-warning tooltip for force atoms in ring-template mode', () => {
    const { context, calls, setRingTemplateMode } = makeContext();
    setRingTemplateMode(true);
    const handlers = createPrimitiveEventHandlers(context);
    const molecule = { atoms: new Map([['a1', { id: 'a1', name: 'C' }]]) };

    handlers.handleForceAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'a1', name: 'C' }, molecule, { message: 'warn' });

    assert.deepEqual(calls, [
      ['showPrimitiveHover', ['a1'], []],
      ['setSelectionValenceTooltipAtomId', 'a1'],
      ['showImmediate', 'atom-tooltip', { clientX: 5, clientY: 6 }]
    ]);
  });

  it('routes force atom clicks to charge edits when a charge tool is active', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomClick({}, { id: 'a1', name: 'C', charge: 1 }, { id: 'mol' });

    assert.deepEqual(calls, [['changeAtomCharge', 'a1', { chargeTool: 'positive', decrement: false }]]);
  });

  it('routes 2D atom right-clicks to charge decrements when a charge tool is active', () => {
    const { context, calls, setChargeTool, setMode } = makeContext();
    setMode('2d');
    setChargeTool('negative');
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;

    handlers.handle2dAtomContextMenu(
      {
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        }
      },
      { id: 'a1', getCharge: () => -2 }
    );

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, [['changeAtomCharge', 'a1', { chargeTool: 'negative', decrement: true }]]);
  });

  it('suppresses 2D bond tooltips while charge mode is active', () => {
    const { context, calls, setChargeTool, setMode } = makeContext();
    setMode('2d');
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dBondMouseOver({ clientX: 5, clientY: 6 }, { id: 'b1' }, { id: 'a1' }, { id: 'a2' });

    assert.deepEqual(calls, []);
  });

  it('suppresses 2D bond tooltips while paint mode is active', () => {
    const { context, calls, setMode, setPaintMode, setPaintTool } = makeContext();
    setMode('2d');
    setPaintMode(true);
    setPaintTool('bucket');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dBondMouseOver({ clientX: 5, clientY: 6 }, { id: 'b1' }, { id: 'a1' }, { id: 'a2' });

    assert.deepEqual(calls, [
      ['showPrimitiveHover', [], ['b1']],
      ['hide']
    ]);
  });

  it('suppresses force bond tooltips while charge mode is active', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('negative');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceBondMouseOver({ clientX: 5, clientY: 6 }, 'b1', {
      bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]]),
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'O' }]
      ])
    });

    assert.deepEqual(calls, []);
  });

  it('suppresses force bond tooltips while paint mode is active', () => {
    const { context, calls, setPaintMode, setPaintTool } = makeContext();
    setPaintMode(true);
    setPaintTool('eraser');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceBondMouseOver({ clientX: 5, clientY: 6 }, 'b1', {
      bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]]),
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'O' }]
      ])
    });

    assert.deepEqual(calls, [
      ['showPrimitiveHover', [], ['b1']],
      ['hide']
    ]);
  });

  it('does not charge force-mode hydrogens when a charge tool is active', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomClick({}, { id: 'h1', name: 'H', charge: 0 }, { id: 'mol' });

    assert.deepEqual(calls, []);
  });

  it('does not highlight force-mode hydrogens in charge mode', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('negative');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'h1', name: 'H' }, { atoms: new Map([['h1', { id: 'h1', name: 'H' }]]) }, null);

    assert.deepEqual(calls, []);
  });

  it('suppresses atom tooltips while charge mode is active', () => {
    const { context, calls, setChargeTool, setMode } = makeContext();
    setMode('2d');
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'a1' }, { id: 'mol' }, { message: 'warn' });

    assert.deepEqual(calls, [['showPrimitiveHover', ['a1'], []]]);
  });

  it('suppresses atom and valence tooltips while paint mode is active', () => {
    const { context, calls, setMode, setPaintMode, setPaintTool, setSelectMode } = makeContext();
    setMode('2d');
    setPaintMode(true);
    setPaintTool('brush');
    setSelectMode(true);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'a1' }, { id: 'mol' }, { message: 'warn' });

    assert.deepEqual(calls, [
      ['showPrimitiveHover', ['a1'], []],
      ['hide']
    ]);
  });

  it('restores charge-mode hover immediately after primitive hover suppression', () => {
    const { context, calls, setChargeTool, setMode, setPrimitiveHoverSuppressed } = makeContext();
    setMode('2d');
    setChargeTool('positive');
    setPrimitiveHoverSuppressed(true);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'a1' }, { id: 'mol' }, null);

    assert.deepEqual(calls, [
      ['setPrimitiveHoverSuppressed', false],
      ['showPrimitiveHover', ['a1'], []]
    ]);
  });
});
