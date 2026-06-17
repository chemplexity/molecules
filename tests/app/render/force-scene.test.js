import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { createForceSceneRenderer } from '../../../src/app/render/force-scene.js';

class FakeSelection {
  constructor(records, nodeRef = {}, dataValue = []) {
    this.records = records;
    this.nodeRef = nodeRef;
    this.dataValue = dataValue;
  }

  node() {
    return this.nodeRef;
  }

  selectAll() {
    return new FakeSelection(this.records, this.nodeRef, this.dataValue);
  }

  data(value) {
    if (Array.isArray(value)) {
      this.dataValue = value;
    }
    return this;
  }

  enter() {
    return this;
  }

  append(tagName) {
    this.records.push(['append', tagName]);
    return new FakeSelection(this.records, this.nodeRef, this.dataValue);
  }

  insert(tagName) {
    this.records.push(['insert', tagName]);
    return new FakeSelection(this.records, this.nodeRef, this.dataValue);
  }

  filter() {
    return this;
  }

  attr(name, value) {
    if (['class', 'data-ring-fill-id', 'd', 'fill-rule', 'fill', 'fill-opacity', 'points', 'stroke'].includes(name)) {
      const resolved = typeof value === 'function' && this.dataValue.length > 0 ? this.dataValue.map(d => value(d)) : value;
      this.records.push(['attr', name, resolved]);
    }
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

function makeSimulation(records, initialNodes = []) {
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
  let nodesValue = initialNodes;
  let alphaValue = 0.6;
  const handlers = new Map();
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
    tick(iterations) {
      records.push(['simulation.tick', iterations]);
      return this;
    },
    on(eventName, handler) {
      handlers.set(eventName, handler);
      records.push(['simulation.on', eventName, typeof handler]);
      return this;
    },
    emit(eventName) {
      handlers.get(eventName)?.();
      return this;
    }
  };
}

function makeRenderer({
  preserveSelectionOnNextRender = false,
  hasHighlights = false,
  hasSelection = false,
  preserveView = false,
  generate2dCoords = () => {},
  alignReaction2dProductOrientation = () => {},
  convertMolecule = () => ({ nodes: [], links: [] }),
  initialSimulationNodes = [],
  seedForceNodePositions = null,
  forceFitTransform = () => null,
  zoomTransformsDiffer = () => true,
  isKeepInViewEnabled = () => false,
  getKeepInViewTicks = () => 0
} = {}) {
  const records = [];
  const seedForceNodePositionsImpl =
    seedForceNodePositions ??
    ((_graph, _molecule, anchorLayout) => {
      records.push(['seedForceNodePositions', anchorLayout]);
    });
  const nodeRef = { id: 'svg-node' };
  const svg = new FakeSelection(records, nodeRef);
  const zoomTransform = function zoomTransform() {};
  const simulation = makeSimulation(records, initialSimulationNodes);
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
      forceLayoutInitialSettleTicks: 7,
      forceLayoutInitialSettleAlpha: 0.7,
      forceLayoutInitialRestartAlpha: 0.08,
      forceLayoutEditRestartAlpha: 0.005,
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
      isKeepInViewEnabled,
      getKeepInViewTicks,
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
      buildForceAnchorLayout: () => {
        records.push(['buildForceAnchorLayout']);
        return null;
      },
      convertMolecule,
      seedForceNodePositions: seedForceNodePositionsImpl,
      forceLinkDistance: () => 30,
      forceAnchorRadius: () => ({ kind: 'anchor' }),
      forceHydrogenRepulsion: () => ({ kind: 'hRepel' }),
      forceHydrogenPlacement: links => ({ kind: 'hPlace', links }),
      patchForceNodePositions: (patchPos, options = {}) => {
        records.push(['patchForceNodePositions', patchPos, options]);
      },
      reseatHydrogensAroundPatched: (patchPos, options = {}) => {
        records.push(['reseatHydrogensAroundPatched', patchPos, options]);
      },
      reseatForceGraphHydrogens: (graph, options = {}) => {
        records.push(['reseatForceGraphHydrogens', graph, options]);
      },
      forceFitTransform,
      zoomTransformsDiffer,
      isHydrogenNode: node => node?.name === 'H',
      enLabelColor: () => '#000',
      renderReactionPreviewArrowForce: () => {
        records.push(['renderReactionPreviewArrowForce']);
      },
      generate2dCoords: mol => {
        generate2dCoords(mol);
      },
      alignReaction2dProductOrientation: mol => {
        alignReaction2dProductOrientation(mol);
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

  return { renderer, records, simulation };
}

/**
 * Creates a minimal six-coordinate cobalt complex for force-render tests.
 * @returns {object} Molecule-like object with clone, atoms, and bonds.
 */
function makeOctahedralForceSeedMolecule() {
  const bondIds = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];

  function buildAtoms() {
    return new Map([
      ['Co1', { id: 'Co1', name: 'Co', properties: { group: 9 }, bonds: [...bondIds] }],
      ['N1', { id: 'N1', name: 'N', properties: {}, bonds: ['b1'] }],
      ['N2', { id: 'N2', name: 'N', properties: {}, bonds: ['b2'] }],
      ['N3', { id: 'N3', name: 'N', properties: {}, bonds: ['b3'] }],
      ['N4', { id: 'N4', name: 'N', properties: {}, bonds: ['b4'] }],
      ['N5', { id: 'N5', name: 'N', properties: {}, bonds: ['b5'] }],
      ['N6', { id: 'N6', name: 'N', properties: {}, bonds: ['b6'] }]
    ]);
  }

  function buildBonds() {
    return new Map([
      ['b1', { id: 'b1', kind: 'covalent', properties: {}, atoms: ['Co1', 'N1'] }],
      ['b2', { id: 'b2', kind: 'covalent', properties: {}, atoms: ['Co1', 'N2'] }],
      ['b3', { id: 'b3', kind: 'covalent', properties: {}, atoms: ['Co1', 'N3'] }],
      ['b4', { id: 'b4', kind: 'covalent', properties: {}, atoms: ['Co1', 'N4'] }],
      ['b5', { id: 'b5', kind: 'covalent', properties: {}, atoms: ['Co1', 'N5'] }],
      ['b6', { id: 'b6', kind: 'covalent', properties: {}, atoms: ['Co1', 'N6'] }]
    ]);
  }

  return {
    id: 'octahedral-force-seed',
    atoms: buildAtoms(),
    bonds: buildBonds(),
    getChiralCenters() {
      return [];
    },
    hideHydrogens() {},
    clone() {
      return {
        id: 'octahedral-force-seed-clone',
        atoms: buildAtoms(),
        bonds: buildBonds(),
        getChiralCenters() {
          return [];
        },
        hideHydrogens() {},
        clone: this.clone
      };
    }
  };
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

  it('arms force keep-in-view after restoring a preserved viewport when requested', () => {
    const { renderer, records } = makeRenderer({
      preserveView: true
    });

    renderer.updateForce({ id: 'mol-force-clean', atoms: new Map(), bonds: new Map() }, { preserveView: true, keepInView: true });

    const restoreIndex = records.findIndex(entry => entry[0] === 'call' && entry[1] === 'zoomTransform' && entry[2]?.x === 10 && entry[2]?.y === 20 && entry[2]?.k === 2);
    const keepInViewIndex = records.findIndex(entry => entry[0] === 'enableKeepInView');

    assert.ok(restoreIndex >= 0);
    assert.ok(keepInViewIndex > restoreIndex);
    assert.deepEqual(records[keepInViewIndex], ['enableKeepInView', 10]);
  });

  it('fits the force viewport while keep-in-view is active even when zooming in', () => {
    const fitTransform = { x: 120, y: 90, k: 1.4 };
    const currentTransform = { x: 10, y: 20, k: 2 };
    const graph = {
      nodes: [
        { id: 'a1', name: 'C', protons: 6, x: 100, y: 100 },
        { id: 'a2', name: 'C', protons: 6, x: 140, y: 100 }
      ],
      links: []
    };
    const { renderer, records, simulation } = makeRenderer({
      preserveView: true,
      convertMolecule: () => graph,
      isKeepInViewEnabled: () => true,
      forceFitTransform: (nodes, pad) => {
        records.push(['forceFitTransform', nodes.map(node => node.id), pad]);
        return fitTransform;
      },
      zoomTransformsDiffer: (a, b) => {
        records.push(['zoomTransformsDiffer', a, b]);
        return true;
      }
    });

    renderer.updateForce({ id: 'mol-force-fit', atoms: new Map(), bonds: new Map() }, { preserveView: true, keepInView: true });
    records.length = 0;
    simulation.emit('tick');

    assert.deepEqual(records.filter(entry => entry[0] === 'forceFitTransform' || entry[0] === 'zoomTransformsDiffer' || (entry[0] === 'call' && entry[1] === 'zoomTransform')), [
      ['forceFitTransform', ['a1', 'a2'], 40],
      ['zoomTransformsDiffer', fitTransform, currentTransform],
      ['call', 'zoomTransform', fitTransform]
    ]);
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
      [['setForceAutoFitEnabled', true], ['disableKeepInView'], ['syncSelectionToMolecule', 'mol-sync'], ['setPreserveSelectionOnNextRender', false], ['call', 'zoomTransform', { kind: 'identity' }]]
    );
  });

