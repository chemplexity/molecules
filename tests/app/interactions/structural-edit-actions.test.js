import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../../../src/app/core/editor-actions.js';
import { createStructuralEditActions } from '../../../src/app/interactions/structural-edit-actions.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateAndRefine2dCoords } from '../../../src/layout/index.js';

function makeAtom(id, name) {
  return {
    id,
    name,
    bonds: [],
    properties: { aromatic: false },
    getNeighbors(mol) {
      return this.bonds
        .map(bondId => mol.bonds.get(bondId))
        .filter(Boolean)
        .map(bond => mol.atoms.get(bond.getOtherAtom(id)))
        .filter(Boolean);
    }
  };
}

function makeBond(id, atomId1, atomId2, properties = {}) {
  return {
    id,
    atoms: [atomId1, atomId2],
    properties: { order: 1, aromatic: false, ...properties },
    setStereo(value) {
      this.properties.stereo = value;
    },
    setAromatic(value) {
      this.properties.aromatic = value;
      this.properties.order = value ? 1.5 : 1;
    },
    setOrder(value) {
      this.properties.order = value;
      this.properties.aromatic = false;
    },
    getAtomObjects(mol) {
      return [mol.atoms.get(atomId1) ?? null, mol.atoms.get(atomId2) ?? null];
    },
    getOtherAtom(atomId) {
      if (atomId === atomId1) {
        return atomId2;
      }
      if (atomId === atomId2) {
        return atomId1;
      }
      return null;
    }
  };
}

function attachBond(mol, bond) {
  mol.bonds.set(bond.id, bond);
  mol.atoms.get(bond.atoms[0]).bonds.push(bond.id);
  mol.atoms.get(bond.atoms[1]).bonds.push(bond.id);
}

function makeBaseContext(overrides = {}) {
  const calls = [];
  const activeMol = overrides.activeMol ?? null;
  const simulation = overrides.simulation ?? {
    nodes: () => [],
    force: () => ({ links: () => [] }),
    on() {},
    alpha() {
      return this;
    },
    restart() {
      return this;
    }
  };

  const context = {
    controller: {
      performStructuralEdit: (...args) => {
        calls.push(['performStructuralEdit', ...args]);
        return undefined;
      }
    },
    getMode: () => overrides.mode ?? '2d',
    getDrawBondElement: () => overrides.drawBondElement ?? 'N',
    molecule: {
      getActive: () => overrides.liveMol ?? activeMol,
      getCurrentForceMol: () => activeMol
    },
    view: {
      captureZoomTransformSnapshot: () => 'zoom-snapshot',
      restoreZoomTransformSnapshot: snapshot => {
        calls.push(['restoreZoomTransformSnapshot', snapshot]);
      },
      zoomToFitIf2d: () => {
        calls.push(['zoomToFitIf2d']);
      }
    },
    resonance: {
      prepareResonanceStateForStructuralEdit: mol => ({ mol, resonanceReset: false, resonanceCleared: false })
    },
    chemistry: {
      kekulize: mol => {
        calls.push(['kekulize', mol]);
      },
      refreshAromaticity: (mol, options) => {
        calls.push(['refreshAromaticity', mol, options]);
      }
    },
    force: {
      getSimulation: () => simulation,
      isHydrogenNode: node => node?.name === 'H',
      placeHydrogensAroundParent: (...args) => {
        calls.push(['placeHydrogensAroundParent', ...args]);
      },
      patchNodePositions: patchPos => {
        calls.push(['patchNodePositions', patchPos]);
      },
      reseatHydrogensAroundPatched: patchPos => {
        calls.push(['reseatHydrogensAroundPatched', patchPos]);
      }
    },
    constants: {
      forceBondLength: overrides.forceBondLength ?? 30
    }
  };

  return { calls, context: { ...context, ...overrides.context } };
}

