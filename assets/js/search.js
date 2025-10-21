// /assets/js/search.js
// Handles the Search view that surfaces nearby places of interest for a saved location using a local GeoNames dataset.

import { addLocationsFromSearch } from "./location.js";
import { formatTimestamp } from "./utils.js";

const searchView = document.querySelector('.search-view[data-view="search"]');

const locationCard = document.getElementById("search-location-card");
const summaryContainer = document.getElementById("search-location-summary");
const locationStatusText = document.getElementById("search-location-status");
const datasetInfoText = document.getElementById("search-dataset-info");
const searchActionsSection = document.getElementById("search-actions");
const searchForm = document.getElementById("search-nearby-form");
const radiusInput = document.getElementById("search-radius");
const categorySelect = document.getElementById("search-category");
const limitInput = document.getElementById("search-limit");
const resultsSection = document.getElementById("search-results-section");
const resultsStatusText = document.getElementById("search-results-status");
const resultsList = document.getElementById("search-results-list");
const searchActionBar = document.getElementById("search-results-actions");
const searchViewBtn = document.getElementById("search-results-view-btn");
const searchSaveBtn = document.getElementById("search-results-save-btn");
const searchShareBtn = document.getElementById("search-results-share-btn");
const searchSketchBtn = document.getElementById("search-results-sketch-btn");

const GEONAMES_META_KEY = "dalitrail:geonames-meta";
const GEONAMES_INLINE_KEY = "dalitrail:geonames-inline";

const COUNTRY_NAMES = {
  US: "United States",
  CA: "Canada",
};

const STATE_NAMES = {
  WA: "Washington",
  OR: "Oregon",
  ID: "Idaho",
  CA: "California",
  MT: "Montana",
  BC: "British Columbia",
};

const CATEGORY_FEATURES = {
  all: null,
  trails: ["T.TRL", "T.TRT", "T.RDGE"],
  water: ["H.STM", "H.STMB", "H.LK", "H.PND", "H.SPR", "H.RPDS"],
  peaks: ["T.PK", "T.MT", "T.RDGE"],
  towns: ["P.PPL", "P.PPLA", "P.PPLA2", "P.PPLL"],
  parks: ["L.PRK", "L.RESF", "L.RESW"],
};

const CITY_FEATURE_CODES = ["P.PPL", "P.PPLA", "P.PPLA2", "P.PPLL"];
const CITY_CODE_PRIORITY = {
  "P.PPLC": 0,
  "P.PPLG": 0,
  "P.PPLA": 1,
  "P.PPLA2": 1,
  "P.PPLA3": 1,
  "P.PPLA4": 1,
  "P.PPL": 2,
  "P.PPLL": 3,
  "P.PPLX": 4,
};
const DEFAULT_CITY_PRIORITY = 5;
const MIN_PRIMARY_RADIUS_KM = 15;

let currentEntry = null;
let lastDatasetPromptTs = 0;
let sqlLibraryPromise = null;
let cachedDbContext = null;
const searchResultsById = new Map();
const selectedResultIds = new Set();

const logSearchEvent = (message) => {
  window.dispatchEvent(
    new CustomEvent("dalitrail:log", { detail: { message: `Search: ${message}` } })
  );
};

const readGeonamesMeta = () => {
  try {
    const raw = localStorage.getItem(GEONAMES_META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    return meta && typeof meta === "object" ? meta : null;
  } catch {
    return null;
  }
};

const datasetNeedsPermission = (meta) => {
  if (!meta) return true;
  if (meta.requiresPicker) return true;
  if (!meta.fileName && !meta.cachePath) return true;
  return false;
};

const promptForGeonames = (reason) => {
  const now = Date.now();
  if (now - lastDatasetPromptTs < 1500) return;
  lastDatasetPromptTs = now;
  logSearchEvent(`Prompting for GeoNames dataset (${reason}).`);
  window.dispatchEvent(
    new CustomEvent("dalitrail:prompt-geonames", { detail: { reason } })
  );
};

const formatDisplayNumber = (value, digits = 6) =>
  Number.isFinite(value) ? Number.parseFloat(value).toFixed(digits) : "--";

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
};

