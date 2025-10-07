import { Wallet } from 'ethers';

export function loginMessage(nonce: string) {
  return `Login nonce: ${nonce}`;
}

// can also expose a helper for browser wallets via window.ethereum or EIP-1193 if needed
export async function signLoginNonceWithWallet(wallet: Wallet, nonce: string) {
  const message = loginMessage(nonce);
  const signature = await wallet.signMessage(message);
  return { message, signature };
}
