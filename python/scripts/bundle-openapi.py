#!/usr/bin/env python3
"""Bundle DCN service OpenAPI specs into one SDK OpenAPI document.

This is the Python sibling of ``js/scripts/bundle-openapi.mjs``. It lives in
the SDK repository so SDK builds do not depend on executable tooling from the
``dcn-api-spec`` submodule; the submodule provides only the OpenAPI source
documents.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Optional, cast

import yaml


HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
JsonMap = dict[str, object]


def pascal(value: str) -> str:
    out: list[str] = []
    upper_next = True
    for char in value:
        if char.isalnum():
            out.append(char.upper() if upper_next else char)
            upper_next = False
        else:
            upper_next = True
    return "".join(out) or "Schema"


def as_map(value: object, *, context: str) -> JsonMap:
    if not isinstance(value, dict):
        raise RuntimeError(f"{context} is not an object")
    raw = cast(dict[object, object], value)
    out: JsonMap = {}
    for key, item in raw.items():
        if not isinstance(key, str):
            raise RuntimeError(f"{context} contains a non-string key")
        out[key] = item
    return out


def as_list(value: object) -> list[object]:
    if not isinstance(value, list):
        return []
    return cast(list[object], value)


def optional_map(value: object) -> Optional[JsonMap]:
    if not isinstance(value, dict):
        return None
    raw = cast(dict[object, object], value)
    out: JsonMap = {}
    for key, item in raw.items():
        if isinstance(key, str):
            out[key] = item
    return out


def optional_list(value: object) -> Optional[list[object]]:
    if not isinstance(value, list):
        return None
    return cast(list[object], value)


def string_key_items(value: object) -> list[tuple[str, object]]:
    if not isinstance(value, dict):
        return []
    raw = cast(dict[object, object], value)
    return [(key, item) for key, item in raw.items() if isinstance(key, str)]


def pointer_lookup(document: JsonMap, pointer: str) -> object:
    if not pointer:
        return document
    if not pointer.startswith("/"):
        raise RuntimeError(f"Only JSON pointer refs are supported: #{pointer}")
    current: object = document
    for raw_part in pointer.lstrip("/").split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        current_map = optional_map(current)
        if current_map is None or part not in current_map:
            raise RuntimeError(f"Invalid JSON pointer: #{pointer}")
        current = current_map[part]
    return current


class SpecBundler:
    def __init__(self, spec_root: Path) -> None:
        self.spec_root = spec_root.resolve()
        self.documents: dict[Path, JsonMap] = {}
        self.schema_components: dict[str, object] = {}
        self.security_components: dict[str, object] = {}

    def bundle(self, *, title: str, version: str, drop_options: bool) -> JsonMap:
        service_specs = self.service_specs()
        if not service_specs:
            raise RuntimeError(f"No service specs found under {self.spec_root / 'services'}")

        first = self.load(service_specs[0])
        bundled_tags: list[object] = []
        bundled_paths: JsonMap = {}
        components: JsonMap = {"securitySchemes": {}, "schemas": {}}
        bundled: JsonMap = {
            "openapi": "3.0.3",
            "info": {"title": title, "version": version},
            "servers": first.get("servers", []),
            "security": [],
            "tags": bundled_tags,
            "paths": bundled_paths,
            "components": components,
        }

        seen_tags: set[str] = set()
        for spec_path in service_specs:
            doc = self.load(spec_path)
            tags = as_list(doc.get("tags", []))
            for tag in tags:
                tag_map = optional_map(tag)
                name = tag_map.get("name") if tag_map is not None else None
                if isinstance(name, str) and name not in seen_tags:
                    bundled_tags.append(copy.deepcopy(tag))
                    seen_tags.add(name)

            for path, path_item in sorted(string_key_items(doc.get("paths", {}))):
                path_item_map = optional_map(path_item)
                if path_item_map is None:
                    continue
                resolved_path_item = as_map(
                    self.resolve_node(path_item_map, spec_path),
                    context=f"resolved path item {path}",
                )
                if drop_options:
                    resolved_path_item = {
                        key: value
                        for key, value in resolved_path_item.items()
                        if key.lower() != "options"
                    }
                if not any(key.lower() in HTTP_METHODS for key in resolved_path_item):
                    continue
                if path in bundled_paths:
                    raise RuntimeError(f"Duplicate path in service specs: {path}")
                bundled_paths[path] = resolved_path_item

        components["securitySchemes"] = dict(sorted(self.security_components.items()))
        components["schemas"] = dict(sorted(self.schema_components.items()))
        if not components["securitySchemes"]:
            del components["securitySchemes"]
        if not components["schemas"]:
            del components["schemas"]
        if not components:
            del bundled["components"]

        return bundled

    def service_specs(self) -> list[Path]:
        services_dir = self.spec_root / "services"
        if not services_dir.exists():
            return []
        return sorted(path for path in services_dir.glob("*/openapi.yaml") if path.is_file())

    def load(self, path: Path) -> JsonMap:
        resolved = path.resolve()
        self.require_inside_spec_root(resolved)
        if resolved not in self.documents:
            with resolved.open("r", encoding="utf-8") as file:
                loaded: object = yaml.safe_load(file) or {}
            if not isinstance(loaded, dict):
                raise RuntimeError(f"OpenAPI document is not an object: {resolved}")
            self.documents[resolved] = cast(JsonMap, loaded)
        return self.documents[resolved]

    def resolve_node(self, node: object, current_file: Path) -> object:
        node_list = optional_list(node)
        if node_list is not None:
            return [self.resolve_node(item, current_file) for item in node_list]
        node_map = optional_map(node)
        if node_map is None:
            return copy.deepcopy(node)
        ref = node_map.get("$ref")
        if isinstance(ref, str):
            return self.resolve_ref(ref, current_file)
        return {
            key: self.resolve_node(value, current_file)
            for key, value in node_map.items()
        }

    def resolve_ref(self, ref: str, current_file: Path) -> object:
        ref_file, pointer = self.split_ref(ref, current_file)
        target_doc = self.load(ref_file)
        target = pointer_lookup(target_doc, pointer)

        if pointer.startswith("/components/securitySchemes/"):
            name = pointer.rsplit("/", 1)[-1]
            self.security_components[name] = self.resolve_node(target, ref_file)
            return {"$ref": f"#/components/securitySchemes/{name}"}

        if self.is_schema_file(ref_file):
            name = self.schema_name(target, ref_file)
            resolved = self.resolve_node(target, ref_file)
            if name not in self.schema_components:
                self.schema_components[name] = resolved
            elif self.schema_components[name] != resolved:
                raise RuntimeError(
                    f"Conflicting OpenAPI schema component name {name!r} from {ref_file}"
                )
            return {"$ref": f"#/components/schemas/{name}"}

        return self.resolve_node(target, ref_file)

    def split_ref(self, ref: str, current_file: Path) -> tuple[Path, str]:
        file_part, _, pointer = ref.partition("#")
        ref_file = (
            current_file.resolve()
            if not file_part
            else (current_file.parent / file_part).resolve()
        )
        self.require_inside_spec_root(ref_file)
        return ref_file, pointer or ""

    def require_inside_spec_root(self, path: Path) -> None:
        try:
            path.resolve().relative_to(self.spec_root)
        except ValueError as error:
            raise RuntimeError(f"OpenAPI $ref path escapes spec root: {path}") from error

    def is_schema_file(self, path: Path) -> bool:
        try:
            relative = path.resolve().relative_to(self.spec_root)
        except ValueError:
            return False
        return "schemas" in relative.parts and path.suffix in {".yaml", ".yml", ".json"}

    @staticmethod
    def schema_name(schema: object, path: Path) -> str:
        schema_map = optional_map(schema)
        if schema_map is not None:
            title = schema_map.get("title")
            if isinstance(title, str):
                return pascal(title)
        return pascal(path.stem)


def write_output(path: Path, data: JsonMap, *, output_format: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        if output_format == "json":
            json.dump(data, file, indent=2)
            file.write("\n")
        else:
            yaml.safe_dump(data, file, sort_keys=False, allow_unicode=False)


def infer_format(output: Path) -> str:
    return "json" if output.suffix.lower() == ".json" else "yaml"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Bundle DCN OpenAPI service specs for SDK codegen."
    )
    parser.add_argument("--spec-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--title", default="DCN Chain API")
    parser.add_argument("--version", default="0.2.0")
    parser.add_argument("--keep-options", action="store_true")
    parser.add_argument(
        "--format",
        choices=["json", "yaml"],
        help="Defaults to output extension.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    spec_root = Path(args.spec_root)
    if not (spec_root / "services").is_dir():
        raise RuntimeError(
            f"Missing dcn-api-spec services at {spec_root}. "
            "Run: git submodule update --init --recursive submodules/dcn-api-spec"
        )
    output = Path(args.output)
    bundled = SpecBundler(spec_root).bundle(
        title=args.title,
        version=args.version,
        drop_options=not args.keep_options,
    )
    write_output(output, bundled, output_format=args.format or infer_format(output))
    print(f"Bundled OpenAPI spec -> {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
