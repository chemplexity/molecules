import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createZoomTransformHelpers } from '../../../src/app/render/zoom-transform.js';

describe('createZoomTransformHelpers', () => {
  it('captures the current zoom transform snapshot', () => {
    const helpers = createZoomTransformHelpers({
      d3: {
        zoomTransform: () => ({ x: 12, y: 34, k: 2.5 }),
        zoomIdentity: null
      },
      svg: {
        node: () => ({})
      },
      zoom: {}
    });

    assert.deepEqual(helpers.captureZoomTransformSnapshot(), { x: 12, y: 34, k: 2.5 });
  });

  it('restores a zoom transform snapshot through the shared svg/zoom bridge', () => {
    const calls = [];
    const helpers = createZoomTransformHelpers({
      d3: {
        zoomTransform: () => ({ x: 0, y: 0, k: 1 }),
        zoomIdentity: {
          translate(x, y) {
            calls.push(['translate', x, y]);
            return {
              scale(k) {
                calls.push(['scale', k]);
                return { x, y, k };
              }
            };
          }
        }
      },
      svg: {
        node: () => ({}),
        call(transform, value) {
          calls.push(['call', transform, value]);
        }
      },
      zoom: {
        transform: 'zoom-transform'
      }
    });

    helpers.restoreZoomTransformSnapshot({ x: 5, y: 6, k: 1.75 });

    assert.deepEqual(calls, [
      ['translate', 5, 6],
      ['scale', 1.75],
      ['call', 'zoom-transform', { x: 5, y: 6, k: 1.75 }]
    ]);
  });

  it('ignores null zoom snapshots on restore', () => {
    let called = false;
    const helpers = createZoomTransformHelpers({
      d3: {
        zoomTransform: () => ({ x: 0, y: 0, k: 1 }),
        zoomIdentity: {
          translate() {
            called = true;
            return {
              scale() {
                called = true;
                return null;
              }
            };
          }
        }
      },
      svg: {
        node: () => ({}),
        call() {
          called = true;
        }
      },
      zoom: {
        transform: 'zoom-transform'
      }
    });

    helpers.restoreZoomTransformSnapshot(null);

    assert.equal(called, false);
  });
});
