/** @module app/ui/descriptors */

import { molecularFormula, molecularMass } from '../../descriptors/molecular.js';
import { toJSON } from '../../io/json.js';
import { allMatrices } from '../../matrices/index.js';
import {
  abcIndex,
  balabanIndex,
  eccentricConnectivityIndex,
  forgottenIndex,
  gaIndex,
  gutmanIndex,
  hararyIndex,
  harmonicIndex,
  hosoyaIndex,
  hyperWienerIndex,
  narumiKatayamaIndex,
  plattIndex,
  randicIndex,
  schultzIndex,
  sumConnectivityIndex,
  szegedIndex,
  wienerIndex,
  wienerPolarityIndex,
  zagreb1,
  zagreb2
} from '../../descriptors/topological.js';
import {
  logP,
  tpsa,
  hBondDonors,
  hBondAcceptors,
  rotatableBondCount,
  fsp3,
  lipinskiRuleOfFive,
  molarRefractivity,
  ringCount,
  aromaticRingCount,
  stereocenters,
  veberRules,
  qed
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
  'Fsp3 (carbons)': 'Fraction of sp³ carbons — a measure of molecular complexity and three-dimensionality.',
  'Ring Count': 'Total number of rings (smallest set of smallest rings, SSSR).',
  'Aromatic Rings': 'Number of fully aromatic rings.',
  Stereocenters: 'Number of atoms with a defined chirality annotation (@ or @@).',
  'Ro5 Violations': "Lipinski's Rule of Five: MW ≤ 500, logP ≤ 5, HBD ≤ 5, HBA ≤ 10. One violation is allowed.",
  'Veber Rules': 'Veber oral bioavailability rules: TPSA ≤ 140 Å² and rotatable bonds ≤ 10.',
  QED: 'Quantitative Estimate of Drug-likeness (Bickerton 2012). Weighted geometric mean of MW, logP, HBD, HBA, TPSA, RotBonds, ArRings desirabilities. Approximate implementation.'
};

