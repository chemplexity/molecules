import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initGestureInteractions } from '../../../src/app/interactions/gesture-layer.js';

function selectorPartMatches(selection, selector) {
  const normalized = selector.trim().replace(/^:scope\s*>\s*/, '');
  if (!normalized) {
    return false;
  }
  const attrMatch = /^([a-zA-Z0-9_-]+)?\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(normalized);
  if (attrMatch) {
    const [, tagName, attrName, attrValue] = attrMatch;
    if (tagName && selection.tagName !== tagName) {
      return false;
    }
    const value = selection.attrs.get(attrName);
    return attrValue == null ? value != null : value === attrValue;
  }
  const [baseSelector, notSelector] = normalized.split(':not(');
  if (notSelector) {
    const excluded = notSelector.replace(/\)$/, '');
    return selectorPartMatches(selection, baseSelector) && !selectorPartMatches(selection, excluded);
  }
  const [tagName, ...classParts] = normalized.split('.');
  if (tagName && selection.tagName !== tagName) {
    return false;
  }
  if (classParts.length === 0) {
    return true;
  }
  const classes = String(selection.attrs.get('class') ?? '').split(/\s+/);
  return classParts.every(className => classes.includes(className));
}

function makeSelection(node = null) {
  const handlers = new Map();
  const attrs = new Map();
  const styles = new Map();
  const children = [];
  const selectionNode = node ?? {};
  selectionNode.isConnected ??= true;
  selectionNode.ownerSVGElement ??= null;
  selectionNode.style ??= {};
  selectionNode.getAttribute ??= name => attrs.get(name) ?? null;
  selectionNode.querySelectorAll ??= selector => {
    const selectors = selector.split(',').map(part => part.trim());
    const matches = [];
    const visit = selection => {
      if (selectors.some(part => selectorPartMatches(selection, part))) {
        matches.push(selection.node());
      }
      for (const child of selection.children) {
        visit(child);
      }
    };
    for (const child of children) {
      visit(child);
    }
    return matches;
  };
  selectionNode.getScreenCTM ??= () => null;
  return {
    handlers,
    attrs,
    styles,
    children,
    on(name, handler) {
      handlers.set(name, handler);
      return this;
    },
    append(tagName) {
      const child = makeSelection({
        tagName,
        isConnected: true,
        ownerSVGElement: null,
        getScreenCTM() {
          return null;
        }
      });
      child.tagName = tagName;
      children.push(child);
      return child;
    },
    insert(tagName, beforeSelector) {
      const child = makeSelection({
        tagName,
        isConnected: true,
        ownerSVGElement: null,
        getScreenCTM() {
          return null;
        }
      });
      child.tagName = tagName;
      child.insertBeforeSelector = beforeSelector;
      const beforeIndex = children.findIndex(existing => beforeSelector.split(',').some(selector => selectorPartMatches(existing, selector)));
      children.splice(beforeIndex < 0 ? children.length : beforeIndex, 0, child);
      return child;
    },
    attr(name, value) {
      attrs.set(name, value);
      return this;
    },
    style(name, value) {
      styles.set(name, value);
      if (selectionNode.style) {
        selectionNode.style[name] = value ?? '';
      }
      return this;
    },
    node() {
      return selectionNode;
    }
  };
}

function makeHitElement(kind, id) {
  const classes =
    kind === 'atom'
      ? ['atom-hit']
      : kind === 'bond'
        ? ['bond-hit']
        : kind === 'force-atom'
          ? ['node']
          : ['bond-hover-target'];
  const ownerSVGElement = {
    createSVGPoint() {
      return {
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y };
        }
      };
    }
  };
  const group = {
    getAttribute(name) {
      if (name === 'data-atom-id' || name === 'data-bond-id') {
        return id;
      }
      return null;
    }
  };
  return {
    __datum: { id, name: 'C' },
    ownerSVGElement,
    classList: {
      contains(name) {
        return classes.includes(name);
      }
    },
    closest(selector) {
      if ((selector === '[data-atom-id]' && kind === 'atom') || (selector === '[data-bond-id]' && kind === 'bond')) {
        return group;
      }
      return null;
    },
    getAttribute(name) {
      if (name === 'x1' || name === 'y1') {
        return '0';
      }
      if (name === 'x2' || name === 'y2') {
        return '10';
      }
      return null;
    },
    getBoundingClientRect() {
      return { left: 0, right: 10, top: 0, bottom: 10 };
    },
    getScreenCTM() {
      return {
        a: 1,
        d: 1,
        e: 0,
        f: 0
      };
    }
  };
}

