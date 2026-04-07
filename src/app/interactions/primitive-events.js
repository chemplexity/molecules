/** @module app/interactions/primitive-events */

export function createPrimitiveEventHandlers(context) {
  function showPrimitiveHover(atomIds = [], bondIds = []) {
    if (context.view.isPrimitiveHoverSuppressed?.()) {
      context.view.setPrimitiveHoverSuppressed?.(false);
      return false;
    }
    context.view.showPrimitiveHover(atomIds, bondIds);
    return true;
  }

  function maybeRefreshDrawBondHover(id, kind) {
    if (!context.state.overlayState.getDrawBondMode() || context.view.isDrawBondHoverSuppressed()) {
      return;
    }
    if (kind === 'atom') {
      context.state.overlayState.getHoveredAtomIds().add(id);
    } else {
      context.state.overlayState.getHoveredBondIds().add(id);
    }
    context.view.refreshSelectionOverlay();
  }

  function clearHoverOnExit() {
    if (context.drawBond.hasDrawBondState()) {
      context.drawBond.resetHover();
    } else {
      context.view.clearPrimitiveHover();
      context.view.refreshSelectionOverlay();
    }
  }

  function handle2dBondClick(event, bondId) {
    if (context.state.overlayState.getDrawBondMode()) {
      context.actions.promoteBondOrder(bondId, { drawBondType: context.drawBond.getType?.() ?? 'single' });
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      context.actions.eraseItem([], [bondId]);
      return;
    }
    context.selection.handle2dPrimitiveClick(event, [], [bondId]);
  }

  function handle2dBondDblClick(event, atomIds) {
    context.selection.handle2dComponentDblClick(event, atomIds);
  }

  function handle2dBondMouseOver(event, bond, atom1, atom2) {
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      showPrimitiveHover([], [bond.id]);
      return;
    }
    if (!showPrimitiveHover([], [bond.id])) {
      return;
    }
    maybeRefreshDrawBondHover(bond.id, 'bond');
    if (context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) {
      return;
    }
    context.tooltip.showDelayed(context.formatters.bondTooltipHtml(bond, atom1, atom2), event, 150);
  }

  function handle2dBondMouseMove(event) {
    context.tooltip.move(event);
  }

  function handle2dBondMouseOut() {
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handle2dAtomMouseDownDrawBond(event, atomId) {
    if (!context.state.overlayState.getDrawBondMode() || context.state.viewState.getMode() !== '2d' || !context.state.documentState.getMol2d()) {
      return;
    }
    if (!context.overlays.isReactionPreviewEditableAtomId(atomId)) {
      return;
    }
    event.stopPropagation();
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    context.drawBond.start(atomId, gX, gY);
  }

  function handle2dAtomClick(event, atomId) {
    if (context.state.overlayState.getDrawBondMode()) {
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      context.actions.eraseItem([atomId], []);
      return;
    }
    context.selection.handle2dPrimitiveClick(event, [atomId], []);
  }

  function handle2dAtomDblClick(event, atomId) {
    context.selection.handle2dComponentDblClick(event, [atomId]);
  }

  function handle2dAtomMouseOver(event, atom, mol, valenceWarning) {
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      showPrimitiveHover([atom.id], []);
      return;
    }
    if (!showPrimitiveHover([atom.id], [])) {
      return;
    }
    maybeRefreshDrawBondHover(atom.id, 'atom');
    const showAtomTooltips = context.options.getRenderOptions().showAtomTooltips;
    if (!showAtomTooltips || (context.state.overlayState.getEraseMode() && !valenceWarning) || ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode()) && !valenceWarning)) {
      return;
    }
    if ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) && valenceWarning) {
      context.tooltipState.setSelectionValenceTooltipAtomId(atom.id);
      context.tooltip.showImmediate(context.formatters.atomTooltipHtml(atom, mol, valenceWarning, '2d'), event);
      return;
    }
    context.tooltip.showDelayed(context.formatters.atomTooltipHtml(atom, mol, valenceWarning, '2d'), event, 150);
  }

  function handle2dAtomMouseMove(event) {
    context.tooltip.move(event);
  }

  function handle2dAtomMouseOut(atomId) {
    if (context.state.overlayState.getSelectMode() && context.tooltipState.getSelectionValenceTooltipAtomId() === atomId) {
      return;
    }
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handleForceBondClick(event, bondId, molecule) {
    if (context.state.overlayState.getDrawBondMode()) {
      context.actions.promoteBondOrder(bondId, { drawBondType: context.drawBond.getType?.() ?? 'single' });
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      const bond = molecule.bonds.get(bondId);
      if (bond?.atoms.some(id => molecule.atoms.get(id)?.name === 'H')) {
        return;
      }
      context.actions.eraseItem([], [bondId]);
      return;
    }
    context.selection.handleForcePrimitiveClick(event, [], [bondId]);
  }

  function handleForceBondDblClick(event, atomIds) {
    context.selection.handleForceComponentDblClick(event, atomIds);
  }

  function handleForceBondMouseOver(event, bondId, molecule) {
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      const bond = molecule.bonds.get(bondId);
      if (bond?.atoms.some(id => molecule.atoms.get(id)?.name === 'H')) {
        return;
      }
      showPrimitiveHover([], [bondId]);
      return;
    }
    if (!showPrimitiveHover([], [bondId])) {
      return;
    }
    maybeRefreshDrawBondHover(bondId, 'bond');
    if (context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) {
      return;
    }
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      return;
    }
    const atom1 = molecule.atoms.get(bond.atoms[0]);
    const atom2 = molecule.atoms.get(bond.atoms[1]);
    if (!atom1 || !atom2) {
      return;
    }
    context.tooltip.showDelayed(context.formatters.bondTooltipHtml(bond, atom1, atom2), event, 150);
  }

  function handleForceBondMouseMove(event) {
    context.tooltip.move(event);
  }

  function handleForceBondMouseOut() {
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handleForceAtomMouseDownDrawBond(event, atom) {
    if (!context.state.overlayState.getDrawBondMode() || context.state.viewState.getMode() !== 'force' || !context.state.documentState.getCurrentMol()) {
      return;
    }
    if (atom.name === 'H') {
      return;
    }
    if (!context.overlays.isReactionPreviewEditableAtomId(atom.id)) {
      return;
    }
    event.stopPropagation();
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    context.drawBond.start(atom.id, gX, gY);
  }

  function handleForceAtomClick(event, atom, molecule) {
    if (context.state.overlayState.getDrawBondMode()) {
      if (!context.overlays.isReactionPreviewEditableAtomId(atom.id)) {
        event.stopPropagation();
        return;
      }
      if (atom.name === 'H' && atom.name !== context.drawBond.getElement()) {
        event.stopPropagation();
        const drawType = context.drawBond.getType?.() ?? 'single';
        if (drawType === 'wedge' || drawType === 'dash') {
          const molAtom = molecule.atoms.get(atom.id);
          const parentAtom = molAtom?.getNeighbors(molecule).find(n => n.name !== 'H');
          if (parentAtom) {
            const [gX, gY] = context.pointer(event, context.dom.gNode());
            context.actions.autoPlaceBond(parentAtom.id, gX, gY);
            return;
          }
        }
        context.actions.replaceForceHydrogenAtom(atom.id, molecule);
      }
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      if (atom.name === 'H') {
        return;
      }
      context.actions.eraseItem([atom.id], []);
      return;
    }
    context.selection.handleForcePrimitiveClick(event, [atom.id], []);
  }

  function handleForceAtomDblClick(event, atomId) {
    context.selection.handleForceComponentDblClick(event, [atomId]);
  }

  function handleForceAtomMouseOver(event, atomNode, molecule, valenceWarning) {
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      if (atomNode.name === 'H') {
        return;
      }
      showPrimitiveHover([atomNode.id], []);
      return;
    }
    if (!showPrimitiveHover([atomNode.id], [])) {
      return;
    }
    maybeRefreshDrawBondHover(atomNode.id, 'atom');
    const atom = molecule.atoms.get(atomNode.id);
    if (!atom) {
      return;
    }
    const showAtomTooltips = context.options.getRenderOptions().showAtomTooltips;
    if (!showAtomTooltips || (context.state.overlayState.getEraseMode() && !valenceWarning) || ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode()) && !valenceWarning)) {
      return;
    }
    if ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) && valenceWarning) {
      context.tooltipState.setSelectionValenceTooltipAtomId(atomNode.id);
      context.tooltip.showImmediate(context.formatters.atomTooltipHtml(atom, molecule, valenceWarning, 'force'), event);
      return;
    }
    context.tooltip.showDelayed(context.formatters.atomTooltipHtml(atom, molecule, valenceWarning, 'force'), event, 200);
  }

  function handleForceAtomMouseMove(event) {
    context.tooltip.move(event);
  }

  function handleForceAtomMouseOut(atomId) {
    if (context.state.overlayState.getSelectMode() && context.tooltipState.getSelectionValenceTooltipAtomId() === atomId) {
      return;
    }
    clearHoverOnExit();
    context.tooltip.hide();
  }

  return {
    handle2dBondClick,
    handle2dBondDblClick,
    handle2dBondMouseOver,
    handle2dBondMouseMove,
    handle2dBondMouseOut,
    handle2dAtomMouseDownDrawBond,
    handle2dAtomClick,
    handle2dAtomDblClick,
    handle2dAtomMouseOver,
    handle2dAtomMouseMove,
    handle2dAtomMouseOut,
    handleForceBondClick,
    handleForceBondDblClick,
    handleForceBondMouseOver,
    handleForceBondMouseMove,
    handleForceBondMouseOut,
    handleForceAtomMouseDownDrawBond,
    handleForceAtomClick,
    handleForceAtomDblClick,
    handleForceAtomMouseOver,
    handleForceAtomMouseMove,
    handleForceAtomMouseOut
  };
}
