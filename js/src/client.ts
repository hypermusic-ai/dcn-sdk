declare const process: { env?: Record<string, string | undefined> } | undefined;

import { DecentralisedArtGeneratedClient } from './generated/DecentralisedArtGeneratedClient';
import type { ApiRequestOptions } from './generated/core/ApiRequestOptions';
import { BaseHttpRequest } from './generated/core/BaseHttpRequest';
import { CancelablePromise } from './generated/core/CancelablePromise';
import type { OpenAPIConfig } from './generated/core/OpenAPI';
import type { AccountInfoResponse as GeneratedAccountInfoResponse } from './generated/models/AccountInfoResponse';
import type { AccountListResponse as GeneratedAccountListResponse } from './generated/models/AccountListResponse';
import type { Address as GeneratedAddress } from './generated/models/Address';
import type { AuthResponse as GeneratedAuthResponse } from './generated/models/AuthResponse';
import type { AlreadyPublished as GeneratedAlreadyPublished } from './generated/models/AlreadyPublished';
import type { ConditionInfoResponse as GeneratedConditionInfoResponse } from './generated/models/ConditionInfoResponse';
import type { ConfirmRequest as GeneratedConfirmRequest } from './generated/models/ConfirmRequest';
import type { ConfirmResponse as GeneratedConfirmResponse } from './generated/models/ConfirmResponse';
import type { ConnectorDimension as GeneratedConnectorDimension } from './generated/models/ConnectorDimension';
import type { ConnectorInfoResponse as GeneratedConnectorInfoResponse } from './generated/models/ConnectorInfoResponse';
import type { CreateConditionRequest as GeneratedCreateConditionRequest } from './generated/models/CreateConditionRequest';
import type { CreateConditionResponse as GeneratedCreateConditionResponse } from './generated/models/CreateConditionResponse';
import type { CreateConnectorRequest as GeneratedCreateConnectorRequest } from './generated/models/CreateConnectorRequest';
import type { CreateConnectorResponse as GeneratedCreateConnectorResponse } from './generated/models/CreateConnectorResponse';
import type { CreateTransformationRequest as GeneratedCreateTransformationRequest } from './generated/models/CreateTransformationRequest';
import type { CreateTransformationResponse as GeneratedCreateTransformationResponse } from './generated/models/CreateTransformationResponse';
import type { EntityKind as GeneratedEntityKind } from './generated/models/EntityKind';
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
import type { PreparedPublication as GeneratedPreparedPublication } from './generated/models/PreparedPublication';
import type { PrepareResponse as GeneratedPrepareResponse } from './generated/models/PrepareResponse';
import type { PublishError as GeneratedPublishError } from './generated/models/PublishError';
import type { RunningInstance as GeneratedRunningInstance } from './generated/models/RunningInstance';
import type { SendRequest as GeneratedSendRequest } from './generated/models/SendRequest';
import type { SendResponse as GeneratedSendResponse } from './generated/models/SendResponse';
import type { SigningFields as GeneratedSigningFields } from './generated/models/SigningFields';
import type { TransformationCallDef as GeneratedTransformationCallDef } from './generated/models/TransformationCallDef';
import type { TransformationInfoResponse as GeneratedTransformationInfoResponse } from './generated/models/TransformationInfoResponse';
import type { UnsignedTransaction as GeneratedUnsignedTransaction } from './generated/models/UnsignedTransaction';
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
export type SimulateResponse = ParticlesResultItem[];
export type EntityKind = GeneratedEntityKind;
export type UnsignedTransaction = GeneratedUnsignedTransaction;
export type PreparedPublication = GeneratedPreparedPublication;
export type AlreadyPublished = GeneratedAlreadyPublished;
export type PrepareResponse = GeneratedPrepareResponse;
export type ConfirmRequest = GeneratedConfirmRequest;
export type ConfirmResponse = GeneratedConfirmResponse;
export type PublishError = GeneratedPublishError;
export type SigningFields = GeneratedSigningFields;
export type SendRequest = GeneratedSendRequest;
export type SendResponse = GeneratedSendResponse;

