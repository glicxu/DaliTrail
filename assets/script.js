const appRoot = document.querySelector(".app");
const backBtn = document.getElementById("back-btn");
const homeView = document.querySelector('.home-view[data-view="home"]');
const aboutView = document.querySelector('.about-view[data-view="about"]');
const locationView = document.querySelector('.location-view[data-view="location"]');
const locationHistoryView = document.querySelector('.location-history-view[data-view="location-history"]');
const trackView = document.querySelector('.track-view[data-view="track"]');
const openLocationViewBtn = document.getElementById("open-location-view-btn");
const openTrackViewBtn = document.getElementById("open-track-view-btn");
const openAboutViewBtn = document.getElementById("open-about-view-btn");

const statusText = document.getElementById("status-text");
const pointsCountText = document.getElementById("points-count");
const distanceText = document.getElementById("distance");
const elapsedText = document.getElementById("elapsed");
const elevationGainText = document.getElementById("elevation-gain");
const elevationLossText = document.getElementById("elevation-loss");
const logList = document.getElementById("log");
const exportSection = document.querySelector(".export");
const logSection = document.querySelector(".log");
const toggleLogBtn = document.getElementById("toggle-log-btn");
const openMapsBtn = document.getElementById("open-maps-btn");
const avgSpeedText = document.getElementById("avg-speed");

const locationNoteInput = document.getElementById("location-note-input");
const captureLocationBtn = document.getElementById("capture-location-btn");
const locationStatusText = document.getElementById("location-status");
const latestLocationCard = document.getElementById("latest-location-card");
const openLocationHistoryBtn = document.getElementById("open-location-history-btn");
const locationsList = document.getElementById("locations-list");
const locationHistoryStatus = document.getElementById("location-history-status");
const historyViewBtn = document.getElementById("history-view-btn");
const historyShareBtn = document.getElementById("history-share-btn");
const historyDeleteBtn = document.getElementById("history-delete-btn");
const locationModeInputs = document.querySelectorAll('input[name="location-mode"]');
const locationModeViews = document.querySelectorAll(".location-mode-view");
const manualCoordinateInput = document.getElementById("manual-coordinate-input");
const manualAccuracyInput = document.getElementById("manual-accuracy-input");
const saveManualLocationBtn = document.getElementById("save-manual-location-btn");

const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const finishBtn = document.getElementById("finish-btn");
const LAST_VIEW_KEY = "dalitrail:last-view";

const STORAGE_KEY = "dalitrail:session";
const LOCATIONS_KEY = "dalitrail:locations";

const installSection = document.querySelector(".about-view .install");
const installBtn = document.getElementById("install-btn");
const installStatusText = document.getElementById("install-status");
const updateSection = document.getElementById("update-section");
const updateBtn = document.getElementById("update-btn");
let swRegistration = null;

let watchId = null;
let geoPermission = "prompt";
let activeStartTime = null;
let elapsedOffset = 0;
let timerId = null;
let points = [];
let lastPoint = null;
let lastAcceptedPoint = null;
let totalDistance = 0;
let hasFinished = false;
let elevationGain = 0;
let elevationLoss = 0;
const isSecure =
    window.isSecureContext || window.location.hostname === "localhost";
const isIosDevice =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent || "");
const isAndroidDevice =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "");
let savedLocations = [];
let isCapturingLocation = false;
const selectedLocationIds = new Set();
let locationMode = "auto";

const MAX_SEGMENT_METERS = 150; // Ignore improbable jumps
const MAX_ACCURACY_METERS = 25; // Skip low-accuracy fixes
const MIN_DISPLACEMENT_METERS = 6; // Require meaningful movement
let deferredInstallPrompt = null;

const logEvent = (message) => {
    const item = document.createElement("li");
    const timestamp = new Date().toLocaleTimeString();
    item.textContent = `[${timestamp}] ${message}`;
    logList.prepend(item);
    if (logSection && logSection.hidden) {
        toggleLogBtn?.classList.add("notify");
    }
};

const VIEWS = {
    home: homeView,
    about: aboutView,
    location: locationView,
    "location-history": locationHistoryView,
    track: trackView,
};

const showView = (view) => {
    if (!(view in VIEWS)) {
        throw new Error(`Unknown view: ${view}`);
    }
    appRoot.dataset.view = view;
    if (typeof localStorage !== "undefined") {
        try {
            localStorage.setItem(LAST_VIEW_KEY, view);
        } catch {
            // Ignore storage errors (e.g., quota exceeded, disabled).
        }
    }
    Object.entries(VIEWS).forEach(([name, section]) => {
        if (!section) {
            return;
        }
        section.hidden = name !== view;
    });
    if (backBtn) {
        backBtn.hidden = view === "home";
        backBtn.disabled = view === "home";
        backBtn.tabIndex = view === "home" ? -1 : 0;
    }
    if (view === "track") {
        hideLog();
        updateMetrics();
    }
    if (view === "location-history") {
        updateHistoryActions();
    }
};

const persistSavedLocations = () => {
    if (typeof localStorage === "undefined") {
        return;
    }
    try {
        localStorage.setItem(LOCATIONS_KEY, JSON.stringify(savedLocations));
    } catch (error) {
        locationStatusText.textContent = `Unable to save location: ${error.message}`;
    }
};

const loadSavedLocations = () => {
    if (typeof localStorage === "undefined") {
        savedLocations = [];
        return;
    }
    try {
        const raw = localStorage.getItem(LOCATIONS_KEY);
        if (!raw) {
            savedLocations = [];
            return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            savedLocations = [];
            return;
        }
        savedLocations = parsed
            .filter(
                (entry) =>
                    typeof entry === "object" &&
                    entry !== null &&
                    Number.isFinite(entry.lat) &&
                    Number.isFinite(entry.lng) &&
                    typeof entry.id === "string"
            )
            .map((entry) => ({
                ...entry,
                note: typeof entry.note === "string" ? entry.note : "",
            }))
            .sort((a, b) => b.timestamp - a.timestamp);
    } catch {
        savedLocations = [];
    }
};

const formatTimestamp = (value) => {
    const date = new Date(value);
    return date.toLocaleString();
};

const updateHistoryActions = () => {
    const hasSelection = selectedLocationIds.size > 0;
    if (historyViewBtn) {
        historyViewBtn.disabled = !hasSelection;
    }
    if (historyShareBtn) {
        historyShareBtn.disabled = !hasSelection;
    }
    if (historyDeleteBtn) {
        historyDeleteBtn.disabled = !hasSelection;
    }
};

