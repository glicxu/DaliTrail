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
const shareLocationBtn = document.getElementById("share-location-btn");
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
const isIosDevice =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent || "");
const isAndroidDevice =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "");

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

const updateShareButtonState = () => {
    if (!shareLocationBtn) {
        return;
    }
    shareLocationBtn.disabled = points.length === 0;
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
    updateShareButtonState();
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
    updateShareButtonState();
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
    return {
        formatted,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatted)}`,
        geoUri: `geo:${formatted}?q=${encodeURIComponent(formatted)}`,
        appleMapsUrl: `maps://?q=${encodeURIComponent(formatted)}`,
    };
};

const shareCurrentLocation = async () => {
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

    const shareMessage = `I'm currently at ${targets.formatted} — tracked with DaliTrail.`;
    const shareData = {
        title: "My current location",
        text: shareMessage,
        url: targets.mapsUrl,
    };

    try {
        if (shareLocationBtn) {
            shareLocationBtn.disabled = true;
        }
        if (navigator.share) {
            await navigator.share(shareData);
            logEvent("Shared current location.");
        } else {
            const fallbackUrl =
                (isIosDevice && (targets.appleMapsUrl || targets.geoUri)) ||
                targets.mapsUrl ||
                targets.geoUri;
            window.location.href = fallbackUrl;
            logEvent("Opened maps app with current location.");
        }
    } catch (error) {
        if (error.name === "AbortError") {
            logEvent("Location share cancelled by user.");
        } else {
            logEvent(`Location share failed: ${error.message}`);
            alert("Sharing failed. You can manually share the location from the log.");
        }
    } finally {
        updateShareButtonState();
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

shareLocationBtn?.addEventListener("click", shareCurrentLocation);
openMapsBtn?.addEventListener("click", openRouteInMaps);
toggleLogBtn?.addEventListener("click", toggleLogVisibility);
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
