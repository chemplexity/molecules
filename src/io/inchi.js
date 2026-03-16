/** @module io/inchi */

import elements from '../data/elements.js';
import { Molecule } from '../core/Molecule.js';

// ---------------------------------------------------------------------------
// Internal helpers — layer parsers
// ---------------------------------------------------------------------------

/**
 * Parses an InChI formula string into an ordered array of heavy-atom element
 * symbols (1-indexed; index 0 is a null placeholder).
 *
 * Ordering follows Hill convention without hydrogen:
 *   - All C atoms first (indices 1 … nC)
 *   - Remaining heavy elements in alphabetical order
 *
 * @param {string} formulaStr - e.g. "C6H6" or "C2H6O"
 * @returns {(string|null)[]} e.g. [null, 'C', 'C', 'O'] for "C2H6O"
 */
function parseFormula(formulaStr) {
  const counts = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m;
  while ((m = re.exec(formulaStr)) !== null) {
    if (!m[1]) {
      continue;
    }
    const el    = m[1];
    const count = m[2] === '' ? 1 : parseInt(m[2], 10);
    if (el === 'H') {
      continue;
    } // H is handled by the /h layer
    counts[el] = (counts[el] ?? 0) + count;
  }

  const list = [null]; // 1-indexed; index 0 unused
  // C first
  for (let i = 0; i < (counts['C'] ?? 0); i++) {
    list.push('C');
  }
  delete counts['C'];
  // Remaining elements alphabetically
  for (const el of Object.keys(counts).sort()) {
    for (let i = 0; i < counts[el]; i++) {
      list.push(el);
    }
  }
  return list;
}

/**
 * Expands an InChI atom-list string into an array of 1-based atom indices.
 * Supports single numbers ("1"), ranges ("1-6"), and comma-lists ("1,5,3-4").
 *
 * @param {string} listStr
 * @returns {number[]}
 */
function expandAtomList(listStr) {
  const atoms = [];
  for (const part of listStr.split(',')) {
    const dash = part.indexOf('-');
    if (dash > 0) {
      const from = parseInt(part.slice(0, dash), 10);
      const to   = parseInt(part.slice(dash + 1), 10);
      for (let i = from; i <= to; i++) {
        atoms.push(i);
      }
    } else {
      atoms.push(parseInt(part, 10));
    }
  }
  return atoms;
}

/**
 * Parses the InChI /h (hydrogen) layer into a map of
 * heavy-atom index (1-based) → H count.
 *
 * Format examples:
 *   "1-6H"        atoms 1–6, 1 H each
 *   "1H3,2H2,3H"  atom 1→3H, atom 2→2H, atom 3→1H
 *   "1,5H2"       atoms 1 and 5, 2 H each
 *
 * @param {string} hStr
 * @returns {Map<number, number>}
 */
function parseHydrogenLayer(hStr) {
  const hMap  = new Map();
  const re    = /(\d[\d,-]*)H(\d*)/g;
  let match;
  while ((match = re.exec(hStr)) !== null) {
    const count = match[2] === '' ? 1 : parseInt(match[2], 10);
    for (const idx of expandAtomList(match[1])) {
      hMap.set(idx, (hMap.get(idx) ?? 0) + count);
    }
  }
  return hMap;
}

/**
 * Parses the InChI /c (connection) layer into a deduplicated array of
 * [atomA, atomB] bond pairs (1-based indices).
 *
 * Grammar (recursive descent):
 *   chain        := NUMBER ( '-' NUMBER | '(' branches ')' | bare_digit )*
 *   branches     := chain ( ',' chain )*
 *   bare_digit   := NUMBER  (implicit bond after a closing ')')
 *
 * Ring closures are handled naturally: a repeated atom number simply adds
 * another bond to the already-placed atom.
 *
 * @param {string} cStr - e.g. "1-2-3" | "1-4(2)3" | "1-2-3-4-5-6-1"
 * @returns {[number, number][]}
 */