const renderLatestLocation = () => {
    if (!latestLocationCard) {
        return;
    }
    latestLocationCard.innerHTML = "";
    if (savedLocations.length === 0) {
        latestLocationCard.classList.add("empty");
        latestLocationCard.innerHTML = `<p class="status-text">No locations saved yet.</p>`;
        delete latestLocationCard.dataset.id;
        if (locationStatusText) {
            locationStatusText.textContent = "No locations saved yet.";
        }
        if (openLocationHistoryBtn) {
            openLocationHistoryBtn.disabled = true;
        }
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
        ${
            Number.isFinite(latest.accuracy)
                ? `<span>Accuracy: +/-${latest.accuracy.toFixed(1)} m</span>`
                : ""
        }
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

    if (locationStatusText) {
        locationStatusText.textContent = `Saved ${savedLocations.length} location${
            savedLocations.length === 1 ? "" : "s"
        }.`;
    }
    if (openLocationHistoryBtn) {
        openLocationHistoryBtn.disabled = savedLocations.length === 0;
    }
};

const renderLocationHistory = () => {
    if (!locationsList || !locationHistoryStatus) {
        return;
    }
    locationsList.innerHTML = "";
    const validIds = new Set(savedLocations.map((entry) => entry.id));
    Array.from(selectedLocationIds).forEach((id) => {
        if (!validIds.has(id)) {
            selectedLocationIds.delete(id);
        }
    });

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
            ${
                Number.isFinite(entry.accuracy)
                    ? `<span>Accuracy: +/-${entry.accuracy.toFixed(1)} m</span>`
                    : ""
            }
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

const fuseLocationSamples = (samples) => {
    if (!samples.length) {
        return null;
    }

    const validSamples = samples.filter(
        (sample) => Number.isFinite(sample.lat) && Number.isFinite(sample.lng)
    );
    if (!validSamples.length) {
        return null;
    }

    const accurateSamples = validSamples.filter(
        (sample) => Number.isFinite(sample.accuracy) && sample.accuracy > 0
    );
    const referenceSample =
        accurateSamples.length > 0
            ? accurateSamples.reduce((best, sample) =>
                  sample.accuracy < best.accuracy ? sample : best
              )
            : validSamples[0];

    const QUALITY_THRESHOLD = 100;
    const MAX_DISTANCE_MULTIPLIER = 2;
    const MIN_DISTANCE_THRESHOLD = 25;

    const qualityFiltered = accurateSamples.length
        ? accurateSamples.filter((sample) => sample.accuracy <= QUALITY_THRESHOLD)
        : validSamples;

    const distanceThreshold = Math.max(
        MIN_DISTANCE_THRESHOLD,
        (referenceSample.accuracy || MIN_DISTANCE_THRESHOLD) * MAX_DISTANCE_MULTIPLIER
    );

    const clustered = qualityFiltered.filter((sample) => {
        const distance = haversineDistance(referenceSample, sample);
        return Number.isFinite(distance) && distance <= distanceThreshold;
    });

    const points = clustered.length ? clustered : [referenceSample];

    let weightSum = 0;
    let latSum = 0;
    let lngSum = 0;
    let altSum = 0;
    let altWeightSum = 0;

    points.forEach((sample) => {
        const accuracy = Number.isFinite(sample.accuracy) && sample.accuracy > 0 ? sample.accuracy : 50;
        const weight = 1 / (accuracy * accuracy);
        weightSum += weight;
        latSum += sample.lat * weight;
        lngSum += sample.lng * weight;
        if (Number.isFinite(sample.altitude)) {
            altSum += sample.altitude * weight;
            altWeightSum += weight;
        }
    });

    if (weightSum === 0) {
        const fallback = referenceSample;
        return {
            lat: fallback.lat,
            lng: fallback.lng,
            accuracy: fallback.accuracy ?? 50,
            altitude: Number.isFinite(fallback.altitude) ? fallback.altitude : null,
            timestamp: Date.now(),
            sampleCount: points.length,
        };
    }

    const fused = {
        lat: latSum / weightSum,
        lng: lngSum / weightSum,
        accuracy: Math.sqrt(1 / weightSum),
        altitude: altWeightSum > 0 ? altSum / altWeightSum : null,
        timestamp: Date.now(),
        sampleCount: points.length,
    };

    return fused;
};

const collectFusedLocation = ({ maxSamples = 5, windowMs = 4500 } = {}) =>
    new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported on this device."));
            return;
        }

        const samples = [];
        let resolved = false;
        let watchId = null;
        let timerId = null;

        const cleanup = () => {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
            if (timerId !== null) {
                window.clearTimeout(timerId);
                timerId = null;
            }
        };

        const finalize = () => {
            if (resolved) {
                return;
            }
            resolved = true;
            cleanup();
            resolve(samples.slice());
        };

        const handleError = (error) => {
            if (resolved) {
                return;
            }
            if (samples.length) {
                finalize();
            } else {
                cleanup();
                resolved = true;
                reject(error);
            }
        };

        timerId = window.setTimeout(finalize, windowMs);

        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy, altitude } = position.coords;
                samples.push({
                    lat: latitude,
                    lng: longitude,
                    accuracy: Number.isFinite(accuracy) ? accuracy : Infinity,
                    altitude: Number.isFinite(altitude) ? altitude : null,
                    timestamp: position.timestamp || Date.now(),
                });

                if (samples.length >= maxSamples) {
                    finalize();
                }
            },
            handleError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: windowMs,
            }
        );
    }).then((samples) => {
        const fused = fuseLocationSamples(samples);
        if (!fused) {
            throw new Error("Unable to determine an accurate position.");
        }
        logEvent(
            `Location fusion: captured ${samples.length} samples, fused at ${fused.lat.toFixed(
                6
            )}, ${fused.lng.toFixed(6)} with ~±${fused.accuracy?.toFixed(1) ?? "?"} m accuracy.`
        );
        samples.forEach((sample, index) => {
            logEvent(
                `Sample ${index + 1}: ${sample.lat.toFixed(6)}, ${sample.lng.toFixed(6)} (accuracy ${
                    Number.isFinite(sample.accuracy) ? `±${sample.accuracy.toFixed(1)} m` : "unknown"
                })`
            );
        });
        return { fused, samples };
    });

const openLocationMap = (entry) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${entry.lat},${entry.lng}`
    )}`;
    window.open(url, "_blank", "noopener");
};

