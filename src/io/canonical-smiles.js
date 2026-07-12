/** @module io/canonical-smiles */

import { perceiveAromaticity } from '../algorithms/aromaticity.js';
import { morganRanks } from '../algorithms/morgan.js';
import { serializeComponent } from './smiles-serializer.js';

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {void}
 */
function _normalizeNitroGroup(mol) {
  // Normalize hypervalent N(=O)=O (neutral nitro) to [N+]([O-])=O.
  // InChI always uses the charged form; normalizing here makes toCanonicalSMILES
  // produce the same string for both SMILES-parsed and InChI-parsed molecules.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N') {
      continue;
    }
    const charge = atom.properties.charge ?? 0;

    if (charge === 0) {
      // Case 1: neutral N with two double bonds to neutral monovalent O atoms.
      const dblOs = [];
      let sngNeutralO = null; // single bond to neutral terminal O (Case 3)
      for (const bondId of atom.bonds) {
        const bond = mol.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const order = bond.properties.order ?? 1;
        const o = mol.atoms.get(bond.getOtherAtom(atom.id));
        if (!o || o.name !== 'O' || (o.properties.charge ?? 0) !== 0) {
          continue;
        }
        const oHeavyDegree = o.bonds.filter(bid => {
          const b = mol.bonds.get(bid);
          return b && mol.atoms.get(b.getOtherAtom(o.id))?.name !== 'H';
        }).length;
        if (oHeavyDegree !== 1) {
          continue;
        }
        const oHCount = o.bonds.filter(bid => {
          const b = mol.bonds.get(bid);
          return b && mol.atoms.get(b.getOtherAtom(o.id))?.name === 'H';
        }).length;
        if (order === 2) {
          dblOs.push({ bond, o });
        } else if (order === 1 && oHCount === 0) {
          sngNeutralO = { bond, o };
        }
      }
      if (dblOs.length >= 2) {
        // N(=O)=O → [N+]([O-])=O
        atom.setCharge(1);
        dblOs[dblOs.length - 1].bond.properties.order = 1;
        dblOs[dblOs.length - 1].o.setCharge(-1);
      } else if (dblOs.length === 1 && sngNeutralO) {
        // Case 3: N(=O)[O] (one double, one single to neutral terminal O with no H)
        // → [N+]([O-])=O.  Arises when InChI assigns the N-oxide bond orders before
        // the charge layer places [O-]; the terminal O ends up as a neutral radical.
        atom.setCharge(1);
        sngNeutralO.o.setCharge(-1);
      } else {
        continue;
      }
    } else if (charge === -1) {
      // Case 2: inverted nitro [N-](=O)[O+] → [N+]([O-])=O.
      // InChI occasionally reconstructs the nitro group with N carrying -1 and
      // the single-bonded O carrying +1 instead of the conventional N+/O- form.
      let dblO = null;
      let sngOPlus = null;
      for (const bondId of atom.bonds) {
        const bond = mol.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const o = mol.atoms.get(bond.getOtherAtom(atom.id));
        if (!o || o.name !== 'O') {
          continue;
        }
        const oCharge = o.properties.charge ?? 0;
        const oHeavyDegree = o.bonds.filter(bid => {
          const b = mol.bonds.get(bid);
          return b && mol.atoms.get(b.getOtherAtom(o.id))?.name !== 'H';
        }).length;
        if (oHeavyDegree !== 1) {
          continue;
        }
        const order = bond.properties.order ?? 1;
        if (order === 2 && oCharge === 0) {
          dblO = { bond, o };
        } else if (order === 1 && oCharge === 1) {
          sngOPlus = { bond, o };
        }
      }
      if (!dblO || !sngOPlus) {
        continue;
      }
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
    if (atom.name !== 'C') {
      continue;
    }
    let iminiumBond = null; // [NH+]= or [N+]= (double, charge +1) — store h too
    let amineBond = null; // -NH2 (single, charge 0, 2H)
    let amineBondH1 = null; // -NH  (single, charge 0, 1H) — for Case 1b
    let chargedSingleBond = null; // [NH2+]- (single, charge +1, 2H)
    let unchainedDoubleBond = null; // =N (double, charge 0)
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const n = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!n || n.name !== 'N') {
        continue;
      }
      const order = bond.properties.order ?? 1;
      const h = n.getHydrogenNeighbors(mol).length;
      const charge = n.properties.charge ?? 0;
      if (order === 2 && charge === 1) {
        iminiumBond = { bond, n, h };
      } else if (order === 1 && h === 2 && charge === 0) {
        amineBond = { bond, n };
      } else if (order === 1 && h === 1 && charge === 0) {
        amineBondH1 = { bond, n };
      } else if (order === 1 && h === 2 && charge === 1) {
        chargedSingleBond = { bond, n };
      } else if (order === 2 && charge === 0) {
        unchainedDoubleBond = { bond, n };
      }
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
    if (atom.name !== 'C' || (atom.properties.charge ?? 0) !== -1) {
      continue;
    }
    if (atom.getHydrogenNeighbors(mol).length === 0) {
      continue;
    }
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {
        continue;
      }
      const n = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!n || n.name !== 'N' || (n.properties.charge ?? 0) !== 0) {
        continue;
      }
      if (n.getHydrogenNeighbors(mol).length === 0) {
        continue;
      }
      bond.properties.order = 2;
      atom.setCharge(0);
      n.setCharge(-1);
      break;
    }
  }
}

