# Fix for `Directory '/var/task/public/css' does not exist`

The error occurs when Starlette's `StaticFiles` is instantiated with a directory that is missing from the deployed function bundle. Glim's `public/` files are intended to be served by Vercel's CDN, so the application must not mount `public/css` or `public/js` at production import time.

The current `app.py` makes local static mounting an explicit opt-in. It registers `/css` and `/js` mounts only when `GLIM_LOCAL_STATIC=1`, the runtime is not identified as Vercel, and each local directory exists. The flag is set by `run.sh` for local Uvicorn development. Do not configure `GLIM_LOCAL_STATIC` in Vercel.

## Deployment steps

1. Replace the deployed project files with this package's contents, preserving the project root so `app.py`, `vercel.json`, `templates/`, and `public/` are siblings.
2. Check that the Vercel Project **Root Directory** points to the folder containing this `app.py` and `public/` directory, not a parent or older nested copy.
3. Commit and deploy the updated files as a new deployment. Do not simply revisit an older deployment.
4. Verify `/`, `/css/styles.css`, and `/js/main.js` on the newly deployed URL.

Vercel's current FastAPI documentation says project-root `public/` files are served by its CDN and should not be mounted with `app.mount()` in the deployed application: https://vercel.com/docs/frameworks/backend/fastapi
