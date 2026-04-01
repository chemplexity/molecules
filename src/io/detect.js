/** @module io/detect */

import { parseINCHI } from './inchi.js';
import { parseSMILES, tokenize } from './smiles.js';

const INCHI_PREFIX = /^inchi=/i;
const ALLOWED_SMILES_CHARS = /^[A-Za-z0-9@+\-[\]()\\/%=#$:.,*]+$/;
const INVALID_START = /^[)=#$:/\\.%]/;
const INVALID_END = /[(=#$:/\\.%.-]$/;

function canonicalizeInChIPrefix(input) {
  return input.replace(INCHI_PREFIX, 'InChI=');
}

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
