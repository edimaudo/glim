from fastapi.testclient import TestClient

from app import app


def test_pages_assets_and_no_openapi_routes():
    with TestClient(app) as client:
        landing = client.get("/")
        assert landing.status_code == 200
        assert "Glim" in landing.text
        assert "{% extends" not in landing.text
        signin = client.get("/signin")
        assert signin.status_code == 200
        assert signin.text.count("<html") == 1
        assert "Sign in — Glim" in signin.text
        app_page = client.get("/app")
        assert app_page.status_code == 200
        assert "Your plan — Glim" in app_page.text
        missing = client.get("/definitely-not-a-real-page")
        assert missing.status_code == 404
        assert "Page not found" in missing.text
        assert "Back to home" in missing.text
        assert missing.headers["content-type"].startswith("text/html")
        assert client.get("/css/styles.css").status_code == 200
        assert client.get("/js/main.js").status_code == 200
        assert client.get("/js/client.js").status_code == 200
        assert client.get("/health").json()["status"] == "ok"
        # The application has no /api prefix and no public OpenAPI docs routes.
        for path in ("/api/health", "/api/docs", "/api/openapi.json", "/docs", "/openapi.json", "/session/status"):
            assert client.get(path).status_code == 404


def test_no_server_side_financial_state_endpoint():
    with TestClient(app) as client:
        assert client.get("/state").status_code == 404
        assert client.put("/state", json={"debts": []}).status_code == 404


def test_demo_session_is_signed_http_only_and_expires_by_max_age():
    with TestClient(app) as client:
        assert client.get("/session").status_code == 401
        created = client.post("/session", json={"name": "Alex Morgan", "email": "Alex@example.com"})
        assert created.status_code == 200
        assert created.json()["profile"]["email"] == "alex@example.com"
        cookie = created.headers.get("set-cookie", "").lower()
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert "max-age=28800" in cookie
        assert client.get("/session").json()["profile"]["name"] == "Alex Morgan"
        signed_out = client.delete("/session")
        assert signed_out.status_code == 200
        assert client.get("/session").status_code == 401


def test_session_input_is_validated_without_request_model_classes():
    with TestClient(app) as client:
        assert client.post("/session", json={"name": "", "email": "bad"}).status_code == 422
        assert client.post("/session", content="not json", headers={"content-type": "application/json"}).status_code == 400


def test_missing_production_session_secret_returns_generic_customer_safe_error(monkeypatch):
    import app as application

    monkeypatch.setattr(application, "_SESSION_SECRET", "")
    with TestClient(application.app) as client:
        assert client.get("/session/status").status_code == 404
        response = client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        assert response.status_code == 503
        detail = response.json()["detail"]
        assert detail == "We could not start your session. Please try again later."
        assert "GLIM_SESSION_SECRET" not in detail
        assert "Vercel" not in detail


def test_coach_and_integration_routes_require_demo_session():
    with TestClient(app) as client:
        assert client.post("/coach", json={"question": "How does APR work?"}).status_code == 401
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        coach = client.post("/coach", json={"question": "How does APR work?", "context": {"debts": []}})
        assert coach.status_code == 200
        assert coach.json()["reply"]
        status = client.get("/integrations/status")
        assert status.status_code == 200
        assert status.json()["financial_data_storage"] == "browser IndexedDB"


def test_product_compare_uses_user_entered_terms():
    products = [
        {"name": "Account A", "annual_rate": 3.0, "annual_fee": 0, "monthly_fee": 0},
        {"name": "Account B", "annual_rate": 2.0, "annual_fee": 0, "monthly_fee": 0},
    ]
    with TestClient(app) as client:
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/products/compare", json={"category": "savings", "balance": 1000, "products": products})
        assert response.status_code == 200
        assert response.json()["products"][0]["name"] == "Account A"
        assert "Verify current terms" in response.json()["notice"]


def test_reward_requires_demo_session_and_valid_milestone():
    payload = {"milestone_key": "savings_goal_reached", "recipient_email": "sandbox@example.com", "evidence": {"target": 100, "current": 10}, "client_claim_id": "claim-00000001"}
    with TestClient(app) as client:
        assert client.post("/rewards/claim", json=payload).status_code == 401
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/rewards/claim", json=payload)
        assert response.status_code == 409


