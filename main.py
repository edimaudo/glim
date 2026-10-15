"""Deployment entrypoint for the Glim FastAPI application.

When the repository root is the deployment root, import through the package so
relative imports in ``app/main.py`` retain their package context.
"""
from app.main import app

__all__ = ["app"]
