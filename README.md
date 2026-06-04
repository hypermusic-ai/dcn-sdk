# Decentralized Creative Network SDKs

SDKs for the chain API : `https://api.decentralised.art/chain`

---

[![Release](https://github.com/hypermusic-ai/dcn-sdk/actions/workflows/release.yml/badge.svg)](https://github.com/hypermusic-ai/dcn-sdk/actions/workflows/release.yml)

- [Decentralized Creative Network SDKs](#decentralized-creative-network-sdks)
  - [Install (Python SDK)](#install-python-sdk)
  - [Install (JavaScript SDK)](#install-javascript-sdk)
  - [Release Process](#release-process)

---

## Install (Python SDK)

Package name: `dcn`
Requires Python `3.9+`

[Learn more about Python SDK](python/README.md)

Install from the latest source on `main`:

```bash
pip install "git+https://github.com/hypermusic-ai/dcn-sdk.git@main#subdirectory=python"
```

Install a pinned release:

```bash
pip install "dcn @ https://github.com/hypermusic-ai/dcn-sdk/releases/download/v0.1.0/dcn-python-sdk.tar.gz"
```

Install the latest GitHub Release:

```bash
pip install "dcn @ https://github.com/hypermusic-ai/dcn-sdk/releases/latest/download/dcn-python-sdk.tar.gz"
```

## Install (JavaScript SDK)

Package name: `dcn`

[Learn more about JavaScript SDK](js/README.md)

Install a pinned release with npm:

```bash
npm install "https://github.com/hypermusic-ai/dcn-sdk/releases/download/v0.1.0/dcn-js-sdk.tgz"
```

Install the latest GitHub Release:

```bash
npm install "https://github.com/hypermusic-ai/dcn-sdk/releases/latest/download/dcn-js-sdk.tgz"
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

- `dcn-js-sdk.tgz` and the versioned npm tarball for JavaScript/TypeScript projects.
- `dcn-python-sdk.tar.gz` plus the versioned Python wheel and source distribution files.
