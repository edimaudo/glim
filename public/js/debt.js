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
        meta.textContent = `${debt.type || "Debt"} · ${apr} · ${minimum}${due}`;
        detail.append(title, meta);
        const amount = document.createElement("div"); amount.className = "debt-item-amount";
        const value = document.createElement("strong"); value.textContent = money(debt.balance);
        const actions = document.createElement("div"); actions.className = "debt-item-actions";
        const update = document.createElement("button"); update.type = "button"; update.textContent = "Update balance"; update.setAttribute("aria-label", `Update balance for ${debt.name}`); update.dataset.editBalance = debt.id;
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${debt.name}`); remove.dataset.removeDebt = debt.id;
        actions.append(update, remove); amount.append(value, actions);
        const balanceForm = document.createElement("form");
        balanceForm.className = "debt-balance-update"; balanceForm.hidden = true; balanceForm.dataset.balanceForm = debt.id;
        balanceForm.innerHTML = `<label for="updated-balance-${escapeHtml(debt.id)}">New balance (CAD)</label><input id="updated-balance-${escapeHtml(debt.id)}" name="balance" type="number" min="0" max="10000000" step="0.01" value="${Number(debt.balance) || 0}" required><button type="submit" class="button button-secondary">Save balance</button><button type="button" class="panel-link" data-cancel-balance="${escapeHtml(debt.id)}">Cancel</button>`;
        row.append(icon, detail, amount, balanceForm); list.append(row);
      });
    }
    const total = totalBalance(debts); const minimums = totalMinimums(debts);
    if (!state.lastPlan) {
      window.GlimApp.drawScheduleChart("debt-chart", [], "debt-chart-description");
      window.GlimApp.renderDebtCheckpoints(null);
      if ($("debt-chart-description")) $("debt-chart-description").textContent = debts.length ? "Calculate a repayment plan to see how your projected balance changes month by month." : "Add a debt and calculate a plan to see your projected payoff path.";
    }
    if ($("debt-total")) $("debt-total").textContent = money(total);
    if ($("debt-minimums")) $("debt-minimums").textContent = money(minimums);
    if ($("debt-budget-summary")) $("debt-budget-summary").textContent = money(state.monthlyBudget || 0);
    if ($("debt-budget-note")) $("debt-budget-note").textContent = (state.monthlyBudget || 0) >= minimums ? "Available for debt payments" : "Below entered minimums — review this budget";
    if ($("debt-count-tag")) $("debt-count-tag").textContent = `${debts.length} ${debts.length === 1 ? "account" : "accounts"}`;
    if ($("monthly-budget") && document.activeElement !== $("monthly-budget")) $("monthly-budget").value = Number(state.monthlyBudget) > 0 ? state.monthlyBudget : "";
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
      const result = await window.GlimClient.calculatePlan(window.GlimApp.state.debts || [], monthlyBudget, strategy);
      const state = window.GlimApp.state;
      state.monthlyBudget = monthlyBudget;
      state.strategy = strategy;
      state.lastPlan = result.selected;
      state.lastPlanComparison = result;
      await window.GlimApp.saveState();
      renderPlanResult(result);
      renderDebts();
      window.GlimApp.drawScheduleChart("debt-chart", result.selected.schedule, "debt-chart-description");
      window.GlimApp.renderDebtCheckpoints(result.selected);
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
    // A newly tracked account changes the starting portfolio against which progress is measured.
    window.GlimApp.state.baselineDebt = totalBalance(window.GlimApp.state.debts);
    recordDebtSnapshot("debt added by user; starting portfolio reset");
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
    if (!window.confirm(`Remove “${debt.name}” from your plan?`)) return;
    window.GlimApp.state.debts = window.GlimApp.state.debts.filter((item) => item.id !== debtId);
    // Removing an account from tracking is not proof that it was repaid. Reset the reward
    // baseline so deletion alone cannot qualify as debt reduction.
    window.GlimApp.state.baselineDebt = totalBalance(window.GlimApp.state.debts);
    recordDebtSnapshot("tracked account removed; progress baseline reset");
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
      window.GlimApp.renderDebtCheckpoints(state.lastPlan);
      window.GlimApp.renderOverview(state.lastPlan);
      return;
    }
    window.GlimApp.renderOverview(null);
    window.GlimApp.drawScheduleChart("debt-chart", [], "debt-chart-description");
    window.GlimApp.renderDebtCheckpoints(null);
    const desc = $("debt-chart-description");
    if (desc) desc.textContent = state.debts?.length
      ? "Calculate a repayment plan to see how your projected balance changes month by month."
      : "Add a debt and calculate a plan to see your projected payoff path.";
  }

  function recordDebtSnapshot(source = "user-confirmed balance update") {
    const state = window.GlimApp.state;
    const history = Array.isArray(state.balanceHistory) ? state.balanceHistory : [];
    const snapshot = { date: new Date().toISOString().slice(0, 10), total: totalBalance(state.debts), source };
    const existing = history.findIndex((item) => item.date === snapshot.date);
    if (existing >= 0) history[existing] = snapshot;
    else history.push(snapshot);
    state.balanceHistory = history.slice(-120);
  }

  async function updateDebtBalance(debtId, form) {
    const state = window.GlimApp.state;
    const debt = (state.debts || []).find((item) => item.id === debtId);
    const input = form.querySelector('input[name="balance"]');
    const message = $("debt-import-message");
    const balance = Number(input?.value);
    if (!debt || !Number.isFinite(balance) || balance < 0 || balance > 10000000) {
      if (message) { message.textContent = "Enter a balance between $0 and $10,000,000."; message.className = "form-message is-error"; }
      window.GlimApp.toast("Enter a valid balance amount."); return;
    }
    debt.balance = Math.round(balance * 100) / 100;
    debt.sample = false;
    debt.balance_checked_at = new Date().toISOString();
    if (!Number.isFinite(Number(state.baselineDebt)) || Number(state.baselineDebt) <= 0) state.baselineDebt = totalBalance(state.debts);
    state.lastPlan = null; state.lastPlanComparison = null;
    recordDebtSnapshot("user-confirmed balance update");
    try {
      await window.GlimApp.saveState();
      form.hidden = true;
      renderDebts();
      window.GlimApp.renderAll();
      if ($("plan-results")) $("plan-results").hidden = true;
      window.GlimApp.toast("Balance updated. Confirmed by you, not synced with the lender.");
    } catch (error) { window.GlimApp.toast(`Could not save the balance update: ${error.message}`); }
  }

  function parseCsvLine(line) {
    const values = []; let value = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { values.push(value.trim()); value = ""; }
      else value += ch;
    }
    if (quoted) throw new Error("The CSV contains an unmatched quotation mark.");
    values.push(value.trim());
    return values;
  }

  async function importCsvFile(file) {
    const output = $("debt-import-message");
    const report = (text, error = false) => { if (output) { output.textContent = text; output.className = `form-message ${error ? "is-error" : "is-success"}`; } };
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { report("The CSV is larger than 2 MB. Export a smaller file and try again.", true); return; }
    try {
      const text = await file.text();
      const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error("The CSV needs a header and at least one debt row.");
      const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, ""));
      const required = ["name", "balance", "apr", "minimum_payment"];
      const missing = required.filter((header) => !headers.includes(header));
      if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}. Required: name, balance, apr, minimum_payment. Optional: type, due_date.`);
      const column = (row, name) => row[headers.indexOf(name)] ?? "";
      const imported = []; const rejected = [];
      const rowsToProcess = Math.min(lines.length - 1, 100);
      for (let i = 1; i <= rowsToProcess; i++) {
        const row = parseCsvLine(lines[i]);
        const name = column(row, "name").trim();
        const balance = Number(column(row, "balance"));
        const apr = Number(column(row, "apr"));
        const minimum = Number(column(row, "minimum_payment"));
        const dueDate = column(row, "due_date").trim();
        const dueDateValid = !dueDate || (/^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !Number.isNaN(new Date(`${dueDate}T12:00:00`).getTime()) && new Date(`${dueDate}T12:00:00`).toISOString().slice(0, 10) === dueDate);
        if (!name || !Number.isFinite(balance) || balance < 0 || balance > 10000000 || !Number.isFinite(apr) || apr < 0 || apr > 100 || !Number.isFinite(minimum) || minimum < 0 || minimum > 10000000 || !dueDateValid) {
          rejected.push(i + 1); continue;
        }
        imported.push({
          id: id(), name: name.slice(0, 100), type: (column(row, "type") || "Credit card").slice(0, 40),
          balance: Math.round(balance * 100) / 100, apr: Math.round(apr * 10000) / 10000,
          minimum_payment: Math.round(minimum * 100) / 100, due_date: dueDate || null,
          sample: false, source: "csv-imported"
        });
      }
      if (!imported.length) throw new Error("No valid debt rows were found. Check the required columns and numeric values.");
      const state = window.GlimApp.state;
      const existing = state.debts || [];
      const sampleDebts = existing.filter((item) => item.sample);
      const userDebts = existing.filter((item) => !item.sample);
      if (userDebts.length + imported.length > 100) throw new Error("Glim supports up to 100 tracked debts. Remove an entry before importing more.");
      // Seed records are examples, not real user accounts. Remove them on the first import,
      // including when the user has already added a real account alongside the examples.
      state.debts = [...userDebts, ...imported];
      if (previousExampleDebts.length || existing.length === 0) state.balanceHistory = [];
      state.baselineDebt = totalBalance(state.debts);
      state.lastPlan = null; state.lastPlanComparison = null;
      recordDebtSnapshot("CSV-imported balances; user-provided");
      await window.GlimApp.saveState();
      renderDebts(); window.GlimApp.renderOverview(null); if ($("plan-results")) $("plan-results").hidden = true;
      report(`Imported ${imported.length} debt ${imported.length === 1 ? "row" : "rows"}. Review the balances, rates, and minimum payments before calculating a plan.${rejected.length ? ` Skipped invalid rows: ${rejected.join(", ")}.` : ""}${lines.length - 1 > rowsToProcess ? ` Only the first ${rowsToProcess} CSV data rows were reviewed.` : ""}`);
      window.GlimApp.toast(`${imported.length} debt entries imported. Verify all figures against your statements.`);
    } catch (error) { report(error.message || "Could not read this CSV file.", true); }
  }

  function init() {
    $("add-debt-toggle")?.addEventListener("click", () => { const form = $("debt-form"); if (form.hidden) openForm(); else closeForm(); });
    $("cancel-debt-form")?.addEventListener("click", closeForm);
    $("cancel-debt-form-secondary")?.addEventListener("click", closeForm);
    $("debt-form")?.addEventListener("submit", addDebt);
    $("plan-form")?.addEventListener("submit", runPlan);
    $("debts-list")?.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-debt]");
      const edit = event.target.closest("[data-edit-balance]");
      const cancel = event.target.closest("[data-cancel-balance]");
      if (remove) removeDebt(remove.dataset.removeDebt);
      if (edit) {
        const form = document.querySelector(`[data-balance-form="${CSS.escape(edit.dataset.editBalance)}"]`);
        if (form) { form.hidden = !form.hidden; if (!form.hidden) form.querySelector("input")?.focus(); }
      }
      if (cancel) { const form = document.querySelector(`[data-balance-form="${CSS.escape(cancel.dataset.cancelBalance)}"]`); if (form) form.hidden = true; }
    });
    $("debts-list")?.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-balance-form]");
      if (form) { event.preventDefault(); updateDebtBalance(form.dataset.balanceForm, form); }
    });
    $("import-debt-csv")?.addEventListener("click", () => $("debt-csv-file")?.click());
    $("debt-csv-file")?.addEventListener("change", (event) => { importCsvFile(event.target.files?.[0]); event.target.value = ""; });
  }

  window.GlimDebt = { init, render: renderDebts, previewCharts, runPlan, totalBalance, totalMinimums, durationText, importCsvFile, updateDebtBalance, recordDebtSnapshot };
})();
