import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runLigandAngleTidy } from '../../../../src/layout/engine/cleanup/ligand-angle-tidy.js';
import { layoutOrganometallicFamily } from '../../../../src/layout/engine/families/organometallic.js';
import { angleOf, distance, fromAngle } from '../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { makeSquarePlanarPlatinumComplex } from '../support/molecules.js';

/**
 * Returns whether all direct platinum ligands sit on the axis-aligned square-planar cross.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} ligandAtomIds - Direct ligand atom IDs.
 * @returns {boolean} True when every ligand lies on one of the principal axes.
 */
function isAxisAlignedCross(coords, ligandAtomIds) {
  const metal = coords.get('Pt1');
  return ligandAtomIds.every(atomId => {
    const ligand = coords.get(atomId);
    const dx = ligand.x - metal.x;
    const dy = ligand.y - metal.y;
    return Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6;
  });
}

describe('layout/engine/cleanup/ligand-angle-tidy', () => {
  it('restores distorted cisplatin ligands to square-planar angles', () => {
    const graph = createLayoutGraph(makeSquarePlanarPlatinumComplex(), { suppressH: true });
    const layout = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const distortedCoords = new Map([...layout.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const ligandAtomId = 'Cl2';
    const metalPosition = distortedCoords.get('Pt1');
    const ligandPosition = distortedCoords.get(ligandAtomId);
    const ligandDistance = distance(metalPosition, ligandPosition);
    const distortedAngle = angleOf({
      x: ligandPosition.x - metalPosition.x,
      y: ligandPosition.y - metalPosition.y
    }) + (Math.PI / 9);

    distortedCoords.set(ligandAtomId, {
      x: metalPosition.x + fromAngle(distortedAngle, ligandDistance).x,
      y: metalPosition.y + fromAngle(distortedAngle, ligandDistance).y
    });

    const corrected = runLigandAngleTidy(graph, distortedCoords);

    assert.ok(corrected.nudges >= 1);
    assert.equal(isAxisAlignedCross(distortedCoords, ['Cl2', 'Cl3', 'N4', 'N5']), false);
    assert.equal(isAxisAlignedCross(corrected.coords, ['Cl2', 'Cl3', 'N4', 'N5']), true);
  });
});
