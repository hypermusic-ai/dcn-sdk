import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DcnApiError } from '../src/client';
import type { DcnClient } from '../src/client';
import { createWorldSdk, WorldRpcCallError } from '../src/worlds/runtime';
import { createWorldHost } from '../src/worlds/host';
import type { WorldPermission } from '../src/worlds/protocol';
import { ADDR, FORMAT } from './fixtures';

const WORLD_ID = 'world.test';

/**
 * Minimal in-process stand-in for a browser Window: postMessage synchronously
 * dispatches a `message` event on itself with `source` set to its peer (the
 * sender). One peer pair models the world iframe <-> host relationship.
 */
class FakeWindow extends EventTarget {
    peer!: FakeWindow;
    origin = 'http://localhost';
    location = new URL('http://localhost/') as unknown as Location;
    lastTargetOrigin: string | undefined;
    blockedMessages: unknown[] = [];
    postedMessages: unknown[] = [];
    postMessage(data: unknown, targetOrigin?: string): void {
        this.lastTargetOrigin = targetOrigin;
        this.postedMessages.push(data);
        if (targetOrigin !== undefined && targetOrigin !== '*' && targetOrigin !== this.origin) {
            this.blockedMessages.push(data);
            return;
        }
        const event = new Event('message') as Event & {
            data: unknown;
            source: unknown;
            origin: string;
        };
        event.data = data;
        event.source = this.peer;
        event.origin = this.peer.origin;
        this.dispatchEvent(event);
    }
    get parent(): FakeWindow {
        return this.peer;
    }
}

function makePair(): { worldWin: FakeWindow; hostWin: FakeWindow } {
    const worldWin = new FakeWindow();
    const hostWin = new FakeWindow();
    worldWin.peer = hostWin;
    hostWin.peer = worldWin;
    return { worldWin, hostWin };
}

function fakeClient(overrides: Partial<Record<keyof DcnClient, unknown>> = {}): {
    client: DcnClient;
    spies: Record<string, ReturnType<typeof vi.fn>>;
} {
    const spies = {
        connectorGet: vi.fn(async (name: string) => ({
            name,
            dimensions: [],
            condition_name: '',
            condition_args: [],
            owner: ADDR,
            address: '0x0',
            format_hash: FORMAT,
        })),
        connectorExists: vi.fn(async () => true),
        transformationExists: vi.fn(async () => true),
        transformationGet: vi.fn(async (name: string) => ({ name, sol_src: 'return x;', owner: ADDR, address: '0x0' })),
        conditionExists: vi.fn(async () => true),
        conditionGet: vi.fn(async (name: string) => ({ name, sol_src: 'return true;', owner: ADDR, address: '0x0' })),
        formatInfo: vi.fn(async () => ({ connectors: ['pitch'] })),
        listFormats: vi.fn(async () => ({ formats: [FORMAT] })),
        feed: vi.fn(async () => ({ items: [] })),
        execute: vi.fn(async () => [{ path: '/pitch', data: [1, 2, 3] }]),
    };
    const client = { ...spies, ...overrides } as unknown as DcnClient;
    return { client, spies };
}

function connect(permissions: WorldPermission[], clientFactory = fakeClient()) {
    const { worldWin, hostWin } = makePair();
    const host = createWorldHost({
        client: clientFactory.client,
        worldId: WORLD_ID,
        permissions,
        iframe: { contentWindow: worldWin as unknown as Window },
        listenWindow: hostWin as unknown as Window,
    });
    const sdk = createWorldSdk({
        worldId: WORLD_ID,
        channelToken: host.channelToken,
        listenWindow: worldWin as unknown as Window,
        requestTimeoutMs: 200,
    });
    sdk.ready();
    return { sdk, host, spies: clientFactory.spies };
}

