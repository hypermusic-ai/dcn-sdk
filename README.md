# decentralised.art SDKs

SDKs for the chain API : `https://api.decentralised.art/chain`

---

[![Release](https://github.com/decentralised-art/sdk/actions/workflows/release.yml/badge.svg)](https://github.com/decentralised-art/sdk/actions/workflows/release.yml)

- [decentralised.art SDKs](#decentralisedart-sdks)
  - [Install (Python SDK)](#install-python-sdk)
  - [Install (JavaScript SDK)](#install-javascript-sdk)
  - [Release Process](#release-process)

---

## Install (Python SDK)

Package name: `decentralised-art`
Requires Python `3.9+`

[Learn more about Python SDK](python/README.md)

Install from the latest source on `main`:

```bash
pip install "git+https://github.com/decentralised-art/sdk.git@main#subdirectory=python"
```

Install a pinned release:

```bash
pip install "decentralised-art @ https://github.com/decentralised-art/sdk/releases/download/v0.1.0/decentralised-art-python-sdk.tar.gz"
```

Install the latest GitHub Release:

```bash
pip install "decentralised-art @ https://github.com/decentralised-art/sdk/releases/latest/download/decentralised-art-python-sdk.tar.gz"
```

## Install (JavaScript SDK)

Package name: `decentralised-art`

[Learn more about JavaScript SDK](js/README.md)

Install a pinned release with npm:

```bash
npm install "https://github.com/decentralised-art/sdk/releases/download/v0.1.0/decentralised-art-js-sdk.tgz"
```

Install the latest GitHub Release:

```bash
npm install "https://github.com/decentralised-art/sdk/releases/latest/download/decentralised-art-js-sdk.tgz"
```

Prefer the pinned URL in production so installs are reproducible.

## Release Process

Set the JavaScript package version, commit it, then push a matching version tag:

```bash
cd js
npm version 0.1.0 --no-git-tag-version
cd ..
git add js/package.json js/package-lock.json
git commit -m "Release v0.1.0"
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds, checks, and attaches release assets when the tag is pushed.

The release includes:

- `decentralised-art-js-sdk.tgz` and the versioned npm tarball for JavaScript/TypeScript projects.
- `decentralised-art-python-sdk.tar.gz` plus the versioned Python wheel and source distribution files.
