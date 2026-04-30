import { DcnClient } from '@hypermusic-ai/dcn-js';
import { Wallet } from 'ethers';

async function main() {
    const sdk = new DcnClient();

    const version = await sdk.version();
    console.log('API:', version.version, version.build_timestamp);

    const connector = await sdk.connectorGet('pitch');
    console.log('pitch format:', connector.format_hash);

    const feed = await sdk.feed({ limit: 5, includeUnfinalized: true });
    console.log('feed items:', feed.items.map((item) => item.payload.name));

    const wallet = Wallet.createRandom();
    await sdk.loginWithWallet(wallet);

    const output = await sdk.execute('pitch', 8, {
        '0': { start_point: 12, transformation_shift: 3 },
    });
    console.log('execute pitch result:', output);
}

main();
