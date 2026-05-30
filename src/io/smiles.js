/** @module io/smiles */

import elements from '../data/elements.js';
import { Molecule, computeRS } from '../core/Molecule.js';
import { perceiveAromaticity } from '../algorithms/aromaticity.js';
import { morganRanks } from '../algorithms/morgan.js';

export const grammar = [
  { type: 'atom', term: 'H', tag: 'H', expression: /(?=[A-Z])H(?=[^efgos]|$)([0-9]?)+/g },
  { type: 'atom', term: 'D', tag: 'H', expression: /(?=[A-Z])D(?=[^bsy]|$)([0-9]?)+/g },
  { type: 'atom', term: 'He', tag: 'He', expression: /He/g },
  { type: 'atom', term: 'Li', tag: 'Li', expression: /Li/g },
  { type: 'atom', term: 'Be', tag: 'Be', expression: /Be/g },
  { type: 'atom', term: 'B', tag: 'B', expression: /B(?=[^aehikr]|$)/g },
  { type: 'atom', term: 'C', tag: 'C', expression: /C(?=[^adeflmru]|$)/g },
  { type: 'atom', term: 'N', tag: 'N', expression: /N(?=[^adei]|$)/g },
  { type: 'atom', term: 'O', tag: 'O', expression: /O/g },
  { type: 'atom', term: 'F', tag: 'F', expression: /F(?=[^elmr]|$)/g },
  { type: 'atom', term: 'Ne', tag: 'Ne', expression: /Ne/g },
  { type: 'atom', term: 'Na', tag: 'Na', expression: /Na/g },
  { type: 'atom', term: 'Mg', tag: 'Mg', expression: /Mg/g },
  { type: 'atom', term: 'Al', tag: 'Al', expression: /Al/g },
  { type: 'atom', term: 'Si', tag: 'Si', expression: /Si/g },
  { type: 'atom', term: 'P', tag: 'P', expression: /P(?=[^admrtu]|$)/g },
  { type: 'atom', term: 'S', tag: 'S', expression: /S(?=[^egimr]|$)/g },
  { type: 'atom', term: 'Cl', tag: 'Cl', expression: /Cl/g },
  { type: 'atom', term: 'Ar', tag: 'Ar', expression: /Ar/g },
  { type: 'atom', term: 'As', tag: 'As', expression: /As/g },
  { type: 'atom', term: 'Se', tag: 'Se', expression: /Se/g },
  { type: 'atom', term: 'Br', tag: 'Br', expression: /Br/g },
  { type: 'atom', term: 'I', tag: 'I', expression: /I(?=[^r]|$)/g },
  { type: 'atom', term: 'K', tag: 'K', expression: /K(?=[^r]|$)/g },
  { type: 'atom', term: 'Ca', tag: 'Ca', expression: /Ca/g },
  { type: 'atom', term: 'Sc', tag: 'Sc', expression: /Sc/g },
  { type: 'atom', term: 'Ti', tag: 'Ti', expression: /Ti/g },
  { type: 'atom', term: 'V', tag: 'V', expression: /V/g },
  { type: 'atom', term: 'Cr', tag: 'Cr', expression: /Cr/g },
  { type: 'atom', term: 'Mn', tag: 'Mn', expression: /Mn/g },
  { type: 'atom', term: 'Fe', tag: 'Fe', expression: /Fe/g },
  { type: 'atom', term: 'Co', tag: 'Co', expression: /Co/g },
  { type: 'atom', term: 'Ni', tag: 'Ni', expression: /Ni/g },
  { type: 'atom', term: 'Cu', tag: 'Cu', expression: /Cu/g },
  { type: 'atom', term: 'Zn', tag: 'Zn', expression: /Zn/g },
  { type: 'atom', term: 'Ga', tag: 'Ga', expression: /Ga/g },
  { type: 'atom', term: 'Ge', tag: 'Ge', expression: /Ge/g },
  { type: 'atom', term: 'Kr', tag: 'Kr', expression: /Kr/g },
  { type: 'atom', term: 'Rb', tag: 'Rb', expression: /Rb/g },
  { type: 'atom', term: 'Sr', tag: 'Sr', expression: /Sr/g },
  { type: 'atom', term: 'Y', tag: 'Y', expression: /Y(?=[^b]|$)/g },
  { type: 'atom', term: 'Zr', tag: 'Zr', expression: /Zr/g },
  { type: 'atom', term: 'Nb', tag: 'Nb', expression: /Nb/g },
  { type: 'atom', term: 'Mo', tag: 'Mo', expression: /Mo/g },
  { type: 'atom', term: 'Tc', tag: 'Tc', expression: /Tc/g },
  { type: 'atom', term: 'Ru', tag: 'Ru', expression: /Ru/g },
  { type: 'atom', term: 'Rh', tag: 'Rh', expression: /Rh/g },
  { type: 'atom', term: 'Pd', tag: 'Pd', expression: /Pd/g },
  { type: 'atom', term: 'Ag', tag: 'Ag', expression: /Ag/g },
  { type: 'atom', term: 'Cd', tag: 'Cd', expression: /Cd/g },
  { type: 'atom', term: 'In', tag: 'In', expression: /In/g },
  { type: 'atom', term: 'Sn', tag: 'Sn', expression: /Sn/g },
  { type: 'atom', term: 'Sb', tag: 'Sb', expression: /Sb/g },
  { type: 'atom', term: 'Te', tag: 'Te', expression: /Te/g },
  { type: 'atom', term: 'Xe', tag: 'Xe', expression: /Xe/g },
  { type: 'atom', term: 'Cs', tag: 'Cs', expression: /Cs/g },
  { type: 'atom', term: 'Ba', tag: 'Ba', expression: /Ba/g },
  { type: 'atom', term: 'La', tag: 'La', expression: /La/g },
  { type: 'atom', term: 'Ce', tag: 'Ce', expression: /Ce/g },
  { type: 'atom', term: 'Pr', tag: 'Pr', expression: /Pr/g },
  { type: 'atom', term: 'Nd', tag: 'Nd', expression: /Nd/g },
  { type: 'atom', term: 'Pm', tag: 'Pm', expression: /Pm/g },
  { type: 'atom', term: 'Sm', tag: 'Sm', expression: /Sm/g },
  { type: 'atom', term: 'Eu', tag: 'Eu', expression: /Eu/g },
  { type: 'atom', term: 'Gd', tag: 'Gd', expression: /Gd/g },
  { type: 'atom', term: 'Tb', tag: 'Tb', expression: /Tb/g },
  { type: 'atom', term: 'Dy', tag: 'Dy', expression: /Dy/g },
  { type: 'atom', term: 'Ho', tag: 'Ho', expression: /Ho/g },
  { type: 'atom', term: 'Er', tag: 'Er', expression: /Er/g },
  { type: 'atom', term: 'Tm', tag: 'Tm', expression: /Tm/g },
  { type: 'atom', term: 'Yb', tag: 'Yb', expression: /Yb/g },
  { type: 'atom', term: 'Lu', tag: 'Lu', expression: /Lu/g },
  { type: 'atom', term: 'Hf', tag: 'Hf', expression: /Hf/g },
  { type: 'atom', term: 'Ta', tag: 'Ta', expression: /Ta/g },
  { type: 'atom', term: 'W', tag: 'W', expression: /W/g },
  { type: 'atom', term: 'Re', tag: 'Re', expression: /Re/g },
  { type: 'atom', term: 'Os', tag: 'Os', expression: /Os/g },
  { type: 'atom', term: 'Ir', tag: 'Ir', expression: /Ir/g },
  { type: 'atom', term: 'Pt', tag: 'Pt', expression: /Pt/g },
  { type: 'atom', term: 'Au', tag: 'Au', expression: /Au/g },
  { type: 'atom', term: 'Hg', tag: 'Hg', expression: /Hg/g },
  { type: 'atom', term: 'Tl', tag: 'Tl', expression: /Tl/g },
  { type: 'atom', term: 'Pb', tag: 'Pb', expression: /Pb/g },
  { type: 'atom', term: 'Bi', tag: 'Bi', expression: /Bi/g },
  { type: 'atom', term: 'Po', tag: 'Po', expression: /Po/g },
  { type: 'atom', term: 'At', tag: 'At', expression: /At/g },
  { type: 'atom', term: 'Rn', tag: 'Rn', expression: /Rn/g },
  { type: 'atom', term: 'Fr', tag: 'Fr', expression: /Fr/g },
  { type: 'atom', term: 'Ra', tag: 'Ra', expression: /Ra/g },
  { type: 'atom', term: 'Ac', tag: 'Ac', expression: /Ac/g },
  { type: 'atom', term: 'Th', tag: 'Th', expression: /Th/g },
  { type: 'atom', term: 'Pa', tag: 'Pa', expression: /Pa/g },
  { type: 'atom', term: 'U', tag: 'U', expression: /U/g },
  { type: 'atom', term: 'Np', tag: 'Np', expression: /Np/g },
  { type: 'atom', term: 'Pu', tag: 'Pu', expression: /Pu/g },
  { type: 'atom', term: 'Am', tag: 'Am', expression: /Am/g },
  { type: 'atom', term: 'Cm', tag: 'Cm', expression: /Cm/g },
  { type: 'atom', term: 'Bk', tag: 'Bk', expression: /Bk/g },
  { type: 'atom', term: 'Cf', tag: 'Cf', expression: /Cf/g },
  { type: 'atom', term: 'Es', tag: 'Es', expression: /Es/g },
  { type: 'atom', term: 'Fm', tag: 'Fm', expression: /Fm/g },
  { type: 'atom', term: 'Md', tag: 'Md', expression: /Md/g },
  { type: 'atom', term: 'No', tag: 'No', expression: /No/g },
  { type: 'atom', term: 'Lr', tag: 'Lr', expression: /Lr/g },
  { type: 'atom', term: 'Rf', tag: 'Rf', expression: /Rf/g },
  { type: 'atom', term: 'Db', tag: 'Db', expression: /Db/g },
  { type: 'atom', term: 'Sg', tag: 'Sg', expression: /Sg/g },
  { type: 'atom', term: 'Bh', tag: 'Bh', expression: /Bh/g },
  { type: 'atom', term: 'Hs', tag: 'Hs', expression: /Hs/g },
  { type: 'atom', term: 'Mt', tag: 'Mt', expression: /Mt/g },
  { type: 'atom', term: 'Ds', tag: 'Ds', expression: /Ds/g },
  { type: 'atom', term: 'Rg', tag: 'Rg', expression: /Rg/g },
  { type: 'atom', term: 'Cn', tag: 'Cn', expression: /Cn/g },
  { type: 'atom', term: 'Nh', tag: 'Nh', expression: /Nh/g },
  { type: 'atom', term: 'Fl', tag: 'Fl', expression: /Fl/g },
  { type: 'atom', term: 'Mc', tag: 'Mc', expression: /Mc/g },
  { type: 'atom', term: 'Lv', tag: 'Lv', expression: /Lv/g },
  { type: 'atom', term: 'Ts', tag: 'Ts', expression: /Ts/g },
  { type: 'atom', term: 'Og', tag: 'Og', expression: /Og/g },
  { type: 'atom', term: 'b', tag: 'B', expression: /(?<![R])b(?=[^e]|$)/g },
  { type: 'atom', term: 'c', tag: 'C', expression: /(?<![T])c(?=[^l]|$)/g },
  { type: 'atom', term: 'n', tag: 'N', expression: /(?<![MZ])n(?=[^ae]|$)/g },
  { type: 'atom', term: 'o', tag: 'O', expression: /(?<![M])o(?=[^s]|$)/g },
  { type: 'atom', term: 'p', tag: 'P', expression: /p/g },
  { type: 'atom', term: 's', tag: 'S', expression: /s(?=[^ei]|$)/g },
  { type: 'atom', term: 'se', tag: 'Se', expression: /se/g },
  { type: 'atom', term: 'as', tag: 'As', expression: /as/g },
  { type: 'bond', term: '-', tag: 'single', expression: /(?=([^0-9]))[-](?=[^0-9-\]])/g },
  { type: 'bond', term: '=', tag: 'double', expression: /[=]/g },
  { type: 'bond', term: '#', tag: 'triple', expression: /[#]/g },
  { type: 'bond', term: '$', tag: 'quadruple', expression: /[$]/g },
  { type: 'bond', term: ':', tag: 'aromatic', expression: /(?<![\d%])[:]/g },
  { type: 'bond', term: '/', tag: 'stereo', expression: /[/]/g },
  { type: 'bond', term: '\\', tag: 'stereo', expression: /[\\]/g },
  { type: 'bond', term: '(', tag: 'branch', expression: /[(]/g },
  { type: 'bond', term: ')', tag: 'branch', expression: /[)]/g },
  {
    type: 'bond',
    term: '%',
    tag: 'ring',
    expression: /(?=[^+-])(?:[a-zA-Z]{1,2}[@]{1,2})?(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[=\-#$/\\:]?[%]?\d+(?=([^+]|$))/g
  },
  { type: 'bond', term: '.', tag: 'dot', expression: /(?:[A-Z][+-]?[[])?[.]/g },
  { type: 'property', term: '+', tag: 'charge', expression: /[a-zA-Z]{1,2}(?:@{1,2})?(?:H[0-9]*)?[+]+[0-9]*(?=[\]])/g },
  { type: 'property', term: '-', tag: 'charge', expression: /[a-zA-Z]{1,2}(?:@{1,2})?(?:H[0-9]*)?[-]+[0-9]*(?=[\]])/g },
  { type: 'property', term: 'n', tag: 'isotope', expression: /(?:[[])[0-9]+[A-Z]{1,2}(?=.?[^[]*[\]])/g },
  { type: 'property', term: 'S', tag: 'chiral', expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g },
  { type: 'property', term: 'R', tag: 'chiral', expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g }
];

function compareArrays(a, b, ab = []) {
  for (let i = 0; i < a.length; i++) {
    ab[i] = b.indexOf(a[i]) > -1 ? 1 : 0;
  }
  return ab;
}

function addAtomV1(id, name, value, group = 0, protons = 0, neutrons = 0, electrons = 0) {
  return {
    id,
    name,
    value,
    group,
    protons,
    neutrons,
    electrons,
    bonds: { id: [], atoms: [], electrons: 0 },
    properties: { chiral: 0, charge: 0, aromatic: 0 }
  };
}

function addBondV1(id, name, value, order = 0, atoms = [], stereo = null) {
  return { id, name, value, order, atoms, stereo };
}

const DEFAULT_COORDINATE_DONOR_ELEMENTS = new Set(['N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I', 'As', 'Se']);

function isTransitionMetalAtom(atom) {
  if (!atom || atom.name === 'H') {
    return false;
  }
  const group = atom.properties?.group ?? atom.group ?? elements[atom.name]?.group ?? 0;
  return group >= 3 && group <= 12;
}

function isDefaultCoordinateDonorAtom(atom) {
  return atom && DEFAULT_COORDINATE_DONOR_ELEMENTS.has(atom.name);
}

function inferParsedBondKind(atomA, atomB) {
  const atomAIsMetal = isTransitionMetalAtom(atomA);
  const atomBIsMetal = isTransitionMetalAtom(atomB);
  const ligandAtom = atomAIsMetal ? atomB : atomBIsMetal ? atomA : null;
  if (atomAIsMetal !== atomBIsMetal && isDefaultCoordinateDonorAtom(ligandAtom)) {
    return 'coordinate';
  }
  return 'covalent';
}

/**
 * Extracts the explicit bond order embedded in a ring token term (e.g. 'C=1' → 2).
 * Returns null if no bond prefix is present.
 * @param {string} term - Ring token term.
 * @returns {number|null} The computed value, or `null` if not applicable.
 */
function ringTokenBondOrder(term) {
  const m = term.match(/[a-zA-Z\]@]([-=#$:/\\])/);
  if (!m) {
    return null;
  }
  switch (m[1]) {
    case '=':
      return 2;
    case '#':
      return 3;
    case '$':
      return 4;
    case ':':
      return 1.5;
    default:
      return null; // '-', '/', '\' → use aromatic heuristic
  }
}

function nextAtom(start, keys, atoms) {
  const index = keys.indexOf(start);
  if (index !== -1) {
    keys = keys.slice(index, keys.length);
    for (let i = 1, ii = keys.length; i < ii; i++) {
      if (atoms[keys[i]] !== undefined) {
        return keys[i];
      }
    }
  }
  return null;
}

function previousAtom(start, keys, atoms) {
  if (start === '0' && atoms['0'] !== undefined) {
    return '0';
  }
  const index = keys.indexOf(start);
  if (index !== -1) {
    keys = keys.slice(0, index).reverse();
    for (let i = 0, ii = keys.length; i < ii; i++) {
      if (atoms[keys[i]] !== undefined) {
        return keys[i];
      }
    }
  }
  return null;
}

/**
 * Returns `true` when the atom is an auxiliary bracket hydrogen such as the
 * helper `H` in `[C@H]`.
 * @param {object|null|undefined} atom - Candidate v1 atom.
 * @returns {boolean} Whether the atom should be skipped as a traversal anchor.
 */
function isAuxiliaryBracketHydrogen(atom) {
  return atom?.name === 'H' && atom?.auxiliaryBracketHydrogen === true;
}

/**
 * Like previousAtom but skips over `(…)` branch groups when scanning backward.
 * Used to find the true source atom for stereo bonds that follow a branch close `)`.
 *
 * Ring-closure tokens (e.g. `S2`, `C@@]1`) share the same character-position key as
 * their owning atom. The atom check is therefore performed independently of whether a
 * bond also exists at that key, so a co-located ring-closure token never blocks the
 * scan from returning the correct source atom.
 * @param {string} start  - key of the bond token to search backward from
 * @param {string[]} keys - ordered list of all token keys
 * @param {object}  atoms - atom map
 * @param {object}  bonds - bond map
 * @returns {string|null} key of the source atom, or null
 */
function previousAtomSkipBranches(start, keys, atoms, bonds) {
  const index = keys.indexOf(start);
  if (index === -1) {
    return null;
  }
  let i = index - 1;
  while (i >= 0) {
    const key = keys[i];
    if (bonds[key]?.value === ')') {
      // skip the matching (…) branch going backward
      let depth = 1;
      i--;
      while (i >= 0 && depth > 0) {
        const k = keys[i];
        if (bonds[k]?.value === ')') {
          depth++;
        } else if (bonds[k]?.value === '(') {
          depth--;
        }
        i--;
      }
      continue;
    }
    if (atoms[key] !== undefined) {
      return key;
    }
    i--;
  }
  return null;
}

/**
 * Finds the previous atom token that should act as a bond source.
 *
 * Bracket hydrogens such as the `H` in `[C@H]` are auxiliary stereo tokens, not
 * true traversal anchors. When an explicit bond follows the bracket atom, the
 * source must remain the bracket atom rather than that hydrogen.
 * @param {string} start - The start value.
 * @param {string[]} keys - The keys value.
 * @param {object} atoms - Array of atoms.
 * @param {object|null} [bonds] - Array of bonds.
 * @returns {string|null} The result string, or `null` if not applicable.
 */
function previousBondSourceAtom(start, keys, atoms, bonds = null) {
  const previous = key => (bonds ? previousAtomSkipBranches(key, keys, atoms, bonds) : previousAtom(key, keys, atoms));

  let atomKey = previous(start);
  while (atomKey !== null) {
    const atom = atoms[atomKey];
    if (!isAuxiliaryBracketHydrogen(atom)) {
      return atomKey;
    }
    atomKey = previous(atomKey);
  }
  return null;
}

function normalizeSmilesSeparators(input) {
  let normalized = '';
  let bracketDepth = 0;
  let pendingSeparator = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '[') {
      if (pendingSeparator && normalized.length > 0 && normalized[normalized.length - 1] !== '.') {
        normalized += '.';
      }
      pendingSeparator = false;
      bracketDepth++;
      normalized += ch;
      continue;
    }

    if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      normalized += ch;
      continue;
    }

    if (bracketDepth === 0 && /\s/.test(ch)) {
      pendingSeparator = normalized.length > 0;
      continue;
    }

    if (bracketDepth === 0 && ch === '.') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '.') {
        normalized += '.';
      }
      pendingSeparator = false;
      continue;
    }

    if (pendingSeparator && normalized.length > 0 && normalized[normalized.length - 1] !== '.') {
      normalized += '.';
    }
    pendingSeparator = false;
    normalized += ch;
  }

  return normalized;
}

/**
 * Validates branch and bracket delimiters before grammar tokenization. The v1
 * tokenizer is intentionally permissive, so malformed delimiter structure must
 * be caught before decode can build dangling bonds.
 * @param {string} input - Normalized SMILES source.
 * @returns {void}
 * @throws {Error} If branch or bracket delimiters are unbalanced.
 */
function validateSmilesDelimiters(input) {
  const branchStack = [];
  const bracketStack = [];

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const inBracket = bracketStack.length > 0;

    if (ch === '[') {
      bracketStack.push(i);
      continue;
    }
    if (ch === ']') {
      if (!inBracket) {
        throw new Error(`Invalid SMILES: unmatched bracket close at position ${i}`);
      }
      bracketStack.pop();
      continue;
    }
    if (inBracket) {
      continue;
    }
    if (ch === '(') {
      branchStack.push(i);
      continue;
    }
    if (ch === ')') {
      if (branchStack.length === 0) {
        throw new Error(`Invalid SMILES: unmatched branch close at position ${i}`);
      }
      branchStack.pop();
    }
  }

  if (bracketStack.length > 0) {
    throw new Error(`Invalid SMILES: unclosed bracket starting at position ${bracketStack[bracketStack.length - 1]}`);
  }
  if (branchStack.length > 0) {
    throw new Error(`Invalid SMILES: unclosed branch starting at position ${branchStack[branchStack.length - 1]}`);
  }
}

/**
 * Returns the standalone ring-closure token term that begins at the given input
 * position, or null when the input there is not an uncovered ring closure.
 * @param {string} input - Normalized SMILES source.
 * @param {number} index - Character position to inspect.
 * @returns {string|null} Ring token term or null.
 */
function matchStandaloneRingClosure(input, index) {
  const current = input[index];
  const next = input[index + 1] ?? '';
  const nextNext = input[index + 2] ?? '';
  const nextThird = input[index + 3] ?? '';
  const hasTwoDigitPercent = next === '%' && /\d/.test(nextNext) && /\d/.test(nextThird);

  if (/\d/.test(current)) {
    return current;
  }
  if (current === '%' && /\d/.test(next) && /\d/.test(nextNext)) {
    return input.slice(index, index + 3);
  }
  if (!'-=#$:/\\'.includes(current)) {
    return null;
  }
  if (/\d/.test(next)) {
    return input.slice(index, index + 2);
  }
  if (hasTwoDigitPercent) {
    return input.slice(index, index + 4);
  }
  return null;
}

/**
 * Emits synthetic ring tokens for uncovered standalone ring closures such as
 * `%11`, `-2`, or `:%10` that follow an atom or an earlier ring closure.
 * @param {string} input - Normalized SMILES source.
 * @param {object[]} tokens - Token list to extend in place.
 * @param {Set<number>} inBracket - Character positions inside bracket atoms.
 * @returns {void}
 */
function emitStandaloneRingClosureTokens(input, tokens, inBracket) {
  const coveredPositions = new Set();
  for (const token of tokens) {
    for (let position = token.index; position < token.index + token.term.length; position++) {
      coveredPositions.add(position);
    }
  }

  const additions = [];
  for (let index = 0; index < input.length; index++) {
    if (inBracket.has(index) || coveredPositions.has(index)) {
      continue;
    }
    const term = matchStandaloneRingClosure(input, index);
    if (!term) {
      continue;
    }
    let overlapsCoveredSpan = false;
    for (let position = index; position < index + term.length; position++) {
      if (inBracket.has(position) || coveredPositions.has(position)) {
        overlapsCoveredSpan = true;
        break;
      }
    }
    if (overlapsCoveredSpan) {
      continue;
    }
    additions.push({
      index,
      type: 'bond',
      term,
      tag: 'ring'
    });
    for (let position = index; position < index + term.length; position++) {
      coveredPositions.add(position);
    }
  }

  if (additions.length > 0) {
    tokens.push(...additions);
    tokens.sort((firstToken, secondToken) => firstToken.index - secondToken.index);
  }
}

