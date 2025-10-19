// /assets/js/search.js
// Handles the Search view that surfaces nearby places of interest for a saved location using a local GeoNames dataset.

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

let currentEntry = null;
let lastDatasetPromptTs = 0;
let sqlLibraryPromise = null;
let cachedDbContext = null;

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
};

const resetResults = (message) => {
  if (resultsList) resultsList.innerHTML = "";
  if (resultsSection) resultsSection.hidden = false;
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
      limit: 1,
      featureCodes: CITY_FEATURE_CODES,
    });
    applyDatasetMeta(data);
    const feature = data.features?.[0] || null;
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
  resultsList.innerHTML = "";
  if (!features.length) {
    resetResults("No places found within the selected radius.");
    return;
  }

  const fragment = document.createDocumentFragment();
  features.forEach((feature) => {
    const item = document.createElement("li");
    item.className = "search-result-item";
    item.innerHTML = `
      <div class="search-result-header">
        <strong>${feature.name}</strong>
        <span>${feature.distance_km.toFixed(2)} km</span>
      </div>
      <div class="search-result-meta">
        <span>Type: ${feature.feature_code || feature.feature_class || "Unknown"}</span>
        <span>Coordinates: ${formatDisplayNumber(feature.latitude)}, ${formatDisplayNumber(feature.longitude)}</span>
      </div>
      <div class="search-result-actions">
        <button class="btn btn-outline" type="button" data-role="view-map" data-lat="${feature.latitude}" data-lng="${feature.longitude}">View on Map</button>
      </div>
    `;
    fragment.appendChild(item);
  });

  resultsList.appendChild(fragment);
  setResultsStatus(`${features.length} place${features.length === 1 ? "" : "s"} found.`);
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

const handleResultsClick = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button[data-role='view-map']");
  if (!(button instanceof HTMLButtonElement)) return;
  const lat = Number.parseFloat(button.dataset.lat || "");
  const lng = Number.parseFloat(button.dataset.lng || "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  openInMaps(lat, lng);
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
resultsList?.addEventListener("click", handleResultsClick);
