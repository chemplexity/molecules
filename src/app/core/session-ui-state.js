/** @module app/core/session-ui-state */

export function createSessionUiStateBridge(deps) {
  function serializeSnapshotMol(mol) {
    if (!mol) {
      return null;
    }
    const atoms = [];
    for (const [id, atom] of mol.atoms) {
      atoms.push({
        id,
        name: atom.name,
        x: atom.x,
        y: atom.y,
        visible: atom.visible,
        properties: JSON.parse(JSON.stringify(atom.properties))
      });
    }
    const bonds = [];
    for (const [id, bond] of mol.bonds) {
      bonds.push({
        id,
        atoms: [...bond.atoms],
        properties: JSON.parse(JSON.stringify(bond.properties))
      });
    }
    return {
      atoms,
      bonds,
      moleculeProperties: JSON.parse(JSON.stringify(mol.properties ?? {}))
    };
  }

  function updateAnalysisPanels(mol, options = {}) {
    const { recomputeResonance = true, refreshResonancePanel = true } = options;
    if (!mol) {
      deps.document.getElementById('fg-body').innerHTML = '';
      deps.document.getElementById('reaction-body').innerHTML = '';
      deps.clearResonancePanelState();
      return;
    }
    deps.updateFunctionalGroups(mol);
    deps.updateReactionTemplatesPanel();
    if (refreshResonancePanel) {
      deps.updateResonancePanel(mol, { recompute: recomputeResonance });
    }
  }

  function capturePanelState() {
    return {
      descriptorTab: deps.document.querySelector('.desc-tab.active')?.dataset.tab ?? null,
      smartsTab: deps.document.querySelector('.smarts-tab.active')?.dataset.tab ?? null
    };
  }

  function restorePanelState(panelState = null) {
    if (panelState?.descriptorTab) {
      deps.document.querySelectorAll('.desc-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === panelState.descriptorTab));
      deps.document.querySelectorAll('.desc-tab-panel').forEach(panel => {
        panel.style.display = panel.id === `tab-${panelState.descriptorTab}` ? '' : 'none';
      });
    }
    if (panelState?.smartsTab) {
      deps.document.querySelectorAll('.smarts-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === panelState.smartsTab));
      deps.document.querySelectorAll('.smarts-tab-panel').forEach(panel => {
        panel.style.display = panel.id === `tab-${panelState.smartsTab}` ? '' : 'none';
      });
    }
  }

  function captureInteractionState() {
    return {
      selectedAtomIds: [...deps.getSelectedAtomIds()],
      selectedBondIds: [...deps.getSelectedBondIds()],
      toolMode: deps.getDrawBondMode() ? 'draw-bond' : deps.getEraseMode() ? 'erase' : deps.getSelectMode() ? 'select' : 'pan',
      drawBondElement: deps.getDrawBondElement(),
      forceAutoFitEnabled: deps.getForceAutoFitEnabled(),
      forceKeepInView: deps.getForceKeepInView(),
      forceKeepInViewTicks: deps.getForceKeepInViewTicks()
    };
  }

  function restoreInteractionState(snapshot) {
    deps.setSelectedAtomIds(new Set(snapshot.selectedAtomIds ?? []));
    deps.setSelectedBondIds(new Set(snapshot.selectedBondIds ?? []));
    deps.clearHoveredAtomIds();
    deps.clearHoveredBondIds();
    deps.setSelectionModifierActive(false);
    deps.setDrawBondState(null);
    deps.setDrawBondHoverSuppressed(false);
    deps.setErasePainting(false);
    deps.setDrawBondElement(snapshot.drawBondElement ?? 'C');
    deps.setSelectMode(snapshot.toolMode === 'select');
    deps.setDrawBondMode(snapshot.toolMode === 'draw-bond');
    deps.setEraseMode(snapshot.toolMode === 'erase');
    deps.setForceAutoFitEnabled(snapshot.forceAutoFitEnabled ?? true);
    deps.setForceKeepInView(!!snapshot.forceKeepInView);
    deps.setForceKeepInViewTicks(snapshot.forceKeepInViewTicks ?? 0);
    deps.clearDrawBondArtifacts();
    deps.hideTooltip();
    deps.clearSelectionValenceTooltip();
    deps.syncToolButtonsFromState();
    deps.refreshSelectionOverlay();
  }

  return {
    serializeSnapshotMol,
    updateAnalysisPanels,
    capturePanelState,
    restorePanelState,
    captureInteractionState,
    restoreInteractionState
  };
}
