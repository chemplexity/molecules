/** @module descriptors/physicochemical */

import { molecularMass } from './molecular.js';

// ---------------------------------------------------------------------------
// Element-set constants (module-level to avoid repeated inline allocations)
// ---------------------------------------------------------------------------

/** Heteroatoms that accept a multiple bond from a carbonyl-like centre. */
const _HETEROATOMS = new Set(['O', 'N', 'S', 'P']);

/** Atoms that can act as a carbonyl-like centre (C=O, C=S, S=O, P=O, …). */
const _CARBONYL_CENTERS = new Set(['C', 'S', 'P']);

/** Heteroatoms that donate lone pairs to oxygen/sulphur-like acceptor sites. */
const _OSP_HETEROATOMS = new Set(['O', 'S', 'P']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertMolecule(mol, name) {
  if (!mol || !(mol.atoms instanceof Map) || !(mol.bonds instanceof Map)) {
    throw new TypeError(`${name} must be a Molecule instance with .atoms and .bonds Maps.`);
  }
}

function _heavyAtoms(mol) {
  return [...mol.atoms.values()].filter(a => a.name !== 'H');
}

function _sortIds(ids) {
  return [...ids].sort((a, b) => String(a).localeCompare(String(b)));
}

function _sortRings(rings) {
  return rings.map(ring => _sortIds(ring)).sort((a, b) => a.length - b.length || a.join('\u0000').localeCompare(b.join('\u0000')));
}

/**
 * Infer hybridisation from bond orders.  Returns 'sp', 'sp2', or 'sp3'.
 * Falls back to the stored `properties.hybridization` if set.
 */
function _hybSp(atom, mol) {
  if (atom.getHybridization()) {
    return atom.getHybridization();
  }
  if (atom.isAromatic()) {
    return 'sp2';
  }
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (!bond) {
      continue;
    }
    const order = bond.properties.order ?? 1;
    if (order === 3) {
      return 'sp';
    }
    if (order === 2) {
      return 'sp2';
    }
  }
  return 'sp3';
}

/** Standard valences for implicit-H calculation. */
const VALENCE = {
  C: 4,
  N: 3,
  O: 2,
  S: 2,
  P: 3,
  F: 1,
  Cl: 1,
  Br: 1,
  I: 1,
  B: 3
};

function _targetValence(atom) {
  const charge = atom.getCharge();
  switch (atom.name) {
    case 'C':
      return 4;
    case 'N':
      if (atom.isAromatic()) {
        return charge > 0 ? 3 : 2;
      }
      return charge > 0 ? 4 : charge < 0 ? 2 : 3;
    case 'O':
      return charge > 0 ? 3 : charge < 0 ? 1 : 2;
    case 'S':
      return charge > 0 ? 3 : charge < 0 ? 1 : 2;
    case 'P':
      return charge > 0 ? 4 : 3;
    default:
      return VALENCE[atom.name];
  }
}

/**
 * Count the implicit H atoms attached to `atom` using the SMILES valence rule:
 * `implicitH = primaryValence − Σ(bond orders) − |formal charge adjustment|`.
 *
 * Returns 0 for elements not in the valence table or when the atom is over-bonded.
 */
function _implicitH(atom, mol) {
  const targetValence = _targetValence(atom);
  if (targetValence === undefined) {
    return 0;
  }
  let bondOrderSum = 0;
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (!bond) {
      continue;
    }
    const other = mol.atoms.get(bond.getOtherAtom(atom.id));
    if (!other || other.name === 'H') {
      continue; // explicit H neighbours are not double-counted
    }
    const order = bond.properties.order ?? 1;
    bondOrderSum += order === 1.5 ? 1 : order; // aromatic bonds count as 1 for valence
  }
  return Math.max(0, targetValence - bondOrderSum);
}

function _attachedHydrogenCount(atom, mol) {
  const explicit = atom.getHydrogenNeighbors
    ? atom.getHydrogenNeighbors(mol).length
    : atom.bonds.reduce((count, bId) => {
        const bond = mol.bonds.get(bId);
        if (!bond) {
          return count;
        }
        const other = mol.atoms.get(bond.getOtherAtom(atom.id));
        return count + (other?.name === 'H' ? 1 : 0);
      }, 0);
  if (explicit > 0) {
    return explicit;
  }
  return _implicitH(atom, mol);
}

