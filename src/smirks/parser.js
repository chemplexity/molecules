/** @module smirks/parser */

import elements from '../data/elements.js';
import { Molecule } from '../core/Molecule.js';
import { parseSMILES } from '../io/smiles.js';
import { parseSMARTS } from '../smarts/parser.js';

function _buildTemplateReaction(atomMap, overrides = {}) {
  return {
    atomMap,
    template: {
      chargeSpecified: false,
      hydrogenCountSpecified: false,
      hydrogenCount: 0,
      radicalSpecified: false,
      chiralitySpecified: false,
      chiralityToken: null,
      ...overrides
    }
  };
}

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
          body: inner.slice(0, i),
          atomMap: parseInt(digits, 10)
        };
      }
      break;
    }
  }
  return { body: inner, atomMap: null };
}

function _parseCharge(text, pos) {
  const ch = text[pos];
  if (ch !== '+' && ch !== '-') {
    return null;
  }

  let i = pos;
  const sign = text[i] === '+' ? 1 : -1;
  i++;

  let repeated = 1;
  while (i < text.length && text[i] === ch) {
    repeated++;
    i++;
  }

  let digits = '';
  while (i < text.length && text[i] >= '0' && text[i] <= '9') {
    digits += text[i++];
  }

  const magnitude = digits.length > 0 ? parseInt(digits, 10) : repeated;
  return { charge: sign * magnitude, nextPos: i };
}

function _parseTemplateAtomInner(inner) {
  const { body, atomMap } = _extractTrailingAtomMap(inner);
  let pos = 0;
  let chargeSpecified = false;
  let hydrogenCountSpecified = false;
  let hydrogenCount = 0;
  let chiralitySpecified = false;
  let chiralityToken = null;

  while (pos < body.length && body[pos] >= '0' && body[pos] <= '9') {
    pos++;
  }

  if (pos >= body.length) {
    throw new Error(`parseSMIRKS: unsupported bracket atom '[${inner}]'`);
  }

  let name = null;
  let aromatic = false;

  const first = body[pos];
  if (first === '*') {
    throw new Error(`parseSMIRKS: wildcard atoms are not supported in product templates ('[${inner}]')`);
  }

  if (first >= 'A' && first <= 'Z') {
    const next = pos + 1 < body.length ? body[pos + 1] : null;
    if (next !== null && next >= 'a' && next <= 'z') {
      const sym2 = first + next;
      if (elements[sym2] !== undefined) {
        name = sym2;
        pos += 2;
      }
    }
    if (!name) {
      name = first;
      pos++;
    }
  } else if (first >= 'a' && first <= 'z') {
    const next = pos + 1 < body.length ? body[pos + 1] : null;
    if (next !== null && next >= 'a' && next <= 'z') {
      const sym2 = (first + next);
      if (elements[sym2[0].toUpperCase() + sym2.slice(1)] !== undefined) {
        name = sym2[0].toUpperCase() + sym2.slice(1);
        aromatic = true;
        pos += 2;
      }
    }
    if (!name) {
      name = first.toUpperCase();
      aromatic = true;
      pos++;
    }
  } else {
    throw new Error(`parseSMIRKS: unsupported bracket atom '[${inner}]'`);
  }

  let charge = 0;
  while (pos < body.length) {
    const ch = body[pos];
    if (ch === '@') {
      if (chiralitySpecified) {
        throw new Error(`parseSMIRKS: duplicate chirality primitive in product atom '[${inner}]'`);
      }
      chiralityToken = (body[pos + 1] === '@') ? '@@' : '@';
      chiralitySpecified = true;
      pos += chiralityToken.length;
      continue;
    }
    if (ch === 'H') {
      if (hydrogenCountSpecified) {
        throw new Error(`parseSMIRKS: duplicate hydrogen count in product atom '[${inner}]'`);
      }
      pos++;
      let digits = '';
      while (pos < body.length && body[pos] >= '0' && body[pos] <= '9') {
        digits += body[pos++];
      }
      hydrogenCount = digits.length > 0 ? parseInt(digits, 10) : 1;
      hydrogenCountSpecified = true;
      continue;
    }
    if (ch === '+' || ch === '-') {
      const parsed = _parseCharge(body, pos);
      if (!parsed) {
        throw new Error(`parseSMIRKS: invalid charge in product atom '[${inner}]'`);
      }
      charge += parsed.charge;
      chargeSpecified = true;
      pos = parsed.nextPos;
      continue;
    }
    throw new Error(`parseSMIRKS: unsupported product atom primitive '${ch}' in '[${inner}]'`);
  }

  return {
    name,
    properties: {
      aromatic,
      charge,
      reaction: _buildTemplateReaction(atomMap, {
        chargeSpecified,
        hydrogenCountSpecified,
        hydrogenCount,
        chiralitySpecified,
        chiralityToken
      })
    }
  };
}

