// /assets/js/utils.js
// Reusable utilities shared by DaliTrail modules.
// - No dependencies
// - Safe for offline use
// - Tree-shake friendly

// --------------------- Environment ---------------------
export const isSecure = (typeof window !== "undefined")
  && (window.isSecureContext || window.location.hostname === "localhost");

// --------------------- Time & Formatting ----------------
export const formatTimestamp = (value) =>
  new Date(value).toLocaleString();

export const formatElevation = (alt) =>
  Number.isFinite(alt) ? `Elevation: ${alt.toFixed(1)} m` : "Elevation: not available";

export const parseIsoTime = (s) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

// utils.js — lightweight app logger (no deps on main.js)
export function getPendingLogCount() { return _pendingLogs.length; }


// In-memory buffer so logs emitted before main.js is ready aren't lost.
const _pendingLogs = [];

/**
 * App-wide logging function. If main.js has registered a logger via setLogger()
 * or exposed window.LogAppEvent, we call it immediately. Otherwise:
 *  - we buffer the event
 *  - we also emit a DOM event 'dalitrail:log' for any listener that wants it
 */
export function logAppEvent(event, data = {}) {
  try {
    if (typeof window !== "undefined" && typeof window.LogAppEvent === "function") {
      window.LogAppEvent(event, data);
      return;
    }
  } catch {}

  // No logger yet — buffer the log and also broadcast a DOM event (best-effort)
  _pendingLogs.push({ event, data, ts: Date.now() });
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("dalitrail:log", { detail: { event, data } }));
    }
  } catch {}
}

/**
 * Called by main.js when its real logger is ready.
 * This sets a global logger and flushes any buffered events.
 */
export function setLogger(fn) {
  if (typeof fn !== "function") return;
  try {
    window.LogAppEvent = fn; // standardize the sink
  } catch {}
  // Flush buffered logs
  while (_pendingLogs.length) {
    const { event, data } = _pendingLogs.shift();
    try { fn(event, data); } catch {}
  }
}


// --------------------- Math / Geo -----------------------
const toRad = (v) => (v * Math.PI) / 180;
const toDeg = (v) => (v * 180) / Math.PI;

export const round6 = (n) => Number.parseFloat(n).toFixed(6);

export const dedupeByKey = (arr, keyFn) => {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
};

// Haversine distance in meters between {lat,lng} pairs
export const haversineMeters = (a, b) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

// Bearing from 'from' to 'to' in degrees [0..360), also a short compass label
export function distanceAndDirection(from, to) {
  const meters = haversineMeters(from, to);
  const φ1 = toRad(from.lat), φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let brng = toDeg(Math.atan2(y, x)); // [-180..+180]
  brng = (brng + 360) % 360; // [0..360)
  const compass = bearingToCompass(brng);
  return { meters, bearingDegrees: brng, compass };
}

function bearingToCompass(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
                "S","SSW","SW","WSW","W","WNW","NW","NNW","N"];
  const idx = Math.round(deg / 22.5);
  return dirs[idx];
}

// --------------------- KML helpers ----------------------
export function parseKmlCoordinateList(coordText) {
  // "lon,lat[,alt] lon,lat[,alt] ..."
  return coordText
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(",").map((n) => Number(n)))
    .filter((arr) => Number.isFinite(arr[0]) && Number.isFinite(arr[1]))
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


