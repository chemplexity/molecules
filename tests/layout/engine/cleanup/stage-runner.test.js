import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runStageGraph } from '../../../../src/layout/engine/cleanup/stage-runner.js';

describe('layout/engine/cleanup/stage-runner', () => {
  it('falls back to the next available parent stage when an optional upstream stage returns null', () => {
    const baselineCoords = new Map([
      ['A1', { x: 0, y: 0 }]
    ]);
    const baselineStage = {
      name: 'placement',
      coords: baselineCoords,
      audit: { ok: true }
    };

    const result = runStageGraph([
      {
        name: 'selectedGeometryStereo',
        parentStage: 'best',
        transformFn(parentCoords) {
          return { coords: parentCoords };
        },
        comparatorFn() {
          return true;
        }
      },
      {
        name: 'stereoCleanup',
        parentStage: 'selectedGeometryStereo',
        transformFn() {
          return null;
        }
      },
      {
        name: 'stereoProtectedTouchup',
        parentStage: ['stereoCleanup', 'selectedGeometryStereo'],
        guard(stageResults) {
          return stageResults.has('selectedGeometryStereo');
        },
        transformFn(parentCoords) {
          const currentPosition = parentCoords.get('A1');
          return {
            coords: new Map([
              ['A1', { x: currentPosition.x + 1, y: currentPosition.y }]
            ])
          };
        },
        comparatorFn() {
          return true;
        }
      }
    ], baselineStage, {});

    assert.equal(result.allStageResults.has('stereoCleanup'), false);
    assert.equal(result.allStageResults.has('stereoProtectedTouchup'), true);
    assert.deepEqual(result.bestStage.coords.get('A1'), { x: 1, y: 0 });
  });

  it('skips a follow-up stereo stage when its immediate touchup parent never materialized', () => {
    const baselineStage = {
      name: 'placement',
      coords: new Map([
        ['A1', { x: 0, y: 0 }]
      ]),
      audit: { ok: true }
    };
    let followupCalls = 0;

    const result = runStageGraph([
      {
        name: 'selectedGeometryStereo',
        parentStage: 'best',
        transformFn(parentCoords) {
          return { coords: parentCoords };
        },
        comparatorFn() {
          return true;
        }
      },
      {
        name: 'postTouchupStereo',
        parentStage: 'stereoTouchup',
        guard(stageResults) {
          return stageResults.has('stereoTouchup');
        },
        transformFn(parentCoords) {
          followupCalls++;
          return { coords: parentCoords };
        }
      }
    ], baselineStage, {});

    assert.equal(result.allStageResults.has('postTouchupStereo'), false);
    assert.equal(followupCalls, 0);
  });
});
