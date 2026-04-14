/** @module app/render/bond-lengths-overlay */

import { getBondLength } from '../../data/bond-lengths.js';
import { getBondLengthsActive, refreshBondEnPanel, registerBondLengthsPanelUpdater, setBondEnActive, setBondLengthsActive } from './bond-overlay-state.js';
export { getBondLengthsActive } from './bond-overlay-state.js';

let ctx = {};

/**
 * Initializes the bond-lengths panel renderer with the app context it needs to
 * redraw the active molecule in either 2D or force mode.
 * @param {object} context - App context object.
 */
export function initBondLengthsPanel(context) {
  ctx = context;
  registerBondLengthsPanelUpdater(updateBondLengthsPanel);
}

function _currentDisplayedMol() {
  return ctx.mode === 'force' ? (ctx.currentMol ?? null) : (ctx._mol2d ?? null);
}

/**
 * Returns overlay data for rendering bond length labels, or null when the
 * overlay is inactive. Each entry provides the bond ID and a display label
 * in Angstroms (Å) for the average covalent bond length of that pair and order.
 * Returns null for bonds with no data in the lookup table.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to compute overlay data for.
 * @returns {Array<{bondId: string, label: string}>|null} Per-bond length entries, or null when inactive.
 */
export function getBondLengthsOverlayData(mol) {
  if (!getBondLengthsActive() || !mol) {
    return null;
  }
  const entries = [];
  for (const bond of mol.bonds.values()) {
    const atomA = mol.atoms.get(bond.atoms[0]);
    const atomB = mol.atoms.get(bond.atoms[1]);
    if (!atomA || !atomB) {
      continue;
    }
    // Deuterium shares hydrogen's bond lengths
    const symbolA = atomA.name === 'D' ? 'H' : atomA.name;
    const symbolB = atomB.name === 'D' ? 'H' : atomB.name;
    const order = bond.properties.aromatic ? 'aromatic' : bond.properties.kind === 'dative' ? 'dative' : (bond.properties.order ?? 1);
    const length = getBondLength(symbolA, symbolB, order);
    if (length === null) {
      continue;
    }
    entries.push({ bondId: bond.id, label: length.toFixed(2) });
  }
  return entries.length > 0 ? entries : null;
}

/**
 * Clears the bond-lengths panel UI state and deactivates the overlay.
 */
export function clearBondLengthsPanel() {
  setBondLengthsActive(false);
  const tbody = document.getElementById('bond-lengths-body');
  if (tbody) {
    tbody.innerHTML = '';
  }
}

/**
 * Renders or refreshes the Bond Lengths toggle row.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to render the panel for.
 */
export function updateBondLengthsPanel(mol) {
  if (typeof document === 'undefined') {
    return;
  }
  const tbody = document.getElementById('bond-lengths-body');
  if (!tbody) {
    return;
  }
  if (!mol) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = '';

  const tr = document.createElement('tr');
  tr.classList.add('resonance-clickable');
  tr.title = 'Average covalent bond length (Å) per bond from crystallographic data (CRC Handbook / CCDC survey).';
  if (getBondLengthsActive()) {
    tr.classList.add('resonance-active');
  }

  const nameCell = document.createElement('td');
  const countCell = document.createElement('td');
  countCell.className = 'reaction-count';
  countCell.textContent = getBondLengthsActive() ? 'On' : 'Off';

  const name = document.createElement('div');
  name.className = 'reaction-name';
  name.textContent = 'Bond Lengths';
  nameCell.appendChild(name);

  tr.appendChild(nameCell);
  tr.appendChild(countCell);

  tr.addEventListener('click', event => {
    event.stopPropagation();
    const nextActive = !getBondLengthsActive();
    setBondLengthsActive(nextActive);
    if (nextActive) {
      setBondEnActive(false);
    }
    const displayedMol = _currentDisplayedMol() ?? mol;
    updateBondLengthsPanel(displayedMol);
    if (nextActive) {
      refreshBondEnPanel(displayedMol);
    }
    _redraw(displayedMol);
  });

  tbody.appendChild(tr);
}

function _redraw(mol) {
  if (ctx.mode === 'force') {
    ctx.updateForce(mol, { preservePositions: true, preserveView: true });
  } else {
    ctx.draw2d();
  }
}
