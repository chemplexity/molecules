import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createTwoDSceneRenderer } from '../../src/app/render/scene-2d.js';

class FakeSelection {
  constructor(records, nodeRef = {}) {
    this.records = records;
    this.nodeRef = nodeRef;
  }

  node() {
    return this.nodeRef;
  }

  selectAll() {
    return new FakeSelection(this.records, this.nodeRef);
  }

  select() {
    return new FakeSelection(this.records, this.nodeRef);
  }

  data() {
    return this;
  }

  enter() {
    return this;
  }

  append() {
    return new FakeSelection(this.records, this.nodeRef);
  }

  insert() {
    return new FakeSelection(this.records, this.nodeRef);
  }

  attr() {
    return this;
  }

  style() {
    return this;
  }

  on() {
    return this;
  }

  call(fn, ...args) {
    this.records.push(['call', fn?.name ?? 'anonymous', ...args]);
    if (typeof fn === 'function') {
      fn(this, ...args);
    }
    return this;
  }

  text() {
    return this;
  }

  remove() {
    this.records.push(['remove']);
    return this;
  }

  raise() {
    return this;
  }
}

function makeAtom(id, x, y) {
  return {
    id,
    name: 'C',
    x,
    y,
    visible: true,
    getNeighbors() {
      return [];
    },
    getCharge() {
      return 0;
    },
    getChirality() {
      return null;
    }
  };
}

