import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createEditorActions, ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../../../src/app/core/editor-actions.js';

function makeDeps({ mode = '2d', hasReactionPreview = false } = {}) {
  const calls = [];
  const mol = { id: 'mol' };
  return {
    calls,
    mol,
    deps: {
      state: {
        documentState: {
          getActiveMolecule: () => mol,
          setActiveMolecule(nextMol) {
            calls.push(['setActiveMolecule', nextMol]);
          }
        },
        viewState: {
          getMode: () => mode,
          captureZoomTransform: () => ({ x: 1, y: 2, k: 3 }),
          sync2dDerivedState(nextMol) {
            calls.push(['sync2dDerivedState', nextMol]);
          },
          restore2dEditViewport(snapshot, options) {
            calls.push(['restore2dEditViewport', snapshot, options]);
          },
          clearPrimitiveHover() {
            calls.push(['clearPrimitiveHover']);
          },
          suppressDrawBondHover() {
            calls.push(['suppressDrawBondHover']);
          },
          enableForceKeepInView() {
            calls.push(['enableForceKeepInView']);
          },
          restoreZoomTransformSnapshot(snapshot) {
            calls.push(['restoreZoomTransformSnapshot', snapshot]);
          }
        }
      },
      renderers: {
        draw2d() {
          calls.push(['draw2d']);
        },
        updateForce(nextMol, options) {
          calls.push(['updateForce', nextMol, options]);
        }
      },
      history: {
        takeSnapshot(options) {
          calls.push(['takeSnapshot', options]);
        },
        captureSnapshot() {
          calls.push(['captureSnapshot']);
          return { id: 'captured-snapshot' };
        },
        discardLastSnapshot() {
          calls.push(['discardLastSnapshot']);
        }
      },
      panels: {},
      analysis: {
        syncInputField(nextMol) {
          calls.push(['syncInputField', nextMol]);
        },
        updateFormula(nextMol) {
          calls.push(['updateFormula', nextMol]);
        },
        updateDescriptors(nextMol) {
          calls.push(['updateDescriptors', nextMol]);
        },
        updatePanels(nextMol) {
          calls.push(['updatePanels', nextMol]);
        }
      },
      dom: {},
      overlays: {
        hasReactionPreview: () => hasReactionPreview,
        prepareReactionPreviewBondEditTarget(payload) {
          calls.push(['prepareReactionPreviewBondEditTarget', payload]);
          return { bondId: 'bond-2', restored: true };
        },
        prepareReactionPreviewEditTargets(payload) {
          calls.push(['prepareReactionPreviewEditTargets', payload]);
          return { atomId: 'atom-2', restored: true };
        },
        prepareResonanceStructuralEdit(nextMol) {
          calls.push(['prepareResonanceStructuralEdit', nextMol]);
          return { mol: nextMol, resonanceReset: true };
        }
      },
      view: {
        clearPrimitiveHover() {
          calls.push(['clearPrimitiveHover']);
        },
        suppressDrawBondHover() {
          calls.push(['suppressDrawBondHover']);
        },
        sync2dDerivedState(nextMol) {
          calls.push(['sync2dDerivedState', nextMol]);
        },
        restore2dEditViewport(snapshot, options) {
          calls.push(['restore2dEditViewport', snapshot, options]);
        },
        enableForceKeepInView() {
          calls.push(['enableForceKeepInView']);
        },
        restoreZoomTransformSnapshot(snapshot) {
          calls.push(['restoreZoomTransformSnapshot', snapshot]);
        }
      }
    }
  };
}