/**
 * Parses a SMILES string into an array of tokens using the v1 grammar.
 * @param {string} input - SMILES string.
 * @param {object[]} [tokens] - Pre-existing token array to append to.
 * @returns {{ tokens: object[] }} The result object.
 * @throws {Error} If no valid atoms are found.
 */
export function tokenize(input, tokens = []) {
  input = normalizeSmilesSeparators(input);
  validateSmilesDelimiters(input);

  for (let i = 0; i < grammar.length; i++) {
    const token = grammar[i];
    let text = [];
    while ((text = token.expression.exec(input))) {
      tokens.push({ index: text.index, type: token.type, term: text[0], tag: token.tag });
    }
  }

  tokens.sort((a, b) => a.index - b.index);

  // Charge / chiral / isotope property tokens inside bracket atoms can overlap
  // with the generic ring-token regex. Valid bracket ring closures start at the
  // same index as the owning atom token (e.g. `[N+]5`, `[C@H]3`), but bogus
  // matches can also start *inside* the property span itself (e.g. `o-3` from
  // `[Co-3]568`). Those interior matches are not real ring closures and can
  // steal partners from later legitimate tokens.
  {
    const propertySpans = tokens.filter(t => t.type === 'property').map(t => ({ start: t.index, end: t.index + t.term.length }));
    if (propertySpans.length > 0) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].tag !== 'ring') {
          continue;
        }
        const start = tokens[i].index;
        const insideProperty = propertySpans.some(span => start > span.start && start < span.end);
        if (insideProperty) {
          tokens.splice(i, 1);
        }
      }
    }
  }

  // Remove bond tokens that fall inside the character span of a ring token.
  // Happens when a bond prefix is embedded in the ring token (e.g. 'C=1' captures '=').
  {
    const covered = new Set();
    for (const t of tokens) {
      if (t.tag === 'ring') {
        for (let p = t.index + 1; p < t.index + t.term.length; p++) {
          covered.add(p);
        }
      }
    }
    if (covered.size > 0) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].type !== 'atom' && tokens[i].tag !== 'ring' && covered.has(tokens[i].index)) {
          tokens.splice(i, 1);
        }
      }
    }
  }

  // Bracket-aware atom priority resolution.
  //
  // The grammar runs all regexes independently, so the same character position
  // can collect multiple atom tokens — e.g. 'C' (len 1) and 'Co' (len 2) both
  // matching at the same index.  The correct winner depends on context:
  //   • inside  [...] → prefer the longer token (two-letter element wins)
  //   • outside [...] → prefer the shorter token (single-letter organic atom wins)
  //
  // Additionally, when a two-letter element inside brackets is kept, the
  // aromatic-atom token that matches its second character (e.g. 'o' at index+1
  // for 'Co') must be removed so it isn't mistakenly decoded as an extra atom.
  {
    // Build the set of string positions that lie inside bracket atoms [...].
    const inBracket = new Set();
    let depth = 0;
    for (let i = 0; i < input.length; i++) {
      if (input[i] === '[') {
        depth++;
      }
      if (depth > 0) {
        inBracket.add(i);
      }
      if (input[i] === ']' && depth > 0) {
        depth--;
      }
    }

    // Collect all atom tokens grouped by their index position.
    const atomsByIndex = new Map();
    for (const t of tokens) {
      if (t.type !== 'atom') {
        continue;
      }
      if (!atomsByIndex.has(t.index)) {
        atomsByIndex.set(t.index, []);
      }
      atomsByIndex.get(t.index).push(t);
    }

    const toRemove = new Set();

    // For positions with more than one atom token, keep only the winner.
    for (const [idx, group] of atomsByIndex) {
      if (group.length <= 1) {
        continue;
      }
      const inside = inBracket.has(idx);
      // Sort ascending by term length so group[0] is shortest.
      group.sort((a, b) => a.term.length - b.term.length);
      const winner = inside ? group[group.length - 1] : group[0];
      for (const t of group) {
        if (t !== winner) {
          toRemove.add(t);
        }
      }
    }

    // Remove stray aromatic-atom tokens that are the second character of a
    // two-letter element token kept above (e.g. 'o' at pos 2 when 'Co' is at
    // pos 1 inside brackets).
    for (const t of tokens) {
      if (t.type !== 'atom' || t.term.length !== 1) {
        continue;
      }
      if (!inBracket.has(t.index)) {
        continue;
      }
      // Check whether a two-letter element starts at index-1 and spans this position.
      const prevGroup = atomsByIndex.get(t.index - 1);
      if (!prevGroup) {
        continue;
      }
      const hasTwoLetterParent = prevGroup.some(pt => pt.term.length === 2 && !toRemove.has(pt));
      if (hasTwoLetterParent) {
        toRemove.add(t);
      }
    }

    // Apply removals in reverse order to preserve splice indices.
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (toRemove.has(tokens[i])) {
        tokens.splice(i, 1);
      }
    }

    // Tag atom tokens that sit inside bracket atoms so the implicit-H logic
    // can skip them (bracket atoms carry explicit H only, per the SMILES spec).
    for (const t of tokens) {
      if (t.type === 'atom' && inBracket.has(t.index)) {
        t.bracket = true;
      }
    }

    // Real bracket ring closures are anchored to the primary bracket atom
    // itself (e.g. `[C@H]1`, `[N+]5`). Matches that start on later bracket
    // atoms, such as the explicit `H3` inside `[NH3]`, are just bracket-H text
    // being misread as a ring token and must not survive to decoding.
    const bracketSpans = [];
    let bracketStart = -1;
    depth = 0;
    for (let i = 0; i < input.length; i++) {
      if (input[i] === '[') {
        if (depth === 0) {
          bracketStart = i;
        }
        depth++;
      } else if (input[i] === ']' && depth > 0) {
        depth--;
        if (depth === 0 && bracketStart !== -1) {
          bracketSpans.push({ start: bracketStart, end: i });
          bracketStart = -1;
        }
      }
    }
    const ringTokensToRemove = new Set();
    for (const span of bracketSpans) {
      const bracketAtoms = tokens.filter(token => token.type === 'atom' && token.bracket && token.index > span.start && token.index < span.end).sort((a, b) => a.index - b.index);
      if (bracketAtoms.length === 0) {
        continue;
      }
      const primaryAtomIndex = bracketAtoms[0].index;
      for (const token of bracketAtoms) {
        if (token.index !== primaryAtomIndex && token.tag === 'H') {
          token.auxiliaryBracketHydrogen = true;
        }
      }
      for (const token of tokens) {
        if (token.tag !== 'ring') {
          continue;
        }
        if (token.index > span.start && token.index < span.end && token.index !== primaryAtomIndex) {
          ringTokensToRemove.add(token);
        }
      }
    }
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (ringTokensToRemove.has(tokens[i])) {
        tokens.splice(i, 1);
      }
    }

    emitStandaloneRingClosureTokens(input, tokens, inBracket);
  }

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].tag === 'ring') {
      let ringID = tokens[i].term.match(/[0-9]+/g);
      if (ringID !== null) {
        ringID = ringID[0];
      } else {
        continue;
      }

      if (ringID.length > 1) {
        const isExplicitMultiDigitClosure = tokens[i].term.includes('%');
        let exception = 0;
        if (isExplicitMultiDigitClosure) {
          for (let j = 0; j < tokens.length; j++) {
            if (i === j || tokens[j].tag !== 'ring') {
              continue;
            }
            let checkID = tokens[j].term.match(/[0-9]+/g);
            if (checkID !== null) {
              checkID = checkID[0];
            } else {
              continue;
            }
            if (ringID === checkID) {
              exception = 1;
              break;
            }
          }
        }

        if (exception === 1) {
          continue;
        }

        const prefixMatch = tokens[i].term.match(/[a-zA-Z\]]/g);
        // Synthetic %XX closures can legitimately be bare ring tokens with no
        // atom/bracket prefix. They are already split out as standalone
        // closures above, so skip the legacy digit-splitting rewrite for those
        // terms. Bracket closures like `[Os++]123` arrive here as `]123` and
        // still need to be split into `]1` + `]2` + `]3`.
        if (prefixMatch === null) {
          continue;
        }
        // Plain adjacent digits after an atom or bracket atom are always
        // separate single-digit ring closures in SMILES (`C12` == `C1` + `C2`).
        // Only `%12`-style terms represent a true multi-digit closure.
        const prefix = prefixMatch[prefixMatch.length - 1];
        const bondChar = tokens[i].term.match(/[=\-#$/\\:]/)?.[0] ?? '';
        for (let j = 0; j < ringID.length; j++) {
          tokens.splice(i + 1, 0, {
            index: tokens[i].index + j,
            type: tokens[i].type,
            term: prefix + (j === 0 ? bondChar : '') + ringID.slice(j, j + 1),
            tag: tokens[i].tag
          });
        }
        tokens.splice(i, 1);
      }
    }
  }

  const atomTokens = tokens.filter(token => token.type === 'atom');
  if (atomTokens.length === 0) {
    throw new Error('Invalid SMILES: no valid atoms found');
  }

  return { tokens };
}

/**
 * Converts a token list (from {@link tokenize}) into v1-format atoms and bonds.
 *
 * Returns the raw v1 graph structure, not a {@link Molecule} instance.
 * Use {@link parseSMILES} to get a Molecule.
 * @param {{ tokens: object[] }|object[]} tokens - Array of parsed tokens.
 * @returns {{ atoms: object, bonds: object }} The result object.
 * @throws {Error} If token validation fails or no atoms are found.
 */
export function decode(tokens) {
  function validateTokens(tokens) {
    if (typeof tokens !== 'object') {
      throw new Error('Tokens must be of type "object"');
    } else if (tokens.tokens !== undefined) {
      tokens = tokens.tokens;
    }
    const fields = ['index', 'type', 'term', 'tag'];
    for (let i = 0; i < tokens.length; i++) {
      const match = compareArrays(fields, Object.keys(tokens[i]));
      if (match.reduce((a, b) => a + b) < 4) {
        throw new Error(`Invalid token at index "${i}"`);
      }
    }
    return tokens;
  }

  function readTokens(tokens, atoms = {}, bonds = {}, properties = {}, keys = {}) {
    for (let i = 0; i < tokens.length; i++) {
      const { type, term, tag, index } = tokens[i];
      const key = index.toString();
      switch (type) {
        case 'atom':
          atoms[key] = addAtomV1(key, tag, term);
          if (tokens[i].bracket) {
            atoms[key].bracketAtom = true;
          }
          if (tokens[i].auxiliaryBracketHydrogen) {
            atoms[key].auxiliaryBracketHydrogen = true;
          }
          break;
        case 'bond':
          bonds[key] = addBondV1(key, tag, term);
          break;
        case 'property':
          properties[`${key}:${tag}:${i}`] = { id: key, name: tag, value: term };
          break;
      }
    }
    keys.all = [];
    for (let i = 0; i < tokens.length; i++) {
      keys.all[i] = tokens[i].index.toString();
    }
    if (atoms.length < 1) {
      throw new Error('Could not find atoms');
    }
    keys.atoms = Object.keys(atoms);
    keys.bonds = Object.keys(bonds);
    keys.properties = Object.keys(properties);
    return [atoms, bonds, properties, keys];
  }

  function defaultAtoms(atoms, keys) {
    for (let i = 0; i < keys.atoms.length; i++) {
      const atomID = keys.atoms[i];
      if (elements[atoms[atomID].name] === undefined) {
        continue;
      }
      let element = elements[atoms[atomID].name];
      if (atoms[atomID].value === 'D') {
        element = elements[atoms[atomID].value];
      }
      atoms[atomID].group = element.group;
      atoms[atomID].protons = element.protons;
      atoms[atomID].neutrons = element.neutrons;
      atoms[atomID].electrons = element.electrons;
      atoms[atomID].bonds = { id: [], atoms: [], electrons: 0 };
      atoms[atomID].properties = { chiral: 0, charge: 0, aromatic: 0 };
      if (atoms[atomID].value === atoms[atomID].value.toLowerCase()) {
        atoms[atomID].properties.aromatic = 1;
      }
    }
    return atoms;
  }

  function updateAtomProps(atoms, properties, keys) {
    for (let i = 0; i < keys.properties.length; i++) {
      const propertyID = keys.properties[i];
      const { id: atomPropertyID = propertyID, name, value } = properties[propertyID];
      switch (name) {
        case 'chiral':
          if (atoms[atomPropertyID] !== undefined) {
            atoms[atomPropertyID].properties.chiral = value.slice(value.indexOf('@'));
          }
          break;
        case 'isotope': {
          const isotope = value.match(/[0-9]+/g);
          const atomID = 1 + isotope.toString().length + parseInt(atomPropertyID);
          if (isotope >= 0 && isotope < 250 && atoms[atomID] !== undefined) {
            const neutrons = isotope - atoms[atomID].protons;
            if (neutrons >= 0) {
              atoms[atomID].neutrons = neutrons;
            }
          }
          break;
        }
        case 'charge': {
          const chargeToken = value.match(/([+-]+|[+-][0-9]+)$/)?.[0];
          if (!chargeToken || atoms[atomPropertyID] === undefined) {
            break;
          }
          const sign = chargeToken[0] === '+' ? 1 : -1;
          const magnitude = chargeToken.length > 1 && /[0-9]/.test(chargeToken[1]) ? Number(chargeToken.slice(1)) : chargeToken.length;
          atoms[atomPropertyID].properties.charge = magnitude * sign;
          break;
        }
      }
    }
    return atoms;
  }

  function explicitBonds(atoms, bonds, keys) {
    if (keys.bonds.length === 0 || keys.bonds === undefined) {
      return [atoms, bonds, keys];
    }

    function resolveRingEndpointIndex(tokenId) {
      let atomIndex = Number(tokenId);
      while (atomIndex >= -1 && (atoms[atomIndex] === undefined || isAuxiliaryBracketHydrogen(atoms[atomIndex]))) {
        atomIndex -= 1;
      }
      return atomIndex >= 0 ? atomIndex : null;
    }

    // Tracks ring-bond token IDs that have already been consumed as the
    // *closing* end of a ring closure pair.  When ring-closure numbers are
    // reused (e.g. the same digit appears 4+ times in a SMILES string),
    // the closing token must not be re-processed as a new opening token —
    // doing so creates spurious extra bonds.
    const matchedRingTargets = new Set();

    for (let i = 0; i < keys.bonds.length; i++) {
      const bondID = keys.bonds[i];
      const bondIndex = keys.all.indexOf(bondID);
      const previousKey = bondIndex > 0 ? keys.all[bondIndex - 1] : null;
      const previousIsBranchClose = previousKey != null && bonds[previousKey]?.value === ')';
      let sourceAtom = atoms[previousIsBranchClose ? previousBondSourceAtom(bondID, keys.all, atoms, bonds) : previousBondSourceAtom(bondID, keys.all, atoms)];
      let targetAtom = atoms[nextAtom(bondID, keys.all, atoms)];
      let sourceIndex = 0;
      let targetIndex = 0;

      if (sourceAtom !== undefined && sourceAtom !== null) {
        sourceIndex = keys.atoms.indexOf(sourceAtom.id);
        if ((bonds[bondID].name === 'double' || bonds[bondID].name === 'triple') && sourceAtom.name === 'H') {
          while ((sourceAtom.name === 'H' || atoms[keys.atoms[sourceIndex]] === undefined) && sourceIndex > -1) {
            sourceAtom = atoms[keys.atoms[sourceIndex]];
            sourceIndex -= 1;
          }
        }
        sourceIndex = keys.all.indexOf(sourceAtom.id);
      }
      if (sourceIndex < 0) {
        continue;
      }
      if (targetAtom !== undefined && targetAtom !== null) {
        targetIndex = keys.all.indexOf(targetAtom.id);
      }

      let exceptions = 0;
      if (targetIndex > bondIndex && bondIndex > sourceIndex) {
        if (bonds[keys.all[bondIndex - 1]] !== undefined) {
          const bond1 = bonds[keys.all[bondIndex - 1]].value;
          const bond2 = bonds[bondID].value;
          switch (bond1) {
            case ')':
            case '(':
              switch (bond2) {
                case '-':
                case '=':
                case '#':
                case '$':
                case ':':
                case '/':
                case '\\':
                case '.':
                  exceptions = previousIsBranchClose ? 0 : 1;
              }
          }
        }
      }

      switch (bonds[bondID].name) {
        case 'single':
          if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
            continue;
          }
          bonds[bondID].order = 1;
          bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
          break;
        case 'double':
          if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
            continue;
          } else if (targetAtom.name === 'H') {
            continue;
          }
          bonds[bondID].order = 2;
          bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
          break;
        case 'triple':
          if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
            continue;
          } else if (targetAtom.name === 'H') {
            continue;
          }
          bonds[bondID].order = 3;
          bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
          break;
        case 'quadruple':
          if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
            continue;
          } else if (targetAtom.name === 'H') {
            continue;
          }
          bonds[bondID].order = 4;
          bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
          break;
        case 'aromatic':
          if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
            continue;
          }
          bonds[bondID].order = 1.5;
          bonds[bondID].isAromatic = true;
          bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
          break;
        case 'stereo': {
          if (targetAtom === undefined) {
            continue;
          }
          // Use branch-aware source detection: C(F)/Cl needs to find C, not F
          let stereoSrcId;
          if (exceptions === 1) {
            stereoSrcId = previousBondSourceAtom(bondID, keys.all, atoms, bonds);
          } else {
            stereoSrcId = sourceAtom?.id ?? null;
          }
          if (!stereoSrcId) {
            continue;
          }
          bonds[bondID].order = 1;
          bonds[bondID].stereo = bonds[bondID].value;
          bonds[bondID].atoms = [atoms[stereoSrcId].id, targetAtom.id];
          break;
        }
        case 'dot':
          if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
            continue;
          }
          bonds[bondID].order = 0;
          bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
          break;
        case 'branch': {
          const keysBefore = keys.all.slice(0, bondIndex).reverse();
          const keysAfter = keys.all.slice(bondIndex + 1, keys.all.length);

          switch (bonds[bondID].value) {
            case '(':
              for (let j = 0, skip = 0; j < keysBefore.length; j++) {
                sourceAtom = atoms[keysBefore[j]];
                if (sourceAtom !== undefined && sourceAtom.name !== 'H' && skip === 0) {
                  let bondOrder = 1;
                  if (sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
                    bondOrder = 1.5;
                  }
                  bonds[bondID].order = bondOrder;
                  bonds[bondID].isAromatic = bondOrder === 1.5;
                  bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                  break;
                } else if (bonds[keysBefore[j]] !== undefined) {
                  switch (bonds[keysBefore[j]].value) {
                    case ')':
                      skip++;
                      break;
                    case '(':
                      skip--;
                      break;
                  }
                }
              }
              for (let j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {
                if (bonds[keysAfter[j]] !== undefined && skip === 0) {
                  switch (bonds[keysAfter[j]].value) {
                    case '-':
                      bondOrder = 1;
                      break;
                    case '=':
                      bondOrder = 2;
                      break;
                    case '#':
                      bondOrder = 3;
                      break;
                    case '.':
                      bondOrder = 0;
                      break;
                  }
                }
                if (skip === 0) {
                  bonds[bondID].order = bondOrder;
                  bonds[bondID].isAromatic = bondOrder === 1.5;
                  break;
                } else if (bonds[keysAfter[j]] !== undefined) {
                  switch (bonds[keysAfter[j]].value) {
                    case ')':
                      skip--;
                      break;
                    case '(':
                      skip++;
                      break;
                  }
                }
              }
              break;

            case ')':
              if (keysAfter.length > 0) {
                const immediateNextBond = bonds[keysAfter[0]];
                if (immediateNextBond && ['-', '=', '#', '$', ':', '/', '\\', '.'].includes(immediateNextBond.value)) {
                  break;
                }
              }
              for (let j = 0, skip = 1; j < keysBefore.length; j++) {
                sourceAtom = atoms[keysBefore[j]];
                if (sourceAtom !== undefined && sourceAtom.name !== 'H' && skip === 0) {
                  bonds[bondID].order = 1;
                  bonds[bondID].atoms[0] = sourceAtom.id;
                  break;
                } else if (bonds[keysBefore[j]] !== undefined) {
                  switch (bonds[keysBefore[j]].value) {
                    case ')':
                      skip++;
                      break;
                    case '(':
                      skip--;
                      break;
                  }
                }
              }
              for (let j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {
                targetAtom = atoms[keysAfter[j]];
                if (bonds[keysAfter[j]] !== undefined && skip === 0) {
                  switch (bonds[keysAfter[j]].value) {
                    case '-':
                      bondOrder = 1;
                      break;
                    case '=':
                      bondOrder = 2;
                      break;
                    case '#':
                      bondOrder = 3;
                      break;
                    case '.':
                      bondOrder = 0;
                      break;
                  }
                }
                if (targetAtom !== undefined && skip === 0) {
                  if (sourceAtom !== undefined && sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
                    bondOrder = 1.5;
                  }
                  bonds[bondID].order = bondOrder;
                  bonds[bondID].isAromatic = bondOrder === 1.5;
                  bonds[bondID].atoms[1] = targetAtom.id;
                  break;
                } else if (bonds[keysAfter[j]] !== undefined) {
                  switch (bonds[keysAfter[j]].value) {
                    case ')':
                      skip--;
                      break;
                    case '(':
                      skip++;
                      break;
                  }
                }
              }
              break;
          }
          break;
        }
        case 'ring': {
          // Skip tokens already consumed as the closing end of an earlier pair.
          // This prevents spurious bonds when a ring-closure digit is reused.
          if (matchedRingTargets.has(bondID)) {
            break;
          }

          const sourceID = bonds[bondID].value.match(/[0-9]+/g);
          const bondsBefore = keys.bonds.slice(0, keys.bonds.indexOf(bondID));
          const bondsAfter = keys.bonds.slice(keys.bonds.indexOf(bondID), keys.bonds.length);

          for (let j = 1; j < bondsAfter.length; j++) {
            if (bonds[bondsAfter[j]].name !== 'ring') {
              continue;
            }
            if (matchedRingTargets.has(bondsAfter[j])) {
              continue;
            }
            const targetID = bonds[bondsAfter[j]].value.match(/[0-9]+/g);
            let targetIndex = bondsAfter[j];
            let srcIdx = bondID;

            if (sourceID !== null && targetID !== null && sourceID[0] === targetID[0]) {
              // Walk backward to find the owning atom. Skip bracket-H atoms
              // (e.g. the H in [C@H]) because they are not valid ring endpoints.
              srcIdx = resolveRingEndpointIndex(srcIdx);
              targetIndex = resolveRingEndpointIndex(targetIndex);
              if (srcIdx === null || targetIndex === null) {
                continue;
              }
              if (srcIdx === targetIndex) {
                // Reused ring digits can appear multiple times on the same atom.
                // Keep searching for the next valid partner instead of creating
                // an impossible self-loop.
                continue;
              }
              let bondOrder = 1;
              if (atoms[srcIdx].properties.aromatic === 1 && atoms[targetIndex].properties.aromatic === 1) {
                bondOrder = 1.5;
              }
              // Prefer explicit bond type encoded in either ring token's term (e.g. 'C=1' or 'c:1')
              const srcBO = ringTokenBondOrder(bonds[bondID].value);
              const tgtBO = ringTokenBondOrder(bonds[bondsAfter[j]].value);
              if (srcBO !== null) {
                bondOrder = srcBO;
              } else if (tgtBO !== null) {
                bondOrder = tgtBO;
              }
              bonds[bondID].order = bondOrder;
              bonds[bondID].isAromatic = bondOrder === 1.5;
              bonds[bondID].atoms = [srcIdx.toString(), targetIndex.toString()];
              matchedRingTargets.add(bondsAfter[j]);
              break;
            }

            if (j === bondsAfter.length - 1) {
              for (let k = 0; k < bondsBefore.length; k++) {
                if (bonds[bondsBefore[k]].name !== 'ring' || matchedRingTargets.has(bondsBefore[k])) {
                  continue;
                }
                const targetID2 = bonds[bondsBefore[k]].value.match(/[0-9]+/g);
                let targetIndex = bondID;
                let srcIdx = bondsBefore[k];
                if (sourceID !== null && targetID2 !== null && sourceID[0] === targetID2[0]) {
                  srcIdx = resolveRingEndpointIndex(srcIdx);
                  targetIndex = resolveRingEndpointIndex(targetIndex);
                  if (srcIdx === null || targetIndex === null) {
                    continue;
                  }
                  if (srcIdx === targetIndex) {
                    continue;
                  }
                  let bondOrder = 1;
                  if (atoms[srcIdx].properties.aromatic === 1 && atoms[targetIndex].properties.aromatic === 1) {
                    bondOrder = 1.5;
                  }
                  const srcBO = ringTokenBondOrder(bonds[bondsBefore[k]].value);
                  const tgtBO = ringTokenBondOrder(bonds[bondID].value);
                  if (srcBO !== null) {
                    bondOrder = srcBO;
                  } else if (tgtBO !== null) {
                    bondOrder = tgtBO;
                  }
                  bonds[bondID].order = bondOrder;
                  bonds[bondID].isAromatic = bondOrder === 1.5;
                  bonds[bondID].atoms = [srcIdx.toString(), targetIndex.toString()];
                  break;
                }
              }
            }
          }
          break;
        }
      }
    }

    // Remove duplicate / incomplete bonds
    for (let i = 0; i < keys.bonds.length; i++) {
      if (keys.bonds[i] === undefined) {
        keys.bonds.splice(i, 1);
        i--;
        continue;
      }
      if (bonds[keys.bonds[i]].atoms.length !== 2) {
        delete bonds[keys.bonds[i]];
        keys.bonds.splice(i, 1);
        i--;
        continue;
      }
      if (i === keys.bonds.length - 1) {
        continue;
      }

      const bondsAfter = keys.bonds.slice(i, keys.bonds.length);
      for (let j = 0; j < bondsAfter.length; j++) {
        if (j === 0) {
          continue;
        }
        const bondID2 = bondsAfter[j];
        const a = bonds[keys.bonds[i]];
        const b = bonds[bondID2];
        if (a === undefined || b === undefined) {
          continue;
        }
        if ((a.atoms[0] === b.atoms[0] && a.atoms[1] === b.atoms[1]) || (a.atoms[0] === b.atoms[1] && a.atoms[1] === b.atoms[0])) {
          if (a.name === 'ring' && b.name === 'ring') {
            delete bonds[bondID2];
            keys.bonds.splice(keys.bonds.indexOf(bondID2), 1);
          } else if (a.name === 'branch' && (b.name === 'single' || b.name === 'double' || b.name === 'triple')) {
            delete bonds[keys.bonds[i]];
            keys.bonds.splice(i, 1);
          } else if ((a.name === 'single' || a.name === 'double' || a.name === 'triple') && b.name === 'branch') {
            delete bonds[bondID2];
            keys.bonds.splice(keys.bonds.indexOf(bondID2), 1);
          } else {
            delete bonds[keys.bonds[i]];
            keys.bonds.splice(i, 1);
          }
          i--;
          break;
        }
      }
    }

    // Add bond references to atoms
    for (let i = 0; i < keys.bonds.length; i++) {
      const bondID2 = keys.bonds[i];
      if (bonds[bondID2].name === 'dot') {
        continue;
      }
      const sourceID = bonds[bondID2].atoms[0];
      const targetID = bonds[bondID2].atoms[1];
      if (sourceID === undefined || targetID === undefined) {
        continue;
      }
      atoms[sourceID].bonds.id.push(bondID2);
      atoms[targetID].bonds.id.push(bondID2);
      atoms[sourceID].bonds.atoms.push(targetID);
      atoms[targetID].bonds.atoms.push(sourceID);
      atoms[sourceID].bonds.electrons += bonds[bondID2].order;
      atoms[targetID].bonds.electrons += bonds[bondID2].order;
    }

    return [atoms, bonds, keys];
  }

  function implicitBonds(atoms, bonds, keys) {
    // Standard valences for atoms with multiple allowed valences (OpenSMILES organic subset).
    // Aromatic atoms are excluded: their 1.5-order bonds give fractional electron sums that
    // must not be fed into the integer valence table — use 18−group for them as before.
    const MULTI_VALENCE = { B: [3], N: [3, 5], P: [3, 5], S: [2, 4, 6] };
    const stdValence = atom => {
      if (!atom.properties.aromatic) {
        const mv = MULTI_VALENCE[atom.name];
        if (mv) {
          const v = mv.find(x => x >= atom.bonds.electrons);
          return v !== undefined ? v : mv[mv.length - 1];
        }
      }
      return 18 - atom.group;
    };

    const valence = group => {
      if (group === 0 || (group > 2 && group <= 12)) {
        return 12;
      } else if (group <= 2) {
        return 2;
      } else if (group > 12 && group <= 18) {
        return 18;
      }
    };

    const charge = (electrons, ch) => {
      if (ch > 0) {
        return electrons - ch;
      }
      return electrons;
    };

    const checkRow = (group, protons, electrons) => {
      if (group > 12 && protons > 10 && electrons <= 0) {
        return electrons + 4;
      } else {
        return electrons;
      }
    };

    const updateAtomsBonds = (sourceID, targetID, bondID, bondOrder) => {
      atoms[sourceID].bonds.id.push(bondID);
      atoms[targetID].bonds.id.push(bondID);
      atoms[sourceID].bonds.atoms.push(targetID);
      atoms[targetID].bonds.atoms.push(sourceID);
      atoms[sourceID].bonds.electrons += bondOrder;
      atoms[targetID].bonds.electrons += bondOrder;
    };

    const shouldSkipHydrogenTraversal = atom => atom?.name === 'H' && (isAuxiliaryBracketHydrogen(atom) || atom.bonds.atoms.some(targetID => atoms[targetID]?.name !== 'H'));

    for (let i = 0; i < keys.atoms.length - 1; i++) {
      let sourceAtom = atoms[keys.atoms[i]];
      const targetAtom = atoms[keys.atoms[i + 1]];
      let sourceIndex = i;

      while ((shouldSkipHydrogenTraversal(sourceAtom) || atoms[keys.atoms[sourceIndex]] === undefined) && sourceIndex > -1) {
        sourceAtom = atoms[keys.atoms[sourceIndex]];
        sourceIndex -= 1;
      }
      if (!sourceAtom) {
        continue;
      }

      let sourceTotal = charge(valence(sourceAtom.group) - sourceAtom.bonds.electrons, sourceAtom.properties.charge);
      let targetTotal = charge(valence(targetAtom.group) - targetAtom.bonds.electrons, targetAtom.properties.charge);
      sourceTotal = checkRow(sourceAtom.group, sourceAtom.properties.protons, sourceTotal);
      targetTotal = checkRow(targetAtom.group, targetAtom.properties.protons, targetTotal);

      if (sourceTotal <= 0 || targetTotal <= 0) {
        continue;
      }
      if (sourceAtom.bonds.atoms.indexOf(targetAtom.id) !== -1) {
        continue;
      }

      const n = keys.all.indexOf(targetAtom.id) - keys.all.indexOf(sourceAtom.id);
      let exceptions = 0;

      if (n > 1) {
        const keysBetween = keys.all.slice(keys.all.indexOf(sourceAtom.id) + 1, keys.all.indexOf(targetAtom.id));
        for (let j = 0; j < keysBetween.length; j++) {
          if (bonds[keysBetween[j]] === undefined) {
            exceptions += 0;
          } else if (bonds[keysBetween[j]].name !== 'ring') {
            exceptions += 1;
          }
        }
      }

      if (exceptions === 0) {
        const bondID = sourceAtom.name + sourceAtom.id + (targetAtom.name + targetAtom.id);
        const bondValue = sourceAtom.name + targetAtom.name;
        let bondName = 'single';
        let bondOrder = 1;
        if (sourceAtom.name === 'H' || targetAtom.name === 'H') {
          bondName = 'H';
        }
        if (sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
          bondName = 'aromatic';
          bondOrder = 1.5;
        }
        keys.bonds.push(bondID);
        bonds[bondID] = addBondV1(bondID, bondName, bondValue, bondOrder, [sourceAtom.id, targetAtom.id]);
        updateAtomsBonds(sourceAtom.id, targetAtom.id, bondID, bondOrder);
      }
    }

    // Add implicit hydrogen
    const H = elements.H;

    const update = (x, sourceID, sourceName) => {
      const bondID = `H${x + 1}${sourceName}${sourceID}`;
      const targetID = bondID;
      atoms[targetID] = addAtomV1(targetID, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);
      bonds[bondID] = addBondV1(bondID, 'H', 'H', 1, [sourceID, targetID]);
      atoms[sourceID].bonds.id.push(bondID);
      atoms[sourceID].bonds.atoms.push(targetID);
      atoms[sourceID].bonds.electrons += 1;
      atoms[targetID].bonds.id.push(bondID);
      atoms[targetID].bonds.atoms.push(sourceID);
      atoms[targetID].bonds.electrons += 1;
    };

    for (let i = 0; i < keys.atoms.length; i++) {
      const sourceAtom = atoms[keys.atoms[i]];
      if (sourceAtom.group === 0 || (sourceAtom.group < 13 && sourceAtom.group > 1)) {
        continue;
      }

      const bondCount = sourceAtom.bonds.atoms.length;

      if (sourceAtom.name !== 'H' && bondCount > 0) {
        for (let j = 0; j < bondCount; j++) {
          const targetID = sourceAtom.bonds.atoms[j];
          const targetAtom = atoms[targetID];
          if (targetAtom.name === 'H') {
            const count = parseInt(targetAtom.value.match(/[0-9]+/g));
            if (count > 1 && count < sourceAtom.electrons) {
              for (let k = 0; k < count - 1; k++) {
                update(k, sourceAtom.id, sourceAtom.name);
              }
            }
          }
        }
      } else if (sourceAtom.name === 'H' && sourceAtom.properties.charge === 0 && bondCount === 0) {
        update(i, sourceAtom.id, sourceAtom.name);
      }

      // Bracket atoms carry explicit H only — skip the valence-fill logic.
      if (sourceAtom.bracketAtom) {
        continue;
      }

      let total = stdValence(sourceAtom) - sourceAtom.bonds.electrons;
      const ch = sourceAtom.properties.charge;
      if (total <= 0 || sourceAtom.group === 1) {
        continue;
      }
      if (ch > 0) {
        total -= ch;
      } else if (ch < 0) {
        total += ch;
        if (total === 1) {
          total -= 1;
          atoms[sourceAtom.id].bonds.electrons += 1;
        }
      }
      if (total <= 0) {
        continue;
      }
      for (let j = 0; j < total; j++) {
        if (sourceAtom.properties.aromatic === 1 && j > 1) {
          continue;
        }
        update(j, sourceAtom.id, sourceAtom.name);
      }
    }

    return [atoms, bonds, keys];
  }

  function clean(atoms, bonds) {
    const atomID = Object.keys(atoms);
    const bondID = Object.keys(bonds);

    for (let i = 0; i < bondID.length; i++) {
      const source = atoms[bonds[bondID[i]].atoms[0]];
      const target = atoms[bonds[bondID[i]].atoms[1]];
      const order = bonds[bondID[i]].order;
      bonds[bondID[i]].value = source.name + order + target.name;
    }

    const getID = (name, i) => name + (i + 1);
    const setID = (obj, a, b) => {
      if (Object.prototype.hasOwnProperty.call(obj, a)) {
        obj[b] = obj[a];
        delete obj[a];
      }
    };

    for (let i = 0; i < atomID.length; i++) {
      const oldID = atomID[i];
      const newID = getID(atoms[oldID].name, i);
      atoms[oldID].id = newID;
      for (let j = 0; j < atoms[oldID].bonds.id.length; j++) {
        let key = atoms[oldID].bonds.id[j];
        let index = bonds[key].atoms.indexOf(oldID);
        if (index !== -1) {
          bonds[key].atoms[index] = newID;
        }
        key = atoms[oldID].bonds.atoms[j];
        index = atoms[key].bonds.atoms.indexOf(oldID);
        if (index !== -1) {
          atoms[key].bonds.atoms[index] = newID;
        }
      }
      setID(atoms, oldID, newID);
    }

    return [atoms, bonds];
  }

  const validTokens = validateTokens(tokens);
  if (!validTokens) {
    throw new Error('Invalid SMILES: token validation failed');
  }

  const readResult = readTokens(validTokens);
  if (!readResult || !Array.isArray(readResult) || readResult.length < 4) {
    throw new Error('Invalid SMILES: could not parse atoms/bonds');
  }
  let [atoms, bonds, , keys] = readResult;
  const properties = readResult[2];

  if (!atoms || Object.keys(atoms).length < 1) {
    throw new Error('Invalid SMILES: no atoms found');
  }

  atoms = defaultAtoms(atoms, keys);
  atoms = updateAtomProps(atoms, properties, keys);

  const _explicit = explicitBonds(atoms, bonds, keys);
  atoms = _explicit[0];
  bonds = _explicit[1];
  keys = _explicit[2];

  const _implicit = implicitBonds(atoms, bonds, keys);
  atoms = _implicit[0];
  bonds = _implicit[1];
  keys = _implicit[2];

  const _clean = clean(atoms, bonds);
  atoms = _clean[0];
  bonds = _clean[1];

  return { atoms, bonds };
}

