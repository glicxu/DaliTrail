// /assets/js/main.js
// MAIN: app shell, navigation, install/update plumbing, and wiring.

import {
  loadSavedLocations,
  renderLatestLocation,
  renderLocationHistory,
  openSelectedLocations,
  shareSelectedLocations,
  deleteSelectedLocations,
} from "./location.js";

import { updateMetrics, restoreTrailState } from "./track.js";

import "/assets/js/notes.js";
import "/assets/js/events.js";
import "/assets/js/search.js";


// ---------- DOM ----------
const appRoot = document.querySelector(".app");
const backBtn = document.getElementById("back-btn");
const homeView = document.querySelector('.home-view[data-view="home"]');
const aboutView = document.querySelector('.about-view[data-view="about"]');
const locationView = document.querySelector('.location-view[data-view="location"]');
const locationHistoryView = document.querySelector('.location-history-view[data-view="location-history"]');
const notesView = document.querySelector('.notes-view[data-view="notes"]');
const eventsView = document.querySelector('.event-view[data-view="events"]');
const searchView = document.querySelector('.search-view[data-view="search"]');

const openLocationViewBtn = document.getElementById("open-location-view-btn");
const openEventViewBtn = document.getElementById("open-event-view-btn");
const openNotesViewBtn = document.getElementById("open-notes-view-btn");
const openAboutViewBtn = document.getElementById("open-about-view-btn");

const installSection = document.querySelector(".about-view .install");
const installBtn = document.getElementById("install-btn");
const installStatusText = document.getElementById("install-status");
const installHintText = document.getElementById("install-hint");
const updateSection = document.getElementById("update-section");
const updateBtn = document.getElementById("update-btn");
const statusText = document.getElementById("status-text");

const toggleLogBtn = document.getElementById("toggle-log-btn");
const logSection = document.querySelector(".log");
const openMapsBtn = document.getElementById("open-maps-btn");
const logList = document.getElementById("log");
const geonamesDownloadBtn = document.getElementById("geonames-download-btn");
const geonamesConnectBtn = document.getElementById("geonames-connect-btn");
const geonamesManageBtn = document.getElementById("geonames-manage-btn");
const geonamesStatusText = document.getElementById("geonames-status");
const geonamesFileInput = document.getElementById("geonames-file-input");
const geonamesDetails = document.getElementById("geonames-section");
const geonamesDownloadPanel = document.getElementById("geonames-download-panel");
const geonamesDownloadSelect = document.getElementById("geonames-download-select");
const geonamesDownloadStatus = document.getElementById("geonames-download-status");
const geonamesDownloadConfirm = document.getElementById("geonames-download-confirm");
const backupDownloadBtn = document.getElementById("backup-download-btn");
const backupRestoreBtn = document.getElementById("backup-restore-btn");
const backupFileInput = document.getElementById("backup-file-input");
const backupStatusText = document.getElementById("backup-status");

const logAppEvent = (message) => {
  if (!logList) return;
  const li = document.createElement("li");
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  li.textContent = `[${timestamp}] ${message}`;
  logList.appendChild(li);
  logSection?.removeAttribute("hidden");
  if (logSection instanceof HTMLDetailsElement) logSection.open = true;
  toggleLogBtn?.classList.add("notify");
};

if (typeof window !== "undefined") {
  window.addEventListener("dalitrail:log", (event) => {
    const message = event?.detail?.message;
    if (typeof message === "string" && message.trim()) {
      logAppEvent(message);
    }
  });
}

const installationWatchers = {
  promptTimer: null,
  promptReceived: false,
};

// NEW Location buttons
const btnRecord = document.getElementById("btn-record-position");
const btnEnter = document.getElementById("btn-enter-coords");
const btnImport = document.getElementById("btn-import-kml");
const kmlInput = document.getElementById("kmlFileInput");

// History actions
const openLocationHistoryBtn = document.getElementById("open-location-history-btn");
const historyViewBtn = document.getElementById("history-view-btn");
const historyShareBtn = document.getElementById("history-share-btn");
const historyDeleteBtn = document.getElementById("history-delete-btn");


const LAST_VIEW_KEY = "dalitrail:last-view";
const isIosDevice = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "");
const isAndroidDevice = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "");
const isWindowsDevice = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent || "");
const isSecure = window.isSecureContext || window.location.hostname === "localhost";

let deferredInstallPrompt = null;
let installClickRequested = false;
let installPromptWaitTimeoutId = null;
let swRegistration = null;

