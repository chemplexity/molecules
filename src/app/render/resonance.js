/** @module app/render/resonance */

import { generateResonanceStructures } from '../../algorithms/index.js';
import { ringAtomKey } from '../../core/style.js';
import { centerReaction2dPairCoords, cloneWithPrefixedIds } from '../../layout/reaction2d.js';
import { forceLayoutBondScale, FORCE_LAYOUT_BOND_LENGTH, FORCE_LAYOUT_INITIAL_FIT_PAD, FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER } from './force-helpers.js';
import { getRenderOptions } from './helpers.js';
import { createModeAwareHelpers } from './render-mode-helpers.js';
import { createNavButton } from './panel-row.js';
import { buildResonanceElectronFlow, clearMoleculeResonanceElectronFlow, RESONANCE_ELECTRON_FLOW_PROPERTY, setMoleculeResonanceElectronFlow } from './resonance-arrows.js';

let ctx = {};
const modeHelpers = createModeAwareHelpers(() => ctx);

/**
 * Default resonance options used by the sidebar panel.
 *
 * The UI currently keeps charge-separated contributors enabled, but collapses
 * independent-region permutations so the panel emphasizes locally meaningful
 * contributors rather than every Cartesian-product combination.
 * @type {{ includeChargeSeparatedStates: boolean, includeIndependentComponentPermutations: boolean }}
 */
const RESONANCE_PANEL_OPTIONS = {
  includeChargeSeparatedStates: true,
  includeIndependentComponentPermutations: false
};

let _resonanceLocked = false;
let _activeResonanceState = 1;
let _activeResonancePairIndex = 0;
let _activeResonanceDirection = 'forward';
let _resonanceSourceMol = null;
let _suppressResonanceRowClickUntil = 0;
let _suppressResonanceClickCount = 0;

const RESONANCE_PAIR_PRODUCT_PREFIX = '__resonance_product__:';
const RESONANCE_PAIR_FORCE_FIT_PAD = FORCE_LAYOUT_INITIAL_FIT_PAD;
const RESONANCE_PAIR_FORCE_FIT_SCALE_MULTIPLIER = FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER;
const RESONANCE_NAV_CLICK_SUPPRESS_MS = 1500;

const _RESONANCE_PRESERVE_CLICK_SELECTORS = ['#plot', '#rotate-controls', '#force-controls', '#clean-controls', '#draw-tools', '#atom-selector', '#toggle-controls'].join(', ');

function forcePixelsPerMoleculeUnit(layoutBondLength = getRenderOptions().layoutBondLength ?? 1.5) {
  const parsedBondLength = Number(layoutBondLength);
  const moleculeBondLength = Number.isFinite(parsedBondLength) && parsedBondLength > 0 ? parsedBondLength : 1.5;
  const forceBondLength = FORCE_LAYOUT_BOND_LENGTH * forceLayoutBondScale(moleculeBondLength);
  return forceBondLength / moleculeBondLength;
}

/**
 * Initializes the resonance-panel renderer with the app context it needs to
 * redraw the active molecule in either 2D or force mode.
 * @param {object} context - App context object.
 * @param {'2d'|'force'} context.mode - Current layout mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context.currentMol - Active molecule in force mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context._mol2d - Active molecule in 2D mode.
 * @param {() => void} context.draw2d - Triggers a 2D redraw.
 * @param {() => void} [context.resetOrientation] - Clears any active 2D rotate/flip view transform before drawing locked resonance pairs.
 * @param {() => Array<object>} [context.getForceNodes] - Returns current force-simulation nodes for preserving force-mode pose.
 * @param {(mol: object, options?: object) => void} context.updateForce - Triggers a force-layout redraw.
 * @param {() => boolean} [context.hasReactionPreview] - Returns true when a reaction preview is active.
 * @param {(options?: object) => boolean} [context.restoreReactionPreviewSource] - Restores the reaction preview source molecule.
 * @param {(options?: object) => void} [context.takeSnapshot] - Pushes an undo snapshot.
 */
export function initResonancePanel(context) {
  ctx = context;
}

/**
 * Clears the resonance-panel UI state without mutating the current molecule.
 */
