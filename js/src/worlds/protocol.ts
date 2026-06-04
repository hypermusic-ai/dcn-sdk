/**
 * Shared world<->host runtime contract.
 *
 * This module is the single source of truth for the postMessage protocol that
 * connects a world (running inside a sandboxed iframe) to its host. It is
 * imported by both the world-side runtime (`./runtime`) and the host-side
 * broker (`./host`). It contains only types and constants, so it adds no
 * runtime weight to the world bundle.
 */
import type { ConditionInfoResponse } from '../generated/models/ConditionInfoResponse';
import type { ConnectorInfoResponse } from '../generated/models/ConnectorInfoResponse';
import type { ExecuteResponse } from '../generated/models/ExecuteResponse';
import type { FeedEventType } from '../generated/models/FeedEventType';
import type { FeedPage } from '../generated/models/FeedPage';
import type { FormatInfoResponse } from '../generated/models/FormatInfoResponse';
import type { FormatListResponse } from '../generated/models/FormatListResponse';
import type { RunningInstance } from '../generated/models/RunningInstance';
import type { TransformationInfoResponse } from '../generated/models/TransformationInfoResponse';

/** Version of the world runtime protocol implemented by this SDK. */
export const WORLD_PROTOCOL_VERSION = 1 as const;

/** URL parameter used to pass the per-mount channel token into a world iframe. */
export const WORLD_CHANNEL_TOKEN_PARAM = 'dcnWorldChannel';

/** Message `type` discriminators exchanged between world and host. */
export const WORLD_MESSAGE_TYPES = {
    /** world -> host: the world has loaded and is ready to receive state. */
    ready: 'dcn:world-ready',
    /** host -> world: render state and/or seed data for the world. */
    state: 'dcn:world-state',
    /** world -> host: the world finished rendering a given state request. */
    rendered: 'dcn:world-rendered',
    /** world -> host: the world hit an unrecoverable error. */
    error: 'dcn:world-error',
    /** world -> host: invoke a brokered DCN data/execute call. */
    rpcRequest: 'dcn:world-rpc-request',
    /** host -> world: result for a previous rpc request. */
    rpcResponse: 'dcn:world-rpc-response',
} as const;

export type WorldMessageType = (typeof WORLD_MESSAGE_TYPES)[keyof typeof WORLD_MESSAGE_TYPES];

// ---------------------------------------------------------------------------
// Manifest / permission types (lightweight mirror of the backend WorldManifest)
// ---------------------------------------------------------------------------

/** Surfaces a world may be mounted on (mirrors `WorldRuntimeSurface`). */
export type WorldRuntimeSurface = 'world-page' | 'studio-plugin';

/**
 * Permissions a world may declare. Mirrors `ALLOWED_PERMISSIONS` in the backend
 * (`src/world_bundle.rs`). The broker uses the `dcn.*` entries to gate brokered
 * calls.
 */
export type WorldPermission =
    | 'dcn.connectors.read'
    | 'dcn.execute'
    | 'browser.audio'
    | 'browser.downloads';

/**
 * Subset of the backend `WorldManifest` (camelCase JSON) needed on the client.
 * Only `permissions` is consulted by the broker today; the remaining fields are
 * provided for hosts that want to render manifest metadata. A full validator is
 * intentionally out of scope for v1.
 */
export interface WorldManifest {
    schemaVersion: number;
    slug: string;
    name: string;
    version: string;
    entry: string;
    runtime: string;
    surfaces: WorldRuntimeSurface[];
    permissions: WorldPermission[];
    description: string;
    shortDescription?: string;
    heroLabel?: string;
    accentColor?: string;
    acceptedFormatHashes?: string[];
    requiredScalars?: string[];
    acceptedScalars?: string[];
    requiredScalarSets?: { id: string; label: string; scalars: string[] }[];
    valueLimits?: {
        particlesCount?: { min: number; max: number };
        scalarValues?: Record<string, { min: number; max: number }>;
    };
    preview?: string;
}

// ---------------------------------------------------------------------------
// RPC method surface (mirrors the brokered subset of DcnClient)
// ---------------------------------------------------------------------------

export type WorldRpcMethod =
    | 'connectorGet'
    | 'connectorExists'
    | 'transformationGet'
    | 'conditionGet'
    | 'formatInfo'
    | 'listFormats'
    | 'feed'
    | 'execute';

/** Cursor page params for list-style brokered calls. */
export interface WorldPageParams {
    limit?: number;
    after?: string;
}

