/** @module app/render/render-mode-helpers */

/**
 * Returns helpers that resolve the currently displayed molecule and trigger a
 * mode-appropriate redraw, always reading the live module-level context via
 * the provided getter so callers don't need to re-bind after init.
 * @param {() => object} getCtx - Returns the current rendering context.
 * @returns {{ currentMol: () => object|null, redraw: (mol: object) => void }} Mode-aware molecule and redraw helpers.
 */
export function createModeAwareHelpers(getCtx) {
  return {
    currentMol() {
      const c = getCtx();
      return c.mode === 'force' ? (c.currentMol ?? null) : (c._mol2d ?? null);
    },
    redraw(mol) {
      const c = getCtx();
      if (c.mode === 'force') {
        c.updateForce(mol, { preservePositions: true, preserveView: true });
      } else {
        c.draw2d();
      }
    }
  };
}
