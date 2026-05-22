import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { measureTerminalMultipleBondLeafFanPenalty, runTerminalMultipleBondLeafFanTidy } from '../../../../src/layout/engine/cleanup/presentation/ring-terminal-hetero.js';
import { add, angleOf, angularDifference, distance, fromAngle, rotate, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';

function bondAngle(coords, centerAtomId, firstAtomId, secondAtomId) {
  const centerPosition = coords.get(centerAtomId);
  assert.ok(centerPosition);
  assert.ok(coords.has(firstAtomId));
  assert.ok(coords.has(secondAtomId));
  return angularDifference(angleOf(sub(coords.get(firstAtomId), centerPosition)), angleOf(sub(coords.get(secondAtomId), centerPosition)));
}

function rotateAtomIds(coords, atomIds, pivotAtomId, rotation) {
  const pivotPosition = coords.get(pivotAtomId);
  assert.ok(pivotPosition);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    assert.ok(position);
    coords.set(atomId, add(pivotPosition, rotate(sub(position, pivotPosition), rotation)));
  }
}

describe('layout/engine/cleanup/ring-terminal-hetero', () => {
  it('recovers exact carbonyl fans by rotating a small acyclic support side', () => {
    const result = runPipeline(parseSMILES('O=C(NC)C1CCCCC1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const { layoutGraph } = result;
    const coords = new Map([...result.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const centerAtomId = 'C2';
    const leafAtomId = 'O1';
    const supportAtomId = 'N3';
    const supportLeafAtomId = 'C4';
    const fixedAtomId = 'C5';
    const centerPosition = coords.get(centerAtomId);
    assert.ok(centerPosition);

    const fixedAngle = angleOf(sub(coords.get(fixedAtomId), centerPosition));
    const supportAngle = angleOf(sub(coords.get(supportAtomId), centerPosition));
    rotateAtomIds(coords, [supportAtomId, supportLeafAtomId], centerAtomId, fixedAngle + Math.PI - supportAngle);
    coords.set(leafAtomId, add(centerPosition, fromAngle(fixedAngle + Math.PI / 2, distance(centerPosition, coords.get(leafAtomId)))));

    const beforePenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, coords);
    assert.ok(beforePenalty.maxDeviation > 1, 'expected the fixture to start with a visibly bad carbonyl fan');

    const retouch = runTerminalMultipleBondLeafFanTidy(layoutGraph, coords, {
      bondLength: layoutGraph.options.bondLength
    });
    assert.ok(retouch.nudges > 0);
    assert.equal(auditLayout(layoutGraph, retouch.coords, { bondLength: layoutGraph.options.bondLength }).ok, true);
    assert.ok(measureTerminalMultipleBondLeafFanPenalty(layoutGraph, retouch.coords).maxDeviation < 1e-9);
    assert.ok(Math.abs(bondAngle(retouch.coords, centerAtomId, leafAtomId, supportAtomId) - (2 * Math.PI) / 3) < 1e-9);
    assert.ok(Math.abs(bondAngle(retouch.coords, centerAtomId, leafAtomId, fixedAtomId) - (2 * Math.PI) / 3) < 1e-9);
    assert.ok(Math.abs(bondAngle(retouch.coords, centerAtomId, supportAtomId, fixedAtomId) - (2 * Math.PI) / 3) < 1e-9);
  });
});
