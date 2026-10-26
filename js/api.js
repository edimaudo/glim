(function () {
  async function request(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (!response.ok) {
      const detail = payload.detail || payload.message || `Request failed (${response.status}).`;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return payload;
  }

  window.GlimAPI = {
    health: () => request("/api/health"),
    getState: () => request("/api/state"),
    saveState: (state) => request("/api/state", { method: "PUT", body: JSON.stringify({ state }) }),
    calculatePlan: (debts, monthly_budget, selected_strategy) => request("/api/debt/plan", { method: "POST", body: JSON.stringify({ debts, monthly_budget, selected_strategy }) }),
    askCoach: (question, context, tone, mode) => request("/api/coach", { method: "POST", body: JSON.stringify({ question, context, tone, mode }) }),
    integrationStatus: () => request("/api/integrations/status"),
    rewardIdeas: (interest_tags = []) => request("/api/rewards/recommendations", { method: "POST", body: JSON.stringify({ interest_tags }) }),
    claimReward: (milestone_key, recipient_email) => request("/api/rewards/claim", { method: "POST", body: JSON.stringify({ milestone_key, recipient_email }) }),
    resetDemo: () => request("/api/reset-demo", { method: "POST", body: "{}" }),
  };
})();