/**
 * Scans backward from `bracketOpenPos - 1` to find the position of the
 * "from" atom: the atom immediately before the `[` of a bracket atom in the
 * SMILES chain, correctly skipping `(…)` branches and treating `[…]` bracket
 * atoms as single units.
 *
 * Returns the character index of the from-atom, or -1 if none (chain start).
 * @param {number}        bracketOpenPos - index of the `[` character
 * @param {string} smiles - SMILES notation string.
 * @param {Map<number,string>} posToClean - char-position → clean atom ID
 * @returns {number} The computed numeric value.
 */
function findFromAtomPos(bracketOpenPos, smiles, posToClean) {
  let i = bracketOpenPos - 1;
  while (i >= 0) {
    if (smiles[i] === ')') {
      // Skip entire matching (…) branch going backward
      let depth = 1;
      i--;
      while (i >= 0 && depth > 0) {
        if (smiles[i] === ')') {
          depth++;
        } else if (smiles[i] === '(') {
          depth--;
        }
        i--;
      }
    } else if (smiles[i] === ']') {
      // Find matching [ going backward, then grab the atom inside
      let j = i - 1;
      while (j >= 0 && smiles[j] !== '[') {
        j--;
      }
      for (let k = j + 1; k < i; k++) {
        if (posToClean.has(k)) {
          return k;
        }
      }
      i = j - 1;
    } else if (posToClean.has(i)) {
      return i;
    } else {
      i--;
    }
  }
  return -1;
}

/**
 * Returns the character position of the atom that owns a ring token.
 *
 * Ring tokens sometimes include the atom text inside the token span
 * (`[C@H]1`, `C=1`) and sometimes start at the digit immediately after the
 * atom (`C1`, `[C@@H]4`). Prefer an atom token that falls inside the ring
 * token span, then fall back to the nearest atom token immediately before the
 * ring token.
 * @param {{ index: number, term: string }} ringToken - Ring-closure token object.
 * @param {Array<{ index: number }>} atomTokens - The atomTokens value.
 * @returns {number|null} The computed value, or `null` if not applicable.
 */
function findRingTokenAtomPos(ringToken, atomTokens) {
  const direct = atomTokens.find(atom => atom.index >= ringToken.index && atom.index < ringToken.index + ringToken.term.length);
  if (direct) {
    return direct.index;
  }

  let previous = null;
  for (const atom of atomTokens) {
    if (atom.index > ringToken.index) {
      break;
    }
    previous = atom;
  }
  return previous?.index ?? null;
}

/**
 * Builds a map from clean atom ID → SMILES chirality neighbour order for every
 * `@`/`@@` atom in the SMILES string.
 *
 * The clean atom ID scheme mirrors what `decode()`'s internal `clean()` step
 * produces: atoms are numbered sequentially by ascending character position,
 * and each gets the ID `<elementSymbol><rank>` (e.g. `C1`, `H3`, `N4`).
 *
 * The SMILES chirality neighbour order is:
 *   0. the "from" atom (the last atom token before the opening `[`)
 *   1. the bracket H (the first atom token inside `[…]`, if any)
 *   2+ remaining neighbours in left-to-right SMILES string order
 *        (first atom of each `(…)` branch, then the chain continuation)
 *
 * Ring-closure bonds at the chiral centre are handled: both ring tokens
 * embedded inside the bracket and depth-0 ring closures after `]` are
 * inserted into the neighbour list in SMILES reading order.  Chain-start
 * atoms (no preceding atom) are also supported.
 * @param {string}   smiles  - original SMILES string
 * @param {object[]} tokens  - token list from {@link tokenize}
 * @returns {Map<string, {chiral: '@'|'@@', neighbors: string[]}>} The resulting map.
 */
function extractChiralNeighborOrders(smiles, tokens) {
  // ── 1. Build position → cleanId map ─────────────────────────────────────
  // clean() numbers atoms by their order in Object.keys(atoms), which for
  // numeric-string keys is ascending numeric (= character-position) order,
  // followed by non-numeric keys (implicit H atoms — ignored here because
  // chiral centres always use bracket notation with explicit atoms).
  const atomTokens = tokens.filter(t => t.type === 'atom').sort((a, b) => a.index - b.index);

  const posToClean = new Map(); // char position → clean ID
  atomTokens.forEach((t, i) => posToClean.set(t.index, t.tag + (i + 1)));

  // ── 2. Collect chiral property tokens ───────────────────────────────────
  // Property regex for chiral matches "C@" or "C@@" (element + token).
  const chiralProps = tokens.filter(t => t.type === 'property' && t.tag === 'chiral');

  const result = new Map();

  for (const cp of chiralProps) {
    // cp.term  = 'C@' or 'C@@'
    // cp.index = character position of the element in the SMILES string
    const chiralToken = cp.term.includes('@@') ? '@@' : '@';
    const atomPos = cp.index;
    const cleanId = posToClean.get(atomPos);
    if (!cleanId) {
      continue;
    }

    // Must be a bracket atom
    if (atomPos === 0 || smiles[atomPos - 1] !== '[') {
      continue;
    }

    // Find closing ']'
    let bracketEnd = -1;
    for (let i = atomPos; i < smiles.length; i++) {
      if (smiles[i] === ']') {
        bracketEnd = i;
        break;
      }
    }
    if (bracketEnd < 0) {
      continue;
    }

    const neighbors = [];

    // ── 2a. From atom: backward scan from '[' properly skipping branches ──
    // Scan backwards from bracketOpenPos-1, skipping (…) branches and
    // treating […] bracket atoms as a single unit.
    // Chain-start atoms (fromPos < 0) have no from-atom; their first neighbour
    // in SMILES order will be the first ring closure or branch/chain atom
    // collected below.
    const bracketOpenPos = atomPos - 1; // we already verified smiles[atomPos-1]==='['
    const fromPos = findFromAtomPos(bracketOpenPos, smiles, posToClean);
    if (fromPos >= 0) {
      neighbors.push(posToClean.get(fromPos));
    }

    // ── 2b. Bracket H: atom token inside (atomPos, bracketEnd) ──────────
    const bracketAtoms = atomTokens.filter(t => t.index > atomPos && t.index < bracketEnd);
    for (const ba of bracketAtoms) {
      neighbors.push(posToClean.get(ba.index));
    }

    // ── 2c-pre. Ring closures embedded in the bracket ────────────────────
    // For atoms like `[C@H]3`, the ring token `H]3` starts inside the
    // bracket (index between atomPos and bracketEnd).  The ring digit `3`
    // appears right after `]` in the SMILES, so the ring partner comes
    // before the chain continuation in SMILES neighbour order.
    const handledRingNums = new Set();
    for (const rt of tokens) {
      if (rt.tag !== 'ring') {
        continue;
      }
      if (rt.index < atomPos || rt.index > bracketEnd) {
        continue;
      }
      const m = rt.term.match(/\d+/);
      if (!m) {
        continue;
      }
      const ringNum = m[0];
      // Find the partner ring token (same ring number, outside our bracket)
      const partner = tokens.find(pt => pt.tag === 'ring' && pt !== rt && pt.term.match(/\d+/)?.[0] === ringNum);
      if (!partner) {
        continue;
      }
      const partnerAtomPos = findRingTokenAtomPos(partner, atomTokens);
      if (partnerAtomPos === null) {
        continue;
      }
      const partnerCleanId = posToClean.get(partnerAtomPos);
      if (partnerCleanId) {
        neighbors.push(partnerCleanId);
        handledRingNums.add(ringNum);
      }
    }

    // ── 2c. Post-bracket neighbours: branches + chain continuation ───────
    // Sort all post-bracket tokens by position and scan depth.
    const postTokens = tokens.filter(t => t.index > bracketEnd).sort((a, b) => a.index - b.index);

    let depth = 0;
    let capturedInBranch = false; // reset per branch

    for (const pt of postTokens) {
      if (pt.type === 'bond' && pt.tag === 'branch') {
        if (pt.term === '(') {
          depth++;
          if (depth === 1) {
            capturedInBranch = false;
          } // new top-level branch
        } else {
          depth--;
        }
      } else if (pt.type === 'atom') {
        if (depth === 0) {
          // Chain continuation — only one
          neighbors.push(posToClean.get(pt.index));
          break;
        } else if (depth === 1 && !capturedInBranch) {
          // First atom of a direct branch
          neighbors.push(posToClean.get(pt.index));
          capturedInBranch = true;
        }
      } else if (pt.tag === 'ring' && depth === 0) {
        const ringNum = pt.term.match(/\d+/)?.[0];
        if (ringNum && !handledRingNums.has(ringNum)) {
          // Unhandled depth-0 ring closure — find the partner and add it
          const partner = tokens.find(pr => pr.tag === 'ring' && pr !== pt && pr.term.match(/\d+/)?.[0] === ringNum);
          if (partner) {
            const partnerAtomPos = findRingTokenAtomPos(partner, atomTokens);
            if (partnerAtomPos !== null) {
              const partnerCleanId = posToClean.get(partnerAtomPos);
              if (partnerCleanId) {
                neighbors.push(partnerCleanId);
                handledRingNums.add(ringNum);
              }
            }
          }
        }
        // Do not break — chain continuation may follow
      }
    }

    if (neighbors.length === 4 && neighbors.every(Boolean)) {
      result.set(cleanId, { chiral: chiralToken, neighbors });
    }
  }

  return result;
}

/**
 * Parses a SMILES string and returns a {@link Molecule}.
 *
 * Internally uses the v1 {@link tokenize} and {@link decode} pipeline,
 * then converts the result into a Molecule. Each Atom gains extra
 * periodic-table properties: `protons`, `neutrons`, `electrons`, `group`, `period`.
 * @param {string} smiles - SMILES notation string.
 * @param {{ preserveAromaticBondOrders?: boolean }} [options] - Configuration options.
 * @returns {Molecule} The resulting molecule.
 * @throws {Error} If the SMILES string cannot be parsed.
 */
