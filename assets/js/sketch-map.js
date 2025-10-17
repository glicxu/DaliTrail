// /assets/js/sketch-map.js
// Minimal, dependency-free sketch map for plotting points in relative positions.
// Exports: openSketchMap (default), openSketchMapOverlay, renderSketchMapIn

// -- Public API ---------------------------------------------------------------

export default function openSketchMap(input) { return openSketchMapOverlay(input); }
export function openSketchMapOverlay(input) {
  const { points, ...opts } = normalizeInput(input);
  const overlay = buildOverlay();
  renderSketchMapIn(overlay.canvas, points, opts);
  return overlay.api;
}

export function renderSketchMapIn(target, points, options = {}) {
  const { canvas, cleanup } = resolveCanvas(target);
  const opts = withDefaults(options);

  // Prepare scene
  const scene = buildScene(points, opts);
  if (!scene.points.length) {
    drawEmpty(canvas, opts);
    return { destroy: cleanup };
  }

  // Viewport / camera state
  const camera = makeCamera(canvas, scene, opts);

  // Interaction handlers
  const handlers = attachInteractions(canvas, camera, scene, opts);

  // Render loop (only on demand)
  const draw = () => drawScene(canvas, camera, scene, opts);
  const resize = () => {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, Math.floor(rect.width || opts.width || 640));
    const h = Math.max(160, Math.floor(rect.height || opts.height || 400));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    camera.dpr = dpr;
    fitToView(camera, scene, opts);
    draw();
  };

  // Observe resize
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Initial draw
  resize();

  // Live track (optional): simple polling callback if user feeds new points
  let liveTimer = null;
  if (opts.liveTrack && typeof opts.onRequestPoints === "function") {
    const tick = async () => {
      try {
        const nextPoints = await opts.onRequestPoints();
        if (Array.isArray(nextPoints) && nextPoints.length) {
          scene.points = normalizePoints(nextPoints);
          recomputeScene(scene);
          if (opts.follow) fitToView(camera, scene, opts);
          draw();
        }
      } finally {
        liveTimer = window.setTimeout(tick, opts.liveIntervalMs);
      }
    };
    liveTimer = window.setTimeout(tick, opts.liveIntervalMs);
  }

  // API for host
  const api = {
    redraw: draw,
    fit: () => (fitToView(camera, scene, opts), draw()),
    setPoints(newPoints) {
      scene.points = normalizePoints(newPoints || []);
      recomputeScene(scene);
      fitToView(camera, scene, opts);
      draw();
    },
    destroy() {
      try { ro.disconnect(); } catch {}
      detachInteractions(canvas, handlers);
      if (liveTimer) window.clearTimeout(liveTimer);
      cleanup();
    },
  };

  // Stash API for overlay close button if present
  canvas.__sketch_api__ = api;
  return api;
}

// -- Internal helpers ---------------------------------------------------------

function normalizeInput(input) {
  if (Array.isArray(input)) return { points: normalizePoints(input) };
  if (input && typeof input === "object" && Array.isArray(input.points)) {
    return { points: normalizePoints(input.points), ...input };
  }
  return { points: [] };
}

function withDefaults(opts) {
  return {
    width: null,
    height: null,
    padding: 20,
    dotRadius: 5,
    lineWidth: 2,
    arrow: false, // set true to draw small arrow heads
    labelDistance: true, // draw distance labels between consecutive points
    units: "m", // "m" or "km" (auto switches to km for >= 1000m if "m")
    font: "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    bg: null, // auto by theme
    fg: null, // auto by theme
    grid: false,
    follow: false,
    liveTrack: false,
    liveIntervalMs: 4000,
    onRequestPoints: null,
    ...opts,
  };
}

function buildOverlay() {
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

  const api = {
    close() {
      try { canvas.__sketch_api__?.destroy?.(); } catch {}
      overlay.remove();
      style.remove();
    },
  };

  btnClose.addEventListener("click", api.close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) api.close(); });
  btnFit.addEventListener("click", () => { canvas.__sketch_api__?.fit?.(); });

  return { overlay, panel, canvas, api };
}

function resolveCanvas(target) {
  if (target instanceof HTMLCanvasElement) {
    return { canvas: target, cleanup: () => {} };
  }
  if (target && target.getContext) {
    return { canvas: target, cleanup: () => {} };
  }
  // Create a canvas in the given element, or body as last resort
  let host = target instanceof HTMLElement ? target : document.body;
  const canvas = document.createElement("canvas");
  canvas.className = "sketchmap-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  return { canvas, cleanup: () => { try { canvas.remove(); } catch {} } };
}

function normalizePoints(points) {
  return points
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    .map((p) => ({ lat: +p.lat, lng: +p.lng, note: p.note || "", timestamp: +p.timestamp || Date.now() }));
}

