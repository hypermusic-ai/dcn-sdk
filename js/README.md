# Typescript / Javascript SDK

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
console.log(result);
```

The SDK defaults to the chain API base URL, `https://api.decentralised.art/chain`.
Set `DCN_API_BASE` or pass `new DcnClient({ baseUrl })` to target another chain API.
