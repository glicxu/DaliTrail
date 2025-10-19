// LOCATION: saved places CRUD, capture/manual entry, history rendering/sharing.

import {
  isSecure,
  formatTimestamp,
  formatElevation,
  haversineMeters,
  round6,
  dedupeByKey,
  parseIsoTime,
  parseKmlCoordinateList as parseCoordinateList,
  sampleLineVertices,
  distanceAndDirection,
  getSunTimes,
  getMoonTimes,
  getMoonPhase,
} from "/assets/js/utils.js";

const LOCATIONS_KEY = "dalitrail:locations";
const MAX_SAMPLES = 5;
const SAMPLE_WINDOW_MS = 4500;

// DOM handles (late-resolved inside init to avoid early nulls)
let locationStatusText;
let latestLocationCard;
let openLocationHistoryBtn;
let locationsList;
let locationHistoryStatus;

// Optional Sun/Moon card
let sunCard, sunRiseEl, sunSetEl, moonCard, moonRiseEl, moonSetEl, moonPhaseEl;

let isCapturingLocation = false;
let savedLocations = [];
const selectedLocationIds = new Set();

// ----- utils -----
const haversineDistance = (a, b) => haversineMeters(a, b);
const sanitizeAltitude = (altitude) => (Number.isFinite(altitude) ? altitude : null);