const resultIdForFeature = (feature) => {
  if (!feature) return "";
  if (feature.geoname_id !== undefined && feature.geoname_id !== null) {
    return String(feature.geoname_id);
  }
  const lat = Number(feature.latitude ?? feature.lat ?? 0);
  const lng = Number(feature.longitude ?? feature.lng ?? 0);
  return `${lat.toFixed(6)}:${lng.toFixed(6)}:${feature.name ?? ""}`;
};

const getSelectedSearchResults = () =>
  Array.from(selectedResultIds)
    .map((id) => searchResultsById.get(id))
    .filter(Boolean);

const updateSearchActionState = () => {
  const count = selectedResultIds.size;
  if (searchActionBar) {
    searchActionBar.hidden = searchResultsById.size === 0;
  }
  if (searchViewBtn) searchViewBtn.disabled = count === 0;
  if (searchSaveBtn) searchSaveBtn.disabled = count === 0;
  const hasEntry = !!currentEntry;
  if (searchShareBtn) searchShareBtn.disabled = count === 0;
  if (searchSketchBtn) searchSketchBtn.disabled = count === 0 || !hasEntry;
};

const clearSearchSelection = () => {
  selectedResultIds.clear();
  if (resultsList) {
    resultsList.querySelectorAll(".search-result-item").forEach((item) => item.classList.remove("selected"));
    resultsList.querySelectorAll(".search-result-checkbox").forEach((input) => {
      if (input instanceof HTMLInputElement) input.checked = false;
    });
  }
  updateSearchActionState();
};

const sanitizeSearchFeature = (feature) => {
  if (!feature) return null;
  const latitude = Number.parseFloat(feature.latitude ?? feature.lat ?? "");
  const longitude = Number.parseFloat(feature.longitude ?? feature.lng ?? "");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const distanceValue = Number.parseFloat(feature.distance_km ?? feature.distance ?? "");
  const elevationValue = Number.parseFloat(feature.elevation ?? feature.altitude ?? "");

  return {
    ...feature,
    latitude,
    longitude,
    distance_km: Number.isFinite(distanceValue) ? distanceValue : null,
    elevation: Number.isFinite(elevationValue) ? elevationValue : null,
  };
};

const openSelectedSearchResults = () => {
  const selected = getSelectedSearchResults();
  if (!selected.length) return;

  const coords = selected
    .map((feature) => {
      const lat = Number(feature.latitude ?? feature.lat);
      const lng = Number(feature.longitude ?? feature.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    })
    .filter(Boolean);

  if (!coords.length) return;

  logSearchEvent(`Opening ${coords.length} selected search result(s) in Maps.`);

  if (coords.length === 1) {
    openInMaps(coords[0].lat, coords[0].lng);
    return;
  }

  const fmt = (point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
  const origin = coords[0];
  const destination = coords[coords.length - 1];
  const waypoints = coords.slice(1, -1);

  let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${encodeURIComponent(fmt(origin))}&destination=${encodeURIComponent(fmt(destination))}`;
  if (waypoints.length) {
    url += `&waypoints=${encodeURIComponent(waypoints.map(fmt).join("|"))}`;
  }
  window.open(url, "_blank", "noopener");
};

const saveSelectedSearchResults = () => {
  const selected = getSelectedSearchResults();
  if (!selected.length) return;
  logSearchEvent(`Saving ${selected.length} selected search result(s) to saved locations.`);
  const outcome = addLocationsFromSearch(selected);
  const message =
    outcome.added > 0
      ? `Added ${outcome.added} result${outcome.added === 1 ? "" : "s"} to Saved Locations.`
      : "Selected results are already in Saved Locations.";
  setResultsStatus(message);
};

const shareSelectedSearchResults = async () => {
  const selected = getSelectedSearchResults();
  if (!selected.length) return;

  logSearchEvent(`Sharing ${selected.length} selected search result(s).`);

  const lines = selected.map((feature, index) => {
    const parts = [];
    const label = feature.name ? `${feature.name}` : "Unnamed place";
    parts.push(`#${index + 1} ${label}`);
    if (Number.isFinite(feature.distance_km)) {
      parts.push(`Distance: ${Number(feature.distance_km).toFixed(2)} km`);
    }
    const typeParts = [];
    if (feature.feature_class) typeParts.push(feature.feature_class);
    if (feature.feature_code) typeParts.push(feature.feature_code);
    if (typeParts.length) parts.push(`Feature: ${typeParts.join(".")}`);
    parts.push(`Lat: ${Number(feature.latitude).toFixed(6)}`);
    parts.push(`Lng: ${Number(feature.longitude).toFixed(6)}`);
    if (Number.isFinite(feature.elevation)) {
      parts.push(`Elevation: ${Number(feature.elevation).toFixed(0)} m`);
    }
    const locality = [];
    if (feature.admin1) locality.push(STATE_NAMES[feature.admin1] || feature.admin1);
    if (feature.country) locality.push(COUNTRY_NAMES[feature.country] || feature.country);
    if (locality.length) parts.push(`Region: ${locality.join(", ")}`);
    return parts.join("\n");
  });

  const sharePayload = {
    title: "Nearby places",
    text: `Nearby places from DaliTrail:\n\n${lines.join("\n\n")}\nSent via DaliTrail.`,
  };

  if (navigator.share) {
    try {
      await navigator.share(sharePayload);
      setResultsStatus("Shared selected places successfully.");
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setResultsStatus(`Share failed: ${error.message || error}`);
    }
  }

  const first = selected[0];
  const lat = Number(first.latitude ?? first.lat);
  const lng = Number(first.longitude ?? first.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    openInMaps(lat, lng);
    setResultsStatus("Sharing not supported on this device. Opened the first result on the map instead.");
  } else {
    setResultsStatus("Sharing not supported on this device.");
  }
};

