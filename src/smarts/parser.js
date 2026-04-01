/** @module smarts/parser */

import { Molecule } from '../core/Molecule.js';
import { compileAtomExpr, compileBondToken, compileBareAtomToken, defaultSmartsBondPred } from './primitives.js';

function _extractTrailingAtomMap(inner) {
  let depth = 0;
  for (let i = inner.length - 1; i >= 0; i--) {
    const ch = inner[i];
    if (ch === ')') {
      depth++;
      continue;
    }
    if (ch === '(') {
      depth--;
      continue;
    }
    if (depth === 0 && ch === ':') {
      const digits = inner.slice(i + 1);
      if (/^\d+$/.test(digits)) {
        return {
          expr: inner.slice(0, i),
          atomMap: parseInt(digits, 10)
        };
      }
      break;
    }
  }
  return { expr: inner, atomMap: null };
}

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

  // ringOpens: ringNum → { atomId: string, bondPred: function|null, bondProps: object|null }
  const ringOpens = new Map();

  // Branch stack: [ { prevId: string|null, bondPred: function|null, bondProps: object|null } ]
  const branchStack = [];

  /** ID of the most recently added atom. */
  let prevId = null;

  /**
   * Pending bond predicate set by a bond token.  Applied when the next atom
   * is added.  `null` means "use the default SMARTS bond predicate".
   */
  let pendingBondPred = null;
  let pendingBondProps = null;

  /**
   * Creates a new query atom node with the given predicate, connects it to
   * `prevId` (if any), and updates `prevId`.
   */
  function addAtomNode(pred, properties = {}) {
    const id = `q${atomCount++}`;
    mol.addAtom(id, '*', properties);
    mol.atoms.get(id)._predicate = pred;

    if (prevId !== null) {
      const bond = mol.addBond(null, prevId, id, pendingBondProps ?? {}, false);
      bond._predicate = pendingBondPred ?? defaultSmartsBondPred;
      pendingBondPred = null;
      pendingBondProps = null;
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
      branchStack[branchStack.length - 1].bondProps = pendingBondProps;
      pos++;
      continue;
    }

    // ── Branch close ──────────────────────────────────────────────────────
    if (ch === ')') {
      if (branchStack.length === 0) {
        throw new Error(`parseSMARTS: unmatched ')' at pos ${pos}`);
      }
      ({ prevId, pendingBondPred, bondProps: pendingBondProps } = branchStack.pop());
      pos++;
      continue;
    }

    // ── Disconnected component ('.') ──────────────────────────────────────
    if (ch === '.') {
      prevId = null;
      pendingBondPred = null;
      pendingBondProps = null;
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
        const { atomId: openId, bondPred: openBond, bondProps: openProps } = ringOpens.get(ringNum);
        ringOpens.delete(ringNum);
        const bond = mol.addBond(null, openId, prevId, { ...(openProps ?? {}), ...(pendingBondProps ?? {}) }, false);
        bond._predicate = pendingBondPred ?? openBond ?? defaultSmartsBondPred;
        pendingBondPred = null;
        pendingBondProps = null;
      } else {
        ringOpens.set(ringNum, { atomId: prevId, bondPred: pendingBondPred, bondProps: pendingBondProps });
        pendingBondPred = null;
        pendingBondProps = null;
      }
      continue;
    }

    // ── Bond token ────────────────────────────────────────────────────────
    const bondResult = compileBondToken(smarts, pos);
    if (bondResult !== null) {
      pendingBondPred = bondResult.pred;
      pendingBondProps = bondResult.props ?? null;
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
      const { expr, atomMap } = _extractTrailingAtomMap(inner);
      addAtomNode(compileAtomExpr(expr, { parseFn: parseSMARTS }), { reaction: { atomMap } });
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

    throw new Error(`parseSMARTS: invalid character '${ch}' at pos ${pos}`);
  }

  if (branchStack.length > 0) {
    throw new Error("parseSMARTS: unclosed '('");
  }
  if (ringOpens.size > 0) {
    throw new Error('parseSMARTS: unclosed ring closure');
  }

  return mol;
}