function buildScene(points, opts) {
  const pts = normalizePoints(points);
  const scene = { points: pts, center: { lat: 0, lng: 0 }, bounds: null, metersPerDegX: 0, metersPerDegY: 111_132, distances: [] };
  recomputeScene(scene);
  return scene;
}

function recomputeScene(scene) {
  const pts = scene.points;
  if (!pts.length) { scene.bounds = null; return; }
  // center by mean lat/lng for better aspect
  let latSum = 0, lngSum = 0;
  pts.forEach(p => { latSum += p.lat; lngSum += p.lng; });
  scene.center.lat = latSum / pts.length;
  scene.center.lng = lngSum / pts.length;
  scene.metersPerDegX = 111_320 * Math.cos(toRad(scene.center.lat));
  scene.metersPerDegY = 110_540;
  // compute projected XY (meters, relative to center)
  pts.forEach(p => {
    p._x = (p.lng - scene.center.lng) * scene.metersPerDegX;
    p._y = -(p.lat - scene.center.lat) * scene.metersPerDegY; // screen y down
  });
  // bounds
  let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(p => { if (p._x < minX) minX = p._x; if (p._x > maxX) maxX = p._x; if (p._y < minY) minY = p._y; if (p._y > maxY) maxY = p._y; });
  scene.bounds = { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  // distances between consecutive points
  scene.distances = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b._x - a._x, dy = b._y - a._y;
    scene.distances.push({ i, meters: Math.hypot(dx, dy) });
  }
}

function makeCamera(canvas, scene, opts) {
  return {
    x: 0, y: 0, scale: 1, dpr: 1,
    padding: opts.padding,
    fit: { ready: false },
    apply(ctx) { ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.x, this.dpr * this.y); },
  };
}

function fitToView(cam, scene, opts) {
  const { width, height } = canvasPixelSize(cam, cam);
  const pad = opts.padding;
  const w = Math.max(1, width / cam.dpr) - pad * 2;
  const h = Math.max(1, height / cam.dpr) - pad * 2;
  const sx = w / scene.bounds.width;
  const sy = h / scene.bounds.height;
  cam.scale = Math.max(0.0001, Math.min(sx, sy));
  // center content
  const cx = -(scene.bounds.minX + scene.bounds.width / 2) * cam.scale + (width / cam.dpr) / 2;
  const cy = -(scene.bounds.minY + scene.bounds.height / 2) * cam.scale + (height / cam.dpr) / 2;
  cam.x = cx;
  cam.y = cy;
  cam.fit.ready = true;
}

function canvasPixelSize(canvasOrCam, cam) {
  const canvas = canvasOrCam.canvas || canvasOrCam;
  return { width: canvas.width, height: canvas.height, dpr: cam.dpr || 1 };
}

function attachInteractions(canvas, cam, scene, opts) {
  let dragging = false;
  let last = { x: 0, y: 0 };
  const toLocal = (evt) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (evt.clientX - rect.left), y: (evt.clientY - rect.top) };
  };
  const redraw = () => drawScene(canvas, cam, scene, opts);

  const onDown = (e) => { dragging = true; last = toLocal(e); e.preventDefault(); };
  const onMove = (e) => {
    if (!dragging) return;
    const pt = toLocal(e);
    cam.x += (pt.x - last.x);
    cam.y += (pt.y - last.y);
    last = pt;
    redraw();
  };
  const onUp = () => { dragging = false; };

  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left);
    const my = (e.clientY - rect.top);
    const wheel = Math.sign(e.deltaY) * 0.1;
    const factor = Math.exp(-wheel); // smooth zoom
    const prevScale = cam.scale;
    const nextScale = clamp(prevScale * factor, 0.1, 50);
    // zoom around mouse
    cam.x = mx - (mx - cam.x) * (nextScale / prevScale);
    cam.y = my - (my - cam.y) * (nextScale / prevScale);
    cam.scale = nextScale;
    redraw();
  };

  // Touch pinch/drag
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
        a: getTouch(e.touches[0]),
        b: getTouch(e.touches[1]),
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
      drawScene(canvas, cam, scene, opts);
    } else if (dragging && e.touches.length === 1) {
      const t = getTouch(e.touches[0]);
      cam.x += (t.x - last.x);
      cam.y += (t.y - last.y);
      last = t;
      drawScene(canvas, cam, scene, opts);
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

  return { onDown, onMove, onUp, onWheel, onTouchStart, onTouchMove, onTouchEnd };
}

function detachInteractions(canvas, h) {
  if (!h) return;
  canvas.removeEventListener("mousedown", h.onDown);
  window.removeEventListener("mousemove", h.onMove);
  window.removeEventListener("mouseup", h.onUp);
  canvas.removeEventListener("wheel", h.onWheel);
  canvas.removeEventListener("touchstart", h.onTouchStart);
  canvas.removeEventListener("touchmove", h.onTouchMove);
  canvas.removeEventListener("touchend", h.onTouchEnd);
  canvas.removeEventListener("touchcancel", h.onTouchEnd);
}

