#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


SDK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SDK_DIR.parent
SPEC_ROOT = REPO_ROOT / "submodules" / "dcn-api-spec"
BUNDLE_OPENAPI = SDK_DIR / "scripts" / "bundle-openapi.py"
SPEC_OUTPUT = REPO_ROOT / "build" / "openapi" / "dcn-sdk.openapi.yaml"
OUTPUT_DIR = SDK_DIR / "build"
DEST = SDK_DIR / "dcn" / "dcn_api_client"


def run(args: list[str]) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.check_call(args, cwd=REPO_ROOT)


def fail_missing_tool() -> None:
    raise SystemExit(
        f"SDK OpenAPI bundler not found: {BUNDLE_OPENAPI}\n"
        "Run: git submodule update --init --recursive submodules/dcn-api-spec"
    )


def main() -> int:
    if not BUNDLE_OPENAPI.exists():
        fail_missing_tool()

    run([
        sys.executable,
        str(BUNDLE_OPENAPI),
        "--spec-root",
        str(SPEC_ROOT),
        "--output",
        str(SPEC_OUTPUT),
    ])

    command = [
        sys.executable,
        "-m",
        "openapi_python_client",
        "generate",
        "--path",
        str(SPEC_OUTPUT),
        "--output-path",
        str(OUTPUT_DIR),
        "--overwrite",
    ]
    config = {
        "project_name_override": "dcn_api_client",
        "package_name_override": "dcn_api_client",
    }
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        suffix=".json",
        delete=False,
    ) as file:
        json.dump(config, file)
        config_path = Path(file.name)
    try:
        run([*command, "--config", str(config_path)])
    finally:
        config_path.unlink(missing_ok=True)

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
