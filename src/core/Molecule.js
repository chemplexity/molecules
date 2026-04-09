/** @module core/Molecule */

import { randomUUID } from 'node:crypto';
import { Atom, getImplicitHydrogenChargeAdjustment } from './Atom.js';
import { Bond } from './Bond.js';
import elements from '../data/elements.js';
import { findSubgraphMappings as _vf2Mappings, findFirstSubgraphMapping as _vf2First, matchesSubgraph as _vf2Matches } from '../algorithms/vf2.js';
import { validateValence } from '../validation/index.js';
// Smarts functions are registered lazily by smarts/index.js to avoid a
// circular dependency (Molecule → smarts → parser → Molecule).
let _smartsFind, _smartsFirst, _smartsMatches;

/**
 * Deep-clones a plain property bag used on molecules, atoms, and bonds.
 * @param {object|undefined|null} value - The value.
 * @returns {object} The result object.
 */
function _clonePropertyBag(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Represents a molecular graph where atoms are vertices and bonds are edges.
 */
export class Molecule {
  /** @type {number} Monotonically increasing counter used for auto-generated IDs. */
  static _nextId = 0;

  /**
   * @param {(mol: Molecule, smarts: string, options?: object) => Iterable.<Map.<string, string>>} find - SMARTS find-all callback.
   * @param {(mol: Molecule, smarts: string, options?: object) => Map.<string, string>|null} first - SMARTS find-first callback.
   * @param {Array.<object>} matches - Array of match result objects.
   * @private
   */
  static _registerSMARTS(find, first, matches) {
    _smartsFind = find;
    _smartsFirst = first;
    _smartsMatches = matches;
  }

  /**
   * @param {string|null} [id] - Unique identifier. Auto-generated as a numeric string when omitted or null.
   */
  constructor(id) {
    /** @type {string} */
    this.id = id ?? `${++Molecule._nextId}`;
    /** @type {string} Universally unique identifier, auto-generated on construction. */
    this.uuid = randomUUID();
    /** @type {string} Hill notation formula string, set by parseSMILES or getName(). */
    this.name = '';
    /** @type {Array} Arbitrary tags for application use. */
    this.tags = [];
    /** @type {Map<string, Atom>} */
    this.atoms = new Map();
    /** @type {Map<string, Bond>} */
    this.bonds = new Map();
    /** @type {{mass?: number, formula?: object}} Computed molecular properties. */
    this.properties = {};
    /** @private*/
    this._bondIndex = new Map();
    /** @private*/
    this._ringsCache = null;
    /** @private*/
    this._nextAtomId = 0;
    /** @private*/
    this._nextBondId = 0;
  }

  /** @returns {number} Number of atoms in the molecule. */
  get atomCount() {
    return this.atoms.size;
  }

  /** @returns {number} Number of bonds in the molecule. */
  get bondCount() {
    return this.bonds.size;
  }

  /**
   * Adds an atom to the molecule.
   * @param {string|null} [id]  - Unique atom identifier. Auto-generated when omitted or null.
   * @param {string} name       - Element symbol (e.g. 'C', 'N').
   * @param {object} [properties] - Initial atom properties (charge, aromatic, protons, …).
   * Missing periodic-table fields are derived automatically from `name`.
   * @param {object}  [options] - Configuration options.
   * @param {boolean} [options.recompute] - When `false`, skips the automatic
   *   `_recomputeProperties()` call after adding the atom. Use this flag when
   *   adding many atoms in a batch (e.g. during parsing) and call
   *   `_recomputeProperties()` once after the batch is complete.
   * @returns {Atom} The newly created atom.
   */
  addAtom(id, name, properties = {}, { recompute = true } = {}) {
    const atom = new Atom(id ?? this._generateAutoAtomId(), name, properties);
    const el = elements[atom.name];
    if (el) {
      const hasOwn = key => Object.prototype.hasOwnProperty.call(properties, key);
      if (!hasOwn('group')) {
        atom.properties.group = el.group;
      }
      if (!hasOwn('period')) {
        atom.properties.period = el.period;
      }
      if (!hasOwn('protons')) {
        atom.properties.protons = el.protons;
      }
      if (!hasOwn('neutrons')) {
        atom.properties.neutrons = el.neutrons;
      }
      if (!hasOwn('electrons') && atom.properties.protons !== undefined) {
        atom.properties.electrons = atom.properties.protons - atom.properties.charge;
      }
    }
    if (this.atoms.has(atom.id)) {
      throw new Error(`Atom '${atom.id}' already exists.`);
    }
    this.atoms.set(atom.id, atom);
    this._ringsCache = null;
    if (this.properties.resonance) {
      this.clearResonanceStates();
    }
    if (recompute) {
      this._recomputeProperties();
    }
    return atom;
  }

  /**
   * Changes the element of an existing atom, updating all periodic-table
   * derived properties (group, period, protons, neutrons, electrons).
   * Non-element properties such as charge, aromatic, stereo, and 2D
   * coordinates are preserved unchanged.
   * @param {string} atomId      - ID of the atom to mutate.
   * @param {string} newElement  - New element symbol (e.g. `'N'`, `'O'`).
   * @returns {Atom} The mutated atom.
   * @throws {Error} If the atom is not found or the element symbol is unknown.
   */
  changeAtomElement(atomId, newElement) {
    const atom = this.atoms.get(atomId);
    if (!atom) {
      throw new Error(`Atom '${atomId}' not found.`);
    }
    const el = elements[newElement];
    if (!el) {
      throw new Error(`Unknown element '${newElement}'.`);
    }
    atom.name = newElement;
    atom.properties.group = el.group;
    atom.properties.period = el.period;
    atom.properties.protons = el.protons;
    atom.properties.neutrons = el.neutrons;
    // electrons = protons minus charge for a neutral-spin assignment
    atom.properties.electrons = el.protons - (atom.properties.charge ?? 0);
    // If the atom was previously hidden (e.g. an implicit H with visible=false),
    // make it visible now that it is a non-H heavy atom.
    if (newElement !== 'H' && atom.visible === false) {
      atom.visible = true;
    }
    // Rebalance the atom's hidden/implicit hydrogen shell against the new
    // element's default valence family. This prevents edits like C -> S from
    // inheriting carbon's old CH3 hydrogen count and becoming SH3.
    this._adjustImplicitHydrogens(atomId);
    this._ringsCache = null;
    this._recomputeProperties();
    return atom;
  }

  /**
   * Removes an atom and all its connected bonds from the molecule.
   * @param {string} id - ID of the atom to remove.
   */
  removeAtom(id) {
    const atom = this.atoms.get(id);
    if (!atom) {
      return;
    }
    for (const bondId of atom.bonds) {
      const bond = this.bonds.get(bondId);
      if (bond) {
        const other = bond.getOtherAtom(id);
        const otherAtom = this.atoms.get(other);
        if (otherAtom) {
          otherAtom.bonds = otherAtom.bonds.filter(b => b !== bondId);
        }
        const [a, b] = bond.atoms;
        this._bondIndex.delete(a < b ? `${a},${b}` : `${b},${a}`);
        this.bonds.delete(bondId);
      }
    }
    this.atoms.delete(id);
    this._ringsCache = null;
    if (this.properties.resonance) {
      this.clearResonanceStates();
    }
    this._recomputeProperties();
  }

  /**
   * Adds a bond between two atoms.
   * @param {string|null} [id]  - Unique bond identifier. Auto-generated when omitted or null.
   * @param {string} atomA - ID of the first atom.
   * @param {string} atomB - ID of the second atom.
   * @param {object} [properties] - Initial bond properties (order, aromatic, kind, …).
   * @param {boolean} [implicitHydrogen] - When true, implicit hydrogen counts on both atoms are recomputed after the bond is added.
   * @returns {Bond} The newly created bond.
   * @throws {Error} If either atom does not exist in the molecule.
   */
  addBond(id, atomA, atomB, properties = {}, implicitHydrogen = true) {
    if (!this.atoms.has(atomA)) {
      throw new Error(`Atom '${atomA}' not found.`);
    }
    if (!this.atoms.has(atomB)) {
      throw new Error(`Atom '${atomB}' not found.`);
    }
    if (atomA === atomB) {
      throw new Error(`Self-loop on atom '${atomA}' is not allowed.`);
    }
    const pairKey = atomA < atomB ? `${atomA},${atomB}` : `${atomB},${atomA}`;
    if (this._bondIndex.has(pairKey)) {
      throw new Error(`A bond between '${atomA}' and '${atomB}' already exists.`);
    }
    const bond = new Bond(id ?? this._generateAutoBondId(), [atomA, atomB], properties);
    if (this.bonds.has(bond.id)) {
      throw new Error(`Bond '${bond.id}' already exists.`);
    }
    this.bonds.set(bond.id, bond);
    this._bondIndex.set(pairKey, bond.id);
    this._ringsCache = null;
    this.atoms.get(atomA).bonds.push(bond.id);
    this.atoms.get(atomB).bonds.push(bond.id);
    if (this.properties.resonance) {
      this.clearResonanceStates();
    }
    if (implicitHydrogen) {
      this._adjustImplicitHydrogens(atomA);
      this._adjustImplicitHydrogens(atomB);
      this._recomputeProperties();
    }
    return bond;
  }

  /**
   * Adjusts the implicit hydrogen atoms on the given atom to satisfy its valence.
   * Pendant H atoms (H with exactly 1 bond to this atom) are removed and
   * replaced with the correct count based on element group and current bond orders.
   *
   * Valence rules:
   * - Groups 1–2  (s-block): valence = group
   * - Groups 13–17 (p-block): valence = 18 − group
   * - Groups 3–12 (transition metals) or group 18: no adjustment
   * @private
   * @param {string} atomId - ID of the atom to adjust.
   */
  _adjustImplicitHydrogens(atomId) {
    const atom = this.atoms.get(atomId);
    if (!atom) {
      return;
    }
    const el = elements[atom.name];
    if (!el) {
      return;
    }
    const { group } = el;
    let valence;
    if (group >= 1 && group <= 2) {
      valence = group;
    } else if (group === 13) {
      valence = 3; // Group 13 (B, Al…) is trivalent — does not fill an octet
    } else if (group >= 14 && group <= 17) {
      valence = 18 - group;
    } else {
      return;
    }

    const pendantHIds = [];
    let nonHBondOrder = 0;
    for (const bondId of atom.bonds) {
      const bond = this.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherId = bond.getOtherAtom(atomId);
      const other = this.atoms.get(otherId);
      if (other?.name === 'H' && other.bonds.length === 1) {
        pendantHIds.push(otherId);
      } else {
        nonHBondOrder += bond.properties.order ?? 1;
      }
    }

    const radical = atom.getRadical();
    // Charge shifts the implicit-H target according to the same families used
    // by valence validation:
    // - group 14 centers (C/Si) step down by |charge| or radical count
    // - groups 15–16 (N/P/O/S) shift by one protonation step in the charge
    //   direction, avoiding multi-step auto-protonation like O+2 -> OH3+2
    const charge = atom.properties.charge ?? 0;
    const chargeAdj = getImplicitHydrogenChargeAdjustment(group, charge);
    const neededH = Math.max(0, valence - nonHBondOrder - radical + chargeAdj);

    // Remove existing pendant H atoms.
    for (const hId of pendantHIds) {
      const hAtom = this.atoms.get(hId);
      if (!hAtom) {
        continue;
      }
      for (const bondId of [...hAtom.bonds]) {
        const bond = this.bonds.get(bondId);
        if (bond) {
          const [a, b] = bond.atoms;
          this._bondIndex.delete(a < b ? `${a},${b}` : `${b},${a}`);
        }
        atom.bonds = atom.bonds.filter(b => b !== bondId);
        this.bonds.delete(bondId);
      }
      this.atoms.delete(hId);
    }

    // Add the required number of new H atoms (invisible — kept in graph for
    // correct SMARTS X/H-count semantics but hidden from 2D layout/rendering).
    for (let i = 0; i < neededH; i++) {
      const hAtom = new Atom(this._generateAutoAtomId(), 'H');
      hAtom.resolveElement();
      hAtom.visible = false;
      this.atoms.set(hAtom.id, hAtom);
      const hBond = new Bond(this._generateAutoBondId(), [atomId, hAtom.id], { order: 1 });
      this.bonds.set(hBond.id, hBond);
      this._bondIndex.set(atomId < hAtom.id ? `${atomId},${hAtom.id}` : `${hAtom.id},${atomId}`, hBond.id);
      this.atoms.get(atomId).bonds.push(hBond.id);
      hAtom.bonds.push(hBond.id);
    }
  }

  /**
   * Rebuilds implicit hydrogens on the specified heavy atoms without changing
   * their existing coordinates. Hidden H atoms created during repair inherit
   * their parent atom's current position so local edits do not force relayout.
   * @param {Iterable<string>|null} [atomIds] - Atom IDs to repair. When
   *   omitted, all heavy atoms in the molecule are repaired.
   * @returns {Molecule} The current molecule.
   */
  repairImplicitHydrogens(atomIds = null) {
    const targetIds = atomIds == null ? [...this.atoms.keys()] : [...new Set(atomIds)];
    const warningAtomIdsBefore = new Set(validateValence(this).map(warning => warning.atomId));

    for (const atomId of targetIds) {
      const atom = this.atoms.get(atomId);
      if (!atom || atom.name === 'H') {
        continue;
      }
      if (!warningAtomIdsBefore.has(atomId)) {
        continue;
      }
      const repairedPreview = this.clone();
      repairedPreview._adjustImplicitHydrogens(atomId);
      const warningAtomIdsAfter = new Set(validateValence(repairedPreview).map(warning => warning.atomId));
      if (warningAtomIdsAfter.has(atomId)) {
        continue;
      }
      this._adjustImplicitHydrogens(atomId);

      if (atom.x == null || atom.y == null) {
        continue;
      }
      for (const neighbor of atom.getNeighbors(this)) {
        if (neighbor.name !== 'H' || neighbor.visible !== false) {
          continue;
        }
        neighbor.x = atom.x;
        neighbor.y = atom.y;
      }
    }

    this._recomputeProperties();
    return this;
  }

  /**
   * Clears stored stereo annotations on the specified atoms and any bonds
   * attached to them. This is useful after interactive graph edits where the
   * original stereochemistry annotation may no longer be trustworthy.
   * @param {Iterable<string>|null} [atomIds] - Atom IDs whose local stereo
   *   metadata should be cleared. When omitted, clears all stereo annotations.
   * @returns {Molecule} The current molecule.
   */
  clearStereoAnnotations(atomIds = null) {
    const targetIds = atomIds == null ? [...this.atoms.keys()] : [...new Set(atomIds)];

    for (const atomId of targetIds) {
      const atom = this.atoms.get(atomId);
      if (!atom) {
        continue;
      }
      atom.setChirality(null);
      for (const bondId of atom.bonds) {
        const bond = this.bonds.get(bondId);
        if (bond) {
          bond.properties.stereo = null;
        }
      }
    }

    return this;
  }

  /**
   * Generates the next unused auto atom ID for this molecule.
   * @private
   * @returns {string} The result string.
   */
  _generateAutoAtomId() {
    let id;
    do {
      id = `${this._nextAtomId++}`;
    } while (this.atoms.has(id));
    return id;
  }

  /**
   * Generates the next unused auto bond ID for this molecule.
   * @private
   * @returns {string} The result string.
   */
  _generateAutoBondId() {
    let id;
    do {
      id = `${this._nextBondId++}`;
    } while (this.bonds.has(id));
    return id;
  }

  /**
   * Creates a structural copy of an atom for molecule-level copy operations.
   *
   * Preserves chemistry state, coordinates, and supported display metadata.
   * @private
   * @param {Atom} atom - The atom object.
   * @returns {Atom} The resulting atom.
   */
  _copyAtom(atom) {
    const properties = _clonePropertyBag(atom.properties);
    const copy = new Atom(atom.id, atom.name, properties);
    Object.assign(copy.properties, properties);
    copy.uuid = atom.uuid;
    copy.tags = [...atom.tags];
    copy.x = atom.x;
    copy.y = atom.y;
    copy.z = atom.z;
    copy.visible = atom.visible;
    return copy;
  }

  /**
   * Creates a structural copy of a bond for molecule-level copy operations.
   * @private
   * @param {Bond} bond - The bond object.
   * @returns {Bond} The resulting bond.
   */
  _copyBond(bond) {
    const properties = _clonePropertyBag(bond.properties);
    const copy = new Bond(bond.id, [...bond.atoms], properties);
    Object.assign(copy.properties, properties);
    copy.uuid = bond.uuid;
    copy.tags = [...bond.tags];
    return copy;
  }

  /**
   * Rebuilds the canonical atom-pair → bond-ID index from the current bond set.
   * @private
   */
  _rebuildBondIndex() {
    this._bondIndex = new Map();
    for (const bond of this.bonds.values()) {
      const [a, b] = bond.atoms;
      this._bondIndex.set(a < b ? `${a},${b}` : `${b},${a}`, bond.id);
    }
  }

  /**
   * Removes a bond from the molecule.
   * By default, any atom that becomes isolated (degree 0) after the removal
   * is also deleted. Pass `{ pruneIsolated: false }` to keep isolated atoms.
   * All computed properties (`charge`, `formula`, `mass`, `name`) are
   * recomputed afterwards.
   * @param {string} id - ID of the bond to remove.
   * @param {object} [options] - Configuration options.
   * @param {boolean} [options.pruneIsolated] - When true, atoms that become
   *   isolated after removal are deleted. Pass false to keep them.
   */
  removeBond(id, { pruneIsolated = true } = {}) {
    const bond = this.bonds.get(id);
    if (!bond) {
      return;
    }
    for (const atomId of bond.atoms) {
      const atom = this.atoms.get(atomId);
      if (atom) {
        atom.bonds = atom.bonds.filter(b => b !== id);
      }
    }
    const [a, b] = bond.atoms;
    this._bondIndex.delete(a < b ? `${a},${b}` : `${b},${a}`);
    this._ringsCache = null;
    this.bonds.delete(id);
    if (this.properties.resonance) {
      this.clearResonanceStates();
    }

    if (pruneIsolated) {
      for (const atomId of bond.atoms) {
        const atom = this.atoms.get(atomId);
        if (atom && atom.bonds.length === 0) {
          this.atoms.delete(atomId);
        }
      }
    }

    this._recomputeProperties();
  }

  /**
   * Recomputes and stores all derived molecular properties:
   * `charge`, `formula`, `mass`, and `name`.
   *
   * `getFormula()` is called once and the result is reused for `getName()`,
   * avoiding a second full atom traversal per mutation.
   * @private
   */
  _recomputeProperties() {
    this.properties.charge = this.getCharge();
    const formula = this.getFormula();
    this.properties.formula = formula;
    this.properties.mass = this.getMass();
    this.name = this.getName(formula);
  }

  /**
   * Sets the formal charge on an atom and recomputes all molecular properties.
   * Delegates to {@link Atom#setCharge}, then calls `_recomputeProperties`.
   * @param {string} id     - Atom ID.
   * @param {number} charge - The new formal charge.
   * @returns {Atom|null} The updated atom, or `null` if the atom was not found.
   */
  setAtomCharge(id, charge) {
    const atom = this.atoms.get(id);
    if (!atom) {
      return null;
    }
    atom.setCharge(charge);
    if (this.properties.resonance) {
      this.clearResonanceStates();
    }
    this._recomputeProperties();
    return atom;
  }

  /**
   * Sets the explicit radical count on an atom and recomputes all molecular properties.
   * @param {string} id           - Atom ID.
   * @param {number} radicalCount - Number of unpaired electrons to store.
   * @returns {Atom|null} The updated atom, or `null` if the atom was not found.
   */
  setAtomRadical(id, radicalCount) {
    const atom = this.atoms.get(id);
    if (!atom) {
      return null;
    }
    atom.setRadical(radicalCount);
    if (this.properties.resonance) {
      this.clearResonanceStates();
    }
    this._recomputeProperties();
    return atom;
  }

  /**
   * Returns the neighbour atom IDs of a given atom.
   * @param {string} id - Atom ID.
   * @returns {string[]} Array of neighbouring atom IDs.
   */
  getNeighbors(id) {
    const atom = this.atoms.get(id);
    if (!atom) {
      return [];
    }
    return atom.bonds.map(bondId => {
      const bond = this.bonds.get(bondId);
      return bond.getOtherAtom(id);
    });
  }

  /**
   * Returns the degree (number of bonds) of an atom.
   * @param {string} id - Atom ID.
   * @returns {number} Degree of the atom.
   */
  getDegree(id) {
    return this.atoms.get(id)?.bonds.length ?? 0;
  }

  /**
   * Computes the formal charge of a single atom from its element identity
   * and the sum of its bond orders. Delegates to {@link Atom#computeCharge}.
   * @param {string} id - Atom ID.
   * @returns {number} The computed numeric value.
   */
  computeAtomCharge(id) {
    const atom = this.atoms.get(id);
    if (!atom) {
      return 0;
    }
    const totalBondOrder = atom.bonds.reduce((sum, bondId) => {
      return sum + (this.bonds.get(bondId)?.properties.order ?? 1);
    }, 0);
    return atom.computeCharge(totalBondOrder);
  }

  /**
   * Tests whether the atom with the given id is part of a ring.
   * Delegates to {@link Atom#isInRing}.
   * @param {string} id - Atom ID.
   * @returns {boolean} `false` if the atom is not found.
   */
  isAtomInRing(id) {
    const atom = this.atoms.get(id);
    return atom ? atom.isInRing(this) : false;
  }

  /**
   * Computes the total formal charge of the molecule (sum of all atom charges).
   * Automatically stored in `this.properties.charge` after every atom/bond mutation.
   * @returns {number} The computed numeric value.
   */
  getCharge() {
    let charge = 0;
    for (const atom of this.atoms.values()) {
      charge += atom.getCharge();
    }
    return charge;
  }

  /**
   * Computes the molecular formula as a map of element symbol → count,
   * with keys ordered by CHNOPS convention (C, H, N, O, P, S first,
   * then remaining elements alphabetically).
   * @returns {Record<string, number>} e.g. `{ C: 6, H: 6 }` for benzene.
   */
  getFormula() {
    const counts = {};
    for (const atom of this.atoms.values()) {
      counts[atom.name] = (counts[atom.name] ?? 0) + 1;
    }
    return Molecule._orderByCHNOPS(counts);
  }

  /**
   * Returns the CHNOPS-ordered formula string
   * (C, H, N, O, P, S first, then remaining elements alphabetically).
   *
   * An optional pre-computed formula object may be supplied to avoid a
   * redundant atom traversal when the caller already holds the result of
   * {@link getFormula}. When omitted, `getFormula()` is called internally.
   * @param {Record<string, number>} [formula] - Pre-computed formula map (CHNOPS-ordered).
   * @returns {string} e.g. `'C6H6'` for benzene.
   */
  getName(formula) {
    const f = formula ?? this.getFormula();
    return Object.entries(f)
      .map(([el, n]) => (n === 1 ? el : el + n))
      .join('');
  }

  /**
   * Orders an element-count map by CHNOPS convention.
   * @private
   * @param {Record<string, number>} counts - The counts value.
   * @returns {Record<string, number>} The computed result.
   */
  static _orderByCHNOPS(counts) {
    const CHNOPS = ['C', 'H', 'N', 'O', 'P', 'S'];
    const ordered = {};
    for (const el of CHNOPS) {
      if (el in counts) {
        ordered[el] = counts[el];
      }
    }
    for (const el of Object.keys(counts).sort()) {
      if (!(el in ordered)) {
        ordered[el] = counts[el];
      }
    }
    return ordered;
  }

  /**
   * Computes the molecular mass (g/mol).
   *
   * Uses `atom.properties.protons + atom.properties.neutrons` when set by
   * {@link parseSMILES} (including isotope adjustments). Falls back to
   * standard atomic masses from the periodic table for manually-built atoms.
   * @returns {number} Molecular mass rounded to 4 decimal places.
   */
  getMass() {
    let mass = 0;
    for (const atom of this.atoms.values()) {
      const p = atom.properties;
      if (p.protons !== undefined && p.neutrons !== undefined) {
        mass += p.protons + p.neutrons;
      } else {
        const el = elements[atom.name];
        if (el) {
          mass += el.protons + el.neutrons;
        }
      }
    }
    return Math.round(mass * 10000) / 10000;
  }

  // ---------------------------------------------------------------------------
  // Graph utilities
  // ---------------------------------------------------------------------------

  /**
   * Returns the bond connecting `atomIdA` and `atomIdB`, or `null` if none exists.
   *
   * Uses `_bondIndex` for O(1) lookup.
   * @param {string} atomIdA - The atomIdA value.
   * @param {string} atomIdB - The atomIdB value.
   * @returns {import('./Bond.js').Bond|null} The computed result.
   */
  getBond(atomIdA, atomIdB) {
    const key = atomIdA < atomIdB ? `${atomIdA},${atomIdB}` : `${atomIdB},${atomIdA}`;
    const bondId = this._bondIndex.get(key);
    return bondId !== undefined ? (this.bonds.get(bondId) ?? null) : null;
  }

  /**
   * Updates properties on an existing bond and recomputes all molecular properties.
   * Semantic bond kinds and directional stereo are validated through the
   * `Bond` helpers before any remaining metadata is merged in.
   * @param {string} bondId - ID of the bond to update.
   * @param {object} properties - Properties to merge in (e.g. `{ order: 2 }` or `{ kind: 'dative' }`).
   * @returns {import('./Bond.js').Bond|null} The updated bond, or `null` if not found.
   */
  updateBond(bondId, properties) {
    const bond = this.bonds.get(bondId);
    if (!bond) {
      return null;
    }
    const nextProperties = { ...(properties ?? {}) };
    if (Object.prototype.hasOwnProperty.call(nextProperties, 'kind')) {
      bond.setKind(nextProperties.kind);
      delete nextProperties.kind;
    }
    if (Object.prototype.hasOwnProperty.call(nextProperties, 'stereo')) {
      bond.setStereo(nextProperties.stereo);
      delete nextProperties.stereo;
    }
    Object.assign(bond.properties, nextProperties);
    this._recomputeProperties();
    return bond;
  }

  /**
   * Returns the ordered list of atom IDs on the shortest path between two atoms,
   * or `null` if no path exists (disconnected graph).
   * @param {string} atomIdA - The atomIdA value.
   * @param {string} atomIdB - The atomIdB value.
   * @returns {string[]|null} Array of results.
   */
  getPath(atomIdA, atomIdB) {
    if (!this.atoms.has(atomIdA) || !this.atoms.has(atomIdB)) {
      return null;
    }
    if (atomIdA === atomIdB) {
      return [atomIdA];
    }
    const parent = new Map([[atomIdA, null]]);
    const queue = [atomIdA];
    let queueHead = 0;
    outer: while (queueHead < queue.length) {
      const current = queue[queueHead++];
      for (const bId of this.atoms.get(current).bonds) {
        const b = this.bonds.get(bId);
        if (!b) {
          continue;
        }
        const next = b.getOtherAtom(current);
        if (!parent.has(next)) {
          parent.set(next, current);
          if (next === atomIdB) {
            break outer;
          }
          queue.push(next);
        }
      }
    }
    if (!parent.has(atomIdB)) {
      return null;
    }
    const path = [];
    for (let cur = atomIdB; cur !== null; cur = parent.get(cur)) {
      path.unshift(cur);
    }
    return path;
  }

  /**
   * Returns the fundamental cycle basis of the molecular graph as an array of
   * atom-ID arrays. Each array lists the atom IDs that form one ring, in the
   * order they were discovered by BFS.
   *
   * The number of rings equals the cyclomatic number E − V + C, where C is the
   * number of connected components.
   * @returns {string[][]} Array of results.
   */
  getRings() {
    if (this._ringsCache !== null) {
      return this._ringsCache;
    }
    const n = this.atoms.size;
    const m = this.bonds.size;
    if (n === 0 || m < 3) {
      this._ringsCache = [];
      return this._ringsCache;
    }

    // Cyclomatic number = m - n + c  (c = connected components).
    // This equals the number of linearly independent rings (ring rank).
    const c = this.getComponents().length;
    const ringCount = m - n + c;
    if (ringCount <= 0) {
      this._ringsCache = [];
      return this._ringsCache;
    }

    // For each bond (u,v), find the smallest ring containing it by running a
    // BFS from u to v with that bond removed.  This is the Smallest Set of
    // Smallest Rings (SSSR) approach and finds the correct local rings even in
    // fused polycyclic systems where a DFS-basis would produce large macrocycles.
    const allRings = [];
    const seen = new Set();

    for (const [bondId, bond] of this.bonds) {
      const [u, v] = bond.atoms;

      // BFS from u, skipping bondId, looking for v.
      const prev = new Map([[u, null]]);
      const queue = [u];
      let queueHead = 0;
      let found = false;

      outer: while (queueHead < queue.length) {
        const cur = queue[queueHead++];
        for (const bId of this.atoms.get(cur)?.bonds ?? []) {
          if (bId === bondId) {
            continue;
          } // skip the removed bond
          const b = this.bonds.get(bId);
          if (!b) {
            continue;
          }
          const next = b.getOtherAtom(cur);
          if (prev.has(next)) {
            continue;
          }
          prev.set(next, cur);
          if (next === v) {
            found = true;
            break outer;
          }
          queue.push(next);
        }
      }

      if (!found) {
        continue;
      } // bridge bond — not in any ring

      // Reconstruct atom path from v back to u.
      const ring = [];
      for (let cur = v; cur !== null; cur = prev.get(cur)) {
        ring.push(cur);
      }

      // Deduplicate by sorted atom-ID signature.
      const key = [...ring].sort().join('\0');
      if (!seen.has(key)) {
        seen.add(key);
        allRings.push(ring);
      }
    }

    // Return up to ringCount rings, smallest first.
    allRings.sort((a, b) => a.length - b.length);
    this._ringsCache = allRings.slice(0, ringCount);
    return this._ringsCache;
  }

  /**
   * Returns a new `Molecule` containing only the atoms in `atomIds` and the
   * bonds that connect them within that set.
   *
   * Atom and bond IDs are preserved; the returned molecule gets a fresh ID and
   * UUID. Bonds that cross the boundary (connect an included atom to an excluded
   * atom) are omitted.
   * @param {string[]} atomIds - Array of atom IDs.
   * @returns {Molecule} The resulting molecule.
   */
  getSubgraph(atomIds) {
    const idSet = new Set(atomIds);
    const sub = new Molecule();

    for (const id of atomIds) {
      const atom = this.atoms.get(id);
      if (!atom) {
        continue;
      }
      const copy = this._copyAtom(atom);
      sub.atoms.set(copy.id, copy);
    }

    for (const bond of this.bonds.values()) {
      const [a, b] = bond.atoms;
      if (!idSet.has(a) || !idSet.has(b)) {
        continue;
      }
      const copy = this._copyBond(bond);
      sub.bonds.set(copy.id, copy);
      sub.atoms.get(a).bonds.push(copy.id);
      sub.atoms.get(b).bonds.push(copy.id);
    }

    sub._rebuildBondIndex();
    sub._recomputeProperties();
    return sub;
  }

  /**
   * Returns an array of sub-`Molecule` instances, one per connected component.
   * Disconnected structures (e.g. ionic pairs) are split into separate molecules.
   * @returns {Molecule[]} Array of results.
   */
  getComponents() {
    const visited = new Set();
    const components = [];

    for (const startId of this.atoms.keys()) {
      if (visited.has(startId)) {
        continue;
      }
      const component = new Set();
      const queue = [startId];
      let queueHead = 0;
      while (queueHead < queue.length) {
        const current = queue[queueHead++];
        if (visited.has(current)) {
          continue;
        }
        visited.add(current);
        component.add(current);
        for (const bId of this.atoms.get(current).bonds) {
          const b = this.bonds.get(bId);
          if (!b) {
            continue;
          }
          const next = b.getOtherAtom(current);
          if (!visited.has(next)) {
            queue.push(next);
          }
        }
      }
      components.push(this.getSubgraph([...component]));
    }

    return components;
  }

  /**
   * Returns the first atom that satisfies the predicate, or `null` if none match.
   * @param {function(Atom): boolean} predicate - Predicate function for filtering.
   * @returns {import('./Atom.js').Atom|null} The computed result.
   */
  findAtom(predicate) {
    for (const atom of this.atoms.values()) {
      if (predicate(atom)) {
        return atom;
      }
    }
    return null;
  }

  /**
   * Returns the first bond that satisfies the predicate, or `null` if none match.
   * @param {function(Bond): boolean} predicate - Predicate function for filtering.
   * @returns {import('./Bond.js').Bond|null} The computed result.
   */
  findBond(predicate) {
    for (const bond of this.bonds.values()) {
      if (predicate(bond)) {
        return bond;
      }
    }
    return null;
  }

  /**
   * Returns a new `Molecule` with all explicit hydrogen atoms (and their bonds)
   * removed. All heavy atoms and the bonds between them are preserved.
   * IDs, UUIDs, tags, and properties of retained atoms/bonds are kept intact.
   * @returns {Molecule} The resulting molecule.
   */
  stripHydrogens() {
    const heavyIds = [...this.atoms.keys()].filter(id => this.atoms.get(id).name !== 'H');
    return this.getSubgraph(heavyIds);
  }

  /**
   * Marks all explicit hydrogen atoms as invisible (`atom.visible = false`) without
   * removing them from the graph. The molecule structure is preserved so that
   * stereo bonds to H (wedge/dash) can still be rendered. Returns `this`.
   * @returns {Molecule} The resulting molecule.
   */
  hideHydrogens() {
    for (const atom of this.atoms.values()) {
      if (atom.name === 'H') {
        atom.visible = false;
      }
    }
    return this;
  }

  /**
   * Sets the formal charge of every atom to 0 and recomputes all molecular
   * properties. Returns `this` for chaining.
   * @returns {this} The computed result.
   */
  neutralizeCharge() {
    for (const atom of this.atoms.values()) {
      atom.setCharge(0);
      if (atom.properties.protons !== undefined) {
        atom.properties.electrons = atom.properties.protons;
      }
    }
    this._recomputeProperties();
    return this;
  }

  /**
   * Returns a deep copy of this molecule. All atoms and bonds are duplicated
   * with their IDs, UUIDs, tags, and properties preserved. The returned
   * molecule receives a fresh auto-generated ID and UUID.
   * @returns {Molecule} The resulting molecule.
   */
  clone() {
    const copy = new Molecule();
    for (const atom of this.atoms.values()) {
      const atomCopy = this._copyAtom(atom);
      copy.atoms.set(atomCopy.id, atomCopy);
    }
    for (const bond of this.bonds.values()) {
      const bondCopy = this._copyBond(bond);
      copy.bonds.set(bondCopy.id, bondCopy);
      copy.atoms.get(bondCopy.atoms[0]).bonds.push(bondCopy.id);
      copy.atoms.get(bondCopy.atoms[1]).bonds.push(bondCopy.id);
    }
    copy._rebuildBondIndex();
    copy.name = this.name;
    copy.tags = [...this.tags];
    copy.properties = {
      ...copy.properties,
      ..._clonePropertyBag(this.properties)
    };
    return copy;
  }

  /**
   * Returns a new `Molecule` that contains all atoms and bonds from both this
   * molecule and `other`. The two molecules remain disconnected in the result
   * unless the caller later adds bonds between them.
   * @param {Molecule} other - The other value.
   * @returns {Molecule} The resulting molecule.
   */
  merge(other) {
    const combined = new Molecule();

    for (const atom of this.atoms.values()) {
      const copy = this._copyAtom(atom);
      combined.atoms.set(copy.id, copy);
    }
    for (const bond of this.bonds.values()) {
      const copy = this._copyBond(bond);
      combined.bonds.set(copy.id, copy);
      combined.atoms.get(copy.atoms[0]).bonds.push(copy.id);
      combined.atoms.get(copy.atoms[1]).bonds.push(copy.id);
    }

    const atomIdMap = new Map();
    for (const atom of other.atoms.values()) {
      let nextId = atom.id;
      if (combined.atoms.has(nextId)) {
        nextId = combined._generateAutoAtomId();
      }
      atomIdMap.set(atom.id, nextId);
      const copy = other._copyAtom(atom);
      copy.id = nextId;
      combined.atoms.set(copy.id, copy);
    }

    for (const bond of other.bonds.values()) {
      let nextId = bond.id;
      if (combined.bonds.has(nextId)) {
        nextId = combined._generateAutoBondId();
      }
      const copy = other._copyBond(bond);
      copy.id = nextId;
      copy.atoms = bond.atoms.map(atomId => atomIdMap.get(atomId) ?? atomId);
      combined.bonds.set(copy.id, copy);
      for (const atomId of copy.atoms) {
        combined.atoms.get(atomId).bonds.push(copy.id);
      }
    }

    for (const atom of combined.atoms.values()) {
      atom.bonds = [...new Set(atom.bonds)];
    }

    combined._rebuildBondIndex();
    combined._recomputeProperties();
    return combined;
  }

  /**
   * Returns the IDs of all atoms that carry a chirality annotation (`'@'` or `'@@'`).
   * @returns {string[]} Array of results.
   */
  getChiralCenters() {
    return [...this.atoms.values()].filter(a => a.isChiralCenter()).map(a => a.id);
  }

  /**
   * Derives the CIP E/Z designation of a double bond from the directional
   * (`/`/`\\`) bonds attached to its two sp2 atoms.
   *
   * Uses CIP priority rules: for each sp2 atom the normalised direction of its
   * stereo-marked neighbour is corrected by flipping when that neighbour has
   * lower* CIP priority than the other substituent (so that the comparison
   * always reflects the higher-priority group on each end).
   *
   * Same corrected directions → `Z`; different → `E`.
   *
   * Returns `null` when the bond is not a double bond or either sp2 end lacks a
   * directional neighbour bond.
   * @param {string} bondId - The bond ID.
   * @returns {'E'|'Z'|null} The computed result.
   */
  getEZStereo(bondId) {
    const dbl = this.bonds.get(bondId);
    if (!dbl || dbl.properties.order !== 2) {
      return null;
    }

    const flip = s => (s === '/' ? '\\' : '/');

    const infoAt = sp2Id => {
      const sp2 = this.atoms.get(sp2Id);
      if (!sp2) {
        return null;
      }
      let dir = null,
        markedId = null;
      const otherIds = [];
      for (const bId of sp2.bonds) {
        if (bId === bondId) {
          continue;
        }
        const b = this.bonds.get(bId);
        if (!b) {
          continue;
        }
        const otherId = b.getOtherAtom(sp2Id);
        if (b.properties.stereo) {
          dir = b.atoms[0] === sp2Id ? b.properties.stereo : flip(b.properties.stereo);
          markedId = otherId;
        } else {
          otherIds.push(otherId);
        }
      }
      return dir !== null ? { dir, markedId, otherIds } : null;
    };

    const [idA, idB] = dbl.atoms;
    const infoA = infoAt(idA);
    const infoB = infoAt(idB);
    if (!infoA || !infoB) {
      return null;
    }

    const correctDir = (sp2Id, { dir, markedId, otherIds }) => {
      if (otherIds.length === 0) {
        return dir;
      }
      const [markedRank, otherRank] = assignCIPRanks(sp2Id, [markedId, otherIds[0]], this);
      return markedRank < otherRank ? flip(dir) : dir;
    };

    const dA = correctDir(idA, infoA);
    const dB = correctDir(idB, infoB);
    return dA === dB ? 'Z' : 'E';
  }

  // ---------------------------------------------------------------------------
  // Subgraph isomorphism (VF2)
  // ---------------------------------------------------------------------------

  /**
   * Returns `true` if `query` is isomorphic to some subgraph of this molecule.
   *
   * A thin wrapper around {@link findSubgraphMappings} that stops after the
   * first match.
   * @param {Molecule} query - The query structure.
   * @param {object}   [options]  See {@link findSubgraphMappings} for supported keys.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  matchesSubgraph(query, options = {}) {
    return _vf2Matches(this, query, options);
  }

  /**
   * Returns the first injective mapping from `query` atom IDs to atom IDs in
   * this molecule, or `null` if no such mapping exists.
   * @param {Molecule} query - The query structure.
   * @param {object}   [options]  See {@link findSubgraphMappings} for supported keys.
   * @returns {Map<string, string>|null} The resulting map.
   */
  findFirstSubgraphMapping(query, options = {}) {
    return _vf2First(this, query, options);
  }

  /**
   * Generator that lazily yields every injective mapping from `query` atom IDs
   * to atom IDs in this molecule.  Each value is a
   * `Map<queryAtomId, targetAtomId>`.
   *
   * Pull values with `for…of` or `.next()` to control how many mappings are
   * enumerated.
   * @param {Molecule} query - The query structure.
   * @param {object}   [options]  See {@link findSubgraphMappings} for supported keys.
   * @yields {Map<string, string>}
   */
  *findSubgraphMappings(query, options = {}) {
    yield* _vf2Mappings(this, query, options);
  }

  /**
   * Assigns a hybridization state to every atom in the molecule and returns
   * `this` for chaining.
   *
   * Rules (applied to the **heavy atoms** of organic/main-group chemistry):
   * - **`'sp'`**  — atom has a triple bond, or two cumulated double bonds (allene center).
   * - **`'sp2'`** — atom has one double bond, or is aromatic.
   * - **`'sp3'`** — atom has only single bonds (including isolated atoms).
   * - **`null`**  — transition metals (groups 3–12), noble gases (group 18),
   *                 s-block metals (groups 1–2, excluding H), and any atom whose
   *                 element group is unknown (0 / not yet resolved).
   *
   * H atoms are always assigned `'sp3'`.
   * @returns {this} The computed result.
   */
  assignHybridizations() {
    for (const atom of this.atoms.values()) {
      atom.setHybridization(_hybridizationOf(atom, this));
    }
    return this;
  }

  /**
   * Returns `true` if the SMARTS pattern matches some subgraph of this molecule.
   * @param {string} smarts - SMARTS pattern string.
   * @param {object} [options] - Configuration options.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  matchesSMARTS(smarts, options = {}) {
    return _smartsMatches(this, smarts, options);
  }

  /**
   * Returns the first mapping from the SMARTS pattern into this molecule,
   * or `null` if no match exists.  The mapping is a `Map<queryAtomId, targetAtomId>`.
   * @param {string} smarts - SMARTS pattern string.
   * @param {object} [options] - Configuration options.
   * @returns {Map<string, string>|null} The resulting map.
   */
  firstSMARTS(smarts, options = {}) {
    return _smartsFirst(this, smarts, options);
  }

  /**
   * Generator that yields all mappings from the SMARTS pattern into this
   * molecule.  Each yielded value is a `Map<queryAtomId, targetAtomId>`.
   * @param {string} smarts - SMARTS pattern string.
   * @param {object} [options] - Configuration options.
   * @yields {Map<string, string>}
   */
  *findSMARTS(smarts, options = {}) {
    yield* _smartsFind(this, smarts, options);
  }

  /**
   * Returns all mappings from the SMARTS pattern into this molecule as an
   * array.  Convenience wrapper around `findSMARTS`.
   * @param {string} smarts - SMARTS pattern string.
   * @param {object} [options] - Configuration options.
   * @returns {Map<string, string>[]} Array of results.
   */
  querySMARTS(smarts, options = {}) {
    return [..._smartsFind(this, smarts, options)];
  }

  // ---------------------------------------------------------------------------
  // Resonance state management
  // ---------------------------------------------------------------------------

  /**
   * Total number of resonance states computed for this molecule.
   * Returns 1 when `generateResonanceStructures` has not been called.
   * @returns {number} The computed numeric value.
   */
  get resonanceCount() {
    return this.properties.resonance?.count ?? 1;
  }

  /**
   * Returns a summary of all resonance states as an array of `{ id, weight }`
   * objects sorted by state index. Data is sourced from
   * `molecule.properties.resonance.weights`.
   *
   * Returns `[{ id: 1, weight: 100 }]` when resonance has not been generated.
   * @returns {{ id: number, weight: number }[]} Array of results.
   */
  getResonanceStates() {
    const res = this.properties.resonance;
    if (!res) {
      return [{ id: 1, weight: 100 }];
    }
    return res.weights.map((weight, i) => ({ id: i + 1, weight }));
  }

  /**
   * Applies resonance state `n` to the molecule by writing the stored bond
   * and atom properties for that state into the live `bond.properties` and
   * `atom.properties`. The renderer sees updated values without any knowledge
   * of resonance.
   * @param {number} n - 1-based state index.
   * @throws {RangeError} If `n` is out of range.
   */
  setResonanceState(n) {
    const res = this.properties.resonance;
    if (!res) {
      return;
    }
    if (n < 1 || n > res.count) {
      throw new RangeError(`Resonance state ${n} is out of range [1, ${res.count}].`);
    }
    res.currentState = n;
    for (const bond of this.bonds.values()) {
      const rs = bond.properties.resonance;
      if (!rs) {
        continue;
      }
      const state = rs.states[n];
      if (!state) {
        continue;
      }
      bond.properties.order = state.order;
      bond.properties.localizedOrder = state.localizedOrder;
      bond.properties.aromatic = state.aromatic;
      bond.properties.stereo = state.stereo;
    }
    for (const atom of this.atoms.values()) {
      const rs = atom.properties.resonance;
      if (!rs) {
        continue;
      }
      const state = rs.states[n];
      if (!state) {
        continue;
      }
      atom.properties.charge = state.charge;
      atom.properties.radical = state.radical;
    }
  }

  /**
   * Restores state 1 (the canonical as-parsed form) and then removes all
   * resonance tables from bonds, atoms, and the molecule.
   */
  resetResonance() {
    this.setResonanceState(1);
    this.clearResonanceStates();
  }

  /**
   * Removes all resonance state tables from bonds, atoms, and the molecule
   * without changing any live bond or atom property values. Use
   * `resetResonance()` first if you want to restore the canonical form.
   *
   * Called automatically by `addAtom`, `removeAtom`, `addBond`, `removeBond`,
   * `setAtomCharge`, and `setAtomRadical` when resonance states are present.
   */
  clearResonanceStates() {
    for (const bond of this.bonds.values()) {
      delete bond.properties.resonance;
    }
    for (const atom of this.atoms.values()) {
      delete atom.properties.resonance;
    }
    delete this.properties.resonance;
  }
}

// ---------------------------------------------------------------------------
// Private hybridization helper
// ---------------------------------------------------------------------------

/**
 * Computes the hybridization state of a single atom based on its bonds.
 * @param {Atom} atom - The atom object.
 * @param {Molecule} mol - The molecule graph.
 * @returns {'sp'|'sp2'|'sp3'|null} The computed result.
 */
function _hybridizationOf(atom, mol) {
  // H is always sp3
  if (atom.name === 'H') {
    return 'sp3';
  }

  const { group } = atom.properties;
  // Exclude: unknown (group 0), alkali/alkaline-earth metals (groups 1–2),
  // transition metals (groups 3–12), noble gases (group 18).
  if (!group || group <= 2 || (group >= 3 && group <= 12) || group === 18) {
    return null;
  }

  // p-block (groups 13–17): count multiple bonds and aromaticity.
  let nTriple = 0;
  let nDouble = 0;
  let aromatic = atom.isAromatic();

  for (const bId of atom.bonds) {
    const b = mol.bonds.get(bId);
    if (!b) {
      continue;
    }
    if (b.properties.aromatic) {
      aromatic = true;
      continue;
    }
    const order = b.properties.order ?? 1;
    if (order === 3) {
      nTriple++;
    } else if (order === 2) {
      nDouble++;
    }
  }

  if (nTriple > 0 || nDouble >= 2) {
    return 'sp';
  }
  if (nDouble === 1 || aromatic) {
    return 'sp2';
  }
  return 'sp3';
}

// ---------------------------------------------------------------------------
// CIP priority helpers
// ---------------------------------------------------------------------------

/**
 * CIP priority key for an atom, encoding both atomic number (Rule 1) and
 * mass number (Rule 2: same-Z atoms ranked by descending mass).
 *
 * Encoding: key = Z * 1000 + massNumber
 * Z ≤ 118, massNumber ≤ ~300, so keys stay well within safe-integer range.
 * For atoms without an explicit isotope the standard mass is used, which
 * keeps all non-labelled atoms of the same element at equal priority.
 * @param {string} atomId - The atom ID.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {number} CIP priority key encoding atomic number and mass number.
 */
function _cipZ(atomId, mol) {
  const atom = mol.atoms.get(atomId);
  if (!atom) {
    return 0;
  }
  const p = atom.properties;
  const el = elements[atom.name];
  const Z = p.protons ?? el?.protons ?? 0;
  const N = p.neutrons ?? el?.neutrons ?? Z; // fallback: N ≈ Z
  return Z * 1000 + Math.round(Z + N);
}

function _buildCIPHierarchy(startId, excludeId, mol, maxDepth = 10) {
  const result = [[_cipZ(startId, mol)]];
  let frontier = [{ id: startId, parentId: excludeId }];
  const visited = new Set([excludeId, startId]);

  for (let depth = 0; depth < maxDepth; depth++) {
    const levelZ = [];
    const nextFrontier = [];

    for (const { id, parentId } of frontier) {
      const atom = mol.atoms.get(id);
      if (!atom) {
        continue;
      }

      for (const bId of atom.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        if (b.getOtherAtom(id) !== parentId) {
          continue;
        }
        const order = Math.round(b.properties.order ?? 1);
        const pZ = _cipZ(parentId, mol);
        for (let p = 1; p < order; p++) {
          levelZ.push(pZ);
        }
        break;
      }

      for (const bId of atom.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const otherId = b.getOtherAtom(id);
        if (otherId === parentId) {
          continue;
        }
        const order = Math.round(b.properties.order ?? 1);
        const oZ = _cipZ(otherId, mol);
        levelZ.push(oZ);
        for (let p = 1; p < order; p++) {
          levelZ.push(oZ);
        }
        if (!visited.has(otherId)) {
          visited.add(otherId);
          nextFrontier.push({ id: otherId, parentId: id });
        }
      }
    }

    if (levelZ.length === 0) {
      break;
    }
    levelZ.sort((a, b) => b - a);
    result.push(levelZ);
    frontier = nextFrontier;
  }

  return result;
}

function _compareCIPHierarchies(listA, listB) {
  const maxLen = Math.max(listA.length, listB.length);
  for (let i = 0; i < maxLen; i++) {
    const a = listA[i] ?? [];
    const b = listB[i] ?? [];
    const maxItems = Math.max(a.length, b.length);
    for (let j = 0; j < maxItems; j++) {
      const az = a[j] ?? 0;
      const bz = b[j] ?? 0;
      if (az !== bz) {
        return az > bz ? 1 : -1;
      }
    }
  }
  return 0;
}

/**
 * Assigns CIP priority ranks to the neighbours of `centerId`.
 * Returns a parallel array of ranks (1 = lowest). Ties receive the same rank.
 * @param {string} centerId - ID of the center atom.
 * @param {string[]} neighborIds - The neighborIds value.
 * @param {Molecule} mol - The molecule graph.
 * @returns {number[]} Array of results.
 */
export function assignCIPRanks(centerId, neighborIds, mol) {
  const entries = neighborIds.map(nId => ({
    id: nId,
    hier: _buildCIPHierarchy(nId, centerId, mol)
  }));
  entries.sort((a, b) => _compareCIPHierarchies(a.hier, b.hier));

  const rankOf = new Map();
  let rank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && _compareCIPHierarchies(entries[i].hier, entries[i - 1].hier) !== 0) {
      rank = i + 1;
    }
    rankOf.set(entries[i].id, rank);
  }

  return neighborIds.map(id => rankOf.get(id) ?? 0);
}

