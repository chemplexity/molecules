import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDrawBondPreviewActions } from '../../../src/app/interactions/draw-bond-preview.js';

class FakeSelection {
  constructor(root, node) {
    this.root = root;
    this.node = node;
  }

  append(tag) {
    const node = { tag, attrs: {}, text: '', removed: false, parent: this.node ?? null };
    this.root.nodes.push(node);
    return new FakeSelection(this.root, node);
  }

  insert(tag) {
    return this.append(tag);
  }

  attr(name, value) {
    if (!this.node) {
      return value === undefined ? undefined : this;
    }
    if (value === undefined) {
      return this.node.attrs[name];
    }
    this.node.attrs[name] = value;
    return this;
  }

  text(value) {
    if (!this.node) {
      return this;
    }
    this.node.text = value;
    return this;
  }

  remove() {
    if (this.node) {
      this.node.removed = true;
      const stack = [this.node];
      while (stack.length > 0) {
        const current = stack.pop();
        for (const child of this.root.nodes) {
          if (child.parent === current && !child.removed) {
            child.removed = true;
            stack.push(child);
          }
        }
      }
    }
    return this;
  }

  empty() {
    return !this.node || this.node.removed;
  }
}

class FakeRootSelection {
  constructor() {
    this.nodes = [];
  }

  append(tag) {
    const node = { tag, attrs: {}, text: '', removed: false, parent: null };
    this.nodes.push(node);
    return new FakeSelection(this, node);
  }

  insert(tag) {
    return this.append(tag);
  }

  select(selector) {
    const className = selector.includes('.') ? selector.split('.').pop() : selector.replace('.', '');
    const node = [...this.nodes].reverse().find(entry => !entry.removed && entry.attrs.class === className);
    return new FakeSelection(this, node ?? null);
  }
}

function makeActions(overrides = {}) {
  let drawBondState = overrides.initialDrawBondState ?? null;
  const hoveredAtoms = new Set();
  const hoveredBonds = new Set();
  const calls = [];
  const g = new FakeRootSelection();

  const actions = createDrawBondPreviewActions({
    g,
    getMode: () => overrides.mode ?? '2d',
    getDrawBondElement: () => overrides.drawBondElement ?? 'O',
    getDrawBondType: () => overrides.drawBondType ?? 'single',
    getDrawElemProtons: () => ({ O: 8, C: 6 }),
    overlays: {
      isReactionPreviewEditableAtomId: atomId => overrides.isEditableAtomId?.(atomId) ?? true
    },
    state: {
      getDrawBondState: () => drawBondState,
      setDrawBondState: value => {
        drawBondState = value;
      },
      clearHoveredAtomIds: () => hoveredAtoms.clear(),
      clearHoveredBondIds: () => hoveredBonds.clear(),
      addHoveredAtomId: atomId => hoveredAtoms.add(atomId)
    },
    view: {
      clearPrimitiveHover: () => {
        calls.push('clearPrimitiveHover');
      }
    },
    renderers: {
      applyForceSelection: () => {
        calls.push('applyForceSelection');
      },
      redraw2dSelection: () => {
        calls.push('redraw2dSelection');
      }
    },
    plot: {
      getSize: () => ({
        width: 600,
        height: 400
      })
    },
    force: {
      getNodeById: atomId => overrides.forceNodeById?.(atomId) ?? null,
      getNodes: () => overrides.forceNodes ?? []
    },
    view2D: {
      getAtomById: atomId => overrides.atomById?.(atomId) ?? null,
      getAtoms: () => overrides.atoms ?? [],
      getCenterX: () => overrides.cx2d ?? 0,
      getCenterY: () => overrides.cy2d ?? 0
    },
    constants: {
      scale: 40,
      forceBondLength: 25,
      strokeWidth: 2,
      fontSize: 22
    },
    helpers: {
      atomRadius: protonCount => protonCount,
      atomColor: element => `fill-${element}`,
      strokeColor: element => `stroke-${element}`,
      singleBondWidth: () => '3',
      labelHalfW: label => label.length * 5
    }
  });

  return {
    actions,
    getDrawBondState: () => drawBondState,
    hoveredAtoms,
    hoveredBonds,
    calls,
    g
  };
}

