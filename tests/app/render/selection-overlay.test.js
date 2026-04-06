import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createForceSelectionRenderer, createSelectionOverlayManager } from '../../../src/app/render/selection-overlay.js';

class FakeSelection {
  constructor(records) {
    this.records = records;
  }

  select(selector) {
    this.records.push(['select', selector]);
    return this;
  }

  remove() {
    this.records.push(['remove']);
    return this;
  }

  insert(tag, before) {
    this.records.push(['insert', tag, before]);
    return new FakeSelection(this.records);
  }

  append(tag) {
    this.records.push(['append', tag]);
    return new FakeSelection(this.records);
  }

  attr(name, value) {
    this.records.push(['attr', name, value]);
    return this;
  }

  style(name, value) {
    this.records.push(['style', name, value]);
    return this;
  }

  selectAll(selector) {
    this.records.push(['selectAll', selector]);
    return this;
  }

  data(value) {
    this.records.push(['data', value]);
    return this;
  }

  enter() {
    this.records.push(['enter']);
    return this;
  }

  datum(value) {
    this.records.push(['datum', value]);
    return this;
  }
}

function makeAtom(id, { x = 0, y = 0, visible = true, name = 'C' } = {}) {
  return {
    id,
    x,
    y,
    visible,
    name,
    getCharge() {
      return 0;
    },
    getNeighbors() {
      return [];
    }
  };
}

function makeBond(id, atomA, atomB) {
  return {
    id,
    getAtomObjects() {
      return [atomA, atomB];
    }
  };
}

function makeManager(options = {}) {
  const records = [];
  const selectedAtomIds = options.selectedAtomIds ?? new Set();
  const selectedBondIds = options.selectedBondIds ?? new Set();
  const hoveredAtomIds = options.hoveredAtomIds ?? new Set();
  const hoveredBondIds = options.hoveredBondIds ?? new Set();
  const scheduler = { callback: null };

  const mol2D = options.mol2D ?? null;
  const forceMol = options.forceMol ?? null;

  const manager = createSelectionOverlayManager({
    scheduler: {
      requestAnimationFrame: callback => {
        scheduler.callback = callback;
        records.push(['raf']);
        return 1;
      }
    },
    state: {
      getMode: () => options.mode ?? '2d',
      getSelectMode: () => options.selectMode ?? false,
      getDrawBondMode: () => options.drawBondMode ?? false,
      getEraseMode: () => options.eraseMode ?? false,
      getSelectionModifierActive: () => options.selectionModifierActive ?? false,
      getSelectedAtomIds: () => selectedAtomIds,
      getSelectedBondIds: () => selectedBondIds,
      getHoveredAtomIds: () => hoveredAtomIds,
      getHoveredBondIds: () => hoveredBondIds
    },
    molecule: {
      getForceMol: () => forceMol,
      getMol2D: () => mol2D
    },
    view2D: {
      getHCounts: () => new Map(),
      getStereoMap: () => options.stereoMap ?? null,
      toSVGPt: atom => ({ x: atom.x, y: atom.y })
    },
    view: {
      getGraphSelection: () => new FakeSelection(records)
    },
    renderers: {
      applyForceSelection: () => {
        records.push(['applyForceSelection']);
      }
    },
    constants: {
      getFontSize: () => 14
    }
  });

  return { manager, records, selectedAtomIds, selectedBondIds, hoveredAtomIds, hoveredBondIds, scheduler };
}

