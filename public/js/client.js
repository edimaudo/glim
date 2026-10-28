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

  window.GlimClient = {
    health: () => request("/health"),
    sessionStatus: () => request("/session/status"),
    createSession: (name, email) => request("/session", { method: "POST", body: JSON.stringify({ name, email }) }),
    currentSession: () => request("/session"),
    deleteSession: () => request("/session", { method: "DELETE" }),
    calculatePlan: (debts, monthly_budget, selected_strategy) => request("/debt/plan", { method: "POST", body: JSON.stringify({ debts, monthly_budget, selected_strategy }) }),
    compareProducts: (payload) => request("/products/compare", { method: "POST", body: JSON.stringify(payload) }),
    askCoach: (question, context, tone, mode) => request("/coach", { method: "POST", body: JSON.stringify({ question, context, tone, mode }) }),
    integrationStatus: () => request("/integrations/status"),
    rewardIdeas: (interest_tags = []) => request("/rewards/recommendations", { method: "POST", body: JSON.stringify({ interest_tags }) }),
    claimReward: (milestone_key, recipient_email, evidence, client_claim_id) => request("/rewards/claim", { method: "POST", body: JSON.stringify({ milestone_key, recipient_email, evidence, client_claim_id }) }),
    payoutStatus: (batchId) => request(`/rewards/status/${encodeURIComponent(batchId)}`),
  };
})();
