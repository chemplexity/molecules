import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../../../src/app/core/editor-actions.js';
import { createEditingActions } from '../../../src/app/interactions/editing.js';
import { parseSMILES } from '../../../src/io/smiles.js';

function makeContext(overrides = {}) {
  const selectedAtomIds = new Set(overrides.selectedAtomIds ?? []);
  const selectedBondIds = new Set(overrides.selectedBondIds ?? []);
  const hoveredAtomIds = new Set(overrides.hoveredAtomIds ?? []);
  const hoveredBondIds = new Set(overrides.hoveredBondIds ?? []);
  const calls = [];

  const context = {
    state: {
      overlayState: {
        getSelectedAtomIds: () => selectedAtomIds,
        getSelectedBondIds: () => selectedBondIds,
        getHoveredAtomIds: () => hoveredAtomIds,
        getHoveredBondIds: () => hoveredBondIds
      }
    },
    actions: {
      performStructuralEdit: (...args) => {
        calls.push(['performStructuralEdit', ...args.slice(0, 2)]);
        if (overrides.performStructuralEdit) {
          return overrides.performStructuralEdit(...args);
        }
        return { performed: true };
      }
    },
    overlays: {
      hasReactionPreview: () => overrides.hasReactionPreview ?? false,
      prepareReactionPreviewEraseTargets: (...args) => {
        calls.push(['prepareReactionPreviewEraseTargets', ...args]);
        if (overrides.prepareReactionPreviewEraseTargets) {
          return overrides.prepareReactionPreviewEraseTargets(...args);
        }
        return {
          atomIds: args[0] ?? [],
          bondIds: args[1] ?? []
        };
      }
    },
    policies: {
      reactionPreview: { block: ReactionPreviewPolicy.block },
      resonance: { normalizeForEdit: ResonancePolicy.normalizeForEdit },
      snapshot: { take: SnapshotPolicy.take },
      viewport: { none: ViewportPolicy.none }
    },
    chemistry: {
      clearStereoAnnotations: () => {},
      kekulize: () => {},
      refreshAromaticity: () => {}
    },
    force: {
      getSimulation: () => null,
      patchNodePositions: () => {},
      reseatHydrogensAroundPatched: () => {}
    },
    view2D: {
      fitCurrentView: () => {
        calls.push(['fitCurrentView']);
      }
    },
    view: {
      refreshSelectionOverlay: () => {
        calls.push(['refreshSelectionOverlay']);
      }
    },
    dom: {
      flashEraseButton: () => {
        calls.push(['flashEraseButton']);
      }
    }
  };

  return {
    actions: createEditingActions(context),
    calls,
    selectedAtomIds,
    selectedBondIds,
    hoveredAtomIds,
    hoveredBondIds
  };
}

