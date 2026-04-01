/** @module app/ui/descriptors */

import { molecularFormula, molecularMass } from '../../descriptors/molecular.js';
import { allMatrices }    from '../../matrices/index.js';
import {
  wienerIndex, hyperWienerIndex, balabanIndex,
  randicIndex, zagreb1, zagreb2, hararyIndex,
  plattIndex, szegedIndex
} from '../../descriptors/topological.js';
import {
  logP, tpsa, hBondDonors, hBondAcceptors,
  rotatableBondCount, fsp3, lipinskiRuleOfFive,
  molarRefractivity, ringCount, aromaticRingCount,
  stereocenters, veberRules, qed
} from '../../descriptors/physicochemical.js';

function fmtVal(v) {
  if (v == null || !isFinite(v)) {
    return '—';
  }
  return Number.isInteger(v) ? v : v.toFixed(2);
}

const PC_DESCRIPTIONS = {
  'MW (Da)': 'Molecular weight in Daltons (average mass).',
  'Formal Charge': 'Net formal charge summed over all atoms.',
  'logP (Crippen)': 'Estimated lipophilicity using the Crippen atom-contribution method (Wildman & Crippen, 1999).',
  'MR (Crippen)': 'Molar refractivity (cm³/mol) estimated by Crippen atom contributions — reflects polarisability and molecular volume.',
  'TPSA (Å²)': 'Topological Polar Surface Area — sum of surface contributions from polar atoms (Ertl, 2000).',
  'HB Donors': 'Number of hydrogen-bond donors (NH and OH groups, Lipinski definition).',
  'HB Acceptors': 'Number of hydrogen-bond acceptors (N and O atoms, Lipinski definition).',
  'Rotatable Bonds': 'Count of single, non-aromatic, non-ring bonds between two non-terminal heavy atoms.',
  'Fsp3': 'Fraction of sp³ carbons — a measure of molecular complexity and three-dimensionality.',
  'Ring Count': 'Total number of rings (smallest set of smallest rings, SSSR).',
  'Aromatic Rings': 'Number of fully aromatic rings.',
  'Stereocenters': 'Number of atoms with a defined chirality annotation (@ or @@).',
  'Ro5 Violations': "Lipinski's Rule of Five: MW ≤ 500, logP ≤ 5, HBD ≤ 5, HBA ≤ 10. One violation is allowed.",
  'Veber Rules': 'Veber oral bioavailability rules: TPSA ≤ 140 Å² and rotatable bonds ≤ 10.',
  'QED': 'Quantitative Estimate of Drug-likeness (Bickerton 2012). Weighted geometric mean of MW, logP, HBD, HBA, TPSA, RotBonds, ArRings desirabilities. Approximate implementation.'
};

