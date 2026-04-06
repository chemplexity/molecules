/** @module io/detect */

import { parseINCHI } from './inchi.js';
import { parseSMILES, tokenize } from './smiles.js';

const INCHI_PREFIX = /^inchi=/i;
const ALLOWED_SMILES_CHARS = /^[A-Za-z0-9@+\-[\]()\\/%=#$:.,*]+$/;
const INVALID_START = /^[)=#$:/\\.%]/;
const INVALID_END = /[(=#$:/\\.%.-]$/;

/**
 * Normalises the InChI prefix to the canonical mixed-case form `'InChI='`.
 * The InChI standard is case-insensitive for the prefix but tools expect
 * exactly `'InChI='`, so inputs like `'inchi='` or `'INCHI='` are fixed here.
 *
 * @param {string} input
 * @returns {string}
 */
function canonicalizeInChIPrefix(input) {
  return input.replace(INCHI_PREFIX, 'InChI=');
}

/**
 * Returns `true` when `input` is structurally plausible as a SMILES string,
 * without fully parsing it.
 *
 * Checks:
 * - Contains only SMILES-allowed characters.
 * - Does not start or end with an unambiguously invalid character.
 * - Balanced parentheses and bracket pairs.
 * - All ring-closure digits appear an even number of times.
 * - Every character is covered by at least one token from `tokenize()`.
 * - At least one atom token is present.
 *
 * @param {string} input
 * @returns {boolean}
 */
function looksLikeSmiles(input) {
  if (!ALLOWED_SMILES_CHARS.test(input) || INVALID_START.test(input) || INVALID_END.test(input)) {
    return false;
  }

  let branchDepth = 0;
  let bracketDepth = 0;
  const ringClosures = new Map();

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === '[') {
      if (bracketDepth !== 0 || input[i + 1] === ']') {
        return false;
      }
      bracketDepth = 1;
      continue;
    }

    if (char === ']') {
      if (bracketDepth !== 1) {
        return false;
      }
      bracketDepth = 0;
      continue;
    }

    if (bracketDepth > 0) {
      continue;
    }

    if (char === '(') {
      if (input[i + 1] === ')' || input[i + 1] === undefined) {
        return false;
      }
      branchDepth++;
      continue;
    }

    if (char === ')') {
      if (branchDepth === 0) {
        return false;
      }
      branchDepth--;
      continue;
    }

    if (char === '%') {
      const ringId = input.slice(i + 1, i + 3);
      if (!/^\d{2}$/.test(ringId)) {
        return false;
      }
      ringClosures.set(ringId, (ringClosures.get(ringId) ?? 0) + 1);
      i += 2;
      continue;
    }

    if (/\d/.test(char)) {
      ringClosures.set(char, (ringClosures.get(char) ?? 0) + 1);
      continue;
    }

    if (char === '.') {
      const prev = input[i - 1];
      const next = input[i + 1];
      if (prev === '.' || next === '.' || next === undefined) {
        return false;
      }
      continue;
    }

    if (/[-=#$:/\\]/.test(char)) {
      const next = input[i + 1];
      if (next === undefined || /[)=#$:/\\.%]/.test(next)) {
        return false;
      }
    }
  }

  if (branchDepth !== 0 || bracketDepth !== 0) {
    return false;
  }

  for (const count of ringClosures.values()) {
    if (count % 2 !== 0) {
      return false;
    }
  }

  try {
    const tokenized = tokenize(input);
    const covered = Array(input.length).fill(false);
    for (const token of tokenized.tokens) {
      for (let i = token.index; i < token.index + token.term.length; i++) {
        covered[i] = true;
      }
    }

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char !== '[' && char !== ']' && !covered[i]) {
        return false;
      }
    }

    return tokenized.tokens.some(token => token.type === 'atom');
  } catch {
    return false;
  }
}

/**
 * Heuristically guesses whether `input` is a SMILES string or an InChI string,
 * without running a full parser.
 *
 * Returns `'smiles'`, `'inchi'`, or `null` (when the format cannot be
 * determined, or when `input` is not a non-whitespace string).
 *
 * @param {string} input
 * @returns {'smiles'|'inchi'|null}
 */
export function guessChemicalStringFormat(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  if (INCHI_PREFIX.test(trimmed)) {
    return 'inchi';
  }

  return looksLikeSmiles(trimmed) ? 'smiles' : null;
}

/**
 * Detects the chemical string format of `input`, optionally validating it by
 * attempting a full parse.
 *
 * When `validate` is `false` (default), delegates to `guessChemicalStringFormat`
 * and returns immediately without parsing.  When `validate` is `true`, the
 * guessed format is confirmed by running `parseSMILES` or `parseINCHI`; if the
 * parse throws, `null` is returned.
 *
 * Returns `'smiles'`, `'inchi'`, or `null`.
 *
 * @param {string} input
 * @param {object} [options]
 * @param {boolean} [options.validate=false] - When `true`, confirms the guess
 *   with a full parse attempt.
 * @returns {'smiles'|'inchi'|null}
 */
export function detectChemicalStringFormat(input, { validate = false } = {}) {
  const guess = guessChemicalStringFormat(input);
  if (!validate || guess === null || typeof input !== 'string') {
    return guess;
  }

  const trimmed = input.trim();

  try {
    if (guess === 'inchi') {
      parseINCHI(canonicalizeInChIPrefix(trimmed));
      return 'inchi';
    }

    parseSMILES(trimmed);
    return 'smiles';
  } catch {
    return null;
  }
}
