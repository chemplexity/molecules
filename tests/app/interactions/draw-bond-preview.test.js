import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDrawBondPreviewActions } from '../../../src/app/interactions/draw-bond-preview.js';

class FakeSelection {
  constructor(root, node) {
    this.root = root;
    this.node = node;
  }

  append(tag) {
    const node = { tag, attrs: {}, text: '', removed: false };
    this.root.nodes.push(node);
    return new FakeSelection(this.root, node);
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
    const node = { tag, attrs: {}, text: '', removed: false };
    this.nodes.push(node);
    return new FakeSelection(this, node);
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
      fontSize: 22,
      drawElemProtons: { O: 8, C: 6 }
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
    assert.equal(g.select('line.draw-bond-preview').empty(), false);
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
    assert.equal(g.select('line.draw-bond-preview').empty(), true);
    assert.deepEqual(calls, ['clearPrimitiveHover', 'redraw2dSelection']);
  });
});
