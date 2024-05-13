import {
  Address,
  Base58EncodedBytes,
  KeyPairSigner,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  Signature,
  SignatureBytes,
  TransactionPartialSigner,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getAddressFromPublicKey,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getTransactionEncoder,
  isSolanaError,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/web3.js";
import { getTransferSolInstruction } from "@solana-program/system";
import { getAddMemoInstruction } from "@solana-program/memo";
import { createJitoBundlesRpc } from "./jito-rpc";
import dotenv from "dotenv";
import {
  createBlockHeightExceedencePromiseFactory,
  createRecentSignatureConfirmationPromiseFactory,
} from "@solana/transaction-confirmation";

dotenv.config();

// from https://jito-labs.gitbook.io/mev/searcher-resources/bundles#why-are-my-bundles-not-landing
const MINIMUM_JITO_TIP = 1000;

const NUMBER_TRANSACTIONS = 3;

const solanaRpc = createSolanaRpc("https://api.testnet.solana.com");
const solanaRpcSubscriptions = createSolanaRpcSubscriptions(
  "wss://api.testnet.solana.com"
);

const recentSignatureConfirmationPromiseFactory =
  createRecentSignatureConfirmationPromiseFactory({
    rpc: solanaRpc,
    rpcSubscriptions: solanaRpcSubscriptions,
  });

const blockHeightExceedencePromiseFactory =
  createBlockHeightExceedencePromiseFactory({
    rpc: solanaRpc,
    rpcSubscriptions: solanaRpcSubscriptions,
  });

const jitoBundlesRpc = createJitoBundlesRpc(
  "https://dallas.testnet.block-engine.jito.wtf"
);

// from https://stackoverflow.com/a/4550514/1375972
function randomElement<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

async function getPayerSigner(): Promise<KeyPairSigner> {
  const solanaPrivateKey = process.env.PAYER_KEYPAIR_BASE58;
  if (!solanaPrivateKey) {
    throw new Error("PAYER_KEYPAIR_BASE58 environment variable is missing");
  }
  const privateKeyBytes = getBase58Encoder().encode(solanaPrivateKey);
  return await createKeyPairSignerFromBytes(privateKeyBytes as Uint8Array);
}

async function createTransaction(
  index: number,
  latestBlockhash: Parameters<
    typeof setTransactionMessageLifetimeUsingBlockhash
  >[0],
  payerSigner: TransactionPartialSigner,
  tip?: Address
) {
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payerSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) =>
      appendTransactionMessageInstruction(
        getAddMemoInstruction({
          memo: `this is transaction ${index}`,
        }),
        tx
      ),
    (tx) =>
      tip
        ? appendTransactionMessageInstruction(
            getTransferSolInstruction({
              source: payerSigner,
              destination: tip,
              amount: MINIMUM_JITO_TIP,
            }),
            tx
          )
        : tx
  );
  return await signTransactionMessageWithSigners(transactionMessage);
}

function awaitTransactionInBackground(
  transactionSignature: Signature,
  lastValidBlockHeight: bigint
) {
  const abortSignal = new AbortController().signal;

  const recentSignatureConfirmationPromise =
    recentSignatureConfirmationPromiseFactory({
      abortSignal,
      commitment: "confirmed",
      signature: transactionSignature,
    });

  const blockHeightExceedencePromise = blockHeightExceedencePromiseFactory({
    abortSignal,
    commitment: "confirmed",
    lastValidBlockHeight,
  });

  Promise.race([
    recentSignatureConfirmationPromise,
    blockHeightExceedencePromise,
  ])
    .then(() => {
      console.log(
        `Transactions are confirmed! First signature was ${transactionSignature}`
      );
    })
    .catch((err) => {
      if (isSolanaError(err, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED)) {
        console.error("Transactions did not land before they expired");
      } else {
        console.error(err);
      }
    });
}

async function main() {
  const signer = await getPayerSigner();
  const payerAddress = await getAddressFromPublicKey(signer.keyPair.publicKey);
  console.log(`Sending transactions as ${payerAddress}`);

  const jitoTipAddresses = await jitoBundlesRpc.getTipAccounts().send();
  const jitoTipAddress = randomElement(jitoTipAddresses);

  const { value: latestBlockhash } = await solanaRpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const signedTransactions = await Promise.all(
    Array.from({ length: NUMBER_TRANSACTIONS }, (_, i) => {
      const isLastTransaction = i === NUMBER_TRANSACTIONS - 1;
      return createTransaction(
        i,
        latestBlockhash,
        signer,
        isLastTransaction ? jitoTipAddress : undefined
      );
    })
  );

  const transactionEncoder = getTransactionEncoder();
  const base58Decoder = getBase58Decoder();

  const transactionSignatures = signedTransactions.map((transaction) => {
    const signatureBytes = transaction.signatures[
      payerAddress
    ] as SignatureBytes;
    return base58Decoder.decode(signatureBytes) as Signature;
  });

  // TODO: simulate the bundle first - need a Jito enabled RPC

  // Wait for a transaction signature to confirm, use this because Jito doesn't have a subscription for bundle status
  console.log(`Confirming first transaction: ${transactionSignatures[0]}`);
  awaitTransactionInBackground(
    transactionSignatures[0],
    latestBlockhash.lastValidBlockHeight
  );

  // Send the bundle
  const base58EncodedTransactions = signedTransactions.map((transaction) => {
    const transactionBytes = transactionEncoder.encode(transaction);
    return base58Decoder.decode(transactionBytes) as Base58EncodedBytes;
  });

  console.log(
    `Sending ${base58EncodedTransactions.length} transactions as a bundle...`
  );
  const bundleId = await jitoBundlesRpc
    .sendBundle(base58EncodedTransactions)
    .send();
  console.log(`Sent! Bundle ID: ${bundleId}`);
}

main().catch((err) => console.error(err));