const shareLocationEntry = async (entry) => {
    const noteLine = entry.note ? `\nNote: ${entry.note}` : "";
    const message = `Location recorded on ${formatTimestamp(
        entry.timestamp
    )}\nLat: ${entry.lat.toFixed(6)}\nLng: ${entry.lng.toFixed(6)}${noteLine}\n\nSent from DaliTrail.`;

    const shareData = {
        title: "Saved location",
        text: message,
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${entry.lat},${entry.lng}`
        )}`,
    };

    if (navigator.share) {
        try {
            await navigator.share(shareData);
            locationStatusText.textContent = "Location shared successfully.";
        } catch (error) {
            if (error.name !== "AbortError") {
                locationStatusText.textContent = `Share failed: ${error.message}`;
            }
        }
    } else {
        openLocationMap(entry);
    }
};

const getSelectedLocations = () => {
    return savedLocations.filter((entry) => selectedLocationIds.has(entry.id));
};

const openSelectedLocations = () => {
    const selected = getSelectedLocations();
    if (selected.length === 0) {
        return;
    }
    if (selected.length === 1) {
        openLocationMap(selected[0]);
        return;
    }
    const origin = selected[0];
    const destination = selected[selected.length - 1];
    const waypoints = selected.slice(1, -1);
    const format = (entry) => `${entry.lat.toFixed(6)},${entry.lng.toFixed(6)}`;
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${encodeURIComponent(
        format(origin)
    )}&destination=${encodeURIComponent(format(destination))}`;
    if (waypoints.length) {
        const waypointString = waypoints.map(format).join("|");
        url += `&waypoints=${encodeURIComponent(waypointString)}`;
    }
    window.open(url, "_blank", "noopener");
};

const shareSelectedLocations = async () => {
    if (shareSelectedLocations.isSharing) {
        return;
    }
    shareSelectedLocations.isSharing = true;
    try {
        const selected = getSelectedLocations();
        if (selected.length === 0) {
            return;
        }
        const lines = selected.map((entry, index) => {
            const note = entry.note ? `Note: ${entry.note}\n` : "";
            const accuracy = Number.isFinite(entry.accuracy)
                ? `Accuracy: +/-${entry.accuracy.toFixed(1)} m\n`
                : "";
            return `#${index + 1} ${formatTimestamp(entry.timestamp)}\nLat: ${entry.lat.toFixed(6)}\nLng: ${entry.lng.toFixed(6)}\n${accuracy}${note}`;
        });
        const shareText = `Saved locations from DaliTrail:\n\n${lines.join("\n")}\nSent via DaliTrail.`;

        const buildLocationsKml = () => {
            const name = `DaliTrail-locations-${new Date().toISOString()}`;
            const placemarks = selected
                .map(
                    (entry, index) => `\n    <Placemark>\n      <name>Location ${index + 1}</name>\n      <description><![CDATA[\n${entry.note ? `${entry.note}\n` : ""}Recorded: ${formatTimestamp(entry.timestamp)}\nLatitude: ${entry.lat.toFixed(6)}\nLongitude: ${entry.lng.toFixed(6)}\n${Number.isFinite(entry.accuracy) ? `Accuracy: +/-${entry.accuracy.toFixed(1)} m` : ""}\n      ]]></description>\n      <Point>\n        <coordinates>${entry.lng.toFixed(6)},${entry.lat.toFixed(6)},0</coordinates>\n      </Point>\n    </Placemark>`
                )
                .join("\n");
            return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${name}</name>\n${placemarks}\n  </Document>\n</kml>`;
        };

        const kmlContent = buildLocationsKml();
        const blob = new Blob([kmlContent], {
            type: "application/vnd.google-earth.kml+xml",
        });
        const filename = `dalitrail-locations-${Date.now()}.kml`;

        const shareKmlWithFilesApi = async () => {
            if (!(navigator.share && navigator.canShare)) {
                return false;
            }
            try {
                const kmlFile = new File([blob], filename, { type: blob.type });
                if (!navigator.canShare({ files: [kmlFile] })) {
                    return false;
                }
                await navigator.share({
                    files: [kmlFile],
                    title: "DaliTrail locations",
                    text: "Selected locations exported from DaliTrail.",
                });
                if (locationHistoryStatus) {
                    locationHistoryStatus.textContent = "KML shared successfully.";
                }
                return true;
            } catch (error) {
                if (error.name === "AbortError") {
                    if (locationHistoryStatus) {
                        locationHistoryStatus.textContent = "Share cancelled.";
                    }
                    return true;
                }
                if (
                    error.name === "NotAllowedError" ||
                    error.name === "SecurityError" ||
                    error.name === "PermissionDeniedError"
                ) {
                    return false;
                }
                if (locationHistoryStatus) {
                    locationHistoryStatus.textContent = `Sharing failed: ${error.message}`;
                }
                return true;
            }
        };

        if (await shareKmlWithFilesApi()) {
            return;
        }

        if (navigator.share && !navigator.canShare) {
            try {
                await navigator.share({
                    title: "Saved locations",
                    text: shareText,
                });
                if (locationHistoryStatus) {
                    locationHistoryStatus.textContent = "Locations shared successfully.";
                }
                return;
            } catch (error) {
                if (error.name === "AbortError") {
                    if (locationHistoryStatus) {
                        locationHistoryStatus.textContent = "Share cancelled.";
                    }
                    return;
                }
                if (
                    error.name !== "NotAllowedError" &&
                    error.name !== "SecurityError" &&
                    !error.message?.includes("not yet completed")
                ) {
                    if (locationHistoryStatus) {
                        locationHistoryStatus.textContent = `Sharing failed: ${error.message}`;
                    }
                    return;
                }
            }
        }

        if (navigator.clipboard) {
            try {
                await navigator.clipboard.writeText(shareText);
                alert("Locations copied to clipboard. You can paste them anywhere.");
                if (locationHistoryStatus) {
                    locationHistoryStatus.textContent = "Locations copied to clipboard.";
                }
                return;
            } catch {
                // ignore and fall back
            }
        }

        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        if (locationHistoryStatus) {
            locationHistoryStatus.textContent = "KML downloaded. Share it from your files app.";
        }
    } finally {
        shareSelectedLocations.isSharing = false;
    }
};
shareSelectedLocations.isSharing = false;


const deleteSelectedLocations = () => {
    const selected = getSelectedLocations();
    if (selected.length === 0) {
        return;
    }
    const confirmed = window.confirm(
        selected.length === 1
            ? "Delete this saved location permanently?"
            : `Delete these ${selected.length} saved locations permanently?`
    );
    if (!confirmed) {
        if (locationHistoryStatus) {
            locationHistoryStatus.textContent = "Deletion cancelled.";
        }
        return;
    }

    const toRemove = new Set(selected.map((entry) => entry.id));
    savedLocations = savedLocations.filter((entry) => !toRemove.has(entry.id));
    selectedLocationIds.clear();
    persistSavedLocations();
    renderLatestLocation();
    renderLocationHistory();
    if (locationStatusText) {
        locationStatusText.textContent =
            savedLocations.length === 0
                ? "No locations saved yet."
                : `Saved ${savedLocations.length} location${savedLocations.length === 1 ? "" : "s"}.`;
    }
    if (locationHistoryStatus) {
        locationHistoryStatus.textContent = `Deleted ${selected.length} location${selected.length === 1 ? "" : "s"}.`;
    }
    logEvent(`Deleted ${selected.length} saved location${selected.length === 1 ? "" : "s"}.`);
};

const scheduleFallbackNavigation = (callback, delay = 1200) => {
    const handleVisibilityChange = () => {
        if (document.hidden) {
            window.clearTimeout(timerId);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        }
    };

    const timerId = window.setTimeout(() => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        callback();
    }, delay);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
        window.clearTimeout(timerId);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
};

const showLog = () => {
    if (!logSection || !toggleLogBtn) {
        return;
    }
    logSection.hidden = false;
    toggleLogBtn.textContent = "Hide Log";
    toggleLogBtn.setAttribute("aria-expanded", "true");
};

const hideLog = () => {
    if (!logSection || !toggleLogBtn) {
        return;
    }
    logSection.hidden = true;
    toggleLogBtn.textContent = "Show Log";
    toggleLogBtn.setAttribute("aria-expanded", "false");
    toggleLogBtn.classList.remove("notify");
};

const toggleLogVisibility = () => {
    if (!logSection || !toggleLogBtn) {
        return;
    }
    if (logSection.hidden) {
        toggleLogBtn.classList.remove("notify");
        showLog();
    } else {
        hideLog();
    }
};

const applyLocationMode = (mode) => {
    const nextMode = mode === "manual" ? "manual" : "auto";
    locationMode = nextMode;
    locationModeInputs.forEach((input) => {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        input.checked = input.value === nextMode;
        const option = input.closest(".mode-option");
        if (option && option instanceof HTMLElement) {
            option.classList.toggle("active", input.value === nextMode);
        }
    });
    locationModeViews.forEach((view) => {
        if (!(view instanceof HTMLElement)) {
            return;
        }
        const isActive = view.dataset.mode === nextMode;
        view.hidden = !isActive;
        view.setAttribute("aria-hidden", String(!isActive));
    });
    if (nextMode === "manual") {
        manualCoordinateInput?.focus();
    }
};

const captureCurrentLocation = async () => {
    if (!captureLocationBtn) {
        return;
    }
    if (isCapturingLocation) {
        return;
    }
    if (!navigator.geolocation) {
        alert("Geolocation is not supported on this device.");
        return;
    }
    if (!isSecure) {
        alert("Enable HTTPS (or use localhost) to access your location.");
        return;
    }

    isCapturingLocation = true;
    captureLocationBtn.disabled = true;
    if (locationStatusText) {
        locationStatusText.textContent = "Collecting precise location...";
    }
    const note = (locationNoteInput?.value || "").trim();

    try {
        const { fused } = await collectFusedLocation();
        const entry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            lat: fused.lat,
            lng: fused.lng,
            accuracy: Number.isFinite(fused.accuracy) ? fused.accuracy : null,
            note,
            timestamp: fused.timestamp,
        };
        savedLocations = [entry, ...savedLocations];
        persistSavedLocations();
        renderLatestLocation();
        renderLocationHistory();
        if (locationNoteInput) {
            locationNoteInput.value = "";
        }
        if (locationStatusText) {
            const accuracyText = entry.accuracy ? ` (~+/-${entry.accuracy.toFixed(1)} m)` : "";
            locationStatusText.textContent = `Location saved${accuracyText}.`;
        }
    } catch (error) {
        if (locationStatusText) {
            const fallbackMessage =
                error && typeof error === "object" && "message" in error ? error.message : String(error);
            locationStatusText.textContent = `Unable to capture location: ${fallbackMessage}`;
        }
    } finally {
        isCapturingLocation = false;
        captureLocationBtn.disabled = false;
    }
};

const parseCoordinateInput = (raw) => {
    if (!raw) {
        throw new Error("Enter coordinates to continue.");
    }
    const normalized = raw
        .replace(/[()]/g, " ")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) {
        throw new Error("Enter coordinates to continue.");
    }

    const toDecimal = (degrees, minutes, seconds, direction) => {
        const deg = Number.parseFloat(degrees);
        const min = minutes ? Number.parseFloat(minutes) : 0;
        const sec = seconds ? Number.parseFloat(seconds) : 0;
        if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) {
            throw new Error("Unable to read degrees, minutes, or seconds.");
        }
        let value = Math.abs(deg) + min / 60 + sec / 3600;
        if (deg < 0) {
            value *= -1;
        }
        const dir = direction?.toUpperCase() ?? "";
        if (dir === "S" || dir === "W") {
            value = Math.abs(value) * -1;
        } else if (dir === "N" || dir === "E") {
            value = Math.abs(value);
        }
        return value;
    };

    const validatePair = (lat, lng) => {
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
            throw new Error("Latitude must be between -90 and 90 degrees.");
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw new Error("Longitude must be between -180 and 180 degrees.");
        }
        return { lat, lng };
    };

    const assignWithDirection = (matches, extractor) => {
        let lat = null;
        let lng = null;
        matches.forEach((match) => {
            const { value, direction } = extractor(match);
            const dir = direction.toUpperCase();
            if (dir === "N" || dir === "S") {
                lat = value;
            } else if (dir === "E" || dir === "W") {
                lng = value;
            }
        });
        if (lat === null || lng === null) {
            if (matches.length >= 2) {
                const first = extractor(matches[0]);
                const second = extractor(matches[1]);
                if (lat === null) {
                    lat = first.value;
                }
                if (lng === null) {
                    lng = second.value;
                }
            }
        }
        if (lat === null || lng === null) {
            throw new Error("Unable to determine latitude and longitude from input.");
        }
        return validatePair(lat, lng);
    };

    const dmsRegex =
        /(\d{1,3})[°º]?\s*(\d{1,2})['’′]?\s*(\d{1,2}(?:\.\d+)?)?["”″]?\s*([NSEW])/gi;
    const dmsMatches = [...normalized.matchAll(dmsRegex)];
    if (dmsMatches.length >= 2) {
        return assignWithDirection(dmsMatches.slice(0, 2), (match) => {
            const [, deg, min, sec, dir] = match;
            return {
                value: toDecimal(deg, min, sec, dir),
                direction: dir,
            };
        });
    }

    const directionalDecimalRegex = /([+-]?\d+(?:\.\d+)?)\s*[°º]?\s*([NSEW])/gi;
    const directionalDecimals = [...normalized.matchAll(directionalDecimalRegex)];
    if (directionalDecimals.length >= 2) {
        return assignWithDirection(directionalDecimals.slice(0, 2), (match) => {
            const [, valueStr, dir] = match;
            const value = Number.parseFloat(valueStr);
            if (!Number.isFinite(value)) {
                throw new Error("Unable to read coordinate value.");
            }
            const direction = dir.toUpperCase();
            const signedValue =
                direction === "S" || direction === "W" ? -Math.abs(value) : Math.abs(value);
            return {
                value: signedValue,
                direction,
            };
        });
    }

    const commaPair = normalized.match(
        /^([+-]?\d+(?:\.\d+)?)[\s,]+([+-]?\d+(?:\.\d+)?)(?:[\s,]+)?$/
    );
    if (commaPair) {
        const lat = Number.parseFloat(commaPair[1]);
        const lng = Number.parseFloat(commaPair[2]);
        return validatePair(lat, lng);
    }

    const numericTokens = normalized
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0 && /^[-+]?\d+(?:\.\d+)?$/.test(token));
    if (numericTokens.length >= 2) {
        const lat = Number.parseFloat(numericTokens[0]);
        const lng = Number.parseFloat(numericTokens[1]);
        return validatePair(lat, lng);
    }

    throw new Error("Unable to parse coordinates. Try decimal or degree format.");
};

const saveManualLocation = () => {
    if (!manualCoordinateInput || !saveManualLocationBtn) {
        return;
    }
    const rawValue = manualCoordinateInput.value.trim();
    if (!rawValue) {
        if (locationStatusText) {
            locationStatusText.textContent = "Enter coordinates to continue.";
        }
        manualCoordinateInput.focus();
        return;
    }
    let lat;
    let lng;
    try {
        const result = parseCoordinateInput(rawValue);
        lat = result.lat;
        lng = result.lng;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to parse coordinates.";
        if (locationStatusText) {
            locationStatusText.textContent = message;
        }
        manualCoordinateInput.focus();
        manualCoordinateInput.select?.();
        return;
    }
    let accuracy = null;
    const accuracyRaw = manualAccuracyInput?.value.trim();
    if (accuracyRaw) {
        const parsedAccuracy = Number.parseFloat(accuracyRaw);
        if (!Number.isFinite(parsedAccuracy) || parsedAccuracy < 0) {
            if (locationStatusText) {
                locationStatusText.textContent = "Accuracy must be a positive number.";
            }
            manualAccuracyInput?.focus();
            return;
        }
        accuracy = parsedAccuracy;
    }
    const note = (locationNoteInput?.value || "").trim();
    const timestamp = Date.now();
    const entry = {
        id: `${timestamp}-${Math.random().toString(16).slice(2, 8)}`,
        lat,
        lng,
        accuracy,
        note,
        timestamp,
    };
    savedLocations = [entry, ...savedLocations];
    persistSavedLocations();
    renderLatestLocation();
    renderLocationHistory();
    manualCoordinateInput.value = "";
    if (manualAccuracyInput) {
        manualAccuracyInput.value = "";
    }
    if (locationStatusText) {
        const accuracyText = Number.isFinite(accuracy) ? ` (~+/-${accuracy.toFixed(1)} m)` : "";
        locationStatusText.textContent = `Manual coordinates saved${accuracyText}.`;
    }
    logEvent(
        `Manual coordinates saved at Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)}${
            Number.isFinite(accuracy) ? ` (±${accuracy.toFixed(1)} m)` : ""
        }.`
    );
};

const setStatus = (message) => {
    statusText.textContent = message;
};

const formatElapsed = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
};

const updateMetrics = () => {
    pointsCountText.textContent = points.length;
    distanceText.textContent = `${totalDistance.toFixed(1)} m`;
    elevationGainText.textContent = `${elevationGain.toFixed(1)} m`;
    elevationLossText.textContent = `${elevationLoss.toFixed(1)} m`;
    const elapsed =
        elapsedOffset + (activeStartTime ? Date.now() - activeStartTime : 0);
    elapsedText.textContent = formatElapsed(elapsed);
    const hours = elapsed / 3600000;
    const avgSpeed = hours > 0 ? (totalDistance / 1000) / hours : 0;
    if (avgSpeedText) {
        avgSpeedText.textContent = `${avgSpeed.toFixed(2)} km/h`;
    }
};

const startTimer = () => {
    stopTimer();
    timerId = window.setInterval(updateMetrics, 1000);
};

const stopTimer = () => {
    if (timerId) {
        window.clearInterval(timerId);
        timerId = null;
    }
};

const haversineDistance = (pointA, pointB) => {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;

    const dLat = toRad(pointB.lat - pointA.lat);
    const dLon = toRad(pointB.lng - pointA.lng);

    const lat1 = toRad(pointA.lat);
    const lat2 = toRad(pointB.lat);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
};

const persistTrailState = () => {
    if (typeof localStorage === "undefined") {
        return;
    }
    const payload = {
        points,
        totalDistance,
        elevationGain,
        elevationLoss,
        elapsedOffset:
            elapsedOffset + (activeStartTime ? Date.now() - activeStartTime : 0),
        hasFinished,
        lastPoint,
        lastAcceptedPoint,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        logEvent(`Unable to persist session: ${error.message}`);
    }
};

const restoreTrailState = () => {
    if (typeof localStorage === "undefined") {
        return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return;
    }
    try {
        const parsed = JSON.parse(raw);
        points = Array.isArray(parsed.points) ? parsed.points : [];
        totalDistance = Number(parsed.totalDistance) || 0;
        elevationGain = Number(parsed.elevationGain) || 0;
        elevationLoss = Number(parsed.elevationLoss) || 0;
        elapsedOffset = Number(parsed.elapsedOffset) || 0;
        hasFinished = Boolean(parsed.hasFinished);
        lastPoint = parsed.lastPoint || null;
        lastAcceptedPoint = parsed.lastAcceptedPoint || null;

        if (points.length > 0) {
            exportSection.hidden = !hasFinished;
            startBtn.textContent = hasFinished ? "Start New" : "Resume";
            setStatus(
                hasFinished
                    ? "Previous trail finished. Start a new one when ready."
                    : "Trail data restored. Tap Resume to continue tracking."
            );
            logEvent("Restored previous session data from storage.");
        }
        updateMetrics();
    } catch (error) {
        logEvent(`Failed to restore session: ${error.message}`);
    }
    hideLog();
};

const resetTrail = () => {
    points = [];
    lastPoint = null;
    lastAcceptedPoint = null;
    totalDistance = 0;
    elevationGain = 0;
    elevationLoss = 0;
    elapsedOffset = 0;
    activeStartTime = null;
    hasFinished = false;
    exportSection.hidden = true;
    updateMetrics();
    hideLog();
    logEvent("New trail session started.");
    persistTrailState();
};


const sanitizeAltitude = (altitude) => {
    return Number.isFinite(altitude) ? altitude : null;
};

const shouldUsePoint = (point) => {
    if (!Number.isFinite(point.accuracy)) {
        return true;
    }
    if (point.accuracy > MAX_ACCURACY_METERS) {
        logEvent(
            `Skipping point: accuracy ${point.accuracy.toFixed(
                1
            )}m exceeds threshold`
        );
        return false;
    }
    return true;
};

const startTracking = () => {
    if (geoPermission === "denied") {
        setStatus("Location access is blocked. Enable it in your browser settings to start tracking.");
        alert("Location access is blocked. Please enable it in your browser or system settings.");
        logEvent("Start blocked: geolocation permission denied.");
        persistTrailState();
        return;
    }

    if (!isSecure) {
        setStatus("Enable HTTPS (or run on localhost) to use GPS features.");
        logEvent("Secure context required for geolocation.");
        return;
    }

    if (!navigator.geolocation) {
        setStatus("Geolocation is not supported by this browser.");
        return;
    }

    if (hasFinished) {
        resetTrail();
    }

    startBtn.disabled = true;
    pauseBtn.disabled = false;
    finishBtn.disabled = false;
    exportSection.hidden = true;

    if (points.length === 0) {
        elapsedOffset = 0;
    }

    activeStartTime = Date.now();
    startTimer();

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy, altitude } = position.coords;
            const point = {
                lat: latitude,
                lng: longitude,
                accuracy,
                timestamp: position.timestamp,
                altitude: sanitizeAltitude(altitude),
            };
            lastPoint = point;
            if (!shouldUsePoint(point)) {
                return;
            }

            if (!lastAcceptedPoint) {
                lastAcceptedPoint = point;
                points.push(point);
                updateMetrics();
                persistTrailState();
                return;
            }

            const displacement = haversineDistance(lastAcceptedPoint, point);

            if (displacement < MIN_DISPLACEMENT_METERS) {
                logEvent(
                    `Ignored movement ${displacement.toFixed(
                        1
                    )}m (below threshold).`
                );
                return;
            }

            if (displacement > MAX_SEGMENT_METERS) {
                logEvent(
                    `Discarded segment ${displacement.toFixed(
                        1
                    )}m (too large, likely GPS jump).`
                );
                return;
            }

            totalDistance += displacement;
            if (
                point.altitude !== null &&
                lastAcceptedPoint.altitude !== null
            ) {
                const altitudeDelta =
                    point.altitude - lastAcceptedPoint.altitude;
                if (altitudeDelta > 0) {
                    elevationGain += altitudeDelta;
                } else if (altitudeDelta < 0) {
                    elevationLoss += Math.abs(altitudeDelta);
                }
            }

            lastAcceptedPoint = point;
            points.push(point);
            updateMetrics();
            persistTrailState();
        },
        (error) => {
            setStatus(`Error: ${error.message}`);
            logEvent(`Error: ${error.message}`);
            if (error.code === error.PERMISSION_DENIED) {
                geoPermission = "denied";
                setStatus("Location access denied. Enable it in your browser settings to continue.");
            }
            persistTrailState();
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000,
        }
    );

    setStatus("Recording trail…");
    logEvent("Trail recording started.");
    startBtn.textContent = "Resume";
    persistTrailState();
};

const pauseTracking = () => {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    if (activeStartTime) {
        elapsedOffset += Date.now() - activeStartTime;
    }
    activeStartTime = null;
    stopTimer();

    startBtn.disabled = false;
    pauseBtn.disabled = true;
    setStatus("Trail paused.");
    logEvent("Trail paused.");
    persistTrailState();
};

const finishTracking = () => {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    stopTimer();

    if (activeStartTime) {
        elapsedOffset += Date.now() - activeStartTime;
    }
    activeStartTime = null;

    startBtn.disabled = false;
    pauseBtn.disabled = true;
    finishBtn.disabled = true;

    setStatus("Trail finished. Export ready.");
    logEvent("Trail finished.");

    exportSection.hidden = points.length === 0;
    hasFinished = true;
    startBtn.textContent = "Start New";
    persistTrailState();
};

const buildMapsTargets = () => {
    if (points.length === 0) {
        return null;
    }
    const origin = points[0];
    const destination = points[points.length - 1];
    const waypointSlice = points.slice(1, Math.min(points.length - 1, 8));
    const format = ({ lat, lng }) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const formattedOrigin = format(origin);
    const formattedDestination = format(destination);
    const formattedWaypoints = waypointSlice.map(format);
    const encodedWaypoints = formattedWaypoints.join("|");

    const googleRouteUrlBase = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${encodeURIComponent(
        formattedOrigin
    )}&destination=${encodeURIComponent(formattedDestination)}`;
    const googleRouteUrl = formattedWaypoints.length
        ? `${googleRouteUrlBase}&waypoints=${encodeURIComponent(encodedWaypoints)}`
        : googleRouteUrlBase;

    const googleMapsAppUrlBase = `comgooglemaps://?directionsmode=walking&saddr=${encodeURIComponent(
        formattedOrigin
    )}&daddr=${encodeURIComponent(formattedDestination)}`;
    const googleMapsAppUrl = formattedWaypoints.length
        ? `${googleMapsAppUrlBase}&waypoints=${encodeURIComponent(encodedWaypoints)}`
        : googleMapsAppUrlBase;

    const geoUri = `geo:${formattedDestination}?q=${encodeURIComponent(`Trail@${formattedDestination}`)}`;

    const appleMapsAppUrl = `maps://?saddr=${encodeURIComponent(formattedOrigin)}&daddr=${encodeURIComponent(
        formattedDestination
    )}&dirflg=w`;
    const appleMapsWebUrl = `https://maps.apple.com/?saddr=${encodeURIComponent(
        formattedOrigin
    )}&daddr=${encodeURIComponent(formattedDestination)}&dirflg=w`;

    return {
        googleRouteUrl,
        googleMapsAppUrl,
        geoUri,
        appleMapsAppUrl,
        appleMapsWebUrl,
    };
};

