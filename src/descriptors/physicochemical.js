/** @module descriptors/physicochemical */

import { molecularMass } from './molecular.js';

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
  C: 4, N: 3, O: 2, S: 2, P: 3,
  F: 1, Cl: 1, Br: 1, I: 1, B: 3
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
    if (other && ['O', 'N', 'S', 'P'].includes(other.name)) {
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
    if (other && ['C', 'S', 'P'].includes(other.name) && _hasMultipleBondToHetero(other, mol, bId)) {
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
    if (other && ['C', 'S', 'P'].includes(other.name) && _hasMultipleBondToHetero(other, mol, bId)) {
      return true;
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
  'C:sp3': 0.2940,
  'C:sp2': 0.1439,
  'C:aro': 0.1441,
  'C:sp': 0.0000,
  'N:sp3': -0.2729,
  'N:sp2': -0.1624,
  'N:aro': -0.3572,
  'N:+': -1.0187,
  'O:oh': -0.6820,   // alcohol / carboxylic acid OH (has implicit H)
  'O:ether': +0.1552,   // aliphatic ether or ester O (no H, sp3) — Wildman O1
  'O:sp2': -0.4962,   // carbonyl =O
  'O:aro': -0.4400,   // aromatic O
  'O:-': -0.9390,   // carboxylate O−
  'S': 0.2220,
  'F': 0.4202,
  'Cl': 0.6482,
  'Br': 0.8850,
  'I': 1.3500,
  'P': 0.4500
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
    const el  = atom.name;
    const h   = _attachedHydrogenCount(atom, molecule);
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
        sum += 9.23;  // ether
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
      sum += h >= 1 ? 38.80 : 25.30;
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
 * @returns {number}
 */
export function hBondDonors(molecule) {
  assertMolecule(molecule, 'molecule');
  return _heavyAtoms(molecule).filter(a =>
    (a.name === 'O' || a.name === 'N' || a.name === 'S') &&
    _attachedHydrogenCount(a, molecule) > 0
  ).length;
}

/**
 * Counts hydrogen-bond acceptors (all N and O atoms, Lipinski definition).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number}
 */
export function hBondAcceptors(molecule) {
  assertMolecule(molecule, 'molecule');
  return _heavyAtoms(molecule).filter(a => _isHBondAcceptor(a, molecule)).length;
}

// ---------------------------------------------------------------------------
// Rotatable bonds
// ---------------------------------------------------------------------------

/**
 * Counts rotatable bonds (single, non-aromatic, between two non-terminal
 * heavy atoms).  Delegates to {@link Bond#isRotatable}.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number}
 */
export function rotatableBondCount(molecule) {
  assertMolecule(molecule, 'molecule');
  return [...molecule.bonds.values()].filter(b => b.isRotatable(molecule)).length;
}

// ---------------------------------------------------------------------------
// Fraction sp3 (Fsp3)
// ---------------------------------------------------------------------------

/**
 * Computes the fraction of sp3 carbons (Fsp3), a measure of molecular
 * complexity and three-dimensionality.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number} Value in [0, 1] rounded to three decimal places.
 */
export function fsp3(molecule) {
  assertMolecule(molecule, 'molecule');
  const carbons = _heavyAtoms(molecule).filter(a => a.name === 'C');
  if (carbons.length === 0) {
    return 0;
  }
  const sp3Count = carbons.filter(a => _hybSp(a, molecule) === 'sp3').length;
  return Math.round((sp3Count / carbons.length) * 1000) / 1000;
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
  const mw  = molecularMass(molecule);
  const lp  = logP(molecule);
  const hbd = hBondDonors(molecule);
  const hba = hBondAcceptors(molecule);
  const violations = [
    mw  > 500,
    lp  > 5,
    hbd > 5,
    hba > 10
  ].filter(Boolean).length;
  return {
    molecularWeight: mw,
    logP: lp,
    hBondDonors: hbd,
    hBondAcceptors: hba,
    violations,
    passes: violations <= 1
  };
}
