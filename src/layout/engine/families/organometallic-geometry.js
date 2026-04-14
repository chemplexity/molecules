/** @module families/organometallic-geometry */

import { OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, TRIGONAL_BIPYRAMIDAL_EQUATOR_ANGLE } from '../constants.js';

const SQUARE_PLANAR_ELEMENTS = new Set(['Pd', 'Pt']);
const TETRAHEDRAL_ELEMENTS = new Set(['Zn', 'Cd', 'Hg']);
const TRIGONAL_PLANAR_ELEMENTS = new Set(['Cu', 'Ag', 'Au']);
const TRIGONAL_BIPYRAMIDAL_ELEMENTS = new Set(['Fe', 'Co', 'Ni']);
const SQUARE_PYRAMIDAL_ELEMENTS = new Set(['Rh', 'Ir', 'Ru', 'Os', 'Pd', 'Pt']);
const OCTAHEDRAL_ELEMENTS = new Set(['Co', 'Rh', 'Ir', 'Ru', 'Os']);

/**
 * Returns the safe publication-style geometry label for a simple organometallic center.
 * @param {string} element - Metal element symbol.
 * @param {number} ligandCount - Number of directly attached ligands.
 * @param {object} [options] - Geometry options.
 * @param {boolean} [options.allLigandsMonodentate] - Whether every ligand is a simple monodentate attachment.
 * @returns {'generic'|'linear'|'trigonal-planar'|'square-planar'|'projected-tetrahedral'|'projected-trigonal-bipyramidal'|'projected-square-pyramidal'|'projected-octahedral'} Geometry kind.
 */
export function organometallicGeometryKind(element, ligandCount, options = {}) {
  const allLigandsMonodentate = options.allLigandsMonodentate ?? true;
  if (ligandCount === 2) {
    return 'linear';
  }
  if (ligandCount === 3 && allLigandsMonodentate && TRIGONAL_PLANAR_ELEMENTS.has(element)) {
    return 'trigonal-planar';
  }
  if (ligandCount === 4 && SQUARE_PLANAR_ELEMENTS.has(element)) {
    return 'square-planar';
  }
  if (ligandCount === 4 && TETRAHEDRAL_ELEMENTS.has(element)) {
    return 'projected-tetrahedral';
  }
  if (ligandCount === 5 && allLigandsMonodentate && TRIGONAL_BIPYRAMIDAL_ELEMENTS.has(element)) {
    return 'projected-trigonal-bipyramidal';
  }
  if (ligandCount === 5 && allLigandsMonodentate && SQUARE_PYRAMIDAL_ELEMENTS.has(element)) {
    return 'projected-square-pyramidal';
  }
  if (ligandCount === 6 && allLigandsMonodentate && OCTAHEDRAL_ELEMENTS.has(element)) {
    return 'projected-octahedral';
  }
  return 'generic';
}

/**
 * Returns the ideal placement specs for a supported publication-style organometallic geometry.
 * @param {ReturnType<typeof organometallicGeometryKind>} geometryKind - Geometry classification.
 * @param {number} ligandCount - Number of directly attached ligands.
 * @returns {Array<{angle: number, displayType: ('wedge'|'dash'|null)}>} Placement specs.
 */
export function organometallicArrangementSpecs(geometryKind, ligandCount) {
  switch (geometryKind) {
    case 'linear':
      return [
        { angle: 0, displayType: null },
        { angle: Math.PI, displayType: null }
      ];
    case 'trigonal-planar':
      return [
        { angle: Math.PI / 2, displayType: null },
        { angle: -Math.PI / 6, displayType: null },
        { angle: (-5 * Math.PI) / 6, displayType: null }
      ];
    case 'square-planar':
      return [
        { angle: Math.PI / 2, displayType: null },
        { angle: 0, displayType: null },
        { angle: -Math.PI / 2, displayType: null },
        { angle: Math.PI, displayType: null }
      ];
    case 'projected-tetrahedral':
      return [
        { angle: (2 * Math.PI) / 3, displayType: null },
        { angle: Math.PI / 3, displayType: null },
        { angle: -Math.PI / 6, displayType: 'dash' },
        { angle: (-5 * Math.PI) / 6, displayType: 'wedge' }
      ];
    case 'projected-trigonal-bipyramidal':
      return [
        { angle: Math.PI / 2, displayType: null },
        { angle: 0, displayType: null },
        { angle: -Math.PI / 2, displayType: null },
        { angle: Math.PI - TRIGONAL_BIPYRAMIDAL_EQUATOR_ANGLE, displayType: 'dash' },
        { angle: -(Math.PI - TRIGONAL_BIPYRAMIDAL_EQUATOR_ANGLE), displayType: 'wedge' }
      ];
    case 'projected-square-pyramidal':
      return [
        { angle: Math.PI / 2, displayType: null },
        { angle: OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, displayType: 'dash' },
        { angle: -OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, displayType: 'wedge' },
        { angle: -(Math.PI - OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE), displayType: 'wedge' },
        { angle: Math.PI - OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, displayType: 'dash' }
      ];
    case 'projected-octahedral':
      return [
        { angle: Math.PI / 2, displayType: null },
        { angle: OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, displayType: 'dash' },
        { angle: -OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, displayType: 'wedge' },
        { angle: -Math.PI / 2, displayType: null },
        { angle: -(Math.PI - OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE), displayType: 'wedge' },
        { angle: Math.PI - OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, displayType: 'dash' }
      ];
    default: {
      if (ligandCount <= 0) {
        return [];
      }
      if (ligandCount === 1) {
        return [{ angle: 0, displayType: null }];
      }
      if (ligandCount === 4) {
        return [
          { angle: Math.PI / 4, displayType: null },
          { angle: -Math.PI / 4, displayType: null },
          { angle: (-3 * Math.PI) / 4, displayType: null },
          { angle: (3 * Math.PI) / 4, displayType: null }
        ];
      }
      const step = (2 * Math.PI) / ligandCount;
      return Array.from({ length: ligandCount }, (_, index) => ({
        angle: Math.PI / 2 - index * step,
        displayType: null
      }));
    }
  }
}

/**
 * Returns the expected renderer-facing wedge/dash assignment count for one geometry kind.
 * @param {ReturnType<typeof organometallicGeometryKind>} geometryKind - Geometry classification.
 * @returns {number} Expected projected bond-assignment count.
 */
export function organometallicProjectedDisplayAssignmentCount(geometryKind) {
  switch (geometryKind) {
    case 'projected-tetrahedral':
      return 2;
    case 'projected-trigonal-bipyramidal':
      return 2;
    case 'projected-square-pyramidal':
      return 4;
    case 'projected-octahedral':
      return 4;
    default:
      return 0;
  }
}