export function clearResonancePanelState() {
  _resonanceLocked = false;
  _activeResonanceState = 1;
  _activeResonancePairIndex = 0;
  _activeResonanceDirection = 'forward';
  _resonanceSourceMol = null;
  _suppressResonanceRowClickUntil = 0;
  _suppressResonanceClickCount = 0;
  const tbody = document.getElementById('resonance-body');
  if (tbody) {
    tbody.innerHTML = '';
  }
}

/**
 * Returns whether a click on the given DOM target should leave the current resonance contributor locked.
 * @param {EventTarget|null} target - The element that received the click event.
 * @returns {boolean} True if the resonance view should be preserved for this target.
 */
export function shouldPreserveResonanceForClickTarget(target) {
  if (!target?.closest) {
    return false;
  }
  if (target.closest('#resonance-table')) {
    return true;
  }
  return !!target.closest(_RESONANCE_PRESERVE_CLICK_SELECTORS);
}

/**
 * Returns whether a resonance contributor pair is currently locked for display.
 * @returns {boolean} True when a resonance pair view is active.
 */
export function hasActiveResonanceView() {
  return _resonanceLocked && !!_resonanceSourceMol?.properties?.resonance;
}

/**
 * Resolves the canonical source molecule behind the active resonance display.
 * @param {import('../../core/Molecule.js').Molecule|null} [mol] - Displayed molecule fallback.
 * @returns {import('../../core/Molecule.js').Molecule|null} Source molecule when available.
 */
export function getActiveResonanceSourceMolecule(mol = _currentResonanceMolecule()) {
  return _resonanceSourceMol ?? _resolveResonanceTargetMolecule(mol);
}

/**
 * Restores the molecule's default resonance contributor, unlocks the
 * resonance row, redraws the current mode, and refreshes the panel UI.
 * @param {import('../../core/Molecule.js').Molecule|null} [mol] - Molecule to reset; defaults to the currently displayed molecule.
 * @returns {boolean} True if a locked contributor was reset, false if resonance was already unlocked.
 */
export function resetActiveResonanceView(mol = _currentResonanceMolecule()) {
  mol = _resonanceSourceMol ?? _resolveResonanceTargetMolecule(mol);
  if (!_resonanceLocked || !mol?.properties?.resonance) {
    _resonanceLocked = false;
    _activeResonanceState = 1;
    _activeResonancePairIndex = 0;
    _activeResonanceDirection = 'forward';
    clearMoleculeResonanceElectronFlow(mol);
    _setDisplayedResonanceMolecule(mol);
    _resonanceSourceMol = null;
    _renderResonancePanel(mol);
    return false;
  }
  mol.setResonanceState(1);
  clearMoleculeResonanceElectronFlow(mol);
  _resonanceLocked = false;
  _activeResonanceState = 1;
  _activeResonancePairIndex = 0;
  _activeResonanceDirection = 'forward';
  const forceInitialPatchPos = _forceInitialPatchFromCurrentSourceNodes(mol);
  _setDisplayedResonanceMolecule(mol);
  _resonanceSourceMol = null;
  _redrawResonanceMolecule(mol, { forceAutoFit: true, forceInitialPatchPos });
  _renderResonancePanel(mol);
  return true;
}

/**
 * Prepares a molecule for a structural edit by restoring contributor 1 and
 * clearing any stored resonance tables so later recomputation starts from the
 * edited graph instead of reviving stale contributors.
 * @param {import('../../core/Molecule.js').Molecule|null} [mol] - Molecule to prepare; defaults to the currently displayed molecule.
 * @returns {{mol: import('../../core/Molecule.js').Molecule|null, resonanceReset: boolean, resonanceCleared: boolean}} Structural edit preparation result.
 */
