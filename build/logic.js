// Fling the State - pure game logic (no THREE dependency; node-testable).
// The trajectory preview and the actual flight both use these functions,
// so what you see is exactly where the piece lands.

const SS = {
  G: 18,            // gravity (world units / s^2)
  POWER: 4.0,       // horizontal velocity per unit of pull
  VY0: 6.5,         // base vertical launch velocity (raised for the 30° tilted board)
  VYK: 2.0,         // extra vertical velocity per unit of pull
  MAX_PULL: 8,      // max slingshot pull length (world units)
  MIN_PULL: 0.8,    // below this the shot is cancelled
  LAUNCH_Y: 2.4,    // piece center height at launch (== pouch height)
  REST_Y: 0.42,     // piece center height when resting on the table
  TOL_MIN: 1.6,     // minimum stick radius (lets tiny states be hittable)
  TOL_FRac: 0.45,   // stick radius = max(TOL_MIN, TOL_FRac * stateRadius)
};

// pull: {x, z} vector from finger to pouch-rest (points opposite the drag).
// Returns launch velocity {x, y, z}.
function ssVelocityForPull(px, pz) {
  const len = Math.hypot(px, pz);
  return { x: px * SS.POWER, y: SS.VY0 + len * SS.VYK, z: pz * SS.POWER };
}

// Time until the piece falls back to rest height.
function ssFlightTime(vy, y0) {
  y0 = (y0 === undefined) ? SS.LAUNCH_Y : y0;
  const disc = vy * vy + 2 * SS.G * (y0 - SS.REST_Y);
  return (vy + Math.sqrt(Math.max(disc, 0))) / SS.G;
}

// Ballistic intersection with an arbitrary plane.
// Plane: (p - s)·n = offset. Returns {t, x, y, z} of the DESCENDING
// intersection (piece moving into the plane), or null.
function ssLandingOnPlane(p0, v, s, n, offset) {
  const G = SS.G;
  const A = -0.5 * G * n.y;
  const B = v.x * n.x + v.y * n.y + v.z * n.z;
  const C = (p0.x - s.x) * n.x + (p0.y - s.y) * n.y + (p0.z - s.z) * n.z - offset;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || Math.abs(A) < 1e-9) return null;
  const sqrtD = Math.sqrt(disc);
  const roots = [(-B - sqrtD) / (2 * A), (-B + sqrtD) / (2 * A)].sort((a, b) => b - a);
  for (const t of roots) {
    if (t <= 0) continue;
    // descending into the plane? (velocity into the surface)
    const vdotn = v.x * n.x + (v.y - G * t) * n.y + v.z * n.z;
    if (vdotn < 0) {
      return { t, x: p0.x + v.x * t, y: p0.y + v.y * t - 0.5 * G * t * t, z: p0.z + v.z * t };
    }
  }
  return null;
}

// Analytic landing point from launch position p0 {x,y,z} and velocity v {x,y,z}.
function ssLanding(p0, v) {
  const t = ssFlightTime(v.y, p0.y);
  return { x: p0.x + v.x * t, z: p0.z + v.z * t, t: t };
}

// Sampled trajectory points (for the dotted preview). Returns array of {x,y,z}.
function ssTrajectory(p0, v, n) {
  n = n || 42;
  const t = ssFlightTime(v.y, p0.y);
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const ti = (t * i) / (n + 1);
    pts.push({
      x: p0.x + v.x * ti,
      y: p0.y + v.y * ti - 0.5 * SS.G * ti * ti,
      z: p0.z + v.z * ti,
    });
  }
  return pts;
}

// Position along the flight at time t (analytic -- identical to the preview).
function ssPosAt(p0, v, t) {
  return {
    x: p0.x + v.x * t,
    y: p0.y + v.y * t - 0.5 * SS.G * t * t,
    z: p0.z + v.z * t,
  };
}

