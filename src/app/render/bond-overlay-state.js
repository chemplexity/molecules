/** @module app/render/bond-overlay-state */

function createOverlayToggleState() {
  let active = false;
  let updater = null;
  return {
    getActive: () => active,
    setActive: value => {
      active = value === true;
    },
    registerUpdater: fn => {
      updater = fn;
    },
    refresh: mol => updater?.(mol)
  };
}

const bondEnState = createOverlayToggleState();
const bondLengthsState = createOverlayToggleState();

/**
 * Returns whether the bond electronegativity overlay is active.
 * @returns {boolean} True when the bond electronegativity overlay is active.
 */
export function getBondEnActive() {
  return bondEnState.getActive();
}

/**
 * Sets whether the bond electronegativity overlay is active. Activating it
 * deactivates the bond-lengths overlay, since only one bond-property overlay
 * can be shown at a time.
 * @param {boolean} active - Next bond electronegativity overlay state.
 */
export function setBondEnActive(active) {
  bondEnState.setActive(active);
  if (active === true) {
    bondLengthsState.setActive(false);
  }
}

/**
 * Returns whether the bond lengths overlay is active.
 * @returns {boolean} True when the bond lengths overlay is active.
 */
export function getBondLengthsActive() {
  return bondLengthsState.getActive();
}

/**
 * Sets whether the bond lengths overlay is active. Activating it deactivates
 * the bond electronegativity overlay, since only one bond-property overlay
 * can be shown at a time.
 * @param {boolean} active - Next bond lengths overlay state.
 */
export function setBondLengthsActive(active) {
  bondLengthsState.setActive(active);
  if (active === true) {
    bondEnState.setActive(false);
  }
}

/**
 * Registers the callback used to rerender the bond electronegativity panel.
 * @param {(mol: import('../../core/Molecule.js').Molecule|null) => void} updater - Panel rerender callback.
 */
export function registerBondEnPanelUpdater(updater) {
  bondEnState.registerUpdater(updater);
}

/**
 * Registers the callback used to rerender the bond lengths panel.
 * @param {(mol: import('../../core/Molecule.js').Molecule|null) => void} updater - Panel rerender callback.
 */
export function registerBondLengthsPanelUpdater(updater) {
  bondLengthsState.registerUpdater(updater);
}

/**
 * Rerenders the bond electronegativity panel when an updater is registered.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - Molecule currently shown in the UI.
 */
export function refreshBondEnPanel(mol) {
  bondEnState.refresh(mol);
}

/**
 * Rerenders the bond lengths panel when an updater is registered.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - Molecule currently shown in the UI.
 */
export function refreshBondLengthsPanel(mol) {
  bondLengthsState.refresh(mol);
}
