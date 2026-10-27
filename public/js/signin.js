(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("signin-form");
    if (!form) return;
    const nameInput = document.getElementById("display-name");
    const emailInput = document.getElementById("email");
    const message = document.getElementById("signin-error");
    const continueButton = form.querySelector('button[type="submit"]');

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
        const result = await window.GlimAPI.createSession(name, email);
        await window.GlimStorage.getState(email, result.profile);
        window.location.href = "/app.html";
      } catch (error) {
        message.textContent = `Could not start a demo session: ${error.message}`;
        message.className = "form-message is-error";
      } finally {
        continueButton.disabled = false;
        continueButton.textContent = priorLabel;
      }
    });
  });
})();
