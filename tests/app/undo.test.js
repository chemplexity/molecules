import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createUndoManager } from '../../src/app/core/undo.js';

function makeContext(label, calls) {
  return {
    captureAppSnapshot() {
      calls.push([label, 'capture']);
      return { from: label, seq: calls.length };
    },
    restoreAppSnapshot(snapshot) {
      calls.push([label, 'restore', snapshot]);
    },
    clearReactionPreviewState() {
      calls.push([label, 'clearReactionPreviewState']);
    },
    restoreReactionPreviewSource() {
      calls.push([label, 'restoreReactionPreviewSource']);
      return false;
    }
  };
}

describe('createUndoManager', () => {
  it('creates independent undo histories', () => {
    const calls = [];
    const first = createUndoManager({ getDocument: () => null });
    const second = createUndoManager({ getDocument: () => null });

    first.initUndo(makeContext('first', calls));
    second.initUndo(makeContext('second', calls));

    first.takeSnapshot({ clearReactionPreview: false, snapshot: { from: 'first-snapshot' } });
    second.takeSnapshot({ clearReactionPreview: false, snapshot: { from: 'second-snapshot' } });

    first.undoAction();

    assert.deepEqual(calls, [
      ['first', 'capture'],
      ['first', 'restore', { from: 'first-snapshot' }]
    ]);
  });

  it('resets history on re-init by default', () => {
    const calls = [];
    const manager = createUndoManager({ getDocument: () => null });

    manager.initUndo(makeContext('first', calls));
    manager.takeSnapshot({ clearReactionPreview: false, snapshot: { from: 'first-snapshot' } });

    manager.initUndo(makeContext('second', calls));
    manager.undoAction();

    assert.deepEqual(calls, []);
  });

  it('rejects ambiguous snapshot requests that also ask to clear reaction preview', () => {
    const manager = createUndoManager({ getDocument: () => null });
    manager.initUndo(makeContext('ctx', []));

    assert.throws(
      () => manager.takeSnapshot({ snapshot: { id: 'snap' } }),
      /takeSnapshot cannot clear reaction preview when an explicit snapshot is provided/
    );
  });
});