export function parseSMILES(smiles, { preserveAromaticBondOrders = true } = {}) {
  if (typeof smiles !== 'string' || smiles.trim() === '') {
    throw new Error('Invalid SMILES input: must be a non-empty string');
  }
  const { tokens } = tokenize(smiles);
  const { atoms: v1Atoms, bonds: v1Bonds } = decode({ tokens });
  const mol = new Molecule();

  for (const atom of Object.values(v1Atoms)) {
    const a = mol.addAtom(
      atom.id,
      atom.name,
      {
        charge: atom.properties.charge,
        aromatic: atom.properties.aromatic === 1
      },
      { recompute: false }
    );
    // Restore isotope-adjusted neutrons — the v1 parser may have overridden
    // the table default (e.g. [13C] sets neutrons = 13 − 6 = 7).
    a.properties.neutrons = atom.neutrons;
  }

  for (const bond of Object.values(v1Bonds)) {
    if (bond.atoms.length !== 2) {
      continue;
    }
    if (bond.name === 'dot') {
      continue;
    }
    const [a, b] = bond.atoms;
    if (!mol.atoms.has(a) || !mol.atoms.has(b)) {
      continue;
    }
    mol.addBond(
      null,
      a,
      b,
      {
        order: bond.order,
        aromatic: bond.name === 'aromatic' || bond.isAromatic === true,
        stereo: bond.stereo || null,
        kind: inferParsedBondKind(mol.atoms.get(a), mol.atoms.get(b))
      },
      false
    );
  }

  // ── Mark bracket H atoms bonded to non-H atoms as invisible ────────────
  // e.g. the H in [C@H] is a stereo H — it needs 2D coords for the wedge
  // bond but should not appear as a visible atom in skeletal rendering.
  for (const v1atom of Object.values(v1Atoms)) {
    if (v1atom.name !== 'H' || !v1atom.bracketAtom) {
      continue;
    }
    const molAtom = mol.atoms.get(v1atom.id);
    if (!molAtom) {
      continue;
    }
    const hasNonHNeighbor = molAtom.getNeighbors(mol).some(n => n && n.name !== 'H');
    if (hasNonHNeighbor) {
      molAtom.visible = false;
    }
  }

  // ── Compute CIP R/S for each chiral centre ──────────────────────────────
  const chiralOrders = extractChiralNeighborOrders(smiles, tokens);
  for (const [cleanId, { chiral, neighbors }] of chiralOrders) {
    const atom = mol.atoms.get(cleanId);
    if (!atom) {
      continue;
    }
    atom.properties.chirality = computeRS(chiral, neighbors, cleanId, mol);
  }

  perceiveAromaticity(mol, { preserveKekule: preserveAromaticBondOrders });

  // Normalize aromatic N-oxide: aromatic N with exocyclic double bond to a
  // terminal O → convert to [n+][O-] (single bond with formal charges).
  // This matches the InChI canonical form so round-trip comparison works.
  for (const [atomId, atom] of mol.atoms) {
    if (!atom.isAromatic() || atom.name !== 'N') {continue;}
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond || bond.properties.aromatic || bond.properties.order !== 2) {continue;}
      const otherId = bond.getOtherAtom(atomId);
      const other = mol.atoms.get(otherId);
      if (!other || other.name !== 'O') {continue;}
      const otherHeavyDeg = other.bonds.filter(bId => {
        const b = mol.bonds.get(bId);
        return b && mol.atoms.get(b.getOtherAtom(otherId))?.name !== 'H';
      }).length;
      if (otherHeavyDeg !== 1) {continue;}
      bond.properties.order = 1;
      atom.setCharge((atom.properties.charge ?? 0) + 1);
      other.setCharge((other.properties.charge ?? 0) - 1);
    }
  }

  mol._recomputeProperties();

  return mol;
}

/**
 * Normal SMILES valence for each organic-subset element (lowest standard valence).
 * @type {Record<string, number>}
 */
const ORGANIC_VALENCE = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, F: 1, Cl: 1, Br: 1, I: 1 };

/**
 * Returns `true` when `atom` is a standard pendant hydrogen that can be
 * represented implicitly in SMILES output (uncharged, mass-number 1, pendant
 * to exactly one non-H atom).
 * @param {import('../core/Atom.js').Atom} atom - The atom object.
 * @param {Set<string>} nonHIds - Set of atom IDs that are not hydrogen.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
function _isStrippable(atom, nonHIds, mol) {
  if (atom.name !== 'H') {
    return false;
  }
  if ((atom.properties.charge ?? 0) !== 0) {
    return false;
  }
  if (atom.properties.protons !== undefined && atom.properties.neutrons !== undefined) {
    if (Math.round(atom.properties.protons + atom.properties.neutrons) !== 1) {
      return false;
    }
  }
  // Must be pendant (exactly 1 bond) and that bond must be to a non-H atom.
  if (atom.bonds.length !== 1) {
    return false;
  }
  const b = mol.bonds.get(atom.bonds[0]);
  return b != null && nonHIds.has(b.getOtherAtom(atom.id));
}

/**
 * Builds the SMILES atom token for `atom`.
 *
 * Returns a bare element symbol when the atom is in the organic subset, has no
 * charge, no non-standard isotope, and the SMILES implicit-H rule would assign
 * exactly `pendantHCount` hydrogens.  Otherwise returns a bracket atom
 * (e.g. `[NH4+]`, `[13CH4]`, `[nH]`).
 * @param {import('../core/Atom.js').Atom} atom - The atom object.
 * @param {number} pendantHCount  - Number of implicit H atoms to encode.
 * @param {number} heavyBondOrder - Sum of bond orders to heavy-atom neighbours.
 * @param {string} [chiralToken] - Chirality token (`@` or `@@`) to embed in the bracket atom, or empty string when absent.
 * @returns {string} The result string.
 */
function _atomToken(atom, pendantHCount, heavyBondOrder, chiralToken = '') {
  const name = atom.name;
  const charge = atom.properties.charge ?? 0;
  const aromatic = atom.properties.aromatic ?? false;

  // Determine if a non-standard isotope is present.
  let massNum = null;
  if (atom.properties.protons !== undefined && atom.properties.neutrons !== undefined) {
    const atomMass = Math.round(atom.properties.protons + atom.properties.neutrons);
    const elData = elements[name];
    const stdMass = elData ? Math.round(elData.protons + elData.neutrons) : atomMass;
    if (atomMass !== stdMass) {
      massNum = atomMass;
    }
  }

  // Bare organic-subset symbol when all conditions are satisfied.
  // Chirality always requires bracket notation.
  if (name in ORGANIC_VALENCE && charge === 0 && massNum === null && chiralToken === '') {
    const impliedH = Math.max(0, ORGANIC_VALENCE[name] - heavyBondOrder);
    if (Math.round(impliedH) === pendantHCount) {
      return aromatic ? name.toLowerCase() : name;
    }
  }

  // Bracket notation: [massSymbolchiralHcountcharge]
  let s = '[';
  if (massNum !== null) {
    s += massNum;
  }
  s += aromatic ? name.toLowerCase() : name;
  if (chiralToken) {
    s += chiralToken;
  }
  if (pendantHCount === 1) {
    s += 'H';
  } else if (pendantHCount > 1) {
    s += `H${pendantHCount}`;
  }
  if (charge > 0) {
    s += charge === 1 ? '+' : `+${charge}`;
  } else if (charge < 0) {
    s += charge === -1 ? '-' : `${charge}`;
  }
  s += ']';
  return s;
}

/**
 * Returns the SMILES bond character for `bond`.
 * Single bonds (order 1) and aromatic bonds both return `''` (implicit).
 *
 * When `fromId` is supplied and the bond has a directional stereo property
 * (`'/'` or `'\\'`), returns the direction relative to `fromId` as the
 * source atom (flipping when `fromId` is `bond.atoms[1]`).
 * @param {import('../core/Bond.js').Bond} bond - The bond object.
 * @param {string|null} [fromId] - The fromId value.
 * @returns {string} The result string.
 */
function _bondToken(bond, fromId = null) {
  if (!bond || bond.properties.aromatic) {
    return '';
  }
  if (bond.properties.stereo && fromId !== null) {
    const s = bond.properties.stereo;
    return bond.atoms[0] === fromId ? s : s === '/' ? '\\' : '/';
  }
  switch (bond.properties.order ?? 1) {
    case 2:
      return '=';
    case 3:
      return '#';
    case 4:
      return '$';
    default:
      return '';
  }
}

/**
 * Formats a ring-closure integer as its SMILES token:
 * single digits 1–9 are written bare; 10+ use `%nn` notation.
 * @param {number} n - Count or dimension.
 * @returns {string} The result string.
 */
function _ringToken(n) {
  return n < 10 ? `${n}` : `%${n}`;
}

/**
 * Serialises a single *connected* `Molecule` component into a SMILES string.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {((atomId: string) => number)|null} [sortFn] - Optional atom-ranking function `(atomId) => number` used by canonical serialisation to enforce a deterministic DFS traversal order.
 * @returns {string} The result string.
 */
function _serializeComponent(mol, sortFn = null) {
  // ---- Identify strippable (implicit) H atoms ----
  const nonHIds = new Set([...mol.atoms.keys()].filter(id => mol.atoms.get(id).name !== 'H'));

  // For each non-H atom, count how many neighbouring H atoms are strippable.
  const pendantH = new Map();
  for (const id of nonHIds) {
    let n = 0;
    for (const bId of mol.atoms.get(id).bonds) {
      const b = mol.bonds.get(bId);
      const other = b && mol.atoms.get(b.getOtherAtom(id));
      if (other && _isStrippable(other, nonHIds, mol)) {
        n++;
      }
    }
    pendantH.set(id, n);
  }

  // Build the heavy-atom subgraph (retains non-strippable H, e.g. [2H] or H2).
  const keepIds = [...mol.atoms.keys()].filter(id => !_isStrippable(mol.atoms.get(id), nonHIds, mol));
  const heavy = mol.getSubgraph(keepIds);

  if (heavy.atomCount === 0) {
    return '';
  }

  // When a canonical sort function is supplied, reorder each atom's bond list
  // by the canonical rank of the other end.  This makes dfs1, _chiralTokenFor,
  // and emit all traverse neighbours in canonical rank order automatically.
  if (sortFn) {
    for (const [atomId, atom] of heavy.atoms) {
      atom.bonds.sort((b1, b2) => {
        const o1 = heavy.bonds.get(b1)?.getOtherAtom(atomId) ?? '';
        const o2 = heavy.bonds.get(b2)?.getOtherAtom(atomId) ?? '';
        return (sortFn(o1) ?? 0) - (sortFn(o2) ?? 0);
      });
    }
  }

  const startId = sortFn
    ? [...heavy.atoms.keys()].reduce((best, id) => ((sortFn(id) ?? Infinity) < (sortFn(best) ?? Infinity) ? id : best))
    : ([...heavy.atoms.entries()].find(([, a]) => a.bonds.length === 1)?.[0] ?? heavy.atoms.keys().next().value);

  // ---- Pass 1: DFS to identify ring-closure bonds ----
  // Back edges in the DFS spanning tree become ring-closure bonds.
  // The "opener" is the ancestor atom (visited earlier); the "closer" is the
  // descendant that discovers the back edge.  The bond symbol is placed at
  // the opener so that the v1 ring-token parser can extract it.
  const visited1 = new Set();
  const inStack1 = new Set();
  const entryBond = new Map(); // atomId → bondId we arrived via
  const ringBondId = new Map(); // bondId → ring-closure number
  const atomRings = new Map(); // atomId → [{num, bond, isOpener}]
  let ringSeq = 1;
  const dfsOrder = new Map(); // atomId → DFS visit sequence number
  let dfsCounter = 0;

  const dfs1 = id => {
    dfsOrder.set(id, dfsCounter++);
    visited1.add(id);
    inStack1.add(id);
    for (const bId of heavy.atoms.get(id).bonds) {
      if (bId === entryBond.get(id)) {
        continue;
      }
      const bond = heavy.bonds.get(bId);
      const nextId = bond.getOtherAtom(id);
      if (!visited1.has(nextId)) {
        entryBond.set(nextId, bId);
        dfs1(nextId);
      } else if (inStack1.has(nextId) && !ringBondId.has(bId)) {
        // Back edge: id = closer, nextId = opener (ancestor).
        const num = ringSeq++;
        ringBondId.set(bId, num);
        if (!atomRings.has(id)) {
          atomRings.set(id, []);
        }
        if (!atomRings.has(nextId)) {
          atomRings.set(nextId, []);
        }
        // Bond symbol at opener so v1 ring-token parser sees it.
        atomRings.get(nextId).push({ num, bond, isOpener: true });
        atomRings.get(id).push({ num, bond, isOpener: false });
      }
    }
    inStack1.delete(id);
  };
  dfs1(startId);

  const ringBondSet = new Set(ringBondId.keys());

  // ---- E/Z stereo normalisation ----
  // Two valid SMILES representations of the same E/Z geometry (e.g. /C=C/ and
  // \C=C\) have different stored stereo characters even though they encode
  // identical geometry.  Without normalisation, toCanonicalSMILES produces
  // different strings for them, breaking sameMolecule() comparisons.
  //
  // Strategy (three phases):
  //   1. Read expected E/Z parity from mol (original bond stereo intact).
  //   2. Clear ALL bond stereo from heavy — this removes redundant directions
  //      on ring-closure chain bonds (e.g. c2\O3 → c2O3) and secondary
  //      substituents that the old per-sp2-atom sweep missed.
  //   3. Set stereo on exactly one primary substituent bond per sp2 atom.
  //
  // This modifies only the heavy-subgraph bond copies, not the original mol.
  {
    // Return the atom that the canonical DFS traverses a bond FROM.
    // For spanning-tree bonds: from = parent (atom whose entryBond ≠ this bond).
    // For ring-closure bonds: from = opener (isOpener === true in atomRings).
    const getFromAtomId = bondId => {
      if (ringBondSet.has(bondId)) {
        for (const [atomId, rings] of atomRings) {
          if (rings.some(r => r.bond.id === bondId && r.isOpener)) {
            return atomId;
          }
        }
        return null;
      }
      const b = heavy.bonds.get(bondId);
      if (!b) {
        return null;
      }
      const [a0, a1] = b.atoms;
      if (entryBond.get(a0) === bondId) {
        return a1;
      } // a0 is child → a1 is parent
      if (entryBond.get(a1) === bondId) {
        return a0;
      } // a1 is child → a0 is parent
      return null;
    };

    // Find the canonical substituent bond on a given sp2 atom.
    // Bonds are already sorted by canonical rank (see sort above), so the first
    // non-double-bond is always the canonical choice regardless of whether it
    // already carries a stereo property (stereo is synthesised from getEZStereo).
    const findSubstituentBond = (sp2Id, dblBondId) => {
      for (const bId of heavy.atoms.get(sp2Id)?.bonds ?? []) {
        if (bId === dblBondId) {
          continue;
        }
        const b = heavy.bonds.get(bId);
        if (b) {
          return { bId, b };
        }
      }
      return null;
    };

    // Phase 1: collect expected parity from mol before any modification.
    const ezEntries = [];
    for (const dblBond of heavy.bonds.values()) {
      if ((dblBond.properties.order ?? 1) !== 2) {
        continue;
      }
      const expectedParity = mol.getEZStereo(dblBond.id);
      if (!expectedParity) {
        continue;
      }
      const [idA, idB] = dblBond.atoms;
      // Use Morgan ranks to pick a canonical A-side regardless of bond atom
      // insertion order (which differs between SMILES-parsed and InChI-parsed).
      const rankA = sortFn ? (sortFn(idA) ?? 0) : 0;
      const rankB = sortFn ? (sortFn(idB) ?? 0) : 0;
      const [idCanoA, idCanoB] = rankA <= rankB ? [idA, idB] : [idB, idA];

      const sAInfo = findSubstituentBond(idCanoA, dblBond.id);
      const sBInfo = findSubstituentBond(idCanoB, dblBond.id);
      if (!sAInfo || !sBInfo) {
        continue;
      }
      const fromA = getFromAtomId(sAInfo.bId);
      const fromB = getFromAtomId(sBInfo.bId);
      if (fromA === null || fromB === null) {
        continue;
      }

      // Detect whether BOTH substituent bonds are "bridge" bonds: bonds that
      // connect the sp2 atom to another double-bond atom (i.e., they are the
      // shared single bond between two consecutive double bonds in a conjugated
      // chain).  For such interior double bonds, getEZStereo() can return a
      // notation-dependent parity because the bridge bond direction is
      // determined by the ADJACENT double bond's notation rather than by a true
      // non-double-bond substituent.  When both sides are bridge bonds, the
      // expected parity is unreliable and Phase 3 should NOT flip any bond to
      // "correct" it — the canonical result already reflects the actual geometry
      // via the already-assigned adjacent bonds.
      const otherA = sAInfo.b.getOtherAtom(idCanoA);
      const sAIsBridge = (heavy.atoms.get(otherA)?.bonds ?? []).some(bId2 => {
        if (bId2 === dblBond.id || bId2 === sAInfo.bId) { return false; }
        return (heavy.bonds.get(bId2)?.properties.order ?? 1) === 2;
      });
      const otherB = sBInfo.b.getOtherAtom(idCanoB);
      const sBIsBridge = (heavy.atoms.get(otherB)?.bonds ?? []).some(bId2 => {
        if (bId2 === dblBond.id || bId2 === sBInfo.bId) { return false; }
        return (heavy.bonds.get(bId2)?.properties.order ?? 1) === 2;
      });
      const bothBridge = sAIsBridge && sBIsBridge;

      ezEntries.push({ dblBond, sA: sAInfo.b, sB: sBInfo.b, expectedParity, fromA, fromB, sABId: sAInfo.bId, bothBridge });
    }

    // Sort ezEntries by DFS emission order of their sA substituent bond.
    // Bond insertion order differs between SMILES-parsed and InChI-parsed
    // molecules, so without sorting, the "once only" cascade can start from
    // opposite ends of a conjugated chain, producing all-flipped stereo.
    {
      const saEmitOrder = bId => {
        if (ringBondSet.has(bId)) {
          for (const [atomId, rings] of atomRings) {
            if (rings.some(r => r.bond.id === bId && r.isOpener)) {
              return dfsOrder.get(atomId) ?? Infinity;
            }
          }
          return Infinity;
        }
        const b = heavy.bonds.get(bId);
        if (!b) { return Infinity; }
        const [a0, a1] = b.atoms;
        if (entryBond.get(a0) === bId) { return dfsOrder.get(a0) ?? Infinity; }
        if (entryBond.get(a1) === bId) { return dfsOrder.get(a1) ?? Infinity; }
        return Infinity;
      };
      ezEntries.sort((a, b) => saEmitOrder(a.sABId) - saEmitOrder(b.sABId));
    }

    // Phase 2: clear ALL bond stereo from heavy so no redundant directions remain
    // (including bonds in ring-closure chains adjacent to sp2 atoms).
    for (const bond of heavy.bonds.values()) {
      if (bond.properties.stereo) {
        bond.properties.stereo = null;
      }
    }

    // Phase 3: set exactly one primary stereo bond per sp2 atom.
    //
    // Two kinds of conjugated-system conflicts require care:
    //
    // (a) SHARED substituent bond: in a 1,3-diene A=B-C=D, the single bond B-C
    //     is the substituent bond for BOTH the A=B double bond (B-side) and the
    //     C=D double bond (C-side).  A naïve per-double-bond loop would overwrite
    //     B-C twice, leaving it correct for only the last writer.  Fix: "once only"
    //     rule — if a substituent bond already carries stereo from a prior iteration,
    //     keep it and flip only the other substituent bond in the trial.
    //
    // (b) DIFFERENT substituent bonds on the same sp2 atom: in a 1,3-diene
    //     A=B-C(R)=D, atom C has substituent B-C (for A=B's B-side) AND substituent
    //     C-R (for C=D's C-side).  After Phase 3, C carries stereo on two bonds.
    //     The isolation below temporarily hides the one that belongs to a different
    //     double bond so getEZStereo sees only the intended pair.
    for (const { dblBond, sA, sB, expectedParity, fromA, fromB, bothBridge } of ezEntries) {
      const [idA, idB] = dblBond.atoms;

      // Temporarily null out stereo on bonds adjacent to either sp2 atom that
      // are not sA or sB — so the getEZStereo trial sees only the two bonds we
      // intend.
      const saved = [];
      for (const sp2Id of [idA, idB]) {
        for (const bId of heavy.atoms.get(sp2Id)?.bonds ?? []) {
          const b = heavy.bonds.get(bId);
          if (b && b !== sA && b !== sB && b.properties.stereo) {
            saved.push({ b, stereo: b.properties.stereo });
            b.properties.stereo = null;
          }
        }
      }

      // "Once only" rule: if sA or sB already carry stereo from a prior iteration
      // (they are the shared bond in a conjugated system), keep them untouched and
      // only adjust the "free" bond in the trial-and-flip step below.
      const sAWasSet = !!sA.properties.stereo;
      const sBWasSet = !!sB.properties.stereo;

      if (!sAWasSet) {
        sA.properties.stereo = sA.atoms[0] === fromA ? '/' : '\\';
      }
      if (!sBWasSet) {
        // Determine B-side by trial: try '/' first; flip if parity is wrong.
        sB.properties.stereo = sB.atoms[0] === fromB ? '/' : '\\';
      }

      if (heavy.getEZStereo(dblBond.id) !== expectedParity && !bothBridge) {
        if (!sBWasSet) {
          sB.properties.stereo = sB.atoms[0] === fromB ? '\\' : '/';
        } else if (!sAWasSet) {
          sA.properties.stereo = sA.atoms[0] === fromA ? '\\' : '/';
        }
      }

      // Restore the stereo that was temporarily cleared.
      for (const { b, stereo } of saved) {
        b.properties.stereo = stereo;
      }
    }
  }

  // ---- Pass 2: DFS emission ----
  const emitted = new Set();

  // ---- Helper: compute @/@@  chirality token for a chiral atom ----
  // Reconstructs the SMILES neighbour order that emit() will produce for this
  // atom and tries both tokens against the stored CIP designation.
  // Returns '' when no unique chirality can be resolved (e.g. fewer than 4
  // distinct CIP ranks).
  const _chiralTokenFor = id => {
    const atom = mol.atoms.get(id);
    if (!atom || !atom.isChiralCenter()) {
      return '';
    }

    // 1. DFS parent — the atom we arrived from.
    const entryBondId = entryBond.get(id);
    const parentId = entryBondId ? (heavy.bonds.get(entryBondId)?.getOtherAtom(id) ?? null) : null;

    // 2. Strippable (implicit) H atom in original mol, if any.
    let hAtomId = null;
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      const other = b && mol.atoms.get(b.getOtherAtom(id));
      if (other && _isStrippable(other, nonHIds, mol)) {
        hAtomId = other.id;
        break;
      }
    }

    // 3. Ring-closure partners in atomRings order.
    const ringPartners = (atomRings.get(id) ?? []).map(({ bond }) => bond.getOtherAtom(id));

    // 4. DFS children (heavy bonds, not ring-bonds, not parent) in bond
    //    iteration order — matches the order emit() uses for branches/chain.
    const childIds = [];
    for (const bId of heavy.atoms.get(id).bonds) {
      if (ringBondSet.has(bId)) {
        continue;
      }
      const b = heavy.bonds.get(bId);
      const nextId = b?.getOtherAtom(id);
      if (nextId && nextId !== parentId) {
        childIds.push(nextId);
      }
    }

    // Assemble SMILES neighbour list in chirality-convention order:
    // from-atom, bracket-H, ring-partners, branch/chain children.
    const neighbors = [];
    if (parentId) {
      neighbors.push(parentId);
    }
    if (hAtomId) {
      neighbors.push(hAtomId);
    }
    neighbors.push(...ringPartners);
    neighbors.push(...childIds);

    if (neighbors.length !== 4) {
      return '';
    }

    const stored = atom.getChirality();
    if (computeRS('@', neighbors, id, mol) === stored) {
      return '@';
    }
    if (computeRS('@@', neighbors, id, mol) === stored) {
      return '@@';
    }
    return '';
  };

  const emit = id => {
    emitted.add(id);
    const atom = heavy.atoms.get(id);

    // Sum of bond orders over all bonds in the heavy subgraph (used for
    // implicit-H calculation; aromatic bonds contribute 1.5 each).
    const heavyBO = atom.bonds.reduce((acc, bId) => acc + (heavy.bonds.get(bId)?.properties.order ?? 1), 0);

    const chiralTok = _chiralTokenFor(id);
    let s = _atomToken(atom, pendantH.get(id) ?? 0, heavyBO, chiralTok);

    // Ring-closure annotations appended right after the atom symbol.
    // Bond character is placed at the opener only.
    for (const { num, bond, isOpener } of atomRings.get(id) ?? []) {
      if (isOpener) {
        const otherId = bond.getOtherAtom(id);
        const bothAromatic = atom.isAromatic() && (heavy.atoms.get(otherId)?.isAromatic() ?? false);
        s += (bothAromatic ? '' : _bondToken(bond, id)) + _ringToken(num);
      } else {
        s += _ringToken(num);
      }
    }

    // Spanning-tree children (non-ring bonds to unvisited atoms).
    const children = [];
    for (const bId of atom.bonds) {
      if (ringBondSet.has(bId)) {
        continue;
      }
      const bond = heavy.bonds.get(bId);
      const nextId = bond.getOtherAtom(id);
      if (!emitted.has(nextId)) {
        children.push({ nextId, bond });
      }
    }

    // All children except the last are written as branches in parentheses.
    for (let i = 0; i < children.length; i++) {
      const { nextId, bond } = children[i];
      const nextAtom = heavy.atoms.get(nextId);
      const bothAromatic = atom.isAromatic() && (nextAtom?.isAromatic() ?? false);
      const bs = bothAromatic ? '' : _bondToken(bond, id);
      s += i < children.length - 1 ? `(${bs}${emit(nextId)})` : `${bs}${emit(nextId)}`;
    }

    return s;
  };

  return emit(startId);
}