if (installSection) {
  installSection.hidden = false;
  if (installBtn) installBtn.disabled = true;
  if (installStatusText) {
    installStatusText.textContent = isSecure
      ? "Checking install support..."
      : "Install requires HTTPS or localhost.";
  }
  logAppEvent("Install section initialized.");
  logAppEvent(isSecure ? "Secure origin confirmed." : "Insecure origin detected. Install prompt will be blocked.");
  if (isIosDevice) logAppEvent("Running on iOS; use Safari's Add to Home Screen instead of install prompt.");
  else if (isSecure) {
    installationWatchers.promptTimer = window.setTimeout(() => {
      if (!installationWatchers.promptReceived) {
        logAppEvent("Still waiting for install prompt event (no beforeinstallprompt yet).");
      }
    }, 8000);
    logAppEvent("Waiting for service worker registration and install prompt readiness...");
  }
}

// ---------- Views ----------
const VIEWS = { home: homeView, about: aboutView, location: locationView, "location-history": locationHistoryView, events: eventsView, notes: notesView, search: searchView };

const showView = (view) => {
  if (!(view in VIEWS)) throw new Error(`Unknown view: ${view}`);
  appRoot.dataset.view = view;
  try {
    if (view === "about") localStorage.removeItem(LAST_VIEW_KEY);
    else localStorage.setItem(LAST_VIEW_KEY, view);
  } catch {}

  Object.entries(VIEWS).forEach(([name, section]) => section && (section.hidden = name !== view));
  if (backBtn) {
    backBtn.hidden = view === "home";
    backBtn.disabled = view === "home";
    backBtn.tabIndex = view === "home" ? -1 : 0;
  }
};

const loadInitialView = () => {
  try {
    const stored = localStorage.getItem(LAST_VIEW_KEY);
    if (stored && stored in VIEWS && stored !== "about") return stored;
  } catch {}
  return appRoot?.dataset.view || "home";
};

// ---------- Log ----------
const showLog = () => {
  if (!logSection || !toggleLogBtn) return;
  logSection.hidden = false;
  if (logSection instanceof HTMLDetailsElement) logSection.open = true;
  toggleLogBtn.textContent = "Hide Log";
  toggleLogBtn.setAttribute("aria-expanded", "true");
};
const hideLog = () => {
  if (!logSection || !toggleLogBtn) return;
  logSection.hidden = true;
  if (logSection instanceof HTMLDetailsElement) logSection.open = false;
  toggleLogBtn.textContent = "Show Log";
  toggleLogBtn.setAttribute("aria-expanded", "false");
  toggleLogBtn.classList.remove("notify");
};
const toggleLogVisibility = () => (logSection.hidden ? (toggleLogBtn.classList.remove("notify"), showLog()) : hideLog());

// ---------- GeoNames helpers ----------
const GEONAMES_META_KEY = "dalitrail:geonames-meta";
const GEONAMES_INLINE_KEY = "dalitrail:geonames-inline";
const FALLBACK_GEONAMES_DATASETS = [
  {
    id: "us-wa",
    label: "United States - Washington State",
    description: "Cities, trails, and outdoor features for Washington.",
    url: "/datasets/geonames-lite-us-wa.db",
    approx_size: "0.9 MB",
    file_name: "geonames-lite-us-wa.db",
    source: "download",
  },
  {
    id: "sample",
    label: "Sample Dataset (Tiny)",
    description: "Mini dataset for testing search locally.",
    url: "/assets/data/geonames-sample.db",
    approx_size: "36 KB",
    file_name: "geonames-sample.db",
    source: "bundle",
  },
];
const GEONAMES_DATASET_CACHE_KEY = "dalitrail:geonames-datasets";
const BACKUP_VERSION = 1;
const LOCATIONS_KEY = "dalitrail:locations";
const NOTES_KEY = "dalitrail:notes";
const EVENTS_KEY = "dalitrail:events";
const TRAIL_SESSION_KEY = "dalitrail:session";
const TRACKS_KEY = "dalitrail:tracks";
let geonamesDatasets = [];
let geonamesDatasetOptionsLoaded = false;
let geonamesDatasetsFetched = false;

