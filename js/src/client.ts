declare const process: { env?: Record<string, string | undefined> } | undefined;

import { DcnGeneratedClient } from './generated/DcnGeneratedClient';
import type { ApiRequestOptions } from './generated/core/ApiRequestOptions';
import { BaseHttpRequest } from './generated/core/BaseHttpRequest';
import { CancelablePromise } from './generated/core/CancelablePromise';
import type { OpenAPIConfig } from './generated/core/OpenAPI';
import type { AccountInfoResponse as GeneratedAccountInfoResponse } from './generated/models/AccountInfoResponse';
import type { AccountListResponse as GeneratedAccountListResponse } from './generated/models/AccountListResponse';
import type { Address as GeneratedAddress } from './generated/models/Address';
import type { AuthResponse as GeneratedAuthResponse } from './generated/models/AuthResponse';
import type { ConditionInfoResponse as GeneratedConditionInfoResponse } from './generated/models/ConditionInfoResponse';
import type { ConnectorDimension as GeneratedConnectorDimension } from './generated/models/ConnectorDimension';
import type { ConnectorInfoResponse as GeneratedConnectorInfoResponse } from './generated/models/ConnectorInfoResponse';
import type { CreateConditionRequest as GeneratedCreateConditionRequest } from './generated/models/CreateConditionRequest';
import type { CreateConditionResponse as GeneratedCreateConditionResponse } from './generated/models/CreateConditionResponse';
import type { CreateConnectorRequest as GeneratedCreateConnectorRequest } from './generated/models/CreateConnectorRequest';
import type { CreateConnectorResponse as GeneratedCreateConnectorResponse } from './generated/models/CreateConnectorResponse';
import type { CreateTransformationRequest as GeneratedCreateTransformationRequest } from './generated/models/CreateTransformationRequest';
import type { CreateTransformationResponse as GeneratedCreateTransformationResponse } from './generated/models/CreateTransformationResponse';
import type { ExecuteRequest as GeneratedExecuteRequest } from './generated/models/ExecuteRequest';
import type { ExecuteResponse as GeneratedExecuteResponse } from './generated/models/ExecuteResponse';
import type { FeedEventStatus as GeneratedFeedEventStatus } from './generated/models/FeedEventStatus';
import type { FeedEventType as GeneratedFeedEventType } from './generated/models/FeedEventType';
import type { FeedItem as GeneratedFeedItem } from './generated/models/FeedItem';
import type { FeedPage as GeneratedFeedPage } from './generated/models/FeedPage';
import type { FormatHash as GeneratedFormatHash } from './generated/models/FormatHash';
import type { FormatInfoResponse as GeneratedFormatInfoResponse } from './generated/models/FormatInfoResponse';
import type { FormatListResponse as GeneratedFormatListResponse } from './generated/models/FormatListResponse';
import type { NonceResponse as GeneratedNonceResponse } from './generated/models/NonceResponse';
import type { ParticlesResultItem as GeneratedParticlesResultItem } from './generated/models/ParticlesResultItem';
import type { RunningInstance as GeneratedRunningInstance } from './generated/models/RunningInstance';
import type { TransformationCallDef as GeneratedTransformationCallDef } from './generated/models/TransformationCallDef';
import type { TransformationInfoResponse as GeneratedTransformationInfoResponse } from './generated/models/TransformationInfoResponse';
import type { VersionResponse as GeneratedVersionResponse } from './generated/models/VersionResponse';

export type Address = GeneratedAddress;
export type FormatHash = GeneratedFormatHash;
export type FeedEventType = GeneratedFeedEventType;
export type FeedEventStatus = GeneratedFeedEventStatus;
export type VersionResponse = GeneratedVersionResponse;
export type NonceResponse = GeneratedNonceResponse;
export type AuthResponse = GeneratedAuthResponse;
export type AccountListResponse = GeneratedAccountListResponse;
export type AccountInfoResponse = GeneratedAccountInfoResponse;
export type TransformationCallDef = GeneratedTransformationCallDef;
export type RunningInstance = GeneratedRunningInstance;
export type ConnectorDimension = GeneratedConnectorDimension;
export type CreateConnectorRequest = GeneratedCreateConnectorRequest;
export type ConnectorInfoResponse = GeneratedConnectorInfoResponse;
export type CreateConnectorResponse = GeneratedCreateConnectorResponse;
export type CreateTransformationRequest = GeneratedCreateTransformationRequest;
export type CreateTransformationResponse = GeneratedCreateTransformationResponse;
export type TransformationInfoResponse = GeneratedTransformationInfoResponse;
export type CreateConditionRequest = GeneratedCreateConditionRequest;
export type CreateConditionResponse = GeneratedCreateConditionResponse;
export type ConditionInfoResponse = GeneratedConditionInfoResponse;
export type ExecuteRequest = GeneratedExecuteRequest;
export type ParticlesResultItem = GeneratedParticlesResultItem;
export type ExecuteResponse = GeneratedExecuteResponse;
export type FormatListResponse = GeneratedFormatListResponse;
export type FormatInfoResponse = GeneratedFormatInfoResponse;
export type FeedItem = GeneratedFeedItem;
export type FeedPage = GeneratedFeedPage;

