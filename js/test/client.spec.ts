import { describe, it, expect, beforeEach } from 'vitest';
import { DcnClient } from '../src/client';
import '../test/setup'; // ensure fetch is mocked

// a sample address
const ADDR = '0x1111111111111111111111111111111111111111' as const;

describe('DCN JS SDK wrapper', () => {
  let sdk: DcnClient;

  beforeEach(() => {
    sdk = new DcnClient({ baseUrl: 'https://example.invalid' });
  });

  it('GET /version', async () => {
    const v = await sdk.version();
    expect(v.version).toBe('1.2.3');

    const last = globalThis.__lastRequests.at(-1)!;
    expect(typeof last.input).toBe('string');
    expect((last.input as string).endsWith('/version')).toBe(true);
    // no Authorization header before login
    expect((last.init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it('nonce → auth sets tokens and Authorization header is attached afterwards', async () => {
    const { nonce } = await sdk.getNonce(ADDR);
    expect(nonce).toBe('abcd-efgh');

    const login = await sdk.loginWithSignature(ADDR, `Login nonce: ${nonce}`, '0xSIG');
    expect(login.access_token).toBe('access-123');
    expect(login.refresh_token).toBe('refresh-456');

    // Call something authenticated now
    await sdk.execute('melody', 64);
    const last = globalThis.__lastRequests.at(-1)!;
    const auth = new Headers(last.init?.headers as HeadersInit).get('Authorization');
    expect(auth).toBe('Bearer access-123');
  });

  it('POST /refresh rotates access token', async () => {
    // seed tokens via login
    await sdk.getNonce(ADDR);
    await sdk.loginWithSignature(ADDR, 'Login nonce: abcd-efgh', '0xSIG');

    const refreshed = await sdk.refresh();
    expect(refreshed.access_token).toBe('access-789');
    expect(sdk.accessToken).toBe('access-789');

    // after refresh, Authorization must carry the new token
    await sdk.execute('melody', 64);
    const last = globalThis.__lastRequests.at(-1)!;
    const auth = new Headers(last.init?.headers as HeadersInit).get('Authorization');
    expect(auth).toBe('Bearer access-789');
  });

  it('GET /account/{address}', async () => {
    const res = await sdk.accountInfo(ADDR, 25, 0);
    expect(res.address).toBe(ADDR);
    expect(res.total_features).toBeTypeOf('number');

    const last = globalThis.__lastRequests.at(-1)!;
    const url = last.input as string;
    expect(url.includes(`/account/${ADDR}`)).toBe(true);
    expect(url.includes('limit=25')).toBe(true);
    expect(url.includes('page=0')).toBe(true);
  });

  it('GET/POST /feature', async () => {
    const created = await sdk.featurePost({
      name: 'melody',
      dimensions: [{ feature_name: 'pitch', transformations: [] }],
    });
    expect(created.resource?.name).toBe('melody');
    expect(created.resource?.address).toBeDefined();

    const byName = await sdk.featureGet('melody');
    expect(byName.name).toBe('melody');
    expect(byName.address).toBe('latest');

    const byNameVer = await sdk.featureGet('melody', 'v1');
    expect(byNameVer.name).toBe('melody');
    expect(byNameVer.address).toBe('v1');
  });

  it('GET/POST /transformation', async () => {
    const created = await sdk.transformationPost({
      name: 'add',
      sol_src: 'return x + 1;',
    });
    expect(created.resource?.name).toBe('add');
    expect(created.resource?.address).toBeDefined();

    const byName = await sdk.transformationGet('add');
    expect(byName.address).toBe('latest');

    const byNameVer = await sdk.transformationGet('add', 'v1');
    expect(byNameVer.address).toBe('v1');
  });

  it('GET /execute/{featureName}/{numSamples} (no running instances)', async () => {
    const out = await sdk.execute('melody', 64);
    expect(Array.isArray(out)).toBe(true);
    expect(out[0].feature_path).toBe('melody');

    const last = globalThis.__lastRequests.at(-1)!;
    const url = last.input as string;
    expect(url.endsWith('/execute/melody/64')).toBe(true);
  });

  it('GET /execute/{featureName}/{numSamples}/{running_instances}', async () => {
    const out = await sdk.execute('melody', 64, [
      [12, 3],
      [1, 1],
    ]);
    expect(out[0].data).toBe('[(12;3)(1;1)]');

    const last = globalThis.__lastRequests.at(-1)!;
    const url = last.input as string;
    expect(url.includes('/execute/melody/64/[(12;3)(1;1)]')).toBe(true);
  });
});
