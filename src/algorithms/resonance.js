/** @module algorithms/resonance */

import { kekulize } from '../layout/mol2d-helpers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Neutral sigma-frame valence targets for common aromatic elements. */
const AROMATIC_SIGMA_VALENCE = {
  B: 3,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  Si: 4,
  P: 3,
  S: 2,
  Cl: 1,
  As: 3,
  Se: 2,
  Br: 1,
  Te: 2,
  I: 1
};

/** Halides that can support exocyclic aromatic charge-separated donor states. */
const EXOCYCLIC_AROMATIC_HALIDE_DONOR_SYMBOLS = new Set(['F', 'Cl', 'Br', 'I']);

/**
 * Returns the common neutral valence family for an element.
 *
 * These are the same "ordinary chemistry" valence families used by the
 * validator and serve as the neutral baseline before any charge/radical shift
 * is applied during resonance charge assignment.
 *
 * @param {string} symbol
 * @param {number} group
 * @param {number} period
 * @returns {number[]}
 */
function _commonNeutralValences(symbol, group, period) {
  if (symbol === 'H') {
    return [1];
  }
  if (symbol === 'He' || group === 18) {
    return [0];
  }
  if (group === 1 || group === 2) {
    return [group];
  }
  if (group === 13) {
    return [3];
  }
  if (group === 14) {
    return [4];
  }
  if (group === 15) {
    return period <= 2 ? [3] : [3, 5];
  }
  if (group === 16) {
    return period <= 2 ? [2] : [2, 4, 6];
  }
  if (group === 17) {
    return [1];
  }
  return [];
}

/**
 * Shifts an element's common valence family by a proposed formal charge.
 *
 * This mirrors the common-valence logic in validation: carbon-family atoms
 * usually step down with charge magnitude, while heavier pnictogens/chalcogens
 * can step up under cationic resonance assignments.
 *
 * @param {string} symbol
 * @param {import('../core/Atom.js').Atom} atom
 * @param {number} charge
 * @returns {number[]}
 */
function _shiftedCommonValences(symbol, atom, charge) {
  const group = atom.properties.group;
  const period = atom.properties.period;
  const radical = atom.properties.radical ?? 0;
  const base = _commonNeutralValences(symbol, group, period);
  if (base.length === 0) {
    return [];
  }

  const shift =
    symbol === 'H'
      ? v => v - Math.abs(charge) - radical
      : group === 14
        ? v => v - Math.abs(charge) - radical
        : group >= 15 && group <= 17
          ? v => v + charge - radical
          : v => v - charge - radical;

  return [...new Set(base.map(shift).filter(v => Number.isInteger(v) && v >= 0 && v <= 8))].sort((a, b) => a - b);
}

/**
 * Returns the plausible formal charges for an atom at a proposed bond-order sum.
 *
 * Candidate charges are limited to values whose shifted common valence family
 * can accommodate the proposed total bond order.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {number} bondSum
 * @param {number} maxCharge
 * @returns {number[]}
 */
function _candidateFormalCharges(atom, bondSum, maxCharge) {
  const group = atom.properties.group;
  if (!group || (group >= 3 && group <= 12)) {
    return [atom.properties.charge ?? 0];
  }

  const candidates = [];
  for (let charge = -maxCharge; charge <= maxCharge; charge++) {
    const allowedValences = _shiftedCommonValences(atom.name, atom, charge);
    if (allowedValences.includes(bondSum)) {
      candidates.push(charge);
    }
  }

  if (candidates.length > 0) {
    return candidates;
  }

  const fallback = atom.computeCharge(bondSum);
  return Math.abs(fallback) <= maxCharge ? [fallback] : [];
}

/**
 * Scores how "natural" a formal-charge assignment is for one atom.
 *
 * Lower cost is preferred. The canonical live charge is favored, small charge
 * magnitudes are preferred over larger ones, and heteroatoms are biased toward
 * negative charge while carbons are biased away from it.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {number} charge
 * @returns {number}
 */
function _formalChargeAssignmentCost(atom, charge) {
  const canonicalCharge = atom.properties.charge ?? 0;
  let cost = Math.abs(charge - canonicalCharge) * 8 + Math.abs(charge) * 4;

  if (charge < 0) {
    if (atom.name === 'O' || atom.name === 'N' || atom.name === 'S' || atom.name === 'F' || atom.name === 'Cl' || atom.name === 'Br' || atom.name === 'I') {
      cost -= 2;
    } else {
      cost += 2;
    }
  } else if (charge > 0) {
    if (atom.name === 'O' || atom.name === 'N' || atom.name === 'F' || atom.name === 'Cl' || atom.name === 'Br' || atom.name === 'I') {
      cost += 2;
    } else {
      cost -= 1;
    }
  }

  return cost;
}

/**
 * Computes the legacy octet-fill formal charge used for aromatic atoms.
 *
 * Aromatic resonance enumeration already has dedicated ring-level validation,
 * and the earlier octet-fill bookkeeping works well there, so we keep it for
 * aromatic atoms while using the newer valence-family solver for non-aromatics.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {number} bondSum
 * @returns {number}
 */
function _legacyFormalCharge(atom, bondSum) {
  const group = atom.properties.group;
  if (!group) {
    return atom.properties.charge ?? 0;
  }

  const valenceElectrons = group <= 2 ? group : group - 10;
  const maxElectrons = atom.name === 'H' ? 2 : 8;
  const lonePairElectrons = Math.max(0, maxElectrons - 2 * bondSum);
  return valenceElectrons - lonePairElectrons - bondSum;
}

/**
 * Returns the number of aromatic in-ring pi bonds an atom is expected to take
 * part in for a valid localized aromatic contributor.
 *
 * This mirrors the aromaticity model used in `algorithms/aromaticity.js`:
 * carbon and pyridine-like nitrogens contribute one electron via a ring pi
 * bond, while pyrrole-/furan-like heteroatoms contribute via a lone pair and
 * therefore take part in zero ring pi bonds. Cationic O/S and pyridinium-like
 * N shift back to one ring pi bond.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {number} formalCharge
 * @returns {number|null}
 */
function _expectedAromaticPiBondCount(atom, molecule, formalCharge) {
  if (!atom?.properties?.aromatic) {
    return null;
  }

  if (atom.name === 'C') {
    return formalCharge === 0 ? 1 : 0;
  }

  if (atom.name === 'N') {
    if (formalCharge === -1) {
      return 0;
    }
    if (formalCharge === 1) {
      return 1;
    }
    const hasHydrogen = atom.bonds.some(bondId => {
      const bond = molecule.bonds.get(bondId);
      return bond && molecule.atoms.get(bond.getOtherAtom(atom.id))?.name === 'H';
    });
    return hasHydrogen ? 0 : 1;
  }

  if (atom.name === 'O' || atom.name === 'S') {
    return formalCharge > 0 ? 1 : 0;
  }

  if (atom.name === 'B') {
    return 0;
  }

  const sigmaTarget = AROMATIC_SIGMA_VALENCE[atom.name];
  if (sigmaTarget === undefined) {
    return null;
  }
  return formalCharge === 0 && sigmaTarget > 2 ? 1 : 0;
}

/**
 * Returns true when an aromatic atom is double-bonded to a positively charged
 * exocyclic halide donor that can feed electron density into the aromatic ring.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {Set<string>|null} ringAtomSet
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Map<string, number>} bondOrders
 * @param {Map<string, number>} formalCharges
 * @returns {boolean}
 */
