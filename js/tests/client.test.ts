import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DecentralisedArtClient } from '../src/client';
import type { DecentralisedArtApiError } from '../src/client';
import { ADDR, FORMAT, HASH, TX, json } from './fixtures';

const SIGNING = {
  type: '0x2',
  nonce: '0x7',
  maxFeePerGas: '0xd09dc300',
  maxPriorityFeePerGas: '0x59682f00',
  value: '0x0',
} as const;
const TRANSACTION = { from: ADDR, to: ADDR, data: '0x1234', chainId: '0x1', gas: '0x5208' };

// A server that prepares for relay, relays, and answers pending until `minedAfter` checks.
function relayServer(minedAfter: number) {
  const calls: Array<{ path: string; body: unknown }> = [];
  let confirmChecks = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/chain', '');
    if (path.startsWith('/nonce/')) return json({ nonce: 'abcd-efgh' });
    if (path === '/auth') return json({ access_token: 'access-123' });
    const body = JSON.parse(init?.body as string) as { name: string; tx_hash?: string };
    calls.push({ path, body });
    if (path.endsWith('/prepare')) {
      const base = { kind: 'transformation', name: body.name, address: ADDR, content_hash: HASH };
      if (body.name === 'done') return json({ ...base, status: 'published', owner: ADDR });
      return json({
        ...base,
        status: 'prepared',
        transaction: TRANSACTION,
        publication_nonce: 0,
        deadline: 1790000000,
        signing: SIGNING,
      });
    }
    if (path.endsWith('/send')) return json({ status: 'pending', tx_hash: TX }, 202);
    confirmChecks += 1;
    if (confirmChecks < minedAfter) return json({ message: 'not mined yet', status: 'pending', tx_hash: TX }, 202);
    return json({
      status: 'mined',
      kind: 'transformation',
      name: body.name,
      tx_hash: TX,
      block_number: 8,
      address: ADDR,
      owner: ADDR,
      content_hash: HASH,
    }, 201);
  });
  const client = new DecentralisedArtClient({ baseUrl: 'https://example.invalid/chain', accessToken: 'token', fetch });
  return { client, calls };
}

// An ethers-style wallet: signs login messages and transactions.
function ethersWallet() {
  return {
    address: ADDR,
    signMessage: vi.fn(async () => '0xSIG'),
    signTransaction: vi.fn(async () => '0x02ef01'),
  };
}

