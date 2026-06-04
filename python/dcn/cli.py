from __future__ import annotations

import argparse
import json

from .client import Client


def main() -> None:
    parser = argparse.ArgumentParser(prog="dcn-auth")
    parser.add_argument("--base-url", default=None)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("version")

    nonce = subparsers.add_parser("nonce")
    nonce.add_argument("address")

    args = parser.parse_args()
    client = Client(base_url=args.base_url)

    if args.command == "version":
        result = client.version()
    elif args.command == "nonce":
        result = client.get_nonce(args.address)
    else:
        parser.error(f"Unknown command: {args.command}")

    print(json.dumps(result, indent=2))