  it('settles fresh force layouts invisibly before restarting gently', () => {
    const graph = {
      nodes: [{ id: 'c1', name: 'C', protons: 6, charge: 0 }],
      links: []
    };
    const { renderer, records } = makeRenderer({
      convertMolecule: () => graph
    });

    renderer.updateForce({ id: 'mol-settle', atoms: new Map(), bonds: new Map() });

    const settleAlphaIndex = records.findIndex(entry => entry[0] === 'simulation.alpha.set' && entry[1] === 0.7);
    const tickIndex = records.findIndex(entry => entry[0] === 'simulation.tick');
    const reseatIndex = records.findIndex(entry => entry[0] === 'reseatForceGraphHydrogens');
    const restartAlphaIndex = records.findIndex(entry => entry[0] === 'simulation.alpha.set' && entry[1] === 0.08);
    const restartIndex = records.findIndex(entry => entry[0] === 'simulation.restart');

    assert.ok(settleAlphaIndex >= 0);
    assert.ok(tickIndex > settleAlphaIndex);
    assert.ok(reseatIndex > tickIndex);
    assert.ok(restartAlphaIndex > reseatIndex);
    assert.ok(restartIndex > restartAlphaIndex);
    assert.deepEqual(records[tickIndex], ['simulation.tick', 7]);
    assert.deepEqual(records[reseatIndex], ['reseatForceGraphHydrogens', graph, { resetVelocity: true }]);
  });