function escapeAttr(value) {
  return String(value).replace(/"/g, '&quot;');
}

function detailHighlightGroups(detail, molecule, label = '') {
  if (!detail) {
    return [];
  }
  if (Array.isArray(detail.atoms) && detail.atoms.length > 0) {
    if (Array.isArray(detail.atoms[0])) {
      return detail.atoms.map(group => [...group]);
    }
    if (label === 'Stereocenters') {
      return detail.atoms.map(atomId => [atomId]);
    }
    return [[...detail.atoms]];
  }
  if (Array.isArray(detail.bonds) && detail.bonds.length > 0) {
    return detail.bonds
      .map(bondId => molecule.bonds.get(bondId))
      .filter(Boolean)
      .map(bond => [...bond.atoms]);
  }
  return [];
}

export function updateDescriptors(molecule, extraH = 0) {
  const tbody = document.getElementById('descriptor-body');

  let heavyCount = 0;
  for (const atom of molecule.atoms.values()) {
    if (atom.name !== 'H') {
      heavyCount++;
    }
  }

  let rows = [
    ['Atoms (total)', molecule.atoms.size + extraH],
    ['Heavy atoms',   heavyCount],
    ['Bonds',         molecule.bonds.size]
  ];

  try {
    if (heavyCount >= 2) {
      const { adjacency, degree, distance, reciprocal } = allMatrices(molecule);
      const W   = wienerIndex(distance);
      const WW  = hyperWienerIndex(distance);
      const H   = hararyIndex(reciprocal);
      const chi = randicIndex(adjacency, degree);
      const M1  = zagreb1(degree);
      const M2  = zagreb2(adjacency, degree);
      const F   = plattIndex(adjacency, degree);
      const Sz  = szegedIndex(distance, adjacency);
      let J = null;
      try {
        J = balabanIndex(distance, adjacency);
      } catch {
        // Leave Balaban index blank when the graph is not suitable.
      }
      rows = rows.concat([
        ['Wiener Index (W)',   W],
        ['Hyper-Wiener (WW)',  WW],
        ['Harary Index (H)',   H],
        ['Balaban Index (J)',  J],
        ['Randić Index (χ)',   chi],
        ['Zagreb M1',         M1],
        ['Zagreb M2',         M2],
        ['Platt Index (F)',    F],
        ['Szeged Index (Sz)', Sz]
      ]);
    }
  } catch {
    // Keep the descriptor panel usable if a calculation fails.
  }

  tbody.innerHTML = rows
    .map(([label, val]) => `<tr><td>${label}</td><td>${fmtVal(val)}</td></tr>`)
    .join('');
  updatePhysicochemical(molecule);
}

export function updateFormula(molecule, extraH = 0) {
  const formula = molecularFormula(molecule);
  if (extraH > 0) {
    formula['H'] = (formula['H'] ?? 0) + extraH;
  }
  const CHNOPS = ['C', 'H', 'N', 'O', 'P', 'S'];
  const ordered = {};
  for (const el of CHNOPS) {
    if (el in formula) {
      ordered[el] = formula[el];
    }
  }
  for (const el of Object.keys(formula).sort()) {
    if (!(el in ordered)) {
      ordered[el] = formula[el];
    }
  }

  let html = Object.entries(ordered)
    .map(([el, n]) => n === 1 ? el : `${el}${n}`)
    .join('')
    .replace(/(\d+)/g, '<sub>$1</sub>');

  const charge = molecule.properties.charge ?? 0;
  if (charge !== 0) {
    const n = charge === 1 ? '+' : charge > 1 ? `${charge}+`
      : charge === -1 ? '−' : `${Math.abs(charge)}−`;
    html += `<sup>${n}</sup>`;
  }
  document.getElementById('molecularFormula').innerHTML = html;

  const mass = molecularMass(molecule) + extraH * 1.008;
  document.getElementById('molecularWeight').textContent =
        `${(Math.round(mass * 100) / 100).toFixed(2)} g/mol`;
}

export function updatePhysicochemical(molecule) {
  const tbody = document.getElementById('pc-body');
  if (!tbody) {
    return;
  }
  const rows = [];
  try {
    const mw   = molecularMass(molecule);
    const lp   = logP(molecule);
    const mr   = molarRefractivity(molecule);
    const tp   = tpsa(molecule);
    const hbd  = hBondDonors(molecule);
    const hba  = hBondAcceptors(molecule);
    const rot  = rotatableBondCount(molecule);
    const fs   = fsp3(molecule);
    const rc   = ringCount(molecule);
    const arc  = aromaticRingCount(molecule);
    const sc   = stereocenters(molecule);
    const ro5  = lipinskiRuleOfFive(molecule);
    const veb  = veberRules(molecule);
    const qedV = qed(molecule);
    rows.push(
      ['MW (Da)',          fmtVal(mw), null],
      ['logP (Crippen)',   fmtVal(lp), null],
      ['MR (Crippen)',     fmtVal(mr), null],
      ['TPSA (Å²)',        fmtVal(tp), null],
      ['HB Donors',        hbd.count, hbd],
      ['HB Acceptors',     hba.count, hba],
      ['Rotatable Bonds',  rot.count, rot],
      ['Fsp3',             fmtVal(fs), null],
      ['Ring Count',       rc.count, rc],
      ['Aromatic Rings',   arc.count, arc],
      ['Stereocenters',    sc.count, sc],
      ['Ro5 Violations',   `${ro5.violations} (${ro5.passes ? 'pass' : 'fail'})`, null],
      ['Veber Rules',      veb.passes ? 'pass' : 'fail', null],
      ['QED',              fmtVal(qedV), null]
    );
  } catch {
    // Leave physicochemical rows empty when descriptor calculation fails.
  }
  tbody.innerHTML = rows
    .map(([label, val, detail]) => {
      const desc = PC_DESCRIPTIONS[label] ?? '';
      const highlightGroups = detailHighlightGroups(detail, molecule, label);
      const highlightAttr = highlightGroups.length
        ? ` data-highlight="${escapeAttr(JSON.stringify(highlightGroups))}"`
        : '';
      return `<tr data-desc="${escapeAttr(desc)}"${highlightAttr}><td>${label}</td><td>${val}</td></tr>`;
    })
    .join('');
}