function _hasMultipleBondToHetero(center, mol, excludeBondId = null) {
  for (const bId of center.bonds) {
    if (bId === excludeBondId) {
      continue;
    }
    const bond = mol.bonds.get(bId);
    if (!bond) {
      continue;
    }
    const order = bond.properties.order ?? 1;
    if (order < 2) {
      continue;
    }
    const other = mol.atoms.get(bond.getOtherAtom(center.id));
    if (other && _HETEROATOMS.has(other.name)) {
      return true;
    }
  }
  return false;
}

function _isAcidicOH(atom, mol) {
  if (atom.name !== 'O') {
    return false;
  }
  if (_attachedHydrogenCount(atom, mol) === 0) {
    return false;
  }
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (!bond || (bond.properties.order ?? 1) !== 1) {
      continue;
    }
    const other = mol.atoms.get(bond.getOtherAtom(atom.id));
    if (other && _CARBONYL_CENTERS.has(other.name) && _hasMultipleBondToHetero(other, mol, bId)) {
      return true;
    }
  }
  return false;
}

function _isAmideLikeNitrogen(atom, mol) {
  if (atom.name !== 'N') {
    return false;
  }
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (!bond || (bond.properties.order ?? 1) !== 1) {
      continue;
    }
    const other = mol.atoms.get(bond.getOtherAtom(atom.id));
    if (!other || !_CARBONYL_CENTERS.has(other.name)) {
      continue;
    }
    // Only suppress acceptor behaviour when the adjacent multiple bond is to
    // an electronegative atom that is NOT nitrogen (i.e. C=O, C=S, C=P).
    // Guanidine/amidine carbons carry C=N, so their NH groups remain
    // genuine acceptors and must NOT be excluded here.
    for (const bId2 of other.bonds) {
      if (bId2 === bId) {
        continue;
      }
      const bond2 = mol.bonds.get(bId2);
      if (!bond2) {
        continue;
      }
      const order2 = bond2.properties.order ?? 1;
      if (order2 < 2) {
        continue;
      }
      const neighbor = mol.atoms.get(bond2.getOtherAtom(other.id));
      if (neighbor && _OSP_HETEROATOMS.has(neighbor.name)) {
        return true; // true amide-like: C=O–N, C=S–N, etc.
      }
    }
  }
  return false;
}

