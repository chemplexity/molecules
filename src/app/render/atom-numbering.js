/** @module app/render/atom-numbering */

let ctx = {};
let _atomNumberingActive = false;
const TWO_PI = Math.PI * 2;
const DEFAULT_NUMBERING_FALLBACK_ANGLE = -Math.PI / 4;
const DEFAULT_NUMBERING_ANGLE_STEPS = 72;

function _normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -Math.PI) {
    normalized += TWO_PI;
  }
  while (normalized > Math.PI) {
    normalized -= TWO_PI;
  }
  return normalized;
}

function _angularDistance(a, b) {
  return Math.abs(_normalizeAngle(a - b));
}

/**
 * Picks the placement angle for an atom annotation that maximizes clearance from all blocked sector angles.
 * @param {Array<{angle: number, spread: number}>} [blockedSectors] - Array of blocked angular sectors, each with a center angle and half-spread in radians.
 * @param {number} [fallbackAngle] - Default angle used when no blockedSectors are provided and as a tiebreaker.
 * @returns {number} Best placement angle in radians.
 */
export function pickAtomAnnotationAngle(blockedSectors = [], fallbackAngle = DEFAULT_NUMBERING_FALLBACK_ANGLE) {
  if (!Array.isArray(blockedSectors) || blockedSectors.length === 0) {
    return fallbackAngle;
  }

  let bestAngle = fallbackAngle;
  let bestClearance = -Infinity;
  let bestFallbackDistance = Infinity;
  for (let step = 0; step < DEFAULT_NUMBERING_ANGLE_STEPS; step++) {
    const angle = -Math.PI + (step / DEFAULT_NUMBERING_ANGLE_STEPS) * TWO_PI;
    let clearance = Infinity;
    for (const sector of blockedSectors) {
      const spread = Math.max(0, sector?.spread ?? 0);
      const separation = _angularDistance(angle, sector?.angle ?? 0) - spread;
      clearance = Math.min(clearance, separation);
    }
    const fallbackDistance = _angularDistance(angle, fallbackAngle);
    if (clearance > bestClearance + 1e-6 || (Math.abs(clearance - bestClearance) <= 1e-6 && fallbackDistance < bestFallbackDistance)) {
      bestAngle = angle;
      bestClearance = clearance;
      bestFallbackDistance = fallbackDistance;
    }
  }
  return bestAngle;
}

/**
 * Computes the radial distance (in pixels) from an atom center to place an atom-numbering label.
 * @param {number} fontSize - Current font size in pixels.
 * @param {string} [label] - Label text whose length influences the offset.
 * @returns {number} Pixel distance from the atom center to the label.
 */
export function atomNumberingLabelDistance(fontSize, label = '') {
  const labelLength = String(label).length;
  return Math.max(15, Math.round(fontSize + 6 + Math.max(0, labelLength - 1) * 2));
}

/**
 * Computes the angular blocker direction introduced by one side of a multiple bond to guide atom annotation placement.
 * @param {{x: number, y: number}} start - SVG coordinates of the bond's start atom.
 * @param {{x: number, y: number}} end - SVG coordinates of the bond's end atom.
 * @param {number} [side] - Which side of the bond (+1 or -1) the parallel line lies on.
 * @param {number} [forwardBias] - Weight applied to the along-bond direction in the blocker angle blend.
 * @returns {number|null} Blocker angle in radians, or null if the bond has zero length.
 */
export function multipleBondSideBlockerAngle(start, end, side = 1, forwardBias = 0.45) {
  const dx = (end?.x ?? 0) - (start?.x ?? 0);
  const dy = (end?.y ?? 0) - (start?.y ?? 0);
  const len = Math.hypot(dx, dy) || 1;
  if (!Number.isFinite(len) || len <= 0) {
    return null;
  }
  const ux = dx / len;
  const uy = dy / len;
  const perpX = (-dy / len) * (side >= 0 ? 1 : -1);
  const perpY = (dx / len) * (side >= 0 ? 1 : -1);
  return Math.atan2(uy * forwardBias + perpY, ux * forwardBias + perpX);
}

/**
 * Initializes the atom-numbering panel renderer with the app context it
 * needs to redraw the active molecule in either 2D or force mode.
 * @param {object} context - App context object.
 * @param {'2d'|'force'} context.mode - Current layout mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context.currentMol - Active molecule in force mode.
 * @param {import('../../core/Molecule.js').Molecule|null} context._mol2d - Active molecule in 2D mode.
 * @param {() => void} context.draw2d - Triggers a 2D redraw.
 * @param {(mol: object, options?: object) => void} context.updateForce - Triggers a force-layout redraw.
 * @param {() => boolean} [context.hasReactionPreview] - Returns true when a reaction preview is active.
 * @param {() => Set<string>} [context.getReactionPreviewReactantAtomIds] - Returns reactant atom IDs for the current reaction preview.
 * @param {() => Array<Array<string>>} [context.getReactionPreviewMappedAtomPairs] - Returns mapped atom pairs for the current reaction preview.
 */
export function initAtomNumberingPanel(context) {
  ctx = context;
}

function _currentDisplayedMol() {
  return ctx.mode === 'force' ? (ctx.currentMol ?? null) : (ctx._mol2d ?? null);
}

