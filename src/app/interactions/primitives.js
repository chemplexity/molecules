/** @module app/interactions/primitives */

function getConnectedComponentAtomIds(mol, seedAtomIds) {
  const componentAtomIds = new Set();
  const queue = [...seedAtomIds];

  for (let head = 0; head < queue.length; head += 1) {
    const atomId = queue[head];
    if (componentAtomIds.has(atomId)) {
      continue;
    }
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    componentAtomIds.add(atomId);
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const nextAtomId = bond.getOtherAtom(atomId);
      if (!componentAtomIds.has(nextAtomId)) {
        queue.push(nextAtomId);
      }
    }
  }

  return componentAtomIds;
}

export function createPrimitiveSelectionActions(context) {
  function select2dComponent(seedAtomIds, additive = false) {
    const mol = context.state.documentState.getMol2d();
    if (!mol) {
      return;
    }
    const componentAtomIds = getConnectedComponentAtomIds(mol, seedAtomIds);
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();

    context.view.clearPrimitiveHover();
    if (!additive) {
      selectedAtomIds.clear();
      selectedBondIds.clear();
    }

    for (const atomId of componentAtomIds) {
      const atom = mol.atoms.get(atomId);
      if (!atom || atom.x == null || atom.visible === false) {
        continue;
      }
      selectedAtomIds.add(atomId);
    }

    for (const bond of mol.bonds.values()) {
      const [a1, a2] = bond.atoms;
      if (!componentAtomIds.has(a1) || !componentAtomIds.has(a2)) {
        continue;
      }
      selectedBondIds.add(bond.id);
    }

    context.renderers.draw2d();
  }

  function select2dPrimitive(atomIds = [], bondIds = [], additive = false) {
    const mol = context.state.documentState.getMol2d();
    if (!mol) {
      return;
    }
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();

    context.view.clearPrimitiveHover();
    if (!additive) {
      selectedAtomIds.clear();
      selectedBondIds.clear();
    }

    for (const atomId of atomIds) {
      const atom = mol.atoms.get(atomId);
      if (!atom || atom.x == null || atom.visible === false) {
        continue;
      }
      if (additive && selectedAtomIds.has(atomId)) {
        selectedAtomIds.delete(atomId);
      } else {
        selectedAtomIds.add(atomId);
      }
    }

    for (const bondId of bondIds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const [a1, a2] = bond.getAtomObjects(mol);
      if (!a1 || !a2 || a1.x == null || a2.x == null) {
        continue;
      }
      const isHiddenBond = a1.visible === false || a2.visible === false;
      if (isHiddenBond && !context.helpers.hasVisibleStereoBond(bond.id)) {
        continue;
      }
      if (additive && selectedBondIds.has(bondId)) {
        selectedBondIds.delete(bondId);
      } else {
        selectedBondIds.add(bondId);
      }
    }

    context.renderers.draw2d();
  }

  function handle2dPrimitiveClick(event, atomIds = [], bondIds = []) {
    if (!context.state.overlayState.getSelectMode() || context.state.viewState.getMode() !== '2d' || !context.state.documentState.getMol2d()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    select2dPrimitive(atomIds, bondIds, context.helpers.isAdditiveSelectionEvent(event));
  }

  function handle2dComponentDblClick(event, seedAtomIds) {
    if (!context.state.overlayState.getSelectMode() || context.state.viewState.getMode() !== '2d' || !context.state.documentState.getMol2d()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    select2dComponent(seedAtomIds, context.helpers.isAdditiveSelectionEvent(event));
  }

  function selectForceComponent(seedAtomIds, additive = false) {
    const mol = context.state.documentState.getCurrentMol();
    if (!mol) {
      return;
    }
    const componentAtomIds = getConnectedComponentAtomIds(mol, seedAtomIds);
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();

    context.view.clearPrimitiveHover();
    if (!additive) {
      selectedAtomIds.clear();
      selectedBondIds.clear();
    }

    for (const atomId of componentAtomIds) {
      if (mol.atoms.has(atomId)) {
        selectedAtomIds.add(atomId);
      }
    }

    for (const bond of mol.bonds.values()) {
      const [a1, a2] = bond.atoms;
      if (!componentAtomIds.has(a1) || !componentAtomIds.has(a2)) {
        continue;
      }
      selectedBondIds.add(bond.id);
    }

    context.renderers.applyForceSelection();
  }

  function selectForcePrimitive(atomIds = [], bondIds = [], additive = false) {
    const mol = context.state.documentState.getCurrentMol();
    if (!mol) {
      return;
    }
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();

    context.view.clearPrimitiveHover();
    if (!additive) {
      selectedAtomIds.clear();
      selectedBondIds.clear();
    }

    for (const atomId of atomIds) {
      if (!mol.atoms.has(atomId)) {
        continue;
      }
      if (additive && selectedAtomIds.has(atomId)) {
        selectedAtomIds.delete(atomId);
      } else {
        selectedAtomIds.add(atomId);
      }
    }

    for (const bondId of bondIds) {
      if (!mol.bonds.has(bondId)) {
        continue;
      }
      if (additive && selectedBondIds.has(bondId)) {
        selectedBondIds.delete(bondId);
      } else {
        selectedBondIds.add(bondId);
      }
    }

    context.renderers.applyForceSelection();
  }

  function handleForcePrimitiveClick(event, atomIds = [], bondIds = []) {
    if (
      !context.state.overlayState.getSelectMode() ||
      context.state.viewState.getMode() !== 'force' ||
      !context.state.documentState.getCurrentMol() ||
      event.defaultPrevented
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectForcePrimitive(atomIds, bondIds, context.helpers.isAdditiveSelectionEvent(event));
  }

  function handleForceComponentDblClick(event, seedAtomIds) {
    if (
      !context.state.overlayState.getSelectMode() ||
      context.state.viewState.getMode() !== 'force' ||
      !context.state.documentState.getCurrentMol() ||
      event.defaultPrevented
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectForceComponent(seedAtomIds, context.helpers.isAdditiveSelectionEvent(event));
  }

  return {
    select2dComponent,
    select2dPrimitive,
    handle2dPrimitiveClick,
    handle2dComponentDblClick,
    selectForceComponent,
    selectForcePrimitive,
    handleForcePrimitiveClick,
    handleForceComponentDblClick
  };
}
