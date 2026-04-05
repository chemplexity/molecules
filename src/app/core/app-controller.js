/** @module app/core/app-controller */

import { createEditorActions } from './editor-actions.js';

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
