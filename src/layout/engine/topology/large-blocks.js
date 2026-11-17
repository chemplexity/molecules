/** @module topology/large-blocks */

/**
 * Returns whether the current traits exceed the large-molecule threshold.
 * @param {{heavyAtomCount: number, ringSystemCount: number}} traits - Layout traits.
 * @param {{heavyAtomCount: number, ringSystemCount: number, blockCount: number}} threshold - Large-molecule threshold.
 * @param {number} componentCount - Current connected-component or block count.
 * @returns {boolean} True when the threshold is exceeded.
 */
export function exceedsLargeMoleculeThreshold(traits, threshold, componentCount) {
  return traits.heavyAtomCount > threshold.heavyAtomCount || traits.ringSystemCount > threshold.ringSystemCount || componentCount > threshold.blockCount;
}

/**
 * Returns the ring systems fully contained within one component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[]}} component - Connected-component descriptor.
 * @returns {object[]} Ring systems contained within the component.
 */
function componentRingSystems(layoutGraph, component) {
  if (!layoutGraph?.ringSystems || !Array.isArray(component?.atomIds)) {
    return [];
  }
  const atomIdSet = new Set(component.atomIds);
  return layoutGraph.ringSystems.filter(ringSystem => ringSystem.atomIds.every(atomId => atomIdSet.has(atomId)));
}

/**
 * Counts unique heavy atoms that belong to ring systems inside one component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[]}} component - Connected-component descriptor.
 * @returns {number} Ring heavy-atom count.
 */
function componentRingHeavyAtomCount(layoutGraph, component) {
  const ringAtomIds = new Set();
  for (const ringSystem of componentRingSystems(layoutGraph, component)) {
    for (const atomId of ringSystem.atomIds) {
      const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
      if (atom?.name !== 'H') {
        ringAtomIds.add(atomId);
      }
    }
  }
  return ringAtomIds.size;
}

/**
 * Counts atoms that participate in placement for one component. Explicit
 * hydrogens contribute when visible; suppressed hydrogens do not. Keeping this
 * count aligned with large-molecule block partitioning prevents an
 * explicit-hydrogen-rich component from overwhelming the ordinary mixed
 * placer while its heavy-atom count remains below the public threshold.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[]}} component - Connected-component descriptor.
 * @returns {number} Placement participant count.
 */
function componentParticipantAtomCount(layoutGraph, component) {
  const atoms = layoutGraph.atoms ?? layoutGraph.sourceMolecule?.atoms;
  let count = 0;
  for (const atomId of component.atomIds) {
    const atom = atoms?.get(atomId);
    const element = atom?.element ?? atom?.name;
    if (!atom || atom.visible === false || (layoutGraph.options.suppressH && element === 'H')) {
      continue;
    }
    count++;
  }
  return count;
}

/**
 * Returns whether one connected component should use the large-molecule path.
 * In addition to the raw threshold checks, this catches mixed components with
 * a comparatively small ring scaffold and a very large non-ring body, which
 * can be much slower through the ordinary mixed scaffold placer.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[], heavyAtomCount: number}} component - Connected-component descriptor.
 * @returns {boolean} True when the component should use large-molecule placement.
 */
export function exceedsLargeComponentThreshold(layoutGraph, component) {
  if (!layoutGraph?.options?.largeMoleculeThreshold || !component || !Number.isFinite(component.heavyAtomCount)) {
    return false;
  }
  const threshold = layoutGraph.options.largeMoleculeThreshold;
  const ringSystemCount = componentRingSystems(layoutGraph, component).length;
  const participantThreshold = Math.max(48, Math.floor(threshold.heavyAtomCount * 0.8));
  if (component.heavyAtomCount > threshold.heavyAtomCount || componentParticipantAtomCount(layoutGraph, component) > participantThreshold || ringSystemCount > threshold.ringSystemCount) {
    return true;
  }

  const ringHeavyAtomCount = componentRingHeavyAtomCount(layoutGraph, component);
  const nonRingHeavyAtomCount = Math.max(0, component.heavyAtomCount - ringHeavyAtomCount);
  const mixedHeavyFloor = Math.max(48, Math.floor(threshold.heavyAtomCount * 0.7));
  const nonRingHeavyFloor = Math.max(24, Math.floor(threshold.heavyAtomCount * 0.35));

  return ringSystemCount > 0 && component.heavyAtomCount >= mixedHeavyFloor && nonRingHeavyAtomCount >= nonRingHeavyFloor;
}