export function prepareResonanceStateForStructuralEdit(mol = _currentResonanceMolecule()) {
  mol = _resonanceSourceMol ?? _resolveResonanceTargetMolecule(mol);
  if (!mol?.properties?.resonance) {
    return { mol, resonanceReset: false, resonanceCleared: false };
  }
  const resonanceReset = _resonanceLocked;
  mol.setResonanceState(1);
  clearMoleculeResonanceElectronFlow(mol);
  mol.clearResonanceStates();
  _resonanceLocked = false;
  _activeResonanceState = 1;
  _activeResonancePairIndex = 0;
  _activeResonanceDirection = 'forward';
  _setDisplayedResonanceMolecule(mol);
  _resonanceSourceMol = null;
  return { mol, resonanceReset, resonanceCleared: true };
}

/**
 * Captures the current locked resonance contributor index for undo/redo snapshot purposes.
 * @param {import('../../core/Molecule.js').Molecule|null} [mol] - Molecule to snapshot; defaults to the currently displayed molecule.
 * @returns {{locked: boolean, activeState: number}|null} Snapshot object, or null if resonance is not locked.
 */
export function captureResonanceViewSnapshot(mol = _currentResonanceMolecule()) {
  mol = _resonanceSourceMol ?? _resolveResonanceTargetMolecule(mol);
  if (!_resonanceLocked || !mol?.properties?.resonance) {
    return null;
  }
  return {
    locked: true,
    activeState: _activeResonanceState,
    activePairIndex: _activeResonancePairIndex,
    activeDirection: _activeResonanceDirection
  };
}

/**
 * Prepares a molecule snapshot suitable for undo history, reverting to contributor 1 before cloning if resonance is locked.
 * @param {import('../../core/Molecule.js').Molecule|null} [mol] - Molecule to snapshot; defaults to the currently displayed molecule.
 * @returns {{mol: import('../../core/Molecule.js').Molecule|null, resonanceView: {locked: boolean, activeState: number}|null}} The snapshot molecule and associated resonance view state.
 */
export function prepareResonanceUndoSnapshot(mol = _currentResonanceMolecule()) {
  // Undo snapshots for reaction preview should never route through the
  // resonance target resolver, because that resolver intentionally restores the
  // source molecule and would collapse the live preview during snapshot
  // capture. The preview snapshot already carries its own source molecule.
  if (ctx.hasReactionPreview?.()) {
    return { mol, resonanceView: null };
  }
  mol = _resonanceSourceMol ?? mol;
  const resonanceView = captureResonanceViewSnapshot(mol);
  if (!resonanceView) {
    return { mol, resonanceView: null };
  }
  const previousState = resonanceView.activeState;
  const previousFlow = mol.properties?.resonanceElectronFlow;
  mol.setResonanceState(1);
  clearMoleculeResonanceElectronFlow(mol);
  const snapshotMol = mol.clone();
  mol.setResonanceState(previousState);
  if (previousFlow) {
    mol.properties.resonanceElectronFlow = previousFlow;
  } else {
    setMoleculeResonanceElectronFlow(mol, previousState);
  }
  return { mol: snapshotMol, resonanceView };
}

/**
 * Restores the resonance contributor view from a previously captured snapshot and refreshes the panel.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - Molecule to apply the snapshot to.
 * @param {{locked: boolean, activeState: number}|null} [snapshot] - Snapshot from `captureResonanceViewSnapshot`, or null to reset to contributor 1.
 * @returns {boolean} True if a locked resonance state was successfully restored, false if reset to default.
 */
export function restoreResonanceViewSnapshot(mol, snapshot = null) {
  if (!snapshot?.locked || !mol?.properties?.resonance) {
    _resonanceLocked = false;
    _activeResonanceState = 1;
    _activeResonancePairIndex = 0;
    _activeResonanceDirection = 'forward';
    clearMoleculeResonanceElectronFlow(mol);
    _setDisplayedResonanceMolecule(mol);
    _resonanceSourceMol = null;
    _renderResonancePanel(mol);
    return false;
  }
  const count = Math.max(1, mol.resonanceCount);
  const pairs = resonancePairSequence(count);
  const pairIndex = Math.max(0, Math.min(snapshot.activePairIndex ?? Math.max(0, (snapshot.activeState ?? 2) - 2), pairs.length - 1));
  const pair = resonancePairAt(count, pairIndex, snapshot.activeDirection === 'reverse' ? 'reverse' : 'forward') ?? { fromState: 1, toState: Math.max(1, Math.min(snapshot.activeState ?? 1, count)) };
  _resonanceLocked = true;
  _activeResonanceState = pair.toState;
  _activeResonancePairIndex = pairIndex;
  _activeResonanceDirection = pair.direction ?? 'forward';
  _resonanceSourceMol = mol;
  mol.setResonanceState(pair.toState);
  setMoleculeResonanceElectronFlow(mol, pair.toState, { fromState: pair.fromState, toState: pair.toState });
  const displayMol = buildResonancePairDisplayMolecule(mol, pair);
  _setDisplayedResonanceMolecule(displayMol ?? mol);
  _renderResonancePanel(mol);
  return true;
}

