/** @module topology/canonical-order */

import elements from '../../../data/elements.js';

function compareIds(a, b) {
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

function lexCmp(a, b) {
  const len = Math.max(a.length, b.length);
  for (let index = 0; index < len; index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
  }
  return 0;
}

function assignRanks(invariants) {
  const order = [...Array(invariants.length).keys()].sort((firstIndex, secondIndex) => lexCmp(invariants[firstIndex], invariants[secondIndex]));
  const rank = new Array(invariants.length).fill(0);
  for (let index = 1; index < order.length; index++) {
    const previous = order[index - 1];
    const current = order[index];
    rank[current] = rank[previous] + (lexCmp(invariants[previous], invariants[current]) !== 0 ? 1 : 0);
  }
  return {
    rank,
    unique: rank[order[order.length - 1]] + 1
  };
}

function canonicalizeCycle(sequence) {
  if (sequence.length === 0) {
    return [];
  }
  let best = null;
  const directions = [sequence, [...sequence].reverse()];
  for (const direction of directions) {
    for (let index = 0; index < direction.length; index++) {
      const candidate = direction.slice(index).concat(direction.slice(0, index));
      if (best === null || lexCmp(candidate, best) < 0) {
        best = candidate;
      }
    }
  }
  return best ?? [];
}

/**
 * Computes deterministic heavy-atom ranks for a molecule using a Morgan-style
 * invariant expansion seeded from a stable atom-ID order.
 * @param {object} molecule - Molecule-like graph object.
 * @returns {Map<string, number>} Canonical heavy-atom ranks.
 */
export function computeCanonicalAtomRanks(molecule) {
  const atoms = [...molecule.atoms.values()]
    .filter(atom => atom.name !== 'H')
    .sort((firstAtom, secondAtom) => compareIds(firstAtom.id, secondAtom.id));
  if (atoms.length === 0) {
    return new Map();
  }

  const ids = atoms.map(atom => atom.id);
  const atomIndexById = new Map(ids.map((atomId, index) => [atomId, index]));
  const neighbors = atoms.map(atom => {
    const neighborIndexes = [];
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherIndex = atomIndexById.get(bond.getOtherAtom(atom.id));
      if (otherIndex !== undefined) {
        neighborIndexes.push(otherIndex);
      }
    }
    neighborIndexes.sort((firstIndex, secondIndex) => compareIds(ids[firstIndex], ids[secondIndex]));
    return neighborIndexes;
  });

  const hydrogenCounts = atoms.map(atom => {
    let hydrogenCount = 0;
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherAtom = molecule.atoms.get(bond.getOtherAtom(atom.id));
      if (otherAtom?.name === 'H') {
        hydrogenCount++;
      }
    }
    return hydrogenCount;
  });

  const initialInvariants = atoms.map((atom, index) => {
    const atomicNumber = atom.properties.protons ?? 0;
    const heavyDegree = neighbors[index].length;
    const charge = typeof atom.getCharge === 'function' ? atom.getCharge() : (atom.properties.charge ?? 0);
    let isotopeMass = 0;
    if (atom.properties.protons != null && atom.properties.neutrons != null) {
      const observedMass = Math.round(atom.properties.protons + atom.properties.neutrons);
      const element = elements[atom.name];
      const standardMass = element ? Math.round(element.protons + element.neutrons) : observedMass;
      if (observedMass !== standardMass) {
        isotopeMass = observedMass;
      }
    }
    const aromatic = typeof atom.isAromatic === 'function' && atom.isAromatic() ? 1 : (atom.properties.aromatic ? 1 : 0);
    return [atomicNumber, heavyDegree, charge, isotopeMass, hydrogenCounts[index], aromatic];
  });

  function extendRanks(rank) {
    const invariants = rank.map((currentRank, index) => {
      const neighborRanks = neighbors[index].map(neighborIndex => rank[neighborIndex]).sort((first, second) => first - second);
      return [currentRank, ...neighborRanks];
    });
    return assignRanks(invariants);
  }

  let { rank, unique } = assignRanks(initialInvariants);
  for (;;) {
    const next = extendRanks(rank);
    if (next.unique <= unique) {
      break;
    }
    rank = next.rank;
    unique = next.unique;
  }

  while (unique < atoms.length) {
    const counts = new Map();
    for (const currentRank of rank) {
      counts.set(currentRank, (counts.get(currentRank) ?? 0) + 1);
    }
    let tiedRank = null;
    for (let currentRank = 0; currentRank <= atoms.length; currentRank++) {
      if ((counts.get(currentRank) ?? 0) > 1) {
        tiedRank = currentRank;
        break;
      }
    }
    if (tiedRank == null) {
      break;
    }
    const tiedIndexes = rank
      .map((currentRank, index) => (currentRank === tiedRank ? index : -1))
      .filter(index => index >= 0);
    tiedIndexes.sort((firstIndex, secondIndex) => {
      const invariantCompare = lexCmp(initialInvariants[firstIndex], initialInvariants[secondIndex]);
      return invariantCompare !== 0 ? invariantCompare : compareIds(ids[firstIndex], ids[secondIndex]);
    });
    const chosenIndex = tiedIndexes[0];
    const fractional = rank.map((currentRank, index) => [index === chosenIndex ? currentRank - 0.5 : currentRank]);
    ({ rank, unique } = assignRanks(fractional));
    for (;;) {
      const next = extendRanks(rank);
      if (next.unique <= unique) {
        break;
      }
      rank = next.rank;
      unique = next.unique;
    }
  }

  return new Map(ids.map((atomId, index) => [atomId, rank[index]]));
}