function makeRenderer({ preserveSelectionOnNextRender = false } = {}) {
  const records = [];
  const nodeRef = { id: 'svg-node' };
  const svg = new FakeSelection(records, nodeRef);
  const g = new FakeSelection(records, nodeRef);
  const state = {
    mol: null,
    hCounts: null,
    cx: 0,
    cy: 0,
    stereoMap: null,
    preserveSelectionOnNextRender
  };
  const zoomTransform = function zoomTransform() {};
  const zoomIdentity = {
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
  const renderer = createTwoDSceneRenderer({
    d3: {
      zoomIdentity,
      pointer: () => [0, 0]
    },
    svg,
    zoom: {
      transform: zoomTransform
    },
    g,
    plotEl: {
      clientWidth: 600,
      clientHeight: 400
    },
    constants: {
      scale: 60,
      getFontSize: () => 14,
      valenceWarningFill: 'rgba(0,0,0,0.1)'
    },
    state: {
      getMol: () => state.mol,
      getHCounts: () => state.hCounts,
      getStereoMap: () => state.stereoMap,
      setScene: ({ mol, hCounts, cx, cy, stereoMap }) => {
        state.mol = mol;
        state.hCounts = hCounts;
        state.cx = cx;
        state.cy = cy;
        state.stereoMap = stereoMap;
        records.push(['setScene', mol.id, cx, cy]);
      },
      setCenter: (cx, cy) => {
        state.cx = cx;
        state.cy = cy;
        records.push(['setCenter', cx, cy]);
      },
      setActiveValenceWarningMap: map => {
        records.push(['setActiveValenceWarningMap', map.size]);
      },
      getPreserveSelectionOnNextRender: () => state.preserveSelectionOnNextRender,
      setPreserveSelectionOnNextRender: value => {
        state.preserveSelectionOnNextRender = value;
        records.push(['setPreserveSelectionOnNextRender', value]);
      }
    },
    cache: {
      reset: () => {
        records.push(['cache.reset']);
      }
    },
    selection: {
      syncSelectionToMolecule: mol => {
        records.push(['syncSelectionToMolecule', mol.id]);
      },
      clearSelection: () => {
        records.push(['clearSelection']);
      }
    },
    overlay: {
      getDrawBondMode: () => false
    },
    helpers: {
      valenceWarningMapFor: () => new Map(),
      toSVGPt: atom => ({
        x: 300 + (atom.x - state.cx) * 60,
        y: 200 - (atom.y - state.cy) * 60
      }),
      secondaryDir: () => 1,
      getSelectedDragAtomIds: () => null,
      drawBond: () => {
        records.push(['drawBond']);
      },
      redrawHighlights: () => {
        records.push(['redrawHighlights']);
      },
      redrawSelection: () => {
        records.push(['redrawSelection']);
      },
      generateAndRefine2dCoords: () => {
        records.push(['generateAndRefine2dCoords']);
      },
      alignReaction2dProductOrientation: () => {},
      spreadReaction2dProductComponents: () => {},
      centerReaction2dPairCoords: () => {},
      drawReactionPreviewArrow2d: () => {
        records.push(['drawReactionPreviewArrow2d']);
      },
      viewportFitPadding: pad => ({ left: pad, right: pad, top: pad, bottom: pad }),
      hasReactionPreview: () => false,
      enLabelColor: () => '#000'
    },
    events: {
      handle2dBondClick: () => {},
      handle2dBondDblClick: () => {},
      handle2dBondMouseOver: () => {},
      handle2dBondMouseMove: () => {},
      handle2dBondMouseOut: () => {},
      handle2dAtomMouseDownDrawBond: () => {},
      handle2dAtomClick: () => {},
      handle2dAtomDblClick: () => {},
      handle2dAtomMouseOver: () => {},
      handle2dAtomMouseMove: () => {},
      handle2dAtomMouseOut: () => {}
    },
    drag: {
      create2dBondDrag: () => () => {},
      create2dAtomDrag: () => () => {}
    },
    actions: {
      promoteBondOrder: () => {}
    },
    view: {
      getOrientation: () => ({ rotationDeg: 0, flipH: false, flipV: false })
    },
    analysis: {
      updateFormula: mol => {
        records.push(['updateFormula', mol.id]);
      },
      updateDescriptors: mol => {
        records.push(['updateDescriptors', mol.id]);
      },
      updatePanels: (mol, options) => {
        records.push(['updatePanels', mol.id, options]);
      }
    }
  });

  return { renderer, records, state };
}

describe('createTwoDSceneRenderer', () => {
  it('renders a 2D scene, updates state, and clears selection by default', () => {
    const { renderer, records, state } = makeRenderer();
    const atom = makeAtom('a1', 0, 0);
    const mol = {
      id: 'mol-2d',
      atoms: new Map([[atom.id, atom]]),
      bonds: new Map(),
      hideHydrogens() {},
      getChiralCenters() {
        return [];
      }
    };

    renderer.render2d(mol);

    assert.equal(state.mol, mol);
    assert.equal(state.cx, 0);
    assert.equal(state.cy, 0);
    assert.deepEqual(
      records.filter(entry => ['generateAndRefine2dCoords', 'setScene', 'clearSelection', 'setPreserveSelectionOnNextRender', 'updateFormula', 'updateDescriptors'].includes(entry[0]) || (entry[0] === 'call' && entry[1] === 'zoomTransform')),
      [
        ['generateAndRefine2dCoords'],
        ['call', 'zoomTransform', { x: 0, y: 0, k: 1 }],
        ['setScene', 'mol-2d', 0, 0],
        ['clearSelection'],
        ['setPreserveSelectionOnNextRender', false],
        ['updateFormula', 'mol-2d'],
        ['updateDescriptors', 'mol-2d']
      ]
    );
  });

  it('syncs selection and can refit the current 2D view', () => {
    const { renderer, records, state } = makeRenderer({ preserveSelectionOnNextRender: true });
    const atom = makeAtom('a1', 1, -1);
    const mol = {
      id: 'mol-refit',
      atoms: new Map([[atom.id, atom]]),
      bonds: new Map(),
      hideHydrogens() {},
      getChiralCenters() {
        return [];
      }
    };

    renderer.render2d(mol);
    renderer.fitCurrent2dView();

    assert.equal(state.mol, mol);
    assert.deepEqual(
      records.filter(entry => ['syncSelectionToMolecule', 'setCenter'].includes(entry[0]) || (entry[0] === 'call' && entry[1] === 'zoomTransform')),
      [
        ['call', 'zoomTransform', { x: 0, y: 0, k: 1 }],
        ['syncSelectionToMolecule', 'mol-refit'],
        ['setCenter', 1, -1],
        ['call', 'zoomTransform', { x: 0, y: 0, k: 1 }]
      ]
    );
  });
});
