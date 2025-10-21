// /assets/js/sketch-map.js
// Sketch map overlay used for two flows:
// 1) Walk-to-location flow (live navigation with tracking).
// 2) Plot selected saved locations (relative distances).

import { haversineMeters, distanceAndDirection } from "/assets/js/utils.js";

// Public API ------------------------------------------------------------------

export function openSketchMap(input) {
  return openSketchMapOverlay(input);
}

export default openSketchMap;

export function openSketchMapOverlay(input) {
  const opts = normalizeInput(input);
  if (opts.recordTrail || hasTarget(opts)) {
    return openNavigateOverlay(opts);
  }
  return openPlotOverlay(opts);
}

// ---------- Navigate Mode (Walk to a target) ---------------------------------

const MAX_TRACK_POINTS = 1500;
const MIN_TRACK_DELTA_METERS = 6;
const REQUIRED_ANCHOR_SAMPLES = 3;
const ANCHOR_MAX_ACCURACY_METERS = 45;
const ANCHOR_TIMEOUT_MS = 3000;

function openNavigateOverlay({ target, liveTrack = true, follow = true, recordTrail = false, onSaveTrail = null, initialAnchor = null }) {
  const hasTargetPoint = hasTarget({ target });
  if (!recordTrail && !hasTargetPoint) {
    throw new Error("openNavigateOverlay requires a target with lat/lng.");
  }

  const targetPoint = hasTargetPoint
    ? {
        lat: Number(target.lat),
        lng: Number(target.lng),
        note: typeof target.note === "string" && target.note.trim() ? target.note.trim() : "Target",
      }
    : null;

  const title = recordTrail ? "Track recorder" : "Sketch map";
  const legendHtml = recordTrail
    ? `<div class="sketch-legend">
         <span class="dot me"></span> You
         <span class="line path"></span> Track
       </div>`
    : `<div class="sketch-legend">
         <span class="dot me"></span> You
         <span class="dot target"></span> Target
         <span class="line path"></span> Track
       </div>`;
  const statsHtml = recordTrail
    ? `<div class="sketch-stats">
         <div><span class="label">Distance</span> <span id="sketch-distance">0 m</span></div>
         <div><span class="label">Avg speed</span> <span id="sketch-speed">0 km/h</span></div>
         <div><span class="label">Direction</span> <span id="sketch-heading">N/A</span></div>
       </div>`
    : "";

  const overlay = document.createElement("div");
  overlay.className = "sketch-overlay";
  overlay.innerHTML = `
    <div class="sketch-panel" role="dialog" aria-modal="true" aria-label="Sketch map">
      <header class="sketch-header">
        <h2>${title}</h2>
        <div class="sketch-actions">
          ${recordTrail ? '<button class="btn btn-outline sketch-save">Save track</button>' : ""}
          <button class="btn btn-outline sketch-toggle-follow">${follow ? "Unpin me" : "Follow me"}</button>
          <button class="btn btn-outline sketch-fit">Fit</button>
          <button class="btn btn-outline sketch-close">Close</button>
        </div>
      </header>
      <div class="sketch-body">
        <canvas id="sketch-canvas" aria-label="Sketch map canvas"></canvas>
        ${legendHtml}
        ${statsHtml}
        <div class="sketch-readout" id="sketch-readout">Waiting for GPS fix...</div>
      </div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .sketch-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center;padding:1rem}
    .sketch-panel{background:#fff;color:#111827;max-width:960px;width:min(96%,960px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:1rem;border:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){.sketch-panel{background:#0f172a;color:#f8fafc;border-color:rgba(255,255,255,.12)}}
    .sketch-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
    .sketch-header h2{margin:0;font-size:1.15rem;font-weight:700;letter-spacing:.2px}
    .sketch-actions{display:flex;gap:.5rem}
    .sketch-body{display:grid;gap:.5rem}
    #sketch-canvas{display:block;width:min(92vw,900px);height:min(72vh,520px);background:#ffffff;border-radius:12px;border:1px solid rgba(0,0,0,.1)}
    @media (prefers-color-scheme: dark){#sketch-canvas{background:#0b1220;border-color:rgba(255,255,255,.1)}}
    .sketch-legend{display:flex;gap:1rem;align-items:center;font-size:.95rem;opacity:.9}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%}
    .dot.me{background:#2563eb}
    .dot.target{background:#f97316}
    .line.path{display:inline-block;width:22px;height:0;border-top:3px solid #22c55e;border-radius:2px}
    .sketch-stats{display:grid;gap:.4rem;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));font-size:.95rem;opacity:.9}
    .sketch-stats .label{display:block;font-weight:700;letter-spacing:.02em;color:#475569}
    @media (prefers-color-scheme: dark){.sketch-stats .label{color:#cbd5f5}}
    .sketch-readout{font-family:ui-monospace,monospace;font-size:.95rem;opacity:.9}
    .sketch-actions .btn{padding:.55rem 1rem;font-size:1rem;border-radius:14px;font-weight:600;border-width:2px;background:rgba(37,99,235,0.12);color:#1d4ed8;border-color:rgba(37,99,235,0.55);box-shadow:0 6px 16px rgba(37,99,235,0.25)}
    .sketch-actions .btn.sketch-close{color:#dc2626;border-color:rgba(220,38,38,0.5);background:rgba(220,38,38,0.12);box-shadow:0 6px 16px rgba(220,38,38,0.2)}
    .sketch-actions .btn:focus-visible{outline:3px solid rgba(59,130,246,0.75);outline-offset:2px}
    .sketch-actions .btn:active{transform:scale(.97)}
    @media (prefers-color-scheme: dark){
      .sketch-actions .btn{background:rgba(96,165,250,0.22);color:#e0f2fe;border-color:rgba(191,219,254,0.65);box-shadow:0 8px 20px rgba(59,130,246,0.35)}
      .sketch-actions .btn.sketch-close{color:#fecaca;border-color:rgba(248,113,113,0.55);background:rgba(248,113,113,0.22);box-shadow:0 8px 20px rgba(248,113,113,0.3)}
      .sketch-stats .label{color:#e2e8f0}
    }
    @media (hover:none){
      .sketch-actions .btn{border-color:rgba(37,99,235,0.75);background:rgba(37,99,235,0.2)}
      .sketch-actions .btn.sketch-close{border-color:rgba(220,38,38,0.7);background:rgba(220,38,38,0.22)}
    }
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("#sketch-canvas");
  const ctx = canvas.getContext("2d");
  const readout = overlay.querySelector("#sketch-readout");
  const btnClose = overlay.querySelector(".sketch-close");
  const btnFollow = overlay.querySelector(".sketch-toggle-follow");
  const btnFit = overlay.querySelector(".sketch-fit");
  const btnSave = recordTrail ? overlay.querySelector(".sketch-save") : null;
  const distanceEl = recordTrail ? overlay.querySelector("#sketch-distance") : null;
  const speedEl = recordTrail ? overlay.querySelector("#sketch-speed") : null;
  const headingEl = recordTrail ? overlay.querySelector("#sketch-heading") : null;

  const anchorSamples = [];
  let anchorStartTime = null;
  let anchorPoint = null;
  const camera = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
  let followMe = !!follow;
  let origin = targetPoint ? { lat: targetPoint.lat, lng: targetPoint.lng } : { lat: 0, lng: 0 };
  let me = null;
  const track = [];
  let watchId = null;
  let trackStartTime = null;
  let lastHeading = null;
  let lastFixTimestamp = null;
  let cumulativeDistance = 0;
  const saveCallback = typeof onSaveTrail === "function" ? onSaveTrail : null;
  let saveInProgress = false;

  if (
    recordTrail &&
    initialAnchor &&
    Number.isFinite(Number(initialAnchor.lat)) &&
    Number.isFinite(Number(initialAnchor.lng))
  ) {
    const lat = Number(initialAnchor.lat);
    const lng = Number(initialAnchor.lng);
    const ts = Number(initialAnchor.timestamp) || Date.now();
    const acc = Number(initialAnchor.accuracy);
    const normalizedAccuracy = Number.isFinite(acc) ? acc : null;
    anchorPoint = { lat, lng, accuracy: normalizedAccuracy, timestamp: ts };
    const anchorRecord = {
      lat,
      lng,
      accuracy: normalizedAccuracy,
      timestamp: ts,
    };
    track.push(anchorRecord);
    cumulativeDistance = 0;
    trackStartTime = ts;
    lastFixTimestamp = ts;
    me = { lat, lng, accuracy: normalizedAccuracy, timestamp: ts };
  }

  const formatDistance = (meters) => {
    if (!Number.isFinite(meters) || meters <= 0) return "0 m";
    if (meters < 1000) return `${meters < 100 ? meters.toFixed(1) : meters.toFixed(0)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const formatDuration = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const updateStats = () => {
    if (!recordTrail || !distanceEl || !speedEl || !headingEl) return;
    distanceEl.textContent = formatDistance(cumulativeDistance);
    const elapsedMs = trackStartTime && lastFixTimestamp ? Math.max(0, lastFixTimestamp - trackStartTime) : 0;
    const avgSpeed = elapsedMs > 0 ? (cumulativeDistance / (elapsedMs / 1000)) * 3.6 : 0;
    speedEl.textContent = `${avgSpeed.toFixed(avgSpeed >= 10 ? 1 : 2)} km/h`;
    if (lastHeading && Number.isFinite(lastHeading.bearingDegrees)) {
      headingEl.textContent = `${lastHeading.bearingDegrees.toFixed(0)}\u00B0 (${lastHeading.compass})`;
    } else {
      headingEl.textContent = "N/A";
    }
  };

  const resizeObserver = window.ResizeObserver
    ? new ResizeObserver(() => {
        resizeCanvas();
        draw(true);
      })
    : null;
  const onWindowResize = () => {
    resizeCanvas();
    draw(true);
  };
  if (resizeObserver) {
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener("resize", onWindowResize);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    camera.dpr = dpr;
    const width = Math.max(320, Math.round(rect.width * dpr));
    const height = Math.max(200, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function getAllPoints() {
    const pts = [];
    if (targetPoint) pts.push(targetPoint);
    if (me) pts.push(me);
    for (const p of track) pts.push(p);
    return pts;
  }

  function updateCamera(forceFit = false) {
    if (!forceFit && !followMe) return;
    const pts = getAllPoints();
    if (!pts.length) return;
    origin = computeOrigin(pts);
    const projected = pts.map((p) => projectPoint(p, origin));
    const bounds = computeBounds(projected);
    if (!bounds) return;

    const padding = 40;
    const logicalWidth = canvas.width / camera.dpr;
    const logicalHeight = canvas.height / camera.dpr;
    const spanX = Math.max(bounds.width, 1);
    const spanY = Math.max(bounds.height, 1);
    const scale = Math.max(
      0.0001,
      Math.min(
        (logicalWidth - padding * 2) / spanX,
        (logicalHeight - padding * 2) / spanY
      )
    );

    camera.scale = scale;
    camera.offsetX = padding - bounds.minX * scale;
    camera.offsetY = padding + bounds.maxY * scale;
  }

  function toCanvas(point) {
    const projected = projectPoint(point, origin);
    return {
      x: projected.x * camera.scale + camera.offsetX,
      y: -projected.y * camera.scale + camera.offsetY,
    };
  }

  function draw(forceFit = false) {
    resizeCanvas();
    updateCamera(forceFit);

    const theme = getTheme();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);

    // Track path.
    if (track.length >= 2) {
      ctx.beginPath();
      const first = toCanvas(track[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < track.length; i += 1) {
        const next = toCanvas(track[i]);
        ctx.lineTo(next.x, next.y);
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.path;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    // Target.
    if (targetPoint) {
      const pos = toCanvas(targetPoint);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = theme.target;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.stroke;
      ctx.stroke();
    }

    // Me.
    if (me) {
      const pos = toCanvas(me);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = theme.me;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.stroke;
      ctx.stroke();
    }

    ctx.restore();

    // Border.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function updateReadout() {
    if (!readout) return;
    if (recordTrail) {
      if (recordTrail && !anchorPoint) {
        const sampleCount = anchorSamples.length;
        readout.textContent =
          sampleCount > 1
            ? `Locking GPS\u2026 ${sampleCount} samples`
            : "Locking GPS\u2026";
        return;
      }
      if (!me) {
        readout.textContent = "Waiting for GPS fix...";
        return;
      }
      const accuracyText = Number.isFinite(me.accuracy) ? `\u00B1${me.accuracy.toFixed(0)} m` : "accuracy n/a";
      const elapsedMs = trackStartTime && lastFixTimestamp ? Math.max(0, lastFixTimestamp - trackStartTime) : 0;
      const elapsedText = formatDuration(elapsedMs);
      const pointsText = track.length || (me ? 1 : 0);
      readout.textContent = `Accuracy ${accuracyText} \u2022 Elapsed ${elapsedText} \u2022 Points ${pointsText}`;
      return;
    }
    if (!me || !targetPoint) {
      readout.textContent = "Waiting for GPS fix...";
      return;
    }
    const { meters, bearingDegrees, compass } = distanceAndDirection(me, targetPoint);
    const distanceText = meters < 995 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
    readout.textContent = `You -> Target: ${distanceText}, bearing ${bearingDegrees.toFixed(0)}\u00B0 (${compass})`;
  }

  function handleFix(position) {
    const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
  const next = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp,
  };
  const accuracyTooHigh = Number.isFinite(next.accuracy) && next.accuracy > MAX_ACCURACY_METERS;

  if (anchorPoint && accuracyTooHigh) {
    me = next;
    lastFixTimestamp = timestamp;
    updateReadout();
    return;
  }

    if (recordTrail && !anchorPoint) {
      if (!anchorStartTime) anchorStartTime = timestamp;
      anchorSamples.push(next);
      if (anchorSamples.length > REQUIRED_ANCHOR_SAMPLES * 3) anchorSamples.shift();

      const usableSamples = anchorSamples.filter(
        (sample) => !Number.isFinite(sample.accuracy) || sample.accuracy <= ANCHOR_MAX_ACCURACY_METERS
      );
      const sampleSet = usableSamples.length ? usableSamples : anchorSamples.slice();
      const avgLat = sampleSet.reduce((sum, sample) => sum + sample.lat, 0) / sampleSet.length;
      const avgLng = sampleSet.reduce((sum, sample) => sum + sample.lng, 0) / sampleSet.length;
      const accValues = sampleSet.map((sample) => sample.accuracy).filter((value) => Number.isFinite(value));
      const avgAcc = accValues.length ? accValues.reduce((sum, value) => sum + value, 0) / accValues.length : next.accuracy;

      me = { lat: avgLat, lng: avgLng, accuracy: avgAcc, timestamp };
      lastFixTimestamp = timestamp;

      const sampleCount = sampleSet.length;
      const elapsed = anchorStartTime ? timestamp - anchorStartTime : 0;
      const meetsSampleCount = sampleCount >= REQUIRED_ANCHOR_SAMPLES;
      const meetsAccuracy = Number.isFinite(avgAcc) && avgAcc <= 20;
      const timedOut = elapsed >= ANCHOR_TIMEOUT_MS;
      const msgAcc = Number.isFinite(avgAcc) ? ` (~\u00B1${avgAcc.toFixed(0)} m)` : "";
      readout.textContent = `Locking GPS\u2026 ${sampleCount} fix${sampleCount === 1 ? "" : "es"}${msgAcc}`;

      if (meetsAccuracy || meetsSampleCount || timedOut) {
        anchorPoint = { lat: avgLat, lng: avgLng, accuracy: avgAcc, timestamp };
        const anchorRecord = {
          lat: anchorPoint.lat,
          lng: anchorPoint.lng,
          accuracy: anchorPoint.accuracy ?? null,
          timestamp,
        };
        anchorSamples.length = 0;
        track.length = 0;
        track.push(anchorRecord);
        cumulativeDistance = 0;
        trackStartTime = timestamp;
        lastFixTimestamp = timestamp;
        anchorStartTime = null;
        draw(true);
        updateReadout();
        updateStats();
      }
      return;
    }

    const previousRecorded = track.length ? track[track.length - 1] : null;
    const displacement = previousRecorded ? haversineMeters(previousRecorded, next) : Infinity;

    if (displacement >= MIN_TRACK_DELTA_METERS) {
      track.push({ lat: next.lat, lng: next.lng, accuracy: next.accuracy, timestamp: next.timestamp });
      if (track.length > MAX_TRACK_POINTS) {
        track.splice(0, track.length - MAX_TRACK_POINTS);
      }
      if (recordTrail && previousRecorded) {
      const segment = haversineMeters(previousRecorded, next);
      if (Number.isFinite(segment)) cumulativeDistance += segment;
      lastHeading = distanceAndDirection(previousRecorded, next);
      }
      if (recordTrail && !trackStartTime) {
        trackStartTime = next.timestamp;
      }
    }

    me = next;
    lastFixTimestamp = next.timestamp;
    draw(followMe);
    updateReadout();
    updateStats();
  }

  function handleFixError(err) {
    readout.textContent = `GPS error: ${err.message || err}`;
  }

  function cleanup() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener("resize", onWindowResize);
    overlay.remove();
  }

  // Event wiring.
  btnClose.addEventListener("click", cleanup);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) cleanup();
  });
  btnFit.addEventListener("click", () => draw(true));
  btnFollow.addEventListener("click", () => {
    followMe = !followMe;
    btnFollow.textContent = followMe ? "Unpin me" : "Follow me";
    if (followMe) {
      draw(true);
    }
  });
  btnSave?.addEventListener("click", async () => {
    if (saveInProgress) return;
    if (!track.length) {
      alert("No GPS points recorded yet. Keep recording a bit longer before saving.");
      return;
    }
    const defaultName = `Track ${new Date(trackStartTime || Date.now()).toLocaleString()}`;
    const input = window.prompt("Name this track", defaultName);
    if (input === null) return;
    const name = input.trim() || defaultName;
    const noteInput = window.prompt("Add a note for this track (optional)", "");
    const note = typeof noteInput === "string" ? noteInput.trim() : "";
    const createdAt = trackStartTime || Date.now();
    const durationMs = Math.max(0, (lastFixTimestamp ?? createdAt) - (trackStartTime ?? createdAt));
    const distanceMeters = cumulativeDistance;
    const points = track.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      timestamp: p.timestamp,
      accuracy: p.accuracy,
    }));

    saveInProgress = true;
    btnSave.disabled = true;
    btnSave.textContent = "Saving...";
    try {
      const result = saveCallback ? await Promise.resolve(saveCallback({ name, note, createdAt, durationMs, distanceMeters, points })) : true;
      if (result === false) {
        btnSave.disabled = false;
        btnSave.textContent = "Save track";
        saveInProgress = false;
        return;
      }
      cleanup();
    } catch (error) {
      console.error("Track save failed:", error);
      alert(`Unable to save track: ${error?.message || error}`);
      btnSave.disabled = false;
      btnSave.textContent = "Save track";
      saveInProgress = false;
    } finally {
      saveInProgress = false;
    }
  });

  // Initial render.
  resizeCanvas();
  draw(true);
  updateReadout();
  updateStats();

  if (liveTrack && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      handleFix,
      handleFixError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  } else if (liveTrack) {
    readout.textContent = "Geolocation is not available.";
  }

  return { close: cleanup };
}

