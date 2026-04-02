/** @module algorithms/resonance */

import { kekulize } from '../layout/mol2d-helpers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum valence for common elements used in validation. */
const MAX_VALENCE = {
  H: 1,
  B: 3,
  C: 4,
  N: 4, // can be 5 with formal charge
  O: 3, // can be 3 with formal charge
  F: 1,
  Si: 4,
  P: 5,
  S: 6,
  Cl: 1,
  As: 5,
  Se: 6,
  Br: 1,
  Te: 6,
  I: 1
};

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
 * Derives formal charges for all pi-system atoms given a bond-order assignment.
 *
 * Each atom fills its remaining valence shell with lone pairs, then the formal
 * charge is derived from the Lewis formula:
 *   FC = valenceElectrons − lonePairElectrons − bondOrderSum
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Map<string, number>} bondOrders - bondId → resolved integer order
 * @returns {Map<string, number>} atomId → formal charge
 */
function _deriveFormalCharges(molecule, atomIds, bondOrders) {
  const charges = new Map();
  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const group = atom.properties.group;
    if (!group) {
      charges.set(atomId, atom.properties.charge ?? 0);
      continue;
    }
    // s-block (groups 1-2): valence electrons = group; p-block (13-17): group − 10
    const valenceElectrons = group <= 2 ? group : group - 10;

    // Sum bond orders for this atom using the candidate assignment
    let bondSum = 0;
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      bondSum += bondOrders.has(bondId)
        ? bondOrders.get(bondId)
        : (bond.properties.localizedOrder ?? bond.properties.order ?? 1);
    }

    // Fill lone pairs to complete the octet (max 8 electrons total, or 2 for H)
    // Each bond order unit consumes 2 electrons from the octet (one from each end),
    // so lone-pair electrons = octet − 2 × bondOrderSum. FC = V − LP − BO.
    const maxElectrons = atom.name === 'H' ? 2 : 8;
    const lonePairElectrons = Math.max(0, maxElectrons - 2 * bondSum);
    const fc = valenceElectrons - lonePairElectrons - bondSum;
    charges.set(atomId, fc);
  }
  return charges;
}

/**
 * Validates that no atom in the pi system exceeds its maximum valence or
 * acquires a formal charge magnitude greater than `maxCharge` after a
 * proposed bond-order assignment.
 *
 * For atoms that were originally aromatic, also checks that the assignment
 * produces a valid Kekulé form: the atom's total bond order must match its
 * expected neutral valence (i.e. every aromatic atom must end up in exactly
 * one pi bond — partial matchings that leave aromatic atoms with unfilled
 * valence are rejected).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Set<string>} atomIds
 * @param {Map<string, number>} bondOrders
 * @param {Map<string, number>} formalCharges
 * @param {number} maxCharge
 * @returns {boolean}
 */
function _isValidState(molecule, atomIds, bondOrders, formalCharges, maxCharge) {
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
      bondSum += bondOrders.has(bondId)
        ? bondOrders.get(bondId)
        : (bond.properties.localizedOrder ?? bond.properties.order ?? 1);
    }

    const maxVal = MAX_VALENCE[atom.name];
    if (maxVal !== undefined && bondSum > maxVal) {
      return false;
    }

    // For originally aromatic atoms, reject partial matchings that leave the
    // atom with fewer bonds than its neutral valence — this filters out
    // non-Kekulé partial matchings like a single isolated double bond in a ring.
    if (atom.properties.aromatic) {
      const group = atom.properties.group;
      if (group) {
        const neutralValence = group <= 2 ? group : group - 10;
        // neutralBondSum: total bonds needed to fill valence without lone pairs
        // (i.e. atom should be fully bonded in a valid Kekulé form)
        if (bondSum < neutralValence - (atom.properties.charge ?? 0)) {
          return false;
        }
      }
    }

    const fc = formalCharges.get(atomId) ?? 0;
    if (Math.abs(fc) > maxCharge) {
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
  const bParts = [...bondOrders.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([id, o]) => `${id}:${o}`);
  const aParts = [...atomCharges.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([id, c]) => `${id}:${c}`);
  const rParts = [...atomRadicals.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([id, r]) => `${id}:${r}`);
  return `${bParts.join('|')}/${aParts.join('|')}/${rParts.join('|')}`;
}

