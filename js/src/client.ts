declare const process: { env?: Record<string, string | undefined> } | undefined;

export type Address = string;
export type FormatHash = string;
export type FeedEventType = 'connector_added' | 'transformation_added' | 'condition_added';
export type FeedEventStatus = 'observed' | 'safe' | 'finalized' | 'removed';

export interface DcnClientOptions {
    baseUrl?: string;
    accessToken?: string | null;
    fetch?: typeof fetch;
}

export interface VersionResponse {
    build_timestamp: string;
    version: string;
}

export interface NonceResponse {
    nonce: string;
}

export interface AuthResponse {
    access_token: string;
}

export interface CursorState<T = string> {
    has_more: boolean;
    next_after: T | null;
}

export interface AccountListResponse {
    limit: number;
    total_accounts: number;
    cursor: CursorState<Address>;
    accounts: Address[];
}

export interface AccountInfoResponse {
    address: Address;
    limit: number;
    owned_connectors: string[];
    owned_transformations: string[];
    owned_conditions: string[];
    cursor_connectors: CursorState;
    cursor_transformations: CursorState;
    cursor_conditions: CursorState;
}

export interface TransformationCallDef {
    name: string;
    args?: number[];
}

export interface RunningInstance {
    start_point: number;
    transformation_shift: number;
}

export interface ConnectorDimension {
    transformations: TransformationCallDef[];
    composite?: string;
    bindings?: Record<string, string>;
}

export interface CreateConnectorRequest {
    name: string;
    dimensions: ConnectorDimension[];
    condition_name: string;
    condition_args: number[];
    static_ri?: Record<string, RunningInstance>;
}

export interface ConnectorInfoResponse extends CreateConnectorRequest {
    condition_name: string;
    condition_args: number[];
    owner: Address;
    address: string;
    format_hash: FormatHash;
}

export interface CreateConnectorResponse {
    name: string;
    owner: Address;
    address: string;
    format_hash: FormatHash;
}

export interface CreateSourceRequest {
    name: string;
    sol_src: string;
}

export interface SourceInfoResponse extends CreateSourceRequest {
    owner: Address;
    address: string;
}

export interface CreateSourceResponse {
    name: string;
    owner: Address;
    address: string;
}

export type TransformationInfoResponse = SourceInfoResponse;
export type CreateTransformationRequest = CreateSourceRequest;
export type CreateTransformationResponse = CreateSourceResponse;
export type ConditionInfoResponse = SourceInfoResponse;
export type CreateConditionRequest = CreateSourceRequest;
export type CreateConditionResponse = CreateSourceResponse;

export interface ExecuteRequest {
    connector_name: string;
    particles_count: number | string;
    dynamic_ri?: Record<string, RunningInstance>;
}

export interface ParticlesResultItem {
    path: string;
    data: number[];
}

export type ExecuteResponse = ParticlesResultItem[];

export interface FormatListResponse {
    limit: number;
    total_formats: number;
    cursor: CursorState<FormatHash>;
    formats: FormatHash[];
}

export interface FormatInfoResponse {
    format_hash: FormatHash;
    limit: number;
    total_connectors: number;
    cursor: CursorState;
    scalars: string[];
    connectors: string[];
}

export interface FeedEventPayload {
    type: 'connector' | 'transformation' | 'condition';
    name: string;
    owner: Address;
    [key: string]: unknown;
}

export interface FeedItem {
    feed_id: string;
    event_type: FeedEventType;
    status: FeedEventStatus;
    visible: boolean;
    tx_hash: string;
    block_number: number;
    tx_index: number;
    log_index: number;
    history_cursor: string;
    created_at_ms: number;
    updated_at_ms: number;
    projector_version: number;
    payload: FeedEventPayload;
}

export interface FeedPage {
    limit: number;
    cursor: {
        has_more: boolean;
        next_before: string | null;
    };
    items: FeedItem[];
}

export interface FeedOptions {
    limit?: number;
    before?: string;
    type?: FeedEventType;
    includeUnfinalized?: boolean;
}

export interface AccountInfoOptions {
    limit?: number;
    afterConnectors?: string;
    afterTransformations?: string;
    afterConditions?: string;
}

export interface PageOptions {
    limit?: number;
    after?: string;
}

export class DcnApiError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, body: unknown) {
        super(`DCN API request failed with status ${status}`);
        this.name = 'DcnApiError';
        this.status = status;
        this.body = body;
    }
}

const DEFAULT_BASE = 'https://api.decentralised.art/chain';

type QueryValue = string | number | boolean | null | undefined;

function stripSlashes(value: string): string {
    return value.replace(/\/+$/, '');
}

async function parseBody(resp: Response): Promise<unknown> {
    const contentType = resp.headers.get('content-type') ?? '';
    if (resp.status === 204) return undefined;
    if (contentType.includes('application/json')) return resp.json();
    const text = await resp.text();
    return text.length ? text : undefined;
}

export class DcnClient {
    private _accessToken?: string | null;
    private readonly _baseUrl: string;
    private readonly _fetch: typeof fetch;

    constructor(opts: DcnClientOptions = {}) {
        const envBase = typeof process !== 'undefined' ? process.env?.DCN_API_BASE : undefined;
        this._baseUrl = stripSlashes(opts.baseUrl ?? envBase ?? DEFAULT_BASE);
        this._accessToken = opts.accessToken ?? null;
        this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    }