  it('keeps preserved-position force updates from running the initial settle pass', () => {
    const { renderer, records } = makeRenderer();

    renderer.updateForce({ id: 'mol-preserve', atoms: new Map(), bonds: new Map() }, { preservePositions: true });

    assert.equal(records.some(entry => entry[0] === 'simulation.tick'), false);
    assert.equal(records.some(entry => entry[0] === 'reseatForceGraphHydrogens'), false);
    assert.ok(records.some(entry => entry[0] === 'simulation.alpha.set' && entry[1] === 0.005));
  });

  it('marks nonstandard force atom labels as auto-visible', () => {
    const molecule = parseSMILES('[Fe]C');
    const { renderer, records } = makeRenderer({
      preserveView: true,
      convertMolecule: () => ({
        nodes: [
          { id: 'Fe1', name: 'Fe', protons: 26, charge: 0, x: 10, y: 20 },
          { id: 'C2', name: 'C', protons: 6, charge: 0, x: 40, y: 20 }
        ],
        links: []
      })
    });

    renderer.updateForce(molecule, { preserveView: true });

    const atomSymbolClassRecord = records.find(
      entry => entry[0] === 'attr' && entry[1] === 'class' && Array.isArray(entry[2]) && entry[2].some(value => value.startsWith('atom-symbol'))
    );
    assert.deepEqual(atomSymbolClassRecord?.[2], ['atom-symbol force-auto-label', 'atom-symbol']);
  });