describe('createSelectionOverlayManager', () => {
  it('returns hover-only selection ids when no explicit selection exists', () => {
    const mol = {
      atoms: new Map([['a1', makeAtom('a1')]]),
      bonds: new Map([['b1', { id: 'b1' }]])
    };
    const { manager } = makeManager({
      mode: '2d',
      selectMode: true,
      hoveredAtomIds: new Set(['a1', 'ghost-atom']),
      hoveredBondIds: new Set(['b1', 'ghost-bond']),
      mol2D: mol
    });

    const { atomIds, bondIds } = manager.getRenderableSelectionIds();
    assert.deepEqual([...atomIds], ['a1']);
    assert.deepEqual([...bondIds], ['b1']);
  });

  it('returns the explicit selection unless additive modifier is active', () => {
    const mol = {
      atoms: new Map([
        ['a1', makeAtom('a1')],
        ['a2', makeAtom('a2')]
      ]),
      bonds: new Map([['b1', { id: 'b1' }]])
    };
    const selectedAtomIds = new Set(['a1']);
    const hoveredAtomIds = new Set(['a2']);

    const withoutModifier = makeManager({
      mode: '2d',
      selectMode: true,
      selectionModifierActive: false,
      selectedAtomIds,
      selectedBondIds: new Set(['b1']),
      hoveredAtomIds,
      mol2D: mol
    }).manager.getRenderableSelectionIds();

    assert.deepEqual([...withoutModifier.atomIds], ['a1']);
    assert.deepEqual([...withoutModifier.bondIds], ['b1']);

    const withModifier = makeManager({
      mode: '2d',
      selectMode: true,
      selectionModifierActive: true,
      selectedAtomIds,
      selectedBondIds: new Set(['b1']),
      hoveredAtomIds,
      mol2D: mol
    }).manager.getRenderableSelectionIds();

    assert.deepEqual([...withModifier.atomIds].sort(), ['a1', 'a2']);
    assert.deepEqual([...withModifier.bondIds], ['b1']);
  });

  it('filters 2D hover targets against visibility and stereo-hidden bonds', () => {
    const visibleAtom = makeAtom('a1', { visible: true });
    const hiddenAtom = makeAtom('a2', { visible: false });
    const visibleBond = makeBond('b1', visibleAtom, visibleAtom);
    const hiddenBond = makeBond('b2', visibleAtom, hiddenAtom);
    const mol = {
      atoms: new Map([
        ['a1', visibleAtom],
        ['a2', hiddenAtom]
      ]),
      bonds: new Map([
        ['b1', visibleBond],
        ['b2', hiddenBond]
      ])
    };
    const { manager, hoveredAtomIds, hoveredBondIds, scheduler } = makeManager({
      mode: '2d',
      selectMode: true,
      mol2D: mol,
      stereoMap: new Map([['b2', 'wedge']])
    });

    manager.showPrimitiveHover(['a1', 'a2'], ['b1', 'b2']);

    assert.deepEqual([...hoveredAtomIds], ['a1']);
    assert.deepEqual([...hoveredBondIds].sort(), ['b1', 'b2']);
    assert.equal(typeof scheduler.callback, 'function');
  });

  it('can set primitive hover directly in draw mode', () => {
    const atomA = makeAtom('a1', { x: 10, y: 10 });
    const atomB = makeAtom('a2', { x: 40, y: 10 });
    const bond = makeBond('b1', atomA, atomB);
    const mol = {
      atoms: new Map([
        ['a1', atomA],
        ['a2', atomB]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { manager, hoveredAtomIds, hoveredBondIds, scheduler } = makeManager({
      mode: '2d',
      drawBondMode: true,
      mol2D: mol
    });

    manager.setPrimitiveHover(['a1'], ['b1']);

    assert.deepEqual([...hoveredAtomIds], ['a1']);
    assert.deepEqual([...hoveredBondIds], ['b1']);
    assert.equal(typeof scheduler.callback, 'function');
  });

  it('throttles selection overlay refreshes until the scheduled frame runs', () => {
    const mol = {
      atoms: new Map([['a1', makeAtom('a1')]]),
      bonds: new Map()
    };
    const { manager, records, scheduler } = makeManager({
      mode: 'force',
      forceMol: mol
    });

    manager.refreshSelectionOverlay();
    manager.refreshSelectionOverlay();
    assert.equal(records.filter(([kind]) => kind === 'raf').length, 1);

    scheduler.callback();
    assert.equal(records.filter(([kind]) => kind === 'applyForceSelection').length, 1);
  });

  it('redraws the 2D selection layer for selected atoms and bonds', () => {
    const atomA = makeAtom('a1', { x: 10, y: 10 });
    const atomB = makeAtom('a2', { x: 40, y: 10 });
    const bond = makeBond('b1', atomA, atomB);
    const mol = {
      atoms: new Map([
        ['a1', atomA],
        ['a2', atomB]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { manager, records } = makeManager({
      mode: '2d',
      mol2D: mol,
      selectedAtomIds: new Set(['a1']),
      selectedBondIds: new Set(['b1'])
    });

    manager.redraw2dSelection();

    assert.ok(records.some(([kind, value]) => kind === 'select' && value === 'g.atom-selection'));
    assert.ok(records.some(([kind, tag]) => kind === 'insert' && tag === 'g'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'line'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'circle'));
  });

  it('renders the extracted force selection layer for selected atoms and bonds', () => {
    const records = [];
    const nodes = [
      { id: 'a1', x: 10, y: 10, protons: 6 },
      { id: 'a2', x: 30, y: 10, protons: 6 }
    ];
    const links = [{ id: 'b1', source: nodes[0], target: nodes[1] }];

    const renderer = createForceSelectionRenderer({
      view: {
        getGraphSelection: () => new FakeSelection(records)
      },
      selection: {
        getRenderableSelectionIds: () => ({
          atomIds: new Set(['a1']),
          bondIds: new Set(['b1'])
        })
      },
      force: {
        getNodes: () => nodes,
        getLinks: () => links
      },
      cache: {
        setSelectionLines: value => records.push(['setSelectionLines', value]),
        setSelectionCircles: value => records.push(['setSelectionCircles', value])
      },
      constants: {
        getSelectionColor: () => 'rgb(150, 200, 255)',
        getSelectionOutline: () => 'rgb(40, 100, 210)',
        getBondSelectionRadius: () => 6,
        getAtomSelectionRadius: () => 13,
        getOutlineWidth: () => 2
      },
      helpers: {
        atomRadius: () => 10
      }
    });

    renderer.applyForceSelection();

    assert.ok(records.some(([kind, selector]) => kind === 'selectAll' && selector === 'g.force-selection-layer'));
    assert.ok(records.some(([kind, tag]) => kind === 'insert' && tag === 'g'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'line'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'circle'));
  });
});
