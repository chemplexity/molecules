/** @module app/interactions/editing */

export function createEditingActions(context) {
  function clearHovered() {
    context.state.overlayState.getHoveredAtomIds().clear();
    context.state.overlayState.getHoveredBondIds().clear();
  }

  function deleteTargets(atomIds, bondIds, options = {}) {
    const {
      transient = false
    } = options;
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

        context.chemistry.clearStereoAnnotations(mol, affectedHeavyIds);
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        mol.repairImplicitHydrogens(affectedHeavyIds);

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
