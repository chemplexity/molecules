/** @module app/ui/physchem-panel-deps */

/**
 * Builds the structured dependency object for the PhyschemPanel factory,
 * mapping flat dependency properties into named sub-objects (dom, tooltip, tooltipDelayMs, highlights).
 * @param {object} deps - Flat app context providing PhyschemPanel-related methods and values.
 * @returns {object} Dependency object consumed by `createPhyschemPanel`.
 */
export function createPhyschemPanelDeps(deps) {
  return {
    dom: {
      getTableElement: deps.dom.getTableElement
    },
    tooltip: deps.tooltip,
    tooltipDelayMs: deps.tooltipDelayMs,
    highlights: {
      setHighlight: deps.highlights.setHighlight,
      restorePersistentHighlight: deps.highlights.restorePersistentHighlight,
      setPersistentHighlightFallback: deps.highlights.setPersistentHighlightFallback
    }
  };
}
