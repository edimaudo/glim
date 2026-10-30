(function () {
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  function formatRewardStatus(status) {
    const labels = { SUCCESS: "Completed", PENDING: "Processing", PROCESSING: "Processing", DENIED: "Not completed", CANCELED: "Cancelled", RETURNED: "Returned", ONHOLD: "On hold" };
    const key = String(status || "SUBMITTED").toUpperCase();
    return labels[key] || "Submitted";
  }

  function renderRewardHistory() {
    const output = $("reward-history");
    if (!output || !app.state) return;
    const entries = app.state.rewardPayouts || [];
    output.hidden = entries.length === 0;
    if (!entries.length) { output.innerHTML = ""; return; }
    output.innerHTML = `<section class="panel reward-history-panel"><div class="panel-heading"><div><h2>Reward activity</h2><p>Review the status of your reward requests.</p></div></div><div class="saved-product-list">${entries.slice().reverse().map((item) => `<div class="saved-product-item"><span><strong>${escapeHtml(item.milestone_label || "Glim milestone")}</strong><small>${escapeHtml(item.requested_at ? new Date(item.requested_at).toLocaleString() : "Request date unavailable")} · CAD $${Number(item.amount || 1).toFixed(2)} · ${escapeHtml(formatRewardStatus(item.batch_status))}</small></span>${item.payout_batch_id ? `<button type="button" class="button button-secondary" data-refresh-reward="${escapeHtml(item.payout_batch_id)}">Refresh status</button>` : ""}</div>`).join("")}</div><p id="reward-status-message" class="small-help" role="status" aria-live="polite"></p></section>`;
  }

  async function refreshRewardStatus(batchId, button) {
    const message = $("reward-status-message");
    if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
    if (message) message.textContent = "Updating reward status…";
    try {
      const result = await window.GlimClient.payoutStatus(batchId);
      const state = app.state;
      const index = (state.rewardPayouts || []).findIndex((item) => item.payout_batch_id === batchId);
      if (index >= 0) state.rewardPayouts[index] = { ...state.rewardPayouts[index], batch_status: result.batch_status, item_status_counts: result.item_status_counts, refreshed_at: new Date().toISOString(), notice: result.notice };
      await app.saveState();
      renderRewardHistory();
      const refreshedMessage = $("reward-status-message");
      if (refreshedMessage) refreshedMessage.textContent = `Reward status updated: ${formatRewardStatus(result.batch_status)}.`;
    } catch (error) {
      console.error("Glim could not refresh reward status", error);
      if (message) { message.textContent = "We couldn’t refresh the reward status right now. Please try again later."; message.className = "form-message is-error"; }
      if (button) { button.disabled = false; button.textContent = "Retry status"; }
    }
  }

  const app = {
    state: null,
    activeView: "overview",
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
      this.activeView = view;
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
        } else if (debts.some((debt) => debt.apr === null || debt.apr === undefined || debt.apr === "" || debt.minimum_payment === null || debt.minimum_payment === undefined || debt.minimum_payment === "")) {
          nextTitle.textContent = "Complete your debt details";
          nextCopy.textContent = "Your starting balance is ready. Add the interest rate and monthly minimum payment to compare repayment plans.";
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
      renderRewardHistory();
    },
    drawScheduleChart(canvasId, schedule, descriptionId) {
      const canvas = $(canvasId);
      if (!canvas) return;
      const description = $(descriptionId);
      const hasProjection = Array.isArray(schedule) && schedule.length >= 2;
      const chartWrap = canvas.closest(".chart-wrap");
      canvas.hidden = !hasProjection;
      chartWrap?.classList.toggle("is-empty", !hasProjection);
      if (!hasProjection) {
        if (description) {
          description.hidden = false;
          if (!description.textContent) description.textContent = "Calculate a repayment plan to see the projected balance.";
        }
        return;
      }
      if (description) description.hidden = false;
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
      indices.forEach((index) => ctx.fillText(points[index].label || (points[index].month === 0 ? "Today" : `${points[index].month} mo`), x(index), cssHeight - 8));
      ctx.fillStyle = line;
      const last = points[points.length - 1]; ctx.beginPath(); ctx.arc(x(points.length - 1), y(last.balance), 3.5, 0, Math.PI * 2); ctx.fill();
      canvas.setAttribute("aria-label", last.label ? `Recorded tracked debt starts at ${money(points[0].balance)} on ${points[0].label} and ends at ${money(last.balance)} on ${last.label}.` : `Estimated debt balance starts at ${money(points[0].balance)} and ends at ${money(last.balance)} after ${last.month} months.`);
      if (description && !description.textContent) description.textContent = `Estimated balance from ${money(points[0].balance)} to ${money(last.balance)}.`;
    },
    renderDebtCheckpoints(plan) {
      const target = $("debt-chart-checkpoints");
      if (!target) return;
      const schedule = plan?.schedule;
      if (!Array.isArray(schedule) || !schedule.length) { target.innerHTML = ""; target.hidden = true; return; }
      target.hidden = false;
      const last = schedule[schedule.length - 1];
      const endMonth = Number(last.month || 0);
      const months = [...new Set([0, 3, 6, 12].filter((month) => month <= endMonth))];
      if (endMonth > 0 && !months.includes(endMonth)) months.push(endMonth);
      const byMonth = new Map(schedule.map((item) => [Number(item.month || 0), Number(item.balance || 0)]));
      target.innerHTML = months.map((month) => {
        const point = byMonth.get(month) ?? Number(schedule.filter((item) => Number(item.month || 0) <= month).slice(-1)[0]?.balance || 0);
        const label = month === 0 ? "Today" : (month === endMonth && Number(last.balance || 0) <= 0.005 ? "Payoff" : `${month} months`);
        return `<div class="chart-checkpoint"><span>${label}</span><strong>${money(point)}</strong></div>`;
      }).join("");
    },
  };

  function openCoachDialog(button) {
    const dialog = $("coach-dialog");
    if (!dialog) return;
    const section = button.closest("[data-view-panel]")?.dataset.viewPanel || app.activeView || "overview";
    app.activeView = section;
    const labels = { overview: "Overview", debt: "Debt management", savings: "Savings", literacy: "Financial literacy", settings: "Settings" };
    if ($("coach-dialog-title")) $("coach-dialog-title").textContent = `Ask Glim about ${labels[section] || "your plan"}`;
    if ($("coach-dialog-context")) $("coach-dialog-context").textContent = `Using your ${String(labels[section] || "financial plan").toLowerCase()} context, current balances and goals where relevant.`;
    if ($("coach-dialog-question")) { $("coach-dialog-question").value = button.dataset.coachPrompt || "Help me decide on a practical next step."; }
    if ($("coach-dialog-response")) { $("coach-dialog-response").hidden = true; $("coach-dialog-response").textContent = ""; }
    if ($("coach-dialog-status")) $("coach-dialog-status").textContent = "Ready to help";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
    $("coach-dialog-question")?.focus();
  }

  async function askCoach(question, surface = "overview") {
    const inDialog = surface === "dialog";
    const input = $(inDialog ? "coach-dialog-question" : "coach-question");
    const response = $(inDialog ? "coach-dialog-response" : "coach-response");
    const status = $(inDialog ? "coach-dialog-status" : "coach-status");
    const button = document.querySelector(inDialog ? '#coach-dialog-form button[type="submit"]' : '#coach-form button[type="submit"]');
    const text = (question ?? input?.value ?? "").trim();
    if (text.length < 2) { app.toast("Add a question for Glim."); input?.focus(); return; }
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
      active_section: app.activeView || "overview",
      financial_literacy: { level: app.state.literacyLevel || null, assessment_score: app.state.literacyAssessmentScore ?? null, last_quiz_score: app.state.quizLastScore ?? null, last_quiz_level: app.state.quizLastLevel || null },
    };
    try {
      const result = await window.GlimClient.askCoach(text, context, prefs.coachTone || "balanced", prefs.coachMode || "coach");
      if (response) {
        response.textContent = result.reply + (result.notice ? `\n\n${result.notice}` : "");
        response.hidden = false;
      }
      if (status) status.textContent = result.configured ? "Ready" : "Ready to help";
      await app.saveState();
    } catch (error) {
      console.error("Glim coach request failed", error);
      if (response) { response.textContent = "I couldn't prepare a response just now. Please try again."; response.hidden = false; }
      if (status) status.textContent = "Try again";
    } finally {
      if (button) { button.disabled = false; button.innerHTML = 'Ask Glim <span aria-hidden="true">↑</span>'; }
    }
  }

  async function updateIntegrationStatus() {
    try {
      const status = await window.GlimClient.integrationStatus();
      if ($("coach-status")) $("coach-status").textContent = "Ready to help";
      if ($("settings-gemini-status")) $("settings-gemini-status").textContent = status.gemini ? "AI coaching available" : "Built-in guidance available";
      if ($("settings-qloo-status")) $("settings-qloo-status").textContent = status.qloo ? "Personalized ideas available" : "General suggestions available";
    } catch (_) { /* A status display should not block the workspace. */ }
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
      const result = await window.GlimClient.rewardIdeas([selectedInterest]);
      const cards = (result.ideas || []).map((idea) => `<article class="reward-idea"><strong>${escapeHtml(idea.name)}</strong><p>${escapeHtml(idea.description)}</p></article>`).join("");
      output.innerHTML = `<strong>${result.provider === "qloo" ? "Personalized ideas" : "Low-cost reward ideas"}</strong><p>${escapeHtml(result.notice || "Choose a reward that fits your interests without adding pressure to your budget.")}</p>${cards ? `<div class="reward-ideas-list">${cards}</div>` : "<p>No ideas are available right now. Try again later.</p>"}`;
    } catch (error) {
      console.error("Glim could not load reward ideas", error);
      output.textContent = "Reward ideas are unavailable right now. Please try again later.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Find reward ideas"; }
    }
  }

  function getEligibleReward(scope = "any") {
    const state = app.state || {};
    const claimed = new Set(state.claimedRewardMilestones || []);
    const completedGoal = (state.savingsGoals || []).find((goal) => Number(goal.target) > 0 && Number(goal.current) >= Number(goal.target) && !claimed.has(`savings_goal:${goal.id}`));
    const savingsReward = completedGoal ? {
      key: `savings_goal:${completedGoal.id}`,
      apiKey: "savings_goal_reached",
      label: `Savings goal reached: ${completedGoal.name}`,
      scope: "savings",
      sourceMessageId: "savings-milestone-message",
      evidence: { goal_id: completedGoal.id, target: Number(completedGoal.target), current: Number(completedGoal.current) }
    } : null;

    const baseline = Number(state.baselineDebt);
    const current = (state.debts || []).reduce((sum, debt) => sum + Math.max(0, Number(debt.balance) || 0), 0);
    const debtReward = baseline > 0 && current <= baseline * 0.9 && !claimed.has("debt_reduction_10") ? {
      key: "debt_reduction_10",
      apiKey: "debt_reduction_10",
      label: "Tracked debt reduced by at least 10%",
      scope: "debt",
      sourceMessageId: "debt-milestone-message",
      evidence: { baseline_balance: baseline, current_balance: current }
    } : null;

    if (scope === "savings") return savingsReward;
    if (scope === "debt") return debtReward;
    return savingsReward || debtReward;
  }

  function openRewardDialog(event) {
    const scope = event?.currentTarget?.dataset?.rewardScope || "any";
    const eligible = getEligibleReward(scope);
    const messageIds = { any: "milestone-reward-message", debt: "debt-milestone-message", savings: "savings-milestone-message" };
    const notice = $(messageIds[scope] || messageIds.any);
    if (!eligible) {
      const messages = {
        any: "No reward milestone is eligible yet. Track a completed savings goal or a 10% reduction in tracked debt.",
        debt: "This reward unlocks after your tracked debt balance falls at least 10% below its starting balance.",
        savings: "This reward unlocks when one of your tracked savings goals reaches its target."
      };
      if (notice) { notice.textContent = messages[scope] || messages.any; notice.className = "form-message"; }
      return;
    }
    if (notice) { notice.textContent = ""; notice.className = "form-message"; }
    app.pendingReward = eligible;
    if ($("reward-dialog-title")) $("reward-dialog-title").textContent = eligible.label;
    if ($("reward-dialog-description")) $("reward-dialog-description").textContent = `Your milestone is eligible for a CAD $1.00 reward. Enter the recipient email and continue to submit the request. This reward is separate from your debt payments and savings contributions.`;
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
    const milestone = app.pendingReward || getEligibleReward("any");
    if (!milestone) { if (message) { message.textContent = "This milestone is no longer eligible. Refresh the page and try again."; message.className = "form-message is-error"; } return; }
    if (formButton) { formButton.disabled = true; formButton.textContent = "Submitting…"; }
    if (message) { message.textContent = "Submitting your reward request…"; message.className = "form-message"; }
    try {
      const claimId = app.state.rewardClaimRequests?.[milestone.key] || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `claim-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      app.state.rewardClaimRequests = { ...(app.state.rewardClaimRequests || {}), [milestone.key]: claimId };
      await app.saveState();
      const result = await window.GlimClient.claimReward(milestone.apiKey, email, milestone.evidence, claimId);
      app.state.claimedRewardMilestones = [...new Set([...(app.state.claimedRewardMilestones || []), milestone.key])];
      app.state.rewardPayouts = [...(app.state.rewardPayouts || []).filter((item) => item.payout_batch_id !== result.payout_batch_id), {
        claim_key: milestone.key, milestone_label: milestone.label, payout_batch_id: result.payout_batch_id || null,
        sender_batch_id: result.sender_batch_id || null, batch_status: result.batch_status || "submitted",
        amount: Number(result.amount?.value || 1), currency: result.amount?.currency || "CAD", requested_at: new Date().toISOString(), notice: result.notice
      }].slice(-20);
      if (message) { message.textContent = "Your reward request has been submitted."; message.className = "form-message is-success"; }
      const sourceNotice = $(milestone.sourceMessageId || "milestone-reward-message");
      if (sourceNotice) { sourceNotice.textContent = `Reward status: ${formatRewardStatus(result.batch_status)}.`; sourceNotice.className = "form-message is-success"; }
      const overviewNotice = $("milestone-reward-message");
      if (overviewNotice) { overviewNotice.textContent = `Latest reward request: ${result.batch_status || "submitted"}.`; overviewNotice.className = "form-message is-success"; }
      renderRewardHistory();
      app.toast("Your reward request has been submitted.");
      await app.saveState();
    } catch (error) {
      console.error("Glim could not submit reward request", error);
      if (message) { message.textContent = "We couldn’t submit this reward right now. Please try again later."; message.className = "form-message is-error"; }
    } finally {
      if (formButton) { formButton.disabled = false; formButton.textContent = "Submit request"; }
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

  function initSectionTabs() {
    document.querySelectorAll("[data-tabset]").forEach((tabset) => {
      const tabs = Array.from(tabset.querySelectorAll('[role="tab"][data-tab-target]'));
      if (!tabs.length) return;

      const activate = (selected, moveFocus = false) => {
        tabs.forEach((tab) => {
          const active = tab === selected;
          tab.classList.toggle("is-active", active);
          tab.setAttribute("aria-selected", String(active));
          tab.tabIndex = active ? 0 : -1;
          const panel = document.getElementById(tab.dataset.tabTarget);
          if (panel) {
            panel.hidden = !active;
            panel.classList.toggle("is-active", active);
          }
        });
        if (moveFocus) selected.focus();
        const panel = document.getElementById(selected.dataset.tabTarget);
        // Redraw canvas charts after their tab becomes visible so the measured width is correct.
        window.requestAnimationFrame(() => {
          if (!app.state || !panel) return;
          const schedule = app.state.lastPlan?.schedule;
          if (panel.querySelector("#debt-chart") && schedule?.length) {
            app.drawScheduleChart("debt-chart", schedule, "debt-chart-description");
          }
          if (panel.querySelector("#overview-debt-chart")) {
            app.renderOverview(app.state.lastPlan || null);
          }
        });
      };

      tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab)));
      tabset.addEventListener("keydown", (event) => {
        const index = tabs.indexOf(event.target);
        if (index < 0) return;
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        activate(tabs[next], true);
      });

      const initiallySelected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];
      activate(initiallySelected);
    });
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
      if (button.closest(".prompt-chips")) return;
      const question = $("coach-question");
      app.navigate("overview");
      if (question) { question.value = button.dataset.prompt; question.focus(); }
    }));
    $("coach-form")?.addEventListener("submit", (event) => { event.preventDefault(); askCoach(undefined, "overview"); });
    $("coach-dialog-form")?.addEventListener("submit", (event) => { event.preventDefault(); askCoach(undefined, "dialog"); });
    $("close-coach-dialog")?.addEventListener("click", () => $("coach-dialog")?.close());
    document.querySelectorAll("[data-open-coach]").forEach((button) => button.addEventListener("click", () => openCoachDialog(button)));
    document.querySelectorAll(".prompt-chips [data-prompt]").forEach((button) => button.addEventListener("click", () => askCoach(button.dataset.prompt, "overview")));
    $("signout-button")?.addEventListener("click", async () => {
      const button = $("signout-button"); if (button) button.disabled = true;
      try { await window.GlimClient.deleteSession(); } catch (_) { /* Expired demo cookies are harmless; continue to sign-in. */ }
      window.location.href = "/signin";
    });
    $("mobile-menu-button")?.addEventListener("click", () => {
      const sidebar = $("sidebar"); const open = !sidebar.classList.contains("is-open");
      sidebar.classList.toggle("is-open", open); $("mobile-menu-button").setAttribute("aria-expanded", String(open));
      $("mobile-menu-button").setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
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
    $("reward-history")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-refresh-reward]");
      if (button) refreshRewardStatus(button.dataset.refreshReward, button);
    });
    document.querySelectorAll("[data-reward-scope]").forEach((button) => button.addEventListener("click", openRewardDialog));
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
    try { profile = (await window.GlimClient.currentSession()).profile; }
    catch (_) { window.location.replace("/signin"); return; }
    if (!profile?.email) { window.location.replace("/signin"); return; }

    const userName = $("user-name");
    if (userName) userName.textContent = profile.name || "Glim member";
    if ($("user-initials")) $("user-initials").textContent = String(profile.name || "G").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    initSectionTabs();
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
      // Keep low-level browser database exceptions out of the rendered interface.
      console.error("Glim could not initialize browser-local data", error);
      app.toast("Glim couldn't open your saved information. Please refresh the page and try again.");
    }
  }

  app.checkSmartFollowup = checkSmartFollowup;
  app.followupMessage = followupMessage;
  window.GlimApp = app;
  document.addEventListener("DOMContentLoaded", initialize);
})();