/**
 * Recomputes resonance contributors for the given molecule and refreshes the
 * resonance panel. Structural edits should call this after the molecular graph
 * changes so stale contributor tables are discarded.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to recompute resonance for.
 * @param {object} [options] - Optional configuration.
 * @param {boolean} [options.recompute] - When false, skips recomputation and only refreshes the panel UI.
 */
export function updateResonancePanel(mol, options = {}) {
  const { recompute = true } = options;
  if (mol?.__reactionPreview?.resonancePair && _resonanceSourceMol) {
    mol = _resonanceSourceMol;
  }
  if (!mol) {
    clearResonancePanelState();
    return;
  }
  if (recompute) {
    if (!mol.properties?.resonance) {
      _resonanceLocked = false;
      _activeResonanceState = 1;
      _activeResonanceDirection = 'forward';
    } else {
      _activeResonanceState = Math.max(1, Math.min(_activeResonanceState, mol.resonanceCount));
    }
  } else if (mol.properties?.resonance) {
    _activeResonanceState = Math.max(1, Math.min(_activeResonanceState, mol.resonanceCount));
  } else {
    _resonanceLocked = false;
    _activeResonanceState = 1;
    _activeResonanceDirection = 'forward';
  }
  _renderResonancePanel(mol);
}

function _currentResonanceMolecule() {
  return _resonanceSourceMol ?? modeHelpers.currentMol();
}

function _setDisplayedResonanceMolecule(mol) {
  if (!mol) {
    return;
  }
  if (ctx.mode === 'force') {
    if (typeof ctx.setCurrentMol === 'function') {
      ctx.setCurrentMol(mol);
    } else {
      ctx.currentMol = mol;
    }
  } else if (typeof ctx.setMol2d === 'function') {
    ctx.setMol2d(mol);
  } else {
    ctx._mol2d = mol;
  }
}

/**
 * If a reaction preview is currently active, restores the source molecule so
 * resonance clicks always operate on the real molecule instead of the preview.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - Molecule to resolve.
 * @returns {import('../../core/Molecule.js').Molecule|null} The resolved molecule, or the original if no preview is active.
 */
function _resolveResonanceTargetMolecule(mol) {
  if (!ctx.hasReactionPreview?.()) {
    return mol;
  }
  const restored = ctx.restoreReactionPreviewSource?.(ctx.mode === '2d' ? { restoreEntryZoom: true, restoreEntryDisplay: true } : { restoreEntryZoom: true });
  if (!restored) {
    return mol;
  }
  return _currentResonanceMolecule() ?? mol;
}