export interface DcnClientOptions {
    /** Chain API base URL. Defaults to `DCN_API_BASE` or `https://api.decentralised.art/chain`. */
    baseUrl?: string;
    /** Bearer access token used for protected publish/execute endpoints. */
    accessToken?: string | null;
    /** Fetch implementation to use. Useful for tests, custom runtimes, or instrumentation. */
    fetch?: typeof fetch;
}

/** Feed page query options. */
export interface FeedOptions {
    /** Page size. The current server requires this parameter. */
    limit?: number;
    /** History cursor from a previous response `cursor.next_before`. */
    before?: string;
    /** Optional event type filter. */
    type?: FeedEventType;
    /** Include observed and safe events when true; finalized-only when false. */
    includeUnfinalized?: boolean;
}

/** Account ownership query options. */
export interface AccountInfoOptions {
    /** Page size for each ownership list. */
    limit?: number;
    /** Cursor for owned connectors. */
    afterConnectors?: string;
    /** Cursor for owned transformations. */
    afterTransformations?: string;
    /** Cursor for owned conditions. */
    afterConditions?: string;
}

/** Cursor page options used by list endpoints. */
export interface PageOptions {
    /** Page size. */
    limit?: number;
    /** Cursor from a previous response `cursor.next_after`. */
    after?: string;
}

/** Error raised for non-2xx DCN API responses. */
export class DcnApiError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, body: unknown) {
        super(`DCN API request failed with status ${String(status)}`);
        this.name = 'DcnApiError';
        this.status = status;
        this.body = body;
    }
}

const DEFAULT_BASE = 'https://api.decentralised.art/chain';

function stripSlashes(value: string): string {
    return value.replace(/\/+$/, '');
}

async function resolveConfigValue<T>(
    value: T | ((options: ApiRequestOptions) => Promise<T>) | undefined,
    options: ApiRequestOptions
): Promise<T | undefined> {
    if (typeof value === 'function') {
        return (value as (options: ApiRequestOptions) => Promise<T>)(options);
    }
    return value;
}

