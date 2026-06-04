/**
 * Host-side world broker.
 *
 * The host (a world page or studio plugin surface) owns an authenticated
 * `DcnClient` and mounts worlds in sandboxed iframes. This broker listens for
 * brokered RPC requests from a world, enforces the world's manifest
 * permissions, forwards the call to the chain via `DcnClient`, and replies.
 * It can also push state (render data and/or cache seed) to the world.
 *
 * Usage (host side):
 *
 *   import { DcnClient } from 'dcn';
 *   import { createWorldHost } from 'dcn/worlds/host';
 *   const host = createWorldHost({
 *     client: new DcnClient({ accessToken }),
 *     worldId: descriptor.slug,
 *     permissions: descriptor.permissions,
 *     iframe: previewIframe,
 *   });
 *   host.pushState({ payload: { label: 'Hello' }, seed: { connectors } });
 */
import { DcnApiError } from '../client';
import type { DcnClient } from '../client';
// Re-exported so a single-entry bundle of this module gives hosts both the
// broker and the chain client they pass to it (used by the served host build).
export { DcnClient } from '../client';
import {
    WORLD_CHANNEL_TOKEN_PARAM,
    WORLD_MESSAGE_TYPES,
    WORLD_PROTOCOL_VERSION,
    WORLD_RPC_PERMISSION,
    type WorldManifest,
    type WorldErrorMessage,
    type WorldPermission,
    type WorldReadyMessage,
    type WorldRenderedMessage,
    type WorldRpcError,
    type WorldRpcMethod,
    type WorldRpcRequestMessage,
    type WorldRpcResponseMessage,
    type WorldStateMessage,
    type WorldStateSeed,
} from './protocol';
import type { ConnectorInfoResponse } from '../generated/models/ConnectorInfoResponse';

export interface WorldHostOptions {
    /** Authenticated chain client used to service brokered calls. */
    client: DcnClient;
    /**
     * World identity. When provided, only messages tagged with this id are
     * accepted. When omitted, the broker adopts the id from the world's first
     * `ready` message, so hosts that mount a generic world don't need to know
     * its internal id up front.
     */
    worldId?: string;
    /** Permissions granted to this world (from its validated manifest). */
    permissions: WorldPermission[];
    /** Optional numeric limits from the validated world manifest. */
    valueLimits?: WorldManifest['valueLimits'];
    /** The mounted world iframe. Used as the default target for pushes and source checks. */
    iframe?: Pick<HTMLIFrameElement, 'contentWindow' | 'src'>;
    /** Explicit target window (alternative to `iframe`). */
    targetWindow?: Window | null;
    /** Window to listen on for world messages. Defaults to the global `window`. */
    listenWindow?: Window;
    /** `postMessage` targetOrigin for pushes/responses. Defaults to `'*'`. */
    targetOrigin?: string;
    /** When set, inbound messages from other origins are ignored. */
    expectedOrigin?: string;
    /** Per-mount capability token. Defaults to a generated cryptographic token. */
    channelToken?: string;
    /** Receives broker warnings that should not be exposed to untrusted worlds. Defaults to `console.warn`. */
    logger?: Pick<Console, 'warn'>;
    onReady?: (message: WorldReadyMessage) => void;
    onError?: (message: WorldErrorMessage) => void;
    onRendered?: (message: WorldRenderedMessage) => void;
}

export interface WorldHost {
    readonly worldId: string;
    /** Per-mount token that the world must echo in every protocol message. */
    readonly channelToken: string;
    /** Append the channel token to a world entry URL before assigning iframe.src. */
    worldUrl(url: string): string;
    /** Push render state and/or cache seed to the world. */
    pushState(state: { payload?: unknown; seed?: WorldStateSeed; requestId?: string }): void;
    /** Convenience: seed only connector definitions into the world cache. */
    pushConnectors(connectors: Record<string, ConnectorInfoResponse>): void;
    /** Detach the message listener. */
    dispose(): void;
}

const MAX_WORLD_PARTICLES_COUNT = 65536n;
const MAX_DYNAMIC_RI_ENTRIES = 100;
const MAX_UINT32 = 0xffffffff;

function toRpcError(error: unknown, logger: Pick<Console, 'warn'>): WorldRpcError {
    if (error instanceof WorldBadRequestError) {
        return {
            code: 'bad_request',
            message: error.message,
        };
    }
    if (error instanceof DcnApiError) {
        return {
            code: 'host_error',
            message: `Chain request failed with status ${String(error.status)}`,
            status: error.status,
        };
    }
    logger.warn('DCN world host RPC failed unexpectedly', error);
    return {
        code: 'host_error',
        message: 'Unexpected host error',
    };
}

class WorldBadRequestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorldBadRequestError';
    }
}

