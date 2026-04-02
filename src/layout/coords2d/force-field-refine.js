/** @module layout/coords2d/force-field-refine */

const DEG120 = (2 * Math.PI) / 3;

/**
 * 2D molecular-mechanics force-field relaxation, inspired by ChemDraw's
 * "Clean Up Structure" algorithm.
 *
 * Three pairwise potentials are applied in each gradient-descent step:
 *
 *  1. **Bond-length springs**    – harmonic spring along every bond,
 *     restoring to `bondLength`.
 *  2. **Bond-angle bending**    – for every atom with ≥2 neighbours, a
 *     harmonic spring on each bond-angle pair, restoring to the ideal angle
 *     (180° for sp, 120° everywhere else in a 2D depiction).
 *  3. **Non-bonded repulsion**  – soft-wall (1/r³) repulsion between every
 *     pair of heavy atoms that are not bonded (1-2) or angle-neighbours (1-3),
 *     acting inside a distance cut-off of 2.2 × bondLength.
 *
 * Ring atoms (`frozen`) are held fixed throughout.  The integrator runs up to
 * `MAX_ITER` damped gradient-descent steps; it exits early once the maximum
 * per-atom displacement drops below `CONVERGE`.
 *
 * @param {import('../../core/Molecule.js').Molecule} molecule
 * @param {Map<string, {x:number,y:number}>} coords   – mutated in-place
 * @param {Set<string>} frozen         – atom IDs that must not move (ring atoms)
 * @param {number} bondLength
 */
