/** @module app/render/force-viewport-state */

/**
 * Creates force-viewport state helper functions for enabling and disabling the keep-in-view behavior.
 * @param {object} ctx - Context providing `state` (setKeepInView, setKeepInViewTicks) and `constants` (getDefaultKeepInViewTicks).
 * @returns {object} Object with `enableKeepInView` and `disableKeepInView` helpers.
 */
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