  it('skips chiral force stereo reseeding when reaction preview metadata allows it', () => {
    const molecule = {
      atoms: new Map([['__rxn_product__0:c1', { id: '__rxn_product__0:c1', name: 'C', protons: 6, bonds: [], properties: {} }]]),
      bonds: new Map(),
      __reactionPreview: {
        skipForceStereoSeed: true
      },
      getChiralCenters: () => ['__rxn_product__0:c1']
    };
    const { renderer, records } = makeRenderer({
      convertMolecule: () => ({
        nodes: [{ id: '__rxn_product__0:c1', name: 'C', protons: 6, charge: 0, x: 100, y: 100 }],
        links: []
      }),
      generate2dCoords: () => {
        records.push(['generate2dCoords']);
      }
    });

    renderer.updateForce(molecule, { preservePositions: true });

    assert.equal(records.some(entry => entry[0] === 'generate2dCoords'), false);
  });

  it('carries force hydrogen slot metadata through preserved-position edits', () => {
    const previousHydrogen = {
      id: 'h1',
      name: 'H',
      x: 12,
      y: 34,
      vx: 0.5,
      vy: -0.25,
      forcePlacementParentId: 'c1',
      forcePlacementAngle: Math.PI / 4
    };
    let capturedOptions = null;
    const { renderer } = makeRenderer({
      initialSimulationNodes: [{ id: 'c1', name: 'C', x: 10, y: 20 }, previousHydrogen],
      convertMolecule: () => ({
        nodes: [
          { id: 'c1', name: 'C', protons: 6, charge: 0 },
          { id: 'h1', name: 'H', protons: 1, charge: 0 }
        ],
        links: [{ id: 'b1', source: 0, target: 1, order: 1 }]
      }),
      seedForceNodePositions: (_graph, _molecule, _anchorLayout, options) => {
        capturedOptions = options;
      }
    });

    renderer.updateForce({ id: 'mol-ring-edit', atoms: new Map(), bonds: new Map() }, { preservePositions: true });

    const previous = capturedOptions?.previousNodePositions?.get('h1');
    assert.equal(previous?.forcePlacementParentId, 'c1');
    assert.equal(previous?.forcePlacementAngle, Math.PI / 4);
  });

  it('keeps force charge badges black on styled atoms', () => {
    const molecule = parseSMILES('[NH4+]');
    molecule.atoms.get('N1').setStyle({ color: '#3366ff', opacity: 0.55 });
    const { renderer, records } = makeRenderer({
      preserveView: true,
      convertMolecule: () => ({
        nodes: [{ id: 'N1', name: 'N', protons: 7, charge: 1, x: 20, y: 30 }],
        links: []
      })
    });

    renderer.updateForce(molecule, { preserveView: true });

    const ringClassIndex = records.findIndex(entry => entry[0] === 'attr' && entry[1] === 'class' && entry[2] === 'charge-label-ring');
    const textClassIndex = records.findIndex(entry => entry[0] === 'attr' && entry[1] === 'class' && entry[2] === 'charge-label-text');
    assert.ok(ringClassIndex >= 0, 'expected force charge badge ring');
    assert.ok(textClassIndex >= 0, 'expected force charge badge text');
    assert.deepEqual(records.find((entry, index) => index > ringClassIndex && entry[0] === 'attr' && entry[1] === 'stroke'), ['attr', 'stroke', '#111111']);
    assert.deepEqual(records.find((entry, index) => index > textClassIndex && entry[0] === 'attr' && entry[1] === 'fill'), ['attr', 'fill', '#111111']);
    assert.equal(records.some(entry => entry[0] === 'attr' && entry[1] === 'fill' && Array.isArray(entry[2]) && entry[2].includes('#3366ff')), true);
  });

