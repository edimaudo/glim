import importlib
import os
from fastapi.testclient import TestClient


def test_localstorage_mode_does_not_initialize_sqlite_or_accept_api_writes(monkeypatch, tmp_path):
    database_path = tmp_path / "should-not-exist.db"
    monkeypatch.setenv("GLIM_STORAGE_MODE", "localStorage")
    monkeypatch.setenv("DATABASE_PATH", str(database_path))
    module = importlib.import_module("app.main")
    module = importlib.reload(module)

    assert module.db is None
    assert module.DATABASE_ENABLED is False
    assert not database_path.exists()

    with TestClient(module.app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["storage_mode"] == "localStorage"
        assert health.json()["database_initialized"] is False

        config = client.get("/storage-config.js")
        assert config.status_code == 200
        assert "storageMode: 'localStorage'" in config.text

        landing = client.get("/")
        assert landing.status_code == 200
        assert "/static/storage.js" in landing.text

        rejected = client.post("/api/profile", json={"name": "Prototype", "monthly_income": 1000, "income_range": "test"})
        assert rejected.status_code == 409

    assert not database_path.exists()
