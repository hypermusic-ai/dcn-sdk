# Typescript / Javascript SDK

## Install

Install a pinned GitHub Release with npm:

```bash
npm install "https://github.com/hypermusic-ai/dcn-sdk/releases/download/v0.1.0/dcn-js-sdk.tgz"
```

Install the latest GitHub Release:

```bash
npm install "https://github.com/hypermusic-ai/dcn-sdk/releases/latest/download/dcn-js-sdk.tgz"
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
import { DcnClient } from 'dcn';
import { Wallet } from 'ethers';

const sdk = new DcnClient(); // https://api.decentralised.art/chain

const version = await sdk.version();
console.log(version.version, version.build_timestamp);

const connector = await sdk.connectorGet('pitch');
console.log(connector.format_hash);

const feed = await sdk.feed({ limit: 10, includeUnfinalized: true });
console.log(feed.items.map((item) => item.payload.name));

const wallet = Wallet.createRandom();
await sdk.loginWithWallet(wallet);

const result = await sdk.execute('pitch', 8, {
  '0': { start_point: 12, transformation_shift: 3 },
});
console.log(result.block_number, result.particles);

// Entities created through *Post are local until published by their owner.
await sdk.transformationPost({ name: 'shift', sol_src: 'return x + 1;' });
console.log(await sdk.simulate('pitch', 8));
```

The SDK defaults to the chain API base URL, `https://api.decentralised.art/chain`.
Set `DCN_API_BASE` or pass `new DcnClient({ baseUrl })` to target another chain API.

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
of `eth_signTransaction`. After `loginWithSignature`, or with a wallet that cannot sign
without sending (MetaMask), `publish` has no signer; use the browser wallet flow below.

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
