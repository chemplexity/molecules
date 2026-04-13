/** @module scaffold/fallback-scaffold */

function familyPriority(family) {
  switch (family) {
    case 'bridged':
      return 5;
    case 'macrocycle':
      return 4;
    case 'fused':
      return 3;
    case 'spiro':
      return 2;
    case 'isolated-ring':
      return 1;
    default:
      return 0;
  }
}

function compareStrings(firstValue, secondValue) {
  return String(firstValue).localeCompare(String(secondValue), 'en', { numeric: true });
}

/**
 * Returns the fallback priority of a matched scaffold template.
 * @param {object} candidate - Scaffold candidate.
 * @returns {number} Template priority or `-1`.
 */
export function candidateTemplatePriority(candidate) {
  return candidate.templateMatch?.priority ?? -1;
}

/**
 * Compares two fallback scaffold candidates deterministically.
 * @param {object} firstCandidate - First scaffold candidate.
 * @param {object} secondCandidate - Second scaffold candidate.
 * @returns {number} Sort comparator result.
 */
export function compareFallbackScaffolds(firstCandidate, secondCandidate) {
  if (secondCandidate.atomCount !== firstCandidate.atomCount) {
    return secondCandidate.atomCount - firstCandidate.atomCount;
  }
  if (secondCandidate.ringCount !== firstCandidate.ringCount) {
    return secondCandidate.ringCount - firstCandidate.ringCount;
  }
  if (candidateTemplatePriority(secondCandidate) !== candidateTemplatePriority(firstCandidate)) {
    return candidateTemplatePriority(secondCandidate) - candidateTemplatePriority(firstCandidate);
  }
  if (secondCandidate.aromaticRingCount !== firstCandidate.aromaticRingCount) {
    return secondCandidate.aromaticRingCount - firstCandidate.aromaticRingCount;
  }
  if (familyPriority(secondCandidate.family) !== familyPriority(firstCandidate.family)) {
    return familyPriority(secondCandidate.family) - familyPriority(firstCandidate.family);
  }
  return compareStrings(firstCandidate.signature, secondCandidate.signature);
}
