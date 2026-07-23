/** @module descriptors/chemical-space */

import { allMatrices } from '../matrices/index.js';
import { molecularMass } from './molecular.js';
import {
  abcIndex,
  balabanIndex,
  eccentricConnectivityIndex,
  forgottenIndex,
  gaIndex,
  gutmanIndex,
  hararyIndex,
  harmonicIndex,
  hosoyaIndex,
  hyperWienerIndex,
  narumiKatayamaIndex,
  plattIndex,
  randicIndex,
  schultzIndex,
  szegedIndex,
  sumConnectivityIndex,
  wienerIndex,
  wienerPolarityIndex,
  zagreb1,
  zagreb2
} from './topological.js';

// The current exact Hosoya implementation enumerates graph matchings. Keeping
// this bound makes a full descriptor profile practical for every network node.
const HOSOYA_MAX_HEAVY_ATOMS = 18;

/**
 * Descriptor definitions intended for lightweight chemical-space visualizations.
 *
 * The selected indices all share an adjacency / degree / distance-matrix input,
 * allowing {@link chemicalSpaceDescriptorProfile} to construct those matrices once
 * for a molecule and expose a set of immediately plottable values.
 *
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
export const CHEMICAL_SPACE_DESCRIPTOR_OPTIONS = Object.freeze([
  { key: 'molecularWeight', label: 'Molecular weight' },
  { key: 'heavyAtomCount', label: 'Heavy-atom count' },
  { key: 'wienerIndex', label: 'Wiener index' },
  { key: 'hyperWienerIndex', label: 'Hyper-Wiener index' },
  { key: 'balabanIndex', label: 'Balaban index' },
  { key: 'randicIndex', label: 'Randić index' },
  { key: 'zagreb1', label: 'Zagreb index 1' },
  { key: 'zagreb2', label: 'Zagreb index 2' },
  { key: 'hararyIndex', label: 'Harary index' },
  { key: 'plattIndex', label: 'Platt index' },
  { key: 'szegedIndex', label: 'Szeged index' },
  { key: 'abcIndex', label: 'Atom-bond connectivity index' },
  { key: 'gaIndex', label: 'Geometric-arithmetic index' },
  { key: 'harmonicIndex', label: 'Harmonic index' },
  { key: 'sumConnectivityIndex', label: 'Sum-connectivity index' },
  { key: 'eccentricConnectivityIndex', label: 'Eccentric connectivity index' },
  { key: 'wienerPolarityIndex', label: 'Wiener polarity index' },
  { key: 'schultzIndex', label: 'Schultz index' },
  { key: 'gutmanIndex', label: 'Gutman index' },
  { key: 'forgottenIndex', label: 'Forgotten index' },
  { key: 'narumiKatayamaIndex', label: 'Narumi-Katayama index' },
  { key: 'hosoyaIndex', label: 'Hosoya index' }
]);

/**
 * Returns whether every entry in an all-pairs distance matrix is finite.
 * Topological indices based on graph distance are not defined for a disconnected
 * heavy-atom graph as represented by the current matrix module.
 * @private
 * @param {number[][]} distance - All-pairs distance matrix.
 * @returns {boolean} Whether the matrix can be used by distance indices.
 */
function _hasFiniteDistances(distance) {
  return distance.every(row => row.every(Number.isFinite));
}

/**
 * Rounds finite floating-point descriptor values for compact JSON payloads while
 * preserving the exact integer results returned by many topological indices.
 * @private
 * @param {number} value - Descriptor value.
 * @returns {number|null} Rounded finite value, or null when unavailable.
 */
function _plotValue(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 1e8) / 1e8;
}

/**
 * Computes a compact, serializable descriptor profile for chemical-space plots.
 *
 * Hydrogen atoms are excluded by the matrix module, matching the established
 * convention of the library's topological descriptors. Molecular weight still
 * includes every atom. Disconnected heavy-atom graphs keep their molecular
 * statistics but return null for graph-distance indices rather than throwing.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule - Molecule to profile.
 * @returns {Record<string, number|boolean|null>} Serializable profile.
 */
export function chemicalSpaceDescriptorProfile(molecule) {
  if (!molecule?.atoms || !molecule?.bonds) {
    throw new TypeError('chemicalSpaceDescriptorProfile expects a molecule graph.');
  }

  const heavyAtomCount = [...molecule.atoms.values()].filter(atom => atom.name !== 'H').length;
  const profile = {
    schemaVersion: 2,
    molecularWeight: _plotValue(molecularMass(molecule)),
    heavyAtomCount,
    connected: true,
    wienerIndex: null,
    hyperWienerIndex: null,
    balabanIndex: null,
    randicIndex: null,
    zagreb1: null,
    zagreb2: null,
    hararyIndex: null,
    plattIndex: null,
    szegedIndex: null,
    abcIndex: null,
    gaIndex: null,
    harmonicIndex: null,
    sumConnectivityIndex: null,
    eccentricConnectivityIndex: null,
    wienerPolarityIndex: null,
    schultzIndex: null,
    gutmanIndex: null,
    forgottenIndex: null,
    narumiKatayamaIndex: null,
    hosoyaIndex: null
  };

  const { adjacency, degree, distance, reciprocal } = allMatrices(molecule);
  profile.connected = _hasFiniteDistances(distance);
  if (!profile.connected) {
    return profile;
  }

  profile.wienerIndex = _plotValue(wienerIndex(distance));
  profile.hyperWienerIndex = _plotValue(hyperWienerIndex(distance));
  profile.balabanIndex = _plotValue(balabanIndex(distance, adjacency));
  profile.randicIndex = _plotValue(randicIndex(adjacency, degree));
  profile.zagreb1 = _plotValue(zagreb1(degree));
  profile.zagreb2 = _plotValue(zagreb2(adjacency, degree));
  profile.hararyIndex = _plotValue(hararyIndex(reciprocal));
  profile.plattIndex = _plotValue(plattIndex(adjacency, degree));
  profile.szegedIndex = _plotValue(szegedIndex(distance, adjacency));
  profile.abcIndex = _plotValue(abcIndex(adjacency, degree));
  profile.gaIndex = _plotValue(gaIndex(adjacency, degree));
  profile.harmonicIndex = _plotValue(harmonicIndex(adjacency, degree));
  profile.sumConnectivityIndex = _plotValue(sumConnectivityIndex(adjacency, degree));
  profile.eccentricConnectivityIndex = _plotValue(eccentricConnectivityIndex(adjacency, degree, distance));
  profile.wienerPolarityIndex = _plotValue(wienerPolarityIndex(distance));
  profile.schultzIndex = _plotValue(schultzIndex(degree, distance));
  profile.gutmanIndex = _plotValue(gutmanIndex(degree, distance));
  profile.forgottenIndex = _plotValue(forgottenIndex(degree));
  profile.narumiKatayamaIndex = _plotValue(narumiKatayamaIndex(degree));
  profile.hosoyaIndex = heavyAtomCount <= HOSOYA_MAX_HEAVY_ATOMS ? _plotValue(hosoyaIndex(molecule)) : null;
  return profile;
}