function _normalizeEnolateToChain(mol) {
  // InChI prefers the enolate charge on the far-end oxygen in a 1,3-dicarbonyl
  // (β-keto enolate) system — specifically, the oxygen furthest from the
  // ring/aromatic system.
  // Pattern: O_a([O-]) - C_b = C_c - C_d = O_e
  // Converts to:         O_a=C_b - C_c = C_d - O_e([O-])
  //
  // Fires when:
  //  • C_b is a ring atom OR adjacent to a ring atom (ring/aromatic context)
  //  • C_b is not aromatic (avoid breaking aromaticity)
  //  • C_c is not aromatic
  //  • C_d is not aromatic (may be in a ring — the earlier non-ring restriction
  //    was too strict; ring lactam/lactone ketones also need this normalization)
  //  • O_e is neutral (neutral carbonyl → becomes [O-] after transform)
  const rings = mol.getRings();
  const ringAtomIds = new Set(rings.flat());
  outer: for (const oA of mol.atoms.values()) {
    if (oA.name !== 'O' || (oA.properties.charge ?? 0) !== -1) {
      continue;
    }
    for (const bAB of oA.bonds) {
      const bondAB = mol.bonds.get(bAB);
      if (!bondAB || (bondAB.properties.order ?? 1) !== 1) {
        continue;
      }
      const cB = mol.atoms.get(bondAB.getOtherAtom(oA.id));
      if (!cB || cB.name !== 'C') {
        continue;
      }
      if (cB.properties.aromatic) {
        continue;
      }
      // C_b must be in a ring OR adjacent to a ring atom (i.e. it is in the
      // ring/aromatic context that InChI uses as the reference end).
      const cBNearRing =
        ringAtomIds.has(cB.id) ||
        cB.bonds.some(bId => {
          const nb = mol.bonds.get(bId);
          return nb && ringAtomIds.has(nb.getOtherAtom(cB.id));
        });
      if (!cBNearRing) {
        continue;
      }
      for (const bBC of cB.bonds) {
        if (bBC === bAB) {
          continue;
        }
        const bondBC = mol.bonds.get(bBC);
        if (!bondBC || (bondBC.properties.order ?? 1) !== 2) {
          continue;
        }
        const cC = mol.atoms.get(bondBC.getOtherAtom(cB.id));
        if (!cC || cC.name !== 'C') {
          continue;
        }
        if (cC.properties.aromatic) {
          continue;
        }
        for (const bCD of cC.bonds) {
          if (bCD === bBC) {
            continue;
          }
          const bondCD = mol.bonds.get(bCD);
          if (!bondCD || (bondCD.properties.order ?? 1) !== 1) {
            continue;
          }
          const cD = mol.atoms.get(bondCD.getOtherAtom(cC.id));
          if (!cD || cD.name !== 'C') {
            continue;
          }
          if (cD.properties.aromatic) {
            continue;
          }
          for (const bDE of cD.bonds) {
            if (bDE === bCD) {
              continue;
            }
            const bondDE = mol.bonds.get(bDE);
            if (!bondDE || (bondDE.properties.order ?? 1) !== 2) {
              continue;
            }
            const oE = mol.atoms.get(bondDE.getOtherAtom(cD.id));
            if (!oE || oE.name !== 'O' || (oE.properties.charge ?? 0) !== 0) {
              continue;
            }
            // Guard: don't fire when O_e is in a ring (aromatic O — thiophene-like)
            if (ringAtomIds.has(oE.id)) {
              continue;
            }
            // Found: O_a([O-])-C_b=C_c-C_d=O_e
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
    if (atom.name !== 'C' || (atom.properties.charge ?? 0) !== -1) {
      continue;
    }
    // Skip when [C-] is directly bonded to an NH nitrogen: InChI prefers the
    // imine tautomer ([CH-]-NH-C=O → C=[NH-]) over the enolate in that case.
    const hasNHNeighbor = atom.bonds.some(bId => {
      const b = mol.bonds.get(bId);
      if (!b) {
        return false;
      }
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      return other && other.name === 'N' && other.getHydrogenNeighbors(mol).length > 0;
    });
    if (hasNHNeighbor) {
      continue;
    }
    let found = false;
    // Extra case: [C-] in a 5-membered ring bonded (single) to N, where N has a
    // double bond to C, which has a single bond to another C that has an exocyclic
    // C=O.  Pattern: [C-]-N=C-C=O (charge on C, not N).
    // Transform: C-N=C-C=O → C=N-C=C-[O-].  bond2 (N=C) also flips 2→1 to keep N
    // trivalent.  This restores the aromatic oxazolate/oxazolone anion form.
    for (const bondId of atom.bonds) {
      if (found) {
        break;
      }
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {
        continue;
      }
      const nMid = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!nMid || nMid.name !== 'N' || (nMid.properties.charge ?? 0) !== 0) {
        continue;
      }
      if (nMid.properties.aromatic) {
        continue;
      }
      for (const bNMid of nMid.bonds) {
        if (bNMid === bondId || found) {
          continue;
        }
        const bond2 = mol.bonds.get(bNMid);
        if (!bond2 || (bond2.properties.order ?? 1) !== 2) {
          continue;
        }
        const cMidN = mol.atoms.get(bond2.getOtherAtom(nMid.id));
        if (!cMidN || cMidN.name !== 'C' || (cMidN.properties.charge ?? 0) !== 0) {
          continue;
        }
        for (const bCMid of cMidN.bonds) {
          if (bCMid === bNMid || found) {
            continue;
          }
          const bond3 = mol.bonds.get(bCMid);
          if (!bond3 || (bond3.properties.order ?? 1) !== 1) {
            continue;
          }
          const carbonyl = mol.atoms.get(bond3.getOtherAtom(cMidN.id));
          if (!carbonyl || carbonyl.name !== 'C' || (carbonyl.properties.charge ?? 0) !== 0) {
            continue;
          }
          let oBond = null,
            oAtom = null;
          for (const b4Id of carbonyl.bonds) {
            if (b4Id === bCMid) {
              continue;
            }
            const b4 = mol.bonds.get(b4Id);
            if (!b4 || (b4.properties.order ?? 1) !== 2) {
              continue;
            }
            const other = mol.atoms.get(b4.getOtherAtom(carbonyl.id));
            if (!other || other.name !== 'O' || (other.properties.charge ?? 0) !== 0) {
              continue;
            }
            // Guard: the O must not be a ring atom (avoid breaking lactone O)
            const rings = mol.getRings();
            const ringAtomIds = new Set(rings.flat());
            if (ringAtomIds.has(other.id)) {
              continue;
            }
            oBond = b4;
            oAtom = other;
            break;
          }
          if (!oBond) {
            continue;
          }
          bond.properties.order = 2; // [C-]-N: 1→2
          bond2.properties.order = 1; // N=C: 2→1
          bond3.properties.order = 2; // C-C(=O): 1→2
          oBond.properties.order = 1; // C=O: 2→1
          atom.setCharge(0);
          oAtom.setCharge(-1);
          found = true;
          break;
        }
      }
    }
    if (found) {
      continue;
    }
    for (const bondId of atom.bonds) {
      if (found) {
        break;
      }
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {
        continue;
      }
      const cMid1 = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!cMid1 || cMid1.name !== 'C') {
        continue;
      }
      // Direct case: [C-]-C=O, [C-]-C=S (thioamide anion), or [C-]-C=[N+] (iminium)
      for (const bId of cMid1.bonds) {
        if (bId === bondId) {
          continue;
        }
        const b = mol.bonds.get(bId);
        if (!b || (b.properties.order ?? 1) !== 2) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(cMid1.id));
        if (!other) {
          continue;
        }
        if (other.name === 'O' || other.name === 'S') {
          if ((other.properties.charge ?? 0) !== 0) {
            continue;
          }
          bond.properties.order = 2;
          atom.setCharge(0);
          b.properties.order = 1;
          other.setCharge(-1);
          found = true;
          break;
        }
        // [C-]-C=[N+] → C=C-N (iminium carbanion: neutralise both charges)
        if (other.name === 'N' && (other.properties.charge ?? 0) === 1 && !other.properties.aromatic) {
          bond.properties.order = 2;
          atom.setCharge(0);
          b.properties.order = 1;
          other.setCharge(0);
          found = true;
          break;
        }
      }
      if (found) {
        break;
      }
      // Vinylogous case: [C-]-(1)-Csp2-(pi)-Csp2-(1)-C=O
      const mid1Order = bond.properties.order ?? 1;
      if (mid1Order !== 1) {
        continue;
      }
      const mid1HasPi = [...cMid1.bonds].some(b2Id => {
        const b2 = mol.bonds.get(b2Id);
        return b2 && (b2.properties.order === 2 || b2.properties.order === 1.5 || b2.properties.aromatic);
      });
      if (!mid1HasPi) {
        continue;
      }
      for (const b2Id of cMid1.bonds) {
        if (b2Id === bondId || found) {
          continue;
        }
        const bond2 = mol.bonds.get(b2Id);
        if (!bond2) {
          continue;
        }
        const cMid2 = mol.atoms.get(bond2.getOtherAtom(cMid1.id));
        if (!cMid2 || cMid2.name !== 'C') {
          continue;
        }
        const mid2HasPi = [...cMid2.bonds].some(b3Id => {
          const b3 = mol.bonds.get(b3Id);
          return b3 && (b3.properties.order === 2 || b3.properties.order === 1.5 || b3.properties.aromatic);
        });
        if (!mid2HasPi) {
          continue;
        }
        for (const b3Id of cMid2.bonds) {
          if (b3Id === b2Id || found) {
            continue;
          }
          const bond3 = mol.bonds.get(b3Id);
          if (!bond3 || (bond3.properties.order ?? 1) !== 1) {
            continue;
          }
          const carbonyl = mol.atoms.get(bond3.getOtherAtom(cMid2.id));
          if (!carbonyl || carbonyl.name !== 'C') {
            continue;
          }
          let oBond = null,
            oAtom = null;
          for (const b4Id of carbonyl.bonds) {
            if (b4Id === b3Id) {
              continue;
            }
            const b4 = mol.bonds.get(b4Id);
            if (!b4 || (b4.properties.order ?? 1) !== 2) {
              continue;
            }
            const other = mol.atoms.get(b4.getOtherAtom(carbonyl.id));
            if (!other || (other.name !== 'O' && other.name !== 'S') || (other.properties.charge ?? 0) !== 0) {
              continue;
            }
            oBond = b4;
            oAtom = other;
            break;
          }
          if (!oBond) {
            continue;
          }
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

function _normalizeNitrogenAnionEnolate(mol) {
  // Convert ring [N-]-C(=O_exo) to ring N=C-[O-].
  // InChI places the negative charge on a ring nitrogen adjacent to an
  // exocyclic carbonyl carbon, instead of the standard form where the oxygen
  // carries the charge (isoxazolate, pyrazolate-3-one anions).
  // Pattern: non-aromatic N with charge=-1, single bond to a non-aromatic C
  // that has an exocyclic double bond to a neutral terminal O (not in a ring).
  // Transform: N-C: 1→2, C=O: 2→1, N: −1→0, O: 0→−1.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== -1) {
      continue;
    }
    if (atom.properties.aromatic) {
      continue;
    }
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {
        continue;
      }
      const cAtom = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!cAtom || cAtom.name !== 'C' || (cAtom.properties.charge ?? 0) !== 0) {
        continue;
      }
      if (cAtom.properties.aromatic) {
        continue;
      }
      let oBond = null,
        oAtom = null;
      for (const b2Id of cAtom.bonds) {
        if (b2Id === bondId) {
          continue;
        }
        const b2 = mol.bonds.get(b2Id);
        if (!b2 || (b2.properties.order ?? 1) !== 2) {
          continue;
        }
        const other = mol.atoms.get(b2.getOtherAtom(cAtom.id));
        if (!other || other.name !== 'O' || (other.properties.charge ?? 0) !== 0) {
          continue;
        }
        if (other.isInRing(mol)) {
          continue;
        }
        const heavyDeg = [...other.bonds].filter(bid => {
          const ob = mol.bonds.get(bid);
          return ob && mol.atoms.get(ob.getOtherAtom(other.id))?.name !== 'H';
        }).length;
        if (heavyDeg !== 1) {
          continue;
        }
        oBond = b2;
        oAtom = other;
        break;
      }
      if (!oBond) {
        continue;
      }
      bond.properties.order = 2;
      oBond.properties.order = 1;
      atom.setCharge(0);
      oAtom.setCharge(-1);
      break;
    }
  }
}

function _normalizeIsoxazolateONAnion(mol) {
  // Isoxazolate anion where O and N are adjacent in the ring (N-O bond):
  // InChI assigns [N-] to the ring nitrogen adjacent to O, and an exo C=O on
  // the ring C adjacent to O on the other side (C-O-N pattern in ring).
  // The correct enolate form has [O-] exo and an aromatic ring.
  //
  // Pattern (5-membered ring, traversal Ca-Cb-C9-O4-N2([N-])-Ca):
  //   Ca=Cb ring double bond, C9-O4-N2([N-]) chain in ring, C9 has exo C=O.
  //
  // Transform: Ca=Cb → 1, Ca-N2 → 2, Cb-C9 → 2,
  //            C9=O_exo → 1, N2: −1→0, O_exo: 0→−1.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {
      continue;
    }
    const ringSet = new Set(ring);
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a)) {
      continue;
    }
    const nMinus = atoms.find(a => a.name === 'N' && (a.properties.charge ?? 0) === -1 && !a.properties.aromatic);
    if (!nMinus) {
      continue;
    }
    // N must be adjacent to ring O (O-N bond in ring)
    let ringO = null;
    for (const bId of nMinus.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(nMinus.id));
      if (other && ringSet.has(other.id) && other.name === 'O' && !other.properties.aromatic) {
        ringO = other;
        break;
      }
    }
    if (!ringO) {
      continue;
    }
    // Find Ca (ring C adjacent to nMinus, not ringO)
    let ca = null,
      caNBond = null;
    for (const bId of nMinus.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(nMinus.id));
      if (other && ringSet.has(other.id) && other.name === 'C' && other.id !== ringO.id) {
        ca = other;
        caNBond = b;
        break;
      }
    }
    if (!ca) {
      continue;
    }
    // Ca must have an existing ring double bond to Cb (Ca=Cb, where Cb can be C or N).
    let cb = null,
      caCbBond = null;
    for (const bId of ca.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(ca.id));
      if (other && ringSet.has(other.id) && (other.name === 'C' || other.name === 'N') && other.id !== nMinus.id) {
        cb = other;
        caCbBond = b;
        break;
      }
    }
    if (!cb) {
      continue;
    }
    // Find C9 (ring C adjacent to ringO, not Ca — the C that carries the exo C=O)
    let c9 = null;
    for (const bId of ringO.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(ringO.id));
      if (other && ringSet.has(other.id) && other.name === 'C' && other.id !== ca.id) {
        c9 = other;
        break;
      }
    }
    if (!c9) {
      continue;
    }
    // Cb and C9 must be adjacent in the ring
    const cbC9Bond = mol.getBond(cb.id, c9.id);
    if (!cbC9Bond || (cbC9Bond.properties.order ?? 1) !== 1) {
      continue;
    }
    // C9 must have exo double bond to neutral terminal non-ring O
    let c9OBond = null,
      c9OAtom = null;
    for (const bId of c9.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(c9.id));
      if (!other || other.name !== 'O' || (other.properties.charge ?? 0) !== 0) {
        continue;
      }
      if (ringSet.has(other.id)) {
        continue;
      }
      const heavyDeg = [...other.bonds].filter(bid => {
        const ob = mol.bonds.get(bid);
        return ob && mol.atoms.get(ob.getOtherAtom(other.id))?.name !== 'H';
      }).length;
      if (heavyDeg !== 1) {
        continue;
      }
      c9OBond = b;
      c9OAtom = other;
      break;
    }
    if (!c9OBond) {
      continue;
    }
    caCbBond.properties.order = 1;
    caNBond.properties.order = 2;
    cbC9Bond.properties.order = 2;
    c9OBond.properties.order = 1;
    nMinus.setCharge(0);
    c9OAtom.setCharge(-1);
  }
}

function _normalizeAmidinoHydroximateAnion(mol) {
  // Amidine-hydroxamate anion normalization:
  //   C(=[N-H]-aro)(-N=O)  →  C(=N-[O-])(-NH-aro)
  // InChI places [N-] (with H and aromatic-ring bond) on the imino N and
  // has N=O on the adjacent amide N. The canonical form has [O-] on the
  // N-oxide oxygen and the NH is on the amino N bonded to the aromatic ring.
  // Transform: bond C=N1 (2→1), bond C-N2 (1→2), bond N2=O (2→1),
  //            N1 charge (-1→0), O charge (0→-1).
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== -1) {
      continue;
    }
    if (atom.properties.aromatic) {
      continue;
    }
    // N1 must have: H bond, aromatic ring bond, and double bond to C
    const hasH = [...atom.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(atom.id))?.name === 'H';
    });
    if (!hasH) {
      continue;
    }
    const hasAro = [...atom.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(atom.id))?.properties?.aromatic;
    });
    if (!hasAro) {
      continue;
    }
    // Find the double bond to a chain C (Cm)
    let n1cBond = null,
      cm = null;
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {
        continue;
      }
      const c = mol.atoms.get(b.getOtherAtom(atom.id));
      if (!c || c.name !== 'C' || (c.properties.charge ?? 0) !== 0) {
        continue;
      }
      if (c.properties.aromatic) {
        continue;
      }
      n1cBond = b;
      cm = c;
      break;
    }
    if (!cm) {
      continue;
    }
    // Cm must have a single bond to another N (N2) which has a double bond to terminal O
    let cmN2Bond = null,
      n2 = null,
      n2oBond = null,
      oAtom = null;
    for (const bId of cm.bonds) {
      if (bId === n1cBond.id) {
        continue;
      }
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 1) {
        continue;
      }
      const nb = mol.atoms.get(b.getOtherAtom(cm.id));
      if (!nb || nb.name !== 'N' || (nb.properties.charge ?? 0) !== 0) {
        continue;
      }
      if (nb.properties.aromatic) {
        continue;
      }
      // Find N2=O terminal
      for (const nbId of nb.bonds) {
        if (nbId === bId) {
          continue;
        }
        const nb2 = mol.bonds.get(nbId);
        if (!nb2 || (nb2.properties.order ?? 1) !== 2) {
          continue;
        }
        const oa = mol.atoms.get(nb2.getOtherAtom(nb.id));
        if (!oa || oa.name !== 'O' || (oa.properties.charge ?? 0) !== 0) {
          continue;
        }
        const oHeavy = [...oa.bonds].filter(bid => {
          const ob = mol.bonds.get(bid);
          return ob && mol.atoms.get(ob.getOtherAtom(oa.id))?.name !== 'H';
        }).length;
        if (oHeavy !== 1) {
          continue;
        }
        cmN2Bond = b;
        n2 = nb;
        n2oBond = nb2;
        oAtom = oa;
        break;
      }
      if (n2) {
        break;
      }
    }
    if (!n2) {
      continue;
    }
    n1cBond.properties.order = 1;
    cmN2Bond.properties.order = 2;
    n2oBond.properties.order = 1;
    atom.setCharge(0);
    oAtom.setCharge(-1);
    break;
  }
}

