/** @module templates/placement */

import { findFirstSubgraphMapping } from '../../algorithms/vf2.js';
import { getTemplateById, getTemplateCoords } from './library.js';

/**
 * Places a matched scaffold template onto the target atom IDs.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string|null|undefined} templateId - Template identifier.
 * @param {string[]} atomIds - Target atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Placed coordinates or `null`.
 */
export function placeTemplateCoords(layoutGraph, templateId, atomIds, bondLength) {
  if (!templateId) {
    return null;
  }
  const template = getTemplateById(templateId);
  if (!template || template.hasGeometry !== true) {
    return null;
  }
  const templateCoords = getTemplateCoords(template, bondLength);
  if (!templateCoords) {
    return null;
  }
  const target = layoutGraph.sourceMolecule.getSubgraph(atomIds);
  const mapping = findFirstSubgraphMapping(target, template.molecule, { limit: 1 });
  if (!mapping) {
    return null;
  }
  const coords = new Map();
  for (const [templateAtomId, targetAtomId] of mapping) {
    const position = templateCoords.get(templateAtomId);
    if (position) {
      coords.set(targetAtomId, position);
    }
  }
  return coords.size === atomIds.length ? coords : null;
}
