/** @module app/render/resonance */

import { generateResonanceStructures } from '../../algorithms/index.js';

let ctx = {};

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

const _RESONANCE_PRESERVE_CLICK_SELECTORS = ['#plot', '#rotate-controls', '#force-controls', '#clean-controls', '#draw-tools', '#atom-selector', '#toggle-controls'].join(', ');

/**
 * Initializes the resonance-panel renderer with the app context it needs to
 * redraw the active molecule in either 2D or force mode.
 * @param {object} context - App context object.
 * @param {'2d'|'force'} context.mode - Current layout mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context.currentMol - Active molecule in force mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context._mol2d - Active molecule in 2D mode.
 * @param {() => void} context.draw2d - Triggers a 2D redraw.
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
 * Restores the molecule's default resonance contributor, unlocks the
 * resonance row, redraws the current mode, and refreshes the panel UI.
 * @param {import('../../core/Molecule.js').Molecule|null} [mol] - Molecule to reset; defaults to the currently displayed molecule.
 * @returns {boolean} True if a locked contributor was reset, false if resonance was already unlocked.
 */
export function resetActiveResonanceView(mol = _currentResonanceMolecule()) {
  mol = _resolveResonanceTargetMolecule(mol);
  if (!_resonanceLocked || !mol?.properties?.resonance) {
    _resonanceLocked = false;
    _activeResonanceState = 1;
    _renderResonancePanel(mol);
    return false;
  }
  mol.setResonanceState(1);
  _resonanceLocked = false;
  _activeResonanceState = 1;
  _redrawResonanceMolecule(mol);
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
  mol = _resolveResonanceTargetMolecule(mol);
  if (!mol?.properties?.resonance) {
    return { mol, resonanceReset: false, resonanceCleared: false };
  }
  const resonanceReset = _resonanceLocked;
  mol.setResonanceState(1);
  mol.clearResonanceStates();
  _resonanceLocked = false;
  _activeResonanceState = 1;
  return { mol, resonanceReset, resonanceCleared: true };
}

/**
 * Captures the current locked resonance contributor index for undo/redo snapshot purposes.
 * @param {import('../../core/Molecule.js').Molecule|null} [mol] - Molecule to snapshot; defaults to the currently displayed molecule.
 * @returns {{locked: boolean, activeState: number}|null} Snapshot object, or null if resonance is not locked.
 */
export function captureResonanceViewSnapshot(mol = _currentResonanceMolecule()) {
  mol = _resolveResonanceTargetMolecule(mol);
  if (!_resonanceLocked || !mol?.properties?.resonance) {
    return null;
  }
  return {
    locked: true,
    activeState: _activeResonanceState
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
  const resonanceView = captureResonanceViewSnapshot(mol);
  if (!resonanceView) {
    return { mol, resonanceView: null };
  }
  const previousState = resonanceView.activeState;
  mol.setResonanceState(1);
  const snapshotMol = mol.clone();
  mol.setResonanceState(previousState);
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
    _renderResonancePanel(mol);
    return false;
  }
  const nextState = Math.max(1, Math.min(snapshot.activeState ?? 1, mol.resonanceCount));
  _resonanceLocked = true;
  _activeResonanceState = nextState;
  mol.setResonanceState(nextState);
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
  if (!mol) {
    clearResonancePanelState();
    return;
  }
  if (recompute) {
    if (!mol.properties?.resonance) {
      _resonanceLocked = false;
      _activeResonanceState = 1;
    } else {
      _activeResonanceState = Math.max(1, Math.min(_activeResonanceState, mol.resonanceCount));
    }
  } else if (mol.properties?.resonance) {
    _activeResonanceState = Math.max(1, Math.min(_activeResonanceState, mol.resonanceCount));
  } else {
    _resonanceLocked = false;
    _activeResonanceState = 1;
  }
  _renderResonancePanel(mol);
}

/**
 * Returns the currently rendered molecule for the active mode.
 * @returns {import('../../core/Molecule.js').Molecule|null} The active 2D or force-layout molecule.
 */
function _currentResonanceMolecule() {
  return ctx.mode === 'force' ? (ctx.currentMol ?? null) : (ctx._mol2d ?? null);
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

/**
 * Redraws the active molecule after a resonance contributor change while
 * keeping the current view stable in force mode.
 * @param {import('../../core/Molecule.js').Molecule} mol - The molecule to redraw.
 */
function _redrawResonanceMolecule(mol) {
  if (ctx.mode === 'force') {
    ctx.updateForce(mol, { preservePositions: true, preserveView: true });
    return;
  }
  ctx.draw2d();
}

/**
 * Creates a small circular navigation button for the resonance panel.
 * @param {string} label - Button text label.
 * @param {string} title - Tooltip title.
 * @param {() => void} onActivate - Callback invoked when the button is clicked.
 * @returns {HTMLButtonElement} The created button element.
 */
function _resonanceNavButton(label, title, onActivate) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reaction-nav-btn';
  btn.title = title;
  btn.textContent = label;
  btn.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  });
  btn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  return btn;
}

/**
 * Applies a specific resonance contributor to the current molecule and updates
 * the row state shown in the resonance panel.
 * @param {import('../../core/Molecule.js').Molecule} mol - The molecule to apply the state to.
 * @param {number} state - 1-based resonance contributor index to activate.
 */
function _activateResonanceState(mol, state) {
  if (ctx.hasReactionPreview?.()) {
    ctx.takeSnapshot?.({ clearReactionPreview: false });
  }
  mol = _resolveResonanceTargetMolecule(mol);
  if (!mol?.properties?.resonance) {
    return;
  }
  _resonanceLocked = true;
  _activeResonanceState = state;
  mol.setResonanceState(state);
  _redrawResonanceMolecule(mol);
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
  const isCyclable = count > 1;
  const isActive = _resonanceLocked && isCyclable;
  const activeState = Math.max(1, Math.min(_activeResonanceState, count));

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
    stateLabel.textContent = `${activeState}/${count}`;
    nav.appendChild(
      _resonanceNavButton('‹', 'Previous resonance structure', () => {
        const previous = activeState - 1 < 1 ? count : activeState - 1;
        _activateResonanceState(mol, previous);
      })
    );
    nav.appendChild(stateLabel);
    nav.appendChild(
      _resonanceNavButton('›', 'Next resonance structure', () => {
        const next = activeState + 1 > count ? 1 : activeState + 1;
        _activateResonanceState(mol, next);
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
    if (_resonanceLocked) {
      resetActiveResonanceView(mol);
      return;
    }
    _activateResonanceState(mol, 2);
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
      if (!_resonanceLocked) {
        return;
      }
      resetActiveResonanceView();
    },
    true
  );
}
