/** @module algorithms/aromaticity */

function _isTransitionMetal(atom) {
  const group = atom?.properties?.group ?? 0;
  return group >= 3 && group <= 12;
}

function _hasPiOrder(bond) {
  return bond?.properties?.order === 2 || bond?.properties?.aromatic || bond?.properties?.order === 1.5;
}

function _hasFusedExocyclicRingPiBond(atom, ringAtomSet, mol) {
  for (const bondId of atom.bonds) {
    const bond = mol.bonds.get(bondId);
    if (!_hasPiOrder(bond)) {
      continue;
    }
    const other = mol.atoms.get(bond.getOtherAtom(atom.id));
    if (!other || other.name === 'H' || _isTransitionMetal(other) || ringAtomSet.has(other.id)) {
      continue;
    }
    if (other.isInRing(mol)) {
      return true;
    }
  }
  return false;
}

function _isFusedPyridineLikeNitrogen(atom, ringBonds, ringAtomSet, mol) {
  if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 0) {
    return false;
  }
  const hasH = atom.bonds.some(bId => {
    const b = mol.bonds.get(bId);
    if (!b) {
      return false;
    }
    return mol.atoms.get(b.getOtherAtom(atom.id))?.name === 'H';
  });
  if (hasH || ringBonds.length !== 2 || ringBonds.some(_hasPiOrder)) {
    return false;
  }
  return ringBonds.some(bond => {
    const neighbor = mol.atoms.get(bond.getOtherAtom(atom.id));
    return neighbor && _hasFusedExocyclicRingPiBond(neighbor, ringAtomSet, mol);
  });
}

/**
 * Returns true for neutral five-member ring nitrogens whose pyrrolic hydrogen
 * has been replaced by a non-conjugating substituent.
 * @param {import('../core/Atom.js').Atom} atom - Candidate nitrogen atom.
 * @param {import('../core/Bond.js').Bond[]} ringBonds - Ring bonds incident to the atom.
 * @param {Set<string>} ringAtomSet - Atom IDs in the candidate ring.
 * @param {import('../core/Molecule.js').Molecule} mol - Molecule graph.
 * @returns {boolean} `true` when the N should donate two π electrons.
 */
function _isSubstitutedPyrrolicLikeNitrogen(atom, ringBonds, ringAtomSet, mol) {
  if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 0 || ringAtomSet.size !== 5) {
    return false;
  }
  if (ringBonds.length !== 2) {
    return false;
  }

  const exocyclicHeavySingleBonds = atom.bonds
    .map(bondId => mol.bonds.get(bondId))
    .filter(bond => bond && !ringAtomSet.has(bond.getOtherAtom(atom.id)))
    .filter(bond => {
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      return other && other.name !== 'H' && !_hasPiOrder(bond);
    });

  if (exocyclicHeavySingleBonds.length === 0) {
    return false;
  }

  // A substituted pyrrolic-like N still needs neighboring ring conjugation or
  // fused-ring support; otherwise saturated tertiary ring amines would be
  // incorrectly promoted to 2-electron donors.
  return ringBonds.some(bond => {
    const neighbor = mol.atoms.get(bond.getOtherAtom(atom.id));
    if (!neighbor) {
      return false;
    }
    return neighbor.bonds.some(neighborBondId => {
      const neighborBond = mol.bonds.get(neighborBondId);
      if (!neighborBond || neighborBond.id === bond.id) {
        return false;
      }
      const otherId = neighborBond.getOtherAtom(neighbor.id);
      return ringAtomSet.has(otherId)
        ? _hasPiOrder(neighborBond)
        : _hasFusedExocyclicRingPiBond(neighbor, ringAtomSet, mol);
    });
  });
}

function _aromaticRingCandidates(mol) {
  const hasTransitionMetal = [...mol.atoms.values()].some(_isTransitionMetal);
  if (!hasTransitionMetal) {
    return mol.getRings();
  }
  const organicRingAtomIds = [...mol.atoms.keys()].filter(id => {
    const atom = mol.atoms.get(id);
    return atom && atom.name !== 'H' && !_isTransitionMetal(atom);
  });
  return mol.getSubgraph(organicRingAtomIds).getRings();
}