function _stripProductAtomMaps(template) {
  let stripped = '';
  let pos = 0;
  while (pos < template.length) {
    if (template[pos] !== '[') {
      stripped += template[pos++];
      continue;
    }
    const closeIdx = template.indexOf(']', pos + 1);
    if (closeIdx < 0) {
      throw new Error(`parseSMIRKS: unclosed '[' at pos ${pos}`);
    }
    const inner = template.slice(pos + 1, closeIdx);
    const { body } = _extractTrailingAtomMap(inner);
    stripped += `[${body}]`;
    pos = closeIdx + 1;
  }
  return stripped;
}

function _annotateProductStereo(productText, product) {
  const strippedText = _stripProductAtomMaps(productText);
  const stereoMol = parseSMILES(strippedText);

  const productAtoms = [...product.atoms.values()].filter(atom => atom.name !== 'H');
  const stereoAtoms = [...stereoMol.atoms.values()].filter(atom => atom.name !== 'H');
  if (productAtoms.length !== stereoAtoms.length) {
    throw new Error('parseSMIRKS: internal stereo annotation mismatch in product template');
  }

  const productToStereoAtomId = new Map();
  for (let i = 0; i < productAtoms.length; i++) {
    productToStereoAtomId.set(productAtoms[i].id, stereoAtoms[i].id);
  }

  for (const productAtom of productAtoms) {
    const flags = productAtom.properties.reaction?.template ?? {};
    if (!flags.chiralitySpecified) {
      continue;
    }
    if (flags.hydrogenCountSpecified && flags.hydrogenCount > 1) {
      throw new Error(`parseSMIRKS: chiral product atom '[${productAtom.name}]' cannot specify H${flags.hydrogenCount}`);
    }
    const stereoAtom = stereoMol.atoms.get(productToStereoAtomId.get(productAtom.id));
    if (!stereoAtom?.getChirality()) {
      throw new Error(`parseSMIRKS: product chirality could not be resolved for atom '${productAtom.id}'`);
    }
    productAtom.setChirality(stereoAtom.getChirality());
  }

  for (const productBond of product.bonds.values()) {
    const stereoA = productToStereoAtomId.get(productBond.atoms[0]);
    const stereoB = productToStereoAtomId.get(productBond.atoms[1]);
    const stereoBond = stereoMol.getBond(stereoA, stereoB);
    if (stereoBond?.getStereo()) {
      productBond.setStereo(stereoBond.getStereo());
    }
  }
}

function _parseBareTemplateAtom(text, pos) {
  const ch = text[pos];
  if (ch === '*') {
    throw new Error(`parseSMIRKS: wildcard atoms are not supported in product templates ('*' at pos ${pos})`);
  }

  if (ch >= 'A' && ch <= 'Z') {
    const next = pos + 1 < text.length ? text[pos + 1] : null;
    if (next !== null && next >= 'a' && next <= 'z') {
      const sym2 = ch + next;
      if (elements[sym2] !== undefined) {
        return { name: sym2, properties: { aromatic: false, charge: 0, reaction: _buildTemplateReaction(null) }, len: 2 };
      }
    }
    if (elements[ch] !== undefined) {
      return { name: ch, properties: { aromatic: false, charge: 0, reaction: _buildTemplateReaction(null) }, len: 1 };
    }
  }

  if (ch >= 'a' && ch <= 'z') {
    const next = pos + 1 < text.length ? text[pos + 1] : null;
    if (next !== null && next >= 'a' && next <= 'z') {
      const sym2 = (ch + next);
      const cap = sym2[0].toUpperCase() + sym2.slice(1);
      if (elements[cap] !== undefined) {
        return { name: cap, properties: { aromatic: true, charge: 0, reaction: _buildTemplateReaction(null) }, len: 2 };
      }
    }
    const cap = ch.toUpperCase();
    if (elements[cap] !== undefined) {
      return { name: cap, properties: { aromatic: true, charge: 0, reaction: _buildTemplateReaction(null) }, len: 1 };
    }
  }

  return null;
}

