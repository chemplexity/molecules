import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import {
  measureOrthogonalHypervalentDeviation,
  runHypervalentAngleTidy
} from '../../../../src/layout/engine/cleanup/hypervalent-angle-tidy.js';
import { angleOf, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';

function angleAt(coords, centerAtomId, ligandAtomId) {
  return angleOf(sub(coords.get(ligandAtomId), coords.get(centerAtomId)));
}

function assertOrthogonalCross(angles) {
  const sortedAngles = [...angles].map(angle => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((first, second) => first - second);
  const deltas = sortedAngles.map(
    (angle, index) => ((sortedAngles[(index + 1) % sortedAngles.length] - angle) + Math.PI * 2) % (Math.PI * 2)
  );
  for (const delta of deltas) {
    assert.ok(Math.abs(delta - Math.PI / 2) < 1e-6);
  }
}

function assertOppositePair(firstAngle, secondAngle) {
  const separation = ((Math.abs(firstAngle - secondAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const foldedSeparation = Math.min(separation, Math.PI * 2 - separation);
  assert.ok(Math.abs(foldedSeparation - Math.PI) < 1e-6);
}

describe('layout/engine/cleanup/hypervalent-angle-tidy', () => {
  it('snaps monoxo phosphonate leaf ligands onto an orthogonal cross', () => {
    const graph = createLayoutGraph(parseSMILES('CP(=O)(O)O'), { suppressH: true });
    const coords = new Map([
      ['C1', { x: 0, y: 0 }],
      ['P2', { x: 1.5, y: 0 }],
      ['O3', { x: 2.45, y: 1.15 }],
      ['O4', { x: 2.2, y: 0.18 }],
      ['O5', { x: 2.2, y: -0.12 }]
    ]);

    const result = runHypervalentAngleTidy(graph, coords);
    const ligandAngles = [
      angleAt(result.coords, 'P2', 'C1'),
      angleAt(result.coords, 'P2', 'O3'),
      angleAt(result.coords, 'P2', 'O4'),
      angleAt(result.coords, 'P2', 'O5')
    ];

    assert.ok(result.nudges >= 3);
    assertOrthogonalCross(ligandAngles);
  });

  it('re-squares a class-swapped bis-oxo sulfone cross so the single bonds end up opposite each other', () => {
    const graph = createLayoutGraph(parseSMILES('NS(=O)(=O)C'), { suppressH: true });
    const coords = new Map([
      ['N1', { x: -1.299038105676658, y: 0.75 }],
      ['S2', { x: 0, y: 0 }],
      ['O3', { x: 1.299038105676658, y: -0.75 }],
      ['O4', { x: -0.75, y: -1.299038105676658 }],
      ['C5', { x: 0.75, y: 1.299038105676658 }]
    ]);

    assert.ok(measureOrthogonalHypervalentDeviation(graph, coords) > 0.1);

    const result = runHypervalentAngleTidy(graph, coords);
    const nitrogenAngle = angleAt(result.coords, 'S2', 'N1');
    const carbonAngle = angleAt(result.coords, 'S2', 'C5');
    const firstOxoAngle = angleAt(result.coords, 'S2', 'O3');
    const secondOxoAngle = angleAt(result.coords, 'S2', 'O4');

    assert.ok(result.nudges > 0);
    assert.ok(Math.abs(measureOrthogonalHypervalentDeviation(graph, result.coords)) < 1e-9);
    assertOppositePair(nitrogenAngle, carbonAngle);
    assertOppositePair(firstOxoAngle, secondOxoAngle);
  });

  it('rotates a compact bridge-linked phosphate block to re-square a triphosphate center', () => {
    const graph = createLayoutGraph(parseSMILES('OP(=O)(O)OP(=O)(O)OP(=O)(O)O'), { suppressH: true });
    const coords = new Map([
      ['O1', { x: -1, y: 0 }],
      ['P2', { x: 0, y: 0 }],
      ['O3', { x: 0, y: 1 }],
      ['O4', { x: 0, y: -1 }],
      ['O5', { x: 1, y: 0 }],
      ['P6', { x: 2, y: 0 }],
      ['O7', { x: 2, y: 1 }],
      ['O8', { x: 2, y: -1 }],
      ['O9', { x: 3, y: 0 }],
      ['P10', { x: 4, y: 0 }],
      ['O11', { x: 4, y: 1 }],
      ['O12', { x: 4, y: -1 }],
      ['O13', { x: 5, y: 0 }]
    ]);
    const center = coords.get('P6');
    for (const atomId of ['O9', 'P10', 'O11', 'O12', 'O13']) {
      const offset = sub(coords.get(atomId), center);
      const angle = angleOf(offset) + Math.PI / 6;
      const radius = Math.hypot(offset.x, offset.y);
      coords.set(atomId, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
    }

    const beforePenalty = measureOrthogonalHypervalentDeviation(graph, coords);
    const result = runHypervalentAngleTidy(graph, coords);
    const middleLigandAngles = ['O5', 'O7', 'O8', 'O9'].map(atomId => angleAt(result.coords, 'P6', atomId));
    const rightLigandAngles = ['O9', 'O11', 'O12', 'O13'].map(atomId => angleAt(result.coords, 'P10', atomId));

    assert.ok(beforePenalty > 0.1);
    assert.ok(result.nudges > 0);
    assertOrthogonalCross(middleLigandAngles);
    assertOrthogonalCross(rightLigandAngles);
  });
});
