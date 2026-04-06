/** @module app/render/force-viewport-state */

export function createForceViewportStateHelpers(ctx) {
  function enableKeepInView(ticks = ctx.constants.getDefaultKeepInViewTicks()) {
    ctx.state.setKeepInView(true);
    ctx.state.setKeepInViewTicks(Math.max(0, ticks | 0));
  }

  function disableKeepInView() {
    ctx.state.setKeepInView(false);
    ctx.state.setKeepInViewTicks(0);
  }

  return {
    enableKeepInView,
    disableKeepInView
  };
}
