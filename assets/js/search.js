// /assets/js/search.js
// Handles the Search view that surfaces nearby places of interest for a saved location.

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

const logSearchEvent = (message) => {
  window.dispatchEvent(
    new CustomEvent("dalitrail:log", { detail: { message: `Search: ${message}` } })
  );
};

const formatDisplayNumber = (value, digits = 6) =>
  Number.isFinite(value) ? Number.parseFloat(value).toFixed(digits) : "—";

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
  Array.from(searchForm.elements).forEach((el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLButtonElement) {
      el.disabled = !enabled;
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

  rows.push(
    { label: "Latitude", value: formatDisplayNumber(entry.lat) },
    { label: "Longitude", value: formatDisplayNumber(entry.lng) },
  );

  if (Number.isFinite(entry.accuracy)) rows.push({ label: "Accuracy", value: `±${entry.accuracy.toFixed(1)} m` });
  if (Number.isFinite(entry.altitude)) rows.push({ label: "Elevation", value: `${entry.altitude.toFixed(1)} m` });
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
};

const fetchNearby = async ({ lat, lng, radiusKm, limit, featureCodes }) => {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(radiusKm),
    limit: String(limit),
  });
  if (featureCodes && featureCodes.length) params.set("feature_codes", featureCodes.join(","));

  const url = `/api/places/nearby?${params.toString()}`;
  logSearchEvent(`Requesting nearby places (${url})`);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    let detail = response.statusText || "Request failed";
    try {
      const data = await response.json();
      if (data?.detail) detail = data.detail;
    } catch {
      /* keep default detail */
    }
    logSearchEvent(`Request failed: ${detail}`);
    throw new Error(detail);
  }
  const json = await response.json();
  logSearchEvent(`Request succeeded with ${json?.features?.length ?? 0} result(s).`);
  return json;
};

const applyDatasetMeta = (data) => {
  if (!data || !datasetInfoText) return;
  const parts = [];
  if (data.dataset) parts.push(data.dataset);
  if (data.metadata?.lite_filter) parts.push(data.metadata.lite_filter);
  if (data.metadata?.lite_generated_at) parts.push(`generated ${new Date(data.metadata.lite_generated_at).toLocaleString()}`);
  const text = parts.length ? parts.join(" • ") : "GeoNames dataset connected.";
  setDatasetInfo(text, { hidden: false });
};

const lookupLocationContext = async (entry) => {
  if (!entry) return;
  logSearchEvent(`Loading context near ${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)}`);
  setLocationStatus("Looking up nearby place names…");
  try {
    const data = await fetchNearby({
      lat: entry.lat,
      lng: entry.lng,
      radiusKm: 25,
      limit: 1,
      featureCodes: CITY_FEATURE_CODES,
    });
    applyDatasetMeta(data);
    const feature = data?.features?.[0] || null;
    const context = extractContext(feature);
    if (context && context.city) {
      setLocationStatus(`Nearest city: ${context.city}${context.stateName ? `, ${context.stateName}` : ""}.`);
      logSearchEvent(`Nearest populated place: ${context.city}${context.stateName ? `, ${context.stateName}` : ""}`);
    } else {
      setLocationStatus("No populated places within 25 km.");
      logSearchEvent("No populated place within 25 km.");
    }
    renderSummary(entry, context);
  } catch (error) {
    renderSummary(entry, null);
    setLocationStatus(error.message);
    if (/dataset/i.test(error.message) || /GeoNames/i.test(error.message)) {
      handleDatasetUnavailable("GeoNames dataset not available. Download or connect one from the About page.");
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
  for (const feature of features) {
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
  }
  resultsList.appendChild(fragment);
  setResultsStatus(`${features.length} place${features.length === 1 ? "" : "s"} found.`);
};

const handleSearchSubmit = async (event) => {
  event.preventDefault();
  if (!currentEntry) return;
  logSearchEvent("Search form submitted.");
  setResultsStatus("Searching nearby places…");
  if (resultsSection) resultsSection.hidden = false;

  const radiusKm = Number.parseFloat(radiusInput?.value) || 5;
  const limit = Math.min(100, Math.max(1, Number.parseInt(limitInput?.value, 10) || 20));
  const categoryKey = categorySelect?.value || "all";
  const featureCodes = CATEGORY_FEATURES[categoryKey] || null;
  logSearchEvent(`Parameters -> radius: ${radiusKm} km, limit: ${limit}, category: ${categoryKey}`);

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
    logSearchEvent(`Search failed: ${error?.message || error}`);
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

  setFormEnabled(true);
  if (datasetInfoText) datasetInfoText.hidden = true;
  renderSummary(entry, null);
  setLocationStatus("Looking up nearby place names…");
  resetResults("Run a search to see suggested places around your location.");
  if (resultsSection) resultsSection.hidden = true;
  logSearchEvent(`Search view opened for location recorded ${formatTimestamp(entry.timestamp)}.`);
  void lookupLocationContext(entry);
});

searchForm?.addEventListener("submit", handleSearchSubmit);
resultsList?.addEventListener("click", handleResultsClick);
