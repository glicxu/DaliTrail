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
import "/assets/js/search.js";


// ---------- DOM ----------
const appRoot = document.querySelector(".app");
const backBtn = document.getElementById("back-btn");
const homeView = document.querySelector('.home-view[data-view="home"]');
const aboutView = document.querySelector('.about-view[data-view="about"]');
const locationView = document.querySelector('.location-view[data-view="location"]');
const locationHistoryView = document.querySelector('.location-history-view[data-view="location-history"]');
const notesView = document.querySelector('.notes-view[data-view="notes"]');
const searchView = document.querySelector('.search-view[data-view="search"]');

const openLocationViewBtn = document.getElementById("open-location-view-btn");
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
const VIEWS = { home: homeView, about: aboutView, location: locationView, "location-history": locationHistoryView, notes: notesView, search: searchView };

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
const BACKUP_VERSION = 1;
const BACKUP_PREFIX = "dalitrail:";

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

const updateGeonamesStatus = (overrideMessage) => {
  if (!geonamesStatusText) return;
  if (overrideMessage) {
    geonamesStatusText.hidden = false;
    geonamesStatusText.textContent = overrideMessage;
    return;
  }
  const meta = loadGeonamesMeta();
  if (!meta) {
    geonamesStatusText.hidden = false;
    geonamesStatusText.textContent = "No GeoNames database connected yet.";
    return;
  }
  const updated = new Date(meta.updatedAt || Date.now());
  const formattedDate = Number.isNaN(updated.getTime()) ? "unknown time" : updated.toLocaleString();
  const sourceLabel = meta.source === "user-file" ? "Custom file" : "Downloaded from DaliTrail";
  const cacheLabel = meta.cached ? "Cached for offline use." : "Available for this session.";
  geonamesStatusText.hidden = false;
  geonamesStatusText.textContent = `${sourceLabel} (${formatBytes(meta.size || 0)}). Updated ${formattedDate}. ${cacheLabel}`;
};

const cacheGeonamesBuffer = async (buffer) => {
  if (!("storage" in navigator) || typeof navigator.storage?.getDirectory !== "function") {
    return { cached: false };
  }
  try {
    const root = await navigator.storage.getDirectory();
    const appDir = await root.getDirectoryHandle("dalitrail", { create: true });
    const fileHandle = await appDir.getFileHandle("geonames.db", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    return { cached: true, path: "opfs://dalitrail/geonames.db" };
  } catch (error) {
    console.warn("Unable to cache GeoNames data:", error);
    return { cached: false };
  }
};

const gatherBackupItems = () => {
  const items = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(BACKUP_PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) items[key] = value;
  }
  return items;
};

const updateBackupStatus = (message) => {
  logAppEvent(`Backup: ${message}`);
  if (!backupStatusText) return;
  backupStatusText.hidden = false;
  backupStatusText.textContent = message;
};