const openSketchForSelectedResults = async () => {
  const selected = getSelectedSearchResults();
  if (!selected.length || !currentEntry) return;

  logSearchEvent(`Opening sketch map for ${selected.length} nearby place(s).`);

  const originPoint = {
    lat: currentEntry.lat,
    lng: currentEntry.lng,
    note: currentEntry.note ? currentEntry.note : `Saved ${formatTimestamp(currentEntry.timestamp)}`,
    timestamp: currentEntry.timestamp,
  };

  const ensureDistanceKm = (feature) => {
    if (Number.isFinite(feature.distance_km)) return Number(feature.distance_km);
    const meters = haversineKm(currentEntry.lat, currentEntry.lng, Number(feature.latitude), Number(feature.longitude)) * 1000;
    return meters / 1000;
  };

  const sorted = [...selected].sort((a, b) => ensureDistanceKm(a) - ensureDistanceKm(b));

  const points = [originPoint, ...sorted.map((feature) => ({
    lat: Number(feature.latitude),
    lng: Number(feature.longitude),
    note: feature.name || "Nearby place",
    timestamp: Date.now(),
  }))];

  const connections = sorted.map((_, idx) => ({ from: 0, to: idx + 1 }));
  const units = sorted.some((feature) => ensureDistanceKm(feature) >= 1) ? "km" : "m";

  try {
    const { openSketchMap } = await import("/assets/js/sketch-map.js");
    if (typeof openSketchMap !== "function") throw new Error("Sketch map unavailable.");
    openSketchMap({
      points,
      connections,
      originIndex: 0,
      distanceMode: "origin",
      units,
      labelDistance: true,
    });
  } catch (error) {
    console.error("Unable to open sketch map:", error);
    setResultsStatus("Unable to open sketch map for selected results.");
  }
};

const showLocalDatasetMeta = (meta) => {
  if (!meta) return;
  const parts = [];
  if (meta.fileName) parts.push(meta.fileName);
  if (meta.size) {
    const formatted = formatBytes(meta.size);
    if (formatted) parts.push(formatted);
  }
  if (meta.updatedAt) parts.push(new Date(meta.updatedAt).toLocaleString());
  const message = parts.length ? parts.join(" | ") : "GeoNames database connected.";
  setDatasetInfo(message, { hidden: false });
};

const setDatasetInfo = (message, options = { hidden: false }) => {
  if (!datasetInfoText) return;
  datasetInfoText.textContent = message;
  datasetInfoText.hidden = options.hidden ?? false;
  logSearchEvent(message);
};

const setLocationStatus = (message) => {
  if (!locationStatusText) return;
  locationStatusText.textContent = message;
  locationStatusText.hidden = !message;
};

const setResultsStatus = (message) => {
  if (!resultsStatusText) return;
  resultsStatusText.textContent = message;
  resultsStatusText.hidden = !message;
};

