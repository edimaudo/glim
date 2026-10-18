from fastapi.testclient import TestClient
from app.main import app
from pathlib import Path
from html.parser import HTMLParser
import re


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.ignored += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.ignored:
            self.ignored -= 1

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)

    def text(self):
        return " ".join(" ".join(self.parts).split())

app_root = Path(__file__).resolve().parents[1]


def test_public_landing_is_separate_from_sign_in():
    with TestClient(app) as client:
        landing = client.get("/")
        assert landing.status_code == 200
        assert "Pay down debt. Build savings." in landing.text
        assert 'id="authForm"' not in landing.text
        assert "Explore the tools" not in landing.text
        assert "eyebrow" not in landing.text
        assert 'href="/signin"' in landing.text
        assert "PayPal" not in landing.text
        assert "Gemini" not in landing.text

        signin = client.get("/signin")
        assert signin.status_code == 200
        assert 'id="authForm"' in signin.text
        assert 'id="authEmail"' in signin.text
        assert "In this prototype, your plan is stored in this browser" not in signin.text


def test_navigation_has_only_three_main_destinations_and_old_sections_redirect():
    with TestClient(app) as client:
        for section in ["overview", "plan", "settings"]:
            response = client.get(f"/app/{section}")
            assert response.status_code == 200, section
            assert f'href="/app/{section}"' in response.text
            assert f'class="tab active" href="/app/{section}"' in response.text
            assert 'class="tab-panel active"' in response.text
            assert "walkthroughOverlay" in response.text
            assert 'id="pExpenses"' in response.text
            assert "Income range" not in response.text
            assert "Connections and AI" not in response.text
            assert 'id="startWalkthroughBtn"' in response.text
            assert "PayPal Sandbox" not in response.text
            assert "eyebrow" not in response.text
            assert "Gemini" not in response.text
        assert client.get("/app/not-a-section").status_code == 404
        for section in ["savings", "coach", "game", "squad", "learn"]:
            old = client.get(f"/app/{section}", follow_redirects=False)
            assert old.status_code == 302
            assert old.headers["location"] == "/app/overview"
        assert client.get("/app", follow_redirects=False).status_code == 302


def test_app_pages_are_jinja_templates_not_static_html():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
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
        assert "forest" not in response.text.lower()
        assert "Habit points" not in response.text
        assert "Planning only until PayPal" not in response.text
        assert "plan-preview" not in response.text
        assert response.text.count('class="summary-item"') == 2
        visible = VisibleText()
        visible.feed(response.text)
        copy = visible.text()
        assert not re.search(r"\b(forest|stash|boss|drip|gamification|points)\b", copy, re.I)
        assert "PayPal" not in copy and "Gemini" not in copy and "Sandbox" not in copy
        assert "Monthly recap" not in copy and "Auto-deposit" not in copy


def test_profile_schema_uses_one_income_value_and_expenses():
    from app.models import Profile
    profile = Profile(monthly_income=5000, average_monthly_expenses=3200, floor_balance=500)
    data = profile.model_dump()
    assert data["monthly_income"] == 5000
    assert data["average_monthly_expenses"] == 3200
    assert "income_range" not in data
    assert data["name"] == ""
    assert data["persona"] == "custom"
    assert "show_friend_support" in data


def test_main_experience_is_financial_and_gamification_free():
    with TestClient(app) as client:
        response = client.get("/app/overview")
        assert response.status_code == 200
        assert 'id="debtList"' in response.text
        assert 'id="debtBalance"' in response.text
        assert 'id="savingsBalance"' in response.text
        assert "Recurring payments to review" not in response.text
        assert "Friends and encouragement" not in response.text
        assert "Interest Ogre" not in response.text
        assert "supporting-modules" not in response.text
        visible = VisibleText()
        visible.feed(response.text)
        copy = visible.text()
        assert "Suggested amount" in copy
        assert "Debt plan" in copy
        assert not re.search(r"\b(forest|stash|boss|drip|points|streak|squad|gamification|ogre)\b", copy, re.I)