function _normalizeEnolateNoxide(mol) {
  // Convert enolate-Noxide form to keto-hydroxamate form:
  //   C=C-N=O + [O-] on enolate C  →  C(=O)-C=N-[O-]
  // InChI represents some hydroxamate anions as the enolate tautomer where
  // the negative charge is on the alpha-carbon [O-] and the N has an N=O
  // (N-oxide) bond. The canonical SMILES form has the ketone C=O and the
  // hydroxamate N=C-[O-].
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'O' || (atom.properties.charge ?? 0) !== -1) {
      continue;
    }
    if (atom.properties.aromatic) {
      continue;
    }
    const heavyBonds = [...atom.bonds].filter(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(atom.id))?.name !== 'H';
    });
    if (heavyBonds.length !== 1) {
      continue;
    }
    const c6Bond = mol.bonds.get(heavyBonds[0]);
    if (!c6Bond || (c6Bond.properties.order ?? 1) !== 1) {
      continue;
    }
    const c6 = mol.atoms.get(c6Bond.getOtherAtom(atom.id));
    if (!c6 || c6.name !== 'C' || (c6.properties.charge ?? 0) !== 0 || c6.properties.aromatic) {
      continue;
    }
    let c6cMidBond = null,
      cMid = null;
    for (const bId of c6.bonds) {
      if (bId === heavyBonds[0]) {
        continue;
      }
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(c6.id));
      if (!other || other.name !== 'C' || (other.properties.charge ?? 0) !== 0 || other.properties.aromatic) {
        continue;
      }
      c6cMidBond = b;
      cMid = other;
      break;
    }
    if (!c6cMidBond || !cMid) {
      continue;
    }
    let cMidNBond = null,
      nAtom = null,
      nOBond = null,
      nOAtom = null;
    for (const bId of cMid.bonds) {
      if (bId === c6cMidBond.id) {
        continue;
      }
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 1) {
        continue;
      }
      const n = mol.atoms.get(b.getOtherAtom(cMid.id));
      if (!n || n.name !== 'N' || (n.properties.charge ?? 0) !== 0 || n.properties.aromatic) {
        continue;
      }
      for (const nbId of n.bonds) {
        if (nbId === bId) {
          continue;
        }
        const nb = mol.bonds.get(nbId);
        if (!nb || (nb.properties.order ?? 1) !== 2) {
          continue;
        }
        const o = mol.atoms.get(nb.getOtherAtom(n.id));
        if (!o || o.name !== 'O' || (o.properties.charge ?? 0) !== 0) {
          continue;
        }
        const oHeavy = [...o.bonds].filter(bid => {
          const ob = mol.bonds.get(bid);
          return ob && mol.atoms.get(ob.getOtherAtom(o.id))?.name !== 'H';
        }).length;
        if (oHeavy !== 1) {
          continue;
        }
        cMidNBond = b;
        nAtom = n;
        nOBond = nb;
        nOAtom = o;
        break;
      }
      if (nAtom) {
        break;
      }
    }
    if (!nAtom) {
      continue;
    }
    c6Bond.properties.order = 2;
    atom.setCharge(0);
    c6cMidBond.properties.order = 1;
    cMidNBond.properties.order = 2;
    nOBond.properties.order = 1;
    nOAtom.setCharge(-1);
    break;
  }
}

function _normalizePolysulfideAnion(mol) {
  // Convert =[S-]-S-... to [S-]-S-... for polysulfide anions. InChI sometimes
  // represents the terminus as a neutral S double-bonded to an inner [S-],
  // but the standard notation uses terminal [S-] with single bonds only.
  // For each [S-] that has a double bond to a terminal neutral S, transfer the
  // charge to the terminal S and demote the double bond to single.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'S' || (atom.properties.charge ?? 0) !== -1) {
      continue;
    }
    if (atom.properties.aromatic) {
      continue;
    }
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (!other || other.name !== 'S' || (other.properties.charge ?? 0) !== 0) {
        continue;
      }
      const otherHeavy = [...other.bonds].filter(bId2 => {
        const b2 = mol.bonds.get(bId2);
        return b2 && mol.atoms.get(b2.getOtherAtom(other.id))?.name !== 'H';
      }).length;
      if (otherHeavy !== 1) {
        continue;
      }
      b.properties.order = 1;
      atom.setCharge(0);
      other.setCharge(-1);
      break;
    }
  }
}

function _normalizeThioate(mol) {
  // Normalize C([O-])=S to C(=O)[S-]. InChI places thioate charge on sulfur;
  // this ensures toCanonicalSMILES agrees regardless of which resonance form was stored.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C') {
      continue;
    }
    let oBond = null,
      oAtom = null,
      sBond = null,
      sAtom = null;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other) {
        continue;
      }
      const order = bond.properties.order ?? 1;
      if (other.name === 'O' && (other.properties.charge ?? 0) === -1 && order === 1) {
        oBond = bond;
        oAtom = other;
      } else if (other.name === 'S' && (other.properties.charge ?? 0) === 0 && order === 2) {
        sBond = bond;
        sAtom = other;
      }
    }
    if (!oBond || !sBond) {
      continue;
    }
    oBond.properties.order = 2;
    oAtom.setCharge(0);
    sBond.properties.order = 1;
    sAtom.setCharge(-1);
  }
}

function _normalizeOximateAnion(mol) {
  // Normalize C(=N[O-]) to [C-](N=O). InChI writes aldoximate/ketoximate anions
  // as nitroso carbanions ([C-]-N=O) rather than the C=N-O- oximate form.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N') {
      continue;
    }
    if ((atom.properties.charge ?? 0) !== 0) {
      continue;
    }
    let cBond = null,
      cAtom = null,
      oBond = null,
      oAtom = null;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other) {
        continue;
      }
      const order = bond.properties.order ?? 1;
      if (other.name === 'C' && order === 2 && (other.properties.charge ?? 0) === 0) {
        cBond = bond;
        cAtom = other;
      } else if (other.name === 'O' && order === 1 && (other.properties.charge ?? 0) === -1) {
        oBond = bond;
        oAtom = other;
      }
    }
    if (!cBond || !oBond) {
      continue;
    }
    // N must have exactly these two heavy-atom bonds (no additional substituents).
    if (atom.bonds.length !== 2) {
      continue;
    }
    // O must be terminal (no other heavy bonds).
    if (oAtom.bonds.length !== 1) {
      continue;
    }
    cBond.properties.order = 1;
    cAtom.setCharge(-1);
    oBond.properties.order = 2;
    oAtom.setCharge(0);
  }
}

