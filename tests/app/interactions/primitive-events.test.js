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
      resetHover() {
        calls.push(['resetHover']);
      },
      getElement: () => 'N',
      getType: () => 'triple'
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

  Object.assign(context, overrides);
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
      ['placeRingTemplate', 6, 10, 20, { anchorBondId: 'b1' }]
    ]);
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
      ['placeRingTemplate', 5, 10, 20, { anchorBondId: 'b1' }]
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
    assert.deepEqual(calls, [['showPrimitiveHover', ['a1'], []]]);
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
