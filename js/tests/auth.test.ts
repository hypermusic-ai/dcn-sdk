import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DcnClient } from '../src/client';
import { ADDR } from './fixtures';

describe('DCN JS auth facade', () => {
  let sdk: DcnClient;

  beforeEach(() => {
    sdk = new DcnClient({ baseUrl: 'https://example.invalid/chain' });
  });

  it('authenticates with nonce and attaches bearer token afterwards', async () => {
    const { nonce } = await sdk.getNonce(ADDR);
    const auth = await sdk.loginWithSignature(ADDR, `Login nonce: ${nonce}`, '0xSIG');
    expect(auth.access_token).toBe('access-123');
    expect(sdk.accessToken).toBe('access-123');

    await sdk.execute('pitch', 8);
    const last = globalThis.__lastRequests.at(-1)!;
    const authorization = new Headers(last.init?.headers as HeadersInit).get('Authorization');
    expect(authorization).toBe('Bearer access-123');
  });

  it('authenticates wallets with getAddress and the nonce message', async () => {
    const wallet = {
      getAddress: vi.fn(async () => ADDR),
      signMessage: vi.fn(async (message: string) => {
        expect(message).toBe('Login nonce: abcd-efgh');
        return '0xSIG';
      }),
    };

    const auth = await sdk.loginWithWallet(wallet);
    expect(auth.access_token).toBe('access-123');
    expect(wallet.getAddress).toHaveBeenCalledOnce();
    expect(wallet.signMessage).toHaveBeenCalledWith('Login nonce: abcd-efgh');

    const last = globalThis.__lastRequests.at(-1)!;
    expect(JSON.parse(last.init?.body as string)).toEqual({
      address: ADDR,
      message: 'Login nonce: abcd-efgh',
      signature: '0xSIG',
    });
  });

  it('rejects wallet login when no address is available', async () => {
    await expect(sdk.loginWithWallet({ signMessage: vi.fn() })).rejects.toThrow(
      'Wallet address is unavailable'
    );
  });
});
