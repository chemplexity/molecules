/** @module validation/valence */

import elements from '../data/elements.js';

function commonNeutralValences(symbol, { group, period }) {
  if (symbol === 'H') return [1];
  if (symbol === 'He' || group === 18) return [0];
  if (group === 1 || group === 2) return [group];
  if (group === 13) return [3];
  if (group === 14) return [4];
  if (group === 15) return period <= 2 ? [3] : [3, 5];
  if (group === 16) return period <= 2 ? [2] : [2, 4, 6];
  if (group === 17) return [1];
  return [];
}

function shiftedCommonValences(symbol, el, charge, radical) {
  const base = commonNeutralValences(symbol, el);
  if (base.length === 0) return [];

  const shift =
    symbol === 'H'
      ? v => v - Math.abs(charge) - radical
      : el.group === 14
        ? v => v - Math.abs(charge) - radical
        : el.group >= 15 && el.group <= 17
          ? v => v + charge - radical
          : v => v - charge - radical;

  return [...new Set(base.map(shift).filter(v => Number.isInteger(v) && v >= 0 && v <= 8))].sort((a, b) => a - b);
}

/**
 * Validates the valence (total bond order) of each atom in a molecule.
 *
 * Uses the electron-count parity rule derived from formal-charge theory,
 * then narrows the result to common valence families for the element:
 *
 *   ec = valenceElectrons(element) − formalCharge − radicalCount
 *
 *   candidate bond orders = non-negative integers ≤ allowedMax
 *                           that share the same parity as ec
 *
 *   allowed bond orders = candidate bond orders ∩ shiftedCommonValences
 *
 * where `allowedMax` enforces orbital-count limits:
 *   - period 1  (H, He):  min(ec, 2 − ec)  — one s orbital, 2 e⁻ max
 *   - period 2  (Li–Ne):  min(ec, 8 − ec)  — octet rule from both ends;
 *                          caps the candidate set for second-row atoms
 *   - halogens (group 17): min(ec, 8 − ec) — keep Cl/Br/I monovalent by default
 *   - other period 3+ main-group atoms: min(ec, 8) — d-orbital participation, generous cap
 *
 * Common valence families are then shifted by charge / radical in the direction
 * that matches ordinary chemistry:
 *   - C/Si family: neutral 4; charged/radical species usually step down
 *   - N/P family: neutral 3 (plus 5 for heavier atoms); cations step up
 *   - O/S family: neutral 2 (plus 4/6 for heavier atoms); cations step up
 *   - halogens: neutral 1; anions step down to 0
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
 *   radical:   number,
 *   bondOrder: number,
 *   allowed:   number[],
 *   reason:    string,
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
    if (atom.isAromatic()) {
      continue;
    }

    // Valence electrons:
    //   period-1 group-18 (He): special case → 2, not 8
    //   p-block (groups 13–18): V = group − 10
    //   s-block (groups 1–2):   V = group
    const V = group === 18 && period === 1 ? 2 : group >= 13 ? group - 10 : group;

    const charge = atom.getCharge();
    const radical = atom.getRadical();
    const ec = V - charge - radical; // effective electrons available for bonding

    // Compute allowedMax from orbital-count constraints
    const shellSize = period === 1 ? 2 : 8;
    const octetMax = ec >= 0 ? Math.max(0, Math.min(ec, shellSize - ec)) : 0;
    const allowExpandedOctet = period > 2 && group !== 17;
    const allowedMax = allowExpandedOctet ? Math.min(Math.max(0, ec), 8) : octetMax;

    // Build the candidate set from parity/orbital rules.
    const candidates = [];
    if (ec >= 0) {
      const parity = ec % 2;
      for (let bo = parity; bo <= allowedMax; bo += 2) {
        candidates.push(bo);
      }
    }
    // ec < 0 (charge exceeds valence electrons) → candidate set stays empty.

    // Keep only the common valence states that fit the parity/orbital guardrails.
    const preferred = new Set(shiftedCommonValences(atom.name, el, charge, radical));
    const allowed = candidates.filter(bo => preferred.has(bo));

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
      const radicalStr = radical > 0 ? `, radical ${radical}` : '';
      const allowedStr = allowed.length ? allowed.join(', ') : 'none';
      const reason = `Bond order ${totalBO} is not valid for ${atom.name} with charge ${chargeStr}${radicalStr} (allowed: ${allowedStr})`;
      warnings.push({
        atomId,
        element: atom.name,
        charge,
        radical,
        bondOrder: totalBO,
        allowed,
        reason,
        message: `${atom.name}(${atomId}): ${reason}`
      });
    }
  }

  return warnings;
}
