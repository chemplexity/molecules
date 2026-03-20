/** @module io/inchi */

import elements from '../data/elements.js';
import { Molecule, computeRS } from '../core/Molecule.js';
import { validateValence } from '../validation/valence.js';

// ---------------------------------------------------------------------------
// Internal helpers — layer parsers
// ---------------------------------------------------------------------------

function parseFormulaComponent(componentStr) {
  const counts = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m;
  while ((m = re.exec(componentStr)) !== null) {
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

  const list = [];
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

function expandFormulaComponentStrings(formulaStr) {
  const components = [];
  for (const part of formulaStr.split('.').filter(Boolean)) {
    const match = /^(\d+)(?:\*(.+)|([A-Z].*))$/.exec(part);
    const repeat = match ? parseInt(match[1], 10) : 1;
    const body = match ? (match[2] ?? match[3]) : part;
    for (let i = 0; i < repeat; i++) {
      components.push(body);
    }
  }
  return components;
}

/**
 * Parses an InChI formula string into ordered heavy-atom components.
 *
 * Component order is preserved from the formula layer so semicolon-separated
 * layers such as `/h...;...` can be mapped onto the correct disconnected
 * components. Within each component, heavy atoms follow Hill order without H.
 *
 * @param {string} formulaStr - e.g. "C6H6" or "ClH.H3N"
 * @returns {string[][]}
 */
function parseFormulaComponents(formulaStr) {
  return expandFormulaComponentStrings(formulaStr).map(parseFormulaComponent);
}

function countFormulaHydrogens(formulaStr) {
  let total = 0;
  const re = /H(\d*)/g;
  let match;
  while ((match = re.exec(formulaStr)) !== null) {
    total += match[1] === '' ? 1 : parseInt(match[1], 10);
  }
  return total;
}

function expandRepeatedSections(layerStr) {
  const sections = [];
  for (const part of layerStr.split(';')) {
    const match = /^(\d+)\*(.*)$/.exec(part);
    if (!match) {
      sections.push(part);
      continue;
    }
    const repeat = parseInt(match[1], 10);
    const body = match[2];
    for (let i = 0; i < repeat; i++) {
      sections.push(body);
    }
  }
  return sections;
}

/**
 * Parses an InChI formula string into an ordered array of heavy-atom element
 * symbols (1-indexed; index 0 is a null placeholder).
 *
 * @param {string} formulaStr - e.g. "C6H6" or "C2H6O"
 * @returns {(string|null)[]} e.g. [null, 'C', 'C', 'O'] for "C2H6O"
 */
function parseFormula(formulaStr) {
  const list = [null]; // 1-indexed; index 0 unused
  for (const component of parseFormulaComponents(formulaStr)) {
    list.push(...component);
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
 * Parses the InChI /h (hydrogen) layer into fixed assignments plus mobile
 * hydrogen groups.
 *
 * Format examples:
 *   "1-6H"        atoms 1–6, 1 H each
 *   "1H3,2H2,3H"  atom 1→3H, atom 2→2H, atom 3→1H
 *   "1,5H2"       atoms 1 and 5, 2 H each
 *   "(H,11,12)"   mobile/exchangeable H shared between listed atoms
 *
 * @param {string} hStr
 * @param {number[]} [componentOffsets=[]] - per-component 1-based atom index offsets
 * @returns {{ fixed: Map<number, number>, mobile: Array<{ count: number, atoms: number[] }> }}
 */
function parseHydrogenLayer(hStr, componentOffsets = []) {
  const fixed = new Map();
  const mobile = [];
  const sections = expandRepeatedSections(hStr);

  for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
    const section = sections[sectionIdx];
    const offset = componentOffsets[sectionIdx] ?? 0;
    const re = /(\d[\d,-]*)H(\d*)/g;
    let match;
    while ((match = re.exec(section)) !== null) {
      const count = match[2] === '' ? 1 : parseInt(match[2], 10);
      for (const idx of expandAtomList(match[1])) {
        const globalIdx = offset + idx;
        fixed.set(globalIdx, (fixed.get(globalIdx) ?? 0) + count);
      }
    }
    // Mobile / exchangeable H: "(H,11,12)" or "(H2,1,2,3)".
    const mobileRe = /\(H(\d*),(\d[\d,]*)\)/g;
    while ((match = mobileRe.exec(section)) !== null) {
      const count = match[1] === '' ? 1 : parseInt(match[1], 10);
      mobile.push({
        count,
        atoms: match[2].split(',').map(s => offset + parseInt(s, 10))
      });
    }
  }
  return { fixed, mobile };
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
function parseConnectionSection(cStr) {
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

  // Top-level: one chain
  parseChain(null);
  if (pos !== src.length) {
    throw new Error(`parseINCHI /c: unsupported syntax at position ${pos} in "${cStr}"`);
  }

  return raw;
}

function parseConnectionLayer(cStr, componentOffsets = []) {
  const raw = [];
  const neighborOrders = new Map();
  const sections = expandRepeatedSections(cStr);

  if (sections.length <= 1 && componentOffsets.length === 0) {
    raw.push(...parseConnectionSection(cStr));
  } else {
    for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
      const section = sections[sectionIdx].trim();
      if (!section) {
        continue;
      }
      const offset = componentOffsets[sectionIdx] ?? 0;
      for (const [a, b] of parseConnectionSection(section)) {
        raw.push([a + offset, b + offset]);
      }
    }
  }

  const addNeighbor = (a, b) => {
    if (!neighborOrders.has(a)) {
      neighborOrders.set(a, []);
    }
    const neighbors = neighborOrders.get(a);
    if (!neighbors.includes(b)) {
      neighbors.push(b);
    }
  };
  for (const [a, b] of raw) {
    addNeighbor(a, b);
    addNeighbor(b, a);
  }

  const seen = new Set();
  const bonds = raw.filter(([a, b]) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return { bonds, neighborOrders };
}

/**
 * Parses the InChI /q (charge) layer.
 *
 * @param {string} qStr - e.g. "+1" or "-2"
 * @returns {number}
 */
function parseChargeLayer(qStr) {
  return expandRepeatedSections(qStr)
    .reduce((sum, part) => {
      const n = parseInt(part, 10);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
}

function parseChargeComponents(qStr) {
  return expandRepeatedSections(qStr)
    .map(part => {
      const n = parseInt(part, 10);
      return isNaN(n) ? 0 : n;
    });
}

function parseTetrahedralLayer(tStr, componentOffsets = []) {
  const entries = [];
  const sections = expandRepeatedSections(tStr);
  for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
    const section = sections[sectionIdx];
    const offset = componentOffsets[sectionIdx] ?? 0;
    const re = /(\d+)([+\-?])/g;
    let match;
    while ((match = re.exec(section)) !== null) {
      entries.push({
        atomIndex: offset + parseInt(match[1], 10),
        parity: match[2]
      });
    }
  }
  return entries;
}

function parseDoubleBondStereoLayer(bStr, componentOffsets = []) {
  const entries = [];
  const sections = expandRepeatedSections(bStr);
  for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
    const section = sections[sectionIdx];
    const offset = componentOffsets[sectionIdx] ?? 0;
    const re = /(\d+)-(\d+)([+\-?])/g;
    let match;
    while ((match = re.exec(section)) !== null) {
      entries.push({
        atomA: offset + parseInt(match[1], 10),
        atomB: offset + parseInt(match[2], 10),
        parity: match[3]
      });
    }
  }
  return entries;
}

function parseInversionLayer(mStr) {
  const n = parseInt(mStr, 10);
  return n === 1 ? 1 : 0;
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
 * (ignoring H atoms). 6-membered rings are aromatic when every atom has
 * exactly one unit of unsatisfied valence (remaining = 1). 5-membered rings
 * use the 4+1 rule: exactly 4 pi-contributor atoms (remaining = 1) plus
 * exactly 1 lone-pair-donor heteroatom (non-C, remaining = 0), covering
 * pyrrole, furan, thiophene, imidazole, indole, etc.
 * Using per-bond shortest-cycle search (rather than the fundamental-cycle
 * basis) correctly handles fused ring systems such as naphthalene and indole
 * where the cycle basis alone would miss one of the rings.
 *
 * **Phase B — greedy promotion**
 * For every remaining heavy-atom bond where both endpoints have unsatisfied
 * valence, the bond order is incremented by 1. Bonds where either endpoint
 * belongs to an aromatic ring are skipped to prevent exocyclic substituents
 * (e.g. carboxyl groups on benzene) from being incorrectly promoted.
 * This loop repeats until no further changes occur.
 *
 * @param {Molecule} mol
 * @param {string[]} heavyAtomIds - IDs of heavy atoms in the molecule.
 */
function inferBondOrders(mol, heavyAtomIds, totalCharge = 0) {
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
    const { group, period } = el;
    if (group >= 1  && group <= 2)  {
      return group;
    }
    if (group >= 13 && group <= 17) {
      const base = 18 - group;
      // Elements beyond period 2 can exhibit expanded valence (d-orbital
      // participation): S valence 4/6 (sulfoxide/sulfone/sulfate),
      // Se valence 4 (selenoxide), P valence 5 (phosphine oxide), etc.
      // Find the smallest same-parity valence that is *strictly greater* than
      // the atom's current bond-order sum, so remaining() > 0 and the
      // terminal-promotion loop can raise adjacent bonds to double/triple.
      // Cap at base+4 (e.g. S: 6, Se: 6, P: 7) to prevent unbounded growth:
      // once the atom reaches that cap, v == cap and the second condition in
      // the while loop (v < base+4) stops the increment, returning v==cap and
      // giving remaining = cap − current (≤ 0 when fully saturated).
      if (period > 2) {
        const current = atom.getValence(mol);
        const cap = base + 4;
        let v = base;
        while (v <= current && v < cap) {
          v += 2;
        }
        return v;
      }
      return base;
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

  // requireNeighborCapacity=true: exclude neighbours with remaining=0 from the
  // terminal test. Used in Phase B (after aromatics are known) so that ring
  // atoms adjacent to saturated carbonyls (e.g. o-quinone C8=O) are correctly
  // seen as terminal rather than non-terminal, forcing priority promotion of
  // the unsaturated ring C=C instead of a greedy mid-chain bond.
  // The first call (before Phase A) must leave requireNeighborCapacity=false so
  // that heteroaromatic rings (furan, thiophene …) are not pre-promoted before
  // their aromatic nature can be detected.
  function promoteTerminalUnsaturation(aromaticBondIds = new Set(), requireNeighborCapacity = false) {
    const isAromaticRingAtom = (atomId) => {
      const atom = mol.atoms.get(atomId);
      return atom !== undefined && atom.bonds.some(bId => aromaticBondIds.has(bId));
    };

    let terminalChanged = true;
    while (terminalChanged) {
      terminalChanged = false;
      for (const atomId of heavyAtomIds) {
        const atom = mol.atoms.get(atomId);
        if (!atom || isAromaticRingAtom(atomId)) {
          continue;
        }
        const eligibleBonds = atom.bonds
          .map(bId => mol.bonds.get(bId))
          .filter(bond => bond)
          .filter(bond => !aromaticBondIds.has(bond.id))
          .filter(bond => {
            const otherId = bond.getOtherAtom(atomId);
            return heavySet.has(otherId) && !isAromaticRingAtom(otherId)
              && (!requireNeighborCapacity || remaining(otherId) > 0);
          });
        if (eligibleBonds.length !== 1) {
          continue;
        }
        const bond = eligibleBonds[0];
        const otherId = bond.getOtherAtom(atomId);
        while (bond.properties.order < 3 && remaining(atomId) > 0 && remaining(otherId) > 0) {
          bond.properties.order += 1;
          terminalChanged = true;
        }
      }
    }
  }

  // Promote terminal multiple bonds first (e.g. C#N, C#C, C=O). Doing this
  // before aromatic detection prevents quinones and related systems from being
  // misidentified as aromatic while their carbonyls are still single bonds.
  promoteTerminalUnsaturation();

  // ---- Phase A: aromatic detection ----------------------------------------
  // Inspect every heavy-atom bond. If its shortest cycle has size 5 or 6 and
  // every atom in that cycle has remaining = 1 (one pi electron each), the
  // ring is conjugated and all its bonds are labelled aromatic.
  const aromaticBondIds = new Set();
  // Collect unique rings (size 4–8) for the Phase A2 fused Hückel check.
  const uniqueRings = new Map(); // key: sorted atom IDs → ring atom array

  for (const bond of mol.bonds.values()) {
    const [idA, idB] = bond.atoms;
    if (!heavySet.has(idA) || !heavySet.has(idB)) {
      continue;
    }

    const ring = smallestRingForBond(mol, bond, heavySet);
    if (!ring) {
      continue;
    }

    // Collect for Phase A2 regardless of aromatic check outcome.
    if (ring.length >= 4 && ring.length <= 8) {
      const ringKey = [...ring].sort().join('|');
      if (!uniqueRings.has(ringKey)) {
        uniqueRings.set(ringKey, ring);
      }
    }

    if (ring.length === 6) {
      // Standard 6-membered aromatic ring (benzene, pyridine, pyrimidine …).
      // Every atom must have exactly 1 remaining pi electron.
      const piCount6 = ring.filter(id => remaining(id) === 1).length;
      if (piCount6 === ring.length) {
        // all atoms contribute 1 pi electron — standard case
      } else if (totalCharge > 0 && piCount6 === ring.length - 1) {
        // Cationic aromatic (pyrylium, thiopyrylium …): n−1 pi atoms plus
        // exactly 1 heteroatom (non-C) with remaining = 0 that acts like a
        // pyridine-N (contributes 1 pi electron from its formal double bond).
        const cationHetero = ring.filter(id => {
          if (remaining(id) !== 0) {
            return false;
          }
          const a = mol.atoms.get(id);
          return a && a.name !== 'C';
        });
        if (cationHetero.length !== 1) {
          continue;
        }
      } else {
        continue;
      }
    } else if (ring.length === 5) {
      // Heteroaromatic 5-membered ring (pyrrole, furan, thiophene …).
      // 4 pi-contributor atoms (remaining = 1) + 1 lone-pair-donor
      // heteroatom (non-C, remaining = 0) satisfies the 6-pi-electron rule.
      const piCount   = ring.filter(id => remaining(id) === 1).length;
      const donorCount = ring.filter(id => {
        if (remaining(id) !== 0) {
          return false;
        }
        const a = mol.atoms.get(id);
        return a && a.name !== 'C';
      }).length;
      if (piCount !== 4 || donorCount !== 1) {
        continue;
      }
    } else {
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

  // ---- Phase A2: fused ring Hückel check ----------------------------------
  // Per-ring Phase A cannot detect rings whose aromaticity depends on the
  // fused system as a whole. Example: indole — neither the 5-membered
  // all-carbon ring nor the 6-membered N-containing ring satisfies the
  // simple per-ring rules, yet together their 10 π electrons obey Hückel.
  //
  // Algorithm:
  //   1. Group collected rings into connected components (sharing ≥ 1 atom).
  //   2. Per component, count π electrons:
  //        remaining = 1  → 1 π-electron (sp2 C or imine-like N/O)
  //        remaining = 0, non-C → 2 π-electrons (lone-pair donor: N, O, S…)
  //        anything else  → disqualify (sp3 or hypervalent)
  //   3. If π satisfies Hückel (4n + 2), mark all intra-system bonds aromatic.
  if (uniqueRings.size > 1) {
    const ringList = [...uniqueRings.values()];
    const rc       = ringList.length;
    const ufP      = Array.from({ length: rc }, (_, i) => i);
    const ufFind   = (x) => {
      while (ufP[x] !== x) {
        ufP[x] = ufP[ufP[x]]; x = ufP[x];
      }
      return x;
    };
    for (let i = 0; i < rc; i++) {
      const setI = new Set(ringList[i]);
      for (let j = i + 1; j < rc; j++) {
        if (ringList[j].some(id => setI.has(id))) {
          ufP[ufFind(i)] = ufFind(j);
        }
      }
    }
    const ringComponents = new Map();
    for (let i = 0; i < rc; i++) {
      const root = ufFind(i);
      if (!ringComponents.has(root)) {
        ringComponents.set(root, []);
      }
      ringComponents.get(root).push(i);
    }
    for (const [, indices] of ringComponents) {
      const sysAtoms = new Set();
      for (const ri of indices) {
        for (const id of ringList[ri]) {
          sysAtoms.add(id);
        }
      }
      let pi = 0;
      let ok = true;
      for (const atomId of sysAtoms) {
        const rem = remaining(atomId);
        if (rem === 1) {
          pi += 1;
        } else if (rem === 0) {
          const a = mol.atoms.get(atomId);
          if (a && a.name !== 'C') {
            pi += 2; // lone-pair donor (N, O, S, Se …)
          } else {
            ok = false; break; // sp3 carbon or unexpected valence
          }
        } else {
          ok = false; break; // rem ≥ 2 or negative — not suitable
        }
      }
      if (!ok) {
        continue;
      }
      const nHuckel = (pi - 2) / 4;
      if (nHuckel < 0 || !Number.isInteger(nHuckel)) {
        continue;
      }
      // Hückel satisfied: mark every bond between ring-system atoms aromatic.
      for (const bond of mol.bonds.values()) {
        const [idA, idB] = bond.atoms;
        if (sysAtoms.has(idA) && sysAtoms.has(idB)) {
          bond.properties.aromatic = true;
          aromaticBondIds.add(bond.id);
        }
      }
    }
  }

  // ---- Phase B: greedy bond-order promotion --------------------------------
  // Promote bonds that are not aromatic AND whose endpoints are not part of
  // an aromatic ring. Skipping aromatic-ring atoms prevents exocyclic bonds
  // (e.g. C=O on phenol, COOH on aspirin) from being incorrectly promoted.
  const isAromaticRingAtom = (atomId) => {
    const atom = mol.atoms.get(atomId);
    return atom !== undefined && atom.bonds.some(bId => aromaticBondIds.has(bId));
  };

  // Re-run prioritization after aromatic bonds are known, this time excluding
  // saturated-dead-end neighbours (remaining=0) from the terminal count so that
  // ring atoms adjacent to completed carbonyls (o-quinone pattern) are treated
  // as terminal and get their ring C=C bonds promoted before the greedy loop.
  promoteTerminalUnsaturation(aromaticBondIds, true);

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
      if (isAromaticRingAtom(idA) || isAromaticRingAtom(idB)) {
        continue;
      }
      if (remaining(idA) > 0 && remaining(idB) > 0) {
        bond.properties.order += 1;
        changed = true;
      }
    }
  }

  // ---- Nitro / N-oxide fixup ----------------------------------------------
  // Period-2 group-15 atoms (N) with remaining=0 bonded to terminal heavy
  // atoms (O, S, …) with remaining>0 represent nitro/N-oxide groups. Promote
  // one such bond to double so that assignComponentFormalCharges can assign
  // the correct N⁺/O⁻ zwitterionic charges later.
  for (const atomId of heavyAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const el = elements[atom.name];
    if (!el || el.period !== 2 || el.group !== 15 || remaining(atomId) !== 0) {
      continue;
    }
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond || aromaticBondIds.has(bondId) || bond.properties.order !== 1) {
        continue;
      }
      const otherId = bond.getOtherAtom(atomId);
      if (!heavySet.has(otherId) || remaining(otherId) <= 0) {
        continue;
      }
      const other = mol.atoms.get(otherId);
      if (!other) {
        continue;
      }
      const otherHeavyDeg = other.bonds.filter(b2 => {
        const ob = mol.bonds.get(b2);
        return ob && heavySet.has(ob.getOtherAtom(otherId));
      }).length;
      if (otherHeavyDeg !== 1) {
        continue;
      }
      bond.properties.order = 2;
      break;
    }
  }

  const localizedNeed = new Map();
  for (const bondId of aromaticBondIds) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    for (const atomId of bond.atoms) {
      if (!localizedNeed.has(atomId)) {
        localizedNeed.set(atomId, remaining(atomId) === 1 ? 1 : 0);
      }
    }
  }

  const aromaticNeighbors = new Map();
  for (const bondId of aromaticBondIds) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [a, b] = bond.atoms;
    if (!aromaticNeighbors.has(a)) {
      aromaticNeighbors.set(a, []);
    }
    if (!aromaticNeighbors.has(b)) {
      aromaticNeighbors.set(b, []);
    }
    aromaticNeighbors.get(a).push({ bondId, other: b });
    aromaticNeighbors.get(b).push({ bondId, other: a });
  }

  const visitedAro = new Set();
  const aromaticComponents = [];
  for (const atomId of localizedNeed.keys()) {
    if (visitedAro.has(atomId)) {
      continue;
    }
    const atomIds = [];
    const bondIds = new Set();
    const queue = [atomId];
    visitedAro.add(atomId);
    while (queue.length > 0) {
      const curr = queue.shift();
      atomIds.push(curr);
      for (const edge of aromaticNeighbors.get(curr) ?? []) {
        bondIds.add(edge.bondId);
        if (!visitedAro.has(edge.other)) {
          visitedAro.add(edge.other);
          queue.push(edge.other);
        }
      }
    }
    aromaticComponents.push({ atomIds, bondIds: [...bondIds] });
  }

  function chooseLocalizedDoubleBonds(component) {
    const needs = new Map(component.atomIds.map(id => [id, localizedNeed.get(id) ?? 0]));
    const candidateEdges = component.bondIds
      .map(id => mol.bonds.get(id))
      .filter(Boolean)
      .filter(bond => bond.atoms.every(id => (needs.get(id) ?? 0) === 1));
    const edgeByAtom = new Map(component.atomIds.map(id => [id, []]));
    for (const bond of candidateEdges) {
      for (const atomId of bond.atoms) {
        edgeByAtom.get(atomId)?.push(bond);
      }
    }
    const selected = new Set();

    function search() {
      const unsatisfied = component.atomIds
        .filter(id => (needs.get(id) ?? 0) > 0)
        .sort((a, b) => (edgeByAtom.get(a)?.length ?? 0) - (edgeByAtom.get(b)?.length ?? 0));
      if (unsatisfied.length === 0) {
        return true;
      }
      const atomId = unsatisfied[0];
      const options = (edgeByAtom.get(atomId) ?? []).filter(bond => {
        const [a, b] = bond.atoms;
        return (needs.get(a) ?? 0) > 0 && (needs.get(b) ?? 0) > 0;
      });
      for (const bond of options) {
        const [a, b] = bond.atoms;
        needs.set(a, 0);
        needs.set(b, 0);
        selected.add(bond.id);
        if (search()) {
          return true;
        }
        selected.delete(bond.id);
        needs.set(a, 1);
        needs.set(b, 1);
      }
      return false;
    }

    return search() ? selected : null;
  }

  // ---- Phase C: finalise aromatic bond order and atom flags ---------------
  // Set bond order to 1.5 (the SMILES convention for aromatic bonds) and mark
  // both endpoints as aromatic atoms so toSMILES can emit lowercase symbols
  // with correct implicit-H counts rather than bracket notation.
  for (const component of aromaticComponents) {
    const localizedDoubles = chooseLocalizedDoubleBonds(component);
    if (!localizedDoubles) {
      continue;
    }
    for (const bondId of component.bondIds) {
      const bond = mol.bonds.get(bondId);
      if (bond) {
        bond.properties.localizedOrder = localizedDoubles.has(bondId) ? 2 : 1;
      }
    }
  }

  for (const bondId of aromaticBondIds) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    bond.properties.order = 1.5;
    for (const atomId of bond.atoms) {
      const atom = mol.atoms.get(atomId);
      if (atom) {
        atom.properties.aromatic = true;
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
 *   - /t /m tetrahedral stereo  — assigns atom R/S where determinable
 *   - /b alkene stereo          — assigns bond E/Z via directional bond markers
 *
 * Relative/racemic stereo flags (/s values other than the absolute standard
 * cases) and isotope (/i) layers are still ignored.
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

  // Collect main layers and, if present, a fixed-H section with its own layers.
  const mainLayers = {};
  const fixedLayers = {};
  let fixedFormulaStr = null;
  let inFixedSection = false;
  for (let i = 2; i < parts.length; i++) {
    if (!parts[i]) {
      continue;
    }
    const prefix = parts[i][0];
    if (!inFixedSection && prefix === 'f') {
      fixedFormulaStr = parts[i].slice(1);
      inFixedSection = true;
      continue;
    }
    if (inFixedSection) {
      fixedLayers[prefix] = parts[i].slice(1);
    } else {
      mainLayers[prefix] = parts[i].slice(1);
    }
  }
  const activeFormulaStr = fixedFormulaStr ?? formulaStr;
  const layers = { ...mainLayers, ...fixedLayers };

  const rawFormulaComponents = expandFormulaComponentStrings(activeFormulaStr);
  const formulaComponents = parseFormulaComponents(activeFormulaStr);
  const componentHydrogenCounts = rawFormulaComponents.map(countFormulaHydrogens);
  const componentOffsets = [];
  const componentIndexByAtomIndex = [null];
  let runningOffset = 0;
  for (let componentIdx = 0; componentIdx < formulaComponents.length; componentIdx++) {
    const component = formulaComponents[componentIdx];
    componentOffsets.push(runningOffset);
    runningOffset += component.length;
    for (let i = 0; i < component.length; i++) {
      componentIndexByAtomIndex.push(componentIdx);
    }
  }

  const hInfo = layers['h']
    ? parseHydrogenLayer(layers['h'], componentOffsets)
    : { fixed: new Map(), mobile: [] };
  const tetraStereoEntries = layers['t'] ? parseTetrahedralLayer(layers['t'], componentOffsets) : [];
  const doubleBondStereoEntries = layers['b'] ? parseDoubleBondStereoLayer(layers['b'], componentOffsets) : [];
  const inversionFlag = layers['m'] ? parseInversionLayer(layers['m']) : 0;

  // -------------------------------------------------------------------------
  // Phase 1 — build heavy-atom skeleton from formula
  // -------------------------------------------------------------------------
  const atomList = parseFormula(activeFormulaStr); // [null, 'C', 'C', 'O', ...]
  const n        = atomList.length - 1;      // total number of heavy atoms

  function buildHeavySkeleton() {
    const mol       = new Molecule();
    const idByIndex = new Map(); // InChI index (1-based) → atom ID in mol
    const componentHeavyAtomIds = formulaComponents.map(() => []);

    for (let i = 1; i <= n; i++) {
      const atom = mol.addAtom(null, atomList[i]);
      atom.resolveElement();
      idByIndex.set(i, atom.id);
      componentHeavyAtomIds[componentIndexByAtomIndex[i]]?.push(atom.id);
    }

    const connectionInfo = layers['c'] ? parseConnectionLayer(layers['c'], componentOffsets) : null;

    if (connectionInfo) {
      for (const [a, b] of connectionInfo.bonds) {
        const idA = idByIndex.get(a);
        const idB = idByIndex.get(b);
        if (!idA || !idB) {
          throw new Error(`parseINCHI: atom index out of range in /c layer (got ${a} or ${b}, max ${n})`);
        }
        mol.addBond(null, idA, idB, { order: 1 }, false);
      }
    }
    if (!connectionInfo) {
      const hasMultiHeavyComponent = formulaComponents.some(component => component.length > 1);
      if (hasMultiHeavyComponent) {
        const orphaned = [];
        for (let i = 1; i <= n; i++) {
          orphaned.push(`${i} (${atomList[i]})`);
        }
        throw new Error(
          `parseINCHI: formula requires a /c layer for connected heavy atom(s): ${orphaned.join(', ')}`
        );
      }
      return {
        mol,
        idByIndex,
        heavyAtomIds: [...idByIndex.values()],
        componentHeavyAtomIds,
        connectionInfo: { bonds: [], neighborOrders: new Map() }
      };
    }

    if (n > 1) {
      const connectedHeavy = new Set();
      for (const bond of mol.bonds.values()) {
        const [idA, idB] = bond.atoms;
        const atomA = mol.atoms.get(idA);
        const atomB = mol.atoms.get(idB);
        if (atomA?.name === 'H' || atomB?.name === 'H') {
          continue;
        }
        connectedHeavy.add(idA);
        connectedHeavy.add(idB);
      }
      const orphaned = [];
      for (let i = 1; i <= n; i++) {
        const id = idByIndex.get(i);
        const componentIdx = componentIndexByAtomIndex[i];
        const componentSize = formulaComponents[componentIdx]?.length ?? 0;
        if (!id || connectedHeavy.has(id) || componentSize <= 1) {
          continue;
        }
        orphaned.push(`${i} (${atomList[i]})`);
      }
      if (orphaned.length > 0) {
        throw new Error(
          `parseINCHI: /c layer leaves heavy atom(s) unconnected: ${orphaned.join(', ')}`
        );
      }
    }
    return { mol, idByIndex, heavyAtomIds: [...idByIndex.values()], componentHeavyAtomIds, connectionInfo };
  }

  const {
    mol: baseMol,
    idByIndex,
    heavyAtomIds,
    componentHeavyAtomIds,
    connectionInfo
  } = buildHeavySkeleton();
  const componentChargeTargets = new Array(formulaComponents.length).fill(0);
  const rawComponentCharges = layers['q'] ? parseChargeComponents(layers['q']) : [];
  for (let i = 0; i < Math.min(componentChargeTargets.length, rawComponentCharges.length); i++) {
    componentChargeTargets[i] = rawComponentCharges[i];
  }
  const protonDelta = layers['p'] ? (parseInt(layers['p'], 10) || 0) : 0;

  function componentMobileHydrogenCount(componentIdx) {
    return hInfo.mobile.reduce((sum, group) => {
      const atomIdx = group.atoms[0];
      if (componentIndexByAtomIndex[atomIdx] !== componentIdx) {
        return sum;
      }
      return sum + group.count;
    }, 0);
  }

  function adjustHydrogensForProtons() {
    if (protonDelta === 0) {
      return;
    }

    const protonAdjustments = new Array(formulaComponents.length).fill(0);
    let remaining = protonDelta;

    if (remaining < 0) {
      while (remaining < 0) {
        let changed = false;
        for (let componentIdx = 0; componentIdx < formulaComponents.length && remaining < 0; componentIdx++) {
          if (componentMobileHydrogenCount(componentIdx) + componentHydrogenCounts[componentIdx] <= 0) {
            continue;
          }

          for (const group of hInfo.mobile) {
            const atomIdx = group.atoms[0];
            if (componentIndexByAtomIndex[atomIdx] !== componentIdx || group.count <= 0 || remaining >= 0) {
              continue;
            }
            group.count--;
            componentHydrogenCounts[componentIdx]--;
            protonAdjustments[componentIdx]--;
            remaining++;
            changed = true;
          }
        }
        if (!changed) {
          break;
        }
      }

      while (remaining < 0) {
        let changed = false;
        for (let componentIdx = 0; componentIdx < formulaComponents.length && remaining < 0; componentIdx++) {
          // Do NOT modify hInfo.fixed here — the excess H will be removed after
          // bond-order inference by correctHydrogenDeficit (which runs later and
          // prefers heteroatoms).  Only update the count target so that function
          // knows how many H the final molecule should have.
          for (const [atomIdx, count] of hInfo.fixed) {
            if (componentIndexByAtomIndex[atomIdx] !== componentIdx || count <= 0 || remaining >= 0) {
              continue;
            }
            componentHydrogenCounts[componentIdx]--;
            protonAdjustments[componentIdx]--;
            remaining++;
            changed = true;
            break;
          }
        }
        if (!changed) {
          break;
        }
      }
    } else {
      while (remaining > 0) {
        let changed = false;
        for (let componentIdx = 0; componentIdx < formulaComponents.length && remaining > 0; componentIdx++) {
          componentHydrogenCounts[componentIdx]++;
          protonAdjustments[componentIdx]++;
          remaining--;
          changed = true;
        }
        if (!changed) {
          break;
        }
      }
    }

    for (let i = 0; i < componentChargeTargets.length; i++) {
      componentChargeTargets[i] += protonAdjustments[i];
    }
  }

  adjustHydrogensForProtons();

  function applyComponentCharges(mol) {
    for (let i = 0; i < componentHeavyAtomIds.length; i++) {
      const charge = componentChargeTargets[i] ?? 0;
      const atomIds = componentHeavyAtomIds[i];
      if (charge === 0 || atomIds.length !== 1) {
        continue;
      }
      const atom = mol.atoms.get(atomIds[0]);
      atom?.setCharge(charge);
    }
  }

  function assignComponentFormalCharges(mol) {
    for (let i = 0; i < componentHeavyAtomIds.length; i++) {
      const charge = componentChargeTargets[i] ?? 0;
      const atomIds = componentHeavyAtomIds[i];
      if (atomIds.length <= 1) {
        continue;
      }

      const computedCharges = atomIds.map(atomId => {
        const atom = mol.atoms.get(atomId);
        if (!atom) {
          return null;
        }
        const totalBO = atom.bonds.reduce((sum, bondId) => {
          return sum + (mol.bonds.get(bondId)?.properties.order ?? 1);
        }, 0);
        // For period>2 p-block atoms, use the expanded valence corresponding
        // to the atom's actual bond order so that, e.g., S in SO4²⁻ (BO=6)
        // reports formal charge 0 rather than +4 (which is what the base-2
        // valence formula would give). The rule is: walk up from the base
        // valence in steps of 2 (same parity) until we reach or exceed BO,
        // then charge = BO − v. This is the complement of neutralVal().
        const el = elements[atom.name];
        let atomCharge;
        if (el && el.period > 2 && el.group >= 13 && el.group <= 17) {
          const base = 18 - el.group;
          const cap  = base + 4;      // e.g. S: 6, Se: 6, P: 7, As: 7
          let v = base;
          while (v < totalBO && v < cap) {
            v += 2;
          }
          atomCharge = totalBO - v;
        } else {
          atomCharge = atom.computeCharge(totalBO);
        }
        return { atom, charge: atomCharge };
      }).filter(Boolean);

      const totalComputedCharge = computedCharges.reduce((sum, entry) => sum + entry.charge, 0);
      if (totalComputedCharge !== charge) {
        continue;
      }

      for (const entry of computedCharges) {
        entry.atom.setCharge(entry.charge);
      }
    }
  }

  function applyTetrahedralStereo(mol) {
    if (tetraStereoEntries.length === 0) {
      return;
    }
    const tokenForParity = (parity) => {
      let token = parity === '-' ? '@@' : '@';
      if (inversionFlag === 1) {
        token = token === '@' ? '@@' : '@';
      }
      return token;
    };

    for (const entry of tetraStereoEntries) {
      if (entry.parity === '?') {
        continue;
      }
      const centerId = idByIndex.get(entry.atomIndex);
      const center = centerId ? mol.atoms.get(centerId) : null;
      if (!center) {
        continue;
      }

      const orderedHeavy = (connectionInfo.neighborOrders.get(entry.atomIndex) ?? [])
        .slice()
        .sort((a, b) => a - b)
        .map(idx => idByIndex.get(idx))
        .filter(Boolean);
      const hydrogenIds = center.getNeighbors(mol)
        .filter(atom => atom.name === 'H')
        .map(atom => atom.id);
      const neighborOrder = [...orderedHeavy, ...hydrogenIds];
      if (neighborOrder.length !== 4) {
        continue;
      }
      let token = tokenForParity(entry.parity);
      if (hydrogenIds.length === 0 && !center.isInRing(mol)) {
        token = token === '@' ? '@@' : '@';
      }

      center.properties.chirality = computeRS(token, neighborOrder, centerId, mol);
    }
  }

  function encodeStereoDirection(bond, centerId, dir) {
    bond.setStereo(bond.atoms[0] === centerId ? dir : (dir === '/' ? '\\' : '/'));
  }

  function applyDoubleBondStereo(mol) {
    if (doubleBondStereoEntries.length === 0) {
      return;
    }

    const pickCandidateBonds = (centerId, skipBondId) => {
      const atom = mol.atoms.get(centerId);
      if (!atom) {
        return [];
      }
      return atom.bonds
        .filter(bondId => bondId !== skipBondId)
        .map(bondId => mol.bonds.get(bondId))
        .filter(Boolean)
        .sort((a, b) => {
          const aOther = mol.atoms.get(a.getOtherAtom(centerId));
          const bOther = mol.atoms.get(b.getOtherAtom(centerId));
          const aHeavy = aOther?.name === 'H' ? 1 : 0;
          const bHeavy = bOther?.name === 'H' ? 1 : 0;
          if (aHeavy !== bHeavy) {
            return aHeavy - bHeavy;
          }
          return a.id.localeCompare(b.id);
        });
    };

    for (const entry of doubleBondStereoEntries) {
      if (entry.parity === '?') {
        continue;
      }
      const idA = idByIndex.get(entry.atomA);
      const idB = idByIndex.get(entry.atomB);
      const dbl = idA && idB ? mol.getBond(idA, idB) : null;
      if (!dbl || dbl.properties.order !== 2) {
        continue;
      }

      const target = entry.parity === '+' ? 'E' : 'Z';
      const candidatesA = pickCandidateBonds(idA, dbl.id);
      const candidatesB = pickCandidateBonds(idB, dbl.id);
      let assigned = false;

      for (const bondA of candidatesA) {
        for (const bondB of candidatesB) {
          bondA.setStereo(null);
          bondB.setStereo(null);
          for (const dirA of ['/', '\\']) {
            for (const dirB of ['/', '\\']) {
              bondA.setStereo(null);
              bondB.setStereo(null);
              encodeStereoDirection(bondA, idA, dirA);
              encodeStereoDirection(bondB, idB, dirB);
              if (mol.getEZStereo(dbl.id) === target) {
                assigned = true;
                break;
              }
            }
            if (assigned) {
              break;
            }
          }
          if (assigned) {
            break;
          }
          bondA.setStereo(null);
          bondB.setStereo(null);
        }
        if (assigned) {
          break;
        }
      }
    }
  }

  applyComponentCharges(baseMol);

  function attachHydrogens(mol, hMap) {
    for (const [idx, count] of hMap) {
      const parentId = idByIndex.get(idx);
      if (!parentId) {
        continue;
      }
      for (let i = 0; i < count; i++) {
        const hAtom = mol.addAtom(null, 'H');
        hAtom.resolveElement();
        hAtom.visible = false;
        mol.addBond(null, parentId, hAtom.id, { order: 1 }, false);
      }
    }
  }

  function correctHydrogenDeficit(mol) {
    const getRem = (atom) => {
      const el = elements[atom.name];
      if (!el) {
        return 0;
      }
      const { group } = el;
      let nv = 0;
      if (group >= 1  && group <= 2)  {
        nv = group;
      } else if (group >= 13 && group <= 17) {
        nv = 18 - group;
      }
      return nv + (atom.properties.charge ?? 0) - atom.getValence(mol);
    };

    for (let componentIdx = 0; componentIdx < componentHeavyAtomIds.length; componentIdx++) {
      const formulaHydrogens = componentHydrogenCounts[componentIdx] ?? 0;
      const atomIds = componentHeavyAtomIds[componentIdx];
      let attached = 0;
      for (const atomId of atomIds) {
        const atom = mol.atoms.get(atomId);
        if (!atom) {
          continue;
        }
        attached += atom.getHydrogenNeighbors(mol).length;
      }
      let deficit = formulaHydrogens - attached;
      while (deficit > 0) {
        const candidates = atomIds
          .map(id => mol.atoms.get(id))
          .filter(Boolean)
          .filter(a => getRem(a) > 0)
          .sort((a, b) => getRem(b) - getRem(a));
        if (candidates.length === 0) {
          break;
        }
        const atom = candidates[0];
        const hAtom = mol.addAtom(null, 'H');
        hAtom.resolveElement();
        hAtom.visible = false;
        mol.addBond(null, atom.id, hAtom.id, { order: 1 }, false);
        deficit--;
      }
      // /p layer can leave excess H when the removed proton was listed in /h.
      // Remove surplus H atoms, preferring heteroatoms (O, N, S…) over C.
      while (deficit < 0) {
        const candidates = atomIds
          .map(id => mol.atoms.get(id))
          .filter(Boolean)
          .filter(a => a.getHydrogenNeighbors(mol).length > 0)
          .sort((a, b) => {
            const aIsHetero = a.name !== 'C' ? 1 : 0;
            const bIsHetero = b.name !== 'C' ? 1 : 0;
            return bIsHetero - aIsHetero;
          });
        if (candidates.length === 0) {
          break;
        }
        const hNbs = candidates[0].getHydrogenNeighbors(mol);
        mol.removeAtom(hNbs[0].id);
        deficit++;
      }
    }
  }

  function withHydrogenMap(hMap) {
    const mol = baseMol.clone();
    attachHydrogens(mol, hMap);
    if (doInfer) {
      // Run bond-order inference BEFORE removing /p-adjusted excess H so that
      // heteroatom H atoms (e.g. phenol O-H that becomes phenolate O⁻ via /p-1)
      // are present during aromaticity detection.  correctHydrogenDeficit then
      // removes the surplus H after bonds are settled.
      inferBondOrders(mol, heavyAtomIds, componentChargeTargets.reduce((s, c) => s + c, 0));
      correctHydrogenDeficit(mol);
      assignComponentFormalCharges(mol);
    } else {
      correctHydrogenDeficit(mol);
    }
    applyTetrahedralStereo(mol);
    applyDoubleBondStereo(mol);
    return mol;
  }

  function scoreMol(mol) {
    const warnings = validateValence(mol).length;
    let chargePenalty = 0;
    for (const atomId of heavyAtomIds) {
      const atom = mol.atoms.get(atomId);
      if (!atom) {
        continue;
      }
      const totalBO = atom.bonds.reduce((sum, bondId) => {
        return sum + (mol.bonds.get(bondId)?.properties.order ?? 1);
      }, 0);
      chargePenalty += Math.abs(atom.computeCharge(totalBO) - (atom.properties.charge ?? 0));
    }
    return { warnings, chargePenalty };
  }

  function compareScores(a, b) {
    if (a.warnings !== b.warnings) {
      return a.warnings - b.warnings;
    }
    return a.chargePenalty - b.chargePenalty;
  }

  function buildHydrogenMap(assignments) {
    const hMap = new Map(hInfo.fixed);
    for (let i = 0; i < assignments.length; i++) {
      const group = hInfo.mobile[i];
      const counts = assignments[i];
      for (let j = 0; j < group.atoms.length; j++) {
        if (counts[j] > 0) {
          hMap.set(group.atoms[j], (hMap.get(group.atoms[j]) ?? 0) + counts[j]);
        }
      }
    }
    return hMap;
  }

  function mobileCapacities(group) {
    return group.atoms.map(idx => {
      const atomId = idByIndex.get(idx);
      const atom = atomId ? baseMol.atoms.get(atomId) : null;
      if (!atom) {
        return 0;
      }
      const el = elements[atom.name];
      if (!el) {
        return 0;
      }
      const { group: periodicGroup } = el;
      let nv = 0;
      if (periodicGroup >= 1 && periodicGroup <= 2) {
        nv = periodicGroup;
      } else if (periodicGroup >= 13 && periodicGroup <= 17) {
        nv = 18 - periodicGroup;
      }
      return Math.max(0, nv + (atom.properties.charge ?? 0) - atom.getValence(baseMol));
    });
  }

  function enumerateGroupAssignments(total, capacities, idx = 0, prefix = [], out = []) {
    if (idx === capacities.length - 1) {
      if (total <= capacities[idx]) {
        out.push([...prefix, total]);
      }
      return out;
    }
    const max = Math.min(total, capacities[idx]);
    for (let nHere = max; nHere >= 0; nHere--) {
      enumerateGroupAssignments(total - nHere, capacities, idx + 1, [...prefix, nHere], out);
    }
    return out;
  }

  function chooseHydrogenMap() {
    if (hInfo.mobile.length === 0) {
      return new Map(hInfo.fixed);
    }
    let bestAssignments = null;
    let bestScore = null;

    const perGroupAssignments = hInfo.mobile.map(group => {
      const capacities = mobileCapacities(group);
      const assignments = enumerateGroupAssignments(group.count, capacities);
      if (assignments.length > 0) {
        return assignments;
      }
      // Fall back to unconstrained placement if rough valence capacities were too strict.
      return enumerateGroupAssignments(group.count, new Array(group.atoms.length).fill(group.count));
    });

    function walk(groupIdx, acc) {
      if (groupIdx === perGroupAssignments.length) {
        const hMap = buildHydrogenMap(acc);
        const mol = withHydrogenMap(hMap);
        const score = scoreMol(mol);
        if (!bestScore || compareScores(score, bestScore) < 0) {
          bestScore = score;
          bestAssignments = acc.map(x => [...x]);
        }
        return;
      }
      for (const assignment of perGroupAssignments[groupIdx]) {
        acc.push(assignment);
        walk(groupIdx + 1, acc);
        acc.pop();
      }
    }

    walk(0, []);
    return buildHydrogenMap(bestAssignments ?? []);
  }

  const chosenHMap = chooseHydrogenMap();
  let mol = withHydrogenMap(chosenHMap);
  if (!addHydrogens) {
    mol = mol.stripHydrogens();
  }

  // -------------------------------------------------------------------------
  // Phase 5 — net charge from /q layer
  // -------------------------------------------------------------------------
  if (layers['q'] || layers['p']) {
    mol.properties.charge = (layers['q'] ? parseChargeLayer(layers['q']) : 0) + protonDelta;
  }

  // Recompute derived properties.
  mol.properties.formula = mol.getFormula();
  mol.properties.mass    = mol.getMass();
  if (!layers['q'] && !layers['p']) {
    mol.properties.charge = mol.getCharge();
  }
  mol.name               = mol.getName();

  return mol;
}