const buildKml = () => {
    if (points.length === 0) {
        return "";
    }

    const startDate = points[0]?.timestamp ? new Date(points[0].timestamp) : new Date();
    const name = `DaliTrail-${startDate.toISOString()}`;
    const coordinates = points
        .map(({ lng, lat, altitude }) => {
            const altValue = Number.isFinite(altitude) ? altitude : 0;
            return `${lng.toFixed(6)},${lat.toFixed(6)},${altValue.toFixed(1)}`;
        })
        .join(" ");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
    <Placemark>
      <name>${name}</name>
      <Style>
        <LineStyle>
          <color>ff2b7ff6</color>
          <width>4</width>
        </LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          ${coordinates}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
};

const encodePolyline = (pathPoints) => {
    let lastLat = 0;
    let lastLng = 0;
    let result = "";

    const encodeValue = (current, previous) => {
        let value = Math.round(current * 1e5) - Math.round(previous * 1e5);
        value <<= 1;
        if (value < 0) {
            value = ~value;
        }
        let output = "";
        while (value >= 0x20) {
            output += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
            value >>= 5;
        }
        output += String.fromCharCode(value + 63);
        return output;
    };

    for (const point of pathPoints) {
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
            continue;
        }
        result += encodeValue(point.lat, lastLat);
        result += encodeValue(point.lng, lastLng);
        lastLat = point.lat;
        lastLng = point.lng;
    }

    return result;
};

