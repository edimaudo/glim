#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export GLIM_LOCAL_STATIC=1
python -m uvicorn app:app --reload