function _forceAnchorLayoutFromVisibleResonanceCoords(mol) {
  const anchors = new Map();
  for (const [id, atom] of mol?.atoms ?? []) {
    if (atom.name === 'H' || atom.visible === false || !Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    anchors.set(id, { x: atom.x, y: atom.y });
  }
  return anchors.size > 0 ? anchors : null;
}

function _forceInitialPatchFromVisibleResonanceCoords(mol, anchorLayout) {
  if (!mol?.atoms || !anchorLayout?.size) {
    return null;
  }
  const anchors = [...anchorLayout].filter(([, pos]) => Number.isFinite(pos?.x) && Number.isFinite(pos?.y));
  if (anchors.length === 0) {
    return null;
  }
  let cx = 0;
  let cy = 0;
  for (const [, pos] of anchors) {
    cx += pos.x;
    cy += pos.y;
  }
  cx /= anchors.length;
  cy /= anchors.length;

  const plotRect = ctx.plotEl?.getBoundingClientRect?.();
  const width = Number.isFinite(plotRect?.width) && plotRect.width > 0 ? plotRect.width : 600;
  const height = Number.isFinite(plotRect?.height) && plotRect.height > 0 ? plotRect.height : 400;
  const scale = forcePixelsPerMoleculeUnit();
  const patch = new Map();
  for (const [id, pos] of anchors) {
    patch.set(id, {
      x: width / 2 + (pos.x - cx) * scale,
      y: height / 2 - (pos.y - cy) * scale
    });
  }
  return patch.size > 0 ? patch : null;
}

function _forceInitialPatchFromCurrentSourceNodes(mol) {
  if (ctx.mode !== 'force' || typeof ctx.getForceNodes !== 'function' || !mol?.atoms?.size) {
    return null;
  }
  const patch = new Map();
  for (const node of ctx.getForceNodes() ?? []) {
    const atom = mol.atoms.get(node?.id);
    if (!atom || atom.name === 'H' || atom.visible === false || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      continue;
    }
    patch.set(node.id, { x: node.x, y: node.y });
  }
  return patch.size > 0 ? patch : null;
}

function _redrawResonanceMolecule(mol, options = {}) {
  const { forceAutoFit = false, preserveForcePairLayout = false, forceInitialPatchPos = null } = options;
  if (ctx.mode !== 'force' && typeof ctx.render2d === 'function') {
    if (mol?.__reactionPreview?.resonancePair === true) {
      ctx.resetOrientation?.();
    }
    ctx.render2d(mol, {
      recomputeResonance: false,
      refreshResonancePanel: false,
      preserveAnalysis: true,
      preserveGeometry: true
    });
    return;
  }
  if (ctx.mode === 'force' && (forceAutoFit || mol?.__reactionPreview?.resonancePair) && typeof ctx.updateForce === 'function') {
    const anchorLayout = _forceAnchorLayoutFromVisibleResonanceCoords(mol);
    if (preserveForcePairLayout) {
      ctx.updateForce(mol, {
        preservePositions: true,
        preserveView: true,
        anchorLayout
      });
      return;
    }
    const isResonancePair = mol?.__reactionPreview?.resonancePair === true;
    const initialPatchPos = forceInitialPatchPos ?? (isResonancePair ? _forceInitialPatchFromVisibleResonanceCoords(mol, anchorLayout) : null);
    ctx.updateForce(mol, {
      preservePositions: false,
      preserveView: false,
      anchorLayout,
      ...(isResonancePair
        ? {
            fitPad: RESONANCE_PAIR_FORCE_FIT_PAD,
            fitScaleMultiplier: RESONANCE_PAIR_FORCE_FIT_SCALE_MULTIPLIER,
            fitReactionLike: true,
            ...(initialPatchPos ? { initialPatchPos } : {})
          }
        : initialPatchPos
          ? { initialPatchPos }
          : {})
    });
    return;
  }
  modeHelpers.redraw(mol);
}

const _resonanceNavButton = createNavButton;

function resonancePairSequence(count) {
  const n = Math.max(1, count);
  if (n <= 1) {
    return [];
  }
  return Array.from({ length: n }, (_, index) => resonancePairAt(n, index, 'forward'));
}

function resonancePairAt(count, pairIndex, direction = 'forward') {
  const n = Math.max(1, count);
  if (n <= 1) {
    return null;
  }
  const index = ((pairIndex % n) + n) % n;
  const leftState = index + 1;
  const rightState = index === n - 1 ? 1 : index + 2;
  const reverse = direction === 'reverse';
  return {
    pairIndex: index,
    direction: reverse ? 'reverse' : 'forward',
    leftState,
    rightState,
    fromState: reverse ? rightState : leftState,
    toState: reverse ? leftState : rightState,
    sourceSide: reverse ? 'right' : 'left'
  };
}

function suppressResonanceResetClick() {
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  _suppressResonanceRowClickUntil = now + RESONANCE_NAV_CLICK_SUPPRESS_MS;
  _suppressResonanceClickCount = Math.max(_suppressResonanceClickCount, 1);
}

function consumeSuppressedResonanceResetClick() {
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  if (_suppressResonanceClickCount <= 0 || now > _suppressResonanceRowClickUntil) {
    _suppressResonanceClickCount = 0;
    return false;
  }
  _suppressResonanceClickCount -= 1;
  return true;
}

function prefixResonanceElectronFlowIds(flow, prefix) {
  if (!flow || !prefix) {
    return flow;
  }
  const prefixEndpoint = endpoint => {
    if (!endpoint) {
      return endpoint;
    }
    return {
      ...endpoint,
      ...(endpoint.atomId != null ? { atomId: `${prefix}${endpoint.atomId}` } : {}),
      ...(endpoint.bondId != null ? { bondId: `${prefix}${endpoint.bondId}` } : {})
    };
  };
  return {
    ...flow,
    arrows: (flow.arrows ?? []).map(arrow => ({
      ...arrow,
      from: prefixEndpoint(arrow.from),
      to: prefixEndpoint(arrow.to)
    }))
  };
}

function cloneResonanceDisplaySourceWithCurrentPose(sourceMol) {
  const displaySource = sourceMol.clone();
  if (ctx.mode !== 'force' || typeof ctx.getForceNodes !== 'function') {
    return displaySource;
  }

  const nodes = ctx.getForceNodes() ?? [];
  const finiteHeavyNodes = nodes.filter(node => {
    const atom = displaySource.atoms.get(node?.id);
    return atom && atom.name !== 'H' && atom.visible !== false && Number.isFinite(node.x) && Number.isFinite(node.y);
  });
  if (finiteHeavyNodes.length === 0) {
    return displaySource;
  }

  let cx = 0;
  let cy = 0;
  for (const node of finiteHeavyNodes) {
    cx += node.x;
    cy += node.y;
  }
  cx /= finiteHeavyNodes.length;
  cy /= finiteHeavyNodes.length;

  const scale = 1 / forcePixelsPerMoleculeUnit(ctx.getRenderOptions?.().layoutBondLength);
  for (const node of nodes) {
    const atom = displaySource.atoms.get(node?.id);
    if (!atom || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      continue;
    }
    atom.x = (node.x - cx) * scale;
    atom.y = (cy - node.y) * scale;
  }
  return displaySource;
}

function preserveSourceRingFillsOnResonancePair(pairMol, sourceMol) {
  if (!pairMol || !sourceMol || typeof sourceMol.getRingFills !== 'function' || typeof pairMol.setRingFill !== 'function') {
    return;
  }
  const pairRingKeys = typeof pairMol.getRings === 'function'
    ? new Set(pairMol.getRings().map(ringAtomIds => ringAtomKey(ringAtomIds)))
    : null;
  const canFillRing = atomIds => atomIds.length > 0
    && atomIds.every(atomId => pairMol.atoms.has(atomId))
    && (!pairRingKeys || pairRingKeys.has(ringAtomKey(atomIds)));

  for (const fill of sourceMol.getRingFills()) {
    const atomIds = fill.atomIds ?? [];
    if (canFillRing(atomIds)) {
      pairMol.setRingFill(atomIds, fill);
    }

    const productAtomIds = atomIds.map(atomId => `${RESONANCE_PAIR_PRODUCT_PREFIX}${atomId}`);
    if (canFillRing(productAtomIds)) {
      pairMol.setRingFill(productAtomIds, { color: fill.color, opacity: fill.opacity });
    }
  }
}

function buildResonancePairDisplayMolecule(sourceMol, pair) {
  if (!sourceMol?.properties?.resonance) {
    return null;
  }
  const count = Math.max(1, sourceMol.resonanceCount);
  const leftState = Math.max(1, Math.min(pair?.leftState ?? pair?.fromState ?? 1, count));
  const rightState = Math.max(1, Math.min(pair?.rightState ?? pair?.toState ?? 1, count));
  const sourceState = Math.max(1, Math.min(pair?.fromState ?? leftState, count));
  const targetState = Math.max(1, Math.min(pair?.toState ?? rightState, count));
  const sourceSide = pair?.sourceSide === 'right' ? 'right' : 'left';
  const displaySource = cloneResonanceDisplaySourceWithCurrentPose(sourceMol);
  const left = displaySource.clone();
  const rightSource = displaySource.clone();
  left.setResonanceState(leftState);
  rightSource.setResonanceState(rightState);
  const baseFlowSource = sourceSide === 'right' ? rightSource : left;
  const baseFlow = buildResonanceElectronFlow(baseFlowSource, targetState, { fromState: sourceState, toState: targetState });
  const flow = sourceSide === 'right' ? prefixResonanceElectronFlowIds(baseFlow, RESONANCE_PAIR_PRODUCT_PREFIX) : baseFlow;
  const right = cloneWithPrefixedIds(rightSource, RESONANCE_PAIR_PRODUCT_PREFIX);
  const pairMol = left.merge(right);
  pairMol.clearResonanceStates();
  pairMol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY] = flow;
  const reactantAtomIds = new Set(left.atoms.keys());
  const productAtomIds = new Set(right.atoms.keys());
  const reactantReferenceCoords = new Map(
    [...left.atoms.values()]
      .filter(atom => atom.x != null && atom.y != null)
      .map(atom => [atom.id, { x: atom.x, y: atom.y }])
  );
  pairMol.__reactionPreview = {
    reactantAtomIds,
    productAtomIds,
    productComponentAtomIdSets: [productAtomIds],
    mappedAtomPairs: [...left.atoms.keys()].filter(atomId => sourceMol.atoms.has(atomId)).map(atomId => [atomId, `${RESONANCE_PAIR_PRODUCT_PREFIX}${atomId}`]),
    editedProductAtomIds: new Set(productAtomIds),
    reactantReferenceCoords,
    skipForceStereoSeed: true,
    resonancePair: true,
    resonanceDirection: pair?.direction === 'reverse' ? 'reverse' : 'forward',
    sourceSide,
    fromState: sourceState,
    toState: targetState,
    leftState,
    rightState
  };
  centerReaction2dPairCoords(pairMol, pairMol.__reactionPreview, ctx.getRenderOptions?.().layoutBondLength ?? 1.5);
  preserveSourceRingFillsOnResonancePair(pairMol, sourceMol);
  return pairMol;
}