const setFormEnabled = (enabled) => {
  if (!searchForm) return;
  Array.from(searchForm.elements).forEach((element) => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLButtonElement
    ) {
      element.disabled = !enabled;
    }
  });
  if (searchActionsSection) searchActionsSection.hidden = !enabled;
  if (searchActionBar) searchActionBar.hidden = !enabled || searchResultsById.size === 0;
  if (!enabled) clearSearchSelection();
};

const resetResults = (message) => {
  if (resultsList) resultsList.innerHTML = "";
  if (resultsSection) resultsSection.hidden = false;
  searchResultsById.clear();
  clearSearchSelection();
  setResultsStatus(message);
};

const openInMaps = (lat, lng) => {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  window.open(url, "_blank", "noopener");
};

const renderSummary = (entry, context) => {
  if (!summaryContainer || !locationCard) return;
  if (!entry) {
    summaryContainer.innerHTML = "";
    locationCard.hidden = true;
    return;
  }

  const rows = [];
  if (context?.city) rows.push({ label: "City", value: context.city });
  if (context?.stateName || context?.stateCode) {
    rows.push({ label: "State", value: context.stateName || context.stateCode });
  }
  if (context?.countryName || context?.countryCode) {
    rows.push({ label: "Country", value: context.countryName || context.countryCode });
  }

  rows.push({ label: "Latitude", value: formatDisplayNumber(entry.lat) });
  rows.push({ label: "Longitude", value: formatDisplayNumber(entry.lng) });

  if (Number.isFinite(entry.accuracy)) {
    rows.push({ label: "Accuracy", value: `+/-${entry.accuracy.toFixed(1)} m` });
  }
  if (Number.isFinite(entry.altitude)) {
    rows.push({ label: "Elevation", value: `${entry.altitude.toFixed(1)} m` });
  }
  if (entry.note) rows.push({ label: "Note", value: entry.note });
  rows.push({ label: "Recorded", value: formatTimestamp(entry.timestamp) });

  summaryContainer.innerHTML = rows
    .map(
      ({ label, value }) => `
      <div class="search-summary-row">
        <span>${label}</span>
        <span>${value}</span>
      </div>`
    )
    .join("");

  locationCard.hidden = false;
};

const extractContext = (feature) => {
  if (!feature) return null;
  const stateCode = feature.admin1 || null;
  const countryCode = feature.country || null;
  return {
    city: feature.name || null,
    stateCode,
    stateName: stateCode ? STATE_NAMES[stateCode] || null : null,
    countryCode,
    countryName: countryCode ? COUNTRY_NAMES[countryCode] || null : null,
  };
};

const getCombinedFeatureCode = (feature) => {
  if (!feature) return "";
  const cls = feature.feature_class || "";
  const code = feature.feature_code || "";
  if (!cls && !code) return "";
  if (!cls) return code;
  if (!code) return cls;
  return `${cls}.${code}`;
};

const getCityPriority = (feature) => {
  const combined = getCombinedFeatureCode(feature);
  return CITY_CODE_PRIORITY[combined] ?? DEFAULT_CITY_PRIORITY;
};

const pickBestCityCandidate = (features, entry) => {
  if (!features || !features.length) return null;
  const withinPrimaryRadius = features.filter(
    (feature) => Number(feature.distance_km) <= MIN_PRIMARY_RADIUS_KM
  );
  const pool = withinPrimaryRadius.length ? withinPrimaryRadius : features;
  const ranked = pool
    .map((feature) => ({
      feature,
      priority: getCityPriority(feature),
      population: Number.isFinite(Number(feature.population))
        ? Number(feature.population)
        : 0,
      distance: Number.isFinite(Number(feature.distance_km))
        ? Number(feature.distance_km)
        : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.population !== b.population) return b.population - a.population;
      return a.distance - b.distance;
    });
  return ranked[0]?.feature || null;
};

