import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config'; // <--- This magic line loads the .env file

// 1. Safely load variables from the environment
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PRIVATE_KEY_STRING = process.env.PRIVATE_KEY;

// 2. Fail fast if the keys are missing
if (!HELIUS_API_KEY || !PRIVATE_KEY_STRING) {
    throw new Error("Missing HELIUS_API_KEY or PRIVATE_KEY in .env file!");
}

// 3. Setup Connection & Wallet
const HTTP_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(HTTP_URL, { commitment: 'confirmed' });

// Decode the secure private key and generate the wallet object
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_STRING));

console.log(`Wallet loaded securely: ${wallet.publicKey.toBase58()}`);

// ... rest of your swap logic below

// Token Mint Addresses
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';

// Decimals (crucial for accurate math)
const USDC_DECIMALS = 6; 

/**
 * FUNCTION 1: Swap EXACTLY 3 USDC for JitoSOL
 * Swap Mode: ExactIn (Default)
 */
async function swapExactUsdcForJitoSol(usdcAmountIn: number) {
    console.log(`\nInitiating swap: EXACTLY ${usdcAmountIn} USDC -> JitoSOL`);
    
    // Convert human readable USDC to raw integer (e.g., 3 * 10^6 = 3000000)
    const rawAmount = Math.floor(usdcAmountIn * (10 ** USDC_DECIMALS));

    // 1. Get Quote from Jupiter
    const quoteResponse = await (
        await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${JITOSOL_MINT}&amount=${rawAmount}&slippageBps=50`)
    ).json();

    console.log(`Quote received. Expected JitoSOL Out: ${quoteResponse.outAmount}`);

    // 2. Execute Swap
    await executeJupiterSwap(quoteResponse);
}

/**
 * FUNCTION 2: Swap JitoSOL for EXACTLY 3 USDC
 * Swap Mode: ExactOut
 */
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
    await executeJupiterSwap(quoteResponse);
}

/**
 * Helper Function: Takes a Jupiter quote, builds the transaction, signs, and sends it.
 */
async function executeJupiterSwap(quoteResponse: any) {
    try {
  // 1. Get serialized transaction from Jupiter
        const { swapTransaction } = await (
            await fetch('https://api.jup.ag/swap/v1/swap', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    // 'x-api-key': process.env.JUPITER_API_KEY // See note below
                },
                body: JSON.stringify({
                    quoteResponse,
                    userPublicKey: wallet.publicKey.toString(),
                    wrapAndUnwrapSol: true,
                })
            })
        ).json();

        // 2. Deserialize the base64 transaction string into a VersionedTransaction
        const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

        // 3. Sign the transaction
        transaction.sign([wallet]);

        // 4. Send to Helius RPC
        console.log("Sending transaction...");
        const txid = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true, // Speeds up execution but disables pre-execution error checking
            maxRetries: 2
        });

        console.log(`Transaction sent! Confirming...`);
        
        // 5. Confirm the transaction
        const latestBlockHash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: txid
        });

        console.log(`✅ Swap Successful! https://solscan.io/tx/${txid}`);

    } catch (error) {
        console.error("❌ Swap Failed:", error);
    }
}

// ==========================================
// Execution Block
// ==========================================
async function main() {
    // Make sure to only uncomment one of these at a time for testing!
    
    // Swap 1 USDC in to get JitoSOL
     await swapExactUsdcForJitoSol(1);

    // Swap JitoSOL out to get exactly 1 USDC
     //await swapJitoSolForExactUsdc(1);
}

main();