describe('createEditorActions', () => {
  it('blocks structural edits when the reaction-preview policy says to block', () => {
    const { deps, calls } = makeDeps({ hasReactionPreview: true });
    const actions = createEditorActions(deps);

    const result = actions.performStructuralEdit(
      'delete-selection',
      {
        overlayPolicy: ReactionPreviewPolicy.block
      },
      () => {
        calls.push(['mutate']);
      }
    );

    assert.equal(result.performed, false);
    assert.equal(result.blockedByOverlay, true);
    assert.deepEqual(calls, []);
  });

  it('routes 2D structural edits through the shared prepare/snapshot/analyze/viewport pipeline', () => {
    const { deps, calls, mol } = makeDeps();
    const actions = createEditorActions(deps);

    const result = actions.performStructuralEdit(
      'promote-bond-order',
      {
        overlayPolicy: ReactionPreviewPolicy.prepareBondTarget,
        reactionPreviewPayload: 'bond-1',
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.restoreEdit
      },
      ({ reactionEdit, resonanceReset }) => {
        calls.push(['mutate', reactionEdit, resonanceReset]);
        return {
          clearPrimitiveHover: true,
          suppressDrawBondHover: true
        };
      }
    );

    assert.equal(result.performed, true);
    assert.deepEqual(calls, [
      ['prepareReactionPreviewBondEditTarget', 'bond-1'],
      ['captureSnapshot'],
      ['prepareResonanceStructuralEdit', mol],
      ['takeSnapshot', { clearReactionPreview: false, snapshot: { id: 'captured-snapshot' } }],
      ['mutate', { bondId: 'bond-2', restored: true, previousSnapshot: { id: 'captured-snapshot' } }, true],
      ['setActiveMolecule', mol],
      ['clearPrimitiveHover'],
      ['suppressDrawBondHover'],
      ['syncInputField', mol],
      ['updateFormula', mol],
      ['updateDescriptors', mol],
      ['updatePanels', mol],
      ['sync2dDerivedState', mol],
      ['draw2d'],
      ['restore2dEditViewport', { x: 1, y: 2, k: 3 }, { reactionRestored: true, reactionEntryZoomSnapshot: null, resonanceReset: true, zoomToFit: false }]
    ]);
  });

  it('runs force-specific hooks around the shared force redraw path', () => {
    const { deps, calls, mol } = makeDeps({ mode: 'force' });
    const actions = createEditorActions(deps);

    const result = actions.performStructuralEdit(
      'delete-selection',
      {
        overlayPolicy: ReactionPreviewPolicy.preserve,
        resonancePolicy: ResonancePolicy.preserve,
        snapshotPolicy: SnapshotPolicy.skip
      },
      () => ({
        force: {
          options: { preservePositions: true, preserveView: true },
          beforeRender: () => {
            calls.push(['beforeRender']);
            return 'aux';
          },
          afterRender: (_context, aux) => {
            calls.push(['afterRender', aux]);
          },
          enableKeepInView: true
        }
      })
    );

    assert.equal(result.performed, true);
    assert.deepEqual(calls, [
      ['setActiveMolecule', mol],
      ['syncInputField', mol],
      ['updateFormula', mol],
      ['updateDescriptors', mol],
      ['updatePanels', mol],
      ['beforeRender'],
      ['updateForce', mol, { preservePositions: true, preserveView: true }],
      ['afterRender', 'aux'],
      ['enableForceKeepInView']
    ]);
  });

  it('restores the saved force zoom after a reaction-preview edit re-renders in force mode', () => {
    const { deps, calls, mol } = makeDeps({ mode: 'force' });
    deps.overlays.prepareReactionPreviewBondEditTarget = payload => {
      calls.push(['prepareReactionPreviewBondEditTarget', payload]);
      return {
        bondId: 'bond-2',
        restored: true,
        entryZoomTransform: { x: 9, y: 8, k: 1.25 }
      };
    };
    const actions = createEditorActions(deps);

    const result = actions.performStructuralEdit(
      'promote-bond-order',
      {
        overlayPolicy: ReactionPreviewPolicy.prepareBondTarget,
        reactionPreviewPayload: 'bond-1',
        resonancePolicy: ResonancePolicy.preserve,
        snapshotPolicy: SnapshotPolicy.skip,
        viewportPolicy: ViewportPolicy.restoreEdit
      },
      () => ({
        updateAnalysis: false
      })
    );

    assert.equal(result.performed, true);
    assert.deepEqual(calls, [
      ['prepareReactionPreviewBondEditTarget', 'bond-1'],
      ['setActiveMolecule', mol],
      ['syncInputField', mol],
      ['updateForce', mol, { preservePositions: true, preserveView: true }],
      ['restoreZoomTransformSnapshot', { x: 9, y: 8, k: 1.25 }]
    ]);
  });

  it('skips snapshotting when preflight rejects a no-op edit', () => {
    const { deps, calls } = makeDeps();
    const actions = createEditorActions(deps);

    const result = actions.performStructuralEdit(
      'change-atom-elements',
      {
        preflight: () => false
      },
      () => {
        calls.push(['mutate']);
      }
    );

    assert.equal(result.performed, false);
    assert.equal(result.cancelled, true);
    assert.deepEqual(calls, [['captureSnapshot'], ['prepareResonanceStructuralEdit', deps.state.documentState.getActiveMolecule()]]);
  });

  it('uses the overlay-prep previous snapshot instead of recapturing after reaction-preview restore', () => {
    const { deps, calls, mol } = makeDeps();
    deps.overlays.prepareReactionPreviewBondEditTarget = payload => {
      calls.push(['prepareReactionPreviewBondEditTarget', payload]);
      return { bondId: 'bond-2', restored: true, previousSnapshot: { id: 'overlay-snapshot' } };
    };
    const actions = createEditorActions(deps);

    const result = actions.performStructuralEdit(
      'promote-bond-order',
      {
        overlayPolicy: ReactionPreviewPolicy.prepareBondTarget,
        reactionPreviewPayload: 'bond-1',
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take
      },
      ({ reactionEdit }) => {
        calls.push(['mutate', reactionEdit]);
        return {};
      }
    );

    assert.equal(result.performed, true);
    assert.deepEqual(calls, [
      ['prepareReactionPreviewBondEditTarget', 'bond-1'],
      ['prepareResonanceStructuralEdit', mol],
      ['takeSnapshot', { clearReactionPreview: false, snapshot: { id: 'overlay-snapshot' } }],
      ['mutate', { bondId: 'bond-2', restored: true, previousSnapshot: { id: 'overlay-snapshot' } }],
      ['setActiveMolecule', mol],
      ['syncInputField', mol],
      ['updateFormula', mol],
      ['updateDescriptors', mol],
      ['updatePanels', mol],
      ['sync2dDerivedState', mol],
      ['draw2d']
    ]);
  });

  it('discards the just-taken snapshot when mutateFn cancels late', () => {
    const { deps, calls, mol } = makeDeps();
    const actions = createEditorActions(deps);

    const result = actions.performStructuralEdit(
      'late-cancel-edit',
      {
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take
      },
      () => {
        calls.push(['mutate']);
        return { cancelled: true };
      }
    );

    assert.equal(result.performed, false);
    assert.equal(result.cancelled, true);
    assert.deepEqual(calls, [
      ['captureSnapshot'],
      ['prepareResonanceStructuralEdit', mol],
      ['takeSnapshot', { clearReactionPreview: false, snapshot: { id: 'captured-snapshot' } }],
      ['mutate'],
      ['discardLastSnapshot']
    ]);
  });
});
