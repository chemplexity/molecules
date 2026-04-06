import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createForceSceneRenderer } from '../../../src/app/render/force-scene.js';

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

  filter() {
    return this;
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

  merge() {
    return this;
  }

  exit() {
    return this;
  }

  remove() {
    this.records.push(['remove']);
    return this;
  }

  datum() {
    return this;
  }
}

function makeSimulation(records) {
  const linkForce = {
    linksValue: [],
    links(value) {
      if (value !== undefined) {
        this.linksValue = value;
        records.push(['linkForce.links', value]);
        return this;
      }
      return this.linksValue;
    },
    strength() {
      records.push(['linkForce.strength']);
      return this;
    },
    distance() {
      records.push(['linkForce.distance']);
      return this;
    }
  };
  const chargeForce = {
    strength() {
      records.push(['chargeForce.strength']);
      return this;
    },
    distanceMax() {
      records.push(['chargeForce.distanceMax']);
      return this;
    }
  };
  const forceMap = {
    link: linkForce,
    charge: chargeForce
  };
  let nodesValue = [];
  let alphaValue = 0.6;
  return {
    nodes(value) {
      if (value !== undefined) {
        nodesValue = value;
        records.push(['simulation.nodes', value]);
        return this;
      }
      return nodesValue;
    },
    force(name, value) {
      if (arguments.length === 2) {
        forceMap[name] = value;
        records.push(['simulation.force.set', name]);
        return this;
      }
      records.push(['simulation.force.get', name]);
      return forceMap[name];
    },
    alpha(value) {
      if (value !== undefined) {
        alphaValue = value;
        records.push(['simulation.alpha.set', value]);
        return this;
      }
      return alphaValue;
    },
    restart() {
      records.push(['simulation.restart']);
      return this;
    },
    on(eventName, handler) {
      records.push(['simulation.on', eventName, typeof handler]);
      return this;
    }
  };
}

function makeRenderer({ preserveSelectionOnNextRender = false, hasHighlights = false, hasSelection = false, preserveView = false } = {}) {
  const records = [];
  const nodeRef = { id: 'svg-node' };
  const svg = new FakeSelection(records, nodeRef);
  const zoomTransform = function zoomTransform() {};
  const simulation = makeSimulation(records);
  const renderer = createForceSceneRenderer({
    d3: {
      zoomIdentity: { kind: 'identity' },
      zoomTransform: node => {
        records.push(['d3.zoomTransform', node]);
        return { x: 10, y: 20, k: 2 };
      }
    },
    svg,
    zoom: {
      transform: zoomTransform
    },
    g: new FakeSelection(records, nodeRef),
    plotEl: {
      clientWidth: 600,
      clientHeight: 400
    },
    simulation,
    constants: {
      bondOffset: 2,
      valenceWarningFill: 'rgba(0,0,0,0.1)',
      forceLayoutHeavyRepulsion: -100,
      forceLayoutHRepulsion: -40,
      forceLayoutInitialFitPad: 40,
      forceLayoutInitialHRadiusScale: 0.75,
      forceLayoutInitialZoomMultiplier: 0.9,
      forceLayoutInitialKeepInViewTicks: 10,
      forceLayoutFitPad: 40,
      forceLayoutKeepInViewAlphaMin: 0.05
    },
    state: {
      setActiveValenceWarningMap: map => {
        records.push(['setActiveValenceWarningMap', map.size]);
      },
      setForceAutoFitEnabled: value => {
        records.push(['setForceAutoFitEnabled', value]);
      },
      isForceAutoFitEnabled: () => !preserveView,
      enableKeepInView: ticks => {
        records.push(['enableKeepInView', ticks]);
      },
      disableKeepInView: () => {
        records.push(['disableKeepInView']);
      },
      isKeepInViewEnabled: () => false,
      getKeepInViewTicks: () => 0,
      setKeepInViewTicks: value => {
        records.push(['setKeepInViewTicks', value]);
      },
      getPreserveSelectionOnNextRender: () => preserveSelectionOnNextRender,
      setPreserveSelectionOnNextRender: value => {
        records.push(['setPreserveSelectionOnNextRender', value]);
      },
      syncSelectionToMolecule: mol => {
        records.push(['syncSelectionToMolecule', mol.id]);
      },
      clearSelection: () => {
        records.push(['clearSelection']);
      }
    },
    cache: {
      reset: () => {
        records.push(['cache.reset']);
      },
      setValenceWarningCircles: () => {
        records.push(['cache.setValenceWarningCircles']);
      },
      getValenceWarningCircles: () => null,
      getHighlightLines: () => null,
      getHighlightCircles: () => null,
      getSelectionLines: () => null,
      getSelectionCircles: () => null
    },
    helpers: {
      valenceWarningMapFor: () => new Map(),
      buildForceAnchorLayout: () => null,
      convertMolecule: () => ({ nodes: [], links: [] }),
      seedForceNodePositions: () => {
        records.push(['seedForceNodePositions']);
      },
      forceLinkDistance: () => 30,
      forceAnchorRadius: () => ({ kind: 'anchor' }),
      forceHydrogenRepulsion: () => ({ kind: 'hRepel' }),
      forceFitTransform: () => null,
      isHydrogenNode: node => node?.name === 'H',
      enLabelColor: () => '#000',
      renderReactionPreviewArrowForce: () => {
        records.push(['renderReactionPreviewArrowForce']);
      }
    },
    events: {
      handleForceBondClick: () => {},
      handleForceBondDblClick: () => {},
      handleForceBondMouseOver: () => {},
      handleForceBondMouseMove: () => {},
      handleForceBondMouseOut: () => {},
      handleForceAtomMouseDownDrawBond: () => {},
      handleForceAtomClick: () => {},
      handleForceAtomDblClick: () => {},
      handleForceAtomMouseOver: () => {},
      handleForceAtomMouseMove: () => {},
      handleForceAtomMouseOut: () => {}
    },
    drag: {
      createForceAtomDrag: () => () => {},
      createForceBondDrag: () => () => {}
    },
    callbacks: {
      hasHighlights: () => hasHighlights,
      hasSelection: () => hasSelection,
      applyForceHighlights: () => {
        records.push(['applyForceHighlights']);
      },
      applyForceSelection: () => {
        records.push(['applyForceSelection']);
      }
    }
  });

  return { renderer, records };
}

