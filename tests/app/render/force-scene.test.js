import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
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

function makeRenderer({
  preserveSelectionOnNextRender = false,
  hasHighlights = false,
  hasSelection = false,
  preserveView = false,
  generateAndRefine2dCoords = () => {},
  alignReaction2dProductOrientation = () => {}
} = {}) {
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
      buildForceAnchorLayout: () => {
        records.push(['buildForceAnchorLayout']);
        return null;
      },
      convertMolecule: () => ({ nodes: [], links: [] }),
      seedForceNodePositions: (_graph, _molecule, anchorLayout) => {
        records.push(['seedForceNodePositions', anchorLayout]);
      },
      forceLinkDistance: () => 30,
      forceAnchorRadius: () => ({ kind: 'anchor' }),
      forceHydrogenRepulsion: () => ({ kind: 'hRepel' }),
      patchForceNodePositions: (patchPos, options = {}) => {
        records.push(['patchForceNodePositions', patchPos, options]);
      },
      reseatHydrogensAroundPatched: (patchPos, options = {}) => {
        records.push(['reseatHydrogensAroundPatched', patchPos, options]);
      },
      forceFitTransform: () => null,
      isHydrogenNode: node => node?.name === 'H',
      enLabelColor: () => '#000',
      renderReactionPreviewArrowForce: () => {
        records.push(['renderReactionPreviewArrowForce']);
      },
      generateAndRefine2dCoords: mol => {
        generateAndRefine2dCoords(mol);
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

  return { renderer, records };
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

  it('applies initial force patches before the first restarted tick', () => {
    const { renderer, records } = makeRenderer();
    const patchPos = new Map([['a1', { x: 120, y: 140 }]]);

    renderer.updateForce({ id: 'mol-patch', atoms: new Map(), bonds: new Map() }, {
      preservePositions: true,
      initialPatchPos: patchPos
    });

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

  it('honors a provided force anchor layout instead of regenerating one', () => {
    const { renderer, records } = makeRenderer();
    const anchorLayout = new Map([['a1', { x: 0, y: 0 }]]);

    renderer.updateForce({ id: 'mol-anchor', atoms: new Map(), bonds: new Map() }, {
      preserveView: true,
      anchorLayout
    });

    assert.deepEqual(
      records.find(entry => entry[0] === 'seedForceNodePositions'),
      ['seedForceNodePositions', anchorLayout]
    );
    assert.equal(records.some(entry => entry[0] === 'buildForceAnchorLayout'), false);
  });

  it('seeds missing projected organometallic display hints on the first force render', () => {
    const molecule = makeOctahedralForceSeedMolecule();
    const { renderer } = makeRenderer({
      generateAndRefine2dCoords: seededMol => {
        seededMol.bonds.get('b1').properties.display = { as: 'wedge', centerId: 'Co1' };
        seededMol.bonds.get('b2').properties.display = { as: 'dash', centerId: 'Co1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    assert.deepEqual(molecule.bonds.get('b1').properties.display, { as: 'wedge', centerId: 'Co1' });
    assert.deepEqual(molecule.bonds.get('b2').properties.display, { as: 'dash', centerId: 'Co1' });
    assert.equal(molecule.bonds.get('b3').properties.display, undefined);
  });

  it('repairs incomplete projected organometallic display hints instead of keeping a lone wedge', () => {
    const molecule = makeOctahedralForceSeedMolecule();
    molecule.bonds.get('b1').properties.display = { as: 'wedge', centerId: 'Co1' };
    const { renderer } = makeRenderer({
      generateAndRefine2dCoords: seededMol => {
        seededMol.bonds.get('b1').properties.display = { as: 'wedge', centerId: 'Co1' };
        seededMol.bonds.get('b2').properties.display = { as: 'dash', centerId: 'Co1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    assert.deepEqual(molecule.bonds.get('b1').properties.display, { as: 'wedge', centerId: 'Co1' });
    assert.deepEqual(molecule.bonds.get('b2').properties.display, { as: 'dash', centerId: 'Co1' });
  });

  it('seeds projected organometallic display hints for real parsed bonds that expose kind via properties', () => {
    const molecule = parseSMILES('[Co+3](N)(N)(N)(N)(N)N');
    const { renderer } = makeRenderer({
      generateAndRefine2dCoords: seededMol => {
        const coordinationBonds = [...seededMol.bonds.values()].filter(bond => bond.atoms.includes('Co1') && !bond.atoms.some(atomId => atomId.startsWith('H')));
        coordinationBonds[0].properties.display = { as: 'wedge', centerId: 'Co1' };
        coordinationBonds[1].properties.display = { as: 'dash', centerId: 'Co1' };
      }
    });

    renderer.updateForce(molecule, { preserveView: false });

    const displayAssignments = [...molecule.bonds.values()]
      .filter(bond => bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
      .map(bond => bond.properties.display.as)
      .sort();
    assert.deepEqual(displayAssignments, ['dash', 'wedge']);
  });
});
