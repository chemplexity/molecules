import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { create2DSceneRenderer } from '../../../src/app/render/scene-2d.js';
import { applyCoords } from '../../../src/layout/engine/apply.js';
import { generateCoords } from '../../../src/layout/engine/api.js';
import { syncDisplayStereo } from '../../../src/layout/mol2d-helpers.js';

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

function makeRenderer({ preserveSelectionOnNextRender = false, helperOverrides = {}, dragOverrides = {} } = {}) {
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
  const renderer = create2DSceneRenderer({
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
      generate2dCoords: () => {
        records.push(['generate2dCoords']);
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
      enLabelColor: () => '#000',
      ...helperOverrides
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
      create2dAtomDrag: () => () => {},
      ...dragOverrides
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

function createStereoHydrogenOffsetRecorder() {
  const offsets = [];
  return {
    offsets,
    helperOverrides: {
      drawBond: (_container, _bond, atom1, atom2, mol, toSVGPt, stereoType) => {
        if (!stereoType) {
          return;
        }
        const hydrogen = atom1?.name === 'H' ? atom1 : atom2?.name === 'H' ? atom2 : null;
        if (!hydrogen) {
          return;
        }
        const parent = hydrogen.getNeighbors(mol).find(neighbor => neighbor.name !== 'H') ?? null;
        if (!parent) {
          return;
        }
        const hydrogenPoint = toSVGPt(hydrogen);
        const parentPoint = toSVGPt(parent);
        offsets.push({
          hydrogenId: hydrogen.id,
          offset: Math.hypot(hydrogenPoint.x - parentPoint.x, hydrogenPoint.y - parentPoint.y)
        });
      }
    }
  };
}

function latestZoomTransform(records) {
  const entry = [...records].reverse().find(record => record[0] === 'call' && record[1] === 'zoomTransform');
  return entry?.[2] ?? null;
}

function applyZoomTransform(point, transform) {
  if (!transform) {
    return point;
  }
  return {
    x: transform.x + point.x * transform.k,
    y: transform.y + point.y * transform.k
  };
}

function buildStereoHydrogenRenderState(smiles) {
  const mol = parseSMILES(smiles);
  const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
  applyCoords(mol, layoutResult, {
    clearUnplaced: true,
    hiddenHydrogenMode: 'coincident',
    syncStereoDisplay: true
  });
  const hCounts = new Map();
  for (const atom of mol.atoms.values()) {
    if (atom.name === 'H') {
      continue;
    }
    const count = atom.getNeighbors(mol).filter(neighbor => neighbor.name === 'H').length;
    if (count > 0) {
      hCounts.set(atom.id, count);
    }
  }
  mol.hideHydrogens();
  const stereoMap = syncDisplayStereo(mol);
  for (const [bondId] of stereoMap) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [atom1, atom2] = bond.getAtomObjects(mol);
    const hydrogen = atom1?.visible === false && atom1.name === 'H' ? atom1 : atom2?.visible === false && atom2.name === 'H' ? atom2 : null;
    if (hydrogen) {
      hydrogen.visible = true;
      continue;
    }
    const heavyAtom = atom1?.visible === false ? (atom2 ?? null) : atom2?.visible === false ? (atom1 ?? null) : null;
    if (!heavyAtom) {
      continue;
    }
    const nextCount = (hCounts.get(heavyAtom.id) ?? 0) - 1;
    if (nextCount <= 0) {
      hCounts.delete(heavyAtom.id);
    } else {
      hCounts.set(heavyAtom.id, nextCount);
    }
  }
  return { mol, hCounts, stereoMap };
}

describe('create2DSceneRenderer', () => {
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
      records.filter(
        entry =>
          ['generate2dCoords', 'setScene', 'clearSelection', 'setPreserveSelectionOnNextRender', 'updateFormula', 'updateDescriptors'].includes(entry[0]) ||
          (entry[0] === 'call' && entry[1] === 'zoomTransform')
      ),
      [
        ['generate2dCoords'],
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

  it('does not mutate hidden stereo hydrogen coordinates during 2D rendering', () => {
    const { renderer } = makeRenderer();
    const mol = parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O');
    const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
    applyCoords(mol, layoutResult, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });
    mol.hideHydrogens();
    const before = [...mol.atoms.values()].filter(atom => atom.name === 'H').map(atom => [atom.id, { x: atom.x, y: atom.y }]);

    renderer.render2d(mol, { preserveGeometry: true });
    const afterFirstRender = [...mol.atoms.values()].filter(atom => atom.name === 'H').map(atom => [atom.id, { x: atom.x, y: atom.y }]);
    renderer.render2d(mol, { preserveGeometry: true });
    const afterSecondRender = [...mol.atoms.values()].filter(atom => atom.name === 'H').map(atom => [atom.id, { x: atom.x, y: atom.y }]);

    assert.deepEqual(afterFirstRender, before);
    assert.deepEqual(afterSecondRender, before);
  });

  it('projects visible stereo hydrogens away from coincident parent atoms during render2d', () => {
    const recorder = createStereoHydrogenOffsetRecorder();
    const { renderer } = makeRenderer({ helperOverrides: recorder.helperOverrides });
    const mol = parseSMILES('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
    applyCoords(mol, layoutResult, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });

    renderer.render2d(mol, { preserveGeometry: true });

    assert.ok(recorder.offsets.length > 0, 'expected stereo hydrogen bonds to be drawn');
    assert.ok(
      recorder.offsets.every(({ offset }) => offset > 1e-6),
      'expected rendered stereo hydrogens to be projected away from their parent atoms'
    );
  });

  it('reprojects hidden stereo hydrogens when draw2d restores a different molecule', () => {
    const recorder = createStereoHydrogenOffsetRecorder();
    const { renderer, state } = makeRenderer({ helperOverrides: recorder.helperOverrides });
    const restoredState = buildStereoHydrogenRenderState('C1C[C@H]2[C@@H](C1)C=C[C@H]2O');
    const stereoHydrogenBondIds = [...restoredState.stereoMap.keys()].filter(bondId => {
      const bond = restoredState.mol.bonds.get(bondId);
      if (!bond) {
        return false;
      }
      const [atom1, atom2] = bond.getAtomObjects(restoredState.mol);
      return atom1?.name === 'H' || atom2?.name === 'H';
    });
    assert.ok(stereoHydrogenBondIds.length > 0, 'expected fixture to contain stereo hydrogen bonds');

    const secondMol = parseSMILES('CCO');
    const secondLayout = generateCoords(secondMol, { suppressH: true, bondLength: 1.5 });
    applyCoords(secondMol, secondLayout, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });
    secondMol.hideHydrogens();
    renderer.render2d(secondMol, { preserveGeometry: true });

    recorder.offsets.length = 0;
    state.mol = restoredState.mol;
    state.hCounts = restoredState.hCounts;
    state.stereoMap = restoredState.stereoMap;
    state.cx = 0;
    state.cy = 0;
    renderer.draw2d();

    assert.ok(recorder.offsets.length > 0, 'expected stereo hydrogen bonds to be redrawn');
    assert.ok(
      recorder.offsets.every(({ offset }) => offset > 1e-6),
      'expected restored stereo hydrogens to remain projected away from their parent atoms'
    );
  });

  it('returns projected SVG points for visible stereo hydrogens', () => {
    const { renderer } = makeRenderer();
    const mol = parseSMILES('C1C[C@H]2[C@@H](C1)C=C[C@H]2C');
    const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
    applyCoords(mol, layoutResult, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });

    renderer.render2d(mol, { preserveGeometry: true });

    const hydrogen = [...mol.atoms.values()].find(atom => atom.name === 'H' && atom.visible !== false);
    assert.ok(hydrogen, 'expected a visible stereo hydrogen');
    const [parent] = hydrogen.getNeighbors(mol);
    assert.ok(parent, 'expected stereo hydrogen to have a parent atom');

    const hydrogenPoint = renderer.toSVGPt(hydrogen);
    const parentPoint = renderer.toSVGPt(parent);

    assert.ok(Math.hypot(hydrogenPoint.x - parentPoint.x, hydrogenPoint.y - parentPoint.y) > 1e-6, 'expected projected hydrogen SVG point to differ from the parent atom point');
  });

  it('pins visible stereo hydrogens to their rendered position before neighboring drags', () => {
    const dragOptionsByAtomId = new Map();
    const { renderer } = makeRenderer({
      dragOverrides: {
        create2dAtomDrag: (_molecule, atomId, options) => {
          dragOptionsByAtomId.set(atomId, options);
          return () => {};
        }
      }
    });
    const mol = parseSMILES('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
    applyCoords(mol, layoutResult, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });

    renderer.render2d(mol, { preserveGeometry: true });

    const hydrogen = [...mol.atoms.values()].find(atom => atom.name === 'H' && atom.visible !== false);
    assert.ok(hydrogen, 'expected a visible stereo hydrogen');
    const [parent] = hydrogen.getNeighbors(mol);
    assert.ok(parent, 'expected stereo hydrogen to have a parent atom');
    const movedAtom = parent.getNeighbors(mol).find(neighbor => neighbor.id !== hydrogen.id && neighbor.name !== 'H' && neighbor.visible !== false);
    assert.ok(movedAtom, 'expected a neighboring heavy atom to drag');
    const dragOptions = dragOptionsByAtomId.get(movedAtom.id);
    assert.ok(dragOptions?.captureDragState, 'expected atom drag options to be registered');

    const initialPoint = renderer.toSVGPt(hydrogen);
    assert.ok(Math.abs(hydrogen.x - parent.x) <= 1e-6 && Math.abs(hydrogen.y - parent.y) <= 1e-6, 'expected the visible stereo hydrogen to start coincident with its parent');

    dragOptions.captureDragState({ sourceEvent: {} }, mol, [movedAtom.id], []);
    assert.ok(Math.hypot(hydrogen.x - parent.x, hydrogen.y - parent.y) > 1e-6, 'expected drag start to materialize the stereo hydrogen coordinates');

    movedAtom.x += 0.35;
    movedAtom.y -= 0.22;
    const movedPoint = renderer.toSVGPt(hydrogen);
    assert.ok(Math.abs(movedPoint.x - initialPoint.x) <= 1e-6, 'expected the stereo hydrogen x position to stay pinned during a neighboring edit');
    assert.ok(Math.abs(movedPoint.y - initialPoint.y) <= 1e-6, 'expected the stereo hydrogen y position to stay pinned during a neighboring edit');
  });

  it('keeps the reported thio-sugar stereo hydrogens on exact vertical projections', () => {
    const { renderer } = makeRenderer();
    const mol = parseSMILES('CC1=N[C@H]2[C@H](O[C@@H](CO)[C@H](O)[C@H]2O)S1');
    const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
    applyCoords(mol, layoutResult, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });

    renderer.render2d(mol, { preserveGeometry: true });

    const stereoHydrogens = [...mol.atoms.values()].filter(atom => atom.name === 'H' && atom.visible !== false);
    assert.ok(stereoHydrogens.length > 0, 'expected visible stereo hydrogens');
    for (const hydrogen of stereoHydrogens) {
      const [parent] = hydrogen.getNeighbors(mol);
      assert.ok(parent, `expected ${hydrogen.id} to have a heavy-atom parent`);
      const hydrogenPoint = renderer.toSVGPt(hydrogen);
      const parentPoint = renderer.toSVGPt(parent);
      assert.ok(Math.abs(hydrogenPoint.x - parentPoint.x) <= 1e-6, `expected ${hydrogen.id} to stay on the parent vertical axis`);
      assert.ok(Math.abs(hydrogenPoint.y - parentPoint.y) > 1e-6, `expected ${hydrogen.id} to project away from ${parent.id}`);
    }
  });

  it('fits projected explicit stereo hydrogens into the 2D viewport', () => {
    const { renderer, records } = makeRenderer();
    const mol = parseSMILES('[H][C@]12CS[C@]([H])(CCCCC(O)=O)[C@@]1([H])NC(=O)N2');
    const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
    applyCoords(mol, layoutResult, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });

    renderer.render2d(mol, { preserveGeometry: true });
    renderer.fitCurrent2dView();

    const transform = latestZoomTransform(records);
    assert.ok(transform, 'expected a zoom-to-fit transform');

    const stereoHydrogens = [...mol.atoms.values()].filter(atom => atom.name === 'H' && atom.visible !== false);
    assert.ok(stereoHydrogens.length > 0, 'expected visible explicit stereo hydrogens');

    for (const hydrogen of stereoHydrogens) {
      const screenPoint = applyZoomTransform(renderer.toSVGPt(hydrogen), transform);
      assert.ok(screenPoint.x >= 0 && screenPoint.x <= 600, `expected ${hydrogen.id} to stay inside the fitted viewport horizontally`);
      assert.ok(screenPoint.y >= 0 && screenPoint.y <= 400, `expected ${hydrogen.id} to stay inside the fitted viewport vertically`);
    }
  });
});