const buildTrailTargets = () => {
    const targets = buildMapsTargets();
    if (!targets) {
        return null;
    }

    const encodedPath = encodePolyline(points);
    const googleEncodedUrl = encodedPath
        ? `https://www.google.com/maps?q=enc:${encodeURIComponent(encodedPath)}&z=16`
        : targets.googleRouteUrl;
    const googleMapsPolylineUrl = encodedPath ? `comgooglemaps://?q=enc:${encodedPath}` : "";

    return {
        ...targets,
        encodedPath,
        googleEncodedUrl,
        googleMapsPolylineUrl,
    };
};

const openMapsFallback = (existingTargets) => {
    const targets = existingTargets ?? buildTrailTargets();
    if (!targets) {
        return;
    }
    let fallbackUrl = targets.googleEncodedUrl || targets.googleRouteUrl || targets.appleMapsWebUrl;
    if (isIosDevice) {
        fallbackUrl = targets.appleMapsWebUrl || targets.appleMapsAppUrl || fallbackUrl;
    }
    fallbackUrl ||= targets.geoUri;
    if (!fallbackUrl) {
        return;
    }
    window.location.href = fallbackUrl;
    logEvent("Opened trail in maps using fallback route URL.");
};

const openRouteInMaps = async () => {
    if (points.length === 0) {
        alert("You need at least one recorded point before opening in Maps.");
        return;
    }

    const targets = buildTrailTargets();
    if (!targets) {
        alert("Unable to build a maps link for this trail.");
        return;
    }

    const { googleMapsAppUrl, googleMapsPolylineUrl, appleMapsAppUrl, appleMapsWebUrl } = targets;
    const attemptedUrls = new Set();

    const openUrl = (url, logMessage) => {
        if (!url || attemptedUrls.has(url)) {
            return false;
        }
        attemptedUrls.add(url);
        window.location.href = url;
        if (logMessage) {
            logEvent(logMessage);
        }
        return true;
    };

    if (isIosDevice) {
        if (openUrl(appleMapsAppUrl, "Attempted to open trail in Apple Maps.")) {
            scheduleFallbackNavigation(() => openMapsFallback(targets));
            return;
        }
        if (openUrl(appleMapsWebUrl, "Opened trail in Apple Maps web view.")) {
            return;
        }
        if (openUrl(googleMapsPolylineUrl, "Attempted to open trail in Google Maps app.")) {
            scheduleFallbackNavigation(() => openMapsFallback(targets));
            return;
        }
        if (openUrl(googleMapsAppUrl, "Opened trail in Google Maps directions.")) {
            return;
        }
    }

    if (isAndroidDevice) {
        if (openUrl(googleMapsAppUrl, "Attempted to open trail in Google Maps app.")) {
            scheduleFallbackNavigation(() => openMapsFallback(targets));
            return;
        }
        if (openUrl(targets.googleRouteUrl, "Opened trail in Google Maps directions.")) {
            return;
        }
    }

    if (openUrl(targets.googleRouteUrl, "Opened trail in Google Maps directions.")) {
        return;
    }
    if (openUrl(googleMapsAppUrl, "Opened trail in Google Maps directions.")) {
        return;
    }
    if (openUrl(googleMapsPolylineUrl, "Opened trail in Google Maps app.")) {
        return;
    }
    openMapsFallback(targets);
};