// ----- modal helpers -----
function openModal({ title, html, onSave, saveText = "Save", onCancel }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="modal-header">
        <h3>${title}</h3>
        <button class="btn btn-outline modal-close" aria-label="Close">Close</button>
      </header>
      <div class="modal-body">${html}</div>
      <footer class="modal-footer">
        <button class="btn btn-primary modal-save">${saveText}</button>
      </footer>
    </div>
  `;
  const style = document.createElement("style");
  style.textContent = `
    .modal-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:saturate(110%) blur(2px);display:flex;align-items:center;justify-content:center}
    .modal-panel{background:#fff;color:#111827;max-width:560px;width:min(94%,560px);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:1rem;border:1px solid rgba(0,0,0,.08)}
    @media (prefers-color-scheme: dark){.modal-panel{background:#0f172a;color:#f8fafc;border-color:rgba(255,255,255,.12)}}
    .modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
    .modal-header h3{margin:0;font-size:1.1rem;font-weight:800}
    .modal-body{display:grid;gap:.75rem;margin:.5rem 0}
    .modal-footer{display:flex;justify-content:flex-end;margin-top:.5rem}
    .modal-footer .btn{min-width:8rem}
    .form-row{display:grid;gap:.35rem}
    .form-row label{font-weight:700;font-size:.95rem;color:#6b7280}
    .form-row input,.form-row textarea{width:100%;padding:.55rem .7rem;border-radius:10px;border:1px solid rgba(0,0,0,.15);background:#fff;color:#111827}
    @media (prefers-color-scheme: dark){
      .form-row input,.form-row textarea{background:#0b1223;color:#e5e7eb;border-color:rgba(255,255,255,.16)}
    }
    .status-note{font-size:.9rem;opacity:.9}
  `;
  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  overlay.querySelector(".modal-close").addEventListener("click", () => { onCancel?.(); close(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { onCancel?.(); close(); } });
  overlay.querySelector(".modal-save").addEventListener("click", async () => {
    if (onSave) {
      const res = await onSave(overlay);
      if (res === false) return;
    }
    close();
  });

  return overlay;
}

// ----- persistence -----
export const persistSavedLocations = () => {
  try { localStorage.setItem(LOCATIONS_KEY, JSON.stringify(savedLocations)); }
  catch (error) { locationStatusText && (locationStatusText.textContent = `Unable to save location: ${error.message}`); }
};

export const loadSavedLocations = () => {
  try {
    const raw = localStorage.getItem(LOCATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error("bad store");
    savedLocations = parsed
      .filter((e) => e && Number.isFinite(e.lat) && Number.isFinite(e.lng) && typeof e.id === "string")
      .map((e) => ({ ...e, note: typeof e.note === "string" ? e.note : "", altitude: Number.isFinite(e.altitude) ? e.altitude : null }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch { savedLocations = []; }
};

// ----- Sun/Moon cards -----
function updateSunCardFor(lat, lng, date = new Date()) {
  if (!sunCard || !sunRiseEl || !sunSetEl) return;
  const { sunrise, sunset, polar } = getSunTimes(lat, lng, date);
  const fmt = (d) => (d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
  sunRiseEl.textContent = fmt(sunrise);
  sunSetEl.textContent = fmt(sunset);
  sunCard.hidden = false;
  if (polar) sunCard.dataset.polar = "true"; else delete sunCard.dataset.polar;
}

function updateMoonCardFor(lat, lng, date = new Date()) {
  if (!moonCard || !moonRiseEl || !moonSetEl || !moonPhaseEl) return;
  const { moonrise, moonset, alwaysUp, alwaysDown } = getMoonTimes(lat, lng, date);
  const fmt = (d) => (d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
  moonRiseEl.textContent = fmt(moonrise);
  moonSetEl.textContent  = fmt(moonset);
  moonCard.hidden = false;
  if (alwaysUp) moonCard.dataset.always = "up";
  else if (alwaysDown) moonCard.dataset.always = "down";
  else delete moonCard.dataset.always;

  const phase = getMoonPhase(date);
  const pct = Math.round(phase.fraction * 100);
  let extra = "";
  if (phase.isNearNew) extra = " · near New Moon";
  if (phase.isNearFull) extra = " · near Full Moon";
  if (!extra) {
    const toFull = phase.daysToFull.toFixed(1);
    const toNew  = Math.min(phase.ageDays, phase.daysToNew).toFixed(1);
    extra = phase.daysToFull < Math.min(phase.ageDays, phase.daysToNew) ? ` · ~${toFull} d to Full` : ` · ~${toNew} d to New`;
  }
  moonPhaseEl.textContent = `${phase.phaseName} (${pct}% lit)${extra}`;
}

// ----- action buttons (safe injection) -----
function hideLegacyModeUI(locationView) {
  // Only hide inside the location view
  locationView.querySelectorAll('.mode-option, .location-mode-view, #capture-location-btn').forEach((el) => {
    if (el instanceof HTMLElement) { el.hidden = true; el.style.display = "none"; }
  });
}

function ensureActionButtons(locationView) {
  // anchor inside location view only
  const anchor =
    locationView.querySelector(".location-controls") ||
    locationView.querySelector(".location-header") ||
    locationView; // fallback to the section itself

  // Guard: must be an Element (not Document)
  if (!(anchor instanceof Element)) return;

  let row = locationView.querySelector("#location-actions-row");
  if (row) return; // already added

  row = document.createElement("div");
  row.id = "location-actions-row";
  row.className = "actions-row";
  row.innerHTML = `
    <button id="btn-record-position" class="btn btn-primary">Record position</button>
    <button id="btn-enter-coords" class="btn btn-outline">Enter GPS coordinates</button>
    <button id="btn-import-kml" class="btn btn-outline">Import KML</button>
  `;
  anchor.prepend(row);

  // light styles once
  if (!document.getElementById("location-actions-row-style")) {
    const style = document.createElement("style");
    style.id = "location-actions-row-style";
    style.textContent = `
      .actions-row{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 .75rem 0}
      .actions-row .btn{padding:.5rem .8rem;border-radius:10px;border:1px solid currentColor;font-weight:700}
    `;
    document.head.appendChild(style);
  }

  // wire buttons
  row.querySelector("#btn-record-position")?.addEventListener("click", onClickRecordPosition);
  row.querySelector("#btn-enter-coords")?.addEventListener("click", onClickEnterManual);
  
  
  // Ensure hidden KML input exists inside this view
  let kmlInput = locationView.querySelector("#kmlFileInput");
  if (!kmlInput) {
    kmlInput = document.createElement("input");
    kmlInput.type = "file";
    kmlInput.id = "kmlFileInput";
    kmlInput.accept = ".kml,.xml,application/vnd.google-earth.kml+xml,application/xml,text/xml";
    kmlInput.hidden = true; // or: kmlInput.style.display = "none";
    locationView.prepend(kmlInput);
  }
  // After building the row and before returning, wire the button:
  row.querySelector("#btn-import-kml")?.addEventListener("click", async () => {
    await ensureKmlImportHook();
    const input = document.getElementById("kmlFileInput");
    if (input && input instanceof HTMLInputElement) {
        input.click(); // Mobile Safari requires user gesture — this is one
    } else {
    alert("KML import setup failed.");
  }
 });
}

// ----- modals -----
async function onClickRecordPosition() {
  if (!navigator.geolocation) { alert("Geolocation is not supported on this device."); return; }
  if (!isSecure) { alert("Enable HTTPS (or use localhost) to access your location."); return; }

  let fusedResult = null;
  let collecting = true;

  const overlay = openModal({
    title: "Record position",
    saveText: "Save location",
    html: `
      <div class="form-row">
        <label for="note-rec">Notes (optional)</label>
        <textarea id="note-rec" rows="3" placeholder="e.g., campsite, viewpoint, water source"></textarea>
      </div>
      <div class="status-note" id="gps-status">Collecting precise position…</div>
      <div id="gps-preview" class="status-note"></div>
    `,
    onCancel: () => { collecting = false; },
    onSave: async (ovl) => {
      if (!fusedResult) {
        const stat = ovl.querySelector("#gps-status");
        if (stat) stat.textContent = "Still collecting GPS… please wait a moment.";
        return false;
      }
      const note = (ovl.querySelector("#note-rec")?.value || "").trim();
      const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        lat: fusedResult.lat,
        lng: fusedResult.lng,
        accuracy: Number.isFinite(fusedResult.accuracy) ? fusedResult.accuracy : null,
        altitude: Number.isFinite(fusedResult.altitude) ? fusedResult.altitude : null,
        note,
        timestamp: fusedResult.timestamp,
      };
      savedLocations = [entry, ...savedLocations];
      persistSavedLocations();
      renderLatestLocation();
      renderLocationHistory();
      locationStatusText && (locationStatusText.textContent = `Location saved${entry.accuracy ? ` (~+/-${entry.accuracy.toFixed(1)} m)` : ""}.`);
      updateSunCardFor(entry.lat, entry.lng);
      updateMoonCardFor(entry.lat, entry.lng);
      return true;
    }
  });

  const stat = overlay.querySelector("#gps-status");
  const preview = overlay.querySelector("#gps-preview");

  try {
    const { fused } = await collectFusedLocation();
    if (!collecting) return;
    fusedResult = fused;
    if (stat) stat.textContent = "GPS ready.";
    if (preview) {
      const acc = Number.isFinite(fused.accuracy) ? `±${fused.accuracy.toFixed(0)} m` : "n/a";
      preview.textContent = `Lat ${fused.lat.toFixed(6)}, Lng ${fused.lng.toFixed(6)} (${acc})`;
    }
  } catch (err) {
    if (stat) stat.textContent = `GPS error: ${err?.message || err}`;
  }
}

function onClickEnterManual() {
  openModal({
    title: "Enter GPS coordinates",
    saveText: "Save location",
    html: `
      <div class="form-row">
        <label for="coords-man">Coordinates</label>
        <input id="coords-man" type="text" placeholder='e.g., 47.6205, -122.3493  or  47°37'14"N 122°20'57"W'>
      </div>
      <div class="form-row">
        <label for="acc-man">Accuracy (meters, optional)</label>
        <input id="acc-man" type="number" inputmode="decimal" placeholder="e.g., 10">
      </div>
      <div class="form-row">
        <label for="note-man">Notes (optional)</label>
        <textarea id="note-man" rows="3" placeholder="e.g., campsite, viewpoint, water source"></textarea>
      </div>
      <div id="man-status" class="status-note"></div>
    `,
    onSave: (ovl) => {
      const coordRaw = ovl.querySelector("#coords-man")?.value?.trim();
      const accRaw = ovl.querySelector("#acc-man")?.value?.trim();
      const note = (ovl.querySelector("#note-man")?.value || "").trim();
      const status = ovl.querySelector("#man-status");

      if (!coordRaw) { status && (status.textContent = "Enter coordinates to continue."); return false; }

      let lat, lng;
      try { const res = parseCoordinateInput(coordRaw); lat = res.lat; lng = res.lng; }
      catch (error) { status && (status.textContent = error instanceof Error ? error.message : "Unable to parse coordinates."); return false; }

      let accuracy = null;
      if (accRaw) {
        const parsedAccuracy = Number.parseFloat(accRaw);
        if (!Number.isFinite(parsedAccuracy) || parsedAccuracy < 0) { status && (status.textContent = "Accuracy must be a positive number."); return false; }
        accuracy = parsedAccuracy;
      }

      const timestamp = Date.now();
      const entry = { id: `${timestamp}-${Math.random().toString(16).slice(2, 8)}`, lat, lng, accuracy, altitude: null, note, timestamp };
      savedLocations = [entry, ...savedLocations];
      persistSavedLocations();
      renderLatestLocation();
      renderLocationHistory();
      locationStatusText && (locationStatusText.textContent = `Manual coordinates saved${Number.isFinite(accuracy) ? ` (~+/-${accuracy.toFixed(1)} m)` : ""}.`);
      return true;
    }
  });
}

// ----- render -----
export const renderLatestLocation = () => {
  if (!latestLocationCard) return;
  latestLocationCard.innerHTML = "";

  if (savedLocations.length === 0) {
    latestLocationCard.classList.add("empty");
    latestLocationCard.innerHTML = `<p class="status-text">No locations saved yet.</p>`;
    delete latestLocationCard.dataset.id;
    locationStatusText && (locationStatusText.textContent = "No locations saved yet.");
    openLocationHistoryBtn && (openLocationHistoryBtn.disabled = true);
    if (sunCard) sunCard.hidden = true;
    return;
  }

  const latest = savedLocations[0];
  latestLocationCard.classList.remove("empty");
  latestLocationCard.dataset.id = latest.id;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `
    <span>${formatTimestamp(latest.timestamp)}</span>
    <span>Lat: ${latest.lat.toFixed(6)} | Lng: ${latest.lng.toFixed(6)}</span>
    ${Number.isFinite(latest.accuracy) ? `<span>Accuracy: +/-${latest.accuracy.toFixed(1)} m</span>` : ""}
    <span>${formatElevation(latest.altitude)}</span>
  `;
  latestLocationCard.appendChild(meta);

  if (latest.note) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = latest.note;
    latestLocationCard.appendChild(note);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <button class="btn btn-primary" data-action="view">View on Map</button>
    <button class="btn btn-outline" data-action="share">Share</button>
  `;
  latestLocationCard.appendChild(actions);

  locationStatusText && (locationStatusText.textContent = `Saved ${savedLocations.length} location${savedLocations.length === 1 ? "" : "s"}.`);
  openLocationHistoryBtn && (openLocationHistoryBtn.disabled = savedLocations.length === 0);

  updateSunCardFor(latest.lat, latest.lng);
  updateMoonCardFor(latest.lat, latest.lng);
};

export const renderLocationHistory = () => {
  if (!locationsList || !locationHistoryStatus) return;
  const previouslyOpenGroups = new Set(
    Array.from(locationsList.querySelectorAll(".history-group-details"))
      .filter((el) => el.open && el.parentElement?.dataset?.group)
      .map((el) => el.parentElement.dataset.group)
  );
  locationsList.innerHTML = "";

  const validIds = new Set(savedLocations.map((e) => e.id));
  for (const id of Array.from(selectedLocationIds)) if (!validIds.has(id)) selectedLocationIds.delete(id);

  if (savedLocations.length === 0) {
    locationHistoryStatus.textContent = "No saved locations yet.";
    ensureHistoryActionButtons();
    updateHistoryActions();
    return;
  }

  locationHistoryStatus.textContent = `Select the locations you want to act on.`;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const createHistoryItem = (entry) => {
    const item = document.createElement("li");
    item.className = "location-history-item";
    item.dataset.id = entry.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = entry.id;
    checkbox.checked = selectedLocationIds.has(entry.id);
    item.appendChild(checkbox);

    const card = document.createElement("div");
    card.className = "location-card";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span>${formatTimestamp(entry.timestamp)}</span>
      <span>Lat: ${entry.lat.toFixed(6)} | Lng: ${entry.lng.toFixed(6)}</span>
      ${Number.isFinite(entry.accuracy) ? `<span>Accuracy: +/-${entry.accuracy.toFixed(1)} m</span>` : ""}
      <span>${formatElevation(entry.altitude)}</span>
    `;
    card.appendChild(meta);
    if (entry.note) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = entry.note;
      card.appendChild(note);
    }
    item.appendChild(card);
    return item;
  };

  const groups = [
    {
      id: "today",
      label: "Today",
      test: (days) => days === 0,
      entries: [],
    },
    {
      id: "last-7",
      label: "Last 7 days",
      test: (days) => days > 0 && days < 7,
      entries: [],
    },
    {
      id: "last-30",
      label: "Last 30 days",
      test: (days) => days >= 7 && days < 30,
      entries: [],
    },
    {
      id: "older",
      label: "Older",
      test: () => true,
      entries: [],
    },
  ];

  savedLocations.forEach((entry) => {
    const entryDate = new Date(entry.timestamp);
    const entryStart = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate()).getTime();
    const diff = todayStart - entryStart;
    const daysDiff = Number.isFinite(diff) ? Math.max(0, Math.floor(diff / MS_PER_DAY)) : 0;
    const group = groups.find((g) => g.test(daysDiff)) || groups[groups.length - 1];
    group.entries.push(entry);
  });

  groups
    .filter((g) => g.entries.length)
    .forEach((group, index) => {
      const wrapper = document.createElement("li");
      wrapper.className = "history-group";
      wrapper.dataset.group = group.id;

      const details = document.createElement("details");
      details.className = "history-group-details";
      details.open = index === 0;

      const summary = document.createElement("summary");
      summary.className = "history-group-summary";
      const selectedCount = group.entries.reduce(
        (acc, entry) => acc + (selectedLocationIds.has(entry.id) ? 1 : 0),
        0
      );
      const allSelected = selectedCount === group.entries.length;
      summary.innerHTML = `
        <span class="history-group-title">${group.label}</span>
        <span class="history-group-count">${group.entries.length}</span>
      `;
      details.appendChild(summary);

      const controls = document.createElement("div");
      controls.className = "history-group-controls";
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "btn btn-outline history-group-toggle";
      toggleBtn.dataset.ids = group.entries.map((entry) => entry.id).join(",");
      toggleBtn.dataset.mode = allSelected ? "clear" : "select";
      toggleBtn.textContent = allSelected ? "Unselect all" : "Select all";
      controls.appendChild(toggleBtn);
      details.appendChild(controls);

      const list = document.createElement("ul");
      list.className = "history-group-list";
      list.setAttribute("role", "list");
      group.entries.forEach((entry) => list.appendChild(createHistoryItem(entry)));
      details.appendChild(list);

      details.open = previouslyOpenGroups.has(group.id) || (previouslyOpenGroups.size === 0 && index === 0);
      wrapper.appendChild(details);
      locationsList.appendChild(wrapper);
    });

  ensureHistoryActionButtons();
  updateHistoryActions();
};

function ensureHistoryActionButtons() {
  const container =
    document.querySelector(".location-history-view .history-actions") ||
    document.querySelector(".history-actions");
  if (!container) return;

  const ensureButton = (id, text) => {
    let btn = document.getElementById(id);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = id;
      btn.className = "btn btn-outline";
      btn.textContent = text;
      container.appendChild(btn);
    }
    return btn;
  };

  const sketchBtn = ensureButton("history-sketch-btn", "Sketch map");
  const walkBtn = ensureButton("history-walk-btn", "Walk to this location");
  const editBtn = ensureButton("history-edit-btn", "Edit");

  // Reorder so sketch, walk, and edit stay grouped.
  if (sketchBtn.nextElementSibling !== walkBtn) container.insertBefore(walkBtn, sketchBtn.nextSibling);
  if (walkBtn.nextElementSibling !== editBtn) container.insertBefore(editBtn, walkBtn.nextSibling);
}

const updateHistoryActions = () => {
  const historyViewBtn = document.getElementById("history-view-btn");
  const historyShareBtn = document.getElementById("history-share-btn");
  const historyDeleteBtn = document.getElementById("history-delete-btn");

  const walkBtn = document.getElementById("history-walk-btn");
  const sketchBtn = document.getElementById("history-sketch-btn");
  const editBtn = document.getElementById("history-edit-btn");

  const selCount = selectedLocationIds.size;
  const hasSelection = selCount > 0;

  if (historyViewBtn) historyViewBtn.disabled = !hasSelection;
  if (historyShareBtn) historyShareBtn.disabled = !hasSelection;
  if (historyDeleteBtn) historyDeleteBtn.disabled = !hasSelection;

  if (walkBtn) walkBtn.disabled = selCount !== 1;
  if (editBtn) editBtn.disabled = selCount !== 1;
  if (sketchBtn) sketchBtn.disabled = !hasSelection;
};

function openEditLocationModal(entry) {
  const overlay = openModal({
    title: "Edit location",
    saveText: "Save changes",
    html: `
      <div class="form-row">
        <label for="edit-coords">Coordinates</label>
        <div id="edit-coords" class="status-note"></div>
      </div>
      <div class="form-row">
        <label for="edit-note">Notes (optional)</label>
        <textarea id="edit-note" rows="3" placeholder="Add details or reminders about this spot"></textarea>
      </div>
      <div class="form-row">
        <label for="edit-accuracy">Accuracy (meters, optional)</label>
        <input id="edit-accuracy" type="number" inputmode="decimal" min="0" step="0.1" placeholder="e.g., 8.5">
      </div>
      <div class="form-row">
        <label for="edit-altitude">Altitude (meters, optional)</label>
        <input id="edit-altitude" type="number" inputmode="decimal" step="0.1" placeholder="e.g., 512">
      </div>
      <div class="status-note">Coordinates are read-only. Update the note or metadata, then save.</div>
    `,
    onSave: (ovl) => {
      const noteInput = /** @type {HTMLTextAreaElement|null} */ (ovl.querySelector("#edit-note"));
      const accInput = /** @type {HTMLInputElement|null} */ (ovl.querySelector("#edit-accuracy"));
      const altInput = /** @type {HTMLInputElement|null} */ (ovl.querySelector("#edit-altitude"));

      const note = noteInput?.value.trim() || "";
      const accRaw = accInput?.value.trim() || "";
      const altRaw = altInput?.value.trim() || "";

      let accuracy = null;
      if (accRaw) {
        const parsed = Number(accRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          if (accInput) accInput.setCustomValidity("Enter a non-negative number.");
          accInput?.reportValidity();
          return false;
        }
        accuracy = parsed;
      } else if (accInput) {
        accInput.setCustomValidity("");
      }

      let altitude = null;
      if (altRaw) {
        const parsed = Number(altRaw);
        if (!Number.isFinite(parsed)) {
          if (altInput) altInput.setCustomValidity("Enter a numeric altitude.");
          altInput?.reportValidity();
          return false;
        }
        altitude = parsed;
      } else if (altInput) {
        altInput.setCustomValidity("");
      }

      entry.note = note;
      if (accuracy === null) delete entry.accuracy;
      else entry.accuracy = accuracy;
      if (altitude === null) delete entry.altitude;
      else entry.altitude = altitude;

      persistSavedLocations();
      renderLatestLocation();
      renderLocationHistory();
      locationHistoryStatus && (locationHistoryStatus.textContent = "Location updated.");
      return true;
    },
  });

  const coordsField = overlay.querySelector("#edit-coords");
  if (coordsField) coordsField.textContent = `${entry.lat.toFixed(6)}, ${entry.lng.toFixed(6)}`;

  const noteField = overlay.querySelector("#edit-note");
  if (noteField instanceof HTMLTextAreaElement) noteField.value = entry.note || "";

  const accField = overlay.querySelector("#edit-accuracy");
  if (accField instanceof HTMLInputElement) {
    accField.value = Number.isFinite(entry.accuracy) ? String(entry.accuracy) : "";
    accField.addEventListener("input", () => accField.setCustomValidity(""));
  }

  const altField = overlay.querySelector("#edit-altitude");
  if (altField instanceof HTMLInputElement) {
    altField.value = Number.isFinite(entry.altitude) ? String(entry.altitude) : "";
    altField.addEventListener("input", () => altField.setCustomValidity(""));
  }
}

// ⛔️ Removed the two top-level listeners; we'll bind them inside safeInit()

// Keep this delegated listener for history actions (already global)
document.addEventListener("click", async (e) => {
  const btn = e.target;
  if (!(btn instanceof HTMLButtonElement)) return;

  if (btn.id === "history-walk-btn") {
    const selected = getSelectedLocations();
    if (selected.length !== 1) return;
    const { startWalkingTo } = await import("/assets/js/walk.js");
    startWalkingTo(selected[0]);
  }

  if (btn.id === "history-sketch-btn") {
    const selected = getSelectedLocations();
    if (!selected.length) return;
    const points = selected.map((e) => ({ lat: e.lat, lng: e.lng, note: e.note || "", timestamp: e.timestamp }));
    try {
      const mod = await import("/assets/js/sketch-map.js");
      const open = mod.openSketchMap || mod.openSketchMapOverlay || mod.default;
      if (!open) throw new Error("Sketch map module missing an export.");
      try { open({ points, liveTrack: true, follow: false }); }
      catch { open(points); }
    } catch (err) {
      console.error(err);
      alert("Unable to open sketch map.");
    }
  }

  if (btn.id === "history-edit-btn") {
    const selected = getSelectedLocations();
    if (selected.length !== 1) return;
    openEditLocationModal(selected[0]);
  }

  if (btn.classList.contains("history-group-toggle")) {
    const ids = btn.dataset.ids ? btn.dataset.ids.split(",").filter(Boolean) : [];
    if (!ids.length) return;
    const mode = btn.dataset.mode === "clear" ? "clear" : "select";
    if (mode === "select") ids.forEach((id) => selectedLocationIds.add(id));
    else ids.forEach((id) => selectedLocationIds.delete(id));
    renderLocationHistory();
  }
});

// ----- geolocation fusion -----
const fuseLocationSamples = (samples) => {
  if (!samples.length) return null;
  const valid = samples.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!valid.length) return null;

  const accurate = valid.filter((s) => Number.isFinite(s.accuracy) && s.accuracy > 0);
  const reference = accurate.length ? accurate.reduce((best, s) => (s.accuracy < best.accuracy ? s : best)) : valid[0];

  const QUALITY_THRESHOLD = 100;
  const MAX_DISTANCE_MULTIPLIER = 2;
  const MIN_DISTANCE_THRESHOLD = 25;

  const qualityFiltered = accurate.length ? accurate.filter((s) => s.accuracy <= QUALITY_THRESHOLD) : valid;
  const distanceThreshold = Math.max(MIN_DISTANCE_THRESHOLD, (reference.accuracy || MIN_DISTANCE_THRESHOLD) * MAX_DISTANCE_MULTIPLIER);

  const clustered = qualityFiltered.filter((s) => {
    const d = haversineDistance(reference, s);
    return Number.isFinite(d) && d <= distanceThreshold;
  });

  const points = clustered.length ? clustered : [reference];

  let wSum = 0, latSum = 0, lngSum = 0, altSum = 0, altW = 0;
  points.forEach((s) => {
    const acc = Number.isFinite(s.accuracy) && s.accuracy > 0 ? s.accuracy : 50;
    const w = 1 / (acc * acc);
    wSum += w;
    latSum += s.lat * w;
    lngSum += s.lng * w;
    if (Number.isFinite(s.altitude)) { altSum += s.altitude * w; altW += w; }
  });

  if (!wSum) {
    const f = reference;
    return { lat: f.lat, lng: f.lng, accuracy: f.accuracy ?? 50, altitude: Number.isFinite(f.altitude) ? f.altitude : null, timestamp: Date.now(), sampleCount: points.length };
  }

  return { lat: latSum / wSum, lng: lngSum / wSum, accuracy: Math.sqrt(1 / wSum), altitude: altW > 0 ? altSum / altW : null, timestamp: Date.now(), sampleCount: points.length };
};

const collectFusedLocation = ({ maxSamples = MAX_SAMPLES, windowMs = SAMPLE_WINDOW_MS } = {}) =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation is not supported."));
    const samples = [];
    let resolved = false, watchId = null, timerId = null;

    const cleanup = () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); if (timerId !== null) window.clearTimeout(timerId); watchId = null; timerId = null; };
    const finalize = () => { if (resolved) return; resolved = true; cleanup(); resolve(samples.slice()); };
    const handleError = (err) => { if (resolved) return; if (samples.length) finalize(); else { cleanup(); resolved = true; reject(err); } };

    timerId = window.setTimeout(finalize, windowMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, altitude } = pos.coords;
        samples.push({
          lat: latitude, lng: longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : Infinity,
          altitude: Number.isFinite(altitude) ? altitude : null,
          timestamp: pos.timestamp || Date.now(),
        });
        if (samples.length >= maxSamples) finalize();
      },
      handleError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: windowMs }
    );
  }).then((samples) => {
    const fused = fuseLocationSamples(samples);
    if (!fused) throw new Error("Unable to determine an accurate position.");
    console.log(`Fused ${samples.length} -> ${fused.lat.toFixed(6)}, ${fused.lng.toFixed(6)}, ±${fused.accuracy?.toFixed(1) ?? "?"}m`);
    return { fused, samples };
  });

// ----- actions -----
const openLocationMap = (entry) => {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${entry.lat},${entry.lng}`)}`;
  window.open(url, "_blank", "noopener");
};

const shareLocationEntry = async (entry) => {
  const noteLine = entry.note ? `\nNote: ${entry.note}` : "";
  const elevationLine = `\n${formatElevation(entry.altitude)}`;
  const message = `Location recorded on ${formatTimestamp(entry.timestamp)}
Lat: ${entry.lat.toFixed(6)}
Lng: ${entry.lng.toFixed(6)}${elevationLine}${noteLine}

Sent from DaliTrail.`;

  const shareData = {
    title: "Saved location",
    text: message,
    url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${entry.lat},${entry.lng}`)}`,
  };

  if (navigator.share) {
    try { await navigator.share(shareData); locationStatusText && (locationStatusText.textContent = "Location shared successfully."); }
    catch (error) { if (error.name !== "AbortError") locationStatusText && (locationStatusText.textContent = `Share failed: ${error.message}`); }
  } else {
    openLocationMap(entry);
  }
};

export const getSelectedLocations = () => savedLocations.filter((e) => selectedLocationIds.has(e.id));

export const openSelectedLocations = () => {
  const selected = getSelectedLocations();
  if (selected.length === 0) return;
  if (selected.length === 1) return openLocationMap(selected[0]);

  const origin = selected[0];
  const destination = selected[selected.length - 1];
  const waypoints = selected.slice(1, -1);
  const fmt = (e) => `${e.lat.toFixed(6)},${e.lng.toFixed(6)}`;

  let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${encodeURIComponent(fmt(origin))}&destination=${encodeURIComponent(fmt(destination))}`;
  if (waypoints.length) url += `&waypoints=${encodeURIComponent(waypoints.map(fmt).join("|"))}`;
  window.open(url, "_blank", "noopener");
};

export const shareSelectedLocations = async () => {
  const selected = getSelectedLocations();
  if (selected.length === 0) return;

  const lines = selected.map((e, i) => {
    const note = e.note ? `Note: ${e.note}\n` : "";
    const acc = Number.isFinite(e.accuracy) ? `Accuracy: +/-${e.accuracy.toFixed(1)} m\n` : "";
    const elev = `${formatElevation(e.altitude)}\n`;
    return `#${i + 1} ${formatTimestamp(e.timestamp)}
Lat: ${e.lat.toFixed(6)}
Lng: ${e.lng.toFixed(6)}
${acc}${elev}${note}`;
  });
  const shareText = `Saved locations from DaliTrail:\n\n${lines.join("\n")}\nSent via DaliTrail.`;

  const buildLocationsKml = () => {
    const name = `DaliTrail-locations-${new Date().toISOString()}`;
    const placemarks = selected.map((e, i) => {
      const alt = Number.isFinite(e.altitude) ? e.altitude : 0;
      const elevText = formatElevation(e.altitude);
      const acc = Number.isFinite(e.accuracy) ? `Accuracy: +/-${e.accuracy.toFixed(1)} m\n` : "";
      return `
    <Placemark>
      <name>Location ${i + 1}</name>
      <description><![CDATA[
${e.note ? `${e.note}\n` : ""}Recorded: ${formatTimestamp(e.timestamp)}
Latitude: ${e.lat.toFixed(6)}
Longitude: ${e.lng.toFixed(6)}
${acc}${elevText}
      ]]></description>
      <Point>
        <coordinates>${e.lng.toFixed(6)},${e.lat.toFixed(6)},${alt.toFixed(1)}</coordinates>
      </Point>
    </Placemark>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
${placemarks}
  </Document>
</kml>`;
  };

  const blob = new Blob([buildLocationsKml()], { type: "application/vnd.google-earth.kml+xml" });
  const filename = `dalitrail-locations-${Date.now()}.kml`;

  const shareKmlWithFilesApi = async () => {
    if (!(navigator.share && navigator.canShare)) return false;
    try {
      const kmlFile = new File([blob], filename, { type: blob.type });
      if (!navigator.canShare({ files: [kmlFile] })) return false;
      await navigator.share({ files: [kmlFile], title: "DaliTrail locations", text: "Selected locations exported from DaliTrail." });
      locationHistoryStatus && (locationHistoryStatus.textContent = "KML shared successfully.");
      return true;
    } catch (error) {
      if (error.name === "AbortError") { locationHistoryStatus && (locationHistoryStatus.textContent = "Share cancelled."); return true; }
      if (["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(error.name)) return false;
      locationHistoryStatus && (locationHistoryStatus.textContent = `Sharing failed: ${error.message}`);
      return true;
    }
  };

  if (await shareKmlWithFilesApi()) return;

  if (navigator.share && !navigator.canShare) {
    try { await navigator.share({ title: "Saved locations", text: shareText }); locationHistoryStatus && (locationHistoryStatus.textContent = "Locations shared successfully."); return; }
    catch (error) { if (error.name !== "AbortError" && error.name !== "NotAllowedError" && error.name !== "SecurityError") locationHistoryStatus && (locationHistoryStatus.textContent = `Sharing failed: ${error.message}`); }
  }

  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(shareText); alert("Locations copied to clipboard. You can paste them anywhere."); locationHistoryStatus && (locationHistoryStatus.textContent = "Locations copied to clipboard."); return; }
    catch {}
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  locationHistoryStatus && (locationHistoryStatus.textContent = "KML downloaded. Share it from your files app.");
};

export const deleteSelectedLocations = () => {
  const selected = getSelectedLocations();
  if (selected.length === 0) return;

  const confirmed = window.confirm(selected.length === 1 ? "Delete this saved location permanently?" : `Delete these ${selected.length} saved locations permanently?`);
  if (!confirmed) { locationHistoryStatus && (locationHistoryStatus.textContent = "Deletion cancelled."); return; }

  const toRemove = new Set(selected.map((e) => e.id));
  savedLocations = savedLocations.filter((e) => !toRemove.has(e.id));
  selectedLocationIds.clear();
  persistSavedLocations();
  renderLatestLocation();
  renderLocationHistory();
  locationStatusText && (locationStatusText.textContent = savedLocations.length === 0 ? "No locations saved yet." : `Saved ${savedLocations.length} location${savedLocations.length === 1 ? "" : "s"}.`);
  locationHistoryStatus && (locationHistoryStatus.textContent = `Deleted ${selected.length} location${selected.length === 1 ? "" : "s"}.`);
};

// ----- coordinate parser -----
const parseCoordinateInput = (raw) => {
  if (!raw) throw new Error("Enter coordinates to continue.");
  const normalized = raw.replace(/[()]/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Enter coordinates to continue.");

  const toDecimal = (degrees, minutes, seconds, direction) => {
    const deg = Number.parseFloat(degrees);
    const min = minutes ? Number.parseFloat(minutes) : 0;
    const sec = seconds ? Number.parseFloat(seconds) : 0;
    if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) throw new Error("Unable to read degrees, minutes, or seconds.");
    let value = Math.abs(deg) + min / 60 + sec / 3600;
    if (deg < 0) value *= -1;
    const dir = direction?.toUpperCase() ?? "";
    if (dir === "S" || dir === "W") value = -Math.abs(value);
    else if (dir === "N" || dir === "E") value = Math.abs(value);
    return value;
  };

  const validatePair = (lat, lng) => {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
    return { lat, lng };
  };

  const dmsRegex = /(\d{1,3})[°º]?\s*(\d{1,2})['’′]?\s*(\d{1,2}(?:\.\d+)?)?["”″]?\s*([NSEW])/gi;
  const dmsMatches = [...normalized.matchAll(dmsRegex)];
  if (dmsMatches.length >= 2) {
    const [a, b] = dmsMatches;
    return validatePair(toDecimal(a[1], a[2], a[3], a[4]), toDecimal(b[1], b[2], b[3], b[4]));
  }

  const directionalDecimalRegex = /([+-]?\d+(?:\.\d+)?)\s*[°º]?\s*([NSEW])/gi;
  const dd = [...normalized.matchAll(directionalDecimalRegex)];
  if (dd.length >= 2) {
    const val = (m) => {
      const v = Number.parseFloat(m[1]); const dir = m[2].toUpperCase();
      if (!Number.isFinite(v)) throw new Error("Unable to read coordinate value.");
      return (dir === "S" || dir === "W") ? -Math.abs(v) : Math.abs(v);
    };
    return validatePair(val(dd[0]), val(dd[1]));
  }

  const commaPair = normalized.match(/^([+-]?\d+(?:\.\d+)?)[\s,]+([+-]?\d+(?:\.\d+)?)(?:[\s,]+)?$/);
  if (commaPair) return validatePair(Number.parseFloat(commaPair[1]), Number.parseFloat(commaPair[2]));

  const tokens = normalized.split(/[\s,]+/).filter((t) => /^[-+]?\d+(?:\.\d+)?$/.test(t));
  if (tokens.length >= 2) return validatePair(Number.parseFloat(tokens[0]), Number.parseFloat(tokens[1]));

  throw new Error("Unable to parse coordinates. Try decimal or degree format.");
};

// ----- KML import hook (unchanged) -----
/* (function initKmlImport() {
  const input = document.getElementById("kmlFileInput");
  if (!input) return;

  import("/assets/js/kml-import.js").then(({ attachKmlImport }) => {
    attachKmlImport({
      input,
      getSaved: () => savedLocations.slice(),
      mergeAndSave: (entries) => {
        const key = (e) => `${round6(e.lat)},${round6(e.lng)}@${Math.floor(e.timestamp / 1000)}`;
        const existing = new Set(savedLocations.map(key));
        const fresh = entries.filter((e) => !existing.has(key(e)));
        if (!fresh.length) return { added: 0, total: savedLocations.length };

        savedLocations = [...fresh, ...savedLocations].sort((a, b) => b.timestamp - a.timestamp);
        persistSavedLocations();
        renderLatestLocation();
        renderLocationHistory();
        return { added: fresh.length, total: savedLocations.length };
      },
      onStatus: (msg) => { locationStatusText && (locationStatusText.textContent = msg); },
    });
  });
})(); */

// ----- KML import hook (resilient) -----
let _kmlInitDone = false;
async function ensureKmlImportHook() {
  if (_kmlInitDone) return;
  const input = document.getElementById("kmlFileInput");
  if (!input) return; // call again after the input is created
  try {
    const { attachKmlImport } = await import("/assets/js/kml-import.js");
    attachKmlImport({
      input,
      getSaved: () => savedLocations.slice(),
      mergeAndSave: (entries) => {
        const key = (e) => `${round6(e.lat)},${round6(e.lng)}@${Math.floor(e.timestamp / 1000)}`;
        const existing = new Set(savedLocations.map(key));
        const fresh = entries.filter((e) => !existing.has(key(e)));
        if (!fresh.length) return { added: 0, total: savedLocations.length };

        savedLocations = [...fresh, ...savedLocations].sort((a, b) => b.timestamp - a.timestamp);
        persistSavedLocations();
        renderLatestLocation();
        renderLocationHistory();
        return { added: fresh.length, total: savedLocations.length };
      },
      onStatus: (msg) => { locationStatusText && (locationStatusText.textContent = msg); },
    });
    _kmlInitDone = true;
  } catch (err) {
    console.error("KML import hook failed:", err);
  }
}


// ----- SAFE INIT (prevents breaking other buttons) -----
function safeInit() {
  try {
    const locationView = document.querySelector('.location-view[data-view="location"]');
    if (!locationView) return; // do nothing if the view isn't in DOM

    // resolve DOM refs inside the view
    locationStatusText = document.getElementById("location-status");
    latestLocationCard = document.getElementById("latest-location-card");
    openLocationHistoryBtn = document.getElementById("open-location-history-btn");
    locationsList = document.getElementById("locations-list");
    locationHistoryStatus = document.getElementById("location-history-status");

    sunCard = document.getElementById("sun-card");
    sunRiseEl = document.getElementById("sunrise-text");
    sunSetEl = document.getElementById("sunset-text");
    moonCard = document.getElementById("moon-card");
    moonRiseEl = document.getElementById("moonrise-text");
    moonSetEl = document.getElementById("moonset-text");
    moonPhaseEl = document.getElementById("moonphase-text");

    hideLegacyModeUI(locationView);
    ensureActionButtons(locationView);

    // ✅ BIND LISTENERS NOW THAT ELEMENTS EXIST
    if (locationsList) {
      locationsList.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
        const id = target.value;
        if (!id) return;
        if (target.checked) selectedLocationIds.add(id);
        else selectedLocationIds.delete(id);
        updateHistoryActions();
      }, { passive: true });
    }

    if (latestLocationCard) {
      latestLocationCard.addEventListener("click", (event) => {
        const btn = event.target?.closest?.("button[data-action]");
        if (!(btn instanceof HTMLButtonElement)) return;
        const id = latestLocationCard.dataset.id;
        const entry = savedLocations.find((x) => x.id === id);
        if (!entry) return;
        if (btn.dataset.action === "view") openLocationMap(entry);
        if (btn.dataset.action === "share") void shareLocationEntry(entry);
      });
    }

    loadSavedLocations();
    renderLatestLocation();
    renderLocationHistory();
  } catch (err) {
    // Fail gracefully so Home buttons still work
    console.error("location.js init failed:", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeInit, { once: true });
} else {
  safeInit();
}