function drawEmpty(canvas, opts) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const theme = getTheme(opts);
  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = theme.fgMuted;
  ctx.font = opts.font;
  ctx.textAlign = "center";
  ctx.fillText("No points to display", width / 2, height / 2);
  ctx.restore();
}

function drawScene(canvas, cam, scene, opts) {
  const ctx = canvas.getContext("2d");
  const theme = getTheme(opts);

  // Clear
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Grid (optional)
  if (opts.grid) drawGrid(canvas, cam, scene, theme);

  // World space
  ctx.save();
  cam.apply(ctx);

  // Lines connecting points in order
  ctx.lineWidth = opts.lineWidth;
  ctx.strokeStyle = theme.accent;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  scene.points.forEach((p, i) => {
    const x = p._x * cam.scale + cam.x;
    const y = p._y * cam.scale + cam.y;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Distances between consecutive points (screen-space labels)
  if (opts.labelDistance && scene.points.length >= 2) {
    ctx.font = opts.font;
    ctx.fillStyle = theme.fgMuted;
    ctx.strokeStyle = theme.bg;
    ctx.lineWidth = 3;
    for (let i = 1; i < scene.points.length; i++) {
      const a = scene.points[i - 1], b = scene.points[i];
      const ax = a._x * cam.scale + cam.x, ay = a._y * cam.scale + cam.y;
      const bx = b._x * cam.scale + cam.x, by = b._y * cam.scale + cam.y;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const meters = scene.distances[i - 1].meters;
      const label = formatDistance(meters, opts.units);
      // text halo
      ctx.save();
      ctx.translate(mx, my - 6);
      ctx.strokeText(label, 0, 0);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  // Points
  const r = opts.dotRadius;
  scene.points.forEach((p, i) => {
    const x = p._x * cam.scale + cam.x;
    const y = p._y * cam.scale + cam.y;
    ctx.fillStyle = i === 0 ? theme.start : (i === scene.points.length - 1 ? theme.end : theme.point);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // index label
    ctx.font = opts.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = theme.fg;
    ctx.fillText(String(i + 1), x, y + r + 3);
  });

  ctx.restore();

  // Border
  ctx.save();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawGrid(canvas, cam, scene, theme) {
  const ctx = canvas.getContext("2d");
  ctx.save();
  cam.apply(ctx);
  const stepMeters = niceStep(scene.bounds.width, 6);
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1 / cam.dpr;
  const minX = scene.bounds.minX - 1000, maxX = scene.bounds.maxX + 1000;
  const minY = scene.bounds.minY - 1000, maxY = scene.bounds.maxY + 1000;
  for (let x = Math.floor(minX / stepMeters) * stepMeters; x <= maxX; x += stepMeters) {
    const px = x * cam.scale + cam.x;
    ctx.beginPath(); ctx.moveTo(px, minY * cam.scale + cam.y); ctx.lineTo(px, maxY * cam.scale + cam.y); ctx.stroke();
  }
  for (let y = Math.floor(minY / stepMeters) * stepMeters; y <= maxY; y += stepMeters) {
    const py = y * cam.scale + cam.y;
    ctx.beginPath(); ctx.moveTo(minX * cam.scale + cam.y, py); ctx.lineTo(maxX * cam.scale + cam.x, py); ctx.stroke();
  }
  ctx.restore();
}

// -- Utilities ----------------------------------------------------------------

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function toRad(d) { return d * Math.PI / 180; }

function niceStep(rangeMeters, targetLines = 6) {
  if (rangeMeters <= 0) return 100;
  const raw = rangeMeters / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

function formatDistance(meters, unitsPref) {
  if (unitsPref === "km" || (unitsPref === "m" && meters >= 1000)) {
    return (meters / 1000).toFixed(meters >= 10_000 ? 0 : 1) + " km";
  }
  return Math.round(meters) + " m";
}

function getTheme(opts) {
  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const bg = opts.bg || (dark ? "#0b1223" : "#ffffff");
  const fg = opts.fg || (dark ? "#e5e7eb" : "#0f172a");
  const fgMuted = dark ? "rgba(229,231,235,.75)" : "rgba(15,23,42,.65)";
  const border = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.08)";
  const grid = dark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)";
  const accent = dark ? "#60a5fa" : "#2563eb";
  const point  = dark ? "#93c5fd" : "#1d4ed8";
  const start  = dark ? "#34d399" : "#059669";
  const end    = dark ? "#f472b6" : "#db2777";
  return { bg, fg, fgMuted, border, grid, accent, point, start, end };
}