/**
 * Enumerates all valid bond-order assignments for the pi-system candidate bonds
 * via backtracking, collecting up to `maxContributors` states.
 *
 * Each candidate bond is either "matched" (order 2) or "unmatched" (order 1),
 * plus any fixed pi bond contribution for triples. After assigning all bonds,
 * formal charges are derived and validity is checked.
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

  // Precompute baseline bond order for non-candidate bonds (stays constant)
  // Track which atoms have been matched (have a double bond) to enforce
  // that each atom can participate in at most one double bond from the
  // candidate set (standard matching constraint).

  function buildBondOrders() {
    const bo = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const bondId = candidates[i];
      const base = fixedBondIds.has(bondId) ? 1 : 0; // fixed adds +1 always
      bo.set(bondId, base + (assignment[i] ? 1 : 0) + (fixedBondIds.has(bondId) ? 1 : 0));
    }
    // Correct: triple bonds have fixed 1 + candidate 1 = 2 when matched, 1+1=fixed=2 when not
    // Re-do: for triple bonds, base order is 2 (1 fixed + 1 sigma), candidate adds 1 more → 3
    // For double/aromatic/single: base order is 1 (sigma only), candidate adds 1 → 2
    // Actually, let's recompute cleanly:
    const bo2 = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const bondId = candidates[i];
      const isTriple = fixedBondIds.has(bondId);
      // sigma (1) + fixed pi (1 if triple) + candidate pi (1 if matched)
      bo2.set(bondId, 1 + (isTriple ? 1 : 0) + (assignment[i] ? 1 : 0));
    }
    return bo2;
  }

  function backtrack(idx, matchedAtoms) {
    if (results.length >= maxContributors) {
      return;
    }
    if (idx === candidates.length) {
      const bondOrders = buildBondOrders();
      const atomCharges = _deriveFormalCharges(molecule, atomIds, bondOrders);
      const atomRadicals = new Map();
      for (const atomId of atomIds) {
        atomRadicals.set(atomId, molecule.atoms.get(atomId)?.properties.radical ?? 0);
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
    backtrack(idx + 1, matchedAtoms);

    // Try matched (double/order-2 candidate) — only if neither endpoint is already matched
    if (!matchedAtoms.has(aId) && !matchedAtoms.has(bId)) {
      assignment[idx] = true;
      matchedAtoms.add(aId);
      matchedAtoms.add(bId);
      backtrack(idx + 1, matchedAtoms);
      matchedAtoms.delete(aId);
      matchedAtoms.delete(bId);
      assignment[idx] = false;
    }
  }

  backtrack(0, new Set());
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
        const srcRadical = newRadicals.get(atomId) ?? (atom.properties.radical ?? 0);
        const dstRadical = newRadicals.get(otherId) ?? (otherAtom.properties.radical ?? 0);
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
      bondSum += bondOrders.has(bondId)
        ? bondOrders.get(bondId)
        : (bond.properties.localizedOrder ?? bond.properties.order ?? 1);
    }
    const charge = atomCharges.get(atomId) ?? 0;
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
  const canonicalKey = _stateKey(state1BondOrders, state1AtomCharges,
    new Map([...state1AtomRadicals]));

  const alternateStates = states.filter(s => {
    const key = _stateKey(s.bondOrders, s.atomCharges, s.atomRadicals);
    return key !== canonicalKey;
  });

  const allStates = [
    { bondOrders: state1BondOrders, atomCharges: state1AtomCharges, atomRadicals: state1AtomRadicals, weight: states[0]?.weight ?? 100 },
    ...alternateStates
  ];

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
      if ((stateCharge !== undefined && stateCharge !== s1Charge) ||
          (stateRadical !== undefined && stateRadical !== s1Radical)) {
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
 */
export function generateResonanceStructures(molecule, options = {}) {
  const { maxContributors = 16, maxCharge = 1 } = options;

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

  // Enumerate paired-electron matchings
  const pairedStates = _enumerateMatchings(
    molecule, atomIds, candidates, fixedBondIds, maxContributors, maxCharge
  );

  // Enumerate radical-migration states on top of paired states
  const seen = new Set(pairedStates.map(s => _stateKey(s.bondOrders, s.atomCharges, s.atomRadicals)));
  const radicalStates = _enumerateRadicalStates(
    molecule, atomIds, bondIds, pairedStates, maxContributors, seen
  );

  const allRawStates = [...pairedStates, ...radicalStates].slice(0, maxContributors);

  // Score each state
  const scoredStates = allRawStates.map(s => ({
    ...s,
    weight: _scoreState(molecule, atomIds, s.atomCharges, s.bondOrders)
  }));

  // Sort by weight descending — state 1 (canonical) keeps index 0 regardless
  const canonical = scoredStates[0];
  const rest = scoredStates.slice(1).sort((a, b) => b.weight - a.weight);
  const finalStates = [canonical, ...rest];

  _writeToModel(molecule, atomIds, bondIds, finalStates);
}
