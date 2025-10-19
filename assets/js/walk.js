// /assets/js/walk.js
import { isSecure, distanceAndDirection } from "/assets/js/utils.js";

export function startWalkingTo(entry) {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported on this device.");
    return;
  }
  if (!isSecure) {
    alert("Enable HTTPS (or use localhost) to access your location.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "walk-overlay";
  overlay.innerHTML = `
  <div class="walk-panel" role="dialog" aria-modal="true" aria-label="Walk to this location">
    <header class="walk-header">
      <h2>Walk to this location</h2>
      <div class="walk-actions">
        <button class="btn btn-outline walk-open-sketch" aria-label="Open sketch map">Sketch map</button>
        <button class="btn btn-outline walk-close" aria-label="Close">Close</button>
      </div>
    </header>
    <div class="walk-body">
      <p class="walk-target">Target:
        <span class="mono">${entry.lat.toFixed(6)}, ${entry.lng.toFixed(6)}</span>
        ${entry.note ? ` · ${entry.note.replace(/</g,"&lt;")}` : ""}
      </p>
      <div class="walk-stats">
        <div><span class="walk-label">Distance</span> <span id="walk-distance">—</span></div>
        <div><span class="walk-label">Direction</span> <span id="walk-bearing">—</span></div>
        <div><span class="walk-label">GPS accuracy</span> <span id="walk-acc">—</span></div>
        <div><span class="walk-label">ETA (walk)</span> <span id="walk-eta">—</span></div>
      </div>

      <p class="walk-note">
        Note: Distance and direction shown are straight-line (“as the crow flies”).
        Use roads, trails, and local guidance to navigate safely.
      </p>

      <div class="walk-arrow" aria-hidden="true">➤</div>
      <p class="status-text" id="walk-status">Getting your position…</p>
    </div>
  </div>`;

  const style = document.createElement("style");
  style.textContent = `
  .walk-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center}
  .walk-panel{background:#fff;color:#111827;max-width:560px;width:min(94%,560px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:1rem 1rem 1.25rem;border:1px solid rgba(0,0,0,.08)}
  @media (prefers-color-scheme: dark){.walk-panel{background:#0f172a;color:#f8fafc;border-color:rgba(255,255,255,.12)} .walk-label{color:#cbd5e1}}
  .walk-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
  .walk-header h2{margin:0;font-size:1.15rem;font-weight:700;letter-spacing:.2px}
  .walk-actions{display:flex;gap:.5rem}
  .walk-body{display:grid;gap:.9rem}
  .walk-target{margin:0;font-size:.98rem;line-height:1.4}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
  .walk-stats{display:grid;gap:.5rem;font-size:1.05rem;padding:.5rem .75rem;border-radius:12px;background:rgba(0,0,0,.04)}
  @media (prefers-color-scheme: dark){.walk-stats{background:rgba(255,255,255,.06)}}
  .walk-label{display:inline-block;min-width:9rem;font-weight:700;color:#6b7280}
  #walk-distance{font-weight:800;font-size:1.25rem}
  .walk-arrow{font-size:3.25rem;text-align:center;line-height:1;transform:rotate(0deg);transition:transform .15s ease;color:#2563eb;text-shadow:0 2px 8px rgba(0,0,0,.35);user-select:none}
  @media (prefers-color-scheme: dark){.walk-arrow{color:#60a5fa}}
  .status-text#walk-status{font-size:.95rem;opacity:.9;margin:.2rem 0 0 0}
  .walk-actions .btn{padding:.55rem 1rem;font-size:1rem;border-radius:14px;font-weight:600;border-width:2px;background:rgba(37,99,235,0.12);color:#1d4ed8;border-color:rgba(37,99,235,0.55);box-shadow:0 6px 16px rgba(37,99,235,0.25)}
  .walk-actions .btn.walk-close{color:#dc2626;border-color:rgba(220,38,38,0.5);background:rgba(220,38,38,0.15);box-shadow:0 6px 16px rgba(220,38,38,0.22)}
  .walk-actions .btn:focus-visible{outline:3px solid rgba(59,130,246,0.75);outline-offset:2px}
  .walk-actions .btn:active{transform:scale(.97)}
  @media (prefers-color-scheme: dark){
    .walk-actions .btn{background:rgba(96,165,250,0.22);color:#e0f2fe;border-color:rgba(191,219,254,0.65);box-shadow:0 8px 20px rgba(59,130,246,0.35)}
    .walk-actions .btn.walk-close{color:#fecaca;border-color:rgba(248,113,113,0.55);background:rgba(248,113,113,0.24);box-shadow:0 8px 20px rgba(248,113,113,0.3)}
  }
  @media (hover:none){
    .walk-actions .btn{border-color:rgba(37,99,235,0.75);background:rgba(37,99,235,0.22)}
    .walk-actions .btn.walk-close{border-color:rgba(220,38,38,0.7);background:rgba(220,38,38,0.26)}
  }
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const btnClose = overlay.querySelector(".walk-close");
  const btnSketch = overlay.querySelector(".walk-open-sketch");
  const elDist = overlay.querySelector("#walk-distance");
  const elBear = overlay.querySelector("#walk-bearing");
  const elAcc = overlay.querySelector("#walk-acc");
  const elEta = overlay.querySelector("#walk-eta");
  const elStat = overlay.querySelector("#walk-status");
  const arrow = overlay.querySelector(".walk-arrow");

  let watchId = null;
  const WALK_SPEED_MPS = 1.4;

  const cleanup = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    overlay.remove();
  };
  btnClose.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });

  btnSketch.addEventListener("click", async () => {
    const { openSketchMap } = await import("/assets/js/sketch-map.js");
    openSketchMap({
      target: { lat: entry.lat, lng: entry.lng, note: entry.note || "Target" },
      liveTrack: true,          // start its own GPS watch & track
      follow: true              // keep view centered on you
    });
  });

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const { meters, bearingDegrees, compass } = distanceAndDirection(cur, entry);

      elDist.textContent = meters < 995 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
      elBear.textContent = `${bearingDegrees.toFixed(0)}° (${compass})`;
      elAcc.textContent = Number.isFinite(pos.coords.accuracy) ? `±${pos.coords.accuracy.toFixed(0)} m` : "n/a";

      if (meters > 3) {
        const secs = Math.round(meters / WALK_SPEED_MPS);
        const mm = Math.floor(secs / 60), ss = secs % 60;
        elEta.textContent = `${mm}m ${ss}s`;
      } else {
        elEta.textContent = "Arrived";
      }

      arrow.style.transform = `rotate(${bearingDegrees}deg)`;
      elStat.textContent = "Updating…";
    },
    (err) => {
      elStat.textContent = `GPS error: ${err.message || err}`;
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}
