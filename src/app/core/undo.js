/** @module app/core/undo */

let ctx = {};

let _undoStack = [];
let _redoStack = [];
const _UNDO_MAX = 50;

/**
 * Inject shared state accessors.  Call once after simulation and g are created.
 * @param {{ mode, currentMol, _mol2d, _cx2d, _cy2d, _hCounts2d, _stereoMap2d,
 *           simulation, getReactionPreviewSnapshot, clearReactionPreviewState,
 *           restoreReactionPreviewSource,
 *           restoreReactionPreviewSnapshot, restoreSnapshot }} context
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

function _makeSnapshot() {
  const mol = ctx.mode === 'force' ? ctx.currentMol : ctx._mol2d;
  let snap;
  if (!mol) {
    snap = { empty: true, mode: ctx.mode };
  } else {
    const atoms = [];
    for (const [id, atom] of mol.atoms) {
      atoms.push({
        id,
        name: atom.name,
        x: atom.x,
        y: atom.y,
        visible: atom.visible,
        properties: JSON.parse(JSON.stringify(atom.properties))
      });
    }
    const bonds = [];
    for (const [id, bond] of mol.bonds) {
      bonds.push({
        id,
        atoms: [...bond.atoms],
        properties: JSON.parse(JSON.stringify(bond.properties))
      });
    }
    snap = { mode: ctx.mode, atoms, bonds };
    snap.reactionPreview = ctx.getReactionPreviewSnapshot ? ctx.getReactionPreviewSnapshot() : null;
    if (ctx.mode === '2d') {
      snap.cx2d = ctx._cx2d;
      snap.cy2d = ctx._cy2d;
      snap.hCounts2d = ctx._hCounts2d ? [...ctx._hCounts2d] : [];
      snap.stereoMap2d = ctx._stereoMap2d ? [...ctx._stereoMap2d] : null;
    } else {
      snap.nodePositions = ctx.simulation.nodes().map(n => ({
        id: n.id,
        x: n.x,
        y: n.y,
        vx: n.vx,
        vy: n.vy,
        anchorX: n.anchorX,
        anchorY: n.anchorY
      }));
    }
  }
  return snap;
}

export function takeSnapshot({ clearReactionPreview = true } = {}) {
  if (clearReactionPreview) {
    const restored = ctx.restoreReactionPreviewSource ? ctx.restoreReactionPreviewSource() : false;
    if (!restored) {
      ctx.clearReactionPreviewState();
    }
  }
  const snap = _makeSnapshot();
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
  ctx.restoreSnapshot(snap);
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
  ctx.restoreSnapshot(snap);
}
