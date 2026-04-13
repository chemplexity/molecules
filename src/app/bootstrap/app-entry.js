import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import { finalizeAppBootstrap } from './app-bootstrap.js';
import { createFinalizeAppBootstrapDeps } from './deps/finalize-bootstrap-deps.js';
import { initializeAppRuntime } from './app-runtime.js';
import { createAppRuntimeDeps } from './deps/app-runtime-deps.js';
import { DRAW_ELEM_PROTONS, createInteractionRuntimeDeps } from './deps/interaction-runtime-deps.js';
import { createBootstrapDom } from './dom-elements.js';
import { exampleMolecules } from './example-molecules.js';
import { initializeInteractionRuntime } from './interaction-runtime.js';
import { atomBBoxFallback, enLabelColor, initForceSimulation, initPlotBootstrap } from './plot-bootstrap.js';
import { initializeRuntimeBridges } from './runtime-bridges.js';
import { VALENCE_WARNING_FILL, createRuntimeState } from './runtime-state.js';
import { parseSMILES, toSMILES } from '../../io/smiles.js';
import { Molecule } from '../../core/Molecule.js';
import { parseINCHI, toInChI } from '../../io/inchi.js';
import { detectChemicalStringFormat } from '../../io/detect.js';
import { moleculeCatalog } from '../../data/molecule-catalog.js';
import { validateValence } from '../../validation/index.js';
import { refreshAromaticity } from '../../algorithms/aromaticity.js';
import {
  refineExistingCoords as refineExistingCoordsLegacy,
  generateAndRefine2dCoords as generateAndRefine2dCoordsLegacy
} from '../../layout/index.js';
import { applyCoords as applyComputedCoords } from '../../layoutv2/apply.js';
import { generateCoords as generateComputedCoords, refineCoords as refineComputedCoords } from '../../layoutv2/api.js';
import * as mol2dHelpers from '../../layout/mol2d-helpers.js';
import { updateDescriptors, updateFormula } from '../ui/descriptors.js';
import { initUndo, takeSnapshot as _takeSnapshot, discardLastSnapshot as _discardLastSnapshot, clearHistory as _clearUndoHistory, undoAction, redoAction } from '../core/undo.js';
import { createAppDelegates } from '../core/app-delegates.js';
import { ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../core/editor-actions.js';
import { initOptionsModal } from '../ui/options-modal.js';
import { createOptionsModalDeps } from '../ui/deps/options-modal-deps.js';
import { initAppShell } from '../ui/app-shell.js';
import { createAppShellDeps } from '../ui/deps/app-shell-deps.js';
import { initPhyschemPanel } from '../ui/physchem-panel.js';
import { createPhyschemPanelDeps } from '../ui/deps/physchem-panel-deps.js';
import { initPlotInteractions } from '../ui/plot-interactions.js';
import { initTabPanels } from '../ui/tab-panels.js';
import { initExport, copyForcePng, copyForceSvg, copySvg2d, savePng2d } from '../ui/export.js';
import { createSelectionStateHelpers } from '../interactions/selection-state.js';
import {
  BOND_OFFSET,
  STROKE_W,
  RENDER_OPTION_LIMITS,
  getDefaultRenderOptions,
  getRenderOptions,
  updateRenderOptions,
  atomColor,
  strokeColor,
  singleBondWidth,
  atomRadius,
  bondTooltipHtml,
  atomTooltipHtml
} from '../render/helpers.js';
import {
  _setHighlight,
  _prepare2dExportHighlightState,
  _restorePersistentHighlight,
  updateFunctionalGroups,
  getHighlightedAtomIds,
  captureHighlightSnapshot,
  restoreHighlightSnapshot,
  clearHighlightState,
  create2DHighlightRenderer,
  createForceHighlightRenderer,
  initHighlights,
  setPersistentHighlightFallback
} from '../render/highlights.js';
import {
  initReaction2d,
  _clearReactionPreviewState,
  _captureReactionPreviewSnapshot,
  _getReactionPreviewSourceMol,
  _restoreReactionPreviewSnapshot,
  _restoreReactionPreviewSource,
  _prepareReactionPreviewEditTargets,
  _prepareReactionPreviewBondEditTarget,
  _prepareReactionPreviewEraseTargets,
  _hasReactionPreview,
  _isReactionPreviewEditableAtomId,
  _centerReaction2dPairCoords,
  _spreadReaction2dProductComponents,
  _alignReaction2dProductOrientation,
  _drawReactionPreviewArrow2d,
  _renderReactionPreviewArrowForce,
  _reapplyActiveReactionPreview,
  updateReactionTemplatesPanel,
  _viewportFitPadding,
  _getReactionPreviewReactantAtomIds,
  _getReactionPreviewMappedAtomPairs
} from '../render/reaction-2d.js';
import { createReaction2dDeps } from '../render/deps/reaction-2d-deps.js';
import {
  create2DHighlightRendererDeps,
  create2DSceneRendererDeps,
  createForceHighlightRendererDeps,
  createForceSceneRendererDeps,
  createForceSelectionRendererDeps,
  createForceViewportStateDeps,
  createSelectionOverlayManagerDeps
} from '../render/deps/scene-deps.js';
import {
  initResonancePanel,
  updateResonancePanel,
  clearResonancePanelState,
  resetActiveResonanceView,
  prepareResonanceStateForStructuralEdit,
  prepareResonanceUndoSnapshot,
  restoreResonanceViewSnapshot
} from '../render/resonance.js';
import { initBondEnPanel, updateBondEnPanel, clearBondEnPanel } from '../render/bond-en-polarity.js';
import { initAtomNumberingPanel, updateAtomNumberingPanel, clearAtomNumberingPanel } from '../render/atom-numbering.js';
import { createBondEnPanelDeps, createResonancePanelDeps, createAtomNumberingPanelDeps } from '../render/deps/panel-deps.js';
import { createForceSceneRenderer } from '../render/force-scene.js';
import { createForceViewportStateHelpers } from '../render/force-viewport-state.js';
import {
  FORCE_LAYOUT_BOND_LENGTH,
  FORCE_LAYOUT_INITIAL_FIT_PAD,
  FORCE_LAYOUT_INITIAL_H_RADIUS_SCALE,
  FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER,
  FORCE_LAYOUT_INITIAL_KEEP_IN_VIEW_TICKS,
  FORCE_LAYOUT_FIT_PAD,
  FORCE_LAYOUT_KEEP_IN_VIEW_ALPHA_MIN,
  FORCE_LAYOUT_HEAVY_REPULSION,
  FORCE_LAYOUT_H_REPULSION,
  FORCE_LAYOUT_EDIT_KEEP_IN_VIEW_TICKS,
  createForceAnchorRadiusForce,
  createForceHydrogenRepulsionForce,
  createForceHelpers,
  forceLinkDistance,
  isHydrogenNode
} from '../render/force-helpers.js';
import { create2DSceneRenderer } from '../render/scene-2d.js';
import { create2DRenderHelpers } from '../render/2d-helpers.js';
import { createForceSelectionRenderer, createSelectionOverlayManager } from '../render/selection-overlay.js';
import { createZoomTransformHelpers } from '../render/zoom-transform.js';
import { initNavigationInteractions } from '../interactions/navigation.js';
import { initGestureInteractions, isAdditiveSelectionEvent } from '../interactions/gesture-layer.js';
import { initKeyboardInteractions } from '../interactions/keyboard.js';

const { WEDGE_HALF_W, WEDGE_DASHES, perpUnit, shortenLine, secondaryDir, labelHalfW, syncDisplayStereo, flipDisplayStereo, kekulize } = mol2dHelpers;

window.setInputFormat = (fmt, options = {}) => {
  window._setInputFormat?.(fmt, options);
};
window.renderExamples = () => {
  window._renderExamples?.();
};
window.pickRandomMolecule = () => {
  window._pickRandomMolecule?.();
};
window.parseInput = value => {
  window._parseInput?.(value);
};
window._getExampleMolecules = () => exampleMolecules;

const atomBBox = mol2dHelpers.atomBBox ?? atomBBoxFallback;

function getSelected2dRendererVersion() {
  return getRenderOptions().twoDRendererVersion === 'v1' ? 'v1' : 'v2';
}

function readPlacedCoords(molecule, options = {}) {
  const coords = new Map();
  if (!molecule?.atoms) {
    return coords;
  }
  const suppressH = options.suppressH ?? false;
  for (const atom of molecule.atoms.values()) {
    if (suppressH && atom.name === 'H') {
      continue;
    }
    if (Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
      coords.set(atom.id, { x: atom.x, y: atom.y });
    }
  }
  return coords;
}

function buildComputedLayoutOptions(options = {}) {
  return {
    suppressH: options.suppressH ?? true,
    bondLength: options.bondLength ?? 1.5,
    maxCleanupPasses: options.maxCleanupPasses ?? options.maxPasses ?? 6
  };
}

function generateActive2dCoords(molecule, options = {}) {
  if (getSelected2dRendererVersion() === 'v1') {
    return generateAndRefine2dCoordsLegacy(molecule, options);
  }
  const result = generateComputedCoords(molecule, buildComputedLayoutOptions(options));
  applyComputedCoords(molecule, result, {
    clearUnplaced: true,
    hiddenHydrogenMode: 'coincident',
    syncStereoDisplay: true
  });
  return result.coords;
}

function generateAndRefineActive2dCoords(molecule, options = {}) {
  if (getSelected2dRendererVersion() === 'v1') {
    return generateAndRefine2dCoordsLegacy(molecule, options);
  }
  return generateActive2dCoords(molecule, options);
}

function refineActive2dCoords(molecule, options = {}) {
  if (getSelected2dRendererVersion() === 'v1') {
    return refineExistingCoordsLegacy(molecule, options);
  }
  const layoutOptions = buildComputedLayoutOptions(options);
  if (layoutOptions.suppressH) {
    molecule.hideHydrogens();
  }
  const existingCoords = readPlacedCoords(molecule, { suppressH: layoutOptions.suppressH });
  if (existingCoords.size === 0) {
    return existingCoords;
  }
  const result = refineComputedCoords(molecule, {
    ...layoutOptions,
    existingCoords,
    touchedAtoms: options.touchedAtoms,
    touchedBonds: options.touchedBonds
  });
  applyComputedCoords(molecule, result, {
    preserveExisting: true,
    hiddenHydrogenMode: 'coincident',
    syncStereoDisplay: true
  });
  return result.coords;
}

const runtimeState = createRuntimeState({
  getRenderOptions,
  validateValence
});

const { plotEl, tooltip, inputEl, collectionSelectEl, svg, g, zoom } = initPlotBootstrap({
  d3,
  document,
  getInteractionModeActive: event =>
    (runtimeState.selectMode || runtimeState.drawBondMode || runtimeState.eraseMode || runtimeState.chargeTool != null) &&
    (runtimeState.mode === '2d' || runtimeState.mode === 'force') &&
    (event.type === 'mousedown' || event.type === 'dblclick') &&
    event.button === 0,
  onForceManualZoom: () => {
    if (runtimeState.mode === 'force') {
      runtimeState.forceAutoFitEnabled = false;
      forceViewportStateHelpers.disableKeepInView();
    }
  }
});
const domElements = createBootstrapDom({
  document,
  plotEl,
  inputEl,
  collectionSelectEl
});

function _isAdditiveSelectionEvent(event) {
  return isAdditiveSelectionEvent(event);
}

const simulation = initForceSimulation({
  d3,
  isHydrogenNode,
  forceLinkDistance,
  createForceAnchorRadiusForce,
  createForceHydrogenRepulsionForce,
  constants: {
    forceLayoutHeavyRepulsion: FORCE_LAYOUT_HEAVY_REPULSION,
    forceLayoutHRepulsion: FORCE_LAYOUT_H_REPULSION
  }
});

const forceHelpers = createForceHelpers({
  d3,
  plotEl,
  simulation,
  viewportFitPadding: pad => _viewportFitPadding(pad),
    generateAndRefine2dCoords: generateAndRefineActive2dCoords,
    generate2dCoords: generateActive2dCoords,
    alignReaction2dProductOrientation: mol => _alignReaction2dProductOrientation(mol),
  spreadReaction2dProductComponents: (mol, bondLength) => _spreadReaction2dProductComponents(mol, bondLength),
  centerReaction2dPairCoords: (mol, bondLength) => _centerReaction2dPairCoords(mol, bondLength)
});

const SCALE = 60;
const BOND_OFF_2D = 7;

const selectionStateHelpers = createSelectionStateHelpers({
  state: {
    getSelectedAtomIds: () => runtimeState.selectedAtomIds,
    setSelectedAtomIds: value => {
      runtimeState.selectedAtomIds = value;
    },
    getSelectedBondIds: () => runtimeState.selectedBondIds,
    setSelectedBondIds: value => {
      runtimeState.selectedBondIds = value;
    }
  }
});

const zoomTransformHelpers = createZoomTransformHelpers({
  d3,
  svg,
  zoom
});

const render2DHelpers = create2DRenderHelpers({
  d3,
  svg,
  zoom,
  plotEl,
  state: {
    getMol: () => runtimeState.mol2d,
    getHCounts: () => runtimeState.hCounts2d,
    getCenterX: () => runtimeState.cx2d,
    getCenterY: () => runtimeState.cy2d,
    setDerivedState: ({ hCounts, stereoMap }) => {
      runtimeState.hCounts2d = hCounts;
      runtimeState.stereoMap2d = stereoMap;
    }
  },
  constants: {
    scale: SCALE,
    bondOffset2d: BOND_OFF_2D,
    getFontSize: () => runtimeState.fontSize,
    wedgeHalfWidth: WEDGE_HALF_W,
    wedgeDashes: WEDGE_DASHES
  },
  geometry: {
    perpUnit,
    shortenLine,
    secondaryDir
  },
  stereo: {
    pickStereoMap: mol => syncDisplayStereo(mol, runtimeState.stereoMap2d)
  }
});

const highlight2DRenderer = create2DHighlightRenderer(
  create2DHighlightRendererDeps({
    getGraphSelection: () => g,
    getMol: () => runtimeState.mol2d,
    getHCounts: () => runtimeState.hCounts2d,
    toSVGPt: atom => render2DHelpers.toSVGPt2d(atom),
    getFontSize: () => runtimeState.fontSize
  })
);

const forceHighlightRenderer = createForceHighlightRenderer(
  createForceHighlightRendererDeps({
    getGraphSelection: () => g,
    getNodes: () => simulation.nodes(),
    getLinks: () => simulation.force('link').links(),
    setHighlightLines: value => {
      runtimeState.functionalGroupHighlightLines = value;
    },
    setHighlightCircles: value => {
      runtimeState.functionalGroupHighlightCircles = value;
    },
    getHighlightRadius: () => 8,
    getOutlineWidth: () => 2,
    atomRadius
  })
);

const forceViewportStateHelpers = createForceViewportStateHelpers(
  createForceViewportStateDeps({
    setKeepInView: value => {
      runtimeState.forceKeepInView = value;
    },
    setKeepInViewTicks: value => {
      runtimeState.forceKeepInViewTicks = value;
    },
    getDefaultKeepInViewTicks: () => FORCE_LAYOUT_EDIT_KEEP_IN_VIEW_TICKS
  })
);

const forceSceneRenderer = createForceSceneRenderer(
  createForceSceneRendererDeps({
    d3,
    svg,
    zoom,
    g,
    plotEl,
    simulation,
    bondOffset: BOND_OFFSET,
    valenceWarningFill: VALENCE_WARNING_FILL,
    forceLayoutHeavyRepulsion: FORCE_LAYOUT_HEAVY_REPULSION,
    forceLayoutHRepulsion: FORCE_LAYOUT_H_REPULSION,
    forceLayoutInitialFitPad: FORCE_LAYOUT_INITIAL_FIT_PAD,
    forceLayoutInitialHRadiusScale: FORCE_LAYOUT_INITIAL_H_RADIUS_SCALE,
    forceLayoutInitialZoomMultiplier: FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER,
    forceLayoutInitialKeepInViewTicks: FORCE_LAYOUT_INITIAL_KEEP_IN_VIEW_TICKS,
    forceLayoutFitPad: FORCE_LAYOUT_FIT_PAD,
    forceLayoutKeepInViewAlphaMin: FORCE_LAYOUT_KEEP_IN_VIEW_ALPHA_MIN,
    setActiveValenceWarningMap: map => {
      runtimeState.activeValenceWarningMap = map;
    },
    setForceAutoFitEnabled: value => {
      runtimeState.forceAutoFitEnabled = value;
    },
    isForceAutoFitEnabled: () => runtimeState.forceAutoFitEnabled,
    enableKeepInView: ticks => forceViewportStateHelpers.enableKeepInView(ticks),
    disableKeepInView: () => forceViewportStateHelpers.disableKeepInView(),
    isKeepInViewEnabled: () => runtimeState.forceKeepInView,
    getKeepInViewTicks: () => runtimeState.forceKeepInViewTicks,
    setKeepInViewTicks: value => {
      runtimeState.forceKeepInViewTicks = value;
    },
    getPreserveSelectionOnNextRender: () => runtimeState.preserveSelectionOnNextRender,
    setPreserveSelectionOnNextRender: value => {
      runtimeState.preserveSelectionOnNextRender = value;
    },
    syncSelectionToMolecule: mol => selectionStateHelpers.syncSelectionToMolecule(mol),
    clearSelection: () => {
      runtimeState.selectedAtomIds.clear();
      runtimeState.selectedBondIds.clear();
    },
    resetCache: () => {
      runtimeState.forceSelectionLines = null;
      runtimeState.forceSelectionCircles = null;
      runtimeState.forceValenceWarningCircles = null;
      runtimeState.functionalGroupHighlightLines = null;
      runtimeState.functionalGroupHighlightCircles = null;
    },
    setValenceWarningCircles: selection => {
      runtimeState.forceValenceWarningCircles = selection;
    },
    getValenceWarningCircles: () => runtimeState.forceValenceWarningCircles,
    getHighlightLines: () => runtimeState.functionalGroupHighlightLines,
    getHighlightCircles: () => runtimeState.functionalGroupHighlightCircles,
    getSelectionLines: () => runtimeState.forceSelectionLines,
    getSelectionCircles: () => runtimeState.forceSelectionCircles,
    valenceWarningMapFor: molecule => runtimeState.valenceWarningMapFor(molecule),
    buildForceAnchorLayout: molecule => forceHelpers.buildForceAnchorLayout(molecule),
    convertMolecule: molecule => forceHelpers.convertMolecule(molecule),
    seedForceNodePositions: (graph, molecule, anchorLayout, options) => forceHelpers.seedForceNodePositions(graph, molecule, anchorLayout, options),
    patchForceNodePositions: (patchPos, options = {}) => forceHelpers.patchForceNodePositions(patchPos, options),
    reseatHydrogensAroundPatched: (patchPos, options = {}) => forceHelpers.reseatHydrogensAroundPatched(patchPos, options),
    forceLinkDistance: link => forceHelpers.forceLinkDistance(link),
    forceAnchorRadius: () => forceHelpers.forceAnchorRadius(),
    forceHydrogenRepulsion: () => forceHelpers.forceHydrogenRepulsion(),
    forceFitTransform: (nodes, pad, options) => forceHelpers.forceFitTransform(nodes, pad, options),
    isHydrogenNode: node => forceHelpers.isHydrogenNode(node),
    enLabelColor: value => enLabelColor(value),
    renderReactionPreviewArrowForce: nodes => _renderReactionPreviewArrowForce(nodes),
    generateAndRefine2dCoords: (mol, options = {}) => generateAndRefineActive2dCoords(mol, options),
    alignReaction2dProductOrientation: mol => _alignReaction2dProductOrientation(mol),
    handleForceBondClick: (event, bondId, molecule) => primitiveEventHandlers.handleForceBondClick(event, bondId, molecule),
    handleForceBondDblClick: (event, atomIds) => primitiveEventHandlers.handleForceBondDblClick(event, atomIds),
    handleForceBondMouseOver: (event, bondId, molecule) => primitiveEventHandlers.handleForceBondMouseOver(event, bondId, molecule),
    handleForceBondMouseMove: event => primitiveEventHandlers.handleForceBondMouseMove(event),
    handleForceBondMouseOut: () => primitiveEventHandlers.handleForceBondMouseOut(),
    handleForceAtomMouseDownDrawBond: (event, datum) => primitiveEventHandlers.handleForceAtomMouseDownDrawBond(event, datum),
    handleForceAtomClick: (event, datum, molecule) => primitiveEventHandlers.handleForceAtomClick(event, datum, molecule),
    handleForceAtomContextMenu: (event, datum) => primitiveEventHandlers.handleForceAtomContextMenu(event, datum),
    handleForceAtomDblClick: (event, atomId) => primitiveEventHandlers.handleForceAtomDblClick(event, atomId),
    handleForceAtomMouseOver: (event, datum, molecule, warning) => primitiveEventHandlers.handleForceAtomMouseOver(event, datum, molecule, warning),
    handleForceAtomMouseMove: event => primitiveEventHandlers.handleForceAtomMouseMove(event),
    handleForceAtomMouseOut: atomId => primitiveEventHandlers.handleForceAtomMouseOut(atomId),
    createForceAtomDrag: sim => dragGestureActions.createForceAtomDrag(sim),
    createForceBondDrag: (sim, molecule) => dragGestureActions.createForceBondDrag(sim, molecule),
    hasHighlights: () => getHighlightedAtomIds().size > 0,
    hasSelection: () => runtimeState.selectedAtomIds.size > 0 || runtimeState.selectedBondIds.size > 0,
    applyForceHighlights: () => applyForceHighlights(),
    applyForceSelection: () => applyForceSelection()
  })
);

const scene2DRenderer = create2DSceneRenderer(
  create2DSceneRendererDeps({
    d3,
    svg,
    zoom,
    g,
    plotEl,
    scale: SCALE,
    getFontSize: () => runtimeState.fontSize,
    valenceWarningFill: VALENCE_WARNING_FILL,
    getMol: () => runtimeState.mol2d,
    getHCounts: () => runtimeState.hCounts2d,
    getStereoMap: () => runtimeState.stereoMap2d,
    setScene: ({ mol, hCounts, cx, cy, stereoMap }) => {
      runtimeState.mol2d = mol;
      runtimeState.hCounts2d = hCounts;
      runtimeState.cx2d = cx;
      runtimeState.cy2d = cy;
      runtimeState.stereoMap2d = stereoMap;
    },
    setCenter: (cx, cy) => {
      runtimeState.cx2d = cx;
      runtimeState.cy2d = cy;
    },
    setActiveValenceWarningMap: map => {
      runtimeState.activeValenceWarningMap = map;
    },
    getPreserveSelectionOnNextRender: () => runtimeState.preserveSelectionOnNextRender,
    setPreserveSelectionOnNextRender: value => {
      runtimeState.preserveSelectionOnNextRender = value;
    },
    resetCache: () => {
      runtimeState.forceSelectionLines = null;
      runtimeState.forceSelectionCircles = null;
      runtimeState.forceValenceWarningCircles = null;
      runtimeState.functionalGroupHighlightLines = null;
      runtimeState.functionalGroupHighlightCircles = null;
    },
    syncSelectionToMolecule: mol => selectionStateHelpers.syncSelectionToMolecule(mol),
    clearSelection: () => {
      runtimeState.selectedAtomIds.clear();
      runtimeState.selectedBondIds.clear();
    },
    getDrawBondMode: () => runtimeState.drawBondMode,
    getDrawBondType: () => runtimeState.drawBondType,
    valenceWarningMapFor: molecule => runtimeState.valenceWarningMapFor(molecule),
    toSVGPt: atom => render2DHelpers.toSVGPt2d(atom),
    secondaryDir,
    getSelectedDragAtomIds: (mol, atomIds = [], bondIds = []) => selectionStateHelpers.getSelectedDragAtomIds(mol, atomIds, bondIds),
    drawBond: (container, bond, a1, a2, mol, toSVGPt, stereoType = null) => render2DHelpers.drawBond(container, bond, a1, a2, mol, toSVGPt, stereoType),
    redrawHighlights: () => _redraw2dHighlights(),
    redrawSelection: () => selectionOverlayManager.redraw2dSelection(),
    generateAndRefine2dCoords: (mol, options = {}) => generateAndRefineActive2dCoords(mol, options),
    generate2dCoords: (mol, options = {}) => generateActive2dCoords(mol, options),
    alignReaction2dProductOrientation: _alignReaction2dProductOrientation,
    spreadReaction2dProductComponents: _spreadReaction2dProductComponents,
    centerReaction2dPairCoords: _centerReaction2dPairCoords,
    drawReactionPreviewArrow2d: (toSVGPt, atoms) => _drawReactionPreviewArrow2d(toSVGPt, atoms),
    viewportFitPadding: _viewportFitPadding,
    hasReactionPreview: () => _hasReactionPreview(),
    enLabelColor: value => enLabelColor(value),
    handle2dBondClick: (event, bondId) => primitiveEventHandlers.handle2dBondClick(event, bondId),
    handle2dBondDblClick: (event, atomIds) => primitiveEventHandlers.handle2dBondDblClick(event, atomIds),
    handle2dBondMouseOver: (event, bond, a1, a2) => primitiveEventHandlers.handle2dBondMouseOver(event, bond, a1, a2),
    handle2dBondMouseMove: event => primitiveEventHandlers.handle2dBondMouseMove(event),
    handle2dBondMouseOut: () => primitiveEventHandlers.handle2dBondMouseOut(),
    handle2dAtomMouseDownDrawBond: (event, atomId) => primitiveEventHandlers.handle2dAtomMouseDownDrawBond(event, atomId),
    handle2dAtomClick: (event, atomId) => primitiveEventHandlers.handle2dAtomClick(event, atomId),
    handle2dAtomContextMenu: (event, atom) => primitiveEventHandlers.handle2dAtomContextMenu(event, atom),
    handle2dAtomDblClick: (event, atomId) => primitiveEventHandlers.handle2dAtomDblClick(event, atomId),
    handle2dAtomMouseOver: (event, atom, mol, warning) => primitiveEventHandlers.handle2dAtomMouseOver(event, atom, mol, warning),
    handle2dAtomMouseMove: event => primitiveEventHandlers.handle2dAtomMouseMove(event),
    handle2dAtomMouseOut: atomId => primitiveEventHandlers.handle2dAtomMouseOut(atomId),
    create2dBondDrag: (mol, bondId, options) => dragGestureActions.create2dBondDrag(mol, bondId, options),
    create2dAtomDrag: (mol, atomId, options) => dragGestureActions.create2dAtomDrag(mol, atomId, options),
    promoteBondOrder: (bondId, options = {}) => _promoteBondOrder(bondId, options),
    getOrientation: () => ({ rotationDeg: runtimeState.rotationDeg, flipH: runtimeState.flipH, flipV: runtimeState.flipV }),
    updateFormula: mol => updateFormula(mol),
    updateDescriptors: mol => updateDescriptors(mol),
    updatePanels: (mol, options = {}) => _updateAnalysisPanels(mol, options)
  })
);

const selectionOverlayManager = createSelectionOverlayManager(
  createSelectionOverlayManagerDeps({
    requestAnimationFrame: callback => requestAnimationFrame(callback),
    getMode: () => runtimeState.mode,
    getSelectMode: () => runtimeState.selectMode,
    getDrawBondMode: () => runtimeState.drawBondMode,
    getEraseMode: () => runtimeState.eraseMode,
    getChargeTool: () => runtimeState.chargeTool,
    getSelectionModifierActive: () => runtimeState.selectionModifierActive,
    getSelectedAtomIds: () => runtimeState.selectedAtomIds,
    getSelectedBondIds: () => runtimeState.selectedBondIds,
    getHoveredAtomIds: () => runtimeState.hoveredAtomIds,
    getHoveredBondIds: () => runtimeState.hoveredBondIds,
    getForceMol: () => runtimeState.currentMol,
    getMol2D: () => runtimeState.mol2d,
    getHCounts: () => runtimeState.hCounts2d,
    getStereoMap: () => runtimeState.stereoMap2d,
    toSVGPt: atom => render2DHelpers.toSVGPt2d(atom),
    getGraphSelection: () => g,
    applyForceSelection: () => applyForceSelection(),
    getFontSize: () => runtimeState.fontSize
  })
);

const forceSelectionRenderer = createForceSelectionRenderer(
  createForceSelectionRendererDeps({
    getGraphSelection: () => g,
    getRenderableSelectionIds: () => selectionOverlayManager.getRenderableSelectionIds(),
    getNodes: () => simulation.nodes(),
    getLinks: () => simulation.force('link').links(),
    setSelectionLines: value => {
      runtimeState.forceSelectionLines = value;
    },
    setSelectionCircles: value => {
      runtimeState.forceSelectionCircles = value;
    },
    getSelectionColor: () => 'rgb(150, 200, 255)',
    getSelectionOutline: () => 'rgb(40, 100, 210)',
    getBondSelectionRadius: () => 6,
    getAtomSelectionRadius: () => 13,
    getOutlineWidth: () => 2,
    atomRadius
  })
);

const applyForceHighlights = () => forceHighlightRenderer.applyForceHighlights();
const applyForceSelection = () => forceSelectionRenderer.applyForceSelection();
const _clearPrimitiveHover = () => selectionOverlayManager.clearPrimitiveHover();
const _refreshSelectionOverlay = () => selectionOverlayManager.refreshSelectionOverlay();
const _getRenderableSelectionIds = () => selectionOverlayManager.getRenderableSelectionIds();
const _showPrimitiveHover = (atomIds = [], bondIds = []) => selectionOverlayManager.showPrimitiveHover(atomIds, bondIds);
const _setPrimitiveHover = (atomIds = [], bondIds = []) => selectionOverlayManager.setPrimitiveHover(atomIds, bondIds);
const _getSelectedDragAtomIds = (mol, atomIds = [], bondIds = []) => selectionStateHelpers.getSelectedDragAtomIds(mol, atomIds, bondIds);
const _toSVGPt2d = atom => render2DHelpers.toSVGPt2d(atom);
const _zoomToFitIf2d = () => render2DHelpers.zoomToFitIf2d();

const {
  syncInputField: _syncInputField,
  captureAppSnapshot: _captureAppSnapshot,
  updateAnalysisPanels: _updateAnalysisPanels,
  restoreSnapshot: _restoreSnapshot,
  updateModeChrome: _updateModeChrome,
  appState,
  renderRuntime
} = initializeRuntimeBridges({
  runtimeState,
  domElements,
  render2DHelpers,
  captureZoomTransformSnapshot: () => _captureZoomTransformSnapshot(),
  restoreZoomTransformSnapshot: snapshot => _restoreZoomTransformSnapshot(snapshot),
  restore2dEditViewport: (zoomSnapshot, options) => _restore2dEditViewport(zoomSnapshot, options),
  pickStereoWedgesPreserving2dChoice: mol => _pickStereoWedgesPreserving2dChoice(mol),
  clearPrimitiveHover: () => _clearPrimitiveHover(),
  setPrimitiveHover: (atomIds = [], bondIds = []) => _setPrimitiveHover(atomIds, bondIds),
  setDrawBondHoverSuppressed: value => {
    runtimeState.drawBondHoverSuppressed = value;
  },
  setPrimitiveHoverSuppressed: value => {
    runtimeState.primitiveHoverSuppressed = value;
  },
  restorePersistentHighlight: () => _restorePersistentHighlight(),
  fitCurrent2dView: () => fitCurrent2dView(),
  enableForceKeepInView: () => forceViewportStateHelpers.enableKeepInView(),
  getZoomTransform: () => d3.zoomTransform(svg.node()),
  setZoomTransform: transform => svg.call(zoom.transform, transform),
  makeZoomIdentity: (x, y, k) => d3.zoomIdentity.translate(x, y).scale(k),
  setPreserveSelectionOnNextRender: value => {
    runtimeState.preserveSelectionOnNextRender = value;
  },
  scale: SCALE,
  clearUndoHistory: () => _clearUndoHistory(),
  clearHighlightState: () => clearHighlightState(),
  kekulize,
  stopSimulation: () => simulation.stop(),
  getDraw2D: () => draw2d,
  getRender2D: () => render2d,
  forceSceneRenderer,
  updateFormula: mol => updateFormula(mol),
  updateDescriptors: mol => updateDescriptors(mol),
  updateAnalysisPanels: (mol, options = {}) => _updateAnalysisPanels(mol, options)
});

const inputFlowRenderers = {
  ...renderRuntime,
  clearScene: () => {
    g.selectAll('*').remove();
  }
};

let _handle2dPrimitiveClick;
let _handle2dComponentDblClick;
let _handleForcePrimitiveClick;
let _handleForceComponentDblClick;
let _drawBond;
let _redraw2dHighlights;
let _restore2dEditViewport;
let _prepareResonanceStructuralEdit;
let _promoteBondOrder;
let _changeAtomElements;
let _changeAtomCharge;
let _replaceForceHydrogenWithDrawElement;
let _startDrawBond;
let _updateDrawBondPreview;
let _resetDrawBondHover;
let _cancelDrawBond;
let _ensureMol;
let _autoPlaceBond;
let _commitDrawBond;
let draw2d;
let render2d;
let fitCurrent2dView;
let _eraseItem;
let _captureZoomTransformSnapshot;
let _restoreZoomTransformSnapshot;
let _pickStereoWedgesPreserving2dChoice;
let _renderMol;
let _clearMolecule;
let _parseAndRender;
let _parseAndRenderInchi;

const {
  navigationActions,
  selectionActions,
  editingActions,
  dragGestureActions,
  drawBondPreviewActions,
  drawBondCommitActions,
  primitiveSelectionActions,
  primitiveEventHandlers
} = initializeInteractionRuntime(
  createInteractionRuntimeDeps({
    appState,
    takeSnapshot: options => _takeSnapshot(options),
    captureAppSnapshot: options => _captureAppSnapshot(options),
    discardLastSnapshot: () => _discardLastSnapshot(),
    renderRuntime,
    hasReactionPreview: () => _hasReactionPreview(),
    reapplyActiveReactionPreview: () => _reapplyActiveReactionPreview(),
    resetActiveResonanceView,
    alignReaction2dProductOrientation: _alignReaction2dProductOrientation,
    spreadReaction2dProductComponents: _spreadReaction2dProductComponents,
    centerReaction2dPairCoords: _centerReaction2dPairCoords,
    viewportFitPadding: _viewportFitPadding,
    generateAndRefine2dCoords: generateAndRefineActive2dCoords,
    refineExistingCoords: refineActive2dCoords,
    atomBBox,
    flipDisplayStereo,
    clearPrimitiveHover: () => _clearPrimitiveHover(),
    restorePersistentHighlight: () => _restorePersistentHighlight(),
    getFitCurrent2dView: () => fitCurrent2dView,
    getZoomTransform: () => d3.zoomTransform(svg.node()),
    setZoomTransform: transform => svg.call(zoom.transform, transform),
    makeZoomIdentity: (x, y, k) => d3.zoomIdentity.translate(x, y).scale(k),
    syncStereoMap2d: mol => {
      runtimeState.stereoMap2d = _pickStereoWedgesPreserving2dChoice(mol);
    },
    flipStereoMap2d: mol => {
      runtimeState.stereoMap2d = flipDisplayStereo(mol, runtimeState.stereoMap2d);
      const preview = mol.__reactionPreview;
      if (preview) {
        if (preview.forcedStereoBondTypes?.size) {
          for (const [bondId] of preview.forcedStereoBondTypes) {
            const newType = runtimeState.stereoMap2d.get(bondId);
            if (newType !== undefined) {
              preview.forcedStereoBondTypes.set(bondId, newType);
            }
          }
        }
        if (preview.forcedStereoByCenter?.size) {
          for (const [centerId, info] of preview.forcedStereoByCenter) {
            const newType = runtimeState.stereoMap2d.get(info.bondId);
            if (newType !== undefined) {
              preview.forcedStereoByCenter.set(centerId, { ...info, type: newType });
            }
          }
        }
      }
    },
    setPreserveSelectionOnNextRender: value => {
      runtimeState.preserveSelectionOnNextRender = value;
    },
    scale: SCALE,
    bondOffset2d: BOND_OFF_2D,
    patchForceNodePositions: (patchPos, options = {}) => forceHelpers.patchForceNodePositions(patchPos, options),
    forceFitTransform: (nodes, pad, options = {}) => forceHelpers.forceFitTransform(nodes, pad, options),
    forceFitPad: FORCE_LAYOUT_FIT_PAD,
    forceInitialZoomMultiplier: FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER,
    zoomTransformsDiffer: (a, b, epsilon) => forceHelpers.zoomTransformsDiffer(a, b, epsilon),
    parseSMILES,
    parseINCHI,
    simulation,
    plotEl,
    clean2dButton: domElements.getClean2dButtonElement(),
    cleanForceButton: domElements.getCleanForceButtonElement(),
    updateModeChrome: _updateModeChrome,
    getDraw2D: () => draw2d,
    applyForceSelection,
    panButton: domElements.getPanButtonElement(),
    selectButton: domElements.getSelectButtonElement(),
    drawBondButton: domElements.getDrawBondButtonElement(),
    drawTools: domElements.getDrawToolsElement(),
    eraseButton: domElements.getEraseButtonElement(),
    getChargeToolButton: tool => (tool === 'positive' ? domElements.getPositiveChargeButtonElement() : tool === 'negative' ? domElements.getNegativeChargeButtonElement() : null),
    getElementButton: element => domElements.getElementButtonElement(element),
    getBondDrawTypeButton: type => domElements.getBondDrawTypeButtonElement(type),
    performStructuralEdit: (...args) => runtimeState.appController.performStructuralEdit(...args),
    prepareReactionPreviewEraseTargets: (atomIds, bondIds) => _prepareReactionPreviewEraseTargets(atomIds, bondIds),
    reactionPreviewBlock: ReactionPreviewPolicy.block,
    normalizeResonanceForEdit: ResonancePolicy.normalizeForEdit,
    takeSnapshotPolicy: SnapshotPolicy.take,
    viewportNonePolicy: ViewportPolicy.none,
    clearStereoAnnotations: (mol, affectedIds) => mol.clearStereoAnnotations(affectedIds),
    kekulize,
    refreshAromaticity,
    patchNodePositions: patchPos => forceHelpers.patchForceNodePositions(patchPos),
    reseatHydrogensAroundPatched: patchPos => forceHelpers.reseatHydrogensAroundPatched(patchPos),
    refreshSelectionOverlay: () => _refreshSelectionOverlay(),
    flashEraseButton: () => {
      const btn = domElements.getEraseButtonElement();
      if (!btn) {
        return;
      }
      btn.textContent = '✓';
      setTimeout(() => {
        btn.textContent = '🗑️';
      }, 1500);
    },
    createDrag: () => d3.drag(),
    getDrawBondMode: () => runtimeState.drawBondMode,
    getEraseMode: () => runtimeState.eraseMode,
    getChargeTool: () => runtimeState.chargeTool,
    captureSnapshot: () => _captureAppSnapshot(),
    getSelectedDragAtomIds: (mol, atomIds = [], bondIds = []) => selectionStateHelpers.getSelectedDragAtomIds(mol, atomIds, bondIds),
    getCurrentMolecule: () => runtimeState.currentMol,
    setAutoFitEnabled: value => {
      runtimeState.forceAutoFitEnabled = value;
    },
    disableKeepInView: () => forceViewportStateHelpers.disableKeepInView(),
    refresh2dSelection: () => selectionOverlayManager.redraw2dSelection(),
    hideTooltip: () => {
      tooltip.transition().duration(50).style('opacity', 0);
    },
    setElementCursor: (element, value) => {
      d3.select(element).style('cursor', value);
    },
    g,
    getMode: () => runtimeState.mode,
    getDrawBondElement: () => runtimeState.drawBondElement,
    getDrawBondType: () => runtimeState.drawBondType,
    getDrawElemProtons: () => DRAW_ELEM_PROTONS,
    isReactionPreviewEditableAtomId: id => _isReactionPreviewEditableAtomId(id),
    getDrawBondState: () => runtimeState.drawBondState,
    setDrawBondState: value => {
      runtimeState.drawBondState = value;
    },
    clearHoveredAtomIds: () => runtimeState.hoveredAtomIds.clear(),
    clearHoveredBondIds: () => runtimeState.hoveredBondIds.clear(),
    addHoveredAtomId: atomId => runtimeState.hoveredAtomIds.add(atomId),
    redraw2dSelection: () => selectionOverlayManager.redraw2dSelection(),
    getPlotSize: () => ({
      width: plotEl.clientWidth || 600,
      height: plotEl.clientHeight || 400
    }),
    getForceNodeById: atomId => simulation.nodes().find(node => node.id === atomId),
    getForceNodes: () => simulation.nodes(),
    get2DAtomById: atomId => runtimeState.mol2d?.atoms.get(atomId),
    get2DAtoms: () => (runtimeState.mol2d ? [...runtimeState.mol2d.atoms.values()] : []),
    get2DCenterX: () => runtimeState.cx2d,
    get2DCenterY: () => runtimeState.cy2d,
    forceBondLength: FORCE_LAYOUT_BOND_LENGTH,
    strokeWidth: STROKE_W,
    fontSize: runtimeState.fontSize,
    atomRadius,
    atomColor,
    strokeColor,
    singleBondWidth,
    labelHalfW,
    setDrawBondHoverSuppressed: value => {
      runtimeState.drawBondHoverSuppressed = value;
    },
    captureZoomTransform: () => zoomTransformHelpers.captureZoomTransformSnapshot(),
    restore2dEditViewport: (zoomSnapshot, options = {}) => _restore2dEditViewport(zoomSnapshot, options),
    forceScale: 25,
    restoreSnapshot: snap => _restoreSnapshot(snap),
    prepareReactionPreviewEditTargets: payload => _prepareReactionPreviewEditTargets(payload),
    prepareResonanceStructuralEdit: mol => _prepareResonanceStructuralEdit(mol),
    getActiveMolecule: () => (runtimeState.mode === 'force' ? runtimeState.currentMol : runtimeState.mol2d),
    ensureActiveMolecule: () => _ensureMol(),
    enableKeepInView: () => forceViewportStateHelpers.enableKeepInView(),
    sync2DDerivedState: mol => render2DHelpers.sync2dDerivedState(mol),
    syncInputField: mol => _syncInputField(mol),
    updateFormula: mol => updateFormula(mol),
    updateDescriptors: mol => updateDescriptors(mol),
    updatePanels: mol => _updateAnalysisPanels(mol),
    draw2d: () => renderRuntime.draw2d(),
    updateForce: (mol, options = {}) => renderRuntime.updateForce(mol, options),
    clearSelection: () => {
      runtimeState.selectedAtomIds.clear();
      runtimeState.selectedBondIds.clear();
    },
    changeAtomElements: (atomIds, newEl, options = {}) => _changeAtomElements(atomIds, newEl, options),
    changeAtomCharge: (atomId, options = {}) => _changeAtomCharge(atomId, options),
    promoteBondOrder: (bondId, options = {}) => _promoteBondOrder(bondId, options),
    isAdditiveSelectionEvent: event => _isAdditiveSelectionEvent(event),
    hasVisibleStereoBond: bondId => runtimeState.stereoMap2d && runtimeState.stereoMap2d.has(bondId),
    replaceForceHydrogenAtom: (atomId, mol) => _replaceForceHydrogenWithDrawElement(atomId, mol),
    showPrimitiveHover: (atomIds = [], bondIds = []) => _showPrimitiveHover(atomIds, bondIds),
    isDrawBondHoverSuppressed: () => runtimeState.drawBondHoverSuppressed,
    isPrimitiveHoverSuppressed: () => runtimeState.primitiveHoverSuppressed,
    setPrimitiveHoverSuppressed: value => {
      runtimeState.primitiveHoverSuppressed = value;
    },
    showDelayedTooltip: (html, event, delay = 150) => {
      tooltip.transition().delay(delay).style('opacity', 0.9);
      tooltip
        .html(html)
        .style('left', `${event.clientX + 13}px`)
        .style('top', `${event.clientY - 20}px`);
    },
    showImmediateTooltip: (html, event) => {
      tooltip.interrupt().style('opacity', 0.9);
      tooltip
        .html(html)
        .style('left', `${event.clientX + 13}px`)
        .style('top', `${event.clientY - 20}px`);
    },
    moveTooltip: event => {
      tooltip.style('left', `${event.clientX + 13}px`).style('top', `${event.clientY - 20}px`);
    },
    getSelectionValenceTooltipAtomId: () => runtimeState.selectionValenceTooltipAtomId,
    setSelectionValenceTooltipAtomId: value => {
      runtimeState.selectionValenceTooltipAtomId = value;
    },
    getRenderOptions,
    atomTooltipHtml,
    bondTooltipHtml,
    pointer: (event, node) => d3.pointer(event, node),
    getGNode: () => g.node()
  })
);

const { inputFlowManager, inputControls } = initializeAppRuntime(
  createAppRuntimeDeps({
    Molecule,
    document,
    window,
    runtimeState,
    inputEl,
    getInputMode: () => window.inputMode,
    setInputMode: value => {
      window.inputMode = value;
    },
    domElements,
    plotEl,
    toSMILES,
    toInChI,
    appState,
    getSelectedAtomIds: () => runtimeState.selectedAtomIds,
    getSelectedBondIds: () => runtimeState.selectedBondIds,
    setSelectedAtomIds: value => {
      runtimeState.selectedAtomIds = value;
    },
    setSelectedBondIds: value => {
      runtimeState.selectedBondIds = value;
    },
    getSelectMode: () => runtimeState.selectMode,
    setSelectMode: value => {
      runtimeState.selectMode = value;
    },
    getDrawBondMode: () => runtimeState.drawBondMode,
    setDrawBondMode: value => {
      runtimeState.drawBondMode = value;
    },
    getEraseMode: () => runtimeState.eraseMode,
    setEraseMode: value => {
      runtimeState.eraseMode = value;
    },
    getChargeTool: () => runtimeState.chargeTool,
    setChargeTool: value => {
      runtimeState.chargeTool = value;
    },
    getDrawBondElement: () => runtimeState.drawBondElement,
    setDrawBondElement: value => {
      runtimeState.drawBondElement = value;
    },
    getDrawBondType: () => runtimeState.drawBondType,
    setDrawBondType: value => {
      runtimeState.drawBondType = value;
    },
    clearSelection: () => {
      runtimeState.selectedAtomIds.clear();
      runtimeState.selectedBondIds.clear();
    },
    clearHovered: () => {
      runtimeState.hoveredAtomIds.clear();
      runtimeState.hoveredBondIds.clear();
    },
    clearHoveredAtomIds: () => runtimeState.hoveredAtomIds.clear(),
    clearHoveredBondIds: () => runtimeState.hoveredBondIds.clear(),
    setSelectionModifierActive: value => {
      runtimeState.selectionModifierActive = value;
    },
    setErasePainting: value => {
      runtimeState.erasePainting = value;
    },
    syncToolButtonsFromState: () => selectionActions.syncToolButtonsFromState(),
    refreshSelectionOverlay: () => _refreshSelectionOverlay(),
    setDrawBondState: value => {
      runtimeState.drawBondState = value;
    },
    setDrawBondHoverSuppressed: value => {
      runtimeState.drawBondHoverSuppressed = value;
    },
    clearDrawBondArtifacts: () => drawBondPreviewActions.clearArtifacts(),
    getForceAutoFitEnabled: () => runtimeState.forceAutoFitEnabled,
    setForceAutoFitEnabled: value => {
      runtimeState.forceAutoFitEnabled = value;
    },
    getForceKeepInView: () => runtimeState.forceKeepInView,
    setForceKeepInView: value => {
      runtimeState.forceKeepInView = value;
    },
    getForceKeepInViewTicks: () => runtimeState.forceKeepInViewTicks,
    setForceKeepInViewTicks: value => {
      runtimeState.forceKeepInViewTicks = value;
    },
    disableForceKeepInView: () => forceViewportStateHelpers.disableKeepInView(),
    simulation,
    isHydrogenNode,
    forceHelpers,
    g,
    getDraw2D: () => draw2d,
    forceSceneRenderer,
    resetForceRenderCaches: () => {
      runtimeState.forceSelectionLines = null;
      runtimeState.forceSelectionCircles = null;
      runtimeState.forceValenceWarningCircles = null;
      runtimeState.functionalGroupHighlightLines = null;
      runtimeState.functionalGroupHighlightCircles = null;
    },
    syncInputField: mol => _syncInputField(mol),
    captureAppSnapshot: options => _captureAppSnapshot(options),
    restoreSnapshot: snap => _restoreSnapshot(snap),
    inputFlowRenderers,
    renderRuntime,
    updateFunctionalGroups: mol => updateFunctionalGroups(mol),
    updateFormula: mol => updateFormula(mol),
    updateDescriptors: mol => updateDescriptors(mol),
    updateAnalysisPanels: (mol, options = {}) => _updateAnalysisPanels(mol, options),
    updateReactionTemplatesPanel: () => updateReactionTemplatesPanel(),
    updateResonancePanel: (mol, options = {}) => updateResonancePanel(mol, options),
    clearResonancePanelState: () => clearResonancePanelState(),
    updateBondEnPanel: mol => updateBondEnPanel(mol),
    clearBondEnPanel: () => clearBondEnPanel(),
    updateAtomNumberingPanel: mol => updateAtomNumberingPanel(mol),
    clearAtomNumberingPanel: () => clearAtomNumberingPanel(),
    getReactionPreviewReactantAtomIds: () => _getReactionPreviewReactantAtomIds(),
    getReactionPreviewMappedAtomPairs: () => _getReactionPreviewMappedAtomPairs(),
    captureReactionPreviewSnapshot: () => _captureReactionPreviewSnapshot(),
    restoreReactionPreviewSnapshot: snap => _restoreReactionPreviewSnapshot(snap),
    clearReactionPreviewState: () => _clearReactionPreviewState(),
    reapplyActiveReactionPreview: () => _reapplyActiveReactionPreview(),
    hasReactionPreview: () => _hasReactionPreview(),
    prepareReactionPreviewBondEditTarget: bondId => _prepareReactionPreviewBondEditTarget(bondId),
    prepareReactionPreviewEditTargets: payload => _prepareReactionPreviewEditTargets(payload),
    prepareResonanceUndoSnapshot: mol => prepareResonanceUndoSnapshot(mol),
    restoreResonanceViewSnapshot: (mol, snap) => restoreResonanceViewSnapshot(mol, snap),
    prepareResonanceStructuralEdit: mol => _prepareResonanceStructuralEdit(mol),
    prepareResonanceStateForStructuralEdit: mol => prepareResonanceStateForStructuralEdit(mol),
    captureHighlightSnapshot: () => captureHighlightSnapshot(),
    clearHighlightState: () => clearHighlightState(),
    restoreHighlightSnapshot: (snapshot, mol) => restoreHighlightSnapshot(snapshot, mol),
    restorePhyschemHighlightSnapshot: snapshot => runtimeState.restorePhyschemHighlightSnapshot(snapshot),
    restorePersistentHighlight: () => _restorePersistentHighlight(),
    takeSnapshot: options => _takeSnapshot(options),
    updateModeChrome: nextMode => _updateModeChrome(nextMode),
    restoreZoomTransformSnapshot: snapshot => _restoreZoomTransformSnapshot(snapshot),
    captureZoomTransformSnapshot: () => _captureZoomTransformSnapshot(),
    zoomTransformHelpers,
    zoomToFitIf2d: () => _zoomToFitIf2d(),
    tooltip,
    parseSMILES,
    parseINCHI,
    detectChemicalStringFormat,
    kekulize,
    refreshAromaticity,
    navigationActions,
    exampleMolecules,
    moleculeCatalog,
    forceBondLength: FORCE_LAYOUT_BOND_LENGTH
  })
);

finalizeAppBootstrap(
  createFinalizeAppBootstrapDeps({
    createAppDelegates,
    createReaction2dDeps,
    createResonancePanelDeps,
    createBondEnPanelDeps,
    createAtomNumberingPanelDeps,
    createOptionsModalDeps,
    createPhyschemPanelDeps,
    createAppShellDeps,
    initUndo,
    initHighlights,
    initExport,
    initReaction2d,
    initResonancePanel,
    initBondEnPanel,
    initAtomNumberingPanel,
    initNavigationInteractions,
    initKeyboardInteractions,
    initGestureInteractions,
    initOptionsModal,
    initPlotInteractions,
    initTabPanels,
    initPhyschemPanel,
    initAppShell,
    setDelegates: appDelegates => {
      ({
        handle2dPrimitiveClick: _handle2dPrimitiveClick,
        handle2dComponentDblClick: _handle2dComponentDblClick,
        handleForcePrimitiveClick: _handleForcePrimitiveClick,
        handleForceComponentDblClick: _handleForceComponentDblClick,
        drawBond: _drawBond,
        redraw2dHighlights: _redraw2dHighlights,
        restore2dEditViewport: _restore2dEditViewport,
        prepareResonanceStructuralEdit: _prepareResonanceStructuralEdit,
        promoteBondOrder: _promoteBondOrder,
        changeAtomElements: _changeAtomElements,
        changeAtomCharge: _changeAtomCharge,
        replaceForceHydrogenWithDrawElement: _replaceForceHydrogenWithDrawElement,
        startDrawBond: _startDrawBond,
        updateDrawBondPreview: _updateDrawBondPreview,
        resetDrawBondHover: _resetDrawBondHover,
        cancelDrawBond: _cancelDrawBond,
        ensureMol: _ensureMol,
        autoPlaceBond: _autoPlaceBond,
        commitDrawBond: _commitDrawBond,
        draw2d,
        render2d,
        fitCurrent2dView,
        eraseItem: _eraseItem,
        captureZoomTransformSnapshot: _captureZoomTransformSnapshot,
        restoreZoomTransformSnapshot: _restoreZoomTransformSnapshot,
        pickStereoWedgesPreserving2dChoice: _pickStereoWedgesPreserving2dChoice,
        renderMol: _renderMol,
        clearMolecule: _clearMolecule,
        parseAndRender: _parseAndRender,
        parseAndRenderInchi: _parseAndRenderInchi
      } = appDelegates);
    },
    appController: runtimeState.appController,
    runtimeState,
    appState,
    getDrawBondState: () => runtimeState.drawBondState,
    setDrawBondHoverSuppressed: value => {
      runtimeState.drawBondHoverSuppressed = value;
    },
    getSelectMode: () => runtimeState.selectMode,
    getDrawBondMode: () => runtimeState.drawBondMode,
    getEraseMode: () => runtimeState.eraseMode,
    getChargeTool: () => runtimeState.chargeTool,
    setCapturePhyschemHighlightSnapshot: fn => {
      runtimeState.capturePhyschemHighlightSnapshot = fn;
    },
    setRestorePhyschemHighlightSnapshot: fn => {
      runtimeState.restorePhyschemHighlightSnapshot = fn;
    },
    getInitialSmiles: () => 'CC(=O)C(Cl)CC(C(C)C)C=C',
    primitiveSelectionActions,
    drawBondPreviewActions,
    drawBondCommitActions,
    editingActions,
    selectionActions,
    render2DHelpers,
    highlight2DRenderer,
    scene2DRenderer,
    zoomTransformHelpers,
    renderRuntime,
    applyForceHighlights: () => applyForceHighlights(),
    refreshSelectionOverlay: () => _refreshSelectionOverlay(),
    applyForceSelection: () => applyForceSelection(),
    selectionOverlayManager,
    forceSceneRenderer,
    syncDisplayStereo,
    clearReactionPreviewState: () => _clearReactionPreviewState(),
    restoreReactionPreviewSource: options => _restoreReactionPreviewSource(options),
    reapplyActiveReactionPreview: () => _reapplyActiveReactionPreview(),
    hasReactionPreview: () => _hasReactionPreview(),
    isReactionPreviewEditableAtomId: id => _isReactionPreviewEditableAtomId(id),
    getReactionPreviewSourceMol: () => _getReactionPreviewSourceMol(),
    getReactionPreviewMappedAtomPairs: () => _getReactionPreviewMappedAtomPairs(),
    getReactionPreviewReactantAtomIds: () => _getReactionPreviewReactantAtomIds(),
    takeSnapshot: options => _takeSnapshot(options),
    undoAction: () => undoAction(),
    redoAction: () => redoAction(),
    d3,
    svg,
    zoom,
    g,
    plotEl,
    simulation,
    document,
    window,
    tooltip,
    domElements,
    clearPrimitiveHover: () => _clearPrimitiveHover(),
    showPrimitiveHover: (atomIds = [], bondIds = []) => _showPrimitiveHover(atomIds, bondIds),
    updateAnalysisPanels: (mol, options = {}) => _updateAnalysisPanels(mol, options),
    prepare2dExportHighlightState: () => _prepare2dExportHighlightState(),
    setHighlight: (mappings, options = {}) => _setHighlight(mappings, options),
    restorePersistentHighlight: () => _restorePersistentHighlight(),
    setPersistentHighlightFallback: (fn, options) => setPersistentHighlightFallback(fn, options),
    renderOptionLimits: RENDER_OPTION_LIMITS,
    getRenderOptions: () => getRenderOptions(),
    getDefaultRenderOptions: () => getDefaultRenderOptions(),
    updateRenderOptions: nextOptions => updateRenderOptions(nextOptions),
    inputControls,
    inputFlowManager,
    parseSMILES,
    parseINCHI,
    copyForcePng,
    copyForceSvg,
    copySvg2d,
    savePng2d,
    atomTooltipHtml,
    toSMILES,
    toInChI
  })
);