    private url(path: string, query?: Record<string, QueryValue>): string {
        const url = new URL(path.replace(/^\/+/, ''), `${this._baseUrl}/`);
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    private async request<T>(
        method: string,
        path: string,
        opts: { body?: unknown; query?: Record<string, QueryValue>; auth?: boolean } = {}
    ): Promise<T> {
        const headers: Record<string, string> = {};
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        if (opts.auth !== false && this._accessToken) {
            headers.Authorization = `Bearer ${this._accessToken}`;
        }

        const resp = await this._fetch(this.url(path, opts.query), {
            method,
            headers,
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
        const parsed = await parseBody(resp);
        if (!resp.ok) throw new DcnApiError(resp.status, parsed);
        return parsed as T;
    }

    private async exists(path: string): Promise<boolean> {
        const resp = await this._fetch(this.url(path), { method: 'HEAD' });
        if (resp.status === 404) return false;
        if (!resp.ok) throw new DcnApiError(resp.status, await parseBody(resp));
        return true;
    }

    async version(): Promise<VersionResponse> {
        return this.request('GET', '/version', { auth: false });
    }

    async getNonce(address: Address): Promise<NonceResponse> {
        return this.request('GET', `/nonce/${encodeURIComponent(address)}`, { auth: false });
    }

    async loginWithSignature(
        address: Address,
        message: string,
        signature: string
    ): Promise<AuthResponse> {
        const resp = await this.request<AuthResponse>('POST', '/auth', {
            auth: false,
            body: { address, message, signature },
        });
        this._accessToken = resp.access_token;
        return resp;
    }

    async loginWithWallet(wallet: { address?: string; getAddress?: () => Promise<string>; signMessage: (message: string) => Promise<string> }): Promise<AuthResponse> {
        const address = wallet.address ?? await wallet.getAddress?.();
        if (!address) throw new Error('Wallet address is unavailable');
        const { nonce } = await this.getNonce(address);
        const message = `Login nonce: ${nonce}`;
        const signature = await wallet.signMessage(message);
        return this.loginWithSignature(address, message, signature);
    }

    async listAccounts(opts: PageOptions = {}): Promise<AccountListResponse> {
        return this.request('GET', '/accounts', {
            auth: false,
            query: { limit: opts.limit ?? 50, after: opts.after },
        });
    }

    async accountInfo(address: Address, opts: AccountInfoOptions = {}): Promise<AccountInfoResponse> {
        return this.request('GET', `/account/${encodeURIComponent(address)}`, {
            auth: false,
            query: {
                limit: opts.limit ?? 50,
                after_connectors: opts.afterConnectors,
                after_transformations: opts.afterTransformations,
                after_conditions: opts.afterConditions,
            },
        });
    }

    async connectorExists(name: string): Promise<boolean> {
        return this.exists(`/connector/${encodeURIComponent(name)}`);
    }

    async connectorGet(name: string): Promise<ConnectorInfoResponse> {
        return this.request('GET', `/connector/${encodeURIComponent(name)}`, { auth: false });
    }

    async connectorPost(req: CreateConnectorRequest): Promise<CreateConnectorResponse> {
        return this.request('POST', '/connector', { body: req });
    }

    async transformationExists(name: string): Promise<boolean> {
        return this.exists(`/transformation/${encodeURIComponent(name)}`);
    }

    async transformationGet(name: string): Promise<TransformationInfoResponse> {
        return this.request('GET', `/transformation/${encodeURIComponent(name)}`, { auth: false });
    }

    async transformationPost(req: CreateTransformationRequest): Promise<CreateTransformationResponse> {
        return this.request('POST', '/transformation', { body: req });
    }

    async conditionExists(name: string): Promise<boolean> {
        return this.exists(`/condition/${encodeURIComponent(name)}`);
    }

    async conditionGet(name: string): Promise<ConditionInfoResponse> {
        return this.request('GET', `/condition/${encodeURIComponent(name)}`, { auth: false });
    }

    async conditionPost(req: CreateConditionRequest): Promise<CreateConditionResponse> {
        return this.request('POST', '/condition', { body: req });
    }

    async execute(
        connectorName: string,
        particlesCount: number | string,
        dynamicRi?: Record<string, RunningInstance>
    ): Promise<ExecuteResponse> {
        return this.request('POST', '/execute', {
            body: {
                connector_name: connectorName,
                particles_count: particlesCount,
                ...(dynamicRi ? { dynamic_ri: dynamicRi } : {}),
            } satisfies ExecuteRequest,
        });
    }

    async listFormats(opts: PageOptions = {}): Promise<FormatListResponse> {
        return this.request('GET', '/formats', {
            auth: false,
            query: { limit: opts.limit ?? 50, after: opts.after },
        });
    }

    async formatInfo(hash: FormatHash, opts: PageOptions = {}): Promise<FormatInfoResponse> {
        return this.request('GET', `/format/${encodeURIComponent(hash)}`, {
            auth: false,
            query: { limit: opts.limit ?? 50, after: opts.after },
        });
    }

    async feed(opts: FeedOptions = {}): Promise<FeedPage> {
        return this.request('GET', '/feed', {
            auth: false,
            query: {
                limit: opts.limit ?? 50,
                before: opts.before,
                type: opts.type,
                include_unfinalized:
                    opts.includeUnfinalized === undefined ? undefined : opts.includeUnfinalized ? 1 : 0,
            },
        });
    }

    async feedStream(opts: { sinceSeq?: number; limit?: number } = {}): Promise<Response> {
        const resp = await this._fetch(this.url('/feed/stream', {
            since_seq: opts.sinceSeq,
            limit: opts.limit,
        }), { method: 'GET' });
        if (!resp.ok) throw new DcnApiError(resp.status, await parseBody(resp));
        return resp;
    }

    get accessToken() {
        return this._accessToken ?? undefined;
    }
}
