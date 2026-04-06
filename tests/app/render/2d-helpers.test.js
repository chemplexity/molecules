import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { create2DRenderHelpers } from '../../../src/app/render/2d-helpers.js';

class FakeSelection {
  constructor(records, nodeRef = {}) {
    this.records = records;
    this.nodeRef = nodeRef;
  }

  node() {
    return this.nodeRef;
  }

  append(tag) {
    this.records.push(['append', tag]);
    return new FakeSelection(this.records, this.nodeRef);
  }

  attr(name, value) {
    this.records.push(['attr', name, value]);
    return this;
  }

  style(name, value) {
    this.records.push(['style', name, value]);
    return this;
  }

  call(fn, ...args) {
    this.records.push(['call', fn?.name ?? 'anonymous', ...args]);
    if (typeof fn === 'function') {
      fn(this, ...args);
    }
    return this;
  }
}

function makeZoomIdentity() {
  return {
    translate(x, y) {
      return {
        x,
        y,
        scale(k) {
          return { x, y, k };
        }
      };
    }
  };
}

function makeAtom(id, name, x, y) {
  return {
    id,
    name,
    x,
    y,
    visible: true,
    _neighbors: [],
    getCharge() {
      return 0;
    },
    getNeighbors() {
      return this._neighbors;
    }
  };
}

function makeHelpersContext({ mol = null, hCounts = new Map(), stereoMap = new Map(), centerX = 0, centerY = 0 } = {}) {
  const records = [];
  const state = {
    mol,
    hCounts,
    stereoMap,
    centerX,
    centerY,
    derived: null
  };
  const svg = new FakeSelection(records, { id: 'svg-node' });
  const zoom = {
    transform: function transform() {}
  };
  const helpers = create2DRenderHelpers({
    d3: {
      zoomIdentity: makeZoomIdentity(),
      zoomTransform: () => ({
        applyX: value => value,
        applyY: value => value
      })
    },
    svg,
    zoom,
    plotEl: {
      clientWidth: 600,
      clientHeight: 400
    },
    state: {
      getMol: () => state.mol,
      getHCounts: () => state.hCounts,
      getCenterX: () => state.centerX,
      getCenterY: () => state.centerY,
      setDerivedState: derived => {
        state.derived = derived;
      }
    },
    constants: {
      scale: 60,
      bondOffset2d: 7,
      getFontSize: () => 14,
      wedgeHalfWidth: 6,
      wedgeDashes: 5
    },
    geometry: {
      perpUnit(dx, dy) {
        const len = Math.hypot(dx, dy) || 1;
        return { nx: -dy / len, ny: dx / len };
      },
      shortenLine(x1, y1, x2, y2) {
        return { x1, y1, x2, y2 };
      },
      secondaryDir: () => 1
    },
    stereo: {
      pickStereoMap: molArg => {
        records.push(['pickStereoMap', molArg?.id ?? null]);
        return stereoMap;
      }
    }
  });

  return { helpers, records, state, svg, zoom };
}

describe('create2DRenderHelpers', () => {
  it('maps 2D molecule coordinates into SVG coordinates using the current center', () => {
    const { helpers } = makeHelpersContext({ centerX: 1, centerY: -1 });
    const point = helpers.toSVGPt2d({ x: 2, y: 1 });
    assert.deepEqual(point, { x: 360, y: 80 });
  });

  it('computes hydrogen counts and stereo state through sync2dDerivedState', () => {
    const carbon = makeAtom('c1', 'C', 0, 0);
    const hydrogen = makeAtom('h1', 'H', 1, 0);
    carbon._neighbors = [hydrogen];
    hydrogen._neighbors = [carbon];
    const mol = {
      id: 'mol-sync',
      atoms: new Map([
        [carbon.id, carbon],
        [hydrogen.id, hydrogen]
      ])
    };
    const stereoMap = new Map([['bond-1', 'wedge']]);
    const { helpers, state, records } = makeHelpersContext({ mol, stereoMap });

    helpers.sync2dDerivedState(mol);

    assert.ok(state.derived);
    assert.equal(state.derived.hCounts.get('c1'), 1);
    assert.equal(state.derived.stereoMap, stereoMap);
    assert.ok(records.some(([kind, molId]) => kind === 'pickStereoMap' && molId === 'mol-sync'));
  });

  it('fits the 2D view when atoms fall outside the viewport', () => {
    const atom = makeAtom('a1', 'C', 10, 0);
    const mol = {
      atoms: new Map([[atom.id, atom]])
    };
    const { helpers, records, zoom } = makeHelpersContext({ mol });

    helpers.zoomToFitIf2d();

    assert.ok(records.some(([kind, name]) => kind === 'call' && name === 'transform'));
    assert.ok(records.some(([kind, name]) => kind === 'call' && name === 'transform' && true));
    assert.ok(records.some(([kind]) => kind === 'call'));
    assert.equal(typeof zoom.transform, 'function');
  });

  it('renders wedge and double bonds through the extracted draw helper', () => {
    const records = [];
    const container = new FakeSelection(records);
    const atomA = makeAtom('a1', 'C', 0, 0);
    const atomB = makeAtom('a2', 'C', 1, 0);
    atomA._neighbors = [atomB];
    atomB._neighbors = [atomA];
    const mol = {
      id: 'mol-draw',
      atoms: new Map([
        [atomA.id, atomA],
        [atomB.id, atomB]
      ]),
      getBond() {
        return null;
      }
    };
    const { helpers, state } = makeHelpersContext({ mol });
    state.mol = mol;
    state.hCounts = new Map();
    const toSVGPt = atom => ({ x: atom.x * 60, y: atom.y * 60 });

    helpers.drawBond(container, { properties: { order: 1 } }, atomA, atomB, mol, toSVGPt, 'wedge');
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'polygon'));

    const doubleRecords = [];
    const doubleContainer = new FakeSelection(doubleRecords);
    helpers.drawBond(doubleContainer, { properties: { order: 2 } }, atomA, atomB, mol, toSVGPt, null);
    assert.equal(
      doubleRecords.filter(([kind, tag]) => kind === 'append' && tag === 'line').length >= 2,
      true
    );
  });
});
