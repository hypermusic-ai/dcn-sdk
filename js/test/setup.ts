import { vi, beforeEach, afterEach } from 'vitest';

declare global {
  // make TS happy when we assign to globalThis.fetch
  // eslint-disable-next-line no-var
  var __lastRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }>;
}

beforeEach(() => {
  globalThis.__lastRequests = [];

  // Simple router for our SDK endpoints
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    globalThis.__lastRequests.push({ input, init });

    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const json = (obj: unknown) =>
      new Response(JSON.stringify(obj), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    // VERSION
    if (url.endsWith('/version') && method === 'GET') {
      return json({ version: '1.2.3', build_timestamp: '2025-10-01T12:34:56Z' });
    }

    // AUTH: /nonce/{address}
    const nonceMatch = url.match(/\/nonce\/(0x[a-fA-F0-9]{40})$/);
    if (nonceMatch && method === 'GET') {
      const [, address] = nonceMatch;
      return json({ address, nonce: 'abcd-efgh' });
    }

    // AUTH: /auth
    if (url.endsWith('/auth') && method === 'POST') {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.message?.includes('abcd-efgh')) {
        return json({ access_token: 'access-123', refresh_token: 'refresh-456' });
      }
      return new Response('Unauthorized', { status: 401 });
    }

    // AUTH: /refresh
    if (url.endsWith('/refresh') && method === 'POST') {
      const xrt = (init?.headers as Record<string, string> | undefined)?.['X-Refresh-Token'];
      if (xrt === 'refresh-456') {
        return json({ access_token: 'access-789', refresh_token: 'refresh-456' });
      }
      return new Response('Unauthorized', { status: 401 });
    }

    // ACCOUNT: /account/{address}
    const acctMatch = url.match(/\/account\/(0x[a-fA-F0-9]{40})(?:\?.*)?$/);
    if (acctMatch && method === 'GET') {
      const [, addr] = acctMatch;
      return json({ address: addr, total_features: 2, total_transformations: 1, items: [] });
    }

    // FEATURE: GET by name/version
    const featVer = url.match(/\/feature\/([^/]+)\/([^/]+)$/);
    if (featVer && method === 'GET') {
      const [, name, ver] = featVer;
      return json({ name, version: ver, dimensions: [] });
    }
    const featName = url.match(/\/feature\/([^/]+)$/);
    if (featName && method === 'GET') {
      const [, name] = featName;
      return json({ name, version: 'latest', dimensions: [] });
    }
    if (url.endsWith('/feature') && method === 'POST') {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return json({ ...body, version: body.version ?? 'v1' });
    }

    // TRANSFORMATION: GET/POST
    const trVer = url.match(/\/transformation\/([^/]+)\/([^/]+)$/);
    if (trVer && method === 'GET') {
      const [, name, ver] = trVer;
      return json({ name, version: ver, sol_src: 'return x;' });
    }
    const trName = url.match(/\/transformation\/([^/]+)$/);
    if (trName && method === 'GET') {
      const [, name] = trName;
      return json({ name, version: 'latest', sol_src: 'return x;' });
    }
    if (url.endsWith('/transformation') && method === 'POST') {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return json({ ...body, version: body.version ?? 'v1' });
    }

    // EXECUTE (with or without running_instances)
    const execWith = url.match(/\/execute\/([^/]+)\/(\d+)\/(\[\(.+\)\])$/);
    if (execWith && method === 'GET') {
      const [, feat, count, encoded] = execWith;
      return json([
        { feature_path: feat, count: Number(count), running: encoded, data: [1, 2, 3, 4] },
      ]);
    }
    const execNo = url.match(/\/execute\/([^/]+)\/(\d+)$/);
    if (execNo && method === 'GET') {
      const [, feat, count] = execNo;
      return json([{ feature_path: feat, count: Number(count), data: [9, 8, 7] }]);
    }

    // default 404 for unknown
    return new Response('Not Found', { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
