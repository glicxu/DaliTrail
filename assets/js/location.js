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
  distanceAndDirection,     // used for walk-to overlay
} from "/assets/js/utils.js";

const LOCATIONS_KEY = "dalitrail:locations";
const MAX_SAMPLES = 5;
const SAMPLE_WINDOW_MS = 4500;

// DOM
const locationStatusText = document.getElementById("location-status");
const latestLocationCard = document.getElementById("latest-location-card");
const openLocationHistoryBtn = document.getElementById("open-location-history-btn");
const locationsList = document.getElementById("locations-list");
const locationHistoryStatus = document.getElementById("location-history-status"); // still used by history rendering
const locationNoteInput = document.getElementById("location-note-input");
const manualCoordinateInput = document.getElementById("manual-coordinate-input");
const manualAccuracyInput = document.getElementById("manual-accuracy-input");

let isCapturingLocation = false;
let savedLocations = [];
const selectedLocationIds = new Set();
let locationMode = "auto";

// ----- utils (local wrappers) -----
const haversineDistance = (a, b) => haversineMeters(a, b);
const sanitizeAltitude = (altitude) => (Number.isFinite(altitude) ? altitude : null);

// ----- persistence -----
export const persistSavedLocations = () => {
  try {
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(savedLocations));
  } catch (error) {
    locationStatusText && (locationStatusText.textContent = `Unable to save location: ${error.message}`);
  }
};

export const loadSavedLocations = () => {
  try {
    const raw = localStorage.getItem(LOCATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error("bad store");
    savedLocations = parsed
      .filter((e) => e && Number.isFinite(e.lat) && Number.isFinite(e.lng) && typeof e.id === "string")
      .map((e) => ({
        ...e,
        note: typeof e.note === "string" ? e.note : "",
        altitude: Number.isFinite(e.altitude) ? e.altitude : null,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    savedLocations = [];
  }
};

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
};

export const renderLocationHistory = () => {
  if (!locationsList || !locationHistoryStatus) return;
  locationsList.innerHTML = "";

  const validIds = new Set(savedLocations.map((e) => e.id));
  for (const id of Array.from(selectedLocationIds)) if (!validIds.has(id)) selectedLocationIds.delete(id);

  if (savedLocations.length === 0) {
    locationHistoryStatus.textContent = "No saved locations yet.";
    updateHistoryActions();
    return;
  }

  locationHistoryStatus.textContent = `Select the locations you want to act on.`;
  savedLocations.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "location-history-item";
    li.dataset.id = entry.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = entry.id;
    checkbox.checked = selectedLocationIds.has(entry.id);
    li.appendChild(checkbox);

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
    li.appendChild(card);
    locationsList.appendChild(li);
  });

  updateHistoryActions();
};

const updateHistoryActions = () => {
  const historyViewBtn = document.getElementById("history-view-btn");
  const historyShareBtn = document.getElementById("history-share-btn");
  const historyDeleteBtn = document.getElementById("history-delete-btn");
  const actionsRow = document.querySelector(".history-actions");

  // Ensure "Walk to this location" button exists (injected; no HTML change needed)
  let walkBtn = document.getElementById("history-walk-btn");
  if (!walkBtn && actionsRow) {
    walkBtn = document.createElement("button");
    walkBtn.id = "history-walk-btn";
    walkBtn.className = "btn btn-outline";
    walkBtn.textContent = "Walk to this location";
    actionsRow.insertBefore(walkBtn, historyDeleteBtn || null);
  }

  const selCount = selectedLocationIds.size;
  const hasSelection = selCount > 0;

  if (historyViewBtn) historyViewBtn.disabled = !hasSelection;
  if (historyShareBtn) historyShareBtn.disabled = !hasSelection;
  if (historyDeleteBtn) historyDeleteBtn.disabled = !hasSelection;
  if (walkBtn) walkBtn.disabled = selCount !== 1;
};

document.getElementById("locations-list")?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
  const id = target.value;
  if (!id) return;
  if (target.checked) selectedLocationIds.add(id);
  else selectedLocationIds.delete(id);
  updateHistoryActions();
});

