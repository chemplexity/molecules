/** @module app/core/undo */

/**
 * Creates an isolated undo/redo manager with its own stack and UI button state.
 * @param {object} [options] - Optional configuration.
 * @param {number} [options.maxEntries] - Maximum number of undo/redo entries to retain.
 * @param {() => Document} [options.getDocument] - Returns the document used to look up undo/redo buttons.
 * @returns {object} Object with `initUndo`, `takeSnapshot`, `discardLastSnapshot`, `undoAction`, `redoAction`, and `clearHistory`.
 */
export function createUndoManager({ maxEntries = 50, getDocument = () => globalThis.document } = {}) {
  let ctx = {};
  let undoStack = [];
  let redoStack = [];

  function getButton(id) {
    const doc = getDocument?.();
    return doc?.getElementById?.(id) ?? null;
  }

  function updateUndoBtn() {
    const btn = getButton('undo-btn');
    if (btn) {
      btn.disabled = undoStack.length === 0;
    }
  }

  function updateRedoBtn() {
    const btn = getButton('redo-btn');
    if (btn) {
      btn.disabled = redoStack.length === 0;
    }
  }

  function makeSnapshot(options) {
    return ctx.captureAppSnapshot(options);
  }

  function clearHistory() {
    undoStack = [];
    redoStack = [];
    updateUndoBtn();
    updateRedoBtn();
  }

  function initUndo(context, { resetHistory = true } = {}) {
    ctx = context;
    if (resetHistory) {
      clearHistory();
    } else {
      updateUndoBtn();
      updateRedoBtn();
    }
  }

  function takeSnapshot({ clearReactionPreview = true, snapshot = null, ...snapshotOptions } = {}) {
    if (snapshot && clearReactionPreview) {
      throw new Error('takeSnapshot cannot clear reaction preview when an explicit snapshot is provided; pass clearReactionPreview: false.');
    }
    if (!snapshot && clearReactionPreview) {
      const restored = ctx.restoreReactionPreviewSource ? ctx.restoreReactionPreviewSource() : false;
      if (!restored) {
        ctx.clearReactionPreviewState();
      }
    }
    const nextSnapshot = snapshot ?? makeSnapshot(snapshotOptions);
    if (undoStack.length >= maxEntries) {
      undoStack.shift();
    }
    undoStack.push(nextSnapshot);
    redoStack = [];
    updateUndoBtn();
    updateRedoBtn();
  }

  function discardLastSnapshot() {
    if (undoStack.length === 0) {
      return null;
    }
    const removed = undoStack.pop();
    updateUndoBtn();
    return removed;
  }

  function undoAction() {
    if (undoStack.length === 0) {
      return;
    }
    const redoSnap = makeSnapshot();
    if (redoStack.length >= maxEntries) {
      redoStack.shift();
    }
    redoStack.push(redoSnap);
    updateRedoBtn();
    const snap = undoStack.pop();
    updateUndoBtn();
    ctx.restoreAppSnapshot(snap);
  }

  function redoAction() {
    if (redoStack.length === 0) {
      return;
    }
    const undoSnap = makeSnapshot();
    if (undoStack.length >= maxEntries) {
      undoStack.shift();
    }
    undoStack.push(undoSnap);
    updateUndoBtn();
    const snap = redoStack.pop();
    updateRedoBtn();
    ctx.restoreAppSnapshot(snap);
  }

  return {
    initUndo,
    takeSnapshot,
    discardLastSnapshot,
    undoAction,
    redoAction,
    clearHistory
  };
}

const defaultUndoManager = createUndoManager();

export const initUndo = (...args) => defaultUndoManager.initUndo(...args);
export const takeSnapshot = (...args) => defaultUndoManager.takeSnapshot(...args);
export const discardLastSnapshot = (...args) => defaultUndoManager.discardLastSnapshot(...args);
export const undoAction = (...args) => defaultUndoManager.undoAction(...args);
export const redoAction = (...args) => defaultUndoManager.redoAction(...args);
export const clearHistory = (...args) => defaultUndoManager.clearHistory(...args);