/** Feed page params for the brokered feed call. */
export interface WorldFeedParams {
    limit?: number;
    before?: string;
    type?: FeedEventType;
    includeUnfinalized?: boolean;
}

/** Execute params for the brokered execute call. */
export interface WorldExecuteParams {
    connectorName: string;
    particlesCount: number | string;
    dynamicRi?: Record<string, RunningInstance>;
}

/**
 * Maps each RPC method to its params and result. Results reuse the generated
 * chain response types so world and host stay in lockstep with the API.
 */
export interface WorldRpcMap {
    connectorGet: { params: { name: string }; result: ConnectorInfoResponse };
    connectorExists: { params: { name: string }; result: boolean };
    transformationGet: { params: { name: string }; result: TransformationInfoResponse };
    conditionGet: { params: { name: string }; result: ConditionInfoResponse };
    formatInfo: { params: { hash: string } & WorldPageParams; result: FormatInfoResponse };
    listFormats: { params: WorldPageParams; result: FormatListResponse };
    feed: { params: WorldFeedParams; result: FeedPage };
    execute: { params: WorldExecuteParams; result: ExecuteResponse };
}

export type WorldRpcParams<M extends WorldRpcMethod> = WorldRpcMap[M]['params'];
export type WorldRpcResult<M extends WorldRpcMethod> = WorldRpcMap[M]['result'];

/** Permission required to invoke a given RPC method. */
export const WORLD_RPC_PERMISSION: Record<WorldRpcMethod, WorldPermission> = {
    connectorGet: 'dcn.connectors.read',
    connectorExists: 'dcn.connectors.read',
    transformationGet: 'dcn.connectors.read',
    conditionGet: 'dcn.connectors.read',
    formatInfo: 'dcn.connectors.read',
    listFormats: 'dcn.connectors.read',
    feed: 'dcn.connectors.read',
    execute: 'dcn.execute',
};

// ---------------------------------------------------------------------------
// Message envelopes
// ---------------------------------------------------------------------------

export interface WorldReadyMessage {
    type: typeof WORLD_MESSAGE_TYPES.ready;
    worldId: string;
    protocolVersion: number;
    channelToken: string;
}

export interface WorldRenderedMessage {
    type: typeof WORLD_MESSAGE_TYPES.rendered;
    worldId: string;
    channelToken: string;
    requestId?: string;
}

export interface WorldErrorMessage {
    type: typeof WORLD_MESSAGE_TYPES.error;
    worldId: string;
    channelToken: string;
    message: string;
}

/** Connector/transformation/condition data the host may push to seed the cache. */
export interface WorldStateSeed {
    connectors?: Record<string, ConnectorInfoResponse>;
    transformations?: Record<string, TransformationInfoResponse>;
    conditions?: Record<string, ConditionInfoResponse>;
}

/**
 * State pushed from host to world. `payload` carries arbitrary render data for
 * the world; the optional `seed` pre-populates the world-side read cache.
 */
export interface WorldStateMessage<TPayload = unknown> {
    type: typeof WORLD_MESSAGE_TYPES.state;
    worldId: string;
    channelToken: string;
    requestId?: string;
    payload?: TPayload;
    seed?: WorldStateSeed;
}

export interface WorldRpcRequestMessage<M extends WorldRpcMethod = WorldRpcMethod> {
    type: typeof WORLD_MESSAGE_TYPES.rpcRequest;
    worldId: string;
    channelToken: string;
    requestId: string;
    method: M;
    params: WorldRpcParams<M>;
}

export interface WorldRpcError {
    code: 'permission_denied' | 'unknown_method' | 'bad_request' | 'host_error' | 'timeout';
    message: string;
    /** Underlying chain API status, when the failure came from a DcnApiError. */
    status?: number;
}

export type WorldRpcResponseMessage<M extends WorldRpcMethod = WorldRpcMethod> = {
    type: typeof WORLD_MESSAGE_TYPES.rpcResponse;
    worldId: string;
    channelToken: string;
    requestId: string;
} & ({ ok: true; result: WorldRpcResult<M> } | { ok: false; error: WorldRpcError });

export type WorldToHostMessage =
    | WorldReadyMessage
    | WorldRenderedMessage
    | WorldErrorMessage
    | WorldRpcRequestMessage;

export type HostToWorldMessage = WorldStateMessage | WorldRpcResponseMessage;