// utils.js — replace your sunrise/sunset with this
export function getSunTimes(lat, lng, date = new Date()) {
  // Returns local Date objects for sunrise/sunset, or null if no event.
  // NOAA algorithm with solar zenith = 90.833° (official).
  const ZENITH = 90.833; // degrees

  // helpers
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const normalizeDeg = (a) => ((a % 360) + 360) % 360;

  // day of year in local time
  const localY = date.getFullYear();
  const localM = date.getMonth();      // 0-11
  const localD = date.getDate();       // 1-31
  const localMidnight = new Date(localY, localM, localD, 0, 0, 0, 0);

  const startOfYear = new Date(localY, 0, 1);
  const N = Math.floor((localMidnight - startOfYear) / 86400000) + 1; // 1..366

  // longitude hour
  const lngHour = lng / 15;

  function compute(isSunrise) {
    // approximate time
    const t = N + ((isSunrise ? 6 : 18) - lngHour) / 24;

    // Sun's mean anomaly
    const M = 0.9856 * t - 3.289;

    // Sun's true longitude
    let L = M + 1.916 * Math.sin(toRad(M)) + 0.020 * Math.sin(toRad(2 * M)) + 282.634;
    L = normalizeDeg(L);

    // Right ascension
    let RA = toDeg(Math.atan(0.91764 * Math.tan(toRad(L))));
    RA = normalizeDeg(RA);

    // RA quadrant correction
    const Lquadrant = Math.floor(L / 90) * 90;
    const RAquadrant = Math.floor(RA / 90) * 90;
    RA = RA + (Lquadrant - RAquadrant);

    RA = RA / 15; // hours

    // Sun's declination
    const sinDec = 0.39782 * Math.sin(toRad(L));
    const cosDec = Math.cos(Math.asin(sinDec));

    // Sun local hour angle
    const cosH = (Math.cos(toRad(ZENITH)) - sinDec * Math.sin(toRad(lat))) /
                 (cosDec * Math.cos(toRad(lat)));

    if (cosH > 1) return null;   // Sun never rises on this date at this location
    if (cosH < -1) return null;  // Sun never sets on this date at this location

    // H (in degrees)
    let H = isSunrise ? (360 - toDeg(Math.acos(cosH))) : toDeg(Math.acos(cosH));
    H = H / 15; // hours

    // Local mean time
    const T = H + RA - 0.06571 * t - 6.622;

    // UT in hours
    let UT = T - lngHour;
    // normalize 0..24
    UT = ((UT % 24) + 24) % 24;

    // Build a UTC Date at the same local calendar date + UT hours
    const utcMs = Date.UTC(localY, localM, localD, 0, 0, 0, 0) + UT * 3600000;

    // Convert to local Date object (constructor will apply TZ/DST)
    return new Date(utcMs);
  }

  const sunrise = compute(true);
  const sunset  = compute(false);
  return { sunrise, sunset };
}

// Optional pretty formatter:
export function formatLocalTime(dt) {
  if (!dt) return "—";
  return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}


// ---- NOAA helpers (angles in radians unless noted) ----
function julianDayUTC(year, month, day) {
  // Fliegel–Van Flandern algorithm at 12:00 UTC for stability
  if (month <= 2) { year -= 1; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  const JD0 = Math.floor(365.25 * (year + 4716))
            + Math.floor(30.6001 * (month + 1))
            + day + B - 1524.5;
  return JD0; // at 00:00 UTC; we’ll work in minutes offset separately
}

function geomMeanLongSun(T) { // degrees [0..360)
  let L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  L0 = ((L0 % 360) + 360) % 360;
  return L0;
}

function geomMeanAnomSun(T) { // degrees
  return 357.52911 + T * (35999.05029 - 0.0001537 * T);
}

function eccentEarthOrbit(T) {
  return 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
}

function sunEqOfCenter(T) {
  const M = toRad(geomMeanAnomSun(T));
  return toDeg(
    Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M) * 0.000289
  );
}

function sunTrueLong(T) {
  return geomMeanLongSun(T) + sunEqOfCenter(T);
}

function sunAppLong(T) {
  const O = sunTrueLong(T);
  const omega = 125.04 - 1934.136 * T;
  return O - 0.00569 - 0.00478 * Math.sin(toRad(omega));
}

function meanObliqEcliptic(T) {
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  return 23 + (26 + (seconds / 60)) / 60; // degrees
}

function obliqCorr(T) {
  const e0 = meanObliqEcliptic(T);
  const omega = 125.04 - 1934.136 * T;
  return e0 + 0.00256 * Math.cos(toRad(omega)); // degrees
}

function sunDeclination(T) {
  const e = toRad(obliqCorr(T));
  const λ = toRad(sunAppLong(T));
  return Math.asin(Math.sin(e) * Math.sin(λ)); // radians
}

function equationOfTime(T) {
  // minutes
  const ε = toRad(obliqCorr(T));
  const L0 = toRad(geomMeanLongSun(T));
  const e = eccentEarthOrbit(T);
  const M = toRad(geomMeanAnomSun(T));

  const y = Math.tan(ε / 2); // radians
  const y2 = y * y;

  const sin2L0 = Math.sin(2 * L0);
  const sinM = Math.sin(M);
  const cos2L0 = Math.cos(2 * L0);
  const sin4L0 = Math.sin(4 * L0);
  const sin2M = Math.sin(2 * M);

  const E = y2 * sin2L0 - 2 * e * sinM + 4 * e * y2 * sinM * cos2L0
          - 0.5 * y2 * y2 * sin4L0 - 1.25 * e * e * sin2M;

  return toDeg(E) * 4.0; // minutes of time
}

