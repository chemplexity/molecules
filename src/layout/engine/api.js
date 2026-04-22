/** @module api */

import { runPipeline } from './pipeline.js';

function hasHiddenHydrogenAtoms(molecule) {
  if (!molecule?.atoms) {
    return false;
  }
  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H' && atom.visible === false) {
      return true;
    }
  }
  return false;
}

function collectHiddenHydrogenAtomIds(molecule) {
  const hiddenHydrogenAtomIds = new Set();
  if (!molecule?.atoms) {
    return hiddenHydrogenAtomIds;
  }
  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H' && atom.visible === false) {
      hiddenHydrogenAtomIds.add(atom.id);
    }
  }
  return hiddenHydrogenAtomIds;
}

function augmentExistingCoordsWithHiddenHydrogens(molecule, existingCoords, hiddenHydrogenAtomIds) {
  if (!(existingCoords instanceof Map) || !(hiddenHydrogenAtomIds instanceof Set) || hiddenHydrogenAtomIds.size === 0) {
    return existingCoords;
  }
  const augmentedCoords = new Map(existingCoords);
  let addedAny = false;
  for (const atomId of hiddenHydrogenAtomIds) {
    if (augmentedCoords.has(atomId)) {
      continue;
    }
    const atom = molecule?.atoms?.get(atomId);
    if (!atom || atom.name !== 'H') {
      continue;
    }
    if (Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
      augmentedCoords.set(atomId, { x: atom.x, y: atom.y });
      addedAny = true;
      continue;
    }
    const parent = atom.getNeighbors(molecule).find(neighbor => Number.isFinite(neighbor?.x) && Number.isFinite(neighbor?.y));
    if (!parent) {
      continue;
    }
    augmentedCoords.set(atomId, { x: parent.x, y: parent.y });
    addedAny = true;
  }
  return addedAny ? augmentedCoords : existingCoords;
}

function buildEngineInputMolecule(molecule, options) {
  if (!options?.suppressH || !hasHiddenHydrogenAtoms(molecule)) {
    return molecule;
  }
  const clone = molecule.clone();
  for (const atom of clone.atoms.values()) {
    if (atom.name === 'H' && atom.visible === false) {
      atom.visible = true;
    }
  }
  return clone;
}

function stripHiddenHydrogenCoords(result, hiddenHydrogenAtomIds) {
  if (!(hiddenHydrogenAtomIds instanceof Set) || hiddenHydrogenAtomIds.size === 0 || !result) {
    return result;
  }
  let removedAny = false;
  const coords = result.coords instanceof Map ? new Map(result.coords) : result.coords;
  for (const atomId of hiddenHydrogenAtomIds) {
    if (coords instanceof Map) {
      removedAny = coords.delete(atomId) || removedAny;
    }
  }

  let restoredAnyVisibility = false;
  const layoutGraph = result.layoutGraph;
  if (layoutGraph?.atoms instanceof Map) {
    for (const atom of layoutGraph.atoms.values()) {
      if (atom?.element !== 'H' || atom.visible === false) {
        continue;
      }
      if (
        hiddenHydrogenAtomIds.has(atom.id)
        || (
          layoutGraph.options?.suppressH === true
          && coords instanceof Map
          && !coords.has(atom.id)
        )
      ) {
        atom.visible = false;
        restoredAnyVisibility = true;
      }
    }
  }

  if (!removedAny && !restoredAnyVisibility) {
    return result;
  }

  return {
    ...result,
    coords
  };
}

function buildEngineRunOptions(molecule, options, hiddenHydrogenAtomIds) {
  if (!(options?.existingCoords instanceof Map) || !(hiddenHydrogenAtomIds instanceof Set) || hiddenHydrogenAtomIds.size === 0) {
    return options;
  }
  const existingCoords = augmentExistingCoordsWithHiddenHydrogens(molecule, options.existingCoords, hiddenHydrogenAtomIds);
  if (existingCoords === options.existingCoords) {
    return options;
  }
  return {
    ...options,
    existingCoords
  };
}

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
  const hiddenHydrogenAtomIds = options?.suppressH ? collectHiddenHydrogenAtomIds(molecule) : new Set();
  const engineOptions = buildEngineRunOptions(molecule, options, hiddenHydrogenAtomIds);
  const result = runPipeline(buildEngineInputMolecule(molecule, engineOptions), engineOptions);
  return stripHiddenHydrogenCoords(result, hiddenHydrogenAtomIds);
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
  const hiddenHydrogenAtomIds = options?.suppressH ? collectHiddenHydrogenAtomIds(molecule) : new Set();
  const engineOptions = buildEngineRunOptions(molecule, options, hiddenHydrogenAtomIds);
  const result = stripHiddenHydrogenCoords(runPipeline(buildEngineInputMolecule(molecule, engineOptions), engineOptions), hiddenHydrogenAtomIds);
  return {
    ...result,
    metadata: buildRefinementMetadata(result, options)
  };
}