function _normalizeAmidineAnion(mol) {
  // Normalize [N-]-C=N (exo anion) to N=C-[N-] (ring anion) in amidine-like systems.
  // InChI places the negative charge on the ring nitrogen when one N is cyclic.
  // Mirrors the cation normalization in _normalizeAmidiniumResonance.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C') {
      continue;
    }
    let anionBond = null,
      anionN = null,
      imineBond = null,
      imineN = null;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other || other.name !== 'N') {
        continue;
      }
      const order = bond.properties.order ?? 1;
      const charge = other.properties.charge ?? 0;
      if (order === 1 && charge === -1) {
        anionBond = bond;
        anionN = other;
      } else if (order === 2 && charge === 0) {
        imineBond = bond;
        imineN = other;
      }
    }
    if (!anionBond || !imineBond) {
      continue;
    }
    // Check if imineN (the one with double bond) is in a ring with atom.
    // If so, InChI prefers the charge on imineN → swap.
    const seen = new Set([atom.id]);
    const queue = [imineN.id];
    seen.add(imineN.id);
    let inRing = false;
    while (queue.length > 0 && !inRing) {
      const cur = queue.shift();
      for (const bId of mol.atoms.get(cur).bonds) {
        if (bId === imineBond.id) {
          continue;
        }
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const next = b.getOtherAtom(cur);
        if (next === atom.id) {
          inRing = true;
          break;
        }
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (!inRing) {
      continue;
    }
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
    if (atom.name !== 'N') {
      continue;
    }
    if ((atom.properties.charge ?? 0) !== 1) {
      continue;
    }
    const hCount = atom.getHydrogenNeighbors(mol).length;
    if (hCount < 2) {
      continue;
    } // must be [NH2+]

    // Find double-bonded ring-C
    let dblBond = null,
      dblC = null;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {
        continue;
      }
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other || other.name !== 'C') {
        continue;
      }
      dblBond = bond;
      dblC = other;
      break;
    }
    if (!dblC) {
      continue;
    }

    // Find a ring N adjacent to dblC that is in the same ring as dblC
    // (i.e., removing the dblC-ringN bond still connects them via a ring path).
    // Prefer N atoms that do NOT already have a ring double bond, so that adding
    // the new ringN=dblC double bond does not create an over-bonded N (which
    // would break the Kekulé alternating pattern for aromaticity detection).
    let ringN = null,
      ringNBondId = null;
    let ringNFallback = null,
      ringNBondIdFallback = null;
    for (const bondId of dblC.bonds) {
      if (bondId === dblBond.id) {
        continue;
      }
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const other = mol.atoms.get(bond.getOtherAtom(dblC.id));
      if (!other || other.name !== 'N' || (other.properties.charge ?? 0) !== 0) {
        continue;
      }
      // BFS to check if dblC and other are still connected without this bond
      const seen = new Set([dblC.id]);
      const q = [other.id];
      seen.add(other.id);
      let found = false;
      while (q.length > 0 && !found) {
        const cur = q.shift();
        for (const bId of mol.atoms.get(cur).bonds) {
          if (bId === bondId) {
            continue;
          } // skip the direct bond we're testing
          const b = mol.bonds.get(bId);
          if (!b) {
            continue;
          }
          const next = b.getOtherAtom(cur);
          if (next === dblC.id) {
            found = true;
            break;
          }
          if (!seen.has(next)) {
            seen.add(next);
            q.push(next);
          }
        }
      }
      if (!found) {
        continue;
      }
      // Check if this N already has a double bond (ring or exo).
      // If it does, save as fallback and keep looking for a better candidate
      // (one with no existing double bond is preferred to avoid over-bonding).
      const hasExistingDbl = other.bonds.some(bId2 => {
        if (bId2 === bondId) {
          return false;
        }
        const b2 = mol.bonds.get(bId2);
        return b2 && (b2.properties.order ?? 1) === 2;
      });
      if (!hasExistingDbl) {
        ringN = other;
        ringNBondId = bondId;
        break;
      } else if (!ringNFallback) {
        ringNFallback = other;
        ringNBondIdFallback = bondId;
      }
    }
    // If no ideal (no-double-bond) candidate found, use fallback
    if (!ringN && ringNFallback) {
      ringN = ringNFallback;
      ringNBondId = ringNBondIdFallback;
    }
    if (!ringN) {
      // Non-adjacent ring N: find a ring through dblC containing a neutral N,
      // then do the charge transfer and reassign all ring bonds to alternating
      // Kekulé orders so perceiveAromaticity can aromatize the ring.
      const allRings = mol.getRings();
      let nonAdjRing = null,
        nonAdjRingN = null;
      for (const ring of allRings) {
        if (!ring.includes(dblC.id)) {
          continue;
        }
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
        if (nid) {
          nonAdjRing = ring;
          nonAdjRingN = mol.atoms.get(nid);
          break;
        }
      }
      if (!nonAdjRingN) {
        continue;
      }
      // Verify ring has existing pi character (at least one ring-internal double bond)
      const ringSet = new Set(nonAdjRing);
      const rHasPi = nonAdjRing.some(id =>
        mol.atoms.get(id).bonds.some(bId => {
          if (bId === dblBond.id) {
            return false;
          }
          const b = mol.bonds.get(bId);
          return b && (b.properties.order ?? 1) === 2 && ringSet.has(b.getOtherAtom(id));
        })
      );
      if (!rHasPi) {
        continue;
      }
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
          if (b && b.getOtherAtom(aId) === bId) {
            return b;
          }
        }
        return null;
      };
      const chg = ord =>
        ord.reduce((n, id, i) => {
          const b = getBond(id, ord[(i + 1) % ord.length]);
          return n + (b && (b.properties.order ?? 1) !== (i % 2 === 0 ? 2 : 1) ? 1 : 0);
        }, 0);
      const dir = chg(ordered) <= chg(orderedB) ? ordered : orderedB;
      for (let i = 0; i < dir.length; i++) {
        const b = getBond(dir[i], dir[(i + 1) % dir.length]);
        if (b) {
          b.properties.order = i % 2 === 0 ? 2 : 1;
        }
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
          if (bId === ringNBondId || bId === dblBond.id) {
            continue;
          }
          const b = mol.bonds.get(bId);
          if (!b) {
            continue;
          }
          const next = b.getOtherAtom(cur);
          if (next === dblC.id) {
            parent.set(next, cur);
            foundPath = true;
            break outer2;
          }
          if (!parent.has(next)) {
            parent.set(next, cur);
            q.push(next);
          }
        }
      }
      if (!foundPath) {
        return false;
      }
      // Collect ring atoms from the path
      const ringAtoms = new Set([dblC.id, ringN.id]);
      let cur = dblC.id;
      while (parent.get(cur) !== null) {
        cur = parent.get(cur);
        ringAtoms.add(cur);
      }
      // Check for any double bond between two ring atoms
      return [...ringAtoms].some(id =>
        mol.atoms.get(id).bonds.some(bId => {
          if (bId === dblBond.id || bId === ringNBondId) {
            return false;
          }
          const b = mol.bonds.get(bId);
          if (!b || (b.properties.order ?? 1) !== 2) {
            return false;
          }
          return ringAtoms.has(b.getOtherAtom(id));
        })
      );
    })();
    if (!hasRingPi) {
      continue;
    }

    // Transfer: C=[NH2+] → C-NH2, ring-N → [N+], ring-N=C bond → double
    // (ring-N=dblC gives N+ a ring pi bond so perceiveAromaticity succeeds)
    dblBond.properties.order = 1;
    atom.setCharge(0);
    ringN.setCharge(1);
    mol.bonds.get(ringNBondId).properties.order = 2;
    // Remove any existing ring double bond from C adjacent to new N=C to avoid
    // over-bonding: the old C2=C3 (if adjacent to dblC) should become single.
    for (const bondId of dblC.bonds) {
      if (bondId === ringNBondId) {
        continue;
      }
      const bond = mol.bonds.get(bondId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {
        continue;
      }
      const otherId = bond.getOtherAtom(dblC.id);
      if (!otherId) {
        continue;
      }
      const other = mol.atoms.get(otherId);
      if (!other || other.name === 'N' || other.name === 'S' || other.name === 'O') {
        continue;
      }
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
    if (satom.name !== 'S' || (satom.properties.charge ?? 0) !== -1) {
      continue;
    }
    // Find C bonded to S (the thioamide exo-C)
    let exoC = null,
      exoCBond = null;
    for (const bId of satom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const o = mol.atoms.get(b.getOtherAtom(sid));
      if (o?.name === 'C') {
        exoC = o;
        exoCBond = b;
        break;
      }
    }
    if (!exoC) {
      continue;
    }
    // exoC must have an amino N substituent
    const hasAmino = exoC.bonds.some(bId => {
      const b = mol.bonds.get(bId);
      const o = b && mol.atoms.get(b.getOtherAtom(exoC.id));
      return o?.name === 'N';
    });
    if (!hasAmino) {
      continue;
    }
    // Find double bond from exoC to a ring atom (ringC)
    let ringC = null,
      ringCBond = null;
    const allRings = mol.getRings();
    for (const bId of exoC.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 2) {
        continue;
      }
      const o = mol.atoms.get(b.getOtherAtom(exoC.id));
      if (!o || o.name !== 'C') {
        continue;
      }
      if (allRings.some(r => r.includes(o.id))) {
        ringC = o;
        ringCBond = b;
        break;
      }
    }
    if (!ringC) {
      continue;
    }
    // Find ring containing ringC with a neutral N
    let targetRing = null,
      targetN = null;
    for (const ring of allRings) {
      if (!ring.includes(ringC.id)) {
        continue;
      }
      const nid = ring.find(id => {
        const a = mol.atoms.get(id);
        return a?.name === 'N' && (a.properties.charge ?? 0) === 0;
      });
      if (nid) {
        targetRing = ring;
        targetN = mol.atoms.get(nid);
        break;
      }
    }
    if (!targetN) {
      continue;
    }
    // Verify ring has existing pi character
    const ringSet = new Set(targetRing);
    const hasPi = targetRing.some(id =>
      mol.atoms.get(id).bonds.some(bId => {
        const b = mol.bonds.get(bId);
        return b && (b.properties.order ?? 1) === 2 && ringSet.has(b.getOtherAtom(id));
      })
    );
    if (!hasPi) {
      continue;
    }
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
    const dir = nIdxA >= nIdxB ? ordered : orderedB;
    const N = dir.length;
    const getBond = (aId, bId) => {
      for (const bid of mol.atoms.get(aId).bonds) {
        const b = mol.bonds.get(bid);
        if (b && b.getOtherAtom(aId) === bId) {
          return b;
        }
      }
      return null;
    };
    for (let i = 0; i < N; i++) {
      const b = getBond(dir[i], dir[(i + 1) % N]);
      if (b) {
        b.properties.order = i % 2 === 0 && i !== N - 1 ? 2 : 1;
      }
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
            if (hCount >= 2) {
              return false;
            }
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

      // Skip if any non-aromatic carbon in the path has 2+ H neighbors — such
      // an atom is sp3 and cannot participate in ring aromaticity (CH2 bridges
      // connect rings but are never aromatic).
      const hasSp3Carbon = [...pathAtomSet].some(vid => {
        if (vid === id) {
          return false;
        }
        const va = mol.atoms.get(vid);
        if (!va || va.properties.aromatic || va.name !== 'C') {
          return false;
        }
        const hCount = [...va.bonds].filter(bId => {
          const b = mol.bonds.get(bId);
          return b && mol.atoms.get(b.getOtherAtom(vid))?.name === 'H';
        }).length;
        return hCount >= 2;
      });
      if (hasSp3Carbon) {
        continue;
      }

      bond.properties.order = 1.5;
      bond.properties.aromatic = true;
      for (const ringBId of ringBondIds) {
        const rb = mol.bonds.get(ringBId);
        if (rb) {
          rb.properties.order = 1.5;
          rb.properties.aromatic = true;
        }
      }
    }
  }
}

function _normalizeIsocyanide(mol) {
  // Convert R[N+]#[C-] (and R[N+]#C) to R[N]=C. InChI writes isocyanide groups
  // as double bonds: the terminal carbenoid C has no implicit H and no charge,
  // while the N loses its formal positive charge.
  // When [N+]#C (neutral terminal C, no C- to cancel N+) is converted, the
  // net positive charge decreases.  Compensate by:
  //   1. Reducing a nearby N with charge ≥ 2 (e.g. [N+2] from over-assignment).
  //   2. If no such N exists and the molecule's net charge has dropped to 0,
  //      give the terminal C a +1 charge — matching InChI's [CH+]=N form for
  //      molecules whose only positive charge was the isocyanide N+.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 1) {
      continue;
    }
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 3) {
        continue;
      }
      const c = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!c || c.name !== 'C') {
        continue;
      }
      const cHeavyBonds = [...c.bonds].filter(b2Id => {
        const other = mol.atoms.get(mol.bonds.get(b2Id).getOtherAtom(c.id));
        return other && other.name !== 'H';
      });
      if (cHeavyBonds.length !== 1) {
        continue;
      }
      bond.properties.order = 2;
      atom.setCharge(0);
      const hadCMinus = (c.properties.charge ?? 0) !== 0;
      if (hadCMinus) {
        c.setCharge(0);
        continue;
      }
      // C was neutral. First try to drain an overcharged N (e.g. [N+2]).
      let drained = false;
      for (const [, a] of mol.atoms) {
        if (a.name === 'N' && (a.properties.charge ?? 0) >= 2) {
          a.setCharge((a.properties.charge ?? 0) - 1);
          drained = true;
          break;
        }
      }
      if (drained) {
        continue;
      }
      // No N≥2 to drain. If the molecule's net charge is now 0 (isocyanide N+
      // was the only positive charge), give C +1 to match InChI's [CH+]=N form.
      let netCharge = 0;
      for (const [, a] of mol.atoms) {
        netCharge += a.properties.charge ?? 0;
      }
      if (netCharge === 0) {
        c.setCharge(1);
      }
    }
  }
}

