(function () {
  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
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
    createSession: (name, email) => request("/api/session", { method: "POST", body: JSON.stringify({ name, email }) }),
    currentSession: () => request("/api/session"),
    deleteSession: () => request("/api/session", { method: "DELETE" }),
    calculatePlan: (debts, monthly_budget, selected_strategy) => request("/api/debt/plan", { method: "POST", body: JSON.stringify({ debts, monthly_budget, selected_strategy }) }),
    compareProducts: (payload) => request("/api/products/compare", { method: "POST", body: JSON.stringify(payload) }),
    askCoach: (question, context, tone, mode) => request("/api/coach", { method: "POST", body: JSON.stringify({ question, context, tone, mode }) }),
    integrationStatus: () => request("/api/integrations/status"),
    rewardIdeas: (interest_tags = []) => request("/api/rewards/recommendations", { method: "POST", body: JSON.stringify({ interest_tags }) }),
    claimReward: (milestone_key, recipient_email, evidence, client_claim_id) => request("/api/rewards/claim", { method: "POST", body: JSON.stringify({ milestone_key, recipient_email, evidence, client_claim_id }) }),
    payoutStatus: (batchId) => request(`/api/rewards/status/${encodeURIComponent(batchId)}`),
  };
})();
