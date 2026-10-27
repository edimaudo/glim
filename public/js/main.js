(function () {
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  function renderPayoutHistory() {
    const output = $("reward-payout-history");
    if (!output || !app.state) return;
    const entries = app.state.rewardPayouts || [];
    output.hidden = entries.length === 0;
    if (!entries.length) { output.innerHTML = ""; return; }
    output.innerHTML = `<section class="panel payout-history-panel"><div class="panel-heading"><div><h2>Sandbox reward requests</h2><p>Local history of payout batches Glim submitted to PayPal Sandbox.</p></div></div><div class="saved-product-list">${entries.slice().reverse().map((item) => `<div class="saved-product-item"><span><strong>${escapeHtml(item.milestone_label || "Glim milestone")}</strong><small>${escapeHtml(item.requested_at ? new Date(item.requested_at).toLocaleString() : "Request date unavailable")} · CAD $${Number(item.amount || 1).toFixed(2)} · ${escapeHtml(item.batch_status || "Submitted")}</small><small>Batch: ${escapeHtml(item.payout_batch_id || "not returned")}</small></span>${item.payout_batch_id ? `<button type="button" class="button button-secondary" data-refresh-payout="${escapeHtml(item.payout_batch_id)}">Refresh status</button>` : ""}</div>`).join("")}</div><p id="payout-refresh-message" class="small-help" role="status" aria-live="polite"></p></section>`;
  }

  async function refreshPayoutStatus(batchId, button) {
    const message = $("payout-refresh-message");
    if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
    if (message) message.textContent = "Checking PayPal Sandbox…";
    try {
      const result = await window.GlimAPI.payoutStatus(batchId);
      const state = app.state;
      const index = (state.rewardPayouts || []).findIndex((item) => item.payout_batch_id === batchId);
      if (index >= 0) state.rewardPayouts[index] = { ...state.rewardPayouts[index], batch_status: result.batch_status, item_status_counts: result.item_status_counts, refreshed_at: new Date().toISOString(), notice: result.notice };
      await app.saveState();
      renderPayoutHistory();
      const refreshedMessage = $("payout-refresh-message");
      if (refreshedMessage) refreshedMessage.textContent = `${result.notice} Latest batch status: ${result.batch_status}.`;
    } catch (error) {
      if (message) { message.textContent = error.message; message.className = "form-message is-error"; }
      if (button) { button.disabled = false; button.textContent = "Retry status"; }
    }
  }

  const app = {
    state: null,
    saveQueue: Promise.resolve(),
    async saveState() {
      if (!this.state || !this.state.profile?.email) return;
      const snapshot = JSON.parse(JSON.stringify(this.state));
      this.saveQueue = this.saveQueue.catch(() => {}).then(() => window.GlimStorage.saveState(this.state.profile.email, snapshot));
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
      renderPayoutHistory();
      const history = (this.state.balanceHistory || []).map((entry, index) => ({ month: index, balance: Math.max(0, Number(entry.total) || 0), label: String(entry.date || "").slice(5) }));
      this.drawScheduleChart("debt-history-chart", history, "debt-history-description");
      if ($("debt-history-description")) {
        const first = history[0]; const last = history[history.length - 1];
        $("debt-history-description").textContent = first && last ? `Manually recorded tracked debt moved from ${money(first.balance)} on ${first.label} to ${money(last.balance)} on ${last.label}.` : "Update a balance after checking your statement to build a history.";
      }
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
      const points = schedule.map((item, i) => ({ month: Number(item.month ?? i), balance: Math.max(0, Number(item.balance) || 0), label: item.label || null }));
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
      indices.forEach((index) => ctx.fillText(points[index].label || (points[index].month === 0 ? "Now" : `M${points[index].month}`), x(index), cssHeight - 8));
      ctx.fillStyle = line;
      const last = points[points.length - 1]; ctx.beginPath(); ctx.arc(x(points.length - 1), y(last.balance), 3.5, 0, Math.PI * 2); ctx.fill();
      canvas.setAttribute("aria-label", last.label ? `Recorded tracked debt starts at ${money(points[0].balance)} on ${points[0].label} and ends at ${money(last.balance)} on ${last.label}.` : `Estimated debt balance starts at ${money(points[0].balance)} and ends at ${money(last.balance)} after ${last.month} months.`);
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
    app.state.coachInteractions = Number(app.state.coachInteractions || 0) + 1;
    app.state.lastCoachQuestion = text;
    app.state.lastCoachAt = new Date().toISOString();
    const context = {
      debts: (app.state.debts || []).map((debt) => ({ name: debt.name, type: debt.type, balance: debt.balance, apr: debt.apr, minimum_payment: debt.minimum_payment, due_date: debt.due_date })),
      savings_goals: (app.state.savingsGoals || []).map((goal) => ({ name: goal.name, target: goal.target, current: goal.current, monthly_contribution: goal.monthly_contribution })),
      user_entered_product_options: (app.state.productComparisons || []).slice(-10).map((item) => ({ category: item.category, name: item.name, provider: item.provider, annual_rate: item.annual_rate, annual_fee: item.annual_fee, monthly_fee: item.monthly_fee, promo_rate: item.promo_rate, promo_months: item.promo_months, post_promo_rate: item.post_promo_rate, product_url: item.product_url })),
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
      await app.saveState();
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
      // Use the selected interest signal. Recommendations are optional and should not encourage spending.
      const selectedInterest = $("reward-interest")?.value || "urn:tag:genre:media:nonfiction";
      const result = await window.GlimAPI.rewardIdeas([selectedInterest]);
      const cards = (result.ideas || []).map((idea) => `<article class="reward-idea"><strong>${escapeHtml(idea.name)}</strong><p>${escapeHtml(idea.description)}</p></article>`).join("");
      output.innerHTML = `<strong>${result.provider === "qloo" ? "Personalized ideas" : "Low-cost reward ideas"}</strong><p>${escapeHtml(result.notice || "Start with a reward that does not add pressure to your budget.")}</p>${cards ? `<div class="reward-ideas-list">${cards}</div>` : "<p>No ideas returned. Try again after checking the Qloo configuration.</p>"}`;
    } catch (error) {
      output.textContent = error.message;
    } finally {
      if (button) { button.disabled = false; button.textContent = "Find reward ideas"; }
    }
  }

  function getEligibleReward() {
    const state = app.state || {};
    const claimed = new Set(state.claimedRewardMilestones || []);
    const completedGoal = (state.savingsGoals || []).find((goal) => Number(goal.target) > 0 && Number(goal.current) >= Number(goal.target));
    if (completedGoal && !claimed.has(`savings_goal:${completedGoal.id}`)) {
      return { key: `savings_goal:${completedGoal.id}`, apiKey: "savings_goal_reached", label: `Savings goal reached: ${completedGoal.name}`, evidence: { goal_id: completedGoal.id, target: Number(completedGoal.target), current: Number(completedGoal.current) } };
    }
    const baseline = Number(state.baselineDebt);
    const current = (state.debts || []).reduce((sum, debt) => sum + Math.max(0, Number(debt.balance) || 0), 0);
    if (baseline > 0 && current <= baseline * 0.9 && !claimed.has("debt_reduction_10")) {
      return { key: "debt_reduction_10", apiKey: "debt_reduction_10", label: "Tracked debt reduced by at least 10%", evidence: { baseline_balance: baseline, current_balance: current } };
    }
    return null;
  }

  function openRewardDialog() {
    const eligible = getEligibleReward();
    if (!eligible) {
      app.toast("To test a reward, reach a savings goal or record a 10% reduction from your tracked starting debt. The Sandbox uses manually entered demo data.");
      app.navigate("savings"); return;
    }
    app.pendingReward = eligible;
    if ($("reward-dialog-title")) $("reward-dialog-title").textContent = eligible.label;
    if ($("reward-dialog-description")) $("reward-dialog-description").textContent = `This requests a CAD $1.00 payout to a PayPal Sandbox recipient for: ${eligible.label}. It uses manually entered demo data and does not independently verify a real financial account.`;
    if ($("reward-email") && app.state.profile?.email) $("reward-email").value = app.state.profile.email;
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
    const milestone = app.pendingReward || getEligibleReward();
    if (!milestone) { if (message) { message.textContent = "This milestone is no longer eligible. Refresh the page and try again."; message.className = "form-message is-error"; } return; }
    if (formButton) { formButton.disabled = true; formButton.textContent = "Submitting…"; }
    if (message) { message.textContent = "Contacting PayPal Sandbox…"; message.className = "form-message"; }
    try {
      const claimId = app.state.rewardClaimRequests?.[milestone.key] || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `claim-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      app.state.rewardClaimRequests = { ...(app.state.rewardClaimRequests || {}), [milestone.key]: claimId };
      await app.saveState();
      const result = await window.GlimAPI.claimReward(milestone.apiKey, email, milestone.evidence, claimId);
      app.state.claimedRewardMilestones = [...new Set([...(app.state.claimedRewardMilestones || []), milestone.key])];
      app.state.rewardPayouts = [...(app.state.rewardPayouts || []).filter((item) => item.payout_batch_id !== result.payout_batch_id), {
        claim_key: milestone.key, milestone_label: milestone.label, payout_batch_id: result.payout_batch_id || null,
        sender_batch_id: result.sender_batch_id || null, batch_status: result.batch_status || "submitted",
        amount: Number(result.amount?.value || 1), currency: result.amount?.currency || "CAD", requested_at: new Date().toISOString(), notice: result.notice
      }].slice(-20);
      if (message) { message.textContent = `${result.notice} Batch: ${result.payout_batch_id || "pending"}. Status: ${result.batch_status || "submitted"}.`; message.className = "form-message is-success"; }
      renderPayoutHistory();
      app.toast("PayPal Sandbox accepted the payout request.");
      await app.saveState();
    } catch (error) {
      if (message) { message.textContent = error.message; message.className = "form-message is-error"; }
    } finally {
      if (formButton) { formButton.disabled = false; formButton.textContent = "Submit Sandbox request"; }
    }
  }

  function followupMessage() {
    const state = app.state || {};
    const frequency = state.prefs?.reminderFrequency || "weekly";
    if (frequency === "off") return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (state.snoozedReminderUntil && new Date(state.snoozedReminderUntil) > today) return null;
    const baseInterval = frequency === "twice-weekly" ? 3 : frequency === "monthly" ? 30 : 7;
    const dismissals = Number(state.reminderDismissals || 0);
    // Repeated dismissals make gentle/balanced reminders less frequent; direct coaching opts into shorter intervals.
    const interval = state.prefs?.coachTone === "direct"
      ? Math.max(2, Math.floor(baseInterval * 0.75))
      : dismissals >= 2 ? Math.min(60, baseInterval * 2) : baseInterval;
    if (state.lastReminderAt) {
      const last = new Date(state.lastReminderAt); last.setHours(0, 0, 0, 0);
      if ((today - last) / 86400000 < interval) return null;
    }
    const upcoming = (state.debts || []).filter((debt) => debt.due_date).map((debt) => ({ debt, days: Math.ceil((new Date(`${debt.due_date}T12:00:00`) - today) / 86400000) })).filter((item) => item.days <= 7).sort((a,b) => a.days - b.days)[0];
    let title = "Take a quick look at your plan";
    let copy = "Review your balances and choose one manageable next step. Your financial details stay in this browser.";
    let action = "Review my plan";
    let view = "debt";
    if (upcoming) {
      const dueText = upcoming.days < 0 ? `${Math.abs(upcoming.days)} day${Math.abs(upcoming.days) === 1 ? "" : "s"} overdue` : upcoming.days === 0 ? "due today" : `due in ${upcoming.days} day${upcoming.days === 1 ? "" : "s"}`;
      title = upcoming.days < 0 ? "Check an overdue due date" : "A payment date is coming up";
      copy = `${upcoming.debt.name} is ${dueText} based on the date you entered. Confirm the current status with your issuer; Glim cannot see whether a payment cleared.`;
      action = "Review debt details"; view = "debt";
    } else if (state.savingsGoals?.some((goal) => Number(goal.current) < Number(goal.target))) {
      const goal = state.savingsGoals.find((item) => Number(item.current) < Number(item.target));
      title = "Check your savings contribution";
      copy = `${goal.name} is ${Math.max(0, Math.round(Number(goal.current) / Math.max(1, Number(goal.target)) * 100))}% funded. Consider whether the planned contribution still fits after essentials and required debt payments.`;
      action = "Review savings"; view = "savings";
    } else if (Number(state.coachInteractions || 0) > 0) {
      title = "Revisit the question you were working on";
      copy = state.prefs?.coachTone === "direct" ? "Review your latest coach response and decide whether the next step is still realistic." : "You have already taken a step by exploring your options. Check whether anything has changed and adjust the plan if needed.";
      action = "Open my coach"; view = "overview";
    }
    if ((state.reminderDismissals || 0) >= 2 && state.prefs?.coachTone !== "direct") copy += " No pressure to do everything today; choose only what is useful.";
    return { title, copy, action, view };
  }

  async function checkSmartFollowup() {
    const data = followupMessage();
    const card = $("smart-followup-card");
    if (!card) return;
    if (!data) { card.hidden = true; return; }
    card.hidden = false;
    $("smart-followup-title").textContent = data.title;
    $("smart-followup-copy").textContent = data.copy;
    $("smart-followup-action").textContent = data.action;
    $("smart-followup-action").dataset.view = data.view;
    const prefs = app.state.prefs || {};
    if (prefs.browserNotifications && "Notification" in window && Notification.permission === "granted") {
      const today = new Date().toISOString().slice(0, 10);
      if (app.state.lastBrowserNotificationDate !== today) {
        try { new Notification(`Glim: ${data.title}`, { body: data.copy, tag: `glim-${today}` }); app.state.lastBrowserNotificationDate = today; await app.saveState(); } catch (_) { /* A blocked notification must not break Glim. */ }
      }
    }
  }

  async function dismissSmartFollowup(snooze = false) {
    if (!app.state) return;
    app.state.lastReminderAt = new Date().toISOString();
    if (snooze) {
      const until = new Date(); until.setDate(until.getDate() + 3); app.state.snoozedReminderUntil = until.toISOString();
      app.state.reminderEvents = [...(app.state.reminderEvents || []), { type: "snoozed", at: new Date().toISOString() }].slice(-100);
    } else {
      app.state.reminderDismissals = Number(app.state.reminderDismissals || 0) + 1;
      app.state.reminderEvents = [...(app.state.reminderEvents || []), { type: "dismissed", at: new Date().toISOString() }].slice(-100);
    }
    const card = $("smart-followup-card"); if (card) card.hidden = true;
    await app.saveState();
    app.toast(snooze ? "Follow-up snoozed for three days." : "Follow-up dismissed. Glim will adjust the next reminder cadence.");
  }

  function initHandlers() {
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", async () => {
      const destination = button.dataset.view;
      if (button.id === "smart-followup-action" && app.state) {
        app.state.reminderDismissals = 0;
        app.state.lastReminderAt = new Date().toISOString();
        app.state.snoozedReminderUntil = null;
        app.state.reminderEvents = [...(app.state.reminderEvents || []), { type: "acted", at: new Date().toISOString(), destination }].slice(-100);
        await app.saveState();
        const card = $("smart-followup-card"); if (card) card.hidden = true;
      }
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
    $("signout-button")?.addEventListener("click", async () => {
      const button = $("signout-button"); if (button) button.disabled = true;
      try { await window.GlimAPI.deleteSession(); } catch (_) { /* Expired demo cookies are harmless; continue to sign-in. */ }
      window.location.href = "/signin.html";
    });
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
    $("smart-followup-dismiss")?.addEventListener("click", () => dismissSmartFollowup(false));
    $("smart-followup-snooze")?.addEventListener("click", () => dismissSmartFollowup(true));
    $("enable-browser-notifications")?.addEventListener("click", async () => {
      const status = $("notification-status");
      if (!("Notification" in window)) { if (status) status.textContent = "Browser notifications are not supported here. In-app reminders still work when Glim is open."; return; }
      const permission = await Notification.requestPermission();
      app.state.prefs = { ...(app.state.prefs || {}), browserNotifications: permission === "granted" };
      app.state.lastReminderAt = null;
      await app.saveState();
      if (status) status.textContent = permission === "granted" ? "Browser notifications are enabled when Glim is open." : "Notifications were not enabled. In-app reminders remain available.";
      await checkSmartFollowup();
    });
    $("reward-payout-history")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-refresh-payout]");
      if (button) refreshPayoutStatus(button.dataset.refreshPayout, button);
    });
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
    let profile;
    try { profile = (await window.GlimAPI.currentSession()).profile; }
    catch (_) { window.location.replace("/signin.html"); return; }
    if (!profile?.email) { window.location.replace("/signin.html"); return; }

    const userName = $("user-name");
    if (userName) userName.textContent = profile.name || "Glim member";
    if ($("user-initials")) $("user-initials").textContent = String(profile.name || "G").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    initHandlers();
    window.GlimSettings?.init();
    window.GlimDebt?.init();
    window.GlimSavings?.init();

    try {
      app.state = await window.GlimStorage.getState(profile.email, profile);
      app.state.profile = { ...(app.state.profile || {}), name: profile.name || "Glim member", email: profile.email || "" };
      if (!app.state.prefs) app.state.prefs = { theme: "light", fontSize: "medium", reminderFrequency: "weekly", coachTone: "balanced", coachMode: "coach" };
      window.GlimSettings?.applyPreferences(app.state.prefs);
      window.GlimLiteracy?.init();
      app.renderAll();
      await app.saveState();
      await updateIntegrationStatus();
      await window.GlimDebt?.previewCharts();
      await window.GlimProducts?.init();
      await checkSmartFollowup();
      window.setInterval(() => { if (!document.hidden && app.state) checkSmartFollowup(); }, 15 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden && app.state) checkSmartFollowup(); });
    } catch (error) {
      app.toast(`Could not load Glim data: ${error.message}`);
      const banner = document.querySelector(".prototype-banner");
      if (banner) banner.textContent = `Glim could not open your browser-local data. Check browser storage permissions and reload. ${error.message}`;
    }
  }

  app.checkSmartFollowup = checkSmartFollowup;
  app.followupMessage = followupMessage;
  window.GlimApp = app;
  document.addEventListener("DOMContentLoaded", initialize);
})();