function _normalizeAzideDiazonium(mol) {
  // Convert [N+]#N=N to [N+]-N=N. InChI normalizes the cumulated diazonium
  // azide chain by reducing the triple bond to a single bond. Detect: N with
  // charge +1 that has a triple bond to a neutral N which in turn has a double
  // bond to another neutral N, then lower the triple bond to 1.
  //
  // Also convert C-N=N (radical C adjacent to diazo) to C=[N+]=N. InChI
  // sometimes represents diazonium `C=[N+]=N` as a radical `[C]-N=N` where the
  // C has remaining=1 (undervalent). Promote the C-N single bond to double and
  // add +1 to the inner N, restoring the canonical diazonium form.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'C' || (atom.properties.charge ?? 0) !== 0) {
      continue;
    }
    if (atom.properties.aromatic) {
      continue;
    }
    // C must not be in a ring (only chain carbons form diazonium)
    if (atom.isInRing(mol)) {
      continue;
    }
    // C must have remaining = 1 (exactly one undervalent bond)
    const cValence = atom.bonds.reduce((s, bId) => {
      const b = mol.bonds.get(bId);
      return s + (b?.properties?.order ?? 1);
    }, 0);
    if (4 - cValence !== 1) {
      continue;
    } // remaining must be exactly 1
    // Find C-N single bond where N is the inner diazo N
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || (b.properties.order ?? 1) !== 1) {
        continue;
      }
      const nInner = mol.atoms.get(b.getOtherAtom(atom.id));
      if (!nInner || nInner.name !== 'N' || (nInner.properties.charge ?? 0) !== 0) {
        continue;
      }
      if (nInner.properties.aromatic) {
        continue;
      }
      // Inner N must have exactly 1 double bond to a terminal N
      let termN = null;
      for (const b2Id of nInner.bonds) {
        if (b2Id === bId) {
          continue;
        }
        const b2 = mol.bonds.get(b2Id);
        if (!b2 || (b2.properties.order ?? 1) !== 2) {
          continue;
        }
        const nt = mol.atoms.get(b2.getOtherAtom(nInner.id));
        if (!nt || nt.name !== 'N' || (nt.properties.charge ?? 0) !== 0) {
          continue;
        }
        // Terminal N: exactly 1 heavy bond (to inner N), no H
        const ntHeavy = [...nt.bonds].filter(b3Id => {
          const b3 = mol.bonds.get(b3Id);
          return b3 && mol.atoms.get(b3.getOtherAtom(nt.id))?.name !== 'H';
        }).length;
        if (ntHeavy !== 1) {
          continue;
        }
        termN = nt;
        break;
      }
      if (!termN) {
        continue;
      }
      // Inner N must have no other heavy bonds besides C and terminal N
      const nInnerHeavy = [...nInner.bonds].filter(b2Id => {
        const b2 = mol.bonds.get(b2Id);
        return b2 && mol.atoms.get(b2.getOtherAtom(nInner.id))?.name !== 'H';
      }).length;
      if (nInnerHeavy !== 2) {
        continue;
      }
      // Promote C-N to C=N, inner N gets +1
      b.properties.order = 2;
      nInner.setCharge(1);
      // After promoting C=N+, the adjacent chain C may have a carboxylate with a
      // neutral O radical ([O]) instead of [O-]. Give it the -1 charge to balance.
      for (const adjBId of atom.bonds) {
        const adjB = mol.bonds.get(adjBId);
        if (!adjB || (adjB.properties.order ?? 1) !== 1) {
          continue;
        }
        const adjC = mol.atoms.get(adjB.getOtherAtom(atom.id));
        if (!adjC || adjC.name !== 'C' || (adjC.properties.charge ?? 0) !== 0) {
          continue;
        }
        for (const cBId of adjC.bonds) {
          const cB = mol.bonds.get(cBId);
          if (!cB || (cB.properties.order ?? 1) !== 1) {
            continue;
          }
          const oAtom = mol.atoms.get(cB.getOtherAtom(adjC.id));
          if (!oAtom || oAtom.name !== 'O' || (oAtom.properties.charge ?? 0) !== 0) {
            continue;
          }
          const oHeavy = [...oAtom.bonds].filter(obId => {
            const ob = mol.bonds.get(obId);
            return ob && mol.atoms.get(ob.getOtherAtom(oAtom.id))?.name !== 'H';
          }).length;
          if (oHeavy !== 1) {
            continue;
          }
          // Check that adjC also has a =O (double bond to another O)
          const hasDoubleO = [...adjC.bonds].some(cBId2 => {
            const cB2 = mol.bonds.get(cBId2);
            if (!cB2 || (cB2.properties.order ?? 1) !== 2) {
              return false;
            }
            const oa2 = mol.atoms.get(cB2.getOtherAtom(adjC.id));
            return oa2 && oa2.name === 'O';
          });
          if (hasDoubleO) {
            oAtom.setCharge(-1);
          }
        }
      }
      break;
    }
  }
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 1) {
      continue;
    }
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 3) {
        continue;
      }
      const n2 = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!n2 || n2.name !== 'N' || (n2.properties.charge ?? 0) !== 0) {
        continue;
      }
      const hasDoubleBondToN = [...n2.bonds].some(b2Id => {
        const b2 = mol.bonds.get(b2Id);
        if (!b2 || (b2.properties.order ?? 1) !== 2) {
          return false;
        }
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
          if (!b2) {
            return false;
          }
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
    if (!groupEleven.has(atom.name)) {
      continue;
    }
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
    if (atom.name !== 'Ti') {
      continue;
    }
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 1) {
        continue;
      }
      const o = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!o || o.name !== 'O' || (o.properties.charge ?? 0) !== 0) {
        continue;
      }
      // Confirm O is monovalent: exactly one heavy-atom bond (to Ti)
      const oHeavy = [...o.bonds].filter(obId => {
        const ob = mol.bonds.get(obId);
        if (!ob) {
          return false;
        }
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
  const transitionMetals = new Set(['Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'La', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt']);
  for (const [, atom] of mol.atoms) {
    if (!transitionMetals.has(atom.name)) {
      continue;
    }
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond) {
        continue;
      }
      const bondOrder = bond.properties.order ?? 1;
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other) {
        continue;
      }
      if (bondOrder === 2 && other.name === 'Si') {
        // Always downgrade M=Si to M-Si.
        bond.properties.order = 1;
      } else if (bondOrder === 2 && other.name === 'C' && !other.properties.aromatic) {
        // For carbene-type M=C: downgrade only when the C has no other pi bonds
        // (guards against M=C=O ketene-type ligands where C already has C=O).
        let hasOtherPiBond = false;
        for (const obId of other.bonds) {
          if (obId === bId) {
            continue;
          }
          const ob = mol.bonds.get(obId);
          if (ob && (ob.properties.order ?? 1) >= 2) {
            hasOtherPiBond = true;
            break;
          }
        }
        if (!hasOtherPiBond) {
          bond.properties.order = 1;
        }
      } else if (bondOrder === 1 && other.name === 'C' && !other.properties.aromatic) {
        // For M-C≡O (carbonyl ligand): when the C is singly bonded to M and
        // triply bonded to O, InChI downgrades C#O to C=O making C a radical.
        for (const obId of other.bonds) {
          if (obId === bId) {
            continue;
          }
          const ob = mol.bonds.get(obId);
          if (!ob || (ob.properties.order ?? 1) !== 3) {
            continue;
          }
          const oAtom = mol.atoms.get(ob.getOtherAtom(other.id));
          if (!oAtom || oAtom.name !== 'O') {
            continue;
          }
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
    if (atom.name !== 'B') {
      continue;
    }
    for (const bId of atom.bonds) {
      const bBond = mol.bonds.get(bId);
      if (!bBond || (bBond.properties.order ?? 1) !== 2) {
        continue;
      }
      const cAtom = mol.atoms.get(bBond.getOtherAtom(atom.id));
      if (!cAtom || cAtom.name !== 'C') {
        continue;
      }
      // Look for a monovalent O on the C (single bond, neutral, no H, 1 heavy bond)
      let oBond = null;
      for (const cBId of cAtom.bonds) {
        if (cBId === bId) {
          continue;
        }
        const cb = mol.bonds.get(cBId);
        if (!cb || (cb.properties.order ?? 1) !== 1) {
          continue;
        }
        const o = mol.atoms.get(cb.getOtherAtom(cAtom.id));
        if (!o || o.name !== 'O' || (o.properties.charge ?? 0) !== 0) {
          continue;
        }
        // Confirm O is monovalent: only this one heavy-atom bond
        const oHeavy = [...o.bonds].filter(obId => {
          const ob = mol.bonds.get(obId);
          if (!ob) {
            return false;
          }
          const nb = mol.atoms.get(ob.getOtherAtom(o.id));
          return nb && nb.name !== 'H';
        });
        if (oHeavy.length === 1) {
          oBond = cb;
          break;
        }
      }
      if (!oBond) {
        continue;
      }
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
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 0) {
      continue;
    }
    let cBond = null,
      cAtom = null,
      oBond = null;
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {
        continue;
      }
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!other) {
        continue;
      }
      if (other.name === 'O' && (other.properties.charge ?? 0) === 0 && !oBond) {
        oBond = bond;
      } else if (other.name === 'C' && (other.properties.charge ?? 0) === 0 && !cBond) {
        cBond = bond;
        cAtom = other;
      }
    }
    if (!cBond || !oBond) {
      continue;
    }
    cBond.properties.order = 1;
    atom.setCharge(1);
    cAtom.setCharge(-1);
  }
}

function _normalizeFuroxan(mol) {
  // Convert aromatic N-oxide heterocyclic rings to the Kekulé form InChI uses.
  // Handles two ring compositions:
  //   - Furoxan (1,2,5-oxadiazole-2-oxide): ring 2C, 2N, 1O; N+ exo O-
  //   - Triazolium N-oxide (e.g. 1,2,3-triazolium): ring 2C, 3N; N+ exo O-
  // Both have aromatic input from SMILES but InChI writes them as non-aromatic
  // with C=C double bond, N+(=O) dative, and the adjacent neutral ring N → N-.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {
      continue;
    }
    const ringSet = new Set(ring);
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const cs = atoms.filter(a => a.name === 'C');
    const ns = atoms.filter(a => a.name === 'N');
    const os = atoms.filter(a => a.name === 'O');
    // Furoxan: 2C + 2N + 1O; or Triazolium N-oxide: 2C + 3N + 0O
    const isFuroxan = cs.length === 2 && ns.length === 2 && os.length === 1;
    const isTriazoliumNOxide = cs.length === 2 && ns.length === 3 && os.length === 0;
    if (!isFuroxan && !isTriazoliumNOxide) {
      continue;
    }
    const nPos = ns.find(a => (a.properties.charge ?? 0) === 1);
    const nNeg = ns.find(a => (a.properties.charge ?? 0) === 0);
    if (!nPos || !nNeg) {
      continue;
    }
    let exoO = null;
    for (const bId of nPos.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(nPos.id));
      if (!other || ringSet.has(other.id)) {
        continue;
      }
      if (other.name === 'O' && (other.properties.charge ?? 0) === -1) {
        exoO = { bond: b, atom: other };
        break;
      }
    }
    if (!exoO) {
      continue;
    }
    // For triazolium N-oxide: the neutral N that becomes N- must be the one
    // directly bonded to N+ in the ring AND having no exocyclic heavy atoms.
    let nToCharge = nNeg;
    if (isTriazoliumNOxide) {
      const nNegCandidates = ns.filter(a => (a.properties.charge ?? 0) === 0);
      const nPosRingNeighbors = new Set(
        nPos.bonds
          .map(bId => mol.bonds.get(bId))
          .filter(b => b && ringSet.has(b.getOtherAtom(nPos.id)))
          .map(b => b.getOtherAtom(nPos.id))
      );
      nToCharge =
        nNegCandidates.find(
          a =>
            nPosRingNeighbors.has(a.id) &&
            a.bonds.every(bId => {
              const b = mol.bonds.get(bId);
              const other = mol.atoms.get(b?.getOtherAtom(a.id));
              return !other || other.name === 'H' || ringSet.has(other.id);
            })
        ) ?? nNeg;
    }
    const getBond = (aId, bId) => mol.getBond(aId, bId);
    // C-C bond: the only bond in the ring between two C atoms
    const ccBond = (() => {
      for (const c of cs) {
        for (const bId of c.bonds) {
          const b = mol.bonds.get(bId);
          if (!b) {
            continue;
          }
          const other = mol.atoms.get(b.getOtherAtom(c.id));
          if (other && other.name === 'C' && ringSet.has(other.id)) {
            return b;
          }
        }
      }
      return null;
    })();
    if (!ccBond) {
      continue;
    }
    // Kekulize: C=C double, all other ring bonds single
    for (let i = 0; i < ring.length; i++) {
      const b = getBond(ring[i], ring[(i + 1) % ring.length]);
      if (!b) {
        continue;
      }
      b.properties.order = b === ccBond ? 2 : 1;
      if (b.properties.aromatic !== undefined) {
        b.properties.aromatic = false;
      }
    }
    for (const a of atoms) {
      a.properties.aromatic = false;
    }
    // N+ exo: single bond to O(-1) → double bond to neutral O
    exoO.bond.properties.order = 2;
    exoO.atom.setCharge(0);
    // The target neutral ring N → N(-1)
    nToCharge.setCharge(-1);
  }
}

function _normalizeOverchargedNitrogen(mol) {
  // InChI sometimes distributes the positive charge of an amidinium or similar
  // delocalized group across two N atoms in the same component, writing one N
  // as N+2 (or higher) and balancing it with an N-1 elsewhere.  The canonical
  // chemistry is N+1 / N(0).  Fix: for each N with charge > 1, find the nearest
  // N-1 in the same connected component and reduce both by 1.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) < 2) {
      continue;
    }
    const component = new Set([atom.id]);
    const queue = [atom.id];
    while (queue.length > 0) {
      const id = queue.shift();
      for (const bId of mol.atoms.get(id).bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(id));
        if (!other || component.has(other.id) || other.name === 'H') {
          continue;
        }
        component.add(other.id);
        queue.push(other.id);
      }
    }
    let nMinus = null;
    for (const id of component) {
      const a = mol.atoms.get(id);
      if (a && a !== atom && a.name === 'N' && (a.properties.charge ?? 0) === -1) {
        nMinus = a;
        break;
      }
    }
    if (nMinus) {
      atom.setCharge((atom.properties.charge ?? 0) - 1);
      nMinus.setCharge(0);
      continue;
    }
    // Also reduce N+2 when the molecule has a terminal iminyl C=N (written as
    // [CH]=N or similar from former isocyanide normalization).  The isocyanide
    // N+ is neutralised by _normalizeIsocyanide in the smiles canonical but
    // not in the inchi canonical (because the triple bond wasn't formed there),
    // leaving the inchi form with one extra +1 on another N.
    const hasTerminalIminyl = [...component].some(id => {
      const a = mol.atoms.get(id);
      if (!a || a.name !== 'C' || (a.properties.charge ?? 0) !== 0) {
        return false;
      }
      const heavyBonds = [...a.bonds].filter(bId => {
        const b = mol.bonds.get(bId);
        return b && mol.atoms.get(b.getOtherAtom(id))?.name !== 'H';
      });
      if (heavyBonds.length !== 1) {
        return false;
      } // terminal C (1 heavy bond)
      const bond = mol.bonds.get(heavyBonds[0]);
      if (!bond || (bond.properties.order ?? 1) !== 2) {
        return false;
      } // double bond
      const n = mol.atoms.get(bond.getOtherAtom(id));
      return n && n.name === 'N' && (n.properties.charge ?? 0) === 0;
    });
    if (!hasTerminalIminyl) {
      continue;
    }
    atom.setCharge((atom.properties.charge ?? 0) - 1);
  }
}