/** Copy only the defined keys from `source` into a fresh object. */
function pick<T extends Record<string, unknown>>(source: Record<string, unknown>, keys: (keyof T)[]): T {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
        const value = source[key as string];
        if (value !== undefined) out[key as string] = value;
    }
    return out as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new WorldBadRequestError(`RPC parameter '${key}' must be a non-empty string`);
    }
    return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
    const value = params[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new WorldBadRequestError(`RPC parameter '${key}' must be a string`);
    return value;
}

function optionalLimit(params: Record<string, unknown>): number | undefined {
    const value = params.limit;
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100) {
        throw new WorldBadRequestError("RPC parameter 'limit' must be an integer between 1 and 100");
    }
    return value;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
    const value = params[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw new WorldBadRequestError(`RPC parameter '${key}' must be a boolean`);
    return value;
}

function decimalStringToBigInt(value: string, key: string): bigint {
    if (!/^(0|[1-9]\d*)$/.test(value)) {
        throw new WorldBadRequestError(`RPC parameter '${key}' must be a canonical non-negative integer`);
    }
    return BigInt(value);
}

function assertParticlesWithinLimits(count: bigint, limits: WorldManifest['valueLimits'] | undefined): void {
    const particlesCount = limits?.particlesCount;
    if (particlesCount === undefined) return;
    const countNumber = Number(count);
    if (countNumber < particlesCount.min || countNumber > particlesCount.max) {
        throw new WorldBadRequestError(
            `RPC parameter 'particlesCount' must be between ${String(particlesCount.min)} and ${String(particlesCount.max)}`
        );
    }
}

function requiredParticlesCount(
    params: Record<string, unknown>,
    limits: WorldManifest['valueLimits'] | undefined
): number | string {
    const value = params.particlesCount;
    const count =
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
            ? BigInt(value)
            : typeof value === 'string'
              ? decimalStringToBigInt(value, 'particlesCount')
              : undefined;
    if (count === undefined || count > MAX_WORLD_PARTICLES_COUNT) {
        throw new WorldBadRequestError("RPC parameter 'particlesCount' must be an integer between 0 and 65536");
    }
    assertParticlesWithinLimits(count, limits);
    const validNumber =
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        BigInt(value) <= MAX_WORLD_PARTICLES_COUNT;
    if (validNumber) return value;
    return value as string;
}

function optionalRunningInstances(params: Record<string, unknown>): Record<string, unknown> | undefined {
    const value = params.dynamicRi;
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new WorldBadRequestError("RPC parameter 'dynamicRi' must be an object");
    const entries = Object.entries(value);
    if (entries.length > MAX_DYNAMIC_RI_ENTRIES) throw new WorldBadRequestError("RPC parameter 'dynamicRi' is too large");
    for (const [key, item] of entries) {
        if (decimalStringToBigInt(key, 'dynamicRi key') > BigInt(MAX_UINT32)) {
            throw new WorldBadRequestError("RPC parameter 'dynamicRi' keys must be uint32 indexes");
        }
        if (!isRecord(item)) throw new WorldBadRequestError("RPC parameter 'dynamicRi' values must be objects");
        for (const field of ['start_point', 'transformation_shift'] as const) {
            const coord = item[field];
            if (typeof coord !== 'number' || !Number.isSafeInteger(coord) || coord < 0 || coord > 0xffffffff) {
                throw new WorldBadRequestError(`RPC parameter 'dynamicRi.${key}.${field}' must be a uint32`);
            }
        }
    }
    return value;
}

function validateRpcParams(
    method: WorldRpcMethod,
    value: unknown,
    limits: WorldManifest['valueLimits'] | undefined
): Record<string, unknown> {
    if (!isRecord(value)) throw new WorldBadRequestError('RPC params must be an object');
    switch (method) {
        case 'connectorGet':
        case 'connectorExists':
        case 'transformationGet':
        case 'conditionGet':
            return { name: requiredString(value, 'name') };
        case 'formatInfo': {
            const formatLimit = optionalLimit(value);
            const after = optionalString(value, 'after');
            return {
                hash: requiredString(value, 'hash'),
                ...(formatLimit !== undefined ? { limit: formatLimit } : {}),
                ...(after !== undefined ? { after } : {}),
            };
        }
        case 'listFormats': {
            const listLimit = optionalLimit(value);
            const listAfter = optionalString(value, 'after');
            return {
                ...(listLimit !== undefined ? { limit: listLimit } : {}),
                ...(listAfter !== undefined ? { after: listAfter } : {}),
            };
        }
        case 'feed': {
            const feedLimit = optionalLimit(value);
            const before = optionalString(value, 'before');
            const type = optionalString(value, 'type');
            const includeUnfinalized = optionalBoolean(value, 'includeUnfinalized');
            return {
                ...(feedLimit !== undefined ? { limit: feedLimit } : {}),
                ...(before !== undefined ? { before } : {}),
                ...(type !== undefined ? { type } : {}),
                ...(includeUnfinalized !== undefined ? { includeUnfinalized } : {}),
            };
        }
        case 'execute': {
            const dynamicRi = optionalRunningInstances(value);
            return {
                connectorName: requiredString(value, 'connectorName'),
                particlesCount: requiredParticlesCount(value, limits),
                ...(dynamicRi !== undefined ? { dynamicRi } : {}),
            };
        }
        default:
            throw new WorldBadRequestError(`Unknown world RPC method: ${String(method)}`);
    }
}

