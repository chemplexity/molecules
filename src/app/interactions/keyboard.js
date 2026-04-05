/** @module app/interactions/keyboard */

export function initKeyboardInteractions(context) {
  const { doc = document, win = window } = context;

  doc.addEventListener('keydown', event => {
    if (event.key === 'Meta' || event.key === 'Control') {
      const nextActive = !!(event.metaKey || event.ctrlKey);
      if (context.state.overlayState.getSelectionModifierActive() !== nextActive) {
        context.state.overlayState.setSelectionModifierActive(nextActive);
        context.view.refreshSelectionOverlay();
      }
    }

    const tag = doc.activeElement?.tagName;
    const isTextInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
      if (isTextInput) {
        return;
      }
      const mol = context.state.documentState.getActiveMolecule();
      if (mol) {
        if (!context.state.overlayState.getSelectMode()) {
          context.selection.toggleSelectMode();
        }
        for (const [id] of mol.atoms) {
          context.state.overlayState.getSelectedAtomIds().add(id);
        }
        for (const [id] of mol.bonds) {
          context.state.overlayState.getSelectedBondIds().add(id);
        }
        context.view.applySelectionOverlay();
      }
      event.preventDefault();
      return;
    }

    if (isTextInput) {
      return;
    }

    const PAN_STEP = 40;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const dx = event.key === 'ArrowLeft' ? PAN_STEP : event.key === 'ArrowRight' ? -PAN_STEP : 0;
      const dy = event.key === 'ArrowUp' ? PAN_STEP : event.key === 'ArrowDown' ? -PAN_STEP : 0;
      const t = context.view.getZoomTransform();
      context.view.setZoomTransform(context.view.makeZoomIdentity(t.x + dx, t.y + dy, t.k));
      event.preventDefault();
      return;
    }

    if (event.key === 'Escape') {
      if (context.drawBond.hasDrawBondState()) {
        context.drawBond.cancelDrawBond();
        event.preventDefault();
        return;
      }
      if (context.state.overlayState.getDrawBondMode()) {
        context.selection.toggleDrawBondMode();
        event.preventDefault();
        return;
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      context.history.redo();
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === 'z') {
      context.history.undo();
      event.preventDefault();
      return;
    }

    const selectMode = context.state.overlayState.getSelectMode();
    const drawBondMode = context.state.overlayState.getDrawBondMode();
    const eraseMode = context.state.overlayState.getEraseMode();
    const hoveredAtomIds = context.state.overlayState.getHoveredAtomIds();

    if ((selectMode || (drawBondMode && !context.drawBond.hasDrawBondState())) && hoveredAtomIds.size > 0 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const elementKeys = {
        c: 'C',
        C: 'C',
        n: 'N',
        N: 'N',
        o: 'O',
        O: 'O',
        s: 'S',
        S: 'S',
        p: 'P',
        P: 'P',
        f: 'F',
        F: 'F',
        i: 'I',
        I: 'I',
        b: 'B',
        B: 'B',
        k: 'K',
        K: 'K'
      };
      const newEl = elementKeys[event.key];
      if (newEl) {
        const mol = context.state.documentState.getActiveMolecule();
        if (mol) {
          const toChange = [...hoveredAtomIds].filter(id => {
            if (!context.overlays.isReactionPreviewEditableAtomId(id)) {
              return false;
            }
            const atom = mol.atoms.get(id);
            return atom && atom.name !== newEl;
          });
          if (toChange.length > 0) {
            context.actions.changeAtomElements(toChange, newEl);
          }
        }
        event.preventDefault();
        return;
      }
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }
    if (
      (selectMode || eraseMode || (drawBondMode && !context.drawBond.hasDrawBondState())) &&
      context.state.overlayState.getSelectedAtomIds().size === 0 &&
      context.state.overlayState.getSelectedBondIds().size === 0 &&
      (context.state.overlayState.getHoveredAtomIds().size > 0 || context.state.overlayState.getHoveredBondIds().size > 0)
    ) {
      for (const id of context.state.overlayState.getHoveredAtomIds()) {
        context.state.overlayState.getSelectedAtomIds().add(id);
      }
      for (const id of context.state.overlayState.getHoveredBondIds()) {
        context.state.overlayState.getSelectedBondIds().add(id);
      }
      context.view.clearPrimitiveHover();
    }
    context.actions.deleteSelection();
    event.preventDefault();
  });

  doc.addEventListener('keyup', event => {
    if (event.key !== 'Meta' && event.key !== 'Control') {
      return;
    }
    const nextActive = !!(event.metaKey || event.ctrlKey);
    if (context.state.overlayState.getSelectionModifierActive() !== nextActive) {
      context.state.overlayState.setSelectionModifierActive(nextActive);
      context.view.refreshSelectionOverlay();
    }
  });

  win.addEventListener('blur', () => {
    if (!context.state.overlayState.getSelectionModifierActive()) {
      return;
    }
    context.state.overlayState.setSelectionModifierActive(false);
    context.view.refreshSelectionOverlay();
  });
}
