/** @module validation/valence */

import elements from '../data/elements.js';

/**
 * Validates the valence (total bond order) of each atom in a molecule.
 *
 * Uses the electron-count parity rule derived from formal-charge theory:
 *
 *   ec = valenceElectrons(element) − formalCharge
 *
 *   allowed bond orders = non-negative integers ≤ allowedMax
 *                         that share the same parity as ec
 *
 * where `allowedMax` enforces orbital-count limits:
 *   - period 1  (H, He):  min(ec, 2 − ec)  — one s orbital, 2 e⁻ max
 *   - period 2  (Li–Ne):  min(ec, 8 − ec)  — octet rule from both ends;
 *                          correctly gives C→4, N→3, O→2, F→1 for neutral atoms
 *   - period 3+ (Na–Xe):  min(ec, 8)       — d-orbital participation, generous cap
 *
 * Aromatic atoms are skipped: their bond orders are resonance-averaged
 * (fractional) and only well-defined after Kekulé assignment.
 *
 * Transition metals (groups 3–12) and unknown elements are silently skipped.
 *
 * Bond orders are floored before summing so that fractional aromatic bond
 * orders stored by the SMILES parser (1.5) are treated as sigma bonds (1)
 * for non-aromatic atoms that border aromatic rings.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {Array<{
 *   atomId:    string,
 *   element:   string,
 *   charge:    number,
 *   bondOrder: number,
 *   allowed:   number[],
 *   message:   string
 * }>} Array of warning objects — empty when all atoms are valid.
 */
export function validateValence(molecule) {
  const warnings = [];

  for (const [atomId, atom] of molecule.atoms) {
    const el = elements[atom.name];
    if (!el) {
      continue; // unknown element
    }

    const { group, period } = el;

    // Skip transition metals (groups 3–12): complex multi-oxidation-state rules
    if (group >= 3 && group <= 12) {
      continue;
    }

    // Skip aromatic atoms: their bond orders are fractional (resonance-averaged)
    // and only well-defined after Kekulé assignment.
    if (atom.properties.aromatic) {
      continue;
    }

    // Valence electrons:
    //   period-1 group-18 (He): special case → 2, not 8
    //   p-block (groups 13–18): V = group − 10
    //   s-block (groups 1–2):   V = group
    const V = (group === 18 && period === 1) ? 2
      : group >= 13 ? group - 10
        : group;

    const charge = atom.properties.charge ?? 0;
    const ec     = V - charge; // effective electrons available for bonding

    // Compute allowedMax from orbital-count constraints
    const shellSize  = period === 1 ? 2 : 8;
    const octectMax  = ec >= 0 ? Math.max(0, Math.min(ec, shellSize - ec)) : 0;
    const allowedMax = period <= 2 ? octectMax : Math.min(Math.max(0, ec), 8);

    // Build the set of allowed bond orders (same parity as ec, up to allowedMax)
    const allowed = [];
    if (ec >= 0) {
      const parity = ec % 2;
      for (let bo = parity; bo <= allowedMax; bo += 2) {
        allowed.push(bo);
      }
    }
    // ec < 0 (charge exceeds valence electrons) → allowed stays empty

    // Sum bond orders using Math.floor so fractional aromatic bond orders
    // (1.5, stored by the SMILES parser) become sigma-bond counts (1).
    let totalBO = 0;
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      totalBO += Math.floor(bond.properties.order ?? 1);
    }

    if (!allowed.includes(totalBO)) {
      const chargeStr = charge > 0 ? `+${charge}` : `${charge}`;
      warnings.push({
        atomId,
        element: atom.name,
        charge,
        bondOrder: totalBO,
        allowed,
        message: `${atom.name}(${atomId}): bond order ${totalBO} is not valid ` +
          `for ${atom.name} with charge ${chargeStr} ` +
          `(allowed: ${allowed.length ? allowed.join(', ') : 'none'})`
      });
    }
  }

  return warnings;
}