const buildLocationTargets = (point) => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        return null;
    }
    const formatted = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
    const accuracyQuery = Number.isFinite(point.accuracy)
        ? `(+/- ${point.accuracy.toFixed(1)} m radius)`
        : null;
    const description = accuracyQuery
        ? `${formatted} ${accuracyQuery}`
        : formatted;
    const encodedDescription = encodeURIComponent(description);
    return {
        formatted,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodedDescription}`,
        geoUri: `geo:${formatted}?q=${encodedDescription}`,
        appleMapsUrl: `maps://?q=${encodedDescription}`,
    };
};

const shareCurrentLocation = () => {
    if (points.length === 0) {
        alert("No location data available yet. Start recording to capture your position.");
        return;
    }
    const latestPoint = points[points.length - 1];
    const targets = buildLocationTargets(latestPoint);
    if (!targets) {
        alert("Unable to determine your current location.");
        return;
    }
    const fallbackUrl =
        (isIosDevice && (targets.appleMapsUrl || targets.geoUri)) ||
        targets.mapsUrl ||
        targets.geoUri;
    window.location.href = fallbackUrl;
    logEvent("Opened maps app with current location.");
};

startBtn.addEventListener("click", () => {
    startTracking();
});

pauseBtn.addEventListener("click", () => {
    pauseTracking();
});