async function dispatch(
    client: DcnClient,
    method: WorldRpcMethod,
    params: Record<string, unknown>
): Promise<unknown> {
    switch (method) {
        case 'connectorGet':
            return client.connectorGet(params.name as string);
        case 'connectorExists':
            return client.connectorExists(params.name as string);
        case 'transformationGet':
            return client.transformationGet(params.name as string);
        case 'conditionGet':
            return client.conditionGet(params.name as string);
        case 'formatInfo':
            return client.formatInfo(params.hash as string, pick(params, ['limit', 'after']));
        case 'listFormats':
            return client.listFormats(pick(params, ['limit', 'after']));
        case 'feed':
            return client.feed(pick(params, ['limit', 'before', 'type', 'includeUnfinalized']));
        case 'execute':
            return client.execute(
                params.connectorName as string,
                params.particlesCount as number | string,
                params.dynamicRi as never
            );
        default:
            throw new Error(`Unknown world RPC method: ${String(method)}`);
    }
}

/** Create a host broker for a single mounted world. */
export function createWorldHost(options: WorldHostOptions): WorldHost {
    const { client } = options;
    const listenWindow = options.listenWindow ?? (globalThis as unknown as Window);
    const configuredTargetOrigin = options.targetOrigin;
    let targetOrigin = configuredTargetOrigin ?? inferTargetOrigin(options, listenWindow);
    const channelToken = options.channelToken ?? generateChannelToken();
    const logger = options.logger ?? console;
    if (!channelToken) throw new Error('createWorldHost requires a non-empty channelToken');
    const permissions = new Set<WorldPermission>(options.permissions);
    // Bound id; either configured up front or adopted from the first `ready`.
    let boundWorldId = options.worldId;
    let readySeen = false;
    let disposed = false;

    function defaultTarget(): Window | null {
        return options.iframe?.contentWindow ?? options.targetWindow ?? null;
    }

    function expectedSource(): Window | null | undefined {
        if (options.iframe !== undefined) return options.iframe.contentWindow ?? null;
        if (options.targetWindow !== undefined) return options.targetWindow;
        return undefined;
    }

    function postTo(target: Window | null, message: unknown): void {
        target?.postMessage(message, targetOrigin);
    }

    async function handleRpcRequest(
        request: WorldRpcRequestMessage,
        source: Window | null
    ): Promise<void> {
        const target = source ?? defaultTarget();
        const base = {
            type: WORLD_MESSAGE_TYPES.rpcResponse,
            worldId: request.worldId,
            channelToken,
            requestId: request.requestId,
        } as const;

        if (!readySeen) {
            const response: WorldRpcResponseMessage = {
                ...base,
                ok: false,
                error: {
                    code: 'bad_request',
                    message: `World '${request.worldId}' sent RPC before the ready handshake`,
                },
            };
            postTo(target, response);
            return;
        }

        // request.method arrives from an untrusted world, so treat the lookup as
        // possibly-missing even though the type narrows it to a known method.
        const permissionTable = WORLD_RPC_PERMISSION as Record<string, WorldPermission | undefined>;
        const required = permissionTable[request.method];
        if (required === undefined) {
            const response: WorldRpcResponseMessage = {
                ...base,
                ok: false,
                error: { code: 'unknown_method', message: `Unknown method '${request.method}'` },
            };
            postTo(target, response);
            return;
        }
        if (!permissions.has(required)) {
            const response: WorldRpcResponseMessage = {
                ...base,
                ok: false,
                error: {
                    code: 'permission_denied',
                    message: `World '${request.worldId}' lacks permission '${required}' for '${request.method}'`,
                },
            };
            postTo(target, response);
            return;
        }

        try {
            const result = await dispatch(
                client,
                request.method,
                validateRpcParams(request.method, request.params, options.valueLimits)
            );
            const response: WorldRpcResponseMessage = { ...base, ok: true, result: result as never };
            postTo(target, response);
        } catch (error) {
            const response: WorldRpcResponseMessage = { ...base, ok: false, error: toRpcError(error, logger) };
            postTo(target, response);
        }
    }

    function onMessage(event: MessageEvent): void {
        if (options.expectedOrigin !== undefined && event.origin !== options.expectedOrigin) return;
        const configuredSource = expectedSource();
        if (configuredSource !== undefined && event.source !== configuredSource) return;
        const data = event.data as { type?: unknown; worldId?: unknown; channelToken?: unknown } | null;
        if (!data || typeof data.type !== 'string') return;
        if (data.channelToken !== channelToken) return;
        const incomingWorldId = typeof data.worldId === 'string' ? data.worldId : undefined;
        if (boundWorldId !== undefined && incomingWorldId !== boundWorldId) return;
        // Sandboxed frames without allow-same-origin report `event.origin` as
        // "null". A specific postMessage targetOrigin cannot match that opaque
        // origin, so after source+token validation we must reply with "*".
        if (configuredTargetOrigin === undefined && event.origin === 'null' && targetOrigin !== '*') {
            logger.warn('DCN world host detected a null-origin sandbox; using wildcard postMessage targetOrigin');
            targetOrigin = '*';
        }
        const source = (event.source as Window | null) ?? null;
        switch (data.type) {
            case WORLD_MESSAGE_TYPES.rpcRequest:
                if (incomingWorldId === undefined) return;
                void handleRpcRequest(data as WorldRpcRequestMessage, source);
                break;
            case WORLD_MESSAGE_TYPES.ready:
                if (incomingWorldId === undefined) return;
                if ((data as Partial<WorldReadyMessage>).protocolVersion !== WORLD_PROTOCOL_VERSION) return;
                // Adopt the world's id on first contact when not configured.
                boundWorldId ??= incomingWorldId;
                readySeen = true;
                options.onReady?.(data as WorldReadyMessage);
                break;
            case WORLD_MESSAGE_TYPES.error:
                if (!readySeen || incomingWorldId === undefined) return;
                options.onError?.(data as WorldErrorMessage);
                break;
            case WORLD_MESSAGE_TYPES.rendered:
                if (!readySeen || incomingWorldId === undefined) return;
                options.onRendered?.(data as WorldRenderedMessage);
                break;
            default:
                break;
        }
    }

    listenWindow.addEventListener('message', onMessage as EventListener);

    return {
        get worldId() {
            return boundWorldId ?? '';
        },
        channelToken,
        worldUrl(url: string) {
            return addChannelToken(url, channelToken, listenWindow);
        },
        pushState(state: { payload?: unknown; seed?: WorldStateSeed; requestId?: string }) {
            // Without a bound id the world can't match the message; wait for ready.
            if (boundWorldId === undefined) return;
            const message: WorldStateMessage = {
                type: WORLD_MESSAGE_TYPES.state,
                worldId: boundWorldId,
                channelToken,
                ...(state.requestId !== undefined ? { requestId: state.requestId } : {}),
                ...(state.payload !== undefined ? { payload: state.payload } : {}),
                ...(state.seed !== undefined ? { seed: state.seed } : {}),
            };
            postTo(defaultTarget(), message);
        },
        pushConnectors(connectors: Record<string, ConnectorInfoResponse>) {
            this.pushState({ seed: { connectors } });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            listenWindow.removeEventListener('message', onMessage as EventListener);
        },
    };
}