describe('world runtime <-> host broker', () => {
    let connected: ReturnType<typeof connect> | undefined;

    beforeEach(() => {
        connected?.host.dispose();
        connected?.sdk.dispose();
        connected = undefined;
    });

    it('round-trips brokered read and execute calls through the host', async () => {
        connected = connect(['dcn.connectors.read', 'dcn.execute']);
        const { sdk, spies } = connected;

        const connector = await sdk.connectorGet('pitch');
        expect(connector.format_hash).toBe(FORMAT);
        expect(spies.connectorGet).toHaveBeenCalledWith('pitch');

        const out = await sdk.execute('pitch', 8, { '0': { start_point: 1, transformation_shift: 0 } });
        expect(out[0].data).toEqual([1, 2, 3]);
        expect(spies.execute).toHaveBeenCalledWith('pitch', 8, {
            '0': { start_point: 1, transformation_shift: 0 },
        });
    });

    it('round-trips transformation and condition existence checks through the host', async () => {
        connected = connect(['dcn.transformations.read', 'dcn.conditions.read']);
        const { sdk, spies } = connected;

        await expect(sdk.transformationExists('transpose')).resolves.toBe(true);
        await expect(sdk.transformationGet('transpose')).resolves.toMatchObject({ name: 'transpose' });
        await expect(sdk.conditionExists('always')).resolves.toBe(true);
        await expect(sdk.conditionGet('always')).resolves.toMatchObject({ name: 'always' });

        expect(spies.transformationExists).toHaveBeenCalledWith('transpose');
        expect(spies.transformationGet).toHaveBeenCalledWith('transpose');
        expect(spies.conditionExists).toHaveBeenCalledWith('always');
        expect(spies.conditionGet).toHaveBeenCalledWith('always');
    });

    it('serves connectorGet from the seeded cache without an RPC round-trip', async () => {
        connected = connect(['dcn.connectors.read']);
        const { sdk, host, spies } = connected;

        host.pushConnectors({
            pitch: {
                name: 'pitch',
                dimensions: [],
                condition_name: '',
                condition_args: [],
                owner: ADDR,
                address: '0x0',
                format_hash: FORMAT,
            },
        });

        const connector = await sdk.connectorGet('pitch');
        expect(connector.name).toBe('pitch');
        expect(spies.connectorGet).not.toHaveBeenCalled();
        await expect(sdk.connectorExists('pitch')).resolves.toBe(true);
        expect(spies.connectorExists).not.toHaveBeenCalled();
    });

    it('delivers host state pushes to onState subscribers', async () => {
        connected = connect(['dcn.connectors.read']);
        const { sdk, host } = connected;
        const seen: unknown[] = [];
        sdk.onState<{ label: string }>((state) => seen.push(state.payload));

        host.pushState({ payload: { label: 'hello world' } });
        expect(seen).toEqual([{ label: 'hello world' }]);
    });

    it('rejects calls the world lacks permission for', async () => {
        connected = connect([]); // no permissions granted
        const { sdk, spies } = connected;

        await expect(sdk.connectorGet('pitch')).rejects.toMatchObject({
            name: 'WorldRpcCallError',
            code: 'permission_denied',
        });
        expect(spies.connectorGet).not.toHaveBeenCalled();
    });

    it('gates execute behind dcn.execute', async () => {
        connected = connect(['dcn.connectors.read']); // read but not execute
        const { sdk, spies } = connected;

        await expect(sdk.execute('pitch', 4)).rejects.toMatchObject({ code: 'permission_denied' });
        expect(spies.execute).not.toHaveBeenCalled();
    });

    it('gates transformation and condition reads independently', async () => {
        connected = connect(['dcn.transformations.read']);
        const { sdk, spies } = connected;

        await expect(sdk.transformationGet('transpose')).resolves.toMatchObject({ name: 'transpose' });
        await expect(sdk.conditionExists('always')).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(sdk.conditionGet('always')).rejects.toMatchObject({ code: 'permission_denied' });
        expect(spies.transformationGet).toHaveBeenCalledWith('transpose');
        expect(spies.conditionExists).not.toHaveBeenCalled();
        expect(spies.conditionGet).not.toHaveBeenCalled();
    });

    it('gates feed behind social read permission', async () => {
        connected = connect(['dcn.connectors.read']);
        const { sdk, spies } = connected;

        await expect(sdk.listFormats()).resolves.toMatchObject({ formats: [FORMAT] });
        await expect(sdk.feed()).rejects.toMatchObject({ code: 'permission_denied' });
        expect(spies.listFormats).toHaveBeenCalled();
        expect(spies.feed).not.toHaveBeenCalled();

        connected.host.dispose();
        connected.sdk.dispose();
        connected = connect(['dcn.social.read']);
        await expect(connected.sdk.feed()).resolves.toMatchObject({ items: [] });
        expect(connected.spies.feed).toHaveBeenCalled();
    });

    it('propagates chain API errors as host_error with the status', async () => {
        const factory = fakeClient({
            connectorGet: vi.fn(async () => {
                throw new DcnApiError(404, { error: 'not_found' });
            }),
        });
        connected = connect(['dcn.connectors.read'], factory);
        const { sdk } = connected;

        const error = await sdk.connectorGet('missing').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WorldRpcCallError);
        expect((error as WorldRpcCallError).code).toBe('host_error');
        expect((error as WorldRpcCallError).status).toBe(404);
    });

    it('times out when no host responds', async () => {
        const { worldWin } = makePair();
        const sdk = createWorldSdk({
            worldId: WORLD_ID,
            channelToken: 'test-channel',
            listenWindow: worldWin as unknown as Window,
            requestTimeoutMs: 30,
        });
        await expect(sdk.connectorGet('pitch')).rejects.toMatchObject({ code: 'timeout' });
        sdk.dispose();
    });

    it('adopts the world id from the first ready when not configured up front', async () => {
        const { worldWin, hostWin } = makePair();
        const { client, spies } = fakeClient();
        const host = createWorldHost({
            client,
            // no worldId configured
            permissions: ['dcn.connectors.read'],
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
        });
        const sdk = createWorldSdk({
            worldId: 'world.dynamic',
            channelToken: host.channelToken,
            listenWindow: worldWin as unknown as Window,
            requestTimeoutMs: 200,
        });

        sdk.ready();
        expect(host.worldId).toBe('world.dynamic');

        const connector = await sdk.connectorGet('pitch');
        expect(connector.name).toBe('pitch');
        expect(spies.connectorGet).toHaveBeenCalledWith('pitch');

        host.dispose();
        sdk.dispose();
    });

    it('forwards lifecycle ready/error/rendered to host callbacks', () => {
        const onReady = vi.fn();
        const onError = vi.fn();
        const onRendered = vi.fn();
        const { worldWin, hostWin } = makePair();
        const { client } = fakeClient();
        const host = createWorldHost({
            client,
            worldId: WORLD_ID,
            permissions: [],
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
            onReady,
            onError,
            onRendered,
        });
        const sdk = createWorldSdk({
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            listenWindow: worldWin as unknown as Window,
        });

        sdk.ready();
        sdk.reportRendered('req-1');
        sdk.reportError('boom');

        expect(onReady).toHaveBeenCalledTimes(1);
        expect(onRendered).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));

        host.dispose();
        sdk.dispose();
    });

    it('uses wildcard targetOrigin when pushing into a null-origin sandbox', () => {
        const { worldWin, hostWin } = makePair();
        const { client } = fakeClient();
        const host = createWorldHost({
            client,
            worldId: WORLD_ID,
            permissions: [],
            iframe: {
                contentWindow: worldWin as unknown as Window,
                src: 'http://localhost/world-assets/test/index.html',
            },
            listenWindow: hostWin as unknown as Window,
            expectedOrigin: 'null',
        });

        host.pushState({ payload: { label: 'sandbox' } });

        expect(worldWin.lastTargetOrigin).toBe('*');
        host.dispose();
    });

    it('adapts replies and pushes after a null-origin sandbox handshake', () => {
        const { worldWin, hostWin } = makePair();
        worldWin.origin = 'null';
        const { client } = fakeClient();
        const host = createWorldHost({
            client,
            worldId: WORLD_ID,
            permissions: [],
            iframe: {
                contentWindow: worldWin as unknown as Window,
                src: 'http://localhost/world-assets/test/index.html',
            },
            listenWindow: hostWin as unknown as Window,
            logger: { warn: vi.fn() },
        });
        const sdk = createWorldSdk({
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            listenWindow: worldWin as unknown as Window,
            targetOrigin: 'http://localhost',
        });
        const seen: unknown[] = [];
        sdk.onState((state) => seen.push(state.payload));

        sdk.ready();
        host.pushState({ payload: { label: 'sandbox' } });

        expect(worldWin.lastTargetOrigin).toBe('*');
        expect(seen).toEqual([{ label: 'sandbox' }]);
        host.dispose();
        sdk.dispose();
    });

    it('passes the channel token through the world preview URL', () => {
        const { worldWin, hostWin } = makePair();
        const { client } = fakeClient();
        const host = createWorldHost({
            client,
            permissions: [],
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
            expectedOrigin: 'null',
        });
        const tokenizedUrl = host.worldUrl('http://localhost/world-assets/test/index.html');
        worldWin.location = new URL(tokenizedUrl) as unknown as Location;
        worldWin.origin = 'null';
        const sdk = createWorldSdk({
            worldId: 'simple-counter',
            listenWindow: worldWin as unknown as Window,
        });

        sdk.ready();

        expect(host.worldId).toBe('simple-counter');
        expect(new URL(tokenizedUrl).searchParams.get('dcnWorldChannel')).toBe(host.channelToken);
        host.dispose();
        sdk.dispose();
    });

    it('ignores host messages from the wrong source window', () => {
        const { worldWin, hostWin } = makePair();
        const attackerWin = new FakeWindow();
        attackerWin.peer = worldWin;
        const sdk = createWorldSdk({
            worldId: WORLD_ID,
            channelToken: 'source-token',
            targetWindow: hostWin as unknown as Window,
            listenWindow: worldWin as unknown as Window,
        });
        const seen: unknown[] = [];
        sdk.onState((state) => seen.push(state.payload));

        worldWin.peer = attackerWin;
        worldWin.postMessage({
            type: 'dcn:world-state',
            worldId: WORLD_ID,
            channelToken: 'source-token',
            payload: { label: 'spoofed' },
        });
        worldWin.peer = hostWin;

        expect(seen).toEqual([]);
        sdk.dispose();
    });

    it('ignores host RPC messages with the wrong channel token', async () => {
        const { worldWin, hostWin } = makePair();
        const { client, spies } = fakeClient();
        const host = createWorldHost({
            client,
            worldId: WORLD_ID,
            permissions: ['dcn.connectors.read'],
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
        });

        hostWin.postMessage({
            type: 'dcn:world-ready',
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            protocolVersion: 1,
        });
        hostWin.postMessage({
            type: 'dcn:world-rpc-request',
            worldId: WORLD_ID,
            channelToken: 'wrong-token',
            requestId: 'wrong-token-1',
            method: 'connectorGet',
            params: { name: 'pitch' },
        });
        await Promise.resolve();

        expect(spies.connectorGet).not.toHaveBeenCalled();
        expect(worldWin.postedMessages).not.toContainEqual(
            expect.objectContaining({ requestId: 'wrong-token-1' })
        );
        host.dispose();
    });

    it('does not expose host client secrets in world URLs or broker messages', async () => {
        const { worldWin, hostWin } = makePair();
        const secret = 'secret-access-token-123';
        const privateKey = '0xprivate-key-123';
        const factory = fakeClient({
            accessToken: secret,
            password: 'host-password-123',
            privateKey,
        } as Partial<Record<keyof DcnClient, unknown>>);
        const host = createWorldHost({
            client: factory.client,
            worldId: WORLD_ID,
            permissions: ['dcn.connectors.read'],
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
        });
        const sdk = createWorldSdk({
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            listenWindow: worldWin as unknown as Window,
            requestTimeoutMs: 200,
        });

        const worldUrl = host.worldUrl('http://localhost/world-assets/test/index.html');
        sdk.ready();
        await sdk.connectorGet('pitch');
        host.pushState({ payload: { label: 'public render state' } });

        const exposed = JSON.stringify({ worldUrl, messages: worldWin.postedMessages });
        expect(exposed).not.toContain(secret);
        expect(exposed).not.toContain(privateKey);
        expect(exposed).not.toContain('host-password-123');
        expect(exposed).not.toContain('Authorization');
        expect(exposed).not.toContain('Bearer');
        host.dispose();
        sdk.dispose();
    });

    it('rejects malformed RPC params before calling the chain client', async () => {
        const { worldWin, hostWin } = makePair();
        const { client, spies } = fakeClient();
        const host = createWorldHost({
            client,
            worldId: WORLD_ID,
            permissions: ['dcn.execute'],
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
        });
        hostWin.postMessage({
            type: 'dcn:world-ready',
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            protocolVersion: 1,
        });

        hostWin.postMessage({
            type: 'dcn:world-rpc-request',
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            requestId: 'bad-1',
            method: 'execute',
            params: { connectorName: 'pitch', particlesCount: -1 },
        });

        expect(spies.execute).not.toHaveBeenCalled();
        host.dispose();
    });

    it('redacts unexpected host errors and logs them host-side', async () => {
        const logger = { warn: vi.fn() };
        const factory = fakeClient({
            connectorGet: vi.fn(async () => {
                throw new Error('database secret');
            }),
        });
        const { worldWin, hostWin } = makePair();
        const host = createWorldHost({
            client: factory.client,
            worldId: WORLD_ID,
            permissions: ['dcn.connectors.read'],
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
            logger,
        });
        const sdk = createWorldSdk({
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            listenWindow: worldWin as unknown as Window,
            requestTimeoutMs: 200,
        });

        sdk.ready();
        await expect(sdk.connectorGet('pitch')).rejects.toMatchObject({
            code: 'host_error',
            message: 'Unexpected host error',
        });
        expect(logger.warn).toHaveBeenCalledWith(
            'DCN world host RPC failed unexpectedly',
            expect.any(Error)
        );
        host.dispose();
        sdk.dispose();
    });

    it('rejects execute counts above the broker limit before calling the chain client', async () => {
        connected = connect(['dcn.execute']);
        const { sdk, spies } = connected;

        await expect(sdk.execute('pitch', 65537)).rejects.toMatchObject({
            code: 'bad_request',
        });
        await expect(sdk.execute('pitch', '0001')).rejects.toMatchObject({
            code: 'bad_request',
        });
        expect(spies.execute).not.toHaveBeenCalled();
    });

    it('enforces manifest particlesCount limits at the host boundary', async () => {
        const { worldWin, hostWin } = makePair();
        const { client, spies } = fakeClient();
        const host = createWorldHost({
            client,
            worldId: WORLD_ID,
            permissions: ['dcn.execute'],
            valueLimits: { particlesCount: { min: 4, max: 8 } },
            iframe: { contentWindow: worldWin as unknown as Window },
            listenWindow: hostWin as unknown as Window,
        });
        const sdk = createWorldSdk({
            worldId: WORLD_ID,
            channelToken: host.channelToken,
            listenWindow: worldWin as unknown as Window,
            requestTimeoutMs: 200,
        });

        sdk.ready();
        await expect(sdk.execute('pitch', 3)).rejects.toMatchObject({ code: 'bad_request' });
        await expect(sdk.execute('pitch', 9)).rejects.toMatchObject({ code: 'bad_request' });
        await expect(sdk.execute('pitch', 6)).resolves.toEqual([{ path: '/pitch', data: [1, 2, 3] }]);
        expect(spies.execute).toHaveBeenCalledTimes(1);
        host.dispose();
        sdk.dispose();
    });

    it('rejects non-canonical or oversized dynamicRi indexes before execution', async () => {
        connected = connect(['dcn.execute']);
        const { sdk, spies } = connected;

        await expect(
            sdk.execute('pitch', 4, { '01': { start_point: 1, transformation_shift: 0 } })
        ).rejects.toMatchObject({ code: 'bad_request' });
        await expect(
            sdk.execute('pitch', 4, { '4294967296': { start_point: 1, transformation_shift: 0 } })
        ).rejects.toMatchObject({ code: 'bad_request' });
        expect(spies.execute).not.toHaveBeenCalled();
    });
});
