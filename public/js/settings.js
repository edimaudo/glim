(function () {
  const SCALE = { small: 0.9, medium: 1, large: 1.125 };
  const LABELS = { light: "Switch to dark mode", dark: "Switch to light mode" };

  function applyTheme(theme) {
    const chosen = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", chosen);
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.setAttribute("aria-label", LABELS[chosen]);
      toggle.setAttribute("title", LABELS[chosen]);
      toggle.innerHTML = chosen === "dark" ? '<span aria-hidden="true">☀</span>' : '<span aria-hidden="true">☾</span>';
    }
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const active = button.dataset.themeChoice === chosen;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function applyFontSize(size) {
    const chosen = SCALE[size] ? size : "medium";
    document.documentElement.style.setProperty("--font-scale", String(SCALE[chosen]));
    document.querySelectorAll("[data-font-size]").forEach((button) => {
      const active = button.dataset.fontSize === chosen;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function applyPreferences(prefs = {}) {
    applyTheme(prefs.theme || "light");
    applyFontSize(prefs.fontSize || "medium");
    const frequency = document.getElementById("reminder-frequency");
    const tone = document.getElementById("coach-tone");
    const mode = document.getElementById("coach-mode");
    if (frequency) frequency.value = prefs.reminderFrequency || "weekly";
    if (tone) tone.value = prefs.coachTone || "balanced";
    if (mode) mode.value = prefs.coachMode || "coach";
    const notifications = document.getElementById("notification-status");
    if (notifications && prefs.browserNotifications) notifications.textContent = "Browser notifications are enabled when Glim is open.";
    else if (notifications) notifications.textContent = "Browser notifications are optional; in-app reminders work when Glim is open.";
  }

  async function savePreferences(message = "Preferences saved.") {
    if (!window.GlimApp || !window.GlimApp.state) return;
    const state = window.GlimApp.state;
    state.prefs = {
      ...(state.prefs || {}),
      theme: document.documentElement.dataset.theme || "light",
      fontSize: [...document.querySelectorAll("[data-font-size]")].find((b) => b.classList.contains("is-selected"))?.dataset.fontSize || state.prefs?.fontSize || "medium",
      reminderFrequency: document.getElementById("reminder-frequency")?.value || "weekly",
      coachTone: document.getElementById("coach-tone")?.value || "balanced",
      coachMode: document.getElementById("coach-mode")?.value || "coach",
      browserNotifications: Boolean(state.prefs?.browserNotifications),
    };
    try {
      await window.GlimApp.saveState();
      const output = document.getElementById("settings-message");
      if (output) { output.textContent = message; output.className = "form-message is-success"; }
      return true;
    } catch (error) {
      const output = document.getElementById("settings-message");
      console.error("Glim preferences save failed", error);
      if (output) { output.textContent = "Your preferences could not be saved. Please try again."; output.className = "form-message is-error"; }
      return false;
    }
  }

  async function chooseTheme(theme) {
    applyTheme(theme);
    if (window.GlimApp && window.GlimApp.state) {
      window.GlimApp.state.prefs = { ...(window.GlimApp.state.prefs || {}), theme };
      try { await window.GlimApp.saveState(); } catch (error) { console.error("Glim theme preference save failed", error); window.GlimApp.toast("Your theme preference could not be saved."); }
    }
  }

  async function chooseFontSize(size) {
    applyFontSize(size);
    if (window.GlimApp && window.GlimApp.state) {
      window.GlimApp.state.prefs = { ...(window.GlimApp.state.prefs || {}), fontSize: size };
      try { await window.GlimApp.saveState(); } catch (error) { console.error("Glim text size preference save failed", error); window.GlimApp.toast("Your text size preference could not be saved."); }
    }
  }

  function init() {
    document.getElementById("theme-toggle")?.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      chooseTheme(next);
    });
    document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => chooseTheme(button.dataset.themeChoice)));
    document.querySelectorAll("[data-font-size]").forEach((button) => button.addEventListener("click", () => chooseFontSize(button.dataset.fontSize)));
    document.getElementById("save-preferences")?.addEventListener("click", () => savePreferences());
    document.getElementById("export-profile-data")?.addEventListener("click", () => {
      const output = document.getElementById("reset-message");
      try {
        const state = window.GlimApp?.state;
        if (!state?.profile?.email) throw new Error("Your profile is not available. Please sign in again.");
        const backup = {
          product: "Glim",
          format_version: 1,
          exported_at: new Date().toISOString(),
          storage: "this browser",
          notice: "Contains your saved financial information. Keep this backup private; it is not encrypted.",
          state,
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `glim-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        if (output) { output.textContent = "Data backup downloaded. The JSON file is not encrypted; store it somewhere private."; output.className = "form-message is-success"; }
      } catch (error) {
        if (output) { console.error("Glim profile export failed", error); output.textContent = "Your data backup could not be prepared. Please try again."; output.className = "form-message is-error"; }
      }
    });
    document.getElementById("reset-profile-data")?.addEventListener("click", async () => {
      const output = document.getElementById("reset-message");
      const confirmed = window.confirm("Reset all Glim information saved for this profile in this browser? This removes tracked debts, savings goals, repayment history, product comparisons, learning progress, settings, and reward history. Download a backup first if you need it.");
      if (!confirmed) {
        if (output) { output.textContent = "Reset cancelled. No saved data was changed."; output.className = "form-message"; }
        return;
      }
      if (output) { output.textContent = "Resetting…"; output.className = "form-message"; }
      try {
        const profile = window.GlimApp?.state?.profile;
        if (!profile?.email) throw new Error("Your session is no longer available. Please sign in again.");
        const state = await window.GlimStorage.resetState(profile.email, profile);
        window.GlimApp.setState(state);
        applyPreferences(state.prefs);
        window.GlimApp.renderAll();
        if (output) { output.textContent = "Your profile has been reset."; output.className = "form-message is-success"; }
        window.GlimApp.toast("Your browser profile has been reset.");
      } catch (error) {
        console.error("Glim profile reset failed", error);
        if (output) { output.textContent = "Your profile could not be reset. Please try again."; output.className = "form-message is-error"; }
      }
    });
  }

  window.GlimSettings = { init, applyPreferences, applyTheme, applyFontSize, savePreferences };
})();
