(function () {
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const id = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `goal-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function render() {
    if (!window.GlimApp?.state) return;
    const goals = window.GlimApp.state.savingsGoals || [];
    const saved = goals.reduce((sum, goal) => sum + Math.max(0, Number(goal.current) || 0), 0);
    const target = goals.reduce((sum, goal) => sum + Math.max(0, Number(goal.target) || 0), 0);
    if ($("savings-total")) $("savings-total").textContent = money(saved);
    if ($("savings-target-label")) $("savings-target-label").textContent = `toward ${money(target)} in goals`;
    const totalPct = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
    if ($("savings-encouragement")) $("savings-encouragement").textContent = goals.length ? `${totalPct}% of your combined savings targets. A steady contribution can matter more than a perfect month.` : "Start with one goal that feels useful and realistic.";

    const container = $("savings-goals");
    if (!container) return;
    container.innerHTML = "";
    if (!goals.length) {
      container.innerHTML = '<div class="panel empty-state"><strong>No savings goals yet</strong>Add a target and a contribution that fits your current budget.</div>';
      return;
    }
    goals.forEach((goal) => {
      const current = Math.max(0, Number(goal.current) || 0);
      const goalTarget = Math.max(0, Number(goal.target) || 0);
      const contribution = Math.max(0, Number(goal.monthly_contribution) || 0);
      const pct = goalTarget > 0 ? Math.min(100, Math.round(current / goalTarget * 100)) : 0;
      const needed = Math.max(0, goalTarget - current);
      const months = contribution > 0 ? Math.ceil(needed / contribution) : null;
      const card = document.createElement("article");
      card.className = "goal-card";
      card.innerHTML = `
        <div class="goal-card-header"><div><div class="goal-card-icon" aria-hidden="true">${goal.name.toLowerCase().includes("emergency") ? "◉" : "✳"}</div><h2>${escapeHtml(goal.name)}</h2><p>${contribution > 0 ? `${money(contribution)} planned per month` : "No monthly contribution set"}</p></div><span class="soft-tag">${pct}%</span></div>
        <div class="goal-card-amount"><strong>${money(current)}</strong><span>of ${money(goalTarget)}</span></div>
        <div class="goal-progress-track" role="progressbar" aria-label="${escapeHtml(goal.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
        <div class="goal-card-footer"><span>${needed <= 0 ? "Goal reached" : months === null ? `${money(needed)} remaining` : `About ${months} ${months === 1 ? "month" : "months"} at this pace`}</span><button type="button" data-goal-edit="${escapeHtml(goal.id)}">Update progress</button></div>
        <div class="goal-edit-controls" id="goal-edit-${escapeHtml(goal.id)}" hidden><label class="visually-hidden" for="goal-current-${escapeHtml(goal.id)}">Current saved amount for ${escapeHtml(goal.name)}</label><input id="goal-current-${escapeHtml(goal.id)}" type="number" min="0" max="10000000" step="1" value="${current}" aria-label="Current saved amount for ${escapeHtml(goal.name)}"><button class="button button-secondary" data-goal-save="${escapeHtml(goal.id)}" type="button">Save</button></div>`;
      container.append(card);
    });
  }

  function openForm() {
    const formCard = $("goal-form-card");
    if (formCard) { formCard.hidden = false; $("goal-name")?.focus(); }
  }
  function closeForm() {
    const formCard = $("goal-form-card");
    if (formCard) formCard.hidden = true;
    $("goal-form")?.reset();
  }
  async function addGoal(event) {
    event.preventDefault();
    const name = $("goal-name").value.trim();
    const target = Number($("goal-target").value);
    const current = Number($("goal-current").value);
    const contribution = Number($("goal-monthly").value);
    if (!name || target <= 0 || current < 0 || contribution < 0) { window.GlimApp.toast("Check the savings goal details and try again."); return; }
    window.GlimApp.state.savingsGoals.push({ id: id(), name, target, current, monthly_contribution: contribution, sample: false });
    try {
      await window.GlimApp.saveState(); closeForm(); render(); window.GlimApp.renderOverview(); window.GlimApp.toast("Savings goal added.");
    } catch (error) { window.GlimApp.toast(`Could not save savings goal: ${error.message}`); }
  }
  async function saveProgress(goalId) {
    const input = $(`goal-current-${goalId}`);
    if (!input) return;
    const value = Number(input.value);
    if (value < 0 || !Number.isFinite(value)) { window.GlimApp.toast("Enter a valid saved amount."); return; }
    const goal = (window.GlimApp.state.savingsGoals || []).find((item) => item.id === goalId);
    if (!goal) return;
    goal.current = value;
    goal.starter = false;
    try { await window.GlimApp.saveState(); render(); window.GlimApp.renderOverview(); window.GlimApp.toast("Savings progress updated."); }
    catch (error) { window.GlimApp.toast(`Could not save progress: ${error.message}`); }
  }

  function init() {
    $("add-goal-toggle")?.addEventListener("click", openForm);
    $("cancel-goal-form")?.addEventListener("click", closeForm);
    $("cancel-goal-form-secondary")?.addEventListener("click", closeForm);
    $("goal-form")?.addEventListener("submit", addGoal);
    $("savings-goals")?.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-goal-edit]");
      const save = event.target.closest("[data-goal-save]");
      if (edit) {
        const controls = $(`goal-edit-${edit.dataset.goalEdit}`);
        if (controls) { controls.hidden = !controls.hidden; if (!controls.hidden) controls.querySelector("input")?.focus(); }
      }
      if (save) saveProgress(save.dataset.goalSave);
    });
  }

  window.GlimSavings = { init, render };
})();