const handleDatasetUnavailable = (message) => {
  setDatasetInfo(message, { hidden: false });
  setFormEnabled(false);
  logSearchEvent("Dataset unavailable; disabled search form.");
  promptForGeonames(message || "Select a GeoNames database to continue.");
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const radiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const computeBoundingBox = (lat, lng, radiusKm) => {
  const latRadius = radiusKm / 111;
  const cosLat = Math.max(Math.cos(toRadians(lat)), 1e-6);
  const lngRadius = radiusKm / (111 * cosLat);
  return {
    latMin: lat - latRadius,
    latMax: lat + latRadius,
    lngMin: lng - lngRadius,
    lngMax: lng + lngRadius,
  };
};

const loadSqlLibrary = () => {
  if (!sqlLibraryPromise) {
    sqlLibraryPromise = new Promise((resolve, reject) => {
      if (window.initSqlJs) {
        resolve(window.initSqlJs);
        return;
      }
      const script = document.createElement("script");
      script.src = "/assets/js/vendor/sql-wasm.js";
      script.async = true;
      script.onload = () => resolve(window.initSqlJs);
      script.onerror = () => reject(new Error("Failed to load sql.js"));
      document.head.appendChild(script);
    }).then((initSqlJs) =>
      initSqlJs({
        locateFile: (filename) => `/assets/js/vendor/${filename}`,
      })
    );
  }
  return sqlLibraryPromise;
};

const decodeBase64ToBytes = (base64) => {
  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const readInlineDataset = () => {
  try {
    const base64 = localStorage.getItem(GEONAMES_INLINE_KEY);
    if (!base64) return null;
    return decodeBase64ToBytes(base64);
  } catch (error) {
    console.warn("Unable to read inline GeoNames dataset:", error);
    return null;
  }
};

const readOpfsDataset = async () => {
  if (typeof navigator.storage?.getDirectory !== "function") return null;
  try {
    const root = await navigator.storage.getDirectory();
    const appDir = await root.getDirectoryHandle("dalitrail", { create: false });
    const fileHandle = await appDir.getFileHandle("geonames.db", { create: false });
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    console.warn("Unable to read GeoNames dataset from OPFS:", error);
    return null;
  }
};

const datasetSignature = (meta) =>
  [
    meta?.fileName || "dataset",
    meta?.size || 0,
    meta?.updatedAt || 0,
    meta?.inlineBytes || 0,
  ].join(":");

const loadDatasetBytes = async (meta) => {
  const opfsBytes = await readOpfsDataset();
  if (opfsBytes && opfsBytes.length) return opfsBytes;
  const inlineBytes = readInlineDataset();
  if (inlineBytes && inlineBytes.length) return inlineBytes;
  throw new Error("GeoNames dataset not available locally.");
};

const ensureDatabase = async (meta) => {
  const signature = datasetSignature(meta);
  if (cachedDbContext && cachedDbContext.signature === signature) {
    return cachedDbContext;
  }

  if (cachedDbContext?.db) {
    try {
      cachedDbContext.db.close();
    } catch (_) {
      // ignore
    }
  }
  cachedDbContext = null;

  const bytes = await loadDatasetBytes(meta);
  const SQL = await loadSqlLibrary();
  const db = new SQL.Database(bytes);
  const metadata = {};
  try {
    const stmt = db.prepare("SELECT key, value FROM metadata");
    while (stmt.step()) {
      const row = stmt.getAsObject();
      metadata[row.key] = row.value;
    }
    stmt.free();
  } catch (error) {
    console.warn("Unable to read metadata table:", error);
  }

  cachedDbContext = { db, signature, metadata };
  return cachedDbContext;
};

const fetchNearby = async ({ lat, lng, radiusKm, limit, featureCodes }) => {
  const meta = readGeonamesMeta();
  if (!meta) {
    throw new Error("GeoNames dataset not connected.");
  }

  const context = await ensureDatabase(meta);
  const { db, metadata } = context;
  const bounds = computeBoundingBox(lat, lng, radiusKm);
  const codes = featureCodes && featureCodes.length ? featureCodes : null;

  let sql =
    "SELECT geoname_id, name, latitude, longitude, feature_class, feature_code, country, admin1, admin2, population, elevation, timezone FROM features WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?";
  const params = [bounds.latMin, bounds.latMax, bounds.lngMin, bounds.lngMax];
  if (codes) {
    const placeholders = codes.map(() => "?").join(",");
    sql += ` AND (feature_class || '.' || feature_code) IN (${placeholders})`;
    params.push(...codes);
  }

  const statement = db.prepare(sql);
  statement.bind(params);

  const matches = [];
  while (statement.step()) {
    const row = statement.getAsObject();
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const distance = haversineKm(lat, lng, latitude, longitude);
    if (distance <= radiusKm) {
      matches.push({
        geoname_id: row.geoname_id,
        name: row.name,
        latitude,
        longitude,
        feature_class: row.feature_class,
        feature_code: row.feature_code,
        country: row.country,
        admin1: row.admin1,
        admin2: row.admin2,
        population: row.population,
        elevation: row.elevation,
        timezone: row.timezone,
        distance_km: distance,
      });
    }
  }
  statement.free();

  matches.sort((a, b) => a.distance_km - b.distance_km);
  const limited = matches.slice(0, limit);
  logSearchEvent(`Local query returned ${limited.length} result(s).`);

  return {
    dataset: meta.fileName || "GeoNames dataset",
    metadata,
    features: limited,
  };
};

const applyDatasetMeta = (data) => {
  if (!data || !datasetInfoText) return;
  const parts = [];
  if (data.dataset) parts.push(data.dataset);
  if (data.metadata?.lite_filter) parts.push(data.metadata.lite_filter);
  if (data.metadata?.lite_generated_at) {
    parts.push(
      `generated ${new Date(data.metadata.lite_generated_at).toLocaleString()}`
    );
  }
  const text = parts.length ? parts.join(" | ") : "GeoNames dataset connected.";
  setDatasetInfo(text, { hidden: false });
};

const lookupLocationContext = async (entry) => {
  if (!entry) return;
  logSearchEvent(
    `Loading context near ${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)}`
  );
  setLocationStatus("Looking up nearby place names...");
  try {
    const data = await fetchNearby({
      lat: entry.lat,
      lng: entry.lng,
      radiusKm: 25,
      limit: 12,
      featureCodes: CITY_FEATURE_CODES,
    });
    applyDatasetMeta(data);
    const feature = pickBestCityCandidate(data.features || [], entry);
    const context = extractContext(feature);
    if (context?.city) {
      const suffix = context.stateName ? `, ${context.stateName}` : "";
      setLocationStatus(`Nearest city: ${context.city}${suffix}.`);
      logSearchEvent(`Nearest populated place: ${context.city}${suffix}`);
    } else {
      setLocationStatus("No populated places within 25 km.");
      logSearchEvent("No populated place within 25 km.");
    }
    renderSummary(entry, context);
  } catch (error) {
    renderSummary(entry, null);
    setLocationStatus(error.message || "Lookup failed.");
    logSearchEvent(`Context lookup failed: ${error.message || error}`);
    if (/dataset/i.test(error.message) || /GeoNames/i.test(error.message)) {
      handleDatasetUnavailable(error.message);
    }
  }
};

const renderResults = (features = []) => {
  if (!resultsList) return;
  if (resultsSection) resultsSection.hidden = false;
  resultsList.innerHTML = "";
  searchResultsById.clear();
  clearSearchSelection();

  if (!Array.isArray(features) || !features.length) {
    setResultsStatus("No places found within the selected radius.");
    updateSearchActionState();
    return;
  }

  const seenIds = new Set();
  const fragment = document.createDocumentFragment();

  features.forEach((rawFeature) => {
    const feature = sanitizeSearchFeature(rawFeature);
    if (!feature) return;
    const id = resultIdForFeature(feature);
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    searchResultsById.set(id, feature);

    const item = document.createElement("li");
    item.className = "search-result-item";
    item.dataset.id = id;

    const row = document.createElement("div");
    row.className = "search-result";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "search-result-checkbox";
    checkbox.value = id;
    row.appendChild(checkbox);

    const content = document.createElement("div");
    content.className = "search-result-content";

    const header = document.createElement("div");
    header.className = "search-result-header";

    const nameElement = document.createElement("strong");
    nameElement.textContent = feature.name || "Unnamed place";
    header.appendChild(nameElement);

    const distanceElement = document.createElement("span");
    if (Number.isFinite(feature.distance_km)) {
      distanceElement.textContent = `${Number(feature.distance_km).toFixed(2)} km`;
    } else {
      distanceElement.textContent = "—";
    }
    header.appendChild(distanceElement);
    content.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "search-result-meta";

    const typeSpan = document.createElement("span");
    const typeParts = [];
    if (feature.feature_class) typeParts.push(feature.feature_class);
    if (feature.feature_code) typeParts.push(feature.feature_code);
    typeSpan.textContent = `Type: ${typeParts.length ? typeParts.join(".") : "Unknown"}`;
    meta.appendChild(typeSpan);

    const coordinateSpan = document.createElement("span");
    coordinateSpan.textContent = `Lat: ${formatDisplayNumber(feature.latitude)}, Lng: ${formatDisplayNumber(feature.longitude)}`;
    meta.appendChild(coordinateSpan);

    if (Number.isFinite(feature.elevation)) {
      const elevationSpan = document.createElement("span");
      elevationSpan.textContent = `Elevation: ${Number(feature.elevation).toFixed(0)} m`;
      meta.appendChild(elevationSpan);
    }

    const localityParts = [];
    if (feature.admin1) localityParts.push(STATE_NAMES[feature.admin1] || feature.admin1);
    if (feature.country) localityParts.push(COUNTRY_NAMES[feature.country] || feature.country);
    if (localityParts.length) {
      const localitySpan = document.createElement("span");
      localitySpan.textContent = localityParts.join(", ");
      meta.appendChild(localitySpan);
    }

    content.appendChild(meta);
    row.appendChild(content);
    item.appendChild(row);
    fragment.appendChild(item);
  });

  if (!fragment.childNodes.length) {
    setResultsStatus("No places found within the selected radius.");
    updateSearchActionState();
    return;
  }

  resultsList.appendChild(fragment);
  setResultsStatus(
    `${searchResultsById.size} place${searchResultsById.size === 1 ? "" : "s"} found. Select the ones you want to use.`
  );
  updateSearchActionState();
};

const handleSearchSubmit = async (event) => {
  event.preventDefault();
  if (!currentEntry) return;

  logSearchEvent("Search form submitted.");
  setResultsStatus("Searching nearby places...");
  if (resultsSection) resultsSection.hidden = false;

  const radiusKm = Number.parseFloat(radiusInput?.value) || 5;
  const limit = Math.min(100, Math.max(1, Number.parseInt(limitInput?.value, 10) || 20));
  const categoryKey = categorySelect?.value || "all";
  const featureCodes = CATEGORY_FEATURES[categoryKey] || null;
  logSearchEvent(
    `Parameters -> radius: ${radiusKm} km, limit: ${limit}, category: ${categoryKey}`
  );

  try {
    const data = await fetchNearby({
      lat: currentEntry.lat,
      lng: currentEntry.lng,
      radiusKm,
      limit,
      featureCodes,
    });
    applyDatasetMeta(data);
    renderResults(data.features || []);
  } catch (error) {
    resetResults(error.message || "Search failed.");
    logSearchEvent(`Search failed: ${error.message || error}`);
    if (/dataset/i.test(error.message) || /GeoNames/i.test(error.message)) {
      handleDatasetUnavailable("GeoNames dataset not available. Download or connect one from the About page.");
    }
  }
};

const handleResultsSelectionChange = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains("search-result-checkbox")) {
    return;
  }

  const id = target.value;
  if (!id) return;

  if (target.checked) selectedResultIds.add(id);
  else selectedResultIds.delete(id);

  const item = target.closest(".search-result-item");
  if (item) item.classList.toggle("selected", target.checked);

  updateSearchActionState();
};