function buildUrl(config: OpenAPIConfig, options: ApiRequestOptions): string {
    const encode = config.ENCODE_PATH ?? encodeURIComponent;
    const path = options.url.replace(/{(.*?)}/g, (substring, group: string) => {
        if (Object.prototype.hasOwnProperty.call(options.path ?? {}, group)) {
            return encode(String(options.path?.[group]));
        }
        return substring;
    });
    const url = new URL(path.replace(/^\/+/, ''), `${stripSlashes(config.BASE)}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
            }
        } else {
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}

async function buildHeaders(config: OpenAPIConfig, options: ApiRequestOptions): Promise<Headers> {
    const headers = new Headers({ Accept: 'application/json' });
    const token = await resolveConfigValue(config.TOKEN, options);
    const extraHeaders = await resolveConfigValue(config.HEADERS, options);

    for (const [key, value] of Object.entries(extraHeaders ?? {})) {
        headers.set(key, value);
    }
    for (const [key, value] of Object.entries(options.headers ?? {})) {
        if (value !== undefined && value !== null) headers.set(key, String(value));
    }
    if (typeof token === 'string' && token.length > 0) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (options.body !== undefined) {
        headers.set('Content-Type', options.mediaType ?? 'application/json');
    }
    return headers;
}

async function parseBody(resp: Response): Promise<unknown> {
    const contentType = resp.headers.get('content-type') ?? '';
    if (resp.status === 204) return undefined;
    if (contentType.includes('application/json')) return resp.json();
    const text = await resp.text();
    return text.length ? text : undefined;
}

function requestBody(options: ApiRequestOptions): BodyInit | undefined {
    if (options.body === undefined) return undefined;
    if (typeof options.body === 'string') return options.body;
    return JSON.stringify(options.body);
}

function needsAuth(options: ApiRequestOptions): boolean {
    return options.method === 'POST' && (
        options.url === '/connector' ||
        options.url === '/condition' ||
        options.url === '/transformation' ||
        options.url === '/execute'
    );
}

class DcnHttpRequest extends BaseHttpRequest {
    constructor(
        config: OpenAPIConfig,
        private readonly fetcher: typeof fetch
    ) {
        super(config);
    }

    public override request<T>(options: ApiRequestOptions): CancelablePromise<T> {
        return new CancelablePromise<T>((resolve, reject, onCancel) => {
            const controller = new AbortController();
            onCancel(() => {
                controller.abort();
            });

            void (async () => {
                try {
                    const init: RequestInit = {
                        method: options.method,
                        headers: await buildHeaders(this.config, options),
                        signal: controller.signal,
                    };
                    const payload = requestBody(options);
                    if (payload !== undefined) {
                        init.body = payload;
                    }
                    const response = await this.fetcher(buildUrl(this.config, options), {
                        ...init,
                    });
                    const body = await parseBody(response);
                    if (!response.ok) {
                        reject(new DcnApiError(response.status, body));
                        return;
                    }
                    resolve(body as T);
                } catch (error) {
                    reject(error);
                }
            })();
        });
    }
}

export class DcnClient {
    private _accessToken?: string | null;
    private readonly _baseUrl: string;
    private readonly _fetch: typeof fetch;
    private readonly _api: DcnGeneratedClient;

    /**
     * Create a DCN Chain API client.
     *
     * Defaults to `https://api.decentralised.art/chain`; override with `baseUrl` or `DCN_API_BASE`.
     */
    constructor(opts: DcnClientOptions = {}) {
        const envBase = typeof process !== 'undefined' ? process.env?.DCN_API_BASE : undefined;
        this._baseUrl = stripSlashes(opts.baseUrl ?? envBase ?? DEFAULT_BASE);
        this._accessToken = opts.accessToken ?? null;
        this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

        const fetcher = this._fetch;
        const HttpRequest = class extends DcnHttpRequest {
            constructor(config: OpenAPIConfig) {
                super(config, fetcher);
            }
        };

        this._api = new DcnGeneratedClient({
            BASE: this._baseUrl,
            TOKEN: (options) => Promise.resolve(needsAuth(options) ? this._accessToken ?? '' : ''),
            ENCODE_PATH: encodeURIComponent,
        }, HttpRequest);
    }

    private url(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
        const url = new URL(path.replace(/^\/+/, ''), `${this._baseUrl}/`);
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    private async exists(check: Promise<unknown>): Promise<boolean> {
        try {
            await check;
            return true;
        } catch (error) {
            if (error instanceof DcnApiError && error.status === 404) return false;
            throw error;
        }
    }

    /**
     * Get chain API version metadata.
     *
     * Returns service version and build timestamp.
     */
    async version(): Promise<VersionResponse> {
        return this._api.core.getVersion();
    }

    /**
     * Get a one-time nonce for an address.
     *
     * Sign `Login nonce: <nonce>` and submit it to `loginWithSignature`.
     */
    async getNonce(address: Address): Promise<NonceResponse> {
        return this._api.auth.getNonce(address);
    }

    /**
     * Authenticate using an address, signed login message, and signature.
     *
     * Stores the returned bearer token on this client for protected endpoints.
     */
    async loginWithSignature(
        address: Address,
        message: string,
        signature: string
    ): Promise<AuthResponse> {
        const resp = await this._api.auth.postAuth({ address, message, signature });
        this._accessToken = resp.access_token;
        return resp;
    }

    /**
     * Authenticate with an ethers/browser-style wallet.
     *
     * Fetches a nonce, signs `Login nonce: <nonce>`, then stores the returned bearer token.
     */
    async loginWithWallet(wallet: { address?: string; getAddress?: () => Promise<string>; signMessage: (message: string) => Promise<string> }): Promise<AuthResponse> {
        const address = wallet.address ?? await wallet.getAddress?.();
        if (!address) throw new Error('Wallet address is unavailable');
        const { nonce } = await this.getNonce(address);
        const message = `Login nonce: ${nonce}`;
        const signature = await wallet.signMessage(message);
        return this.loginWithSignature(address, message, signature);
    }

    /**
     * List chain accounts known to the registry.
     *
     * Uses cursor-based pagination.
     */
    async listAccounts(opts: PageOptions = {}): Promise<AccountListResponse> {
        return this._api.account.getAccounts(opts.limit ?? 50, opts.after);
    }

    /**
     * Get owned connectors, transformations, and conditions for an address.
     *
     * Each ownership list has its own cursor.
     */
    async accountInfo(address: Address, opts: AccountInfoOptions = {}): Promise<AccountInfoResponse> {
        return this._api.account.getAccount(
            address,
            opts.limit ?? 50,
            opts.afterConnectors,
            opts.afterTransformations,
            opts.afterConditions
        );
    }

    /**
     * Check connector existence.
     *
     * Returns true when the connector exists, false on 404.
     */
    async connectorExists(name: string): Promise<boolean> {
        return this.exists(this._api.connector.headConnector(name));
    }

    /**
     * Get connector by name.
     *
     * Returns connector definition, owner, address, and derived format hash.
     */
    async connectorGet(name: string): Promise<ConnectorInfoResponse> {
        return this._api.connector.getConnector(name);
    }

    /**
     * Publish a connector definition.
     *
     * Requires bearer authentication.
     */
    async connectorPost(req: CreateConnectorRequest): Promise<CreateConnectorResponse> {
        return this._api.connector.postConnector(req);
    }

    /**
     * Check transformation existence.
     *
     * Returns true when the transformation exists, false on 404.
     */
    async transformationExists(name: string): Promise<boolean> {
        return this.exists(this._api.transformation.headTransformation(name));
    }

    /**
     * Get transformation by name.
     *
     * Returns transformation source metadata, owner, and deployed address.
     */
    async transformationGet(name: string): Promise<TransformationInfoResponse> {
        return this._api.transformation.getTransformation(name);
    }

    /**
     * Publish a transformation definition.
     *
     * Requires bearer authentication.
     */
    async transformationPost(req: CreateTransformationRequest): Promise<CreateTransformationResponse> {
        return this._api.transformation.postTransformation(req);
    }

    /**
     * Check condition existence.
     *
     * Returns true when the condition exists, false on 404.
     */
    async conditionExists(name: string): Promise<boolean> {
        return this.exists(this._api.condition.headCondition(name));
    }

    /**
     * Get condition by name.
     *
     * Returns condition source metadata, owner, and deployed address.
     */
    async conditionGet(name: string): Promise<ConditionInfoResponse> {
        return this._api.condition.getCondition(name);
    }

    /**
     * Publish a condition definition.
     *
     * Requires bearer authentication.
     */
    async conditionPost(req: CreateConditionRequest): Promise<CreateConditionResponse> {
        return this._api.condition.postCondition(req);
    }

    /**
     * Execute a connector.
     *
     * `particlesCount` accepts protobuf JSON uint32 values and rejects values greater than 65536.
     * Requires bearer authentication.
     */
    async execute(
        connectorName: string,
        particlesCount: number | string,
        dynamicRi?: Record<string, RunningInstance>
    ): Promise<ExecuteResponse> {
        return this._api.runner.postExecute({
            connector_name: connectorName,
            particles_count: particlesCount,
            ...(dynamicRi ? { dynamic_ri: dynamicRi } : {}),
        });
    }

    /**
     * List connector format hashes known to the registry.
     *
     * Uses cursor-based pagination.
     */
    async listFormats(opts: PageOptions = {}): Promise<FormatListResponse> {
        return this._api.format.getFormats(opts.limit ?? 50, opts.after);
    }

    /**
     * Get format membership.
     *
     * Lists connector names and scalar labels for a format hash.
     */
    async formatInfo(hash: FormatHash, opts: PageOptions = {}): Promise<FormatInfoResponse> {
        return this._api.format.getFormat(hash, opts.limit ?? 50, opts.after);
    }

    /**
     * List feed items.
     *
     * Returns newest-first feed items with compact payload metadata. Hydrate full details via entity endpoints.
     */
    async feed(opts: FeedOptions = {}): Promise<FeedPage> {
        return this._api.feed.getFeed(
            opts.limit ?? 50,
            opts.before,
            opts.type,
            opts.includeUnfinalized === undefined ? undefined : opts.includeUnfinalized ? 1 : 0
        );
    }

    /**
     * Open the feed Server-Sent Events stream.
     *
     * Starts with bounded replay from `sinceSeq`, then tails live feed deltas.
     */
    async feedStream(opts: { sinceSeq?: number; limit?: number } = {}): Promise<Response> {
        const resp = await this._fetch(this.url('/feed/stream', {
            since_seq: opts.sinceSeq,
            limit: opts.limit,
        }), { method: 'GET' });
        if (!resp.ok) throw new DcnApiError(resp.status, await parseBody(resp));
        return resp;
    }

    /** Current bearer access token, if authenticated. */
    get accessToken() {
        return this._accessToken ?? undefined;
    }
}
