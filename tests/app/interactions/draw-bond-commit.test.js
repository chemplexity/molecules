import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ReactionPreviewPolicy } from '../../../src/app/core/editor-actions.js';
import { createDrawBondCommitActions } from '../../../src/app/interactions/draw-bond-commit.js';
import { parseSMILES } from '../../../src/io/index.js';
import { generateCoords } from '../../../src/layout/engine/api.js';
import { angleOf, angularDifference, sub } from '../../../src/layout/engine/geometry/vec2.js';

function makeAtom(id, name = 'C') {
  return {
    id,
    name,
    x: 0,
    y: 0,
    bonds: [],
    properties: { charge: 0 },
    getCharge() {
      return this.properties.charge ?? 0;
    },
    getNeighbors() {
      return [];
    }
  };
}

function makeBond(id, atomA, atomB) {
  return {
    id,
    atoms: [atomA, atomB],
    getAtomObjects(mol) {
      return [mol.atoms.get(atomA), mol.atoms.get(atomB)];
    }
  };
}

function copyLayoutCoordsToMolecule(mol, coords) {
  for (const [atomId, position] of coords) {
    const atom = mol.atoms.get(atomId);
    if (atom) {
      atom.x = position.x;
      atom.y = position.y;
    }
  }
}

function bondAngleDegrees(coords, centerAtomId, firstAtomId, secondAtomId) {
  const center = coords.get(centerAtomId);
  const first = coords.get(firstAtomId);
  const second = coords.get(secondAtomId);
  return (angularDifference(angleOf(sub(first, center)), angleOf(sub(second, center))) * 180) / Math.PI;
}

function makeEditableMol(atom = null) {
  let bondCounter = 0;
  const atoms = atom ? new Map([[atom.id, atom]]) : new Map();
  const mol = {
    atoms,
    bonds: new Map(),
    addAtom(_id, name) {
      const pattern = new RegExp(`^${name}(\\d+)$`);
      let nextNumber = 1;
      for (const atomId of this.atoms.keys()) {
        const match = pattern.exec(atomId);
        if (match) {
          nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
        }
      }
      const newAtom = makeAtom(`${name}${nextNumber}`, name);
      this.atoms.set(newAtom.id, newAtom);
      return newAtom;
    },
    addBond(_id, atomA, atomB, properties = {}) {
      bondCounter += 1;
      const bond = {
        id: `b${bondCounter}`,
        atoms: [atomA, atomB],
        properties: { order: 1, aromatic: false, ...properties },
        setStereo() {},
        setAromatic(value) {
          this.properties.aromatic = value;
        },
        setOrder(value) {
          this.properties.order = value;
          this.properties.aromatic = false;
        },
        getAtomObjects(currentMol) {
          return [currentMol.atoms.get(atomA), currentMol.atoms.get(atomB)];
        }
      };
      this.bonds.set(bond.id, bond);
      this.atoms.get(atomA)?.bonds.push(bond.id);
      this.atoms.get(atomB)?.bonds.push(bond.id);
      return bond;
    },
    removeAtom(atomId) {
      this.atoms.delete(atomId);
    },
    clearStereoAnnotations() {},
    repairImplicitHydrogens(affected) {
      this.repairedHydrogens = affected;
    }
  };
  return mol;
}

