import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ellipsePerimeterPoints, macrocycleAspectRatio, solveEllipseScale } from '../../../src/layoutv2/geometry/ellipse.js';
import { angleOf, centroid, distance, sub } from '../../../src/layoutv2/geometry/vec2.js';
import { runRingPerimeterCorrection } from '../../../src/layoutv2/cleanup/ring-perimeter-correction.js';
import { layoutMacrocycleFamily } from '../../../src/layoutv2/families/macrocycle.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { makeAlternatingMethylMacrocycle } from '../support/molecules.js';

/**
 * Measures the maximum deviation of the primary macrocycle ring from its ideal ellipse perimeter.
 * @param {object} ring - Macrocycle ring descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {number} Maximum ring-atom deviation from the ideal ellipse perimeter.
 */
function maxPerimeterDeviation(ring, coords, bondLength) {
  const ringPoints = ring.atomIds.map(atomId => coords.get(atomId));
  const center = centroid(ringPoints);
  const startAngle = angleOf(sub(ringPoints[0], center));
  const aspectRatio = macrocycleAspectRatio(ring.size);
  const baseScale = solveEllipseScale(ring.size, bondLength, aspectRatio, startAngle);
  const idealPoints = ellipsePerimeterPoints(center, ring.atomIds.length, baseScale * aspectRatio, baseScale / aspectRatio, startAngle);

  return ring.atomIds.reduce((maxDeviation, atomId, index) => (
    Math.max(maxDeviation, distance(coords.get(atomId), idealPoints[index]))
  ), 0);
}

describe('layoutv2/cleanup/ring-perimeter-correction', () => {
  it('pulls a distorted substituted macrocycle back toward its ideal ellipse', () => {
    const graph = createLayoutGraph(makeAlternatingMethylMacrocycle(), { suppressH: true });
    const ring = graph.rings.find(candidateRing => candidateRing.size >= 12);
    const layout = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const distortedCoords = new Map([...layout.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));

    distortedCoords.set(ring.atomIds[0], {
      x: distortedCoords.get(ring.atomIds[0]).x + 0.35,
      y: distortedCoords.get(ring.atomIds[0]).y - 0.2
    });
    distortedCoords.set(ring.atomIds[3], {
      x: distortedCoords.get(ring.atomIds[3]).x - 0.3,
      y: distortedCoords.get(ring.atomIds[3]).y + 0.25
    });

    const corrected = runRingPerimeterCorrection(graph, distortedCoords, {
      bondLength: graph.options.bondLength
    });

    assert.ok(corrected.nudges >= 1);
    assert.ok(
      maxPerimeterDeviation(ring, corrected.coords, graph.options.bondLength)
      < maxPerimeterDeviation(ring, distortedCoords, graph.options.bondLength)
    );
  });
});
