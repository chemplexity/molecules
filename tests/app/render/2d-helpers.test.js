import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { create2DRenderHelpers } from '../../../src/app/render/2d-helpers.js';
import { getAtomLabel, labelHalfH, labelHalfW, labelTextOffset } from '../../../src/layout/mol2d-helpers.js';

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

function shortenLine(x1, y1, x2, y2, d1, d2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: x1 + ux * d1,
    y1: y1 + uy * d1,
    x2: x2 - ux * d2,
    y2: y2 - uy * d2
  };
}

function computeLabelClearance(atom, otherSVGPt, toSVGPt, hCounts, mol, fontSize = 14) {
  const label = getAtomLabel(atom, hCounts, toSVGPt, mol);
  if (!label) {
    return 0;
  }

  const { x, y } = toSVGPt(atom);
  const dx = otherSVGPt.x - x;
  const dy = otherSVGPt.y - y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = labelTextOffset(label, fontSize);
  const hw = labelHalfW(label, fontSize) + 1;
  const hh = labelHalfH(label, fontSize) + 1;
  const dirX = dx / len;
  const dirY = dy / len;
  const candidates = [];

  if (Math.abs(dirX) > 1e-9) {
    candidates.push((cx + hw) / dirX, (cx - hw) / dirX);
  }
  if (Math.abs(dirY) > 1e-9) {
    candidates.push(hh / dirY, -hh / dirY);
  }

  let best = Infinity;
  for (const t of candidates) {
    if (!(t > 0)) {
      continue;
    }
    const px = dirX * t;
    const py = dirY * t;
    if (px < cx - hw - 1e-6 || px > cx + hw + 1e-6) {
      continue;
    }
    if (py < -hh - 1e-6 || py > hh + 1e-6) {
      continue;
    }
    best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : Math.max(hw, hh);
}

function extractLines(records) {
  const lines = [];
  let current = null;
  for (const [kind, name, value] of records) {
    if (kind === 'append' && name === 'line') {
      current = {};
      lines.push(current);
      continue;
    }
    if (kind === 'attr' && current && (name === 'x1' || name === 'y1' || name === 'x2' || name === 'y2')) {
      current[name] = value;
    }
  }
  return lines;
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
    const bond = {
      id: 'bond-1',
      getAtomObjects() {
        return [carbon, hydrogen];
      }
    };
    carbon._neighbors = [hydrogen];
    hydrogen._neighbors = [carbon];
    const mol = {
      id: 'mol-sync',
      atoms: new Map([
        [carbon.id, carbon],
        [hydrogen.id, hydrogen]
      ]),
      bonds: new Map([[bond.id, bond]]),
      hideHydrogens() {
        hydrogen.visible = false;
      }
    };
    const stereoMap = new Map([['bond-1', 'wedge']]);
    const { helpers, state, records } = makeHelpersContext({ mol, stereoMap });

    helpers.sync2dDerivedState(mol);

    assert.ok(state.derived);
    assert.equal(state.derived.hCounts.get('c1'), 1);
    assert.equal(state.derived.stereoMap, stereoMap);
    assert.equal(hydrogen.visible, true);
    assert.ok(records.some(([kind, molId]) => kind === 'pickStereoMap' && molId === 'mol-sync'));
  });

  it('rehides a stale visible stereo hydrogen when the derived stereo map no longer includes its bond', () => {
    const carbon = makeAtom('c1', 'C', 0, 0);
    const hydrogen = makeAtom('h1', 'H', 0, 0);
    const bond = {
      id: 'bond-1',
      getAtomObjects() {
        return [carbon, hydrogen];
      }
    };
    carbon._neighbors = [hydrogen];
    hydrogen._neighbors = [carbon];
    hydrogen.visible = true;
    const mol = {
      id: 'mol-hide-h',
      atoms: new Map([
        [carbon.id, carbon],
        [hydrogen.id, hydrogen]
      ]),
      bonds: new Map([[bond.id, bond]])
    };
    const { helpers, state } = makeHelpersContext({ mol, stereoMap: new Map() });

    helpers.sync2dDerivedState(mol);

    assert.ok(state.derived);
    assert.equal(state.derived.hCounts.get('c1'), 1);
    assert.equal(hydrogen.visible, false);
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
    const wedgePoints = records.find(([kind, name]) => kind === 'attr' && name === 'points')?.[2];
    assert.ok(wedgePoints, 'expected wedge points attribute');
    const [tipPoint] = wedgePoints.split(' ');
    const [tipX, tipY] = tipPoint.split(',').map(Number);
    assert.ok(tipX > 0, 'expected wedge tip to be trimmed slightly away from the source atom');
    assert.equal(tipY, 0);

    const doubleRecords = [];
    const doubleContainer = new FakeSelection(doubleRecords);
    helpers.drawBond(doubleContainer, { properties: { order: 2 } }, atomA, atomB, mol, toSVGPt, null);
    assert.equal(doubleRecords.filter(([kind, tag]) => kind === 'append' && tag === 'line').length >= 2, true);
  });

  it('moves the wedge tip clear of a labeled source atom', () => {
    const unlabeledRecords = [];
    const unlabeledContainer = new FakeSelection(unlabeledRecords);
    const unlabeledSource = makeAtom('c1', 'C', 0, 0);
    const target = makeAtom('c2', 'C', 1, 0);
    unlabeledSource._neighbors = [target];
    target._neighbors = [unlabeledSource];
    const unlabeledMol = {
      atoms: new Map([
        [unlabeledSource.id, unlabeledSource],
        [target.id, target]
      ]),
      getBond() {
        return null;
      }
    };
    const { helpers: unlabeledHelpers, state: unlabeledState } = makeHelpersContext({ mol: unlabeledMol });
    unlabeledState.mol = unlabeledMol;
    const toSVGPt = atom => ({ x: atom.x * 60, y: atom.y * 60 });
    unlabeledHelpers.drawBond(unlabeledContainer, { properties: { order: 1 } }, unlabeledSource, target, unlabeledMol, toSVGPt, 'wedge');
    const unlabeledPoints = unlabeledRecords.find(([kind, name]) => kind === 'attr' && name === 'points')?.[2];
    assert.ok(unlabeledPoints, 'expected wedge points for unlabeled source');
    const [unlabeledTipX] = unlabeledPoints.split(' ')[0].split(',').map(Number);

    const labeledRecords = [];
    const labeledContainer = new FakeSelection(labeledRecords);
    const labeledSource = makeAtom('o1', 'O', 0, 0);
    labeledSource._neighbors = [target];
    target._neighbors = [labeledSource];
    const labeledMol = {
      atoms: new Map([
        [labeledSource.id, labeledSource],
        [target.id, target]
      ]),
      getBond() {
        return null;
      }
    };
    const { helpers: labeledHelpers, state: labeledState } = makeHelpersContext({ mol: labeledMol });
    labeledState.mol = labeledMol;
    labeledHelpers.drawBond(labeledContainer, { properties: { order: 1 } }, labeledSource, target, labeledMol, toSVGPt, 'wedge');
    const labeledPoints = labeledRecords.find(([kind, name]) => kind === 'attr' && name === 'points')?.[2];
    assert.ok(labeledPoints, 'expected wedge points for labeled source');
    const [labeledTipX] = labeledPoints.split(' ')[0].split(',').map(Number);

    assert.ok(labeledTipX > unlabeledTipX + 6, 'expected labeled source wedge tip to clear the source label');
  });

  it('centers diagonal double bonds on heteroatom labels using the shifted parallel line clearance', () => {
    const records = [];
    const container = new FakeSelection(records);
    const carbon = makeAtom('c1', 'C', 0, 0);
    const oxygen = makeAtom('o1', 'O', 1, 1);
    carbon._neighbors = [oxygen];
    oxygen._neighbors = [carbon];
    const mol = {
      id: 'mol-diagonal-carbonyl',
      atoms: new Map([
        [carbon.id, carbon],
        [oxygen.id, oxygen]
      ]),
      getBond() {
        return null;
      }
    };

    const customContext = create2DRenderHelpers({
      d3: {
        zoomIdentity: makeZoomIdentity(),
        zoomTransform: () => ({
          applyX: value => value,
          applyY: value => value
        })
      },
      svg: new FakeSelection([]),
      zoom: {
        transform: function transform() {}
      },
      plotEl: {
        clientWidth: 600,
        clientHeight: 400
      },
      state: {
        getMol: () => mol,
        getHCounts: () => new Map(),
        getCenterX: () => 0,
        getCenterY: () => 0,
        setDerivedState() {}
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
        shortenLine,
        secondaryDir: () => 1
      },
      stereo: {
        pickStereoMap: () => new Map()
      }
    });

    const toSVGPt = atom => ({ x: atom.x * 60, y: atom.y * 60 });
    customContext.drawBond(container, { properties: { order: 2 } }, carbon, oxygen, mol, toSVGPt, null);

    const lines = extractLines(records);
    assert.equal(lines.length, 2);

    const start = toSVGPt(carbon);
    const end = toSVGPt(oxygen);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const shiftedStart = { x: start.x + nx * 7, y: start.y + ny * 7 };
    const shiftedEnd = { x: end.x + nx * 7, y: end.y + ny * 7 };
    const expectedSecondary = shortenLine(
      shiftedStart.x,
      shiftedStart.y,
      shiftedEnd.x,
      shiftedEnd.y,
      Math.max(computeLabelClearance(carbon, shiftedEnd, toSVGPt, new Map(), mol), 4),
      Math.max(computeLabelClearance(oxygen, shiftedStart, toSVGPt, new Map(), mol), 4)
    );

    assert.ok(Math.abs(lines[1].x1 - expectedSecondary.x1) < 1e-6);
    assert.ok(Math.abs(lines[1].y1 - expectedSecondary.y1) < 1e-6);
    assert.ok(Math.abs(lines[1].x2 - expectedSecondary.x2) < 1e-6);
    assert.ok(Math.abs(lines[1].y2 - expectedSecondary.y2) < 1e-6);
  });

  it('trims bond endpoints farther for subscripted NH2 labels so downward bonds clear the rendered text', () => {
    const records = [];
    const container = new FakeSelection(records);
    const nitrogen = makeAtom('n1', 'N', 0, 0);
    const carbon = makeAtom('c1', 'C', 0, 100);
    nitrogen.getCharge = () => 1;
    nitrogen._neighbors = [carbon];
    carbon._neighbors = [nitrogen];
    const mol = {
      id: 'mol-ammonium-label',
      atoms: new Map([
        [nitrogen.id, nitrogen],
        [carbon.id, carbon]
      ]),
      getBond() {
        return null;
      }
    };
    const helpers = create2DRenderHelpers({
      d3: {
        zoomIdentity: makeZoomIdentity(),
        zoomTransform: () => ({
          applyX: value => value,
          applyY: value => value
        })
      },
      svg: new FakeSelection([]),
      zoom: {
        transform: function transform() {}
      },
      plotEl: {
        clientWidth: 600,
        clientHeight: 400
      },
      state: {
        getMol: () => mol,
        getHCounts: () => new Map([[nitrogen.id, 2]]),
        getCenterX: () => 0,
        getCenterY: () => 0,
        setDerivedState() {}
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
        shortenLine,
        secondaryDir: () => 1
      },
      stereo: {
        pickStereoMap: () => new Map()
      }
    });
    const toSVGPt = atom => ({ x: atom.x, y: atom.y });

    helpers.drawBond(container, { properties: { order: 1 } }, nitrogen, carbon, mol, toSVGPt, null);

    const lines = extractLines(records);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].y1 >= 12.4, `expected downward bond to clear the NH2 subscript descent, got ${lines[0].y1}`);
  });
});