/**
 * Serializes a {@link Molecule} to a SMILES string.
 *
 * The output is non-canonical (traversal follows internal atom insertion order)
 * but is valid SMILES that round-trips through {@link parseSMILES} to a
 * chemically equivalent molecule.
 *
 * **Supported features**
 * - Organic-subset atoms with implicit H (B, C, N, O, P, S, F, Cl, Br, I)
 * - Bracket atoms: explicit charge, H count, and isotope mass number
 * - Ring systems (ring-closure numbers 1–99+, `%nn` notation)
 * - Branch notation
 * - Double / triple / quadruple bonds
 * - Aromatic atoms and bonds (lowercase symbols, implicit `:`)
 * - Disconnected molecules as dot-separated components
 *
 * - Tetrahedral chirality (`@` / `@@`) for atoms with a stored CIP
 *   designation (`properties.chirality === 'R'` or `'S'`)
 * - E/Z geometry (`/` / `\\`) on bonds that carry a stored stereo direction
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @returns {string} The result string.
 */
export function toSMILES(molecule) {
  if (molecule.atomCount === 0) {
    return '';
  }
  return molecule
    .getComponents()
    .map(comp => _serializeComponent(comp))
    .join('.');
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {void}
 */
function _normalizeNitroGroup(mol) {
  // Normalize hypervalent N(=O)=O (neutral nitro) to [N+]([O-])=O.
  // InChI always uses the charged form; normalizing here makes toCanonicalSMILES
  // produce the same string for both SMILES-parsed and InChI-parsed molecules.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N') { continue; }
    const charge = atom.properties.charge ?? 0;

    if (charge === 0) {
      // Case 1: neutral N with two double bonds to neutral monovalent O atoms.
      const dblOs = [];
      for (const bondId of atom.bonds) {
        const bond = mol.bonds.get(bondId);
        if (!bond || (bond.properties.order ?? 1) !== 2) { continue; }
        const o = mol.atoms.get(bond.getOtherAtom(atom.id));
        if (!o || o.name !== 'O' || (o.properties.charge ?? 0) !== 0) { continue; }
        const oHeavyDegree = o.bonds.filter(bid => {
          const b = mol.bonds.get(bid);
          return b && mol.atoms.get(b.getOtherAtom(o.id))?.name !== 'H';
        }).length;
        if (oHeavyDegree === 1) { dblOs.push({ bond, o }); }
      }
      if (dblOs.length < 2) { continue; }
      atom.setCharge(1);
      dblOs[dblOs.length - 1].bond.properties.order = 1;
      dblOs[dblOs.length - 1].o.setCharge(-1);

    } else if (charge === -1) {
      // Case 2: inverted nitro [N-](=O)[O+] → [N+]([O-])=O.
      // InChI occasionally reconstructs the nitro group with N carrying -1 and
      // the single-bonded O carrying +1 instead of the conventional N+/O- form.
      let dblO = null;
      let sngOPlus = null;
      for (const bondId of atom.bonds) {
        const bond = mol.bonds.get(bondId);
        if (!bond) { continue; }
        const o = mol.atoms.get(bond.getOtherAtom(atom.id));
        if (!o || o.name !== 'O') { continue; }
        const oCharge = o.properties.charge ?? 0;
        const oHeavyDegree = o.bonds.filter(bid => {
          const b = mol.bonds.get(bid);
          return b && mol.atoms.get(b.getOtherAtom(o.id))?.name !== 'H';
        }).length;
        if (oHeavyDegree !== 1) { continue; }
        const order = bond.properties.order ?? 1;
        if (order === 2 && oCharge === 0) { dblO = { bond, o }; }
        else if (order === 1 && oCharge === 1) { sngOPlus = { bond, o }; }
      }
      if (!dblO || !sngOPlus) { continue; }
      atom.setCharge(1);
      sngOPlus.o.setCharge(-1);
    }
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {void}
 */
function _normalizeAmidiniumResonance(mol) {
  // Normalize amidinium/guanidinium resonance forms so toCanonicalSMILES always
  // returns the same string regardless of which resonance form was stored.
  //
  // Case 1  – [NH+]=C-NH2 → [NH2+]=C-NH  (amidinium / 2-arm guanidinium, h=2)
  // Case 1b – [N+]=C-NH   → [NH+]=C-N    (ring amidinium: double bond on N with fewer H)
  // Case 2  – [NH2+]-C(=NH) → NC(=[NH2+])  (guanidinium: charge/H on wrong N)
  //
  // Canonical form rule: the double bond (and charge) belongs on the N atom with
  // the greater H count.  Cases 1/1b handle the direct C(=N+)(N) pattern; Case 2
  // handles the single-bonded [NH2+] where the double bond is already on the other N.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C') { continue; }
    let iminiumBond = null;      // [NH+]= or [N+]= (double, charge +1) — store h too
    let amineBond = null;        // -NH2 (single, charge 0, 2H)
    let amineBondH1 = null;      // -NH  (single, charge 0, 1H) — for Case 1b
    let chargedSingleBond = null; // [NH2+]- (single, charge +1, 2H)
    let unchainedDoubleBond = null; // =N (double, charge 0)
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) { continue; }
      const n = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!n || n.name !== 'N') { continue; }
      const order = bond.properties.order ?? 1;
      const h = n.getHydrogenNeighbors(mol).length;
      const charge = n.properties.charge ?? 0;
      if (order === 2 && charge === 1)         { iminiumBond          = { bond, n, h }; }
      else if (order === 1 && h === 2 && charge === 0) { amineBond    = { bond, n }; }
      else if (order === 1 && h === 1 && charge === 0) { amineBondH1  = { bond, n }; }
      else if (order === 1 && h === 2 && charge === 1) { chargedSingleBond = { bond, n }; }
      else if (order === 2 && charge === 0)    { unchainedDoubleBond  = { bond, n }; }
    }
    // Case 1: [NH+]=C-NH2 → [NH2+]=C-NH  (iminiumBond.h=1, amineBond.h=2)
    if (iminiumBond && amineBond) {
      iminiumBond.bond.properties.order = 1;
      iminiumBond.n.setCharge(0);
      amineBond.bond.properties.order = 2;
      amineBond.n.setCharge(1);
    }
    // Case 1b: [N+]=C-NH → [NH+]=C-N  (ring amidinium where iminiumBond has fewer H
    // than the single-bonded N; move double bond + charge to the more-hydrogenated N)
    else if (iminiumBond && !amineBond && amineBondH1 && iminiumBond.h === 0) {
      iminiumBond.bond.properties.order = 1;
      iminiumBond.n.setCharge(0);
      amineBondH1.bond.properties.order = 2;
      amineBondH1.n.setCharge(1);
    }
    // Case 2: [NH2+]-C(=NH) → NC(=[NH2+])  (move H and charge to the double-bonded N)
    // The bond orders are already correct (allyl-N single, terminal-N double).
    // Transfer +1 charge from chargedSingleBond.n → unchainedDoubleBond.n, then let
    // _adjustImplicitHydrogens recompute H counts based on the new charges:
    //   allyl-N  (charge 1→0, single bond × 2): neededH = max(0, 3-2+0) = 1
    //   terminal-N (charge 0→1, double bond):   neededH = max(0, 3-2+1) = 2  → [NH2+]
    else if (chargedSingleBond && unchainedDoubleBond) {
      chargedSingleBond.n.setCharge(0);
      unchainedDoubleBond.n.setCharge(1);
      mol._adjustImplicitHydrogens(chargedSingleBond.n.id);
      mol._adjustImplicitHydrogens(unchainedDoubleBond.n.id);
    }
  }
}

function _normalizeImineTautomer(mol) {
  // Convert [CH-]-NH to CH=[NH-] (imine anion). InChI normalizes alpha-carbanions
  // bonded to NH groups by moving the carbanion charge to N, producing the imine anion.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C' || (atom.properties.charge ?? 0) !== -1) {continue;}
    if (atom.getHydrogenNeighbors(mol).length === 0) {continue;}
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {continue;}
      const n = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!n || n.name !== 'N' || (n.properties.charge ?? 0) !== 0) {continue;}
      if (n.getHydrogenNeighbors(mol).length === 0) {continue;}
      bond.properties.order = 2;
      atom.setCharge(0);
      n.setCharge(-1);
      break;
    }
  }
}

function _normalizeEnolateToChain(mol) {
  // InChI prefers the enolate charge on the exocyclic (chain) carbon rather than
  // on the ring carbon in a 1,3-dicarbonyl system.
  // Pattern: O_a([O-]) - C_b(ring) = C_c(ring) - C_d(chain) = O_e
  // Converts to:         O_a=C_b - C_c = C_d - O_e([O-])
  // Only fires when C_b is a ring atom and C_d is not a ring atom, and none
  // of the ring carbons are aromatic (to avoid breaking aromaticity).
  const rings = mol.getRings();
  const ringAtomIds = new Set(rings.flat());
  outer: for (const oA of mol.atoms.values()) {
    if (oA.name !== 'O' || (oA.properties.charge ?? 0) !== -1) {continue;}
    for (const bAB of oA.bonds) {
      const bondAB = mol.bonds.get(bAB);
      if (!bondAB || (bondAB.properties.order ?? 1) !== 1) {continue;}
      const cB = mol.atoms.get(bondAB.getOtherAtom(oA.id));
      if (!cB || cB.name !== 'C' || !ringAtomIds.has(cB.id)) {continue;}
      if (cB.properties.aromatic) {continue;}
      for (const bBC of cB.bonds) {
        if (bBC === bAB) {continue;}
        const bondBC = mol.bonds.get(bBC);
        if (!bondBC || (bondBC.properties.order ?? 1) !== 2) {continue;}
        const cC = mol.atoms.get(bondBC.getOtherAtom(cB.id));
        if (!cC || cC.name !== 'C' || !ringAtomIds.has(cC.id)) {continue;}
        if (cC.properties.aromatic) {continue;}
        for (const bCD of cC.bonds) {
          if (bCD === bBC) {continue;}
          const bondCD = mol.bonds.get(bCD);
          if (!bondCD || (bondCD.properties.order ?? 1) !== 1) {continue;}
          const cD = mol.atoms.get(bondCD.getOtherAtom(cC.id));
          if (!cD || cD.name !== 'C' || ringAtomIds.has(cD.id)) {continue;}
          for (const bDE of cD.bonds) {
            if (bDE === bCD) {continue;}
            const bondDE = mol.bonds.get(bDE);
            if (!bondDE || (bondDE.properties.order ?? 1) !== 2) {continue;}
            const oE = mol.atoms.get(bondDE.getOtherAtom(cD.id));
            if (!oE || oE.name !== 'O' || (oE.properties.charge ?? 0) !== 0) {continue;}
            // Found: O_a([O-])-C_b(ring)=C_c(ring)-C_d(chain)=O_e
            // Transform: O_a=C_b-C_c=C_d-O_e([O-])
            oA.setCharge(0);
            bondAB.properties.order = 2;
            bondBC.properties.order = 1;
            bondCD.properties.order = 2;
            bondDE.properties.order = 1;
            oE.setCharge(-1);
            continue outer;
          }
        }
      }
    }
  }
}

function _normalizeCarbanionEnolate(mol) {
  // Convert [C-]-C=O (carbanion alpha to carbonyl) to C=C-[O-] (enolate).
  // Also handles the vinylogous case [C-]-C-C-C=O via sp2/aromatic intermediates:
  // [C-]-(1)-Csp2-(1 or 1.5)-Csp2-(1)-C=O → C=Csp2-Csp2=C-[O-].
  // InChI normalizes alpha-carbanions to their enolate tautomers, placing the
  // negative charge on oxygen. After this shift, perceiveAromaticity can then
  // correctly recognize the resulting ring as aromatic when applicable.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C' || (atom.properties.charge ?? 0) !== -1) {continue;}
    // Skip when [C-] is directly bonded to an NH nitrogen: InChI prefers the
    // imine tautomer ([CH-]-NH-C=O → C=[NH-]) over the enolate in that case.
    const hasNHNeighbor = atom.bonds.some(bId => {
      const b = mol.bonds.get(bId);
      if (!b) {return false;}
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      return other && other.name === 'N' && other.getHydrogenNeighbors(mol).length > 0;
    });
    if (hasNHNeighbor) {continue;}
    let found = false;
    for (const bondId of atom.bonds) {
      if (found) {break;}
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {continue;}
      const cMid1 = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!cMid1 || cMid1.name !== 'C') {continue;}
      // Direct case: [C-]-C=O
      for (const bId of cMid1.bonds) {
        if (bId === bondId) {continue;}
        const b = mol.bonds.get(bId);
        if (!b || (b.properties.order ?? 1) !== 2) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(cMid1.id));
        if (!other || other.name !== 'O' || (other.properties.charge ?? 0) !== 0) {continue;}
        bond.properties.order = 2;
        atom.setCharge(0);
        b.properties.order = 1;
        other.setCharge(-1);
        found = true;
        break;
      }
      if (found) {break;}
      // Vinylogous case: [C-]-(1)-Csp2-(pi)-Csp2-(1)-C=O
      const mid1Order = bond.properties.order ?? 1;
      if (mid1Order !== 1) {continue;}
      const mid1HasPi = [...cMid1.bonds].some(b2Id => {
        const b2 = mol.bonds.get(b2Id);
        return b2 && (b2.properties.order === 2 || b2.properties.order === 1.5 || b2.properties.aromatic);
      });
      if (!mid1HasPi) {continue;}
      for (const b2Id of cMid1.bonds) {
        if (b2Id === bondId || found) {continue;}
        const bond2 = mol.bonds.get(b2Id);
        if (!bond2) {continue;}
        const cMid2 = mol.atoms.get(bond2.getOtherAtom(cMid1.id));
        if (!cMid2 || cMid2.name !== 'C') {continue;}
        const mid2HasPi = [...cMid2.bonds].some(b3Id => {
          const b3 = mol.bonds.get(b3Id);
          return b3 && (b3.properties.order === 2 || b3.properties.order === 1.5 || b3.properties.aromatic);
        });
        if (!mid2HasPi) {continue;}
        for (const b3Id of cMid2.bonds) {
          if (b3Id === b2Id || found) {continue;}
          const bond3 = mol.bonds.get(b3Id);
          if (!bond3 || (bond3.properties.order ?? 1) !== 1) {continue;}
          const carbonyl = mol.atoms.get(bond3.getOtherAtom(cMid2.id));
          if (!carbonyl || carbonyl.name !== 'C') {continue;}
          let oBond = null, oAtom = null;
          for (const b4Id of carbonyl.bonds) {
            if (b4Id === b3Id) {continue;}
            const b4 = mol.bonds.get(b4Id);
            if (!b4 || (b4.properties.order ?? 1) !== 2) {continue;}
            const other = mol.atoms.get(b4.getOtherAtom(carbonyl.id));
            if (!other || other.name !== 'O' || (other.properties.charge ?? 0) !== 0) {continue;}
            oBond = b4; oAtom = other; break;
          }
          if (!oBond) {continue;}
          bond.properties.order = 2;
          bond3.properties.order = 2;
          atom.setCharge(0);
          oBond.properties.order = 1;
          oAtom.setCharge(-1);
          found = true;
          break;
        }
      }
    }
  }
}

function _normalizeThioate(mol) {
  // Normalize C([O-])=S to C(=O)[S-]. InChI places thioate charge on sulfur;
  // this ensures toCanonicalSMILES agrees regardless of which resonance form was stored.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C') {continue;}
    let oBond = null, oAtom = null, sBond = null, sAtom = null;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {continue;}
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other) {continue;}
      const order = bond.properties.order ?? 1;
      if (other.name === 'O' && (other.properties.charge ?? 0) === -1 && order === 1) {
        oBond = bond; oAtom = other;
      } else if (other.name === 'S' && (other.properties.charge ?? 0) === 0 && order === 2) {
        sBond = bond; sAtom = other;
      }
    }
    if (!oBond || !sBond) {continue;}
    oBond.properties.order = 2;
    oAtom.setCharge(0);
    sBond.properties.order = 1;
    sAtom.setCharge(-1);
  }
}

function _normalizeAmidineAnion(mol) {
  // Normalize [N-]-C=N (exo anion) to N=C-[N-] (ring anion) in amidine-like systems.
  // InChI places the negative charge on the ring nitrogen when one N is cyclic.
  // Mirrors the cation normalization in _normalizeAmidiniumResonance.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C') {continue;}
    let anionBond = null, anionN = null, imineBond = null, imineN = null;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {continue;}
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other || other.name !== 'N') {continue;}
      const order = bond.properties.order ?? 1;
      const charge = other.properties.charge ?? 0;
      if (order === 1 && charge === -1) { anionBond = bond; anionN = other; }
      else if (order === 2 && charge === 0) { imineBond = bond; imineN = other; }
    }
    if (!anionBond || !imineBond) {continue;}
    // Check if imineN (the one with double bond) is in a ring with atom.
    // If so, InChI prefers the charge on imineN → swap.
    const seen = new Set([atom.id]);
    const queue = [imineN.id];
    seen.add(imineN.id);
    let inRing = false;
    while (queue.length > 0 && !inRing) {
      const cur = queue.shift();
      for (const bId of mol.atoms.get(cur).bonds) {
        if (bId === imineBond.id) {continue;}
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const next = b.getOtherAtom(cur);
        if (next === atom.id) { inRing = true; break; }
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    if (!inRing) {continue;}
    anionBond.properties.order = 2;
    anionN.setCharge(0);
    imineBond.properties.order = 1;
    imineN.setCharge(-1);
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {void}
 */
function _normalizeExocyclicIminium(mol) {
  // Convert ring-C=[NH2+] (non-aromatic form) to ring-[N+]-NH2 (aromatic form).
  // InChI normalizes thiazolium C=[NH2+] to [n+]ccsc1N and pyridinium
  // C=[NH2+] to [n+]ccccc1N. The ring N adjacent to the iminium C gets the
  // positive charge; the exocyclic bond becomes single.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N') {continue;}
    if ((atom.properties.charge ?? 0) !== 1) {continue;}
    const hCount = atom.getHydrogenNeighbors(mol).length;
    if (hCount < 2) {continue;} // must be [NH2+]

    // Find double-bonded ring-C
    let dblBond = null, dblC = null;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {continue;}
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other || other.name !== 'C') {continue;}
      dblBond = bond; dblC = other; break;
    }
    if (!dblC) {continue;}

    // Find a ring N adjacent to dblC that is in the same ring as dblC
    // (i.e., removing the dblC-ringN bond still connects them via a ring path).
    // Prefer N atoms that do NOT already have a ring double bond, so that adding
    // the new ringN=dblC double bond does not create an over-bonded N (which
    // would break the Kekulé alternating pattern for aromaticity detection).
    let ringN = null, ringNBondId = null;
    let ringNFallback = null, ringNBondIdFallback = null;
    for (const bondId of dblC.bonds) {
      if (bondId === dblBond.id) {continue;}
      const bond = mol.bonds.get(bondId);
      if (!bond) {continue;}
      const other = mol.atoms.get(bond.getOtherAtom(dblC.id));
      if (!other || other.name !== 'N' || (other.properties.charge ?? 0) !== 0) {continue;}
      // BFS to check if dblC and other are still connected without this bond
      const seen = new Set([dblC.id]);
      const q = [other.id];
      seen.add(other.id);
      let found = false;
      while (q.length > 0 && !found) {
        const cur = q.shift();
        for (const bId of mol.atoms.get(cur).bonds) {
          if (bId === bondId) {continue;} // skip the direct bond we're testing
          const b = mol.bonds.get(bId);
          if (!b) {continue;}
          const next = b.getOtherAtom(cur);
          if (next === dblC.id) { found = true; break; }
          if (!seen.has(next)) { seen.add(next); q.push(next); }
        }
      }
      if (!found) {continue;}
      // Check if this N already has a double bond (ring or exo).
      // If it does, save as fallback and keep looking for a better candidate
      // (one with no existing double bond is preferred to avoid over-bonding).
      const hasExistingDbl = other.bonds.some(bId2 => {
        if (bId2 === bondId) {return false;}
        const b2 = mol.bonds.get(bId2);
        return b2 && (b2.properties.order ?? 1) === 2;
      });
      if (!hasExistingDbl) {
        ringN = other; ringNBondId = bondId; break;
      } else if (!ringNFallback) {
        ringNFallback = other; ringNBondIdFallback = bondId;
      }
    }
    // If no ideal (no-double-bond) candidate found, use fallback
    if (!ringN && ringNFallback) {
      ringN = ringNFallback; ringNBondId = ringNBondIdFallback;
    }
    if (!ringN) {
      // Non-adjacent ring N: find a ring through dblC containing a neutral N,
      // then do the charge transfer and reassign all ring bonds to alternating
      // Kekulé orders so perceiveAromaticity can aromatize the ring.
      const allRings = mol.getRings();
      let nonAdjRing = null, nonAdjRingN = null;
      for (const ring of allRings) {
        if (!ring.includes(dblC.id)) {continue;}
        // Prefer N over S as the charge acceptor (N is the more common case)
        let nid = ring.find(id => {
          const a = mol.atoms.get(id);
          return a && a.name === 'N' && (a.properties.charge ?? 0) === 0;
        });
        if (!nid) {
          nid = ring.find(id => {
            const a = mol.atoms.get(id);
            return a && a.name === 'S' && (a.properties.charge ?? 0) === 0;
          });
        }
        if (nid) { nonAdjRing = ring; nonAdjRingN = mol.atoms.get(nid); break; }
      }
      if (!nonAdjRingN) {continue;}
      // Verify ring has existing pi character (at least one ring-internal double bond)
      const ringSet = new Set(nonAdjRing);
      const rHasPi = nonAdjRing.some(id =>
        mol.atoms.get(id).bonds.some(bId => {
          if (bId === dblBond.id) {return false;}
          const b = mol.bonds.get(bId);
          return b && (b.properties.order ?? 1) === 2 && ringSet.has(b.getOtherAtom(id));
        })
      );
      if (!rHasPi) {continue;}
      // Charge transfer
      dblBond.properties.order = 1;
      atom.setCharge(0);
      nonAdjRingN.setCharge(1);
      // Assign alternating Kekulé bonds. Rotate ring to start at dblC,
      // then pick the traversal direction that minimises changes to existing
      // bond orders (preferring to preserve shared ring-junction bonds).
      let ordered = [...nonAdjRing];
      const si = ordered.indexOf(dblC.id);
      ordered = [...ordered.slice(si), ...ordered.slice(0, si)];
      const orderedB = [ordered[0], ...ordered.slice(1).reverse()];
      const getBond = (aId, bId) => {
        for (const bid of mol.atoms.get(aId).bonds) {
          const b = mol.bonds.get(bid);
          if (b && b.getOtherAtom(aId) === bId) {return b;}
        }
        return null;
      };
      const chg = (ord) => ord.reduce((n, id, i) => {
        const b = getBond(id, ord[(i + 1) % ord.length]);
        return n + (b && (b.properties.order ?? 1) !== (i % 2 === 0 ? 2 : 1) ? 1 : 0);
      }, 0);
      const dir = chg(ordered) <= chg(orderedB) ? ordered : orderedB;
      for (let i = 0; i < dir.length; i++) {
        const b = getBond(dir[i], dir[(i + 1) % dir.length]);
        if (b) {b.properties.order = (i % 2 === 0) ? 2 : 1;}
      }
      continue;
    }

    // Only normalize rings with existing pi character (saturated rings like
    // pyrrolidine can't become aromatic). Extract the actual ring-atom set by
    // BFS from ringN back to dblC (excluding the direct ringN-dblC bond and the
    // exo dblBond), then check for any double bond between ring atoms.
    const hasRingPi = (() => {
      const parent = new Map([[ringN.id, null]]);
      const q = [ringN.id];
      let foundPath = false;
      outer2: while (q.length > 0) {
        const cur = q.shift();
        for (const bId of mol.atoms.get(cur).bonds) {
          if (bId === ringNBondId || bId === dblBond.id) {continue;}
          const b = mol.bonds.get(bId);
          if (!b) {continue;}
          const next = b.getOtherAtom(cur);
          if (next === dblC.id) { parent.set(next, cur); foundPath = true; break outer2; }
          if (!parent.has(next)) { parent.set(next, cur); q.push(next); }
        }
      }
      if (!foundPath) {return false;}
      // Collect ring atoms from the path
      const ringAtoms = new Set([dblC.id, ringN.id]);
      let cur = dblC.id;
      while (parent.get(cur) !== null) { cur = parent.get(cur); ringAtoms.add(cur); }
      // Check for any double bond between two ring atoms
      return [...ringAtoms].some(id =>
        mol.atoms.get(id).bonds.some(bId => {
          if (bId === dblBond.id || bId === ringNBondId) {return false;}
          const b = mol.bonds.get(bId);
          if (!b || (b.properties.order ?? 1) !== 2) {return false;}
          return ringAtoms.has(b.getOtherAtom(id));
        })
      );
    })();
    if (!hasRingPi) {continue;}

    // Transfer: C=[NH2+] → C-NH2, ring-N → [N+], ring-N=C bond → double
    // (ring-N=dblC gives N+ a ring pi bond so perceiveAromaticity succeeds)
    dblBond.properties.order = 1;
    atom.setCharge(0);
    ringN.setCharge(1);
    mol.bonds.get(ringNBondId).properties.order = 2;
    // Remove any existing ring double bond from C adjacent to new N=C to avoid
    // over-bonding: the old C2=C3 (if adjacent to dblC) should become single.
    for (const bondId of dblC.bonds) {
      if (bondId === ringNBondId) {continue;}
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {continue;}
      const otherId = bond.getOtherAtom(dblC.id);
      if (!otherId) {continue;}
      const other = mol.atoms.get(otherId);
      if (!other || other.name === 'N' || other.name === 'S' || other.name === 'O') {continue;}
      bond.properties.order = 1;
      break;
    }
  }
}

