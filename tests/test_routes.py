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
    assert "/js/storage.js?v=20261028-idb-repair-2" in signin_template
    assert "/js/storage.js?v=20261028-idb-repair-2" in app_template
