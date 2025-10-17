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


// ---------- DOM ----------
const appRoot = document.querySelector(".app");
const backBtn = document.getElementById("back-btn");
const homeView = document.querySelector('.home-view[data-view="home"]');
const aboutView = document.querySelector('.about-view[data-view="about"]');
const locationView = document.querySelector('.location-view[data-view="location"]');
const locationHistoryView = document.querySelector('.location-history-view[data-view="location-history"]');
const notesView = document.querySelector('.notes-view[data-view="notes"]');

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
}

// ---------- Views ----------
const VIEWS = { home: homeView, about: aboutView, location: locationView, "location-history": locationHistoryView, notes: notesView };

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
  toggleLogBtn.textContent = "Hide Log";
  toggleLogBtn.setAttribute("aria-expanded", "true");
};
const hideLog = () => {
  if (!logSection || !toggleLogBtn) return;
  logSection.hidden = true;
  toggleLogBtn.textContent = "Show Log";
  toggleLogBtn.setAttribute("aria-expanded", "false");
  toggleLogBtn.classList.remove("notify");
};
const toggleLogVisibility = () => (logSection.hidden ? (toggleLogBtn.classList.remove("notify"), showLog()) : hideLog());

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
      return;
    }
    if (choice.outcome === "accepted") {
      installSection.hidden = true;
    } else {
      installBtn.disabled = false;
      installStatusText && (installStatusText.textContent = "Install was cancelled. You can try again anytime.");
    }
  } catch {
    installBtn.disabled = false;
    installStatusText && (installStatusText.textContent = `Unable to open install prompt. ${getManualInstallInstructions()}`);
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

backBtn?.addEventListener("click", () => {
  const current = appRoot?.dataset.view;
  showView(current === "location-history" ? "location" : "home");
});

installBtn?.addEventListener("click", async () => {
  if (deferredInstallPrompt) return void promptInstall();
  if (isIosDevice) return alert(getManualInstallInstructions());
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
  const registerServiceWorker = () =>
    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then((registration) => {
        swRegistration = registration;
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
        if (installBtn) installBtn.disabled = false;
        if (installStatusText) {
          installStatusText.textContent = `Unable to register service worker. ${getManualInstallInstructions()}`;
        }
      });

  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installSection?.removeAttribute("hidden");
  installBtn && (installBtn.disabled = false);
  installStatusText && (installStatusText.textContent = "Ready to install DaliTrail on this device.");
  updateInstallHint();
  clearInstallPromptWait();
  if (installClickRequested) void promptInstall();
  installClickRequested = false;
  console.log("Install prompt ready.");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installSection && (installSection.hidden = true);
  installStatusText && (installStatusText.textContent = "DaliTrail is already installed on this device.");
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
