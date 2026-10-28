(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("signin-form");
    if (!form) return;
    const nameInput = document.getElementById("display-name");
    const emailInput = document.getElementById("email");
    const message = document.getElementById("signin-error");
    const continueButton = form.querySelector('button[type="submit"]');
    const sessionSetupMessage = "Demo sign-in is temporarily unavailable because this deployment is not configured. The site owner needs to add GLIM_SESSION_SECRET in Vercel Project Settings → Environment Variables and redeploy.";
    let sessionAvailable = null;

    async function checkSessionConfiguration() {
      try {
        const status = await window.GlimClient.sessionStatus();
        sessionAvailable = Boolean(status.available);
        if (!sessionAvailable) {
          continueButton.disabled = true;
          continueButton.title = "Demo sign-in is not configured";
          message.textContent = sessionSetupMessage;
          message.className = "form-message is-error";
        }
      } catch (_) {
        // Leave the form usable if the status check itself fails. The create-session
        // request will surface a clearer message if the backend is unavailable.
      }
    }

    checkSessionConfiguration();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "";
      const name = nameInput.value.trim();
      const email = emailInput.value.trim().toLowerCase();
      if (name.length < 1 || !emailInput.validity.valid) {
        message.textContent = "Enter a name and a valid email address.";
        message.className = "form-message is-error";
        return;
      }
      const priorLabel = continueButton.textContent;
      continueButton.disabled = true;
      continueButton.textContent = "Opening Glim…";
      try {
        const result = await window.GlimClient.createSession(name, email);
        await window.GlimStorage.getState(email, result.profile);
        window.location.href = "/app";
      } catch (error) {
        const detail = String(error.message || "");
        message.textContent = /GLIM_SESSION_SECRET|not configured on this deployment/i.test(detail)
          ? sessionSetupMessage
          : `Could not start a demo session. ${detail}`;
        message.className = "form-message is-error";
      } finally {
        continueButton.disabled = sessionAvailable === false;
        continueButton.textContent = priorLabel;
      }
    });
  });
})();
