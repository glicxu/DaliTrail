const statusText = document.getElementById("status-text");
const pointsCountText = document.getElementById("points-count");
const distanceText = document.getElementById("distance");
const elapsedText = document.getElementById("elapsed");
const elevationGainText = document.getElementById("elevation-gain");
const elevationLossText = document.getElementById("elevation-loss");
const logList = document.getElementById("log");
const exportSection = document.querySelector(".export");
const downloadBtn = document.getElementById("download-kml-btn");

const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const finishBtn = document.getElementById("finish-btn");

let watchId = null;
let activeStartTime = null;
let elapsedOffset = 0;
let timerId = null;
let points = [];
let lastPoint = null;
let totalDistance = 0;
let hasFinished = false;
let elevationGain = 0;
let elevationLoss = 0;
const isSecure =
    window.isSecureContext || window.location.hostname === "localhost";

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

const resetTrail = () => {
    points = [];
    lastPoint = null;
    totalDistance = 0;
    elevationGain = 0;
    elevationLoss = 0;
    elapsedOffset = 0;
    activeStartTime = null;
    hasFinished = false;
    exportSection.hidden = true;
    updateMetrics();
    logEvent("New trail session started.");
};

const startTracking = () => {
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
                altitude: Number.isFinite(altitude) ? altitude : 0,
            };
            if (lastPoint) {
                totalDistance += haversineDistance(lastPoint, point);
                const altitudeDelta = point.altitude - lastPoint.altitude;
                if (altitudeDelta > 0) {
                    elevationGain += altitudeDelta;
                } else if (altitudeDelta < 0) {
                    elevationLoss += Math.abs(altitudeDelta);
                }
            }
            lastPoint = point;
            points.push(point);
            updateMetrics();
        },
        (error) => {
            setStatus(`Error: ${error.message}`);
            logEvent(`Error: ${error.message}`);
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
};

const buildKml = () => {
    if (points.length === 0) {
        return "";
    }

    const name = `DaliTrail-${new Date(points[0].timestamp).toISOString()}`;
    const coordinates = points
        .map(({ lng, lat, altitude }) => `${lng.toFixed(6)},${lat.toFixed(6)},${altitude.toFixed(1)}`)
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

setStatus("Ready when you are.");
updateMetrics();
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