/**
 * Applies a specific resonance contributor to the current molecule and updates
 * the row state shown in the resonance panel.
 * @param {import('../../core/Molecule.js').Molecule} mol - The molecule to apply the state to.
 * @param {number} pairIndex - 0-based resonance pair index to activate.
 * @param {'forward'|'reverse'} [direction] - Direction to display between adjacent structures.
 */
function _activateResonancePair(mol, pairIndex, direction = 'forward') {
  if (ctx.hasReactionPreview?.()) {
    ctx.takeSnapshot?.({ clearReactionPreview: false });
  }
  mol = _resonanceSourceMol ?? _resolveResonanceTargetMolecule(mol);
  if (!mol?.properties?.resonance) {
    return;
  }
  const pairs = resonancePairSequence(mol.resonanceCount);
  if (pairs.length === 0) {
    return;
  }
  const preserveForcePairLayout = ctx.mode === 'force' && _resonanceLocked && _resonanceSourceMol === mol;
  const nextPairIndex = ((pairIndex % pairs.length) + pairs.length) % pairs.length;
  const pair = resonancePairAt(mol.resonanceCount, nextPairIndex, direction);
  _resonanceLocked = true;
  _activeResonanceState = pair.toState;
  _activeResonancePairIndex = nextPairIndex;
  _activeResonanceDirection = pair.direction;
  _resonanceSourceMol = mol;
  mol.setResonanceState(pair.toState);
  setMoleculeResonanceElectronFlow(mol, pair.toState, { fromState: pair.fromState, toState: pair.toState });
  const displayMol = buildResonancePairDisplayMolecule(mol, pair);
  _setDisplayedResonanceMolecule(displayMol ?? mol);
  _redrawResonanceMolecule(displayMol ?? mol, { preserveForcePairLayout });
  _renderResonancePanel(mol);
}

