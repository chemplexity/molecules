/** @module smarts/primitives */

import elements from '../data/elements.js';
import { findSubgraphMappings as _findSubgraph } from '../algorithms/vf2.js';

// ---------------------------------------------------------------------------
// Molecular property helpers (used by atom primitives)
// ---------------------------------------------------------------------------

/** Atomic number of an atom, falling back to the elements table. */
function _protons(atom) {
  return atom.properties.protons ?? elements[atom.name]?.protons ?? 0;
}

/** Count of explicit H neighbors in `mol`. */
function _totalHCount(atom, mol) {
  let n = 0;
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (!bond) {
      continue;
    }
    const [a, b] = bond.atoms;
    const nbId = a === atom.id ? b : a;
    if (mol.atoms.get(nbId)?.name === 'H') {
      n++;
    }
  }
  return n;
}

/** Count of heavy (non-H) neighbors in `mol`. */
function _heavyDegree(atom, mol) {
  let n = 0;
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (!bond) {
      continue;
    }
    const [a, b] = bond.atoms;
    const nbId = a === atom.id ? b : a;
    if (mol.atoms.get(nbId)?.name !== 'H') {
      n++;
    }
  }
  return n;
}

/** Total bond count (connectivity), including bonds to H. */
function _totalConnectivity(atom, mol) {
  let n = 0;
  for (const bId of atom.bonds) {
    if (mol.bonds.has(bId)) {
      n++;
    }
  }
  return n;
}

