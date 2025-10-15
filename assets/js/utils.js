// assets/js/utils.js

// --- Math & geo ---
export const R_EARTH_M = 6371000;
export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;

export function haversineMeters(a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);
  const sinΔφ2 = Math.sin(Δφ / 2), sinΔλ2 = Math.sin(Δλ / 2);
  const h = sinΔφ2 * sinΔφ2 + Math.cos(φ1) * Math.cos(φ2) * sinΔλ2 * sinΔλ2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R_EARTH_M * c;
}

export function distanceAndDirection(a, b) {
  const meters = haversineMeters(a, b);
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let bearing = toDeg(Math.atan2(y, x));
  bearing = (bearing + 360) % 360;
  const labels = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const compass = labels[Math.round(bearing / 22.5) % 16];
  return { meters, kilometers: meters / 1000, bearingDegrees: bearing, compass };
}

// --- Formatting ---
export const formatTimestamp = (value) => new Date(value).toLocaleString();
export const formatElevation = (alt) =>
  Number.isFinite(alt) ? `Elevation: ${alt.toFixed(1)} m` : "Elevation: not available";

// --- General helpers ---
export const round6 = (n) => Number.parseFloat(n).toFixed(6);
export function dedupeByKey(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const item of arr) { const k = keyFn(item); if (!seen.has(k)) { seen.add(k); out.push(item); } }
  return out;
}

// --- KML helpers ---
export function parseIsoTime(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function parseKmlCoordinateList(coordText) {
  // "lon,lat[,alt] lon,lat[,alt] ..."
  return coordText
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(",").map((n) => Number(n)))
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    .map(([lng, lat, alt]) => ({ lat, lng, alt: Number.isFinite(alt) ? alt : null }));
}

export function sampleLineVertices(coords, cap = 50) {
  if (coords.length <= 2) return coords;
  const stride = Math.max(1, Math.ceil(coords.length / cap));
  const out = [coords[0]];
  for (let i = stride; i < coords.length - 1; i += stride) out.push(coords[i]);
  out.push(coords[coords.length - 1]);
  return out;
}

// --- Env ---
export const isSecure =
  window.isSecureContext || window.location.hostname === "localhost";
