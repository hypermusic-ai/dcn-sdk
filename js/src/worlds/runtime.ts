/**
 * World-side runtime SDK.
 *
 * This is the interface every world must use to talk to the host. It runs
 * inside the sandboxed iframe and deliberately has no `DcnClient` dependency:
 * the world never holds a token and never reaches the chain directly. Every
 * data/execute call is brokered to the host over postMessage, and the host
 * enforces the world's manifest permissions.
 *
 * Usage (inside a world's entry script):
 *
 *   import { createWorldSdk } from 'dcn/worlds/runtime';
 *   const sdk = createWorldSdk({ worldId: 'world.my-thing' });
 *   sdk.onState((state) => render(state.payload));
 *   sdk.ready();
 *   const pitch = await sdk.connectorGet('pitch');
 */
import type { ConditionInfoResponse } from '../generated/models/ConditionInfoResponse';
import type { ConnectorInfoResponse } from '../generated/models/ConnectorInfoResponse';
import type { ExecuteResponse } from '../generated/models/ExecuteResponse';
import type { FormatInfoResponse } from '../generated/models/FormatInfoResponse';
import type { FormatListResponse } from '../generated/models/FormatListResponse';
import type { FeedPage } from '../generated/models/FeedPage';
import type { RunningInstance } from '../generated/models/RunningInstance';
import type { TransformationInfoResponse } from '../generated/models/TransformationInfoResponse';
import {
    WORLD_CHANNEL_TOKEN_PARAM,
    WORLD_MESSAGE_TYPES,
    WORLD_PROTOCOL_VERSION,
    type WorldFeedParams,
    type WorldPageParams,
    type WorldRpcError,
    type WorldRpcMethod,
    type WorldRpcParams,
    type WorldRpcRequestMessage,
    type WorldRpcResponseMessage,
    type WorldRpcResult,
    type WorldStateMessage,
} from './protocol';

export type { WorldStateMessage, WorldStateSeed } from './protocol';

export interface WorldSdkOptions {
    /** Stable world identity. Must match the id the host mounts this world with. */
    worldId: string;
    /** Window to send messages to. Defaults to `window.parent`. */
    targetWindow?: Window;
    /** `postMessage` targetOrigin for outbound messages. Defaults to `'*'`. */
    targetOrigin?: string;
    /** Window to listen on for host messages. Defaults to the global `window`. */
    listenWindow?: Window;
    /**
     * If set, inbound messages whose `event.origin` does not match are ignored.
     * Recommended in production; defaults to accepting any origin.
     */
    expectedOrigin?: string;
    /** Per-mount capability token. Defaults to the URL dcnWorldChannel parameter. */
    channelToken?: string;
    /** Per-call RPC timeout in milliseconds. Defaults to 15000. */
    requestTimeoutMs?: number;
}

/** Error thrown when a brokered call is rejected by the host. */
export class WorldRpcCallError extends Error {
    readonly code: WorldRpcError['code'];
    readonly status?: number;

    constructor(error: WorldRpcError) {
        super(error.message);
        this.name = 'WorldRpcCallError';
        this.code = error.code;
        if (error.status !== undefined) this.status = error.status;
    }
}

export interface WorldSdk {
    readonly worldId: string;
    /** Announce that the world has loaded and is ready to receive state. */
    ready(): void;
    /** Report an unrecoverable error to the host. */
    reportError(message: string): void;
    /** Tell the host the world finished rendering a state request. */
    reportRendered(requestId?: string): void;
    /** Subscribe to host state pushes. Returns an unsubscribe function. */
    onState<TPayload = unknown>(cb: (state: WorldStateMessage<TPayload>) => void): () => void;
    connectorGet(name: string): Promise<ConnectorInfoResponse>;
    connectorExists(name: string): Promise<boolean>;
    transformationExists(name: string): Promise<boolean>;
    transformationGet(name: string): Promise<TransformationInfoResponse>;
    conditionExists(name: string): Promise<boolean>;
    conditionGet(name: string): Promise<ConditionInfoResponse>;
    formatInfo(hash: string, opts?: WorldPageParams): Promise<FormatInfoResponse>;
    listFormats(opts?: WorldPageParams): Promise<FormatListResponse>;
    feed(opts?: WorldFeedParams): Promise<FeedPage>;
    execute(
        connectorName: string,
        particlesCount: number | string,
        dynamicRi?: Record<string, RunningInstance>
    ): Promise<ExecuteResponse>;
    /** Detach listeners and reject any in-flight calls. */
    dispose(): void;
}