/** Sum of bond orders (valence). */
function _valence(atom, mol) {
  let v = 0;
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (!bond) {
      continue;
    }
    v += bond.properties.order ?? 1;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Internal helpers for aromatic bond detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` when a bond is aromatic.
 *
 * The SMILES parser may create aromatic bonds with either `aromatic: true`
 * (explicit `:` bond token) or `order: 1.5` with `aromatic: false` (implicit
 * bond between lowercase aromatic atoms, including ring-closure bonds).  Both
 * representations are treated as "aromatic" by SMARTS predicates.
 *
 * @param {import('../core/Bond.js').Bond} bond
 * @returns {boolean}
 */
function _isAroBond(bond) {
  return (bond.properties.aromatic ?? false) || (bond.properties.order ?? 1) === 1.5;
}

// ---------------------------------------------------------------------------
// Ring helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Set of ring sizes (from the SSSR) that contain `atom`.
 *
 * Uses `mol.getRings()` for an exact result.  The pair-BFS heuristic it
 * replaces was incorrect for fused ring systems: the BFS between neighbours
 * in different rings returned the combined path length, adding spurious large
 * ring sizes to the set (e.g. reporting r9 for an indane bridgehead that is
 * only in a 5- and a 6-membered ring).
 */
function _ringSizesContaining(atom, mol) {
  const sizes = new Set();
  for (const ring of mol.getRings()) {
    if (ring.includes(atom.id)) {
      sizes.add(ring.length);
    }
  }
  return sizes;
}

/**
 * Number of SSSR rings containing `atom`.
 *
 * Counts the ring bonds (bonds in any ring) incident to `atom`, then maps:
 *   0 ring bonds → 0   (not in any ring)
 *   2 ring bonds → 1   (simple ring member)
 *   n ring bonds → n-1 (ring-junction member; e.g. 3→2 for naphthalene bridgehead)
 *
 * This matches Daylight SSSR semantics for fused and bridged ring systems.
 * (Spiro centers — 4 ring bonds — return 3 instead of 2, a known limitation.)
 */
function _ringPathCount(atom, mol) {
  let ringBondCount = 0;
  for (const bId of atom.bonds) {
    const bond = mol.bonds.get(bId);
    if (bond && _isBondInRing(bond, mol)) {
      ringBondCount++;
    }
  }
  if (ringBondCount === 0) {
    return 0;
  }
  if (ringBondCount === 2) {
    return 1;
  }
  return ringBondCount - 1;
}

/** Returns `true` if `bond` is part of any ring in `mol`. */
function _isBondInRing(bond, mol) {
  const [startId, endId] = bond.atoms;
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift();
    const atom = mol.atoms.get(cur);
    if (!atom) {
      continue;
    }
    for (const bId of atom.bonds) {
      if (bId === bond.id) {
        continue;
      }
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const [x, y] = b.atoms;
      const nb = x === cur ? y : x;
      if (nb === endId) {
        return true;
      }
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Default bond predicate: single OR aromatic (SMARTS implicit bond)
// ---------------------------------------------------------------------------

/**
 * Default SMARTS bond predicate — matches single bonds and aromatic bonds.
 * Applied when no explicit bond token appears between two atoms in a SMARTS.
 *
 * @param {import('../core/Bond.js').Bond} tBond
 * @returns {boolean}
 */
export function defaultSmartsBondPred(tBond) {
  return _isAroBond(tBond) || (tBond.properties.order ?? 1) === 1;
}

// ---------------------------------------------------------------------------
// Bond token compiler
// ---------------------------------------------------------------------------

/**
 * Parses a single bond primitive character at `smarts[pos]` and returns
 * `{ pred, len, props }`, where `pred` is a `(tBond) => boolean` predicate and
 * `len` is the number of characters consumed.
 *
 * Returns `null` if the character is not a bond token.
 *
 * @param {string} smarts
 * @param {number} pos
 * @returns {{ pred: function, len: number, props?: object }|null}
 */
export function compileBondToken(smarts, pos) {
  const ch = smarts[pos];
  switch (ch) {
    case '-':
      return { pred: (tB) => !(tB.properties.aromatic ?? false) && (tB.properties.order ?? 1) === 1, len: 1, props: { order: 1, aromatic: false, stereo: null } };
    case '=':
      return { pred: (tB) => !(tB.properties.aromatic ?? false) && (tB.properties.order ?? 1) === 2, len: 1, props: { order: 2, aromatic: false, stereo: null } };
    case '#':
      return { pred: (tB) => (tB.properties.order ?? 1) === 3, len: 1, props: { order: 3, aromatic: false, stereo: null } };
    case ':':
      return { pred: (tB) => _isAroBond(tB), len: 1, props: { order: 1.5, aromatic: true, stereo: null } };
    case '@':
      return { pred: (tB, tMol) => _isBondInRing(tB, tMol), len: 1, props: { order: 1, aromatic: false, stereo: null } };
    case '~':
      return { pred: () => true, len: 1, props: {} };
    case '/':
    case '\\':
      // Directional bonds are still single bonds structurally; the full
      // / vs \ relation is checked after VF2 using the final atom mapping.
      return { pred: (tB) => !(tB.properties.aromatic ?? false) && (tB.properties.order ?? 1) === 1, len: 1, props: { order: 1, aromatic: false, stereo: ch } };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Bare-atom token compiler  (atoms written outside [ ] )
// ---------------------------------------------------------------------------

/**
 * Parses a bare SMARTS atom token (outside `[...]`) starting at `smarts[pos]`.
 *
 * Uppercase  → aliphatic element  (e.g. `C` = aliphatic carbon)
 * Lowercase  → aromatic element   (e.g. `c` = aromatic carbon)
 * `*`        → any atom (wildcard)
 *
 * Returns `{ pred, len }` or `null` if the character is not a valid bare atom.
 *
 * @param {string} smarts
 * @param {number} pos
 * @returns {{ pred: function, len: number }|null}
 */
export function compileBareAtomToken(smarts, pos) {
  const ch = smarts[pos];

  if (ch === '*') {
    return { pred: () => true, len: 1 };
  }

  // Uppercase → aliphatic element (may be two letters: Cl, Br, Si, …)
  if (ch >= 'A' && ch <= 'Z') {
    const next = pos + 1 < smarts.length ? smarts[pos + 1] : null;
    if (next !== null && next >= 'a' && next <= 'z') {
      const sym2 = ch + next;
      if (elements[sym2] !== undefined) {
        return { pred: (a) => a.name === sym2 && !(a.properties.aromatic ?? false), len: 2 };
      }
    }
    return { pred: (a) => a.name === ch && !(a.properties.aromatic ?? false), len: 1 };
  }

  // Lowercase → aromatic element (single letter)
  if (ch >= 'a' && ch <= 'z') {
    const sym = ch.toUpperCase();
    return { pred: (a) => a.name === sym && (a.properties.aromatic ?? false) === true, len: 1 };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Atom expression compiler  (content of [ ] )
// ---------------------------------------------------------------------------

/**
 * Compiles a SMARTS atom expression (the text between `[` and `]`) into a
 * predicate `(tAtom, targetMol) => boolean`.
 *
 * Supported operators (highest → lowest precedence):
 *   `!`  NOT
 *   `&` or implicit AND (adjacent primitives)  — high precedence
 *   `;`  AND — low precedence
 *   `,`  OR
 *
 * Supported primitives:
 *   `*`        wildcard
 *   `a` / `A`  aromatic / aliphatic
 *   `#n`       atomic number n
 *   `+n`       formal charge +n  (`+` alone = any positive charge)
 *   `-n`       formal charge -n  (`-` alone = any negative charge)
 *   `Hn`       total H count = n  (`H` alone = 1)
 *   `Dn`       heavy-atom degree = n  (`D` alone = 1)
 *   `Rn`       in any ring when n=0 means not in ring; n>0 = in exactly n rings (SSSR)
 *   `rn`       in a ring of exactly size n  (`r` alone = any ring)
 *   `Xn`       total connectivity (heavy + H bonds) = n
 *   `vn`       valence (sum of bond orders) = n
 *   `$(smarts)` recursive SMARTS — requires `options.parseFn`
 *   Element symbol (uppercase, optionally + one lowercase) — element match
 *   Lowercase element symbol (e.g. `c`) — aromatic element
 *
 * @param {string} expr  Contents between `[` and `]`.
 * @param {object} [options]
 * @param {function} [options.parseFn]  `parseSMARTS` callback for `$()` recursive SMARTS.
 * @returns {function(import('../core/Atom.js').Atom, import('../core/Molecule.js').Molecule): boolean}
 */
export function compileAtomExpr(expr, options = {}) {
  let pos = 0;

  function prevChar() {
    return pos > 0 ? expr[pos - 1] : null;
  }

  function peek() {
    return pos < expr.length ? expr[pos] : null;
  }
  function accept(ch) {
    if (peek() === ch) {
      pos++; return true;
    }
    return false;
  }
  function readDigits() {
    let s = '';
    while (pos < expr.length && expr[pos] >= '0' && expr[pos] <= '9') {
      s += expr[pos++];
    }
    return s.length > 0 ? parseInt(s, 10) : null;
  }

  // Returns true when the current char could begin a not-expr / primitive.
  // Stops the implicit-AND loop when `,`, `;`, `)`, `&`, or end is seen.
  function canContinueHighAnd() {
    const ch = peek();
    return ch !== null && ch !== ',' && ch !== ';' && ch !== ')';
  }

  function parseOr() {
    const parts = [parseLowAnd()];
    while (accept(',')) {
      parts.push(parseLowAnd());
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return (a, m) => parts.some(f => f(a, m));
  }

  function parseLowAnd() {
    const parts = [parseHighAnd()];
    while (accept(';')) {
      parts.push(parseHighAnd());
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return (a, m) => parts.every(f => f(a, m));
  }

  function parseHighAnd() {
    const parts = [parseNot()];
    for (let more = accept('&') || canContinueHighAnd(); more; more = accept('&') || canContinueHighAnd()) {
      parts.push(parseNot());
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return (a, m) => parts.every(f => f(a, m));
  }

  function parseNot() {
    if (accept('!')) {
      const child = parseNot();
      return (a, m) => !child(a, m);
    }
    if (accept('(')) {
      const inner = parseOr();
      accept(')');
      return inner;
    }
    return parsePrimitive();
  }

  function parsePrimitive() {
    const ch = peek();
    if (ch === null) {
      return () => true;
    }

    if (ch === '*') {
      pos++; return () => true;
    }

    if (ch === 'a') {
      pos++; return (a) => (a.properties.aromatic ?? false) === true;
    }
    if (ch === 'A') {
      pos++; return (a) => (a.properties.aromatic ?? false) === false;
    }

    if (ch === '#') {
      pos++;
      const n = readDigits();
      if (n === null) {
        return () => false;
      }
      return (a) => _protons(a) === n;
    }

    if (ch === '+') {
      pos++;
      const n = readDigits();
      if (n === null) {
        return (a) => (a.properties.charge ?? 0) > 0;
      }
      return (a) => (a.properties.charge ?? 0) === n;
    }

    if (ch === '-') {
      pos++;
      const n = readDigits();
      if (n === null) {
        return (a) => (a.properties.charge ?? 0) < 0;
      }
      return (a) => (a.properties.charge ?? 0) === -n;
    }

    if (ch === 'H') {
      // Daylight-style special case: bare [H], [H+], [H-], etc. denote an
      // elemental hydrogen atom, while H followed by a digit (or attached to
      // another atom primitive as in [CH]) denotes hydrogen-count.
      const next = pos + 1 < expr.length ? expr[pos + 1] : null;
      const prev = prevChar();
      const startsNewPrimitive =
        prev === null || prev === '!' || prev === '(' || prev === ',' || prev === ';' || prev === '&';
      const nextStartsModifier =
        next === null || next === '+' || next === '-' || next === ',' || next === ';' || next === '&' || next === ')';
      if (startsNewPrimitive && nextStartsModifier) {
        pos++;
        return (a) => a.name === 'H' && !(a.properties.aromatic ?? false);
      }

      pos++;
      const n = readDigits() ?? 1;
      return (a, m) => _totalHCount(a, m) === n;
    }

    if (ch === 'D') {
      pos++;
      const n = readDigits() ?? 1;
      return (a, m) => _heavyDegree(a, m) === n;
    }

    if (ch === 'R') {
      pos++;
      const n = readDigits();
      if (n === null) {
        return (a, m) => a.isInRing(m);
      }
      if (n === 0) {
        return (a, m) => !a.isInRing(m);
      }
      return (a, m) => _ringPathCount(a, m) === n;
    }

    if (ch === 'r') {
      pos++;
      const n = readDigits();
      if (n === null) {
        return (a, m) => a.isInRing(m);
      }
      return (a, m) => _ringSizesContaining(a, m).has(n);
    }

    if (ch === '$') {
      pos++;
      if (peek() !== '(') {
        return () => false;
      }
      pos++; // skip '('
      let depth = 1;
      const start = pos;
      while (pos < expr.length && depth > 0) {
        if (expr[pos] === '(') {
          depth++;
        } else if (expr[pos] === ')') {
          depth--;
        }
        pos++;
      }
      const nestedSmarts = expr.slice(start, pos - 1);
      const { parseFn } = options;
      if (!parseFn) {
        return () => false;
      }
      const queryMol = parseFn(nestedSmarts);
      const firstQAtomId = queryMol.atoms.keys().next().value;
      return (a, m) => {
        const vf2opts = {
          atomMatch: (qAtom, tAtom) => qAtom._predicate(tAtom, m),
          bondMatch: (qBond, tBond) => qBond._predicate(tBond, m),
          skipElementFilter: true
        };
        for (const mapping of _findSubgraph(m, queryMol, vf2opts)) {
          if (mapping.get(firstQAtomId) === a.id) {
            return true;
          }
        }
        return false;
      };
    }

    if (ch === 'X') {
      pos++;
      const n = readDigits() ?? 1;
      return (a, m) => _totalConnectivity(a, m) === n;
    }

    if (ch === 'v') {
      pos++;
      const n = readDigits() ?? 1;
      return (a, m) => _valence(a, m) === n;
    }

    // Uppercase → aliphatic element (single or two-letter); lowercase → aromatic element
    if (ch >= 'A' && ch <= 'Z') {
      pos++;
      const next = peek();
      if (next !== null && next >= 'a' && next <= 'z') {
        const sym2 = ch + next;
        if (elements[sym2] !== undefined) {
          pos++;
          return (a) => a.name === sym2 && !(a.properties.aromatic ?? false);
        }
      }
      return (a) => a.name === ch && !(a.properties.aromatic ?? false);
    }

    // Lowercase (not 'a' or 'v', already handled above) → aromatic element
    if (ch >= 'a' && ch <= 'z') {
      pos++;
      return (a) => a.name === ch.toUpperCase() && (a.properties.aromatic ?? false) === true;
    }

    // Unknown primitive — skip character, always false
    throw new Error(`compileAtomExpr: invalid SMARTS primitive '${ch}' at pos ${pos} in [${expr}]`);
  }

  const compiled = parseOr();
  if (pos !== expr.length) {
    throw new Error(`compileAtomExpr: invalid trailing SMARTS syntax at pos ${pos} in [${expr}]`);
  }
  return compiled;
}
