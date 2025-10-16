// LOCATION: saved places CRUD, capture/manual entry, history rendering/sharing.

import {
  isSecure,
  formatTimestamp,
  formatElevation,
  haversineMeters,
  round6,
  dedupeByKey,
  parseIsoTime,
  parseKmlCoordinateList as parseCoordinateList, // kept for compatibility (used in kml-import module)
  sampleLineVertices,                              // kept for compatibility (used in kml-import module)
  distanceAndDirection, // used elsewhere; keep export compatibility
  getSunTimes,          // <-- NEW: sunrise / sunset (local-time aware)
  getMoonTimes,         // <-- NEW: moonrise / moonset (local-time aware)
  getMoonPhase,        // <-- NEW: moon phase (0-1)
} from "/assets/js/utils.js";

const LOCATIONS_KEY = "dalitrail:locations";
const MAX_SAMPLES = 5;
const SAMPLE_WINDOW_MS = 4500;

// DOM
const locationStatusText = document.getElementById("location-status");
const latestLocationCard = document.getElementById("latest-location-card");
const openLocationHistoryBtn = document.getElementById("open-location-history-btn");
const locationsList = document.getElementById("locations-list");
const locationHistoryStatus = document.getElementById("location-history-status");
const locationNoteInput = document.getElementById("location-note-input");
const manualCoordinateInput = document.getElementById("manual-coordinate-input");
const manualAccuracyInput = document.getElementById("manual-accuracy-input");

// Optional Sun/Moon card (if present in HTML)
const sunCard = document.getElementById("sun-card");
const sunRiseEl = document.getElementById("sunrise-text");
const sunSetEl = document.getElementById("sunset-text");
const moonCard   = document.getElementById("moon-card");
const moonRiseEl = document.getElementById("moonrise-text");
const moonSetEl  = document.getElementById("moonset-text");
const moonPhaseEl= document.getElementById("moonphase-text"); 


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

// ----- Sun card -----
function updateSunCardFor(lat, lng, date = new Date()) {
  if (!sunCard || !sunRiseEl || !sunSetEl) return;
  const { sunrise, sunset, polar } = getSunTimes(lat, lng, date);
  const fmt = (d) => (d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
  sunRiseEl.textContent = fmt(sunrise);
  sunSetEl.textContent = fmt(sunset);
  sunCard.hidden = false;
  if (polar) {
    sunCard.dataset.polar = "true";
  } else {
    delete sunCard.dataset.polar;
  }
}

function updateMoonCardFor(lat, lng, date = new Date()) {
  if (!moonCard || !moonRiseEl || !moonSetEl || !moonPhaseEl) return;

  // Rise/Set
  const { moonrise, moonset, alwaysUp, alwaysDown } = getMoonTimes(lat, lng, date);
  const fmt = (d) => (d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
  moonRiseEl.textContent = fmt(moonrise);
  moonSetEl.textContent  = fmt(moonset);
  moonCard.hidden = false;

  if (alwaysUp) moonCard.dataset.always = "up";
  else if (alwaysDown) moonCard.dataset.always = "down";
  else delete moonCard.dataset.always;

  // Phase
  const phase = getMoonPhase(date);
  const pct = Math.round(phase.fraction * 100);
  let extra = "";
  if (phase.isNearNew)  extra = " · near New Moon";
  if (phase.isNearFull) extra = " · near Full Moon";
  // If both flags are false, optionally show days to nearest major:
  if (!extra) {
    const toFull = phase.daysToFull.toFixed(1);
    const toNew  = Math.min(phase.ageDays, phase.daysToNew).toFixed(1);
    // choose whichever is nearer
    extra = phase.daysToFull < Math.min(phase.ageDays, phase.daysToNew)
      ? ` · ~${toFull} d to Full`
      : ` · ~${toNew} d to New`;
  }
  moonPhaseEl.textContent = `${phase.phaseName} (${pct}% lit)${extra}`;
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
    // Sun card: hide if no data
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

  // Update Sun card for the latest location
  updateSunCardFor(latest.lat, latest.lng);

  // Update Moon card for the latest location
  updateMoonCardFor(latest.lat, latest.lng);

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

  // ensure "Walk to this location" exists
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

// Handle "Walk to this location" click (delegated)
document.addEventListener("click", async (e) => {
  const btn = e.target;
  if (!(btn instanceof HTMLButtonElement) || btn.id !== "history-walk-btn") return;
  const selected = getSelectedLocations();
  if (selected.length !== 1) return;
  const { startWalkingTo } = await import("/assets/js/walk.js");
  startWalkingTo(selected[0]); // overlay runs in its own module
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
      altitude: Number.isFinite(fused.altitude) ? fused.altitude : null,
      note,
      timestamp: fused.timestamp,
    };
    savedLocations = [entry, ...savedLocations];
    persistSavedLocations();
    renderLatestLocation();
    renderLocationHistory();
    if (locationNoteInput) locationNoteInput.value = "";
    locationStatusText && (locationStatusText.textContent = `Location saved${entry.accuracy ? ` (~+/-${entry.accuracy.toFixed(1)} m)` : ""}.`);

    // Update Sun card for current fix
    updateSunCardFor(entry.lat, entry.lng);
    // Update Moon card for current fix
    updateMoonCardFor(entry.lat, entry.lng);
  } catch (error) {
    const msg = error && typeof error === "object" && "message" in error ? error.message : String(error);
    locationStatusText && (locationStatusText.textContent = `Unable to capture location: ${msg}`);
  } finally {
    isCapturingLocation = false;
    document.getElementById("capture-location-btn")?.removeAttribute("disabled");
  }
};

// ----- KML import (refactored to its own module) -----
(function initKmlImport() {
  const input = document.getElementById("kmlFileInput");
  if (!input) return;

  import("/assets/js/kml-import.js").then(({ attachKmlImport }) => {
    attachKmlImport({
      input,
      getSaved: () => savedLocations.slice(),
      mergeAndSave: (entries) => {
        // dedupe vs existing
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
})();
