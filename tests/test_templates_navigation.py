from fastapi.testclient import TestClient
from app.main import app
from pathlib import Path

app_root = Path(__file__).resolve().parents[1]


def test_public_landing_is_separate_from_sign_in():
    with TestClient(app) as client:
        landing = client.get("/")
        assert landing.status_code == 200
        assert "Plan to pay down debt while building savings." in landing.text
        assert 'id="authForm"' not in landing.text
        assert "One plan for savings and debt" not in landing.text
        assert "Saving and debt, in one economy." not in landing.text
        assert 'href="/signin"' in landing.text
        assert "Glim is a planning prototype" not in landing.text
        assert "records are stored in this browser" not in landing.text
        assert "How Glim works" not in landing.text

        signin = client.get("/signin")
        assert signin.status_code == 200
        assert 'id="authForm"' in signin.text
        assert 'id="authEmail"' in signin.text
        assert "In this prototype, your plan is stored in this browser" not in signin.text


def test_each_app_section_has_a_real_url_and_template_navigation():
    sections = ["overview", "savings", "plan", "coach", "game", "squad", "learn", "settings"]
    with TestClient(app) as client:
        for section in sections:
            response = client.get(f"/app/{section}")
            assert response.status_code == 200, section
            assert f'href="/app/{section}"' in response.text
            assert f'class="tab active" href="/app/{section}"' in response.text
            assert f'class="tab-panel active"' in response.text
            assert "walkthroughOverlay" in response.text
            assert "pExpenses" in response.text
            assert "Income range" not in response.text
            assert "Credit-card payoff example" not in response.text
            assert "Connections and AI" in response.text
            assert 'id="startWalkthroughBtn"' in response.text
        assert client.get("/app/not-a-section").status_code == 404
        assert client.get("/app", follow_redirects=False).status_code == 302


def test_app_pages_are_jinja_templates_not_static_html():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "/static/styles.css" in response.text
        # Page content is rendered by the server from templates; no static index document is served.
        assert "/static/styles.css" in response.text
        assert not (app_root / "app" / "static" / "index.html").exists()


def test_setup_is_integrated_and_has_no_duplicate_income_range():
    with TestClient(app) as client:
        response = client.get("/app/overview")
        assert response.status_code == 200
        assert "Create your plan" in response.text
        assert "Monthly take-home income (CAD)" in response.text
        assert "Typical monthly expenses (CAD)" in response.text
        assert "Income range" not in response.text
        assert "Set your plan guardrails" not in response.text
        assert "Example figures are illustrative" not in response.text
        assert "Build your buffer. Reduce your debt." not in response.text
        assert "This records practice progress only" not in response.text
        assert "Illustrative recurring expenses" not in response.text


def test_profile_schema_uses_one_income_value_and_expenses():
    from app.models import Profile
    profile = Profile(monthly_income=5000, average_monthly_expenses=3200, floor_balance=500)
    data = profile.model_dump()
    assert data["monthly_income"] == 5000
    assert data["average_monthly_expenses"] == 3200
    assert "income_range" not in data
    assert data["name"] == ""
    assert data["persona"] == "custom"
