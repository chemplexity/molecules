/** @module app/render/zoom-transform */

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
