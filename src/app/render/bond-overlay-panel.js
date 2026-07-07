/** @module app/render/bond-overlay-panel */

import { createModeAwareHelpers } from './render-mode-helpers.js';
import { createOverlayPanelRow } from './panel-row.js';

/**
 * Builds init/update/clear handlers for a bond-property overlay toggle panel
 * (e.g. bond electronegativity, bond lengths). The two overlays share every
 * part of this lifecycle except their DOM id, label/title copy, and how they
 * read/write their own active state.
 * @param {object} config - Panel wiring.
 * @param {string} config.tbodyId - DOM id of the panel's `<tbody>` element.
 * @param {string} config.label - Toggle row label text.
 * @param {string} config.title - Toggle row tooltip text.
 * @param {() => boolean} config.getActive - Reads this overlay's active state.
 * @param {(active: boolean) => void} config.setActive - Writes this overlay's active state (mutual exclusivity with sibling overlays is handled by the state module).
 * @param {(updater: (mol: object|null) => void) => void} config.registerUpdater - Registers this overlay's panel-update callback with its state module.
 * @param {(mol: object|null) => void} config.refreshOther - Refreshes the sibling overlay's panel; called after activation, since activating this overlay deactivates the sibling.
 * @returns {{init: (context: object) => void, update: (mol: object|null) => void, clear: () => void}} Panel lifecycle handlers.
 */
export function createBondOverlayPanel({ tbodyId, label, title, getActive, setActive, registerUpdater, refreshOther }) {
  let ctx = {};
  const modeHelpers = createModeAwareHelpers(() => ctx);

  function update(mol) {
    if (typeof document === 'undefined') {
      return;
    }
    const tbody = document.getElementById(tbodyId);
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
        label,
        title,
        active: getActive(),
        onClick: event => {
          event.stopPropagation();
          const nextActive = !getActive();
          setActive(nextActive);
          const displayedMol = modeHelpers.currentMol() ?? mol;
          update(displayedMol);
          if (nextActive) {
            refreshOther(displayedMol);
          }
          modeHelpers.redraw(displayedMol);
        }
      })
    );
  }

  function clear() {
    setActive(false);
    const tbody = document.getElementById(tbodyId);
    if (tbody) {
      tbody.innerHTML = '';
    }
  }

  function init(context) {
    ctx = context;
    registerUpdater(update);
  }

  return { init, update, clear };
}
