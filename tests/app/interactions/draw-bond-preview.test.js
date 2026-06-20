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
    molecule: {
      getActive: () => overrides.activeMolecule ?? null
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
    options: {
      getRenderOptions: () => ({ layoutBondLength: overrides.layoutBondLength ?? 1.5 })
    },
    helpers: {
      atomRadius: protonCount => protonCount,
      atomColor: element => `fill-${element}`,
      strokeColor: element => `stroke-${element}`,
      singleBondWidth: () => '3',
      labelHalfW: label => label.length * 5,
      toSelectionSVGPt2d: atom => overrides.toSelectionSVGPt2d?.(atom) ?? null
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
      drawBondElement: 'N',
      atomById: atomId => (atomId === 'a1' ? atom : null)
    });

    actions.start('a1', 10, 20);

    const expectedAngle = (11 / 12) * Math.PI * 2;
    assert.equal(getDrawBondState().atomId, 'a1');
    assert.equal(getDrawBondState().ox, 340);
    assert.equal(getDrawBondState().oy, 120);
    assert.ok(Math.abs(getDrawBondState().ex - (340 + Math.cos(expectedAngle) * 60)) < 1e-9);
    assert.ok(Math.abs(getDrawBondState().ey - (120 - Math.sin(expectedAngle) * 60)) < 1e-9);
    assert.equal(getDrawBondState().dragged, false);
    assert.equal(g.select('g.draw-bond-preview').empty(), false);
    assert.equal(g.select('text.draw-bond-dest-label').empty(), false);
    assert.ok(Math.abs(Number(g.select('text.draw-bond-dest-label').attr('x')) - getDrawBondState().ex) < 1e-9);
    assert.ok(Math.abs(Number(g.select('text.draw-bond-dest-label').attr('y')) - getDrawBondState().ey) < 1e-9);
  });

  it('starts a 2D preview from the projected rendered point when available', () => {
    const atom = { id: 'H4', x: 1, y: 2, visible: false, name: 'H' };
    const { actions, getDrawBondState } = makeActions({
      drawBondElement: 'H',
      atomById: atomId => (atomId === 'H4' ? atom : null),
      toSelectionSVGPt2d: currentAtom => (currentAtom?.id === 'H4' ? { x: 412, y: 156 } : null)
    });

    actions.start('H4', 10, 20);

    const expectedAngle = (11 / 12) * Math.PI * 2;
    assert.equal(getDrawBondState().atomId, 'H4');
    assert.equal(getDrawBondState().ox, 412);
    assert.equal(getDrawBondState().oy, 156);
    assert.ok(Math.abs(getDrawBondState().ex - (412 + Math.cos(expectedAngle) * 60)) < 1e-9);
    assert.ok(Math.abs(getDrawBondState().ey - (156 - Math.sin(expectedAngle) * 60)) < 1e-9);
    assert.equal(getDrawBondState().dragged, false);
  });

  it('starts an atom-anchored 2D preview in the no-drag auto-placement direction', () => {
    const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C', bonds: ['b1'] };
    const neighbor = { id: 'a2', x: -1.5, y: 0, visible: true, name: 'C', bonds: ['b1'] };
    source.getNeighbors = () => [neighbor];
    neighbor.getNeighbors = () => [source];
    const bond = {
      id: 'b1',
      atoms: ['a1', 'a2'],
      getOtherAtom(atomId) {
        return atomId === 'a1' ? 'a2' : 'a1';
      }
    };
    const activeMolecule = {
      atoms: new Map([
        ['a1', source],
        ['a2', neighbor]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { actions, getDrawBondState, g } = makeActions({
      activeMolecule,
      drawBondElement: 'C',
      atomById: atomId => (atomId === 'a1' ? source : atomId === 'a2' ? neighbor : null),
      atoms: [source, neighbor]
    });

    actions.start('a1', 0, 0);

    const expectedAngle = (5 / 3) * Math.PI;
    assert.equal(getDrawBondState().ox, 300);
    assert.equal(getDrawBondState().oy, 200);
    assert.ok(Math.abs(getDrawBondState().ex - (300 + Math.cos(expectedAngle) * 60)) < 1e-9);
    assert.ok(Math.abs(getDrawBondState().ey - (200 - Math.sin(expectedAngle) * 60)) < 1e-9);
    assert.equal(g.select('g.draw-bond-preview').empty(), false);
  });

  it('previews carbon atom replacement without drawing an atom-anchored line', () => {
    const chlorine = { id: 'cl1', x: 1, y: 2, visible: true, name: 'Cl', bonds: [] };
    const activeMolecule = {
      atoms: new Map([['cl1', chlorine]]),
      bonds: new Map()
    };
    const { actions, getDrawBondState, g } = makeActions({
      activeMolecule,
      drawBondElement: 'C',
      atomById: atomId => (atomId === 'cl1' ? chlorine : null)
    });

    actions.start('cl1', 10, 20);

    assert.equal(getDrawBondState().ox, 340);
    assert.equal(getDrawBondState().oy, 120);
    assert.equal(getDrawBondState().ex, 340);
    assert.equal(getDrawBondState().ey, 120);
    assert.equal(g.select('g.draw-bond-preview').empty(), false);
    assert.equal(g.select('rect.draw-bond-replacement-cover').empty(), true);
    assert.equal(g.select('text.draw-bond-replacement-label').empty(), true);
    assert.equal(g.select('line.draw-bond-preview-segment').empty(), true);
    assert.equal(g.select('text.draw-bond-dest-label').empty(), true);

    actions.update([400, 120]);

    assert.equal(g.select('g.draw-bond-preview').empty(), false);
    assert.equal(g.select('line.draw-bond-preview-segment').empty(), false);
  });

  it('previews heteroatom replacement with the new atom label', () => {
    const carbon = { id: 'c1', x: 1, y: 2, visible: true, name: 'C', bonds: [] };
    const activeMolecule = {
      atoms: new Map([['c1', carbon]]),
      bonds: new Map()
    };
    const { actions, getDrawBondState, g } = makeActions({
      activeMolecule,
      drawBondElement: 'O',
      atomById: atomId => (atomId === 'c1' ? carbon : null)
    });

    actions.start('c1', 10, 20);

    assert.equal(getDrawBondState().ox, 340);
    assert.equal(getDrawBondState().oy, 120);
    assert.equal(getDrawBondState().ex, 340);
    assert.equal(getDrawBondState().ey, 120);
    assert.equal(g.select('g.draw-bond-preview').empty(), false);
    assert.equal(g.select('rect.draw-bond-replacement-cover').empty(), true);
    const replacementLabel = g.select('text.draw-bond-replacement-label');
    assert.equal(replacementLabel.empty(), false);
    assert.equal(replacementLabel.node.text, 'O');
    assert.equal(g.select('line.draw-bond-preview-segment').empty(), true);
  });

  it('starts a force preview with a visible auto-placement endpoint', () => {
    const { actions, getDrawBondState, g } = makeActions({
      mode: 'force',
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', x: 120, y: 120 } : null)
    });

    actions.start('a1', 0, 0);

    const expectedAngle = (11 / 12) * Math.PI * 2;
    assert.equal(getDrawBondState().ox, 120);
    assert.equal(getDrawBondState().oy, 120);
    assert.ok(Math.abs(getDrawBondState().ex - (120 + Math.cos(expectedAngle) * 25)) < 1e-9);
    assert.ok(Math.abs(getDrawBondState().ey - (120 + Math.sin(expectedAngle) * 25)) < 1e-9);
    assert.equal(g.select('g.draw-bond-preview').empty(), false);
    assert.ok(Math.abs(Number(g.select('circle.draw-bond-dest-node').attr('cx')) - getDrawBondState().ex) < 1e-9);
    assert.ok(Math.abs(Number(g.select('circle.draw-bond-dest-node').attr('cy')) - getDrawBondState().ey) < 1e-9);
  });

  it('starts a blank-space 2D preview with only the origin atom visible', () => {
    const { actions, getDrawBondState, g } = makeActions({
      drawBondElement: 'O'
    });

    actions.start(null, 200, 150);

    assert.deepEqual(getDrawBondState(), {
      atomId: null,
      ox: 200,
      oy: 150,
      ex: 200,
      ey: 150,
      dragged: false
    });
    assert.equal(g.select('text.draw-bond-origin-label').empty(), false);
    assert.equal(g.select('g.draw-bond-preview').empty(), true);
    assert.equal(g.select('text.draw-bond-dest-label').empty(), true);
  });

  it('shows a temporary carbon label for blank-space carbon placement feedback', () => {
    const { actions, g } = makeActions({
      drawBondElement: 'C'
    });

    actions.start(null, 200, 150);

    const originLabel = g.select('text.draw-bond-origin-label');
    assert.equal(originLabel.empty(), false);
    assert.equal(originLabel.node.text, 'C');
    assert.equal(g.select('text.draw-bond-dest-label').empty(), true);
  });

  it('waits for sufficient blank-space movement before showing a second atom preview', () => {
    const { actions, getDrawBondState, g } = makeActions({
      drawBondElement: 'O'
    });

    actions.start(null, 200, 150);
    actions.update([220, 150]);

    assert.deepEqual(getDrawBondState(), {
      atomId: null,
      ox: 200,
      oy: 150,
      ex: 200,
      ey: 150,
      dragged: false,
      snapAtomId: null
    });
    assert.equal(g.select('g.draw-bond-preview').empty(), true);
    assert.equal(g.select('text.draw-bond-dest-label').empty(), true);

    actions.update([240, 150]);

    assert.equal(g.select('g.draw-bond-preview').empty(), false);
    assert.equal(g.select('text.draw-bond-dest-label').empty(), false);
    assert.equal(getDrawBondState().ex, 240);
  });

  it('keeps line-mode hydrogen placement preview strokes clear of the H label', () => {
    const { actions, g } = makeActions({
      drawBondElement: 'H'
    });

    actions.start(null, 200, 150);
    actions.update([260, 150]);

    const segment = g.nodes.find(node => !node.removed && node.attrs.class === 'draw-bond-preview-segment');
    assert.ok(segment);
    assert.equal(segment.attrs.x1, 208);
    assert.equal(segment.attrs.x2, 252);
  });

  it('updates a 2D preview and snaps to a nearby atom', () => {
    const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'O' };
    const dest = { id: 'a2', x: 1, y: 0, visible: true, name: 'N' };
    const { actions, getDrawBondState, g } = makeActions({
      drawBondElement: 'O',
      atomById: atomId => (atomId === 'a1' ? source : atomId === 'a2' ? dest : null),
      atoms: [source, dest]
    });

    actions.start('a1', 0, 0);
    actions.update([342, 200]);

    assert.equal(getDrawBondState().snapAtomId, 'a2');
    assert.equal(g.select('text.draw-bond-dest-label').attr('display'), 'none');
  });

  it('snaps atom-anchored 2D line previews to 30 degree increments', () => {
    const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
    const { actions, getDrawBondState } = makeActions({
      drawBondElement: 'C',
      atomById: atomId => (atomId === 'a1' ? source : null),
      atoms: [source]
    });

    actions.start('a1', 0, 0);
    actions.update([340, 170]);

    const expectedAngle = Math.PI / 6;
    const expectedDistance = 50;
    assert.ok(Math.abs(getDrawBondState().ex - (300 + Math.cos(expectedAngle) * expectedDistance)) < 1e-9);
    assert.ok(Math.abs(getDrawBondState().ey - (200 - Math.sin(expectedAngle) * expectedDistance)) < 1e-9);
  });

  it('uses the configured layout bond length for atom-anchored 2D line previews', () => {
    const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
    const { actions, getDrawBondState } = makeActions({
      drawBondElement: 'C',
      layoutBondLength: 2,
      atomById: atomId => (atomId === 'a1' ? source : null),
      atoms: [source]
    });

    actions.start('a1', 0, 0);
    actions.update([390, 200]);

    assert.equal(getDrawBondState().ex, 380);
    assert.equal(getDrawBondState().ey, 200);
  });

  for (const modifierKey of ['ctrlKey', 'metaKey']) {
    it(`uses freeform atom-anchored 2D line previews when ${modifierKey} is held`, () => {
      const source = { id: 'a1', x: 0, y: 0, visible: true, name: 'C' };
      const { actions, getDrawBondState } = makeActions({
        drawBondElement: 'C',
        atomById: atomId => (atomId === 'a1' ? source : null),
        atoms: [source]
      });

      actions.start('a1', 0, 0);
      actions.update([340, 170], { [modifierKey]: true });

      assert.equal(getDrawBondState().ex, 340);
      assert.equal(getDrawBondState().ey, 170);
    });
  }

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

  it('previews an existing bond with an explicit preview draw type', () => {
    const { actions, g } = makeActions({
      drawBondType: 'single'
    });

    const handled = actions.previewBond({ x: 10, y: 20 }, { x: 70, y: 20 }, { drawBondType: 'triple' });

    assert.equal(handled, true);
    const liveSegments = g.nodes.filter(node => !node.removed && node.attrs.class === 'draw-bond-preview-segment');
    assert.equal(liveSegments.length, 3);
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
