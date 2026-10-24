// Booth strength heatmap geometry (ported from the live Assembly Details page).
// Boundaries: OpenCity TN assembly polygons, /tn_assembly_boundaries.json, points as [lng, lat].
// Difference from live: booths without GPS (or with GPS outside the assembly) are NOT placed on
// an invented grid. They are counted and listed instead, so every coloured area on the map comes
// from a real booth location.

let boundariesCache = null;

export async function loadBoundaries() {
  if (boundariesCache) return boundariesCache;
  try {
    const res = await fetch('/tn_assembly_boundaries.json');
    if (res.ok) boundariesCache = await res.json();
  } catch { /* map still works without the outline */ }
  return boundariesCache || {};
}

// Ray casting; polygon points are [lng, lat].
export function isPointInPolygon(lat, lng, polygon) {
  if (!polygon || polygon.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const dy = yj - yi;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (Math.abs(dy) < 1e-12 ? 1e-12 : dy) + xi) inside = !inside;
  }
  return inside;
}

// Sutherland–Hodgman: keep the part of `poly` where A*x + B*y + C <= 0.
function clipPolygon(poly, A, B, C) {
  const side = (p) => A * p[0] + B * p[1] + C;
  const cut = (p1, p2) => {
    const d1 = side(p1);
    const denom = d1 - side(p2);
    if (Math.abs(denom) < 1e-12) return p1;
    const t = d1 / denom;
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  };
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = side(cur) <= 0;
    const prevIn = side(prev) <= 0;
    if (curIn) {
      if (!prevIn) out.push(cut(prev, cur));
      out.push(cur);
    } else if (prevIn) out.push(cut(prev, cur));
  }
  return out;
}

// Each booth's area = the part of the assembly closer to it than to any other booth
// (Voronoi cell clipped to the boundary). Returns Leaflet [lat, lng] rings.
export function boothAreas(points, boundary) {
  return points.map((p1, i) => {
    let poly = boundary.slice();
    for (let j = 0; j < points.length && poly.length; j++) {
      if (i === j) continue;
      const p2 = points[j];
      const dx = p2.lng - p1.lng;
      const dy = p2.lat - p1.lat;
      poly = clipPolygon(poly, dx, dy, -(dx * (p1.lng + p2.lng) / 2 + dy * (p1.lat + p2.lat) / 2));
    }
    return { booth: p1, ring: poly.length >= 3 ? poly.map(([lng, lat]) => [lat, lng]) : null };
  });
}

// Five bands by rank, as on live: more voters = red, fewer = green.
export const BANDS = [
  { label: 'Very low', color: '#22C55E' },
  { label: 'Low', color: '#84CC16' },
  { label: 'Moderate', color: '#EAB308' },
  { label: 'High', color: '#F97316' },
  { label: 'Very high', color: '#EF4444' },
];

export function bandOf(value, sortedValues) {
  if (!sortedValues.length) return BANDS[2];
  const rank = sortedValues.indexOf(value);
  const p = rank / Math.max(1, sortedValues.length - 1);
  return BANDS[p >= 0.8 ? 4 : p >= 0.6 ? 3 : p >= 0.4 ? 2 : p >= 0.2 ? 1 : 0];
}

export const METRICS = [
  { id: 'total', label: 'Total', get: (b) => b.voter_count || 0 },
  { id: 'male', label: 'Male', get: (b) => b.male_voters || 0 },
  { id: 'female', label: 'Female', get: (b) => b.female_voters || 0 },
  { id: 'other', label: 'Other', get: (b) => b.other_voters || 0 },
];
