import {
  Address,
  Base58EncodedBytes,
  Base64EncodedWireTransaction,
  RpcApiMethods,
  SolanaRpcResponse,
  createDefaultRpcTransport,
  createRpc,
  createRpcApi,
  createSolanaRpc,
  testnet,
} from "@solana/web3.js";

type BundleId = string & {
  readonly __brand: unique symbol;
};

interface JitoBundlesApi extends RpcApiMethods {
  getTipAccounts(): Readonly<Address[]>;
  sendBundle(transactions: Base58EncodedBytes[]): BundleId;
}

export function createJitoBundlesRpc(baseUrl: string) {
  const api = createRpcApi<JitoBundlesApi>();
  const transport = createDefaultRpcTransport({
    url: testnet(`${baseUrl}/api/v1/bundles`),
  });
  return createRpc({ api, transport });
}
