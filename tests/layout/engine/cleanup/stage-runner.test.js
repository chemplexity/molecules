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
        name: 'selectedGeometryCheckpoint',
        parentStage: 'best',
        transformFn(parentCoords) {
          return { coords: parentCoords };
        },
        comparatorFn() {
          return true;
        }
      },
      {
        name: 'stereoRescueCleanup',
        parentStage: 'selectedGeometryCheckpoint',
        transformFn() {
          return null;
        }
      },
      {
        name: 'stereoRescueFallbackCleanup',
        parentStage: ['stereoRescueCleanup', 'selectedGeometryCheckpoint'],
        guard(stageResults) {
          return stageResults.has('selectedGeometryCheckpoint');
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

    assert.equal(result.allStageResults.has('stereoRescueCleanup'), false);
    assert.equal(result.allStageResults.has('stereoRescueFallbackCleanup'), true);
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
        name: 'selectedGeometryCheckpoint',
        parentStage: 'best',
        transformFn(parentCoords) {
          return { coords: parentCoords };
        },
        comparatorFn() {
          return true;
        }
      },
      {
        name: 'stereoRescueFollowup',
        parentStage: 'stereoRescueFallbackCleanup',
        guard(stageResults) {
          return stageResults.has('stereoRescueFallbackCleanup');
        },
        transformFn(parentCoords) {
          followupCalls++;
          return { coords: parentCoords };
        }
      }
    ], baselineStage, {});

    assert.equal(result.allStageResults.has('stereoRescueFollowup'), false);
    assert.equal(followupCalls, 0);
  });

  it('records per-stage execution telemetry for ran, null-return, and winning outcomes', () => {
    const timeSamples = [1, 5, 10, 16, 20, 29];
    const result = runStageGraph([
      {
        name: 'coreGeometryCleanup',
        parentStage: null,
        transformFn(parentCoords) {
          return { coords: parentCoords };
        },
        comparatorFn() {
          return false;
        }
      },
      {
        name: 'presentationCleanup',
        parentStage: 'coreGeometryCleanup',
        guard() {
          return false;
        },
        transformFn(parentCoords) {
          return { coords: parentCoords };
        }
      },
      {
        name: 'stereoRescueCleanup',
        parentStage: 'best',
        transformFn() {
          return null;
        }
      },
      {
        name: 'presentationFallbackCleanup',
        parentStage: 'best',
        transformFn() {
          return {
            coords: new Map([
              ['A1', { x: 2, y: 0 }]
            ]),
            audit: { ok: true }
          };
        },
        comparatorFn() {
          return true;
        }
      }
    ], {
      name: 'placement',
      coords: new Map([
        ['A1', { x: 0, y: 0 }]
      ]),
      audit: { ok: true }
    }, {
      nowMs() {
        return timeSamples.shift();
      }
    });

    assert.equal(result.stageExecutions.get('placement')?.ran, true);
    assert.equal(result.stageExecutions.get('placement')?.won, false);

    assert.equal(result.stageExecutions.get('coreGeometryCleanup')?.ran, true);
    assert.equal(result.stageExecutions.get('coreGeometryCleanup')?.returnedNull, false);
    assert.equal(result.stageExecutions.get('coreGeometryCleanup')?.accepted, false);
    assert.equal(result.stageExecutions.get('coreGeometryCleanup')?.elapsedMs, 4);

    assert.equal(result.stageExecutions.get('presentationCleanup')?.ran, false);
    assert.equal(result.stageExecutions.get('presentationCleanup')?.elapsedMs, 0);

    assert.equal(result.stageExecutions.get('stereoRescueCleanup')?.ran, true);
    assert.equal(result.stageExecutions.get('stereoRescueCleanup')?.returnedNull, true);
    assert.equal(result.stageExecutions.get('stereoRescueCleanup')?.materialized, false);
    assert.equal(result.stageExecutions.get('stereoRescueCleanup')?.elapsedMs, 6);

    assert.equal(result.stageExecutions.get('presentationFallbackCleanup')?.ran, true);
    assert.equal(result.stageExecutions.get('presentationFallbackCleanup')?.materialized, true);
    assert.equal(result.stageExecutions.get('presentationFallbackCleanup')?.accepted, true);
    assert.equal(result.stageExecutions.get('presentationFallbackCleanup')?.won, true);
    assert.equal(result.stageExecutions.get('presentationFallbackCleanup')?.elapsedMs, 9);
  });

  it('can continue from a seeded runner state across multiple stage groups', () => {
    const baselineStage = {
      name: 'placement',
      coords: new Map([
        ['A1', { x: 0, y: 0 }]
      ]),
      audit: { ok: true }
    };
    const firstPass = runStageGraph([
      {
        name: 'coreGeometryCleanup',
        parentStage: null,
        isGeometryPhase: true,
        transformFn() {
          return {
            coords: new Map([
              ['A1', { x: 1, y: 0 }]
            ]),
            audit: { ok: true }
          };
        },
        comparatorFn() {
          return true;
        }
      }
    ], baselineStage, {});
    const secondPass = runStageGraph([
      {
        name: 'presentationFallbackCleanup',
        parentStage: 'best',
        transformFn(parentCoords) {
          const currentPosition = parentCoords.get('A1');
          return {
            coords: new Map([
              ['A1', { x: currentPosition.x + 1, y: currentPosition.y }]
            ]),
            audit: { ok: true }
          };
        },
        comparatorFn() {
          return true;
        }
      }
    ], {
      name: 'selectedGeometryCheckpoint',
      coords: firstPass.bestStage.coords,
      audit: { ok: true }
    }, {}, firstPass);

    assert.equal(secondPass.allStageResults.has('coreGeometryCleanup'), true);
    assert.equal(secondPass.allStageResults.has('presentationFallbackCleanup'), true);
    assert.deepEqual(secondPass.bestStage.coords.get('A1'), { x: 2, y: 0 });
    assert.equal(secondPass.geometryCheckpointStage.name, 'coreGeometryCleanup');
    assert.equal(secondPass.stageExecutions.get('coreGeometryCleanup')?.won, false);
    assert.equal(secondPass.stageExecutions.get('presentationFallbackCleanup')?.won, true);
  });
});