function makeBaseContext(overrides = {}) {
  let mode = '2d';
  let selectMode = false;
  let drawBondMode = false;
  let eraseMode = false;
  let paintMode = false;
  let paintTool = 'brush';
  let paintColor = '#3366ff';
  let paintOpacity = 1;
  let chargeTool = null;
  let erasePainting = false;
  const calls = [];
  const selectedAtomIds = new Set();
  const selectedBondIds = new Set();
  const svgNode = {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 300, height: 200 };
    }
  };
  const svg = makeSelection(svgNode);
  const gNode = {};
  const g = makeSelection(gNode);
  const listeners = new Map();
  const cursorEl = { style: {} };

  const context = {
    state: {
      viewState: {
        getMode: () => mode
      },
      documentState: {
        getMol2d: () => null,
        getCurrentMol: () => null
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
        getPaintOpacity: () => paintOpacity,
        setPaintOpacity: value => {
          paintOpacity = value;
        },
        getChargeTool: () => chargeTool,
        setChargeTool: value => {
          chargeTool = value;
        },
        getErasePainting: () => erasePainting,
        setErasePainting: value => {
          erasePainting = value;
        },
        getSelectedAtomIds: () => selectedAtomIds,
        getSelectedBondIds: () => selectedBondIds
      }
    },
    selection: {
      toggleSelectMode() {}
    },
    renderers: {
      applySelectionOverlay() {}
    },
    overlays: {
      hasReactionPreview: () => false
    },
    drawBond: {
      hasDrawBondState: () => false,
      start() {},
      markDragged() {},
      updatePreview() {},
      commit() {}
    },
    actions: {
      eraseItem() {},
      paintStyleTargets(atomIds, bondIds, style, options) {
        calls.push(['paintStyleTargets', atomIds, bondIds, style, options]);
        return { performed: true };
      },
      paintRingFill(atomIds, style, options) {
        calls.push(['paintRingFill', atomIds, style, options]);
        return { performed: true };
      }
    },
    view: {
      getZoomTransform: () => ({
        applyX: value => value,
        applyY: value => value
      }),
      clearPrimitiveHover() {},
      showPrimitiveHover() {},
      setDrawBondHoverSuppressed() {}
    },
    helpers: {
      toSVGPt2d: atom => atom,
      toSelectionSVGPt2d: atom => atom,
      getDatum: element => element.__datum ?? null
    },
    simulation: {
      nodes: () => [],
      force: () => ({
        links: () => []
      })
    },
    svg,
    g,
    pointer: () => [12, 34],
    schedule: callback => callback(),
    dom: {
      plotEl: {
        querySelectorAll() {
          return [];
        }
      },
      getEraseCursorElement: () => cursorEl
    },
    doc: {
      addEventListener(type, handler) {
        const previous = listeners.get(type);
        if (!previous) {
          listeners.set(type, handler);
          return;
        }
        listeners.set(type, event => {
          previous(event);
          handler(event);
        });
      },
      elementsFromPoint() {
        return [];
      }
    }
  };

  Object.assign(context, overrides);
  return {
    context,
    svg,
    g,
    listeners,
    calls,
    cursorEl,
    selectedAtomIds,
    selectedBondIds,
    state: {
      setMode: value => (mode = value),
      setSelectMode: value => (selectMode = value),
      setDrawBondMode: value => (drawBondMode = value),
      setPaintMode: value => (paintMode = value),
      setPaintTool: value => (paintTool = value),
      setPaintColor: value => (paintColor = value),
      setPaintOpacity: value => (paintOpacity = value),
      setChargeTool: value => (chargeTool = value)
    }
  };
}