function _defaultBondProps(prevId, nextAtom, mol) {
  const prevAtom = prevId == null ? null : mol.atoms.get(prevId);
  if (prevAtom?.isAromatic() && nextAtom.isAromatic()) {
    return { order: 1.5, aromatic: true, stereo: null };
  }
  return { order: 1, aromatic: false, stereo: null };
}

function _parseProductTemplate(template) {
  if (typeof template !== 'string' || template.length === 0) {
    throw new Error('parseSMIRKS: expected a non-empty product template');
  }

  const mol = new Molecule();
  let atomCount = 0;
  const ringOpens = new Map();
  const branchStack = [];
  let prevId = null;
  let pendingBondProps = null;

  function addAtomNode(name, properties) {
    const id = `p${atomCount++}`;
    const atom = mol.addAtom(id, name, properties);
    atom.resolveElement();
    atom.setCharge(properties.charge ?? 0);
    atom.setAromatic(properties.aromatic ?? false);

    if (prevId !== null) {
      const bondProps = pendingBondProps ?? _defaultBondProps(prevId, atom, mol);
      mol.addBond(null, prevId, id, bondProps, false);
      pendingBondProps = null;
    }

    prevId = id;
    return id;
  }

  function setPendingBond(ch) {
    switch (ch) {
      case '-':
        pendingBondProps = { order: 1, aromatic: false, stereo: null };
        break;
      case '=':
        pendingBondProps = { order: 2, aromatic: false, stereo: null };
        break;
      case '#':
        pendingBondProps = { order: 3, aromatic: false, stereo: null };
        break;
      case ':':
        pendingBondProps = { order: 1.5, aromatic: true, stereo: null };
        break;
      case '/':
      case '\\':
        pendingBondProps = { order: 1, aromatic: false, stereo: ch };
        break;
      case '~':
      case '@':
        throw new Error(`parseSMIRKS: unsupported product bond token '${ch}'`);
      default:
        throw new Error(`parseSMIRKS: invalid product bond token '${ch}'`);
    }
  }

  let pos = 0;
  while (pos < template.length) {
    const ch = template[pos];

    if (ch === '(') {
      if (prevId == null) {
        throw new Error(`parseSMIRKS: branch '(' at pos ${pos} must follow a product atom`);
      }
      branchStack.push({ prevId, pendingBondProps });
      pos++;
      continue;
    }

    if (ch === ')') {
      if (branchStack.length === 0) {
        throw new Error(`parseSMIRKS: unmatched ')' at pos ${pos}`);
      }
      ({ prevId, pendingBondProps } = branchStack.pop());
      pos++;
      continue;
    }

    if (ch === '.') {
      if (pendingBondProps) {
        throw new Error(`parseSMIRKS: disconnected component at pos ${pos} cannot follow a dangling bond token`);
      }
      if (prevId == null) {
        throw new Error(`parseSMIRKS: unexpected '.' at pos ${pos}`);
      }
      prevId = null;
      pendingBondProps = null;
      pos++;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || ch === '%') {
      if (prevId == null) {
        throw new Error(`parseSMIRKS: ring closure at pos ${pos} must follow a product atom`);
      }
      let ringNum;
      if (ch === '%') {
        if (pos + 2 >= template.length) {
          throw new Error(`parseSMIRKS: incomplete '%' ring closure at pos ${pos}`);
        }
        ringNum = parseInt(template.slice(pos + 1, pos + 3), 10);
        pos += 3;
      } else {
        ringNum = parseInt(ch, 10);
        pos++;
      }

      if (ringOpens.has(ringNum)) {
        const open = ringOpens.get(ringNum);
        ringOpens.delete(ringNum);
        const currentAtom = mol.atoms.get(prevId);
        const bondProps = pendingBondProps ?? open.bondProps ?? _defaultBondProps(open.atomId, currentAtom, mol);
        mol.addBond(null, open.atomId, prevId, bondProps, false);
        pendingBondProps = null;
      } else {
        ringOpens.set(ringNum, { atomId: prevId, bondProps: pendingBondProps });
        pendingBondProps = null;
      }
      continue;
    }

    if ('-=#:/\\~@'.includes(ch)) {
      if (prevId == null || pendingBondProps) {
        throw new Error(`parseSMIRKS: bond token '${ch}' at pos ${pos} is not attached to a valid product atom sequence`);
      }
      setPendingBond(ch);
      pos++;
      continue;
    }

    if (ch === '[') {
      const closeIdx = template.indexOf(']', pos + 1);
      if (closeIdx < 0) {
        throw new Error(`parseSMIRKS: unclosed '[' at pos ${pos}`);
      }
      const inner = template.slice(pos + 1, closeIdx);
      const parsed = _parseTemplateAtomInner(inner);
      addAtomNode(parsed.name, parsed.properties);
      pos = closeIdx + 1;
      continue;
    }

    const bare = _parseBareTemplateAtom(template, pos);
    if (bare) {
      addAtomNode(bare.name, bare.properties);
      pos += bare.len;
      continue;
    }

    throw new Error(`parseSMIRKS: invalid character '${ch}' at pos ${pos}`);
  }

  if (branchStack.length > 0) {
    throw new Error('parseSMIRKS: unclosed \'(\' in product template');
  }
  if (ringOpens.size > 0) {
    throw new Error('parseSMIRKS: unclosed ring closure in product template');
  }
  if (pendingBondProps) {
    throw new Error('parseSMIRKS: product template cannot end with a bond token');
  }
  if (prevId == null) {
    throw new Error('parseSMIRKS: product template cannot end with a disconnected-component separator');
  }

  return mol;
}