// Hour angle at sunrise/sunset (degrees) for solar zenith 90.833° (includes refraction & solar radius)
function hourAngleSunrise(latDeg, declRad) {
  const φ = toRad(latDeg);
  const cosH = (Math.cos(toRad(90.833)) - Math.sin(φ) * Math.sin(declRad)) / (Math.cos(φ) * Math.cos(declRad));
  if (cosH < -1 || cosH > 1) return NaN; // no sunrise/sunset
  return toDeg(Math.acos(cosH)); // degrees
}

function solarNoonUTC(lngDeg, T) {
  // minutes from 00:00 UTC
  const eqt = equationOfTime(T);
  return 720 - 4 * lngDeg - eqt;
}

function minutesToLocalDate(y, m0, d, minutesUTC) {
  // Construct a UTC Date at 00:00 and add minutes, then convert to local tz automatically
  const ms = Date.UTC(y, m0, d, 0, 0, 0, 0) + Math.round(minutesUTC * 60 * 1000);
  return new Date(ms);
}

// --- Moon rise/set (offline approximate) ------------------------------------
// Based on standard low-precision lunar position formulas and a simple
// horizon-crossing scan in local time. Good to ~5–10 minutes for most latitudes.

const DEG = Math.PI / 180;
const RAD = 1 / DEG;

function jdFromDate(d) {
  return (d.getTime() / 86400000) + 2440587.5;
}
function dateFromJd(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}
function normalizeAngle(a) {
  return (a % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
}

// Greenwich Mean Sidereal Time (radians)
function gmstRad(jd) {
  const T = (jd - 2451545.0) / 36525;
  let gmst = 67310.54841 +
    (876600 * 3600 + 8640184.812866) * T +
    0.093104 * T * T -
    6.2e-6 * T * T * T; // seconds
  gmst = ((gmst % 86400) + 86400) % 86400;
  return (gmst / 86400) * 2 * Math.PI;
}

// Moon geocentric ecliptic longitude/latitude and distance (radians, km)
// Low-precision series (good enough for rise/set)
function moonEcliptic(jd) {
  const T = (jd - 2451545.0) / 36525;

  const L0 = normalizeAngle((218.3164477 + 481267.88123421 * T
           - 0.0015786 * T*T + T*T*T/538841 - T*T*T*T/65194000) * DEG);
  const D  = normalizeAngle((297.8501921 + 445267.1114034 * T
           - 0.0018819 * T*T + T*T*T/545868 - T*T*T*T/113065000) * DEG);
  const M  = normalizeAngle((357.5291092 + 35999.0502909 * T
           - 0.0001536 * T*T + T*T*T/24490000) * DEG);
  const M1 = normalizeAngle((134.9633964 + 477198.8675055 * T
           + 0.0087414 * T*T + T*T*T/69699 - T*T*T*T/14712000) * DEG);
  const F  = normalizeAngle((93.2720950 + 483202.0175233 * T
           - 0.0036539 * T*T - T*T*T/3526000 + T*T*T*T/863310000) * DEG);

  // Major terms only (enough for rise/set altitude)
  const sinD = Math.sin(D), cosD = Math.cos(D);
  const sinM1 = Math.sin(M1), cosM1 = Math.cos(M1);
  const sin2D = Math.sin(2*D), sin2F = Math.sin(2*F);

  // Ecliptic longitude (lambda) corrections (radians)
  let lon = L0
    + (-1.274 * DEG) * Math.sin(M1 - 2*D)    // Evection
    + ( 0.658 * DEG) * Math.sin(2*D)         // Variation
    + (-0.186 * DEG) * Math.sin(M)           // Annual equation
    + (-0.059 * DEG) * Math.sin(2*M1 - 2*D)
    + (-0.057 * DEG) * Math.sin(M1 - 2*D + M)
    + ( 0.053 * DEG) * Math.sin(M1 + 2*D)
    + ( 0.046 * DEG) * Math.sin(2*D - M)
    + ( 0.041 * DEG) * Math.sin(M1 - M)
    + (-0.035 * DEG) * Math.sin(D)
    + (-0.031 * DEG) * Math.sin(M1 + M)
    + (-0.015 * DEG) * Math.sin(2*F - 2*D)
    + ( 0.011 * DEG) * Math.sin(M1 - 4*D);

  // Ecliptic latitude (beta) (radians)
  let lat = (5.128 * DEG) * Math.sin(F)
    + (0.280 * DEG) * Math.sin(M1 + F)
    + (0.277 * DEG) * Math.sin(M1 - F)
    + (0.173 * DEG) * Math.sin(2*D - F)
    + (0.055 * DEG) * Math.sin(2*D + F - M1)
    + (0.046 * DEG) * Math.sin(2*D - F - M1)
    + (0.033 * DEG) * Math.sin(2*D + F)
    + (0.017 * DEG) * Math.sin(2*M1 + F);

  // Distance not required for rise/set (only for parallax refining); skip

  return { lon, lat };
}

// Convert ecliptic -> equatorial (right ascension/declination)
function eclipticToEquatorial(lon, lat, jd) {
  const T = (jd - 2451545.0) / 36525;
  // Mean obliquity of the ecliptic (IAU 2006-ish)
  const eps = (23.439291 - 0.0130042 * T) * DEG;
  const sinE = Math.sin(eps), cosE = Math.cos(eps);

  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);

  const x = cosLon * cosLat;
  const y = sinLon * cosLat * cosE - sinLat * sinE;
  const z = sinLon * cosLat * sinE + sinLat * cosE;

  const ra = Math.atan2(y, x);             // radians
  const dec = Math.asin(z);                // radians
  return { ra: normalizeAngle(ra), dec };
}

