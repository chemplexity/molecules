/** @module layout/ring-fill-shape */

import { pointInPolygon } from './engine/geometry/polygon.js';
import { centroid } from './engine/geometry/vec2.js';

const AREA_EPSILON = 1e-6;

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  }
  return Math.abs(area) / 2;
}

function ringKey(atomIds) {
  return [...atomIds].sort().join('\0');
}

function countSharedAtoms(firstAtomIds, secondAtomIds) {
  const first = new Set(firstAtomIds);
  let count = 0;
  for (const atomId of secondAtomIds) {
    if (first.has(atomId)) {
      count += 1;
    }
  }
  return count;
}

function polygonForRing(atomIds, pointForAtomId) {
  const points = [];
  for (const atomId of atomIds) {
    const point = pointForAtomId(atomId);
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      return null;
    }
    points.push({ x: point.x, y: point.y });
  }
  return points.length >= 3 ? points : null;
}

function polygonToPath(points) {
  if (!points?.length) {
    return '';
  }
  const [first, ...rest] = points;
  return `M ${first.x},${first.y} ${rest.map(point => `L ${point.x},${point.y}`).join(' ')} Z`;
}

/**
 * Builds the SVG path data for a polygon and optional interior hole polygons.
 * @param {Array<{x:number,y:number}>} points - Exterior polygon points.
 * @param {Array<Array<{x:number,y:number}>>} holes - Interior hole polygons.
 * @returns {string} SVG path data.
 */
export function ringFillPathData(points, holes = []) {
  return [points, ...holes].map(polygonToPath).filter(Boolean).join(' ');
}

/**
 * Builds a renderer-facing ring fill shape and punches smaller fused/shared
 * rings out of larger ring polygons so macrocycle fills do not color embedded
 * ring faces.
 * @param {string[]} ringAtomIds - Target ring atom ids.
 * @param {string[][]} allRingAtomIds - All candidate ring atom-id cycles.
 * @param {(atomId:string) => {x:number,y:number}|null|undefined} pointForAtomId - Coordinate lookup callback.
 * @returns {{points:Array<{x:number,y:number}>, holes:Array<Array<{x:number,y:number}>>, path:string}|null} Ring fill shape.
 */
export function buildRingFillShape(ringAtomIds, allRingAtomIds, pointForAtomId) {
  const points = polygonForRing(ringAtomIds, pointForAtomId);
  if (!points) {
    return null;
  }

  const targetArea = polygonArea(points);
  const targetKey = ringKey(ringAtomIds);
  const holes = [];
  for (const candidateAtomIds of allRingAtomIds ?? []) {
    if (ringKey(candidateAtomIds) === targetKey || countSharedAtoms(ringAtomIds, candidateAtomIds) < 2) {
      continue;
    }
    const candidatePoints = polygonForRing(candidateAtomIds, pointForAtomId);
    if (!candidatePoints) {
      continue;
    }
    if (polygonArea(candidatePoints) >= targetArea - AREA_EPSILON) {
      continue;
    }
    if (pointInPolygon(centroid(candidatePoints), points)) {
      holes.push(candidatePoints);
    }
  }

  return {
    points,
    holes,
    path: ringFillPathData(points, holes)
  };
}