function _normalizeThiazolol(mol) {
  // Convert aromatic 1,3-thiazol-4-ol (thiazolol) rings to the Kekulé
  // thiazolinone form InChI uses: C=C-[N-]-S-C(=O).
  // Pattern: 5-membered aromatic ring with 3C + 1S + 1N, one C bearing exo [O-],
  // and S adjacent to both N and C([O-]) in the ring.
  const rings = mol.getRings();
  for (const ring of rings) {
    if (ring.length !== 5) {
      continue;
    }
    const ringSet = new Set(ring);
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const cs = atoms.filter(a => a.name === 'C');
    const ns = atoms.filter(a => a.name === 'N');
    const ss = atoms.filter(a => a.name === 'S');
    if (cs.length !== 3 || ns.length !== 1 || ss.length !== 1) {
      continue;
    }
    const nAtom = ns[0];
    const sAtom = ss[0];
    // Find the C with exo [O-]
    let cOx = null,
      exoO = null,
      exoOBond = null;
    for (const c of cs) {
      for (const bId of c.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(c.id));
        if (!other || ringSet.has(other.id)) {
          continue;
        }
        if (other.name === 'O' && (other.properties.charge ?? 0) === -1) {
          cOx = c;
          exoO = other;
          exoOBond = b;
          break;
        }
      }
      if (cOx) {
        break;
      }
    }
    if (!cOx) {
      continue;
    }
    // Verify S is adjacent (in the ring) to both N and cOx
    const sRingAdj = [...sAtom.bonds]
      .map(bId => {
        const b = mol.bonds.get(bId);
        return b ? mol.atoms.get(b.getOtherAtom(sAtom.id))?.id : null;
      })
      .filter(id => id && ringSet.has(id));
    if (!sRingAdj.includes(nAtom.id) || !sRingAdj.includes(cOx.id)) {
      continue;
    }
    // The two remaining carbons (ca adjacent to N, cb adjacent to cOx) get the C=C bond
    const remainingCs = cs.filter(c => c !== cOx);
    let ca = null,
      cb = null;
    for (const c of remainingCs) {
      const cRingAdj = [...c.bonds]
        .map(bId => {
          const b = mol.bonds.get(bId);
          return b ? mol.atoms.get(b.getOtherAtom(c.id))?.id : null;
        })
        .filter(id => id && ringSet.has(id));
      if (cRingAdj.includes(nAtom.id)) {
        ca = c;
      }
      if (cRingAdj.includes(cOx.id)) {
        cb = c;
      }
    }
    if (!ca || !cb || ca === cb) {
      continue;
    }
    // Dearomatize: ca=cb double bond, all other ring bonds single
    for (let i = 0; i < ring.length; i++) {
      const b = mol.getBond(ring[i], ring[(i + 1) % ring.length]);
      if (!b) {
        continue;
      }
      const isDbl = (ring[i] === ca.id && ring[(i + 1) % ring.length] === cb.id) || (ring[i] === cb.id && ring[(i + 1) % ring.length] === ca.id);
      b.properties.order = isDbl ? 2 : 1;
      if (b.properties.aromatic !== undefined) {
        b.properties.aromatic = false;
      }
    }
    for (const a of atoms) {
      a.properties.aromatic = false;
    }
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
    if (ring.length !== 6) {
      continue;
    }
    const atoms = ring.map(id => mol.atoms.get(id));
    if (atoms.some(a => a?.properties?.aromatic)) {
      continue;
    } // skip aromatic rings
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {
      continue;
    }
    const ringSet = new Set(ring);
    const totalCharge = ns.reduce((s, n) => s + (n.properties.charge ?? 0), 0);
    if (totalCharge !== 1) {
      continue;
    }
    const nFree = ns.find(n => {
      if ((n.properties.charge ?? 0) !== 1) {
        return false;
      }
      const hasH = [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        return b && mol.atoms.get(b.getOtherAtom(n.id))?.name === 'H';
      });
      if (!hasH) {
        return false;
      }
      return ![...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {
          return false;
        }
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && !ringSet.has(other.id) && other.name === 'C';
      });
    });
    if (!nFree) {
      continue;
    }
    const nSub = ns.find(n => {
      if (n === nFree || (n.properties.charge ?? 0) !== 0) {
        return false;
      }
      const hasH = [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        return b && mol.atoms.get(b.getOtherAtom(n.id))?.name === 'H';
      });
      if (hasH) {
        return false;
      }
      return [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {
          return false;
        }
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && !ringSet.has(other.id) && other.name === 'C';
      });
    });
    if (!nSub) {
      continue;
    }
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
    if (ring.length !== 5) {
      continue;
    }
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {
      continue;
    }
    const ringSet = new Set(ring);
    // Check N-N bond exists
    const nA = ns[0],
      nB = ns[1];
    const hasNNBond = [...nA.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(nA.id)) === nB;
    });
    if (!hasNNBond) {
      continue;
    }
    const nMinus = ns.find(n => (n.properties.charge ?? 0) === -1);
    const nNeutral = ns.find(n => (n.properties.charge ?? 0) === 0);
    if (!nMinus || !nNeutral) {
      continue;
    }
    // Find the ring-C adjacent to each N (the C that is NOT the other N in the pair)
    const getAdjRingC = n => {
      for (const bId of n.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        if (!other || !ringSet.has(other.id) || other.name !== 'C') {
          continue;
        }
        return other;
      }
      return null;
    };
    const cAdjacentToMinus = getAdjRingC(nMinus);
    const cAdjacentToNeutral = getAdjRingC(nNeutral);
    if (!cAdjacentToMinus || !cAdjacentToNeutral) {
      continue;
    }
    // Check exo substituents on each ring-C (not H, not in ring)
    const hasExoCarbon = c =>
      [...c.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {
          return false;
        }
        const other = mol.atoms.get(b.getOtherAtom(c.id));
        return other && !ringSet.has(other.id) && other.name === 'C';
      });
    const hasOnlyHeteroExo = c => {
      const exo = [...c.bonds]
        .map(bId => {
          const b = mol.bonds.get(bId);
          if (!b) {
            return null;
          }
          const other = mol.atoms.get(b.getOtherAtom(c.id));
          return other && !ringSet.has(other.id) && other.name !== 'H' ? other.name : null;
        })
        .filter(Boolean);
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
    if (ring.length !== 5) {
      continue;
    }
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {
      continue;
    }
    const nHPlus = ns.find(n => {
      if ((n.properties.charge ?? 0) !== 1) {
        return false;
      }
      return [...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {
          return false;
        }
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && other.name === 'H';
      });
    });
    if (!nHPlus) {
      continue;
    }
    const nNoH = ns.find(n => {
      if (n === nHPlus || (n.properties.charge ?? 0) !== 0) {
        return false;
      }
      return ![...n.bonds].some(bId => {
        const b = mol.bonds.get(bId);
        if (!b) {
          return false;
        }
        const other = mol.atoms.get(b.getOtherAtom(n.id));
        return other && other.name === 'H';
      });
    });
    if (!nNoH) {
      continue;
    }
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
      if (!ringMembership.has(id)) {
        ringMembership.set(id, new Set());
      }
      ringMembership.get(id).add(idx);
    }
  });
  for (const [, atom] of mol.atoms) {
    if (!atom.properties.aromatic) {
      continue;
    }
    if (atom.name !== 'N') {
      continue;
    }
    if ((atom.properties.charge ?? 0) !== 1) {
      continue;
    }
    // Must have no H
    const hasH = [...atom.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(atom.id))?.name === 'H';
    });
    if (hasH) {
      continue;
    }
    // Must be in at least one ring
    const myRings = ringMembership.get(atom.id);
    if (!myRings || myRings.size === 0) {
      continue;
    }

    // Find ring C atoms adjacent to this N+ that have H
    const candidates = [];
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const cAtom = mol.atoms.get(b.getOtherAtom(atom.id));
      if (!cAtom || cAtom.name !== 'C' || !cAtom.properties.aromatic) {
        continue;
      }
      // Must share a ring with the charged N
      const cRings = ringMembership.get(cAtom.id);
      if (!cRings || ![...myRings].some(r => cRings.has(r))) {
        continue;
      }
      // Must have H (explicit bond or implicit hcount)
      const cHasH =
        (cAtom.properties.hcount ?? 0) > 0 ||
        [...cAtom.bonds].some(bId2 => {
          const b2 = mol.bonds.get(bId2);
          return b2 && mol.atoms.get(b2.getOtherAtom(cAtom.id))?.name === 'H';
        });
      if (!cHasH) {
        continue;
      }
      candidates.push(cAtom);
    }
    if (candidates.length === 0) {
      continue;
    }

    // Pick the best candidate: prefer the C adjacent to the ring N that has
    // an exo substituent (total bonds > 2, i.e., not a "free" pyrrole N).
    let target = null;
    for (const cAtom of candidates) {
      // Find the ring N on the other side of this C (not the charged N+)
      for (const bId2 of cAtom.bonds) {
        const b2 = mol.bonds.get(bId2);
        if (!b2) {
          continue;
        }
        const nOther = mol.atoms.get(b2.getOtherAtom(cAtom.id));
        if (!nOther || nOther.id === atom.id) {
          continue;
        }
        if (nOther.name !== 'N' || !nOther.properties.aromatic) {
          continue;
        }
        const nRings = ringMembership.get(nOther.id);
        if (!nRings || ![...myRings].some(r => nRings.has(r))) {
          continue;
        }
        // substituted N has ≥ 3 bonds (has at least one exo substituent)
        if (nOther.bonds.length >= 3) {
          target = cAtom;
          break;
        }
      }
      if (target) {
        break;
      }
    }
    // Fallback: first candidate
    if (!target) {
      target = candidates[0];
    }
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
    if (ring5.length !== 5) {
      continue;
    }
    const atoms5 = ring5.map(id => mol.atoms.get(id));
    if (!atoms5.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const ns5 = atoms5.filter(a => a?.name === 'N');
    if (ns5.length !== 2) {
      continue;
    }

    // Find bridging C: adjacent (in this ring) to BOTH N atoms and has no charge.
    const nIds5 = new Set(ns5.map(n => n.id));
    const bridgingC = atoms5.find(a => {
      if (a?.name !== 'C' || (a.properties.charge ?? 0) !== 0) {
        return false;
      }
      let count = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        if (nIds5.has(b.getOtherAtom(a.id))) {
          count++;
        }
      }
      return count === 2;
    });
    if (!bridgingC) {
      continue;
    }

    // Find a fused 6-membered aromatic ring that shares ≥2 atoms with this ring.
    const ring5Set = new Set(ring5);
    let nHPlus = null;
    for (const ring6 of rings) {
      if (ring6.length !== 6) {
        continue;
      }
      const shared = ring6.filter(id => ring5Set.has(id));
      if (shared.length < 2) {
        continue;
      }
      const atoms6 = ring6.map(id => mol.atoms.get(id));
      if (!atoms6.every(a => a?.properties?.aromatic)) {
        continue;
      }
      const candidate = atoms6.find(a => a?.name === 'N' && (a.properties.charge ?? 0) === 1 && a.getHydrogenNeighbors(mol).length > 0);
      if (candidate) {
        nHPlus = candidate;
        break;
      }
    }
    if (!nHPlus) {
      continue;
    }

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
    if (ring.length !== 6) {
      continue;
    }
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const oIdx = atoms.findIndex(a => a?.name === 'O' && (a.properties.charge ?? 0) === 1);
    if (oIdx === -1) {
      continue;
    }
    const oAtom = atoms[oIdx];
    const ringSet = new Set(ring);
    const paraIdx = (oIdx + 3) % 6;
    const paraC = atoms[paraIdx];
    if (!paraC || paraC.name !== 'C') {
      continue;
    }
    // Para C must have an exo bond to an aromatic carbon (aryl substituent).
    const hasExoAryl = [...paraC.bonds].some(bId => {
      const b = mol.bonds.get(bId);
      if (!b) {
        return false;
      }
      const other = mol.atoms.get(b.getOtherAtom(paraC.id));
      return other && !ringSet.has(other.id) && other.name === 'C' && other.properties.aromatic;
    });
    if (!hasExoAryl) {
      continue;
    }
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
    if (ring.length !== 5) {
      continue;
    }
    const atoms = ring.map(id => mol.atoms.get(id));
    if (!atoms.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const ns = atoms.filter(a => a?.name === 'N');
    if (ns.length !== 2) {
      continue;
    }
    const nPlus = ns.find(n => (n.properties.charge ?? 0) === 1);
    if (!nPlus) {
      continue;
    }
    // Both N atoms must have no H (not [nH+] or [nH] — those are handled by
    // _normalizeImidazoliumNHProton).
    if (ns.some(n => n.getHydrogenNeighbors(mol).length > 0)) {
      continue;
    }
    const nNeutral = ns.find(n => n !== nPlus);
    if (!nNeutral) {
      continue;
    }
    // Find the bridging C adjacent to BOTH N atoms in the ring.
    const nIds = new Set([nPlus.id, nNeutral.id]);
    const bridgingC = atoms.find(a => {
      if (a?.name !== 'C') {
        return false;
      }
      let ringNCount = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        if (nIds.has(mol.atoms.get(b.getOtherAtom(a.id))?.id)) {
          ringNCount++;
        }
      }
      return ringNCount === 2;
    });
    if (!bridgingC) {
      continue;
    }
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
    if (atom.name !== 'C') {
      continue;
    }
    const oNeighbors = [];
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (other?.name === 'O' && !other.properties.aromatic) {
        oNeighbors.push({ atom: other, bond: b });
      }
    }
    if (oNeighbors.length !== 2) {
      continue;
    }
    const oMinus = oNeighbors.find(o => (o.atom.properties.charge ?? 0) === -1);
    const oNeutral = oNeighbors.find(o => (o.atom.properties.charge ?? 0) === 0);
    if (!oMinus || !oNeutral) {
      continue;
    }
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
    if (atom.name !== 'S' || (atom.properties.charge ?? 0) !== 1) {
      continue;
    }
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
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
  // Promote hypervalent neutral N(R...)=O (an amine/nitrone oxide written with a
  // formal double bond, as some source SMILES do) to the charge-separated
  // [N+](R...)[O-] Lewis structure InChI reconstructs. A neutral trivalent
  // nitrogen can carry a double bond to a terminal O only when it has at most
  // one other substituent (a genuine nitroso compound, R-N=O, total bond order
  // 3). With two or more other substituents the total bond order exceeds 3, so
  // the structure is only valid once N carries a +1 charge and the N-O bond is
  // reduced to a single bond with O at -1 — mirroring `_normalizeNitroGroup`.
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'N' || (atom.properties.charge ?? 0) !== 0 || atom.properties.aromatic) {
      continue;
    }

    let doubleBondO = null;
    let otherBondOrderSum = 0;
    for (const bondId of atom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const order = bond.properties.order ?? 1;
      const other = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!doubleBondO && other?.name === 'O' && (other.properties.charge ?? 0) === 0 && order === 2) {
        const oHeavyDegree = other.bonds.filter(bId => {
          const b = mol.bonds.get(bId);
          return b && mol.atoms.get(b.getOtherAtom(other.id))?.name !== 'H';
        }).length;
        if (oHeavyDegree === 1) {
          doubleBondO = { bond, other };
          continue;
        }
      }
      otherBondOrderSum += order;
    }

    if (doubleBondO && otherBondOrderSum + 2 > 3) {
      atom.setCharge(1);
      doubleBondO.other.setCharge(-1);
      doubleBondO.bond.properties.order = 1;
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
    if (!halogens.has(atom.name)) {
      continue;
    }
    if ((atom.properties.charge ?? 0) !== 0) {
      continue;
    }
    // Collect all neighbours; they must all be O.
    const neighbours = [];
    let allO = true;
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(atom.id));
      if (!other || other.name !== 'O') {
        allO = false;
        break;
      }
      neighbours.push({ atom: other, bond: b });
    }
    if (!allO || neighbours.length === 0) {
      continue;
    }
    // Find the single O− neighbour (single bond, charge −1).
    const oMinusEntry = neighbours.find(n => (n.atom.properties.charge ?? 0) === -1 && n.bond.properties.order === 1);
    if (!oMinusEntry) {
      continue;
    }
    // Ensure there is only ONE O−.
    if (neighbours.filter(n => (n.atom.properties.charge ?? 0) === -1).length !== 1) {
      continue;
    }
    const nDouble = neighbours.filter(n => n.bond.properties.order === 2).length;
    // n=2 (chlorate, bromate): round-trip already matches — skip.
    if (nDouble === 2) {
      continue;
    }
    // Transform: move charge to halogen, convert O− single bond → double.
    atom.setCharge(-1);
    oMinusEntry.atom.setCharge(0);
    oMinusEntry.bond.properties.order = 2;
    // For n≥3 (perchlorate, periodate): also convert existing =O → single bond
    // so Cl/I(-1) ends up with exactly one double bond.
    if (nDouble >= 3) {
      for (const n of neighbours) {
        if (n === oMinusEntry) {
          continue;
        }
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
  const aromaticIds = new Set([...mol.atoms.keys()].filter(id => mol.atoms.get(id).properties.aromatic));
  const visited = new Set();
  for (const startId of aromaticIds) {
    if (visited.has(startId)) {
      continue;
    }
    const component = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const id = queue.shift();
      component.push(id);
      for (const bondId of mol.atoms.get(id).bonds) {
        const bond = mol.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const otherId = bond.getOtherAtom(id);
        if (visited.has(otherId) || !aromaticIds.has(otherId)) {
          continue;
        }
        visited.add(otherId);
        queue.push(otherId);
      }
    }
    const totalCharge = component.reduce((sum, id) => sum + (mol.atoms.get(id).properties.charge ?? 0), 0);
    if (totalCharge !== 0) {
      continue;
    }
    const charged = component.filter(id => (mol.atoms.get(id).properties.charge ?? 0) !== 0);
    if (charged.length === 0) {
      continue;
    }
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
    if (chargedAtoms.length !== 2) {
      continue;
    }
    const totalCharge = chargedAtoms.reduce((s, a) => s + (a.properties.charge ?? 0), 0);
    if (totalCharge !== 0) {
      continue;
    }
    const nPlus = chargedAtoms.find(a => a.name === 'N' && a.properties.aromatic && (a.properties.charge ?? 0) === 1);
    const nMinus = chargedAtoms.find(a => a.name === 'N' && !a.properties.aromatic && (a.properties.charge ?? 0) === -1);
    if (!nPlus || !nMinus) {
      continue;
    }
    // Restore the bond from nMinus to its aromatic ring-C neighbour to order=2
    // (InChI lowered it to single when it introduced the zwitterion form).
    const ringSet = new Set(ring);
    for (const bId of nMinus.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(nMinus.id));
      if (!other || !ringSet.has(other.id) || !other.properties.aromatic || other.name !== 'C') {
        continue;
      }
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
    if (!ringAtoms.every(a => a?.properties?.aromatic)) {
      continue;
    }
    const nPlusAtoms = ringAtoms.filter(a => a?.name === 'N' && (a.properties.charge ?? 0) === 1);
    if (nPlusAtoms.length !== 1) {
      continue;
    }
    // Find a ring C with an exo single bond to [N-]
    let exoCData = null;
    for (const ringC of ringAtoms) {
      if (!ringC || ringC.name !== 'C') {
        continue;
      }
      for (const bId of ringC.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(ringC.id));
        if (!other || ringSet.has(other.id)) {
          continue;
        }
        if (other.name === 'N' && (other.properties.charge ?? 0) === -1 && !other.properties.aromatic) {
          exoCData = { ringC, exoBond: b, exoN: other };
          break;
        }
      }
      if (exoCData) {
        break;
      }
    }
    if (!exoCData) {
      continue;
    }
    // Assign Kekule bonds using a valence-propagation walk.
    // First neutralise the charges so valence counts are based on the final neutral atoms.
    nPlusAtoms[0].setCharge(0);
    exoCData.exoN.setCharge(0);
    exoCData.exoBond.properties.order = 2; // restore exo C=N double bond
    // Collect ordered ring bonds (bond[i] connects ring[i]→ring[(i+1)%n])
    const orderedRingBonds = [];
    for (let i = 0; i < ring.length; i++) {
      const aId = ring[i];
      const bId = ring[(i + 1) % ring.length];
      const bond = mol.getBond(aId, bId);
      if (bond) {
        orderedRingBonds.push({ bond, a: aId, b: bId });
      }
    }
    if (orderedRingBonds.length !== ring.length) {
      continue;
    }
    const n = orderedRingBonds.length;
    // Determine which ring atoms need a double bond in the ring (remaining valence = 2).
    // Remaining valence = normal_valence − (sum of exo bond orders) − H_count − ring_single_bonds_from_exo_constraints
    // For simplicity: compute how many bonds the atom "still needs" from ring bonds.
    // Standard valences: C=4, N=3 (neutral), N+=4 (but we've already neutralised above)
    const needsDoubleBond = new Set();
    for (const aId of ring) {
      const a = mol.atoms.get(aId);
      if (!a) {
        continue;
      }
      const stdValence = a.name === 'N' ? 3 : 4; // C=4, N=3 after neutralisation
      const hCount = a.getHydrogenNeighbors(mol).length;
      let exoBondSum = 0;
      for (const bId of a.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const otherId = b.getOtherAtom(aId);
        // Skip ring bonds and H bonds (H is handled via hCount separately)
        if (ringSet.has(otherId)) {
          continue;
        }
        const otherAtom = mol.atoms.get(otherId);
        if (otherAtom?.name === 'H') {
          continue;
        }
        exoBondSum += b.properties.order ?? 1;
      }
      const ringBondsNeeded = stdValence - hCount - exoBondSum;
      // ringBondsNeeded = total bond order the atom needs from its 2 ring bonds.
      // ringBondsNeeded = 2 → both ring bonds single (no ring double needed)
      // ringBondsNeeded = 3 → one ring double + one ring single
      // ringBondsNeeded = 4 → two ring doubles (only possible in special cases)
      if (ringBondsNeeded >= 3) {
        needsDoubleBond.add(aId);
      }
    }
    // Assign Kekule bonds: walk the ring, greedily assign double bonds to adjacent pairs
    // where both atoms need a double. Use a two-pointer approach around the ring.
    // Try each possible starting position for doubles (positions at even offset from ring[0])
    // Find a valid assignment via greedy walk.
    let assigned = false;
    for (let start = 0; start < n && !assigned; start++) {
      const trial = new Array(n).fill(1);
      const trialSatisfied = new Set();
      for (let i = 0; i < n; i++) {
        const idx = (start + i * 2) % n;
        if (i * 2 >= n) {
          break;
        }
        const aId = orderedRingBonds[idx].a;
        const bId = orderedRingBonds[idx].b;
        if (needsDoubleBond.has(aId) && needsDoubleBond.has(bId) && !trialSatisfied.has(aId) && !trialSatisfied.has(bId)) {
          trial[idx] = 2;
          trialSatisfied.add(aId);
          trialSatisfied.add(bId);
        }
      }
      // Check: all atoms that need doubles are satisfied
      const allSatisfied = [...needsDoubleBond].every(id => trialSatisfied.has(id));
      if (allSatisfied) {
        for (let i = 0; i < n; i++) {
          orderedRingBonds[i].bond.properties.order = trial[i];
        }
        assigned = true;
      }
    }
    if (!assigned) {
      continue;
    } // couldn't find valid Kekule; skip this ring
    // De-aromatize: clear aromatic flag on all ring atoms and ring bonds
    for (const a of ringAtoms) {
      if (a) {
        a.properties.aromatic = false;
      }
    }
    for (const { bond } of orderedRingBonds) {
      if (bond.properties.aromatic !== undefined) {
        bond.properties.aromatic = false;
      }
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
    if (ring.length !== 6) {
      continue;
    }
    const ringSet = new Set(ring);
    const ringAtoms = ring.map(id => mol.atoms.get(id));
    // Skip if any ring atom is aromatic or non-carbon
    if (ringAtoms.some(a => !a || a.name !== 'C' || a.properties.aromatic)) {
      continue;
    }

    // Find ring C with exo double bond to N+
    let nPlusIdx = -1;
    let nPlusAtom = null,
      nPlusBond = null;
    for (let i = 0; i < 6; i++) {
      for (const bId of ringAtoms[i].bonds) {
        const b = mol.bonds.get(bId);
        if (!b || (b.properties.order ?? 1) !== 2) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(ringAtoms[i].id));
        if (!other || ringSet.has(other.id)) {
          continue;
        }
        if (other.name === 'N' && (other.properties.charge ?? 0) === 1) {
          nPlusIdx = i;
          nPlusAtom = other;
          nPlusBond = b;
          break;
        }
      }
      if (nPlusIdx !== -1) {
        break;
      }
    }
    if (nPlusIdx === -1) {
      continue;
    }

    // --- Form A: also find exo double bond to neutral non-ring C ---
    let ipsoIdx = -1;
    let methineAtom = null,
      methineBond = null;
    for (let i = 0; i < 6; i++) {
      if (i === nPlusIdx) {
        continue;
      }
      for (const bId of ringAtoms[i].bonds) {
        const b = mol.bonds.get(bId);
        if (!b || (b.properties.order ?? 1) !== 2) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(ringAtoms[i].id));
        if (!other || ringSet.has(other.id)) {
          continue;
        }
        if (other.name === 'C' && (other.properties.charge ?? 0) === 0 && !other.properties.aromatic) {
          ipsoIdx = i;
          methineAtom = other;
          methineBond = b;
          break;
        }
      }
      if (ipsoIdx !== -1) {
        break;
      }
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
        for (const a of ringAtoms) {
          a.properties.aromatic = true;
        }
        for (let i = 0; i < ring.length; i++) {
          const b = mol.getBond(ring[i], ring[(i + 1) % ring.length]);
          if (b) {
            b.properties.aromatic = true;
            b.properties.order = 1.5;
          }
        }
        continue;
      }
    }

    // --- Form B: C=[N+] exo → [C+]–N (charge moves to ring C, double → single) ---
    // InChI converts iminium C=[N+] directly to carbenium [C+]–N without
    // relocating any ring double bond.
    nPlusBond.properties.order = 1; // C_nim=[N+] → C_nim–N
    nPlusAtom.setCharge(0); // neutralise N+
    ringAtoms[nPlusIdx].setCharge(1); // C_nim becomes [C+]
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
  if (!rings || !rings.length) {
    return;
  }

  const ringMembership = new Map(); // atomId → Set<ringIndex>
  rings.forEach((ring, idx) => {
    for (const id of ring) {
      if (!ringMembership.has(id)) {
        ringMembership.set(id, new Set());
      }
      ringMembership.get(id).add(idx);
    }
  });

  const shareRing = (id1, id2) => {
    const r1 = ringMembership.get(id1);
    const r2 = ringMembership.get(id2);
    if (!r1 || !r2) {
      return false;
    }
    for (const r of r1) {
      if (r2.has(r)) {
        return true;
      }
    }
    return false;
  };

  // Organic elements whose presence on N does NOT indicate metal coordination.
  const organicElements = new Set(['C', 'N', 'H', 'O', 'S', 'F', 'Cl', 'Br', 'I', 'B', 'P', 'Si', 'Se', 'As']);

  for (const [, nAtom] of mol.atoms) {
    if (nAtom.name !== 'N') {
      continue;
    }
    if ((nAtom.properties.charge ?? 0) !== 1) {
      continue;
    }
    if (nAtom.properties.aromatic) {
      continue;
    }
    // Skip N+ coordinated to a metal (porphyrin, organometallics, etc.)
    let hasMetal = false;
    for (const bId of nAtom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(nAtom.id));
      if (other && !organicElements.has(other.name)) {
        hasMetal = true;
        break;
      }
    }
    if (hasMetal) {
      continue;
    }
    const nRingSet = ringMembership.get(nAtom.id);
    if (!nRingSet || !nRingSet.size) {
      continue;
    }

    // Find ring-internal double bond: N+ = C_alpha (both in same ring)
    let cAlpha = null,
      ringDoubleBond = null;
    for (const bId of nAtom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      const ord = b.properties.order ?? 1;
      if (Math.abs(ord - 2) > 0.1) {
        continue;
      }
      const other = mol.atoms.get(b.getOtherAtom(nAtom.id));
      if (!other || other.name !== 'C' || other.properties.aromatic) {
        continue;
      }
      if (!shareRing(nAtom.id, other.id)) {
        continue;
      }
      cAlpha = other;
      ringDoubleBond = b;
      break;
    }
    if (!cAlpha) {
      continue;
    }

    // Build ring1Set = atoms of the ring shared by N+ and C_alpha
    const cAlphaRingSet = ringMembership.get(cAlpha.id);
    const sharedRingIdx = [...nRingSet].find(r => cAlphaRingSet && cAlphaRingSet.has(r));
    if (sharedRingIdx === undefined) {
      continue;
    }
    const ring1Set = new Set(rings[sharedRingIdx]);

    // DFS: find an alternating chain from C_alpha outward.
    // Returns array of {atom, bond} or null.
    // Priority: (b) N-H terminus over (a) ring-C terminus.
    const findChain = (curId, prevId, expectedOrd, visited) => {
      visited.add(curId);
      const curAtom = mol.atoms.get(curId);
      if (!curAtom) {
        return null;
      }

      const candidates = [];
      for (const bId of curAtom.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const otherId = b.getOtherAtom(curId);
        if (otherId === prevId || visited.has(otherId)) {
          continue;
        }
        const otherAtom = mol.atoms.get(otherId);
        if (!otherAtom || otherAtom.name === 'H' || otherAtom.properties.aromatic) {
          continue;
        }
        // Never re-enter the iminium ring (ring1) from outside C_alpha
        if (ring1Set.has(otherId) && curId !== cAlpha.id) {
          continue;
        }
        const ord = Math.round(b.properties.order ?? 1);
        if (ord !== expectedOrd) {
          continue;
        }
        candidates.push({ atom: otherAtom, bond: b });
      }
      if (candidates.length === 0) {
        return null;
      }

      // Priority 1 (single-bond step): N with H → immediate case-(b) terminus
      if (expectedOrd === 1) {
        for (const { atom, bond } of candidates) {
          if (atom.name !== 'N') {
            continue;
          }
          const hasH =
            (atom.properties.hcount ?? 0) > 0 ||
            [...atom.bonds].some(bId2 => {
              const b2 = mol.bonds.get(bId2);
              return b2 && mol.atoms.get(b2.getOtherAtom(atom.id))?.name === 'H';
            });
          if (hasH) {
            return [{ atom, bond }];
          }
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
        if (sub) {
          return [{ atom, bond }, ...sub];
        }
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
      const nHasH =
        (nAtom.properties.hcount ?? 0) > 0 ||
        [...nAtom.bonds].some(bId2 => {
          const b2 = mol.bonds.get(bId2);
          return b2 && mol.atoms.get(b2.getOtherAtom(nAtom.id))?.name === 'H';
        });
      if (nHasH) {
        continue;
      }
      if ((cAlpha.properties.charge ?? 0) !== 0) {
        continue;
      }
      // Ensure C_alpha has no exo double bond
      let hasExoDbl = false;
      for (const bId of cAlpha.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const ord = Math.round(b.properties.order ?? 1);
        if (ord < 2) {
          continue;
        }
        const other = mol.atoms.get(b.getOtherAtom(cAlpha.id));
        if (other && !ring1Set.has(other.id) && other.id !== nAtom.id) {
          hasExoDbl = true;
          break;
        }
      }
      if (hasExoDbl) {
        continue;
      }
      nAtom.setCharge(0);
      ringDoubleBond.properties.order = 1;
      cAlpha.setCharge(1);
      continue;
    }

    const terminus = chain[chain.length - 1].atom;
    if (terminus.properties.aromatic) {
      continue;
    }
    if (terminus.name !== 'C' && terminus.name !== 'N') {
      continue;
    }
    // Sanity: terminus must not already be charged
    if ((terminus.properties.charge ?? 0) !== 0) {
      continue;
    }

    // Apply transformation: neutralise N+, flip bond orders, charge terminus
    nAtom.setCharge(0);
    ringDoubleBond.properties.order = 1; // N+=C_alpha → N–C_alpha

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
    if (!atom.properties.aromatic) {
      continue;
    }
    for (const bId of atom.bonds) {
      const bond = mol.bonds.get(bId);
      if (!bond || (bond.properties.order ?? 1) !== 2) {
        continue;
      }
      const ext = mol.atoms.get(bond.getOtherAtom(atom.id));
      if (!ext || ext.properties.aromatic) {
        continue;
      }
      // Only convert when the external atom is C or N.
      if (ext.name !== 'C' && ext.name !== 'N') {
        continue;
      }
      bond.properties.order = 1;
    }
  }
}