/**
 * Counts the π electrons contributed by `atom` when it is part of `ringAtomSet`.
 *
 * Rules (Hückel):
 *  - C (neutral, participates in ring/fused-system pi bond): 1
 *  - C+ (carbocation):                                       0
 *  - C- (carbanion):                                         2
 *  - N pyridine-like / fused aza-ring (no H):                1
 *  - N pyrrole-like  (has H or H replaced by substituent):   2
 *  - O / S (lone pair into ring):                            2
 *  - B (empty p orbital):                                    0
 *  - Already-marked aromatic atom (order=1.5):               1
 * @param {import('../core/Atom.js').Atom} atom - The atom object.
 * @param {Set<string>} ringAtomSet  Atom IDs in the candidate ring.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {number|null}  π electrons contributed, or null if indeterminate / disqualifies ring.
 */
function _piElectrons(atom, ringAtomSet, mol) {
  const el = atom.name;
  const charge = atom.properties.charge ?? 0;

  const ringBonds = atom.bonds.map(bId => mol.bonds.get(bId)).filter(b => b && ringAtomSet.has(b.getOtherAtom(atom.id)));

  // A ring bond counts as "double" if it is an explicit double bond (Kekulé)
  // or if it is already flagged aromatic / order 1.5 (SMILES-aromatic input).
  // Note: O/S/pyrrole-N always donate 2 electrons regardless of bond type,
  // so we only use this flag for C and pyridine-like N.
  const hasRingPiBond = ringBonds.some(_hasPiOrder);
  const hasFusedExocyclicRingPiBond = _hasFusedExocyclicRingPiBond(atom, ringAtomSet, mol);

  if (el === 'C') {
    if (charge === 1) {
      return 0;
    }
    if (charge === -1) {
      return 2;
    }
    return hasRingPiBond || hasFusedExocyclicRingPiBond ? 1 : null;
  }

  if (el === 'N') {
    if (charge === 1) {
      return hasRingPiBond || hasFusedExocyclicRingPiBond ? 1 : null;
    }
    if (charge === -1) {
      return 2;
    }
    // Pyrrole-like: has H attached → lone pair donated to ring → 2 electrons.
    // Check this BEFORE pyridine-like so that SMILES-aromatic [nH] is handled
    // correctly (its bonds are 1.5 but it still donates 2 electrons, not 1).
    const hasH = atom.bonds.some(bId => {
      const b = mol.bonds.get(bId);
      if (!b) {
        return false;
      }
      return mol.atoms.get(b.getOtherAtom(atom.id))?.name === 'H';
    });
    if (hasH || _isSubstitutedPyrrolicLikeNitrogen(atom, ringBonds, ringAtomSet, mol)) {
      return 2;
    }
    // Pyridine-like: sp2, ring π bond present → contributes 1.
    if (hasRingPiBond || hasFusedExocyclicRingPiBond || _isFusedPyridineLikeNitrogen(atom, ringBonds, ringAtomSet, mol)) {
      return 1;
    }
    return null;
  }

  if (el === 'O' || el === 'S') {
    // Furan/thiophene-like (no ring double bond): lone pair donated → 2 π electrons.
    // Pyrylium/thiopyrylium-like (explicit Kekulé double bond in the ring, e.g. C=[O+]):
    //   O/S acts as a pyridine-N equivalent → 1 π electron from the π bond.
    // Lowercase SMILES-aromatic input stores those ring bonds at order 1.5, so
    // positively charged O/S must also treat aromatic ring pi-bonds as a
    // one-electron contribution.
    if (charge > 0) {
      return hasRingPiBond || hasFusedExocyclicRingPiBond ? 1 : null;
    }
    return 2;
  }

  if (el === 'B') {
    return 0;
  }

  // Unknown element — cannot determine aromaticity.
  return null;
}

/**
 * Returns true if `piCount` satisfies Hückel's rule (4n + 2, n ≥ 0).
 * @param {number} piCount - The piCount value.
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
function _isHuckel(piCount) {
  if (piCount < 2) {
    return false;
  }
  return (piCount - 2) % 4 === 0;
}

/**
 * Returns localized bond orders for a selected aromatic bond set using the same
 * maximum-matching logic as renderer-side Kekule localization.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {Set<string>} aromaticBondIds - Aromatic bond ids to localize.
 * @returns {Map<string, number>} Bond id to localized order (1 or 2).
 */
