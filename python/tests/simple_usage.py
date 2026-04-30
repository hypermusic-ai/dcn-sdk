from eth_account import Account
import dcn


def main() -> None:
    sdk = dcn.Client()

    version = sdk.version()
    print(version["version"])
    print(version["build_timestamp"])

    connector = sdk.connector_get("pitch")
    print(connector["format_hash"])

    feed = sdk.feed(limit=5, include_unfinalized=True)
    print([item["payload"]["name"] for item in feed["items"]])

    account = Account.create()
    sdk.login_with_account(account)

    output = sdk.execute(
        "pitch",
        8,
        {"0": {"start_point": 12, "transformation_shift": 3}},
    )
    print(output[0]["path"])
    print(output[0]["data"])


if __name__ == "__main__":
    main()