// Topocentric altitude for body with RA/Dec at observer lat/lng
function topoAltitude(jd, ra, dec, latRad, lngRad) {
  const lst = gmstRad(jd) + lngRad;          // local sidereal
  const H = normalizeAngle(lst - ra);        // hour angle
  const sinAlt = Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(H);
  // Simple refraction & moon semidiameter approximation: use -0.3° horizon
  const alt = Math.asin(sinAlt) * RAD;
  return alt;
}

// Scan the day for crossings of the (approx) horizon altitude threshold.
export function getMoonTimes(lat, lng, date = new Date()) {
  const tzMin = -date.getTimezoneOffset(); // minutes east of UTC
  // Start at local midnight
  const localMidnight = new Date(date);
  localMidnight.setHours(0, 0, 0, 0);

  const latRad = lat * DEG;
  const lngRad = lng * DEG;

  // apparent “horizon” for Moon: include refraction & semidiameter
  const HORIZON_DEG = -0.3;
  const HORIZON_RAD = HORIZON_DEG * DEG;

  let rise = null, set = null;
  let prevAlt = null, prevJd = null;

  // 2-minute steps across 24h (720 samples)
  for (let m = 0; m <= 24 * 60; m += 2) {
    const t = new Date(localMidnight.getTime() + m * 60000);
    const jd = jdFromDate(t);

    // Moon RA/Dec
    const { lon, lat: elat } = moonEcliptic(jd);
    const { ra, dec } = eclipticToEquatorial(lon, elat, jd);

    const altRad = topoAltitude(jd, ra, dec, latRad, lngRad) * DEG; // in degrees
    const alt = altRad * DEG; // (ensure consistent vars if reused; not critical)

    if (prevAlt !== null) {
      const crossedUp = prevAlt < HORIZON_RAD && alt >= HORIZON_RAD;
      const crossedDown = prevAlt >= HORIZON_RAD && alt < HORIZON_RAD;

      if (crossedUp && !rise) {
        // linear interpolate time of crossing
        const f = (HORIZON_RAD - prevAlt) / (alt - prevAlt);
        const tRise = new Date(localMidnight.getTime() + ((m - 2) + 2 * f) * 60000);
        rise = tRise;
      }
      if (crossedDown && !set) {
        const f = (HORIZON_RAD - prevAlt) / (alt - prevAlt);
        const tSet = new Date(localMidnight.getTime() + ((m - 2) + 2 * f) * 60000);
        set = tSet;
      }
    }

    prevAlt = HORIZON_RAD ? (altRad * DEG) : altRad; // keep consistent; not used elsewhere
    prevAlt = altRad; // override to real rad value
    prevJd = jd;
  }

  // Edge conditions
  let alwaysUp = false, alwaysDown = false;
  if (!rise && !set) {
    // Sample noon altitude to decide
    const noon = new Date(localMidnight.getTime() + 12 * 3600000);
    const jdNoon = jdFromDate(noon);
    const { lon, lat: elat } = moonEcliptic(jdNoon);
    const { ra, dec } = eclipticToEquatorial(lon, elat, jdNoon);
    const altNoon = topoAltitude(jdNoon, ra, dec, latRad, lngRad);
    if (altNoon > HORIZON_RAD) alwaysUp = true; else alwaysDown = true;
  }

  return { moonrise: rise, moonset: set, alwaysUp, alwaysDown };
}

