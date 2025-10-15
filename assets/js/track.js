// TRACK: live trail recording, metrics, maps, and KML for the track.

const STORAGE_KEY = "dalitrail:session";
const MAX_SEGMENT_METERS = 150;
const MAX_ACCURACY_METERS = 25;
const MIN_DISPLACEMENT_METERS = 6;

const isIosDevice = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "");
const isAndroidDevice = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "");

const pointsCountText = document.getElementById("points-count");
const distanceText = document.getElementById("distance");
const elapsedText = document.getElementById("elapsed");
const elevationGainText = document.getElementById("elevation-gain");
const elevationLossText = document.getElementById("elevation-loss");
const avgSpeedText = document.getElementById("avg-speed");
const exportSection = document.querySelector(".export");
const statusText = document.getElementById("status-text");

let watchId = null;
let activeStartTime = null;
let elapsedOffset = 0;
let timerId = null;

let points = [];
let lastPoint = null;
let lastAcceptedPoint = null;
let totalDistance = 0;
let hasFinished = false;
let elevationGain = 0;
let elevationLoss = 0;

// ----- utils -----
const toRad = (v) => (v * Math.PI) / 180;
const haversineDistance = (a, b) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const sanitizeAltitude = (alt) => (Number.isFinite(alt) ? alt : null);
const setStatus = (m) => (statusText.textContent = m);
const formatElapsed = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
};

// ----- metrics & persistence -----
export const updateMetrics = () => {
  pointsCountText && (pointsCountText.textContent = points.length);
  distanceText && (distanceText.textContent = `${totalDistance.toFixed(1)} m`);
  elevationGainText && (elevationGainText.textContent = `${elevationGain.toFixed(1)} m`);
  elevationLossText && (elevationLossText.textContent = `${elevationLoss.toFixed(1)} m`);
  const elapsed = elapsedOffset + (activeStartTime ? Date.now() - activeStartTime : 0);
  elapsedText && (elapsedText.textContent = formatElapsed(elapsed));
  const hours = elapsed / 3600000;
  const avgSpeed = hours > 0 ? (totalDistance / 1000) / hours : 0;
  avgSpeedText && (avgSpeedText.textContent = `${avgSpeed.toFixed(2)} km/h`);
};

const startTimer = () => {
  stopTimer();
  timerId = window.setInterval(updateMetrics, 1000);
};
const stopTimer = () => {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
};

const persistTrailState = () => {
  const payload = {
    points,
    totalDistance,
    elevationGain,
    elevationLoss,
    elapsedOffset: elapsedOffset + (activeStartTime ? Date.now() - activeStartTime : 0),
    hasFinished,
    lastPoint,
    lastAcceptedPoint,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.log("Persist failed:", error);
  }
};

export const restoreTrailState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    points = Array.isArray(p.points) ? p.points : [];
    totalDistance = Number(p.totalDistance) || 0;
    elevationGain = Number(p.elevationGain) || 0;
    elevationLoss = Number(p.elevationLoss) || 0;
    elapsedOffset = Number(p.elapsedOffset) || 0;
    hasFinished = Boolean(p.hasFinished);
    lastPoint = p.lastPoint || null;
    lastAcceptedPoint = p.lastAcceptedPoint || null;

    if (points.length > 0) {
      exportSection && (exportSection.hidden = !hasFinished);
      const startBtn = document.getElementById("start-btn");
      if (startBtn) startBtn.textContent = hasFinished ? "Start New" : "Resume";
      setStatus(hasFinished ? "Previous trail finished. Start a new one when ready." : "Trail data restored. Tap Resume to continue tracking.");
    }
    updateMetrics();
  } catch (error) {
    console.log("Restore failed:", error);
  }
  hideLog();
};

const hideLog = () => {
  const section = document.querySelector(".log");
  const btn = document.getElementById("toggle-log-btn");
  if (!section || !btn) return;
  section.hidden = true;
  btn.textContent = "Show Log";
  btn.setAttribute("aria-expanded", "false");
  btn.classList.remove("notify");
};