latestLocationCard?.addEventListener("click", (event) => {
  const btn = event.target?.closest?.("button[data-action]");
  if (!(btn instanceof HTMLButtonElement)) return;
  const id = latestLocationCard.dataset.id;
  const entry = savedLocations.find((x) => x.id === id);
  if (!entry) return;
  if (btn.dataset.action === "view") openLocationMap(entry);
  if (btn.dataset.action === "share") void shareLocationEntry(entry);
});

// Handle "Walk to this location" click
document.addEventListener("click", (e) => {
  const btn = e.target;
  if (!(btn instanceof HTMLButtonElement)) return;
  if (btn.id !== "history-walk-btn") return;

  const selected = getSelectedLocations();
  if (selected.length !== 1) return;
  startWalkingTo(selected[0]);
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

    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timerId !== null) window.clearTimeout(timerId);
      watchId = null; timerId = null;
    };

    const finalize = () => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(samples.slice());
    };

    const handleError = (err) => {
      if (resolved) return;
      if (samples.length) finalize();
      else { cleanup(); resolved = true; reject(err); }
    };

    timerId = window.setTimeout(finalize, windowMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, altitude } = pos.coords;
        samples.push({
          lat: latitude,
          lng: longitude,
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
    try {
      await navigator.share(shareData);
      locationStatusText && (locationStatusText.textContent = "Location shared successfully.");
    } catch (error) {
      if (error.name !== "AbortError") locationStatusText && (locationStatusText.textContent = `Share failed: ${error.message}`);
    }
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
    const placemarks = selected
      .map((e, i) => {
        const alt = Number.isFinite(e.altitude) ? e.altitude : 0; // numeric for KML
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
      })
      .join("\n");
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
      if (error.name === "AbortError") {
        locationHistoryStatus && (locationHistoryStatus.textContent = "Share cancelled.");
        return true;
      }
      if (["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(error.name)) return false;
      locationHistoryStatus && (locationHistoryStatus.textContent = `Sharing failed: ${error.message}`);
      return true;
    }
  };

  if (await shareKmlWithFilesApi()) return;

  if (navigator.share && !navigator.canShare) {
    try {
      await navigator.share({ title: "Saved locations", text: shareText });
      locationHistoryStatus && (locationHistoryStatus.textContent = "Locations shared successfully.");
      return;
    } catch (error) {
      if (error.name !== "AbortError" && error.name !== "NotAllowedError" && error.name !== "SecurityError") {
        locationHistoryStatus && (locationHistoryStatus.textContent = `Sharing failed: ${error.message}`);
      }
    }
  }

  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(shareText);
      alert("Locations copied to clipboard. You can paste them anywhere.");
      locationHistoryStatus && (locationHistoryStatus.textContent = "Locations copied to clipboard.");
      return;
    } catch { /* ignore */ }
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
  if (!confirmed) {
    locationHistoryStatus && (locationHistoryStatus.textContent = "Deletion cancelled.");
    return;
  }

  const toRemove = new Set(selected.map((e) => e.id));
  savedLocations = savedLocations.filter((e) => !toRemove.has(e.id));
  selectedLocationIds.clear();
  persistSavedLocations();
  renderLatestLocation();
  renderLocationHistory();
  locationStatusText && (locationStatusText.textContent = savedLocations.length === 0 ? "No locations saved yet." : `Saved ${savedLocations.length} location${savedLocations.length === 1 ? "" : "s"}.`);
  locationHistoryStatus && (locationHistoryStatus.textContent = `Deleted ${selected.length} location${selected.length === 1 ? "" : "s"}.`);
};

// ----- inputs & capture -----
export const applyLocationMode = (mode) => {
  locationMode = mode === "manual" ? "manual" : "auto";
  document.querySelectorAll('input[name="location-mode"]').forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.checked = input.value === locationMode;
    const option = input.closest(".mode-option");
    option?.classList.toggle("active", input.value === locationMode);
  });
  document.querySelectorAll(".location-mode-view").forEach((view) => {
    if (!(view instanceof HTMLElement)) return;
    const isActive = view.dataset.mode === locationMode;
    view.hidden = !isActive;
    view.setAttribute("aria-hidden", String(!isActive));
  });
  if (locationMode === "manual") manualCoordinateInput?.focus();
};

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