function _otherPanelRow({ label, title, active, onClick }) {
  const tr = document.createElement('tr');
  tr.classList.add('resonance-clickable');
  tr.title = title;
  if (active) {
    tr.classList.add('resonance-active');
  }

  const nameCell = document.createElement('td');
  const countCell = document.createElement('td');
  countCell.className = 'reaction-count';
  countCell.textContent = active ? 'On' : 'Off';

  const name = document.createElement('div');
  name.className = 'reaction-name';
  name.textContent = label;
  nameCell.appendChild(name);

  tr.appendChild(nameCell);
  tr.appendChild(countCell);
  tr.addEventListener('click', onClick);
  return tr;
}

/**
 * Returns whether the atom numbering overlay is currently active.
 * @returns {boolean} True if the atom numbering overlay is active.
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
 * Product atoms that map to a reactant atom of the same element inherit that
 * reactant atom's number.  If the element changes across the mapping (e.g.
 * O→Cl in alcohol halogenation) the product atom is treated as new.
 * Unmapped product H atoms whose parent heavy atom is mapped inherit an available
 * reactant H number from that parent's H pool, so unchanged hydrogens keep their
 * original numbers. Truly new atoms (no inferred source) get fresh numbers.
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to number atoms in.
 * @returns {Map<string, number>|null} Map from atom ID to 1-based atom number, or null when overlay is inactive.
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
    // unmapped product H → infer from parent heavy atom's reactant H atoms;
    // truly new atoms → continue numbering after reactant atoms.

    // Build: reactant heavy atom id → ordered list of its reactant H atom ids.
    const reactantHeavyToHs = new Map();
    for (const [id, atom] of mol.atoms) {
      if (reactantAtomIds.has(id) && atom.name === 'H') {
        const parentHeavy = atom.getNeighbors(mol).find(nb => nb.name !== 'H');
        if (parentHeavy) {
          if (!reactantHeavyToHs.has(parentHeavy.id)) {
            reactantHeavyToHs.set(parentHeavy.id, []);
          }
          reactantHeavyToHs.get(parentHeavy.id).push(id);
        }
      }
    }

    // Track reactant H ids already claimed by an explicit mapping entry.
    const usedReactantHs = new Set();
    for (const [srcId] of mappedAtomPairs) {
      if (mol.atoms.get(srcId)?.name === 'H') {
        usedReactantHs.add(srcId);
      }
    }

    // Pass 1: explicit mappings (only when the element is preserved).
    const unmappedProductAtoms = [];
    for (const [id, atom] of mol.atoms) {
      if (!reactantAtomIds.has(id)) {
        const sourceId = productToSource.get(id);
        if (sourceId != null && numbers.has(sourceId)) {
          const srcAtom = mol.atoms.get(sourceId);
          if (!srcAtom || srcAtom.name === atom.name) {
            // Same element: inherit the reactant number.
            numbers.set(id, numbers.get(sourceId));
          } else {
            // Element changed (e.g. O→Cl): treat product atom as new.
            unmappedProductAtoms.push([id, atom]);
          }
        } else {
          unmappedProductAtoms.push([id, atom]);
        }
      }
    }

    // Pass 2: for unmapped product H atoms, inherit from parent's reactant H pool.
    const unmappedHeavy = [];
    const newProductHs = [];
    for (const [id, atom] of unmappedProductAtoms) {
      if (atom.name !== 'H') {
        unmappedHeavy.push(id);
      } else {
        const parentHeavy = atom.getNeighbors(mol).find(nb => nb.name !== 'H');
        let inherited = false;
        if (parentHeavy && !reactantAtomIds.has(parentHeavy.id)) {
          const srcHeavyId = productToSource.get(parentHeavy.id);
          if (srcHeavyId != null) {
            const available = (reactantHeavyToHs.get(srcHeavyId) ?? []).filter(hid => !usedReactantHs.has(hid));
            if (available.length > 0) {
              usedReactantHs.add(available[0]);
              numbers.set(id, numbers.get(available[0]));
              inherited = true;
            }
          }
        }
        if (!inherited) {
          newProductHs.push(id);
        }
      }
    }
    for (const id of unmappedHeavy) {
      numbers.set(id, n++);
    }
    for (const id of newProductHs) {
      numbers.set(id, n++);
    }
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
 * @param {import('../../core/Molecule.js').Molecule|null} mol - The molecule to render the panel for.
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

  tbody.appendChild(
    _otherPanelRow({
      label: 'Atom Numbering',
      title: 'Display sequential atom indices. Non-hydrogen atoms are numbered first, then hydrogen atoms.',
      active: _atomNumberingActive,
      onClick: event => {
        event.stopPropagation();
        _atomNumberingActive = !_atomNumberingActive;
        const displayedMol = _currentDisplayedMol() ?? mol;
        updateAtomNumberingPanel(displayedMol);
        _redraw(displayedMol);
      }
    })
  );

  const showLonePairs = Boolean(ctx.getRenderOptions?.().showLonePairs);
  tbody.appendChild(
    _otherPanelRow({
      label: 'Lone Pairs',
      title: 'Display lone pair dots on atoms when available.',
      active: showLonePairs,
      onClick: event => {
        event.stopPropagation();
        ctx.updateRenderOptions?.({ showLonePairs: !showLonePairs });
        const displayedMol = _currentDisplayedMol() ?? mol;
        updateAtomNumberingPanel(displayedMol);
        _redraw(displayedMol);
      }
    })
  );
}

function _redraw(mol) {
  if (ctx.mode === 'force') {
    ctx.updateForce(mol, { preservePositions: true, preserveView: true });
  } else {
    ctx.draw2d();
  }
}