function _hasExocyclicPositiveDonorPiBond(atom, ringAtomSet, molecule, bondOrders, formalCharges) {
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }

    const neighborId = bond.getOtherAtom(atom.id);
    if (ringAtomSet?.has(neighborId)) {
      continue;
    }

    const neighbor = molecule.atoms.get(neighborId);
    if (!neighbor || neighbor.properties?.aromatic || !EXOCYCLIC_AROMATIC_HALIDE_DONOR_SYMBOLS.has(neighbor.name)) {
      continue;
    }

    const localizedOrder = bondOrders.get(bond.id) ?? bond.properties.localizedOrder ?? bond.properties.order ?? 1;
    const formalCharge = formalCharges.get(neighborId) ?? 0;
    if (localizedOrder >= 2 && formalCharge === 1) {
      return true;
    }
  }

  return false;
}

/**
 * Returns the localised ring-pi electron contribution for an atom within a
 * specific aromatic ring under a proposed resonance state.
 *
 * This mirrors the Hückel bookkeeping from `algorithms/aromaticity.js`, but
 * uses the candidate state's localised bond orders and formal charges.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {Set<string>} ringAtomSet
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Map<string, number>} bondOrders
 * @param {number} formalCharge
 * @param {Map<string, number>} formalCharges
 * @returns {number|null}
 */
function _localizedRingPiElectrons(atom, ringAtomSet, molecule, bondOrders, formalCharge, formalCharges) {
  const ringBonds = atom.bonds.map(bondId => molecule.bonds.get(bondId)).filter(bond => bond && ringAtomSet.has(bond.getOtherAtom(atom.id)));

  const hasRingPiBond = ringBonds.some(bond => {
    const localizedOrder = bondOrders.get(bond.id) ?? bond.properties.localizedOrder ?? bond.properties.order ?? 1;
    return localizedOrder >= 2;
  });

  if (atom.name === 'C') {
    if (formalCharge === 1) {
      return 0;
    }
    if (formalCharge === -1) {
      return hasRingPiBond ? null : 2;
    }
    if (hasRingPiBond) {
      return 1;
    }
    // Junction carbon in a fused aromatic system: its pi bond may lie entirely
    // in the adjacent ring. If it has a double bond to any aromatic neighbour
    // outside this ring, it still contributes 1 pi electron to this ring's count.
    const hasAdjacentAromaticPiBond = atom.bonds.some(bondId => {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        return false;
      }
      const neighborId = bond.getOtherAtom(atom.id);
      if (ringAtomSet.has(neighborId)) {
        return false;
      }
      const neighbor = molecule.atoms.get(neighborId);
      if (!neighbor?.properties?.aromatic) {
        return false;
      }
      const localizedOrder = bondOrders.get(bondId) ?? bond.properties.localizedOrder ?? bond.properties.order ?? 1;
      return localizedOrder >= 2;
    });
    if (hasAdjacentAromaticPiBond) {
      return 1;
    }
    if (_hasExocyclicPositiveDonorPiBond(atom, ringAtomSet, molecule, bondOrders, formalCharges)) {
      return 0;
    }
    return null;
  }

  if (atom.name === 'N') {
    if (formalCharge === 1) {
      return hasRingPiBond ? 1 : null;
    }
    if (formalCharge === -1) {
      return hasRingPiBond ? null : 2;
    }
    const hasHydrogen = atom.bonds.some(bondId => {
      const bond = molecule.bonds.get(bondId);
      return bond && molecule.atoms.get(bond.getOtherAtom(atom.id))?.name === 'H';
    });
    if (hasHydrogen) {
      return hasRingPiBond ? null : 2;
    }
    return hasRingPiBond ? 1 : null;
  }

  if (atom.name === 'O' || atom.name === 'S') {
    if (formalCharge > 0) {
      return hasRingPiBond ? 1 : null;
    }
    return hasRingPiBond ? null : 2;
  }

  if (atom.name === 'B') {
    return 0;
  }

  return null;
}

/**
 * Returns true when an aromatic ring carries a supported exocyclic donor pair.
 *
 * These are charge-separated aromatic contributors where the positive charge
 * lives on a lone-pair donor outside the ring (for example `Cl+` in
 * chlorobenzene-like contributors) while the ring itself carries the
 * compensating negative charge.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {string[]} ring
 * @param {Map<string, number>} bondOrders
 * @param {Map<string, number>} formalCharges
 * @returns {boolean}
 */
function _hasSupportedExocyclicAromaticDonorPair(molecule, ring, bondOrders, formalCharges) {
  const ringAtomSet = new Set(ring);
  let donorCount = 0;

  for (const ringAtomId of ring) {
    const ringAtom = molecule.atoms.get(ringAtomId);
    if (!ringAtom) {
      return false;
    }

    for (const bondId of ringAtom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }

      const neighborId = bond.getOtherAtom(ringAtomId);
      if (ringAtomSet.has(neighborId)) {
        continue;
      }

      const neighbor = molecule.atoms.get(neighborId);
      if (!neighbor || neighbor.properties?.aromatic || !EXOCYCLIC_AROMATIC_HALIDE_DONOR_SYMBOLS.has(neighbor.name)) {
        continue;
      }

      const localizedOrder = bondOrders.get(bond.id) ?? bond.properties.localizedOrder ?? bond.properties.order ?? 1;
      const formalCharge = formalCharges.get(neighborId) ?? 0;
      if (localizedOrder >= 2 && formalCharge === 1) {
        donorCount++;
      }
    }
  }

  return donorCount === 1;
}

/**
 * Returns true when `piCount` satisfies Hückel's 4n + 2 rule.
 *
 * @param {number} piCount
 * @returns {boolean}
 */
function _isHuckelCount(piCount) {
  if (piCount < 2) {
    return false;
  }
  return (piCount - 2) % 4 === 0;
}

// ---------------------------------------------------------------------------
// Step 1 — Pi system identification
// ---------------------------------------------------------------------------

/**
 * Determines whether an atom is a cumulene central atom (allene-type sp carbon)
 * that should be excluded from the planar conjugated pi system.
 *
 * A cumulene centre has two or more double bonds, is not in a ring, and is
 * carbon — these have orthogonal pi orbitals and do not participate in
 * planar delocalization.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {boolean}
 */
function _isCumuleneCentre(atom, molecule) {
  if (atom.name !== 'C') {
    return false;
  }
  if (atom.isInRing(molecule)) {
    return false;
  }
  let doubleBondCount = 0;
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const order = bond.properties.localizedOrder ?? bond.properties.order ?? 1;
    if (order >= 2) {
      doubleBondCount++;
    }
  }
  return doubleBondCount >= 2;
}

/**
 * Identifies the set of atoms and bonds that participate in electron
 * delocalization — the "pi system" for resonance enumeration.
 *
 * Includes:
 * - All bonds with order ≥ 2 or aromatic flag
 * - Adjacent atoms that can donate a lone pair or accept one (carbocation)
 * - Atoms with a radical adjacent to any pi-system bond
 * - Expands transitively until stable
 *
 * Excludes cumulene central atoms (allene-type carbons with two orthogonal
 * pi bonds outside rings).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ atomIds: Set<string>, bondIds: Set<string> }}
 */