export function forceFieldRefine(molecule, coords, frozen, bondLength, allRingAtoms = new Set()) {
  const K_BOND = 8.0; // bond-length spring constant
  const K_ANGLE = 2.5; // angle-bending constant
  const K_REP = 2.0; // non-bonded repulsion scale
  // Cutoff of 2.0×BL catches 1-4 pairs in compressed geometry while
  // remaining below the 1-4 distance at ideal 120° angles (~2.6×BL).
  // 1-3 pairs are always excluded via ex13, so their distance (~1.73×BL)
  // does not interfere.  A wider cutoff is essential for large macrocycles
  // where many side chains start in close proximity.
  const REP_CUT = bondLength * 2.0; // repulsion interaction cutoff (Å)
  const MAX_STEP = bondLength * 0.25; // per-atom displacement clamp per step
  const CONVERGE = bondLength * 5e-3; // convergence threshold
  const K_POS = 1.5; // position spring for large-ring atoms (prevents collapse)
  const isLargeRingAtom = id => allRingAtoms.has(id) && !frozen.has(id);

  const isH = id => molecule.atoms.get(id)?.name === 'H';

  // Identify movable atoms: in coords, not frozen, not hydrogen.
  const movArr = [...coords.keys()].filter(id => molecule.atoms.has(id) && !frozen.has(id) && !isH(id));
  if (movArr.length === 0) {
    return;
  }

  // Capture initial positions and backbone angles for large-ring atoms.
  // initPos feeds the position springs; initAngles feeds the angle springs
  // (we spring toward the ring's own initial geometry rather than 120°,
  // which would contract a large ring whose interior angle is ~170°+).
  const initPos = new Map();
  for (const id of movArr) {
    if (isLargeRingAtom(id)) {
      const c = coords.get(id);
      if (c) {
        initPos.set(id, { x: c.x, y: c.y });
      }
    }
  }

  // Index map for fast force-array access.
  const idxOf = new Map(movArr.map((id, i) => [id, i]));

  // All non-hydrogen heavy atoms (used as repulsion targets, includes frozen).
  // (Declared early so initAngles can use nb12 built below.)
  // Note: heavyArr and nb12/nb13 are also declared later; this block is pre-pass.
  {
    // Temporary nb12 for initAngles computation only.
    const _nb12tmp = new Map();
    for (const id of [...coords.keys()].filter(i => molecule.atoms.has(i) && molecule.atoms.get(i).name !== 'H')) {
      _nb12tmp.set(id, new Set());
    }
    for (const bond of molecule.bonds.values()) {
      const a = bond.atoms[0],
        b = bond.atoms[1];
      _nb12tmp.get(a)?.add(b);
      _nb12tmp.get(b)?.add(a);
    }
    // Pre-compute initial backbone angles for large ring atoms.
    // Key: `${cId},${bId},${dId}` → angle (radians).
    forceFieldRefine._initAngles = new Map();
    for (const id of movArr) {
      if (!isLargeRingAtom(id)) {
        continue;
      }
      const p0c = initPos.get(id);
      if (!p0c) {
        continue;
      }
      const nbs = [...(_nb12tmp.get(id) ?? [])].filter(n => isLargeRingAtom(n));
      for (let ii = 0; ii < nbs.length; ii++) {
        for (let jj = ii + 1; jj < nbs.length; jj++) {
          const bId = nbs[ii],
            dId = nbs[jj];
          const p0b = initPos.get(bId),
            p0d = initPos.get(dId);
          if (!p0b || !p0d) {
            continue;
          }
          const ubx = p0b.x - p0c.x,
            uby = p0b.y - p0c.y;
          const udx = p0d.x - p0c.x,
            udy = p0d.y - p0c.y;
          const rb = Math.hypot(ubx, uby) || 1e-9;
          const rd = Math.hypot(udx, udy) || 1e-9;
          const cosT0 = Math.max(-1, Math.min(1, (ubx * udx + uby * udy) / (rb * rd)));
          const ang = Math.acos(cosT0);
          forceFieldRefine._initAngles.set(`${id},${bId},${dId}`, ang);
          forceFieldRefine._initAngles.set(`${id},${dId},${bId}`, ang);
        }
      }
    }
  }
  const initAngles = forceFieldRefine._initAngles;

  // All non-hydrogen heavy atoms (used as repulsion targets, includes frozen).
  const heavyArr = [...coords.keys()].filter(id => molecule.atoms.has(id) && !isH(id));

  // Build 1-2 (direct bond) and 1-3 (angle) neighbour sets.
  // 1-3 pairs are excluded from non-bonded repulsion to avoid fighting the
  // angle spring at ideal geometry.
  const nb12 = new Map();
  for (const id of heavyArr) {
    nb12.set(id, new Set());
  }
  for (const bond of molecule.bonds.values()) {
    const a = bond.atoms[0],
      b = bond.atoms[1];
    nb12.get(a)?.add(b);
    nb12.get(b)?.add(a);
  }
  const nb13 = new Map();
  for (const id of heavyArr) {
    const s = new Set();
    for (const nb of nb12.get(id) ?? []) {
      for (const nb2 of nb12.get(nb) ?? []) {
        if (nb2 !== id) {
          s.add(nb2);
        }
      }
    }
    nb13.set(id, s);
  }

  // Ideal interior bond angle for a given central atom.
  // 180° for sp (triple bond or two cumulated double bonds), 120° otherwise.
  function idealBondAngle(atomId) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      return DEG120;
    }
    if (atom.bonds.some(bId => (molecule.bonds.get(bId)?.properties.order ?? 1) === 3)) {
      return Math.PI;
    }
    // Allene center: two cumulated double bonds → sp, 180°
    if (atom.bonds.filter(bId => (molecule.bonds.get(bId)?.properties.order ?? 1) === 2).length >= 2) {
      return Math.PI;
    }
    return DEG120;
  }

  // Scale iteration count with molecule size so large macropeptides converge.
  const MAX_ITER = Math.max(200, movArr.length * 5);

  // Typed arrays for force accumulation — avoids Map overhead per iteration.
  const fx = new Float64Array(movArr.length);
  const fy = new Float64Array(movArr.length);

  let dt = 0.35; // step damping factor

  for (let iter = 0; iter < MAX_ITER; iter++) {
    fx.fill(0);
    fy.fill(0);

    // ------------------------------------------------------------------ //
    // 1. Bond-length springs (heavy atoms only — skip C-H bonds)           //
    // ------------------------------------------------------------------ //
    for (const bond of molecule.bonds.values()) {
      const aId = bond.atoms[0],
        bId = bond.atoms[1];
      if (isH(aId) || isH(bId)) {
        continue;
      } // ignore H bonds
      const ca = coords.get(aId),
        cb = coords.get(bId);
      if (!ca || !cb) {
        continue;
      }
      const movA = idxOf.has(aId),
        movB = idxOf.has(bId);
      if (!movA && !movB) {
        continue;
      }

      const dx = cb.x - ca.x,
        dy = cb.y - ca.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      // Asymmetric spring: stiffer under compression (d < BL) so angle-spring
      // forces can never collapse a bond.  Above BL behaves as a linear spring.
      const compress = d < bondLength ? bondLength / d : 1.0;
      const s = (K_BOND * compress * (d - bondLength)) / d;
      const Fx = s * dx,
        Fy = s * dy;

      if (movA) {
        const i = idxOf.get(aId);
        fx[i] += Fx;
        fy[i] += Fy;
      }
      if (movB) {
        const i = idxOf.get(bId);
        fx[i] -= Fx;
        fy[i] -= Fy;
      }
    }

    // ------------------------------------------------------------------ //
    // 2. Bond-angle bending (heavy-atom angles only)                       //
    // ------------------------------------------------------------------ //
    // Iterate every heavy atom as a potential angle-centre; ring atoms can
    // be centres even though they don't move — they pull their movable
    // substituents to the correct angle.
    for (const cId of heavyArr) {
      const center = coords.get(cId);
      if (!center) {
        continue;
      }
      // Only include heavy-atom neighbours — excludes H from angle terms,
      // preventing spurious forces from C-H vs C-H angle optimisation.
      const nbs = [...(nb12.get(cId) ?? [])].filter(n => coords.has(n) && !isH(n));
      if (nbs.length < 2) {
        continue;
      }

      const ideal = idealBondAngle(cId);

      for (let i = 0; i < nbs.length - 1; i++) {
        for (let j = i + 1; j < nbs.length; j++) {
          const bId = nbs[i],
            dId = nbs[j];
          const cb = coords.get(bId),
            cd = coords.get(dId);

          // Unit vectors from centre to each neighbour.
          let ubx = cb.x - center.x,
            uby = cb.y - center.y;
          let udx = cd.x - center.x,
            udy = cd.y - center.y;
          const rb = Math.hypot(ubx, uby) || 1e-9;
          const rd = Math.hypot(udx, udy) || 1e-9;
          ubx /= rb;
          uby /= rb;
          udx /= rd;
          udy /= rd;

          const cosT = Math.max(-1, Math.min(1, ubx * udx + uby * udy));
          const theta = Math.acos(cosT);
          // For backbone triples entirely within a large ring, spring toward the
          // ring's own initial geometry (not 120°).  A 53-atom ring has interior
          // angles ~173°; forcing 120° would severely contract the backbone.
          const backboneInitAng = isLargeRingAtom(cId) && isLargeRingAtom(bId) && isLargeRingAtom(dId) ? (initAngles.get(`${cId},${bId},${dId}`) ?? null) : null;
          const delta = theta - (backboneInitAng !== null ? backboneInitAng : ideal);
          if (Math.abs(delta) < 1e-8) {
            continue;
          }

          const sinT = Math.sin(theta);
          // Skip near-linear angles (theta ≈ 0° or 180°) where sinT ≈ 0
          // would make K blow up.  These degenerate triplets arise when the
          // initial chain placement is perfectly straight (e.g., C26-N27-C28
          // at 180°).  Skipping lets numerical drift move them away from the
          // singularity in subsequent iterations, after which forces are
          // correctly computed.
          if (Math.abs(sinT) < 0.05) {
            continue;
          }
          const K = (K_ANGLE * delta) / sinT;

          // Analytical gradient: F_b = K * (ud - cosT*ub) / rb
          const Fbx = (K * (udx - cosT * ubx)) / rb;
          const Fby = (K * (udy - cosT * uby)) / rb;
          // F_d = K * (ub - cosT*ud) / rd
          const Fdx = (K * (ubx - cosT * udx)) / rd;
          const Fdy = (K * (uby - cosT * udy)) / rd;

          if (idxOf.has(bId)) {
            const ii = idxOf.get(bId);
            fx[ii] += Fbx;
            fy[ii] += Fby;
          }
          if (idxOf.has(dId)) {
            const ii = idxOf.get(dId);
            fx[ii] += Fdx;
            fy[ii] += Fdy;
          }
          // Note: we deliberately do NOT apply Newton's 3rd to the centre
          // atom.  The angle-spring forces on b and d are purely tangential
          // (perpendicular to the respective bonds), so they correctly rotate
          // the endpoints around the centre without compressing the bonds.
          // Applying the reaction force to a movable centre would push it
          // toward one endpoint, collapsing the bond — observed for the
          // guanidinium (C28) and similar trifurcated atoms.
        }
      }
    }

    // ------------------------------------------------------------------ //
    // 3. Non-bonded repulsion                                              //
    // ------------------------------------------------------------------ //
    for (let i = 0; i < movArr.length; i++) {
      const aId = movArr[i];
      const ca = coords.get(aId);
      const ex12 = nb12.get(aId);
      const ex13 = nb13.get(aId);

      for (const bId of heavyArr) {
        if (bId === aId || ex12?.has(bId) || ex13?.has(bId)) {
          continue;
        }
        const cb = coords.get(bId);
        const dx = ca.x - cb.x,
          dy = ca.y - cb.y;
        const d = Math.hypot(dx, dy) || 1e-9;
        if (d >= REP_CUT) {
          continue;
        }

        // Soft-wall: F = K_REP * (BL/d)³ / d (points away from b).
        const r = bondLength / d;
        const F = (K_REP * r * r * r) / d;
        fx[i] += F * dx;
        fy[i] += F * dy;
      }
    }

    // ------------------------------------------------------------------ //
    // 4. Position springs for large-ring atoms (prevent collapse while     //
    //    allowing the macrocycle to reshape around dense side chains).     //
    // ------------------------------------------------------------------ //
    for (let i = 0; i < movArr.length; i++) {
      const p0 = initPos.get(movArr[i]);
      if (!p0) {
        continue;
      }
      const c = coords.get(movArr[i]);
      fx[i] += K_POS * (p0.x - c.x);
      fy[i] += K_POS * (p0.y - c.y);
    }

    // ------------------------------------------------------------------ //
    // 5. Integrate (damped gradient descent with per-atom displacement cap)//
    // ------------------------------------------------------------------ //
    let maxDisp = 0;
    for (let i = 0; i < movArr.length; i++) {
      let dx = dt * fx[i],
        dy = dt * fy[i];
      const disp = Math.hypot(dx, dy);
      if (disp > MAX_STEP) {
        const s = MAX_STEP / disp;
        dx *= s;
        dy *= s;
      }
      const c = coords.get(movArr[i]);
      coords.set(movArr[i], { x: c.x + dx, y: c.y + dy });
      const actual = Math.min(disp, MAX_STEP);
      if (actual > maxDisp) {
        maxDisp = actual;
      }
    }

    if (maxDisp < CONVERGE) {
      break;
    }
    // Gentle step-size decay after the initial transient.
    // Decay starts at iter=50; floor of 0.10 keeps the integrator active
    // long enough to resolve clashes in large macrocycles.
    if (iter >= 50) {
      dt = Math.max(0.1, dt * 0.998);
    }
  }
}