finishBtn.addEventListener("click", () => {
    const confirmFinish = window.confirm(
        "Finish recording? You will stop collecting GPS points and prepare the export."
    );
    if (confirmFinish) {
        finishTracking();
    } else {
        logEvent("Finish cancelled.");
    }
});

openMapsBtn?.addEventListener("click", openRouteInMaps);
toggleLogBtn?.addEventListener("click", toggleLogVisibility);
locationModeInputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) {
        return;
    }
    input.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        applyLocationMode(target.value);
    });
});
saveManualLocationBtn?.addEventListener("click", saveManualLocation);
captureLocationBtn?.addEventListener("click", captureCurrentLocation);
openLocationViewBtn?.addEventListener("click", () => showView("location"));
openTrackViewBtn?.addEventListener("click", () => showView("track"));
openAboutViewBtn?.addEventListener("click", () => showView("about"));
openLocationHistoryBtn?.addEventListener("click", () => {
    selectedLocationIds.clear();
    renderLocationHistory();
    showView("location-history");
});
historyViewBtn?.addEventListener("click", openSelectedLocations);
historyShareBtn?.addEventListener("click", () => {
    void shareSelectedLocations();
});
historyDeleteBtn?.addEventListener("click", deleteSelectedLocations);
backBtn?.addEventListener("click", () => {
    const current = appRoot?.dataset.view;
    if (current === "location-history") {
        showView("location");
    } else {
        showView("home");
    }
});
installBtn?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
        logEvent("Install prompt unavailable.");
        if (installStatusText) {
            installStatusText.textContent =
                "Install option is not available right now. Try again later.";
        }
        return;
    }
    installBtn.disabled = true;
    if (installStatusText) {
        installStatusText.textContent = "Displaying install prompt...";
    }
    let fallbackTimer = null;
    const scheduleFallbackNotice = () => {
        if (!installStatusText) {
            return;
        }
        fallbackTimer = window.setTimeout(() => {
            installBtn.disabled = false;
            installStatusText.textContent =
                "Install prompt might be blocked. Use Chrome's menu → Install DaliTrail.";
        }, 5000);
    };
    try {
        scheduleFallbackNotice();
        await deferredInstallPrompt.prompt();
        const choicePromise = deferredInstallPrompt.userChoice;
        if (!choicePromise) {
            installBtn.disabled = false;
            if (installStatusText) {
                installStatusText.textContent =
                    "Install prompt may not be supported here. Try Chrome's menu → Install DaliTrail.";
            }
            return;
        }
        const { outcome } = await choicePromise;
        if (fallbackTimer) {
            window.clearTimeout(fallbackTimer);
            fallbackTimer = null;
        }
        logEvent(`Install prompt outcome: ${outcome}.`);
        if (outcome === "accepted") {
            installSection.hidden = true;
        } else {
            installBtn.disabled = false;
            if (installStatusText) {
                installStatusText.textContent =
                    "Install was cancelled. You can try again anytime.";
            }
        }
    } catch (error) {
        logEvent(`Install prompt failed: ${error instanceof Error ? error.message : String(error)}`);
        installBtn.disabled = false;
        if (installStatusText) {
            installStatusText.textContent =
                "Unable to open install prompt. Please try again.";
        }
    } finally {
        if (fallbackTimer) {
            window.clearTimeout(fallbackTimer);
        }
        deferredInstallPrompt = null;
    }
});