function _buildPiSystem(molecule) {
  const bondIds = new Set();
  const atomIds = new Set();

  // Seed with all pi bonds
  for (const [bondId, bond] of molecule.bonds) {
    const order = bond.properties.localizedOrder ?? bond.properties.order ?? 1;
    if (order >= 2 || bond.properties.aromatic) {
      bondIds.add(bondId);
      bond.atoms.forEach(id => atomIds.add(id));
    }
  }

  // Expand transitively: add lone-pair donors, radical atoms, and carbocations
  // that are adjacent to any current pi-system bond, then pull in their bonds
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, atom] of molecule.atoms) {
      if (atom.name === 'H') {
        continue;
      }
      if (_isCumuleneCentre(atom, molecule)) {
        continue;
      }
      const isDonor = atom.availableLonePairs(molecule) >= 1;
      const isAcceptor = atom.name === 'C' && (atom.properties.charge ?? 0) === 1;
      const isRadical = (atom.properties.radical ?? 0) > 0;
      if (!isDonor && !isAcceptor && !isRadical) {
        continue;
      }
      // Check if adjacent to an existing pi-system bond or atom
      let adjacent = false;
      for (const bondId of atom.bonds) {
        const bond = molecule.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const other = bond.getOtherAtom(atom.id);
        if (bondIds.has(bondId) || atomIds.has(other)) {
          adjacent = true;
          break;
        }
      }
      if (!adjacent) {
        continue;
      }
      if (!atomIds.has(atom.id)) {
        atomIds.add(atom.id);
        changed = true;
      }
      // Pull in all single bonds adjacent to this atom that connect to pi atoms
      for (const bondId of atom.bonds) {
        if (bondIds.has(bondId)) {
          continue;
        }
        const bond = molecule.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const other = bond.getOtherAtom(atom.id);
        if (atomIds.has(other)) {
          bondIds.add(bondId);
          changed = true;
        }
      }
    }
  }

  // Remove cumulene centres from atomIds (they seeded via bonds but shouldn't participate)
  for (const atomId of [...atomIds]) {
    const atom = molecule.atoms.get(atomId);
    if (atom && _isCumuleneCentre(atom, molecule)) {
      atomIds.delete(atomId);
    }
  }

  return { atomIds, bondIds };
}

/**
 * Splits the pi system into connected components using only bonds that belong
 * to the pi-system graph.
 *
 * Disconnected components represent independent resonance regions. Their
 * Cartesian-product permutations are often mathematically valid but visually
 * noisy, so callers can use these components to suppress multi-region state
 * combinations.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Set<string>} bondIds
 * @returns {Array<{ atomIds: Set<string>, bondIds: Set<string> }>}
 */
function _piSystemComponents(molecule, atomIds, bondIds) {
  const adjacency = new Map();
  for (const atomId of atomIds) {
    adjacency.set(atomId, []);
  }
  for (const bondId of bondIds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [aId, bId] = bond.atoms;
    if (!atomIds.has(aId) || !atomIds.has(bId)) {
      continue;
    }
    adjacency.get(aId).push({ atomId: bId, bondId });
    adjacency.get(bId).push({ atomId: aId, bondId });
  }

  const visited = new Set();
  const components = [];

  for (const atomId of atomIds) {
    if (visited.has(atomId)) {
      continue;
    }
    const componentAtomIds = new Set();
    const componentBondIds = new Set();
    const stack = [atomId];
    visited.add(atomId);

    while (stack.length > 0) {
      const currentId = stack.pop();
      componentAtomIds.add(currentId);
      for (const edge of adjacency.get(currentId) ?? []) {
        componentBondIds.add(edge.bondId);
        if (!visited.has(edge.atomId)) {
          visited.add(edge.atomId);
          stack.push(edge.atomId);
        }
      }
    }

    components.push({ atomIds: componentAtomIds, bondIds: componentBondIds });
  }

  return components;
}

// ---------------------------------------------------------------------------
// Step 2 — Bond classification
// ---------------------------------------------------------------------------

/**
 * Classifies each pi-system bond into fixed and candidate contributions.
 *
 * Triple bonds contribute one fixed pi bond (always present). They also
 * participate as a matching candidate only when conjugated — i.e. when at
 * least one of their endpoint atoms is also adjacent to another pi-system bond
 * (making electron delocalization meaningful). An isolated C≡C with no
 * adjacent pi system is treated as fixed-only; demoting it to a double bond
 * would produce a carbene with no resonance pathway for the displaced electrons.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} bondIds
 * @returns {{ fixedBondIds: Set<string>, candidateBondIds: Set<string> }}
 */
function _classifyBonds(molecule, bondIds) {
  const fixedBondIds = new Set();
  const candidateBondIds = new Set();
  for (const bondId of bondIds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const order = bond.properties.localizedOrder ?? bond.properties.order ?? 1;
    if (order >= 3) {
      fixedBondIds.add(bondId);
      // Only add as candidate if conjugated (endpoint has another pi bond)
      const isConjugated = bond.atoms.some(atomId => {
        const atom = molecule.atoms.get(atomId);
        if (!atom) {
          return false;
        }
        for (const othBondId of atom.bonds) {
          if (othBondId !== bondId && bondIds.has(othBondId)) {
            return true;
          }
        }
        return false;
      });
      if (isConjugated) {
        candidateBondIds.add(bondId);
      }
    } else {
      candidateBondIds.add(bondId);
    }
  }
  return { fixedBondIds, candidateBondIds };
}

// ---------------------------------------------------------------------------
// Step 3 — Enumerate all valid matchings
// ---------------------------------------------------------------------------

/**
 * Returns plausible formal charges for an atom at a proposed total bond order.
 *
 * This mirrors the common-valence families from validation logic instead of
 * force-filling octets. That keeps electron-deficient contributors such as
 * `C+=O-` reachable, which the earlier octet-fill heuristic incorrectly
 * rejected by assigning the carbon a negative charge.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {number} bondSum
 * @param {number} maxCharge
 * @returns {number[]}
 */
/**
 * Derives formal charges for all pi-system atoms given a bond-order assignment.
 *
 * Instead of inferring lone pairs by padding every atom to an octet, this
 * chooses a charge assignment whose bond-order sums fit each element's common
 * charge-shifted valence family while conserving the canonical total charge.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Map<string, number>} bondOrders - bondId → resolved integer order
 * @param {number} maxCharge
 * @returns {Map<string, number>|null} atomId → formal charge
 */
function _deriveFormalCharges(molecule, atomIds, bondOrders, maxCharge) {
  const atomEntries = [];
  const fixedCharges = new Map();
  let canonicalTotalCharge = 0;
  let fixedChargeTotal = 0;

  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }

    let bondSum = 0;
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      bondSum += bondOrders.has(bondId) ? bondOrders.get(bondId) : (bond.properties.localizedOrder ?? bond.properties.order ?? 1);
    }

    if (atom.properties.aromatic) {
      const fixedCharge = _legacyFormalCharge(atom, bondSum);
      fixedCharges.set(atomId, fixedCharge);
      fixedChargeTotal += fixedCharge;
      canonicalTotalCharge += atom.properties.charge ?? 0;
      continue;
    }

    const candidates = _candidateFormalCharges(atom, bondSum, maxCharge);
    if (candidates.length === 0) {
      return null;
    }

    atomEntries.push({
      atomId,
      atom,
      candidates: [...candidates].sort((a, b) => _formalChargeAssignmentCost(atom, a) - _formalChargeAssignmentCost(atom, b) || Math.abs(a) - Math.abs(b))
    });
    canonicalTotalCharge += atom.properties.charge ?? 0;
  }

  atomEntries.sort((a, b) => a.candidates.length - b.candidates.length);

  const best = { cost: Infinity, charges: null };
  const current = new Map();
  const targetChargeTotal = canonicalTotalCharge - fixedChargeTotal;

  function backtrack(index, runningTotal, runningCost) {
    if (runningCost >= best.cost) {
      return;
    }
    if (index === atomEntries.length) {
      if (runningTotal !== targetChargeTotal) {
        return;
      }
      best.cost = runningCost;
      best.charges = new Map([...fixedCharges, ...current]);
      return;
    }

    let minRemaining = 0;
    let maxRemaining = 0;
    for (let i = index; i < atomEntries.length; i++) {
      minRemaining += Math.min(...atomEntries[i].candidates);
      maxRemaining += Math.max(...atomEntries[i].candidates);
    }
    if (runningTotal + minRemaining > targetChargeTotal || runningTotal + maxRemaining < targetChargeTotal) {
      return;
    }

    const entry = atomEntries[index];
    for (const charge of entry.candidates) {
      current.set(entry.atomId, charge);
      backtrack(index + 1, runningTotal + charge, runningCost + _formalChargeAssignmentCost(entry.atom, charge));
      current.delete(entry.atomId);
    }
  }

  backtrack(0, 0, 0);
  if (best.charges) {
    return best.charges;
  }
  return fixedCharges.size > 0 && atomEntries.length === 0 ? fixedCharges : null;
}

