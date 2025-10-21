// /assets/js/sketch-map-3d.js

// ✅ Local vendor imports (offline)
import * as THREE from "/vendor/three/0.160.0/three.module.min.js";
import { OrbitControls } from "/vendor/three/0.160.0/examples/jsm/controls/OrbitControls.js";

// Minimal 3D sketch map: x/y in meters (local projection), z from altitude.
// Usage: import { openSketchMap3D } from "/assets/js/sketch-map-3d.js";
//        openSketchMap3D({ points }); // points: [{lat,lng,altitude?,timestamp?,note?}]

export async function openSketchMap3D({ points = [] } = {}) {
  const valid = (Array.isArray(points) ? points : [])
    .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));

  if (!valid.length) { alert("No points to render."); return; }

  const THREE = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
  const { OrbitControls } = await import("https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js");

  // UI overlay
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:12px";
  overlay.innerHTML = `
    <div style="background:#fff;color:#0f172a;border:1px solid rgba(0,0,0,.08);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);max-width:980px;width:min(96%,980px);display:grid;gap:8px;padding:12px">
      <header style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:1.05rem;font-weight:800">Sketch map 3D</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="fit3d" class="btn btn-outline" style="border:1px solid rgba(0,0,0,.2);border-radius:10px;padding:.45rem .7rem;font-weight:700;background:#fff;color:#0f172a">Fit view</button>
          <button id="close3d" class="btn btn-outline" style="border:1px solid rgba(0,0,0,.2);border-radius:10px;padding:.45rem .7rem;font-weight:700;background:#fff;color:#0f172a">Close</button>
        </div>
      </header>
      <div style="position:relative">
        <canvas id="sketch3d" style="display:block;width:min(92vw,940px);height:min(72vh,560px);border-radius:10px;border:1px solid rgba(0,0,0,.1);background:#fff"></canvas>
        <div id="stats3d" style="position:absolute;left:10px;bottom:10px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.9);border:1px solid rgba(0,0,0,.08);font:12px system-ui,sans-serif;color:#0f172a"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("#sketch3d");
  const statsEl = overlay.querySelector("#stats3d");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const camera = new THREE.PerspectiveCamera(55, 16/9, 0.1, 1e7);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Lights
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5000, 10000, 8000);
  scene.add(dir);

  // Project lat/lng to local meters (same spirit as your 2D)
  const origin = avgLatLng(valid);
  const meterPoints = valid.map(p => {
    const proj = projectMeters(p, origin);
    // z from altitude; if missing, infer 0; center alt to 0-based for nicer view
    return {
      x: proj.x,
      y: -proj.y,                   // flip to keep north-up if desired
      z: Number.isFinite(p.altitude) ? p.altitude : 0,
    };
  });

  // Center altitude baseline
  const zMin = Math.min(...meterPoints.map(p => p.z));
  const zMax = Math.max(...meterPoints.map(p => p.z));
  const zCenter = Number.isFinite(zMin) && Number.isFinite(zMax) ? (zMin + zMax) / 2 : 0;
  // Vertical exaggeration (tweak as needed)
  const Z_EXAG = 1.5;

  const positions = new Float32Array(meterPoints.length * 3);
  let i = 0;
  for (const p of meterPoints) {
    positions[i++] = p.x;
    positions[i++] = p.z - zCenter * Z_EXAG; // altitude -> vertical axis
    positions[i++] = p.y;
  }

  // Build line geometry
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 1 });
  const line = new THREE.Line(geom, mat);
  scene.add(line);

  // Add a simple ground grid (optional)
  const { bounds } = computeBounds(meterPoints);
  const size = Math.max(bounds.w, bounds.h) || 1000;
  const grid = new THREE.GridHelper(roundToNice(size), roundToNice(size/100));
  grid.rotation.x = Math.PI / 2; // make grid horizontal to our XZ plane
  grid.position.y = -(zCenter * Z_EXAG);
  scene.add(grid);

  // Fit camera
  fitCamera(camera, controls, meterPoints, renderer);

  // Stats text
  if (Number.isFinite(zMin) && Number.isFinite(zMax)) {
    const gainLoss = computeGainLoss(valid);
    statsEl.textContent = `Elev range: ${(zMin).toFixed(0)}–${(zMax).toFixed(0)} m • Gain +${gainLoss.gain.toFixed(0)} m / Loss -${gainLoss.loss.toFixed(0)} m`;
  }

  // Resize
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    renderer.setPixelRatio(dpr);
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Loop
  let rafId = 0;
  function tick() {
    rafId = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  }
  tick();

  // Wiring
  overlay.querySelector("#close3d").addEventListener("click", () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    renderer.dispose();
    overlay.remove();
  });
  overlay.querySelector("#fit3d").addEventListener("click", () => fitCamera(camera, controls, meterPoints, renderer));

  // --- helpers ---
  function avgLatLng(pts) {
    let la = 0, ln = 0;
    for (const p of pts) { la += p.lat; ln += p.lng; }
    return { lat: la / pts.length, lng: ln / pts.length };
  }
  function projectMeters(p, ref) {
    const R = 6371000;
    const toRad = (v) => v * Math.PI / 180;
    const latRad = toRad(p.lat);
    const refLatRad = toRad(ref.lat);
    const dLat = toRad(p.lat - ref.lat);
    const dLng = toRad(p.lng - ref.lng);
    return {
      x: R * dLng * Math.cos((latRad + refLatRad) / 2), // east-west meters
      y: R * dLat,                                       // north-south meters
    };
  }
  function computeBounds(pts) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of pts) { if (p.x<minX) minX=p.x; if (p.x>maxX) maxX=p.x; if (p.y<minY) minY=p.y; if (p.y>maxY) maxY=p.y; }
    return { bounds: { minX, maxX, minY, maxY, w:maxX-minX, h:maxY-minY } };
  }
  function fitCamera(cam, ctrl, pts, rend) {
    if (!pts.length) return;
    const { bounds } = computeBounds(pts);
    const size = Math.max(bounds.w, bounds.h) || 1;
    const box = new THREE.Box3(
      new THREE.Vector3(bounds.minX, -Infinity, bounds.minY),
      new THREE.Vector3(bounds.maxX,  Infinity, bounds.maxY)
    );
    // center + distance heuristic
    const center = new THREE.Vector3((bounds.minX+bounds.maxX)/2, 0, (bounds.minY+bounds.maxY)/2);
    const fov = cam.fov * (Math.PI/180);
    const dist = (size/2) / Math.tan(fov/2);
    cam.position.set(center.x + dist*0.7, center.y + dist*0.8, center.z + dist*0.7);
    cam.lookAt(center);
    ctrl.target.copy(center);
    ctrl.update();
    rend.render(scene, cam);
  }
  function roundToNice(n) {
    const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
  }
  function computeGainLoss(pts) {
    let gain = 0, loss = 0;
    for (let i=1;i<pts.length;i++){
      const a = pts[i-1].altitude, b = pts[i].altitude;
      const aOk = Number.isFinite(a), bOk = Number.isFinite(b);
      const accOk =
        (!Number.isFinite(pts[i]?.altitudeAccuracy) || pts[i].altitudeAccuracy <= 25) &&
        (!Number.isFinite(pts[i-1]?.altitudeAccuracy) || pts[i-1].altitudeAccuracy <= 25);
      if (aOk && bOk && accOk) {
        const d = b - a;
        if (Math.abs(d) >= 1.5) { if (d>0) gain += d; else loss -= d; }
      }
    }
    return { gain, loss };
  }
}
