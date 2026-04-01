/** @module algorithms/morgan */

import elements from '../data/elements.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lexicographically compares two arrays of numbers.
 * Returns negative / 0 / positive like Array.sort's comparator.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function lexCmp(a, b) {
  const len = Math.max(a.length, b.length);
  for (let k = 0; k < len; k++) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

/**
 * Given an array of invariant arrays (one per atom), returns an integer rank
 * array where rank 0 is the lex-smallest invariant and tied atoms share the
 * same rank.
 *
 * @param {number[][]} invariants  One tuple per atom.
 * @returns {number[]}
 */
function assignRanks(invariants) {
  const n = invariants.length;
  const order = [...Array(n).keys()].sort((a, b) => lexCmp(invariants[a], invariants[b]));
  const rank = new Array(n).fill(0);
  for (let j = 1; j < n; j++) {
    const prev = order[j - 1];
    const cur = order[j];
    rank[cur] = rank[prev] + (lexCmp(invariants[prev], invariants[cur]) !== 0 ? 1 : 0);
  }
  // Return unique count alongside rank to avoid a separate new Set(rank).size call.
  const unique = rank[order[n - 1]] + 1;
  return { rank, unique };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assigns canonical atom ranks to the **heavy atoms** of `mol` using a
 * Morgan-style extended-connectivity algorithm with tie-breaking.
 *
 * Based on Weininger (1989) canonical SMILES paper.  Works on a single
 * connected component; for multi-component molecules call per-component.
 *
 * Initial invariant tuple per atom:
 *   [atomic_number, heavy_degree, charge, isotope_mass, bonded_H_count, is_aromatic]
 *
 * After convergence, any remaining ties (symmetric atoms) are broken
 * deterministically: within each tied group the lex-min initial-invariant
 * atom is ranked first, then Morgan is re-run until stability.  Repeating
 * this until all ranks are unique guarantees a fully canonical ordering.
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @returns {Map<string, number>}
 *   Maps heavy-atom ID to canonical rank (0 = first in canonical SMILES).
 */
export function morganRanks(mol) {
  // ---- 1. Collect heavy atoms ------------------------------------------------
  const atoms = [...mol.atoms.values()].filter(a => a.name !== 'H');
  const n = atoms.length;
  if (n === 0) {
    return new Map();
  }

  const ids = atoms.map(a => a.id);
  const idx = new Map(ids.map((id, i) => [id, i])); // atomId → index

  // Heavy-atom neighbor index lists.
  const neighbors = atoms.map(atom => {
    const nbrs = [];
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const i2 = idx.get(b.getOtherAtom(atom.id));
      if (i2 !== undefined) {
        nbrs.push(i2);
      }
    }
    return nbrs;
  });

  // Bonded-H counts (pendant H atoms, both explicit and implicit).
  const hCount = atoms.map(atom => {
    let h = 0;
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (other?.name === 'H') {
        h++;
      }
    }
    return h;
  });

  // ---- 2. Initial invariant tuples -------------------------------------------
  const initInvariants = atoms.map((atom, i) => {
    const atomicNum = atom.properties.protons ?? 0;
    const degree = neighbors[i].length;
    const charge = atom.getCharge();
    let isotope = 0;
    if (atom.properties.protons != null && atom.properties.neutrons != null) {
      const mass = Math.round(atom.properties.protons + atom.properties.neutrons);
      const el = elements[atom.name];
      const std = el ? Math.round(el.protons + el.neutrons) : mass;
      if (mass !== std) {
        isotope = mass;
      }
    }
    const aromatic = atom.isAromatic() ? 1 : 0;
    return [atomicNum, degree, charge, isotope, hCount[i], aromatic];
  });

  // ---- 3. Morgan iteration ---------------------------------------------------
  /**
   * One round of Morgan extension: extend each atom's invariant with the
   * sorted neighbor ranks.
   */
  function extendRanks(rank) {
    const inv = rank.map((r, i) => {
      const nbRanks = neighbors[i].map(j => rank[j]);
      nbRanks.sort((a, b) => a - b);
      nbRanks.unshift(r); // prepend self-rank in place; no spread allocation
      return nbRanks;
    });
    return assignRanks(inv);
  }

  let { rank, unique } = assignRanks(initInvariants);

  for (;;) {
    const next = extendRanks(rank);
    if (next.unique <= unique) {
      break;
    }
    rank = next.rank;
    unique = next.unique;
  }

  // ---- 4. Tie-breaking -------------------------------------------------------
  // After convergence some atoms may still share a rank (they are chemically
  // symmetric).  We break ties deterministically by giving the lex-min initial-
  // invariant member of the smallest tied group a unique rank, then re-running
  // Morgan until stability.  Repeat until all ranks are unique.
  while (unique < n) {
    // Tally rank counts; find the smallest rank with a count > 1.
    const counts = new Map();
    for (const r of rank) {
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }

    let tiedRank = -1;
    for (let r = 0; r <= n; r++) {
      if ((counts.get(r) ?? 0) > 1) {
        tiedRank = r;
        break;
      }
    }
    if (tiedRank < 0) {
      break;
    }

    // Among tied atoms, choose the one with the lex-min initial invariant.
    // Fall back to original index order for a fully deterministic tiebreak.
    const tied = rank.map((r, i) => (r === tiedRank ? i : -1)).filter(i => i >= 0);
    tied.sort((a, b) => {
      const d = lexCmp(initInvariants[a], initInvariants[b]);
      return d !== 0 ? d : a - b;
    });
    const chosen = tied[0];

    // Give the chosen atom a half-step smaller rank, then renormalise.
    const fractional = rank.map((r, i) => [i === chosen ? r - 0.5 : r]);
    ({ rank, unique } = assignRanks(fractional));

    // Re-run Morgan with the new seeds.
    for (;;) {
      const next = extendRanks(rank);
      if (next.unique <= unique) {
        break;
      }
      rank = next.rank;
      unique = next.unique;
    }
  }

  return new Map(ids.map((id, i) => [id, rank[i]]));
}