def test_paypal_claim_reports_missing_sandbox_configuration(monkeypatch):
    monkeypatch.delenv("PAYPAL_CLIENT_ID", raising=False)
    monkeypatch.delenv("PAYPAL_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("PAYPAL_ENV", "sandbox")
    payload = {
        "milestone_key": "savings_goal_reached",
        "recipient_email": "sandbox@example.com",
        "evidence": {"target": 100, "current": 100},
        "client_claim_id": "claim-no-creds-0001",
    }
    with TestClient(app) as client:
        assert client.post("/rewards/claim", json=payload).status_code == 401
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/rewards/claim", json=payload)
        assert response.status_code == 503
        assert "PayPal Sandbox is not configured" in response.json()["detail"]


def test_paypal_reward_uses_fixed_amount_after_guardrail(monkeypatch):
    import app as application

    monkeypatch.setenv("PAYPAL_ENV", "sandbox")
    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET", "sandbox-secret")
    captured = {}

    async def fake_payout(recipient_email, amount_cad, client_claim_id):
        captured.update({"recipient_email": recipient_email, "amount_cad": amount_cad, "client_claim_id": client_claim_id})
        return {"provider": "paypal-sandbox", "payout_batch_id": "batch-demo", "batch_status": "PENDING", "amount": {"value": amount_cad, "currency": "CAD"}, "notice": "Sandbox request submitted."}

    monkeypatch.setattr(application, "create_sandbox_payout", fake_payout)
    payload = {
        "milestone_key": "debt_reduction_10",
        "recipient_email": "sandbox@example.com",
        "evidence": {"baseline_balance": 1000, "current_balance": 900},
        "client_claim_id": "claim-guardrail-0001",
    }
    with TestClient(application.app) as client:
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/rewards/claim", json=payload)
    assert response.status_code == 200
    assert captured["amount_cad"] == "1.00"  # client cannot set the payout amount
    assert response.json()["guardrail"]["check"] == "passed"
    assert response.json()["guardrail"]["currency"] == "CAD"


def test_paypal_status_requires_session_and_reports_unconfigured_sandbox(monkeypatch):
    monkeypatch.delenv("PAYPAL_CLIENT_ID", raising=False)
    monkeypatch.delenv("PAYPAL_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("PAYPAL_ENV", "sandbox")
    with TestClient(app) as client:
        assert client.get("/rewards/status/GLIM-batch-123").status_code == 401
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.get("/rewards/status/GLIM-batch-123")
        assert response.status_code == 503
        assert "PayPal Sandbox is not configured" in response.json()["detail"]


def test_qloo_recommendations_have_local_fallback_and_allowlist(monkeypatch):
    monkeypatch.delenv("QLOO_API_KEY", raising=False)
    with TestClient(app) as client:
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/rewards/recommendations", json={"interest_tags": ["urn:tag:genre:media:nonfiction"]})
        assert response.status_code == 200
        assert response.json()["provider"] == "starter-ideas"
        assert response.json()["configured"] is False
        invalid = client.post("/rewards/recommendations", json={"interest_tags": ["urn:tag:person:real-person"]})
        assert invalid.status_code == 422


def test_entrypoint_does_not_require_public_assets_or_vercel_env(tmp_path):
    """Vercel serves public/ through its CDN; the function bundle may omit it."""
    import os
    import shutil
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    shutil.copy2(project_root / "app.py", tmp_path / "app.py")
    shutil.copytree(project_root / "services", tmp_path / "services")
    shutil.copytree(project_root / "templates", tmp_path / "templates")
    # Intentionally do not copy public/.
    env = os.environ.copy()
    env.pop("VERCEL", None)
    env.pop("VERCEL_ENV", None)
    env.pop("GLIM_LOCAL_STATIC", None)
    env["PYTHONPATH"] = str(tmp_path)
    result = subprocess.run(
        [sys.executable, "-c", "import app; assert app.app is not None; assert not any(getattr(r, 'name', '') in {'css', 'js'} for r in app.app.routes)"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_indexeddb_schema_repairs_old_profiles_store_and_hides_low_level_errors():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    storage = (root / "public/js/storage.js").read_text()
    signin = (root / "public/js/signin.js").read_text()
    main = (root / "public/js/main.js").read_text()
    signin_template = (root / "templates/signin.html").read_text()
    app_template = (root / "templates/app.html").read_text()

    # Version 2 upgrades databases from the first build. If a database still exists
    # without the expected store, the opener explicitly performs a repair upgrade.
    assert "const DB_VERSION = 2;" in storage
    assert "openAtVersion(repairVersion).then(finishResolve, finishReject)" in storage
    assert 'db.createObjectStore(STORE, { keyPath: "key" })' in storage

    # Sign-in and workspace errors must not render browser exception details.
    assert "We couldn’t open Glim right now. Please try again in a moment." in signin
    assert "message.textContent = error.message" not in signin
    assert "Glim couldn't open your saved information. Please refresh the page and try again." in main
    assert "${error.message}" not in main[main.index("Glim could not initialize browser-local data"):]

    # Versioned asset URLs prevent a cached old script from continuing to show raw errors.
    assert "/js/storage.js?v=20261030-starter-profile-1" in signin_template
    assert "/js/storage.js?v=20261030-starter-profile-1" in app_template


def test_signed_in_interface_removes_demo_banners_and_import_instructions():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    signin_template = (root / "templates/signin.html").read_text()
    storage = (root / "public/js/storage.js").read_text()

    assert "Demo mode" not in app_template
    assert "Prototype with sample data" not in app_template
    assert "No real accounts are connected" not in app_template
    assert "CSV columns:" not in app_template
    assert "temporary demo session" not in signin_template
    assert "sample financial data" not in signin_template
    assert "debts: []," in storage
    assert "savingsGoals: []," in storage
    assert "previousDebts.filter((item) => !item.sample)" in storage
    assert "previousGoals.filter((item) => !item.sample)" in storage


def test_finwise_literacy_experience_has_assessment_level_quiz_and_searchable_glossary():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    literacy_js = (root / "public/js/literacy.js").read_text()

    assert "Learn at your pace" not in app_template
    assert "quick check-in" not in app_template.lower()
    assert "Learning paths" not in app_template
    assert "Quick knowledge check" not in app_template
    for element in ("assessment-panel", "quiz-level", "practice-quiz-panel", "glossary-search", "glossary-results"):
        assert element in app_template
    for level in ("novice", "intermediate", "advanced"):
        assert f'{level}:' in literacy_js
    assert "startAssessment" in literacy_js
    assert "submitPracticeQuiz" in literacy_js
    assert "TFSA" in literacy_js and "RRSP" in literacy_js and "FHSA" in literacy_js


def test_shared_contextual_coach_is_available_in_every_app_section():
    from pathlib import Path
    import re

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    for view in ("debt", "savings", "literacy", "settings"):
        match = re.search(rf'<section class="app-view"[^>]*data-view-panel="{view}"[\s\S]*?(?=<section class="app-view"|<\/main>)', app_template)
        assert match, f"Missing section {view}"
        assert "data-open-coach" in match.group(0), f"Missing contextual coach in {view}"
    assert 'id="coach-dialog"' in app_template
    assert 'active_section: app.activeView || "overview"' in (root / "public/js/main.js").read_text()


def test_projected_payoff_chart_is_explained_and_no_confusing_history_chart_remains():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    main_js = (root / "public/js/main.js").read_text()
    debt_js = (root / "public/js/debt.js").read_text()

    assert "Projected payoff path" in app_template
    assert "Monthly balance projection" in app_template
    assert 'id="debt-chart-checkpoints"' in app_template
    assert "debt-history-chart" not in app_template
    assert "renderDebtCheckpoints" in main_js
    assert "Today" in main_js and "months" in main_js
    assert "Calculate a repayment plan to see how your projected balance changes month by month." in debt_js


def test_dashboard_defaults_are_blank_and_obsolete_demo_copy_is_removed():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    settings = (root / "public/js/settings.js").read_text()
    main = (root / "public/js/main.js").read_text()
    storage = (root / "public/js/storage.js").read_text()

    assert '<strong id="savings-total">$0</strong>' in app_template
    assert "reset-profile-data" in app_template and "reset-demo-data" not in app_template
    assert "Prototype with sample data" not in app_template
    assert "manually entered demo data" not in app_template
    assert "sample plan is ready" not in settings
    assert "reset to sample data" not in settings
    assert 'state.monthlyBudget = 0' in storage
    assert "Projected payoff path" in app_template
    assert "renderDebtCheckpoints" in main


def test_no_fabricated_financial_values_or_storage_implementation_copy_in_ui():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    landing = (root / "templates/index.html").read_text()
    debt_js = (root / "public/js/debt.js").read_text()
    savings_js = (root / "public/js/savings.js").read_text()

    assert '$680' not in app_template
    assert '$1,240' not in landing
    assert '+12%' not in landing
    assert '· Sample' not in debt_js and '· Sample' not in savings_js
    assert 'Data remains in IndexedDB.' not in debt_js
    assert 'Glim stores your financial records in this browser using IndexedDB.' not in app_template
    assert 'Download a backup before resetting your profile' in app_template
    # The landing preview should describe capabilities rather than fabricated results.
    assert 'Compare payoff strategies' in landing
    assert 'Choose a realistic contribution' in landing


def test_landing_page_keeps_navigation_targets_and_avoids_fabricated_financial_results():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    landing = (root / "templates/index.html").read_text()
    assert 'id="how-it-works"' in landing
    assert 'href="#how-it-works"' in landing
    assert 'id="built-for-real-life"' in landing
    assert 'value-strip' in landing and 'how-cards' in landing
    assert '$1,240' not in landing and '+12%' not in landing
    assert 'literacy-tool-number' not in (root / "templates/app.html").read_text()


def test_unplanned_charts_show_a_clear_empty_state_instead_of_blank_axes():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    main = (root / "public/js/main.js").read_text()
    css = (root / "public/css/styles.css").read_text()
    assert 'canvas.hidden = !hasProjection' in main
    assert 'classList.toggle("is-empty", !hasProjection)' in main
    assert '.chart-wrap.is-empty { min-height: 0; }' in css
    assert 'No projection yet' not in main


def test_financial_coach_and_rewards_keep_provider_setup_details_out_of_user_copy(monkeypatch):
    from pathlib import Path
    import asyncio
    from services.gemini_coach import get_coach_response
    from services.qloo_personalization import get_reward_ideas

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("QLOO_API_KEY", raising=False)
    coach = asyncio.run(get_coach_response("How should I approach debt repayment?", {"debts": []}))
    rewards = asyncio.run(get_reward_ideas(["urn:tag:genre:media:nonfiction"]))
    assert "demo" not in coach["reply"].lower()
    assert "GEMINI_API_KEY" not in coach["notice"]
    assert "configured" not in coach["notice"].lower()
    assert "Qloo is not configured" not in rewards["notice"]
    assert "QLOO_API_KEY" not in rewards["notice"]

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    main = (root / "public/js/main.js").read_text()
    safety = (root / "services/financial_safety.py").read_text()
    assert "Glim does not connect to your card issuer" not in app_template
    assert "Reward payouts are optional and require a configured PayPal Sandbox" not in app_template
    assert "This response uses Glim’s built-in guidance." in (root / "services/gemini_coach.py").read_text()
    assert "Reward ideas are unavailable right now. Please try again later." in main
    assert "user-entered/sample data" not in safety


def test_contextual_glim_coach_exists_on_overview_and_each_section():
    from pathlib import Path
    import re

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    for view in ("overview", "debt", "savings", "literacy", "settings"):
        match = re.search(rf'<section class="app-view[^>]*data-view-panel="{view}"[\s\S]*?(?=<section class="app-view"|</main>)', app_template)
        assert match, f"Missing section {view}"
        content = match.group(0)
        assert "data-open-coach" in content or 'id="coach-form"' in content, f"Missing coach in {view}"
    main = (root / "public/js/main.js").read_text()
    assert 'active_section: app.activeView || "overview"' in main
    assert 'button.closest("[data-view-panel]")?.dataset.viewPanel' in main



def test_landing_header_is_minimal_and_logo_has_no_separate_g_mark():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    landing = (root / "templates/index.html").read_text()
    signin = (root / "templates/signin.html").read_text()
    app_template = (root / "templates/app.html").read_text()

    header = landing.split("<header", 1)[1].split("</header>", 1)[0]
    assert "How it works" not in header
    assert "Built for real life" not in header
    assert "Ask your coach" not in header
    assert 'class="brand-mark"' not in landing + signin + app_template + (root / "templates/404.html").read_text()
    assert 'class="card-mark"' not in signin
    assert "Clear steps, not judgment. You stay in control." not in landing


def test_app_keeps_payment_provider_backend_only_and_uses_generic_milestones():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates/app.html").read_text()
    main_js = (root / "public/js/main.js").read_text()
    css = (root / "public/css/styles.css").read_text()
    all_ui = "\n".join(path.read_text() for folder in (root / "templates", root / "public/js") for path in folder.rglob("*.*"))

    # Provider choice and test-environment details are implementation concerns, not UI copy.
    assert "PayPal" not in all_ui
    assert "Sandbox" not in all_ui
    assert "sandbox" not in all_ui.lower()
    assert "Payment integration" not in app_template
    assert "PayPal" not in css and "sandbox-label" not in css

    for size in ("small", "medium", "large"):
        assert f'data-font-size="{size}"' in app_template
    assert 'aria-label="Text size"' in app_template
    assert "font-size-control" in css
    assert 'id="savings-tab-milestones"' in app_template
    assert '>Milestones</button>' in app_template
    assert 'data-reward-scope="debt"' in app_template
    assert 'data-reward-scope="savings"' in app_template
    assert 'data-reward-scope="any"' in app_template
    assert 'id="debt-milestone-message"' in app_template
    assert 'id="savings-milestone-message"' in app_template
    assert 'id="claim-reward"' in app_template
    assert 'id="reward-history"' in app_template
    assert 'GlimClient.claimReward' in main_js
    assert 'GlimClient.payoutStatus' in main_js
    assert 'data-refresh-reward' in main_js
    assert 'button.dataset.refreshReward' in main_js
    assert 'button.dataset.refreshPayout' not in main_js
    assert 'validate_reward_milestone' in (root / "app.py").read_text()


def test_app_primary_buttons_share_one_consistent_design_system():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    css = (root / "public/css/styles.css").read_text()
    app_template = (root / "templates/app.html").read_text()

    assert ".app-page .button {" in css
    assert "min-height: 42px" in css
    assert "border-radius: 9px" in css
    assert ".app-page .button-primary,\n.app-page .button-dark" in css
    assert ".app-page .button-secondary" in css
    assert ".app-page .button-ghost" in css
    assert ".app-page .plain-icon-button,\n.app-page .icon-button" in css
    # Primary actions use the shared button class; tabs/chips remain separate controls.
    assert app_template.count('class="button button-primary') >= 8
    assert app_template.count('class="button button-secondary') >= 8



def test_main_workspace_uses_accessible_tabbed_sections_without_duplicate_ids():
    from collections import Counter
    from html.parser import HTMLParser
    from pathlib import Path

    class WorkspaceParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.ids = []
            self.tabs = []
            self.panels = []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if attrs.get("id"):
                self.ids.append(attrs["id"])
            if attrs.get("role") == "tab":
                self.tabs.append(attrs)
            if attrs.get("role") == "tabpanel":
                self.panels.append(attrs)

    with TestClient(app) as client:
        response = client.get("/app")
    assert response.status_code == 200

    parser = WorkspaceParser()
    parser.feed(response.text)
    assert len(parser.tabs) == 18
    assert len(parser.panels) == 18
    assert not [key for key, count in Counter(parser.ids).items() if count > 1]
    panel_ids = {panel.get("id") for panel in parser.panels}
    tab_ids = {tab.get("id") for tab in parser.tabs}
    for tab in parser.tabs:
        assert tab.get("aria-controls") in panel_ids
        assert tab.get("aria-selected") in {"true", "false"}
    for panel in parser.panels:
        assert panel.get("aria-labelledby") in tab_ids

    root = Path(__file__).resolve().parents[1]
    main_js = (root / "public/js/main.js").read_text()
    css = (root / "public/css/styles.css").read_text()
    assert "function initSectionTabs()" in main_js
    assert 'event.key === "ArrowRight"' in main_js
    assert 'event.key === "ArrowLeft"' in main_js
    assert 'id="glossary-term-count" class="soft-tag"' in (root / "templates/app.html").read_text()
    assert "data-focus-glossary" not in (root / "templates/app.html").read_text()
    assert ".section-tab.is-active" in css
    assert ".section-tab-panel[hidden] { display: none !important; }" in css


def test_debt_plan_rejects_unconfirmed_starter_terms():
    with TestClient(app) as client:
        client.post("/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/debt/plan", json={
            "debts": [{"id": "starter", "name": "Credit card debt", "balance": 10000, "apr": None, "minimum_payment": None}],
            "monthly_budget": 500,
            "selected_strategy": "avalanche",
        })
        assert response.status_code == 422
        assert "interest rate and monthly minimum payment" in response.json()["detail"]


def test_starter_profile_defaults_and_existing_data_preservation():
    import shutil
    import subprocess
    from pathlib import Path

    if not shutil.which("node"):
        import pytest
        pytest.skip("Node.js is unavailable for the browser-storage unit test")
    storage_path = Path(__file__).resolve().parents[1] / "public" / "js" / "storage.js"
    script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.argv[1], "utf8");
const context = { window: {}, console, Promise, Date, Math, setTimeout, clearTimeout, structuredClone };
vm.runInNewContext(source, context);
const storage = context.window.GlimStorage;
const fresh = storage.applyStarterPortfolio(storage.defaultState({name:"Alex", email:"alex@example.com"}));
if (fresh.debts.length !== 1 || fresh.debts[0].balance !== 10000) throw new Error("Starter debt is incorrect");
if (fresh.debts[0].apr !== null || fresh.debts[0].minimum_payment !== null) throw new Error("Debt terms must remain unconfirmed");
if (fresh.savingsGoals.length !== 1 || fresh.savingsGoals[0].current !== 1300 || fresh.savingsGoals[0].target !== 10000) throw new Error("Starter savings goal is incorrect");
if (fresh.baselineDebt !== 10000 || fresh.starterPortfolioVersion !== 1) throw new Error("Starter tracking baseline is incorrect");
const existing = storage.defaultState({name:"Sam", email:"sam@example.com"});
existing.debts = [{id:"existing", name:"Existing loan", balance:4200, apr:12.5, minimum_payment:110}];
existing.baselineDebt = 4200;
storage.applyStarterPortfolio(existing);
if (existing.debts.length !== 1 || existing.debts[0].id !== "existing" || existing.baselineDebt !== 4200) throw new Error("Existing user debt was overwritten");
if (existing.savingsGoals.length !== 1 || existing.savingsGoals[0].current !== 1300) throw new Error("Missing savings category was not initialized");
'''
    subprocess.run(["node", "-e", script, str(storage_path)], check=True, capture_output=True, text=True)


def test_app_includes_starter_profile_migration_script_and_cache_buster():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    app_template = (root / "templates" / "app.html").read_text()
    sign_in_template = (root / "templates" / "signin.html").read_text()
    storage = (root / "public" / "js" / "storage.js").read_text()
    assert "storage.js?v=20261030-starter-profile-1" in app_template
    assert "storage.js?v=20261030-starter-profile-1" in sign_in_template
    assert "applyStarterPortfolio(defaultState" in storage
    assert 'balance: 10000' in storage
    assert 'target: 10000' in storage and 'current: 1300' in storage
    assert 'apr: null' in storage and 'minimum_payment: null' in storage
    assert "starterPortfolioVersion" in storage