/**
 * Validates that no atom in the pi system exceeds its maximum valence or
 * acquires a formal charge magnitude greater than `maxCharge` after a
 * proposed bond-order assignment.
 *
 * For atoms that were originally aromatic, also checks that the assignment
 * produces a valid Kekulé form in the aromatic subgraph. Carbon- and
 * pyridine-like atoms must participate in exactly one aromatic pi bond,
 * while pyrrole-/furan-like heteroatoms that donate a lone pair must
 * participate in none. This avoids partial matchings while still allowing
 * fused heteroaromatics such as indoles.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Map<string, number>} bondOrders
 * @param {Map<string, number>} formalCharges
 * @param {number} maxCharge
 * @returns {boolean}
 */
function _isValidState(molecule, atomIds, bondOrders, formalCharges, maxCharge) {
  const aromaticRings = molecule.getRings().filter(ring => ring.every(atomId => molecule.atoms.get(atomId)?.properties?.aromatic));
  const aromaticRingMembershipCounts = new Map();
  for (const ring of aromaticRings) {
    for (const atomId of ring) {
      aromaticRingMembershipCounts.set(atomId, (aromaticRingMembershipCounts.get(atomId) ?? 0) + 1);
    }
  }

  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }

    let bondSum = 0;
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      bondSum += bondOrders.has(bondId) ? bondOrders.get(bondId) : (bond.properties.localizedOrder ?? bond.properties.order ?? 1);
    }

    const formalCharge = formalCharges.get(atomId) ?? 0;
    const allowedValences = _shiftedCommonValences(atom.name, atom, formalCharge);
    if (allowedValences.length > 0 && !allowedValences.includes(bondSum)) {
      return false;
    }

    // For originally aromatic atoms, validate the localized aromatic matching
    // directly. Some aromatic heteroatoms ([nH], o, s, ...) contribute a lone
    // pair instead of an in-ring pi bond, so bond-sum heuristics are too
    // strict; count matched aromatic pi bonds instead.
    if (atom.properties.aromatic) {
      let matchedAromaticPiBonds = 0;

      for (const aromaticBondId of atom.bonds) {
        const aromaticBond = molecule.bonds.get(aromaticBondId);
        if (!aromaticBond || !aromaticBond.properties.aromatic) {
          continue;
        }

        const localizedOrder = bondOrders.has(aromaticBondId) ? bondOrders.get(aromaticBondId) : (aromaticBond.properties.localizedOrder ?? aromaticBond.properties.order ?? 1);

        if (localizedOrder >= 2) {
          matchedAromaticPiBonds++;
        }
      }

      const formalCharge = formalCharges.get(atomId) ?? 0;
      const hasExocyclicDonorPiBond = atom.name === 'C' && formalCharge === 0 && _hasExocyclicPositiveDonorPiBond(atom, null, molecule, bondOrders, formalCharges);
      const expectedMatchedAromaticPiBonds = hasExocyclicDonorPiBond ? 0 : _expectedAromaticPiBondCount(atom, molecule, formalCharge);
      if (expectedMatchedAromaticPiBonds !== null && matchedAromaticPiBonds !== expectedMatchedAromaticPiBonds) {
        return false;
      }
    }

    const fc = formalCharges.get(atomId) ?? 0;
    if (Math.abs(fc) > maxCharge) {
      return false;
    }
  }

  for (const ring of aromaticRings) {
    const ringAtomSet = new Set(ring);
    let piTotal = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    const positiveAtoms = [];

    for (const atomId of ring) {
      const atom = molecule.atoms.get(atomId);
      if (!atom) {
        return false;
      }
      const formalCharge = formalCharges.get(atomId) ?? 0;
      if (formalCharge > 0) {
        positiveCount++;
        positiveAtoms.push(atom);
      } else if (formalCharge < 0) {
        negativeCount++;
      }
      const pi = _localizedRingPiElectrons(atom, ringAtomSet, molecule, bondOrders, formalCharge, formalCharges);
      if (pi === null) {
        return false;
      }
      piTotal += pi;
    }

    const hasNeutralRingCharges = positiveCount === 0 && negativeCount === 0;
    const hasInternalChargeSeparatedPair = positiveCount === 1 && negativeCount === 1;
    const hasExocyclicDonorPair = positiveCount === 0 && negativeCount === 1 && _hasSupportedExocyclicAromaticDonorPair(molecule, ring, bondOrders, formalCharges);

    if (!(hasNeutralRingCharges || hasInternalChargeSeparatedPair || hasExocyclicDonorPair)) {
      return false;
    }

    if (hasInternalChargeSeparatedPair) {
      const supportsChargeSeparatedAromaticState = positiveAtoms.every(
        atom =>
          atom.name === 'O' ||
          atom.name === 'S' ||
          atom.name === 'Se' ||
          atom.name === 'Te' ||
          (atom.name === 'N' && atom.getHydrogenNeighbors(molecule).length > 0 && ring.length === 5 && ring.every(atomId => (aromaticRingMembershipCounts.get(atomId) ?? 0) === 1))
      );
      if (!supportsChargeSeparatedAromaticState) {
        return false;
      }
    }

    if (!_isHuckelCount(piTotal)) {
      return false;
    }
  }

  return true;
}

/**
 * Serialises a bond-order assignment + atom charge/radical map to a
 * deduplication string key.
 *
 * @param {Map<string, number>} bondOrders
 * @param {Map<string, number>} atomCharges
 * @param {Map<string, number>} atomRadicals
 * @returns {string}
 */
function _stateKey(bondOrders, atomCharges, atomRadicals) {
  const bParts = [...bondOrders.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, o]) => `${id}:${o}`);
  const aParts = [...atomCharges.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, c]) => `${id}:${c}`);
  const rParts = [...atomRadicals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, r]) => `${id}:${r}`);
  return `${bParts.join('|')}/${aParts.join('|')}/${rParts.join('|')}`;
}

/**
 * Returns how many candidate pi bonds an atom may participate in at once.
 *
 * Most second-row atoms top out at one movable pi bond, which reproduces the
 * usual matching constraint used for carbonyls and aromatic carbons. Expanded-
 * octet centers such as sulfur or phosphorus can legitimately host more than
 * one movable pi bond, so their limit is derived from the largest common
 * charge-shifted valence family available within `maxCharge`.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} fixedBondIds
 * @param {number} maxCharge
 * @returns {number}
 */
