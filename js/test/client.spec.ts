import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DcnApiError, DcnClient } from '../src/client';
import '../test/setup';

const ADDR = '0x1111111111111111111111111111111111111111';
const FORMAT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DCN JS SDK wrapper', () => {
  let sdk: DcnClient;

  beforeEach(() => {
    sdk = new DcnClient({ baseUrl: 'https://example.invalid/chain' });
  });

  it('uses the chain base URL for version', async () => {
    const v = await sdk.version();
    expect(v.version).toBe('0.4.0');

    const last = globalThis.__lastRequests.at(-1)!;
    expect(last.input).toBe('https://example.invalid/chain/version');
  });

  it('uses DCN_API_BASE and strips trailing slashes', async () => {
    const previousBase = process.env.DCN_API_BASE;
    process.env.DCN_API_BASE = 'https://env.invalid/chain/';
    try {
      const envSdk = new DcnClient();
      const v = await envSdk.version();
      expect(v.version).toBe('0.4.0');

      const last = globalThis.__lastRequests.at(-1)!;
      expect(last.input).toBe('https://env.invalid/chain/version');
    } finally {
      if (previousBase === undefined) {
        delete process.env.DCN_API_BASE;
      } else {
        process.env.DCN_API_BASE = previousBase;
      }
    }
  });

  it('supports custom fetch and scopes bearer auth to authenticated requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/version')) {
        return json({ version: '0.4.0', build_timestamp: '2026-04-30T00:00:00Z' });
      }
      if (url.endsWith('/connector')) {
        return json({ name: 'melody', owner: ADDR, address: '0x0', format_hash: FORMAT }, 201);
      }
      return json({ error: 'not_found' }, 404);
    });
    const customSdk = new DcnClient({
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

  it('authenticates with nonce and attaches bearer token afterwards', async () => {
    const { nonce } = await sdk.getNonce(ADDR);
    const auth = await sdk.loginWithSignature(ADDR, `Login nonce: ${nonce}`, '0xSIG');
    expect(auth.access_token).toBe('access-123');
    expect(sdk.accessToken).toBe('access-123');

    await sdk.execute('pitch', 8);
    const last = globalThis.__lastRequests.at(-1)!;
    const authorization = new Headers(last.init?.headers as HeadersInit).get('Authorization');
    expect(authorization).toBe('Bearer access-123');
  });

  it('authenticates wallets with getAddress and the nonce message', async () => {
    const wallet = {
      getAddress: vi.fn(async () => ADDR),
      signMessage: vi.fn(async (message: string) => {
        expect(message).toBe('Login nonce: abcd-efgh');
        return '0xSIG';
      }),
    };

    const auth = await sdk.loginWithWallet(wallet);
    expect(auth.access_token).toBe('access-123');
    expect(wallet.getAddress).toHaveBeenCalledOnce();
    expect(wallet.signMessage).toHaveBeenCalledWith('Login nonce: abcd-efgh');

    const last = globalThis.__lastRequests.at(-1)!;
    expect(JSON.parse(last.init?.body as string)).toEqual({
      address: ADDR,
      message: 'Login nonce: abcd-efgh',
      signature: '0xSIG',
    });
  });

  it('rejects wallet login when no address is available', async () => {
    await expect(sdk.loginWithWallet({ signMessage: vi.fn() })).rejects.toThrow(
      'Wallet address is unavailable'
    );
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

  it('gets, checks, and publishes connectors', async () => {
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

  it('gets, checks, and publishes transformations and conditions', async () => {
    await expect(sdk.transformationExists('identity')).resolves.toBe(true);
    await expect(sdk.transformationExists('missing')).resolves.toBe(false);
    expect((await sdk.transformationGet('identity')).sol_src).toBe('return x;');
    const transformation = await sdk.transformationPost({ name: 'shift', sol_src: 'return x + 1;' });
    expect(transformation).toEqual({ name: 'shift', owner: ADDR, address: '0x0' });
    expect(transformation).not.toHaveProperty('sol_src');
    expect(JSON.parse(globalThis.__lastRequests.at(-1)!.init?.body as string)).toEqual({
      name: 'shift',
      sol_src: 'return x + 1;',
    });

    await expect(sdk.conditionExists('always')).resolves.toBe(true);
    await expect(sdk.conditionExists('missing')).resolves.toBe(false);
    expect((await sdk.conditionGet('always')).sol_src).toBe('return true;');
    const condition = await sdk.conditionPost({ name: 'gate', sol_src: 'return true;' });
    expect(condition).toEqual({ name: 'gate', owner: ADDR, address: '0x0' });
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
    expect(out[0].path).toBe('/pitch');
    expect(out[0].data).toEqual([1, 2, 3]);

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
    const errorSdk = new DcnClient({
      baseUrl: 'https://example.invalid/chain',
      fetch: fetchMock,
    });

    await expect(errorSdk.connectorGet('missing')).rejects.toMatchObject<DcnApiError>({
      status: 400,
      body: { error: 'bad_request' },
    });
    await expect(errorSdk.execute('pitch', 8)).rejects.toMatchObject<DcnApiError>({
      status: 500,
      body: 'plain failure',
    });
    await expect(errorSdk.connectorExists('pitch')).rejects.toMatchObject<DcnApiError>({
      status: 503,
      body: 'temporarily down',
    });
    await expect(errorSdk.feedStream()).rejects.toMatchObject<DcnApiError>({
      status: 502,
      body: { error: 'stream_failed' },
    });
  });
});
