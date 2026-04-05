/** @module app/core/undo */

let ctx = {};

let _undoStack = [];
let _redoStack = [];
const _UNDO_MAX = 50;

/**
 * Inject shared state accessors.  Call once after simulation and g are created.
 * @param {{ captureAppSnapshot, restoreAppSnapshot, clearReactionPreviewState, restoreReactionPreviewSource }} context
 */
export function initUndo(context) {
  ctx = context;
}

function _updateUndoBtn() {
  const btn = document.getElementById('undo-btn');
  if (btn) {
    btn.disabled = _undoStack.length === 0;
  }
}

function _updateRedoBtn() {
  const btn = document.getElementById('redo-btn');
  if (btn) {
    btn.disabled = _redoStack.length === 0;
  }
}

function _makeSnapshot(options) {
  return ctx.captureAppSnapshot(options);
}

export function takeSnapshot({ clearReactionPreview = true, snapshot = null, ...snapshotOptions } = {}) {
  if (!snapshot && clearReactionPreview) {
    const restored = ctx.restoreReactionPreviewSource ? ctx.restoreReactionPreviewSource() : false;
    if (!restored) {
      ctx.clearReactionPreviewState();
    }
  }
  const snap = snapshot ?? _makeSnapshot(snapshotOptions);
  if (_undoStack.length >= _UNDO_MAX) {
    _undoStack.shift();
  }
  _undoStack.push(snap);
  _redoStack = [];
  _updateUndoBtn();
  _updateRedoBtn();
}

export function undoAction() {
  if (_undoStack.length === 0) {
    return;
  }
  const redoSnap = _makeSnapshot();
  if (_redoStack.length >= _UNDO_MAX) {
    _redoStack.shift();
  }
  _redoStack.push(redoSnap);
  _updateRedoBtn();
  const snap = _undoStack.pop();
  _updateUndoBtn();
  ctx.restoreAppSnapshot(snap);
}

export function clearHistory() {
  _undoStack = [];
  _redoStack = [];
  _updateUndoBtn();
  _updateRedoBtn();
}

export function redoAction() {
  if (_redoStack.length === 0) {
    return;
  }
  const undoSnap = _makeSnapshot();
  if (_undoStack.length >= _UNDO_MAX) {
    _undoStack.shift();
  }
  _undoStack.push(undoSnap);
  _updateUndoBtn();
  const snap = _redoStack.pop();
  _updateRedoBtn();
  ctx.restoreAppSnapshot(snap);
}
