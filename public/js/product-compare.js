(function () {
  const $ = (id) => document.getElementById(id);
  const currency = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CATEGORY_LABEL = { savings: "Savings account", credit_card: "Credit card", line_of_credit: "Line of credit", personal_loan: "Personal loan" };

  function currentCategory() { return $("product-category")?.value || "savings"; }
  function updateLabels() {
    const savings = currentCategory() === "savings";
    if ($("product-rate-label")) $("product-rate-label").textContent = savings ? "Annual interest rate (%)" : "Annual borrowing rate (%)";
    if ($("product-balance-label")) $("product-balance-label").textContent = savings ? "Savings balance to compare (CAD)" : "Borrowing balance to compare (CAD)";
  }
  function productsForCategory(category = currentCategory()) {
    return (window.GlimApp?.state?.productComparisons || []).filter((item) => item.category === category);
  }
  function renderSavedOptions() {
    const result = $("product-comparison-results");
    if (!result || !window.GlimApp?.state) return;
    const options = productsForCategory();
    if (!options.length) { result.innerHTML = '<p class="small-help">Add two offers from the same product category to compare estimated year-one interest and fees.</p>'; return; }
    result.innerHTML = `<div class="saved-product-options"><strong>Saved ${esc(CATEGORY_LABEL[currentCategory()])} offers (${options.length})</strong><div class="saved-product-list">${options.map((item) => `<div class="saved-product-item"><span><strong>${esc(item.name)}</strong><small>${esc(item.provider || "Provider not entered")} · ${Number(item.annual_rate).toFixed(2)}% annual rate</small></span><button type="button" class="panel-link" data-remove-product="${esc(item.id)}" aria-label="Remove ${esc(item.name)}">Remove</button></div>`).join("")}</div></div>`;
    if (options.length >= 2) compareSaved();
  }
  async function compareSaved() {
    const result = $("product-comparison-results");
    const options = productsForCategory();
    if (!result || options.length < 2) return;
    const balance = Number($("product-balance")?.value || 0);
    result.insertAdjacentHTML("beforeend", '<p class="small-help" data-compare-status>Calculating comparable estimates…</p>');
    try {
      const comparison = await window.GlimClient.compareProducts({ category: currentCategory(), balance, products: options });
      const status = result.querySelector("[data-compare-status]"); if (status) status.remove();
      const cards = comparison.products.map((item, index) => `<article class="product-result ${index === 0 ? "is-best" : ""}"><div class="product-result-heading"><div><span class="soft-tag">${index === 0 ? "Best by this estimate" : `Option ${index + 1}`}</span><h3>${esc(item.name)}</h3><p>${esc(item.provider || "Provider not entered")}</p></div><strong>${currency(item.estimated_annual_value)}<small>${currentCategory() === "savings" ? "estimated net value / year" : "estimated cost / year"}</small></strong></div><dl><div><dt>Rate used for estimate</dt><dd>${Number(item.estimated_year_one_rate).toFixed(2)}%</dd></div><div><dt>Fees over 12 months</dt><dd>${currency(item.annual_fees)}</dd></div><div><dt>Gross interest</dt><dd>${currency(item.estimated_gross_interest)}</dd></div></dl>${item.product_url ? `<a href="${esc(item.product_url)}" target="_blank" rel="noopener noreferrer">Open official product page</a>` : ""}</article>`).join("");
      result.insertAdjacentHTML("beforeend", `<section class="product-comparison-output"><h3>Comparison for ${currency(comparison.comparison_balance)}</h3><p>${esc(comparison.direction)}.</p><div class="product-result-grid">${cards}</div><p class="small-help">${esc(comparison.notice)}</p></section>`);
    } catch (error) {
      const status = result.querySelector("[data-compare-status]"); if (status) status.textContent = error.message;
      else result.insertAdjacentHTML("beforeend", `<p class="form-message is-error">${esc(error.message)}</p>`);
    }
  }
  function collectOption() {
    const promoRaw = $("product-promo-rate").value.trim();
    const postRaw = $("product-post-promo-rate").value.trim();
    const url = $("product-url").value.trim();
    return {
      id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `product-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      category: currentCategory(),
      name: $("product-name").value.trim(), provider: $("product-provider").value.trim(),
      annual_rate: Number($("product-rate").value), annual_fee: Number($("product-annual-fee").value || 0), monthly_fee: Number($("product-monthly-fee").value || 0),
      promo_rate: promoRaw ? Number(promoRaw) : null, promo_months: Number($("product-promo-months").value || 0),
      post_promo_rate: postRaw ? Number(postRaw) : null,
      product_url: url.startsWith("https://") ? url : null,
      added_at: new Date().toISOString()
    };
  }
  async function submitOption(event) {
    event.preventDefault();
    const message = $("product-message");
    const option = collectOption();
    if (!option.name || !Number.isFinite(option.annual_rate) || (option.promo_months > 0 && option.promo_rate === null)) {
      if (message) { message.textContent = "Enter a product name and valid current and promotional terms."; message.className = "form-message is-error"; }
      return;
    }
    const enteredUrl = $("product-url").value.trim();
    if (enteredUrl && !enteredUrl.startsWith("https://")) {
      if (message) { message.textContent = "Use an HTTPS official product URL or leave the field blank."; message.className = "form-message is-error"; }
      return;
    }
    const state = window.GlimApp.state;
    state.productComparisons = [...(state.productComparisons || []), option].slice(-40);
    try {
      await window.GlimApp.saveState();
      $("product-name").value = ""; $("product-provider").value = ""; $("product-url").value = "";
      if (message) { message.textContent = `Saved ${option.name}. Add at least one more ${CATEGORY_LABEL[option.category].toLowerCase()} offer to compare.`; message.className = "form-message is-success"; }
      renderSavedOptions();
    } catch (error) {
      if (message) { message.textContent = error.message; message.className = "form-message is-error"; }
    }
  }
  async function removeOption(id) {
    const state = window.GlimApp.state;
    state.productComparisons = (state.productComparisons || []).filter((item) => item.id !== id);
    await window.GlimApp.saveState(); renderSavedOptions();
  }
  async function clearCategory() {
    const state = window.GlimApp.state;
    state.productComparisons = (state.productComparisons || []).filter((item) => item.category !== currentCategory());
    await window.GlimApp.saveState(); renderSavedOptions();
    if ($("product-message")) { $("product-message").textContent = "Offers for this category were removed from this browser profile."; $("product-message").className = "form-message is-success"; }
  }
  async function init() {
    if (!$("product-form")) return;
    $("product-category").addEventListener("change", () => { updateLabels(); renderSavedOptions(); });
    $("product-balance").addEventListener("change", () => renderSavedOptions());
    $("product-form").addEventListener("submit", submitOption);
    $("clear-product-options").addEventListener("click", clearCategory);
    $("product-comparison-results").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-product]"); if (button) removeOption(button.dataset.removeProduct);
    });
    updateLabels(); renderSavedOptions();
  }
  window.GlimProducts = { init, compareSaved, renderSavedOptions };
})();
