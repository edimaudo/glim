(function () {
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  const app = {
    state: null,
    saveQueue: Promise.resolve(),
    async saveState() {
      if (!this.state) return;
      const snapshot = JSON.parse(JSON.stringify(this.state));
      this.saveQueue = this.saveQueue.catch(() => {}).then(() => window.GlimAPI.saveState(snapshot));
      return this.saveQueue;
    },
    setState(state) {
      this.state = state;
      if (window.GlimSettings) window.GlimSettings.applyPreferences(state.prefs || {});
      const name = state.profile?.name || "Glim member";
      if ($("user-name")) $("user-name").textContent = name;
      if ($("user-initials")) $("user-initials").textContent = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      this.renderAll();
    },
    toast(message) {
      const region = $("toast-region");
      if (!region) return;
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", "status");
      toast.textContent = message;
      region.append(toast);
      window.setTimeout(() => toast.remove(), 4300);
    },
    navigate(view) {
      const validViews = ["overview", "debt", "savings", "literacy", "settings"];
      if (!validViews.includes(view)) return;
      document.querySelectorAll("[data-view-panel]").forEach((panel) => {
        const active = panel.dataset.viewPanel === view;
        panel.hidden = !active;
        panel.classList.toggle("is-visible", active);
      });
      document.querySelectorAll(".app-nav [data-view]").forEach((button) => {
        const active = button.dataset.view === view;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-current", active ? "page" : "false");
      });
      const labels = { overview: "Overview", debt: "Debt management", savings: "Savings", literacy: "Financial literacy", settings: "Settings" };
      if ($("breadcrumb-current")) $("breadcrumb-current").textContent = labels[view];
      $("sidebar")?.classList.remove("is-open");
      $("mobile-menu-button")?.setAttribute("aria-expanded", "false");
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    },
    renderOverview(plan) {
      if (!this.state) return;
      const debts = this.state.debts || [];
      const goals = this.state.savingsGoals || [];
      const totalDebt = debts.reduce((sum, debt) => sum + Math.max(0, Number(debt.balance) || 0), 0);
      const totalSaved = goals.reduce((sum, goal) => sum + Math.max(0, Number(goal.current) || 0), 0);
      if ($("overview-total-debt")) $("overview-total-debt").textContent = money(totalDebt);
      if ($("overview-debt-note")) $("overview-debt-note").textContent = `Across ${debts.length} ${debts.length === 1 ? "account" : "accounts"}`;
      if ($("overview-savings-total")) $("overview-savings-total").textContent = money(totalSaved);
      if ($("overview-savings-note")) $("overview-savings-note").textContent = `Across ${goals.length} ${goals.length === 1 ? "goal" : "goals"}`;
      if ($("overview-monthly-budget")) $("overview-monthly-budget").textContent = money(this.state.monthlyBudget || 0);
      const nextTitle = $("next-step-title");
      const nextCopy = $("next-step-copy");
      if (nextTitle && nextCopy) {
        if (!debts.length) {
          nextTitle.textContent = "Add a debt or obligation";
          nextCopy.textContent = "Enter the current balance and payment details to make your first estimate.";
        } else if (!this.state.lastPlan) {
          nextTitle.textContent = "Calculate your repayment plan";
          nextCopy.textContent = "Compare a realistic monthly budget against your current balances and minimum payments.";
        } else {
          nextTitle.textContent = "Review your next payment";
          nextCopy.textContent = `Your latest estimate is about ${window.GlimDebt?.durationText(this.state.lastPlan.payoff_months) || "—"} to pay off the tracked balances, assuming the inputs and budget stay the same.`;
        }
      }
      const chartPlan = plan || this.state.lastPlan;
      if (chartPlan?.schedule?.length) {
        this.drawScheduleChart("overview-debt-chart", chartPlan.schedule, "overview-chart-description");
        if ($("overview-chart-description")) $("overview-chart-description").textContent = `Estimated balance falls from ${money(chartPlan.starting_debt)} to ${money(chartPlan.schedule[chartPlan.schedule.length - 1].balance)} over ${chartPlan.payoff_months ?? "the shown"} months, based on current inputs.`;
      } else {
        this.drawScheduleChart("overview-debt-chart", [], "overview-chart-description");
        if ($("overview-chart-description")) $("overview-chart-description").textContent = "Calculate a repayment plan to see the estimated balance trajectory.";
      }
    },
    renderAll() {
      if (!this.state) return;
      if (window.GlimDebt) window.GlimDebt.render();
      if (window.GlimSavings) window.GlimSavings.render();
      this.renderOverview(this.state.lastPlan || null);
      const banner = document.querySelector(".prototype-banner");
      if (banner) banner.hidden = Boolean(this.state.dismissedBanner);
    },
    drawScheduleChart(canvasId, schedule, descriptionId) {
      const canvas = $(canvasId);
      if (!canvas) return;
      const description = $(descriptionId);
      const cssHeight = canvasId === "debt-chart" ? 235 : 175;
      const width = Math.max(240, canvas.clientWidth || canvas.parentElement?.clientWidth || 400);
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(cssHeight * ratio);
      canvas.style.height = `${cssHeight}px`;
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const styles = getComputedStyle(document.documentElement);
      const text = styles.getPropertyValue("--muted").trim() || "#77827a";
      const textStrong = styles.getPropertyValue("--text-strong").trim() || "#26352b";
      const border = styles.getPropertyValue("--border").trim() || "#e4e8e1";
      const line = styles.getPropertyValue("--green").trim() || "#28745d";
      const pad = { left: 49, right: 12, top: 14, bottom: 29 };
      const plotW = width - pad.left - pad.right;
      const plotH = cssHeight - pad.top - pad.bottom;
      ctx.clearRect(0, 0, width, cssHeight);
      if (!Array.isArray(schedule) || schedule.length < 2) {
        ctx.fillStyle = text; ctx.font = "12px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("No projection yet", width / 2, cssHeight / 2);
        if (description && !description.textContent) description.textContent = "Calculate a repayment plan to draw this estimate.";
        return;
      }
      const points = schedule.map((item, i) => ({ month: Number(item.month ?? i), balance: Math.max(0, Number(item.balance) || 0) }));
      const maxBalance = Math.max(1, ...points.map((point) => point.balance));
      const x = (index) => pad.left + (index / (points.length - 1)) * plotW;
      const y = (balance) => pad.top + plotH - (balance / maxBalance) * plotH;
      ctx.strokeStyle = border; ctx.lineWidth = 1;
      ctx.fillStyle = text; ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "right";
      for (let tick = 0; tick <= 4; tick++) {
        const value = maxBalance * tick / 4;
        const yy = y(value);
        ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
        const label = value >= 1000 ? `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(value)}`;
        ctx.fillText(label, pad.left - 8, yy + 3);
      }
      ctx.beginPath(); ctx.moveTo(x(0), y(points[0].balance));
      points.forEach((point, index) => ctx.lineTo(x(index), y(point.balance)));
      ctx.lineTo(x(points.length - 1), pad.top + plotH); ctx.lineTo(x(0), pad.top + plotH); ctx.closePath();
      ctx.fillStyle = line; ctx.globalAlpha = .10; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); points.forEach((point, index) => index === 0 ? ctx.moveTo(x(index), y(point.balance)) : ctx.lineTo(x(index), y(point.balance)));
      ctx.strokeStyle = line; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
      const showCount = Math.min(6, points.length);
      const indices = [...new Set(Array.from({ length: showCount }, (_, i) => Math.round(i * (points.length - 1) / Math.max(1, showCount - 1))))];
      ctx.fillStyle = text; ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "center";
      indices.forEach((index) => ctx.fillText(points[index].month === 0 ? "Now" : `M${points[index].month}`, x(index), cssHeight - 8));
      ctx.fillStyle = line;
      const last = points[points.length - 1]; ctx.beginPath(); ctx.arc(x(points.length - 1), y(last.balance), 3.5, 0, Math.PI * 2); ctx.fill();
      canvas.setAttribute("aria-label", `Estimated debt balance starts at ${money(points[0].balance)} and ends at ${money(last.balance)} after ${last.month} months.`);
      if (description && !description.textContent) description.textContent = `Estimated balance from ${money(points[0].balance)} to ${money(last.balance)}.`;
    },
  };

  async function askCoach(question) {
    const input = $("coach-question");
    const response = $("coach-response");
    const status = $("coach-status");
    const button = document.querySelector('#coach-form button[type="submit"]');
    const text = (question ?? input?.value ?? "").trim();
    if (text.length < 2) { app.toast("Enter a question for your coach."); input?.focus(); return; }
    if (input) input.value = text;
    if (button) { button.disabled = true; button.textContent = "Thinking…"; }
    if (status) status.textContent = "Thinking…";
    if (response) { response.hidden = false; response.textContent = "Glim is preparing a response…"; }
    const prefs = app.state.prefs || {};
    const context = {
      debts: (app.state.debts || []).map((debt) => ({ name: debt.name, type: debt.type, balance: debt.balance, apr: debt.apr, minimum_payment: debt.minimum_payment, due_date: debt.due_date })),
      savings_goals: (app.state.savingsGoals || []).map((goal) => ({ name: goal.name, target: goal.target, current: goal.current, monthly_contribution: goal.monthly_contribution })),
      monthly_debt_budget: app.state.monthlyBudget,
      selected_plan_summary: app.state.lastPlan ? { strategy: app.state.lastPlan.strategy, starting_debt: app.state.lastPlan.starting_debt, total_interest: app.state.lastPlan.total_interest, payoff_months: app.state.lastPlan.payoff_months, warning: app.state.lastPlan.warning } : null,
    };
    try {
      const result = await window.GlimAPI.askCoach(text, context, prefs.coachTone || "balanced", prefs.coachMode || "coach");
      if (response) {
        response.textContent = result.reply + (result.notice ? `\n\n${result.notice}` : "");
        response.hidden = false;
      }
      if (status) status.textContent = result.configured ? "Gemini connected" : "Demo coach";
      if (result.provider === "demo-fallback") app.toast("Showing a local demo response. Configure Gemini to enable live coaching.");
    } catch (error) {
      if (response) { response.textContent = error.message; response.hidden = false; }
      if (status) status.textContent = "Coach unavailable";
      app.toast("The coach could not respond. Check the configuration and try again.");
    } finally {
      if (button) { button.disabled = false; button.innerHTML = 'Ask Glim <span aria-hidden="true">↑</span>'; }
    }
  }

  async function updateIntegrationStatus() {
    try {
      const status = await window.GlimAPI.integrationStatus();
      if ($("coach-status")) $("coach-status").textContent = status.gemini ? "Gemini connected" : "Demo coach";
      if ($("settings-gemini-status")) $("settings-gemini-status").textContent = status.gemini ? `Configured · ${status.gemini_model}` : "Demo fallback (key not set)";
      if ($("settings-paypal-status")) $("settings-paypal-status").textContent = status.paypal_sandbox ? "Sandbox configured" : "Sandbox not configured";
      if ($("settings-qloo-status")) $("settings-qloo-status").textContent = status.qloo ? "API key configured" : "Starter ideas (key not set)";
    } catch (_) { /* A status display should not block the local prototype. */ }
  }

  async function showRewardIdeas() {
    const output = $("rewards-results");
    const button = $("load-rewards");
    if (!output) return;
    output.hidden = false;
    output.textContent = "Finding ideas…";
    if (button) { button.disabled = true; button.textContent = "Finding…"; }
    try {
      // Qloo accepts tag IDs as interest signals. Nonfiction is used as a safe demo interest.
      const result = await window.GlimAPI.rewardIdeas(["urn:tag:genre:media:nonfiction"]);
      const cards = (result.ideas || []).map((idea) => `<article class="reward-idea"><strong>${escapeHtml(idea.name)}</strong><p>${escapeHtml(idea.description)}</p></article>`).join("");
      output.innerHTML = `<strong>${result.provider === "qloo" ? "Personalized ideas" : "Low-cost reward ideas"}</strong><p>${escapeHtml(result.notice || "Start with a reward that does not add pressure to your budget.")}</p>${cards ? `<div class="reward-ideas-list">${cards}</div>` : "<p>No ideas returned. Try again after checking the Qloo configuration.</p>"}`;
    } catch (error) {
      output.textContent = error.message;
    } finally {
      if (button) { button.disabled = false; button.textContent = "Find reward ideas"; }
    }
  }

  function openRewardDialog() {
    if (!app.state?.milestones?.includes("plan_created")) {
      app.toast("Calculate and review a repayment plan before testing the milestone reward.");
      app.navigate("debt"); return;
    }
    if (app.state.claimedRewardMilestones?.includes("plan_created")) {
      app.toast("A Sandbox reward request has already been submitted for this demo milestone."); return;
    }
    const profile = JSON.parse(localStorage.getItem("glimDemoUser") || "{}");
    if ($("reward-email") && profile.email) $("reward-email").value = profile.email;
    if ($("reward-dialog-message")) { $("reward-dialog-message").textContent = ""; $("reward-dialog-message").className = "form-message"; }
    const dialog = $("reward-dialog");
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    else app.toast("This browser does not support the reward dialog.");
  }

  async function claimReward(event) {
    event.preventDefault();
    const formButton = document.querySelector('#reward-dialog-form button[type="submit"]');
    const message = $("reward-dialog-message");
    const email = $("reward-email").value.trim();
    if (formButton) { formButton.disabled = true; formButton.textContent = "Submitting…"; }
    if (message) { message.textContent = "Contacting PayPal Sandbox…"; message.className = "form-message"; }
    try {
      const result = await window.GlimAPI.claimReward("plan_created", email);
      app.state.claimedRewardMilestones = [...new Set([...(app.state.claimedRewardMilestones || []), "plan_created"])];
      if (message) { message.textContent = `${result.notice} Batch: ${result.payout_batch_id || "pending"}. Status: ${result.batch_status || "submitted"}.`; message.className = "form-message is-success"; }
      app.toast("PayPal Sandbox accepted the payout request.");
      await app.saveState();
    } catch (error) {
      if (message) { message.textContent = error.message; message.className = "form-message is-error"; }
    } finally {
      if (formButton) { formButton.disabled = false; formButton.textContent = "Submit Sandbox request"; }
    }
  }

  function initHandlers() {
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      const destination = button.dataset.view;
      app.navigate(destination);
      if (button.dataset.prompt) {
        const question = $("coach-question");
        if (question) { question.value = button.dataset.prompt; question.focus(); }
      }
    }));
    document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
      const question = $("coach-question");
      app.navigate("overview");
      if (question) { question.value = button.dataset.prompt; question.focus(); }
    }));
    $("coach-form")?.addEventListener("submit", (event) => { event.preventDefault(); askCoach(); });
    document.querySelectorAll(".prompt-chips [data-prompt]").forEach((button) => button.addEventListener("click", () => askCoach(button.dataset.prompt)));
    $("signout-button")?.addEventListener("click", () => { localStorage.removeItem("glimDemoUser"); window.location.href = "/signin.html"; });
    $("mobile-menu-button")?.addEventListener("click", () => {
      const sidebar = $("sidebar"); const open = !sidebar.classList.contains("is-open");
      sidebar.classList.toggle("is-open", open); $("mobile-menu-button").setAttribute("aria-expanded", String(open));
      $("mobile-menu-button").setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    $("dismiss-banner")?.addEventListener("click", async () => {
      if (!app.state) return;
      app.state.dismissedBanner = true;
      const banner = document.querySelector(".prototype-banner"); if (banner) banner.hidden = true;
      try { await app.saveState(); } catch (error) { app.toast(`Could not save preference: ${error.message}`); }
    });
    $("load-rewards")?.addEventListener("click", showRewardIdeas);
    $("claim-reward")?.addEventListener("click", openRewardDialog);
    $("reward-dialog-form")?.addEventListener("submit", claimReward);
    $("close-reward-dialog")?.addEventListener("click", () => $("reward-dialog")?.close());
    $("cancel-reward-dialog")?.addEventListener("click", () => $("reward-dialog")?.close());
    window.addEventListener("resize", () => {
      if (!app.state) return;
      const plan = app.state.lastPlan;
      if (plan?.schedule) app.drawScheduleChart("debt-chart", plan.schedule, "debt-chart-description");
      app.renderOverview(plan || null);
    });
  }

  async function initialize() {
    if (!document.getElementById("app-shell")) return;
    const localProfile = localStorage.getItem("glimDemoUser");
    if (!localProfile) { window.location.replace("/signin.html"); return; }
    let profile = {};
    try { profile = JSON.parse(localProfile); } catch (_) { localStorage.removeItem("glimDemoUser"); window.location.replace("/signin.html"); return; }

    const userName = $("user-name");
    if (userName) userName.textContent = profile.name || "Glim member";
    if ($("user-initials")) $("user-initials").textContent = String(profile.name || "G").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    initHandlers();
    window.GlimSettings?.init();
    window.GlimDebt?.init();
    window.GlimSavings?.init();
    window.GlimLiteracy?.init();

    try {
      const result = await window.GlimAPI.getState();
      app.state = result.state;
      app.state.profile = { ...(app.state.profile || {}), name: profile.name || "Glim member", email: profile.email || "" };
      if (!app.state.prefs) app.state.prefs = { theme: "light", fontSize: "medium", reminderFrequency: "weekly", coachTone: "balanced", coachMode: "coach" };
      window.GlimSettings?.applyPreferences(app.state.prefs);
      app.renderAll();
      await app.saveState();
      await updateIntegrationStatus();
      await window.GlimDebt?.previewCharts();
    } catch (error) {
      app.toast(`Could not load Glim data: ${error.message}`);
      const banner = document.querySelector(".prototype-banner");
      if (banner) banner.textContent = `The backend is not reachable. Start the FastAPI server and reload. ${error.message}`;
    }
  }

  window.GlimApp = app;
  document.addEventListener("DOMContentLoaded", initialize);
})();
