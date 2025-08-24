# python/hatch_build.py
from __future__ import annotations
import os
import sys
import subprocess
from pathlib import Path
from hatchling.builders.hooks.plugin.interface import BuildHookInterface

class CustomHook(BuildHookInterface):
    """
    This hook runs before building wheel/sdist.
    It generates the OpenAPI client into the runtime package so it's included.
    """

    def initialize(self, version: str, build_data: dict) -> None:
        script = Path(self.root) / "gen_client.py"

        # skip if user sets NO_CODEGEN=1
        if os.getenv("NO_CODEGEN") == "1":
            self.app.display_info("Skipping OpenAPI generation (NO_CODEGEN=1)")
            return

        # Basic sanity checks
        if not script.exists():
            self.app.display_warning(f"gen_client.py not found at {script}; skipping codegen.")
            return

        self.app.display_info("Generating OpenAPI client from api.yaml...")

        cmd = [sys.executable, str(script)]
        self.app.display_debug(" ".join(cmd))
        subprocess.check_call(cmd)
        self.app.display_info("OpenAPI client generation complete.")