  it('renders force ring fills behind force bonds', () => {
    const molecule = parseSMILES('C1CCCCC1');
    const ring = molecule.getRings()[0];
    molecule.setRingFill(ring, { color: '#ffe66d', opacity: 0.3 });
    const nodePositions = [
      { x: 10, y: 0 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 30 },
      { x: 0, y: 20 },
      { x: 0, y: 10 }
    ];
    const graphNodes = ring.map((id, index) => ({
      id,
      name: 'C',
      protons: 6,
      charge: 0,
      ...nodePositions[index]
    }));
    const { renderer, records } = makeRenderer({
      preserveView: true,
      convertMolecule: () => ({ nodes: graphNodes, links: [] })
    });

    renderer.updateForce(molecule, { preserveView: true });

    const fillClassIndex = records.findIndex(entry => entry[0] === 'attr' && entry[1] === 'class' && entry[2] === 'ring-fill force-ring-fill');
    const bondClassIndex = records.findIndex(entry => entry[0] === 'attr' && entry[1] === 'class' && entry[2] === 'link');
    const pathRecord = records.find(entry => entry[0] === 'attr' && entry[1] === 'd' && Array.isArray(entry[2]));
    const fillRuleRecord = records.find(entry => entry[0] === 'attr' && entry[1] === 'fill-rule' && entry[2] === 'evenodd');
    const ringFillIdRecord = records.find(entry => entry[0] === 'attr' && entry[1] === 'data-ring-fill-id' && Array.isArray(entry[2]));

    assert.ok(fillClassIndex >= 0);
    assert.ok(bondClassIndex >= 0);
    assert.ok(fillClassIndex < bondClassIndex);
    assert.ok(fillRuleRecord);
    assert.equal(ringFillIdRecord?.[2]?.[0], 'ring-fill:C1|C2|C3|C4|C5|C6');
    assert.equal(records.some(entry => entry[0] === 'attr' && entry[1] === 'fill' && entry[2]?.[0] === '#ffe66d'), true);
    assert.equal(records.some(entry => entry[0] === 'attr' && entry[1] === 'fill-opacity' && entry[2]?.[0] === 0.3), true);
    assert.equal(pathRecord[2][0], 'M 10,0 L 20,10 L 20,20 L 10,30 L 0,20 L 0,10 Z');
  });

  it('renders force macro-ring fills with smaller fused ring holes', () => {
    const molecule = parseSMILES('CCOCC1=C2CC(C1)COC1OC2C=C1');
    const macroRing = molecule.getRings().find(ringAtomIds => ringAtomIds.length === 8);
    molecule.setRingFill(macroRing, { color: '#ffe66d', opacity: 0.3 });
    const positions = new Map([
      ['C14', { x: 100, y: 0 }],
      ['O13', { x: 70, y: -40 }],
      ['C12', { x: 30, y: -40 }],
      ['O11', { x: 0, y: 0 }],
      ['C10', { x: 20, y: 80 }],
      ['C8', { x: 80, y: 90 }],
      ['C7', { x: 120, y: 70 }],
      ['C6', { x: 130, y: 20 }],
      ['C16', { x: 80, y: -10 }],
      ['C15', { x: 55, y: -20 }]
    ]);
    const graphNodes = [...new Set([...macroRing, 'C16', 'C15'])].map(id => ({
      id,
      name: 'C',
      protons: 6,
      charge: 0,
      ...positions.get(id)
    }));
    const { renderer, records } = makeRenderer({
      preserveView: true,
      convertMolecule: () => ({ nodes: graphNodes, links: [] })
    });

    renderer.updateForce(molecule, { preserveView: true });

    const pathRecord = records.find(entry => entry[0] === 'attr' && entry[1] === 'd' && Array.isArray(entry[2]));
    const fillRuleRecord = records.find(entry => entry[0] === 'attr' && entry[1] === 'fill-rule' && entry[2] === 'evenodd');
    assert.ok(pathRecord);
    assert.ok(fillRuleRecord);
    assert.equal((pathRecord[2][0].match(/M /g) ?? []).length, 2);
    assert.match(pathRecord[2][0], /M 80,-10 L 55,-20 L 100,0 L 70,-40 L 30,-40 Z/);
  });

