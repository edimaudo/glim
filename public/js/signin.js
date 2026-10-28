(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("signin-form");
    if (!form) return;
    const nameInput = document.getElementById("display-name");
    const emailInput = document.getElementById("email");
    const message = document.getElementById("signin-error");
    const continueButton = form.querySelector('button[type="submit"]');
    const sessionFailureMessage = "We couldn’t open Glim right now. Please try again in a moment.";

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
        // Prepare/repair browser storage before starting the signed session.
        // Any low-level browser exception is logged for diagnostics but never shown here.
        await window.GlimStorage.getState(email, { name, email });
        await window.GlimClient.createSession(name, email);
        window.location.href = "/app";
      } catch (error) {
        console.error("Glim sign-in could not initialize the session", error);
        message.textContent = sessionFailureMessage;
        message.className = "form-message is-error";
      } finally {
        continueButton.disabled = false;
        continueButton.textContent = priorLabel;
      }
    });
  });
})();
