import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ReactionPreviewPolicy } from '../../../src/app/core/editor-actions.js';
import { createDrawBondCommitActions } from '../../../src/app/interactions/draw-bond-commit.js';

function makeAtom(id, name = 'C') {
  return {
    id,
    name,
    x: 0,
    y: 0,
    bonds: [],
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

function makeActions(overrides = {}) {
  let drawBondState = overrides.initialDrawBondState ?? null;
  const calls = {
    preview: [],
    view: [],
    snapshots: [],
    restoredSnapshots: [],
    changedAtoms: [],
    promotedBonds: []
  };

  const context = {
    getMode: () => overrides.mode ?? '2d',
    getDrawBondElement: () => overrides.drawBondElement ?? 'O',
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
      restore2dEditViewport: () => {
        calls.view.push('restore2dEditViewport');
      }
    },
    plot: {
      getSize: () => ({ width: 600, height: 400 })
    },
    constants: {
      scale: 40,
      forceScale: 25
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
      prepareReactionPreviewEditTargets: payload =>
        overrides.reactionEditFactory ? overrides.reactionEditFactory(payload) : { ...payload, restored: false },
      prepareResonanceStructuralEdit: mol =>
        overrides.structuralEditFactory ? overrides.structuralEditFactory(mol) : { mol, resonanceReset: false }
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
      draw2d: () => {},
      updateForce: () => {}
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

  it('restores the prior reaction preview on a hydrogen snap no-op', () => {
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
        ex: 60,
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
});
