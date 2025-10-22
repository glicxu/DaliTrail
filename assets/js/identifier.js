// /assets/js/identifier.js
// Handles the "Identify" view for real-time image classification using the device camera.

const identifyView = document.querySelector('.identify-view[data-view="identify"]');
const videoElement = document.getElementById("camera-feed");
const canvasElement = document.getElementById("camera-canvas");
const statusText = document.getElementById("identify-status");
const resultsList = document.getElementById("identify-results-list");
const saveIdentificationBtn = document.getElementById("save-identification-btn");

const MODEL_PATH = "/assets/models/plant_classifier/plants_V1.tflite"; // Canonical path

let classifier = null;
let animationFrameId = null;
let isViewActive = false;
let latestTopResult = null;

const logIdentifierEvent = (message, data = {}) => {
  window.dispatchEvent(
    new CustomEvent("dalitrail:log", { detail: { event: "identifier", data: { message, ...data } } })
  );
};

/**
 * Sets the status message displayed in the UI.
 * @param {string} message The message to display.
 * @param {{isError?: boolean}} options
 */
const setStatus = (message, { isError = false } = {}) => {
  if (!statusText) return;
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
  logIdentifierEvent(message);
};

/**
 * Renders the classification results in the UI.
 * @param {Array<{className: string, score: number}>} results
 */
const renderResults = (results) => {
  if (!resultsList) return;
  resultsList.innerHTML = "";

  if (!results || results.length === 0) {
    latestTopResult = null;
    resultsList.hidden = true;
    if (saveIdentificationBtn) saveIdentificationBtn.disabled = true;
    return;
  }

  resultsList.hidden = false;
  latestTopResult = results[0];
  if (saveIdentificationBtn) saveIdentificationBtn.disabled = false;
  const fragment = document.createDocumentFragment();
  results.slice(0, 3).forEach((result) => {
    const li = document.createElement("li");
    const percentage = (result.score * 100).toFixed(1);
    li.innerHTML = `
      <span class="prediction-name">${result.className}</span>
      <span class="prediction-score">${percentage}%</span>
    `;
    fragment.appendChild(li);
  });
  resultsList.appendChild(fragment);
};

/**
 * The main classification loop that runs on each animation frame.
 */
const classificationLoop = async () => {
  if (!isViewActive || !classifier) return;

  try {
    const results = await classifier.classify(videoElement);
    renderResults(results);
  } catch (error) {
    console.error("Classification error:", error);
    // Don't spam the UI with errors, just log them.
  }

  animationFrameId = requestAnimationFrame(classificationLoop);
};

/**
 * Waits for the TFLite Task library to be loaded and attached to the window.
 * @returns {Promise<void>} A promise that resolves when `window.tflite` is available.
 */
const waitForTFLite = () => {
  return new Promise((resolve, reject) => {
    if (window.tflite) {
      return resolve();
    }
    // Poll every 100ms for the tflite global
    const interval = setInterval(() => {
      if (window.tflite) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 100);

    // Fail after 10 seconds if the library doesn't load
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("TFLite library failed to load in time. Check network or script tags."));
    }, 10000);
  });
};

/**
 * Initializes the TFLite model classifier.
 */
const initializeClassifier = async () => {
  if (classifier) return;

  try {
    setStatus("Waiting for TFLite library...");
    await waitForTFLite();

    setStatus("Loading classification model...");
    // Use the high-level Tasks API for simplicity
    classifier = await tflite.ImageClassifier.create(MODEL_PATH);
    setStatus("Model loaded. Point camera at a plant.");
    logIdentifierEvent("Classifier initialized successfully from " + MODEL_PATH);
    // Start the loop once the model is ready
    classificationLoop();
  } catch (error) {
    console.error("Failed to load TFLite model:", error);
    setStatus(`Error: Could not load model. ${error.message}`, { isError: true });
  }
};

/**
 * Starts the camera stream and the classification process.
 */
const startCamera = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Camera access is not supported by your browser.", { isError: true });
    return;
  }

  try {
    setStatus("Requesting camera access...");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, // Prefer the rear camera
    });

    videoElement.srcObject = stream;
    videoElement.addEventListener("loadeddata", () => {
      // Once the video is playing, we can initialize the classifier
      initializeClassifier();
    });
  } catch (error) {
    console.error("Failed to get camera stream:", error);
    if (error.name === "NotAllowedError") {
      setStatus("Camera access was denied. Please grant permission to use this feature.", { isError: true });
    } else {
      setStatus(`Error: Could not access camera. ${error.message}`, { isError: true });
    }
  }
};

/**
 * Stops the camera stream and the classification loop.
 */
const stopCamera = () => {
  if (videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach((track) => track.stop());
    videoElement.srcObject = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  logIdentifierEvent("Camera and classifier stopped.");
};

/**
 * Called from main.js when the "Identify" view is shown.
 */
export const start = () => {
  if (!identifyView) return;
  isViewActive = true;
  logIdentifierEvent("Starting identifier view.");
  startCamera();
};

/**
 * Called from main.js when the "Identify" view is hidden.
 */
export const stop = () => {
  isViewActive = false;
  stopCamera();
  renderResults([]); // Clear previous results
  setStatus("Initializing camera..."); // Reset status for next time
};

/**
 * Initializes the module.
 */
export const init = () => {
  if (!identifyView) {
    console.warn("Identifier view not found in DOM.");
    return;
  }
  logIdentifierEvent("Identifier module initialized.");

  saveIdentificationBtn?.addEventListener("click", () => {
    if (!latestTopResult) return;

    // Dispatch an event for main.js to handle the saving logic.
    // This keeps the identifier module decoupled from location logic.
    window.dispatchEvent(
      new CustomEvent("dalitrail:save-identification", { detail: { result: latestTopResult } })
    );
  });
};