/** @module app/render/bond-overlay-state */

let _bondEnActive = false;
let _bondLengthsActive = false;
let _bondEnPanelUpdater = null;
let _bondLengthsPanelUpdater = null;

/**
 * Returns whether the bond electronegativity overlay is active.
 * @returns {boolean} True when the bond electronegativity overlay is active.
 */
export function getBondEnActive() {
  return _bondEnActive;
}

/**
 * Sets whether the bond electronegativity overlay is active.
 * @param {boolean} active - Next bond electronegativity overlay state.
 */
export function setBondEnActive(active) {
  _bondEnActive = active === true;
}

/**
 * Returns whether the bond lengths overlay is active.
 * @returns {boolean} True when the bond lengths overlay is active.
 */
export function getBondLengthsActive() {
  return _bondLengthsActive;
}

/**
 * Sets whether the bond lengths overlay is active.
 * @param {boolean} active - Next bond lengths overlay state.
 */
export function setBondLengthsActive(active) {
  _bondLengthsActive = active === true;
}

/**
 * Registers the callback used to rerender the bond electronegativity panel.
 * @param {(mol: import('../../core/Molecule.js').Molecule|null) => void} updater - Panel rerender callback.
 */
export function registerBondEnPanelUpdater(updater) {
  _bondEnPanelUpdater = updater;
}

/**
 * Registers the callback used to rerender the bond lengths panel.
 * @param {(mol: import('../../core/Molecule.js').Molecule|null) => void} updater - Panel rerender callback.
 */
export function registerBondLengthsPanelUpdater(updater) {
  _bondLengthsPanelUpdater = updater;
}

/**
 * Rerenders the bond electronegativity panel when an updater is registered.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - Molecule currently shown in the UI.
 */
export function refreshBondEnPanel(mol) {
  _bondEnPanelUpdater?.(mol);
}

/**
 * Rerenders the bond lengths panel when an updater is registered.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - Molecule currently shown in the UI.
 */
export function refreshBondLengthsPanel(mol) {
  _bondLengthsPanelUpdater?.(mol);
}