interface Pending {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
}

function generateRequestId(seq: number): string {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${String(seq)}-${rand}`;
}

/**
 * Create the world-side SDK. The world calls this once and uses the returned
 * object for all host interaction.
 */
export function createWorldSdk(options: WorldSdkOptions): WorldSdk {
    const worldId = options.worldId;
    if (!worldId) throw new Error('createWorldSdk requires a worldId');

    const listenWindow = options.listenWindow ?? (globalThis as unknown as Window);
    const targetWindow = options.targetWindow ?? listenWindow.parent;
    const targetOrigin = options.targetOrigin ?? inferParentOrigin(listenWindow) ?? '*';
    const expectedOrigin =
        options.expectedOrigin ?? (targetOrigin !== '*' && targetOrigin !== 'null' ? targetOrigin : undefined);
    const channelToken = requireChannelToken(options.channelToken ?? inferChannelToken(listenWindow));
    const timeoutMs = options.requestTimeoutMs ?? 15000;

    const pending = new Map<string, Pending>();
    const stateListeners = new Set<(state: WorldStateMessage) => void>();
    const connectorCache = new Map<string, ConnectorInfoResponse>();
    const transformationCache = new Map<string, TransformationInfoResponse>();
    const conditionCache = new Map<string, ConditionInfoResponse>();
    let seq = 0;
    let disposed = false;

    function post(message: unknown): void {
        targetWindow.postMessage(message, targetOrigin);
    }

    function settleRejectAll(reason: unknown): void {
        for (const [, entry] of pending) {
            if (entry.timer) clearTimeout(entry.timer);
            entry.reject(reason);
        }
        pending.clear();
    }

    function rpc<M extends WorldRpcMethod>(
        method: M,
        params: WorldRpcParams<M>
    ): Promise<WorldRpcResult<M>> {
        if (disposed) return Promise.reject(new Error('World SDK has been disposed'));
        const requestId = generateRequestId((seq += 1));
        const request: WorldRpcRequestMessage<M> = {
            type: WORLD_MESSAGE_TYPES.rpcRequest,
            worldId,
            channelToken,
            requestId,
            method,
            params,
        };
        return new Promise<WorldRpcResult<M>>((resolve, reject) => {
            const timer =
                timeoutMs > 0
                    ? setTimeout(() => {
                          pending.delete(requestId);
                          reject(
                              new WorldRpcCallError({
                                  code: 'timeout',
                                  message: `World RPC '${method}' timed out after ${String(timeoutMs)}ms`,
                              })
                          );
                      }, timeoutMs)
                    : undefined;
            pending.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            post(request);
        });
    }

    function handleRpcResponse(message: WorldRpcResponseMessage): void {
        const entry = pending.get(message.requestId);
        if (!entry) return;
        pending.delete(message.requestId);
        if (entry.timer) clearTimeout(entry.timer);
        if (message.ok) {
            entry.resolve(message.result);
        } else {
            entry.reject(new WorldRpcCallError(message.error));
        }
    }

    function handleState(message: WorldStateMessage): void {
        const seed = message.seed;
        if (seed) {
            for (const [name, value] of Object.entries(seed.connectors ?? {})) {
                connectorCache.set(name, value);
            }
            for (const [name, value] of Object.entries(seed.transformations ?? {})) {
                transformationCache.set(name, value);
            }
            for (const [name, value] of Object.entries(seed.conditions ?? {})) {
                conditionCache.set(name, value);
            }
        }
        for (const cb of stateListeners) cb(message);
    }

    function onMessage(event: MessageEvent): void {
        if (expectedOrigin !== undefined && event.origin !== expectedOrigin) return;
        if (event.source !== targetWindow) return;
        const data = event.data as { type?: unknown; worldId?: unknown; channelToken?: unknown } | null;
        if (!data || typeof data.type !== 'string') return;
        if (data.worldId !== worldId) return;
        if (data.channelToken !== channelToken) return;
        if (data.type === WORLD_MESSAGE_TYPES.rpcResponse) {
            handleRpcResponse(data as WorldRpcResponseMessage);
        } else if (data.type === WORLD_MESSAGE_TYPES.state) {
            handleState(data as WorldStateMessage);
        }
    }

    listenWindow.addEventListener('message', onMessage as EventListener);

    return {
        worldId,
        ready() {
            post({
                type: WORLD_MESSAGE_TYPES.ready,
                worldId,
                channelToken,
                protocolVersion: WORLD_PROTOCOL_VERSION,
            });
        },
        reportError(message: string) {
            post({ type: WORLD_MESSAGE_TYPES.error, worldId, channelToken, message });
        },
        reportRendered(requestId?: string) {
            post({ type: WORLD_MESSAGE_TYPES.rendered, worldId, channelToken, requestId });
        },
        onState<TPayload = unknown>(cb: (state: WorldStateMessage<TPayload>) => void) {
            const listener = cb as (state: WorldStateMessage) => void;
            stateListeners.add(listener);
            return () => stateListeners.delete(listener);
        },
        async connectorGet(name: string) {
            const cached = connectorCache.get(name);
            if (cached) return cached;
            const result = await rpc('connectorGet', { name });
            connectorCache.set(name, result);
            return result;
        },
        connectorExists(name: string) {
            if (connectorCache.has(name)) return Promise.resolve(true);
            return rpc('connectorExists', { name });
        },
        transformationExists(name: string) {
            if (transformationCache.has(name)) return Promise.resolve(true);
            return rpc('transformationExists', { name });
        },
        async transformationGet(name: string) {
            const cached = transformationCache.get(name);
            if (cached) return cached;
            const result = await rpc('transformationGet', { name });
            transformationCache.set(name, result);
            return result;
        },
        conditionExists(name: string) {
            if (conditionCache.has(name)) return Promise.resolve(true);
            return rpc('conditionExists', { name });
        },
        async conditionGet(name: string) {
            const cached = conditionCache.get(name);
            if (cached) return cached;
            const result = await rpc('conditionGet', { name });
            conditionCache.set(name, result);
            return result;
        },
        formatInfo(hash: string, opts: WorldPageParams = {}) {
            return rpc('formatInfo', { hash, ...opts });
        },
        listFormats(opts: WorldPageParams = {}) {
            return rpc('listFormats', { ...opts });
        },
        feed(opts: WorldFeedParams = {}) {
            return rpc('feed', { ...opts });
        },
        execute(
            connectorName: string,
            particlesCount: number | string,
            dynamicRi?: Record<string, RunningInstance>
        ) {
            return rpc('execute', {
                connectorName,
                particlesCount,
                ...(dynamicRi ? { dynamicRi } : {}),
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            listenWindow.removeEventListener('message', onMessage as EventListener);
            stateListeners.clear();
            connectorCache.clear();
            transformationCache.clear();
            conditionCache.clear();
            settleRejectAll(new Error('World SDK has been disposed'));
        },
    };
}

function inferParentOrigin(listenWindow: Window): string | undefined {
    const location = (listenWindow as unknown as { location?: Location & { ancestorOrigins?: DOMStringList } })
        .location;
    const ancestorOrigins = location?.ancestorOrigins;
    const ancestorOrigin = ancestorOrigins?.[0];
    if (ancestorOrigin && ancestorOrigin !== 'null') return ancestorOrigin;

    const referrer = (listenWindow as unknown as { document?: Document }).document?.referrer;
    if (referrer) {
        try {
            const origin = new URL(referrer).origin;
            if (origin !== 'null') return origin;
        } catch {
            // Ignore malformed referrers and fall through to the current origin.
        }
    }

    const currentOrigin = location?.origin;
    if (currentOrigin && currentOrigin !== 'null') return currentOrigin;
    return undefined;
}

function inferChannelToken(listenWindow: Window): string | undefined {
    const location = (listenWindow as unknown as { location?: Location }).location;
    const search = location?.search;
    if (search) {
        const token = new URLSearchParams(search).get(WORLD_CHANNEL_TOKEN_PARAM);
        if (token) return token;
    }
    const hash = location?.hash;
    if (hash?.includes('?')) {
        const token = new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get(WORLD_CHANNEL_TOKEN_PARAM);
        if (token) return token;
    }
    return undefined;
}

function requireChannelToken(value: string | undefined): string {
    if (!value) throw new Error('createWorldSdk requires a channelToken or dcnWorldChannel URL parameter');
    return value;
}