function parseConnectionLayer(cStr) {
  const raw = [];
  const src = cStr.trim();
  let pos   = 0;

  function readNumber() {
    let s = '';
    while (pos < src.length && src[pos] >= '0' && src[pos] <= '9') {
      s += src[pos++];
    }
    if (!s) {
      throw new Error(`parseINCHI /c: expected number at position ${pos} in "${cStr}"`);
    }
    return parseInt(s, 10);
  }

  function isDigit() {
    return pos < src.length && src[pos] >= '0' && src[pos] <= '9';
  }

  // Parse a chain starting from `parent`; returns the last atom read.
  function parseChain(parent) {
    const first = readNumber();
    if (parent !== null) {
      raw.push([parent, first]);
    }
    let head = first;

    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '-') {
        pos++;
        const next = readNumber();
        raw.push([head, next]);
        head = next;
      } else if (ch === '(') {
        pos++; // consume '('
        parseBranches(head);
        // A bare digit directly after ')' is an implicit bond from head.
        if (isDigit()) {
          const next = readNumber();
          raw.push([head, next]);
          head = next;
        }
      } else {
        break;
      }
    }
    return head;
  }

  // Parse comma-separated chains inside '(…)'; all branch from `parent`.
  // Expects '(' already consumed; consumes the closing ')'.
  function parseBranches(parent) {
    parseChain(parent);
    while (pos < src.length && src[pos] === ',') {
      pos++;
      parseChain(parent);
    }
    if (src[pos] !== ')') {
      throw new Error(`parseINCHI /c: expected ')' at position ${pos} in "${cStr}"`);
    }
    pos++; // consume ')'
  }

  // Top-level: one chain (disconnected components use ';' which we skip for now)
  parseChain(null);

  // Deduplicate
  const seen = new Set();
  return raw.filter(([a, b]) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Parses the InChI /q (charge) layer.
 *
 * @param {string} qStr - e.g. "+1" or "-2"
 * @returns {number}
 */
function parseChargeLayer(qStr) {
  const n = parseInt(qStr, 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Bond order inference
// ---------------------------------------------------------------------------

/**
 * Returns the atoms forming the smallest cycle that passes through `bond`,
 * or `null` if the bond is a bridge (not in any ring).
 *
 * Runs a BFS from one endpoint to the other, excluding the bond itself.
 * The returned array does NOT repeat the start/end atom.
 *
 * @param {Molecule} mol
 * @param {import('../core/Bond.js').Bond} bond
 * @param {Set<string>} allowedAtoms - Only traverse atoms in this set.
 * @returns {string[]|null}
 */
function smallestRingForBond(mol, bond, allowedAtoms) {
  const [idA, idB] = bond.atoms;
  if (!allowedAtoms.has(idA) || !allowedAtoms.has(idB)) {
    return null;
  }

  const parent = new Map([[idA, null]]);
  const queue  = [idA];

  while (queue.length > 0) {
    const curr = queue.shift();
    for (const bId of mol.atoms.get(curr)?.bonds ?? []) {
      if (bId === bond.id) {
        continue;
      }
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const next = b.getOtherAtom(curr);
      if (!allowedAtoms.has(next)) {
        continue;
      }
      if (next === idB) {
        // Reconstruct the cycle path: idB ← curr ← … ← idA
        const path = [curr];
        let c = curr;
        while (parent.get(c) !== null) {
          c = parent.get(c); path.push(c);
        }
        path.reverse();
        path.push(idB);
        return path;
      }
      if (!parent.has(next)) {
        parent.set(next, curr);
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * Infers bond orders for a molecule built from an InChI connection table.
 *
 * **Phase A — aromatic detection (before any bond promotion)**
 * For each heavy-atom bond, the shortest cycle through that bond is found
 * (ignoring H atoms). If the cycle has 5 or 6 members and every atom in
 * the cycle has exactly one unit of unsatisfied valence (remaining = 1),
 * all bonds in the cycle are marked aromatic and excluded from promotion.
 * Using per-bond shortest-cycle search (rather than the fundamental-cycle
 * basis) correctly handles fused ring systems such as naphthalene where the
 * cycle basis alone would miss one of the two six-membered rings.
 *
 * **Phase B — greedy promotion**
 * For every remaining heavy-atom bond where both endpoints have unsatisfied
 * valence, the bond order is incremented by 1. This loop repeats until no
 * further changes occur, naturally yielding double and triple bonds.
 *
 * @param {Molecule} mol
 * @param {string[]} heavyAtomIds - IDs of heavy atoms in the molecule.
 */
function inferBondOrders(mol, heavyAtomIds) {
  const heavySet = new Set(heavyAtomIds);

  function neutralVal(atomId) {
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      return 0;
    }
    const el = elements[atom.name];
    if (!el) {
      return 0;
    }
    const { group } = el;
    if (group >= 1  && group <= 2)  {
      return group;
    }
    if (group >= 13 && group <= 17) {
      return 18 - group;
    }
    return 0;
  }

  function remaining(atomId) {
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      return 0;
    }
    return neutralVal(atomId) - atom.getValence(mol);
  }

  // ---- Phase A: aromatic detection ----------------------------------------
  // Inspect every heavy-atom bond. If its shortest cycle has size 5 or 6 and
  // every atom in that cycle has remaining = 1 (one pi electron each), the
  // ring is conjugated and all its bonds are labelled aromatic.
  const aromaticBondIds = new Set();

  for (const bond of mol.bonds.values()) {
    const [idA, idB] = bond.atoms;
    if (!heavySet.has(idA) || !heavySet.has(idB)) {
      continue;
    }

    const ring = smallestRingForBond(mol, bond, heavySet);
    if (!ring) {
      continue;
    }
    if (ring.length !== 5 && ring.length !== 6) {
      continue;
    }
    if (!ring.every(id => remaining(id) === 1)) {
      continue;
    }

    // Mark every bond in the ring as aromatic.
    for (let i = 0; i < ring.length - 1; i++) {
      const b = mol.getBond(ring[i], ring[i + 1]);
      if (b) {
        b.properties.aromatic = true; aromaticBondIds.add(b.id);
      }
    }
    // Close the ring (last atom back to first)
    const close = mol.getBond(ring[ring.length - 1], ring[0]);
    if (close) {
      close.properties.aromatic = true; aromaticBondIds.add(close.id);
    }
  }

  // ---- Phase B: greedy bond-order promotion --------------------------------
  // Only promote bonds that are NOT aromatic.
  let changed = true;
  while (changed) {
    changed = false;
    for (const bond of mol.bonds.values()) {
      if (aromaticBondIds.has(bond.id)) {
        continue;
      }
      const [idA, idB] = bond.atoms;
      if (!heavySet.has(idA) || !heavySet.has(idB)) {
        continue;
      }
      if (remaining(idA) > 0 && remaining(idB) > 0) {
        bond.properties.order += 1;
        changed = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses an InChI string and returns a `Molecule`.
 *
 * Layers parsed:
 *   - Formula  (always required) — creates heavy atoms in canonical order
 *   - /c connection             — creates heavy-atom bonds
 *   - /h hydrogen               — attaches explicit H atoms
 *   - /q charge                 — sets net molecular charge
 *
 * Stereochemistry (/b /t /m /s) and isotope (/i) layers are silently ignored.
 *
 * @param {string}  inchiStr
 * @param {object}  [options]
 * @param {boolean} [options.inferBondOrders=true]
 *   Run greedy bond-order inference and aromatic detection after building the
 *   connectivity graph. Set to `false` to get a graph where every bond has
 *   order 1.
 * @param {boolean} [options.addHydrogens=true]
 *   Attach explicit H atoms from the /h layer. Set to `false` to return a
 *   hydrogen-suppressed graph.
 * @returns {Molecule}
 * @throws {Error} For malformed input or unsupported InChI versions.
 */
export function parseINCHI(inchiStr, { inferBondOrders: doInfer = true, addHydrogens = true } = {}) {
  if (typeof inchiStr !== 'string' || !inchiStr.trim()) {
    throw new Error('parseINCHI: input must be a non-empty string');
  }

  const str = inchiStr.trim();

  if (!str.startsWith('InChI=')) {
    throw new Error('parseINCHI: string must start with "InChI="');
  }

  const body  = str.slice('InChI='.length);
  const parts = body.split('/');

  // parts[0] = version (e.g. "1S" or "1")
  if (!parts[0].startsWith('1')) {
    throw new Error(`parseINCHI: unsupported InChI version "${parts[0]}"`);
  }

  // parts[1] = formula layer
  if (!parts[1]) {
    throw new Error('parseINCHI: missing formula layer');
  }
  const formulaStr = parts[1];

  // Collect remaining layers by their single-letter prefix.
  const layers = {};
  for (let i = 2; i < parts.length; i++) {
    if (!parts[i]) {
      continue;
    }
    const prefix = parts[i][0];
    layers[prefix] = parts[i].slice(1);
  }

  // -------------------------------------------------------------------------
  // Phase 1 — build heavy-atom skeleton from formula
  // -------------------------------------------------------------------------
  const atomList = parseFormula(formulaStr); // [null, 'C', 'C', 'O', ...]
  const n        = atomList.length - 1;      // total number of heavy atoms

  const mol       = new Molecule();
  const idByIndex = new Map(); // InChI index (1-based) → atom ID in mol

  for (let i = 1; i <= n; i++) {
    const atom = mol.addAtom(null, atomList[i]);
    atom.resolveElement();
    idByIndex.set(i, atom.id);
  }

  const heavyAtomIds = [...idByIndex.values()];

  // -------------------------------------------------------------------------
  // Phase 2 — create bonds from /c layer
  // -------------------------------------------------------------------------
  if (layers['c']) {
    for (const [a, b] of parseConnectionLayer(layers['c'])) {
      const idA = idByIndex.get(a);
      const idB = idByIndex.get(b);
      if (!idA || !idB) {
        throw new Error(`parseINCHI: atom index out of range in /c layer (got ${a} or ${b}, max ${n})`);
      }
      mol.addBond(null, idA, idB, { order: 1 }, false);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3 — attach hydrogen atoms from /h layer
  // -------------------------------------------------------------------------
  if (addHydrogens && layers['h']) {
    for (const [idx, count] of parseHydrogenLayer(layers['h'])) {
      const parentId = idByIndex.get(idx);
      if (!parentId) {
        continue;
      }
      for (let i = 0; i < count; i++) {
        const hAtom = mol.addAtom(null, 'H');
        mol.addBond(null, parentId, hAtom.id, { order: 1 }, false);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 4 — infer bond orders
  // -------------------------------------------------------------------------
  if (doInfer) {
    inferBondOrders(mol, heavyAtomIds);
  }

  // -------------------------------------------------------------------------
  // Phase 5 — net charge from /q layer
  // -------------------------------------------------------------------------
  if (layers['q']) {
    mol.properties.charge = parseChargeLayer(layers['q']);
  }

  // Recompute derived properties.
  mol.properties.formula = mol.getFormula();
  mol.properties.mass    = mol.getMass();
  if (!layers['q']) {
    mol.properties.charge = mol.getCharge();
  }
  mol.name               = mol.getName();

  return mol;
}
