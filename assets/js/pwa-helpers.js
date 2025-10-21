// /assets/js/pwa-helpers.js
export function createPwaHelpers({ state, installHintText, installStatusText, isIosDevice, isAndroidDevice, isWindowsDevice }) {

  function getManualInstallInstructions() {
    if (isIosDevice) return "On iOS Safari: tap the share icon, then “Add to Home Screen”.";
    if (isAndroidDevice) return "In Chrome: open the menu (⋮) and choose “Install app”.";
    if (isWindowsDevice) return "In Edge/Chrome: open the menu and choose “Install app”.";
    return "Use your browser’s menu to install or add this app to your home screen.";
  }

  function updateInstallHint() {
    if (!installHintText) return;
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    if (isStandalone) {
      installHintText.textContent = "App is installed.";
      return;
    }
    if (state.deferredInstallPrompt) {
      installHintText.textContent = "Click “Install” to add DaliTrail to your device.";
      return;
    }
    installHintText.textContent = getManualInstallInstructions();
  }

  async function promptInstall() {
    const { deferredInstallPrompt } = state;
    if (!deferredInstallPrompt) {
      if (installStatusText) installStatusText.textContent = getManualInstallInstructions();
      return;
    }
    clearInstallPromptWait();
    try {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (installStatusText) {
        installStatusText.textContent =
          outcome === "accepted" ? "Thanks! Installing DaliTrail…" : getManualInstallInstructions();
      }
    } catch (err) {
      console.warn("Install prompt failed:", err);
      if (installStatusText) installStatusText.textContent = getManualInstallInstructions();
    } finally {
      state.deferredInstallPrompt = null; // prompt is one-shot
      updateInstallHint();
    }
  }

  function clearInstallPromptWait() {
    if (state.installPromptWaitTimeoutId) {
      window.clearTimeout(state.installPromptWaitTimeoutId);
      state.installPromptWaitTimeoutId = null;
    }
  }

  function setStatus(message) {
    const el = document.getElementById("status-text");
    if (el) el.textContent = message || "";
  }

  function updatePermissionBanner(permState) {
    const readable =
      permState === "granted"
        ? "Location access granted."
        : permState === "denied"
        ? "Location access denied. Enable it in browser settings."
        : "Location access not yet granted.";
    setStatus(readable);
  }

  return {
    getManualInstallInstructions,
    updateInstallHint,
    promptInstall,
    clearInstallPromptWait,
    setStatus,
    updatePermissionBanner,
  };
}
