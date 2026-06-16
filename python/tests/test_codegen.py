from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parents[1]
SDK_ROOT = PYTHON_DIR.parent
SPEC_ROOT = SDK_ROOT / "submodules" / "dcn-api-spec"
PYTHON_BUNDLER = PYTHON_DIR / "scripts" / "bundle-openapi.py"
JS_BUNDLER = SDK_ROOT / "js" / "scripts" / "bundle-openapi.mjs"
JS_YAML = SDK_ROOT / "js" / "node_modules" / "js-yaml"


class TestOpenApiCodegenParity(unittest.TestCase):
    def test_python_and_js_bundlers_emit_the_same_document(self) -> None:
        node = shutil.which("node")
        if node is None:
            self.skipTest("node is not installed")
        if not JS_YAML.exists():
            self.skipTest("JS dependencies are not installed")

        with tempfile.TemporaryDirectory(prefix="dcn-openapi-parity-") as tmp:
            out_dir = Path(tmp)
            py_out = out_dir / "python.json"
            js_out = out_dir / "js.json"

            py_result = subprocess.run(
                [
                    sys.executable,
                    str(PYTHON_BUNDLER),
                    "--spec-root",
                    str(SPEC_ROOT),
                    "--output",
                    str(py_out),
                    "--format",
                    "json",
                ],
                cwd=SDK_ROOT,
                text=True,
                capture_output=True,
            )
            self.assertEqual(py_result.returncode, 0, py_result.stderr)

            js_result = subprocess.run(
                [
                    node,
                    str(JS_BUNDLER),
                    "--spec-root",
                    str(SPEC_ROOT),
                    "--output",
                    str(js_out),
                ],
                cwd=SDK_ROOT,
                text=True,
                capture_output=True,
            )
            self.assertEqual(js_result.returncode, 0, js_result.stderr)

            self.assertEqual(
                json.loads(py_out.read_text(encoding="utf-8")),
                json.loads(js_out.read_text(encoding="utf-8")),
            )


if __name__ == "__main__":
    unittest.main()
