from fastapi.testclient import TestClient

from app import app


def test_main_pages_and_static_assets_serve():
    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert "Glim" in client.get("/").text
        assert client.get("/signin").status_code == 200
        signin = client.get("/signin")
        assert signin.status_code == 200
        assert signin.text.count("<html") == 1
        assert "Sign in — Glim" in signin.text
        app_page = client.get("/app")
        assert app_page.status_code == 200
        assert "Your plan — Glim" in app_page.text
        assert "{% extends" not in app_page.text
        assert client.get("/api/docs").status_code == 200
        assert client.get("/api/openapi.json").status_code == 200
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
        assert client.get("/css/styles.css").status_code == 200
        assert client.get("/js/main.js").status_code == 200
        assert client.get("/api/health").json()["status"] == "ok"


def test_financial_data_api_does_not_expose_shared_state_endpoint():
    with TestClient(app) as client:
        assert client.get("/api/state").status_code == 404
        assert client.put("/api/state", json={"debts": []}).status_code == 404


def test_demo_session_is_signed_http_only_and_expires_by_max_age():
    with TestClient(app) as client:
        assert client.get("/api/session").status_code == 401
        created = client.post("/api/session", json={"name": "Alex Morgan", "email": "Alex@example.com"})
        assert created.status_code == 200
        assert created.json()["profile"]["email"] == "alex@example.com"
        cookie = created.headers.get("set-cookie", "").lower()
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert "max-age=28800" in cookie
        assert client.get("/api/session").json()["profile"]["name"] == "Alex Morgan"
        signed_out = client.delete("/api/session")
        assert signed_out.status_code == 200
        assert client.get("/api/session").status_code == 401


def test_coach_and_integration_endpoints_require_demo_session():
    with TestClient(app) as client:
        assert client.post("/api/coach", json={"question": "How does APR work?"}).status_code == 401
        client.post("/api/session", json={"name": "Alex", "email": "alex@example.com"})
        coach = client.post("/api/coach", json={"question": "How does APR work?", "context": {"debts": []}})
        assert coach.status_code == 200
        assert coach.json()["reply"]
        status = client.get("/api/integrations/status")
        assert status.status_code == 200
        assert status.json()["financial_data_storage"] == "browser IndexedDB"


def test_product_compare_endpoint_uses_user_entered_terms():
    products = [
        {"name": "Account A", "annual_rate": 3.0, "annual_fee": 0, "monthly_fee": 0},
        {"name": "Account B", "annual_rate": 2.0, "annual_fee": 0, "monthly_fee": 0},
    ]
    with TestClient(app) as client:
        client.post("/api/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/api/products/compare", json={"category": "savings", "balance": 1000, "products": products})
        assert response.status_code == 200
        assert response.json()["products"][0]["name"] == "Account A"
        assert "Verify current terms" in response.json()["notice"]


def test_reward_requires_an_authenticated_demo_session_and_valid_milestone():
    payload = {"milestone_key": "savings_goal_reached", "recipient_email": "sandbox@example.com", "evidence": {"target": 100, "current": 10}, "client_claim_id": "claim-00000001"}
    with TestClient(app) as client:
        assert client.post("/api/rewards/claim", json=payload).status_code == 401
        client.post("/api/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/api/rewards/claim", json=payload)
        assert response.status_code == 409


def test_paypal_reward_claim_returns_configuration_message_without_sandbox_credentials(monkeypatch):
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
        assert client.post("/api/rewards/claim", json=payload).status_code == 401
        client.post("/api/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/api/rewards/claim", json=payload)
        assert response.status_code == 503
        assert "PayPal Sandbox is not configured" in response.json()["detail"]


def test_paypal_status_requires_session_and_reports_unconfigured_sandbox(monkeypatch):
    monkeypatch.delenv("PAYPAL_CLIENT_ID", raising=False)
    monkeypatch.delenv("PAYPAL_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("PAYPAL_ENV", "sandbox")
    with TestClient(app) as client:
        assert client.get("/api/rewards/status/GLIM-batch-123").status_code == 401
        client.post("/api/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.get("/api/rewards/status/GLIM-batch-123")
        assert response.status_code == 503
        assert "PayPal Sandbox is not configured" in response.json()["detail"]


def test_qloo_reward_ideas_have_local_fallback_and_allowlisted_interests(monkeypatch):
    monkeypatch.delenv("QLOO_API_KEY", raising=False)
    with TestClient(app) as client:
        client.post("/api/session", json={"name": "Alex", "email": "alex@example.com"})
        response = client.post("/api/rewards/recommendations", json={"interest_tags": ["urn:tag:genre:media:nonfiction"]})
        assert response.status_code == 200
        assert response.json()["provider"] == "starter-ideas"
        assert response.json()["configured"] is False
        invalid = client.post("/api/rewards/recommendations", json={"interest_tags": ["urn:tag:person:real-person"]})
        assert invalid.status_code == 422