function _maxCandidatePiBondCount(atom, molecule, fixedBondIds, maxCharge) {
  let baselineBondOrder = 0;
  let canonicalBondOrder = 0;
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    baselineBondOrder += 1 + (fixedBondIds.has(bondId) ? 1 : 0);
    canonicalBondOrder += bond.properties.localizedOrder ?? bond.properties.order ?? 1;
  }

  let maxAllowedValence = Math.max(baselineBondOrder, canonicalBondOrder);
  for (let charge = -maxCharge; charge <= maxCharge; charge++) {
    const allowedValences = _shiftedCommonValences(atom.name, atom, charge);
    for (const valence of allowedValences) {
      if (valence > maxAllowedValence) {
        maxAllowedValence = valence;
      }
    }
  }

  return Math.max(0, maxAllowedValence - baselineBondOrder);
}

/**
 * Enumerates all valid bond-order assignments for the pi-system candidate bonds
 * via backtracking, collecting up to `maxContributors` states.
 *
 * Each candidate bond is either "matched" (order 2) or "unmatched" (order 1),
 * plus any fixed pi bond contribution for triples. Most atoms can take part in
 * only one matched candidate bond at a time, but expanded-octet centers such as
 * sulfate sulfur may host multiple matched bonds simultaneously. After
 * assigning all bonds, formal charges are derived and validity is checked.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {string[]} candidates - Ordered array of candidate bond IDs
 * @param {Set<string>} fixedBondIds
 * @param {number} maxContributors
 * @param {number} maxCharge
 * @returns {Array<{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number> }>}
 */
function _enumerateMatchings(molecule, atomIds, candidates, fixedBondIds, maxContributors, maxCharge) {
  const results = [];
  const seen = new Set();

  // Current assignment: candidateIdx → true (double) | false (single)
  const assignment = new Array(candidates.length).fill(false);

  const atomPiBondLimits = new Map();
  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    atomPiBondLimits.set(atomId, _maxCandidatePiBondCount(atom, molecule, fixedBondIds, maxCharge));
  }

  // Forward-checking support: for aromatic atoms that must have exactly one
  // localized pi bond, detect dead branches as soon as their last candidate bond
  // is processed rather than waiting until the leaf.
  //
  // Safe condition: only applies when the ENTIRE pi system is pure carbon.
  // In pure-hydrocarbon aromatic systems (e.g. coronene, pyrene) the Hückel
  // check in _isValidState rules out C+ / C– states, so every aromatic carbon
  // with limit > 0 strictly needs ≥ 1 pi bond.  For mixed systems containing
  // even one heteroatom, charge-separated contributors can leave ring carbons
  // with 0 pi bonds legitimately (e.g. indole zwitterion), so we skip the
  // check to avoid false-positive pruning.
  const allPiAtomsAreCarbon = [...atomIds].every(id => molecule.atoms.get(id)?.name === 'C');

  const atomPiBondNeeds = new Map();
  for (const [atomId, limit] of atomPiBondLimits) {
    let needs = 0;
    if (allPiAtomsAreCarbon && limit > 0 && molecule.atoms.get(atomId)?.properties?.aromatic) {
      needs = 1;
    }
    atomPiBondNeeds.set(atomId, needs);
  }

  // For each atom, the index of its last candidate bond in `candidates`.
  const lastCandidateIdxForAtom = new Map();
  for (let i = 0; i < candidates.length; i++) {
    const bond = molecule.bonds.get(candidates[i]);
    for (const atomId of bond.atoms) {
      if (atomIds.has(atomId)) {
        lastCandidateIdxForAtom.set(atomId, i);
      }
    }
  }
  // Group atoms (with needs > 0) by the index of their last candidate bond.
  const atomsCompletingAt = new Array(candidates.length).fill(null).map(() => []);
  for (const [atomId, lastIdx] of lastCandidateIdxForAtom) {
    if ((atomPiBondNeeds.get(atomId) ?? 0) > 0) {
      atomsCompletingAt[lastIdx].push(atomId);
    }
  }

  function buildBondOrders() {
    const bo2 = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const bondId = candidates[i];
      const isTriple = fixedBondIds.has(bondId);
      // sigma (1) + fixed pi (1 if triple) + candidate pi (1 if matched)
      bo2.set(bondId, 1 + (isTriple ? 1 : 0) + (assignment[i] ? 1 : 0));
    }
    return bo2;
  }

  function backtrack(idx, matchedBondCounts) {
    if (results.length >= maxContributors) {
      return;
    }

    // Forward-check: as soon as an atom's last candidate bond is processed,
    // verify it has already accumulated its minimum required pi bonds. If not,
    // this entire subtree will always fail _isValidState — prune it now.
    // `idx` is the next bond to process, so atoms completing at idx-1 are done.
    if (idx > 0) {
      for (const atomId of atomsCompletingAt[idx - 1]) {
        if ((matchedBondCounts.get(atomId) ?? 0) < (atomPiBondNeeds.get(atomId) ?? 0)) {
          return;
        }
      }
    }

    if (idx === candidates.length) {
      const bondOrders = buildBondOrders();
      const atomCharges = _deriveFormalCharges(molecule, atomIds, bondOrders, maxCharge);
      if (!atomCharges) {
        return;
      }
      const atomRadicals = new Map();
      for (const atomId of atomIds) {
        atomRadicals.set(atomId, molecule.atoms.get(atomId)?.properties.radical ?? 0);
      }
      if (!checkChargeConservation(atomCharges)) {
        return;
      }
      if (!_isValidState(molecule, atomIds, bondOrders, atomCharges, maxCharge)) {
        return;
      }
      const key = _stateKey(bondOrders, atomCharges, atomRadicals);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      results.push({ bondOrders, atomCharges, atomRadicals });
      return;
    }

    const bondId = candidates[idx];
    const bond = molecule.bonds.get(bondId);
    const [aId, bId] = bond.atoms;

    // Try unmatched (single/order-1 candidate)
    assignment[idx] = false;
    backtrack(idx + 1, matchedBondCounts);

    // Try matched (double/order-2 candidate) if both endpoints still have
    // room for another movable pi bond under their common valence families.
    if ((matchedBondCounts.get(aId) ?? 0) < (atomPiBondLimits.get(aId) ?? 0) && (matchedBondCounts.get(bId) ?? 0) < (atomPiBondLimits.get(bId) ?? 0)) {
      assignment[idx] = true;
      matchedBondCounts.set(aId, (matchedBondCounts.get(aId) ?? 0) + 1);
      matchedBondCounts.set(bId, (matchedBondCounts.get(bId) ?? 0) + 1);
      backtrack(idx + 1, matchedBondCounts);
      matchedBondCounts.set(aId, (matchedBondCounts.get(aId) ?? 1) - 1);
      matchedBondCounts.set(bId, (matchedBondCounts.get(bId) ?? 1) - 1);
      assignment[idx] = false;
    }
  }

  // Canonical total formal charge of pi-system atoms — must be preserved in every state.
  let canonicalTotalCharge = 0;
  for (const atomId of atomIds) {
    canonicalTotalCharge += molecule.atoms.get(atomId)?.properties.charge ?? 0;
  }

  function checkChargeConservation(atomCharges) {
    let total = 0;
    for (const fc of atomCharges.values()) {
      total += fc;
    }
    return total === canonicalTotalCharge;
  }

  backtrack(0, new Map());
  return results;
}

/**
 * Generates radical-migration states by moving unpaired electrons along
 * conjugated paths within the pi system.
 *
 * For each radical atom R adjacent to a pi-system bond to atom A:
 * - If R−A is single and A=B is double: radical hops to B (R=A−B•)
 * - If R−A is single and A is terminal in pi system: radical migrates to A (R−•A)
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Set<string>} bondIds
 * @param {Array<{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number> }>} baseStates
 * @param {number} maxContributors
 * @param {Set<string>} seen
 * @returns {Array<{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number> }>}
 */