describe('initGestureInteractions', () => {
  it('starts a blank-space draw-bond gesture through the extracted SVG handler', () => {
    let started = null;
    const { context, svg, state } = makeBaseContext({
      drawBond: {
        hasDrawBondState: () => false,
        start(atomId, x, y) {
          started = { atomId, x, y };
        },
        markDragged() {},
        updatePreview() {},
        commit() {}
      }
    });
    state.setDrawBondMode(true);

    initGestureInteractions(context);

    let stopped = false;
    svg.handlers.get('mousedown.drawbond')({
      button: 0,
      target: { closest: () => null },
      stopPropagation() {
        stopped = true;
      }
    });

    assert.equal(stopped, true);
    assert.deepEqual(started, { atomId: null, x: 12, y: 34 });
  });

  it('selects the whole molecule on blank-space double-click and enters select mode', () => {
    const calls = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}]
      ]),
      bonds: new Map([['b1', {}]])
    };
    const { context, svg, selectedAtomIds, selectedBondIds } = makeBaseContext({
      selection: {
        toggleSelectMode() {
          calls.push('toggleSelectMode');
        }
      },
      renderers: {
        applySelectionOverlay() {
          calls.push('applySelectionOverlay');
        }
      }
    });
    context.state.documentState.getMol2d = () => mol;

    initGestureInteractions(context);

    svg.handlers.get('dblclick.select-all')({
      target: { closest: () => null }
    });

    assert.deepEqual(calls, ['toggleSelectMode', 'applySelectionOverlay']);
    assert.deepEqual([...selectedAtomIds].sort(), ['a1', 'a2']);
    assert.deepEqual([...selectedBondIds], ['b1']);
  });

  it('does not trigger blank-space select-all while charge mode is active', () => {
    const calls = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}]
      ]),
      bonds: new Map([['b1', {}]])
    };
    const { context, svg, selectedAtomIds, selectedBondIds, state } = makeBaseContext({
      selection: {
        toggleSelectMode() {
          calls.push('toggleSelectMode');
        }
      },
      renderers: {
        applySelectionOverlay() {
          calls.push('applySelectionOverlay');
        }
      }
    });
    context.state.documentState.getMol2d = () => mol;
    state.setChargeTool('positive');

    initGestureInteractions(context);

    svg.handlers.get('dblclick.select-all')({
      target: { closest: () => null }
    });

    assert.deepEqual(calls, []);
    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
  });

  it('does not trigger blank-space select-all while paint mode is active', () => {
    const calls = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}]
      ]),
      bonds: new Map([['b1', {}]])
    };
    const { context, svg, selectedAtomIds, selectedBondIds, state } = makeBaseContext({
      selection: {
        toggleSelectMode() {
          calls.push('toggleSelectMode');
        }
      },
      renderers: {
        applySelectionOverlay() {
          calls.push('applySelectionOverlay');
        }
      }
    });
    context.state.documentState.getMol2d = () => mol;
    state.setPaintMode(true);

    initGestureInteractions(context);

    svg.handlers.get('dblclick.select-all')({
      target: { closest: () => null }
    });

    assert.deepEqual(calls, []);
    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
  });

  it('paints atom and bond hits while dragging in brush paint mode', () => {
    const atomHit = makeHitElement('atom', 'a1');
    const bondHit = makeHitElement('bond', 'b1');
    const { context, svg, listeners, calls, state } = makeBaseContext();
    state.setPaintMode(true);
    state.setPaintColor('#ff6633');
    state.setPaintOpacity(0.45);
    context.doc.elementsFromPoint = x => {
      if (x === 10) {
        return [atomHit];
      }
      if (x === 30) {
        return [bondHit];
      }
      return [];
    };

    initGestureInteractions(context);

    let prevented = false;
    let stopped = false;
    svg.handlers.get('mousedown.paint')({
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    });
    listeners.get('mousemove')({
      clientX: 30,
      clientY: 10
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, [
      ['paintStyleTargets', ['a1'], [], { color: '#ff6633', opacity: 0.45 }, { skipSnapshot: false }],
      ['paintStyleTargets', [], ['b1'], { color: '#ff6633', opacity: 0.45 }, { skipSnapshot: true }]
    ]);
  });

  it('previews brush color on 2D atom and bond hover without committing', () => {
    const atomHit = makeHitElement('atom', 'a1');
    const bondHit = makeHitElement('bond', 'b1');
    const { context, g, listeners, calls, state } = makeBaseContext();
    const atomGroup = g.append('g').attr('data-atom-id', 'a1');
    const atomLabel = atomGroup.append('text').attr('class', 'atom-label').style('fill', '#111111').style('opacity', '1');
    const bondGroup = g.append('g').attr('data-bond-id', 'b1');
    const bondLine = bondGroup.append('line').attr('class', 'bond').style('stroke', '#111111').style('stroke-opacity', '1');
    state.setPaintMode(true);
    state.setPaintColor('#ff6633');
    state.setPaintOpacity(0.45);
    context.doc.elementsFromPoint = x => {
      if (x === 10) {
        return [atomHit];
      }
      if (x === 30) {
        return [bondHit];
      }
      return [];
    };

    initGestureInteractions(context);

    listeners.get('mousemove')({
      clientX: 10,
      clientY: 10,
      buttons: 0
    });

    assert.equal(atomLabel.node().style.fill, '#ff6633');
    assert.equal(atomLabel.node().style.opacity, '0.45');
    assert.deepEqual(calls, []);

    listeners.get('mousemove')({
      clientX: 30,
      clientY: 10,
      buttons: 0
    });

    assert.equal(atomLabel.node().style.fill, '#111111');
    assert.equal(atomLabel.node().style.opacity, '1');
    assert.equal(bondLine.node().style.stroke, '#ff6633');
    assert.equal(bondLine.node().style['stroke-opacity'], '0.45');
    assert.deepEqual(calls, []);

    listeners.get('mousemove')({
      clientX: 90,
      clientY: 10,
      buttons: 0
    });

    assert.equal(bondLine.node().style.stroke, '#111111');
    assert.equal(bondLine.node().style['stroke-opacity'], '1');
    assert.deepEqual(calls, []);
  });

  it('previews brush color on force atom and bond hover without committing', () => {
    const atomHit = makeHitElement('force-atom', 'a1');
    const bondHit = makeHitElement('force-bond', 'b1');
    const { context, g, listeners, calls, state } = makeBaseContext();
    const forceAtom = g.append('circle').attr('class', 'node').style('fill', '#222222').style('fill-opacity', '1');
    forceAtom.node().__data__ = { id: 'a1' };
    const forceBond = g.append('line').attr('class', 'link').attr('data-bond-id', 'b1').style('stroke', '#111111').style('stroke-opacity', '1');
    state.setMode('force');
    state.setPaintMode(true);
    state.setPaintColor('#66ccff');
    state.setPaintOpacity(0.55);
    context.doc.elementsFromPoint = x => {
      if (x === 10) {
        return [atomHit];
      }
      if (x === 30) {
        return [bondHit];
      }
      return [];
    };

    initGestureInteractions(context);

    listeners.get('mousemove')({
      clientX: 10,
      clientY: 10,
      buttons: 0
    });

    assert.equal(forceAtom.node().style.fill, '#66ccff');
    assert.equal(forceAtom.node().style['fill-opacity'], '0.55');
    assert.deepEqual(calls, []);

    listeners.get('mousemove')({
      clientX: 30,
      clientY: 10,
      buttons: 0
    });

    assert.equal(forceAtom.node().style.fill, '#222222');
    assert.equal(forceAtom.node().style['fill-opacity'], '1');
    assert.equal(forceBond.node().style.stroke, '#66ccff');
    assert.equal(forceBond.node().style['stroke-opacity'], '0.55');
    assert.deepEqual(calls, []);
  });

  it('does not drag-paint in bucket paint mode', () => {
    const atomHit = makeHitElement('atom', 'a1');
    const { context, svg, listeners, calls, state } = makeBaseContext();
    state.setPaintMode(true);
    state.setPaintTool('bucket');
    context.doc.elementsFromPoint = () => [atomHit];

    initGestureInteractions(context);

    svg.handlers.get('mousedown.paint')({
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {}
    });
    listeners.get('mousemove')({
      clientX: 10,
      clientY: 10
    });

    assert.deepEqual(calls, []);
  });

  it('fills the smallest containing 2D ring in bucket paint mode', () => {
    const mol = {
      atoms: new Map([
        ['outer1', { id: 'outer1', x: 0, y: 0, visible: true }],
        ['outer2', { id: 'outer2', x: 100, y: 0, visible: true }],
        ['outer3', { id: 'outer3', x: 100, y: 100, visible: true }],
        ['outer4', { id: 'outer4', x: 0, y: 100, visible: true }],
        ['inner1', { id: 'inner1', x: 35, y: 35, visible: true }],
        ['inner2', { id: 'inner2', x: 65, y: 35, visible: true }],
        ['inner3', { id: 'inner3', x: 65, y: 65, visible: true }],
        ['inner4', { id: 'inner4', x: 35, y: 65, visible: true }]
      ]),
      getRings() {
        return [
          ['outer1', 'outer2', 'outer3', 'outer4'],
          ['inner1', 'inner2', 'inner3', 'inner4']
        ];
      }
    };
    const { context, svg, calls, state } = makeBaseContext({
      pointer: () => [50, 50]
    });
    context.state.documentState.getMol2d = () => mol;
    state.setPaintMode(true);
    state.setPaintTool('bucket');
    state.setPaintColor('#ffcc00');
    state.setPaintOpacity(0.35);

    initGestureInteractions(context);

    let prevented = false;
    let stopped = false;
    svg.handlers.get('mousedown.paint-bucket')({
      button: 0,
      target: { closest: () => null },
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, [['paintRingFill', ['inner1', 'inner2', 'inner3', 'inner4'], { color: '#ffcc00', opacity: 0.35 }, { skipSnapshot: false }]]);
  });

  it('fills the containing force-layout ring in bucket paint mode', () => {
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', visible: true }],
        ['a2', { id: 'a2', visible: true }],
        ['a3', { id: 'a3', visible: true }],
        ['a4', { id: 'a4', visible: true }]
      ]),
      getRings() {
        return [['a1', 'a2', 'a3', 'a4']];
      }
    };
    const { context, svg, calls, state } = makeBaseContext({
      pointer: () => [50, 50],
      simulation: {
        nodes: () => [
          { id: 'a1', x: 0, y: 0 },
          { id: 'a2', x: 100, y: 0 },
          { id: 'a3', x: 100, y: 100 },
          { id: 'a4', x: 0, y: 100 }
        ],
        force: () => ({
          links: () => []
        })
      }
    });
    context.state.documentState.getCurrentMol = () => mol;
    state.setMode('force');
    state.setPaintMode(true);
    state.setPaintTool('bucket');
    state.setPaintColor('#66ccff');
    state.setPaintOpacity(0.55);

    initGestureInteractions(context);

    svg.handlers.get('mousedown.paint-bucket')({
      button: 0,
      target: { closest: () => null },
      preventDefault() {},
      stopPropagation() {}
    });

    assert.deepEqual(calls, [['paintRingFill', ['a1', 'a2', 'a3', 'a4'], { color: '#66ccff', opacity: 0.55 }, { skipSnapshot: false }]]);
  });

  it('fills each ring entered during a bucket paint drag as one undoable stroke', () => {
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', x: 0, y: 0, visible: true }],
        ['a2', { id: 'a2', x: 100, y: 0, visible: true }],
        ['a3', { id: 'a3', x: 100, y: 100, visible: true }],
        ['a4', { id: 'a4', x: 0, y: 100, visible: true }],
        ['b1', { id: 'b1', x: 200, y: 0, visible: true }],
        ['b2', { id: 'b2', x: 300, y: 0, visible: true }],
        ['b3', { id: 'b3', x: 300, y: 100, visible: true }],
        ['b4', { id: 'b4', x: 200, y: 100, visible: true }]
      ]),
      getRings() {
        return [
          ['a1', 'a2', 'a3', 'a4'],
          ['b1', 'b2', 'b3', 'b4']
        ];
      }
    };
    let pointer = [150, 50];
    const { context, svg, listeners, calls, state } = makeBaseContext({
      pointer: () => pointer
    });
    context.state.documentState.getMol2d = () => mol;
    state.setPaintMode(true);
    state.setPaintTool('bucket');
    state.setPaintColor('#ffcc00');
    state.setPaintOpacity(0.35);

    initGestureInteractions(context);

    const blankTarget = { closest: () => null };
    svg.handlers.get('mousedown.paint-bucket')({
      button: 0,
      target: blankTarget,
      preventDefault() {},
      stopPropagation() {}
    });
    assert.deepEqual(calls, []);

    pointer = [50, 50];
    listeners.get('mousemove')({
      buttons: 1,
      target: blankTarget
    });
    pointer = [52, 52];
    listeners.get('mousemove')({
      buttons: 1,
      target: blankTarget
    });
    pointer = [250, 50];
    listeners.get('mousemove')({
      buttons: 1,
      target: blankTarget
    });

    assert.deepEqual(calls, [
      ['paintRingFill', ['a1', 'a2', 'a3', 'a4'], { color: '#ffcc00', opacity: 0.35 }, { skipSnapshot: false }],
      ['paintRingFill', ['b1', 'b2', 'b3', 'b4'], { color: '#ffcc00', opacity: 0.35 }, { skipSnapshot: true }]
    ]);
  });

  it('previews a bucket ring fill on hover and commits only on mousedown', () => {
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', x: 0, y: 0, visible: true }],
        ['a2', { id: 'a2', x: 100, y: 0, visible: true }],
        ['a3', { id: 'a3', x: 100, y: 100, visible: true }],
        ['a4', { id: 'a4', x: 0, y: 100, visible: true }]
      ]),
      getRings() {
        return [['a1', 'a2', 'a3', 'a4']];
      }
    };
    let pointer = [50, 50];
    const { context, svg, g, listeners, calls, state } = makeBaseContext({
      pointer: () => pointer
    });
    context.state.documentState.getMol2d = () => mol;
    state.setPaintMode(true);
    state.setPaintTool('bucket');
    state.setPaintColor('#ffcc00');
    state.setPaintOpacity(0.35);

    initGestureInteractions(context);
    const existingFill = g
      .append('g')
      .attr('class', 'ring-fills')
      .append('polygon')
      .attr('class', 'ring-fill')
      .attr('data-ring-fill-id', 'ring-fill:a1\0a2\0a3\0a4')
      .style('display', '');
    const highlightLayer = g.append('g').attr('class', 'atom-highlights');
    const bondLayer = g.append('g').attr('class', 'bonds');

    const blankTarget = { closest: () => null };
    listeners.get('mousemove')({
      buttons: 0,
      target: blankTarget
    });

    const preview = g.children.find(child => child.attrs.get('class') === 'ring-fill paint-bucket-ring-preview');
    assert.ok(preview);
    assert.equal(preview.attrs.get('points'), '0,0 100,0 100,100 0,100');
    assert.equal(preview.attrs.get('fill'), '#ffcc00');
    assert.equal(preview.attrs.get('fill-opacity'), 0.35);
    assert.equal(preview.styles.get('display'), null);
    assert.ok(g.children.indexOf(preview) < g.children.indexOf(highlightLayer));
    assert.ok(g.children.indexOf(preview) < g.children.indexOf(bondLayer));
    assert.equal(existingFill.node().style.display, 'none');
    assert.deepEqual(calls, []);

    pointer = [150, 150];
    listeners.get('mousemove')({
      buttons: 0,
      target: blankTarget
    });

    assert.equal(preview.styles.get('display'), 'none');
    assert.equal(existingFill.node().style.display, '');
    assert.deepEqual(calls, []);

    pointer = [50, 50];
    listeners.get('mousemove')({
      buttons: 0,
      target: blankTarget
    });
    svg.handlers.get('mousedown.paint-bucket')({
      button: 0,
      target: blankTarget,
      preventDefault() {},
      stopPropagation() {}
    });

    assert.equal(preview.styles.get('display'), 'none');
    assert.deepEqual(calls, [['paintRingFill', ['a1', 'a2', 'a3', 'a4'], { color: '#ffcc00', opacity: 0.35 }, { skipSnapshot: false }]]);
  });

  it('does not fill a ring when bucket paint starts on an atom or bond hit', () => {
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', x: 0, y: 0, visible: true }],
        ['a2', { id: 'a2', x: 10, y: 0, visible: true }],
        ['a3', { id: 'a3', x: 10, y: 10, visible: true }]
      ]),
      getRings() {
        return [['a1', 'a2', 'a3']];
      }
    };
    const { context, svg, calls, state } = makeBaseContext({
      pointer: () => [5, 5]
    });
    context.state.documentState.getMol2d = () => mol;
    state.setPaintMode(true);
    state.setPaintTool('bucket');

    initGestureInteractions(context);

    svg.handlers.get('mousedown.paint-bucket')({
      button: 0,
      target: { closest: () => ({}) },
      preventDefault() {},
      stopPropagation() {}
    });

    assert.deepEqual(calls, []);
  });

  it('selects a projected stereo hydrogen when its rendered point falls inside the drag box', () => {
    const hydrogen = { id: 'h1', x: 10, y: 10, visible: true, name: 'H' };
    const carbon = { id: 'c1', x: 10, y: 10, visible: true, name: 'C' };
    const mol = {
      atoms: new Map([
        ['h1', hydrogen],
        ['c1', carbon]
      ]),
      bonds: new Map()
    };
    const overlayCalls = [];
    const { context, svg, listeners, selectedAtomIds, state } = makeBaseContext({
      renderers: {
        applySelectionOverlay() {
          overlayCalls.push('applySelectionOverlay');
        }
      },
      helpers: {
        toSVGPt2d: atom => ({ x: atom.x, y: atom.y }),
        toSelectionSVGPt2d: atom => (atom.id === 'h1' ? { x: 90, y: 90 } : { x: atom.x, y: atom.y }),
        getDatum: element => element.__datum ?? null
      }
    });
    context.state.documentState.getMol2d = () => mol;
    state.setSelectMode(true);

    initGestureInteractions(context);

    svg.handlers.get('mousedown.selection')({
      button: 0,
      clientX: 80,
      clientY: 80,
      target: { closest: () => null },
      preventDefault() {}
    });
    listeners.get('mouseup')({
      button: 0,
      clientX: 100,
      clientY: 100
    });

    assert.deepEqual([...selectedAtomIds], ['h1']);
    assert.deepEqual(overlayCalls, ['applySelectionOverlay']);
  });

  it('previews 2D drag-box atom and bond selection before mouseup', () => {
    const a1 = { id: 'a1', x: 50, y: 50, visible: true, name: 'C' };
    const a2 = { id: 'a2', x: 90, y: 90, visible: true, name: 'C' };
    const a3 = { id: 'a3', x: 180, y: 90, visible: true, name: 'C' };
    const b1 = { id: 'b1', atoms: ['a1', 'a2'], getAtomObjects: () => [a1, a2] };
    const b2 = { id: 'b2', atoms: ['a2', 'a3'], getAtomObjects: () => [a2, a3] };
    const mol = {
      atoms: new Map([
        ['a1', a1],
        ['a2', a2],
        ['a3', a3]
      ]),
      bonds: new Map([
        ['b1', b1],
        ['b2', b2]
      ])
    };
    const overlayCalls = [];
    const { context, svg, selectedAtomIds, selectedBondIds, state } = makeBaseContext({
      renderers: {
        applySelectionOverlay() {
          overlayCalls.push('applySelectionOverlay');
        }
      }
    });
    context.state.documentState.getMol2d = () => mol;
    state.setSelectMode(true);

    initGestureInteractions(context);

    svg.handlers.get('mousedown.selection')({
      button: 0,
      clientX: 40,
      clientY: 40,
      target: { closest: () => null },
      preventDefault() {}
    });
    svg.handlers.get('mousemove.selection')({
      clientX: 110,
      clientY: 110
    });

    assert.deepEqual([...selectedAtomIds].sort(), ['a1', 'a2']);
    assert.deepEqual([...selectedBondIds], ['b1']);
    assert.deepEqual(overlayCalls, ['applySelectionOverlay']);

    svg.handlers.get('mousemove.selection')({
      clientX: 42,
      clientY: 42
    });

    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
    assert.equal(overlayCalls.length, 2);
  });

  it('previews additive drag-box selection from the pre-drag baseline', () => {
    const a1 = { id: 'a1', x: 50, y: 50, visible: true, name: 'C' };
    const a2 = { id: 'a2', x: 90, y: 90, visible: true, name: 'C' };
    const b1 = { id: 'b1', atoms: ['a1', 'a2'], getAtomObjects: () => [a1, a2] };
    const mol = {
      atoms: new Map([
        ['a1', a1],
        ['a2', a2]
      ]),
      bonds: new Map([['b1', b1]])
    };
    const { context, svg, selectedAtomIds, selectedBondIds, state } = makeBaseContext();
    context.state.documentState.getMol2d = () => mol;
    selectedAtomIds.add('a1');
    selectedBondIds.add('b1');
    state.setSelectMode(true);

    initGestureInteractions(context);

    svg.handlers.get('mousedown.selection')({
      button: 0,
      clientX: 40,
      clientY: 40,
      metaKey: true,
      target: { closest: () => null },
      preventDefault() {}
    });
    svg.handlers.get('mousemove.selection')({
      clientX: 110,
      clientY: 110
    });

    assert.deepEqual([...selectedAtomIds], ['a2']);
    assert.deepEqual([...selectedBondIds], []);
  });
});