/**
 * Renders the resonance row for the provided molecule.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to render the panel for.
 */
function _renderResonancePanel(mol) {
  if (typeof document === 'undefined') {
    return;
  }
  const tbody = document.getElementById('resonance-body');
  if (!tbody) {
    return;
  }
  if (!mol) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = '';
  const tr = document.createElement('tr');

  const nameCell = document.createElement('td');
  const countCell = document.createElement('td');
  countCell.className = 'reaction-count';

  const name = document.createElement('div');
  name.className = 'reaction-name';
  name.textContent = 'Resonance Structures';
  nameCell.appendChild(name);

  if (!mol.properties?.resonance) {
    const computeBtn = document.createElement('button');
    computeBtn.type = 'button';
    computeBtn.className = 'resonance-compute-btn';
    computeBtn.textContent = 'Compute';
    computeBtn.title = 'Enumerate resonance contributors';
    computeBtn.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    computeBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      generateResonanceStructures(mol, RESONANCE_PANEL_OPTIONS);
      clearMoleculeResonanceElectronFlow(mol);
      _resonanceLocked = false;
      _activeResonanceState = 1;
      _renderResonancePanel(mol);
    });
    countCell.appendChild(computeBtn);
    tr.appendChild(nameCell);
    tr.appendChild(countCell);
    tbody.appendChild(tr);
    return;
  }

  const count = Math.max(1, mol.resonanceCount);
  const pairs = resonancePairSequence(count);
  const pairCount = pairs.length;
  const isCyclable = pairCount > 0;
  const isActive = _resonanceLocked && isCyclable;
  const activePairIndex = Math.max(0, Math.min(_activeResonancePairIndex, Math.max(0, pairCount - 1)));
  const activePair = resonancePairAt(count, activePairIndex, _activeResonanceDirection);

  if (isActive) {
    tr.classList.add('resonance-active');
  }
  if (isCyclable) {
    tr.classList.add('resonance-clickable');
  }

  countCell.textContent = String(count);

  if (isActive) {
    const nav = document.createElement('div');
    nav.className = 'reaction-nav';
    const stateLabel = document.createElement('span');
    stateLabel.className = 'reaction-site-label';
    stateLabel.textContent = activePair
      ? activePair.direction === 'reverse'
        ? `${activePair.leftState}←${activePair.rightState}`
        : `${activePair.leftState}→${activePair.rightState}`
      : `${_activeResonanceState}/${count}`;
    nav.appendChild(
      _resonanceNavButton('‹', 'Previous resonance pair', () => {
        suppressResonanceResetClick();
        const previousIndex = activePair?.direction === 'reverse' ? activePairIndex - 1 : activePairIndex;
        _activateResonancePair(mol, previousIndex, 'reverse');
      })
    );
    nav.appendChild(stateLabel);
    nav.appendChild(
      _resonanceNavButton('›', 'Next resonance pair', () => {
        suppressResonanceResetClick();
        const nextIndex = activePair?.direction === 'reverse' ? activePairIndex : activePairIndex + 1;
        _activateResonancePair(mol, nextIndex, 'forward');
      })
    );
    nameCell.appendChild(nav);
  }

  tr.appendChild(nameCell);
  tr.appendChild(countCell);

  tr.addEventListener('click', event => {
    if (!isCyclable) {
      return;
    }
    event.stopPropagation();
    if (consumeSuppressedResonanceResetClick()) {
      event.preventDefault();
      return;
    }
    if (_resonanceLocked) {
      resetActiveResonanceView(mol);
      return;
    }
    _activateResonancePair(mol, 0, 'forward');
  });

  tbody.appendChild(tr);
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    event => {
      // Don't reset when the user interacts with resonance navigation or
      // view/tool controls; those shouldn't kick the user back to contributor 1.
      if (shouldPreserveResonanceForClickTarget(event.target)) {
        return;
      }
      if (consumeSuppressedResonanceResetClick()) {
        event.preventDefault();
        return;
      }
      if (!_resonanceLocked) {
        return;
      }
      resetActiveResonanceView();
    },
    true
  );
}
