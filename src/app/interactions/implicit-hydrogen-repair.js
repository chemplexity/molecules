/** @module app/interactions/implicit-hydrogen-repair */

import { validateValence } from '../../validation/index.js';

function collectWarningAtomIds(mol, targetIds) {
  return new Set(validateValence(mol).filter(warning => targetIds.has(warning.atomId)).map(warning => warning.atomId));
}

export function repairImplicitHydrogensWhenValenceImproves(mol, atomIds) {
  if (typeof mol?.repairImplicitHydrogens !== 'function' || typeof mol?.clone !== 'function') {
    return false;
  }

  const targetIds = new Set(
    [...new Set(atomIds ?? [])].filter(atomId => {
      const atom = mol.atoms.get(atomId);
      return atom && atom.name !== 'H';
    })
  );
  if (targetIds.size === 0) {
    return false;
  }

  const warningAtomIdsBefore = collectWarningAtomIds(mol, targetIds);
  if (warningAtomIdsBefore.size === 0) {
    return false;
  }

  const repairedPreview = mol.clone();
  repairedPreview.repairImplicitHydrogens(targetIds);
  const warningAtomIdsAfter = collectWarningAtomIds(repairedPreview, targetIds);

  if (warningAtomIdsAfter.size >= warningAtomIdsBefore.size) {
    return false;
  }

  mol.repairImplicitHydrogens(targetIds);
  return true;
}
