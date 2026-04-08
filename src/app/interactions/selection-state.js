/** @module app/interactions/selection-state */

/**
 * Creates selection state helpers for syncing selection to a molecule and resolving which atoms to drag based on current selection.
 * @param {object} context - Dependency context providing a `state` object with selection getters and setters.
 * @returns {object} Object with `syncSelectionToMolecule` and `getSelectedDragAtomIds` helper functions.
 */
export function createSelectionStateHelpers(context) {
  function syncSelectionToMolecule(mol) {
    const selectedAtomIds = context.state.getSelectedAtomIds();
    const selectedBondIds = context.state.getSelectedBondIds();
    context.state.setSelectedAtomIds(new Set([...selectedAtomIds].filter(id => mol.atoms.has(id))));
    context.state.setSelectedBondIds(new Set([...selectedBondIds].filter(id => mol.bonds.has(id))));
  }

  function getSelectedDragAtomIds(mol, atomIds = [], bondIds = []) {
    if (!mol) {
      return null;
    }

    const selectedAtomIds = context.state.getSelectedAtomIds();
    const selectedBondIds = context.state.getSelectedBondIds();
    if (selectedAtomIds.size === 0 && selectedBondIds.size === 0) {
      return null;
    }

    let dragStartsOnSelection = false;
    for (const atomId of atomIds) {
      if (selectedAtomIds.has(atomId)) {
        dragStartsOnSelection = true;
        break;
      }
    }
    if (!dragStartsOnSelection) {
      for (const bondId of bondIds) {
        if (selectedBondIds.has(bondId)) {
          dragStartsOnSelection = true;
          break;
        }
      }
    }
    if (!dragStartsOnSelection) {
      return null;
    }

    const selectedDragAtomIds = new Set();
    for (const atomId of selectedAtomIds) {
      if (mol.atoms.has(atomId)) {
        selectedDragAtomIds.add(atomId);
      }
    }
    for (const bondId of selectedBondIds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      for (const atomId of bond.atoms) {
        if (mol.atoms.has(atomId)) {
          selectedDragAtomIds.add(atomId);
        }
      }
    }
    return selectedDragAtomIds.size > 0 ? selectedDragAtomIds : null;
  }

  return {
    syncSelectionToMolecule,
    getSelectedDragAtomIds
  };
}
