from pathlib import Path
import os
import sys

os.environ.setdefault("GLIM_LOCAL_STATIC", "1")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