function _permSign(fromList, toList) {
  const sigma = toList.map(x => fromList.indexOf(x));
  let inversions = 0;
  for (let i = 0; i < sigma.length; i++) {
    for (let j = i + 1; j < sigma.length; j++) {
      if (sigma[i] > sigma[j]) {
        inversions++;
      }
    }
  }
  return inversions % 2 === 0 ? 1 : -1;
}

/**
 * Computes the CIP R/S designation for a tetrahedral chiral center.
 * @param {'@'|'@@'} chiralToken - The chiralToken value.
 * @param {string[]} smilesNeighborIds - 4 neighbour IDs in SMILES chirality order.
 * @param {string} centerId - ID of the center atom.
 * @param {Molecule} mol - The molecule graph.
 * @returns {'R'|'S'|null} The computed result.
 */
export function computeRS(chiralToken, smilesNeighborIds, centerId, mol) {
  if (smilesNeighborIds.length !== 4) {
    return null;
  }
  const ranks = assignCIPRanks(centerId, smilesNeighborIds, mol);
  if (new Set(ranks).size < 4) {
    return null;
  }

  const indexed = smilesNeighborIds.map((id, i) => ({ id, rank: ranks[i] }));
  indexed.sort((a, b) => a.rank - b.rank);
  const sortedIds = indexed.map(x => x.id);

  const pSign = _permSign(smilesNeighborIds, sortedIds);
  const smilesSign = chiralToken === '@@' ? 1 : -1;
  return smilesSign * pSign > 0 ? 'R' : 'S';
}
