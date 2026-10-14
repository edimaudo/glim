"""Vercel entrypoint for Glim.

Import the FastAPI application through its package so relative imports in
app/main.py retain their package context when the project root is this folder.
"""
from app.main import app

__all__ = ["app"]