function _normalizeExocyclicAlkylideneImine(mol) {
  // After _normalizeExocyclicAromaticDoubleBond, an exo C attached to an
  // aromatic ring may become undervalent when the original c=C bond was
  // reduced to c-C but the double bond was not propagated into the chain.
  // Pattern: c-[CH]-N=C  →  c-[CH]=N-C
  // The [CH] carbon (only 2 heavy bonds + 1H = valence 3) is made normal by
  // shifting the N=C double bond one step toward the ring.
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'C' || atom.properties.aromatic) {
      continue;
    }
    // Must be attached to an aromatic atom via single bond.
    let hasAromaticNeighbor = false;
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b || b.properties.order !== 1) {
        continue;
      }
      if (mol.atoms.get(b.getOtherAtom(atom.id))?.properties.aromatic) {
        hasAromaticNeighbor = true;
        break;
      }
    }
    if (!hasAromaticNeighbor) {
      continue;
    }
    // Must have exactly one explicit H neighbor (the [CH] case, not [CH2]).
    // A CH₂ group has heavyOrder=2 and full valence 4 — it is not undervalent.
    const hNeighbors = atom.bonds.filter(bId => {
      const b = mol.bonds.get(bId);
      return b && mol.atoms.get(b.getOtherAtom(atom.id))?.name === 'H';
    });
    if (hNeighbors.length !== 1) {
      continue;
    }
    // Must be undervalent: with exactly 1 H, normal valence is 4, so heavy bond
    // order must be exactly 2 (2 heavy bonds + 1H = 3 < 4).
    let heavyOrder = 0;
    for (const bId of atom.bonds) {
      const b = mol.bonds.get(bId);
      if (!b) {
        continue;
      }
      if (mol.atoms.get(b.getOtherAtom(atom.id))?.name !== 'H') {
        heavyOrder += b.properties.order;
      }
    }
    if (heavyOrder !== 2) {
      continue;
    }
    // Find a single-bond N neighbor that carries a double bond to another atom.
    for (const bId of atom.bonds) {
      const nBond = mol.bonds.get(bId);
      if (!nBond || nBond.properties.order !== 1) {
        continue;
      }
      const n = mol.atoms.get(nBond.getOtherAtom(atom.id));
      if (!n || n.name !== 'N') {
        continue;
      }
      for (const n2bId of n.bonds) {
        if (n2bId === bId) {
          continue;
        }
        const n2bond = mol.bonds.get(n2bId);
        if (!n2bond || n2bond.properties.order !== 2) {
          continue;
        }
        const other = mol.atoms.get(n2bond.getOtherAtom(n.id));
        if (!other || other.properties.aromatic) {
          continue;
        }
        // Shift: atom-N=other  →  atom=N-other
        nBond.properties.order = 2;
        n2bond.properties.order = 1;
        break;
      }
      break;
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
    _normalizeNitrogenAnionEnolate(comp);
    _normalizeIsoxazolateONAnion(comp);
    _normalizeAmidinoHydroximateAnion(comp);
    _normalizeEnolateNoxide(comp);
    _normalizePolysulfideAnion(comp);
    _normalizeThioate(comp);
    _normalizeOximateAnion(comp);
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
    _normalizeVinylogousIminium(comp); // polymethine ring N+ → chain terminus C+/NH+
    _normalizeFuroxan(comp);
    _normalizeThiazolol(comp);
    _normalizePyrazolateCharge(comp);
    _normalizeImidazoliumNHProton(comp);
    _normalizeAromaticNPlusToC(comp); // aromatic [n+] (no H) → adjacent [cH+]
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
    _normalizeExocyclicAlkylideneImine(comp);
    const ranks = morganRanks(comp);
    return serializeComponent(comp, id => ranks.get(id) ?? 0);
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