const loadGeonamesMeta = () => {
  try {
    const raw = localStorage.getItem(GEONAMES_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const saveGeonamesMeta = (meta) => {
  try {
    localStorage.setItem(GEONAMES_META_KEY, JSON.stringify(meta));
  } catch (error) {
    console.warn("Unable to persist GeoNames metadata:", error);
  }
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return "unknown size";
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

const bytesToBase64 = (bytes) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const storeGeonamesInline = (buffer) => {
  try {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const base64 = bytesToBase64(bytes);
    localStorage.setItem(GEONAMES_INLINE_KEY, base64);
    return bytes.byteLength;
  } catch (error) {
    console.warn("Unable to store inline GeoNames copy:", error);
    clearGeonamesInline();
    return 0;
  }
};

const clearGeonamesInline = () => {
  try {
    localStorage.removeItem(GEONAMES_INLINE_KEY);
  } catch (_) {
    /* ignore */
  }
};

const loadCachedGeonamesDatasets = () => {
  try {
    const raw = localStorage.getItem(GEONAMES_DATASET_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const cacheGeonamesDatasets = (datasets) => {
  try {
    localStorage.setItem(GEONAMES_DATASET_CACHE_KEY, JSON.stringify(datasets));
  } catch {}
};

const openHiddenFileInput = (input) => {
  if (!input) return false;
  input.value = "";

  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return true;
    } catch (error) {
      console.warn("File picker showPicker() failed, falling back to click():", error);
    }
  }

  const wasHiddenAttr = input.hasAttribute("hidden");
  if (wasHiddenAttr) input.removeAttribute("hidden");

  const previousStyles = {
    display: input.style.display,
    position: input.style.position,
    visibility: input.style.visibility,
    top: input.style.top,
    left: input.style.left,
  };

  let appliedTemporaryStyle = false;
  try {
    const computed = window.getComputedStyle ? window.getComputedStyle(input) : null;
    if (!computed || computed.display === "none" || computed.visibility === "hidden") {
      input.style.position = "fixed";
      input.style.top = "-10000px";
      input.style.left = "-10000px";
      input.style.display = "block";
      input.style.visibility = "hidden";
      appliedTemporaryStyle = true;
    }
    input.click();
    return true;
  } catch (error) {
    console.error("File input click failed:", error);
    return false;
  } finally {
    window.setTimeout(() => {
      if (appliedTemporaryStyle) {
        input.style.display = previousStyles.display;
        input.style.position = previousStyles.position;
        input.style.visibility = previousStyles.visibility;
        input.style.top = previousStyles.top;
        input.style.left = previousStyles.left;
      }
      if (wasHiddenAttr) input.setAttribute("hidden", "");
    }, 0);
  }
};

const setBackupStatus = (message) => {
  if (backupStatusText) backupStatusText.textContent = message;
};

const readArrayFromStore = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readObjectFromStore = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const createBackupSnapshot = () => {
  const createdAt = new Date().toISOString();
  const geonamesInline = (() => {
    try {
      return localStorage.getItem(GEONAMES_INLINE_KEY) || null;
    } catch {
      return null;
    }
  })();

  return {
    version: BACKUP_VERSION,
    createdAt,
    data: {
      locations: readArrayFromStore(LOCATIONS_KEY),
      notes: readArrayFromStore(NOTES_KEY),
      events: readArrayFromStore(EVENTS_KEY),
      tracks: readArrayFromStore(TRACKS_KEY),
      trailSession: readObjectFromStore(TRAIL_SESSION_KEY),
      geonames: {
        meta: readObjectFromStore(GEONAMES_META_KEY),
        inline: geonamesInline,
        datasets: readArrayFromStore(GEONAMES_DATASET_CACHE_KEY),
      },
    },
  };
};

const persistJsonOrRemove = (key, value) => {
  if (value == null) {
    localStorage.removeItem(key);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw new Error(`Unable to save ${key}: ${error?.message || error}`);
  }
};

const mergeArraysById = (current = [], incoming = []) => {
  const map = new Map();
  current.forEach((item) => {
    if (item && typeof item.id === "string") map.set(item.id, item);
  });
  incoming.forEach((item) => {
    if (item && typeof item.id === "string") map.set(item.id, item);
  });
  return Array.from(map.values());
};

const mergeDatasetsById = (current = [], incoming = []) => {
  const map = new Map();
  const keyFor = (item) => {
    if (!item || typeof item !== "object") return null;
    if (typeof item.id === "string" && item.id) return `id:${item.id}`;
    if (typeof item.url === "string" && item.url) return `url:${item.url}`;
    return null;
  };
  current.forEach((item) => {
    const key = keyFor(item);
    if (key) map.set(key, item);
  });
  incoming.forEach((item) => {
    const key = keyFor(item);
    if (key) map.set(key, item);
  });
  return Array.from(map.values());
};

const restoreFromBackupSnapshot = (snapshot, mode = "replace") => {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Backup file is not valid JSON.");
  }

  const version = Number.isFinite(snapshot.version) ? snapshot.version : Number(snapshot.version);
  if (Number.isFinite(version) && version > BACKUP_VERSION) {
    throw new Error(`Backup version ${snapshot.version} is newer than supported ${BACKUP_VERSION}.`);
  }

  const { data } = snapshot;
  if (!data || typeof data !== "object") {
    throw new Error("Backup payload missing data section.");
  }

  const incomingLocations = Array.isArray(data.locations) ? data.locations : [];
  const incomingNotes = Array.isArray(data.notes) ? data.notes : [];
  const incomingEvents = Array.isArray(data.events) ? data.events : [];
  const incomingTracks = Array.isArray(data.tracks) ? data.tracks : [];

  const existingLocations = mode === "merge" ? readArrayFromStore(LOCATIONS_KEY) : [];
  const existingNotes = mode === "merge" ? readArrayFromStore(NOTES_KEY) : [];
  const existingEvents = mode === "merge" ? readArrayFromStore(EVENTS_KEY) : [];
  const existingTracks = mode === "merge" ? readArrayFromStore(TRACKS_KEY) : [];

  const mergedLocations = mode === "merge" ? mergeArraysById(existingLocations, incomingLocations) : incomingLocations;
  const mergedNotes = mode === "merge" ? mergeArraysById(existingNotes, incomingNotes) : incomingNotes;
  const mergedEvents = mode === "merge" ? mergeArraysById(existingEvents, incomingEvents) : incomingEvents;
  const mergedTracks = mode === "merge" ? mergeArraysById(existingTracks, incomingTracks) : incomingTracks;

  persistJsonOrRemove(LOCATIONS_KEY, mergedLocations);
  persistJsonOrRemove(NOTES_KEY, mergedNotes);
  persistJsonOrRemove(EVENTS_KEY, mergedEvents);
  persistJsonOrRemove(TRACKS_KEY, mergedTracks);

  const existingTrailSession = mode === "merge" ? readObjectFromStore(TRAIL_SESSION_KEY) : null;
  const incomingTrailSession = data.trailSession && typeof data.trailSession === "object" ? data.trailSession : null;
  const trailSessionToStore = mode === "merge" ? (incomingTrailSession || existingTrailSession) : incomingTrailSession;

  if (trailSessionToStore) {
    persistJsonOrRemove(TRAIL_SESSION_KEY, trailSessionToStore);
  } else if (mode === "replace") {
    localStorage.removeItem(TRAIL_SESSION_KEY);
  }

  const geonames = data.geonames && typeof data.geonames === "object" ? data.geonames : {};
  const existingMeta = mode === "merge" ? readObjectFromStore(GEONAMES_META_KEY) : null;
  const metaToStore = mode === "merge" && geonames.meta == null ? existingMeta : geonames.meta;
  if (metaToStore && typeof metaToStore === "object") {
    persistJsonOrRemove(GEONAMES_META_KEY, metaToStore);
  } else if (mode === "replace") {
    localStorage.removeItem(GEONAMES_META_KEY);
  }

  const existingInline = mode === "merge"
    ? (() => {
        try {
          return localStorage.getItem(GEONAMES_INLINE_KEY) || "";
        } catch {
          return "";
        }
      })()
    : "";
  const inline = typeof geonames.inline === "string" ? geonames.inline.trim() : "";
  const inlineToStore = mode === "merge" ? (inline || existingInline) : inline;
  if (inlineToStore) {
    try {
      localStorage.setItem(GEONAMES_INLINE_KEY, inlineToStore);
    } catch (error) {
      throw new Error(`Unable to store GeoNames inline copy: ${error?.message || error}`);
    }
  } else if (mode === "replace") {
    localStorage.removeItem(GEONAMES_INLINE_KEY);
  }

  const incomingDatasets = Array.isArray(geonames.datasets) ? geonames.datasets : [];
  const existingDatasets = mode === "merge" ? readArrayFromStore(GEONAMES_DATASET_CACHE_KEY) : [];
  const datasetsToStore = mode === "merge" ? mergeDatasetsById(existingDatasets, incomingDatasets) : incomingDatasets;

  if (datasetsToStore.length) {
    persistJsonOrRemove(GEONAMES_DATASET_CACHE_KEY, datasetsToStore);
  } else if (mode === "replace") {
    localStorage.removeItem(GEONAMES_DATASET_CACHE_KEY);
  }

  return {
    locations: mergedLocations.length,
    notes: mergedNotes.length,
    events: mergedEvents.length,
    tracks: mergedTracks.length,
    mode,
  };
};

const triggerBackupDownload = () => {
  if (!backupDownloadBtn) return;
  backupDownloadBtn.disabled = true;
  setBackupStatus("Preparing backup file...");
  logAppEvent("Backup export requested.");
  try {
    const snapshot = createBackupSnapshot();
    const payload = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dalitrail-backup-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupStatus("Backup downloaded. Store it somewhere safe.");
    logAppEvent("Backup exported.");
  } catch (error) {
    console.error("Backup export failed:", error);
    setBackupStatus(`Unable to create backup: ${error?.message || error}`);
    logAppEvent(`Backup export failed: ${error?.message || error}`);
  } finally {
    backupDownloadBtn.disabled = false;
  }
};

const handleBackupFileSelection = async () => {
  if (!backupFileInput) return;
  const file = backupFileInput.files?.[0];
  backupFileInput.value = "";
  if (!file) return;

  backupRestoreBtn && (backupRestoreBtn.disabled = true);
  const sizeLabel = Number.isFinite(file.size) ? formatBytes(file.size) : "unknown size";
  setBackupStatus(`Reading ${file.name} (${sizeLabel})...`);
  logAppEvent(`Backup restore started from ${file.name} (${sizeLabel}).`);

  try {
    const text = await file.text();
    const snapshot = JSON.parse(text);
    const proceed = window.confirm("Restore data from this backup file?");
    if (!proceed) {
      setBackupStatus("Restore cancelled.");
      logAppEvent("Backup restore cancelled by user.");
      backupRestoreBtn && (backupRestoreBtn.disabled = false);
      return;
    }
    const mergePreferred = window.confirm(
      "Merge backup with existing data?\n\nChoose OK to merge (keep current items and add from the backup).\nChoose Cancel to replace everything with the backup file."
    );
    const mode = mergePreferred ? "merge" : "replace";
    const summary = restoreFromBackupSnapshot(snapshot, mode);
    const verb = mode === "merge" ? "merged" : "restored";
    setBackupStatus(`Backup ${verb}. Reloading to apply changes...`);
    logAppEvent(
      `Backup ${verb} (${summary.locations} locations, ${summary.notes} notes, ${summary.events} events, ${summary.tracks} tracks).`
    );
    window.setTimeout(() => window.location.reload(), 900);
  } catch (error) {
    console.error("Backup restore failed:", error);
    setBackupStatus(`Unable to restore backup: ${error?.message || error}`);
    logAppEvent(`Backup restore failed: ${error?.message || error}`);
    backupRestoreBtn && (backupRestoreBtn.disabled = false);
  }
};

const setGeonamesStatus = (message) => {
  if (!geonamesStatusText) return;
  geonamesStatusText.textContent = message;
};

const describeGeonamesMeta = (meta) => {
  if (!meta) return "No GeoNames database connected yet.";
  const parts = [];
  if (meta.label) parts.push(meta.label);
  else if (meta.fileName) parts.push(meta.fileName);
  else parts.push("GeoNames dataset");
  if (meta.size) parts.push(formatBytes(meta.size));
  if (meta.downloadedAt) {
    const downloaded = new Date(meta.downloadedAt);
    if (!Number.isNaN(downloaded.getTime())) parts.push(`downloaded ${downloaded.toLocaleString()}`);
  }
  return parts.join(" • ") || "GeoNames database connected.";
};

const refreshGeonamesStatus = () => {
  const meta = loadGeonamesMeta();
  setGeonamesStatus(describeGeonamesMeta(meta));
};

const handleGeonamesFileSelection = async (file) => {
  if (!file) return;
  try {
    const declaredSize = Number.isFinite(file.size) ? file.size : null;
    const sizeLabel = declaredSize != null ? formatBytes(declaredSize) : "unknown size";
    setGeonamesStatus(`Loading ${file.name}...`);
    logAppEvent(`GeoNames file selected: ${file.name} (${sizeLabel})`);

    const buffer = await file.arrayBuffer();
    if (!buffer.byteLength) {
      setGeonamesStatus("Selected file is empty.");
      return;
    }

    const bytes = new Uint8Array(buffer);
    const storedBytes = storeGeonamesInline(bytes);
    if (!storedBytes) {
      setGeonamesStatus("Unable to cache the selected dataset locally.");
      return;
    }

    const meta = {
      id: `user-file:${file.name}`,
      label: file.name,
      fileName: file.name,
      size: bytes.byteLength,
      source: "user-file",
      inlineBytes: storedBytes,
      updatedAt: Date.now(),
      importedAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
      requiresPicker: false,
    };

    saveGeonamesMeta(meta);
    setGeonamesStatus(describeGeonamesMeta(meta));
    logAppEvent(`GeoNames dataset connected from file: ${file.name}`);
    window.dispatchEvent(new CustomEvent("dalitrail:geonames-updated"));
  } catch (error) {
    console.error("Unable to load GeoNames file:", error);
    setGeonamesStatus(`Unable to load GeoNames file: ${error?.message || error}`);
    clearGeonamesInline();
  }
};

const ensureGeonamesDatasetList = async () => {
  if (geonamesDatasetsFetched) return geonamesDatasets;
  try {
    const response = await fetch("/api/geonames/datasets", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const payload = await response.json();
    const list = Array.isArray(payload?.datasets)
      ? payload.datasets
      : Array.isArray(payload)
      ? payload
      : [];
    if (!list.length) throw new Error("Dataset list is empty.");
    geonamesDatasets = list;
    geonamesDatasetsFetched = true;
    geonamesDatasetOptionsLoaded = false;
    cacheGeonamesDatasets(list);
    return geonamesDatasets;
  } catch (error) {
    const cached = loadCachedGeonamesDatasets();
    if (cached.length) {
      geonamesDatasets = cached;
      geonamesDatasetsFetched = true;
      geonamesDatasetOptionsLoaded = false;
      return geonamesDatasets;
    }
    if (FALLBACK_GEONAMES_DATASETS.length) {
      console.warn("Falling back to bundled GeoNames dataset list:", error);
      geonamesDatasets = [...FALLBACK_GEONAMES_DATASETS];
      geonamesDatasetsFetched = true;
      geonamesDatasetOptionsLoaded = false;
      return geonamesDatasets;
    }
    throw error;
  }
};

const populateGeonamesDatasetOptions = () => {
  if (!geonamesDownloadSelect) return;
  const previousValue = geonamesDownloadSelect.value;
  geonamesDownloadSelect.innerHTML = "";

  if (!geonamesDatasets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No datasets available";
    option.disabled = true;
    option.selected = true;
    geonamesDownloadSelect.appendChild(option);
    geonamesDatasetOptionsLoaded = true;
    return;
  }

  geonamesDatasets.forEach((dataset, index) => {
    const option = document.createElement("option");
    option.value = dataset.id;
    const approx = dataset.approx_size || dataset.approxSize || "";
    option.textContent = approx ? `${dataset.label} (${approx})` : dataset.label;
    option.dataset.description = dataset.description || "";
    if ((previousValue && dataset.id === previousValue) || (!previousValue && index === 0)) {
      option.selected = true;
    }
    geonamesDownloadSelect.appendChild(option);
  });

  geonamesDatasetOptionsLoaded = true;
};

const getSelectedGeonamesDataset = () => {
  if (!geonamesDownloadSelect) return null;
  return geonamesDatasets.find((entry) => entry.id === geonamesDownloadSelect.value) || null;
};

const setGeonamesDownloadStatus = (message) => {
  if (!geonamesDownloadStatus) return;
  if (!message) {
    geonamesDownloadStatus.hidden = true;
    geonamesDownloadStatus.textContent = "";
    return;
  }
  geonamesDownloadStatus.hidden = false;
  geonamesDownloadStatus.textContent = message;
};

const openGeonamesDownloadPanel = (message) => {
  if (!geonamesDownloadPanel) return;
  showView("about");
  if (geonamesDetails instanceof HTMLDetailsElement) geonamesDetails.open = true;
  geonamesDownloadPanel.hidden = false;
  if (message) setGeonamesDownloadStatus(message);
  else setGeonamesDownloadStatus("Select a dataset to begin.");

  ensureGeonamesDatasetList()
    .then(() => {
      populateGeonamesDatasetOptions();
      const dataset = getSelectedGeonamesDataset();
      if (dataset?.description) setGeonamesDownloadStatus(dataset.description);
    })
    .catch((error) => {
      console.error("Unable to load GeoNames dataset list:", error);
      setGeonamesDownloadStatus(`Unable to load dataset list: ${error?.message || error}`);
    });
};

window.addEventListener("dalitrail:request-search", (event) => {
  const entry = event.detail?.entry;
  showView("search");
  window.dispatchEvent(new CustomEvent("dalitrail:search-load", { detail: { entry } }));
});

window.addEventListener("dalitrail:prompt-geonames", (event) => {
  const reason = event?.detail?.reason || "GeoNames database required.";
  logAppEvent(`GeoNames prompt: ${reason}`);
  openGeonamesDownloadPanel(reason);
  window.alert(
    `${reason}\n\nUse the GeoNames download panel to pick a dataset, then try your search again.`
  );
});

window.addEventListener("dalitrail:geonames-updated", () => {
  if (geonamesDownloadPanel) geonamesDownloadPanel.hidden = true;
  setGeonamesDownloadStatus("");
  refreshGeonamesStatus();
});

geonamesDownloadBtn?.addEventListener("click", () => {
  openGeonamesDownloadPanel();
  logAppEvent("Opened GeoNames download panel.");
});

geonamesDownloadSelect?.addEventListener("change", () => {
  const dataset = getSelectedGeonamesDataset();
  if (dataset?.description) setGeonamesDownloadStatus(dataset.description);
  else setGeonamesDownloadStatus("Select a dataset to begin.");
});

geonamesDownloadConfirm?.addEventListener("click", async () => {
  if (!geonamesDownloadConfirm) return;
  const dataset = getSelectedGeonamesDataset();
  if (!dataset) {
    setGeonamesDownloadStatus("Select a dataset to download.");
    return;
  }

  try {
    geonamesDownloadConfirm.disabled = true;
    geonamesDownloadConfirm.textContent = "Downloading...";
    setGeonamesDownloadStatus("Downloading dataset...");
    logAppEvent(`Downloading GeoNames dataset: ${dataset.label || dataset.id}`);

    const response = await fetch(dataset.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) throw new Error("Downloaded dataset is empty.");

    const storedBytes = storeGeonamesInline(bytes);
    if (!storedBytes) throw new Error("Unable to cache dataset locally.");

    const meta = {
      id: dataset.id,
      label: dataset.label,
      url: dataset.url,
      fileName: dataset.file_name || dataset.fileName || `${dataset.id || "geonames"}.db`,
      size: bytes.byteLength,
      inlineBytes: storedBytes,
      source: dataset.source || "download",
      approxSize: dataset.approx_size || dataset.approxSize,
      downloadedAt: new Date().toISOString(),
      updatedAt: Date.now(),
    };

    saveGeonamesMeta(meta);
    cacheGeonamesDatasets(geonamesDatasets);

    setGeonamesDownloadStatus(`Download complete. Connected ${meta.fileName}.`);
    logAppEvent(`GeoNames dataset connected: ${meta.fileName} (${formatBytes(meta.size)})`);
    window.dispatchEvent(new CustomEvent("dalitrail:geonames-updated"));
  } catch (error) {
    const message = error?.message || String(error);
    console.error("GeoNames download failed:", error);
    setGeonamesDownloadStatus(`Download failed: ${message}`);
    logAppEvent(`GeoNames download failed: ${message}`);
  } finally {
    geonamesDownloadConfirm.disabled = false;
    geonamesDownloadConfirm.textContent = "Download & Connect";
  }
});

geonamesConnectBtn?.addEventListener("click", () => {
  if (!geonamesFileInput) return;
  const opened = openHiddenFileInput(geonamesFileInput);
  if (!opened) {
    logAppEvent("Unable to open GeoNames file picker.");
    setGeonamesStatus("File picker blocked. Adjust browser settings and try again.");
    return;
  }
  logAppEvent("Prompted for GeoNames file picker.");
});

geonamesFileInput?.addEventListener("change", () => {
  const file = geonamesFileInput.files?.[0] || null;
  if (!file) return;
  void handleGeonamesFileSelection(file);
  geonamesFileInput.value = "";
});

backupDownloadBtn?.addEventListener("click", () => {
  triggerBackupDownload();
});

backupRestoreBtn?.addEventListener("click", () => {
  setBackupStatus("Select a backup JSON file to restore.");
  if (!backupFileInput) return;
  const opened = openHiddenFileInput(backupFileInput);
  if (!opened) {
    setBackupStatus("Unable to open file picker. Check browser permissions.");
    logAppEvent("Backup restore picker blocked by browser.");
  }
});

backupFileInput?.addEventListener("change", () => {
  void handleBackupFileSelection();
});

openLocationViewBtn?.addEventListener("click", () => {
  showView("location");
  logAppEvent("Opened Location view.");
});

openEventViewBtn?.addEventListener("click", () => {
  showView("events");
  logAppEvent("Opened Events view.");
});

openNotesViewBtn?.addEventListener("click", () => {
  showView("notes");
  logAppEvent("Opened Notes view.");
});

openAboutViewBtn?.addEventListener("click", () => {
  showView("about");
  logAppEvent("Opened About view.");
});

openLocationHistoryBtn?.addEventListener("click", () => {
  if (openLocationHistoryBtn.disabled) return;
  showView("location-history");
  logAppEvent("Viewing saved locations.");
});

historyViewBtn?.addEventListener("click", () => {
  if (historyViewBtn.disabled) return;
  openSelectedLocations();
  logAppEvent("Opened selected locations on map.");
});

historyShareBtn?.addEventListener("click", async () => {
  if (historyShareBtn.disabled) return;
  try {
    await shareSelectedLocations();
    logAppEvent("Shared selected locations.");
  } catch (error) {
    logAppEvent(`Sharing locations failed: ${error?.message || error}`);
  }
});

historyDeleteBtn?.addEventListener("click", () => {
  if (historyDeleteBtn.disabled) return;
  deleteSelectedLocations();
  logAppEvent("Deleted selected locations.");
});

backBtn?.addEventListener("click", () => {
  const current = appRoot?.dataset.view;
  if (current === "location-history" || current === "search") showView("location");
  else showView("home");
});

installBtn?.addEventListener("click", async () => {
  logAppEvent("Install button clicked.");
  if (deferredInstallPrompt) return void promptInstall();
  if (isIosDevice) {
    logAppEvent("Install prompt not available on iOS; showing manual instructions.");
    return alert(getManualInstallInstructions());
  }
  if (isAndroidDevice || isWindowsDevice) {
    installClickRequested = true;
    installStatusText && (installStatusText.textContent = "Preparing install prompt...");
    installBtn && (installBtn.disabled = true);
    clearInstallPromptWait();
    installPromptWaitTimeoutId = window.setTimeout(() => {
      installClickRequested = false;
      installBtn && (installBtn.disabled = false);
      installStatusText && (installStatusText.textContent = getManualInstallInstructions());
      installPromptWaitTimeoutId = null;
      logAppEvent("Install prompt did not appear; showing manual instructions.");
    }, 4000);
    return;
  }
  alert(getManualInstallInstructions());
});

updateBtn?.addEventListener("click", async () => {
  if (!updateBtn) return;
  const originalText = updateBtn.textContent || "Check for Updates";
  updateBtn.disabled = true;
  updateBtn.textContent = "Checking...";
  try {
    if (swRegistration?.update) await swRegistration.update();
    window.location.reload();
  } catch (error) {
    console.log("Update check failed:", error);
    updateBtn.disabled = false;
    updateBtn.textContent = originalText;
  }
});



// PWA: service worker + install prompt
if ("serviceWorker" in navigator) {
  const registerServiceWorker = () => {
    logAppEvent("Registering service worker...");
    return navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then((registration) => {
        logAppEvent("Service worker registered.");
        swRegistration = registration;
        if (navigator.serviceWorker.controller) {
          logAppEvent("Service worker is controlling this page.");
        } else {
          logAppEvent("Awaiting service worker control (controller not yet set).");
        }
        installSection?.removeAttribute("hidden");
        if (installBtn) installBtn.disabled = false;
        if (installStatusText) {
          installStatusText.textContent = isIosDevice
            ? getManualInstallInstructions()
            : "Preparing install prompt...";
        }
        updateInstallHint();
        updateSection?.removeAttribute("hidden");
        if (updateBtn) {
          updateBtn.disabled = false;
          updateBtn.textContent = "Check for Updates";
        }
      })
      .catch((error) => {
        console.log("SW registration failed:", error);
        logAppEvent(`Service worker registration failed: ${error?.message || error}`);
        if (installBtn) installBtn.disabled = false;
        if (installStatusText) {
          installStatusText.textContent = `Unable to register service worker. ${getManualInstallInstructions()}`;
        }
      });
  };

  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      logAppEvent("Service worker reported ready.");
      if (registration.active) {
        logAppEvent("Active service worker state: " + registration.active.state);
      }
    })
    .catch((error) => {
      logAppEvent(`Service worker ready() rejected: ${error?.message || error}`);
    });

  window.setTimeout(() => {
    if (!navigator.serviceWorker.controller) {
      logAppEvent("Still no service worker controller after waiting; try closing other tabs for trail.dalifin.com and reload.");
    }
  }, 10000);
} else {
  logAppEvent("Service worker unsupported in this browser.");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installationWatchers.promptReceived = true;
  if (installationWatchers.promptTimer !== null) {
    window.clearTimeout(installationWatchers.promptTimer);
    installationWatchers.promptTimer = null;
  }
  installSection?.removeAttribute("hidden");
  installBtn && (installBtn.disabled = false);
  installStatusText && (installStatusText.textContent = "Ready to install DaliTrail on this device.");
  updateInstallHint();
  clearInstallPromptWait();
  if (installClickRequested) void promptInstall();
  installClickRequested = false;
  console.log("Install prompt ready.");
  logAppEvent("beforeinstallprompt event captured; install ready.");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installSection && (installSection.hidden = true);
  installStatusText && (installStatusText.textContent = "DaliTrail is already installed on this device.");
  logAppEvent("App installed successfully.");
});

// Geolocation permission banner
let geoPermission = "prompt";
if (navigator.permissions?.query) {
  navigator.permissions
    .query({ name: "geolocation" })
    .then((status) => {
      geoPermission = status.state;
      updatePermissionBanner(geoPermission);
      status.onchange = () => {
        geoPermission = status.state;
        updatePermissionBanner(geoPermission);
      };
    })
    .catch(() => {});
}

// ---------- Init ----------
updateInstallHint();
updateMetrics();
restoreTrailState();
loadSavedLocations();
renderLatestLocation();
renderLocationHistory();
showView(loadInitialView());
refreshGeonamesStatus();

if (!isSecure) {
  setStatus("Open this app via HTTPS (or localhost) to enable location tracking.");
}

// Reload when a new SW takes control
let _reloading = false;
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (_reloading) return;
  _reloading = true;
  logAppEvent("Service worker controller changed; reloading to apply new version.");
  if (document.visibilityState === "visible") {
    window.location.reload();
  } else {
    document.addEventListener(
      "visibilitychange",
      () => { if (document.visibilityState === "visible") window.location.reload(); },
      { once: true }
    );
  }
});



