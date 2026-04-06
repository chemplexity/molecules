/** @module app/core/undo-deps */

export function createUndoDeps(deps) {
  return {
    captureAppSnapshot: deps.captureAppSnapshot,
    clearReactionPreviewState: deps.clearReactionPreviewState,
    restoreReactionPreviewSource: deps.restoreReactionPreviewSource,
    restoreAppSnapshot: deps.restoreAppSnapshot
  };
}
