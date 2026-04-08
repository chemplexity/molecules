/** @module app/render/bond-en-polarity */

import { bondElectronegativityDifference } from '../../descriptors/physicochemical.js';

let ctx = {};
let _bondEnActive = false;

/**
 * Initializes the bond-EN panel renderer with the app context it needs to
 * redraw the active molecule in either 2D or force mode.
 * @param {object} context - App context object.
 * @param {'2d'|'force'} context.mode - Current layout mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context.currentMol - Active molecule in force mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context._mol2d - Active molecule in 2D mode.
 * @param {() => void} context.draw2d - Triggers a 2D redraw.
 * @param {(mol: object, options?: object) => void} context.updateForce - Triggers a force-layout redraw.
 */
export function initBondEnPanel(context) {
  ctx = context;
}

function _currentDisplayedMol() {
  return ctx.mode === 'force' ? (ctx.currentMol ?? null) : (ctx._mol2d ?? null);
}

/**
 * Returns whether the bond electronegativity overlay is currently active.
 * @returns {boolean} True if the bond-EN overlay is active.
 */
export function getBondEnActive() {
  return _bondEnActive;
}

/**
 * Returns overlay data for rendering bond polarity labels, or null when the
 * overlay is inactive. Each entry includes the display label and a normalised
 * value t ∈ [0, 1] (0 = nonpolar, 1 = most polar bond in the molecule).
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to compute overlay data for.
 * @returns {Array<{bondId: string, label: string, t: number}>|null} Per-bond polarity entries, or null when inactive.
 */
export function getBondEnOverlayData(mol) {
  if (!_bondEnActive || !mol) {
    return null;
  }
  const entries = [];
  let max = 0;
  for (const bond of mol.bonds.values()) {
    const delta = bondElectronegativityDifference(mol, bond.id);
    if (delta === null) {
      continue;
    }
    entries.push({ bondId: bond.id, delta });
    if (delta > max) {
      max = delta;
    }
  }
  if (entries.length === 0) {
    return null;
  }
  const norm = max > 0 ? max : 1;
  return entries.map(({ bondId, delta }) => ({
    bondId,
    label: delta.toFixed(2),
    t: delta / norm
  }));
}

/**
 * Clears the bond-EN panel UI state and deactivates the overlay.
 */
export function clearBondEnPanel() {
  _bondEnActive = false;
  const tbody = document.getElementById('bond-en-body');
  if (tbody) {
    tbody.innerHTML = '';
  }
}

/**
 * Renders or refreshes the Bond Electronegativity toggle row.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to render the panel for.
 */
export function updateBondEnPanel(mol) {
  if (typeof document === 'undefined') {
    return;
  }
  const tbody = document.getElementById('bond-en-body');
  if (!tbody) {
    return;
  }
  if (!mol) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = '';

  const tr = document.createElement('tr');
  tr.classList.add('resonance-clickable');
  tr.title = 'Pauling electronegativity difference (Δχ) per bond. ' + 'Values reflect atomic electronegativity only and are independent of bond order.';
  if (_bondEnActive) {
    tr.classList.add('resonance-active');
  }

  const nameCell = document.createElement('td');
  const countCell = document.createElement('td');
  countCell.className = 'reaction-count';
  countCell.textContent = _bondEnActive ? 'On' : 'Off';

  const name = document.createElement('div');
  name.className = 'reaction-name';
  name.textContent = 'Bond Electronegativity';
  nameCell.appendChild(name);

  tr.appendChild(nameCell);
  tr.appendChild(countCell);

  tr.addEventListener('click', event => {
    event.stopPropagation();
    _bondEnActive = !_bondEnActive;
    const displayedMol = _currentDisplayedMol() ?? mol;
    updateBondEnPanel(displayedMol);
    _redraw(displayedMol);
  });

  tbody.appendChild(tr);
}

function _redraw(mol) {
  if (ctx.mode === 'force') {
    ctx.updateForce(mol, { preservePositions: true, preserveView: true });
  } else {
    ctx.draw2d();
  }
}