function makeActions(overrides = {}) {
  let drawBondState = overrides.initialDrawBondState ?? null;
  const calls = {
    preview: [],
    view: [],
    snapshots: [],
    restoredSnapshots: [],
    changedAtoms: [],
    promotedBonds: [],
    renderers: [],
    selection: []
  };

  const context = {
    getMode: () => overrides.mode ?? '2d',
    getDrawBondElement: () => overrides.drawBondElement ?? 'O',
    getDrawBondType: () => overrides.drawBondType ?? 'single',
    preview: {
      clearArtifacts: () => {
        calls.preview.push('clearArtifacts');
      },
      cancel: () => {
        calls.preview.push('cancel');
      }
    },
    state: {
      getDrawBondState: () => drawBondState,
      setDrawBondState: value => {
        drawBondState = value;
      }
    },
    view: {
      clearPrimitiveHover: () => {
        calls.view.push('clearPrimitiveHover');
      },
      setDrawBondHoverSuppressed: value => {
        calls.view.push(['setDrawBondHoverSuppressed', value]);
      },
      captureZoomTransform: () => 'zoom-snapshot',
      getZoomTransform: () => overrides.zoomTransform ?? { x: 0, y: 0, k: 1 },
      restore2dEditViewport: (...args) => {
        calls.view.push(['restore2dEditViewport', ...args]);
      }
    },
    plot: {
      getSize: () => ({ width: 600, height: 400 })
    },
    constants: {
      scale: 40,
      forceScale: 25
    },
    options: {
      getRenderOptions: () => ({ layoutBondLength: overrides.layoutBondLength ?? 1.5 })
    },
    snapshot: {
      capture: () => overrides.capturedSnapshot ?? { id: 'captured-snapshot' },
      restore: snap => {
        calls.restoredSnapshots.push(snap);
      }
    },
    history: {
      takeSnapshot: options => {
        calls.snapshots.push(options);
      }
    },
    overlays: {
      prepareReactionPreviewEditTargets: payload => (overrides.reactionEditFactory ? overrides.reactionEditFactory(payload) : { ...payload, restored: false }),
      prepareResonanceStructuralEdit: mol => (overrides.structuralEditFactory ? overrides.structuralEditFactory(mol) : { mol, resonanceReset: false }),
      isReactionPreviewEditableAtomId: atomId => overrides.isReactionPreviewEditableAtomId?.(atomId) ?? true
    },
    molecule: {
      getActive: () => overrides.activeMol ?? null,
      ensureActive: () => overrides.ensureMol ?? overrides.activeMol ?? null
    },
    force: {
      getNodeById: atomId => overrides.forceNodeById?.(atomId) ?? null,
      getNodes: () => overrides.forceNodes ?? [],
      patchNodePositions: () => {},
      reseatHydrogensAroundPatched: () => {},
      enableKeepInView: () => {}
    },
    view2D: {
      getCenterX: () => 0,
      getCenterY: () => 0,
      syncDerivedState: () => {
        calls.view.push('sync2dDerivedState');
      }
    },
    chemistry: {
      kekulize: () => {},
      refreshAromaticity: () => {}
    },
    analysis: {
      syncInputField: () => {},
      updateFormula: () => {},
      updateDescriptors: () => {},
      updatePanels: () => {}
    },
    renderers: {
      draw2d: () => {
        calls.renderers.push(['draw2d']);
      },
      updateForce: (...args) => {
        calls.renderers.push(['updateForce', ...args]);
      }
    },
    selection: {
      clearSelection: () => {
        calls.selection.push('clearSelection');
      }
    },
    actions: {
      changeAtomElements: (atomIds, newEl, options = {}) => {
        calls.changedAtoms.push({ atomIds, newEl, options });
      },
      promoteBondOrder: (bondId, options = {}) => {
        calls.promotedBonds.push({ bondId, options });
      }
    }
  };

  return {
    actions: createDrawBondCommitActions(context),
    calls,
    getDrawBondState: () => drawBondState
  };
}

