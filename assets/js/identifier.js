// /assets/js/identifier.js
// Handles the "Identify" view for real-time image classification using the device camera.

import { FilesetResolver, ImageClassifier } from "/vendor/tasks.min.js";

const identifyView = document.querySelector('.identify-view[data-view="identify"]');
const videoElement = document.getElementById("camera-feed");
const canvasElement = document.getElementById("camera-canvas");
const statusText = document.getElementById("identify-status");
const resultsList = document.getElementById("identify-results-list");
const saveIdentificationBtn = document.getElementById("save-identification-btn");

const MODEL_PATH = "/assets/models/plants_V1.tflite";
const CONFIDENCE_THRESHOLD = 0.50; // Only show results with at least 50% confidence

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
    return;
  }

  // Do not render results if confidence is too low
  if (results[0].score < CONFIDENCE_THRESHOLD) {
    latestTopResult = null;
    resultsList.hidden = true;
    return;
  }

  // Prevent flickering by only re-rendering if the top result has changed.
  if (latestTopResult && results[0].className === latestTopResult.className) {
    return;
  }

  resultsList.innerHTML = "";
  resultsList.hidden = false;
  latestTopResult = results[0];
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
  if (!isViewActive || !classifier || !videoElement.srcObject) return;

  try {
    // The new API uses a callback for streaming results.
    // We will get the latest result from the classifier.
    const startTimeMs = performance.now();
    const classificationResult = classifier.classifyForVideo(videoElement, startTimeMs);

    if (classificationResult && classificationResult.classifications.length > 0) {
      // The new API returns a different structure.
      const apiResults = classificationResult.classifications[0].categories.map(c => ({
        className: c.displayName,
        score: c.score
      }));
      renderResults(apiResults);
    }
  } catch (error) {
    console.error("Classification error:", error);
    // Don't spam the UI with errors, just log them.
  }

  animationFrameId = requestAnimationFrame(classificationLoop);
};

/**
 * Initializes the MediaPipe Tasks Vision model classifier.
 */
const initializeClassifier = async () => {
  if (classifier) return;

  try {
    setStatus("Creating vision task fileset...");
    // Use FilesetResolver to find the Wasm assets.
    const vision = await FilesetResolver.forVisionTasks(
      // path to the wasm files
      "/assets/js/vendor/"
    );

    // Create the classifier with the new API
    classifier = await ImageClassifier.createFromOptions(
      vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
      },
      runningMode: "VIDEO",
      maxResults: 5,
    }
    );
    setStatus("Model loaded. Point camera at a plant.");
    logIdentifierEvent(`Classifier initialized successfully from ${MODEL_PATH}`);
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