describe('decentralised.art JS SDK wrapper', () => {
  let sdk: DecentralisedArtClient;

  beforeEach(() => {
    sdk = new DecentralisedArtClient({ baseUrl: 'https://example.invalid/chain' });
  });

  it('uses the chain base URL for version', async () => {
    const v = await sdk.version();
    expect(v.version).toBe('0.4.0');

    const last = globalThis.__lastRequests.at(-1)!;
    expect(last.input).toBe('https://example.invalid/chain/version');
  });

  it('uses DECENTRALISED_ART_API_BASE and strips trailing slashes', async () => {
    const previousBase = process.env.DECENTRALISED_ART_API_BASE;
    process.env.DECENTRALISED_ART_API_BASE = 'https://env.invalid/chain/';
    try {
      const envSdk = new DecentralisedArtClient();
      const v = await envSdk.version();
      expect(v.version).toBe('0.4.0');

      const last = globalThis.__lastRequests.at(-1)!;
      expect(last.input).toBe('https://env.invalid/chain/version');
    } finally {
      if (previousBase === undefined) {
        delete process.env.DECENTRALISED_ART_API_BASE;
      } else {
        process.env.DECENTRALISED_ART_API_BASE = previousBase;
      }
    }
  });

  it('supports custom fetch and scopes bearer auth to authenticated requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/version')) {
        return json({ version: '0.4.0', build_timestamp: '2026-04-30T00:00:00Z' });
      }
      if (url.endsWith('/connector')) {
        return json({ name: 'melody', owner: ADDR, address: '0x0', format_hash: FORMAT }, 201);
      }
      return json({ error: 'not_found' }, 404);
    });
    const customSdk = new DecentralisedArtClient({
      baseUrl: 'https://custom.invalid/chain///',
      accessToken: 'token-123',
      fetch: fetchMock,
    });

    await customSdk.version();
    expect(fetchMock.mock.calls[0][0]).toBe('https://custom.invalid/chain/version');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit).get('Authorization')).toBeNull();

    await customSdk.connectorPost({
      name: 'melody',
      dimensions: [{ transformations: [{ name: 'identity', args: [] }] }],
      condition_name: '',
      condition_args: [],
    });
    const postInit = fetchMock.mock.calls[1][1]!;
    expect(new Headers(postInit.headers as HeadersInit).get('Authorization')).toBe('Bearer token-123');
    expect(JSON.parse(postInit.body as string)).toEqual({
      name: 'melody',
      dimensions: [{ transformations: [{ name: 'identity', args: [] }] }],
      condition_name: '',
      condition_args: [],
    });
  });

  it('lists accounts and fetches account ownership with cursors', async () => {
    const listed = await sdk.listAccounts({ limit: 2, after: ADDR });
    expect(listed.accounts).toEqual([ADDR]);
    expect(globalThis.__lastRequests.at(-1)!.input as string).toContain(`after=${ADDR}`);

    const info = await sdk.accountInfo(ADDR, {
      limit: 3,
      afterConnectors: 'pitch',
      afterTransformations: 'identity',
      afterConditions: 'always',
    });
    expect(info.owned_connectors).toEqual(['pitch']);

    const last = globalThis.__lastRequests.at(-1)!;
    const url = last.input as string;
    expect(url).toContain(`/account/${ADDR}`);
    expect(url).toContain('limit=3');
    expect(url).toContain('after_connectors=pitch');
    expect(url).toContain('after_transformations=identity');
    expect(url).toContain('after_conditions=always');
  });

  it('gets, checks, and creates connectors', async () => {
    await expect(sdk.connectorExists('pitch')).resolves.toBe(true);
    await expect(sdk.connectorExists('missing')).resolves.toBe(false);

    const connector = await sdk.connectorGet('pitch');
    expect(connector.format_hash).toBe(FORMAT);
    expect(connector.dimensions[0].transformations[0].name).toBe('identity');

    const created = await sdk.connectorPost({
      name: 'melody',
      dimensions: [{ transformations: [{ name: 'identity', args: [] }] }],
      condition_name: '',
      condition_args: [],
    });
    expect(created.name).toBe('melody');

    const last = globalThis.__lastRequests.at(-1)!;
    expect(JSON.parse(last.init?.body as string)).toEqual({
      name: 'melody',
      dimensions: [{ transformations: [{ name: 'identity', args: [] }] }],
      condition_name: '',
      condition_args: [],
    });
  });

  it('gets, checks, and creates transformations and conditions', async () => {
    await expect(sdk.transformationExists('identity')).resolves.toBe(true);
    await expect(sdk.transformationExists('missing')).resolves.toBe(false);
    expect(await sdk.transformationGet('identity')).toEqual({ name: 'identity', args_count: 1, owner: ADDR, address: '0x0' });
    const transformation = await sdk.transformationPost({ name: 'shift', sol_src: 'return x + 1;' });
    expect(transformation).toEqual({ name: 'shift', owner: ADDR, address: '0x0', args_count: 1 });
    expect(transformation).not.toHaveProperty('sol_src');
    expect(JSON.parse(globalThis.__lastRequests.at(-1)!.init?.body as string)).toEqual({
      name: 'shift',
      sol_src: 'return x + 1;',
    });

    await expect(sdk.conditionExists('always')).resolves.toBe(true);
    await expect(sdk.conditionExists('missing')).resolves.toBe(false);
    expect(await sdk.conditionGet('always')).toEqual({ name: 'always', args_count: 0, owner: ADDR, address: '0x0' });
    const condition = await sdk.conditionPost({ name: 'gate', sol_src: 'return true;' });
    expect(condition).toEqual({ name: 'gate', owner: ADDR, address: '0x0', args_count: 0 });
    expect(condition).not.toHaveProperty('sol_src');
    expect(JSON.parse(globalThis.__lastRequests.at(-1)!.init?.body as string)).toEqual({
      name: 'gate',
      sol_src: 'return true;',
    });
  });

  it('executes connectors with POST /execute', async () => {
    const out = await sdk.execute('pitch', 8, {
      '0': { start_point: 12, transformation_shift: 3 },
    });
    expect(out.block_number).toBe(7);
    expect(out.runner).toBe(ADDR);
    expect(out.particles[0].path).toBe('/pitch');
    expect(out.particles[0].data).toEqual([1, 2, 3]);

    const last = globalThis.__lastRequests.at(-1)!;
    expect(last.input).toBe('https://example.invalid/chain/execute');
    expect(last.init?.method).toBe('POST');
    expect(JSON.parse(last.init?.body as string)).toEqual({
      connector_name: 'pitch',
      particles_count: 8,
      dynamic_ri: { '0': { start_point: 12, transformation_shift: 3 } },
    });

    await sdk.execute('pitch', '8');
    expect(JSON.parse(globalThis.__lastRequests.at(-1)!.init?.body as string)).toEqual({
      connector_name: 'pitch',
      particles_count: '8',
    });
  });

  it('simulates connectors with POST /simulate', async () => {
    const out = await sdk.simulate('pitch', 4, { '1': { start_point: 0, transformation_shift: 1 } });
    expect(out).toEqual([{ path: '/pitch', data: [4, 5] }]);

    const last = globalThis.__lastRequests.at(-1)!;
    expect(last.input).toBe('https://example.invalid/chain/simulate');
    expect(JSON.parse(last.init?.body as string)).toEqual({
      connector_name: 'pitch',
      particles_count: 4,
      dynamic_ri: { '1': { start_point: 0, transformation_shift: 1 } },
    });
  });

  it('prepares and confirms publications', async () => {
    const prepared = await sdk.publishPrepare('connector', 'pitch');
    if (prepared.status !== 'prepared') throw new Error(`unexpected status ${prepared.status}`);
    expect(prepared.transaction.chainId).toBe('0x1');
    let last = globalThis.__lastRequests.at(-1)!;
    expect(last.input).toBe('https://example.invalid/chain/publish/connector/prepare');
    expect(JSON.parse(last.init?.body as string)).toEqual({ name: 'pitch' });

    expect((await sdk.publishPrepare('condition', 'done')).status).toBe('published');

    const pending = await sdk.publishConfirm('connector', { name: 'pitch', content_hash: HASH, tx_hash: '0x00' });
    expect(pending.status).toBe('pending');

    const mined = await sdk.publishConfirm('connector', { name: 'pitch', content_hash: HASH, tx_hash: TX });
    expect(mined).toMatchObject({ status: 'mined', kind: 'connector', name: 'pitch', block_number: 8 });
    last = globalThis.__lastRequests.at(-1)!;
    expect(last.input).toBe('https://example.invalid/chain/publish/connector');
  });

  it('publishes through the relay: prepare, sign offline, send, confirm until mined', async () => {
    const { client, calls } = relayServer(2);
    const signTransaction = vi.fn(async () => '0x02abcd');

    const out = await client.publish('transformation', 'shift', {
      signer: { address: ADDR, signTransaction },
      pollIntervalMs: 0,
    });
    expect(out).toMatchObject({ status: 'mined', block_number: 8, tx_hash: TX });
    expect(signTransaction).toHaveBeenCalledWith({ ...TRANSACTION, ...SIGNING });
    expect(calls.map(({ path }) => path)).toEqual([
      '/publish/transformation/prepare',
      '/publish/transformation/send',
      '/publish/transformation',
      '/publish/transformation',
    ]);
    expect(calls.map(({ body }) => body)).toEqual([
      { name: 'shift', relay: true },
      { name: 'shift', content_hash: HASH, raw_tx: '0x02abcd' },
      { name: 'shift', content_hash: HASH, tx_hash: TX },
      { name: 'shift', content_hash: HASH, tx_hash: TX },
    ]);
  });

  it('publish signs nothing for another owner, another chain, a higher fee, or an existing publication', async () => {
    const { client } = relayServer(1);
    const signTransaction = vi.fn(async () => '0x02abcd');

    const signer = { signTransaction };

    await expect(client.publish('transformation', 'shift', { signer: { address: `0x${'22'.repeat(20)}`, signTransaction } }))
      .rejects.toThrow(/not the entity owner/);
    await expect(client.publish('transformation', 'shift', { signer, chainId: 5 }))
      .rejects.toThrow(/chain 1, not 5/);
    await expect(client.publish('transformation', 'shift', { signer, maxFeePerGas: 1_000_000_000n }))
      .rejects.toThrow(/exceeds the limit/);
    await expect(client.publish('transformation', 'done', { signer }))
      .resolves.toMatchObject({ status: 'published', address: ADDR });
    expect(signTransaction).not.toHaveBeenCalled();

    // Limits the prepared transaction satisfies do not get in the way.
    await expect(client.publish('transformation', 'shift', { signer, chainId: '0x1', maxFeePerGas: 3_500_000_000 }))
      .resolves.toMatchObject({ status: 'mined' });
  });

  it('publish gives up after the configured confirmation attempts', async () => {
    const { client, calls } = relayServer(Number.POSITIVE_INFINITY);
    await expect(client.publish('transformation', 'shift', {
      signer: { signTransaction: async () => '0x02abcd' },
      pollIntervalMs: 0,
      maxConfirmAttempts: 3,
    })).rejects.toThrow(`Publication ${TX} is not mined yet`);
    expect(calls.filter(({ path }) => path === '/publish/transformation')).toHaveLength(3);
  });

  it('publish signs with the wallet used to log in, in the shape ethers expects', async () => {
    const { client, calls } = relayServer(1);
    const wallet = ethersWallet();
    await client.loginWithWallet(wallet);

    await expect(client.publish('transformation', 'shift')).resolves.toMatchObject({ status: 'mined' });
    expect(wallet.signTransaction).toHaveBeenCalledWith({
      type: 2,
      chainId: 1n,
      nonce: 7,
      to: TRANSACTION.to,
      data: TRANSACTION.data,
      gasLimit: 0x5208n,
      maxFeePerGas: 3_500_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
      value: 0n,
    });
    expect(calls.find(({ path }) => path.endsWith('/send'))?.body).toMatchObject({ raw_tx: '0x02ef01' });

    // An explicit signer takes precedence over the remembered wallet.
    const signTransaction = vi.fn(async () => '0x02abcd');
    await client.publish('transformation', 'shift', { signer: { signTransaction } });
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(wallet.signTransaction).toHaveBeenCalledOnce();
  });

  it('publish explains the browser flow when the signer cannot sign offline, and sends nothing', async () => {
    const { client, calls } = relayServer(1);
    const refusal = new Error('The method "eth_signTransaction" does not exist / is not available.');
    const signTransaction = vi.fn(async () => {
      throw refusal;
    });

    const failure = client.publish('transformation', 'shift', { signer: { address: ADDR, signTransaction } });
    await expect(failure).rejects.toThrow(/cannot sign without sending: call publishPrepare/);
    await expect(failure).rejects.toMatchObject({ cause: refusal });
    expect(calls.map(({ path }) => path)).toEqual(['/publish/transformation/prepare']);
  });

  it('publish has no signer without a transaction-signing login, and fails before preparing', async () => {
    const { client, calls } = relayServer(1);

    // Nobody logged in.
    await expect(client.publish('transformation', 'shift')).rejects.toThrow(/No signer/);

    // A wallet that only signs messages, as a browser wallet exposes it.
    await client.loginWithWallet({ address: ADDR, signMessage: async () => '0xSIG' });
    await expect(client.publish('transformation', 'shift')).rejects.toThrow(/No signer/);

    // A signature login forgets the wallet of an earlier login.
    await client.loginWithWallet(ethersWallet());
    await client.loginWithSignature(ADDR, 'Login nonce: abcd-efgh', '0xSIG');
    await expect(client.publish('transformation', 'shift')).rejects.toThrow(/No signer/);

    expect(calls).toHaveLength(0);
  });

  it('prepares for relay and sends a signed publication', async () => {
    const { client, calls } = relayServer(1);
    const prepared = await client.publishPrepare('transformation', 'shift', { relay: true });
    if (prepared.status !== 'prepared') throw new Error(`unexpected status ${prepared.status}`);
    expect(prepared.signing).toEqual(SIGNING);

    const sent = await client.publishSend('transformation', { name: 'shift', content_hash: HASH, raw_tx: '0x02abcd' });
    expect(sent).toEqual({ status: 'pending', tx_hash: TX });
    expect(calls.map(({ path }) => path)).toEqual(['/publish/transformation/prepare', '/publish/transformation/send']);
  });

  it('lists formats, fetches format membership, and fetches feed pages', async () => {
    const formats = await sdk.listFormats({ limit: 4, after: FORMAT });
    expect(formats.formats).toEqual([FORMAT]);
    expect(globalThis.__lastRequests.at(-1)!.input as string).toContain(`after=${FORMAT}`);

    const format = await sdk.formatInfo(FORMAT, { limit: 5, after: 'pitch' });
    expect(format.connectors).toEqual(['pitch']);
    expect(globalThis.__lastRequests.at(-1)!.input as string).toContain('after=pitch');

    const feed = await sdk.feed({
      limit: 6,
      before: 'cursor',
      type: 'connector_added',
      includeUnfinalized: true,
    });
    expect(feed.items[0].event_type).toBe('connector_added');

    const last = globalThis.__lastRequests.at(-1)!;
    const url = last.input as string;
    expect(url).toContain('before=cursor');
    expect(url).toContain('type=connector_added');
    expect(url).toContain('include_unfinalized=1');
  });

  it('omits optional feed query params when unset', async () => {
    await sdk.feed();

    const url = new URL(globalThis.__lastRequests.at(-1)!.input as string);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('before')).toBe(false);
    expect(url.searchParams.has('type')).toBe(false);
    expect(url.searchParams.has('include_unfinalized')).toBe(false);
  });

  it('opens the feed stream endpoint', async () => {
    const response = await sdk.feedStream({ sinceSeq: 10, limit: 20 });
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const last = globalThis.__lastRequests.at(-1)!;
    expect(last.input as string).toContain('/feed/stream?since_seq=10&limit=20');
  });

  it('surfaces JSON, text, HEAD, and stream API errors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'HEAD') {
        return new Response('temporarily down', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      if (url.endsWith('/execute')) {
        return new Response('plain failure', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      if (url.endsWith('/feed/stream')) {
        return json({ error: 'stream_failed' }, 502);
      }
      return json({ error: 'bad_request' }, 400);
    });
    const errorSdk = new DecentralisedArtClient({
      baseUrl: 'https://example.invalid/chain',
      fetch: fetchMock,
    });

    await expect(errorSdk.connectorGet('missing')).rejects.toMatchObject<DecentralisedArtApiError>({
      status: 400,
      body: { error: 'bad_request' },
    });
    await expect(errorSdk.execute('pitch', 8)).rejects.toMatchObject<DecentralisedArtApiError>({
      status: 500,
      body: 'plain failure',
    });
    await expect(errorSdk.connectorExists('pitch')).rejects.toMatchObject<DecentralisedArtApiError>({
      status: 503,
      body: 'temporarily down',
    });
    await expect(errorSdk.feedStream()).rejects.toMatchObject<DecentralisedArtApiError>({
      status: 502,
      body: { error: 'stream_failed' },
    });
  });
});
