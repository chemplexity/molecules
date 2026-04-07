/** @module app/render/atom-numbering */

let ctx = {};
let _atomNumberingActive = false;

/**
 * Initializes the atom-numbering panel renderer with the app context it
 * needs to redraw the active molecule in either 2D or force mode.
 *
 * @param {object} context
 * @param {'2d'|'force'} context.mode
 * @param {import('../../core/Molecule.js').Molecule|null} context.currentMol
 * @param {import('../../core/Molecule.js').Molecule|null} context._mol2d
 * @param {Function} context.draw2d
 * @param {Function} context.updateForce
 * @param {Function} [context.hasReactionPreview]
 * @param {Function} [context.getReactionPreviewReactantAtomIds]
 * @param {Function} [context.getReactionPreviewMappedAtomPairs]
 */
export function initAtomNumberingPanel(context) {
  ctx = context;
}

function _currentDisplayedMol() {
  return ctx.mode === 'force' ? (ctx.currentMol ?? null) : (ctx._mol2d ?? null);
}

/**
 * Returns whether the atom numbering overlay is currently active.
 *
 * @returns {boolean}
 */
export function getAtomNumberingActive() {
  return _atomNumberingActive;
}

/**
 * Returns a Map from atom id to 1-based atom number for the given molecule,
 * or null when the overlay is inactive.
 *
 * In normal mode, non-hydrogen atoms are numbered first in molecule iteration
 * order, followed by hydrogen atoms.
 *
 * In reaction preview mode, reactant atoms are numbered first (heavy then H).
 * Product atoms that map to a reactant atom inherit that reactant atom's number.
 * Unmapped product atoms are omitted.
 *
 * @param {import('../../core/Molecule.js').Molecule|null} mol
 * @returns {Map<string, number>|null}
 */
export function getAtomNumberMap(mol) {
  if (!_atomNumberingActive || !mol) {
    return null;
  }

  const inPreview = ctx.hasReactionPreview?.();
  const reactantAtomIds = inPreview ? ctx.getReactionPreviewReactantAtomIds?.() : null;
  const mappedAtomPairs = inPreview ? (ctx.getReactionPreviewMappedAtomPairs?.() ?? []) : [];

  const numbers = new Map();

  if (reactantAtomIds?.size > 0) {
    // Build product → source lookup from the mapped pairs.
    const productToSource = new Map(mappedAtomPairs.map(([src, prod]) => [prod, src]));
    let n = 1;
    // Heavy reactant atoms first.
    for (const [id, atom] of mol.atoms) {
      if (reactantAtomIds.has(id) && atom.name !== 'H') {
        numbers.set(id, n++);
      }
    }
    // Hydrogen reactant atoms.
    for (const [id, atom] of mol.atoms) {
      if (reactantAtomIds.has(id) && atom.name === 'H') {
        numbers.set(id, n++);
      }
    }
    // Product atoms: mapped → inherit source number;
    // unmapped (new atoms in the product) → continue numbering after reactant atoms.
    const unmappedHeavy = [];
    const unmappedH = [];
    for (const [id, atom] of mol.atoms) {
      if (!reactantAtomIds.has(id)) {
        const sourceId = productToSource.get(id);
        if (sourceId != null && numbers.has(sourceId)) {
          numbers.set(id, numbers.get(sourceId));
        } else if (atom.name !== 'H') {
          unmappedHeavy.push(id);
        } else {
          unmappedH.push(id);
        }
      }
    }
    for (const id of unmappedHeavy) { numbers.set(id, n++); }
    for (const id of unmappedH) { numbers.set(id, n++); }
  } else {
    let n = 1;
    for (const [id, atom] of mol.atoms) {
      if (atom.name !== 'H') {
        numbers.set(id, n++);
      }
    }
    for (const [id, atom] of mol.atoms) {
      if (atom.name === 'H') {
        numbers.set(id, n++);
      }
    }
  }

  return numbers;
}

/**
 * Clears the atom-numbering panel UI state and deactivates the overlay.
 */
export function clearAtomNumberingPanel() {
  _atomNumberingActive = false;
  const tbody = document.getElementById('atom-numbering-body');
  if (tbody) {
    tbody.innerHTML = '';
  }
}

/**
 * Renders or refreshes the Atom Numbering toggle row.
 *
 * @param {import('../../core/Molecule.js').Molecule|null} mol
 */
export function updateAtomNumberingPanel(mol) {
  if (typeof document === 'undefined') {
    return;
  }
  const tbody = document.getElementById('atom-numbering-body');
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
  tr.title = 'Display sequential atom indices. Non-hydrogen atoms are numbered first, then hydrogen atoms.';
  if (_atomNumberingActive) {
    tr.classList.add('resonance-active');
  }

  const nameCell = document.createElement('td');
  const countCell = document.createElement('td');
  countCell.className = 'reaction-count';
  countCell.textContent = _atomNumberingActive ? 'On' : 'Off';

  const name = document.createElement('div');
  name.className = 'reaction-name';
  name.textContent = 'Atom Numbering';
  nameCell.appendChild(name);

  tr.appendChild(nameCell);
  tr.appendChild(countCell);

  tr.addEventListener('click', event => {
    event.stopPropagation();
    _atomNumberingActive = !_atomNumberingActive;
    const displayedMol = _currentDisplayedMol() ?? mol;
    updateAtomNumberingPanel(displayedMol);
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