function _normalizeExocyclicThioamideAnion(mol) {
  // Convert ring-C=C(N)[S-] → ring-C-C(N)=S with ring-N→[N-].
  // InChI places the anion on the aromatic ring N (pyrrole-type lone-pair donor)
  // rather than on the exocyclic S of a thioamide substituent.
  for (const [sid, satom] of mol.atoms) {
    if (satom.name !== 'S' || (satom.properties.charge ?? 0) !== -1) {continue;}
    // Find C bonded to S (the thioamide exo-C)
    let exoC = null, exoCBond = null;
    for (const bId of satom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const o = mol.atoms.get(b.getOtherAtom(sid));
      if (o?.name === 'C') { exoC = o; exoCBond = b; break; }
    }
    if (!exoC) {continue;}
    // exoC must have an amino N substituent
    const hasAmino = exoC.bonds.some(bId => {
      const b = mol.bonds.get(bId);
      const o = b && mol.atoms.get(b.getOtherAtom(exoC.id));
      return o?.name === 'N';
    });
    if (!hasAmino) {continue;}
    // Find double bond from exoC to a ring atom (ringC)
    let ringC = null, ringCBond = null;
    const allRings = mol.getRings();
    for (const bId of exoC.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {continue;}
      const o = mol.atoms.get(b.getOtherAtom(exoC.id));
      if (!o || o.name !== 'C') {continue;}
      if (allRings.some(r => r.includes(o.id))) { ringC = o; ringCBond = b; break; }
    }
    if (!ringC) {continue;}
    // Find ring containing ringC with a neutral N
    let targetRing = null, targetN = null;
    for (const ring of allRings) {
      if (!ring.includes(ringC.id)) {continue;}
      const nid = ring.find(id => {
        const a = mol.atoms.get(id);
        return a?.name === 'N' && (a.properties.charge ?? 0) === 0;
      });
      if (nid) { targetRing = ring; targetN = mol.atoms.get(nid); break; }
    }
    if (!targetN) {continue;}
    // Verify ring has existing pi character
    const ringSet = new Set(targetRing);
    const hasPi = targetRing.some(id =>
      mol.atoms.get(id).bonds.some(bId => {
        const b = mol.bonds.get(bId);
        return b && (b.properties.order ?? 1) === 2 && ringSet.has(b.getOtherAtom(id));
      })
    );
    if (!hasPi) {continue;}
    // Charge transfer: [S-]→S, ring-N→[N-]; exo double→single, C-S→double
    satom.setCharge(0);
    targetN.setCharge(-1);
    ringCBond.properties.order = 1;
    exoCBond.properties.order = 2;
    // Kekulé assignment: for pyrrole-type [N-], N should have single ring bonds.
    // Choose the traversal direction where targetN is at the last (highest) index.
    let ordered = [...targetRing];
    const si = ordered.indexOf(ringC.id);
    ordered = [...ordered.slice(si), ...ordered.slice(0, si)];
    const orderedB = [ordered[0], ...ordered.slice(1).reverse()];
    const nIdxA = ordered.indexOf(targetN.id);
    const nIdxB = orderedB.indexOf(targetN.id);
    const dir = (nIdxA >= nIdxB) ? ordered : orderedB;
    const N = dir.length;
    const getBond = (aId, bId) => {
      for (const bid of mol.atoms.get(aId).bonds) {
        const b = mol.bonds.get(bid);
        if (b && b.getOtherAtom(aId) === bId) {return b;}
      }
      return null;
    };
    for (let i = 0; i < N; i++) {
      const b = getBond(dir[i], dir[(i + 1) % N]);
      if (b) {b.properties.order = (i % 2 === 0 && i !== N - 1) ? 2 : 1;}
    }
  }
}

function _normalizeFusedRingKekule(mol) {
  // Find aromatic ring atoms bonded (via any non-aromatic bond) to non-aromatic
  // ring atoms that form a 5- or 6-membered ring closing back to another aromatic
  // neighbor. Set all bonds in that potential ring to order 1.5 (source-aromatic)
  // so perceiveAromaticity's fused-system promoter can recognize the system.
  // perceiveAromaticity will clean up stale bonds if the system doesn't qualify.
  for (const [id, atom] of mol.atoms) {
    if (!atom.properties.aromatic) {
      continue;
    }
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || bond.properties.aromatic) {
        continue;
      }
      const otherId = bond.getOtherAtom(id);
      const other = mol.atoms.get(otherId);
      if (!other || other.properties.aromatic || !other.isInRing(mol)) {
        continue;
      }

      // Collect aromatic neighbors of 'atom' via aromatic bonds
      const aromaticNeighbors = new Set();
      for (const b2Id of atom.bonds) {
        const b2 = mol.bonds.get(b2Id);
        if (b2?.properties.aromatic) {
          aromaticNeighbors.add(b2.getOtherAtom(id));
        }
      }
      if (aromaticNeighbors.size === 0) {
        continue;
      }

      // BFS from 'other', limiting depth to handle 5- and 6-membered rings
      const visited = new Set([id, otherId]);
      const queue = [[otherId, [bId]]];
      let ringBondIds = null;
      outer: while (queue.length > 0) {
        const [cur, path] = queue.shift();
        if (path.length >= 5) {
          continue;
        }
        for (const nextBId of mol.atoms.get(cur).bonds) {
          const nb = mol.bonds.get(nextBId);
          if (!nb) {
            continue;
          }
          const next = nb.getOtherAtom(cur);
          if (next === id) {
            continue;
          }
          if (aromaticNeighbors.has(next)) {
            ringBondIds = [...path, nextBId];
            break outer;
          }
          if (!visited.has(next) && !mol.atoms.get(next)?.properties.aromatic) {
            visited.add(next);
            queue.push([next, [...path, nextBId]]);
          }
        }
      }
      if (!ringBondIds || ringBondIds.length < 4) {
        continue;
      }

      // Collect ring atom IDs along the path (excluding the starting aromatic atom).
      // Guard: only normalize if the ring has pi character (a double bond) or a
      // heteroatom (N, O, S) in the non-aromatic portion — purely sp3 carbon rings
      // (cyclohexane-like) cannot be aromatic and must not be normalized.
      const pathAtomSet = new Set([id]);
      let curAtom = id;
      for (const ringBId of ringBondIds) {
        const rb = mol.bonds.get(ringBId);
        curAtom = rb ? rb.getOtherAtom(curAtom) : curAtom;
        pathAtomSet.add(curAtom);
      }
      const hasRingPiOrHetero = [...pathAtomSet].some(vid => {
        if (vid === id) {
          return false;
        }
        const va = mol.atoms.get(vid);
        if (!va) {
          return false;
        }
        if (va.name === 'N') {
          // Charged nitrogen with 2+ H atoms (e.g. [NH2+]) is sp3 and cannot
          // contribute pi electrons to an aromatic ring.
          if ((va.properties.charge ?? 0) > 0) {
            const hCount = [...va.bonds].filter(bId => {
              const b = mol.bonds.get(bId);
              return b && mol.atoms.get(b.getOtherAtom(vid))?.name === 'H';
            }).length;
            if (hCount >= 2) { return false; }
          }
          return true;
        }
        if (va.name === 'O' || va.name === 'S') {
          return true;
        }
        return va.bonds.some(vbId => {
          const vb = mol.bonds.get(vbId);
          return vb && (vb.properties.order ?? 1) >= 2 && pathAtomSet.has(vb.getOtherAtom(vid));
        });
      });
      if (!hasRingPiOrHetero) {
        continue;
      }

      // Skip if any non-aromatic ring atom has an exocyclic double bond: such an
      // atom uses its p orbital for the exocyclic pi bond and cannot participate
      // in ring aromaticity (e.g. C=[NH+] in ring → ring cannot be aromatic).
      const hasExocyclicPi = [...pathAtomSet].some(vid => {
        if (vid === id) {
          return false;
        }
        const va = mol.atoms.get(vid);
        if (!va || va.properties.aromatic) {
          return false;
        }
        return va.bonds.some(vbId => {
          const vb = mol.bonds.get(vbId);
          if (!vb || (vb.properties.order ?? 1) < 2) {
            return false;
          }
          return !pathAtomSet.has(vb.getOtherAtom(vid));
        });
      });
      if (hasExocyclicPi) {
        continue;
      }

      bond.properties.order = 1.5;
      bond.properties.aromatic = true;
      for (const ringBId of ringBondIds) {
        const rb = mol.bonds.get(ringBId);
        if (rb) { rb.properties.order = 1.5; rb.properties.aromatic = true; }
      }
    }
  }
}

function _normalizeIsocyanide(mol) {
  // Convert R[N+]#[C-] (and R[N+]#C) to R[N]=C. InChI writes isocyanide groups
  // as double bonds: the terminal carbenoid C has no implicit H and no charge,
  // while the N loses its formal positive charge.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 1) {continue;}
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 3) {continue;}
      const c = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!c || c.name !== 'C') {continue;}
      const cHeavyBonds = [...c.bonds].filter(b2Id => {
        const other = mol.atoms.get(mol.bonds.get(b2Id).getOtherAtom(c.id));
        return other && other.name !== 'H';
      });
      if (cHeavyBonds.length !== 1) {continue;}
      bond.properties.order = 2;
      atom.setCharge(0);
      if ((c.properties.charge ?? 0) !== 0) {c.setCharge(0);}
    }
  }
}

function _normalizeAzideDiazonium(mol) {
  // Convert [N+]#N=N to [N+]-N=N. InChI normalizes the cumulated diazonium
  // azide chain by reducing the triple bond to a single bond. Detect: N with
  // charge +1 that has a triple bond to a neutral N which in turn has a double
  // bond to another neutral N, then lower the triple bond to 1.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 1) {continue;}
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 3) {continue;}
      const n2 = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!n2 || n2.name !== 'N' || (n2.properties.charge ?? 0) !== 0) {continue;}
      const hasDoubleBondToN = [...n2.bonds].some(b2Id => {
        const b2 = mol.bonds.get(b2Id);
        if (!b2 || (b2.properties.order ?? 1) !== 2) {return false;}
        const n3 = mol.atoms.get(b2.getOtherAtom(n2.id));
        return n3 && n3.name === 'N';
      });
      if (hasDoubleBondToN) {
        bond.properties.order = 1;
      } else {
        // Simple diazonium: C-[N+]#N → C-N=[N+]. The terminal N (n2) has only
        // this one bond; InChI moves the + from the internal N to the terminal N
        // and lowers the triple bond to double. Check that n2 has no heavy-atom
        // bonds other than to atom (i.e. it is truly terminal, no N=N etc.).
        const n2HeavyBonds = [...n2.bonds].filter(b2Id => {
          const b2 = mol.bonds.get(b2Id);
          if (!b2) {return false;}
          const other = mol.atoms.get(b2.getOtherAtom(n2.id));
          return other && other.name !== 'H';
        });
        if (n2HeavyBonds.length === 1) {
          atom.setCharge(0);
          n2.setCharge(1);
          bond.properties.order = 2;
        }
      }
    }
  }
}

function _normalizeMetalBonds(mol) {
  // Normalize P=Au, S=Au, etc. to single bonds. Group 11 metals (Cu, Ag, Au)
  // in drug-like coordination compounds form single bonds; InChI strips the
  // extra bond order, so we normalize here to match the round-trip canonical.
  const groupEleven = new Set(['Au', 'Ag', 'Cu']);
  for (const [, atom] of mol.atoms) {
    if (!groupEleven.has(atom.name)) {continue;}
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (bond && (bond.properties.order ?? 1) > 1) {
        bond.properties.order = 1;
      }
    }
  }
}

function _normalizeTitaniumOxide(mol) {
  // Normalize [O][Ti][O] → O=[Ti]=O.  InChI sometimes reconstructs Ti=O
  // double bonds as single bonds with a monovalent (radical-like) O atom.
  // Detect: Ti with a single bond to a neutral, hydrogen-free O that has no
  // other heavy-atom neighbours; upgrade each such bond to a double bond.
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'Ti') {continue;}
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {continue;}
      const o = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!o || o.name !== 'O' || (o.properties.charge ?? 0) !== 0) {continue;}
      // Confirm O is monovalent: exactly one heavy-atom bond (to Ti)
      const oHeavy = [...o.bonds].filter(obId => {
        const ob = mol.bonds.get(obId);
        if (!ob) {return false;}
        const nb = mol.atoms.get(ob.getOtherAtom(o.id));
        return nb && nb.name !== 'H';
      });
      if (oHeavy.length === 1 && o.getHydrogenNeighbors(mol).length === 0) {
        bond.properties.order = 2;
      }
    }
  }
}

function _normalizeMetalSilylene(mol) {
  // Normalize M=Si, M=C(carbene), and M-C≡O (carbonyl) for early/mid
  // transition metals.  InChI does not preserve these high-order metal–ligand
  // bonds and always reconstructs them as lower-order bonds (with C becoming a
  // radical where necessary).
  //   • M=Si → M-Si (always downgrade)
  //   • M=C  → M-C  (only when C has no other pi bonds = pure carbene)
  //   • M-C#O → M-[C]=O (carbonyl: downgrade triple to double; C becomes radical)
  const transitionMetals = new Set([
    'Sc','Ti','V','Cr','Mn','Fe','Co','Ni',
    'Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd',
    'La','Hf','Ta','W','Re','Os','Ir','Pt',
  ]);
  for (const [, atom] of mol.atoms) {
    if (!transitionMetals.has(atom.name)) {continue;}
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond) {continue;}
      const bondOrder = bond.properties.order ?? 1;
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other) {continue;}
      if (bondOrder === 2 && other.name === 'Si') {
        // Always downgrade M=Si to M-Si.
        bond.properties.order = 1;
      } else if (bondOrder === 2 && other.name === 'C' && !(other.properties.aromatic)) {
        // For carbene-type M=C: downgrade only when the C has no other pi bonds
        // (guards against M=C=O ketene-type ligands where C already has C=O).
        let hasOtherPiBond = false;
        for (const obId of other.bonds) {
          if (obId === bId) {continue;}
          const ob = mol.bonds.get(obId);
          if (ob && (ob.properties.order ?? 1) >= 2) { hasOtherPiBond = true; break; }
        }
        if (!hasOtherPiBond) {
          bond.properties.order = 1;
        }
      } else if (bondOrder === 1 && other.name === 'C' && !(other.properties.aromatic)) {
        // For M-C≡O (carbonyl ligand): when the C is singly bonded to M and
        // triply bonded to O, InChI downgrades C#O to C=O making C a radical.
        for (const obId of other.bonds) {
          if (obId === bId) {continue;}
          const ob = mol.bonds.get(obId);
          if (!ob || (ob.properties.order ?? 1) !== 3) {continue;}
          const oAtom = mol.atoms.get(ob.getOtherAtom(other.id));
          if (!oAtom || oAtom.name !== 'O') {continue;}
          // Downgrade C#O to C=O.
          ob.properties.order = 2;
          break;
        }
      }
    }
  }
}

function _normalizeBoronCarbonyl(mol) {
  // Convert [BH2]=C(...)[O] to BC(...)=O.  When InChI round-trips a boron
  // carbonyl (B single bond to C, C double bond to O), it sometimes reconstructs
  // the bond orders in the wrong direction: B gets the double bond and O is left
  // monovalent.  Detect: B has a double bond to C and that C has a single bond
  // to a neutral, hydrogen-free oxygen that has no other heavy-atom neighbours.
  // Fix: swap the bond orders so that B-C is single and C=O is double.
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'B') {continue;}
    for (const bId of atom.bonds) {
      const bBond = mol.bonds.get(bId);
      if (!bBond || (bBond.properties.order ?? 1) !== 2) {continue;}
      const cAtom = mol.atoms.get(bBond.getOtherAtom(atom.id));
      if (!cAtom || cAtom.name !== 'C') {continue;}
      // Look for a monovalent O on the C (single bond, neutral, no H, 1 heavy bond)
      let oBond = null, oAtom = null;
      for (const cBId of cAtom.bonds) {
        if (cBId === bId) {continue;}
        const cb = mol.bonds.get(cBId);
        if (!cb || (cb.properties.order ?? 1) !== 1) {continue;}
        const o = mol.atoms.get(cb.getOtherAtom(cAtom.id));
        if (!o || o.name !== 'O' || (o.properties.charge ?? 0) !== 0) {continue;}
        // Confirm O is monovalent: only this one heavy-atom bond
        const oHeavy = [...o.bonds].filter(obId => {
          const ob = mol.bonds.get(obId);
          if (!ob) {return false;}
          const nb = mol.atoms.get(ob.getOtherAtom(o.id));
          return nb && nb.name !== 'H';
        });
        if (oHeavy.length === 1) {
          oBond = cb; oAtom = o;
          break;
        }
      }
      if (!oBond) {continue;}
      // Swap: B=C → B-C, C-O → C=O
      bBond.properties.order = 1;
      oBond.properties.order = 2;
    }
  }
}

function _normalizeNOxideCarbanion(mol) {
  // Convert N(=C)=O to [N+]([C-])=O. A non-aromatic N with two explicit double
  // bonds (to C and to O) is pentavalent; InChI normalizes it to N+ with the
  // adjacent C becoming a carbanion. Called after perceiveAromaticity so that
  // pyridine-N-oxide nitrogens (aromatic, bonds 1.5) are excluded.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 0) {continue;}
    let cBond = null, cAtom = null, oBond = null;
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {continue;}
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other) {continue;}
      if (other.name === 'O' && (other.properties.charge ?? 0) === 0 && !oBond) {
        oBond = bond;
      } else if (other.name === 'C' && (other.properties.charge ?? 0) === 0 && !cBond) {
        cBond = bond; cAtom = other;
      }
    }
    if (!cBond || !oBond) {continue;}
    cBond.properties.order = 1;
    atom.setCharge(1);
    cAtom.setCharge(-1);
  }
}

function _normalizeFuroxan(mol) {
  // Convert aromatic furoxan rings to the Kekulé form InChI uses. InChI writes
  // furoxan (1,2,5-oxadiazole-2-oxide) as a non-aromatic ring: C=C-N+(=O)-O-N-
  // with the charge on the ring N changed to -1. perceiveAromaticity aromatizes
  // it from SMILES input but cannot recover aromaticity from the Kekulé form, so
  // the two paths produce different canonical SMILES. Fix: after
  // perceiveAromaticity, de-aromatize any aromatic ring with the furoxan pattern
  // (ring 2C, 2N, 1O where one N+ has an exo single bond to O-).
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {continue;}
    const ringSet = new Set(ring);
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {continue;}
    const cs = atoms.filter(a => a.name === 'C');
    const ns = atoms.filter(a => a.name === 'N');
    const os = atoms.filter(a => a.name === 'O');
    if (cs.length !== 2 || ns.length !== 2 || os.length !== 1) {continue;}
    const nPos = ns.find(a => (a.properties.charge ?? 0) === 1);
    const nNeg = ns.find(a => (a.properties.charge ?? 0) === 0);
    if (!nPos || !nNeg) {continue;}
    let exoO = null;
    for (const bId of nPos.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(nPos.id));
      if (!other || ringSet.has(other.id)) {continue;}
      if (other.name === 'O' && (other.properties.charge ?? 0) === -1) {
        exoO = { bond: b, atom: other };
        break;
      }
    }
    if (!exoO) {continue;}
    const getBond = (aId, bId) => {
      const b = mol.getBond(aId, bId);
      return b;
    };
    // C-C bond: the only bond in the ring between two C atoms
    const ccBond = (() => {
      for (const c of cs) {
        for (const bId of c.bonds) {
          const b = mol.bonds.get(bId);
          if (!b) {continue;}
          const other = mol.atoms.get(b.getOtherAtom(c.id));
          if (other && other.name === 'C' && ringSet.has(other.id)) {return b;}
        }
      }
      return null;
    })();
    if (!ccBond) {continue;}
    // Kekulize: C=C double, all other ring bonds single
    for (let i = 0; i < ring.length; i++) {
      const b = getBond(ring[i], ring[(i + 1) % ring.length]);
      if (!b) {continue;}
      b.properties.order = (b === ccBond) ? 2 : 1;
      if (b.properties.aromatic !== undefined) {b.properties.aromatic = false;}
    }
    for (const a of atoms) { a.properties.aromatic = false; }
    // N+ exo: single bond to O(-1) → double bond to neutral O
    exoO.bond.properties.order = 2;
    exoO.atom.setCharge(0);
    // Neutral ring N → N(-1)
    nNeg.setCharge(-1);
  }
}