const handleBackupDownload = () => {
  const items = gatherBackupItems();
  const count = Object.keys(items).length;
  if (count === 0) {
    updateBackupStatus("Nothing to back up yet. Save a location or note first.");
    return;
  }

  const payload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    itemCount: count,
    items,
  };

  try {
    const json = JSON.stringify(payload, null, 2);
    const encoded = new TextEncoder().encode(json);
    const fileName = `dalitrail-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    offerDownloadCopy(encoded, fileName);
    updateBackupStatus(`Backup downloaded with ${count} item${count === 1 ? "" : "s"}. Keep it somewhere safe.`);
  } catch (error) {
    console.error("Backup download failed:", error);
    updateBackupStatus(`Backup failed: ${error?.message || error}`);
  }
};

const applyBackupItems = (items) => {
  const restoredKeys = new Set(Object.keys(items));
  const existingKeys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(BACKUP_PREFIX)) existingKeys.push(key);
  }
  existingKeys.forEach((key) => {
    if (!restoredKeys.has(key)) localStorage.removeItem(key);
  });
  for (const [key, value] of Object.entries(items)) {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
};

const restoreBackupFromFile = async (file) => {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || typeof payload.items !== "object") {
      throw new Error("Invalid backup format.");
    }
    if (payload.version && payload.version > BACKUP_VERSION) {
      logAppEvent("Backup version is newer than supported, attempting restore anyway.");
    }
    applyBackupItems(payload.items || {});
    const count = Object.keys(payload.items || {}).length;
    updateBackupStatus(`Backup restored (${count} item${count === 1 ? "" : "s"}). Reloading...`);
    window.setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    console.error("Backup restore failed:", error);
    updateBackupStatus(`Restore failed: ${error?.message || error}`);
  }
};

const offerDownloadCopy = (buffer, fileName) => {
  try {
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 0);
  } catch (error) {
    console.warn("Unable to offer GeoNames download copy:", error);
  }
};

const handleGeonamesDownload = async () => {
  updateGeonamesStatus("Downloading GeoNames lite dataset...");
  try {
    const response = await fetch("/assets/data/geonames-lite-us-wa.db", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    const fileName = `geonames-lite-us-wa-${new Date().toISOString().slice(0, 10)}.db`;
    const cacheResult = await cacheGeonamesBuffer(buffer);
    const inlineBytes = storeGeonamesInline(buffer);
    offerDownloadCopy(buffer, fileName);
    const meta = {
      source: "download",
      fileName,
      size: buffer.byteLength,
      updatedAt: Date.now(),
      cached: cacheResult.cached,
      cachePath: cacheResult.path || null,
      inlineBytes,
    };
    saveGeonamesMeta(meta);
    updateGeonamesStatus();
    window.dispatchEvent(new CustomEvent("dalitrail:geonames-updated", { detail: { meta } }));
  } catch (error) {
    console.error("GeoNames download failed:", error);
    updateGeonamesStatus(`Download failed: ${error.message || error}`);
  }
};

const handleGeonamesConnect = async () => {
  if ("showOpenFilePicker" in window) {
    try {
      const pickerOpts = {
        multiple: false,
        types: [
          {
            description: "SQLite Database",
            accept: { "application/octet-stream": [".db", ".sqlite"], "application/x-sqlite3": [".db", ".sqlite"] },
          },
        ],
      };
      const [handle] = await window.showOpenFilePicker(pickerOpts);
      if (!handle) return;
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      const cacheResult = await cacheGeonamesBuffer(buffer);
      const inlineBytes = storeGeonamesInline(buffer);
      const meta = {
        source: "user-file",
        fileName: file.name,
        size: file.size,
        updatedAt: Date.now(),
        cached: cacheResult.cached,
        cachePath: cacheResult.path || null,
        requiresPicker: true,
        inlineBytes,
      };
      saveGeonamesMeta(meta);
      updateGeonamesStatus();
      window.dispatchEvent(new CustomEvent("dalitrail:geonames-updated", { detail: { meta } }));
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        updateGeonamesStatus("GeoNames selection cancelled.");
        return;
      }
      console.warn("showOpenFilePicker unavailable or failed, falling back to file input:", error);
    }
  }
  if (geonamesFileInput) geonamesFileInput.click();
};

const handleGeonamesFileInput = async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files || !input.files[0]) {
    return;
  }
  const file = input.files[0];
  updateGeonamesStatus(`Importing ${file.name}...`);
  try {
    const buffer = await file.arrayBuffer();
    const cacheResult = await cacheGeonamesBuffer(buffer);
    const inlineBytes = storeGeonamesInline(buffer);
    const meta = {
      source: "user-file",
      fileName: file.name,
      size: file.size,
      updatedAt: Date.now(),
      cached: cacheResult.cached,
      cachePath: cacheResult.path || null,
      requiresPicker: false,
      inlineBytes,
    };
    saveGeonamesMeta(meta);
    updateGeonamesStatus();
    window.dispatchEvent(new CustomEvent("dalitrail:geonames-updated", { detail: { meta } }));
  } catch (error) {
    console.error("Failed to import GeoNames file:", error);
    updateGeonamesStatus(`Unable to read ${file.name}: ${error.message || error}`);
  } finally {
    input.value = "";
  }
};

const handleGeonamesManage = () => {
  const meta = loadGeonamesMeta();
  if (!meta) {
    updateGeonamesStatus("No GeoNames database connected yet. Download one or select an existing file.");
    return;
  }
  const parts = [
    `Source: ${meta.source === "user-file" ? "Custom file" : "DaliTrail download"}`,
    `File: ${meta.fileName || "unknown"}`,
    `Size: ${formatBytes(meta.size || 0)}`,
    `Cached offline: ${meta.cached ? "Yes" : "No"}`,
    meta.cachePath ? `Cache path: ${meta.cachePath}` : null,
    `Updated: ${new Date(meta.updatedAt || Date.now()).toLocaleString()}`,
  ].filter(Boolean);
  updateGeonamesStatus(parts.join(" | "));
};

if (geonamesDownloadBtn) {
  geonamesDownloadBtn.addEventListener("click", () => {
    void handleGeonamesDownload();
  });
}

if (geonamesConnectBtn) {
  geonamesConnectBtn.addEventListener("click", () => {
    void handleGeonamesConnect();
  });
}

if (geonamesManageBtn) {
  geonamesManageBtn.addEventListener("click", () => {
    handleGeonamesManage();
  });
}

if (geonamesFileInput) {
  geonamesFileInput.addEventListener("change", handleGeonamesFileInput, { passive: true });
}

updateGeonamesStatus();

// ---------- Install helpers ----------
const getManualInstallInstructions = () => {
  if (isIosDevice) return "Use Safari's share sheet and choose Add to Home Screen.";
  if (isAndroidDevice || isWindowsDevice) return "Make sure you're online and using the latest Chrome/Edge, then refresh and try again.";
  return "Try a supported browser like Chrome or Edge.";
};

const updateInstallHint = () => {
  if (!installHintText) return;
  if (isIosDevice) installHintText.textContent = "On iPhone: open Safari’s share sheet and pick Add to Home Screen.";
  else if (isAndroidDevice) installHintText.textContent = "On Android: tap Install. If nothing appears, make sure you're in Chrome and try again.";
  else if (isWindowsDevice) installHintText.textContent = "On Windows: tap Install in Chrome/Edge. If nothing appears, try again.";
  else installHintText.textContent = "Tap Install to open your browser’s install prompt when supported.";
};

const clearInstallPromptWait = () => {
  if (installPromptWaitTimeoutId !== null) {
    window.clearTimeout(installPromptWaitTimeoutId);
    installPromptWaitTimeoutId = null;
  }
};

const promptInstall = async () => {
  if (!deferredInstallPrompt || !installBtn) return;
  logAppEvent("Install prompt requested.");
  installClickRequested = false;
  clearInstallPromptWait();
  installBtn.disabled = true;
  installStatusText && (installStatusText.textContent = "Displaying install prompt...");
  let fallbackTimer = null;
  const scheduleFallbackNotice = () => {
    if (!installStatusText) return;
    fallbackTimer = window.setTimeout(() => {
      installBtn.disabled = false;
      installStatusText.textContent = `Install prompt might be blocked. ${getManualInstallInstructions()}`;
      logAppEvent("Install prompt fallback: no prompt appeared within timeout.");
    }, 5000);
  };
  try {
    scheduleFallbackNotice();
    await deferredInstallPrompt.prompt();
    const choice = deferredInstallPrompt.userChoice && (await deferredInstallPrompt.userChoice);
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    if (!choice) {
      installBtn.disabled = false;
      installStatusText && (installStatusText.textContent = `Install prompt may not be supported here. ${getManualInstallInstructions()}`);
      logAppEvent("Install prompt resolved with no user choice.");
      return;
    }
    if (choice.outcome === "accepted") {
      installSection.hidden = true;
      logAppEvent("User accepted install prompt.");
    } else {
      installBtn.disabled = false;
      installStatusText && (installStatusText.textContent = "Install was cancelled. You can try again anytime.");
      logAppEvent("User dismissed install prompt.");
    }
  } catch {
    installBtn.disabled = false;
    installStatusText && (installStatusText.textContent = `Unable to open install prompt. ${getManualInstallInstructions()}`);
    logAppEvent("Install prompt threw an error.");
  } finally {
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    deferredInstallPrompt = null;
  }
};

// ---------- Permissions banner ----------
const setStatus = (message) => {
  if (!statusText) return;
  if (!message) {
    statusText.textContent = "";
    statusText.hidden = true;
  } else {
    statusText.textContent = message;
    statusText.hidden = false;
  }
};
const updatePermissionBanner = (geoPermission) => {
  if (geoPermission === "denied") {
    setStatus("Location access denied. Enable it in your browser settings to continue.");
  }
};

// ---------- Location page button wiring ----------
function ensureHiddenInputs() {
  // location.js reads these by ID; create if missing (hidden).
  let note = document.getElementById("location-note-input");
  if (!note) {
    note = document.createElement("input");
    note.type = "hidden";
    note.id = "location-note-input";
    document.body.appendChild(note);
  }
  let manual = document.getElementById("manual-coordinate-input");
  if (!manual) {
    manual = document.createElement("input");
    manual.type = "hidden";
    manual.id = "manual-coordinate-input";
    document.body.appendChild(manual);
  }
  let acc = document.getElementById("manual-accuracy-input");
  if (!acc) {
    acc = document.createElement("input");
    acc.type = "hidden";
    acc.id = "manual-accuracy-input";
    document.body.appendChild(acc);
  }
  return { note, manual, acc };
}


btnImport?.addEventListener("click", () => kmlInput?.click());

// ---------- Wire events ----------
openMapsBtn?.addEventListener("click", openRouteInMaps);
toggleLogBtn?.addEventListener("click", toggleLogVisibility);

openLocationViewBtn?.addEventListener("click", () => showView("location"));
openNotesViewBtn?.addEventListener("click", () => showView("notes"));
openAboutViewBtn?.addEventListener("click", () => showView("about"));


openLocationHistoryBtn?.addEventListener("click", () => {
  renderLocationHistory();
  showView("location-history");
});
historyViewBtn?.addEventListener("click", openSelectedLocations);
historyShareBtn?.addEventListener("click", () => void shareSelectedLocations());
historyDeleteBtn?.addEventListener("click", deleteSelectedLocations);

backupDownloadBtn?.addEventListener("click", handleBackupDownload);
backupRestoreBtn?.addEventListener("click", () => {
  if (!backupFileInput) {
    updateBackupStatus("Restore not supported on this device.");
    return;
  }
  backupFileInput.click();
});
backupFileInput?.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) return;
  const file = input.files[0];
  updateBackupStatus(`Restoring from ${file.name}...`);
  void restoreBackupFromFile(file);
  input.value = "";
});

window.addEventListener("dalitrail:prompt-geonames", (event) => {
  const reason = event?.detail?.reason || "GeoNames database required.";
  logAppEvent(`GeoNames prompt: ${reason}`);
  showView("about");
  if (geonamesDetails instanceof HTMLDetailsElement) geonamesDetails.open = true;
  updateGeonamesStatus(
    `${reason} Use the buttons below to download or select a GeoNames database.`
  );
  window.alert(
    `${reason}\n\nOpen About ▸ GeoNames Data and download or select a database to continue using Search.`
  );
});

window.addEventListener("dalitrail:request-search", (event) => {
  const entry = event.detail?.entry;
  showView("search");
  window.dispatchEvent(new CustomEvent("dalitrail:search-load", { detail: { entry } }));
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