const handleResultsClick = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const checkbox = target.closest(".search-result-checkbox");
  if (checkbox instanceof HTMLInputElement) return;

  const item = target.closest(".search-result-item");
  if (!item) return;

  const input = item.querySelector(".search-result-checkbox");
  if (!(input instanceof HTMLInputElement)) return;
  input.checked = !input.checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

window.addEventListener("dalitrail:search-load", (event) => {
  const entry = event.detail?.entry || null;
  currentEntry = entry;
  if (!entry) {
    renderSummary(null, null);
    setLocationStatus("Select a saved location to start searching.");
    setFormEnabled(false);
    resetResults("Select a location to search nearby places.");
    if (resultsSection) resultsSection.hidden = true;
    logSearchEvent("Search view opened without a selected location.");
    return;
  }

  renderSummary(entry, null);
  resetResults("Run a search to see suggested places around your location.");
  if (resultsSection) resultsSection.hidden = true;
  logSearchEvent(`Search view opened for location recorded ${formatTimestamp(entry.timestamp)}.`);

  lastDatasetPromptTs = 0;
  const meta = readGeonamesMeta();
  if (!meta) {
    setFormEnabled(false);
    setDatasetInfo("Select a GeoNames database to search nearby places.", { hidden: false });
    setLocationStatus("Connect a GeoNames database to continue.");
    promptForGeonames("Search requires a GeoNames database.");
    return;
  }

  showLocalDatasetMeta(meta);
  if (datasetNeedsPermission(meta)) {
    setFormEnabled(false);
    setLocationStatus("Grant access to your GeoNames database to continue.");
    promptForGeonames("Grant access to your GeoNames database.");
    return;
  }

  setFormEnabled(true);
  setLocationStatus("Looking up nearby place names...");
  void lookupLocationContext(entry);
});

