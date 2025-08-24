#!/usr/bin/env python3
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # root
PYTHON_DIR = ROOT / "python"
OUT_DIR = PYTHON_DIR / "build"                      # we’ll place the project here
DEST = PYTHON_DIR / "dcn" / "dcn_api_client"       # final importable package

CONFIG = PYTHON_DIR / "openapi-python-client.json"
SPEC = ROOT / "spec" / "api.yaml"

def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.check_call(args)

def main():
    # Ensure destination is clean but keep it if unchanged
    if DEST.exists() and not DEST.is_dir():
        raise SystemExit(f"{DEST} exists and is not a directory")

    if SPEC.exists():
        run(sys.executable, "-m", "openapi_python_client", "generate",
            "--path", str(SPEC),
            "--config", str(CONFIG),
            "--output-path", str(OUT_DIR),
            "--overwrite")
    
    else:
        raise SystemExit(f"Spec not found: {SPEC}")

    generated_pkg = Path(OUT_DIR) / "dcn_api_client"
    if not generated_pkg.exists():
        raise SystemExit("Generated package not found (check generator output)")

    # Copy the Python package into our monorepo's python/ subdir
    if DEST.exists():
        shutil.rmtree(DEST)
    shutil.copytree(generated_pkg, DEST)

    # Ensure __init__.py exists (it will, but belt & suspenders)
    (DEST / "__init__.py").touch(exist_ok=True)

    print(f"Generated client -> {DEST}")

if __name__ == "__main__":
    main()