/**
 * Compares two atom IDs using canonical heavy-atom ranks as the primary key.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @param {Map<string, number>} canonicalAtomRank - Canonical heavy-atom ranks.
 * @returns {number} Negative, zero, or positive comparator result.
 */
export function compareCanonicalAtomIds(firstAtomId, secondAtomId, canonicalAtomRank) {
  const firstRank = canonicalAtomRank.get(firstAtomId);
  const secondRank = canonicalAtomRank.get(secondAtomId);
  if (firstRank != null && secondRank != null && firstRank !== secondRank) {
    return firstRank - secondRank;
  }
  if (firstRank != null && secondRank == null) {
    return -1;
  }
  if (firstRank == null && secondRank != null) {
    return 1;
  }
  return compareIds(firstAtomId, secondAtomId);
}

/**
 * Returns a canonically sorted copy of an atom-ID list.
 * @param {string[]} atomIds - Atom IDs to sort.
 * @param {Map<string, number>} canonicalAtomRank - Canonical heavy-atom ranks.
 * @returns {string[]} Sorted atom IDs.
 */
export function sortAtomIdsCanonical(atomIds, canonicalAtomRank) {
  return [...atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, canonicalAtomRank));
}

/**
 * Builds a deterministic signature for an ordered ring atom sequence.
 * @param {string[]} ringAtomIds - Ring atom IDs in traversal order.
 * @param {Map<string, number>} canonicalAtomRank - Canonical heavy-atom ranks.
 * @param {object} [molecule] - Optional molecule-like graph used to summarize aromaticity.
 * @returns {string} Canonical ring signature.
 */
export function buildCanonicalRingSignature(ringAtomIds, canonicalAtomRank, molecule = null) {
  const rankSequence = ringAtomIds.map(atomId => canonicalAtomRank.get(atomId) ?? Number.MAX_SAFE_INTEGER);
  const bestCycle = canonicalizeCycle(rankSequence);
  let aromaticAtomCount = 0;
  if (molecule) {
    for (const atomId of ringAtomIds) {
      const atom = molecule.atoms.get(atomId);
      if ((typeof atom?.isAromatic === 'function' && atom.isAromatic()) || atom?.properties.aromatic) {
        aromaticAtomCount++;
      }
    }
  }
  return `${ringAtomIds.length}|${aromaticAtomCount}|${bestCycle.join(',')}`;
}

/**
 * Builds a deterministic signature for a connected component.
 * @param {string[]} atomIds - Component atom IDs.
 * @param {Map<string, number>} canonicalAtomRank - Canonical heavy-atom ranks.
 * @param {object} molecule - Molecule-like graph.
 * @returns {string} Canonical component signature.
 */
export function buildCanonicalComponentSignature(atomIds, canonicalAtomRank, molecule) {
  const parts = atomIds
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .map(atomId => {
      const atom = molecule.atoms.get(atomId);
      const charge = typeof atom?.getCharge === 'function' ? atom.getCharge() : (atom?.properties.charge ?? 0);
      const aromatic = (typeof atom?.isAromatic === 'function' && atom.isAromatic()) || atom?.properties.aromatic ? 1 : 0;
      const rank = canonicalAtomRank.get(atomId) ?? Number.MAX_SAFE_INTEGER;
      return `${String(rank).padStart(6, '0')}:${atom?.name ?? 'X'}:${charge}:${aromatic}`;
    })
    .sort();
  return `${parts.length}|${parts.join(';')}`;
}