function _normalizeOverchargedNitrogen(mol) {
  // InChI sometimes distributes the positive charge of an amidinium or similar
  // delocalized group across two N atoms in the same component, writing one N
  // as N+2 (or higher) and balancing it with an N-1 elsewhere.  The canonical
  // chemistry is N+1 / N(0).  Fix: for each N with charge > 1, find the nearest
  // N-1 in the same connected component and reduce both by 1.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) < 2) {continue;}
    const component = new Set([atom.id]);
    const queue = [atom.id];
    while (queue.length > 0) {
      const id = queue.shift();
      for (const bId of mol.atoms.get(id).bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(id));
        if (!other || component.has(other.id) || other.name === 'H') {continue;}
        component.add(other.id);
        queue.push(other.id);
      }
    }
    let nMinus = null;
    for (const id of component) {
      const a = mol.atoms.get(id);
      if (a && a !== atom && a.name === 'N' && (a.properties.charge ?? 0) === -1) {
        nMinus = a; break;
      }
    }
    if (!nMinus) {continue;}
    atom.setCharge((atom.properties.charge ?? 0) - 1);
    nMinus.setCharge(0);
  }
}

function _normalizeThiazolol(mol) {
  // Convert aromatic 1,3-thiazol-4-ol (thiazolol) rings to the Kekulé
  // thiazolinone form InChI uses: C=C-[N-]-S-C(=O).
  // Pattern: 5-membered aromatic ring with 3C + 1S + 1N, one C bearing exo [O-],
  // and S adjacent to both N and C([O-]) in the ring.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {continue;}
    const ringSet = new Set(ring);
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {continue;}
    const cs = atoms.filter(a => a.name === 'C');
    const ns = atoms.filter(a => a.name === 'N');
    const ss = atoms.filter(a => a.name === 'S');
    if (cs.length !== 3 || ns.length !== 1 || ss.length !== 1) {continue;}
    const nAtom = ns[0];
    const sAtom = ss[0];
    // Find the C with exo [O-]
    let cOx = null, exoO = null, exoOBond = null;
    for (const c of cs) {
      for (const bId of c.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(c.id));
        if (!other || ringSet.has(other.id)) {continue;}
        if (other.name === 'O' && (other.properties.charge ?? 0) === -1) {
          cOx = c; exoO = other; exoOBond = b; break;
        }
      }
      if (cOx) {break;}
    }
    if (!cOx) {continue;}
    // Verify S is adjacent (in the ring) to both N and cOx
    const sRingAdj = [...sAtom.bonds].map(bId => {
      const b = mol.bonds.get(bId);
      return b ? mol.atoms.get(b.getOtherAtom(sAtom.id))?.id : null;
    }).filter(id => id && ringSet.has(id));
    if (!sRingAdj.includes(nAtom.id) || !sRingAdj.includes(cOx.id)) {continue;}
    // The two remaining carbons (ca adjacent to N, cb adjacent to cOx) get the C=C bond
    const remainingCs = cs.filter(c => c !== cOx);
    let ca = null, cb = null;
    for (const c of remainingCs) {
      const cRingAdj = [...c.bonds].map(bId => {
        const b = mol.bonds.get(bId);
        return b ? mol.atoms.get(b.getOtherAtom(c.id))?.id : null;
      }).filter(id => id && ringSet.has(id));
      if (cRingAdj.includes(nAtom.id)) {ca = c;}
      if (cRingAdj.includes(cOx.id)) {cb = c;}
    }
    if (!ca || !cb || ca === cb) {continue;}
    // Dearomatize: ca=cb double bond, all other ring bonds single
    for (let i = 0; i < ring.length; i++) {
      const b = mol.getBond(ring[i], ring[(i + 1) % ring.length]);
      if (!b) {continue;}
      const isDbl = (ring[i] === ca.id && ring[(i + 1) % ring.length] === cb.id) ||
                    (ring[i] === cb.id && ring[(i + 1) % ring.length] === ca.id);
      b.properties.order = isDbl ? 2 : 1;
      if (b.properties.aromatic !== undefined) {b.properties.aromatic = false;}
    }
    for (const a of atoms) {a.properties.aromatic = false;}
    // exo [O-] → =O (ketone), N → [N-]
    exoOBond.properties.order = 2;
    exoO.setCharge(0);
    nAtom.setCharge(-1);
  }
}

function _normalizeAlicyclicNHCharge(mol) {
  // In a non-aromatic ring with 2 N atoms and total ring charge=+1, InChI places
  // the + on the N with exo C-substituents (the more substituted N), not on the
  // free NH2 (N without exo C bonds).
  // Pattern: 6-membered non-aromatic ring, exactly 2 N atoms, total N charge=+1:
  //   - N_free: charge=+1, H-neighbors≥1, no exo C bonds
  //   - N_sub:  charge=0,  no H-neighbors, has ≥1 exo C bond
  // Fix: move + from N_free to N_sub.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 6) {continue;}
    const atoms = ring.map(id => mol.atoms.get(id));
    if (atoms.some(a => a?.properties?.aromatic)) {continue;} // skip aromatic rings
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {continue;}
    const ringSet = new Set(ring);
    const totalCharge = ns.reduce((s, n) => s + (n.properties.charge ?? 0), 0);
    if (totalCharge !== 1) {continue;}
    const nFree = ns.find(n => {
      if ((n.properties.charge ?? 0) !== 1) {return false;}
      const hasH = [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        return b && mol.atoms.get(b.getOtherAtom(n.id))?.name === 'H';
      });
      if (!hasH) {return false;}
      return ![...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {return false;}
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && !ringSet.has(other.id) && other.name === 'C';
      });
    });
    if (!nFree) {continue;}
    const nSub = ns.find(n => {
      if (n === nFree || (n.properties.charge ?? 0) !== 0) {return false;}
      const hasH = [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        return b && mol.atoms.get(b.getOtherAtom(n.id))?.name === 'H';
      });
      if (hasH) {return false;}
      return [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {return false;}
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && !ringSet.has(other.id) && other.name === 'C';
      });
    });
    if (!nSub) {continue;}
    nFree.setCharge(0);
    nSub.setCharge(1);
  }
}

function _normalizePyrazolateCharge(mol) {
  // In an aromatic 5-membered ring with an N-N bond (pyrazolate/indazolate) and
  // one [n-], InChI places the [n-] on the N adjacent to the ring-C that has
  // a CARBON exo-substituent, not the N adjacent to a C with heteroatom substituent.
  // Pattern: 5-membered all-aromatic ring, exactly 2 N atoms (adjacent), one [n-].
  // If [n-] is on the N adjacent to a ring-C whose only exo substituents are
  // heteroatoms (N/O/S/P) AND the other N is adjacent to a ring-C with an exo C,
  // move [n-] to the other N.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {continue;}
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {continue;}
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {continue;}
    const ringSet = new Set(ring);
    // Check N-N bond exists
    const nA = ns[0], nB = ns[1];
    const hasNNBond = [...nA.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(nA.id)) === nB;
    });
    if (!hasNNBond) {continue;}
    const nMinus = ns.find(n => (n.properties.charge ?? 0) === -1);
    const nNeutral = ns.find(n => (n.properties.charge ?? 0) === 0);
    if (!nMinus || !nNeutral) {continue;}
    // Find the ring-C adjacent to each N (the C that is NOT the other N in the pair)
    const getAdjRingC = n => {
      for (const bId of n.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        if (!other || !ringSet.has(other.id) || other.name !== 'C') {continue;}
        return other;
      }
      return null;
    };
    const cAdjacentToMinus = getAdjRingC(nMinus);
    const cAdjacentToNeutral = getAdjRingC(nNeutral);
    if (!cAdjacentToMinus || !cAdjacentToNeutral) {continue;}
    // Check exo substituents on each ring-C (not H, not in ring)
    const hasExoCarbon = c => [...c.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      if (!b) {return false;}
      const other = mol.atoms.get(b.getOtherAtom(c.id));
      return other && !ringSet.has(other.id) && other.name === 'C';
    });
    const hasOnlyHeteroExo = c => {
      const exo = [...c.bonds].map(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {return null;}
        const other = mol.atoms.get(b.getOtherAtom(c.id));
        return (other && !ringSet.has(other.id) && other.name !== 'H') ? other.name : null;
      }).filter(Boolean);
      return exo.length > 0 && exo.every(name => name !== 'C');
    };
    // [n-] should be on N adjacent to C-with-exo-C; if it's on the wrong N, swap
    if (hasOnlyHeteroExo(cAdjacentToMinus) && hasExoCarbon(cAdjacentToNeutral)) {
      nMinus.setCharge(0);
      nNeutral.setCharge(-1);
    }
  }
}

function _normalizeImidazoliumNHProton(mol) {
  // InChI places the positive charge in a protonated aromatic 5-membered ring
  // (imidazole, benzimidazole, purine, etc.) on the N WITHOUT hydrogen ([n+]),
  // not on the N WITH hydrogen ([nH+]).
  // Pattern: 5-membered aromatic ring, exactly 2 N atoms:
  //   - one is [nH+]: charge=+1, aromatic, has ≥1 H-neighbor
  //   - the other is [n]: charge=0, aromatic, no H-neighbor
  // Fix: move + from [nH+] to [n] → [nH] and [n+].
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {continue;}
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {continue;}
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {continue;}
    const nHPlus = ns.find(n => {
      if ((n.properties.charge ?? 0) !== 1) {return false;}
      return [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {return false;}
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && other.name === 'H';
      });
    });
    if (!nHPlus) {continue;}
    const nNoH = ns.find(n => {
      if (n === nHPlus || (n.properties.charge ?? 0) !== 0) {return false;}
      return ![...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {return false;}
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && other.name === 'H';
      });
    });
    if (!nNoH) {continue;}
    nHPlus.setCharge(0);
    nNoH.setCharge(1);
  }
}

function _normalizeAromaticNPlusToC(mol) {
  // InChI places cationic charge on C rather than N in aromatic N-heterocycles
  // when N has no H.  Pattern: aromatic [n+] (charge=+1, 0 H) in any ring.
  // Fix: move charge to the adjacent ring C that has H and is adjacent to the
  // ring N with an exo substituent (≥3 bonds).  This correctly identifies the
  // carbon in, e.g., 1,2,3-triazolium cations where one N is a "free" pyrrole-
  // type N (2 bonds, no exo group) and the other has a substituent.
  const rings = mol.getRings();
  const ringMembership = new Map(); // atomId → Set of ring indices
  rings.forEach((ring, idx) => {
    for (const id of ring) {
      if (!ringMembership.has(id)) {ringMembership.set(id, new Set());}
      ringMembership.get(id).add(idx);
    }
  });
  for (const [, atom] of mol.atoms) {
    if (!atom.properties.aromatic) {continue;}
    if (atom.name !== 'N') {continue;}
    if ((atom.properties.charge ?? 0) !== 1) {continue;}
    // Must have no H
    const hasH = [...atom.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(atom.id))?.name === 'H';
    });
    if (hasH) {continue;}
    // Must be in at least one ring
    const myRings = ringMembership.get(atom.id);
    if (!myRings || myRings.size === 0) {continue;}

    // Find ring C atoms adjacent to this N+ that have H
    const candidates = [];
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const cAtom = mol.atoms.get(b.getOtherAtom(atom.id));
      if (!cAtom || cAtom.name !== 'C' || !cAtom.properties.aromatic) {continue;}
      // Must share a ring with the charged N
      const cRings = ringMembership.get(cAtom.id);
      if (!cRings || !([...myRings].some(r => cRings.has(r)))) {continue;}
      // Must have H (explicit bond or implicit hcount)
      const cHasH = (cAtom.properties.hcount ?? 0) > 0 ||
        [...cAtom.bonds].some(bId2 => {
          const b2 = mol.bonds.get(bId2);
          return b2 && mol.atoms.get(b2.getOtherAtom(cAtom.id))?.name === 'H';
        });
      if (!cHasH) {continue;}
      candidates.push(cAtom);
    }
    if (candidates.length === 0) {continue;}

    // Pick the best candidate: prefer the C adjacent to the ring N that has
    // an exo substituent (total bonds > 2, i.e., not a "free" pyrrole N).
    let target = null;
    for (const cAtom of candidates) {
      // Find the ring N on the other side of this C (not the charged N+)
      for (const bId2 of cAtom.bonds) {
        const b2 = mol.bonds.get(bId2);
        if (!b2) {continue;}
        const nOther = mol.atoms.get(b2.getOtherAtom(cAtom.id));
        if (!nOther || nOther.id === atom.id) {continue;}
        if (nOther.name !== 'N' || !nOther.properties.aromatic) {continue;}
        const nRings = ringMembership.get(nOther.id);
        if (!nRings || !([...myRings].some(r => nRings.has(r)))) {continue;}
        // substituted N has ≥ 3 bonds (has at least one exo substituent)
        if (nOther.bonds.length >= 3) { target = cAtom; break; }
      }
      if (target) {break;}
    }
    // Fallback: first candidate
    if (!target) { target = candidates[0]; }
    atom.setCharge(0);
    target.setCharge(1);
  }
}

function _normalizePurineNHPlus(mol) {
  // In fused purine-like bicyclics, InChI places the positive charge on the
  // bridging C of the 5-membered imidazole ring rather than on the [nH+] of
  // the 6-membered pyrimidine ring.  Pattern:
  //   (a) A 5-membered aromatic ring with exactly 2 N atoms and a bridging C.
  //   (b) The 5-ring is fused (shares ≥2 atoms) with a 6-membered aromatic ring.
  //   (c) That 6-membered ring contains an [nH+] (aromatic N, charge=+1, H>0).
  // Fix: clear charge from [nH+] → [nH], set charge on bridging C → [cH+].
  const rings = mol.getRings();
  for (const ring5 of rings) {
    if (ring5.length !== 5) {continue;}
    const atoms5 = ring5.map(id => mol.atoms.get(id));
    if (!atoms5.every(a => a?.properties?.aromatic)) {continue;}
    const ns5 = atoms5.filter(a => a?.name === 'N');
    if (ns5.length !== 2) {continue;}

    // Find bridging C: adjacent (in this ring) to BOTH N atoms and has no charge.
    const nIds5 = new Set(ns5.map(n => n.id));
    const bridgingC = atoms5.find(a => {
      if (a?.name !== 'C' || (a.properties.charge ?? 0) !== 0) {return false;}
      let count = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        if (nIds5.has(b.getOtherAtom(a.id))) {count++;}
      }
      return count === 2;
    });
    if (!bridgingC) {continue;}

    // Find a fused 6-membered aromatic ring that shares ≥2 atoms with this ring.
    const ring5Set = new Set(ring5);
    let nHPlus = null;
    for (const ring6 of rings) {
      if (ring6.length !== 6) {continue;}
      const shared = ring6.filter(id => ring5Set.has(id));
      if (shared.length < 2) {continue;}
      const atoms6 = ring6.map(id => mol.atoms.get(id));
      if (!atoms6.every(a => a?.properties?.aromatic)) {continue;}
      const candidate = atoms6.find(a =>
        a?.name === 'N' &&
        (a.properties.charge ?? 0) === 1 &&
        a.getHydrogenNeighbors(mol).length > 0
      );
      if (candidate) { nHPlus = candidate; break; }
    }
    if (!nHPlus) {continue;}

    nHPlus.setCharge(0);
    bridgingC.setCharge(1);
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {void}
 */
function _normalizeXanthyliumCharge(mol) {
  // In xanthylium/rhodamine-type cations the ring O carries [o+] but InChI
  // places the + on the meso carbon (para position, 3 bonds away) that has an
  // exo aryl substituent. Transfer + from the aromatic ring O to that C.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 6) {continue;}
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {continue;}
    const oIdx = atoms.findIndex(a => a?.name === 'O' && (a.properties.charge ?? 0) === 1);
    if (oIdx === -1) {continue;}
    const oAtom = atoms[oIdx];
    const ringSet = new Set(ring);
    const paraIdx = (oIdx + 3) % 6;
    const paraC = atoms[paraIdx];
    if (!paraC || paraC.name !== 'C') {continue;}
    // Para C must have an exo bond to an aromatic carbon (aryl substituent).
    const hasExoAryl = [...paraC.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      if (!b) {return false;}
      const other = mol.atoms.get(b.getOtherAtom(paraC.id));
      return other && !ringSet.has(other.id) && other.name === 'C' && other.properties.aromatic;
    });
    if (!hasExoAryl) {continue;}
    oAtom.setCharge(0);
    paraC.setCharge(1);
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {void}
 */
function _normalizeImidazoliumBridgingCarbon(mol) {
  // In 1,3-disubstituted imidazolium (no H on either N), InChI places the +
  // on the bridging carbon C2 (flanked by both N atoms) rather than on a ring N.
  // This applies whether C2 carries an H or a substituent.
  // Example: Cn1cc[n+](c1)Ph → Cn1ccn([cH+]1)Ph
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {continue;}
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {continue;}
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {continue;}
    const nPlus = ns.find(n => (n.properties.charge ?? 0) === 1);
    if (!nPlus) {continue;}
    // Both N atoms must have no H (not [nH+] or [nH] — those are handled by
    // _normalizeImidazoliumNHProton).
    if (ns.some(n => n.getHydrogenNeighbors(mol).length > 0)) {continue;}
    const nNeutral = ns.find(n => n !== nPlus);
    if (!nNeutral) {continue;}
    // Find the bridging C adjacent to BOTH N atoms in the ring.
    const nIds = new Set([nPlus.id, nNeutral.id]);
    const bridgingC = atoms.find(a => {
      if (a?.name !== 'C') {return false;}
      let ringNCount = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        if (nIds.has(mol.atoms.get(b.getOtherAtom(a.id))?.id)) {ringNCount++;}
      }
      return ringNCount === 2;
    });
    if (!bridgingC) {continue;}
    nPlus.setCharge(0);
    bridgingC.setCharge(1);
  }
}

function _normalizeCarboxylate(mol) {
  // Ensure carboxylate groups always write as C([O-])=O (double bond on the
  // uncharged oxygen). InChI sometimes assigns order=2 to the charged O- and
  // order=1 to the neutral O, producing C(=[O-])[O], which makes sameMolecule
  // return false for molecules where our parser assigns the opposite Kekule form.
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'C') {continue;}
    const oNeighbors = [];
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (other?.name === 'O' && !other.properties.aromatic) {
        oNeighbors.push({ atom: other, bond: b });
      }
    }
    if (oNeighbors.length !== 2) {continue;}
    const oMinus = oNeighbors.find(o => (o.atom.properties.charge ?? 0) === -1);
    const oNeutral = oNeighbors.find(o => (o.atom.properties.charge ?? 0) === 0);
    if (!oMinus || !oNeutral) {continue;}
    // If double bond is on O-, swap: put it on neutral O instead
    if (oMinus.bond.properties.order === 2 && oNeutral.bond.properties.order === 1) {
      oMinus.bond.properties.order = 1;
      oNeutral.bond.properties.order = 2;
    }
  }
}

function _normalizeSulfoxide(mol) {
  // Convert [S+]([O-]) to S=O (sulfonium oxide zwitterion → sulfoxide).
  // InChI treats these as the same compound; we normalize to the S=O form.
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'S' || (atom.properties.charge ?? 0) !== 1) {continue;}
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (other?.name === 'O' && (other.properties.charge ?? 0) === -1 && b.properties.order === 1) {
        atom.setCharge(0);
        other.setCharge(0);
        b.properties.order = 2;
        break; // only one O- per S+
      }
    }
  }
}

function _normalizeAmineOxide(mol) {
  // Convert aliphatic [N+]([O-]) to N=O (amine oxide zwitterion → dative-bond form).
  // InChI sometimes reconstructs amine N-oxides (R3N=O) as [N+](R3)[O-].
  // Excludes: (1) nitro groups [N+](=O)[O-] (N already has another double bond to O);
  //           (2) aromatic N-oxides (handled elsewhere, e.g. pyridine-N-oxide).
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 1 || atom.properties.aromatic) {continue;}
    // Confirm N is not already carrying another double bond to O (nitro guard).
    const hasDoubleO = atom.bonds.some(bId => {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {return false;}
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      return other?.name === 'O';
    });
    if (hasDoubleO) {continue;}
    // Find the single-bond O- neighbor.
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (other?.name === 'O' && (other.properties.charge ?? 0) === -1 && (b.properties.order ?? 1) === 1) {
        atom.setCharge(0);
        other.setCharge(0);
        b.properties.order = 2;
        break;
      }
    }
  }
}

