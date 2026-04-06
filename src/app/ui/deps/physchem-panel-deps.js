/** @module app/ui/physchem-panel-deps */

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
