(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("signin-form");
    if (!form) return;
    const nameInput = document.getElementById("display-name");
    const emailInput = document.getElementById("email");
    const message = document.getElementById("signin-error");

    const existing = localStorage.getItem("glimDemoUser");
    if (existing) {
      try {
        const profile = JSON.parse(existing);
        if (profile.name) nameInput.value = profile.name;
        if (profile.email) emailInput.value = profile.email;
      } catch (_) { localStorage.removeItem("glimDemoUser"); }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "";
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      if (name.length < 1 || !emailInput.validity.valid) {
        message.textContent = "Enter a name and a valid email address.";
        message.className = "form-message is-error";
        return;
      }
      const profile = { name, email };
      localStorage.setItem("glimDemoUser", JSON.stringify(profile));
      try {
        if (window.GlimAPI) {
          const result = await window.GlimAPI.getState();
          result.state.profile = { ...(result.state.profile || {}), name, email };
          await window.GlimAPI.saveState(result.state);
        }
        window.location.href = "/app.html";
      } catch (error) {
        message.textContent = `Could not load the demo: ${error.message}`;
        message.className = "form-message is-error";
      }
    });
  });
})();