const TOPOLOGICAL_DESCRIPTIONS = {
  'Atoms (total)': 'Total number of atoms, including implicit hydrogens.',
  'Heavy atoms': 'Number of non-hydrogen atoms. Graph indices below are computed on this hydrogen-suppressed graph.',
  Bonds: 'Number of explicit bonds in the molecular graph.',
  'Wiener Index (W)': 'Sum of shortest-path distances between all atom pairs (Wiener, 1947). Measures molecular size and compactness; branching lowers it. Correlates with boiling point.',
  'Hyper-Wiener (WW)': 'Wiener variant that also sums squared distances, weighting distant atom pairs more heavily. More sensitive to branching than W.',
  'Harary Index (H)': 'Sum of reciprocal distances between all atom pairs. Emphasises nearby atoms; higher for compact, densely connected molecules.',
  'Balaban Index (J)': 'Average distance-sum connectivity, normalised by ring count (Balaban, 1982). Highly discriminating for branching and largely independent of molecular size.',
  'Randić Index (χ)': 'Sum of (deg·deg)^−½ over bonds (Randić, 1975). Measures branching; widely used in QSAR for boiling point, solubility, and surface area.',
  'Zagreb M1': 'Sum of squared atom degrees (Gutman & Trinajstić, 1972). Reflects branching and the total π-electron energy.',
  'Zagreb M2': 'Sum of degree products over bonds. Captures branching through how highly connected atoms are linked to each other.',
  'Platt Index (F)': 'Total number of bonds adjacent to each bond (Platt, 1947). Measures local bond connectivity; correlates with physical properties of alkanes.',
  'Szeged Index (Sz)': 'Sum over bonds of the number of atoms closer to each end (Gutman, 1994). Equals the Wiener index for acyclic molecules, so it extends W to rings.',
  'Atom-Bond Connectivity (ABC)': 'Degree-based bond sum (Estrada, 1998) designed to model the stability of linear and branched alkanes and their heats of formation.',
  'Geometric-Arithmetic (GA)': 'Sum over bonds of the geometric/arithmetic mean ratio of atom degrees. Measures how evenly connectivity is distributed across bonds.',
  'Harmonic Index': 'Sum over bonds of 2/(deg+deg). A connectivity measure related to Randić χ, sensitive to branching.',
  'Sum-Connectivity (χs)': 'Sum over bonds of (deg+deg)^−½ (Zhou & Trinajstić, 2009). Randić variant that correlates closely with π-electron energy and physical properties.',
  'Eccentric Connectivity (ξ)': 'Sum of atom degree × eccentricity (greatest distance to any other atom). Combines connectivity with molecular shape; used in activity prediction.',
  'Wiener Polarity (Wp)':
    'Number of atom pairs exactly three bonds apart (Wiener, 1947), i.e. the torsion-defining paths. Used alongside W to predict alkane boiling points; it does not measure electrical polarity.',
  'Schultz Index (MTI)': 'Molecular Topological Index (Schultz, 1989): distances weighted by the sum of atom degrees. Combines size, shape, and branching.',
  'Gutman Index (Gut)': 'Distances weighted by the product of atom degrees. Like Schultz MTI, it blends molecular size with branching.',
  'Forgotten Index (F₃)': 'Sum of cubed atom degrees (Furtula & Gutman, 2015). Strongly emphasises highly branched atoms; correlates with entropy and acentric factor.',
  'Narumi-Katayama (NK)': 'Product of all atom degrees. A simple multiplicative measure of branching.',
  'Hosoya Index (Z)':
    'Number of ways to choose non-adjacent bonds (matchings) (Hosoya, 1971). Correlates with boiling point and π-electron properties. Computed automatically for ≤18 heavy atoms; larger molecules use the Compute button.'
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
    if (label === 'Stereocenters' || label === 'Fsp3 (carbons)') {
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

const HOSOYA_MAX_HEAVY_ATOMS = 18;
const HOSOYA_LABEL = 'Hosoya Index (Z)';
const HOSOYA_COMPUTE_TITLE = `Hosoya Z counts every set of non-adjacent bonds, so its cost grows exponentially with molecule size. It is computed automatically only up to ${HOSOYA_MAX_HEAVY_ATOMS} heavy atoms; larger molecules can take seconds to minutes. The calculation runs in the background and can be cancelled.`;

// Single in-flight or finished Hosoya calculation, keyed by the heavy-atom bond graph.
let hosoyaJob = null;

/**
 * Computes the rows displayed by the topological descriptor panel.
 * @param {object} molecule - Molecule graph to analyze.
 * @param {number} [extraH] - Additional implicit hydrogen count.
 * @returns {Array<[string, number|null]>} Label/value rows.
 */
export function topologicalDescriptorRows(molecule, extraH = 0) {
  const heavyCount = heavyAtomCount(molecule);
  let rows = [
    ['Atoms (total)', molecule.atoms.size + extraH],
    ['Heavy atoms', heavyCount],
    ['Bonds', molecule.bonds.size]
  ];

  try {
    if (heavyCount >= 2) {
      const { adjacency, degree, distance, reciprocal } = allMatrices(molecule);
      let J = null;
      try {
        J = balabanIndex(distance, adjacency);
      } catch {
        // Leave Balaban index blank when the graph is not suitable.
      }
      rows = rows.concat([
        ['Wiener Index (W)', wienerIndex(distance)],
        ['Hyper-Wiener (WW)', hyperWienerIndex(distance)],
        ['Harary Index (H)', hararyIndex(reciprocal)],
        ['Balaban Index (J)', J],
        ['Randić Index (χ)', randicIndex(adjacency, degree)],
        ['Zagreb M1', zagreb1(degree)],
        ['Zagreb M2', zagreb2(adjacency, degree)],
        ['Platt Index (F)', plattIndex(adjacency, degree)],
        ['Szeged Index (Sz)', szegedIndex(distance, adjacency)],
        ['Atom-Bond Connectivity (ABC)', abcIndex(adjacency, degree)],
        ['Geometric-Arithmetic (GA)', gaIndex(adjacency, degree)],
        ['Harmonic Index', harmonicIndex(adjacency, degree)],
        ['Sum-Connectivity (χs)', sumConnectivityIndex(adjacency, degree)],
        ['Eccentric Connectivity (ξ)', eccentricConnectivityIndex(adjacency, degree, distance)],
        ['Wiener Polarity (Wp)', wienerPolarityIndex(distance)],
        ['Schultz Index (MTI)', schultzIndex(degree, distance)],
        ['Gutman Index (Gut)', gutmanIndex(degree, distance)],
        ['Forgotten Index (F₃)', forgottenIndex(degree)],
        ['Narumi-Katayama (NK)', narumiKatayamaIndex(degree)],
        [HOSOYA_LABEL, heavyCount <= HOSOYA_MAX_HEAVY_ATOMS ? hosoyaIndex(molecule) : null]
      ]);
    }
  } catch {
    // Keep the descriptor panel usable if a calculation fails.
  }
  return rows;
}

/**
 * Recalculates and renders graph-theoretical descriptors for the given molecule into the descriptor panel.
 * @param {object} molecule - Molecule object whose descriptors will be computed.
 * @param {number} [extraH] - Additional implicit hydrogen count to include in atom totals.
 */
export function updateDescriptors(molecule, extraH = 0) {
  const tbody = document.getElementById('descriptor-body');
  if (!tbody) {
    return;
  }

  const rows = topologicalDescriptorRows(molecule, extraH);
  const deferHosoya = heavyAtomCount(molecule) > HOSOYA_MAX_HEAVY_ATOMS && typeof Worker !== 'undefined';
  const hosoyaKey = deferHosoya ? hosoyaGraphKey(molecule) : null;
  if (hosoyaJob && hosoyaJob.key !== hosoyaKey) {
    cancelHosoyaJob();
  }
  tbody.innerHTML = rows
    .map(([label, val]) => {
      const desc = TOPOLOGICAL_DESCRIPTIONS[label];
      const descAttr = desc ? ` data-desc="${escapeAttr(desc)}"` : '';
      const valueCell = label === HOSOYA_LABEL && deferHosoya ? '<td data-hosoya></td>' : `<td>${fmtVal(val)}</td>`;
      return `<tr${descAttr}><td>${label}</td>${valueCell}</tr>`;
    })
    .join('');
  if (deferHosoya) {
    renderHosoyaCell(tbody, molecule, hosoyaKey);
  }
  updatePhysicochemical(molecule);
}

function heavyAtomCount(molecule) {
  return [...molecule.atoms.values()].filter(atom => atom.name !== 'H').length;
}

function hosoyaGraphKey(molecule) {
  const isHeavy = id => molecule.atoms.get(id)?.name !== 'H';
  return [...molecule.bonds.values()]
    .filter(bond => bond.atoms.every(isHeavy))
    .map(bond => [...bond.atoms].sort().join('-'))
    .sort()
    .join(',');
}

function cancelHosoyaJob() {
  hosoyaJob?.worker?.terminate();
  hosoyaJob = null;
}

function renderHosoyaCell(tbody, molecule, key) {
  const cell = tbody.querySelector('td[data-hosoya]');
  if (!cell) {
    return;
  }
  if (hosoyaJob?.value != null) {
    cell.textContent = fmtVal(hosoyaJob.value);
    return;
  }
  const running = !!hosoyaJob?.worker;
  cell.innerHTML = `<button type="button" class="hosoya-compute${running ? ' running' : ''}" title="${escapeAttr(HOSOYA_COMPUTE_TITLE)}">${running ? 'Cancel' : 'Compute'}</button>`;
  cell.querySelector('button').addEventListener('click', () => {
    if (hosoyaJob?.worker) {
      cancelHosoyaJob();
    } else {
      startHosoyaJob(tbody, molecule, key);
    }
    renderHosoyaCell(tbody, molecule, key);
  });
}

function startHosoyaJob(tbody, molecule, key) {
  const worker = new Worker(new URL('./hosoya-worker.js', import.meta.url), { type: 'module' });
  const job = { key, worker, value: null };
  hosoyaJob = job;
  const finish = value => {
    worker.terminate();
    if (hosoyaJob !== job) {
      return;
    }
    hosoyaJob = value == null ? null : { key, worker: null, value };
    if (tbody.isConnected) {
      renderHosoyaCell(tbody, molecule, key);
    }
  };
  worker.onmessage = event => finish(event.data);
  worker.onerror = () => finish(null);
  worker.postMessage(toJSON(molecule));
}

/**
 * Updates the molecular formula and molecular weight display elements for the given molecule.
 * @param {object} molecule - Molecule object used to compute the formula and mass.
 * @param {number} [extraH] - Additional implicit hydrogen count to add to the formula.
 */
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
    .map(([el, n]) => (n === 1 ? el : `${el}${n}`))
    .join('')
    .replace(/(\d+)/g, '<sub>$1</sub>');

  const charge = molecule.properties.charge ?? 0;
  if (charge !== 0) {
    const n = charge === 1 ? '+' : charge > 1 ? `${charge}+` : charge === -1 ? '−' : `${Math.abs(charge)}−`;
    html += `<sup>${n}</sup>`;
  }
  document.getElementById('molecularFormula').innerHTML = html;

  const mass = molecularMass(molecule) + extraH * 1.008;
  document.getElementById('molecularWeight').textContent = `${(Math.round(mass * 100) / 100).toFixed(2)} g/mol`;
}

/**
 * Recalculates and renders physicochemical properties for the given molecule into the physchem panel.
 * @param {object} molecule - Molecule object whose physicochemical properties will be computed.
 */
export function updatePhysicochemical(molecule) {
  const tbody = document.getElementById('pc-body');
  if (!tbody) {
    return;
  }
  const rows = [];
  try {
    const mw = molecularMass(molecule);
    const lp = logP(molecule);
    const mr = molarRefractivity(molecule);
    const tp = tpsa(molecule);
    const hbd = hBondDonors(molecule);
    const hba = hBondAcceptors(molecule);
    const rot = rotatableBondCount(molecule);
    const fs = fsp3(molecule);
    const rc = ringCount(molecule);
    const arc = aromaticRingCount(molecule);
    const sc = stereocenters(molecule);
    const ro5 = lipinskiRuleOfFive(molecule);
    const veb = veberRules(molecule);
    const qedV = qed(molecule);
    rows.push(
      ['MW (Da)', fmtVal(mw), null],
      ['logP (Crippen)', fmtVal(lp), null],
      ['MR (Crippen)', fmtVal(mr), null],
      ['TPSA (Å²)', fmtVal(tp), null],
      ['HB Donors', hbd.count, hbd],
      ['HB Acceptors', hba.count, hba],
      ['Rotatable Bonds', rot.count, rot],
      ['Fsp3 (carbons)', fmtVal(fs.value), fs],
      ['Ring Count', rc.count, rc],
      ['Aromatic Rings', arc.count, arc],
      ['Stereocenters', sc.count, sc],
      ['Ro5 Violations', `${ro5.violations} (${ro5.passes ? 'pass' : 'fail'})`, null],
      ['Veber Rules', veb.passes ? 'pass' : 'fail', null],
      ['QED', fmtVal(qedV), null]
    );
  } catch {
    // Leave physicochemical rows empty when descriptor calculation fails.
  }
  tbody.innerHTML = rows
    .map(([label, val, detail]) => {
      const desc = PC_DESCRIPTIONS[label] ?? '';
      const highlightGroups = detailHighlightGroups(detail, molecule, label);
      const highlightAttr = detail ? ` data-highlight="${escapeAttr(JSON.stringify(highlightGroups))}"` : '';
      return `<tr data-desc="${escapeAttr(desc)}"${highlightAttr}><td>${label}</td><td>${val}</td></tr>`;
    })
    .join('');
}