// --- Moon phase (offline) ----------------------------------------------------
// Uses simple Sun/Moon ecliptic longitudes to estimate elongation and phase.
// Good to a few minutes/percent; perfect for a field tool.

//const DEG = Math.PI / 180;
//const RAD = 1 / DEG;
const SYNODIC_MONTH = 29.530588861; // days

//function jdFromDate(d) { return (d.getTime() / 86400000) + 2440587.5; }
//function normalizeAngle(a) { return (a % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); }

// Low-precision Sun true ecliptic longitude (radians)
function sunEclipticLongitude(jd) {
  const T = (jd - 2451545.0) / 36525;
  // mean longitude (deg)
  let L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  L0 = (L0 % 360 + 360) % 360;

  // mean anomaly (deg)
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;

  // equation of center (deg)
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * DEG)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * M * DEG)
          + 0.000289 * Math.sin(3 * M * DEG);

  const trueLon = (L0 + C) * DEG;
  return normalizeAngle(trueLon);
}


// Human-friendly phase name from elongation (radians)
function phaseNameFromElong(elongRad) {
  const deg = elongRad * RAD;
  const wrap = (x) => (x + 360) % 360;
  const d = wrap(deg);
  if (d <  11.25 || d >= 348.75) return "New Moon";
  if (d <  33.75) return "Waxing Crescent";
  if (d <  56.25) return "Waxing Crescent";
  if (d <  78.75) return "First Quarter (approx)";
  if (d < 101.25) return "Waxing Gibbous";
  if (d < 123.75) return "Waxing Gibbous";
  if (d < 146.25) return "Waxing Gibbous";
  if (d < 168.75) return "Waxing Gibbous";
  if (d < 191.25) return "Full Moon";
  if (d < 213.75) return "Waning Gibbous";
  if (d < 236.25) return "Waning Gibbous";
  if (d < 258.75) return "Last Quarter (approx)";
  if (d < 281.25) return "Waning Crescent";
  if (d < 303.75) return "Waning Crescent";
  if (d < 326.25) return "Waning Crescent";
  return "Waning Crescent";
}

// Main export
export function getMoonPhase(date = new Date()) {
  const jd = jdFromDate(date);
  const sunLon  = sunEclipticLongitude(jd);
  const { lon: moonLon } = moonEcliptic(jd);

  // Elongation (Sun->Moon angle) in [0, 2π)
  const elong = normalizeAngle(moonLon - sunLon);

  // Fraction illuminated (0=new, 1=full), simple approximation
  const fraction = (1 - Math.cos(elong)) / 2;

  // Age in days within the synodic cycle
  const ageDays = (elong / (2 * Math.PI)) * SYNODIC_MONTH;

  // Proximity helpers
  const daysToNew  = SYNODIC_MONTH - ageDays;
  const daysToFull = Math.abs(SYNODIC_MONTH / 2 - ageDays);
  const isNearNew  = Math.min(ageDays, daysToNew) < 1.0;
  const isNearFull = daysToFull < 1.0;

  return {
    fraction,                    // 0..1
    ageDays,                     // 0..29.53
    elongationRad: elong,        // radians
    phaseName: phaseNameFromElong(elong),
    isNearNew,
    isNearFull,
    daysToNew,
    daysToFull,
  };
}


// --------------------- Exports summary ------------------
// - isSecure
// - formatTimestamp
// - formatElevation
// - parseIsoTime
// - haversineMeters
// - distanceAndDirection
// - round6
// - dedupeByKey
// - parseKmlCoordinateList
// - sampleLineVertices
// - getSunTimes
// - getMoonTimes
