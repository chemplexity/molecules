/** @module app/interactions/editing */

import { repairImplicitHydrogensWhenValenceImproves } from './implicit-hydrogen-repair.js';

/**
 * Returns whether a hydrogen endpoint should be pruned when its selected bond
 * is deleted instead of being left behind as a standalone displayed fragment.
 * This keeps auto-shown stereo hydrogens from surviving as isolated atoms with
 * valence warnings after the user erases just the bond glyph.
 * @param {object|null|undefined} atom - Candidate bond-end atom.
 * @param {object|null|undefined} bond - Bond scheduled for deletion.
 * @param {Set<string>} deletedAtomIds - Atom ids already queued for deletion.
 * @returns {boolean} True when the hydrogen should be removed after bond deletion.
 */
function shouldPruneDeletedBondHydrogen(atom, bond, deletedAtomIds) {
  if (!atom || atom.name !== 'H' || deletedAtomIds.has(atom.id)) {
    return false;
  }
  if ((atom.bonds?.length ?? 0) !== 1) {
    return false;
  }
  const displayAs = bond?.properties?.display?.as ?? null;
  return atom.visible === true || displayAs === 'wedge' || displayAs === 'dash';
}

/**
 * Collects displayed hydrogens that should disappear along with deleted bonds.
 * @param {object} mol - Molecule being edited.
 * @param {Iterable<string>} deletedBondIds - Bond ids scheduled for deletion.
 * @param {Set<string>} deletedAtomIds - Atom ids already queued for deletion.
 * @returns {Set<string>} Hydrogen atom ids to prune after bond deletion.
 */
function collectDeletedBondHydrogenPruneIds(mol, deletedBondIds, deletedAtomIds) {
  const hydrogenIds = new Set();
  for (const bondId of deletedBondIds) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    for (const atomId of bond.atoms ?? []) {
      const atom = mol.atoms.get(atomId);
      if (shouldPruneDeletedBondHydrogen(atom, bond, deletedAtomIds)) {
        hydrogenIds.add(atom.id);
      }
    }
  }
  return hydrogenIds;
}

/**
 * Creates editing action handlers for deleting atoms/bonds and erasing items in both 2D and force-layout modes.
 * @param {object} context - Dependency context providing state, view, view2D, actions, policies, chemistry, force, overlays, and dom.
 * @returns {object} Object with `deleteSelection`, `deleteTargets`, and `eraseItem`.
 */