// ---------- Plot Mode (Multiple points) --------------------------------------

function openPlotOverlay(input = {}) {
  const points = Array.isArray(input.points) ? input.points : [];
  const labelDistance = input.labelDistance !== false;
  const units = input.units === "km" ? "km" : "m";
  const originIndex = Number.isInteger(input.originIndex) ? input.originIndex : 0;
  const connections = Array.isArray(input.connections) ? input.connections : null;
  const distanceMode = input.distanceMode === "origin" ? "origin" : "path";

  const scene = buildPlotScene(points, { originIndex, connections });

  const overlay = document.createElement("div");
  overlay.className = "sketchmap-overlay";
  overlay.innerHTML = `
    <div class="sketchmap-panel" role="dialog" aria-modal="true" aria-label="Sketch map">
      <header class="sketchmap-toolbar">
        <div class="left">
          <button class="btn btn-outline sm-fit" title="Fit">Fit</button>
        </div>
        <div class="right">
          <button class="btn btn-outline sm-close" aria-label="Close">&times;</button>
        </div>
      </header>
      <div class="sketchmap-body">
        <canvas class="sketchmap-canvas" aria-label="Sketch map plot"></canvas>
      </div>
      <footer class="sketchmap-hint">Drag to pan | Wheel/pinch to zoom</footer>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .sketchmap-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center;padding:1rem}
    .sketchmap-panel{background:#fff;color:#0f172a;width:min(96vw,920px);height:min(90vh,680px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;border:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){.sketchmap-panel{background:#0b1223;color:#e5e7eb;border-color:rgba(255,255,255,.12)}}
    .sketchmap-toolbar{display:flex;align-items:center;justify-content:space-between;padding:.5rem .75rem;border-bottom:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){.sketchmap-toolbar{border-color:rgba(255,255,255,.12)}}
    .sketchmap-toolbar .btn{padding:.35rem .6rem;border-radius:10px;border:1px solid currentColor;font-weight:700}
    .sketchmap-body{flex:1;display:flex}
    .sketchmap-canvas{flex:1;display:block;width:100%;height:100%;background:#ffffff;border-radius:12px}
    @media (prefers-color-scheme: dark){.sketchmap-canvas{background:#0b1220}}
    .sketchmap-hint{opacity:.7;font-size:.85rem;padding:.4rem .75rem}
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector(".sketchmap-canvas");
  const ctx = canvas.getContext("2d");
  const btnClose = overlay.querySelector(".sm-close");
  const btnFit = overlay.querySelector(".sm-fit");

  const camera = { x: 0, y: 0, scale: 1, dpr: 1, padding: 20, _canvas: canvas };

  const resizeObserver = window.ResizeObserver
    ? new ResizeObserver(() => {
        resizeCanvas();
        fitAndDraw();
      })
    : null;
  const onWindowResize = () => {
    resizeCanvas();
    fitAndDraw();
  };
  if (resizeObserver) {
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener("resize", onWindowResize);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    camera.dpr = dpr;
    const width = Math.max(320, Math.round((rect.width || 640) * dpr));
    const height = Math.max(200, Math.round((rect.height || 400) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function fitAndDraw() {
    fitPlot(camera, scene);
    drawPlot(canvas, ctx, camera, scene, { labelDistance, units, distanceMode });
  }

  // Mouse pan/zoom ------------------------------------------------------------
  let dragging = false;
  let last = { x: 0, y: 0 };

  function toLocal(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function onPointerDown(evt) {
    dragging = true;
    last = toLocal(evt);
    evt.preventDefault();
  }

  function onPointerMove(evt) {
    if (!dragging) return;
    const pt = toLocal(evt);
    camera.x += pt.x - last.x;
    camera.y += pt.y - last.y;
    last = pt;
    drawPlot(canvas, ctx, camera, scene, { labelDistance, units, distanceMode });
  }

  function onPointerUp() {
    dragging = false;
  }

  function onWheel(evt) {
    evt.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    const delta = Math.sign(evt.deltaY) * 0.1;
    const factor = Math.exp(-delta);
    const prevScale = camera.scale;
    const nextScale = clamp(prevScale * factor, 0.1, 50);
    camera.x = mx - (mx - camera.x) * (nextScale / prevScale);
    camera.y = my - (my - camera.y) * (nextScale / prevScale);
    camera.scale = nextScale;
    drawPlot(canvas, ctx, camera, scene, { labelDistance, units, distanceMode });
  }

  // Touch gestures ------------------------------------------------------------
  let pinch = null;

  function getTouchPoint(touch) {
    return { x: touch.clientX, y: touch.clientY };
  }

  function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onTouchStart(evt) {
    if (evt.touches.length === 1) {
      dragging = true;
      last = getTouchPoint(evt.touches[0]);
    } else if (evt.touches.length === 2) {
      dragging = false;
      const a = getTouchPoint(evt.touches[0]);
      const b = getTouchPoint(evt.touches[1]);
      pinch = {
        startDist: distanceBetween(a, b),
        startScale: camera.scale,
        startX: camera.x,
        startY: camera.y,
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
  }

  function onTouchMove(evt) {
    if (pinch && evt.touches.length === 2) {
      const a = getTouchPoint(evt.touches[0]);
      const b = getTouchPoint(evt.touches[1]);
      const scaleFactor = clamp(distanceBetween(a, b) / pinch.startDist, 0.2, 5);
      const nextScale = clamp(pinch.startScale * scaleFactor, 0.1, 50);
      camera.x = pinch.center.x - (pinch.center.x - pinch.startX) * (nextScale / pinch.startScale);
      camera.y = pinch.center.y - (pinch.center.y - pinch.startY) * (nextScale / pinch.startScale);
      camera.scale = nextScale;
      drawPlot(canvas, ctx, camera, scene, { labelDistance, units, distanceMode });
    } else if (dragging && evt.touches.length === 1) {
      const touch = getTouchPoint(evt.touches[0]);
      camera.x += touch.x - last.x;
      camera.y += touch.y - last.y;
      last = touch;
      drawPlot(canvas, ctx, camera, scene, { labelDistance, units, distanceMode });
    }
  }

  function onTouchEnd() {
    dragging = false;
    pinch = null;
  }

  // Close helpers -------------------------------------------------------------
  function close() {
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener("resize", onWindowResize);
    canvas.removeEventListener("mousedown", onPointerDown);
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
    overlay.remove();
  }

  // Wiring.
  btnClose.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  btnFit.addEventListener("click", fitAndDraw);

  canvas.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  canvas.addEventListener("touchstart", onTouchStart, { passive: true });
  canvas.addEventListener("touchmove", onTouchMove, { passive: true });
  canvas.addEventListener("touchend", onTouchEnd, { passive: true });
  canvas.addEventListener("touchcancel", onTouchEnd, { passive: true });

  // Initial draw.
  resizeCanvas();
  fitAndDraw();

  return { close, fit: fitAndDraw };
}

// ---------- Shared helpers ---------------------------------------------------

function normalizeInput(input) {
  if (Array.isArray(input)) return { points: input };
  if (input && typeof input === "object") return input;
  return {};
}

function hasTarget(opts = {}) {
  return !!(opts.target && Number.isFinite(opts.target.lat) && Number.isFinite(opts.target.lng));
}

function computeOrigin(points) {
  if (!points.length) return { lat: 0, lng: 0 };
  let latSum = 0;
  let lngSum = 0;
  for (const pt of points) {
    latSum += pt.lat;
    lngSum += pt.lng;
  }
  return { lat: latSum / points.length, lng: lngSum / points.length };
}

function projectPoint(point, reference) {
  const earthRadius = 6371000; // meters
  const latRad = toRad(point.lat);
  const refLatRad = toRad(reference.lat);
  const dLat = toRad(point.lat - reference.lat);
  const dLng = toRad(point.lng - reference.lng);
  return {
    x: earthRadius * dLng * Math.cos((latRad + refLatRad) / 2),
    y: earthRadius * dLat,
  };
}

function computeBounds(points) {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function buildPlotScene(points, { originIndex = 0, connections = null } = {}) {
  const pts = (Array.isArray(points) ? points : [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    .map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      note: typeof p.note === "string" ? p.note : "",
      timestamp: Number.isFinite(p.timestamp) ? p.timestamp : Date.now(),
    }));

  const scene = {
    points: pts,
    center: { lat: 0, lng: 0 },
    metersPerDegX: 0,
    metersPerDegY: 110540,
    bounds: null,
    connections: [],
    edges: [],
    drawMode: "path",
    originIndex: 0,
  };

  if (!pts.length) return scene;

  scene.originIndex = Math.min(Math.max(0, Number.isInteger(originIndex) ? originIndex : 0), pts.length - 1);

  let latSum = 0;
  let lngSum = 0;
  for (const p of pts) {
    latSum += p.lat;
    lngSum += p.lng;
  }
  scene.center.lat = latSum / pts.length;
  scene.center.lng = lngSum / pts.length;
  scene.metersPerDegX = 111320 * Math.cos(toRad(scene.center.lat));

  for (const p of pts) {
    p._x = (p.lng - scene.center.lng) * scene.metersPerDegX;
    p._y = -(p.lat - scene.center.lat) * scene.metersPerDegY;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p._x < minX) minX = p._x;
    if (p._x > maxX) maxX = p._x;
    if (p._y < minY) minY = p._y;
    if (p._y > maxY) maxY = p._y;
  }
  scene.bounds = {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };

  const defaultConnections = () => {
    const edges = [];
    for (let i = 1; i < pts.length; i += 1) edges.push({ from: i - 1, to: i });
    return edges;
  };

  const normalizedConnections = Array.isArray(connections)
    ? connections
        .map((conn) => {
          if (conn == null) return null;
          if (typeof conn === "object") {
            const from = Number.isInteger(conn.from) ? conn.from : Number.isInteger(conn[0]) ? conn[0] : null;
            const to = Number.isInteger(conn.to) ? conn.to : Number.isInteger(conn[1]) ? conn[1] : null;
            if (Number.isInteger(from) && Number.isInteger(to)) return { from, to };
            return null;
          }
          if (Array.isArray(conn) && conn.length >= 2) {
            const from = Number.isInteger(conn[0]) ? conn[0] : null;
            const to = Number.isInteger(conn[1]) ? conn[1] : null;
            if (Number.isInteger(from) && Number.isInteger(to)) return { from, to };
            return null;
          }
          return null;
        })
        .filter(Boolean)
    : null;

  const seenEdges = new Set();
  const validConnections = [];
  if (normalizedConnections?.length) {
    normalizedConnections.forEach(({ from, to }) => {
      if (from === to) return;
      if (from < 0 || from >= pts.length) return;
      if (to < 0 || to >= pts.length) return;
      const key = `${from}->${to}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      validConnections.push({ from, to });
    });
  }

  scene.connections = validConnections.length ? validConnections : defaultConnections();
  const isSequentialPath =
    scene.connections.length === pts.length - 1 &&
    scene.connections.every((edge, idx) => edge.from === idx && edge.to === idx + 1);
  scene.drawMode = isSequentialPath ? "path" : "graph";

  scene.edges = scene.connections.map(({ from, to }) => {
    const a = pts[from];
    const b = pts[to];
    const dx = b._x - a._x;
    const dy = b._y - a._y;
    return { from, to, meters: Math.hypot(dx, dy) };
  });

  return scene;
}

