// /assets/js/sketch.js
import { haversineMeters, distanceAndDirection } from "/assets/js/utils.js";

export function openSketchMap({ target, liveTrack = true, follow = true }) {
  const overlay = document.createElement("div");
  overlay.className = "sketch-overlay";
  overlay.innerHTML = `
    <div class="sketch-panel" role="dialog" aria-modal="true" aria-label="Sketch map">
      <header class="sketch-header">
        <h2>Sketch map</h2>
        <div class="sketch-actions">
          <button class="btn btn-outline sketch-toggle-follow">${follow ? "Unpin me" : "Follow me"}</button>
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
  const readout = overlay.querySelector("#sketch-readout");

  let followMe = !!follow;
  let track = [];        // {lat,lng,acc?}
  let me = null;         // current {lat,lng,acc?}
  let watchId = null;

  // Projection: simple local equirectangular in meters relative to first fix (or mid between me/target).
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
    const points = [];
    if (target) points.push(target);
    if (me) points.push(me);
    for (const p of track) points.push(p);
    if (!points.length) return { scale: 1, tx: 0, ty: 0 };

    // origin: use the centroid-ish (average) to keep numbers small
    const avg = points.reduce((a,p)=>({lat:a.lat+p.lat,lng:a.lng+p.lng}),{lat:0,lng:0});
    origin = { lat: avg.lat/points.length, lng: avg.lng/points.length };

    const xy = points.map(toXY);
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

    const drawPoint = (pt, color, r=5) => {
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

    // grid (optional subtle)
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = "#000";
    const step = 50 * scale; // ~50m grid
    for (let x = (tx%step); x < canvas.width; x += step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let y = (ty%step); y < canvas.height; y += step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    ctx.restore();

    // path
    drawPath(track);

    // target
    if (target) drawPoint(target, "#f97316", 6);

    // me
    if (me) drawPoint(me, "#2563eb", 6);
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
    if (followMe) {
      // redraw with me centered implicitly via fitView using all points
      draw();
    } else {
      // still redraw — fitView will include both
      draw();
    }
    updateReadout();
  };

  // Controls
  const cleanup = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    overlay.remove();
  };
  btnClose.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
  btnFollow.addEventListener("click", () => {
    followMe = !followMe;
    btnFollow.textContent = followMe ? "Unpin me" : "Follow me";
    draw();
  });

  // Init draw (if only target known yet)
  draw(); updateReadout();

  if (liveTrack && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      onFix,
      (err) => { readout.textContent = `GPS error: ${err.message || err}`; },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }
}
