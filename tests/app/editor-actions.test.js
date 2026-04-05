import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEditorActions,
  ReactionPreviewPolicy,
  ResonancePolicy,
  SnapshotPolicy,
  ViewportPolicy
} from '../../src/app/core/editor-actions.js';

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
      ['prepareResonanceStructuralEdit', mol],
      ['takeSnapshot', undefined],
      ['mutate', { bondId: 'bond-2', restored: true }, true],
      ['setActiveMolecule', mol],
      ['clearPrimitiveHover'],
      ['suppressDrawBondHover'],
      ['syncInputField', mol],
      ['updateFormula', mol],
      ['updateDescriptors', mol],
      ['updatePanels', mol],
      ['sync2dDerivedState', mol],
      ['draw2d'],
      ['restore2dEditViewport', { x: 1, y: 2, k: 3 }, { reactionRestored: true, resonanceReset: true, zoomToFit: false }]
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
    assert.deepEqual(calls, [['prepareResonanceStructuralEdit', deps.state.documentState.getActiveMolecule()]]);
  });
});
