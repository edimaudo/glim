# Fix for `Directory '/var/task/public/css' does not exist`

The error occurs when Starlette's `StaticFiles` is instantiated with a directory that is missing from the deployed function bundle. Glim's `public/` files are intended to be served by Vercel's CDN, so the application must not mount `public/css` or `public/js` at production import time.

The current `app.py` makes local static mounting an explicit opt-in. It registers `/css` and `/js` mounts only when `GLIM_LOCAL_STATIC=1`, the runtime is not identified as Vercel, and each local directory exists. The flag is set by `run.sh` for local Uvicorn development. Do not configure `GLIM_LOCAL_STATIC` in Vercel.

## Deployment steps

1. Replace the deployed project files with this package's contents, preserving the project root so `app.py`, `vercel.json`, `templates/`, and `public/` are siblings.
2. Check that the Vercel Project **Root Directory** points to the folder containing this `app.py` and `public/` directory, not a parent or older nested copy.
3. Commit and deploy the updated files as a new deployment. Do not simply revisit an older deployment.
4. Verify `/`, `/css/styles.css`, and `/js/main.js` on the newly deployed URL.

Vercel's current FastAPI documentation says project-root `public/` files are served by its CDN and should not be mounted with `app.mount()` in the deployed application: https://vercel.com/docs/frameworks/backend/fastapi


## Demo sign-in configuration

A Vercel deployment must have `GLIM_SESSION_SECRET` set in Project Settings → Environment Variables. If it is missing, `/session/status` reports that sessions are unavailable, the sign-in button is disabled, and the page explains how the site owner can configure it. This is intentional: the application does not use a predictable signing key in production. Generate a new secret locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"`; add that value directly to Vercel and redeploy. Keep the secret out of source control.

## Branded 404 page

Unknown paths render `templates/404.html` and return HTTP 404. The route is registered after the page/action handlers and optional local static mounts so it cannot shadow valid routes or local assets.
