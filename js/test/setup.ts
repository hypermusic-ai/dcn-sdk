import { vi, beforeEach, afterEach } from 'vitest';

declare global {
  var __lastRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }>;
}

const ADDR = '0x1111111111111111111111111111111111111111';
const FORMAT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requestJson(init?: RequestInit) {
  return init?.body ? JSON.parse(init.body as string) : {};
}

beforeEach(() => {
  globalThis.__lastRequests = [];

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    globalThis.__lastRequests.push({ input, init });

    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;

    if (pathname.endsWith('/version') && method === 'GET') {
      return json({ version: '0.4.0', build_timestamp: '2026-04-30T00:00:00Z' });
    }

    const nonceMatch = pathname.match(/\/nonce\/([^/]+)$/);
    if (nonceMatch && method === 'GET') {
      return json({ nonce: 'abcd-efgh' });
    }

    if (pathname.endsWith('/auth') && method === 'POST') {
      const body = await requestJson(init);
      if (body.message === 'Login nonce: abcd-efgh') {
        return json({ access_token: 'access-123' });
      }
      return json({ error: 'unauthorized' }, 400);
    }

    if (pathname.endsWith('/accounts') && method === 'GET') {
      return json({
        limit: Number(parsedUrl.searchParams.get('limit')),
        total_accounts: 1,
        cursor: { has_more: false, next_after: null },
        accounts: [ADDR],
      });
    }

    const accountMatch = pathname.match(/\/account\/([^/]+)$/);
    if (accountMatch && method === 'GET') {
      return json({
        address: accountMatch[1],
        limit: Number(parsedUrl.searchParams.get('limit')),
        owned_connectors: ['pitch'],
        owned_transformations: ['identity'],
        owned_conditions: ['always'],
        cursor_connectors: { has_more: false, next_after: null },
        cursor_transformations: { has_more: false, next_after: null },
        cursor_conditions: { has_more: false, next_after: null },
      });
    }

    const connectorMatch = pathname.match(/\/connector\/([^/]+)$/);
    if (connectorMatch && method === 'HEAD') {
      return new Response(null, { status: connectorMatch[1] === 'missing' ? 404 : 200 });
    }
    if (connectorMatch && method === 'GET') {
      return json({
        name: connectorMatch[1],
        dimensions: [{ transformations: [{ name: 'identity', args: [] }] }],
        condition_name: '',
        condition_args: [],
        owner: ADDR,
        address: '0x0',
        format_hash: FORMAT,
      });
    }
    if (pathname.endsWith('/connector') && method === 'POST') {
      const body = await requestJson(init);
      return json({ name: body.name, owner: ADDR, address: '0x0', format_hash: FORMAT }, 201);
    }

    const transformationMatch = pathname.match(/\/transformation\/([^/]+)$/);
    if (transformationMatch && method === 'HEAD') {
      return new Response(null, { status: transformationMatch[1] === 'missing' ? 404 : 200 });
    }
    if (transformationMatch && method === 'GET') {
      return json({ name: transformationMatch[1], owner: ADDR, address: '0x0', sol_src: 'return x;' });
    }
    if (pathname.endsWith('/transformation') && method === 'POST') {
      const body = await requestJson(init);
      return json({ name: body.name, owner: ADDR, address: '0x0' }, 201);
    }

    const conditionMatch = pathname.match(/\/condition\/([^/]+)$/);
    if (conditionMatch && method === 'HEAD') {
      return new Response(null, { status: conditionMatch[1] === 'missing' ? 404 : 200 });
    }
    if (conditionMatch && method === 'GET') {
      return json({ name: conditionMatch[1], owner: ADDR, address: '0x0', sol_src: 'return true;' });
    }
    if (pathname.endsWith('/condition') && method === 'POST') {
      const body = await requestJson(init);
      return json({ name: body.name, owner: ADDR, address: '0x0' }, 201);
    }

    if (pathname.endsWith('/execute') && method === 'POST') {
      const body = await requestJson(init);
      return json([{ path: `/${body.connector_name}`, data: [1, 2, 3] }]);
    }

    if (pathname.endsWith('/formats') && method === 'GET') {
      return json({
        limit: Number(parsedUrl.searchParams.get('limit')),
        total_formats: 1,
        cursor: { has_more: false, next_after: null },
        formats: [FORMAT],
      });
    }

    const formatMatch = pathname.match(/\/format\/([^/]+)$/);
    if (formatMatch && method === 'GET') {
      return json({
        format_hash: formatMatch[1],
        limit: Number(parsedUrl.searchParams.get('limit')),
        total_connectors: 1,
        cursor: { has_more: false, next_after: null },
        scalars: ['scalar:0'],
        connectors: ['pitch'],
      });
    }

    if (pathname.endsWith('/feed') && method === 'GET') {
      return json({
        limit: Number(parsedUrl.searchParams.get('limit')),
        cursor: { has_more: false, next_before: null },
        items: [
          {
            feed_id: 'eth:1:connector_added:pitch',
            event_type: 'connector_added',
            status: 'finalized',
            visible: true,
            tx_hash: '0xabc',
            block_number: 1,
            tx_index: 0,
            log_index: 0,
            history_cursor: 'cursor',
            created_at_ms: 1,
            updated_at_ms: 1,
            projector_version: 1,
            payload: { type: 'connector', name: 'pitch', owner: ADDR },
          },
        ],
      });
    }

    if (pathname.endsWith('/feed/stream') && method === 'GET') {
      return new Response('event: stream_meta\ndata: {"has_more":false}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    return json({ error: 'not_found', path: pathname }, 404);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
