from fastapi.testclient import TestClient
from app.main import app
from pathlib import Path

app_root = Path(__file__).resolve().parents[1]


def test_public_landing_is_separate_from_sign_in():
    with TestClient(app) as client:
        landing = client.get("/")
        assert landing.status_code == 200
        assert "Make progress on debt without putting savings last." in landing.text
        assert 'id="authForm"' not in landing.text
        assert "Explore the tools" not in landing.text
        assert landing.text.count('class="primary"') == 1
        assert 'href="/signin"' in landing.text
        assert "Glim is a planning prototype" not in landing.text
        assert "records are stored in this browser" not in landing.text
        assert "How Glim works" not in landing.text

        signin = client.get("/signin")
        assert signin.status_code == 200
        assert 'id="authForm"' in signin.text
        assert 'id="authEmail"' in signin.text
        assert "In this prototype, your plan is stored in this browser" not in signin.text


def test_only_three_primary_app_destinations_and_legacy_routes_redirect():
    sections = ["overview", "plan", "settings"]
    with TestClient(app) as client:
        for section in sections:
            response = client.get(f"/app/{section}")
            assert response.status_code == 200, section
            assert f'href="/app/{section}"' in response.text
            assert f'class="tab active" href="/app/{section}"' in response.text
            assert 'class="tab-panel active"' in response.text
            assert "walkthroughOverlay" in response.text
            assert "pExpenses" in response.text
            assert "Income range" not in response.text
            assert "Credit-card payoff example" not in response.text
            assert "Connections and AI" not in response.text
            assert 'id="startWalkthroughBtn"' in response.text
            assert response.text.count('class="tab ') == 3
        for legacy in ["savings", "coach", "game", "squad", "learn"]:
            response = client.get(f"/app/{legacy}", follow_redirects=False)
            assert response.status_code == 302, legacy
            assert response.headers["location"] == "/app/overview"
        assert client.get("/app/not-a-section").status_code == 404
        assert client.get("/app", follow_redirects=False).status_code == 302


def test_user_facing_copy_is_plain_language_and_does_not_expose_vendors_or_forest_metaphor():
    from bs4 import BeautifulSoup
    with TestClient(app) as client:
        for route in ["/", "/signin", "/app/overview", "/app/plan", "/app/settings"]:
            response = client.get(route)
            assert response.status_code == 200
            text = " ".join(BeautifulSoup(response.text, "html.parser").stripped_strings).lower()
            assert "paypal" not in text, route
            assert "sandbox" not in text, route
            assert "gemini" not in text, route
            assert "your forest" not in text, route
            assert "explore the tools" not in text, route
        home = client.get("/app/overview").text
        assert "Debt remaining" in home
        assert "Savings buffer" in home
        assert "Suggested next step" in home
        assert 'id="progressSupportDetails"' in home
        assert 'id="monthlyDepositForm"' not in home
        assert 'id="loadRecapBtn"' not in home


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


def test_debt_plan_progressively_discloses_entry_and_strategies():
    with TestClient(app) as client:
        response = client.get("/app/plan")
        assert response.status_code == 200
        assert 'id="debtList"' in response.text
        assert 'id="debtDetails"' in response.text
        assert 'id="scoutDetails"' in response.text
        assert 'id="strategySection"' in response.text
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(response.text, 'html.parser')
        assert 'hidden' in soup.select_one('#strategySection').get('class', [])
        debt_details = response.text.split('id="debtDetails"', 1)[1].split('>', 1)[0]
        scout_details = response.text.split('id="scoutDetails"', 1)[1].split('>', 1)[0]
        assert " open" not in debt_details
        assert " open" not in scout_details
        assert "Highest interest first" in response.text
        assert "Compare a possible budget change" in response.text


def test_supporting_progress_uses_plain_labels_and_payment_history_hides_provider_details():
    from bs4 import BeautifulSoup
    with TestClient(app) as client:
        response = client.get("/app/overview")
        soup = BeautifulSoup(response.text, "html.parser")
        text = " ".join(soup.stripped_strings).lower()
        assert "your forest" not in text
        assert "streak protection" not in text
        assert "consistency points" not in text
        assert "use a grace day" in text
        assert "progress, lessons, and support" in text
    script = (app_root / "app" / "static" / "app.js").read_text()
    settlement_renderer = script.split("async function renderSettlements(){", 1)[1].split("const OVERVIEW_PREFS_KEY", 1)[0]
    assert "r.last_error" not in settlement_renderer
    assert "escapeHtml(r.status)" not in settlement_renderer
    assert "Contribution · ${status}" in settlement_renderer
    assert "Continue account approval" in settlement_renderer
