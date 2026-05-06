/** @module app/render/bond-en-overlay */

import { bondElectronegativityDifference } from '../../descriptors/physicochemical.js';
import { getBondEnActive, refreshBondLengthsPanel, registerBondEnPanelUpdater, setBondEnActive, setBondLengthsActive } from './bond-overlay-state.js';
export { getBondEnActive } from './bond-overlay-state.js';
import { createModeAwareHelpers } from './render-mode-helpers.js';
import { createOverlayPanelRow } from './panel-row.js';

let ctx = {};
const modeHelpers = createModeAwareHelpers(() => ctx);

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
  registerBondEnPanelUpdater(updateBondEnPanel);
}

/**
 * Returns overlay data for rendering bond polarity labels, or null when the
 * overlay is inactive. Each entry includes the display label and a normalised
 * value t ∈ [0, 1] (0 = nonpolar, 1 = most polar bond in the molecule).
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to compute overlay data for.
 * @returns {Array<{bondId: string, label: string, t: number}>|null} Per-bond polarity entries, or null when inactive.
 */
export function getBondEnOverlayData(mol) {
  if (!getBondEnActive() || !mol) {
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
  setBondEnActive(false);
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

  tbody.appendChild(
    createOverlayPanelRow({
      label: 'Bond Electronegativity',
      title: 'Pauling electronegativity difference (Δχ) per bond. Values reflect atomic electronegativity only and are independent of bond order.',
      active: getBondEnActive(),
      onClick: event => {
        event.stopPropagation();
        const nextActive = !getBondEnActive();
        setBondEnActive(nextActive);
        if (nextActive) {
          setBondLengthsActive(false);
        }
        const displayedMol = modeHelpers.currentMol() ?? mol;
        updateBondEnPanel(displayedMol);
        if (nextActive) {
          refreshBondLengthsPanel(displayedMol);
        }
        modeHelpers.redraw(displayedMol);
      }
    })
  );
}