function _isHBondAcceptor(atom, mol) {
  const charge = atom.getCharge();
  const hydrogens = _attachedHydrogenCount(atom, mol);
  if (atom.name === 'O') {
    if (charge > 0) {
      return false;
    }
    if (_isAcidicOH(atom, mol)) {
      return false;
    }
    return true;
  }
  if (atom.name === 'N') {
    if (charge > 0) {
      return false;
    }
    if (atom.isAromatic() && hydrogens > 0) {
      return false;
    }
    if (_isAmideLikeNitrogen(atom, mol)) {
      return false;
    }
    return true;
  }
  if (atom.name === 'S' || atom.name === 'P') {
    if (charge > 0) {
      return false;
    }
    if (_hasMultipleBondToHetero(atom, mol)) {
      return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Crippen logP — Wildman & Crippen, JCICS 1999, 39, 868
// Atom types simplified to ~20 (element + hybridisation + charge).
// ---------------------------------------------------------------------------

const CRIPPEN = {
  'C:sp3': 0.294,
  'C:sp2': 0.1439,
  'C:aro': 0.1441,
  'C:sp': 0.0,
  'N:sp3': -0.2729,
  'N:sp2': -0.1624,
  'N:aro': -0.3572,
  'N:+': -1.0187,
  'O:oh': -0.682, // alcohol / carboxylic acid OH (has implicit H)
  'O:ether': +0.1552, // aliphatic ether or ester O (no H, sp3) — Wildman O1
  'O:sp2': -0.4962, // carbonyl =O
  'O:aro': -0.44, // aromatic O
  'O:-': -0.939, // carboxylate O−
  S: 0.222,
  F: 0.4202,
  Cl: 0.6482,
  Br: 0.885,
  I: 1.35,
  P: 0.45
};

function _crippinKey(atom, mol) {
  const el = atom.name;
  const charge = atom.getCharge();
  if (el === 'N' && charge > 0) {
    return 'N:+';
  }
  if (el === 'O' && charge < 0) {
    return 'O:-';
  }
  if (el === 'S' || el === 'F' || el === 'Cl' || el === 'Br' || el === 'I' || el === 'P') {
    return el;
  }
  if (el === 'C' || el === 'N') {
    if (atom.isAromatic()) {
      return `${el}:aro`;
    }
    const hyb = _hybSp(atom, mol);
    return `${el}:${hyb}`;
  }
  if (el === 'O') {
    if (atom.isAromatic()) {
      return 'O:aro';
    }
    const hyb = _hybSp(atom, mol);
    if (hyb === 'sp2') {
      return 'O:sp2';
    }
    return _implicitH(atom, mol) > 0 ? 'O:oh' : 'O:ether';
  }
  return null;
}

/**
 * Estimates lipophilicity using the Crippen atom-contribution method.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number} logP rounded to two decimal places.
 */
export function logP(molecule) {
  assertMolecule(molecule, 'molecule');
  let sum = 0;
  for (const atom of _heavyAtoms(molecule)) {
    const key = _crippinKey(atom, molecule);
    if (key !== null) {
      sum += CRIPPEN[key] ?? 0;
    }
  }
  return Math.round(sum * 100) / 100;
}

// ---------------------------------------------------------------------------
// TPSA — Ertl, J. Med. Chem. 2000, 43, 3714
// ---------------------------------------------------------------------------

/**
 * Computes the Topological Polar Surface Area (Å²) using Ertl atomic
 * contributions.  Only N, O, S, and P atoms contribute.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number} TPSA in Å² rounded to two decimal places.
 */
export function tpsa(molecule) {
  assertMolecule(molecule, 'molecule');
  let sum = 0;
  for (const atom of _heavyAtoms(molecule)) {
    const el = atom.name;
    const h = _attachedHydrogenCount(atom, molecule);
    const hyb = _hybSp(atom, molecule);
    const charge = atom.getCharge();
    if (el === 'O') {
      if (charge > 0) {
        sum += 0;
      } else if (_isAcidicOH(atom, molecule) || h >= 1) {
        sum += 20.23; // OH
      } else if (hyb === 'sp2' || hyb === 'aro' || atom.isAromatic()) {
        sum += 17.07; // C=O / aromatic O
      } else {
        sum += 9.23; // ether
      }
    } else if (el === 'N') {
      if (charge > 0 && h === 0) {
        sum += 0; // quaternary / fully substituted ammonium-like N
      } else if (atom.isAromatic()) {
        sum += h >= 1 ? 15.79 : 12.89; // pyrrolic vs pyridine-like aromatic N
      } else if (hyb === 'sp2') {
        sum += h >= 1 ? 24.68 : 12.89;
      } else {
        if (h >= 2) {
          sum += 26.02; // NH2
        } else if (h === 1) {
          sum += 23.85; // NH
        } else {
          sum += 12.89; // tertiary N
        }
      }
    } else if (el === 'S') {
      sum += h >= 1 ? 38.8 : 25.3;
    } else if (el === 'P') {
      sum += 9.81;
    }
  }
  return Math.round(sum * 100) / 100;
}

// ---------------------------------------------------------------------------
// H-bond donors / acceptors  (Lipinski definitions)
// ---------------------------------------------------------------------------

/**
 * Counts hydrogen-bond donors (NH and OH groups).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ count: number, atoms: string[] }}
 */
export function hBondDonors(molecule) {
  assertMolecule(molecule, 'molecule');
  const atoms = _sortIds(
    _heavyAtoms(molecule)
      .filter(a => (a.name === 'O' || a.name === 'N' || a.name === 'S') && _attachedHydrogenCount(a, molecule) > 0)
      .map(atom => atom.id)
  );
  return { count: atoms.length, atoms };
}

/**
 * Counts hydrogen-bond acceptors (all N and O atoms, Lipinski definition).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ count: number, atoms: string[] }}
 */
export function hBondAcceptors(molecule) {
  assertMolecule(molecule, 'molecule');
  const atoms = _sortIds(
    _heavyAtoms(molecule)
      .filter(a => _isHBondAcceptor(a, molecule))
      .map(atom => atom.id)
  );
  return { count: atoms.length, atoms };
}

// ---------------------------------------------------------------------------
// Rotatable bonds
// ---------------------------------------------------------------------------

/**
 * Counts rotatable bonds (single, non-aromatic, between two non-terminal
 * heavy atoms).  Delegates to {@link Bond#isRotatable}.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ count: number, bonds: string[] }}
 */
export function rotatableBondCount(molecule) {
  assertMolecule(molecule, 'molecule');
  const bonds = _sortIds([...molecule.bonds.values()].filter(b => b.isRotatable(molecule)).map(bond => bond.id));
  return { count: bonds.length, bonds };
}

// ---------------------------------------------------------------------------
// Fraction sp3 (Fsp3)
// ---------------------------------------------------------------------------

/**
 * Computes the fraction of sp3 carbons (Fsp3), a measure of molecular
 * complexity and three-dimensionality.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ value: number, atoms: string[] }} `value` is rounded to three
 *   decimal places; `atoms` is the sorted list of sp3 carbon atom IDs.
 */
export function fsp3(molecule) {
  assertMolecule(molecule, 'molecule');
  const carbons = _heavyAtoms(molecule).filter(a => a.name === 'C');
  if (carbons.length === 0) {
    return { value: 0, atoms: [] };
  }
  const sp3Atoms = carbons.filter(a => _hybSp(a, molecule) === 'sp3');
  const value = Math.round((sp3Atoms.length / carbons.length) * 1000) / 1000;
  return { value, atoms: _sortIds(sp3Atoms.map(a => a.id)) };
}

// ---------------------------------------------------------------------------
// Crippen Molar Refractivity — Wildman & Crippen, JCICS 1999, 39, 868
// ---------------------------------------------------------------------------

const CRIPPEN_MR = {
  'C:sp3': 2.516,
  'C:sp2': 2.433,
  'C:aro': 2.433,
  'C:sp': 2.057,
  'N:sp3': 3.483,
  'N:sp2': 2.991,
  'N:aro': 2.991,
  'N:+': 3.32,
  'O:oh': 1.229,
  'O:ether': 1.69,
  'O:sp2': 2.055,
  'O:aro': 1.69,
  'O:-': 1.229,
  S: 7.591,
  F: 1.014,
  Cl: 5.861,
  Br: 8.865,
  I: 13.855,
  P: 6.92
};

/**
 * Estimates the molar refractivity using the Crippen atom-contribution method
 * (Wildman & Crippen, JCICS 1999).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number} Molar refractivity (cm³/mol) rounded to two decimal places.
 */
export function molarRefractivity(molecule) {
  assertMolecule(molecule, 'molecule');
  let sum = 0;
  for (const atom of _heavyAtoms(molecule)) {
    const key = _crippinKey(atom, molecule);
    if (key !== null) {
      sum += CRIPPEN_MR[key] ?? 0;
    }
  }
  return Math.round(sum * 100) / 100;
}

// ---------------------------------------------------------------------------
// Ring descriptors
// ---------------------------------------------------------------------------

/**
 * Returns the total number of rings (SSSR).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ count: number, atoms: string[][] }}
 */
export function ringCount(molecule) {
  assertMolecule(molecule, 'molecule');
  const atoms = _sortRings(molecule.getRings());
  return { count: atoms.length, atoms };
}

/**
 * Returns the number of fully-aromatic rings.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ count: number, atoms: string[][] }}
 */
export function aromaticRingCount(molecule) {
  assertMolecule(molecule, 'molecule');
  const atoms = _sortRings(
    molecule.getRings().filter(ring =>
      ring.every(atomId => {
        const a = molecule.atoms.get(atomId);
        return a && a.isAromatic();
      })
    )
  );
  return { count: atoms.length, atoms };
}

// ---------------------------------------------------------------------------
// Stereocenters
// ---------------------------------------------------------------------------

/**
 * Returns the number of defined stereocenters.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ count: number, atoms: string[] }}
 */
export function stereocenters(molecule) {
  assertMolecule(molecule, 'molecule');
  const atoms = _sortIds(molecule.getChiralCenters());
  return { count: atoms.length, atoms };
}

// ---------------------------------------------------------------------------
// Formal charge
// ---------------------------------------------------------------------------

/**
 * Returns the total formal charge of the molecule.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number}
 */
export function formalCharge(molecule) {
  assertMolecule(molecule, 'molecule');
  return molecule.getCharge();
}

// ---------------------------------------------------------------------------
// Veber rules
// ---------------------------------------------------------------------------

/**
 * Evaluates Veber's oral bioavailability rules:
 * TPSA ≤ 140 Å² AND rotatable bonds ≤ 10.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ tpsa: number, rotatableBonds: number, passes: boolean }}
 */
export function veberRules(molecule) {
  assertMolecule(molecule, 'molecule');
  const t = tpsa(molecule);
  const rb = rotatableBondCount(molecule);
  return { tpsa: t, rotatableBonds: rb.count, passes: t <= 140 && rb.count <= 10 };
}

// ---------------------------------------------------------------------------
// QED — Bickerton et al., Nat. Chem. 2012, 4, 90-98
// Approximate implementation: ADS function for MW/logP (exact Bickerton 2012
// parameters), Gaussian-bell functions for remaining properties.
// ---------------------------------------------------------------------------

/**
 * Asymmetric double-sigmoid (ADS) used by Bickerton 2012.
 * @private
 */
function _ads(x, a, b, c, d, e, f, dmax) {
  const sig1 = 1 / (1 + Math.exp(-(x - c + d / 2) / e));
  const sig2 = f > 0 ? 1 - 1 / (1 + Math.exp(-(x - c - d / 2) / f)) : x <= c + d / 2 ? 1 : 0;
  return Math.max(0, Math.min(1, (a + b * sig1 * sig2) / dmax));
}

/**
 * Bell desirability: 1 in [lo, hi], Gaussian decay outside with std σ.
 * @private
 */
function _bellExpD(x, lo, hi, sigma) {
  if (x < lo) {
    return Math.exp(-0.5 * ((lo - x) / sigma) ** 2);
  }
  if (x > hi) {
    return Math.exp(-0.5 * ((x - hi) / sigma) ** 2);
  }
  return 1;
}

// Bickerton 2012 Supplementary Table 1 ADS parameters for MW and logP
const _QED_MW_P = [2.817065973, 392.5754953, 290.7489764, 2.419764353, 49.22325677, 65.37051707, 104.9805561];
const _QED_LOGP_P = [3.172690585, 137.8624751, 2.534937, 4.581007086, 0.822739803, 0.576295313, 131.3186604];
// Weights for [MW, logP, HBD, HBA, PSA, RotBonds, ArRings] (Bickerton 2012, approx.)
const _QED_W = [0.66, 0.47, 0.05, 0.1, 0.09, 0.07, 0.44];

/**
 * Computes an approximate QED (Quantitative Estimate of Drug-likeness).
 *
 * Uses ADS desirability functions for MW and logP (exact Bickerton 2012
 * parameters) and Gaussian-bell approximations for HBD, HBA, TPSA,
 * rotatable bonds, and aromatic rings.  The weighted geometric mean follows
 * Bickerton et al. (Nat. Chem. 2012, 4, 90-98).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number} QED score in [0, 1] rounded to three decimal places.
 */
export function qed(molecule) {
  assertMolecule(molecule, 'molecule');
  const mw = molecularMass(molecule);
  const lp = logP(molecule);
  const hbd = hBondDonors(molecule);
  const hba = hBondAcceptors(molecule);
  const psa = tpsa(molecule);
  const rotb = rotatableBondCount(molecule);
  const arom = aromaticRingCount(molecule);

  const d = [
    _ads(mw, ..._QED_MW_P),
    _ads(lp, ..._QED_LOGP_P),
    _bellExpD(hbd.count, 0, 1, 1.5),
    _bellExpD(hba.count, 0, 8, 3.0),
    _bellExpD(psa, 30, 100, 35),
    _bellExpD(rotb.count, 0, 5, 3.0),
    _bellExpD(arom.count, 0, 3, 1.5)
  ];

  const wSum = _QED_W.reduce((s, v) => s + v, 0);
  let lnSum = 0;
  for (let i = 0; i < _QED_W.length; i++) {
    lnSum += _QED_W[i] * Math.log(Math.max(d[i], 1e-9));
  }
  return Math.round(Math.exp(lnSum / wSum) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Lipinski Rule of Five
// ---------------------------------------------------------------------------

/**
 * Evaluates Lipinski's Rule of Five for oral drug-likeness.
 *
 * Returns an object with individual descriptor values, the number of
 * violations, and a `passes` boolean (Lipinski allows one violation).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ molecularWeight: number, logP: number, hBondDonors: number,
 *             hBondAcceptors: number, violations: number, passes: boolean }}
 */
export function lipinskiRuleOfFive(molecule) {
  assertMolecule(molecule, 'molecule');
  const mw = molecularMass(molecule);
  const lp = logP(molecule);
  const hbd = hBondDonors(molecule);
  const hba = hBondAcceptors(molecule);
  const violations = [mw > 500, lp > 5, hbd.count > 5, hba.count > 10].filter(Boolean).length;
  return {
    molecularWeight: mw,
    logP: lp,
    hBondDonors: hbd.count,
    hBondAcceptors: hba.count,
    violations,
    passes: violations <= 1
  };
}