describe('createDrawBondPreviewActions', () => {
  it('starts a 2D preview and creates the preview primitives', () => {
    const atom = { id: 'a1', x: 1, y: 2, visible: true, name: 'N' };
    const { actions, getDrawBondState, g } = makeActions({
      atomById: atomId => (atomId === 'a1' ? atom : null)
    });

    actions.start('a1', 10, 20);

    assert.deepEqual(getDrawBondState(), {
      atomId: 'a1',
      ox: 340,
      oy: 120,
      ex: 340,
      ey: 120,
      dragged: false
    });
    assert.equal(g.select('g.draw-bond-preview').empty(), false);
    assert.equal(g.select('text.draw-bond-dest-label').empty(), false);
  });

  it('updates a 2D preview and snaps to a nearby atom', () => {
    const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
    const dest = { id: 'a2', x: 1, y: 0, visible: true, name: 'N' };
    const { actions, getDrawBondState, g } = makeActions({
      atomById: atomId => (atomId === 'a1' ? source : atomId === 'a2' ? dest : null),
      atoms: [source, dest]
    });

    actions.start('a1', 0, 0);
    actions.update([342, 200]);

    assert.equal(getDrawBondState().snapAtomId, 'a2');
    assert.equal(g.select('text.draw-bond-dest-label').attr('display'), 'none');
  });

  it('resetHover keeps only the source atom highlighted and rerenders', () => {
    const { actions, hoveredAtoms, hoveredBonds, calls } = makeActions({
      initialDrawBondState: { atomId: 'a9', ox: 0, oy: 0, ex: 0, ey: 0, dragged: false }
    });
    hoveredAtoms.add('old');
    hoveredBonds.add('b1');

    actions.resetHover();

    assert.deepEqual([...hoveredAtoms], ['a9']);
    assert.deepEqual([...hoveredBonds], []);
    assert.deepEqual(calls, ['redraw2dSelection']);
  });

  it('cancel clears preview artifacts and state', () => {
    const atom = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
    const { actions, getDrawBondState, calls, g } = makeActions({
      atomById: atomId => (atomId === 'a1' ? atom : null)
    });
    actions.start('a1', 0, 0);

    actions.cancel();

    assert.equal(getDrawBondState(), null);
    assert.equal(g.select('g.draw-bond-preview').empty(), true);
    assert.deepEqual(calls, ['clearPrimitiveHover', 'redraw2dSelection']);
  });

  it('renders multiple preview segments for a double bond selection', () => {
    const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
    const { actions, g } = makeActions({
      drawBondType: 'double',
      atomById: atomId => (atomId === 'a1' ? source : null)
    });

    actions.start('a1', 0, 0);
    actions.update([360, 160]);

    const liveSegments = g.nodes.filter(node => !node.removed && node.attrs.class === 'draw-bond-preview-segment');
    assert.equal(liveSegments.length, 2);
  });

  it('renders force-mode double previews with the final-style separator treatment', () => {
    const _source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
    const { actions, g } = makeActions({
      mode: 'force',
      drawBondType: 'double',
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', x: 120, y: 120 } : null)
    });

    actions.start('a1', 120, 120);
    actions.update([170, 120]);

    const liveSegments = g.nodes.filter(node => !node.removed && node.attrs.class === 'draw-bond-preview-segment');
    assert.equal(liveSegments.length, 2);
    assert.equal(liveSegments[0].attrs['stroke-width'], 3);
    assert.equal(liveSegments[1].attrs.stroke, '#fff');
  });

  it('renders force-mode triple previews with two white separators', () => {
    const { actions, g } = makeActions({
      mode: 'force',
      drawBondType: 'triple',
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', x: 120, y: 120 } : null)
    });

    actions.start('a1', 120, 120);
    actions.update([170, 120]);

    const liveSegments = g.nodes.filter(node => !node.removed && node.attrs.class === 'draw-bond-preview-segment');
    assert.equal(liveSegments.length, 3);
    assert.equal(liveSegments[1].attrs.stroke, '#fff');
    assert.equal(liveSegments[2].attrs.stroke, '#fff');
  });

  it('renders a wedge preview polygon for a wedge bond selection', () => {
    const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
    const { actions, g } = makeActions({
      drawBondType: 'wedge',
      atomById: atomId => (atomId === 'a1' ? source : null)
    });

    actions.start('a1', 0, 0);
    actions.update([360, 160]);

    const wedgePolygons = g.nodes.filter(node => !node.removed && node.attrs.class === 'draw-bond-preview-wedge');
    assert.equal(wedgePolygons.length, 1);
  });
});