describe('createEditingActions', () => {
  it('clears selection and refreshes overlays when delete is blocked by reaction preview', () => {
    const { actions, calls, selectedAtomIds, selectedBondIds } = makeContext({
      selectedAtomIds: ['a1'],
      selectedBondIds: ['b1'],
      performStructuralEdit: () => ({ blockedByOverlay: true })
    });

    const result = actions.deleteSelection();

    assert.deepEqual(result, { blockedByOverlay: true });
    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
    assert.deepEqual(calls, [
      ['refreshSelectionOverlay'],
      [
        'performStructuralEdit',
        'delete-selection',
        {
          overlayPolicy: ReactionPreviewPolicy.block,
          resonancePolicy: ResonancePolicy.normalizeForEdit,
          snapshotPolicy: SnapshotPolicy.take,
          viewportPolicy: ViewportPolicy.none
        }
      ]
    ]);
  });

  it('treats erase as a no-op while reaction preview is active', () => {
    const { actions, calls, hoveredAtomIds, hoveredBondIds } = makeContext({
      hoveredAtomIds: ['a1'],
      hoveredBondIds: ['b1'],
      hasReactionPreview: true
    });

    const result = actions.eraseItem(['a1'], ['b1']);

    assert.deepEqual(result, { performed: false, blockedByOverlay: true });
    assert.deepEqual([...hoveredAtomIds], []);
    assert.deepEqual([...hoveredBondIds], []);
    assert.deepEqual(calls, []);
  });

  it('maps erase targets into selection and delegates to deleteSelection', () => {
    const { actions, calls, selectedAtomIds, selectedBondIds, hoveredAtomIds, hoveredBondIds } = makeContext({
      hoveredAtomIds: ['hover-a'],
      hoveredBondIds: ['hover-b'],
      prepareReactionPreviewEraseTargets: () => ({
        atomIds: ['a9'],
        bondIds: ['b9']
      }),
      performStructuralEdit: () => ({ performed: true })
    });

    const result = actions.eraseItem(['a1'], ['b1']);

    assert.deepEqual(result, { performed: true });
    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
    assert.deepEqual([...hoveredAtomIds], []);
    assert.deepEqual([...hoveredBondIds], []);
    assert.deepEqual(calls, [
      ['prepareReactionPreviewEraseTargets', ['a1'], ['b1']],
      ['refreshSelectionOverlay'],
      [
        'performStructuralEdit',
        'delete-selection',
        {
          overlayPolicy: ReactionPreviewPolicy.block,
          resonancePolicy: ResonancePolicy.normalizeForEdit,
          snapshotPolicy: SnapshotPolicy.take,
          viewportPolicy: ViewportPolicy.none
        }
      ],
      ['flashEraseButton']
    ]);
  });

  it('deletes transient targets without mutating persisted selection state', () => {
    const { actions, calls, selectedAtomIds, selectedBondIds } = makeContext({
      selectedAtomIds: ['persist-a'],
      selectedBondIds: ['persist-b'],
      performStructuralEdit: () => ({ performed: true })
    });

    const result = actions.deleteTargets(['hover-a'], ['hover-b'], { transient: true });

    assert.deepEqual(result, { performed: true });
    assert.deepEqual([...selectedAtomIds], ['persist-a']);
    assert.deepEqual([...selectedBondIds], ['persist-b']);
    assert.deepEqual(calls, [
      [
        'performStructuralEdit',
        'delete-selection',
        {
          overlayPolicy: ReactionPreviewPolicy.block,
          resonancePolicy: ResonancePolicy.normalizeForEdit,
          snapshotPolicy: SnapshotPolicy.take,
          viewportPolicy: ViewportPolicy.none
        }
      ],
      ['flashEraseButton']
    ]);
  });

  it('clears the live selection before deleting so undo does not restore it', () => {
    const { actions, calls, selectedAtomIds, selectedBondIds } = makeContext({
      selectedAtomIds: ['a1'],
      selectedBondIds: ['b1'],
      performStructuralEdit: (_kind, _options, mutate) => {
        mutate({
          mol: {
            atoms: new Map(),
            bonds: new Map(),
            clearStereoAnnotations: () => {},
            repairImplicitHydrogens: () => {}
          },
          mode: '2d'
        });
        return { performed: true };
      }
    });

    const result = actions.deleteSelection();

    assert.deepEqual(result, { performed: true });
    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
    assert.equal(calls[0][0], 'refreshSelectionOverlay');
    assert.equal(calls[1][0], 'performStructuralEdit');
  });

  it('prunes a displayed stereo hydrogen when deleting its bond', () => {
    const mol = parseSMILES('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    const hydrogen = [...mol.atoms.values()].find(atom => atom.name === 'H' && atom.bonds.length === 1 && atom.visible === false);
    assert.ok(hydrogen, 'expected an explicit stereo hydrogen');
    const hydrogenBondId = hydrogen.bonds[0];
    assert.ok(hydrogenBondId, 'expected the stereo hydrogen to have one bond');
    const parentId = hydrogen.getNeighbors(mol).find(atom => atom.name !== 'H')?.id ?? null;
    assert.ok(parentId, 'expected the stereo hydrogen to have a heavy-atom parent');
    hydrogen.visible = true;
    mol.bonds.get(hydrogenBondId).properties.display = { as: 'wedge', centerId: parentId };

    const { actions } = makeContext({
      selectedBondIds: [hydrogenBondId],
      performStructuralEdit: (_kind, _options, mutate) => {
        mutate({ mol, mode: '2d' });
        return { performed: true };
      }
    });

    const result = actions.deleteSelection();

    assert.deepEqual(result, { performed: true });
    assert.equal(mol.bonds.has(hydrogenBondId), false);
    assert.equal(mol.atoms.has(hydrogen.id), false);
    assert.ok(mol.atoms.has(parentId), 'expected the heavy-atom parent to remain');
    assert.equal(
      [...mol.atoms.values()].some(atom => atom.name === 'H' && atom.visible === true && atom.bonds.length === 0),
      false
    );
  });
});
