/** @module app/bootstrap/deps/app-runtime-deps */

export function createAppRuntimeDeps(ctx) {
  return {
    Molecule: ctx.Molecule,
    document: ctx.document,
    window: ctx.window,
    runtimeState: ctx.runtimeState,
    input: {
      getInputMode: () => ctx.getInputMode(),
      setInputMode: value => {
        ctx.setInputMode(value);
      },
      getInputValue: () => ctx.inputEl.value
    },
    dom: {
      ...ctx.domElements,
      document: ctx.document,
      plotEl: ctx.plotEl,
      setInputValue: value => {
        ctx.inputEl.value = value;
      }
    },
    io: {
      toSMILES: ctx.toSMILES,
      toInChI: ctx.toInChI
    },
    state: {
      appState: ctx.appState
    },
    selection: {
      getSelectedAtomIds: () => ctx.getSelectedAtomIds(),
      getSelectedBondIds: () => ctx.getSelectedBondIds(),
      setSelectedAtomIds: value => {
        ctx.setSelectedAtomIds(value);
      },
      setSelectedBondIds: value => {
        ctx.setSelectedBondIds(value);
      },
      getSelectMode: () => ctx.getSelectMode(),
      setSelectMode: value => {
        ctx.setSelectMode(value);
      },
      getDrawBondMode: () => ctx.getDrawBondMode(),
      setDrawBondMode: value => {
        ctx.setDrawBondMode(value);
      },
      getEraseMode: () => ctx.getEraseMode(),
      setEraseMode: value => {
        ctx.setEraseMode(value);
      },
      getDrawBondElement: () => ctx.getDrawBondElement(),
      setDrawBondElement: value => {
        ctx.setDrawBondElement(value);
      },
      clearSelection: () => {
        ctx.clearSelection();
      },
      clearHovered: () => {
        ctx.clearHovered();
      },
      clearHoveredAtomIds: () => ctx.clearHoveredAtomIds(),
      clearHoveredBondIds: () => ctx.clearHoveredBondIds(),
      setSelectionModifierActive: value => {
        ctx.setSelectionModifierActive(value);
      },
      setErasePainting: value => {
        ctx.setErasePainting(value);
      },
      syncToolButtonsFromState: () => ctx.syncToolButtonsFromState(),
      refreshSelectionOverlay: () => ctx.refreshSelectionOverlay()
    },
    drawBond: {
      setDrawBondState: value => {
        ctx.setDrawBondState(value);
      },
      setDrawBondHoverSuppressed: value => {
        ctx.setDrawBondHoverSuppressed(value);
      },
      clearArtifacts: () => ctx.clearDrawBondArtifacts()
    },
    force: {
      getAutoFitEnabled: () => ctx.getForceAutoFitEnabled(),
      setAutoFitEnabled: value => {
        ctx.setForceAutoFitEnabled(value);
      },
      getKeepInView: () => ctx.getForceKeepInView(),
      setKeepInView: value => {
        ctx.setForceKeepInView(value);
      },
      getKeepInViewTicks: () => ctx.getForceKeepInViewTicks(),
      setKeepInViewTicks: value => {
        ctx.setForceKeepInViewTicks(value);
      },
      disableKeepInView: () => ctx.disableForceKeepInView(),
      getNodePositions: () =>
        ctx.simulation.nodes().map(node => ({
          id: node.id,
          x: node.x,
          y: node.y,
          vx: node.vx,
          vy: node.vy,
          anchorX: node.anchorX,
          anchorY: node.anchorY
        })),
      clearGraph: () => {
        ctx.simulation.nodes([]);
        ctx.simulation.force('link').links([]);
      },
      stop: () => {
        ctx.simulation.stop();
      },
      restoreNodePositions: positionMap => {
        for (const node of ctx.simulation.nodes()) {
          const position = positionMap.get(node.id);
          if (!position) {
            continue;
          }
          node.x = position.x;
          node.y = position.y;
          node.vx = Number.isFinite(position.vx) ? position.vx : 0;
          node.vy = Number.isFinite(position.vy) ? position.vy : 0;
          node.anchorX = Number.isFinite(position.anchorX) ? position.anchorX : node.anchorX;
          node.anchorY = Number.isFinite(position.anchorY) ? position.anchorY : node.anchorY;
        }
      },
      restart: () => {
        ctx.simulation.alpha(0.18).restart();
      },
      clearIfActive: () => {
        if (ctx.runtimeState.mode === 'force') {
          ctx.simulation.nodes([]);
          ctx.simulation.force('link').links([]);
          ctx.simulation.stop();
        }
      },
      structuralEdit: {
        getSimulation: () => ctx.simulation,
        isHydrogenNode: ctx.isHydrogenNode,
        placeHydrogensAroundParent: (parent, hydrogens, links, options = {}) => ctx.forceHelpers.placeHydrogensAroundParent(parent, hydrogens, links, options),
        patchNodePositions: patchPos => ctx.forceHelpers.patchForceNodePositions(patchPos),
        reseatHydrogensAroundPatched: patchPos => ctx.forceHelpers.reseatHydrogensAroundPatched(patchPos)
      }
    },
    scene: {
      clear: () => {
        ctx.g.selectAll('*').remove();
      },
      draw2d: () => ctx.getDraw2D()(),
      updateForce: (mol, options = {}) => ctx.forceSceneRenderer.updateForce(mol, options)
    },
    cache: {
      reset: () => {
        ctx.resetForceRenderCaches();
      }
    },
    runtime: {
      syncInputField: mol => ctx.syncInputField(mol),
      captureAppSnapshot: options => ctx.captureAppSnapshot(options),
      restoreSnapshot: snap => ctx.restoreSnapshot(snap)
    },
    renderers: {
      inputFlow: ctx.inputFlowRenderers,
      renderRuntime: ctx.renderRuntime
    },
    analysis: {
      updateFunctionalGroups: mol => ctx.updateFunctionalGroups(mol),
      updateFormula: mol => ctx.updateFormula(mol),
      updateDescriptors: mol => ctx.updateDescriptors(mol),
      updatePanels: (mol, options = {}) => ctx.updateAnalysisPanels(mol, options),
      updatePanelsForController: mol => ctx.updateAnalysisPanels(mol),
      clearFormula: () => ctx.domElements.clearFormula(),
      clearWeight: () => ctx.domElements.clearWeight(),
      clearDescriptors: () => ctx.domElements.clearDescriptors(),
      clearFunctionalGroups: () => ctx.domElements.clearFunctionalGroups(),
      clearSummary: () => ctx.domElements.clearSummary(),
      clearSelectionValenceTooltip: () => {
        ctx.runtimeState.selectionValenceTooltipAtomId = null;
      }
    },
    overlays: {
      updateReactionTemplatesPanel: () => ctx.updateReactionTemplatesPanel(),
      updateResonancePanel: (mol, options = {}) => ctx.updateResonancePanel(mol, options),
      clearResonancePanelState: () => ctx.clearResonancePanelState(),
      updateBondEnPanel: mol => ctx.updateBondEnPanel(mol),
      clearBondEnPanel: () => ctx.clearBondEnPanel(),
      captureReactionPreviewSnapshot: () => ctx.captureReactionPreviewSnapshot(),
      restoreReactionPreviewSnapshot: snap => ctx.restoreReactionPreviewSnapshot(snap),
      clearReactionPreviewState: () => ctx.clearReactionPreviewState(),
      reapplyActiveReactionPreview: () => ctx.reapplyActiveReactionPreview(),
      hasReactionPreview: () => ctx.hasReactionPreview(),
      prepareReactionPreviewBondEditTarget: bondId => ctx.prepareReactionPreviewBondEditTarget(bondId),
      prepareReactionPreviewEditTargets: payload => ctx.prepareReactionPreviewEditTargets(payload)
    },
    resonance: {
      prepareResonanceUndoSnapshot: mol => ctx.prepareResonanceUndoSnapshot(mol),
      restoreResonanceViewSnapshot: (mol, snap) => ctx.restoreResonanceViewSnapshot(mol, snap),
      prepareResonanceStructuralEdit: mol => ctx.prepareResonanceStructuralEdit(mol),
      prepareResonanceStateForStructuralEdit: mol => ctx.prepareResonanceStateForStructuralEdit(mol)
    },
    highlights: {
      captureHighlightSnapshot: () => ctx.captureHighlightSnapshot(),
      clearHighlightState: () => ctx.clearHighlightState(),
      restoreFunctionalGroupHighlightSnapshot: (snapshot, mol) => ctx.restoreHighlightSnapshot(snapshot, mol),
      restorePhyschemHighlightSnapshot: snapshot => ctx.restorePhyschemHighlightSnapshot(snapshot),
      restorePersistentHighlight: () => ctx.restorePersistentHighlight()
    },
    history: {
      takeSnapshot: options => ctx.takeSnapshot(options)
    },
    view: {
      updateModeChrome: nextMode => ctx.updateModeChrome(nextMode),
      restoreZoomTransformSnapshot: snapshot => ctx.restoreZoomTransformSnapshot(snapshot),
      captureZoomTransformSnapshot: () => ctx.captureZoomTransformSnapshot(),
      restoreZoomTransform: snapshot => ctx.zoomTransformHelpers.restoreZoomTransformSnapshot(snapshot),
      captureZoomTransform: () => ctx.zoomTransformHelpers.captureZoomTransformSnapshot(),
      zoomToFitIf2d: () => ctx.zoomToFitIf2d(),
      hideTooltip: () => {
        ctx.tooltip.interrupt().style('opacity', 0);
      }
    },
    molecule: {
      getMolSmiles: () => ctx.window._getMolSmiles?.() ?? null,
      getMolInchi: () => ctx.window._getMolInchi?.() ?? null
    },
    parsers: {
      parseSMILES: ctx.parseSMILES,
      parseINCHI: ctx.parseINCHI,
      detectChemicalStringFormat: ctx.detectChemicalStringFormat
    },
    chemistry: {
      kekulize: ctx.kekulize,
      refreshAromaticity: ctx.refreshAromaticity
    },
    actions: {
      navigationActions: ctx.navigationActions
    },
    data: {
      exampleMolecules: ctx.exampleMolecules,
      randomMolecule: ctx.window.randomMolecule ?? [],
      moleculeCatalog: ctx.moleculeCatalog
    },
    constants: {
      forceBondLength: ctx.forceBondLength
    }
  };
}
