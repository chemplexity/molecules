/** @module geometry/segments */

function pointOnSegment(point, firstPoint, secondPoint) {
  return point.x >= Math.min(firstPoint.x, secondPoint.x) - 1e-9
    && point.x <= Math.max(firstPoint.x, secondPoint.x) + 1e-9
    && point.y >= Math.min(firstPoint.y, secondPoint.y) - 1e-9
    && point.y <= Math.max(firstPoint.y, secondPoint.y) + 1e-9;
}

/**
 * Returns the orientation sign for three 2D points.
 * @param {{x: number, y: number}} firstPoint - First point.
 * @param {{x: number, y: number}} secondPoint - Second point.
 * @param {{x: number, y: number}} thirdPoint - Third point.
 * @returns {number} `1` for counter-clockwise, `-1` for clockwise, `0` for collinear.
 */
export function orientation(firstPoint, secondPoint, thirdPoint) {
  const determinant =
    (secondPoint.x - firstPoint.x) * (thirdPoint.y - firstPoint.y)
    - (secondPoint.y - firstPoint.y) * (thirdPoint.x - firstPoint.x);
  if (Math.abs(determinant) <= 1e-12) {
    return 0;
  }
  return determinant > 0 ? 1 : -1;
}

/**
 * Returns whether two closed line segments intersect.
 * @param {{x: number, y: number}} firstStart - First segment start.
 * @param {{x: number, y: number}} firstEnd - First segment end.
 * @param {{x: number, y: number}} secondStart - Second segment start.
 * @param {{x: number, y: number}} secondEnd - Second segment end.
 * @returns {boolean} True when the segments intersect or touch.
 */
export function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstOrientationA = orientation(firstStart, firstEnd, secondStart);
  const firstOrientationB = orientation(firstStart, firstEnd, secondEnd);
  const secondOrientationA = orientation(secondStart, secondEnd, firstStart);
  const secondOrientationB = orientation(secondStart, secondEnd, firstEnd);

  if (firstOrientationA !== firstOrientationB && secondOrientationA !== secondOrientationB) {
    return true;
  }
  if (firstOrientationA === 0 && pointOnSegment(secondStart, firstStart, firstEnd)) {
    return true;
  }
  if (firstOrientationB === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)) {
    return true;
  }
  if (secondOrientationA === 0 && pointOnSegment(firstStart, secondStart, secondEnd)) {
    return true;
  }
  if (secondOrientationB === 0 && pointOnSegment(firstEnd, secondStart, secondEnd)) {
    return true;
  }
  return false;
}

/**
 * Returns whether two line segments cross strictly through each other.
 * @param {{x: number, y: number}} firstStart - First segment start.
 * @param {{x: number, y: number}} firstEnd - First segment end.
 * @param {{x: number, y: number}} secondStart - Second segment start.
 * @param {{x: number, y: number}} secondEnd - Second segment end.
 * @returns {boolean} True when the segments properly cross.
 */
export function segmentsProperlyIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstAgainstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstAgainstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondAgainstFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondAgainstFirstEnd = orientation(secondStart, secondEnd, firstEnd);
  const epsilon = 1e-9;
  return firstAgainstSecondStart * firstAgainstSecondEnd < -epsilon
    && secondAgainstFirstStart * secondAgainstFirstEnd < -epsilon;
}

/**
 * Returns the minimum Euclidean distance from a point to a segment.
 * @param {{x: number, y: number}} point - Query point.
 * @param {{x: number, y: number}} firstPoint - Segment start.
 * @param {{x: number, y: number}} secondPoint - Segment end.
 * @returns {number} Minimum point-to-segment distance.
 */
export function distancePointToSegment(point, firstPoint, secondPoint) {
  const deltaX = secondPoint.x - firstPoint.x;
  const deltaY = secondPoint.y - firstPoint.y;
  const spanSquared = deltaX * deltaX + deltaY * deltaY;
  if (spanSquared <= 1e-12) {
    return Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y);
  }
  const projection = ((point.x - firstPoint.x) * deltaX + (point.y - firstPoint.y) * deltaY) / spanSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const closestPoint = {
    x: firstPoint.x + deltaX * clampedProjection,
    y: firstPoint.y + deltaY * clampedProjection
  };
  return Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y);
}