// Stick test: does a landing at (lx, lz) stick into the slot?
// Strict: the landing point must be inside the state's actual polygon.
// (The game checks slotAt(landing) === targetIndex, which is equivalent.)
// slot: {cx, cz, r, polys?}
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolys(x, z, polys) {
  for (const poly of polys) {
    if (!pointInRing(x, z, poly[0])) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) if (pointInRing(x, z, poly[i])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}
function ssStickRadius(slot) {
  return Math.max(SS.TOL_MIN, SS.TOL_FRac * slot.r);
}
function ssSticks(lx, lz, slot) {
  if (slot.polys) return pointInPolys(lx, lz, slot.polys);
  // no polys (unit tests) -> radius fallback
  const dx = lx - slot.cx, dz = lz - slot.cz;
  return Math.hypot(dx, dz) <= ssStickRadius(slot);
}

// Clamp a pull vector to the max pull length. Returns {x, z, len}.
function ssClampPull(px, pz) {
  const len = Math.hypot(px, pz);
  if (len <= SS.MAX_PULL || len === 0) return { x: px, z: pz, len: len };
  const k = SS.MAX_PULL / len;
  return { x: px * k, z: pz * k, len: SS.MAX_PULL };
}

// Solve a pull vector that lands the piece at (tx, tz) from pouch p0.
// Direction: straight at the target; line-search the pull length.
function ssSolvePull(p0, tx, tz) {
  let dx = tx - p0.x, dz = tz - p0.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return { x: 0, z: 0 };
  dx /= dist; dz /= dist;
  function errAt(L) {
    const v = ssVelocityForPull(dx * L, dz * L);
    const land = ssLanding({ x: p0.x, y: SS.LAUNCH_Y, z: p0.z }, v);
    return Math.hypot(land.x - tx, land.z - tz);
  }
  let bestL = 0.5, bestErr = errAt(0.5);
  for (let L = 0.5; L <= SS.MAX_PULL; L += 0.1) {           // coarse pass
    const e = errAt(L);
    if (e < bestErr) { bestErr = e; bestL = L; }
  }
  for (let L = Math.max(0.3, bestL - 0.12); L <= Math.min(SS.MAX_PULL, bestL + 0.12); L += 0.01) { // refine
    const e = errAt(L);
    if (e < bestErr) { bestErr = e; bestL = L; }
  }
  return { x: dx * bestL, z: dz * bestL, err: bestErr };
}

// Fisher-Yates shuffle (returns a new array).
function ssShuffle(arr, rnd) {
  rnd = rnd || Math.random;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ---- node self-test ----
if (typeof module !== 'undefined' && require.main === module) {
  const assert = require('assert');

  // 1. Analytic landing matches a finely stepped numeric sim.
  for (const [px, pz] of [[0, 5], [2, -6.3], [-4.1, 3.3], [0.3, 0.9], [7, 0]]) {
    const c = ssClampPull(px, pz);
    const v = ssVelocityForPull(c.x, c.z);
    const p0 = { x: 0, y: SS.LAUNCH_Y, z: 16.5 };
    const land = ssLanding(p0, v);
    // numeric sim
    let x = p0.x, y = p0.y, z = p0.z, vx = v.x, vy = v.y, vz = v.z;
    const dt = 1 / 480; let t = 0;
    while (y > SS.REST_Y && t < 10) { vy -= SS.G * dt; x += vx * dt; y += vy * dt; z += vz * dt; t += dt; }
    assert(Math.abs(x - land.x) < 0.12 && Math.abs(z - land.z) < 0.12,
      `landing mismatch pull=(${px},${pz}): analytic=(${land.x.toFixed(2)},${land.z.toFixed(2)}) sim=(${x.toFixed(2)},${z.toFixed(2)})`);
  }

  // 2. Solver can hit a spread of targets (incl. far corners + tiny-state scale).
  const p0 = { x: 0, z: 16.5 };
  const targets = [[0, -10], [-18, -8], [18, -6], [-5, 6], [8, 4], [-19, 5], [12, -10], [0, 8]];
  for (const [tx, tz] of targets) {
    const pull = ssSolvePull(p0, tx, tz);
    assert(pull.err < 0.15, `solver missed (${tx},${tz}): err=${pull.err}`);
    assert(Math.hypot(pull.x, pull.z) <= SS.MAX_PULL + 1e-9, 'solver exceeded max pull');
  }

  // 3. Stick logic.
  assert(ssSticks(0.5, 0.5, { cx: 0, cz: 0, r: 5 }) === true, 'should stick (big state)');
  assert(ssSticks(3.0, 0, { cx: 0, cz: 0, r: 5 }) === false, 'should not stick (big state, far)');
  assert(ssSticks(1.0, 1.0, { cx: 0, cz: 0, r: 0.36 }) === true, 'tiny state within TOL_MIN sticks');
  assert(ssSticks(1.2, 1.2, { cx: 0, cz: 0, r: 0.36 }) === false, 'tiny state outside TOL_MIN misses');

  // 3b. Polygon stick: inside the actual shape sticks even far from centroid
  // (e.g. Texas panhandle); outside the shape misses.
  const sq = { cx: 0, cz: 0, r: 5, polys: [[[[-5, -5], [5, -5], [5, 5], [-5, 5]]]] };
  assert(ssSticks(4.9, 4.9, sq) === true, 'corner of square polygon sticks');
  assert(ssSticks(4.9, 0, sq) === true, 'edge of square polygon sticks');
  assert(ssSticks(5.1, 0, sq) === false, 'just outside square polygon misses');
  assert(ssSticks(0, 0, sq) === true, 'center sticks');
  // strict: no centroid forgiveness — outside the polygon is a miss even if close
  const tiny = { cx: 0, cz: 0, r: 0.36, polys: [[[[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]]] };
  assert(ssSticks(0.2, 0, tiny) === true, 'inside tiny polygon sticks');
  assert(ssSticks(0.5, 0, tiny) === false, 'just outside tiny polygon misses (no forgiveness)');

  // 4. Range sanity: min pull reaches near targets, max pull reaches far corner.
  // (negative-z pull = drag toward camera = launch up-map, away from camera)
  const vMin = ssVelocityForPull(0, -2), vMax = ssVelocityForPull(0, -7);
  const lMin = ssLanding({ x: 0, y: SS.LAUNCH_Y, z: 16.5 }, vMin);
  const lMax = ssLanding({ x: 0, y: SS.LAUNCH_Y, z: 16.5 }, vMax);
  assert(16.5 - lMin.z > 4 && 16.5 - lMin.z < 16, `min-pull range ${16.5 - lMin.z}`);
  assert(16.5 - lMax.z > 30, `max-pull range ${16.5 - lMax.z}`);

  // 5. Shuffle keeps all elements.
  const sh = ssShuffle([1, 2, 3, 4, 5]);
  assert(sh.slice().sort().join(',') === '1,2,3,4,5', 'shuffle lost elements');

  // 6. Trajectory points are above the table and end near the landing point.
  const v = ssVelocityForPull(1, 5), pp = { x: 0, y: SS.LAUNCH_Y, z: 16.5 };
  const traj = ssTrajectory(pp, v, 42), land = ssLanding(pp, v);
  assert(traj.every(q => q.y > SS.REST_Y - 0.01), 'trajectory dips below rest height');
  const last = traj[traj.length - 1];
  assert(Math.hypot(last.x - land.x, last.z - land.z) < 1.2, 'trajectory end far from landing');

  console.log('logic: all asserts pass');
}