describe('createForceSceneRenderer', () => {
  it('preserves the current force viewport when asked and reapplies overlays', () => {
    const { renderer, records } = makeRenderer({
      preserveView: true,
      hasHighlights: true,
      hasSelection: true
    });

    renderer.updateForce({ id: 'mol-force', atoms: new Map(), bonds: new Map() }, { preserveView: true });

    assert.deepEqual(
      records.filter(entry => {
        if (['setForceAutoFitEnabled', 'disableKeepInView', 'd3.zoomTransform', 'applyForceHighlights', 'applyForceSelection'].includes(entry[0])) {
          return true;
        }
        return entry[0] === 'call' && entry[1] === 'zoomTransform';
      }),
      [
        ['setForceAutoFitEnabled', false],
        ['disableKeepInView'],
        ['d3.zoomTransform', { id: 'svg-node' }],
        ['call', 'zoomTransform', { x: 10, y: 20, k: 2 }],
        ['applyForceHighlights'],
        ['applyForceSelection']
      ]
    );
  });

  it('resets to identity and syncs selection state on a fresh force render', () => {
    const { renderer, records } = makeRenderer({
      preserveSelectionOnNextRender: true
    });

    renderer.updateForce({ id: 'mol-sync', atoms: new Map(), bonds: new Map() }, { preserveView: false });

    assert.deepEqual(
      records.filter(entry => {
        if (['setForceAutoFitEnabled', 'disableKeepInView', 'syncSelectionToMolecule', 'clearSelection', 'setPreserveSelectionOnNextRender'].includes(entry[0])) {
          return true;
        }
        return entry[0] === 'call' && entry[1] === 'zoomTransform';
      }),
      [
        ['setForceAutoFitEnabled', true],
        ['disableKeepInView'],
        ['syncSelectionToMolecule', 'mol-sync'],
        ['setPreserveSelectionOnNextRender', false],
        ['call', 'zoomTransform', { kind: 'identity' }]
      ]
    );
  });
});
