/** @module io/smiles */

import elements from '../data/elements.js';
import { Molecule, computeRS } from '../core/Molecule.js';

// ---------------------------------------------------------------------------
// Grammar — ported from molecules v1 src/main/smiles.js
// ---------------------------------------------------------------------------

export const grammar = [
  { type: 'atom',     term: 'H',  tag: 'H',       expression: /(?=[A-Z])H(?=[^efgos]|$)([0-9]?)+/g },
  { type: 'atom',     term: 'D',  tag: 'H',       expression: /(?=[A-Z])D(?=[^bsy]|$)([0-9]?)+/g },
  { type: 'atom',     term: 'He', tag: 'He',      expression: /He/g },
  { type: 'atom',     term: 'Li', tag: 'Li',      expression: /Li/g },
  { type: 'atom',     term: 'Be', tag: 'Be',      expression: /Be/g },
  { type: 'atom',     term: 'B',  tag: 'B',       expression: /B(?=[^aehikr]|$)/g },
  { type: 'atom',     term: 'C',  tag: 'C',       expression: /C(?=[^adeflmnorsu]|$)/g },
  { type: 'atom',     term: 'N',  tag: 'N',       expression: /N(?=[^abdeiop]|$)/g },
  { type: 'atom',     term: 'O',  tag: 'O',       expression: /O(?=[^s]|$)/g },
  { type: 'atom',     term: 'F',  tag: 'F',       expression: /F(?=[^elmr]|$)/g },
  { type: 'atom',     term: 'Ne', tag: 'Ne',      expression: /Ne/g },
  { type: 'atom',     term: 'Na', tag: 'Na',      expression: /Na/g },
  { type: 'atom',     term: 'Mg', tag: 'Mg',      expression: /Mg/g },
  { type: 'atom',     term: 'Al', tag: 'Al',      expression: /Al/g },
  { type: 'atom',     term: 'Si', tag: 'Si',      expression: /Si/g },
  { type: 'atom',     term: 'P',  tag: 'P',       expression: /P(?=[^abdmortu]|$)/g },
  { type: 'atom',     term: 'S',  tag: 'S',       expression: /S(?=[^bcegimnr]|$)/g },
  { type: 'atom',     term: 'Cl', tag: 'Cl',      expression: /Cl/g },
  { type: 'atom',     term: 'Ar', tag: 'Ar',      expression: /Ar/g },
  { type: 'atom',     term: 'As', tag: 'As',      expression: /As/g },
  { type: 'atom',     term: 'Se', tag: 'Se',      expression: /Se/g },
  { type: 'atom',     term: 'Br', tag: 'Br',      expression: /Br/g },
  { type: 'atom',     term: 'I',  tag: 'I',       expression: /I(?=[^nr]|$)/g },
  { type: 'atom',     term: 'K',  tag: 'K',       expression: /K(?=[^r]|$)/g },
  { type: 'atom',     term: 'Ca', tag: 'Ca',      expression: /Ca/g },
  { type: 'atom',     term: 'Sc', tag: 'Sc',      expression: /Sc/g },
  { type: 'atom',     term: 'Ti', tag: 'Ti',      expression: /Ti/g },
  { type: 'atom',     term: 'V',  tag: 'V',       expression: /V/g },
  { type: 'atom',     term: 'Cr', tag: 'Cr',      expression: /Cr/g },
  { type: 'atom',     term: 'Mn', tag: 'Mn',      expression: /Mn/g },
  { type: 'atom',     term: 'Fe', tag: 'Fe',      expression: /Fe/g },
  { type: 'atom',     term: 'Co', tag: 'Co',      expression: /Co/g },
  { type: 'atom',     term: 'Ni', tag: 'Ni',      expression: /Ni/g },
  { type: 'atom',     term: 'Cu', tag: 'Cu',      expression: /Cu/g },
  { type: 'atom',     term: 'Zn', tag: 'Zn',      expression: /Zn/g },
  { type: 'atom',     term: 'Ga', tag: 'Ga',      expression: /Ga/g },
  { type: 'atom',     term: 'Ge', tag: 'Ge',      expression: /Ge/g },
  { type: 'atom',     term: 'Kr', tag: 'Kr',      expression: /Kr/g },
  { type: 'atom',     term: 'Rb', tag: 'Rb',      expression: /Rb/g },
  { type: 'atom',     term: 'Sr', tag: 'Sr',      expression: /Sr/g },
  { type: 'atom',     term: 'Y',  tag: 'Y',       expression: /Y(?=[^b]|$)/g },
  { type: 'atom',     term: 'Zr', tag: 'Zr',      expression: /Zr/g },
  { type: 'atom',     term: 'Nb', tag: 'Nb',      expression: /Nb/g },
  { type: 'atom',     term: 'Mo', tag: 'Mo',      expression: /Mo/g },
  { type: 'atom',     term: 'Tc', tag: 'Tc',      expression: /Tc/g },
  { type: 'atom',     term: 'Ru', tag: 'Ru',      expression: /Ru/g },
  { type: 'atom',     term: 'Rh', tag: 'Rh',      expression: /Rh/g },
  { type: 'atom',     term: 'Pd', tag: 'Pd',      expression: /Pd/g },
  { type: 'atom',     term: 'Ag', tag: 'Ag',      expression: /Ag/g },
  { type: 'atom',     term: 'Cd', tag: 'Cd',      expression: /Cd/g },
  { type: 'atom',     term: 'In', tag: 'In',      expression: /In/g },
  { type: 'atom',     term: 'Sn', tag: 'Sn',      expression: /Sn/g },
  { type: 'atom',     term: 'Sb', tag: 'Sb',      expression: /Sb/g },
  { type: 'atom',     term: 'Te', tag: 'Te',      expression: /Te/g },
  { type: 'atom',     term: 'Xe', tag: 'Xe',      expression: /Xe/g },
  { type: 'atom',     term: 'b',  tag: 'B',       expression: /(?<![RS])b(?=[^e]|$)/g },
  { type: 'atom',     term: 'c',  tag: 'C',       expression: /(?<![TS])c(?=[^l]|$)/g },
  { type: 'atom',     term: 'n',  tag: 'N',       expression: /(?<![MZIS])n(?=[^ae]|$)/g },
  { type: 'atom',     term: 'o',  tag: 'O',       expression: /(?<![CM])o(?=[^s]|$)/g },
  { type: 'atom',     term: 'p',  tag: 'P',       expression: /p/g },
  { type: 'atom',     term: 's',  tag: 'S',       expression: /s(?=[^ei]|$)/g },
  { type: 'atom',     term: 'se', tag: 'Se',      expression: /se/g },
  { type: 'atom',     term: 'as', tag: 'As',      expression: /as/g },
  { type: 'bond',     term: '-',  tag: 'single',  expression: /(?=([^0-9]))[-](?=[^0-9-\]])/g },
  { type: 'bond',     term: '=',  tag: 'double',  expression: /[=]/g },
  { type: 'bond',     term: '#',  tag: 'triple',  expression: /[#]/g },
  { type: 'bond',     term: '$',  tag: 'quadruple', expression: /[$]/g },
  { type: 'bond',     term: ':',  tag: 'aromatic', expression: /(?<![\d%])[:]/g },
  { type: 'bond',     term: '/',  tag: 'stereo',  expression: /[/]/g },
  { type: 'bond',     term: '\\', tag: 'stereo',  expression: /[\\]/g },
  { type: 'bond',     term: '(',  tag: 'branch',  expression: /[(]/g },
  { type: 'bond',     term: ')',  tag: 'branch',  expression: /[)]/g },
  { type: 'bond',     term: '%',  tag: 'ring',    expression: /(?=[^+-])(?:[a-zA-Z]{1,2}[@]{1,2})?(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[=\-#$/\\:]?[%]?\d+(?=([^+]|$))/g },
  { type: 'bond',     term: '.',  tag: 'dot',     expression: /(?:[A-Z][+-]?[[])?[.]/g },
  { type: 'property', term: '+',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g },
  { type: 'property', term: '-',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g },
  { type: 'property', term: 'n',  tag: 'isotope', expression: /(?:[[])[0-9]+[A-Z]{1,2}(?=.?[^[]*[\]])/g },
  { type: 'property', term: 'S',  tag: 'chiral',  expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g },
  { type: 'property', term: 'R',  tag: 'chiral',  expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g }
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function compareArrays(a, b, ab = []) {
  for (let i = 0; i < a.length; i++) {
    ab[i] = b.indexOf(a[i]) > -1 ? 1 : 0;
  }
  return ab;
}

function addAtomV1(id, name, value, group = 0, protons = 0, neutrons = 0, electrons = 0) {
  return {
    id, name, value,
    group, protons, neutrons, electrons,
    bonds: { id: [], atoms: [], electrons: 0 },
    properties: { chiral: 0, charge: 0, aromatic: 0 }
  };
}

function addBondV1(id, name, value, order = 0, atoms = [], stereo = null) {
  return { id, name, value, order, atoms, stereo };
}

/**
 * Extracts the explicit bond order embedded in a ring token term (e.g. 'C=1' → 2).
 * Returns null if no bond prefix is present.
 *
 * @param {string} term - Ring token term.
 * @returns {number|null}
 */
function ringTokenBondOrder(term) {
  const m = term.match(/[a-zA-Z\]@]([-=#$:/\\])/);
  if (!m) {
    return null;
  }
  switch (m[1]) {
    case '=': return 2;
    case '#': return 3;
    case '$': return 4;
    case ':': return 1.5;
    default:  return null; // '-', '/', '\' → use aromatic heuristic
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
 * Like previousAtom but skips over `(…)` branch groups when scanning backward.
 * Used to find the true source atom for stereo bonds that follow a branch close `)`.
 *
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
    if (bonds[key] !== undefined) {
      if (bonds[key].value === ')') {
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
    } else if (atoms[key] !== undefined) {
      return key;
    }
    i--;
  }
  return null;
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

/**
 * Parses a SMILES string into an array of tokens using the v1 grammar.
 *
 * @param {string} input - SMILES string.
 * @param {object[]} [tokens=[]]
 * @returns {{ tokens: object[] }}
 * @throws {Error} If no valid atoms are found.
 */
export function tokenize(input, tokens = []) {

  for (let i = 0; i < grammar.length; i++) {
    const token = grammar[i];
    let text = [];
    while ((text = token.expression.exec(input))) {
      tokens.push({ index: text.index, type: token.type, term: text[0], tag: token.tag });
    }
  }

  tokens.sort((a, b) => {
    if (a.index < b.index) {
      return -1;
    }
    if (a.index > b.index) {
      return +1;
    }
    return 0;
  });

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

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].tag === 'ring') {
      let ringID = tokens[i].term.match(/[0-9]+/g);
      if (ringID !== null) {
        ringID = ringID[0];
      } else {
        continue;
      }

      if (ringID.length > 1) {
        let exception = 0;
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
            exception = 1; break;
          }
        }

        if (exception === 1) {
          continue;
        }

        const prefix = tokens[i].term.match(/[a-zA-Z]/g)[0];
        for (let j = 0; j < ringID.length; j++) {
          tokens.splice(i + 1, 0, {
            index: tokens[i].index + j,
            type: tokens[i].type,
            term: prefix + ringID.substr(j, j + 1),
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

// ---------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------

/**
 * Converts a token list (from {@link tokenize}) into v1-format atoms and bonds.
 *
 * Returns the raw v1 graph structure, not a {@link Molecule} instance.
 * Use {@link parseSMILES} to get a Molecule.
 *
 * @param {{ tokens: object[] }|object[]} tokens
 * @returns {{ atoms: object, bonds: object }}
 * @throws {Error} If token validation fails or no atoms are found.
 */
export function decode(tokens) {

  function validateTokens(tokens) {
    if (typeof (tokens) !== 'object') {
      console.log('Error: Tokens must be of type "object"');
      return false;
    } else if (tokens.tokens !== undefined) {
      tokens = tokens.tokens;
    }
    const fields = ['index', 'type', 'term', 'tag'];
    for (let i = 0; i < tokens.length; i++) {
      const match = compareArrays(fields, Object.keys(tokens[i]));
      if (match.reduce((a, b) => a + b) < 4) {
        console.log(`Error: Invalid token at index "${i}"`);
        return false;
      }
    }
    return tokens;
  }

  function readTokens(tokens, atoms = {}, bonds = {}, properties = {}, keys = {}) {
    for (let i = 0; i < tokens.length; i++) {
      const { type, term, tag, index } = tokens[i];
      const key = index.toString();
      switch (type) {
        case 'atom':     atoms[key]      = addAtomV1(key, tag, term); break;
        case 'bond':     bonds[key]      = addBondV1(key, tag, term); break;
        case 'property': properties[key] = { id: key, name: tag, value: term }; break;
      }
    }
    keys.all = [];
    for (let i = 0; i < tokens.length; i++) {
      keys.all[i] = tokens[i].index.toString();
    }
    if (atoms.length < 1) {
      console.log('Error: Could not find atoms'); return false;
    }
    keys.atoms      = Object.keys(atoms);
    keys.bonds      = Object.keys(bonds);
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
      atoms[atomID].group     = element.group;
      atoms[atomID].protons   = element.protons;
      atoms[atomID].neutrons  = element.neutrons;
      atoms[atomID].electrons = element.electrons;
      atoms[atomID].bonds     = { id: [], atoms: [], electrons: 0 };
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
      const { name, value } = properties[propertyID];
      switch (name) {
        case 'chiral':
          if (atoms[propertyID] !== undefined) {
            atoms[propertyID].properties.chiral = value.slice(value.indexOf('@'));
          }
          break;
        case 'isotope': {
          const isotope = value.match(/[0-9]+/g);
          const atomID = 1 + isotope.toString().length + parseInt(propertyID);
          if (isotope >= 0 && isotope < 250 && atoms[atomID] !== undefined) {
            const neutrons = isotope - atoms[atomID].protons;
            if (neutrons >= 0) {
              atoms[atomID].neutrons = neutrons;
            }
          }
          break;
        }
        case 'charge': {
          const sign = value.indexOf('+') !== -1 ? 1 : -1;
          let charge = value.match(/(?:[^H])[0-9]+/g);
          if (charge !== null && atoms[propertyID] !== undefined) {
            charge = charge[0].substr(1);
            atoms[propertyID].properties.charge = charge * sign;
            break;
          }
          charge = value.match(/([+]+|[-]+)/g);
          if (charge !== null && atoms[propertyID] !== undefined) {
            atoms[propertyID].properties.charge = charge[0].length * sign;
          }
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

    // Tracks ring-bond token IDs that have already been consumed as the
    // *closing* end of a ring closure pair.  When ring-closure numbers are
    // reused (e.g. the same digit appears 4+ times in a SMILES string),
    // the closing token must not be re-processed as a new opening token —
    // doing so creates spurious extra bonds.
    const matchedRingTargets = new Set();

    for (let i = 0; i < keys.bonds.length; i++) {
      const bondID = keys.bonds[i];
      let sourceAtom = atoms[previousAtom(bondID, keys.all, atoms)];
      let targetAtom = atoms[nextAtom(bondID, keys.all, atoms)];
      const bondIndex  = keys.all.indexOf(bondID);
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
            case ')': case '(':
              switch (bond2) {
                case '-': case '=': case '#': case '$': case ':': case '/': case '\\': case '.': exceptions = 1;
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
          bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
          break;
        case 'stereo': {
          if (targetAtom === undefined) {
            continue;
          }
          // Use branch-aware source detection: C(F)/Cl needs to find C, not F
          let stereoSrcId;
          if (exceptions === 1) {
            stereoSrcId = previousAtomSkipBranches(bondID, keys.all, atoms, bonds);
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
          const keysAfter  = keys.all.slice(bondIndex + 1, keys.all.length);

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
                  bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                  break;
                } else if (bonds[keysBefore[j]] !== undefined) {
                  switch (bonds[keysBefore[j]].value) {
                    case ')': skip++; break;
                    case '(': skip--; break;
                  }
                }
              }
              for (let j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {
                if (bonds[keysAfter[j]] !== undefined && skip === 0) {
                  switch (bonds[keysAfter[j]].value) {
                    case '-': bondOrder = 1;   break;
                    case '=': bondOrder = 2;   break;
                    case '#': bondOrder = 3;   break;
                    case '.': bondOrder = 0;   break;
                  }
                }
                if (skip === 0) {
                  bonds[bondID].order = bondOrder; break;
                } else if (bonds[keysAfter[j]] !== undefined) {
                  switch (bonds[keysAfter[j]].value) {
                    case ')': skip--; break;
                    case '(': skip++; break;
                  }
                }
              }
              break;

            case ')':
              for (let j = 0, skip = 1; j < keysBefore.length; j++) {
                sourceAtom = atoms[keysBefore[j]];
                if (sourceAtom !== undefined && sourceAtom.name !== 'H' && skip === 0) {
                  let bondOrder = 1;
                  if (sourceAtom.properties.aromatic === 1) {
                    bondOrder = 1.5;
                  }
                  bonds[bondID].order = bondOrder;
                  bonds[bondID].atoms[0] = sourceAtom.id;
                  break;
                } else if (bonds[keysBefore[j]] !== undefined) {
                  switch (bonds[keysBefore[j]].value) {
                    case ')': skip++; break;
                    case '(': skip--; break;
                  }
                }
              }
              for (let j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {
                targetAtom = atoms[keysAfter[j]];
                if (bonds[keysAfter[j]] !== undefined && skip === 0) {
                  switch (bonds[keysAfter[j]].value) {
                    case '-': bondOrder = 1;   break;
                    case '=': bondOrder = 2;   break;
                    case '#': bondOrder = 3;   break;
                    case '.': bondOrder = 0;   break;
                  }
                }
                if (targetAtom !== undefined && skip === 0) {
                  if (targetAtom.properties.aromatic === 1) {
                    bondOrder = 1.5;
                  }
                  bonds[bondID].order = bondOrder;
                  bonds[bondID].atoms[1] = targetAtom.id;
                  break;
                } else if (bonds[keysAfter[j]] !== undefined) {
                  switch (bonds[keysAfter[j]].value) {
                    case ')': skip--; break;
                    case '(': skip++; break;
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

          const sourceID    = bonds[bondID].value.match(/[0-9]+/g);
          const bondsBefore = keys.bonds.slice(0, keys.bonds.indexOf(bondID));
          const bondsAfter  = keys.bonds.slice(keys.bonds.indexOf(bondID), keys.bonds.length);

          for (let j = 1; j < bondsAfter.length; j++) {
            if (bonds[bondsAfter[j]].name !== 'ring') {
              continue;
            }
            if (matchedRingTargets.has(bondsAfter[j])) {
              continue;
            }
            const targetID    = bonds[bondsAfter[j]].value.match(/[0-9]+/g);
            let targetIndex = bondsAfter[j];
            let srcIdx      = bondID;

            if (sourceID !== null && targetID !== null && sourceID[0] === targetID[0]) {
              while (atoms[srcIdx] === undefined && srcIdx >= -1)          {
                srcIdx -= 1;
              }
              while (atoms[targetIndex] === undefined && targetIndex >= -1) {
                targetIndex -= 1;
              }
              if (srcIdx === -1 || targetIndex === -1) {
                break;
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
              bonds[bondID].atoms = [srcIdx.toString(), targetIndex.toString()];
              matchedRingTargets.add(bondsAfter[j]);
              break;
            }

            if (j === bondsAfter.length - 1) {
              for (let k = 0; k < bondsBefore.length; k++) {
                if (bonds[bondsAfter[j]].name !== 'ring') {
                  continue;
                }
                const targetID2   = bonds[bondsBefore[k]].value.match(/[0-9]+/g);
                let targetIndex = bondID;
                let srcIdx      = bondsBefore[k];
                if (sourceID !== null && targetID2 !== null && sourceID[0] === targetID2[0]) {
                  while (atoms[srcIdx] === undefined && srcIdx >= -1)          {
                    srcIdx -= 1;
                  }
                  while (atoms[targetIndex] === undefined && targetIndex >= -1) {
                    targetIndex -= 1;
                  }
                  if (srcIdx === -1 || targetIndex === -1) {
                    break;
                  }
                  let bondOrder = 1;
                  if (atoms[srcIdx].properties.aromatic === 1 && atoms[targetIndex].properties.aromatic === 1) {
                    bondOrder = 1.5;
                  }
                  bonds[bondID].order = bondOrder;
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
        keys.bonds.splice(i, 1); i--; continue;
      }
      if (bonds[keys.bonds[i]].atoms.length !== 2) {
        delete bonds[keys.bonds[i]]; keys.bonds.splice(i, 1); i--; continue;
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
        if ((a.atoms[0] === b.atoms[0] && a.atoms[1] === b.atoms[1]) ||
                    (a.atoms[0] === b.atoms[1] && a.atoms[1] === b.atoms[0])) {
          if (a.name === 'ring' && b.name === 'ring') {
            delete bonds[bondID2]; keys.bonds.splice(keys.bonds.indexOf(bondID2), 1);
          } else if (a.name === 'branch' && (b.name === 'single' || b.name === 'double' || b.name === 'triple')) {
            delete bonds[keys.bonds[i]]; keys.bonds.splice(i, 1);
          } else if ((a.name === 'single' || a.name === 'double' || a.name === 'triple') && b.name === 'branch') {
            delete bonds[bondID2]; keys.bonds.splice(keys.bonds.indexOf(bondID2), 1);
          } else {
            delete bonds[keys.bonds[i]]; keys.bonds.splice(i, 1);
          }
          i--;
          break;
        }
      }
    }

    // Add bond references to atoms
    for (let i = 0; i < keys.bonds.length; i++) {
      const bondID2  = keys.bonds[i];
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
    const MULTI_VALENCE = { N: [3, 5], P: [3, 5], S: [2, 4, 6] };
    const stdValence = (atom) => {
      if (!atom.properties.aromatic) {
        const mv = MULTI_VALENCE[atom.name];
        if (mv) {
          const v = mv.find(x => x >= atom.bonds.electrons);
          return v !== undefined ? v : mv[mv.length - 1];
        }
      }
      return 18 - atom.group;
    };

    const valence = (group) => {
      if (group <= 2) {
        return 2;
      } else if (group > 2 && group <= 12) {
        return 12;
      } else if (group > 12 && group <= 18) {
        return 18;
      }
    };

    const charge = (electrons, ch) => {
      if (ch > 0) {
        return electrons -= ch;
      }
    };

    const checkRow = (group, protons, electrons) => {
      if (group > 12 && protons > 10 && electrons <= 0) {
        return electrons += 4;
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

    for (let i = 0; i < keys.atoms.length - 1; i++) {
      let sourceAtom = atoms[keys.atoms[i]];
      const targetAtom = atoms[keys.atoms[i + 1]];
      let sourceIndex = i;

      while ((sourceAtom.name === 'H' || atoms[keys.atoms[sourceIndex]] === undefined) && sourceIndex > -1) {
        sourceAtom = atoms[keys.atoms[sourceIndex]];
        sourceIndex -= 1;
      }
      if (!sourceAtom) {
        continue;
      }

      let sourceTotal = charge(valence(sourceAtom.group) - sourceAtom.bonds.electrons, sourceAtom.properties.charge);
      let targetTotal = charge(valence(targetAtom.group) - targetAtom.bonds.electrons, targetAtom.properties.charge);
      sourceTotal = checkRow(sourceTotal);
      targetTotal = checkRow(targetTotal);

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
        const bondID    = (sourceAtom.name + sourceAtom.id) + (targetAtom.name + targetAtom.id);
        const bondValue = sourceAtom.name + targetAtom.name;
        let bondName  = 'single';
        let bondOrder = 1;
        if (sourceAtom.name === 'H' || targetAtom.name === 'H') {
          bondName = 'H';
        }
        if (sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
          bondName = 'aromatic'; bondOrder = 1.5;
        }
        keys.bonds.push(bondID);
        bonds[bondID] = addBondV1(bondID, bondName, bondValue, bondOrder, [sourceAtom.id, targetAtom.id]);
        updateAtomsBonds(sourceAtom.id, targetAtom.id, bondID, bondOrder);
      }
    }

    // Add implicit hydrogen
    const H = elements.H;

    const update = (x, sourceID, sourceName) => {
      const bondID   = `H${x + 1}${sourceName}${sourceID}`;
      const targetID = bondID;
      atoms[targetID] = addAtomV1(targetID, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);
      bonds[bondID]   = addBondV1(bondID, 'H', 'H', 1, [sourceID, targetID]);
      atoms[sourceID].bonds.id.push(bondID);
      atoms[sourceID].bonds.atoms.push(targetID);
      atoms[sourceID].bonds.electrons += 1;
      atoms[targetID].bonds.id.push(bondID);
      atoms[targetID].bonds.atoms.push(sourceID);
      atoms[targetID].bonds.electrons += 1;
    };

    for (let i = 0; i < keys.atoms.length; i++) {
      const sourceAtom = atoms[keys.atoms[i]];
      if (sourceAtom.group < 13 && sourceAtom.group > 1) {
        continue;
      }

      const bondCount = sourceAtom.bonds.atoms.length;

      if (sourceAtom.name !== 'H' && bondCount > 0) {
        for (let j = 0; j < bondCount; j++) {
          const targetID   = sourceAtom.bonds.atoms[j];
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

      let total = stdValence(sourceAtom) - sourceAtom.bonds.electrons;
      const ch    = sourceAtom.properties.charge;
      if (total <= 0 || sourceAtom.group === 1) {
        continue;
      }
      if (ch > 0) {
        total -= ch;
      } else if (ch < 0) {
        total += ch;
        if (total === 1) {
          total -= 1; atoms[sourceAtom.id].bonds.electrons += 1;
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
      const order  = bonds[bondID[i]].order;
      bonds[bondID[i]].value = source.name + order + target.name;
    }

    const getID = (name, i) => name + (i + 1);
    const setID = (obj, a, b) => {
      if (Object.prototype.hasOwnProperty.call(obj, a)) {
        obj[b] = obj[a]; delete obj[a];
      }
    };

    for (let i = 0; i < atomID.length; i++) {
      const oldID = atomID[i];
      const newID = getID(atoms[oldID].name, i);
      atoms[oldID].id = newID;
      for (let j = 0; j < atoms[oldID].bonds.id.length; j++) {
        let key   = atoms[oldID].bonds.id[j];
        let index = bonds[key].atoms.indexOf(oldID);
        if (index !== -1) {
          bonds[key].atoms[index] = newID;
        }
        key   = atoms[oldID].bonds.atoms[j];
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
  atoms = _explicit[0]; bonds = _explicit[1]; keys = _explicit[2];

  const _implicit = implicitBonds(atoms, bonds, keys);
  atoms = _implicit[0]; bonds = _implicit[1]; keys = _implicit[2];

  const _clean = clean(atoms, bonds);
  atoms = _clean[0]; bonds = _clean[1];

  return { atoms, bonds };
}

// ---------------------------------------------------------------------------
// parseSMILES
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chirality — SMILES neighbour-order extraction
// ---------------------------------------------------------------------------

/**
 * Scans backward from `bracketOpenPos - 1` to find the position of the
 * "from" atom: the atom immediately before the `[` of a bracket atom in the
 * SMILES chain, correctly skipping `(…)` branches and treating `[…]` bracket
 * atoms as single units.
 *
 * Returns the character index of the from-atom, or -1 if none (chain start).
 *
 * @param {number}        bracketOpenPos - index of the `[` character
 * @param {string}        smiles
 * @param {Map<number,string>} posToClean - char-position → clean atom ID
 * @returns {number}
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
 * Ring-closure bonds at the chiral centre are not yet handled; centres with
 * ring tokens in their immediate neighbourhood are skipped (return no entry).
 *
 * @param {string}   smiles  - original SMILES string
 * @param {object[]} tokens  - token list from {@link tokenize}
 * @returns {Map<string, {chiral: '@'|'@@', neighbors: string[]}>}
 */
function extractChiralNeighborOrders(smiles, tokens) {
  // ── 1. Build position → cleanId map ─────────────────────────────────────
  // clean() numbers atoms by their order in Object.keys(atoms), which for
  // numeric-string keys is ascending numeric (= character-position) order,
  // followed by non-numeric keys (implicit H atoms — ignored here because
  // chiral centres always use bracket notation with explicit atoms).
  const atomTokens = tokens
    .filter(t => t.type === 'atom')
    .sort((a, b) => a.index - b.index);

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
    const atomPos     = cp.index;
    const cleanId     = posToClean.get(atomPos);
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
        bracketEnd = i; break;
      }
    }
    if (bracketEnd < 0) {
      continue;
    }

    // Skip centres with a ring token immediately after the ']' — complex ordering
    const ringTokenAfter = tokens.some(
      t => t.tag === 'ring' && t.index > bracketEnd && t.index <= bracketEnd + 3 &&
                 t.index < (tokens.find(t2 => t2.type === 'bond' && t2.tag === 'branch' && t2.term === '(' && t2.index > bracketEnd)?.index ?? Infinity)
    );
    if (ringTokenAfter) {
      continue;
    }

    const neighbors = [];

    // ── 2a. From atom: backward scan from '[' properly skipping branches ──
    // Scan backwards from bracketOpenPos-1, skipping (…) branches and
    // treating […] bracket atoms as a single unit.
    const bracketOpenPos = atomPos - 1; // we already verified smiles[atomPos-1]==='['
    const fromPos = findFromAtomPos(bracketOpenPos, smiles, posToClean);
    if (fromPos < 0) {
      continue;
    } // atom is at chain start — skip
    neighbors.push(posToClean.get(fromPos));

    // ── 2b. Bracket H: atom token inside (atomPos, bracketEnd) ──────────
    const bracketAtoms = atomTokens.filter(
      t => t.index > atomPos && t.index < bracketEnd
    );
    for (const ba of bracketAtoms) {
      neighbors.push(posToClean.get(ba.index));
    }

    // ── 2c. Post-bracket neighbours: branches + chain continuation ───────
    // Sort all post-bracket tokens by position and scan depth.
    const postTokens = tokens
      .filter(t => t.index > bracketEnd)
      .sort((a, b) => a.index - b.index);

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
        // Ring closure immediately at depth 0 — too complex, skip centre
        neighbors.length = 0;
        break;
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
 * then converts the result into a v2 Molecule. Each Atom gains extra
 * periodic-table properties: `protons`, `neutrons`, `electrons`, `group`, `period`.
 *
 * @param {string} smiles - SMILES notation string.
 * @returns {Molecule}
 * @throws {Error} If the SMILES string cannot be parsed.
 */
export function parseSMILES(smiles) {
  if (typeof smiles !== 'string' || smiles.trim() === '') {
    throw new Error('Invalid SMILES input: must be a non-empty string');
  }
  const { tokens } = tokenize(smiles);
  const { atoms: v1Atoms, bonds: v1Bonds } = decode({ tokens });
  const mol = new Molecule();

  for (const atom of Object.values(v1Atoms)) {
    const a = mol.addAtom(atom.id, atom.name, {
      charge: atom.properties.charge,
      aromatic: atom.properties.aromatic === 1
    });
    a.resolveElement();
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
    if (mol.bonds.has(bond.id)) {
      continue;
    }
    if ([...mol.bonds.values()].some(bd => bd.connects(a, b))) {
      continue;
    }
    mol.addBond(bond.id, a, b, { order: bond.order, aromatic: bond.name === 'aromatic', stereo: bond.stereo || null }, false);
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

  mol.properties.formula = mol.getFormula();
  mol.properties.mass    = mol.getMass();
  mol.properties.charge  = mol.getCharge();
  mol.name               = mol.getName();

  return mol;
}

// ---------------------------------------------------------------------------
// toSMILES
// ---------------------------------------------------------------------------

/**
 * Normal SMILES valence for each organic-subset element (lowest standard valence).
 * @type {Object.<string, number>}
 */
const ORGANIC_VALENCE = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, F: 1, Cl: 1, Br: 1, I: 1 };

/**
 * Returns `true` when `atom` is a standard pendant hydrogen that can be
 * represented implicitly in SMILES output (uncharged, mass-number 1, pendant
 * to exactly one non-H atom).
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {Set<string>} nonHIds - Set of atom IDs that are not hydrogen.
 * @param {import('../core/Molecule.js').Molecule} mol
 * @returns {boolean}
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
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {number} pendantHCount  - Number of implicit H atoms to encode.
 * @param {number} heavyBondOrder - Sum of bond orders to heavy-atom neighbours.
 * @returns {string}
 */
function _atomToken(atom, pendantHCount, heavyBondOrder) {
  const name    = atom.name;
  const charge  = atom.properties.charge ?? 0;
  const aromatic = atom.properties.aromatic ?? false;

  // Determine if a non-standard isotope is present.
  let massNum = null;
  if (atom.properties.protons !== undefined && atom.properties.neutrons !== undefined) {
    const atomMass = Math.round(atom.properties.protons + atom.properties.neutrons);
    const elData   = elements[name];
    const stdMass  = elData ? Math.round(elData.protons + elData.neutrons) : atomMass;
    if (atomMass !== stdMass) {
      massNum = atomMass;
    }
  }

  // Bare organic-subset symbol when all conditions are satisfied.
  if (name in ORGANIC_VALENCE && charge === 0 && massNum === null) {
    const impliedH = Math.max(0, ORGANIC_VALENCE[name] - heavyBondOrder);
    if (Math.round(impliedH) === pendantHCount) {
      return aromatic ? name.toLowerCase() : name;
    }
  }

  // Bracket notation: [massSymbolHcountcharge]
  let s = '[';
  if (massNum !== null)       {
    s += massNum;
  }
  s += aromatic ? name.toLowerCase() : name;
  if (pendantHCount === 1)    {
    s += 'H';
  } else if (pendantHCount > 1) {
    s += `H${pendantHCount}`;
  }
  if (charge > 0)             {
    s += charge === 1  ? '+' : `+${charge}`;
  } else if (charge < 0)        {
    s += charge === -1 ? '-' : `${charge}`;
  }
  s += ']';
  return s;
}

/**
 * Returns the SMILES bond character for `bond`.
 * Single bonds (order 1) and aromatic bonds both return `''` (implicit).
 *
 * @param {import('../core/Bond.js').Bond} bond
 * @returns {string}
 */
function _bondToken(bond) {
  if (!bond || bond.properties.aromatic) {
    return '';
  }
  switch (bond.properties.order ?? 1) {
    case 2:  return '=';
    case 3:  return '#';
    case 4:  return '$';
    default: return '';
  }
}

/**
 * Formats a ring-closure integer as its SMILES token:
 * single digits 1–9 are written bare; 10+ use `%nn` notation.
 *
 * @param {number} n
 * @returns {string}
 */
function _ringToken(n) {
  return n < 10 ? `${n}` : `%${n}`;
}

/**
 * Serialises a single *connected* `Molecule` component into a SMILES string.
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @returns {string}
 */
function _serializeComponent(mol) {
  // ---- Identify strippable (implicit) H atoms ----
  const nonHIds = new Set([...mol.atoms.keys()].filter(id => mol.atoms.get(id).name !== 'H'));

  // For each non-H atom, count how many neighbouring H atoms are strippable.
  const pendantH = new Map();
  for (const id of nonHIds) {
    let n = 0;
    for (const bId of mol.atoms.get(id).bonds) {
      const b     = mol.bonds.get(bId);
      const other = b && mol.atoms.get(b.getOtherAtom(id));
      if (other && _isStrippable(other, nonHIds, mol)) {
        n++;
      }
    }
    pendantH.set(id, n);
  }

  // Build the heavy-atom subgraph (retains non-strippable H, e.g. [2H] or H2).
  const keepIds = [...mol.atoms.keys()].filter(id => !_isStrippable(mol.atoms.get(id), nonHIds, mol));
  const heavy   = mol.getSubgraph(keepIds);

  if (heavy.atomCount === 0) {
    return '';
  }

  const startId = heavy.atoms.keys().next().value;

  // ---- Pass 1: DFS to identify ring-closure bonds ----
  // Back edges in the DFS spanning tree become ring-closure bonds.
  // The "opener" is the ancestor atom (visited earlier); the "closer" is the
  // descendant that discovers the back edge.  The bond symbol is placed at
  // the opener so that the v1 ring-token parser can extract it.
  const visited1   = new Set();
  const inStack1   = new Set();
  const entryBond  = new Map(); // atomId → bondId we arrived via
  const ringBondId = new Map(); // bondId → ring-closure number
  const atomRings  = new Map(); // atomId → [{num, bond, isOpener}]
  let ringSeq = 1;

  const dfs1 = (id) => {
    visited1.add(id);
    inStack1.add(id);
    for (const bId of heavy.atoms.get(id).bonds) {
      if (bId === entryBond.get(id)) {
        continue;
      }
      const bond   = heavy.bonds.get(bId);
      const nextId = bond.getOtherAtom(id);
      if (!visited1.has(nextId)) {
        entryBond.set(nextId, bId);
        dfs1(nextId);
      } else if (inStack1.has(nextId) && !ringBondId.has(bId)) {
        // Back edge: id = closer, nextId = opener (ancestor).
        const num = ringSeq++;
        ringBondId.set(bId, num);
        if (!atomRings.has(id))     {
          atomRings.set(id, []);
        }
        if (!atomRings.has(nextId)) {
          atomRings.set(nextId, []);
        }
        // Bond symbol at opener so v1 ring-token parser sees it.
        atomRings.get(nextId).push({ num, bond, isOpener: true  });
        atomRings.get(id).push({ num, bond, isOpener: false });
      }
    }
    inStack1.delete(id);
  };
  dfs1(startId);

  const ringBondSet = new Set(ringBondId.keys());

  // ---- Pass 2: DFS emission ----
  const emitted = new Set();

  const emit = (id) => {
    emitted.add(id);
    const atom = heavy.atoms.get(id);

    // Sum of bond orders over all bonds in the heavy subgraph (used for
    // implicit-H calculation; aromatic bonds contribute 1.5 each).
    const heavyBO = atom.bonds.reduce(
      (acc, bId) => acc + (heavy.bonds.get(bId)?.properties.order ?? 1), 0
    );

    let s = _atomToken(atom, pendantH.get(id) ?? 0, heavyBO);

    // Ring-closure annotations appended right after the atom symbol.
    // Bond character is placed at the opener only.
    for (const { num, bond, isOpener } of (atomRings.get(id) ?? [])) {
      s += (isOpener ? _bondToken(bond) : '') + _ringToken(num);
    }

    // Spanning-tree children (non-ring bonds to unvisited atoms).
    const children = [];
    for (const bId of atom.bonds) {
      if (ringBondSet.has(bId)) {
        continue;
      }
      const bond   = heavy.bonds.get(bId);
      const nextId = bond.getOtherAtom(id);
      if (!emitted.has(nextId)) {
        children.push({ nextId, bond });
      }
    }

    // All children except the last are written as branches in parentheses.
    for (let i = 0; i < children.length; i++) {
      const { nextId, bond } = children[i];
      const bs = _bondToken(bond);
      s += i < children.length - 1
        ? `(${bs}${emit(nextId)})`
        : `${bs}${emit(nextId)}`;
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
 * **Not supported**: stereo descriptors (`/`, `\`, `@`, `@@`) are silently
 * dropped; the connectivity and constitution are preserved.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {string}
 */
export function toSMILES(molecule) {
  if (molecule.atomCount === 0) {
    return '';
  }
  return molecule.getComponents().map(_serializeComponent).join('.');
}
