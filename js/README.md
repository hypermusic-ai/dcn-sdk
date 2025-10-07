# Typescript / Javascript SDK

## Build

```bash
npm run prepack
```

```bash
npm link
npm link @hypermusic-ai/dcn-js
```

## Test

```bash
npm test
```

## Quick start

```typescript
import { DcnClient } from '@hypermusic-ai/dcn-js';
import { Wallet } from 'ethers';

async function main() {
    const sdk = new DcnClient(); // uses https://api.decentralised.art by default

    const v = await sdk.version();
    console.log('API:', v.version, v.build_timestamp);

    const f = await sdk.featureGet('pitch');
    console.log(f);

    const t = await sdk.transformationGet('add');
    console.log(t);

    // 1) Pick an address (wallet)
    const wallet = Wallet.createRandom();
    const auth = await sdk.loginWithWallet(wallet);
    console.log('access_token:', auth.access_token.slice(0, 10), '...');

    // Create a transformation
    //   await sdk.transformationPost({
    //     name: 'add',
    //     sol_src: 'return x + args[0];'
    //   });

    //   // Create a feature
    //   await sdk.featurePost({
    //     name: 'melody',
    //     dimensions: [
    //       { feature_name: 'pitch', transformations: [{ name: 'add', args: [1] }, { name: 'mul', args: [2] }] },
    //       { feature_name: 'time', transformations: [] }
    //     ]
    //   });

      // Execute (no running instances)
      const out0 = await sdk.execute('pitch', 8);
      console.log('execute pitch result:', out0);

      // Execute (with running instances)
      const out1 = await sdk.execute('ThreePer4', 8, [[12, 3],[0,0],[1,1]]);
      console.log('execute ThreePer4 result:', out1);
}
main();
```