describe('createDrawBondCommitActions', () => {
  it('cancels when commit is invoked without an active draw-bond state', () => {
    const { actions, calls } = makeActions();

    actions.commit();

    assert.deepEqual(calls.preview, ['cancel']);
  });

  it('replaces the clicked atom element on a no-drag commit', () => {
    const atom = makeAtom('a1', 'N');
    const mol = {
      atoms: new Map([[atom.id, atom]]),
      bonds: new Map()
    };
    const { actions, calls, getDrawBondState } = makeActions({
      initialDrawBondState: {
        atomId: 'a1',
        ox: 10,
        oy: 20,
        ex: 10,
        ey: 20,
        dragged: false
      },
      activeMol: mol,
      reactionEditFactory: () => ({
        atomId: 'a1',
        restored: true,
        previousSnapshot: { id: 'reaction-preview-snapshot' }
      })
    });

    actions.commit();

    assert.equal(getDrawBondState(), null);
    assert.deepEqual(calls.changedAtoms, [
      {
        atomIds: ['a1'],
        newEl: 'O',
        options: {
          zoomSnapshot: 'zoom-snapshot',
          overlayPolicy: ReactionPreviewPolicy.preserve,
          reactionEdit: {
            atomId: 'a1',
            restored: true,
            previousSnapshot: { id: 'reaction-preview-snapshot' }
          }
        }
      }
    ]);
    assert.deepEqual(calls.snapshots, []);
  });

  it('places only one selected atom on a blank-space no-drag commit', () => {
    const mol = makeEditableMol();
    const { actions, calls } = makeActions({
      activeMol: mol,
      drawBondElement: 'N',
      initialDrawBondState: {
        atomId: null,
        ox: 340,
        oy: 160,
        ex: 340,
        ey: 160,
        snapAtomId: null,
        dragged: false
      }
    });

    actions.commit();

    assert.equal(mol.atoms.size, 1);
    assert.equal(mol.bonds.size, 0);
    const atom = [...mol.atoms.values()][0];
    assert.equal(atom.id, 'N1');
    assert.equal(atom.name, 'N');
    assert.equal(atom.x, 1);
    assert.equal(atom.y, 1);
    assert.deepEqual([...mol.repairedHydrogens], [atom.id]);
    assert.deepEqual(calls.selection, ['clearSelection']);
    assert.deepEqual(calls.renderers, [['draw2d']]);
  });

  it('does not create a brand-new atom from a dragged stereochemical hydrogen source', () => {
    const parent = makeAtom('C3', 'C');
    const hydrogen = makeAtom('H4', 'H');
    parent.bonds = ['b1'];
    hydrogen.bonds = ['b1'];
    const bond = {
      id: 'b1',
      atoms: ['C3', 'H4'],
      properties: { order: 1, display: { as: 'dash', centerId: 'C3' } },
      getOtherAtom(atomId) {
        return atomId === 'H4' ? 'C3' : 'H4';
      },
      getAtomObjects(currentMol) {
        return [currentMol.atoms.get('C3'), currentMol.atoms.get('H4')];
      }
    };
    const mol = {
      atoms: new Map([
        ['C3', parent],
        ['H4', hydrogen]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { actions, calls } = makeActions({
      drawBondElement: 'C',
      activeMol: mol,
      initialDrawBondState: {
        atomId: 'H4',
        ox: 412,
        oy: 156,
        ex: 460,
        ey: 156,
        dragged: true,
        snapAtomId: null
      }
    });

    actions.commit();

    assert.deepEqual([...mol.atoms.keys()], ['C3', 'H4']);
    assert.deepEqual([...mol.bonds.keys()], ['b1']);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.promotedBonds, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('restores the prior reaction preview on a short hydrogen snap no-op', () => {
    const srcAtom = makeAtom('a1', 'C');
    const hydrogen = makeAtom('h1', 'H');
    const mol = {
      atoms: new Map([
        [srcAtom.id, srcAtom],
        [hydrogen.id, hydrogen]
      ]),
      bonds: new Map()
    };
    const { actions, calls } = makeActions({
      initialDrawBondState: {
        atomId: 'a1',
        ox: 0,
        oy: 0,
        ex: 20,
        ey: 0,
        snapAtomId: 'h1',
        dragged: true
      },
      activeMol: mol,
      reactionEditFactory: () => ({
        atomId: 'a1',
        snapAtomId: 'h1',
        restored: true,
        previousSnapshot: { id: 'reaction-preview-snapshot' }
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: false
      })
    });

    actions.commit();

    assert.deepEqual(calls.restoredSnapshots, [{ id: 'reaction-preview-snapshot' }]);
    assert.deepEqual(calls.snapshots, []);
  });

  it('routes force drags from a heavy atom to its displayed stereochemical hydrogen through single-bond clearing', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.getChirality = () => 'R';
    const hydrogen = makeAtom('h1', 'H');
    const bond = {
      id: 'b1',
      atoms: ['a1', 'h1'],
      properties: { order: 1, display: { as: 'dash', centerId: 'a1' } },
      getAtomObjects(currentMol) {
        return [currentMol.atoms.get('a1'), currentMol.atoms.get('h1')];
      },
      getOtherAtom(atomId) {
        return atomId === 'h1' ? 'a1' : 'h1';
      }
    };
    srcAtom.bonds.push('b1');
    hydrogen.bonds.push('b1');
    const mol = {
      atoms: new Map([
        ['a1', srcAtom],
        ['h1', hydrogen]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { actions, calls } = makeActions({
      mode: 'force',
      drawBondType: 'single',
      initialDrawBondState: {
        atomId: 'a1',
        ox: 100,
        oy: 100,
        ex: 130,
        ey: 100,
        snapAtomId: 'h1',
        dragged: true
      },
      activeMol: mol,
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 100, y: 100 } : atomId === 'h1' ? { id: 'h1', name: 'H', x: 130, y: 100 } : null),
      forceNodes: [
        { id: 'a1', name: 'C', x: 100, y: 100 },
        { id: 'h1', name: 'H', x: 130, y: 100 }
      ],
      reactionEditFactory: payload => ({
        ...payload,
        restored: false
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: false
      })
    });

    actions.commit();

    assert.deepEqual(calls.promotedBonds, [
      {
        bondId: 'b1',
        options: {
          drawBondType: 'single',
          preferredCenterId: 'a1',
          zoomSnapshot: null,
          reactionRestored: false,
          reactionEntryZoomSnapshot: null
        }
      }
    ]);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('routes force wedge drags from a heavy atom to its stereochemical hydrogen through bond promotion', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.getChirality = () => 'R';
    const hydrogen = makeAtom('h1', 'H');
    const bond = {
      id: 'b1',
      atoms: ['a1', 'h1'],
      properties: { order: 1 },
      getAtomObjects(currentMol) {
        return [currentMol.atoms.get('a1'), currentMol.atoms.get('h1')];
      },
      getOtherAtom(atomId) {
        return atomId === 'h1' ? 'a1' : 'h1';
      }
    };
    srcAtom.bonds.push('b1');
    hydrogen.bonds.push('b1');
    const mol = {
      atoms: new Map([
        ['a1', srcAtom],
        ['h1', hydrogen]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { actions, calls } = makeActions({
      mode: 'force',
      drawBondType: 'wedge',
      initialDrawBondState: {
        atomId: 'a1',
        ox: 100,
        oy: 100,
        ex: 130,
        ey: 100,
        snapAtomId: 'h1',
        dragged: true
      },
      activeMol: mol,
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 100, y: 100 } : atomId === 'h1' ? { id: 'h1', name: 'H', x: 130, y: 100 } : null),
      forceNodes: [
        { id: 'a1', name: 'C', x: 100, y: 100 },
        { id: 'h1', name: 'H', x: 130, y: 100 }
      ],
      reactionEditFactory: payload => ({
        ...payload,
        restored: false
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: false
      })
    });

    actions.commit();

    assert.deepEqual(calls.promotedBonds, [
      {
        bondId: 'b1',
        options: {
          drawBondType: 'wedge',
          preferredCenterId: 'a1',
          zoomSnapshot: null,
          reactionRestored: false,
          reactionEntryZoomSnapshot: null
        }
      }
    ]);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('routes force wedge drags from a heavy atom to a plain potentially stereochemical hydrogen through bond promotion', () => {
    const mol = parseSMILES('CC(F)(Cl)[H]');
    const center = [...mol.atoms.values()].find(
      atom => atom.name === 'C' && atom.getNeighbors(mol).some(neighbor => neighbor.name === 'F') && atom.getNeighbors(mol).some(neighbor => neighbor.name === 'Cl')
    );
    const hydrogen = center.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
    const bond = mol.bonds.get(hydrogen.bonds.find(bondId => mol.bonds.get(bondId)?.atoms.includes(center.id)));
    const { actions, calls } = makeActions({
      mode: 'force',
      drawBondType: 'wedge',
      initialDrawBondState: {
        atomId: center.id,
        ox: 100,
        oy: 100,
        ex: 130,
        ey: 100,
        snapAtomId: hydrogen.id,
        dragged: true
      },
      activeMol: mol,
      forceNodeById: atomId => (atomId === center.id ? { id: center.id, name: 'C', x: 100, y: 100 } : atomId === hydrogen.id ? { id: hydrogen.id, name: 'H', x: 130, y: 100 } : null),
      forceNodes: [
        { id: center.id, name: 'C', x: 100, y: 100 },
        { id: hydrogen.id, name: 'H', x: 130, y: 100 }
      ],
      reactionEditFactory: payload => ({
        ...payload,
        restored: false
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: false
      })
    });

    actions.commit();

    assert.deepEqual(calls.promotedBonds, [
      {
        bondId: bond.id,
        options: {
          drawBondType: 'wedge',
          preferredCenterId: center.id,
          zoomSnapshot: null,
          reactionRestored: false,
          reactionEntryZoomSnapshot: null
        }
      }
    ]);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('routes force dash drags from a stereochemical hydrogen back to its heavy atom through bond promotion', () => {
    const center = makeAtom('a1', 'C');
    center.getChirality = () => 'R';
    const hydrogen = makeAtom('h1', 'H');
    const bond = {
      id: 'b1',
      atoms: ['a1', 'h1'],
      properties: { order: 1, display: { as: 'wedge', centerId: 'a1' } },
      getAtomObjects(currentMol) {
        return [currentMol.atoms.get('a1'), currentMol.atoms.get('h1')];
      },
      getOtherAtom(atomId) {
        return atomId === 'h1' ? 'a1' : 'h1';
      }
    };
    center.bonds.push('b1');
    hydrogen.bonds.push('b1');
    const mol = {
      atoms: new Map([
        ['a1', center],
        ['h1', hydrogen]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { actions, calls } = makeActions({
      mode: 'force',
      drawBondType: 'dash',
      initialDrawBondState: {
        atomId: 'h1',
        ox: 130,
        oy: 100,
        ex: 100,
        ey: 100,
        snapAtomId: 'a1',
        dragged: true
      },
      activeMol: mol,
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 100, y: 100 } : atomId === 'h1' ? { id: 'h1', name: 'H', x: 130, y: 100 } : null),
      forceNodes: [
        { id: 'a1', name: 'C', x: 100, y: 100 },
        { id: 'h1', name: 'H', x: 130, y: 100 }
      ],
      reactionEditFactory: payload => ({
        ...payload,
        restored: false
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: false
      })
    });

    actions.commit();

    assert.deepEqual(calls.promotedBonds, [
      {
        bondId: 'b1',
        options: {
          drawBondType: 'dash',
          preferredCenterId: 'a1',
          zoomSnapshot: null,
          reactionRestored: false,
          reactionEntryZoomSnapshot: null
        }
      }
    ]);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('routes 2D dash drags from a stereochemical hydrogen back to its heavy atom through bond promotion', () => {
    const center = makeAtom('a1', 'C');
    center.getChirality = () => 'R';
    const hydrogen = makeAtom('h1', 'H');
    const bond = {
      id: 'b1',
      atoms: ['a1', 'h1'],
      properties: { order: 1, display: { as: 'wedge', centerId: 'a1' } },
      getAtomObjects(currentMol) {
        return [currentMol.atoms.get('a1'), currentMol.atoms.get('h1')];
      },
      getOtherAtom(atomId) {
        return atomId === 'h1' ? 'a1' : 'h1';
      }
    };
    center.bonds.push('b1');
    hydrogen.bonds.push('b1');
    const mol = {
      atoms: new Map([
        ['a1', center],
        ['h1', hydrogen]
      ]),
      bonds: new Map([['b1', bond]])
    };
    const { actions, calls } = makeActions({
      mode: '2d',
      drawBondType: 'dash',
      initialDrawBondState: {
        atomId: 'h1',
        ox: 130,
        oy: 100,
        ex: 100,
        ey: 100,
        snapAtomId: 'a1',
        dragged: true
      },
      activeMol: mol,
      reactionEditFactory: payload => ({
        ...payload,
        restored: false
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: false
      })
    });

    actions.commit();

    assert.deepEqual(calls.promotedBonds, [
      {
        bondId: 'b1',
        options: {
          drawBondType: 'dash',
          preferredCenterId: 'a1',
          zoomSnapshot: 'zoom-snapshot',
          reactionRestored: false,
          reactionEntryZoomSnapshot: null
        }
      }
    ]);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('restores the active resonance view when a dragged snap target is not in the editable source', () => {
    const srcAtom = makeAtom('a1', 'C');
    const mol = {
      atoms: new Map([[srcAtom.id, srcAtom]]),
      bonds: new Map()
    };
    const { actions, calls } = makeActions({
      initialDrawBondState: {
        atomId: 'a1',
        ox: 0,
        oy: 0,
        ex: 60,
        ey: 0,
        snapAtomId: '__resonance_product__:a2',
        dragged: true
      },
      activeMol: mol,
      capturedSnapshot: { id: 'resonance-before-commit' },
      reactionEditFactory: payload => ({
        ...payload,
        restored: false
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: true
      })
    });

    actions.commit();

    assert.deepEqual(calls.restoredSnapshots, [{ id: 'resonance-before-commit' }]);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('rejects non-editable snap targets before resonance structural prep', () => {
    const srcAtom = makeAtom('a1', 'C');
    const mol = {
      atoms: new Map([[srcAtom.id, srcAtom]]),
      bonds: new Map()
    };
    let preparedResonance = false;
    const { actions, calls } = makeActions({
      initialDrawBondState: {
        atomId: 'a1',
        ox: 0,
        oy: 0,
        ex: 60,
        ey: 0,
        snapAtomId: '__resonance_product__:a2',
        dragged: true
      },
      activeMol: mol,
      isReactionPreviewEditableAtomId: atomId => !String(atomId).startsWith('__resonance_product__:'),
      structuralEditFactory: currentMol => {
        preparedResonance = true;
        return { mol: currentMol, resonanceReset: true };
      }
    });

    actions.commit();

    assert.equal(preparedResonance, false);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.renderers, []);
  });

  it('promotes an existing 2D bond instead of duplicating it on commit', () => {
    const srcAtom = makeAtom('a1', 'C');
    const destAtom = makeAtom('a2', 'C');
    const bond = makeBond('b1', srcAtom.id, destAtom.id);
    const mol = {
      atoms: new Map([
        [srcAtom.id, srcAtom],
        [destAtom.id, destAtom]
      ]),
      bonds: new Map([[bond.id, bond]])
    };
    const { actions, calls } = makeActions({
      initialDrawBondState: {
        atomId: 'a1',
        ox: 0,
        oy: 0,
        ex: 60,
        ey: 0,
        snapAtomId: 'a2',
        dragged: true
      },
      activeMol: mol,
      reactionEditFactory: payload => ({
        ...payload,
        restored: false,
        previousSnapshot: { id: 'captured-before-commit' }
      }),
      structuralEditFactory: currentMol => ({
        mol: currentMol,
        resonanceReset: true
      })
    });

    actions.commit();

    assert.deepEqual(calls.snapshots, [
      {
        clearReactionPreview: false,
        snapshot: { id: 'captured-before-commit' }
      }
    ]);
    assert.deepEqual(calls.promotedBonds, [
      {
        bondId: 'b1',
        options: {
          drawBondType: 'single',
          preferredCenterId: 'a1',
          zoomSnapshot: 'zoom-snapshot',
          skipReactionPreviewPrep: true,
          skipResonancePrep: true,
          skipSnapshot: true,
          reactionRestored: false,
          reactionEntryZoomSnapshot: null,
          resonanceReset: true
        }
      }
    ]);
  });

  it('preserves the current 2D zoom when auto-placing a bond from reaction preview', () => {
    const srcAtom = makeAtom('a1', 'C');
    const mol = makeEditableMol(srcAtom);
    const { actions, calls } = makeActions({
      activeMol: mol,
      reactionEditFactory: payload => ({
        ...payload,
        restored: false,
        previousSnapshot: { id: 'captured-before-autoplace' }
      })
    });

    actions.autoPlaceBond('a1', 300, 200);

    assert.deepEqual(calls.view.at(-1), [
      'restore2dEditViewport',
      'zoom-snapshot',
      {
        reactionRestored: false,
        reactionEntryZoomSnapshot: null,
        resonanceReset: false,
        zoomToFit: { pad: 0 }
      }
    ]);
  });

  it('places a clicked terminal methyl bond on the zigzag side instead of a straight cap', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');
    const layout = generateCoords(mol, {
      finalLandscapeOrientation: true
    });
    copyLayoutCoordsToMolecule(mol, layout.coords);
    const beforeAtomIds = new Set(mol.atoms.keys());
    const { actions } = makeActions({
      activeMol: mol,
      drawBondElement: 'C'
    });

    actions.autoPlaceBond('C9', 300, 200);

    const newAtomId = [...mol.atoms.keys()].find(atomId => !beforeAtomIds.has(atomId));
    assert.ok(newAtomId, 'expected auto-placement to add a new atom');
    const coords = new Map([...mol.atoms].filter(([, atom]) => Number.isFinite(atom.x) && Number.isFinite(atom.y)).map(([atomId, atom]) => [atomId, { x: atom.x, y: atom.y }]));
    const newAtom = mol.atoms.get(newAtomId);
    const sourceAtom = mol.atoms.get('C9');
    const existingNeighbor = mol.atoms.get('C8');

    assert.ok(newAtom.y < sourceAtom.y, 'expected the new bond to use the lower zigzag slot from C9');
    assert.ok(Math.abs(newAtom.y - existingNeighbor.y) > 0.5, 'expected the new atom not to line up horizontally with the existing branch endpoint');
    assert.ok(Math.abs(bondAngleDegrees(coords, 'C9', 'C8', newAtomId) - 120) < 1e-6, 'expected the new C8-C9 bond angle to stay at 120 degrees');
    assert.deepEqual(
      sourceAtom
        .getNeighbors(mol)
        .filter(neighbor => neighbor.name === 'H')
        .map(neighbor => neighbor.id)
        .sort(),
      ['H21', 'H23']
    );
  });

  it('keeps a dragged 2d bond endpoint on the previewed release position instead of re-snapping it', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions } = makeActions({
      activeMol: mol,
      drawBondElement: 'C',
      initialDrawBondState: {
        atomId: 'a1',
        ox: 300,
        oy: 200,
        ex: 360,
        ey: 140,
        snapAtomId: null,
        dragged: true
      }
    });

    actions.commit();

    const newAtom = mol.atoms.get('C1');
    assert.ok(newAtom);
    assert.equal(newAtom.x, 1.5);
    assert.equal(newAtom.y, 1.5);
  });

  it('keeps a dragged 2d resonance edit endpoint relative to the restored source atom', () => {
    const sourceOxygen = makeAtom('O1', 'O');
    sourceOxygen.x = 0;
    sourceOxygen.y = 0;
    const sourceMol = makeEditableMol(sourceOxygen);
    const displayOxygen = makeAtom('O1', 'O');
    displayOxygen.x = 10;
    displayOxygen.y = 0;
    const displayMol = makeEditableMol(displayOxygen);
    const { actions } = makeActions({
      activeMol: displayMol,
      drawBondElement: 'C',
      initialDrawBondState: {
        atomId: 'O1',
        ox: 700,
        oy: 200,
        ex: 760,
        ey: 140,
        snapAtomId: null,
        dragged: true
      },
      structuralEditFactory: () => ({
        mol: sourceMol,
        resonanceReset: true
      })
    });

    actions.commit();

    const newAtom = sourceMol.atoms.get('C1');
    assert.ok(newAtom);
    assert.equal(newAtom.x, 1.5);
    assert.equal(newAtom.y, 1.5);
  });

  it('uses the configured layout bond length for dragged 2d bond placement', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions } = makeActions({
      activeMol: mol,
      drawBondElement: 'C',
      layoutBondLength: 2,
      initialDrawBondState: {
        atomId: 'a1',
        ox: 300,
        oy: 200,
        ex: 380,
        ey: 200,
        snapAtomId: null,
        dragged: true
      }
    });

    actions.commit();

    const newAtom = mol.atoms.get('C1');
    assert.ok(newAtom);
    assert.equal(newAtom.x, 2);
    assert.equal(newAtom.y, 0);
  });

  it('creates a line from blank space when the blank-space gesture is dragged', () => {
    const mol = makeEditableMol();
    const { actions } = makeActions({
      activeMol: mol,
      drawBondElement: 'C',
      initialDrawBondState: {
        atomId: null,
        ox: 300,
        oy: 200,
        ex: 360,
        ey: 140,
        snapAtomId: null,
        dragged: true
      }
    });

    actions.commit();

    assert.equal(mol.atoms.size, 2);
    assert.equal(mol.bonds.size, 1);
    const [sourceAtom, destAtom] = [...mol.atoms.values()];
    assert.equal(sourceAtom.x, 0);
    assert.equal(sourceAtom.y, 0);
    assert.equal(destAtom.x, 1.5);
    assert.equal(destAtom.y, 1.5);
  });

  it('stores manual wedge display metadata when auto-placing a new wedge bond', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions } = makeActions({
      activeMol: mol,
      drawBondType: 'wedge'
    });

    actions.autoPlaceBond('a1', 300, 200);

    const newBond = [...mol.bonds.values()][0];
    assert.deepEqual(newBond.properties.display, {
      as: 'wedge',
      manual: true,
      centerId: 'a1'
    });
  });

  it('uses the configured layout bond length for force-mode auto-placed bonds', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions, calls } = makeActions({
      activeMol: mol,
      mode: 'force',
      drawBondElement: 'C',
      layoutBondLength: 0.5,
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 300, y: 200 } : null),
      forceNodes: [{ id: 'a1', name: 'C', x: 300, y: 200 }]
    });

    actions.autoPlaceBond('a1', 350, 200);

    const newAtom = mol.atoms.get('C1');
    assert.ok(newAtom);
    assert.equal(newAtom.x, 0.5);
    assert.equal(newAtom.y, 0);

    const forceUpdate = calls.renderers.find(call => call[0] === 'updateForce');
    assert.ok(forceUpdate);
    const patchPos = forceUpdate[2].initialPatchPos;
    assert.deepEqual(patchPos.get('a1'), { x: 300, y: 200 });
    assert.deepEqual(patchPos.get('C1'), { x: 312.5, y: 200 });
  });

  it('refits force layout when an auto-placed bond endpoint is outside the viewport', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions, calls } = makeActions({
      activeMol: mol,
      mode: 'force',
      drawBondElement: 'C',
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 590, y: 200 } : null),
      forceNodes: [{ id: 'a1', name: 'C', x: 590, y: 200 }]
    });

    actions.autoPlaceBond('a1', 640, 200);

    const forceUpdate = calls.renderers.find(call => call[0] === 'updateForce');
    assert.ok(forceUpdate);
    assert.equal(forceUpdate[2].preserveView, false);
  });

  it('refits force layout when an auto-placed bond endpoint would render clipped near the viewport edge', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions, calls } = makeActions({
      activeMol: mol,
      mode: 'force',
      drawBondElement: 'C',
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 552, y: 200 } : null),
      forceNodes: [{ id: 'a1', name: 'C', x: 552, y: 200 }]
    });

    actions.autoPlaceBond('a1', 570, 200);

    const forceUpdate = calls.renderers.find(call => call[0] === 'updateForce');
    assert.ok(forceUpdate);
    assert.equal(forceUpdate[2].preserveView, false);
  });

  it('refits force layout after auto-placing a bond from an active resonance pair', () => {
    const srcAtom = makeAtom('a1', 'C');
    const neighborAtom = makeAtom('a2', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    neighborAtom.x = 1.5;
    neighborAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    mol.atoms.set(neighborAtom.id, neighborAtom);
    const { actions, calls } = makeActions({
      activeMol: mol,
      mode: 'force',
      drawBondElement: 'C',
      structuralEditFactory: currentMol => ({ mol: currentMol, resonanceReset: true }),
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 300, y: 200 } : null),
      forceNodes: [
        { id: 'a1', name: 'C', x: 300, y: 200 },
        { id: 'a2', name: 'C', x: 345, y: 200 },
        { id: '__resonance_product__:a1', name: 'C', x: 600, y: 200 }
      ]
    });

    actions.autoPlaceBond('a1', 350, 200);

    const forceUpdate = calls.renderers.find(call => call[0] === 'updateForce');
    assert.ok(forceUpdate);
    assert.equal(forceUpdate[2].preservePositions, false);
    assert.equal(forceUpdate[2].preserveView, false);
    assert.ok(forceUpdate[2].initialPatchPos instanceof Map);
    assert.deepEqual(forceUpdate[2].initialPatchPos.get('a1'), { x: 300, y: 200 });
    assert.deepEqual(forceUpdate[2].initialPatchPos.get('a2'), { x: 345, y: 200 });
    assert.equal(forceUpdate[2].initialPatchPos.has('__resonance_product__:a1'), false);
  });

  it('refits force layout after auto-placing a bond from reaction preview', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions, calls } = makeActions({
      activeMol: mol,
      mode: 'force',
      drawBondElement: 'C',
      reactionEditFactory: payload => ({
        ...payload,
        atomId: payload.atomId,
        restored: true,
        previousSnapshot: { id: 'preview-before-autoplace' },
        entryZoomTransform: { x: 10, y: 20, k: 2 }
      }),
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 300, y: 200 } : null),
      forceNodes: [{ id: 'a1', name: 'C', x: 300, y: 200 }]
    });

    actions.autoPlaceBond('a1', 350, 200);

    const forceUpdate = calls.renderers.find(call => call[0] === 'updateForce');
    assert.ok(forceUpdate);
    assert.equal(forceUpdate[2].preservePositions, false);
    assert.equal(forceUpdate[2].preserveView, false);
    assert.ok(forceUpdate[2].initialPatchPos instanceof Map);
    assert.deepEqual(forceUpdate[2].initialPatchPos.get('a1'), { x: 300, y: 200 });
    assert.deepEqual(forceUpdate[2].initialPatchPos.get('C1'), { x: 337.5, y: 200 });
  });

  it('refits force layout after dragging a bond from reaction preview', () => {
    const srcAtom = makeAtom('a1', 'C');
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions, calls } = makeActions({
      activeMol: mol,
      mode: 'force',
      drawBondElement: 'C',
      initialDrawBondState: {
        atomId: 'a1',
        ox: 300,
        oy: 200,
        ex: 360,
        ey: 140,
        snapAtomId: null,
        dragged: true
      },
      reactionEditFactory: payload => ({
        ...payload,
        atomId: payload.atomId,
        snapAtomId: payload.snapAtomId,
        restored: true,
        previousSnapshot: { id: 'preview-before-drag' },
        entryZoomTransform: { x: 10, y: 20, k: 2 }
      }),
      forceNodeById: atomId => (atomId === 'a1' ? { id: 'a1', name: 'C', x: 300, y: 200 } : null),
      forceNodes: [{ id: 'a1', name: 'C', x: 300, y: 200 }]
    });

    actions.commit();

    const forceUpdate = calls.renderers.find(call => call[0] === 'updateForce');
    assert.ok(forceUpdate);
    assert.equal(forceUpdate[2].preservePositions, false);
    assert.equal(forceUpdate[2].preserveView, false);
    assert.deepEqual(forceUpdate[2].initialPatchPos.get('a1'), { x: 300, y: 200 });
    assert.deepEqual(forceUpdate[2].initialPatchPos.get('C1'), { x: 360, y: 140 });
  });

  it('does not repair implicit hydrogens on charged atoms when manually adding a bond', () => {
    const srcAtom = makeAtom('a1', 'N');
    srcAtom.properties.charge = 1;
    srcAtom.x = 0;
    srcAtom.y = 0;
    const mol = makeEditableMol(srcAtom);
    const { actions } = makeActions({
      activeMol: mol
    });

    actions.autoPlaceBond('a1', 300, 200);

    assert.equal(mol.repairedHydrogens, undefined);
  });
});
