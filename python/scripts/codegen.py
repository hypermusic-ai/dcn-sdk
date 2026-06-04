#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
import os
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


SDK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SDK_DIR.parent
SPEC_ROOT = REPO_ROOT / "submodules" / "dcn-api-spec"
TOOL = SPEC_ROOT / "tools" / "generate-sdk.py"
SPEC_OUTPUT = REPO_ROOT / "build" / "openapi" / "dcn-sdk.openapi.yaml"
OUTPUT_DIR = SDK_DIR / "build"
DEST = SDK_DIR / "dcn" / "dcn_api_client"


def run(args: list[str]) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.check_call(args, cwd=REPO_ROOT)


def fail_missing_tool() -> None:
    raise SystemExit(
        f"dcn-api-spec codegen tool not found: {TOOL}\n"
        "Run: git submodule update --init --recursive submodules/dcn-api-spec"
    )


def main() -> int:
    if not TOOL.exists():
        fail_missing_tool()

    run([
        sys.executable,
        str(TOOL),
        "generate",
        "--spec-root",
        str(SPEC_ROOT),
        "--output",
        str(SPEC_OUTPUT),
        "--spec-output",
        str(SPEC_OUTPUT),
        "--language",
        "python",
        "--output-dir",
        str(OUTPUT_DIR),
        "--python-project-name",
        "dcn_api_client",
        "--python-package-name",
        "dcn_api_client",
    ])

    generated_pkg = OUTPUT_DIR / "dcn_api_client"
    if not generated_pkg.exists():
        raise SystemExit(f"Generated package not found: {generated_pkg}")
    if DEST.exists() and not DEST.is_dir():
        raise SystemExit(f"{DEST} exists and is not a directory")
    if DEST.exists():
        shutil.rmtree(DEST)
    shutil.copytree(generated_pkg, DEST)
    (DEST / "__init__.py").touch(exist_ok=True)
    print(f"Generated client -> {DEST}")
    return 0


class CustomHook(BuildHookInterface[Any]):
    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        if os.getenv("NO_CODEGEN") == "1":
            self.app.display_info("Skipping OpenAPI generation (NO_CODEGEN=1)")
            return
        self.app.display_info("Generating OpenAPI client from dcn-api-spec...")
        main()
        self.app.display_info("OpenAPI client generation complete.")


if __name__ == "__main__":
    raise SystemExit(main())
