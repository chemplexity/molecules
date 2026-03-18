/** @module smarts/parser */

import { Molecule } from '../core/Molecule.js';
import {
  compileAtomExpr,
  compileBondToken,
  compileBareAtomToken,
  defaultSmartsBondPred
} from './primitives.js';

// ---------------------------------------------------------------------------
// SMARTS → query Molecule
// ---------------------------------------------------------------------------

/**
 * Parses a SMARTS string into a query `Molecule`.
 *
 * Each atom in the returned molecule has a `_predicate` property:
 *   `(tAtom, targetMol) => boolean`
 *
 * Each bond in the returned molecule has a `_predicate` property:
 *   `(tBond) => boolean`
 *
 * These predicates are consumed by {@link findSMARTS} when it constructs
 * the `atomMatch` / `bondMatch` closures passed to VF2.
 *
 * Supported syntax:
 * - Bracket atoms: `[C]`, `[#6]`, `[NH2]`, `[C;!R]`, `[C,N]`, `[+1]`, …
 * - Bare atoms: `C`, `c`, `N`, `n`, `O`, `o`, `S`, `s`, `P`, `Cl`, `Br`, `*`
 * - Bond tokens: `-`, `=`, `#`, `:`, `@`, `~`, `/`, `\`
 * - Branches: `(…)`
 * - Ring closures: single digit `1`–`9` or `%nn`
 * - Disconnected components: `.`
 *
 * @param {string} smarts
 * @returns {Molecule}
 */
export function parseSMARTS(smarts) {
  if (typeof smarts !== 'string' || smarts.length === 0) {
    throw new Error('parseSMARTS: expected a non-empty string');
  }

  const mol = new Molecule();
  let atomCount = 0;
  let bondCount = 0;

  // ringOpens: ringNum → { atomId: string, bondPred: function|null }
  const ringOpens = new Map();

  // Branch stack: [ { prevId: string|null, bondPred: function|null } ]
  const branchStack = [];

  /** ID of the most recently added atom. */
  let prevId = null;

  /**
   * Pending bond predicate set by a bond token.  Applied when the next atom
   * is added.  `null` means "use the default SMARTS bond predicate".
   */
  let pendingBondPred = null;

  /**
   * Creates a new query atom node with the given predicate, connects it to
   * `prevId` (if any), and updates `prevId`.
   */
  function addAtomNode(pred) {
    const id = `q${atomCount++}`;
    mol.addAtom(id, '*');
    mol.atoms.get(id)._predicate = pred;

    if (prevId !== null) {
      const bId = `qb${bondCount++}`;
      mol.addBond(bId, prevId, id, {}, false);
      mol.bonds.get(bId)._predicate = pendingBondPred ?? defaultSmartsBondPred;
      pendingBondPred = null;
    }

    prevId = id;
    return id;
  }

  let pos = 0;

  while (pos < smarts.length) {
    const ch = smarts[pos];

    // ── Branch open ───────────────────────────────────────────────────────
    if (ch === '(') {
      branchStack.push({ prevId, pendingBondPred });
      pos++;
      continue;
    }

    // ── Branch close ──────────────────────────────────────────────────────
    if (ch === ')') {
      if (branchStack.length === 0) {
        throw new Error(`parseSMARTS: unmatched ')' at pos ${pos}`);
      }
      ({ prevId, pendingBondPred } = branchStack.pop());
      pos++;
      continue;
    }

    // ── Disconnected component ('.') ──────────────────────────────────────
    if (ch === '.') {
      prevId = null;
      pendingBondPred = null;
      pos++;
      continue;
    }

    // ── Ring closure: digit or '%nn' ──────────────────────────────────────
    if ((ch >= '0' && ch <= '9') || ch === '%') {
      let ringNum;
      if (ch === '%') {
        if (pos + 2 >= smarts.length) {
          throw new Error(`parseSMARTS: incomplete '%' ring closure at pos ${pos}`);
        }
        ringNum = parseInt(smarts.slice(pos + 1, pos + 3), 10);
        pos += 3;
      } else {
        ringNum = parseInt(ch, 10);
        pos++;
      }

      if (ringOpens.has(ringNum)) {
        const { atomId: openId, bondPred: openBond } = ringOpens.get(ringNum);
        ringOpens.delete(ringNum);
        const bId = `qb${bondCount++}`;
        mol.addBond(bId, openId, prevId, {}, false);
        mol.bonds.get(bId)._predicate = pendingBondPred ?? openBond ?? defaultSmartsBondPred;
        pendingBondPred = null;
      } else {
        ringOpens.set(ringNum, { atomId: prevId, bondPred: pendingBondPred });
        pendingBondPred = null;
      }
      continue;
    }

    // ── Bond token ────────────────────────────────────────────────────────
    const bondResult = compileBondToken(smarts, pos);
    if (bondResult !== null) {
      pendingBondPred = bondResult.pred;
      pos += bondResult.len;
      continue;
    }

    // ── Bracket atom ──────────────────────────────────────────────────────
    if (ch === '[') {
      // Find the matching ']', skipping over balanced '(...)' so that
      // recursive SMARTS like [$([R])] are handled correctly.
      let closeIdx = -1;
      let parenDepth = 0;
      for (let i = pos + 1; i < smarts.length; i++) {
        const c = smarts[i];
        if (c === '(') {
          parenDepth++;
        } else if (c === ')') {
          parenDepth--;
        } else if (c === ']' && parenDepth === 0) {
          closeIdx = i;
          break;
        }
      }
      if (closeIdx < 0) {
        throw new Error(`parseSMARTS: unclosed '[' at pos ${pos}`);
      }
      const inner = smarts.slice(pos + 1, closeIdx);
      addAtomNode(compileAtomExpr(inner, { parseFn: parseSMARTS }));
      pos = closeIdx + 1;
      continue;
    }

    // ── Bare atom ─────────────────────────────────────────────────────────
    const bareResult = compileBareAtomToken(smarts, pos);
    if (bareResult !== null) {
      addAtomNode(bareResult.pred);
      pos += bareResult.len;
      continue;
    }

    // Unknown character — skip silently
    pos++;
  }

  if (branchStack.length > 0) {
    throw new Error('parseSMARTS: unclosed \'(\'');
  }

  return mol;
}