export function createEditingActions(context) {
  function clearHovered() {
    context.state.overlayState.getHoveredAtomIds().clear();
    context.state.overlayState.getHoveredBondIds().clear();
  }

  function deleteTargets(atomIds, bondIds, options = {}) {
    const { transient = false } = options;
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();
    const targetAtomIds = transient ? new Set(atomIds) : new Set(selectedAtomIds);
    const targetBondIds = transient ? new Set(bondIds) : new Set(selectedBondIds);

    if (targetAtomIds.size === 0 && targetBondIds.size === 0) {
      return undefined;
    }

    if (!transient) {
      selectedAtomIds.clear();
      selectedBondIds.clear();
      context.view.refreshSelectionOverlay?.();
    }

    const edit = context.actions.performStructuralEdit(
      'delete-selection',
      {
        overlayPolicy: context.policies.reactionPreview.block,
        resonancePolicy: context.policies.resonance.normalizeForEdit,
        snapshotPolicy: context.policies.snapshot.take,
        viewportPolicy: context.policies.viewport.none
      },
      ({ mol, mode }) => {
        const deletedAtomIds = new Set(targetAtomIds);
        const deletedBondIds = new Set(targetBondIds);
        const affectedHeavyIds = new Set();
        const prunableHydrogenIds = collectDeletedBondHydrogenPruneIds(mol, deletedBondIds, deletedAtomIds);

        for (const id of deletedAtomIds) {
          const atom = mol.atoms.get(id);
          if (!atom) {
            continue;
          }
          for (const neighbor of atom.getNeighbors(mol)) {
            if (neighbor.name === 'H' || deletedAtomIds.has(neighbor.id)) {
              continue;
            }
            affectedHeavyIds.add(neighbor.id);
          }
        }

        for (const id of deletedBondIds) {
          const bond = mol.bonds.get(id);
          if (!bond) {
            continue;
          }
          for (const atomId of bond.atoms) {
            const atom = mol.atoms.get(atomId);
            if (!atom || atom.name === 'H' || deletedAtomIds.has(atomId)) {
              continue;
            }
            affectedHeavyIds.add(atomId);
          }
        }

        for (const id of deletedAtomIds) {
          const atom = mol.atoms.get(id);
          if (!atom) {
            continue;
          }
          const attachedHydrogenIds = atom
            .getNeighbors(mol)
            .filter(neighbor => neighbor.name === 'H')
            .map(neighbor => neighbor.id);
          mol.removeAtom(id);
          for (const hydrogenId of attachedHydrogenIds) {
            mol.removeAtom(hydrogenId);
          }
        }

        for (const id of deletedBondIds) {
          if (mol.bonds.has(id)) {
            mol.removeBond(id, { pruneIsolated: false });
          }
        }
        for (const hydrogenId of prunableHydrogenIds) {
          const hydrogen = mol.atoms.get(hydrogenId);
          if (hydrogen?.name === 'H' && (hydrogen.bonds?.length ?? 0) === 0) {
            mol.removeAtom(hydrogenId);
          }
        }

        context.chemistry.clearStereoAnnotations(mol, affectedHeavyIds);
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        repairImplicitHydrogensWhenValenceImproves(mol, affectedHeavyIds);

        return {
          force:
            mode === 'force'
              ? {
                  options: { preservePositions: true, preserveView: true },
                  beforeRender: () => {
                    const patchPos = new Map();
                    const simulation = context.force.getSimulation?.();
                    if (simulation) {
                      for (const node of simulation.nodes()) {
                        if (affectedHeavyIds.has(node.id) && Number.isFinite(node.x) && Number.isFinite(node.y)) {
                          patchPos.set(node.id, { x: node.x, y: node.y });
                        }
                      }
                    }
                    return patchPos;
                  },
                  afterRender: (_editContext, patchPos) => {
                    if (patchPos.size) {
                      context.force.patchNodePositions(patchPos);
                      context.force.reseatHydrogensAroundPatched(patchPos);
                    }
                  },
                  enableKeepInView: mol.atoms.size > 0
                }
              : null,
          twoD:
            mode === '2d'
              ? {
                  preRender: () => {
                    context.view2D.fitCurrentView();
                  }
                }
              : null
        };
      }
    );

    if (edit?.blockedByOverlay) {
      return edit;
    }

    context.dom.flashEraseButton?.();
    return edit;
  }

  function deleteSelection() {
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();
    return deleteTargets(selectedAtomIds, selectedBondIds);
  }

  function eraseItem(atomIds, bondIds) {
    if (context.overlays.hasReactionPreview()) {
      clearHovered();
      return { performed: false, blockedByOverlay: true };
    }
    const eraseTargets = context.overlays.prepareReactionPreviewEraseTargets(atomIds, bondIds);
    if (eraseTargets.atomIds.length === 0 && eraseTargets.bondIds.length === 0) {
      clearHovered();
      return { performed: false, cancelled: true };
    }

    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();
    selectedAtomIds.clear();
    selectedBondIds.clear();
    for (const id of eraseTargets.atomIds) {
      selectedAtomIds.add(id);
    }
    for (const id of eraseTargets.bondIds) {
      selectedBondIds.add(id);
    }

    const result = deleteSelection();
    clearHovered();
    return result;
  }

  return {
    deleteSelection,
    deleteTargets,
    eraseItem
  };
}
