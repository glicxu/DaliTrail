// /assets/js/sketch-3d.js
// Lightweight 3D overlay for DaliTrail points/track using Three.js (offline).
// Exports: openThreeOverlay({ points, track, me, target })
//
// Requires vendor files:
//   /vendor/three/0.160.0/three.module.min.js
//   /vendor/three/0.160.0/examples/jsm/controls/OrbitControls.js

export async function openThreeOverlay({ points = [], track = [], me = null, target = null } = {}) {
  const THREE = await import("/vendor/three/0.160.0/three.module.min.js");
  const { OrbitControls } = await import("/vendor/three/0.160.0/examples/jsm/controls/OrbitControls.js");

  // ----- overlay shell -----
  const overlay = document.createElement("div");
  overlay.className = "sketch-overlay";
  overlay.innerHTML = `
    <div class="sketch-panel" role="dialog" aria-modal="true" aria-label="3D view">
      <header class="sketch-header">
        <h2>3D Sketch</h2>
        <div class="sketch-actions" role="toolbar" tabindex="0">
          <button class="btn btn-outline sketch-3d-fit">Fit</button>
          <button class="btn btn-outline sketch-3d-close">Close</button>
        </div>
      </header>
      <div class="sketch-body">
        <div id="sketch-3d-host" style="width:min(92vw,900px);height:min(72vh,520px);border-radius:12px;border:1px solid rgba(0,0,0,.1);background:#0b1220"></div>
        <div class="sketch-readout" id="sketch-3d-readout">Drag to orbit • Wheel/pinch to zoom • Right-drag to pan</div>
      </div>
    </div>
  `;
  // inline style so it's self-contained
  const style = document.createElement("style");
  style.textContent = `
    .sketch-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center;padding:1rem}
    .sketch-panel{background:#fff;color:#111827;max-width:960px;width:min(96%,960px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:1rem;border:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){.sketch-panel{background:#0f172a;color:#f8fafc;border-color:rgba(255,255,255,.12)}}
    .sketch-actions .btn{padding:.5rem .9rem;font-size:.95rem;border-radius:12px;font-weight:600;border-width:2px;box-shadow:none}
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const host = overlay.querySelector("#sketch-3d-host");
  const btnClose = overlay.querySelector(".sketch-3d-close");
  const btnFit = overlay.querySelector(".sketch-3d-fit");

  // ----- scene setup -----
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const light1 = new THREE.DirectionalLight(0xffffff, 1);
  light1.position.set(1, 1, 1);
  const light2 = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(light1, light2);

  // ----- projection helpers -----
  const llAll = [...points, ...track];
  if (me) llAll.push(me);
  if (target) llAll.push(target);
  const origin = computeOrigin(llAll.length ? llAll : [{ lat: 0, lng: 0 }]);

  const metersPerDegX = 111320 * Math.cos(toRad(origin.lat));
  const metersPerDegY = 110540;

  const toLocal = (p) => {
    const x = (p.lng - origin.lng) * metersPerDegX;
    const y = (p.lat - origin.lat) * metersPerDegY;
    const z = Number.isFinite(p.altitude) ? p.altitude : 0;
    return new THREE.Vector3(x, -y, z); // flip Y so north=up (matching 2D)
  };

  const Z_EXAG = 1.0; // vertical exaggeration (tweak if you want)

  // ----- primitives -----
  const makeLine = (vecs, color = 0x3b82f6, width = 2) => {
    const geom = new THREE.BufferGeometry().setFromPoints(vecs);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: width });
    return new THREE.Line(geom, mat);
  };
  const dot = (pos, color = 0xffffff, size = 6) => {
    const g = new THREE.SphereGeometry(size, 16, 16);
    const m = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(pos.x, pos.y, pos.z * Z_EXAG);
    scene.add(mesh);
  };

  // 1) scene points path (blue)
  if (points.length >= 2) {
    const pts = points.map(toLocal).map(v => new THREE.Vector3(v.x, v.y, v.z * Z_EXAG));
    scene.add(makeLine(pts, 0x2563eb, 2));
  }
  // 2) live track path (green)
  if (track.length >= 2) {
    const pts = track.map(toLocal).map(v => new THREE.Vector3(v.x, v.y, v.z * Z_EXAG));
    scene.add(makeLine(pts, 0x22c55e, 2));
  }
  // 3) markers
  points.forEach((p, i) => dot(toLocal(p), i === 0 ? 0x10b981 : i === points.length - 1 ? 0xdb2777 : 0x1d4ed8, 5));
  if (me) dot(toLocal(me), 0x60a5fa, 6);
  if (target) dot(toLocal(target), 0xf97316, 6);

  // ----- camera fit -----
  function fitCamera() {
    const box = new THREE.Box3().setFromObject(scene);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z || 10);
      const dist = maxDim / Math.tan((camera.fov * Math.PI) / 360);
      camera.position.set(center.x + dist * 0.6, center.y + dist * 0.6, center.z + dist * 0.6);
      camera.near = Math.max(0.1, dist / 1000);
      camera.far = dist * 10000;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    } else {
      camera.position.set(0, 0, 1000);
    }
  }

  function resize3D() {
    const rect = host.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || 640));
    const h = Math.max(200, Math.round(rect.height || 420));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(() => { resize3D(); });
  ro.observe(host);
  resize3D();
  fitCamera();

  // render loop
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  // wire controls + cleanup
  btnFit.addEventListener("click", fitCamera);
  const close = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.dispose();
    overlay.remove();
  };
  btnClose.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

// ---- tiny helpers ----
function toRad(v){ return (v * Math.PI) / 180; }
function computeOrigin(points) {
  if (!points.length) return { lat: 0, lng: 0 };
  let latSum = 0, lngSum = 0;
  points.forEach(p => { latSum += p.lat; lngSum += p.lng; });
  return { lat: latSum / points.length, lng: lngSum / points.length };
}
