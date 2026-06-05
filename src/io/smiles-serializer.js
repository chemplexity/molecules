/** @module io/smiles-serializer */

import elements from '../data/elements.js';
import { computeRS } from '../core/Molecule.js';

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
export function serializeComponent(mol, sortFn = null) {
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
        if (bId2 === dblBond.id || bId2 === sAInfo.bId) {
          return false;
        }
        return (heavy.bonds.get(bId2)?.properties.order ?? 1) === 2;
      });
      const otherB = sBInfo.b.getOtherAtom(idCanoB);
      const sBIsBridge = (heavy.atoms.get(otherB)?.bonds ?? []).some(bId2 => {
        if (bId2 === dblBond.id || bId2 === sBInfo.bId) {
          return false;
        }
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
        if (!b) {
          return Infinity;
        }
        const [a0, a1] = b.atoms;
        if (entryBond.get(a0) === bId) {
          return dfsOrder.get(a0) ?? Infinity;
        }
        if (entryBond.get(a1) === bId) {
          return dfsOrder.get(a1) ?? Infinity;
        }
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