export const resetTrail = () => {
  points = [];
  lastPoint = null;
  lastAcceptedPoint = null;
  totalDistance = 0;
  elevationGain = 0;
  elevationLoss = 0;
  elapsedOffset = 0;
  activeStartTime = null;
  hasFinished = false;
  exportSection && (exportSection.hidden = true);
  updateMetrics();
  hideLog();
  persistTrailState();
};

// ----- recording -----
export const hasActiveWatch = () => watchId !== null;

export const startTracking = () => {
  if (!navigator.geolocation) return setStatus("Geolocation is not supported by this browser.");

  if (hasFinished) resetTrail();

  const startBtn = document.getElementById("start-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const finishBtn = document.getElementById("finish-btn");

  if (startBtn) startBtn.disabled = true;
  if (pauseBtn) pauseBtn.disabled = false;
  if (finishBtn) finishBtn.disabled = false;
  exportSection && (exportSection.hidden = true);

  if (points.length === 0) elapsedOffset = 0;

  activeStartTime = Date.now();
  startTimer();

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy, altitude } = pos.coords;
      const point = { lat: latitude, lng: longitude, accuracy, timestamp: pos.timestamp, altitude: sanitizeAltitude(altitude) };
      lastPoint = point;

      if (Number.isFinite(point.accuracy) && point.accuracy > MAX_ACCURACY_METERS) {
        console.log(`Skipping point: accuracy ${point.accuracy.toFixed(1)}m exceeds threshold`);
        return;
      }

      if (!lastAcceptedPoint) {
        lastAcceptedPoint = point;
        points.push(point);
        updateMetrics();
        persistTrailState();
        return;
      }

      const displacement = haversineDistance(lastAcceptedPoint, point);
      if (displacement < MIN_DISPLACEMENT_METERS) {
        console.log(`Ignored ${displacement.toFixed(1)}m (below threshold)`);
        return;
      }
      if (displacement > MAX_SEGMENT_METERS) {
        console.log(`Discarded ${displacement.toFixed(1)}m (likely GPS jump)`);
        return;
      }

      totalDistance += displacement;

      if (point.altitude !== null && lastAcceptedPoint.altitude !== null) {
        const dz = point.altitude - lastAcceptedPoint.altitude;
        if (dz > 0) elevationGain += dz;
        else if (dz < 0) elevationLoss += Math.abs(dz);
      }

      lastAcceptedPoint = point;
      points.push(point);
      updateMetrics();
      persistTrailState();
    },
    (error) => {
      setStatus(`Error: ${error.message}`);
      if (error.code === error.PERMISSION_DENIED) {
        setStatus("Location access denied. Enable it in your browser settings to continue.");
      }
      persistTrailState();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );

  setStatus("Recording trail…");
  if (startBtn) startBtn.textContent = "Resume";
  persistTrailState();
};

export const pauseTracking = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (activeStartTime) elapsedOffset += Date.now() - activeStartTime;
  activeStartTime = null;
  stopTimer();

  const startBtn = document.getElementById("start-btn");
  const pauseBtn = document.getElementById("pause-btn");
  if (startBtn) startBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = true;

  setStatus("Trail paused.");
  persistTrailState();
};

export const finishTracking = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  stopTimer();

  if (activeStartTime) elapsedOffset += Date.now() - activeStartTime;
  activeStartTime = null;

  const startBtn = document.getElementById("start-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const finishBtn = document.getElementById("finish-btn");

  if (startBtn) startBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = true;
  if (finishBtn) finishBtn.disabled = true;

  setStatus("Trail finished. Export ready.");
  exportSection && (exportSection.hidden = points.length === 0);
  hasFinished = true;
  if (startBtn) startBtn.textContent = "Start New";
  persistTrailState();
};

