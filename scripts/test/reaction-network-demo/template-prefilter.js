const ATOMIC_NUMBER_TO_ELEMENT = new Map([
  [1, 'H'],
  [5, 'B'],
  [6, 'C'],
  [7, 'N'],
  [8, 'O'],
  [9, 'F'],
  [14, 'Si'],
  [15, 'P'],
  [16, 'S'],
  [17, 'Cl'],
  [35, 'Br'],
  [53, 'I']
]);

const AROMATIC_ORGANIC = new Map([
  ['b', 'B'],
  ['c', 'C'],
  ['n', 'N'],
  ['o', 'O'],
  ['p', 'P'],
  ['s', 'S']
]);

const ORGANIC_SYMBOLS = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I', 'Si']);

function normalizeElement(symbol) {
  if (!symbol) {
    return null;
  }
  if (AROMATIC_ORGANIC.has(symbol)) {
    return AROMATIC_ORGANIC.get(symbol);
  }
  if (symbol.length === 1) {
    return symbol.toUpperCase();
  }
  return `${symbol[0].toUpperCase()}${symbol.slice(1).toLowerCase()}`;
}

function parseAtomPrimitive(text) {
  const atomicNumberMatch = text.match(/^#(\d+)/);
  if (atomicNumberMatch) {
    const element = ATOMIC_NUMBER_TO_ELEMENT.get(Number(atomicNumberMatch[1])) ?? null;
    return element ? { element, aromatic: false } : null;
  }

  const symbolMatch = text.match(/^(Cl|Br|Si|[BCNOPSFIbcnops])/);
  if (!symbolMatch) {
    return null;
  }

  const raw = symbolMatch[1];
  const aromatic = AROMATIC_ORGANIC.has(raw);
  const element = normalizeElement(raw);
  return element && ORGANIC_SYMBOLS.has(element) ? { element, aromatic } : null;
}

function stripAtomMap(atomText) {
  return atomText.replace(/:\d+\b/g, '');
}

function splitTopLevelAlternatives(atomText) {
  const alternatives = [];
  let current = '';
  let depth = 0;

  for (const ch of atomText) {
    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      alternatives.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  alternatives.push(current);
  return alternatives;
}

function leadingPrimitiveText(atomText) {
  const match = atomText.match(/^(#[0-9]+|Cl|Br|Si|[BCNOPSFIbcnops])/);
  return match?.[1] ?? null;
}

function extractBracketAtomBodies(smarts) {
  const bodies = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < smarts.length; i++) {
    const ch = smarts[i];
    if (ch === '[') {
      if (depth === 0) {
        start = i + 1;
      }
      depth++;
      continue;
    }
    if (ch === ']' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        bodies.push(smarts.slice(start, i));
        start = -1;
      }
    }
  }

  return bodies;
}

function stripBracketAtoms(smarts) {
  let result = '';
  let depth = 0;

  for (const ch of smarts) {
    if (ch === '[') {
      depth++;
      continue;
    }
    if (ch === ']' && depth > 0) {
      depth--;
      continue;
    }
    if (depth === 0) {
      result += ch;
    }
  }

  return result;
}

function collectBracketAtomRequirements(atomText, requirements) {
  const body = stripAtomMap(atomText.trim());

  if (body.includes('$(') || body.includes('!')) {
    const leading = leadingPrimitiveText(body);
    if (leading) {
      const primitive = parseAtomPrimitive(leading);
      if (primitive?.aromatic) {
        requirements.aromaticElements.add(primitive.element);
      } else if (primitive?.element) {
        requirements.elements.add(primitive.element);
      }
    }
    return;
  }

  const qualifierStart = body.search(/[;&]/);
  const atomExpression = qualifierStart === -1 ? body : body.slice(0, qualifierStart);
  const rawAlternatives = splitTopLevelAlternatives(atomExpression);
  const alternatives = rawAlternatives.map(part => parseAtomPrimitive(part)).filter(Boolean);
  if (alternatives.length >= 2 && alternatives.length === rawAlternatives.length) {
    const aromaticAlternatives = alternatives.filter(alt => alt.aromatic);
    const plainAlternatives = alternatives.filter(alt => !alt.aromatic);

    if (plainAlternatives.length > 1) {
      requirements.elementAnySets.push(new Set(plainAlternatives.map(alt => alt.element)));
    }
    if (aromaticAlternatives.length > 1) {
      requirements.aromaticElementAnySets.push(new Set(aromaticAlternatives.map(alt => alt.element)));
    }
    return;
  }

  const leading = leadingPrimitiveText(body);
  if (!leading) {
    return;
  }
  const primitive = parseAtomPrimitive(leading);
  if (primitive?.aromatic) {
    requirements.aromaticElements.add(primitive.element);
  } else if (primitive?.element) {
    requirements.elements.add(primitive.element);
  }
}

function collectBareAtomRequirements(reactantSmarts, requirements) {
  const bare = stripBracketAtoms(reactantSmarts);
  const atomMatches = bare.matchAll(/Cl|Br|Si|[BCNOPSFIbcnops]/g);
  for (const match of atomMatches) {
    const primitive = parseAtomPrimitive(match[0]);
    if (primitive?.aromatic) {
      requirements.aromaticElements.add(primitive.element);
    } else if (primitive?.element) {
      requirements.elements.add(primitive.element);
    }
  }
}

export function summarizeMoleculeFeatures(molecule) {
  const features = {
    elements: new Set(),
    aromaticElements: new Set(),
    hasDoubleBond: false,
    hasTripleBond: false,
    hasAromaticBond: false
  };

  for (const atom of molecule.atoms.values()) {
    features.elements.add(atom.name);
    if (atom.properties.aromatic) {
      features.aromaticElements.add(atom.name);
    }
  }

  for (const bond of molecule.bonds.values()) {
    const order = bond.properties.localizedOrder ?? bond.properties.order ?? 1;
    if (bond.properties.aromatic || order === 1.5) {
      features.hasAromaticBond = true;
      continue;
    }
    if (order >= 3) {
      features.hasTripleBond = true;
    } else if (order >= 2) {
      features.hasDoubleBond = true;
    }
  }

  return features;
}

export function inferTemplateRequirements(templateOrSmirks) {
  const smirks = typeof templateOrSmirks === 'string' ? templateOrSmirks : (templateOrSmirks?.smirks ?? '');
  const reactantSmarts = smirks.split('>>')[0] ?? '';
  const requirements = {
    elements: new Set(),
    aromaticElements: new Set(),
    elementAnySets: [],
    aromaticElementAnySets: [],
    hasDoubleBond: false,
    hasTripleBond: false,
    hasAromaticBond: false
  };

  const bracketAtomBodies = extractBracketAtomBodies(reactantSmarts);
  for (const atomBody of bracketAtomBodies) {
    collectBracketAtomRequirements(atomBody, requirements);
  }
  collectBareAtomRequirements(reactantSmarts, requirements);

  const bareBonds = stripBracketAtoms(reactantSmarts);
  requirements.hasDoubleBond = bareBonds.includes('=');
  requirements.hasTripleBond = bareBonds.includes('#');
  requirements.hasAromaticBond = bareBonds.includes(':') || requirements.aromaticElements.size > 0 || requirements.aromaticElementAnySets.length > 0;

  return requirements;
}

export function templateCouldMatchFeatures(requirements, features) {
  for (const element of requirements.elements) {
    if (!features.elements.has(element)) {
      return false;
    }
  }

  for (const element of requirements.aromaticElements) {
    if (!features.aromaticElements.has(element)) {
      return false;
    }
  }

  for (const elementSet of requirements.elementAnySets) {
    if (![...elementSet].some(element => features.elements.has(element))) {
      return false;
    }
  }

  for (const elementSet of requirements.aromaticElementAnySets) {
    if (![...elementSet].some(element => features.aromaticElements.has(element))) {
      return false;
    }
  }

  if (requirements.hasDoubleBond && !features.hasDoubleBond) {
    return false;
  }
  if (requirements.hasTripleBond && !features.hasTripleBond) {
    return false;
  }
  if (requirements.hasAromaticBond && !features.hasAromaticBond) {
    return false;
  }

  return true;
}

export function buildTemplatePrefilterEntries(templates) {
  return templates.map(template => ({
    template,
    requirements: inferTemplateRequirements(template)
  }));
}