/**
 * A relayed publication as the owner signs it: `transaction` merged with `signing`. All
 * quantities are hex, which is exactly what `eth_signTransaction` takes.
 */
export type RelayTransaction = UnsignedTransaction & SigningFields;

/** Signs a relayed publication offline and returns the raw `0x02…` transaction. */
export interface OfflineSigner {
    /** Owner address. When given, it must match the prepared transaction's `from`. */
    address?: string;
    signTransaction(transaction: RelayTransaction): Promise<string>;
}

/** The fields of an ethers v6 `TransactionRequest` a relayed publication sets. */
export interface EthersTransactionRequest {
    type: 2;
    chainId: bigint;
    nonce: number;
    to: string;
    data: string;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    value: bigint;
}

/** A wallet `loginWithWallet` accepts: an ethers `Wallet`/`Signer` or anything shaped like one. */
export interface LoginWallet {
    address?: string;
    getAddress?: () => Promise<string>;
    signMessage: (message: string) => Promise<string>;
    /** When present, `publish` signs with this wallet unless it is given another signer. */
    signTransaction?: (transaction: EthersTransactionRequest) => Promise<string>;
}

function toEthersTransaction(transaction: RelayTransaction): EthersTransactionRequest {
    return {
        type: 2,
        chainId: BigInt(transaction.chainId),
        nonce: Number(BigInt(transaction.nonce)),
        to: transaction.to,
        data: transaction.data,
        gasLimit: BigInt(transaction.gas),
        maxFeePerGas: BigInt(transaction.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
        value: BigInt(transaction.value),
    };
}

/** How `publish` signs, and the limits it enforces before anything is signed. */
export interface PublishOptions {
    /** Signs the transaction. Defaults to the wallet passed to `loginWithWallet`. */
    signer?: OfflineSigner;
    /** Refuse to sign when the prepared `maxFeePerGas` exceeds this, in wei. */
    maxFeePerGas?: bigint | number | string;
    /** Refuse to sign for any other chain. */
    chainId?: bigint | number | string;
    /** Delay between confirmation checks. Defaults to 3000 ms. */
    pollIntervalMs?: number;
    /** Confirmation checks before giving up. Defaults to 200. */
    maxConfirmAttempts?: number;
}
export type FormatListResponse = GeneratedFormatListResponse;
export type FormatInfoResponse = GeneratedFormatInfoResponse;
export type FeedItem = GeneratedFeedItem;
export type FeedPage = GeneratedFeedPage;

export interface DecentralisedArtClientOptions {
    /** Chain API base URL. Defaults to `DECENTRALISED_ART_API_BASE` or `https://api.decentralised.art/chain`. */
    baseUrl?: string;
    /** Bearer access token used for protected create/publish endpoints. */
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

/** Error raised for non-2xx decentralised.art API responses. */
export class DecentralisedArtApiError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, body: unknown) {
        super(`decentralised.art API request failed with status ${String(status)}`);
        this.name = 'DecentralisedArtApiError';
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
        options.url.startsWith('/publish/')
    );
}

class DecentralisedArtHttpRequest extends BaseHttpRequest {
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
                        reject(new DecentralisedArtApiError(response.status, body));
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

export class DecentralisedArtClient {
    private _accessToken?: string | null;
    private _signer: OfflineSigner | null = null;
    private readonly _baseUrl: string;
    private readonly _fetch: typeof fetch;
    private readonly _api: DecentralisedArtGeneratedClient;