function fitPlot(cam, scene) {
  if (!scene.bounds) return;
  const pad = cam.padding || 20;
  const logicalWidth = (cam._canvas?.width || cam.width || 800) / (cam.dpr || 1);
  const logicalHeight = (cam._canvas?.height || cam.height || 520) / (cam.dpr || 1);
  const spanX = Math.max(scene.bounds.width, 1);
  const spanY = Math.max(scene.bounds.height, 1);
  cam.scale = Math.max(0.0001, Math.min((logicalWidth - pad * 2) / spanX, (logicalHeight - pad * 2) / spanY));
  cam.x = pad - scene.bounds.minX * cam.scale;
  cam.y = pad + scene.bounds.maxY * cam.scale;
}

function drawPlot(canvas, ctx, cam, scene, { labelDistance = true, units = "m", distanceMode = "path" } = {}) {
  const theme = getTheme();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.save();
  ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);

  if (!scene.points.length) {
    ctx.fillStyle = theme.fgMuted;
    ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No points selected", canvas.width / (2 * cam.dpr), canvas.height / (2 * cam.dpr));
    ctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    return;
  }

  const drawLine = (a, b) => {
    const ax = a._x * cam.scale + cam.x;
    const ay = a._y * cam.scale + cam.y;
    const bx = b._x * cam.scale + cam.x;
    const by = b._y * cam.scale + cam.y;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };

  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.accent;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (scene.drawMode === "path") {
    ctx.beginPath();
    scene.points.forEach((p, i) => {
      const x = p._x * cam.scale + cam.x;
      const y = p._y * cam.scale + cam.y;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else {
    scene.connections.forEach(({ from, to }) => {
      const a = scene.points[from];
      const b = scene.points[to];
      drawLine(a, b);
    });
  }

  // Points.
  const radius = 5;
  scene.points.forEach((p, i) => {
    const x = p._x * cam.scale + cam.x;
    const y = p._y * cam.scale + cam.y;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (i === 0) ctx.fillStyle = theme.start;
    else if (i === scene.points.length - 1) ctx.fillStyle = theme.end;
    else ctx.fillStyle = theme.point;
    ctx.fill();
    ctx.fillStyle = theme.fg;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(String(i + 1), x, y + radius + 3);

    const label = formatPointLabel(p);
    if (label) {
      ctx.fillStyle = theme.fgMuted;
      ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(label, x, y + radius + 18);
    }
  });

  if (labelDistance && scene.edges.length) {
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const edgesToLabel =
      distanceMode === "origin"
        ? scene.edges.filter((edge) => edge.from === scene.originIndex || edge.to === scene.originIndex)
        : scene.edges;
    const labeled = new Set();
    edgesToLabel.forEach((edge) => {
      const keyA = `${edge.from}->${edge.to}`;
      if (labeled.has(keyA)) return;
      labeled.add(keyA);
      const a = scene.points[edge.from];
      const b = scene.points[edge.to];
      const ax = a._x * cam.scale + cam.x;
      const ay = a._y * cam.scale + cam.y;
      const bx = b._x * cam.scale + cam.x;
      const by = b._y * cam.scale + cam.y;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const label = formatDistance(edge.meters, units);
      ctx.save();
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 3;
      ctx.strokeText(label, mx, my - 6);
      ctx.fillStyle = theme.fgMuted;
      ctx.fillText(label, mx, my - 6);
      ctx.restore();
    });
  }

  ctx.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDistance(meters, unitsPref) {
  if (unitsPref === "km" || (unitsPref === "m" && meters >= 1000)) {
    const value = meters / 1000;
    return `${value.toFixed(value >= 10 ? 0 : 1)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatPointLabel(point, maxLength = 26) {
  if (!point) return "";
  const raw = typeof point.note === "string" ? point.note.trim() : "";
  if (!raw) return "";
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength - 1)}…`;
}

function getTheme() {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (prefersDark) {
    return {
      bg: "#0b1223",
      fg: "#e5e7eb",
      fgMuted: "rgba(229,231,235,0.75)",
      border: "rgba(255,255,255,0.12)",
      accent: "#60a5fa",
      point: "#93c5fd",
      start: "#34d399",
      end: "#f472b6",
      me: "#60a5fa",
      target: "#f97316",
      path: "#22c55e",
      stroke: "rgba(15,23,42,0.85)",
    };
  }
  return {
    bg: "#ffffff",
    fg: "#0f172a",
    fgMuted: "rgba(15,23,42,0.65)",
    border: "rgba(0,0,0,0.08)",
    accent: "#2563eb",
    point: "#1d4ed8",
    start: "#059669",
    end: "#db2777",
    me: "#2563eb",
    target: "#f97316",
    path: "#22c55e",
    stroke: "rgba(15,23,42,0.35)",
  };
}