  it('applies initial force patches before the first restarted tick', () => {
    const { renderer, records } = makeRenderer();
    const patchPos = new Map([['a1', { x: 120, y: 140 }]]);

    renderer.updateForce(
      { id: 'mol-patch', atoms: new Map(), bonds: new Map() },
      {
        preservePositions: true,
        initialPatchPos: patchPos
      }
    );

    const patchIndex = records.findIndex(entry => entry[0] === 'patchForceNodePositions');
    const reseatIndex = records.findIndex(entry => entry[0] === 'reseatHydrogensAroundPatched');
    const alphaIndex = records.findIndex(entry => entry[0] === 'simulation.alpha.set');
    const restartIndex = records.findIndex(entry => entry[0] === 'simulation.restart');

    assert.ok(patchIndex >= 0);
    assert.ok(reseatIndex >= 0);
    assert.ok(alphaIndex >= 0);
    assert.ok(restartIndex >= 0);
    assert.ok(patchIndex < alphaIndex);
    assert.ok(reseatIndex < alphaIndex);
    assert.ok(alphaIndex < restartIndex);
    assert.deepEqual(records[patchIndex], ['patchForceNodePositions', patchPos, { alpha: 0, restart: false }]);
    assert.deepEqual(records[reseatIndex], ['reseatHydrogensAroundPatched', patchPos, { resetVelocity: true }]);
  });

  it('keeps converter-seeded force renders from running the full fresh settle pass', () => {
    const { renderer, records } = makeRenderer();
    const patchPos = new Map([['a1', { x: 120, y: 140 }]]);

    renderer.updateForce(
      { id: 'mol-converted-patch', atoms: new Map(), bonds: new Map() },
      {
        initialPatchPos: patchPos
      }
    );

    assert.equal(records.some(entry => entry[0] === 'simulation.tick'), false);
    assert.equal(records.some(entry => entry[0] === 'reseatForceGraphHydrogens'), false);
    assert.ok(records.some(entry => entry[0] === 'simulation.alpha.set' && entry[1] === 0.005));
  });

  it('honors a provided force anchor layout instead of regenerating one', () => {
    const { renderer, records } = makeRenderer();
    const anchorLayout = new Map([['a1', { x: 0, y: 0 }]]);

    renderer.updateForce(
      { id: 'mol-anchor', atoms: new Map(), bonds: new Map() },
      {
        preserveView: true,
        anchorLayout
      }
    );

    assert.deepEqual(
      records.find(entry => entry[0] === 'seedForceNodePositions'),
      ['seedForceNodePositions', anchorLayout]
    );
    assert.equal(
      records.some(entry => entry[0] === 'buildForceAnchorLayout'),
      false
    );
  });

