(function () {
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const preciseMoney = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const id = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `debt-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function totalBalance(debts) { return (debts || []).reduce((sum, debt) => sum + Math.max(0, Number(debt.balance) || 0), 0); }
  function totalMinimums(debts) { return (debts || []).reduce((sum, debt) => sum + Math.max(0, Number(debt.minimum_payment ?? debt.min_payment) || 0), 0); }
  function durationText(months) {
    if (months === null || months === undefined) return "Not reached";
    if (months === 0) return "Already paid";
    const years = Math.floor(months / 12);
    const remainder = months % 12;
    if (years && remainder) return `${years} yr ${remainder} mo`;
    if (years) return `${years} ${years === 1 ? "year" : "years"}`;
    return `${months} ${months === 1 ? "month" : "months"}`;
  }

  function renderDebts() {
    const state = window.GlimApp.state;
    const debts = state.debts || [];
    const list = $("debts-list");
    if (!list) return;
    list.innerHTML = "";
    if (!debts.length) {
      list.innerHTML = '<div class="empty-state"><strong>No debts added yet</strong>Add a balance, interest rate, and minimum payment to compare your options.</div>';
    } else {
      debts.forEach((debt) => {
        const row = document.createElement("article");
        row.className = "debt-item";
        const icon = document.createElement("div");
        icon.className = "debt-item-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = debt.type === "Line of credit" ? "↗" : debt.type === "Student loan" ? "▤" : "▱";
        const detail = document.createElement("div");
        detail.className = "debt-item-main";
        const title = document.createElement("strong"); title.textContent = debt.name;
        const meta = document.createElement("p");
        const apr = `${Number(debt.apr || 0).toFixed(2)}% APR`;
        const minimum = `${money(debt.minimum_payment ?? debt.min_payment)} / mo minimum`;
        const due = debt.due_date ? ` · Due ${new Date(`${debt.due_date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : "";
        meta.textContent = `${debt.type || "Debt"} · ${apr} · ${minimum}${due}${debt.sample ? " · Sample" : ""}`;
        detail.append(title, meta);
        const amount = document.createElement("div"); amount.className = "debt-item-amount";
        const value = document.createElement("strong"); value.textContent = money(debt.balance);
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${debt.name}`); remove.dataset.removeDebt = debt.id;
        amount.append(value, remove);
        row.append(icon, detail, amount); list.append(row);
      });
    }
    const total = totalBalance(debts); const minimums = totalMinimums(debts);
    if ($("debt-total")) $("debt-total").textContent = money(total);
    if ($("debt-minimums")) $("debt-minimums").textContent = money(minimums);
    if ($("debt-budget-summary")) $("debt-budget-summary").textContent = money(state.monthlyBudget || 0);
    if ($("debt-budget-note")) $("debt-budget-note").textContent = (state.monthlyBudget || 0) >= minimums ? "Available for debt payments" : "Below entered minimums — review this budget";
    if ($("debt-count-tag")) $("debt-count-tag").textContent = `${debts.length} ${debts.length === 1 ? "account" : "accounts"}`;
    if ($("monthly-budget") && document.activeElement !== $("monthly-budget")) $("monthly-budget").value = state.monthlyBudget || 500;
  }

  function renderPlanResult(result) {
    const target = $("plan-results");
    if (!target || !result) return;
    target.hidden = false;
    const selected = result.selected;
    const alternate = selected.strategy === "avalanche" ? result.snowball : result.avalanche;
    const selectedName = selected.strategy === "avalanche" ? "Avalanche" : "Snowball";
    const altName = selected.strategy === "avalanche" ? "Snowball" : "Avalanche";
    const diff = Math.abs(Number(selected.total_interest || 0) - Number(alternate.total_interest || 0));
    target.innerHTML = `
      <div class="result-kpis">
        <div class="result-kpi"><span>Estimated interest · ${selectedName}</span><strong>${preciseMoney(selected.total_interest)}</strong></div>
        <div class="result-kpi"><span>Estimated payoff</span><strong>${escapeHtml(durationText(selected.payoff_months))}</strong></div>
        <div class="result-kpi"><span>Alternative · ${altName}</span><strong>${preciseMoney(alternate.total_interest)}</strong></div>
        <div class="result-kpi"><span>Interest difference</span><strong>${preciseMoney(diff)}</strong></div>
      </div>
      <p class="result-note">${selectedName} ${selected.strategy === "avalanche" ? "targets the highest APR first and can reduce interest costs." : "targets the smallest balance first and may provide earlier milestones."} The ${altName.toLowerCase()} estimate is shown for comparison. This model applies monthly APR/12 interest and entered minimums; actual issuer calculations can differ.${selected.warning ? ` Note: ${escapeHtml(selected.warning)}` : ""}</p>`;
  }

  async function runPlan(event) {
    event?.preventDefault();
    const button = document.querySelector('#plan-form button[type="submit"]');
    const message = $("plan-message");
    const monthlyBudget = Number($("monthly-budget").value);
    const strategy = document.querySelector('input[name="strategy"]:checked')?.value || "avalanche";
    if (button) { button.disabled = true; button.textContent = "Calculating…"; }
    if (message) { message.textContent = "Checking the numbers…"; message.className = "form-message"; }
    try {
      const result = await window.GlimAPI.calculatePlan(window.GlimApp.state.debts || [], monthlyBudget, strategy);
      const state = window.GlimApp.state;
      state.monthlyBudget = monthlyBudget;
      state.strategy = strategy;
      state.lastPlan = result.selected;
      state.lastPlanComparison = result;
      state.milestones = [...new Set([...(state.milestones || []), "plan_created"])];
      await window.GlimApp.saveState();
      renderPlanResult(result);
      renderDebts();
      window.GlimApp.drawScheduleChart("debt-chart", result.selected.schedule, "debt-chart-description");
      window.GlimApp.renderOverview(result.selected);
      if (message) { message.textContent = "Plan calculated and saved. Review the assumptions before acting."; message.className = "form-message is-success"; }
      window.GlimApp.toast("Your repayment estimate is ready.");
    } catch (error) {
      if (message) { message.textContent = error.message; message.className = "form-message is-error"; }
    } finally {
      if (button) { button.disabled = false; button.innerHTML = 'Calculate my plan <span aria-hidden="true">→</span>'; }
    }
  }

  function openForm() {
    const form = $("debt-form");
    if (!form) return;
    form.hidden = false;
    $("add-debt-toggle")?.setAttribute("aria-expanded", "true");
    $("debt-name")?.focus();
  }
  function closeForm() {
    const form = $("debt-form");
    if (form) { form.reset(); form.hidden = true; }
    $("add-debt-toggle")?.setAttribute("aria-expanded", "false");
  }

  async function addDebt(event) {
    event.preventDefault();
    const debt = {
      id: id(), name: $("debt-name").value.trim(), type: $("debt-type").value,
      balance: Number($("debt-balance").value), apr: Number($("debt-apr").value),
      minimum_payment: Number($("debt-minimum").value), due_date: $("debt-due-date").value || null, sample: false,
    };
    if (!debt.name || !(debt.balance > 0) || debt.apr < 0 || debt.minimum_payment < 0) {
      window.GlimApp.toast("Check the debt details and try again."); return;
    }
    window.GlimApp.state.debts.push(debt);
    window.GlimApp.state.lastPlan = null;
    window.GlimApp.state.lastPlanComparison = null;
    try {
      await window.GlimApp.saveState();
      closeForm();
      renderDebts();
      window.GlimApp.renderOverview(null);
      $("plan-results").hidden = true;
      window.GlimApp.toast("Debt added. Calculate a new plan to update your estimate.");
    } catch (error) { window.GlimApp.toast(`Could not save debt: ${error.message}`); }
  }

  async function removeDebt(debtId) {
    const debt = (window.GlimApp.state.debts || []).find((item) => item.id === debtId);
    if (!debt) return;
    if (!window.confirm(`Remove “${debt.name}” from this demo plan?`)) return;
    window.GlimApp.state.debts = window.GlimApp.state.debts.filter((item) => item.id !== debtId);
    window.GlimApp.state.lastPlan = null;
    window.GlimApp.state.lastPlanComparison = null;
    try {
      await window.GlimApp.saveState();
      renderDebts();
      window.GlimApp.renderOverview(null);
      $("plan-results").hidden = true;
      window.GlimApp.toast("Debt removed. Calculate a new plan to refresh your estimate.");
    } catch (error) { window.GlimApp.toast(`Could not save change: ${error.message}`); }
  }

  async function previewCharts() {
    const state = window.GlimApp.state;
    if (state.lastPlan?.schedule?.length) {
      renderPlanResult(state.lastPlanComparison || { selected: state.lastPlan, avalanche: state.lastPlan, snowball: state.lastPlan });
      window.GlimApp.drawScheduleChart("debt-chart", state.lastPlan.schedule, "debt-chart-description");
      window.GlimApp.renderOverview(state.lastPlan);
      return;
    }
    if (!state.debts?.length) {
      window.GlimApp.renderOverview(null);
      window.GlimApp.drawScheduleChart("debt-chart", [], "debt-chart-description");
      return;
    }
    try {
      const result = await window.GlimAPI.calculatePlan(state.debts, state.monthlyBudget || 500, state.strategy || "avalanche");
      window.GlimApp.drawScheduleChart("debt-chart", result.selected.schedule, "debt-chart-description");
      window.GlimApp.renderOverview(result.selected);
    } catch (error) {
      window.GlimApp.renderOverview(null);
      const desc = $("debt-chart-description"); if (desc) desc.textContent = error.message;
    }
  }

  function init() {
    $("add-debt-toggle")?.addEventListener("click", () => { const form = $("debt-form"); if (form.hidden) openForm(); else closeForm(); });
    $("cancel-debt-form")?.addEventListener("click", closeForm);
    $("cancel-debt-form-secondary")?.addEventListener("click", closeForm);
    $("debt-form")?.addEventListener("submit", addDebt);
    $("plan-form")?.addEventListener("submit", runPlan);
    $("debts-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-debt]");
      if (button) removeDebt(button.dataset.removeDebt);
    });
  }

  window.GlimDebt = { init, render: renderDebts, previewCharts, runPlan, totalBalance, totalMinimums, durationText };
})();