// ----- maps export -----
const buildMapsTargets = () => {
  if (points.length === 0) return null;
  const origin = points[0];
  const destination = points[points.length - 1];
  const waypointSlice = points.slice(1, Math.min(points.length - 1, 8));
  const fmt = ({ lat, lng }) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const o = fmt(origin), d = fmt(destination), w = waypointSlice.map(fmt).join("|");

  const googleBase = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}`;
  const googleRouteUrl = waypointSlice.length ? `${googleBase}&waypoints=${encodeURIComponent(w)}` : googleBase;

  const googleMapsAppUrlBase = `comgooglemaps://?directionsmode=walking&saddr=${encodeURIComponent(o)}&daddr=${encodeURIComponent(d)}`;
  const googleMapsAppUrl = waypointSlice.length ? `${googleMapsAppUrlBase}&waypoints=${encodeURIComponent(w)}` : googleMapsAppUrlBase;

  const geoUri = `geo:${d}?q=${encodeURIComponent(`Trail@${d}`)}`;
  const appleMapsAppUrl = `maps://?saddr=${encodeURIComponent(o)}&daddr=${encodeURIComponent(d)}&dirflg=w`;
  const appleMapsWebUrl = `https://maps.apple.com/?saddr=${encodeURIComponent(o)}&daddr=${encodeURIComponent(d)}&dirflg=w`;

  return { googleRouteUrl, googleMapsAppUrl, geoUri, appleMapsAppUrl, appleMapsWebUrl };
};

const encodePolyline = (pts) => {
  let lastLat = 0, lastLng = 0, result = "";
  const enc = (cur, prev) => {
    let v = Math.round(cur * 1e5) - Math.round(prev * 1e5);
    v <<= 1; if (v < 0) v = ~v;
    let out = "";
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
    return out;
  };
  for (const p of pts) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    result += enc(p.lat, lastLat);
    result += enc(p.lng, lastLng);
    lastLat = p.lat; lastLng = p.lng;
  }
  return result;
};

const buildTrailTargets = () => {
  const targets = buildMapsTargets();
  if (!targets) return null;
  const encodedPath = encodePolyline(points);
  const googleEncodedUrl = encodedPath ? `https://www.google.com/maps?q=enc:${encodeURIComponent(encodedPath)}&z=16` : targets.googleRouteUrl;
  const googleMapsPolylineUrl = encodedPath ? `comgooglemaps://?q=enc:${encodedPath}` : "";
  return { ...targets, encodedPath, googleEncodedUrl, googleMapsPolylineUrl };
};

const scheduleFallbackNavigation = (callback, delay = 1200) => {
  const handleVis = () => {
    if (document.hidden) {
      window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVis);
    }
  };
  const timerId = window.setTimeout(() => {
    document.removeEventListener("visibilitychange", handleVis);
    callback();
  }, delay);
  document.addEventListener("visibilitychange", handleVis);
};

const openMapsFallback = (targets) => {
  if (!targets) targets = buildTrailTargets();
  if (!targets) return;
  let url = targets.googleEncodedUrl || targets.googleRouteUrl || targets.appleMapsWebUrl;
  if (isIosDevice) url = targets.appleMapsWebUrl || targets.appleMapsAppUrl || url;
  url ||= targets.geoUri;
  if (!url) return;
  window.location.href = url;
};

export const openRouteInMaps = async () => {
  if (points.length === 0) return alert("You need at least one recorded point before opening in Maps.");
  const targets = buildTrailTargets();
  if (!targets) return alert("Unable to build a maps link for this trail.");

  const { googleMapsAppUrl, googleMapsPolylineUrl, appleMapsAppUrl, appleMapsWebUrl } = targets;
  const tried = new Set();
  const openUrl = (url) => {
    if (!url || tried.has(url)) return false;
    tried.add(url);
    window.location.href = url;
    return true;
  };

  if (isIosDevice) {
    if (openUrl(appleMapsAppUrl)) return scheduleFallbackNavigation(() => openMapsFallback(targets));
    if (openUrl(appleMapsWebUrl)) return;
    if (openUrl(googleMapsPolylineUrl)) return scheduleFallbackNavigation(() => openMapsFallback(targets));
    if (openUrl(googleMapsAppUrl)) return;
  }

  if (isAndroidDevice) {
    if (openUrl(googleMapsAppUrl)) return scheduleFallbackNavigation(() => openMapsFallback(targets));
    if (openUrl(targets.googleRouteUrl)) return;
  }

  if (openUrl(targets.googleRouteUrl)) return;
  if (openUrl(googleMapsAppUrl)) return;
  if (openUrl(googleMapsPolylineUrl)) return;
  openMapsFallback(targets);
};
