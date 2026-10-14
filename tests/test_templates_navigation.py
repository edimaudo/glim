from fastapi.testclient import TestClient
from app.main import app
from pathlib import Path

app_root = Path(__file__).resolve().parents[1]


def test_public_landing_is_separate_from_sign_in():
    with TestClient(app) as client:
        landing = client.get("/")
        assert landing.status_code == 200
        assert "Build savings while paying down debt." in landing.text
        assert 'id="authForm"' not in landing.text
        assert "One plan for savings and debt" not in landing.text
        assert "Saving and debt, in one economy." not in landing.text
        assert 'href="/signin"' in landing.text

        signin = client.get("/signin")
        assert signin.status_code == 200
        assert 'id="authForm"' in signin.text
        assert 'id="authEmail"' in signin.text


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
