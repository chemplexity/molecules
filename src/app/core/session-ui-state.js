/** @module app/core/session-ui-state */

/**
 * Creates the session UI state bridge that manages panel state, interaction state serialization, and analysis panel updates.
 * @param {object} deps - Dependency object providing document, functional group updaters, reaction/resonance/bond-EN/atom-numbering panel helpers, and selection state accessors.
 * @returns {object} Object with `serializeSnapshotMol`, `updateAnalysisPanels`, `capturePanelState`, `restorePanelState`, `captureInteractionState`, and `restoreInteractionState`.
 */
export function createSessionUiStateBridge(deps) {
  const DEFAULT_SMARTS_TAB = 'functional-groups';

  function _restoreTabState(tabSelector, panelSelector, activeTab) {
    deps.document.querySelectorAll(tabSelector).forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
    deps.document.querySelectorAll(panelSelector).forEach(panel => {
      panel.style.display = panel.id === `tab-${activeTab}` ? '' : 'none';
    });
  }

  function _restoreSmartsTab(tab = DEFAULT_SMARTS_TAB) {
    _restoreTabState('.smarts-tab', '.smarts-tab-panel', tab);
  }

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
      deps.clearBondEnPanel?.();
      deps.clearBondLengthsPanel?.();
      deps.clearAtomNumberingPanel?.();
      return;
    }
    deps.updateFunctionalGroups(mol);
    deps.updateReactionTemplatesPanel();
    if (refreshResonancePanel) {
      deps.updateResonancePanel(mol, { recompute: recomputeResonance });
    }
    deps.updateBondEnPanel?.(mol);
    deps.updateBondLengthsPanel?.(mol);
    deps.updateAtomNumberingPanel?.(mol);
  }

  function capturePanelState() {
    const smartsTab = deps.document.querySelector('.smarts-tab.active')?.dataset.tab ?? null;
    return {
      descriptorTab: deps.document.querySelector('.desc-tab.active')?.dataset.tab ?? null,
      smartsTab: smartsTab === 'other' ? null : smartsTab
    };
  }

  function restorePanelState(panelState = null) {
    if (panelState?.descriptorTab) {
      _restoreTabState('.desc-tab', '.desc-tab-panel', panelState.descriptorTab);
    }
    _restoreSmartsTab(panelState?.smartsTab ?? DEFAULT_SMARTS_TAB);
  }

  function _resolveToolMode() {
    if (deps.getDrawBondMode()) return 'draw-bond';
    if (deps.getEraseMode()) return 'erase';
    if (deps.getSelectMode()) return 'select';
    if (deps.getChargeTool?.() === 'positive') return 'charge-positive';
    if (deps.getChargeTool?.() === 'negative') return 'charge-negative';
    return 'pan';
  }

  function captureInteractionState() {
    return {
      selectedAtomIds: [...deps.getSelectedAtomIds()],
      selectedBondIds: [...deps.getSelectedBondIds()],
      toolMode: _resolveToolMode(),
      chargeTool: deps.getChargeTool?.() ?? null,
      drawBondElement: deps.getDrawBondElement(),
      drawBondType: deps.getDrawBondType?.() ?? 'single',
      forceAutoFitEnabled: deps.getForceAutoFitEnabled(),
      forceKeepInView: deps.getForceKeepInView(),
      forceKeepInViewTicks: deps.getForceKeepInViewTicks()
    };
  }

  function _restoreSelectionState(snapshot) {
    deps.setSelectedAtomIds(new Set(snapshot.selectedAtomIds ?? []));
    deps.setSelectedBondIds(new Set(snapshot.selectedBondIds ?? []));
    deps.clearHoveredAtomIds();
    deps.clearHoveredBondIds();
    deps.setSelectionModifierActive(false);
  }

  function _restoreToolState(snapshot) {
    const restoredChargeTool = snapshot.chargeTool ?? (snapshot.toolMode === 'charge-positive' ? 'positive' : snapshot.toolMode === 'charge-negative' ? 'negative' : null);
    deps.setDrawBondState(null);
    deps.setDrawBondHoverSuppressed(false);
    deps.setErasePainting(false);
    deps.setChargeTool?.(restoredChargeTool);
    deps.setDrawBondElement(snapshot.drawBondElement ?? 'C');
    deps.setDrawBondType?.(snapshot.drawBondType ?? 'single');
    deps.setSelectMode(snapshot.toolMode === 'select');
    deps.setDrawBondMode(snapshot.toolMode === 'draw-bond');
    deps.setEraseMode(snapshot.toolMode === 'erase');
  }

  function _restoreForceState(snapshot) {
    deps.setForceAutoFitEnabled(snapshot.forceAutoFitEnabled ?? true);
    deps.setForceKeepInView(!!snapshot.forceKeepInView);
    deps.setForceKeepInViewTicks(snapshot.forceKeepInViewTicks ?? 0);
  }

  function restoreInteractionState(snapshot) {
    _restoreSelectionState(snapshot);
    _restoreToolState(snapshot);
    _restoreForceState(snapshot);
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
