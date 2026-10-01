# Typescript / Javascript SDK

## Install

Install a pinned GitHub Release with npm:

```bash
npm install "https://github.com/decentralised-art/sdk/releases/download/v0.2.0/decentralised-art-js-sdk.tgz"
```

Install the latest GitHub Release:

```bash
npm install "https://github.com/decentralised-art/sdk/releases/latest/download/decentralised-art-js-sdk.tgz"
```

Prefer the pinned URL in production so installs are reproducible.

Install a wallet/signing library separately if your app needs wallet authentication. For example:

```bash
npm install ethers
```

## Build

```bash
npm run prepack
```

## Test

```bash
npm test
```

## Quick Start

```typescript
import { DecentralisedArtClient } from 'decentralised-art';
import { Wallet } from 'ethers';

const sdk = new DecentralisedArtClient(); // https://api.decentralised.art/chain

const version = await sdk.version();
console.log(version.version, version.build_timestamp);

const connector = await sdk.connectorGet('pitch');
console.log(connector.format_hash);

const feed = await sdk.feed({ limit: 10, includeUnfinalized: true });
console.log(feed.items.map((item) => item.payload.name));

// Execution needs no login.
const result = await sdk.execute('pitch', 8, {
  '0': { start_point: 12, transformation_shift: 3 },
});
console.log(result.block_number, result.particles);

const wallet = Wallet.createRandom();
await sdk.loginWithWallet(wallet);

// Entities created through *Post are local until published by their owner.
await sdk.transformationPost({ name: 'shift', sol_src: 'return x + 1;' });
console.log(await sdk.simulate('pitch', 8));
```

The SDK defaults to the chain API base URL, `https://api.decentralised.art/chain`.
Set `DECENTRALISED_ART_API_BASE` or pass `new DecentralisedArtClient({ baseUrl })` to target another chain API.

### Publishing on chain

The owner pays for the publication and the server never holds their key. There are
two ways to get the transaction on chain.

**Relayed (no chain RPC needed).** Sign offline and let the server broadcast through
its own node. `publish` prepares, checks the owner, signs with the wallet you logged in
with, sends, and confirms until mined. It signs nothing when the registry already holds
the publication:

```typescript
import { Wallet } from 'ethers';

const wallet = new Wallet(process.env.OWNER_KEY!); // no provider needed
await sdk.loginWithWallet(wallet);

const result = await sdk.publish('transformation', 'shift', {
  maxFeePerGas: 50_000_000_000n, // refuse to sign above 50 gwei
});
console.log(result.status); // 'mined', or 'published' if it already was
```

Any wallet with ethers' `signTransaction` works this way. For anything else, pass
`signer: { address, signTransaction(tx) }`: `tx` holds hex quantities, exactly the params
of `eth_signTransaction`. After `loginWithSignature`, `publish` has no signer. A browser
wallet such as MetaMask cannot sign without sending: `publish` then fails before anything is
sent, and the browser wallet flow below is the way to publish.

The steps are also available one by one: `publishPrepare(kind, name, { relay: true })`,
`publishSend(kind, { name, content_hash, raw_tx })` and `publishConfirm`.

**Browser wallet.** A wallet such as MetaMask sends the transaction itself (it cannot
sign without sending):

```typescript
const prepared = await sdk.publishPrepare('transformation', 'shift');
if (prepared.status === 'prepared') {
  // prepared.transaction = { from, to, data, chainId, gas } with hex quantities,
  // exactly the params of eth_sendTransaction. With a browser (EIP-1193) wallet:
  const txHash = (await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [prepared.transaction],
  })) as string;

  // Confirm looks the receipt up once; repeat while it is still pending.
  let confirmed = await sdk.publishConfirm('transformation', {
    name: 'shift',
    content_hash: prepared.content_hash,
    tx_hash: txHash,
  });
  while (confirmed.status === 'pending') {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    confirmed = await sdk.publishConfirm('transformation', {
      name: 'shift',
      content_hash: prepared.content_hash,
      tx_hash: txHash,
    });
  }
  console.log(confirmed.status, confirmed.tx_hash); // 'mined'
}
// prepared.status === 'published': the registry already holds this exact entity.
```

### Errors

Responses outside the 2xx range reject with `DecentralisedArtApiError`, which carries the HTTP
`status` and the decoded response `body`:

```typescript
import { DecentralisedArtApiError } from 'decentralised-art';

try {
  await sdk.connectorGet('missing');
} catch (error) {
  if (error instanceof DecentralisedArtApiError) console.log(error.status, error.body);
  else throw error;
}
```