function _mapTable(mol) {
  const mapToAtomId = new Map();
  for (const atom of mol.atoms.values()) {
    const atomMap = atom.getAtomMap();
    if (atomMap == null) {
      continue;
    }
    if (mapToAtomId.has(atomMap)) {
      throw new Error(`parseSMIRKS: duplicate atom map :${atomMap}`);
    }
    mapToAtomId.set(atomMap, atom.id);
  }
  return mapToAtomId;
}

export function parseSMIRKS(smirks) {
  if (typeof smirks !== 'string' || smirks.trim() === '') {
    throw new Error('parseSMIRKS: expected a non-empty string');
  }

  const parts = smirks.split('>>');
  if (parts.length !== 2) {
    throw new Error('parseSMIRKS: expected exactly one \'>>\' separator');
  }

  const [reactantText, productText] = parts;
  const reactant = parseSMARTS(reactantText);
  const product = _parseProductTemplate(productText);
  _annotateProductStereo(productText, product);

  const reactantMaps = _mapTable(reactant);
  const productMaps = _mapTable(product);

  for (const atomMap of productMaps.keys()) {
    if (!reactantMaps.has(atomMap)) {
      throw new Error(`parseSMIRKS: product atom map :${atomMap} is not present in the reactant`);
    }
  }

  const sharedMaps = [...productMaps.keys()].filter(atomMap => reactantMaps.has(atomMap));
  if (sharedMaps.length === 0) {
    throw new Error('parseSMIRKS: phase-1 SMIRKS requires at least one mapped atom shared between reactant and product');
  }

  for (const component of product.getComponents()) {
    const hasSharedMap = [...component.atoms.values()].some(atom => atom.getAtomMap() != null);
    if (!hasSharedMap) {
      throw new Error('parseSMIRKS: phase-1 SMIRKS does not support disconnected product fragments without a shared mapped atom');
    }
  }

  return {
    smirks,
    reactantText,
    productText,
    reactant,
    product,
    reactantMaps,
    productMaps
  };
}
