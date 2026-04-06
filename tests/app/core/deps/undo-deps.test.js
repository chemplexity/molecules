import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createUndoDeps } from '../../../../src/app/core/deps/undo-deps.js';

describe('createUndoDeps', () => {
  it('builds the undo dependency bridge from live callbacks', () => {
    const records = [];
    const deps = createUndoDeps({
      captureAppSnapshot: options => ({ captured: options }),
      clearReactionPreviewState: () => {
        records.push(['clearReactionPreviewState']);
      },
      restoreReactionPreviewSource: () => {
        records.push(['restoreReactionPreviewSource']);
        return true;
      },
      restoreAppSnapshot: snap => {
        records.push(['restoreAppSnapshot', snap]);
      }
    });

    assert.deepEqual(deps.captureAppSnapshot({ foo: 'bar' }), { captured: { foo: 'bar' } });
    assert.equal(deps.restoreReactionPreviewSource(), true);
    deps.clearReactionPreviewState();
    deps.restoreAppSnapshot('snap');

    assert.deepEqual(records, [
      ['restoreReactionPreviewSource'],
      ['clearReactionPreviewState'],
      ['restoreAppSnapshot', 'snap']
    ]);
  });
});
