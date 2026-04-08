/** @module layout/coords2d/spatial-grid */

const DEFAULT_BOND_LENGTH = 1.5;

/**
 * Lightweight grid that maps 2D cell coordinates to sets of atom IDs.
 * Cell size equals `bondLength` so a 3×3 neighbourhood covers all atoms
 * within one bond length of any query point.
 * @param {number} cellSize - The cellSize value.
 */
export class SpatialGrid {
  constructor(cellSize) {
    this.cs = cellSize;
    this.data = new Map(); // "${cx},${cy}" → Set<string>
  }
  _key(x, y) {
    return `${Math.floor(x / this.cs)},${Math.floor(y / this.cs)}`;
  }
  add(id, x, y) {
    const k = this._key(x, y);
    if (!this.data.has(k)) {
      this.data.set(k, new Set());
    }
    this.data.get(k).add(id);
  }
  remove(id, x, y) {
    const k = this._key(x, y);
    const s = this.data.get(k);
    if (s) {
      s.delete(id);
    }
  }
  /**
   * Returns true if any atom (other than those in `exclude`) is within `thresh` of (x,y).
   * @param {number} x - Query x coordinate.
   * @param {number} y - Query y coordinate.
   * @param {number} thresh - Distance threshold.
   * @param {Set.<string>|null} [exclude] - Atom IDs to ignore.
   * @param {Map.<string, {x:number,y:number}>} coords - Map of atom ID to coordinates.
   * @returns {boolean} True if a nearby atom exists.
   */
  hasNear(x, y, thresh, exclude, coords) {
    const cx0 = Math.floor(x / this.cs) - 1;
    const cy0 = Math.floor(y / this.cs) - 1;
    for (let dx = 0; dx <= 2; dx++) {
      for (let dy = 0; dy <= 2; dy++) {
        const ids = this.data.get(`${cx0 + dx},${cy0 + dy}`);
        if (!ids) {
          continue;
        }
        for (const id of ids) {
          if (exclude && exclude.has(id)) {
            continue;
          }
          const c = coords.get(id);
          if (c && Math.hypot(c.x - x, c.y - y) < thresh) {
            return true;
          }
        }
      }
    }
    return false;
  }
  /**
   * Build from an existing coords map (all entries).
   * @param {Map.<string, {x:number,y:number}>} coords - Map of atom ID to coordinates.
   * @param {number} [cellSize] - Grid cell size (defaults to bond length).
   * @returns {SpatialGrid} New grid populated from the coords map.
   */
  static fromCoords(coords, cellSize = DEFAULT_BOND_LENGTH) {
    const g = new SpatialGrid(cellSize);
    for (const [id, { x, y }] of coords) {
      g.add(id, x, y);
    }
    return g;
  }
}