export const saveManualLocation = () => {
  const rawValue = manualCoordinateInput?.value.trim();
  if (!rawValue) {
    locationStatusText && (locationStatusText.textContent = "Enter coordinates to continue.");
    manualCoordinateInput?.focus();
    return;
  }
  let lat, lng;
  try {
    const res = parseCoordinateInput(rawValue);
    lat = res.lat; lng = res.lng;
  } catch (error) {
    locationStatusText && (locationStatusText.textContent = error instanceof Error ? error.message : "Unable to parse coordinates.");
    manualCoordinateInput?.focus();
    manualCoordinateInput?.select?.();
    return;
  }
  let accuracy = null;
  const accuracyRaw = manualAccuracyInput?.value.trim();
  if (accuracyRaw) {
    const parsedAccuracy = Number.parseFloat(accuracyRaw);
    if (!Number.isFinite(parsedAccuracy) || parsedAccuracy < 0) {
      locationStatusText && (locationStatusText.textContent = "Accuracy must be a positive number.");
      manualAccuracyInput?.focus();
      return;
    }
    accuracy = parsedAccuracy;
  }
  const note = (locationNoteInput?.value || "").trim();
  const timestamp = Date.now();
  const entry = { id: `${timestamp}-${Math.random().toString(16).slice(2, 8)}`, lat, lng, accuracy, altitude: null, note, timestamp };
  savedLocations = [entry, ...savedLocations];
  persistSavedLocations();
  renderLatestLocation();
  renderLocationHistory();
  manualCoordinateInput && (manualCoordinateInput.value = "");
  manualAccuracyInput && (manualAccuracyInput.value = "");
  locationStatusText && (locationStatusText.textContent = `Manual coordinates saved${Number.isFinite(accuracy) ? ` (~+/-${accuracy.toFixed(1)} m)` : ""}.`);
  console.log(`Manual saved: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
};

export const captureCurrentLocation = async () => {
  if (isCapturingLocation) return;
  if (!navigator.geolocation) return alert("Geolocation is not supported on this device.");
  if (!isSecure) return alert("Enable HTTPS (or use localhost) to access your location.");

  isCapturingLocation = true;
  document.getElementById("capture-location-btn")?.setAttribute("disabled", "true");
  locationStatusText && (locationStatusText.textContent = "Collecting precise location...");
  const note = (locationNoteInput?.value || "").trim();

  try {
    const { fused } = await collectFusedLocation();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      lat: fused.lat,
      lng: fused.lng,
      accuracy: Number.isFinite(fused.accuracy) ? fused.accuracy : null,
      altitude: Number.isFinite(fused.altitude) ? fused.altitude : null, // persist elevation
      note,
      timestamp: fused.timestamp,
    };
    savedLocations = [entry, ...savedLocations];
    persistSavedLocations();
    renderLatestLocation();
    renderLocationHistory();
    if (locationNoteInput) locationNoteInput.value = "";
    locationStatusText && (locationStatusText.textContent = `Location saved${entry.accuracy ? ` (~+/-${entry.accuracy.toFixed(1)} m)` : ""}.`);
  } catch (error) {
    const msg = error && typeof error === "object" && "message" in error ? error.message : String(error);
    locationStatusText && (locationStatusText.textContent = `Unable to capture location: ${msg}`);
  } finally {
    isCapturingLocation = false;
    document.getElementById("capture-location-btn")?.removeAttribute("disabled");
  }
};

// ----- KML import -----
// Now wired for the Location page (status messages use locationStatusText).
(function setupKmlImport() {
  const input = document.getElementById("kmlFileInput"); // input/button is in the Location view
  if (!input) return;

  input.addEventListener("change", async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    try {
      locationStatusText && (locationStatusText.textContent = "Importing KML...");
      const kmlText = await file.text();
      const parsed = parseKmlToEntries(kmlText);
      if (!parsed.length) {
        locationStatusText && (locationStatusText.textContent = "No importable coordinates found in KML.");
        return;
      }
      const before = savedLocations.length;
      mergeImportedLocations(parsed);
      persistSavedLocations();
      renderLatestLocation();
      renderLocationHistory();
      const added = savedLocations.length - before;
      locationStatusText && (locationStatusText.textContent = `Imported ${parsed.length} from KML (${added} new).`);
      alert(`Parsed ${parsed.length} points. Added ${added} new locations.`);
    } catch (err) {
      console.error(err);
      const msg = err && typeof err === "object" && "message" in err ? err.message : String(err);
      locationStatusText && (locationStatusText.textContent = `Failed to import KML: ${msg}`);
      alert(`Failed to import KML: ${msg}`);
    } finally {
      e.target.value = ""; // allow re-importing the same file
    }
  });

  function parseKmlToEntries(kmlText) {
    const dom = new DOMParser().parseFromString(kmlText, "application/xml");
    if (dom.querySelector("parsererror")) throw new Error("Invalid KML format.");

    const q = (sel, root = dom) => root.querySelector(sel);
    const qa = (sel, root = dom) => Array.from(root.querySelectorAll(sel));
    const txt = (root, selectors) => {
      for (const s of selectors) {
        const el = q(s, root);
        if (el && el.textContent) return el.textContent.trim();
      }
      return undefined;
    };

    const entries = [];

    // Iterate all Placemarks
    qa("Placemark").forEach((pm) => {
      const name = txt(pm, ["name"]);
      const desc = txt(pm, ["description"]);
      const when = txt(pm, ["TimeStamp > when", "TimeSpan > begin"]);
      const timestamp = parseIsoTime(when) ?? Date.now();

      // Point
      const coordRaw = txt(pm, ["Point > coordinates"]);
      if (coordRaw) {
        const [lng, lat, alt] = coordRaw.split(",").map((s) => Number(s.trim()));
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          entries.push(mkEntry({ lat, lng, alt, name, desc, timestamp, source: "Point" }));
        }
      }

      // LineString (sampled)
      const lineRaw = txt(pm, ["LineString > coordinates"]);
      if (lineRaw) {
        const linePts = parseCoordinateList(lineRaw);
        const picks = sampleLineVertices(linePts);
        picks.forEach((p, i) => {
          entries.push(mkEntry({
            lat: p.lat, lng: p.lng, alt: p.alt,
            name: name ? `${name} [${i + 1}/${picks.length}]` : "Line vertex",
            desc, timestamp, source: "LineString"
          }));
        });
      }

      // gx:Track
      const track = q("gx\\:Track, Track", pm);
      if (track) {
        const whens = qa("when", track).map((w) => w.textContent.trim());
        const coords = qa("gx\\:coord, coord", track).map((c) => c.textContent.trim().split(/\s+/).map(Number)); // lon lat alt
        const n = Math.min(whens.length, coords.length);
        for (let i = 0; i < n; i++) {
          const [lng, lat, alt] = coords[i];
          const t = parseIsoTime(whens[i]) ?? timestamp;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            entries.push(mkEntry({
              lat, lng, alt, name: name ? `${name} (${i + 1}/${n})` : "Track point",
              desc, timestamp: t, source: "gx:Track"
            }));
          }
        }
      }
    });

    // Deduplicate by rounded lat/lng + timestamp second
    return dedupeByKey(entries, (e) => `${round6(e.lat)},${round6(e.lng)}@${Math.floor(e.timestamp / 1000)}`);
  }

  function mkEntry({ lat, lng, alt, name, desc, timestamp, source }) {
    const altitude = Number.isFinite(alt) ? alt : null;
    const baseNote = [name, desc].filter(Boolean).join(" — ").trim();
    const note = baseNote || (source ? `Imported (${source})` : "Imported");
    const id = `${timestamp}-${round6(lat)}-${round6(lng)}-${Math.random().toString(16).slice(2, 6)}`;
    return {
      id, lat, lng,
      accuracy: null,
      altitude,
      note,
      timestamp
    };
  }

  function mergeImportedLocations(entries) {
    // Avoid duplicates vs existing savedLocations using same rounded key
    const existingKeys = new Set(
      savedLocations.map((e) => `${round6(e.lat)},${round6(e.lng)}@${Math.floor(e.timestamp / 1000)}`)
    );
    const fresh = entries.filter((e) => !existingKeys.has(`${round6(e.lat)},${round6(e.lng)}@${Math.floor(e.timestamp / 1000)}`));
    if (!fresh.length) return;

    // Merge and sort by timestamp desc
    savedLocations = [...fresh, ...savedLocations].sort((a, b) => b.timestamp - a.timestamp);
  }
})();

// ----- Walk-to overlay (live distance & direction) -----
function startWalkingTo(entry) {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported on this device.");
    return;
  }
  if (!isSecure) {
    alert("Enable HTTPS (or use localhost) to access your location.");
    return;
  }

  // Build overlay
  const overlay = document.createElement("div");
  overlay.className = "walk-overlay";
  overlay.innerHTML = `
  <div class="walk-panel" role="dialog" aria-modal="true" aria-label="Walk to this location">
    <header class="walk-header">
      <h2>Walk to this location</h2>
      <button class="btn btn-outline walk-close" aria-label="Close">Close</button>
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

      <p class="walk-note" id="walk-note">
        Note: Distance and direction shown are straight-line (“as the crow flies”).
        Use roads, trails, and local guidance to navigate safely.
      </p>

      <div class="walk-arrow" aria-hidden="true">➤</div>
      <p class="status-text" id="walk-status">Getting your position…</p>
      </div>
    </div>
  `;


  // Minimal scoped styles
  const style = document.createElement("style");
  // Replace your existing style.textContent for the walk overlay with this:
  style.textContent = `
  .walk-overlay{
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,.55);           /* darker scrim for contrast */
    backdrop-filter:saturate(110%) blur(2px);
    display:flex;align-items:center;justify-content:center;
  }
  .walk-panel{
    background:#ffffff;                    /* high contrast light mode */
    color:#111827;                         /* slate-900-ish */
    max-width:560px;width:min(94%, 560px);
    border-radius:16px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);
    padding:1rem 1rem 1.25rem;
    border:1px solid rgba(0,0,0,.08);
  }
  @media (prefers-color-scheme: dark){
    .walk-panel{
      background:#0f172a;                  /* slate-900 */
      color:#f8fafc;                       /* slate-50 */
      border-color:rgba(255,255,255,.12);
    }
    .walk-label{color:#cbd5e1;}            /* slate-300 */
  }
  .walk-header{
    display:flex;align-items:center;justify-content:space-between;
    margin-bottom:.5rem
  }
  .walk-header h2{
    margin:0;font-size:1.15rem;font-weight:700;letter-spacing:.2px
  }
  .walk-body{display:grid;gap:.9rem}
  .walk-target{
    margin:0;font-size:.98rem;line-height:1.4
  }
  .mono{
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace
  }
  .walk-stats{
    display:grid;gap:.5rem;
    font-size:1.05rem;
    padding:.5rem .75rem;
    border-radius:12px;
    background:rgba(0,0,0,.04);
  }
  @media (prefers-color-scheme: dark){
    .walk-stats{background:rgba(255,255,255,.06);}
  }
  .walk-label{
    display:inline-block;min-width:9rem;
    font-weight:700;                        /* stronger label */
    color:#6b7280;                          /* slate-500 (overridden in dark) */
  }
  #walk-distance{
    font-weight:800;font-size:1.25rem;      /* bigger distance readout */
  }
  .walk-arrow{
    font-size:3.25rem;text-align:center;
    line-height:1;
    transform:rotate(0deg);
    transition:transform .15s ease;
    color:#2563eb;                          /* blue-600 */
    text-shadow:0 2px 8px rgba(0,0,0,.35);  /* improve readability on any bg */
    user-select:none;
  }
  @media (prefers-color-scheme: dark){
    .walk-arrow{color:#60a5fa;}             /* blue-400 in dark */
  }
  .status-text#walk-status{
    font-size:.95rem;opacity:.9;margin:.2rem 0 0 0
  }
  .btn.walk-close{
    padding:.4rem .7rem;border-radius:10px;
    border:1px solid currentColor;
    font-weight:600
  }
 `;

  overlay.appendChild(style);
  document.body.appendChild(overlay);

  const btnClose = overlay.querySelector(".walk-close");
  const elDist  = overlay.querySelector("#walk-distance");
  const elBear  = overlay.querySelector("#walk-bearing");
  const elAcc   = overlay.querySelector("#walk-acc");
  const elEta   = overlay.querySelector("#walk-eta");
  const elStat  = overlay.querySelector("#walk-status");
  const arrow   = overlay.querySelector(".walk-arrow");

  let watchId = null;
  const WALK_SPEED_MPS = 1.4; // avg walking speed

  const cleanup = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    overlay.remove();
  };
  btnClose.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const { meters, bearingDegrees, compass } = distanceAndDirection(cur, entry);

      elDist.textContent = meters < 995 ? `${Math.round(meters)} m` : `${(meters/1000).toFixed(2)} km`;
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
