/** @module app/core/app-controller */

import { createEditorActions } from './editor-actions.js';

/**
 * Creates the application controller that handles structural edits, view actions, and snapshot operations.
 * @param {object} params - Controller dependencies.
 * @param {object} params.state - App state bridge providing view and overlay state accessors.
 * @param {object} params.renderers - Render runtime used to re-render after edits.
 * @param {object} params.history - History helpers with `takeSnapshot` and `captureSnapshot`.
 * @param {object} params.panels - Optional panel registry (may be empty).
 * @param {object} params.analysis - Analysis helpers for syncing the input field, formula, descriptors, and panels.
 * @param {object} params.dom - DOM accessors including `plotEl`.
 * @param {object} params.overlays - Overlay helpers for reaction preview and resonance state.
 * @param {object} params.snapshot - Snapshot helpers with `capture` and `restore`.
 * @param {object} [params.navigation] - Optional navigation action handlers (toggleMode, cleanLayout2d, etc.).
 * @returns {object} Controller object with `state`, `captureAppSnapshot`, `restoreAppSnapshot`, `performStructuralEdit`, and `performViewAction`.
 */
export function createAppController({ state, renderers, history, panels, analysis, dom, overlays, snapshot, navigation }) {
  const editorActions = createEditorActions({
    state,
    renderers,
    history,
    panels,
    analysis,
    dom,
    overlays,
    view: state.viewState
  });

  function performViewAction(kind, payload = {}) {
    if (!navigation) {
      return undefined;
    }
    switch (kind) {
      case 'toggle-mode':
        return navigation.toggleMode(payload);
      case 'clean-layout-2d':
        return navigation.cleanLayout2d(payload);
      case 'clean-layout-force':
        return navigation.cleanLayoutForce(payload);
      case 'start-rotate':
        return navigation.startRotate(payload.delta ?? 0);
      case 'stop-rotate':
        return navigation.stopRotate();
      case 'flip':
        return navigation.flip(payload.axis);
      default:
        return undefined;
    }
  }

  return {
    state,
    captureAppSnapshot: options => snapshot.capture(options),
    restoreAppSnapshot: snap => snapshot.restore(snap),
    performStructuralEdit: editorActions.performStructuralEdit,
    performViewAction
  };
}