function _enumerateRadicalStates(molecule, atomIds, bondIds, baseStates, maxContributors, seen) {
  const results = [];

  for (const base of baseStates) {
    if (results.length + baseStates.length >= maxContributors) {
      break;
    }

    for (const atomId of atomIds) {
      const atom = molecule.atoms.get(atomId);
      if (!atom || (atom.properties.radical ?? 0) === 0) {
        continue;
      }

      // Try migrating one radical electron to each pi-adjacent atom
      for (const bondId of atom.bonds) {
        const bond = molecule.bonds.get(bondId);
        if (!bond || !bondIds.has(bondId)) {
          continue;
        }
        const otherId = bond.getOtherAtom(atomId);
        if (!atomIds.has(otherId)) {
          continue;
        }
        const otherAtom = molecule.atoms.get(otherId);
        if (!otherAtom) {
          continue;
        }

        // Radical hops: R• − A → R − A•
        const newRadicals = new Map(base.atomRadicals);
        const srcRadical = newRadicals.get(atomId) ?? atom.properties.radical ?? 0;
        const dstRadical = newRadicals.get(otherId) ?? otherAtom.properties.radical ?? 0;
        if (srcRadical < 1 || dstRadical >= 2) {
          continue;
        }

        newRadicals.set(atomId, srcRadical - 1);
        newRadicals.set(otherId, dstRadical + 1);

        const key = _stateKey(base.bondOrders, base.atomCharges, newRadicals);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push({ bondOrders: new Map(base.bondOrders), atomCharges: new Map(base.atomCharges), atomRadicals: newRadicals });

        if (results.length + baseStates.length >= maxContributors) {
          break;
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Step 4 — Score and sort
// ---------------------------------------------------------------------------

/**
 * Computes a stability weight for a resonance state.
 *
 * Higher weight = more stable (shown first). Based on Pauling's minimum
 * formal charge principle:
 * - Base: 100
 * - −20 per formal charge on any atom
 * - −10 extra per charge on carbon specifically
 * - −5 per charge-separated pair (+ on one atom, − on non-adjacent atom)
 * - +5 if all pi-system atoms satisfy the octet rule
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Map<string, number>} atomCharges
 * @param {Map<string, number>} bondOrders
 * @returns {number}
 */
function _scoreState(molecule, atomIds, atomCharges, bondOrders) {
  let weight = 100;

  const chargedAtomIds = [];
  for (const atomId of atomIds) {
    const charge = atomCharges.get(atomId) ?? 0;
    if (charge !== 0) {
      weight -= 20;
      const atom = molecule.atoms.get(atomId);
      if (atom?.name === 'C') {
        weight -= 10;
      }
      chargedAtomIds.push(atomId);
    }
  }

  // Penalise charge-separated pairs on non-adjacent atoms
  const bondedPairs = new Set();
  for (const [bondId] of molecule.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [a, b] = bond.atoms;
    bondedPairs.add(`${a}\0${b}`);
    bondedPairs.add(`${b}\0${a}`);
  }
  for (let i = 0; i < chargedAtomIds.length; i++) {
    for (let j = i + 1; j < chargedAtomIds.length; j++) {
      const ci = atomCharges.get(chargedAtomIds[i]) ?? 0;
      const cj = atomCharges.get(chargedAtomIds[j]) ?? 0;
      if (ci * cj < 0 && !bondedPairs.has(`${chargedAtomIds[i]}\0${chargedAtomIds[j]}`)) {
        weight -= 5;
      }
    }
  }

  // Bonus if all pi-system atoms satisfy the octet
  let allOctets = true;
  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      continue;
    }
    let bondSum = 0;
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      bondSum += bondOrders.has(bondId) ? bondOrders.get(bondId) : (bond.properties.localizedOrder ?? bond.properties.order ?? 1);
    }
    const group = atom.properties.group;
    if (!group) {
      continue;
    }
    const valenceElectrons = group <= 2 ? group : group - 10;
    const lonePairs = Math.max(0, Math.min(8 - bondSum, valenceElectrons - bondSum));
    const totalElectrons = bondSum + lonePairs;
    if (totalElectrons !== 8 && atom.name !== 'H' && atom.name !== 'B') {
      allOctets = false;
      break;
    }
  }
  if (allOctets) {
    weight += 5;
  }

  return weight;
}

/**
 * Computes a visual transition cost between two resonance states.
 *
 * Lower cost means fewer bond-order, charge, or radical changes would be seen
 * when cycling between the two states.
 *
 * @param {{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number> }} fromState
 * @param {{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number> }} toState
 * @param {Set<string>} atomIds
 * @param {Set<string>} bondIds
 * @returns {number}
 */
function _stateTransitionCost(fromState, toState, atomIds, bondIds) {
  let cost = 0;

  for (const bondId of bondIds) {
    const fromOrder = fromState.bondOrders.get(bondId) ?? 1;
    const toOrder = toState.bondOrders.get(bondId) ?? fromOrder;
    if (fromOrder !== toOrder) {
      cost += 2;
    }
  }

  for (const atomId of atomIds) {
    const fromCharge = fromState.atomCharges.get(atomId) ?? 0;
    const toCharge = toState.atomCharges.get(atomId) ?? fromCharge;
    if (fromCharge !== toCharge) {
      cost += 1;
    }

    const fromRadical = fromState.atomRadicals.get(atomId) ?? 0;
    const toRadical = toState.atomRadicals.get(atomId) ?? fromRadical;
    if (fromRadical !== toRadical) {
      cost += 1;
    }
  }

  return cost;
}

/**
 * Returns whether a candidate state's atom charges exactly match the live
 * canonical charge assignment on every pi-system atom.
 *
 * When false, the state introduces charge separation or relocates formal
 * charge relative to the canonical structure.
 *
 * @param {{ atomCharges: Map<string, number> }} state
 * @param {Map<string, number>} canonicalAtomCharges
 * @param {Set<string>} atomIds
 * @returns {boolean}
 */
function _matchesCanonicalAtomCharges(state, canonicalAtomCharges, atomIds) {
  for (const atomId of atomIds) {
    if ((state.atomCharges.get(atomId) ?? 0) !== (canonicalAtomCharges.get(atomId) ?? 0)) {
      return false;
    }
  }
  return true;
}

/**
 * Counts how many disconnected pi-system components differ from the canonical
 * live structure in the given state.
 *
 * @param {{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number> }} state
 * @param {Map<string, number>} canonicalBondOrders
 * @param {Map<string, number>} canonicalAtomCharges
 * @param {Map<string, number>} canonicalAtomRadicals
 * @param {Array<{ atomIds: Set<string>, bondIds: Set<string> }>} components
 * @returns {number}
 */
function _changedComponentCount(state, canonicalBondOrders, canonicalAtomCharges, canonicalAtomRadicals, components) {
  let changedCount = 0;

  for (const component of components) {
    let componentChanged = false;

    for (const bondId of component.bondIds) {
      if ((state.bondOrders.get(bondId) ?? canonicalBondOrders.get(bondId) ?? 1) !== (canonicalBondOrders.get(bondId) ?? 1)) {
        componentChanged = true;
        break;
      }
    }

    if (!componentChanged) {
      for (const atomId of component.atomIds) {
        if ((state.atomCharges.get(atomId) ?? canonicalAtomCharges.get(atomId) ?? 0) !== (canonicalAtomCharges.get(atomId) ?? 0)) {
          componentChanged = true;
          break;
        }
        if ((state.atomRadicals.get(atomId) ?? canonicalAtomRadicals.get(atomId) ?? 0) !== (canonicalAtomRadicals.get(atomId) ?? 0)) {
          componentChanged = true;
          break;
        }
      }
    }

    if (componentChanged) {
      changedCount++;
    }
  }

  return changedCount;
}

/**
 * Orders alternate resonance states so cycling between neighbors tends to show
 * the smallest visible change at each step, while keeping more stable states
 * earlier when multiple candidates are equally close.
 *
 * @param {{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number>, weight: number }} canonicalState
 * @param {Array<{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number>, weight: number }>} alternateStates
 * @param {Set<string>} atomIds
 * @param {Set<string>} bondIds
 * @returns {Array<{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number>, weight: number }>}
 */
function _orderAlternateStatesForCycling(canonicalState, alternateStates, atomIds, bondIds) {
  const remaining = [...alternateStates];
  const ordered = [];
  let current = canonicalState;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestCost = Infinity;
    let bestWeight = -Infinity;
    let bestKey = '';

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const cost = _stateTransitionCost(current, candidate, atomIds, bondIds);
      const weight = candidate.weight ?? 0;
      const key = _stateKey(candidate.bondOrders, candidate.atomCharges, candidate.atomRadicals);

      if (cost < bestCost || (cost === bestCost && weight > bestWeight) || (cost === bestCost && weight === bestWeight && key < bestKey)) {
        bestIndex = i;
        bestCost = cost;
        bestWeight = weight;
        bestKey = key;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

/**
 * Serialises a state after filling in any omitted bond-order, charge, or
 * radical entries from the canonical live structure.
 *
 * This prevents sparse internal state maps from being treated as distinct
 * contributors when they render identically to the canonical form.
 *
 * @param {{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number> }} state
 * @param {Map<string, number>} canonicalBondOrders
 * @param {Map<string, number>} canonicalAtomCharges
 * @param {Map<string, number>} canonicalAtomRadicals
 * @param {Set<string>} atomIds
 * @param {Set<string>} bondIds
 * @returns {string}
 */
function _resolvedStateKey(state, canonicalBondOrders, canonicalAtomCharges, canonicalAtomRadicals, atomIds, bondIds) {
  const resolvedBondOrders = new Map();
  for (const bondId of bondIds) {
    resolvedBondOrders.set(bondId, state.bondOrders.get(bondId) ?? canonicalBondOrders.get(bondId) ?? 1);
  }

  const resolvedAtomCharges = new Map();
  const resolvedAtomRadicals = new Map();
  for (const atomId of atomIds) {
    resolvedAtomCharges.set(atomId, state.atomCharges.get(atomId) ?? canonicalAtomCharges.get(atomId) ?? 0);
    resolvedAtomRadicals.set(atomId, state.atomRadicals.get(atomId) ?? canonicalAtomRadicals.get(atomId) ?? 0);
  }

  return _stateKey(resolvedBondOrders, resolvedAtomCharges, resolvedAtomRadicals);
}

/**
 * Computes the total absolute formal charge magnitude across the tracked atoms
 * in a state.
 *
 * This is used as a lightweight proxy for how much charge separation a state
 * introduces. When collapsing permutation-heavy contributors, we keep neutral
 * states plus at most a single localized charge-separated pair.
 *
 * @param {{ atomCharges: Map<string, number> }} state
 * @param {Set<string>} atomIds
 * @returns {number}
 */
function _totalAbsoluteChargeMagnitude(state, atomIds) {
  let total = 0;
  for (const atomId of atomIds) {
    total += Math.abs(state.atomCharges.get(atomId) ?? 0);
  }
  return total;
}

/**
 * Returns whether a state stays within the "single localized charge shift"
 * window relative to the canonical structure.
 *
 * Neutral canonical structures may introduce one localized charge-separated
 * pair (total absolute charge 2). Already-charged canonical structures may
 * rearrange their existing charges, but do not gain extra total charge
 * separation when permutation-collapsing is enabled.
 *
 * @param {{ atomCharges: Map<string, number> }} state
 * @param {Set<string>} atomIds
 * @param {number} canonicalAbsoluteChargeMagnitude
 * @returns {boolean}
 */
function _isSingleChargeShiftState(state, atomIds, canonicalAbsoluteChargeMagnitude) {
  const totalAbsoluteChargeMagnitude = _totalAbsoluteChargeMagnitude(state, atomIds);
  const maxAllowedAbsoluteChargeMagnitude = canonicalAbsoluteChargeMagnitude === 0 ? 2 : canonicalAbsoluteChargeMagnitude;
  return totalAbsoluteChargeMagnitude <= maxAllowedAbsoluteChargeMagnitude;
}

/**
 * Returns the internal search budget used while enumerating raw contributors.
 *
 * The public `maxContributors` limit is applied only after charge/permutation
 * filtering and scoring. Searching more broadly than the final display cap
 * prevents chemically useful local contributors from being dropped simply
 * because noisy states were discovered earlier during backtracking.
 *
 * @param {number} maxContributors
 * @returns {number}
 */
function _enumerationBudget(maxContributors) {
  return Math.max(maxContributors * 8, 64);
}

// ---------------------------------------------------------------------------
// Step 5 — Write to model
// ---------------------------------------------------------------------------

/**
 * Snapshots the current live bond/atom properties as state 1 and writes all
 * enumerated states into `bond.properties.resonance` and
 * `atom.properties.resonance`, then sets `molecule.properties.resonance`.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Set<string>} bondIds
 * @param {Array<{ bondOrders: Map<string, number>, atomCharges: Map<string, number>, atomRadicals: Map<string, number>, weight: number }>} states
 */
function _writeToModel(molecule, atomIds, bondIds, states) {
  // Capture state 1 snapshot from live properties
  const state1BondOrders = new Map();
  for (const bondId of bondIds) {
    const bond = molecule.bonds.get(bondId);
    if (bond) {
      state1BondOrders.set(bondId, bond.properties.localizedOrder ?? bond.properties.order ?? 1);
    }
  }
  const state1AtomCharges = new Map();
  const state1AtomRadicals = new Map();
  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (atom) {
      state1AtomCharges.set(atomId, atom.properties.charge ?? 0);
      state1AtomRadicals.set(atomId, atom.properties.radical ?? 0);
    }
  }

  // Build full state list:
  // - index 0 is always the canonical snapshot (live properties before enumeration)
  // - indices 1..n are the enumerated alternates, excluding any that are identical
  //   to the canonical snapshot (to avoid duplicating state 1)
  const canonicalKey = _stateKey(state1BondOrders, state1AtomCharges, new Map([...state1AtomRadicals]));
  const seenResolvedKeys = new Set([canonicalKey]);
  const alternateStates = [];
  for (const state of states) {
    const resolvedKey = _resolvedStateKey(state, state1BondOrders, state1AtomCharges, state1AtomRadicals, atomIds, bondIds);
    if (seenResolvedKeys.has(resolvedKey)) {
      continue;
    }
    seenResolvedKeys.add(resolvedKey);
    alternateStates.push(state);
  }

  const canonicalState = {
    bondOrders: state1BondOrders,
    atomCharges: state1AtomCharges,
    atomRadicals: state1AtomRadicals,
    weight: states[0]?.weight ?? 100
  };
  const orderedAlternates = _orderAlternateStatesForCycling(canonicalState, alternateStates, atomIds, bondIds);
  const allStates = [canonicalState, ...orderedAlternates];

  const weights = allStates.map(s => s.weight);

  // Write bond resonance tables — only for bonds that change across states
  for (const bondId of bondIds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const s1Order = state1BondOrders.get(bondId) ?? 1;
    const s1LocOrder = bond.properties.localizedOrder ?? null;
    const s1Aromatic = bond.properties.aromatic ?? false;
    const s1Stereo = bond.properties.stereo ?? null;

    let differs = false;
    for (let i = 1; i < allStates.length; i++) {
      const stateOrder = allStates[i].bondOrders.get(bondId);
      if (stateOrder !== undefined && stateOrder !== s1Order) {
        differs = true;
        break;
      }
    }
    if (!differs) {
      continue;
    }

    const stateMap = {};
    stateMap[1] = { order: s1Order, localizedOrder: s1LocOrder, aromatic: s1Aromatic, stereo: s1Stereo };
    for (let i = 1; i < allStates.length; i++) {
      const stateOrder = allStates[i].bondOrders.get(bondId) ?? s1Order;
      stateMap[i + 1] = {
        order: stateOrder,
        localizedOrder: stateOrder >= 2 ? stateOrder : null,
        aromatic: false,
        stereo: null
      };
    }
    bond.properties.resonance = { states: stateMap };
  }

  // Write atom resonance tables — only for atoms that change across states
  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const s1Charge = state1AtomCharges.get(atomId) ?? 0;
    const s1Radical = state1AtomRadicals.get(atomId) ?? 0;

    let differs = false;
    for (let i = 1; i < allStates.length; i++) {
      const stateCharge = allStates[i].atomCharges.get(atomId);
      const stateRadical = allStates[i].atomRadicals.get(atomId);
      if ((stateCharge !== undefined && stateCharge !== s1Charge) || (stateRadical !== undefined && stateRadical !== s1Radical)) {
        differs = true;
        break;
      }
    }
    if (!differs) {
      continue;
    }

    const stateMap = {};
    stateMap[1] = { charge: s1Charge, radical: s1Radical };
    for (let i = 1; i < allStates.length; i++) {
      stateMap[i + 1] = {
        charge: allStates[i].atomCharges.get(atomId) ?? s1Charge,
        radical: allStates[i].atomRadicals.get(atomId) ?? s1Radical
      };
    }
    atom.properties.resonance = { states: stateMap };
  }

  molecule.properties.resonance = { count: allStates.length, currentState: 1, weights };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates all resonance structures for a molecule and writes the results
 * directly into the molecular graph.
 *
 * After calling this function:
 * - `molecule.properties.resonance` holds `{ count, currentState, weights }`
 * - Each bond whose order changes across states carries
 *   `bond.properties.resonance.states`
 * - Each atom whose charge or radical changes carries
 *   `atom.properties.resonance.states`
 *
 * Use `molecule.setResonanceState(n)` to switch to a different contributor.
 * Use `molecule.resetResonance()` to restore the canonical form and clear all
 * tables. Any structural edit (`addAtom`, `removeBond`, etc.) automatically
 * clears stale tables.
 *
 * If the molecule has no pi system (e.g. `CCO`), a single-state entry is
 * written with `count: 1` and no bond/atom tables are populated.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {object} [options={}]
 * @param {number} [options.maxContributors=16] - Maximum number of resonance
 *   states to enumerate. Collected in discovery order; no pre-sorting before
 *   the cap is applied.
 * @param {number} [options.maxCharge=1] - Maximum allowed formal charge
 *   magnitude on any atom. States that would produce larger charges are
 *   discarded.
 * @param {boolean} [options.includeChargeSeparatedStates=true] - When false,
 *   only keeps contributors whose per-atom formal charges match the canonical
 *   live structure. This suppresses charge-separated carbonyl-like forms such
 *   as `C=O <-> C-O-`.
 * @param {boolean} [options.includeIndependentComponentPermutations=true] -
 *   When false, drops states that differ from the canonical structure in more
 *   than one disconnected pi-system component at once. This removes Cartesian-
 *   product permutations from unrelated resonance regions while keeping local
 *   alternates within each conjugated component.
 */
export function generateResonanceStructures(molecule, options = {}) {
  const { maxContributors = 16, maxCharge = 1, includeChargeSeparatedStates = true, includeIndependentComponentPermutations = true } = options;
  const enumerationBudget = _enumerationBudget(maxContributors);

  // Recompute from a clean canonical baseline so clones, mode switches, and
  // repeated calls cannot accumulate stale resonance tables.
  if (molecule.properties.resonance) {
    molecule.setResonanceState(1);
  }
  molecule.clearResonanceStates();

  // Ensure aromatic bonds have localizedOrder before snapshotting
  kekulize(molecule);

  const { atomIds, bondIds } = _buildPiSystem(molecule);

  if (bondIds.size === 0) {
    // No pi system — single state, nothing to write
    molecule.properties.resonance = { count: 1, currentState: 1, weights: [100] };
    return;
  }

  const { fixedBondIds, candidateBondIds } = _classifyBonds(molecule, bondIds);
  const candidates = [...candidateBondIds];
  const components = _piSystemComponents(molecule, atomIds, bondIds);
  const canonicalAtomCharges = new Map();
  const canonicalAtomRadicals = new Map();
  const canonicalBondOrders = new Map();
  let canonicalAbsoluteChargeMagnitude = 0;
  for (const bondId of bondIds) {
    const bond = molecule.bonds.get(bondId);
    canonicalBondOrders.set(bondId, bond?.properties.localizedOrder ?? bond?.properties.order ?? 1);
  }
  for (const atomId of atomIds) {
    const canonicalCharge = molecule.atoms.get(atomId)?.properties.charge ?? 0;
    canonicalAtomCharges.set(atomId, canonicalCharge);
    canonicalAbsoluteChargeMagnitude += Math.abs(canonicalCharge);
    canonicalAtomRadicals.set(atomId, molecule.atoms.get(atomId)?.properties.radical ?? 0);
  }

  // Enumerate paired-electron matchings
  const pairedStates = _enumerateMatchings(molecule, atomIds, candidates, fixedBondIds, enumerationBudget, maxCharge);

  // Enumerate radical-migration states on top of paired states
  const seen = new Set(pairedStates.map(s => _stateKey(s.bondOrders, s.atomCharges, s.atomRadicals)));
  const radicalStates = _enumerateRadicalStates(molecule, atomIds, bondIds, pairedStates, enumerationBudget, seen);

  const allRawStates = [...pairedStates, ...radicalStates]
    .filter(state => includeChargeSeparatedStates || _matchesCanonicalAtomCharges(state, canonicalAtomCharges, atomIds))
    .filter(state => includeIndependentComponentPermutations || _changedComponentCount(state, canonicalBondOrders, canonicalAtomCharges, canonicalAtomRadicals, components) <= 1)
    .filter(state => _isSingleChargeShiftState(state, atomIds, canonicalAbsoluteChargeMagnitude))
    .slice(0, maxContributors);

  // Score each state
  const scoredStates = allRawStates.map(s => ({
    ...s,
    weight: _scoreState(molecule, atomIds, s.atomCharges, s.bondOrders)
  }));

  if (scoredStates.length === 0) {
    _writeToModel(molecule, atomIds, bondIds, []);
    return;
  }

  // Sort by weight descending — state 1 (canonical) keeps index 0 regardless
  const canonical = scoredStates[0];
  const rest = scoredStates.slice(1).sort((a, b) => b.weight - a.weight);
  const finalStates = [canonical, ...rest];

  _writeToModel(molecule, atomIds, bondIds, finalStates);
}
