import { OpenAPI } from './generated/core/OpenAPI';
import { FetchHttpRequest } from './generated/core/FetchHttpRequest'; // <-- add this

import {
    VersionApi,
    AuthApi,
    AccountApi,
    FeatureApi,
    TransformationApi,
    ExecuteApi,
} from './generated/index';

import type {
    AuthRequest,
    AuthResponse,
    RefreshResponse,
    FeatureCreateRequest,
    TransformationCreateRequest,
    ExecuteItem,
    FeatureGetResponse,
    TransformationGetResponse,
    AccountResponse,
    VersionResponse,
} from './generated/index';

export interface DcnClientOptions {
    baseUrl?: string;
    accessToken?: string | null;
    refreshToken?: string | null;
}

const DEFAULT_BASE = 'https://api.decentralised.art';

function encodeRunningInstances(pairs: Array<[number, number]>): string {
    return `[${pairs.map(([a, b]) => `(${a};${b})`).join(',')}]`;
}

export class DcnClient {
    private _accessToken?: string | null;
    private _refreshToken?: string | null;
    private _http: FetchHttpRequest; // <-- hold the http request instance

    constructor(opts: DcnClientOptions = {}) {
        const base = (opts.baseUrl ?? process.env.DCN_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, '');
        this._accessToken = opts.accessToken ?? null;
        this._refreshToken = opts.refreshToken ?? null;

        // Configure OpenAPI (this is the *config*)
        OpenAPI.BASE = base;
        OpenAPI.WITH_CREDENTIALS = false;
        OpenAPI.TOKEN = async () => this._accessToken ?? '';

        OpenAPI.ENCODE_PATH = (path: string) => {
            // Keep [ ] ( ) ; , and / literally; encode everything else that isn't
            // an unreserved character per RFC3986.
            return path.replace(
                /[^A-Za-z0-9\-._~\/\[\]\(\);,]/g,
                (ch) => encodeURIComponent(ch)
            );
        };

        // Create the concrete HTTP *client* (this satisfies BaseHttpRequest)
        this._http = new FetchHttpRequest(OpenAPI);
    }

    // -------------------- Version --------------------
    async version(): Promise<VersionResponse> {
        return await new VersionApi(this._http).getVersion();
    }

    // -------------------- Auth --------------------
    async getNonce(address: `0x${string}`) {
        return await new AuthApi(this._http).getNonce(address);
    }

    async loginWithSignature(address: `0x${string}`, message: string, signature: string): Promise<AuthResponse> {
        const body: AuthRequest = { address, message, signature };
        const resp = await new AuthApi(this._http).postAuth(body);
        this._accessToken = resp.access_token;
        this._refreshToken = resp.refresh_token;
        return resp;
    }

    async loginWithWallet(wallet: any): Promise<AuthResponse> {
        const address = wallet.address as `0x${string}`;
        const { nonce } = await this.getNonce(address);
        const message = `Login nonce: ${nonce}`;
        const signature = await wallet.signMessage(message);
        return this.loginWithSignature(address, message, signature);
    }

    async refresh(): Promise<RefreshResponse> {
        if (!this._refreshToken) throw new Error('Missing refresh token');

        const api = new AuthApi(this._http);

        // First argument: header value (string)
        // Second argument: optional body (can be `{}` or undefined)
        const resp = await api.postRefresh(this._refreshToken, {});

        this._accessToken = resp.access_token;
        if (resp.refresh_token) this._refreshToken = resp.refresh_token;
        return resp;
    }

    // -------------------- Account --------------------
    async accountInfo(address: `0x${string}`, limit = 50, page = 0): Promise<AccountResponse> {
        return await new AccountApi(this._http).getAccountInfo(address, limit, page);
    }

    // -------------------- Feature --------------------
    async featureGet(name: string, version?: string): Promise<FeatureGetResponse> {
        const api = new FeatureApi(this._http);
        return version ? api.getFeatureByNameVersion(name, version) : api.getFeatureByName(name);
    }

    async featurePost(req: FeatureCreateRequest) {
        return await new FeatureApi(this._http).postFeature(req);
    }

    // -------------------- Transformation --------------------
    async transformationGet(name: string, version?: string): Promise<TransformationGetResponse> {
        const api = new TransformationApi(this._http);
        return version ? api.getTransformationByNameVersion(name, version) : api.getTransformationByName(name);
    }

    async transformationPost(req: TransformationCreateRequest) {
        return await new TransformationApi(this._http).postTransformation(req);
    }

    // -------------------- Execute --------------------
    async execute(
        featureName: string,
        numSamples: number,
        runningInstances?: Array<[number, number]>
    ): Promise<ExecuteItem[]> {
        const api = new ExecuteApi(this._http);
        if (!runningInstances?.length) {
            return await api.getExecuteNoRunningInstances(featureName, numSamples);
        } else {
            const encoded = encodeRunningInstances(runningInstances);
            return await api.getExecuteWithRunningInstances(featureName, numSamples, encoded);
        }
    }

    get accessToken() { return this._accessToken ?? undefined; }
    get refreshToken() { return this._refreshToken ?? undefined; }
}
