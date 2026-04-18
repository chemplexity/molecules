/** @module cleanup/frozen-atoms */

/**
 * Returns whether any atom in the candidate set is frozen.
 * @param {Iterable<string>} candidateAtomIds - Candidate atom IDs.
 * @param {Set<string>} frozenAtomIds - Frozen atom IDs.
 * @returns {boolean} True when the candidate touches a frozen atom.
 */
export function containsFrozenAtom(candidateAtomIds, frozenAtomIds) {
  return candidateAtomIds.some(atomId => frozenAtomIds.has(atomId));
}

/**
 * Merges two optional frozen-atom sets into one nullable set.
 * @param {Set<string>|null|undefined} baseFrozenAtomIds - Existing frozen atoms.
 * @param {Iterable<string>|null|undefined} extraFrozenAtomIds - Additional frozen atoms.
 * @returns {Set<string>|null} Merged frozen-atom set, or `null` when empty.
 */
export function mergeFrozenAtomIds(baseFrozenAtomIds, extraFrozenAtomIds) {
  const merged = new Set(baseFrozenAtomIds ?? []);
  for (const atomId of extraFrozenAtomIds ?? []) {
    merged.add(atomId);
  }
  return merged.size > 0 ? merged : null;
}
