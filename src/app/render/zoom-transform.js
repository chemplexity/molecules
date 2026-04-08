/** @module app/render/zoom-transform */

/**
 * Creates zoom-transform snapshot helpers for capturing and restoring the SVG pan/zoom state.
 * @param {object} deps - Dependency object providing `d3`, `svg`, and `zoom` for transform operations.
 * @returns {object} Object with `captureZoomTransformSnapshot` and `restoreZoomTransformSnapshot` functions.
 */
export function createZoomTransformHelpers(deps) {
  function captureZoomTransformSnapshot() {
    const transform = deps.d3.zoomTransform(deps.svg.node());
    return { x: transform.x, y: transform.y, k: transform.k };
  }

  function restoreZoomTransformSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }
    deps.svg.call(deps.zoom.transform, deps.d3.zoomIdentity.translate(snapshot.x, snapshot.y).scale(snapshot.k));
  }

  return {
    captureZoomTransformSnapshot,
    restoreZoomTransformSnapshot
  };
}
