/** @module geometry/ring-path */

/**
 * Traverses `atomIds` as a cyclic list from `startAtomId` toward `endAtomId`
 * using the given step direction (+1 forward, -1 backward).
 * @param {string[]} atomIds - Ordered cyclic ring atom id list.
 * @param {string} startAtomId - Starting atom id.
 * @param {string} endAtomId - Ending atom id.
 * @param {1|-1} step - Step direction (+1 or -1).
 * @returns {string[]} Path from start to end inclusive.
 */
export function traversePath(atomIds, startAtomId, endAtomId, step) {
  const count = atomIds.length;
  let index = atomIds.indexOf(startAtomId);
  const result = [startAtomId];
  while (atomIds[index] !== endAtomId) {
    index = (index + step + count) % count;
    result.push(atomIds[index]);
  }
  return result;
}

/**
 * Returns the longer of the two cyclic arc paths between two shared boundary atoms.
 * @param {string[]} atomIds - Ordered cyclic ring atom id list.
 * @param {string} firstSharedAtomId - First shared atom id.
 * @param {string} secondSharedAtomId - Second shared atom id.
 * @returns {string[]} The non-shared (longer) path segment.
 */
export function nonSharedPath(atomIds, firstSharedAtomId, secondSharedAtomId) {
  const forward = traversePath(atomIds, firstSharedAtomId, secondSharedAtomId, 1);
  const backward = traversePath(atomIds, firstSharedAtomId, secondSharedAtomId, -1);
  return forward.length >= backward.length ? forward : backward;
}
