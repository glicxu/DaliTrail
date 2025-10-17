// /assets/js/sketch-map.js
// Unified sketch map for DaliTrail: supports both "Navigate to target" and "Plot selected points" modes.
//
//  • Navigate mode (walk): openSketchMap({ target, liveTrack=true, follow=true })
//  • Plot mode (multi):    openSketchMap({ points, follow=false })  OR openSketchMap(pointsArray)
//
// Exports: default (openSketchMap), openSketchMap, openSketchMapOverlay
//
// Dependencies: utils.haversineMeters, utils.distanceAndDirection

import { haversineMeters, distanceAndDirection } from "/assets/js/utils.js";

// Public API ------------------------------------------------------------------

export default function openSketchMap(input) { return openSketchMapOverlay(input); }

export function openSketchMapOverlay(input) {
  const opts = normalizeInput(input);

  // Choose mode
  if (opts.target && Number.isFinite(opts.target.lat) && Number.isFinite(opts.target.lng)) {
    return openNavigateOverlay(opts); // live "walk to point"
  }
  return openPlotOverlay(opts);       // multi-point sketch
}

// ---------- Navigate Mode (Walk to a target) ---------------------------------

function openNavigateOverlay({ target, liveTrack = true, follow = true }) {
  const overlay = document.createElement("div");
  overlay.className = "sketch-overlay";
  overlay.innerHTML = `
    <div class="sketch-panel" role="dialog" aria-modal="true" aria-label="Sketch map">
      <header class="sketch-header">
        <h2>Sketch map</h2>
        <div class="sketch-actions">
          <button class="btn btn-outline sketch-toggle-follow">${follow ? "Unpin me" : "Follow me"}</button>
          <button class="btn btn-outline sketch-fit">Fit</button>
          <button class="btn btn-outline sketch-close">Close</button>
        </div>
      </header>

      <div class="sketch-body">
        <canvas id="sketch-canvas" width="800" height="520" aria-label="Sketch map canvas"></canvas>
        <div class="sketch-legend">
          <span class="dot me"></span> You
          <span class="dot target"></span> Target
          <span class="line path"></span> Track
        </div>
        <div class="sketch-readout" id="sketch-readout">—</div>
      </div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
  .sketch-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center}
  .sketch-panel{background:#fff;color:#111827;max-width:960px;width:min(96%,960px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:1rem;border:1px solid rgba(0,0,0,.08)}
  @media (prefers-color-scheme: dark){.sketch-panel{background:#0f172a;color:#f8fafc;border-color:rgba(255,255,255,.12)}}
  .sketch-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
  .sketch-body{display:grid;gap:.5rem}
  canvas{display:block;width:100%;height:auto;background:#ffffff;border-radius:12px;border:1px solid rgba(0,0,0,.1)}
  @media (prefers-color-scheme: dark){canvas{background:#0b1220;border-color:rgba(255,255,255,.1)}}
  .sketch-actions{display:flex;gap:.5rem}
  .sketch-legend{display:flex;gap:1rem;align-items:center;font-size:.95rem;opacity:.9}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%}
  .dot.me{background:#2563eb} .dot.target{background:#f97316}
  .line.path{display:inline-block;width:22px;height:0;border-top:3px solid #22c55e;border-radius:2px}
  .sketch-readout{font-family:ui-monospace,monospace;font-size:.95rem;opacity:.9}
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("#sketch-canvas");
  const ctx = canvas.getContext("2d");
  const btnClose = overlay.querySelector(".sketch-close");
  const btnFollow = overlay.querySelector(".sketch-toggle-follow");
  const btnFit = overlay.querySelector(".sketch-fit");
  const readout = overlay.querySelector("#sketch-readout");

  let followMe = !!follow;
  let track = [];        // {lat,lng,acc?}
  let me = null;         // current {lat,lng,acc?}
  let watchId = null;

  // Projection: local equirectangular relative to a moving origin (centroid of me/target/track)
  let origin = target ? { lat: target.lat, lng: target.lng } : null;

  const toXY = (pt) => {
    // meters relative to origin (equirectangular)
    const R = 6371000;
    const dLat = (pt.lat - origin.lat) * Math.PI/180;
    const dLng = (pt.lng - origin.lng) * Math.PI/180;
    const x = R * dLng * Math.cos((pt.lat + origin.lat)/2 * Math.PI/180);
    const y = R * dLat;
    return { x, y };
  };

  const fitView = () => {
    // Compute extents of path + target (+ me)
    const pts = [];
    if (target) pts.push(target);
    if (me) pts.push(me);
    for (const p of track) pts.push(p);
    if (!pts.length) return { scale: 1, tx: 0, ty: 0 };

    // origin: use the centroid-ish (average) to keep numbers small
    const avg = pts.reduce((a,p)=>({lat:a.lat+p.lat,lng:a.lng+p.lng}),{lat:0,lng:0});
    origin = { lat: avg.lat/pts.length, lng: avg.lng/pts.length };

    const xy = pts.map(toXY);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of xy){ if(p.x<minX)minX=p.x;if(p.x>maxX)maxX=p.x;if(p.y<minY)minY=p.y;if(p.y>maxY)maxY=p.y; }
    const pad = 30;
    const w = canvas.width - pad*2;
    const h = canvas.height - pad*2;
    const spanX = Math.max(5, maxX-minX);
    const spanY = Math.max(5, maxY-minY);
    const scale = Math.min(w/spanX, h/spanY);
    const tx = pad + (-minX)*scale;
    const ty = pad + h + (minY)*scale; // flip y
    return { scale, tx, ty };
  };

  const draw = () => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const { scale, tx, ty } = fitView();

    const drawPoint = (pt, color, r=6) => {
      const { x, y } = toXY(pt);
      ctx.beginPath();
      ctx.arc(x*scale+tx, -y*scale+ty, r, 0, Math.PI*2);
      ctx.fillStyle = color;
      ctx.fill();
    };

    const drawPath = (arr, color="#22c55e") => {
      if (arr.length < 2) return;
      ctx.beginPath();
      const a = toXY(arr[0]);
      ctx.moveTo(a.x*scale+tx, -a.y*scale+ty);
      for (let i=1;i<arr.length;i++){
        const p = toXY(arr[i]);
        ctx.lineTo(p.x*scale+tx, -p.y*scale+ty);
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    // grid (subtle)
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = "#000";
    const step = 50 * (fitView().scale); // ~50m grid visual spacing
    for (let x = (fitView().tx%step); x < canvas.width; x += step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let y = (fitView().ty%step); y < canvas.height; y += step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    ctx.restore();

    // path
    drawPath(track);

    // target
    if (target) drawPoint(target, "#f97316", 7);

    // me
    if (me) drawPoint(me, "#2563eb", 7);
  };

  const updateReadout = () => {
    if (!me || !target) { readout.textContent = "—"; return; }
    const { meters, bearingDegrees, compass } = distanceAndDirection(me, target);
    const dist = meters < 995 ? `${Math.round(meters)} m` : `${(meters/1000).toFixed(2)} km`;
    readout.textContent = `You → Target: ${dist}, bearing ${bearingDegrees.toFixed(0)}° (${compass})`;
  };

  const onFix = (pos) => {
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    if (track.length === 0) track.push(me);
    else {
      // append if moved > 3 m
      const last = track[track.length-1];
      if (haversineMeters(last, me) > 3) track.push(me);
      // keep track length sane
      if (track.length > 1500) track = track.slice(-1500);
    }
    draw();
    updateReadout();
  };

  const cleanup = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    overlay.remove();
    try { style.remove(); } catch {}
  };

  btnClose.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
  btnFollow.addEventListener("click", () => {
    followMe = !followMe;
    btnFollow.textContent = followMe ? "Unpin me" : "Follow me";
    draw();
  });
  btnFit.addEventListener("click", draw);

  // Initial draw (if only target known yet)
  draw(); updateReadout();

  if (liveTrack && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      onFix,
      (err) => { readout.textContent = `GPS error: ${err.message || err}`; },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }

  return { close: cleanup };
}

// ---------- Plot Mode (Multiple points relative with connecting lines) -------

function openPlotOverlay(input) {
  const { points = [], follow = false, labelDistance = true, units = "m" } = input || {};

  const overlay = document.createElement("div");
  overlay.className = "sketchmap-overlay";
  overlay.innerHTML = `
    <div class="sketchmap-panel" role="dialog" aria-modal="true" aria-label="Sketch map">
      <header class="sketchmap-toolbar">
        <div class="left">
          <button class="btn btn-outline sm-fit" title="Fit">Fit</button>
        </div>
        <div class="right">
          <button class="btn btn-outline sm-close" aria-label="Close">✕</button>
        </div>
      </header>
      <div class="sketchmap-body">
        <canvas class="sketchmap-canvas"></canvas>
      </div>
      <footer class="sketchmap-hint">Drag to pan · Wheel/pinch to zoom</footer>
    </div>
  `;
  const style = document.createElement("style");
  style.textContent = `
    .sketchmap-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center}
    .sketchmap-panel{background:#fff;color:#0f172a;width:min(96vw,920px);height:min(90vh,680px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;border:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){
      .sketchmap-panel{background:#0b1223;color:#e5e7eb;border-color:rgba(255,255,255,.12)}
    }
    .sketchmap-toolbar{display:flex;align-items:center;justify-content:space-between;padding:.5rem .75rem;border-bottom:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){ .sketchmap-toolbar{border-color:rgba(255,255,255,.12)} }
    .sketchmap-toolbar .btn{padding:.35rem .6rem;border-radius:10px;border:1px solid currentColor;font-weight:700}
    .sketchmap-body{flex:1;display:flex}
    .sketchmap-canvas{flex:1;display:block;width:100%;height:100%;border-radius:12px}
    .sketchmap-hint{opacity:.7;font-size:.85rem;padding:.4rem .75rem}
  `;
  document.body.appendChild(style);
  document.body.appendChild(overlay);

  const panel = overlay.querySelector(".sketchmap-panel");
  const canvas = overlay.querySelector(".sketchmap-canvas");
  const btnClose = overlay.querySelector(".sm-close");
  const btnFit = overlay.querySelector(".sm-fit");

  // Prepare scene
  const scene = buildPlotScene(points);
  const cam = { x: 0, y: 0, scale: 1, dpr: 1, padding: 20 };
  const ctx = canvas.getContext("2d");

  // Resize observer
  const ro = new ResizeObserver(() => resizeAndDraw());
  ro.observe(canvas);

  function resizeAndDraw() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cam.dpr = dpr;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, Math.floor(rect.width || 640));
    const h = Math.max(160, Math.floor(rect.height || 400));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    fitPlot(cam, scene);
    drawPlot(canvas, ctx, cam, scene, { labelDistance, units });
  }

  // Interactions
  let dragging = false;
  let last = { x: 0, y: 0 };
  const toLocal = (evt) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (evt.clientX - rect.left), y: (evt.clientY - rect.top) };
  };

  const onDown = (e) => { dragging = true; last = toLocal(e); e.preventDefault(); };
  const onMove = (e) => {
    if (!dragging) return;
    const pt = toLocal(e);
    cam.x += (pt.x - last.x);
    cam.y += (pt.y - last.y);
    last = pt;
    drawPlot(canvas, ctx, cam, scene, { labelDistance, units });
  };
  const onUp = () => { dragging = false; };

  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left);
    const my = (e.clientY - rect.top);
    const wheel = Math.sign(e.deltaY) * 0.1;
    const factor = Math.exp(-wheel);
    const prevScale = cam.scale;
    const nextScale = clamp(prevScale * factor, 0.1, 50);
    cam.x = mx - (mx - cam.x) * (nextScale / prevScale);
    cam.y = my - (my - cam.y) * (nextScale / prevScale);
    cam.scale = nextScale;
    drawPlot(canvas, ctx, cam, scene, { labelDistance, units });
  };

  // Touch
  let pinch = null;
  const getTouch = (t) => ({ x: t.clientX, y: t.clientY });
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      dragging = true;
      last = getTouch(e.touches[0]);
    } else if (e.touches.length === 2) {
      dragging = false;
      pinch = {
        startDist: dist2(getTouch(e.touches[0]), getTouch(e.touches[1])),
        startScale: cam.scale,
        startX: cam.x,
        startY: cam.y,
        center: { x: (getTouch(e.touches[0]).x + getTouch(e.touches[1]).x) / 2, y: (getTouch(e.touches[0]).y + getTouch(e.touches[1]).y) / 2 },
      };
    }
  };
  const onTouchMove = (e) => {
    if (pinch && e.touches.length === 2) {
      const a = getTouch(e.touches[0]);
      const b = getTouch(e.touches[1]);
      const d = dist2(a, b);
      const factor = clamp(d / pinch.startDist, 0.2, 5);
      const nextScale = clamp(pinch.startScale * factor, 0.1, 50);
      cam.x = pinch.center.x - (pinch.center.x - pinch.startX) * (nextScale / pinch.startScale);
      cam.y = pinch.center.y - (pinch.center.y - pinch.startY) * (nextScale / pinch.startScale);
      cam.scale = nextScale;
      drawPlot(canvas, ctx, cam, scene, { labelDistance, units });
    } else if (dragging && e.touches.length === 1) {
      const t = getTouch(e.touches[0]);
      cam.x += (t.x - last.x);
      cam.y += (t.y - last.y);
      last = t;
      drawPlot(canvas, ctx, cam, scene, { labelDistance, units });
    }
  };
  const onTouchEnd = () => { dragging = false; pinch = null; };

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: true });
  canvas.addEventListener("touchmove", onTouchMove, { passive: true });
  canvas.addEventListener("touchend", onTouchEnd, { passive: true });
  canvas.addEventListener("touchcancel", onTouchEnd, { passive: true });

  const close = () => {
    try {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
      ro.disconnect();
    } catch {}
    overlay.remove();
    try { style.remove(); } catch {}
  };

  btnClose.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  btnFit.addEventListener("click", resizeAndDraw);

  // initial render
  resizeAndDraw();
  if (follow) resizeAndDraw();

  return { close, fit: resizeAndDraw };
}

// ---------- Plot helpers -----------------------------------------------------

function buildPlotScene(points) {
  const pts = (Array.isArray(points) ? points : []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    .map(p => ({ lat:+p.lat, lng:+p.lng, note:p.note||"", timestamp:+p.timestamp||Date.now() }));

  const scene = { points: pts, center: { lat: 0, lng: 0 }, metersPerDegX: 0, metersPerDegY: 110540, bounds: null, distances: [] };

  if (!pts.length) return scene;

  // center for projection (mean)
  let latSum = 0, lngSum = 0;
  pts.forEach(p => { latSum += p.lat; lngSum += p.lng; });
  scene.center.lat = latSum / pts.length;
  scene.center.lng = lngSum / pts.length;
  scene.metersPerDegX = 111320 * Math.cos(toRad(scene.center.lat));

  // project to local meters
  pts.forEach(p => {
    p._x = (p.lng - scene.center.lng) * scene.metersPerDegX;
    p._y = -(p.lat - scene.center.lat) * scene.metersPerDegY; // down is positive canvas y
  });

  // bounds
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  pts.forEach(p => { if(p._x<minX)minX=p._x;if(p._x>maxX)maxX=p._x;if(p._y<minY)minY=p._y;if(p._y>maxY)maxY=p._y; });
  scene.bounds = { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };

  // segment distances (meters)
  scene.distances = [];
  for (let i=1; i<pts.length; i++) {
    const a = pts[i-1], b = pts[i];
    const dx = b._x - a._x, dy = b._y - a._y;
    scene.distances.push({ i, meters: Math.hypot(dx, dy) });
  }

  return scene;
}

function fitPlot(cam, scene) {
  if (!scene.bounds) return;
  const pad = cam.padding || 20;
  const w = canvasCssPx(cam).w - pad*2;
  const h = canvasCssPx(cam).h - pad*2;
  const sx = w / scene.bounds.width;
  const sy = h / scene.bounds.height;
  cam.scale = Math.max(0.0001, Math.min(sx, sy));
  // center
  const cx = -(scene.bounds.minX + scene.bounds.width/2) * cam.scale + (canvasCssPx(cam).w)/2;
  const cy = -(scene.bounds.minY + scene.bounds.height/2) * cam.scale + (canvasCssPx(cam).h)/2;
  cam.x = cx;
  cam.y = cy;
}

function drawPlot(canvas, ctx, cam, scene, { labelDistance = true, units = "m" } = {}) {
  const theme = getTheme();
  // clear
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = theme.bg; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore();

  // world transform
  ctx.save();
  ctx.setTransform(cam.dpr * 1, 0, 0, cam.dpr * 1, 0, 0);

  // path lines
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.accent;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  scene.points.forEach((p, i) => {
    const x = p._x * cam.scale + cam.x;
    const y = p._y * cam.scale + cam.y;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // points with index labels
  const r = 5;
  scene.points.forEach((p, i) => {
    const x = p._x * cam.scale + cam.x;
    const y = p._y * cam.scale + cam.y;
    ctx.fillStyle = i === 0 ? theme.start : (i === scene.points.length - 1 ? theme.end : theme.point);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = theme.fg;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(String(i+1), x, y + r + 3);
  });

  // segment distance labels
  if (labelDistance && scene.points.length >= 2) {
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    for (let i=1; i<scene.points.length; i++) {
      const a = scene.points[i-1], b = scene.points[i];
      const ax = a._x * cam.scale + cam.x, ay = a._y * cam.scale + cam.y;
      const bx = b._x * cam.scale + cam.x, by = b._y * cam.scale + cam.y;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const meters = scene.distances[i-1].meters;
      const label = formatDistance(meters, units);
      // halo
      ctx.save();
      ctx.strokeStyle = theme.bg; ctx.lineWidth = 3; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.strokeText(label, mx, my - 6);
      ctx.fillStyle = theme.fgMuted;
      ctx.fillText(label, mx, my - 6);
      ctx.restore();
    }
  }

  ctx.restore();

  // border
  ctx.save(); ctx.strokeStyle = theme.border; ctx.lineWidth = 1; ctx.strokeRect(0,0,canvas.width,canvas.height); ctx.restore();
}

// ---------- Shared utils -----------------------------------------------------

function normalizeInput(input) {
  if (Array.isArray(input)) return { points: input };
  if (input && typeof input === "object") return input;
  return {};
}

function toRad(d) { return d * Math.PI / 180; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function canvasCssPx(cam) {
  const c = cam.canvas || cam._canvas || document.querySelector(".sketchmap-canvas") || { width: 800, height: 520 };
  return { w: c.width / (cam.dpr || 1), h: c.height / (cam.dpr || 1) };
}
function formatDistance(meters, unitsPref) {
  if (unitsPref === "km" || (unitsPref === "m" && meters >= 1000)) {
    return (meters / 1000).toFixed(meters >= 10_000 ? 0 : 1) + " km";
  }
  return Math.round(meters) + " m";
}
function getTheme() {
  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const bg = dark ? "#0b1223" : "#ffffff";
  const fg = dark ? "#e5e7eb" : "#0f172a";
  const fgMuted = dark ? "rgba(229,231,235,.75)" : "rgba(15,23,42,.65)";
  const border = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.08)";
  const accent = dark ? "#60a5fa" : "#2563eb";
  const point  = dark ? "#93c5fd" : "#1d4ed8";
  const start  = dark ? "#34d399" : "#059669";
  const end    = dark ? "#f472b6" : "#db2777";
  return { bg, fg, fgMuted, border, accent, point, start, end };
}
