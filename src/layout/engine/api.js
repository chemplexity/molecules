/** @module api */

import { runPipeline } from './pipeline.js';

function buildRefinementMetadata(result, options) {
  return {
    ...result.metadata,
    refine: true,
    touchedAtomCount: options.touchedAtoms instanceof Set ? options.touchedAtoms.size : 0,
    touchedBondCount: options.touchedBonds instanceof Set ? options.touchedBonds.size : 0
  };
}

/**
 * Builds the current layout result for a molecule.
 * At this stage the engine places the supported core families and returns
 * topology metadata plus any fixed/existing coordinate seeding.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} [options] - Layout options.
 * @returns {object} Layout result.
 */
export function generateCoords(molecule, options = {}) {
  return runPipeline(molecule, options);
}

/**
 * Builds the current refinement entrypoint for a molecule.
 * Refinement still runs the full pipeline; the distinction is that
 * `existingCoords`, `touchedAtoms`, and `touchedBonds` steer component
 * placement and cleanup inside the engine rather than selecting a separate
 * top-level pipeline mode here.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} [options] - Refinement options.
 * @returns {object} Refinement result.
 */
export function refineCoords(molecule, options = {}) {
  const result = runPipeline(molecule, options);
  return {
    ...result,
    metadata: buildRefinementMetadata(result, options)
  };
}