  it('seeds missing projected organometallic display hints on the first force render', () => {
    const molecule = makeOctahedralForceSeedMolecule();
    const { renderer } = makeRenderer({
      generate2dCoords: seededMol => {
        seededMol.bonds.get('b1').properties.display = { as: 'dash', centerId: 'Co1' };
        seededMol.bonds.get('b2').properties.display = { as: 'wedge', centerId: 'Co1' };
        seededMol.bonds.get('b4').properties.display = { as: 'wedge', centerId: 'Co1' };
        seededMol.bonds.get('b5').properties.display = { as: 'dash', centerId: 'Co1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    assert.deepEqual(molecule.bonds.get('b1').properties.display, { as: 'dash', centerId: 'Co1' });
    assert.deepEqual(molecule.bonds.get('b2').properties.display, { as: 'wedge', centerId: 'Co1' });
    assert.equal(molecule.bonds.get('b3').properties.display, undefined);
    assert.deepEqual(molecule.bonds.get('b4').properties.display, { as: 'wedge', centerId: 'Co1' });
    assert.deepEqual(molecule.bonds.get('b5').properties.display, { as: 'dash', centerId: 'Co1' });
    assert.equal(molecule.bonds.get('b6').properties.display, undefined);
  });

  it('repairs incomplete projected organometallic display hints instead of keeping a lone wedge', () => {
    const molecule = makeOctahedralForceSeedMolecule();
    molecule.bonds.get('b1').properties.display = { as: 'wedge', centerId: 'Co1' };
    const { renderer } = makeRenderer({
      generate2dCoords: seededMol => {
        seededMol.bonds.get('b1').properties.display = { as: 'dash', centerId: 'Co1' };
        seededMol.bonds.get('b2').properties.display = { as: 'wedge', centerId: 'Co1' };
        seededMol.bonds.get('b4').properties.display = { as: 'wedge', centerId: 'Co1' };
        seededMol.bonds.get('b5').properties.display = { as: 'dash', centerId: 'Co1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    assert.deepEqual(molecule.bonds.get('b1').properties.display, { as: 'dash', centerId: 'Co1' });
    assert.deepEqual(molecule.bonds.get('b2').properties.display, { as: 'wedge', centerId: 'Co1' });
    assert.deepEqual(molecule.bonds.get('b4').properties.display, { as: 'wedge', centerId: 'Co1' });
    assert.deepEqual(molecule.bonds.get('b5').properties.display, { as: 'dash', centerId: 'Co1' });
  });

  it('seeds projected organometallic display hints for real parsed bonds that expose kind via properties', () => {
    const molecule = parseSMILES('[Co+3](N)(N)(N)(N)(N)N');
    const { renderer } = makeRenderer({
      generate2dCoords: seededMol => {
        const coordinationBonds = [...seededMol.bonds.values()].filter(bond => bond.atoms.includes('Co1') && !bond.atoms.some(atomId => atomId.startsWith('H')));
        coordinationBonds[0].properties.display = { as: 'dash', centerId: 'Co1' };
        coordinationBonds[1].properties.display = { as: 'wedge', centerId: 'Co1' };
        coordinationBonds[3].properties.display = { as: 'wedge', centerId: 'Co1' };
        coordinationBonds[4].properties.display = { as: 'dash', centerId: 'Co1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    const displayAssignments = [...molecule.bonds.values()]
      .filter(bond => bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
      .map(bond => bond.properties.display.as)
      .sort();
    assert.deepEqual(displayAssignments, ['dash', 'dash', 'wedge', 'wedge']);
  });

  it('seeds projected trigonal-bipyramidal display hints for five-coordinate iron centers in force mode', () => {
    const molecule = parseSMILES('[Fe](Cl)(Cl)(Cl)(Cl)Cl');
    const { renderer } = makeRenderer({
      generate2dCoords: seededMol => {
        const coordinationBonds = [...seededMol.bonds.values()].filter(bond => bond.atoms.includes('Fe1') && !bond.atoms.some(atomId => atomId.startsWith('H')));
        coordinationBonds[3].properties.display = { as: 'dash', centerId: 'Fe1' };
        coordinationBonds[4].properties.display = { as: 'wedge', centerId: 'Fe1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    const displayAssignments = [...molecule.bonds.values()]
      .filter(bond => bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
      .map(bond => bond.properties.display.as)
      .sort();
    assert.deepEqual(displayAssignments, ['dash', 'wedge']);
  });

  it('seeds projected square-pyramidal display hints for five-coordinate rhodium centers in force mode', () => {
    const molecule = parseSMILES('[Rh](Cl)(Cl)(Cl)(Cl)Cl');
    const { renderer } = makeRenderer({
      generate2dCoords: seededMol => {
        const coordinationBonds = [...seededMol.bonds.values()].filter(bond => bond.atoms.includes('Rh1') && !bond.atoms.some(atomId => atomId.startsWith('H')));
        coordinationBonds[1].properties.display = { as: 'dash', centerId: 'Rh1' };
        coordinationBonds[2].properties.display = { as: 'wedge', centerId: 'Rh1' };
        coordinationBonds[3].properties.display = { as: 'wedge', centerId: 'Rh1' };
        coordinationBonds[4].properties.display = { as: 'dash', centerId: 'Rh1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    const displayAssignments = [...molecule.bonds.values()]
      .filter(bond => bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
      .map(bond => bond.properties.display.as)
      .sort();
    assert.deepEqual(displayAssignments, ['dash', 'dash', 'wedge', 'wedge']);
  });
});