function inferTargetOrigin(options: WorldHostOptions, listenWindow: Window): string {
    if (options.expectedOrigin === 'null') return '*';
    const expected = exactOrigin(options.expectedOrigin, listenWindow);
    if (expected) return expected;
    const iframeOrigin = exactOrigin(options.iframe?.src, listenWindow);
    if (iframeOrigin) return iframeOrigin;
    const current = exactOrigin(locationOrigin(listenWindow), listenWindow);
    return current ?? '*';
}

function exactOrigin(value: string | undefined, listenWindow: Window): string | undefined {
    if (value === undefined || value === '*' || value === '/' || value === 'null') return undefined;
    try {
        return new URL(value, locationHref(listenWindow)).origin;
    } catch {
        return undefined;
    }
}

function generateChannelToken(): string {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function addChannelToken(url: string, channelToken: string, listenWindow: Window): string {
    const base = locationHref(listenWindow);
    const parsed = new URL(url, base);
    parsed.searchParams.set(WORLD_CHANNEL_TOKEN_PARAM, channelToken);
    return parsed.toString();
}

function locationHref(listenWindow: Window): string {
    const location = (listenWindow as unknown as { location?: Location }).location;
    return location !== undefined ? location.href : 'http://localhost/';
}

function locationOrigin(listenWindow: Window): string | undefined {
    return (listenWindow as unknown as { location?: Location }).location?.origin;
}
