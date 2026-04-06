import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionSnapshotDeps } from '../../../src/app/core/session-snapshot-deps.js';

describe('createSessionSnapshotDeps', () => {
  it('builds the snapshot manager dependency bundle from grouped bridges', () => {
    const records = [];
    const deps = createSessionSnapshotDeps({
      Molecule: class FakeMolecule {},
      state: {
        getMode: () => '2d',
        setMode: value => {
          records.push(['setMode', value]);
        },
        getActiveMolecule: () => 'active-mol',
        getCurrentMol: () => 'current-mol',
        setCurrentMol: value => {
          records.push(['setCurrentMol', value]);
        },
        getMol2d: () => 'mol2d',
        setMol2d: value => {
          records.push(['setMol2d', value]);
        },
        getCurrentSmiles: () => 'CCO',
        setCurrentSmiles: value => {
          records.push(['setCurrentSmiles', value]);
        },
        getCurrentInchi: () => 'InChI=1S/...',
        setCurrentInchi: value => {
          records.push(['setCurrentInchi', value]);
        }
      },
      input: {
        getInputMode: () => 'smiles',
        getInputValue: () => 'CCO',
        setInputFormat: (fmt, options) => {
          records.push(['setInputFormat', fmt, options]);
        }
      },
      dom: {
        updateModeChrome: mode => {
          records.push(['updateModeChrome', mode]);
        }
      },
      runtime: {
        syncInputField: mol => {
          records.push(['syncInputField', mol]);
        },
        captureViewState: () => ({ mode: '2d' }),
        clearForceState: () => {
          records.push(['clearForceState']);
        },
        clear2dState: () => {
          records.push(['clear2dState']);
        },
        clearAnalysisState: () => {
          records.push(['clearAnalysisState']);
        },
        restore2dState: (displayMol, snap) => {
          records.push(['restore2dState', displayMol, snap]);
        },
        restoreForceState: (displayMol, snap) => {
          records.push(['restoreForceState', displayMol, snap]);
        },
        redrawRestoredResonanceView: (mol, snap) => {
          records.push(['redrawRestoredResonanceView', mol, snap]);
        }
      },
      sessionUi: {
        serializeSnapshotMol: mol => ({ mol }),
        captureInteractionState: () => ({ toolMode: 'pan' }),
        capturePanelState: () => ({ descriptorTab: 'topological' }),
        restorePanelState: panelState => {
          records.push(['restorePanelState', panelState]);
        },
        restoreInteractionState: snap => {
          records.push(['restoreInteractionState', snap]);
        }
      },
      overlays: {
        captureReactionPreviewSnapshot: () => ({ sourceMol: 'reaction-source' }),
        restoreReactionPreviewSnapshot: snap => {
          records.push(['restoreReactionPreviewSnapshot', snap]);
        },
        clearReactionPreviewState: () => {
          records.push(['clearReactionPreviewState']);
        },
        reapplyActiveReactionPreview: () => true,
        updateReactionTemplatesPanel: () => {
          records.push(['updateReactionTemplatesPanel']);
        }
      },
      resonance: {
        prepareResonanceUndoSnapshot: mol => ({ mol, resonanceView: null }),
        restoreResonanceViewSnapshot: (mol, snap) => {
          records.push(['restoreResonanceViewSnapshot', mol, snap]);
          return true;
        }
      },
      highlights: {
        captureHighlightSnapshot: () => ({ highlighted: ['a1'] }),
        clearHighlightState: () => {
          records.push(['clearHighlightState']);
        },
        restoreFunctionalGroupHighlightSnapshot: (snapshot, mol) => {
          records.push(['restoreFunctionalGroupHighlightSnapshot', snapshot, mol]);
          return false;
        },
        restorePhyschemHighlightSnapshot: snapshot => {
          records.push(['restorePhyschemHighlightSnapshot', snapshot]);
          return false;
        },
        restorePersistentHighlight: () => {
          records.push(['restorePersistentHighlight']);
        }
      },
      view: {
        setRotationDeg: value => {
          records.push(['setRotationDeg', value]);
        },
        setFlipH: value => {
          records.push(['setFlipH', value]);
        },
        setFlipV: value => {
          records.push(['setFlipV', value]);
        },
        restoreZoomTransform: snapshot => {
          records.push(['restoreZoomTransform', snapshot]);
        }
      },
      analysis: {
        updateFormula: mol => {
          records.push(['updateFormula', mol]);
        },
        updateDescriptors: mol => {
          records.push(['updateDescriptors', mol]);
        },
        updatePanels: (mol, options) => {
          records.push(['updatePanels', mol, options]);
        }
      }
    });

    assert.equal(deps.getActiveMolecule(), 'active-mol');
    assert.deepEqual(deps.captureViewState(), { mode: '2d' });
    assert.deepEqual(deps.captureHighlightState(), {
      functionalGroup: { highlighted: ['a1'] },
      physchem: null
    });

    deps.setMode('force');
    deps.restore2dState('display-mol', { zoomTransform: { x: 1, y: 2, k: 3 } });
    deps.updateAnalysisPanels('mol', { recomputeResonance: false });

    assert.deepEqual(records, [
      ['setMode', 'force'],
      ['restore2dState', 'display-mol', { zoomTransform: { x: 1, y: 2, k: 3 } }],
      ['updatePanels', 'mol', { recomputeResonance: false }]
    ]);
  });
});
