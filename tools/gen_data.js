#!/usr/bin/env node
// Decode us-atlas states-10m.json TopoJSON (lon/lat) -> compact game data.
// Projects with d3.geoAlbersUsa (correct; the pre-projected states-albers-10m.json
// has a broken Texas panhandle), then Douglas-Peucker simplifies.
// Output: build/data.js with STATES = [{name, abbr, capital, polys:[[[x,z],...]], cx, cz, r}]
const fs = require('fs');
const path = require('path');
const { geoAlbersUsa } = require('./node_modules/d3-geo');

const topo = JSON.parse(fs.readFileSync(path.join(__dirname, 'states-10m.json'), 'utf8'));
const T = topo.transform, SX = T.scale[0], SY = T.scale[1], TX = T.translate[0], TY = T.translate[1];
const proj = geoAlbersUsa();

// Decode each arc (delta-encoded lon/lat), project to Albers USA (x right, y down).
const decoded = topo.arcs.map(arc => {
  let x = 0, y = 0;
  const pts = [];
  for (let i = 0; i < arc.length; i++) {
    x += arc[i][0]; y += arc[i][1];
    const p = proj([x * SX + TX, y * SY + TY]);
    if (p) pts.push(p); // proj returns null outside the US
  }
  return pts;
});

// Stitch ring arc indices into a point list (negative idx => reversed arc).
function stitch(idxs) {
  const pts = [];
  for (const idx of idxs) {
    let a = decoded[idx < 0 ? ~idx : idx];
    if (idx < 0) a = a.slice().reverse(); else a = a.slice();
    if (pts.length) pts.pop(); // drop duplicated junction point
    for (const p of a) pts.push(p);
  }
  // drop closing duplicate
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) pts.pop();
  }
  return pts;
}

function decimate(pts) {
  // Douglas-Peucker: keeps shape-defining points (corners), drops only
  // truly redundant collinear points. eps is tiny to preserve full detail.
  const eps = 0.5;
  if (pts.length <= 2) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = 0, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0], py = pts[i][1];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps) { keep[maxI] = true; stack.push([a, maxI], [maxI, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const FIPS_ABBR = { '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY','72':'PR' };
const CAPITALS = { Alabama:'Montgomery', Alaska:'Juneau', Arizona:'Phoenix', Arkansas:'Little Rock', California:'Sacramento', Colorado:'Denver', Connecticut:'Hartford', Delaware:'Dover', Florida:'Tallahassee', Georgia:'Atlanta', Hawaii:'Honolulu', Idaho:'Boise', Illinois:'Springfield', Indiana:'Indianapolis', Iowa:'Des Moines', Kansas:'Topeka', Kentucky:'Frankfort', Louisiana:'Baton Rouge', Maine:'Augusta', Maryland:'Annapolis', Massachusetts:'Boston', Michigan:'Lansing', Minnesota:'St. Paul', Mississippi:'Jackson', Missouri:'Jefferson City', Montana:'Helena', Nebraska:'Lincoln', Nevada:'Carson City', 'New Hampshire':'Concord', 'New Jersey':'Trenton', 'New Mexico':'Santa Fe', 'New York':'Albany', 'North Carolina':'Raleigh', 'North Dakota':'Bismarck', Ohio:'Columbus', Oklahoma:'Oklahoma City', Oregon:'Salem', Pennsylvania:'Harrisburg', 'Rhode Island':'Providence', 'South Carolina':'Columbia', 'South Dakota':'Pierre', Tennessee:'Nashville', Texas:'Austin', Utah:'Salt Lake City', Vermont:'Montpelier', Virginia:'Richmond', Washington:'Olympia', 'West Virginia':'Charleston', Wisconsin:'Madison', Wyoming:'Cheyenne' };

const states = [];
for (const g of topo.objects.states.geometries) {
  const id = String(g.id).padStart(2, '0');
  if (id === '11' || id === '72' || id === '60' || id === '66' || id === '69' || id === '78') continue; // skip DC, PR, territories
  const polys = [];
  const polysRaw = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  for (const poly of polysRaw) {
    const rings = poly.map(ringIdxs => decimate(stitch(ringIdxs))).filter(r => r.length >= 3);
    if (rings.length) polys.push(rings);
  }
  if (!polys.length) { console.warn('no rings for', g.properties.name); continue; }
  states.push({ name: g.properties.name, abbr: FIPS_ABBR[id] || id, polys });
}
states.sort((a, b) => a.name.localeCompare(b.name));

// bbox over everything
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (const s of states) for (const poly of s.polys) for (const ring of poly) for (const p of ring) {
  if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
  if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
}
// Fit into map rect: 40 wide x 20 tall, centered at (0, -1.5) leaving front room for slingshot.
const TARGET_W = 40, TARGET_H = 20, CX = 0, CZ = -1.5;
const sc = Math.min(TARGET_W / (x1 - x0), TARGET_H / (y1 - y0));
const ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
const X = x => (x - ox) * sc + CX;
const Z = y => (y - oy) * sc + CZ;

// centroid (largest polygon) + bounding radius per state
function polyArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a / 2);
}
for (const s of states) {
  let best = null, bestA = -1;
  for (const poly of s.polys) { const a = polyArea(poly[0]); if (a > bestA) { bestA = a; best = poly[0]; } }
  let mx = 0, my = 0;
  for (const p of best) { mx += X(p[0]); my += Z(p[1]); }
  mx /= best.length; my /= best.length;
  let r = 0;
  for (const poly of s.polys) for (const p of poly[0]) {
    const dx = X(p[0]) - mx, dy = Z(p[1]) - my, d = Math.sqrt(dx * dx + dy * dy);
    if (d > r) r = d;
  }
  s.cx = +mx.toFixed(3); s.cz = +my.toFixed(3); s.r = +r.toFixed(3);
  s.polys = s.polys.map(poly => poly.map(ring => ring.map(p => [+X(p[0]).toFixed(3), +Z(p[1]).toFixed(3)])));
}

let totalPts = 0;
for (const s of states) for (const poly of s.polys) for (const ring of poly) totalPts += ring.length;

const out = 'const STATES = ' + JSON.stringify(states.map(s => ({
  name: s.name, abbr: s.abbr, capital: CAPITALS[s.name] || '', cx: s.cx, cz: s.cz, r: s.r, polys: s.polys
}))) + ';\n';
const dest = path.join(__dirname, '..', 'build', 'data.js');
fs.writeFileSync(dest, out);
console.log(`wrote ${dest}: ${states.length} states, ${totalPts} pts, ${(out.length / 1024).toFixed(1)} KB`);
