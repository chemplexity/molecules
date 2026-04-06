import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPhyschemPanelDeps } from '../../../../src/app/ui/deps/physchem-panel-deps.js';

describe('createPhyschemPanelDeps', () => {
  it('builds the physicochemical panel dependency bridge from live callbacks', () => {
    const deps = createPhyschemPanelDeps({
      dom: {
        getTableElement: () => 'table'
      },
      tooltip: { id: 'tooltip' },
      tooltipDelayMs: 1500,
      highlights: {
        setHighlight: value => `set:${value}`,
        restorePersistentHighlight: () => 'restore',
        setPersistentHighlightFallback: value => `fallback:${value}`
      }
    });

    assert.equal(deps.dom.getTableElement(), 'table');
    assert.equal(deps.tooltip.id, 'tooltip');
    assert.equal(deps.tooltipDelayMs, 1500);
    assert.equal(deps.highlights.setHighlight('x'), 'set:x');
    assert.equal(deps.highlights.restorePersistentHighlight(), 'restore');
    assert.equal(deps.highlights.setPersistentHighlightFallback('y'), 'fallback:y');
  });
});
