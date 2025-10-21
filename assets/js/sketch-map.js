// /assets/js/sketch-map.js
// Unified Sketch Map overlay for DaliTrail.
// Consistent toolbar: [Pin/Unpin me] [Start/Pause Tracking] [Save] [Close]
// One setup function: controller.setData({ points, target, anchor })
// - points: array of {lat, lng, note?, timestamp?}
// - target: optional {lat, lng, note?}
// - anchor: optional {lat, lng} => computes anchorDistanceMeters on each point

import { haversineMeters, distanceAndDirection } from "/assets/js/utils.js";

// ---------------- Public API ----------------

export function openSketchMap(input = {}) {
  return createUnifiedOverlay(normalizeInput(input));
}

export default openSketchMap;

// -------------- Constants / Config ----------

const MAX_TRACK_POINTS = 1500;
const MIN_TRACK_DELTA_METERS = 6;
const MAX_TRACK_POINT_ACCURACY_METERS = 120;
const REQUIRED_ANCHOR_SAMPLES = 3;
const ANCHOR_MAX_ACCURACY_METERS = 45;
const ANCHOR_TIMEOUT_MS = 3000;

// -------------- Overlay ---------------------

function createUnifiedOverlay(options) {
  // normalized user options
  const {
    recordTrail = false,
    follow = true,
    liveTrack = true,
    onSaveTrail = null,
  } = options;

  // UI
  const overlay = document.createElement("div");
  overlay.className = "sketch-overlay";
  overlay.innerHTML = `
    <div class="sketch-panel" role="dialog" aria-modal="true" aria-label="Sketch map">
      <header class="sketch-header">
        <h2>Sketch map</h2>
        <div class="sketch-actions" role="toolbar" tabindex="0">
          <button class="btn btn-outline sketch-toggle-follow">${follow ? "Unpin me" : "Pin me"}</button>
          <button class="btn btn-outline sketch-startpause">Start Tracking</button>
          <button class="btn btn-outline sketch-save" disabled>Save</button>
          <button class="btn btn-outline sketch-close">Close</button>
        </div>
      </header>
      <div class="sketch-body">
        <canvas id="sketch-canvas" aria-label="Sketch map canvas"></canvas>
        <div class="sketch-legend">
          <span class="dot me"></span> You
          <span class="dot target"></span> Target
          <span class="line path"></span> Track
        </div>
        <div class="sketch-stats">
          <div><span class="label">Distance</span> <span id="sketch-distance">0 m</span></div>
          <div><span class="label">Avg speed</span> <span id="sketch-speed">0 km/h</span></div>
          <div><span class="label">Direction</span> <span id="sketch-heading">N/A</span></div>
        </div>
        <div class="sketch-readout" id="sketch-readout">Waiting for GPS fix...</div>
      </div>
    </div>
  `;

  // Inline styles limited to the overlay shell (layout/scroll is in style.css)
  const style = document.createElement("style");
  style.textContent = `
    .sketch-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center;padding:1rem}
    .sketch-panel{background:#fff;color:#111827;max-width:960px;width:min(96%,960px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:1rem;border:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){.sketch-panel{background:#0f172a;color:#f8fafc;border-color:rgba(255,255,255,.12)}}
    .sketch-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;gap:.75rem;flex-wrap:wrap}
    .sketch-header h2{margin:0;font-size:1.15rem;font-weight:700;letter-spacing:.2px;flex:1 1 auto;min-width:12rem}
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
    @media (prefers-color-scheme: dark){.sketch-stats .label{color:#e2e8f0}}
    .sketch-readout{font-family:ui-monospace,monospace;font-size:.95rem;opacity:.9}
    .sketch-actions .btn{padding:.5rem .9rem;font-size:.95rem;border-radius:12px;font-weight:600;border-width:2px;box-shadow:none}
    .sketch-actions .btn.sketch-close{color:#dc2626;border-color:rgba(220,38,38,0.5);background:rgba(220,38,38,0.12)}
    @media (prefers-color-scheme: dark){
      .sketch-actions .btn{background:rgba(96,165,250,0.22);color:#e0f2fe;border-color:rgba(191,219,254,0.65);box-shadow:0 8px 20px rgba(59,130,246,0.35)}
      .sketch-actions .btn.sketch-close{color:#fecaca;border-color:rgba(248,113,113,0.55);background:rgba(248,113,113,0.22);box-shadow:0 8px 20px rgba(248,113,113,0.3)}
      .sketch-stats .label{color:#e2e8f0}
    }
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  // Elements
  const canvas = overlay.querySelector("#sketch-canvas");
  const ctx = canvas.getContext("2d");
  const readout = overlay.querySelector("#sketch-readout");
  const btnClose = overlay.querySelector(".sketch-close");
  const btnFollow = overlay.querySelector(".sketch-toggle-follow");
  const btnStartPause = overlay.querySelector(".sketch-startpause");
  const btnSave = overlay.querySelector(".sketch-save");
  const distanceEl = overlay.querySelector("#sketch-distance");
  const speedEl = overlay.querySelector("#sketch-speed");
  const headingEl = overlay.querySelector("#sketch-heading");

  // State
  const camera = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
  let followMe = !!follow;

  // "Scene" data users can update via controller.setData(...)
  let scene = {
    points: [],           // [{lat,lng,note?,timestamp?, anchorDistanceMeters?}]
    target: null,         // {lat,lng,note?}
    anchor: null          // {lat,lng}
  };

  // Live tracking
  const recentFixes = [];
  const track = [];
  let me = null;
  let watchId = null;
  let trackingActive = false;
  let anchorPoint = null;
  let anchorStartTime = null;
  let trackStartTime = null;
  let lastFixTimestamp = null;
  let lastHeading = null;
  let cumulativeDistance = 0;
  let saveInProgress = false;

  // ---------- Wiring

  btnClose.addEventListener("click", cleanup);
  overlay.addEventListener("click", (evt) => { if (evt.target === overlay) cleanup(); });

  btnFollow.addEventListener("click", () => {
    followMe = !followMe;
    updateFollowButton();
    if (followMe) draw(true);
  });

  btnStartPause.addEventListener("click", () => {
    if (trackingActive) stopTracking();
    else startTracking();
  });

  btnSave.addEventListener("click", doSave);

  // Resize handling
  const resizeObserver = window.ResizeObserver
    ? new ResizeObserver(() => { resizeCanvas(); draw(true); })
    : null;
  const onWindowResize = () => { resizeCanvas(); draw(true); };

  if (resizeObserver) { resizeObserver.observe(canvas); }
  else { window.addEventListener("resize", onWindowResize); }

  // ---------- Controller (public surface)

  const controller = {
    setData({ points = [], target = null, anchor = null } = {}) {
      // sanitize points
      const pts = (Array.isArray(points) ? points : [])
        .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
        .map(p => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
          note: typeof p.note === "string" ? p.note : "",
          timestamp: Number.isFinite(p.timestamp) ? p.timestamp : Date.now()
        }));

      // validate target/anchor
      const tgt = target && Number.isFinite(target.lat) && Number.isFinite(target.lng)
        ? { lat: Number(target.lat), lng: Number(target.lng), note: target.note ? String(target.note) : "Target" }
        : null;

      const anc = anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)
        ? { lat: Number(anchor.lat), lng: Number(anchor.lng) }
        : null;

      // compute anchor distances if anchor exists
      if (anc) {
        pts.forEach(p => {
          p.anchorDistanceMeters = haversineMeters(
            { lat: p.lat, lng: p.lng },
            { lat: anc.lat, lng: anc.lng }
          );
        });
      }

      scene.points = pts;
      scene.target = tgt;
      scene.anchor = anc;

      // Redraw using only scene (doesn't touch tracking)
      draw(true);
      updateReadout();
      return pts; // useful if caller wants the annotated list
    },

    getState() {
      return {
        scene: JSON.parse(JSON.stringify(scene)),
        trackingActive,
        followMe,
        me,
        trackLength: track.length,
        cumulativeDistance,
      };
    },

    async save() { await doSave(); },

    close: cleanup,
  };

  // Initialize scene from initial options (optional)
  controller.setData({
    points: options.points,
    target: options.target,
    anchor: options.anchor
  });

  // Initial render
  resizeCanvas();
  draw(true);
  updateReadout();
  updateStats();
  updateToolbarState();

  // Auto-start GPS if requested
  if (liveTrack) startTracking({ silent: true });

  return controller;

  // ------------- Internals ------------------

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    camera.dpr = dpr;
    const width = Math.max(320, Math.round((rect.width || 640) * dpr));
    const height = Math.max(200, Math.round((rect.height || 420) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function getAllPointsForView() {
    const pts = [];
    scene.points.forEach(p => pts.push(p));
    if (me) pts.push(me);
    if (scene.target) pts.push(scene.target);
    if (track.length) pts.push(...track);
    return pts;
  }

  function computeOrigin(points) {
    if (!points.length) return { lat: 0, lng: 0 };
    let latSum = 0, lngSum = 0;
    points.forEach(p => { latSum += p.lat; lngSum += p.lng; });
    return { lat: latSum / points.length, lng: lngSum / points.length };
  }

  function projectPoint(point, reference) {
    const R = 6371000;
    const latRad = toRad(point.lat);
    const refLatRad = toRad(reference.lat);
    const dLat = toRad(point.lat - reference.lat);
    const dLng = toRad(point.lng - reference.lng);
    return {
      x: R * dLng * Math.cos((latRad + refLatRad) / 2),
      y: R * dLat,
    };
  }

  function computeBounds(projected) {
    if (!projected.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    projected.forEach(pt => {
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function updateCamera(forceFit = false) {
    if (!forceFit && !followMe) return;
    const pts = getAllPointsForView();
    if (!pts.length) return;
    const origin = computeOrigin(pts);
    const projected = pts.map(p => projectPoint(p, origin));
    const bounds = computeBounds(projected);
    if (!bounds) return;

    const padding = 40;
    const logicalWidth = canvas.width / camera.dpr;
    const logicalHeight = canvas.height / camera.dpr;
    const spanX = Math.max(bounds.width, 1);
    const spanY = Math.max(bounds.height, 1);
    const scale = Math.max(
      0.0001,
      Math.min((logicalWidth - padding * 2) / spanX, (logicalHeight - padding * 2) / spanY)
    );

    camera.scale = scale;
    camera.offsetX = padding - bounds.minX * scale;
    camera.offsetY = padding + bounds.maxY * scale;
  }

  function toCanvasCoords(point, origin) {
    const proj = projectPoint(point, origin);
    return {
      x: proj.x * camera.scale + camera.offsetX,
      y: -proj.y * camera.scale + camera.offsetY,
    };
  }

  function draw(forceFit = false) {
    updateCamera(forceFit);
    const theme = getTheme();

    // clear
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.restore();

    const viewPts = getAllPointsForView();
    const origin = computeOrigin(viewPts);

    ctx.save();
    ctx.setTransform(camera.dpr,0,0,camera.dpr,0,0);

    // Draw polyline: (1) scene.points path (2) track path
    if (scene.points.length >= 2) {
      ctx.beginPath();
      let first = toCanvasCoords(scene.points[0], origin);
      ctx.moveTo(first.x, first.y);
      for (let i=1;i<scene.points.length;i++){
        const next = toCanvasCoords(scene.points[i], origin);
        ctx.lineTo(next.x, next.y);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.accent;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    if (track.length >= 2) {
      ctx.beginPath();
      const first = toCanvasCoords(track[0], origin);
      ctx.moveTo(first.x, first.y);
      for (let i=1;i<track.length;i++){
        const next = toCanvasCoords(track[i], origin);
        ctx.lineTo(next.x, next.y);
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.path;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    // Points labels + optional anchor distances
    const radius = 5;
    scene.points.forEach((p, idx) => {
      const pos = toCanvasCoords(p, origin);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI*2);
      const isFirst = idx === 0;
      const isLast = idx === scene.points.length - 1;
      ctx.fillStyle = isFirst ? theme.start : isLast ? theme.end : theme.point;
      ctx.fill();
      // index label
      ctx.fillStyle = theme.fg;
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(idx+1), pos.x, pos.y + radius + 3);

      // info label
      const lines = [];
      const note = formatPointLabel(p);
      if (note) lines.push(note);
      if (Number.isFinite(p.anchorDistanceMeters)) {
        lines.push(formatDistance(p.anchorDistanceMeters, "m"));
      }
      if (lines.length) {
        ctx.fillStyle = theme.fgMuted;
        ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        let y = pos.y + radius + 18;
        lines.forEach(line => { ctx.fillText(line, pos.x, y); y += 14; });
      }
    });

    // Target
    if (scene.target) {
      const pos = toCanvasCoords(scene.target, origin);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = theme.target;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.stroke;
      ctx.stroke();
    }

    // Me
    if (me) {
      const pos = toCanvasCoords(me, origin);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = theme.me;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.stroke;
      ctx.stroke();
    }

    ctx.restore();

    // Border
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function startTracking({ silent = false } = {}) {
    if (!navigator.geolocation) {
      if (!silent) readout.textContent = "Geolocation is not available.";
      return;
    }
    if (trackingActive) return;

    trackingActive = true;
    anchorPoint = null;
    anchorStartTime = null;
    recentFixes.length = 0;
    if (!track.length) cumulativeDistance = 0;

    watchId = navigator.geolocation.watchPosition(
      handleFix,
      (err) => { readout.textContent = `GPS error: ${err.message || err}`; },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    updateToolbarState();
  }

  function stopTracking() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    trackingActive = false;
    updateToolbarState();
  }

  async function doSave() {
    if (!recordTrail) { alert("Saving is only available in record mode."); return; }
    if (saveInProgress) return;
    if (track.length < 2) { alert("Record a longer track before saving."); return; }
    if (typeof onSaveTrail !== "function") { alert("Saving tracks is not available on this map."); return; }

    const defaultName = `Track ${new Date(trackStartTime || Date.now()).toLocaleString()}`;
    const input = window.prompt("Name this track", defaultName);
    if (input === null) return;
    const name = input.trim() || defaultName;
    const noteInput = window.prompt("Add a note for this track (optional)", "");
    const note = typeof noteInput === "string" ? noteInput.trim() : "";

    const createdAt = trackStartTime || Date.now();
    const durationMs = Math.max(0, (lastFixTimestamp ?? createdAt) - (trackStartTime ?? createdAt));
    const distanceMeters = cumulativeDistance;
    const points = track.map(p => ({
      lat: p.lat, lng: p.lng, timestamp: p.timestamp, accuracy: p.accuracy
    }));

    saveInProgress = true;
    btnSave.textContent = "Saving...";
    updateToolbarState();
    try {
      const res = await Promise.resolve(onSaveTrail({ name, note, createdAt, durationMs, distanceMeters, points }));
      if (res === false) {
        saveInProgress = false;
        btnSave.textContent = "Save";
        updateToolbarState();
        return;
      }
    } catch (e) {
      console.error("Track save failed:", e);
      alert(`Unable to save track: ${e?.message || e}`);
      saveInProgress = false;
      btnSave.textContent = "Save";
      updateToolbarState();
      return;
    }
    saveInProgress = false;
    btnSave.textContent = "Save";
    updateToolbarState();
    cleanup();
  }

  function handleFix(position) {
    const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
    const next = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp,
    };
    const tooInaccurate = Number.isFinite(next.accuracy) && next.accuracy > MAX_TRACK_POINT_ACCURACY_METERS;

    // Establish anchor from averaged initial fixes to smooth start
    if (!anchorPoint) {
      if (!anchorStartTime) anchorStartTime = timestamp;
      recentFixes.push(next);
      if (recentFixes.length > REQUIRED_ANCHOR_SAMPLES * 3) recentFixes.shift();

      const usable = recentFixes.filter(s => !Number.isFinite(s.accuracy) || s.accuracy <= ANCHOR_MAX_ACCURACY_METERS);
      const sampleSet = usable.length ? usable : recentFixes.slice();
      const avgLat = sampleSet.reduce((s, f) => s + f.lat, 0) / sampleSet.length;
      const avgLng = sampleSet.reduce((s, f) => s + f.lng, 0) / sampleSet.length;
      const accValues = sampleSet.map(s => s.accuracy).filter(Number.isFinite);
      const avgAcc = accValues.length ? accValues.reduce((s,v)=>s+v,0)/accValues.length : next.accuracy;

      me = { lat: avgLat, lng: avgLng, accuracy: avgAcc, timestamp };
      lastFixTimestamp = timestamp;

      const sampleCount = sampleSet.length;
      const elapsed = anchorStartTime ? timestamp - anchorStartTime : 0;
      const meetsCount = sampleCount >= REQUIRED_ANCHOR_SAMPLES;
      const meetsAcc = Number.isFinite(avgAcc) && avgAcc <= 20;
      const timedOut = elapsed >= ANCHOR_TIMEOUT_MS;

      readout.textContent = `Locking GPS… ${sampleCount} fix${sampleCount === 1 ? "" : "es"}${Number.isFinite(avgAcc) ? ` (~±${avgAcc.toFixed(0)} m)` : ""}`;

      if (meetsAcc || meetsCount || timedOut) {
        anchorPoint = { lat: avgLat, lng: avgLng, accuracy: avgAcc, timestamp };
        track.length = 0;
        track.push({ ...anchorPoint });
        cumulativeDistance = 0;
        trackStartTime = timestamp;
        lastFixTimestamp = timestamp;
        draw(true);
        updateReadout();
        updateStats();
        updateToolbarState();
      }
      return;
    }

    // After anchor established
    if (tooInaccurate) {
      me = next;
      lastFixTimestamp = timestamp;
      updateReadout();
      return;
    }

    const prev = track.length ? track[track.length - 1] : null;
    const displacement = prev ? haversineMeters(prev, next) : Infinity;
    const significantMove = displacement >= MIN_TRACK_DELTA_METERS;

    if (significantMove) {
      track.push({ ...next });
      if (track.length > MAX_TRACK_POINTS) track.splice(0, track.length - MAX_TRACK_POINTS);
      if (prev) {
        const seg = haversineMeters(prev, next);
        if (Number.isFinite(seg)) cumulativeDistance += seg;
        lastHeading = distanceAndDirection(prev, next);
      }
      if (!trackStartTime) trackStartTime = next.timestamp;
    }

    me = next;
    lastFixTimestamp = next.timestamp;
    draw(followMe);
    updateReadout();
    updateStats();
    updateToolbarState();
  }

  function cleanup() {
    stopTracking();
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener("resize", onWindowResize);
    overlay.remove();
  }

  // -------- UI helpers

  function updateToolbarState() {
    // Start/Pause text
    btnStartPause.textContent = trackingActive ? "Pause Tracking" : "Start Tracking";
    // Save availability
    const canSave = !!(recordTrail && track.length >= 2 && !saveInProgress);
    btnSave.disabled = !canSave;
    btnSave.textContent = saveInProgress ? "Saving..." : "Save";
    // Follow button text
    updateFollowButton();
  }

  function updateFollowButton() {
    btnFollow.textContent = followMe ? "Unpin me" : "Pin me";
  }

  function updateStats() {
    if (!distanceEl || !speedEl || !headingEl) return;
    distanceEl.textContent = formatDistance(cumulativeDistance);
    const elapsedMs = trackStartTime && lastFixTimestamp ? Math.max(0, lastFixTimestamp - trackStartTime) : 0;
    const avgSpeed = elapsedMs > 0 ? (cumulativeDistance / (elapsedMs / 1000)) * 3.6 : 0;
    speedEl.textContent = `${avgSpeed.toFixed(avgSpeed >= 10 ? 1 : 2)} km/h`;
    if (lastHeading && Number.isFinite(lastHeading.bearingDegrees)) {
      headingEl.textContent = `${lastHeading.bearingDegrees.toFixed(0)}° (${lastHeading.compass})`;
    } else {
      headingEl.textContent = "N/A";
    }
  }

  function updateReadout() {
    if (!readout) return;
    if (!trackingActive) {
      // Show anchor distance summary if anchor + points exist
      if (scene.anchor && scene.points.length) {
        const withDists = scene.points.filter(p => Number.isFinite(p.anchorDistanceMeters));
        if (withDists.length) {
          const avg = withDists.reduce((s,p)=>s+p.anchorDistanceMeters,0)/withDists.length;
          readout.textContent = `Anchor distances: ${withDists.length} pts • avg ${formatDistance(avg)}`;
          return;
        }
      }
      if (me && scene.target) {
        const { meters, bearingDegrees, compass } = distanceAndDirection(me, scene.target);
        const distanceText = meters < 995 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
        readout.textContent = `You → Target: ${distanceText}, bearing ${bearingDegrees.toFixed(0)}° (${compass})`;
        return;
      }
      readout.textContent = "Tracking paused";
      return;
    }

    // Tracking active
    if (!anchorPoint) {
      const count = recentFixes.length;
      readout.textContent = count > 1 ? `Locking GPS… ${count} samples` : "Locking GPS…";
      return;
    }

    if (!me) {
      readout.textContent = "Waiting for GPS fix...";
      return;
    }

    const accuracyText = Number.isFinite(me.accuracy) ? `±${me.accuracy.toFixed(0)} m` : "accuracy n/a";
    const elapsedMs = trackStartTime && lastFixTimestamp ? Math.max(0, lastFixTimestamp - trackStartTime) : 0;
    const elapsedText = formatDuration(elapsedMs);
    const pointsText = track.length || (me ? 1 : 0);
    readout.textContent = `Accuracy ${accuracyText} • Elapsed ${elapsedText} • Points ${pointsText}`;
  }
}

// ------------- Shared helpers -------------

function normalizeInput(input) {
  if (Array.isArray(input)) return { points: input };
  if (input && typeof input === "object") return input;
  return {};
}

function toRad(v){ return (v * Math.PI) / 180; }

function formatDistance(meters, unitsPref) {
  if (unitsPref === "km" || (unitsPref === "m" && meters >= 1000)) {
    const value = meters / 1000;
    return `${value.toFixed(value >= 10 ? 0 : 1)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  if (h>0) return `${h}h ${m}m`;
  if (m>0) return `${m}m ${sec}s`;
  return `${sec}s`;
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