function _normalizeHalogenateOxoanion(mol) {
  // InChI assigns the formal −1 charge to the central halogen in oxo-anions
  // of chlorine, bromine, and iodine rather than to the O. For example:
  //   [O-]Cl(=O)(=O)=O  →  O=[Cl-]([O])([O])[O]  (perchlorate)
  //   [O-]Cl=O           →  O=[Cl-]=O              (chlorite)
  //   [O-]Cl             →  O=[Cl-]                (hypochlorite)
  //   [O-]I(=O)(=O)=O   →  O=[I-]([O])([O])[O]   (periodate)
  // Chlorate [O-]Cl(=O)=O and bromate [O-]Br(=O)=O already produce
  // matching round-trip SMILES without transformation, so n=2 is skipped.
  const halogens = new Set(['Cl', 'Br', 'I']);
  for (const [, atom] of mol.atoms) {
    if (!halogens.has(atom.name)) {continue;}
    if ((atom.properties.charge ?? 0) !== 0) {continue;}
    // Collect all neighbours; they must all be O.
    const neighbours = [];
    let allO = true;
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (!other || other.name !== 'O') {allO = false; break;}
      neighbours.push({ atom: other, bond: b });
    }
    if (!allO || neighbours.length === 0) {continue;}
    // Find the single O− neighbour (single bond, charge −1).
    const oMinusEntry = neighbours.find(n => (n.atom.properties.charge ?? 0) === -1 && n.bond.properties.order === 1);
    if (!oMinusEntry) {continue;}
    // Ensure there is only ONE O−.
    if (neighbours.filter(n => (n.atom.properties.charge ?? 0) === -1).length !== 1) {continue;}
    const nDouble = neighbours.filter(n => n.bond.properties.order === 2).length;
    // n=2 (chlorate, bromate): round-trip already matches — skip.
    if (nDouble === 2) {continue;}
    // Transform: move charge to halogen, convert O− single bond → double.
    atom.setCharge(-1);
    oMinusEntry.atom.setCharge(0);
    oMinusEntry.bond.properties.order = 2;
    // For n≥3 (perchlorate, periodate): also convert existing =O → single bond
    // so Cl/I(-1) ends up with exactly one double bond.
    if (nDouble >= 3) {
      for (const n of neighbours) {
        if (n === oMinusEntry) {continue;}
        if (n.bond.properties.order === 2) {
          n.bond.properties.order = 1;
        }
      }
    }
    // For n=0 (hypochlorite) and n=1 (chlorite): leave existing =O bonds as-is.
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {void}
 */
function _normalizeAromaticRingCharges(mol) {
  // Neutralize balanced [n+]/[n-] pairs within the same connected aromatic
  // subgraph. InChI writes tetrazolium zwitterions ([N+]=NN=C[N-]) as neutral
  // aromatic rings (nnnnn); normalizing here makes toCanonicalSMILES agree.
  // Only applies when all charges in a connected aromatic component sum to 0.
  const aromaticIds = new Set(
    [...mol.atoms.keys()].filter(id => mol.atoms.get(id).properties.aromatic)
  );
  const visited = new Set();
  for (const startId of aromaticIds) {
    if (visited.has(startId)) {continue;}
    const component = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const id = queue.shift();
      component.push(id);
      for (const bondId of mol.atoms.get(id).bonds) {
        const bond = mol.bonds.get(bondId);
        if (!bond) {continue;}
        const otherId = bond.getOtherAtom(id);
        if (visited.has(otherId) || !aromaticIds.has(otherId)) {continue;}
        visited.add(otherId);
        queue.push(otherId);
      }
    }
    const totalCharge = component.reduce((sum, id) => sum + (mol.atoms.get(id).properties.charge ?? 0), 0);
    if (totalCharge !== 0) {continue;}
    const charged = component.filter(id => (mol.atoms.get(id).properties.charge ?? 0) !== 0);
    if (charged.length === 0) {continue;}
    for (const id of charged) {
      mol.atoms.get(id).setCharge(0);
    }
  }
  // Second pass: mixed aromatic [n+] / aliphatic [N-] in the same ring.
  // InChI sometimes writes a vinylogous amidine zwitterion as c-[N-]-C=C-[n+]
  // instead of the neutral c=N-C=C-n. The aromatic component walk above misses
  // [N-] because it is not aromatic. Fix: scan rings for exactly this pair,
  // total ring charge = 0, then neutralise and restore the exo double bond.
  const rings = mol.getRings();
  for (const ring of rings) {
    const ringAtoms = ring.map(id => mol.atoms.get(id));
    const chargedAtoms = ringAtoms.filter(a => (a?.properties?.charge ?? 0) !== 0);
    if (chargedAtoms.length !== 2) {continue;}
    const totalCharge = chargedAtoms.reduce((s, a) => s + (a.properties.charge ?? 0), 0);
    if (totalCharge !== 0) {continue;}
    const nPlus = chargedAtoms.find(a => a.name === 'N' && a.properties.aromatic && (a.properties.charge ?? 0) === 1);
    const nMinus = chargedAtoms.find(a => a.name === 'N' && !a.properties.aromatic && (a.properties.charge ?? 0) === -1);
    if (!nPlus || !nMinus) {continue;}
    // Restore the bond from nMinus to its aromatic ring-C neighbour to order=2
    // (InChI lowered it to single when it introduced the zwitterion form).
    const ringSet = new Set(ring);
    for (const bId of nMinus.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(nMinus.id));
      if (!other || !ringSet.has(other.id) || !other.properties.aromatic || other.name !== 'C') {continue;}
      b.properties.order = 2;
      break;
    }
    nPlus.setCharge(0);
    nMinus.setCharge(0);
  }
  // Third pass: aromatic ring with [n+] + exocyclic [N-] on a ring-C neighbour.
  // InChI sometimes produces c([N-]R)[n+] (aromatic ring with exo anionic N),
  // where the original was a non-aromatic ring with an exo imine C=N-R. The ring
  // became aromatic during parseINCHI because the exo single bond to [N-] doesn't
  // prevent aromaticity perception the way an exo double bond to N would.
  // Fix: de-aromatize the ring, assign a Kekule form (C=C alternation starting from
  // the C that bears the exo [N-] bond), restore the exo C-N bond to order 2,
  // and neutralise both the [n+] and the [N-].
  for (const ring of rings) {
    const ringSet = new Set(ring);
    const ringAtoms = ring.map(id => mol.atoms.get(id));
    if (!ringAtoms.every(a => a?.properties?.aromatic)) {continue;}
    const nPlusAtoms = ringAtoms.filter(a => a?.name === 'N' && (a.properties.charge ?? 0) === 1);
    if (nPlusAtoms.length !== 1) {continue;}
    // Find a ring C with an exo single bond to [N-]
    let exoCData = null;
    for (const ringC of ringAtoms) {
      if (!ringC || ringC.name !== 'C') {continue;}
      for (const bId of ringC.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(ringC.id));
        if (!other || ringSet.has(other.id)) {continue;}
        if (other.name === 'N' && (other.properties.charge ?? 0) === -1 && !other.properties.aromatic) {
          exoCData = { ringC, exoBond: b, exoN: other };
          break;
        }
      }
      if (exoCData) {break;}
    }
    if (!exoCData) {continue;}
    // Assign Kekule bonds using a valence-propagation walk.
    // First neutralise the charges so valence counts are based on the final neutral atoms.
    nPlusAtoms[0].setCharge(0);
    exoCData.exoN.setCharge(0);
    exoCData.exoBond.properties.order = 2;   // restore exo C=N double bond
    // Collect ordered ring bonds (bond[i] connects ring[i]→ring[(i+1)%n])
    const orderedRingBonds = [];
    for (let i = 0; i < ring.length; i++) {
      const aId = ring[i];
      const bId = ring[(i + 1) % ring.length];
      const bond = mol.getBond(aId, bId);
      if (bond) {orderedRingBonds.push({ bond, a: aId, b: bId });}
    }
    if (orderedRingBonds.length !== ring.length) {continue;}
    const n = orderedRingBonds.length;
    // Determine which ring atoms need a double bond in the ring (remaining valence = 2).
    // Remaining valence = normal_valence − (sum of exo bond orders) − H_count − ring_single_bonds_from_exo_constraints
    // For simplicity: compute how many bonds the atom "still needs" from ring bonds.
    // Standard valences: C=4, N=3 (neutral), N+=4 (but we've already neutralised above)
    const needsDoubleBond = new Set();
    for (const aId of ring) {
      const a = mol.atoms.get(aId);
      if (!a) {continue;}
      const stdValence = (a.name === 'N') ? 3 : 4;  // C=4, N=3 after neutralisation
      const hCount = a.getHydrogenNeighbors(mol).length;
      let exoBondSum = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const otherId = b.getOtherAtom(aId);
        // Skip ring bonds and H bonds (H is handled via hCount separately)
        if (ringSet.has(otherId)) {continue;}
        const otherAtom = mol.atoms.get(otherId);
        if (otherAtom?.name === 'H') {continue;}
        exoBondSum += (b.properties.order ?? 1);
      }
      const ringBondsNeeded = stdValence - hCount - exoBondSum;
      // ringBondsNeeded = total bond order the atom needs from its 2 ring bonds.
      // ringBondsNeeded = 2 → both ring bonds single (no ring double needed)
      // ringBondsNeeded = 3 → one ring double + one ring single
      // ringBondsNeeded = 4 → two ring doubles (only possible in special cases)
      if (ringBondsNeeded >= 3) {needsDoubleBond.add(aId);}
    }
    // Assign Kekule bonds: walk the ring, greedily assign double bonds to adjacent pairs
    // where both atoms need a double. Use a two-pointer approach around the ring.
    const bondOrders = new Array(n).fill(1);  // default single
    const satisfied = new Set();
    // Try each possible starting position for doubles (positions at even offset from ring[0])
    // Find a valid assignment via greedy walk.
    let assigned = false;
    for (let start = 0; start < n && !assigned; start++) {
      const trial = new Array(n).fill(1);
      const trialSatisfied = new Set();
      for (let i = 0; i < n; i++) {
        const idx = (start + i * 2) % n;
        if ((i * 2) >= n) {break;}
        const aId = orderedRingBonds[idx].a;
        const bId = orderedRingBonds[idx].b;
        if (needsDoubleBond.has(aId) && needsDoubleBond.has(bId) &&
            !trialSatisfied.has(aId) && !trialSatisfied.has(bId)) {
          trial[idx] = 2;
          trialSatisfied.add(aId);
          trialSatisfied.add(bId);
        }
      }
      // Check: all atoms that need doubles are satisfied
      const allSatisfied = [...needsDoubleBond].every(id => trialSatisfied.has(id));
      if (allSatisfied) {
        for (let i = 0; i < n; i++) {orderedRingBonds[i].bond.properties.order = trial[i];}
        assigned = true;
      }
    }
    if (!assigned) {continue;}  // couldn't find valid Kekule; skip this ring
    // De-aromatize: clear aromatic flag on all ring atoms and ring bonds
    for (const a of ringAtoms) { if (a) {a.properties.aromatic = false;} }
    for (const { bond } of orderedRingBonds) {
      if (bond.properties.aromatic !== undefined) {bond.properties.aromatic = false;}
    }
  }
}

function _normalizeCrystalVioletRing(mol) {
  // Normalize two related forms of push–pull chromophores that InChI converts
  // to an aromatic or vinyl cationic form.
  //
  // Form A — quinoid (crystal-violet / malachite-green):
  //   A 6-membered non-aromatic all-C ring where one ring C (C_para) has an
  //   exo double bond to N⁺ and the para ring C (C_ipso, 3 positions away) has
  //   an exo double bond to a neutral non-ring C (methine).
  //   Fix: remove both exo double bonds, add +1 to methine C, neutralise N+,
  //   aromatise the 6-membered ring.
  //
  // Form B — vinyl iminium:
  //   A 6-membered non-aromatic all-C ring where one ring C (C_nim) has an exo
  //   double bond to N⁺ and the adjacent ring C (C_adj) has a ring double bond
  //   to the next ring C (C_beta, 2 positions away from C_nim).
  //   Fix: remove exo N+ double bond, relocate ring double bond from C_adj=C_beta
  //   to C_nim=C_adj, give C_beta +1 charge, neutralise N+.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 6) {continue;}
    const ringSet = new Set(ring);
    const ringAtoms = ring.map(id => mol.atoms.get(id));
    // Skip if any ring atom is aromatic or non-carbon
    if (ringAtoms.some(a => !a || a.name !== 'C' || a.properties.aromatic)) {continue;}

    // Find ring C with exo double bond to N+
    let nPlusIdx = -1;
    let nPlusAtom = null, nPlusBond = null;
    for (let i = 0; i < 6; i++) {
      for (const bId of ringAtoms[i].bonds) {
        const b = mol.bonds.get(bId);
        if (!b || (b.properties.order ?? 1) !== 2) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(ringAtoms[i].id));
        if (!other || ringSet.has(other.id)) {continue;}
        if (other.name === 'N' && (other.properties.charge ?? 0) === 1) {
          nPlusIdx = i; nPlusAtom = other; nPlusBond = b; break;
        }
      }
      if (nPlusIdx !== -1) {break;}
    }
    if (nPlusIdx === -1) {continue;}

    // --- Form A: also find exo double bond to neutral non-ring C ---
    let ipsoIdx = -1;
    let methineAtom = null, methineBond = null;
    for (let i = 0; i < 6; i++) {
      if (i === nPlusIdx) {continue;}
      for (const bId of ringAtoms[i].bonds) {
        const b = mol.bonds.get(bId);
        if (!b || (b.properties.order ?? 1) !== 2) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(ringAtoms[i].id));
        if (!other || ringSet.has(other.id)) {continue;}
        if (other.name === 'C' && (other.properties.charge ?? 0) === 0 &&
            !other.properties.aromatic) {
          ipsoIdx = i; methineAtom = other; methineBond = b; break;
        }
      }
      if (ipsoIdx !== -1) {break;}
    }

    if (ipsoIdx !== -1) {
      // Form A check: ipso and para must be exactly 3 positions apart
      const diff = Math.abs(ipsoIdx - nPlusIdx);
      if (diff === 3) {
        // Apply Form A normalization
        methineBond.properties.order = 1;
        methineAtom.setCharge(1);
        nPlusBond.properties.order = 1;
        nPlusAtom.setCharge(0);
        // Aromatize the ring
        for (const a of ringAtoms) { a.properties.aromatic = true; }
        for (let i = 0; i < ring.length; i++) {
          const b = mol.getBond(ring[i], ring[(i + 1) % ring.length]);
          if (b) { b.properties.aromatic = true; b.properties.order = 1.5; }
        }
        continue;
      }
    }

    // --- Form B: C=[N+] exo → [C+]–N (charge moves to ring C, double → single) ---
    // InChI converts iminium C=[N+] directly to carbenium [C+]–N without
    // relocating any ring double bond.
    nPlusBond.properties.order = 1;            // C_nim=[N+] → C_nim–N
    nPlusAtom.setCharge(0);                    // neutralise N+
    ringAtoms[nPlusIdx].setCharge(1);          // C_nim becomes [C+]
  }
}

function _normalizeVinylogousIminium(mol) {
  // Normalize delocalized polymethine/vinylogous cations where InChI places the
  // positive charge at the terminus of a conjugated chain rather than on an
  // internal ring N.
  //
  // Pattern: a non-aromatic ring N+ (charge=+1) has a ring-internal double bond
  // to an adjacent ring C (C_alpha).  From C_alpha, an alternating single/double
  // chain extends outward.  InChI moves the charge to the chain terminus and
  // flips all bond orders along the chain.
  //
  // Two terminus types:
  //   (a) Ring C reached by a double bond: becomes C+
  //   (b) Non-ring N-H reached by a single bond: becomes iminium [NH+]
  //
  // Examples fixed:
  //   - Row 1415: indolinium N-H ring connected via vinyl chain to cyclopentyl C+
  //   - Row 2631: indolinium N-Et ring connected via vinyl chain to terminal NH+
  const rings = mol.getRings();
  if (!rings || !rings.length) {return;}

  const ringMembership = new Map(); // atomId → Set<ringIndex>
  rings.forEach((ring, idx) => {
    for (const id of ring) {
      if (!ringMembership.has(id)) {ringMembership.set(id, new Set());}
      ringMembership.get(id).add(idx);
    }
  });

  const shareRing = (id1, id2) => {
    const r1 = ringMembership.get(id1);
    const r2 = ringMembership.get(id2);
    if (!r1 || !r2) {return false;}
    for (const r of r1) {if (r2.has(r)) {return true;}}
    return false;
  };

  // Organic elements whose presence on N does NOT indicate metal coordination.
  const organicElements = new Set(['C','N','H','O','S','F','Cl','Br','I','B','P','Si','Se','As']);

  for (const [, nAtom] of mol.atoms) {
    if (nAtom.name !== 'N') {continue;}
    if ((nAtom.properties.charge ?? 0) !== 1) {continue;}
    if (nAtom.properties.aromatic) {continue;}
    // Skip N+ coordinated to a metal (porphyrin, organometallics, etc.)
    let hasMetal = false;
    for (const bId of nAtom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(nAtom.id));
      if (other && !organicElements.has(other.name)) {hasMetal = true; break;}
    }
    if (hasMetal) {continue;}
    const nRingSet = ringMembership.get(nAtom.id);
    if (!nRingSet || !nRingSet.size) {continue;}

    // Find ring-internal double bond: N+ = C_alpha (both in same ring)
    let cAlpha = null, ringDoubleBond = null;
    for (const bId of nAtom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {continue;}
      const ord = b.properties.order ?? 1;
      if (Math.abs(ord - 2) > 0.1) {continue;}
      const other = mol.atoms.get(b.getOtherAtom(nAtom.id));
      if (!other || other.name !== 'C' || other.properties.aromatic) {continue;}
      if (!shareRing(nAtom.id, other.id)) {continue;}
      cAlpha = other; ringDoubleBond = b; break;
    }
    if (!cAlpha) {continue;}

    // Build ring1Set = atoms of the ring shared by N+ and C_alpha
    const cAlphaRingSet = ringMembership.get(cAlpha.id);
    const sharedRingIdx = [...nRingSet].find(r => cAlphaRingSet && cAlphaRingSet.has(r));
    if (sharedRingIdx === undefined) {continue;}
    const ring1Set = new Set(rings[sharedRingIdx]);

    // DFS: find an alternating chain from C_alpha outward.
    // Returns array of {atom, bond} or null.
    // Priority: (b) N-H terminus over (a) ring-C terminus.
    const findChain = (curId, prevId, expectedOrd, visited) => {
      visited.add(curId);
      const curAtom = mol.atoms.get(curId);
      if (!curAtom) {return null;}

      const candidates = [];
      for (const bId of curAtom.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const otherId = b.getOtherAtom(curId);
        if (otherId === prevId || visited.has(otherId)) {continue;}
        const otherAtom = mol.atoms.get(otherId);
        if (!otherAtom || otherAtom.name === 'H' || otherAtom.properties.aromatic) {continue;}
        // Never re-enter the iminium ring (ring1) from outside C_alpha
        if (ring1Set.has(otherId) && curId !== cAlpha.id) {continue;}
        const ord = Math.round(b.properties.order ?? 1);
        if (ord !== expectedOrd) {continue;}
        candidates.push({ atom: otherAtom, bond: b });
      }
      if (candidates.length === 0) {return null;}

      // Priority 1 (single-bond step): N with H → immediate case-(b) terminus
      if (expectedOrd === 1) {
        for (const { atom, bond } of candidates) {
          if (atom.name !== 'N') {continue;}
          const hasH = (atom.properties.hcount ?? 0) > 0 ||
            [...atom.bonds].some(bId2 => {
              const b2 = mol.bonds.get(bId2);
              return b2 && mol.atoms.get(b2.getOtherAtom(atom.id))?.name === 'H';
            });
          if (hasH) {return [{ atom, bond }];}
        }
      }

      // Priority 2 (double-bond step): ring C (not ring1) → immediate case-(a) terminus
      if (expectedOrd === 2) {
        for (const { atom, bond } of candidates) {
          if (ringMembership.has(atom.id) && !ring1Set.has(atom.id)) {
            return [{ atom, bond }];
          }
        }
      }

      // Recurse: try each candidate for chain extension
      for (const { atom, bond } of candidates) {
        const newVisited = new Set(visited);
        const sub = findChain(atom.id, curId, 3 - expectedOrd, newVisited);
        if (sub) {return [{ atom, bond }, ...sub];}
      }
      return null;
    };

    const chain = findChain(cAlpha.id, nAtom.id, 1, new Set([nAtom.id]));

    // Case (c): no chain — InChI charges C_alpha directly when no vinyl extension
    // exists.  Only apply when:
    //   1. N+ has NO hydrogen (N-H iminium is itself the canonical InChI form)
    //   2. C_alpha has no exo double bond (push-pull systems are handled elsewhere)
    if (!chain || chain.length === 0) {
      // Only apply for quaternary N+ (no H) — ring C=[NH+] is InChI's own canonical form
      const nHasH = (nAtom.properties.hcount ?? 0) > 0 ||
        [...nAtom.bonds].some(bId2 => {
          const b2 = mol.bonds.get(bId2);
          return b2 && mol.atoms.get(b2.getOtherAtom(nAtom.id))?.name === 'H';
        });
      if (nHasH) {continue;}
      if ((cAlpha.properties.charge ?? 0) !== 0) {continue;}
      // Ensure C_alpha has no exo double bond
      let hasExoDbl = false;
      for (const bId of cAlpha.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {continue;}
        const ord = Math.round(b.properties.order ?? 1);
        if (ord < 2) {continue;}
        const other = mol.atoms.get(b.getOtherAtom(cAlpha.id));
        if (other && !ring1Set.has(other.id) && other.id !== nAtom.id) {hasExoDbl = true; break;}
      }
      if (hasExoDbl) {continue;}
      nAtom.setCharge(0);
      ringDoubleBond.properties.order = 1;
      cAlpha.setCharge(1);
      continue;
    }

    const terminus = chain[chain.length - 1].atom;
    if (terminus.properties.aromatic) {continue;}
    if (terminus.name !== 'C' && terminus.name !== 'N') {continue;}
    // Sanity: terminus must not already be charged
    if ((terminus.properties.charge ?? 0) !== 0) {continue;}

    // Apply transformation: neutralise N+, flip bond orders, charge terminus
    nAtom.setCharge(0);
    ringDoubleBond.properties.order = 1;   // N+=C_alpha → N–C_alpha

    let newOrd = 2;
    for (const { bond } of chain) {
      bond.properties.order = newOrd;
      newOrd = 3 - newOrd;
    }
    terminus.setCharge(1);
  }
}

function _normalizeExocyclicAromaticDoubleBond(mol) {
  // Convert C=c or N=c (non-aromatic C or N doubly bonded to an aromatic ring
  // atom) to C-c or N-c (single bond).  InChI does not write exocyclic double
  // bonds to aromatic ring atoms; it always uses a single bond and lets the
  // external atom be a radical (lower valence).
  // Exclusion: O, S and other heteroatoms are not touched because InChI retains
  // exo double bonds for those (e.g. pyridone O=c, thione S=c).
  // This is called AFTER perceiveAromaticity so ring atoms are already marked.
  for (const [, atom] of mol.atoms) {
    if (!atom.properties.aromatic) {continue;}
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {continue;}
      const ext = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!ext || ext.properties.aromatic) {continue;}
      // Only convert when the external atom is C or N.
      if (ext.name !== 'C' && ext.name !== 'N') {continue;}
      bond.properties.order = 1;
    }
  }
}

/**
 * Serializes a {@link Molecule} to a **canonical** SMILES string.
 *
 * Atom traversal order is determined by the Morgan extended-connectivity
 * algorithm (Weininger 1989), so the same molecular graph always produces
 * the same string regardless of how the molecule was constructed or which
 * input SMILES was parsed.  The output is therefore suitable as a
 * deduplication key or database identifier.
 *
 * Disconnected components are each canonicalized independently and then
 * sorted lexicographically before being joined with `'.'`.
 *
 * All features of {@link toSMILES} are preserved: chirality (`@`/`@@`),
 * E/Z geometry (`/`/`\\`), isotopes, charges, aromatic atoms, ring closures.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @returns {string} The result string.
 */
export function toCanonicalSMILES(molecule) {
  if (molecule.atomCount === 0) {
    return '';
  }
  const parts = molecule.getComponents().map(comp => {
    _normalizeNitroGroup(comp);
    _normalizeAmidiniumResonance(comp);
    _normalizeImineTautomer(comp);
    _normalizeEnolateToChain(comp);
    _normalizeCarbanionEnolate(comp);
    _normalizeThioate(comp);
    _normalizeAmidineAnion(comp);
    _normalizeIsocyanide(comp);
    _normalizeAzideDiazonium(comp);
    _normalizeMetalBonds(comp);
    _normalizeTitaniumOxide(comp);
    _normalizeMetalSilylene(comp);
    _normalizeBoronCarbonyl(comp);
    _normalizeExocyclicThioamideAnion(comp);
    _normalizeExocyclicIminium(comp);
    _normalizeFusedRingKekule(comp);
    _normalizeOverchargedNitrogen(comp);
    _normalizeAlicyclicNHCharge(comp);
    // Always call perceiveAromaticity so that both pure-Kekulé molecules (from
    // parseINCHI) and mixed Kekulé/aromatic molecules (from parseSMILES) end up
    // with the same aromatic bond set.  Consistent aromaticity ensures that
    // morganRanks produces the same canonical ordering for both representations
    // of the same molecule, which is required for correct E/Z stereo assignment
    // and canonical SMILES string equality.
    perceiveAromaticity(comp);
    _normalizeCrystalVioletRing(comp);
    _normalizeVinylogousIminium(comp);  // polymethine ring N+ → chain terminus C+/NH+
    _normalizeFuroxan(comp);
    _normalizeThiazolol(comp);
    _normalizePyrazolateCharge(comp);
    _normalizeImidazoliumNHProton(comp);
    _normalizeAromaticNPlusToC(comp);   // aromatic [n+] (no H) → adjacent [cH+]
    _normalizeXanthyliumCharge(comp);
    _normalizeImidazoliumBridgingCarbon(comp);
    _normalizePurineNHPlus(comp);
    _normalizeNOxideCarbanion(comp);
    _normalizeCarboxylate(comp);
    _normalizeSulfoxide(comp);
    _normalizeAmineOxide(comp);
    _normalizeHalogenateOxoanion(comp);
    _normalizeAromaticRingCharges(comp);
    _normalizeExocyclicAromaticDoubleBond(comp);
    const ranks = morganRanks(comp);
    return _serializeComponent(comp, id => ranks.get(id) ?? 0);
  });
  parts.sort();
  return parts.join('.');
}

/**
 * Returns true when two molecules have identical structure: the same atom
 * elements, formal charges, bond orders, aromaticity, isotopes, and
 * connectivity (including stereochemistry).
 *
 * Comparison is based on canonical SMILES, so the atom and bond IDs of the
 * two objects do not matter — only the chemical graph does.
 * @param {import('../core/Molecule.js').Molecule} a - First value or atom.
 * @param {import('../core/Molecule.js').Molecule} b - Second value or atom.
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
export function sameMolecule(a, b) {
  if (a === b) {
    return true;
  }
  if (a.atoms.size !== b.atoms.size || a.bonds.size !== b.bonds.size) {
    return false;
  }
  return toCanonicalSMILES(a) === toCanonicalSMILES(b);
}
