// /assets/js/sketch.js
// Sketch Map: draw selected saved locations relative to each other (no tiles).
// Includes a "Show My Location" toggle that live-updates the user's current position.

export function openSketchMapOverlay(points) {
  if (!Array.isArray(points) || points.length === 0) {
    alert("No points to display.");
    return;
  }

  // ---------- build overlay ----------
  const overlay = document.createElement("div");
  overlay.className = "sketch-overlay";
  overlay.innerHTML = `
    <div class="sketch-panel" role="dialog" aria-modal="true" aria-label="Sketch Map">
      <header class="sketch-header">
        <h2>Sketch Map</h2>
        <div class="sketch-actions">
          <button id="sketch-locate-btn" class="btn btn-outline" aria-pressed="false">Show My Location</button>
          <button class="btn btn-outline sketch-close" aria-label="Close">Close</button>
        </div>
      </header>
      <div class="sketch-body">
        <canvas id="sketch-canvas"></canvas>
        <div class="sketch-legend">
          <span id="sketch-scale">Scale</span>
          <span id="sketch-status" class="status-text" role="status"></span>
        </div>
        <p class="sketch-note">
          This is a schematic, straight-line sketch using your saved coordinates (no real map).
          When showing your location, it's drawn relative to these points.
        </p>
      </div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .sketch-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);
      backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center;}
    .sketch-panel{background:#fff;color:#111827;max-width:860px;width:min(96%,860px);border-radius:16px;
      box-shadow:0 18px 50px rgba(0,0,0,.35);padding:1rem;border:1px solid rgba(0,0,0,.08);}
    @media (prefers-color-scheme: dark){
      .sketch-panel{background:#0f172a;color:#f8fafc;border-color:rgba(255,255,255,.12);}
    }
    .sketch-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
    .sketch-header h2{margin:0;font-size:1.1rem;font-weight:700}
    .sketch-actions{display:flex;gap:.5rem}
    .sketch-body{display:grid;gap:.6rem}
    #sketch-canvas{width:100%;height:520px;border-radius:12px;background:#f8fafc;border:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){
      #sketch-canvas{background:#0b1223;border-color:rgba(255,255,255,.1);}
    }
    .sketch-legend{display:flex;justify-content:space-between;align-items:center;font-size:.95rem}
    .sketch-note{opacity:.85;margin:.2rem 0 0;font-size:.9rem}
    .btn{cursor:pointer}
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("#sketch-canvas");
  const closeBtn = overlay.querySelector(".sketch-close");
  const locateBtn = overlay.querySelector("#sketch-locate-btn");
  const elScale = overlay.querySelector("#sketch-scale");
  const elStatus = overlay.querySelector("#sketch-status");

  // ---------- projection helpers ----------
  // Use equirectangular approximation relative to map center.
  const deg2rad = (v) => (v * Math.PI) / 180;

  const center = getCenter(points);
  const cosLat0 = Math.cos(deg2rad(center.lat));

  function llToMeters(p) {
    const dx = (p.lng - center.lng) * 111320 * cosLat0; // meters east
    const dy = (p.lat - center.lat) * 110540;          // meters north
    return { x: dx, y: dy };
  }

  // Fit all points into canvas with margins, keep aspect, return scale + offset
  function computeViewport(allMeters, width, height, margin=30) {
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const m of allMeters) {
      if (m.x < minX) minX=m.x; if (m.x > maxX) maxX=m.x;
      if (m.y < minY) minY=m.y; if (m.y > maxY) maxY=m.y;
    }
    // Avoid zero span
    if (minX===maxX) { minX-=10; maxX+=10; }
    if (minY===maxY) { minY-=10; maxY+=10; }

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const sx = (width - margin*2) / spanX;
    const sy = (height - margin*2) / spanY;
    const scale = Math.min(sx, sy);
    const offsetX = margin - minX * scale;
    const offsetY = height - margin + minY * scale; // invert Y when drawing
    return { scale, offsetX, offsetY, spanX, spanY };
  }

  function metersToCanvas(m, vp) {
    return {
      cx: vp.offsetX + m.x * vp.scale,
      cy: vp.offsetY - m.y * vp.scale, // invert Y
    };
  }

  function formatScale(spanMeters, px, totalPx) {
    // spanMeters mapped to totalPx (canvas width). Find a nice round horizontal bar ~120px.
    const metersPerPx = spanMeters / totalPx;
    let targetPx = 120;
    let rawMeters = metersPerPx * targetPx;
    // round to 1/2/5*10^n
    const pow10 = Math.pow(10, Math.floor(Math.log10(rawMeters)));
    const mant = rawMeters / pow10;
    let nice;
    if (mant < 1.5) nice = 1*pow10;
    else if (mant < 3.5) nice = 2*pow10;
    else if (mant < 7.5) nice = 5*pow10;
    else nice = 10*pow10;
    const barPx = Math.round(nice / metersPerPx);
    const label = nice >= 1000 ? `${(nice/1000).toFixed(nice>=10000?0:1)} km` : `${Math.round(nice)} m`;
    return { barPx, label };
  }

  // ---------- prep data ----------
  const baseMeters = points.map(llToMeters);

  // ---------- canvas setup ----------
  const ctx = canvas.getContext("2d");
  const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * DPR);
    canvas.height = Math.round(rect.height * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS pixels
    redraw();
  }

  window.addEventListener("resize", resize, { passive: true });

  // ---------- live location (toggle) ----------
  let watchId = null;
  let userPoint = null; // {x,y, acc} in meters
  let vpCache = null;

  function startLocate() {
    if (!navigator.geolocation) {
      elStatus.textContent = "Geolocation not supported on this device.";
      return;
    }
    elStatus.textContent = "Locating…";
    locateBtn.setAttribute("aria-pressed", "true");
    locateBtn.textContent = "Hide My Location";

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const m = llToMeters({ lat: latitude, lng: longitude });
        userPoint = { ...m, acc: Number.isFinite(accuracy) ? accuracy : null };
        elStatus.textContent = userPoint.acc ? `GPS ±${userPoint.acc.toFixed(0)} m` : "GPS active";
        redraw();
      },
      (err) => {
        elStatus.textContent = `GPS error: ${err.message || err}`;
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  function stopLocate() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    userPoint = null;
    locateBtn.setAttribute("aria-pressed", "false");
    locateBtn.textContent = "Show My Location";
    elStatus.textContent = "";
    redraw();
  }

  locateBtn.addEventListener("click", () => {
    const pressed = locateBtn.getAttribute("aria-pressed") === "true";
    if (pressed) stopLocate(); else startLocate();
  });

  // ---------- draw ----------
  function redraw() {
    // compute viewport including user point if present (so it's always visible)
    const all = userPoint ? [...baseMeters, userPoint] : baseMeters;
    const vp = computeViewport(all, canvas.clientWidth, canvas.clientHeight, 30);
    vpCache = vp;

    // bg
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawGrid(ctx, vp);

    // edges (optional: draw lines connecting in time-order)
    // drawEdges(ctx, baseMeters, vp);

    // saved points
    for (let i = 0; i < baseMeters.length; i++) {
      drawPin(ctx, metersToCanvas(baseMeters[i], vp), i + 1);
    }

    // labels
    drawLabels(ctx, points, baseMeters, vp);

    // user point on top
    if (userPoint) {
      drawUser(ctx, metersToCanvas(userPoint, vp), userPoint.acc, vp);
    }

    // scale bar
    const { barPx, label } = formatScale(vp.spanX, canvas.clientWidth, canvas.clientWidth);
    elScale.textContent = `Scale: ${label}`;
  }

  function drawGrid(ctx, vp) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.save();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--sketch-bg") || "transparent";
    // grid lines every ~100m
    const stepM = chooseGridStep(vp.spanX);
    ctx.strokeStyle = "rgba(0,0,0,.12)";
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      ctx.strokeStyle = "rgba(255,255,255,.12)";
    }
    ctx.lineWidth = 1;

    // convert meter grid to pixels by scanning across canvas
    const leftM = (0 - vp.offsetX) / vp.scale;
    const rightM = (w - vp.offsetX) / vp.scale;
    const topM = (vp.offsetY - h) / vp.scale;
    const botM = (vp.offsetY - 0) / vp.scale;

    const xStart = Math.floor(leftM / stepM) * stepM;
    const yStart = Math.floor(topM / stepM) * stepM;

    for (let mx = xStart; mx <= rightM; mx += stepM) {
      const x = vp.offsetX + mx * vp.scale;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let my = yStart; my <= botM; my += stepM) {
      const y = vp.offsetY - my * vp.scale;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
  }

  function chooseGridStep(spanX) {
    // spanX is horizontal span in meters; target ~10 grid lines
    const raw = spanX / 10;
    const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
    const mant = raw / pow10;
    if (mant < 1.5) return 1 * pow10;
    if (mant < 3.5) return 2 * pow10;
    if (mant < 7.5) return 5 * pow10;
    return 10 * pow10;
  }

  function drawPin(ctx, p, label) {
    ctx.save();
    // pin
    ctx.fillStyle = "#10b981"; // teal-500
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      ctx.fillStyle = "#34d399"; // teal-400
    }
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // outline
    ctx.strokeStyle = "rgba(0,0,0,.4)";
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      ctx.strokeStyle = "rgba(255,255,255,.4)";
    }
    ctx.lineWidth = 1;
    ctx.stroke();

    // number
    ctx.fillStyle = "#111827";
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      ctx.fillStyle = "#f8fafc";
    }
    ctx.font = "600 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(String(label), p.cx + 8, p.cy);
    ctx.restore();
  }

  function drawLabels(ctx, pts, mtrs, vp) {
    ctx.save();
    ctx.fillStyle = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "#cbd5e1" : "#374151";
    ctx.font = "500 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    for (let i = 0; i < pts.length; i++) {
      const { cx, cy } = metersToCanvas(mtrs[i], vp);
      const note = (pts[i].note || "").trim();
      const ts = new Date(pts[i].timestamp || Date.now()).toLocaleString();
      const line = note ? note : ts;
      ctx.fillText(line, cx + 8, cy + 10);
    }
    ctx.restore();
  }

  function drawUser(ctx, p, acc, vp) {
    ctx.save();
    // accuracy ring
    if (Number.isFinite(acc) && acc > 0) {
      const r = acc * vp.scale; // meters -> px
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(59,130,246,.15)"; // blue-500 alpha
      ctx.fill();
    }
    // dot
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#2563eb"; // blue-600
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    // label
    ctx.fillStyle = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "#e5e7eb" : "#111827";
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("You", p.cx, p.cy - 9);
    ctx.restore();
  }

  // ---------- center & init ----------
  function getCenter(pts) {
    // centroid by lat/lng
    let sLat = 0, sLng = 0;
    for (const p of pts) { sLat += p.lat; sLng += p.lng; }
    return { lat: sLat / pts.length, lng: sLng / pts.length };
  }

  // optional: connecting edges in time order (disabled by default)
  // function drawEdges(ctx, m, vp) {
  //   if (m.length < 2) return;
  //   ctx.save();
  //   ctx.strokeStyle = "rgba(99,102,241,.6)"; // indigo-ish
  //   ctx.lineWidth = 2;
  //   ctx.beginPath();
  //   const p0 = metersToCanvas(m[0], vp);
  //   ctx.moveTo(p0.cx, p0.cy);
  //   for (let i = 1; i < m.length; i++) {
  //     const p = metersToCanvas(m[i], vp);
  //     ctx.lineTo(p.cx, p.cy);
  //   }
  //   ctx.stroke();
  //   ctx.restore();
  // }

  // ---------- close / cleanup ----------
  function cleanup() {
    window.removeEventListener("resize", resize);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    overlay.remove();
  }
  closeBtn.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });

  // kick things off
  resize();
}
