import { RpcApiMethods, createRpcApi } from "@solana/web3.js";

// Define the method's response payload.
type NftCollectionDetailsApiResponse = Readonly<{
  address: string;
}>;

// Set up an interface for the request method.
interface NftCollectionDetailsApi extends RpcApiMethods {
  // Define the method's name, parameters and response type
  qn_fetchNFTCollectionDetails(args: {
    contracts: string[];
  }): NftCollectionDetailsApiResponse;
}

// Export the type spec for downstream users.
export type QuickNodeRpcApi = NftCollectionDetailsApi;

// Create the custom API.
const api = createRpcApi<QuickNodeRpcApi>();