window.addEventListener("dalitrail:geonames-updated", () => {
  lastDatasetPromptTs = 0;
  const meta = readGeonamesMeta();
  if (!meta) return;
  showLocalDatasetMeta(meta);
  setFormEnabled(true);
  if (currentEntry) {
    setLocationStatus("GeoNames database connected. Looking up nearby place names...");
    void lookupLocationContext(currentEntry);
  } else {
    setLocationStatus("GeoNames database connected. Select a location to search.");
  }
});

searchForm?.addEventListener("submit", handleSearchSubmit);
resultsList?.addEventListener("change", handleResultsSelectionChange);
resultsList?.addEventListener("click", handleResultsClick);
searchViewBtn?.addEventListener("click", openSelectedSearchResults);
searchSaveBtn?.addEventListener("click", saveSelectedSearchResults);
searchShareBtn?.addEventListener("click", () => { void shareSelectedSearchResults(); });
searchSketchBtn?.addEventListener("click", () => { void openSketchForSelectedResults(); });

/* -----------------------------------------------------------
 * NEW: Direct bridge for Sketch Map "Load Ref"
 * Listens for `dalitrail:search-nearby` and replies with results
 * without touching the Search UI or tracking state.
 * detail: { lat, lng, radiusMeters?, limit?, types?, resolve }
 * --------------------------------------------------------- */

