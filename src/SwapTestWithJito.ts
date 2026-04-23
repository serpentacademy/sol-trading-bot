import { Connection, Keypair, VersionedTransaction, PublicKey, SystemProgram, TransactionMessage } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';

// 1. Safely load variables from the environment
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PRIVATE_KEY_STRING = process.env.PRIVATE_KEY;

if (!HELIUS_API_KEY || !PRIVATE_KEY_STRING) {
    throw new Error("Missing HELIUS_API_KEY or PRIVATE_KEY in .env file!");
}

const HTTP_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(HTTP_URL, { commitment: 'confirmed' });
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_STRING));

console.log(`Wallet loaded securely: ${wallet.publicKey.toBase58()}`);

// Token Constants
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const USDC_DECIMALS = 6; 

// Jito Configuration
const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
const JITO_TIP_AMOUNT = 30_000; // 0.00001 SOL (The smallest reliable tip)
const JITO_TIP_ACCOUNTS = [
        "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
        "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
        "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
        "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
        "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
        "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
        "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
        "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
];

async function swapExactUsdcForJitoSol(usdcAmountIn: number) {
    console.log(`\nInitiating swap: EXACTLY ${usdcAmountIn} USDC -> JitoSOL`);
    const rawAmount = Math.floor(usdcAmountIn * (10 ** USDC_DECIMALS));

    const quoteResponse = await (
        await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${JITOSOL_MINT}&amount=${rawAmount}&slippageBps=50`)
    ).json();

    console.log(`Quote received. Expected JitoSOL Out: ${quoteResponse.outAmount}`);
    await executeJupiterSwapWithJito(quoteResponse);
}

async function swapJitoSolForExactUsdc(usdcAmountOut: number) {
   console.log(`\nInitiating swap: JitoSOL -> EXACTLY ${usdcAmountOut} USDC`);
    
    // Because swapMode is ExactOut, the amount parameter refers to the OUTPUT token (USDC)
    const rawAmount = Math.floor(usdcAmountOut * (10 ** USDC_DECIMALS));

    // 1. Get Quote from Jupiter (Notice the swapMode=ExactOut parameter)
    const quoteResponse = await (
        await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${JITOSOL_MINT}&outputMint=${USDC_MINT}&amount=${rawAmount}&slippageBps=50&swapMode=ExactOut`)
    ).json();

    console.log(`Quote received. Maximum JitoSOL In: ${quoteResponse.inAmount}`);

    // 2. Execute Swap
    await executeJupiterSwapWithJito(quoteResponse);
}

/**
 * Helper Function: Builds the Jupiter Swap, attaches a Jito Tip, and sends the Bundle.
 */
async function executeJupiterSwapWithJito(quoteResponse: any) {
    try {
        // 1. Get serialized transaction from Jupiter
        const { swapTransaction } = await (
            await fetch('https://api.jup.ag/swap/v1/swap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quoteResponse,
                    userPublicKey: wallet.publicKey.toString(),
                    wrapAndUnwrapSol: true,
                })
            })
        ).json();

        // 2. Deserialize the Jupiter Swap Transaction
        const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        
        // Extract the recent blockhash Jupiter used so our tip tx matches it exactly
        const recentBlockhash = transaction.message.recentBlockhash;

        // 3. Create the Jito Tip Transaction
        // Pick a random Jito tip account for load balancing
        const randomTipAccount = new PublicKey(
            JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
        );

        const tipInstruction = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: randomTipAccount,
            lamports: JITO_TIP_AMOUNT,
        });

        const tipMessage = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: recentBlockhash,
            instructions: [tipInstruction],
        }).compileToV0Message();

        const tipTransaction = new VersionedTransaction(tipMessage);

        // 4. Sign BOTH transactions
        transaction.sign([wallet]);
        tipTransaction.sign([wallet]);

        // Get the signature of the swap transaction to track it on Solscan
        const txid = bs58.encode(transaction.signatures[0]);

        // 5. Serialize both to base58 strings for the Jito Bundle
        const serializedSwapTx = bs58.encode(transaction.serialize());
        const serializedTipTx = bs58.encode(tipTransaction.serialize());

        console.log("Sending Bundle to Jito Block Engine...");

        // 6. Send the payload to Jito
        const jitoResponse = await fetch(JITO_BLOCK_ENGINE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "sendBundle",
                params: [
                    [serializedSwapTx, serializedTipTx]
                ]
            })
        });

        const jitoResult = await jitoResponse.json();
        
        if (jitoResult.error) {
            throw new Error(`Jito Error: ${JSON.stringify(jitoResult.error)}`);
        }

        console.log(`Bundle sent! Jito Bundle ID: ${jitoResult.result}`);
        console.log(`Confirming Swap Transaction on chain...`);
        
        // 7. Confirm the transaction via our Helius RPC
        await connection.confirmTransaction({
            blockhash: recentBlockhash,
            // We get the lastValidBlockHeight from the RPC just to ensure our confirmation loop doesn't hang
            lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
            signature: txid
        });

        console.log(`✅ Swap Successful via Jito! https://solscan.io/tx/${txid}`);

    } catch (error) {
        console.error("❌ Swap Failed:", error);
    }
}

// ==========================================
// Execution Block
// ==========================================
async function main() {
    // Swap 1 USDC in to get JitoSOL using Jito Block Engine
    await swapExactUsdcForJitoSol(1);
    //await swapJitoSolForExactUsdc(1);
}

main();