updateMetrics();
restoreTrailState();
if (points.length === 0 && !hasFinished) {
    setStatus("Ready when you are.");
}
if (!isSecure) {
    setStatus("Open this app via HTTPS (or localhost) to enable location tracking.");
    logEvent("Waiting for secure context to access geolocation.");
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden && watchId !== null) {
        pauseTracking();
        logEvent("App hidden; trail paused to conserve battery.");
    }
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/service-worker.js")
            .then((registration) => {
                swRegistration = registration;
                installSection?.removeAttribute("hidden");
                if (installStatusText) {
                    installStatusText.textContent =
                        "Install option will appear when available.";
                }
                updateSection?.removeAttribute("hidden");
                if (updateBtn) {
                    updateBtn.disabled = false;
                    updateBtn.textContent = "Check for Updates";
                }
                logEvent("Service worker registered. Update checks enabled.");
            })
            .catch((error) =>
                logEvent(`Service worker registration failed: ${error.message}`)
            );
    });
}

updateBtn?.addEventListener("click", async () => {
    if (!updateBtn) {
        return;
    }
    const originalText = updateBtn.textContent || "Check for Updates";
    updateBtn.disabled = true;
    updateBtn.textContent = "Checking...";
    try {
        if (swRegistration?.update) {
            await swRegistration.update();
            logEvent("Checking for new updates...");
        }
        logEvent("Reloading app to apply the latest version.");
        window.location.reload();
    } catch (error) {
        logEvent(`Update check failed: ${error.message}`);
        updateBtn.disabled = false;
        updateBtn.textContent = originalText;
    }
});

const updatePermissionBanner = () => {
    if (geoPermission === "denied") {
        setStatus("Location access denied. Enable it in your browser settings to continue.");
        logEvent("Geolocation permission denied. Prompting user to enable it.");
    }
};

if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
            geoPermission = status.state;
            updatePermissionBanner();
            status.onchange = () => {
                geoPermission = status.state;
                updatePermissionBanner();
            };
        })
        .catch(() => {
            // Permissions API unsupported or unavailable; rely on error callbacks.
        });
}

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installSection?.removeAttribute("hidden");
    if (installBtn) {
        installBtn.disabled = false;
    }
    if (installStatusText) {
        installStatusText.textContent =
            "Ready to install DaliTrail on this device.";
    }
    logEvent("Install prompt ready. Tap Install App to add to home screen.");
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installSection) {
        installSection.hidden = true;
    }
    if (installStatusText) {
        installStatusText.textContent = "DaliTrail is already installed on this device.";
    }
    logEvent("App installed on device.");
});

locationsList?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
        return;
    }
    const id = target.value;
    if (!id) {
        return;
    }
    if (target.checked) {
        selectedLocationIds.add(id);
    } else {
        selectedLocationIds.delete(id);
    }
    updateHistoryActions();
});

latestLocationCard?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }
    const button = target.closest("button[data-action]");
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }
    const id = latestLocationCard.dataset.id;
    const entry = savedLocations.find((item) => item.id === id);
    if (!entry) {
        return;
    }
    if (button.dataset.action === "view") {
        openLocationMap(entry);
    } else if (button.dataset.action === "share") {
        void shareLocationEntry(entry);
    }
});

loadSavedLocations();
renderLatestLocation();
renderLocationHistory();
applyLocationMode(locationMode);
const loadInitialView = () => {
    if (typeof localStorage === "undefined") {
        return appRoot?.dataset.view || "home";
    }
    try {
        const stored = localStorage.getItem(LAST_VIEW_KEY);
        if (stored && stored in VIEWS) {
            return stored;
        }
    } catch {
        // Ignore storage read issues and fall back to default.
    }
    return appRoot?.dataset.view || "home";
};
showView(loadInitialView());