function mapTypesToFeatureCodes(types) {
  if (!Array.isArray(types) || types.length === 0) return null;
  const set = new Set();
  for (const t of types) {
    const key = String(t || "").toLowerCase();
    // map common aliases to our CATEGORY_FEATURES buckets
    if (key === "trail" || key === "trails") (CATEGORY_FEATURES.trails || []).forEach(c => set.add(c));
    else if (key === "peak" || key === "peaks" || key === "mountain") (CATEGORY_FEATURES.peaks || []).forEach(c => set.add(c));
    else if (key === "water" || key === "lake" || key === "river") (CATEGORY_FEATURES.water || []).forEach(c => set.add(c));
    else if (key === "park" || key === "parks") (CATEGORY_FEATURES.parks || []).forEach(c => set.add(c));
    else if (key === "place" || key === "town" || key === "city" || key === "settlement") (CATEGORY_FEATURES.towns || []).forEach(c => set.add(c));
    else if (key === "all" || key === "*") return null; // request all -> null
  }
  return set.size ? Array.from(set) : null;
}

window.addEventListener("dalitrail:search-nearby", async (evt) => {
  const detail = evt?.detail || {};
  const resolve = typeof detail.resolve === "function" ? detail.resolve : null;
  if (!resolve) return;

  const lat = Number(detail.lat);
  const lng = Number(detail.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    resolve([]);
    return;
  }

  const radiusKm = Number.isFinite(detail.radiusMeters) ? detail.radiusMeters / 1000 : 5;
  const limit = Number.isFinite(detail.limit) ? Math.min(50, Math.max(1, detail.limit)) : 10;
  const featureCodes = mapTypesToFeatureCodes(detail.types) || null;

  try {
    const data = await fetchNearby({ lat, lng, radiusKm, limit, featureCodes });
    // Normalize shape for sketch-map: [{lat,lng,name}]
    const out = (data.features || []).slice(0, limit).map(f => ({
      lat: Number(f.latitude),
      lng: Number(f.longitude),
      name: f.name || "Place",
      // Optional passthroughs if you ever want them in the canvas:
      feature_class: f.feature_class,
      feature_code: f.feature_code,
      distance_km: f.distance_km,
      elevation: f.elevation,
    }));
    resolve(out);
  } catch (err) {
    console.warn("dalitrail:search-nearby failed:", err);
    resolve([]);
  }
});
