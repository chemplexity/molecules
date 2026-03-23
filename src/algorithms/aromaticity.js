/** @module algorithms/aromaticity */

/**
 * Counts the π electrons contributed by `atom` when it is part of `ringAtomSet`.
 *
 * Rules (Hückel):
 *  - C (neutral, participates in ring double bond): 1
 *  - C+ (carbocation):                              0
 *  - C- (carbanion):                                2
 *  - N pyridine-like (no H, one ring double bond):  1
 *  - N pyrrole-like  (has H, lone pair into ring):  2
 *  - O / S (lone pair into ring):                   2
 *  - B (empty p orbital):                           0
 *  - Already-marked aromatic atom (order=1.5):      1  (each contributes 1 to the 4n+2 sum)
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {Set<string>} ringAtomSet  Atom IDs in the candidate ring.
 * @param {import('../core/Molecule.js').Molecule} mol
 * @returns {number|null}  π electrons contributed, or null if indeterminate / disqualifies ring.
 */
function _piElectrons(atom, ringAtomSet, mol) {
  const el     = atom.name;
  const charge = atom.properties.charge ?? 0;

  const ringBonds = atom.bonds
    .map(bId => mol.bonds.get(bId))
    .filter(b => b && ringAtomSet.has(b.getOtherAtom(atom.id)));

  // A ring bond counts as "double" if it is an explicit double bond (Kekulé)
  // or if it is already flagged aromatic / order 1.5 (SMILES-aromatic input).
  // Note: O/S/pyrrole-N always donate 2 electrons regardless of bond type,
  // so we only use this flag for C and pyridine-like N.
  const hasRingPiBond = ringBonds.some(
    b => b.properties.order === 2 || b.properties.aromatic || b.properties.order === 1.5
  );

  if (el === 'C') {
    if (charge === 1)  {
      return 0;
    }
    if (charge === -1) {
      return 2;
    }
    return hasRingPiBond ? 1 : null;
  }

  if (el === 'N') {
    if (charge === 1)  {
      return hasRingPiBond ? 1 : null;
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
    if (hasH) {
      return 2;
    }
    // Pyridine-like: sp2, ring π bond present → contributes 1.
    return hasRingPiBond ? 1 : null;
  }

  if (el === 'O' || el === 'S') {
    // Furan/thiophene-like (no ring double bond): lone pair donated → 2 π electrons.
    // Pyrylium/thiopyrylium-like (explicit Kekulé double bond in the ring, e.g. C=[O+]):
    //   O/S acts as a pyridine-N equivalent → 1 π electron from the π bond.
    const hasKekulePiBond = ringBonds.some(b => b.properties.order === 2);
    return hasKekulePiBond ? 1 : 2;
  }

  if (el === 'B') {
    return 0;
  }

  // Unknown element — cannot determine aromaticity.
  return null;
}

/**
 * Returns true if `piCount` satisfies Hückel's rule (4n + 2, n ≥ 0).
 *
 * @param {number} piCount
 * @returns {boolean}
 */
function _isHuckel(piCount) {
  if (piCount < 2) {
    return false;
  }
  return (piCount - 2) % 4 === 0;
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
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @param {{ preserveKekule?: boolean }} [options]
 * @returns {string[][]}  Array of aromatic rings, each as an array of atom IDs.
 */
export function perceiveAromaticity(mol, { preserveKekule = false } = {}) {
  const rings = mol.getRings();
  const aromaticRings = [];
  const done = new Array(rings.length).fill(false);

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
        done[ri] = true; continue;
      }

      let piTotal = 0;
      let valid   = true;

      for (const atomId of ring) {
        const atom = mol.atoms.get(atomId);
        if (!atom) {
          valid = false; break;
        }

        const pi = _piElectrons(atom, ringAtomSet, mol);
        if (pi === null) {
          valid = false; break;
        }
        piTotal += pi;
      }

      if (!valid || !_isHuckel(piTotal)) {
        continue;
      }

      done[ri] = true;
      anyNew   = true;

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
        }
      }

      aromaticRings.push(ring);
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
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @param {{ preserveKekule?: boolean }} [options]
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
    bond.properties.order = Number.isInteger(bond.properties.localizedOrder)
      ? bond.properties.localizedOrder
      : 1;
    bond.properties.aromatic = false;
    delete bond.properties.localizedOrder;
  }

  return perceiveAromaticity(mol, { preserveKekule });
}