    /**
     * Create a decentralised.art Chain API client.
     *
     * Defaults to `https://api.decentralised.art/chain`; override with `baseUrl` or `DECENTRALISED_ART_API_BASE`.
     */
    constructor(opts: DecentralisedArtClientOptions = {}) {
        const envBase = typeof process !== 'undefined' ? process.env?.DECENTRALISED_ART_API_BASE : undefined;
        this._baseUrl = stripSlashes(opts.baseUrl ?? envBase ?? DEFAULT_BASE);
        this._accessToken = opts.accessToken ?? null;
        this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

        const fetcher = this._fetch;
        const HttpRequest = class extends DecentralisedArtHttpRequest {
            constructor(config: OpenAPIConfig) {
                super(config, fetcher);
            }
        };

        this._api = new DecentralisedArtGeneratedClient({
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
            if (error instanceof DecentralisedArtApiError && error.status === 404) return false;
            throw error;
        }
    }

    /**
     * Get chain API version metadata.
     *
     * Returns chain API version and build timestamp.
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
     * Stores the returned bearer token on this client for protected endpoints. No wallet is
     * known afterwards, so `publish` needs an explicit `signer`.
     */
    async loginWithSignature(
        address: Address,
        message: string,
        signature: string
    ): Promise<AuthResponse> {
        const resp = await this._api.auth.postAuth({ address, message, signature });
        this._accessToken = resp.access_token;
        this._signer = null;
        return resp;
    }

    /**
     * Authenticate with an ethers/browser-style wallet.
     *
     * Fetches a nonce, signs `Login nonce: <nonce>`, then stores the returned bearer token. A
     * wallet that can sign transactions (an ethers `Wallet`) also becomes the default signer of
     * `publish`.
     */
    async loginWithWallet(wallet: LoginWallet): Promise<AuthResponse> {
        const address = wallet.address ?? await wallet.getAddress?.();
        if (!address) throw new Error('Wallet address is unavailable');
        const { nonce } = await this.getNonce(address);
        const message = `Login nonce: ${nonce}`;
        const signature = await wallet.signMessage(message);
        const resp = await this.loginWithSignature(address, message, signature);

        const signTransaction = wallet.signTransaction;
        if (signTransaction) {
            this._signer = {
                address,
                signTransaction: (transaction) => signTransaction.call(wallet, toEthersTransaction(transaction)),
            };
        }
        return resp;
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
     * Create a connector locally for simulation.
     *
     * The name must not be reserved on chain. Publish it on chain with `publishPrepare`/`publishConfirm`.
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
     * Returns name, argument count, owner, and address (`"0x0"` until published).
     */
    async transformationGet(name: string): Promise<TransformationInfoResponse> {
        return this._api.transformation.getTransformation(name);
    }

    /**
     * Create a transformation locally for simulation.
     *
     * The name must not be reserved on chain. Publish it on chain with `publishPrepare`/`publishConfirm`.
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
     * Returns name, argument count, owner, and address (`"0x0"` until published).
     */
    async conditionGet(name: string): Promise<ConditionInfoResponse> {
        return this._api.condition.getCondition(name);
    }

    /**
     * Create a condition locally for simulation.
     *
     * The name must not be reserved on chain. Publish it on chain with `publishPrepare`/`publishConfirm`.
     * Requires bearer authentication.
     */
    async conditionPost(req: CreateConditionRequest): Promise<CreateConditionResponse> {
        return this._api.condition.postCondition(req);
    }

    /**
     * Execute a connector on chain.
     *
     * Result is pinned to `block_number`/`block_hash` on `runner`, so anyone can re-check it.
     * `particlesCount` accepts protobuf JSON uint32 values between 1 and 65536.
     * No login required.
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
     * Execute a connector in the server's local simulation EVM.
     *
     * Covers entities created on this server before they are published on chain.
     * No login required.
     */
    async simulate(
        connectorName: string,
        particlesCount: number | string,
        dynamicRi?: Record<string, RunningInstance>
    ): Promise<SimulateResponse> {
        return this._api.runner.postSimulate({
            connector_name: connectorName,
            particles_count: particlesCount,
            ...(dynamicRi ? { dynamic_ri: dynamicRi } : {}),
        });
    }

    /**
     * Prepare on-chain publication of an entity created on this server.
     *
     * Returns `status: 'prepared'` with an unsigned `transaction` for the owner's wallet to send
     * (`eth_sendTransaction`), or `status: 'published'` when the registry already holds it.
     * With `relay`, the answer also carries `signing` (account nonce and fees) so the transaction
     * can be signed offline and sent with `publishSend`. Requires bearer authentication.
     */
    async publishPrepare(kind: EntityKind, name: string, opts: { relay?: boolean } = {}): Promise<PrepareResponse> {
        return this._api.publish.postPublishPrepare(kind, opts.relay ? { name, relay: true } : { name });
    }

    /**
     * Broadcast a publication transaction the owner signed offline, through the server's chain provider.
     *
     * The server checks that the caller signed it and that it publishes exactly this entity, then
     * answers with its `tx_hash`; confirm it with `publishConfirm`. The owner still pays for it.
     * Requires bearer authentication.
     */
    async publishSend(kind: EntityKind, req: SendRequest): Promise<SendResponse> {
        return this._api.publish.postPublishSend(kind, req);
    }

    /**
     * Publish an entity without a chain RPC endpoint: prepare it for relay, sign it offline,
     * let the server broadcast it, and confirm it until it is mined.
     *
     * Signs with `opts.signer`, or else the wallet passed to `loginWithWallet`. Returns the
     * confirmation, or the existing registration when the registry already holds this exact
     * publication (nothing is signed then). The owner pays for the transaction.
     * Requires bearer authentication.
     */
    async publish(
        kind: EntityKind,
        name: string,
        opts: PublishOptions = {}
    ): Promise<ConfirmResponse | AlreadyPublished> {
        const signer = opts.signer ?? this._signer;
        if (!signer) {
            throw new Error(
                'No signer: log in with loginWithWallet using a wallet that can sign transactions, pass ' +
                'opts.signer, or send with a browser wallet through publishPrepare and publishConfirm'
            );
        }

        const prepared = await this.publishPrepare(kind, name, { relay: true });
        if (prepared.status === 'published') return prepared;

        const { transaction, signing, content_hash } = prepared;
        if (!signing) {
            throw new Error('The server returned no signing fields; it does not support relayed publication');
        }
        if (signer.address && signer.address.toLowerCase() !== transaction.from.toLowerCase()) {
            throw new Error(`The signer ${signer.address} is not the entity owner ${transaction.from}`);
        }
        if (opts.chainId !== undefined && BigInt(opts.chainId) !== BigInt(transaction.chainId)) {
            throw new Error(`The publication is for chain ${String(BigInt(transaction.chainId))}, not ${String(opts.chainId)}`);
        }
        if (opts.maxFeePerGas !== undefined && BigInt(signing.maxFeePerGas) > BigInt(opts.maxFeePerGas)) {
            throw new Error(`maxFeePerGas ${String(BigInt(signing.maxFeePerGas))} exceeds the limit ${String(opts.maxFeePerGas)}`);
        }

        // A publication never transfers value, whatever the server returned.
        const raw_tx = await signer.signTransaction({ ...transaction, ...signing, type: '0x2', value: '0x0' });
        const { tx_hash } = await this.publishSend(kind, { name, content_hash, raw_tx });

        const attempts = opts.maxConfirmAttempts ?? 200;
        for (let attempt = 1; ; ++attempt) {
            const confirmed = await this.publishConfirm(kind, { name, content_hash, tx_hash });
            if (confirmed.status === 'mined') return confirmed;
            if (attempt >= attempts) {
                throw new Error(`Publication ${tx_hash} is not mined yet; check it later with publishConfirm`);
            }
            await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalMs ?? 3000));
        }
    }

    /**
     * Confirm a publication transaction sent by the owner's wallet.
     *
     * Looks the receipt up once: `status: 'mined'` on success, repeat while it is `'pending'` (HTTP 202).
     * Requires bearer authentication.
     */
    async publishConfirm(kind: EntityKind, req: ConfirmRequest): Promise<ConfirmResponse | PublishError> {
        return this._api.publish.postPublishConfirm(kind, req);
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
        if (!resp.ok) throw new DecentralisedArtApiError(resp.status, await parseBody(resp));
        return resp;
    }

    /** Current bearer access token, if authenticated. */
    get accessToken() {
        return this._accessToken ?? undefined;
    }
}
