import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { runLigandAngleTidy } from '../../../../src/layout/engine/cleanup/ligand-angle-tidy.js';
import { layoutOrganometallicFamily } from '../../../../src/layout/engine/families/organometallic.js';
import { angleOf, distance, fromAngle, sub, wrapAngleUnsigned } from '../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { makeSquarePlanarPlatinumComplex } from '../support/molecules.js';

const PLATINUM_CHELATE_SMILES = '[H][N]([H])([H])[Pt]1(OCC(=O)O1)[N]([H])([H])[H]';

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

/**
 * Returns ordered angular separations around a metal center.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} metalAtomId - Metal atom ID.
 * @param {string[]} ligandAtomIds - Direct ligand atom IDs.
 * @returns {number[]} Clockwise angular separations in radians.
 */
function metalLigandSeparations(coords, metalAtomId, ligandAtomIds) {
  const metalPosition = coords.get(metalAtomId);
  const angles = ligandAtomIds.map(atomId => wrapAngleUnsigned(angleOf(sub(coords.get(atomId), metalPosition)))).sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  return angles.map((angle, index) => (angles[(index + 1) % angles.length] - angle + 2 * Math.PI) % (2 * Math.PI));
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
    const distortedAngle =
      angleOf({
        x: ligandPosition.x - metalPosition.x,
        y: ligandPosition.y - metalPosition.y
      }) +
      Math.PI / 9;

    distortedCoords.set(ligandAtomId, {
      x: metalPosition.x + fromAngle(distortedAngle, ligandDistance).x,
      y: metalPosition.y + fromAngle(distortedAngle, ligandDistance).y
    });

    const corrected = runLigandAngleTidy(graph, distortedCoords);

    assert.ok(corrected.nudges >= 1);
    assert.equal(isAxisAlignedCross(distortedCoords, ['Cl2', 'Cl3', 'N4', 'N5']), false);
    assert.equal(isAxisAlignedCross(corrected.coords, ['Cl2', 'Cl3', 'N4', 'N5']), true);
  });

  it('splits terminal ligands across an open square-planar chelate pocket', () => {
    const graph = createLayoutGraph(parseSMILES(PLATINUM_CHELATE_SMILES), { suppressH: true });
    const distortedCoords = new Map([
      ['Pt5', { x: 0, y: 0 }],
      ['O6', fromAngle((-108 * Math.PI) / 180, graph.options.bondLength)],
      ['N11', fromAngle(0, graph.options.bondLength)],
      ['N2', fromAngle(Math.PI / 2, graph.options.bondLength)],
      ['O10', fromAngle((144 * Math.PI) / 180, graph.options.bondLength)]
    ]);

    const corrected = runLigandAngleTidy(graph, distortedCoords);
    const separations = metalLigandSeparations(corrected.coords, 'Pt5', ['O6', 'N11', 'N2', 'O10']);

    assert.ok(corrected.nudges >= 1);
    assert.ok(
      Math.min(...separations) > (80 * Math.PI) / 180,
      `expected terminal ligands to clear the acute chelate fan, got ${separations.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')}`
    );
    assert.ok(Math.max(...separations) < (115 * Math.PI) / 180, `expected chelate fan to stay balanced, got ${separations.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')}`);
    assert.ok(Math.abs(distance(corrected.coords.get('Pt5'), corrected.coords.get('N2')) - graph.options.bondLength) < 1e-9);
    assert.ok(Math.abs(distance(corrected.coords.get('Pt5'), corrected.coords.get('N11')) - graph.options.bondLength) < 1e-9);
  });
});