function _localizedAromaticBondOrders(mol, aromaticBondIds) {
  const aromaticBonds = [...aromaticBondIds].map(bondId => mol.bonds.get(bondId)).filter(Boolean);
  if (aromaticBonds.length === 0) {
    return new Map();
  }
  if (aromaticBonds.every(bond => Number.isInteger(bond.properties.localizedOrder))) {
    return new Map(aromaticBonds.map(bond => [bond.id, bond.properties.localizedOrder]));
  }

  const sigmaValence = {
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

  const aromaticAtomIds = new Set();
  for (const bond of aromaticBonds) {
    aromaticAtomIds.add(bond.atoms[0]);
    aromaticAtomIds.add(bond.atoms[1]);
  }

  const sigmaBondOrder = new Map();
  for (const atomId of aromaticAtomIds) {
    sigmaBondOrder.set(atomId, 0);
  }
  for (const bond of mol.bonds.values()) {
    const contribution = bond.properties.aromatic ? 1 : (bond.properties.order ?? 1);
    for (const atomId of bond.atoms) {
      if (sigmaBondOrder.has(atomId)) {
        sigmaBondOrder.set(atomId, sigmaBondOrder.get(atomId) + contribution);
      }
    }
  }

  const canHaveDouble = new Set();
  for (const atomId of aromaticAtomIds) {
    const atom = mol.atoms.get(atomId);
    const neutralBase = sigmaValence[atom.name] ?? 4;
    const adjustedBase = Math.max(0, neutralBase + (atom.getCharge?.() ?? 0));
    if (adjustedBase - sigmaBondOrder.get(atomId) >= 1) {
      canHaveDouble.add(atomId);
    }
  }

  const adjacency = new Map();
  for (const atomId of canHaveDouble) {
    adjacency.set(atomId, []);
  }
  for (const bond of aromaticBonds) {
    const [firstAtomId, secondAtomId] = bond.atoms;
    if (canHaveDouble.has(firstAtomId) && canHaveDouble.has(secondAtomId)) {
      adjacency.get(firstAtomId).push({ bondId: bond.id, otherId: secondAtomId });
      adjacency.get(secondAtomId).push({ bondId: bond.id, otherId: firstAtomId });
    }
  }

  const mate = new Map();
  const matchedBond = new Map();
  for (const atomId of canHaveDouble) {
    mate.set(atomId, null);
  }

  function tryAugment(startAtomId) {
    const visited = new Set([startAtomId]);
    function dfs(atomId) {
      for (const { bondId, otherId } of adjacency.get(atomId)) {
        if (visited.has(otherId)) {
          continue;
        }
        visited.add(otherId);
        const mateOfOther = mate.get(otherId);
        if (mateOfOther === null || dfs(mateOfOther)) {
          mate.set(atomId, otherId);
          mate.set(otherId, atomId);
          matchedBond.set(atomId, bondId);
          matchedBond.set(otherId, bondId);
          return true;
        }
      }
      return false;
    }
    return dfs(startAtomId);
  }

  for (const atomId of canHaveDouble) {
    if (mate.get(atomId) === null) {
      tryAugment(atomId);
    }
  }

  const doubleBondIds = new Set();
  for (const [atomId, bondId] of matchedBond) {
    if (mate.get(atomId) !== null) {
      doubleBondIds.add(bondId);
    }
  }

  return new Map(aromaticBonds.map(bond => [bond.id, doubleBondIds.has(bond.id) ? 2 : 1]));
}

/**
 * Assigns `localizedOrder` (1 or 2) to bonds that are currently flagged
 * aromatic but do NOT belong to any confirmed aromatic ring.  This covers
 * cases where the SMILES parser used lowercase atoms for a ring which Hückel
 * analysis rejected (e.g. the pyrimidinone ring in hypoxanthine written as
 * `O=c1nc[nH]c2[nH]cnc12`).  Without this step those bonds would all be
 * reset to order 1, losing the C=N double bond character.
 *
 * The algorithm is a simplified maximum-matching identical in logic to the
 * `kekulize` function in layout/mol2d-helpers, restricted to the stale atoms.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {Set<string>} confirmedAromaticBondIds Bonds that belong to a genuine aromatic ring.
 */
function _kekulizeStale(mol, confirmedAromaticBondIds) {
  // Neutral σ-frame valence for common aromatic elements.
  const SIGMA_VAL = { B: 3, C: 4, N: 3, O: 2, F: 1, Si: 4, P: 3, S: 2, Cl: 1, As: 3, Se: 2, Br: 1, Te: 2, I: 1 };
  const confirmedLocalizedOrders = _localizedAromaticBondOrders(mol, confirmedAromaticBondIds);

  const staleBondIds = new Set();
  const staleAtomIds = new Set();
  for (const bond of mol.bonds.values()) {
    if (bond.properties.aromatic && !confirmedAromaticBondIds.has(bond.id)) {
      staleBondIds.add(bond.id);
      staleAtomIds.add(bond.atoms[0]);
      staleAtomIds.add(bond.atoms[1]);
    }
  }
  if (staleBondIds.size === 0) {
    return;
  }

  // Compute sigma-frame bond order for each stale atom (treat stale bonds as
  // order 1, confirmed-aromatic bonds as order 1, non-aromatic bonds at face value).
  const sigmaBO = new Map();
  for (const id of staleAtomIds) {
    sigmaBO.set(id, 0);
  }

  for (const bond of mol.bonds.values()) {
    const [a, b] = bond.atoms;
    let contrib;
    if (staleBondIds.has(bond.id) || confirmedAromaticBondIds.has(bond.id)) {
      contrib = staleBondIds.has(bond.id) ? 1 : (confirmedLocalizedOrders.get(bond.id) ?? 1);
    } else {
      contrib = bond.properties.order ?? 1;
    }
    if (staleAtomIds.has(a)) {
      sigmaBO.set(a, sigmaBO.get(a) + contrib);
    }
    if (staleAtomIds.has(b)) {
      sigmaBO.set(b, sigmaBO.get(b) + contrib);
    }
  }

  // Atoms with available valence for a π bond.
  const canHaveDouble = new Set();
  for (const id of staleAtomIds) {
    const atom = mol.atoms.get(id);
    const base = SIGMA_VAL[atom.name] ?? 4;
    const adjusted = Math.max(0, base + (atom.getCharge() ?? 0));
    if (adjusted - sigmaBO.get(id) >= 1) {
      canHaveDouble.add(id);
    }
  }

  // Build matching adjacency restricted to stale bonds between two π-capable atoms.
  const adj = new Map();
  for (const id of canHaveDouble) {
    adj.set(id, []);
  }
  for (const bond of mol.bonds.values()) {
    if (!staleBondIds.has(bond.id)) {
      continue;
    }
    const [a, b] = bond.atoms;
    if (canHaveDouble.has(a) && canHaveDouble.has(b)) {
      adj.get(a).push({ bondId: bond.id, otherId: b });
      adj.get(b).push({ bondId: bond.id, otherId: a });
    }
  }

  // Maximum matching via augmenting paths (Berge's theorem).
  const mate = new Map();
  const matchedBond = new Map();
  for (const id of canHaveDouble) {
    mate.set(id, null);
    matchedBond.set(id, null);
  }

  function _tryAugment(startId) {
    const visited = new Set([startId]);
    function dfs(v) {
      for (const { bondId, otherId: u } of adj.get(v)) {
        if (visited.has(u)) {
          continue;
        }
        visited.add(u);
        if (mate.get(u) === null || dfs(mate.get(u))) {
          mate.set(v, u);
          mate.set(u, v);
          matchedBond.set(v, bondId);
          matchedBond.set(u, bondId);
          return true;
        }
      }
      return false;
    }
    return dfs(startId);
  }

  for (const id of canHaveDouble) {
    if (mate.get(id) === null) {
      _tryAugment(id);
    }
  }

  const doubleBondIds = new Set(matchedBond.values());
  doubleBondIds.delete(null);

  for (const bond of mol.bonds.values()) {
    if (!staleBondIds.has(bond.id)) {
      continue;
    }
    bond.properties.localizedOrder = doubleBondIds.has(bond.id) ? 2 : 1;
  }
}

/**
 * Perceives aromaticity in `mol` using Hückel's rule (4n + 2 π electrons).
 *
 * Works with both:
 *  - **Kekulé input** (explicit alternating single/double bonds, e.g. Kekulé benzene)
 *  - **SMILES-aromatic input** (lowercase atoms, bond order 1.5, e.g. `c1ccccc1`)
 *
 * For each ring in the Smallest Set of Smallest Rings (SSSR), π electrons are
 * counted per atom.  If the total satisfies Hückel's rule the ring is marked
 * aromatic: `atom.properties.aromatic = true` for every atom in the ring, and
 * every ring bond gets `bond.setAromatic(true)`.
 *
 * When `options.preserveKekule` is true, any existing integer ring-bond order
 * is copied to `bond.properties.localizedOrder` before the bond is converted
 * to aromatic order 1.5. Renderers can prefer that preserved localized order
 * when they want a Kekule-style depiction of an aromatic system.
 *
 * Rings containing hydrogen atoms are skipped (H is never sp2 in a ring).
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {{ preserveKekule?: boolean }} [options] - Configuration options.
 * @returns {string[][]} Array of aromatic rings, each as an array of atom IDs.
 */
export function perceiveAromaticity(mol, { preserveKekule = false } = {}) {
  // Clear any atom-aromatic flags set by the SMILES parser so that only
  // rings which actually satisfy Hückel's rule end up marked aromatic.
  // Bond order/aromatic flags are intentionally left intact: _piElectrons
  // relies on them (1.5 for SMILES-aromatic input, 2 for Kekulé) to count
  // π electrons.
  for (const atom of mol.atoms.values()) {
    atom.properties.aromatic = false;
  }

  const rings = _aromaticRingCandidates(mol);
  const aromaticRings = [];
  const done = new Array(rings.length).fill(false);
  const aromaticBondIds = new Set();

  // Iterate until no new aromatic rings are found.  Fused ring systems (e.g.
  // phenanthrene) can require multiple passes: the middle ring only becomes
  // recognisable as aromatic after the two outer rings are processed.
  let anyNew = true;
  while (anyNew) {
    anyNew = false;
    for (let ri = 0; ri < rings.length; ri++) {
      if (done[ri]) {
        continue;
      }
      const ring = rings[ri];
      const ringAtomSet = new Set(ring);

      // Skip rings containing hydrogen.
      if (ring.some(id => mol.atoms.get(id)?.name === 'H')) {
        done[ri] = true;
        continue;
      }

      let piTotal = 0;
      let valid = true;

      for (const atomId of ring) {
        const atom = mol.atoms.get(atomId);
        if (!atom) {
          valid = false;
          break;
        }

        const pi = _piElectrons(atom, ringAtomSet, mol);
        if (pi === null) {
          valid = false;
          break;
        }
        piTotal += pi;
      }

      if (!valid || !_isHuckel(piTotal)) {
        continue;
      }

      done[ri] = true;
      anyNew = true;

      // Mark atoms.
      for (const atomId of ring) {
        mol.atoms.get(atomId).properties.aromatic = true;
      }

      // Mark bonds between consecutive ring atoms.
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const bond = mol.getBond(a, b);
        if (bond) {
          if (preserveKekule && Number.isInteger(bond.properties.order)) {
            bond.properties.localizedOrder = bond.properties.order;
          }
          bond.setAromatic(true);
          aromaticBondIds.add(bond.id);
        }
      }

      aromaticRings.push(ring);
    }
  }

  // Kekulize stale bonds (aromatic-flagged bonds whose ring failed Hückel):
  // run maximum-matching to assign localizedOrder 1 or 2 before clearing the
  // aromatic flag, so non-aromatic rings parsed from lowercase SMILES (e.g.
  // the pyrimidinone ring in hypoxanthine) retain their correct bond orders.
  _kekulizeStale(mol, aromaticBondIds);

  // Remove stale aromatic flags from bonds that the SMILES parser marked
  // as 1.5-order but whose ring failed Hückel analysis.  Bonds shared with
  // a genuinely aromatic ring (tracked in aromaticBondIds) are left alone.
  for (const bond of mol.bonds.values()) {
    if (bond.properties.aromatic && !aromaticBondIds.has(bond.id)) {
      bond.properties.order = bond.properties.localizedOrder ?? 1;
      bond.properties.aromatic = false;
      delete bond.properties.localizedOrder;
    }
  }

  return aromaticRings;
}

/**
 * Clears stale aromatic flags/bond orders and re-perceives aromaticity.
 *
 * This is intended for graph edits where an originally aromatic system may
 * have been broken. Callers should ensure any aromatic bonds that need a
 * recoverable Kekule assignment already carry `localizedOrder` (for example
 * by calling `kekulize(mol)` beforehand).
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {{ preserveKekule?: boolean }} [options] - Configuration options.
 * @returns {string[][]} Array of aromatic rings after refresh.
 */
export function refreshAromaticity(mol, { preserveKekule = true } = {}) {
  for (const atom of mol.atoms.values()) {
    atom.properties.aromatic = false;
  }

  for (const bond of mol.bonds.values()) {
    if (!bond.properties.aromatic) {
      continue;
    }
    bond.properties.order = Number.isInteger(bond.properties.localizedOrder) ? bond.properties.localizedOrder : 1;
    bond.properties.aromatic = false;
    delete bond.properties.localizedOrder;
  }

  return perceiveAromaticity(mol, { preserveKekule });
}
