const statusText = document.getElementById("status-text");
const pointsCountText = document.getElementById("points-count");
const distanceText = document.getElementById("distance");
const elapsedText = document.getElementById("elapsed");
const elevationGainText = document.getElementById("elevation-gain");
const elevationLossText = document.getElementById("elevation-loss");
const logList = document.getElementById("log");
const exportSection = document.querySelector(".export");
const downloadBtn = document.getElementById("download-kml-btn");
const openMapsBtn = document.getElementById("open-maps-btn");

const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const finishBtn = document.getElementById("finish-btn");

const STORAGE_KEY = "dalitrail:session";

const installSection = document.querySelector(".install");
const installBtn = document.getElementById("install-btn");

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

const MAX_SEGMENT_METERS = 150; // Ignore improbable jumps
const MAX_ACCURACY_METERS = 25; // Skip low-accuracy fixes
const MIN_DISPLACEMENT_METERS = 6; // Require meaningful movement
let deferredInstallPrompt = null;

const logEvent = (message) => {
    const item = document.createElement("li");
    const timestamp = new Date().toLocaleTimeString();
    item.textContent = `[${timestamp}] ${message}`;
    logList.prepend(item);
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

const buildKml = () => {
    if (points.length === 0) {
        return "";
    }

    const name = `DaliTrail-${new Date(points[0].timestamp).toISOString()}`;
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

const downloadKml = () => {
    const kmlContent = buildKml();
    if (!kmlContent) {
        return;
    }
    const blob = new Blob([kmlContent], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dali-trail-${new Date().toISOString()}.kml`;
    anchor.click();
    URL.revokeObjectURL(url);
    logEvent("KML file downloaded.");
    persistTrailState();
};

const openMapsFallback = () => {
    if (points.length === 0) {
        return;
    }
    const origin = points[0];
    const destination = points[points.length - 1];
    const waypointSlice = points.slice(1, Math.min(points.length - 1, 8));
    const format = ({ lat, lng }) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

    if (points.length > 1) {
        const waypoints = waypointSlice.map(format).join("|");
        let mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(format(origin))}&destination=${encodeURIComponent(format(destination))}`;
        if (waypoints) {
            mapsUrl += `&waypoints=${encodeURIComponent(waypoints)}`;
        }
        window.open(mapsUrl, "_blank", "noopener");
    } else {
        const geoUri = `geo:${format(destination)}?q=${encodeURIComponent(`Trail@${format(destination)}`)}`;
        window.open(geoUri, "_blank", "noopener");
    }
    logEvent("Opened route in maps via URL fallback.");
};

const shareKmlToMaps = async () => {
    const kmlContent = buildKml();
    if (!kmlContent) {
        return;
    }

    const supportsShare = typeof navigator !== "undefined" && "share" in navigator;
    if (!supportsShare) {
        openMapsFallback();
        return;
    }

    const filename = `dali-trail-${new Date().toISOString()}.kml`;
    const blob = new Blob([kmlContent], { type: "application/vnd.google-earth.kml+xml" });
    const file = new File([blob], filename, { type: blob.type });
    const shareData = {
        files: [file],
        title: "DaliTrail Route",
        text: "Trail recorded with DaliTrail.",
    };

    if (navigator.canShare && !navigator.canShare(shareData)) {
        logEvent("Device cannot share KML file; using maps fallback.");
        openMapsFallback();
        return;
    }

    try {
        if (openMapsBtn) {
            openMapsBtn.disabled = true;
        }
        await navigator.share(shareData);
        logEvent("Shared trail with a maps app.");
    } catch (error) {
        if (error.name !== "AbortError") {
            logEvent(`Sharing failed: ${error.message}`);
            alert("Sharing failed. Trying to open in your maps app instead.");
            openMapsFallback();
        } else {
            logEvent("Sharing cancelled by user.");
        }
    } finally {
        if (openMapsBtn) {
            openMapsBtn.disabled = false;
        }
    }
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

downloadBtn.addEventListener("click", downloadKml);
openMapsBtn?.addEventListener("click", shareKmlToMaps);
installBtn?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
        logEvent("Install prompt unavailable.");
        alert("Install option is not available right now. Try again later.");
        return;
    }
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    logEvent(`Install prompt outcome: ${outcome}.`);
    deferredInstallPrompt = null;
    installSection.hidden = true;
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
            .then(() => logEvent("Service worker registered. App ready for install."))
            .catch((error) =>
                logEvent(`Service worker registration failed: ${error.message}`)
            );
    });
}

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
    if (installSection) {
        installSection.hidden = false;
    }
    logEvent("Install prompt ready. Tap Install App to add to home screen.");
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installSection) {
        installSection.hidden = true;
    }
    logEvent("App installed on device.");
});
