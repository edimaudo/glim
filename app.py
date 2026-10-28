from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
TEMPLATES = Jinja2Templates(directory=str(ROOT / "templates"))
from api import router as api_router

app = FastAPI(
    title="Glim API",
    version="0.1.0",
    description="JSON endpoints for Glim's Canadian financial-coaching prototype.",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)
app.include_router(api_router)


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def landing(request: Request):
    return TEMPLATES.TemplateResponse(request=request, name="index.html", context={})


@app.get("/signin", response_class=HTMLResponse, include_in_schema=False)
async def signin_page(request: Request):
    return TEMPLATES.TemplateResponse(request=request, name="signin.html", context={})


@app.get("/app", response_class=HTMLResponse, include_in_schema=False)
async def app_page(request: Request):
    return TEMPLATES.TemplateResponse(request=request, name="app.html", context={})


# Keep these mounts for local development. On Vercel, files in public/ are also served as static assets.
app.mount("/css", StaticFiles(directory=PUBLIC / "css"), name="css")
app.mount("/js", StaticFiles(directory=PUBLIC / "js"), name="js")
