from __future__ import annotations

import json

import httpx

ADDR = "0x1111111111111111111111111111111111111111"
FORMAT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


def make_json(data: object, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=data,
        headers={"content-type": "application/json"},
    )


class ApiRouter:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        method = request.method
        query = dict(request.url.params)

        if path.endswith("/version") and method == "GET":
            return make_json({"version": "0.4.0", "build_timestamp": "2026-04-30T00:00:00Z"})

        if "/nonce/" in path and method == "GET":
            return make_json({"nonce": "abcd-efgh"})

        if path.endswith("/auth") and method == "POST":
            body = json.loads(request.content.decode())
            if body["message"] == "Login nonce: abcd-efgh":
                return make_json({"access_token": "access-123"})
            return make_json({"error": "bad_request"}, 400)

        if path.endswith("/accounts") and method == "GET":
            return make_json({
                "limit": int(query["limit"]),
                "total_accounts": 1,
                "cursor": {"has_more": False, "next_after": None},
                "accounts": [ADDR],
            })

        if "/account/" in path and method == "GET":
            return make_json({
                "address": path.rsplit("/", 1)[1],
                "limit": int(query["limit"]),
                "owned_connectors": ["pitch"],
                "owned_transformations": ["identity"],
                "owned_conditions": ["always"],
                "cursor_connectors": {"has_more": False, "next_after": None},
                "cursor_transformations": {"has_more": False, "next_after": None},
                "cursor_conditions": {"has_more": False, "next_after": None},
            })

        if "/connector/" in path and method == "HEAD":
            if path.endswith("/broken"):
                return httpx.Response(
                    503,
                    text="temporarily down",
                    headers={"content-type": "text/plain"},
                )
            return httpx.Response(404 if path.endswith("/missing") else 200)
        if "/connector/" in path and method == "GET":
            if path.endswith("/missing"):
                return make_json({"error": "not_found"}, 404)
            if path.endswith("/plain-error"):
                return httpx.Response(
                    500,
                    text="plain failure",
                    headers={"content-type": "text/plain"},
                )
            return make_json({
                "name": path.rsplit("/", 1)[1],
                "dimensions": [{"transformations": [{"name": "identity", "args": []}]}],
                "condition_name": "",
                "condition_args": [],
                "owner": ADDR,
                "address": "0x0",
                "format_hash": FORMAT,
            })
        if path.endswith("/connector") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json(
                {"name": body["name"], "owner": ADDR, "address": "0x0", "format_hash": FORMAT},
                201,
            )

        if "/transformation/" in path and method == "HEAD":
            return httpx.Response(404 if path.endswith("/missing") else 200)
        if "/transformation/" in path and method == "GET":
            return make_json({
                "name": path.rsplit("/", 1)[1],
                "owner": ADDR,
                "address": "0x0",
                "sol_src": "return x;",
            })
        if path.endswith("/transformation") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json({"name": body["name"], "owner": ADDR, "address": "0x0"}, 201)

        if "/condition/" in path and method == "HEAD":
            return httpx.Response(404 if path.endswith("/missing") else 200)
        if "/condition/" in path and method == "GET":
            return make_json({
                "name": path.rsplit("/", 1)[1],
                "owner": ADDR,
                "address": "0x0",
                "sol_src": "return true;",
            })
        if path.endswith("/condition") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json({"name": body["name"], "owner": ADDR, "address": "0x0"}, 201)

        if path.endswith("/execute") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json([{"path": f"/{body['connector_name']}", "data": [1, 2, 3]}])

        if path.endswith("/formats") and method == "GET":
            return make_json({
                "limit": int(query["limit"]),
                "total_formats": 1,
                "cursor": {"has_more": False, "next_after": None},
                "formats": [FORMAT],
            })

        if "/format/" in path and method == "GET":
            return make_json({
                "format_hash": path.rsplit("/", 1)[1],
                "limit": int(query["limit"]),
                "total_connectors": 1,
                "cursor": {"has_more": False, "next_after": None},
                "scalars": ["scalar:0"],
                "connectors": ["pitch"],
            })

        if path.endswith("/feed") and method == "GET":
            return make_json({
                "limit": int(query["limit"]),
                "cursor": {"has_more": False, "next_before": None},
                "items": [{
                    "feed_id": "eth:1:connector_added:pitch",
                    "event_type": "connector_added",
                    "status": "finalized",
                    "visible": True,
                    "tx_hash": "0xabc",
                    "block_number": 1,
                    "tx_index": 0,
                    "log_index": 0,
                    "history_cursor": "cursor",
                    "created_at_ms": 1,
                    "updated_at_ms": 1,
                    "projector_version": 1,
                    "payload": {"type": "connector", "name": "pitch", "owner": ADDR},
                }],
            })

        if path.endswith("/feed/stream") and method == "GET":
            return httpx.Response(
                200,
                text='event: stream_meta\ndata: {"has_more":false}\n\n',
                headers={"content-type": "text/event-stream"},
            )

        return make_json({"error": "not_found", "path": path}, 404)