describe('createStructuralEditActions', () => {
  it('restores the saved reaction-entry zoom before any other 2D viewport handling', () => {
    const { context, calls } = makeBaseContext();
    const actions = createStructuralEditActions(context);

    actions.restore2dEditViewport('zoom-snapshot', {
      reactionRestored: true,
      reactionEntryZoomSnapshot: 'reaction-entry-zoom',
      resonanceReset: true,
      zoomToFit: true
    });

    assert.deepEqual(calls, [['restoreZoomTransformSnapshot', 'reaction-entry-zoom']]);
  });

  it('falls back to the active molecule when resonance prep resets the live view', () => {
    const liveMol = { id: 'live-mol' };
    const { context } = makeBaseContext({
      activeMol: liveMol,
      liveMol,
      context: {
        resonance: {
          prepareResonanceStateForStructuralEdit: () => ({
            mol: null,
            resonanceReset: true,
            resonanceCleared: false
          })
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.prepareResonanceStructuralEdit({ id: 'stale-mol' });

    assert.deepEqual(result, { mol: liveMol, resonanceReset: true });
  });

  it('cycles aromatic bond promotion through the extracted structural-edit action', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'N');
    atom1.properties.aromatic = true;
    atom2.properties.aromatic = true;
    const bond = makeBond('b1', 'a1', 'a2', { order: 2, aromatic: true, localizedOrder: 2 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };
    attachBond(mol, bond);

    let captured = null;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(captured.kind, 'promote-bond-order');
    assert.equal(captured.options.overlayPolicy, ReactionPreviewPolicy.preserve);
    assert.equal(captured.options.resonancePolicy, ResonancePolicy.preserve);
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.skip);
    assert.equal(captured.options.viewportPolicy, ViewportPolicy.restoreEdit);
    assert.equal(bond.properties.order, 3);
    assert.equal(bond.properties.aromatic, false);
    assert.equal('localizedOrder' in bond.properties, false);
    assert.equal(atom1.properties.aromatic, false);
    assert.equal(atom2.properties.aromatic, false);
    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressDrawBondHover, true);
  });

  it('keeps normal promotion cycling when single bond draw mode is selected', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      drawBondType: 'single',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(bond.properties.order, 2);
    assert.equal(bond.properties.aromatic, false);
  });

  it('stores manual dash display metadata when explicitly applying a dash bond', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      drawBondType: 'dash',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.deepEqual(bond.properties.display, {
      as: 'dash',
      centerId: 'a1',
      manual: true
    });
    assert.equal(bond.properties.order, 1);
  });

  it('uses the larger substituent side as the manual wedge center on a clicked non-stereogenic bond', () => {
    const mol = parseSMILES('CCO');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    const oxygen = [...mol.atoms.values()].find(atom => atom.name === 'O');
    const attachedCarbon = oxygen.getNeighbors(mol).find(atom => atom.name === 'C');
    const bond = [...mol.bonds.values()].find(currentBond => currentBond.connects(oxygen.id, attachedCarbon.id));

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder(bond.id, {
      drawBondType: 'wedge',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.deepEqual(bond.properties.display, {
      as: 'wedge',
      centerId: attachedCarbon.id,
      manual: true
    });
  });

  it('treats applying double to an existing double bond as a no-op', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'O');
    const bond = makeBond('b1', 'a1', 'a2', { order: 2 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map()
    };
    attachBond(mol, bond);

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: '2d', reactionEdit: null });
            if (preflightResult === false) {
              return { cancelled: true };
            }
            mutateCalled = true;
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'double',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(result.cancelled, true);
    assert.equal(mutateCalled, false);
    assert.equal(bond.properties.order, 2);
  });

  it('treats applying triple to an existing triple bond as a no-op', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'N');
    const bond = makeBond('b1', 'a1', 'a2', { order: 3 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map()
    };
    attachBond(mol, bond);

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: '2d', reactionEdit: null });
            if (preflightResult === false) {
              return { cancelled: true };
            }
            mutateCalled = true;
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'triple',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(result.cancelled, true);
    assert.equal(mutateCalled, false);
    assert.equal(bond.properties.order, 3);
  });

  it('treats applying aromatic to an existing aromatic bond as a no-op', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1.5, aromatic: true, localizedOrder: 2 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map()
    };
    attachBond(mol, bond);

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: '2d', reactionEdit: null });
            if (preflightResult === false) {
              return { cancelled: true };
            }
            mutateCalled = true;
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'aromatic',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(result.cancelled, true);
    assert.equal(mutateCalled, false);
    assert.equal(bond.properties.aromatic, true);
  });

  it('clears a manual wedge or dash display when single bond mode is selected', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1, display: { as: 'dash', manual: true, centerId: 'a1' } });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      drawBondType: 'single',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(bond.properties.order, 1);
    assert.equal(bond.properties.display, undefined);
  });

  it('assigns tetrahedral chirality when applying a wedge to a real stereogenic center', () => {
    const mol = parseSMILES('CC(F)(Cl)Br');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    const center = [...mol.atoms.values()].find(atom => atom.name === 'C' && atom.getNeighbors(mol).some(neighbor => neighbor.name === 'F'));
    const fluorine = [...mol.atoms.values()].find(atom => atom.name === 'F');
    const bond = [...mol.bonds.values()].find(currentBond => currentBond.connects(center.id, fluorine.id));

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder(bond.id, {
      drawBondType: 'wedge',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.match(center.getChirality(), /^[RS]$/);
    assert.deepEqual(bond.properties.display, {
      as: 'wedge',
      manual: true,
      centerId: center.id
    });
  });

  it('changes atom elements through the extracted structural-edit action', () => {
    const atom = makeAtom('a1', 'C');
    const mol = {
      atoms: new Map([['a1', atom]]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    let captured = null;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: '2d' });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomElements(['a1'], 'N', { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'change-atom-elements');
    assert.equal(captured.options.overlayPolicy, ReactionPreviewPolicy.prepareEditTargets);
    assert.equal(captured.options.resonancePolicy, ResonancePolicy.normalizeForEdit);
    assert.equal(atom.name, 'N');
    assert.equal(result.clearSelection, true);
    assert.equal(result.suppressPrimitiveHover, true);
    assert.equal(result.clearPrimitiveHover, true);
  });

  it('seeds force atom edits from the edited atom position before the first redraw', () => {
    const atom = makeAtom('a1', 'O');
    const mol = {
      atoms: new Map([['a1', atom]]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    let captured = null;
    const { context } = makeBaseContext({
      simulation: {
        nodes: () => [{ id: 'a1', name: 'O', x: 120, y: 80 }],
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: 'force' });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomElements(['a1'], 'C', { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'change-atom-elements');
    assert.equal(atom.name, 'C');
    assert.equal(result.force.options.preservePositions, true);
    assert.equal(result.force.options.preserveView, true);
    assert.deepEqual(result.force.options.initialPatchPos, new Map([['a1', { x: 120, y: 80 }]]));
  });

  it('replaces a force hydrogen with the draw element and patches its position', () => {
    const hydrogen = makeAtom('h1', 'H');
    const carbon = makeAtom('c1', 'C');
    const mol = {
      atoms: new Map([
        ['h1', hydrogen],
        ['c1', carbon]
      ]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    const hydrogenNode = { id: 'h1', name: 'H', x: 10, y: 0 };
    const carbonNode = { id: 'c1', name: 'C', x: 0, y: 0 };
    const simulation = {
      nodes: () => [hydrogenNode, carbonNode],
      force(name) {
        if (name === 'link') {
          return {
            links: () => [{ source: carbonNode, target: hydrogenNode }]
          };
        }
        return { links: () => [] };
      },
      on() {},
      alpha() {
        return this;
      },
      restart() {
        return this;
      }
    };

    const { context, calls } = makeBaseContext({
      activeMol: mol,
      simulation,
      forceBondLength: 30,
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            const result = mutate({ mol, mode: 'force', reactionEdit: { atomId: 'h1' } });
            const aux = result.force.beforeRender();
            result.force.afterRender({}, aux);
            return { kind, options, result };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const response = actions.replaceForceHydrogenWithDrawElement('h1', mol);

    assert.equal(response.kind, 'replace-force-hydrogen-with-draw-element');
    assert.equal(response.options.overlayPolicy, ReactionPreviewPolicy.prepareEditTargets);
    assert.equal(response.options.resonancePolicy, ResonancePolicy.normalizeForEdit);
    assert.equal(response.options.snapshotPolicy, SnapshotPolicy.take);
    assert.equal(response.options.viewportPolicy, ViewportPolicy.none);
    assert.equal(hydrogen.name, 'N');
    const patchCall = calls.find(([kind]) => kind === 'patchNodePositions');
    assert.ok(patchCall);
    const patchPos = patchCall[1];
    assert.equal(patchPos.get('h1').x, 30);
    assert.equal(patchPos.get('h1').y, 0);
  });
});
