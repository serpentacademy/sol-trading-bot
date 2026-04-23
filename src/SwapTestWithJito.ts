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
const JITO_TIP_AMOUNT = 200_000; // 0.00030 SOL (The smallest reliable tip)
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
        await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${JITOSOL_MINT}&amount=${rawAmount}&slippageBps=120`)
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
        await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${JITOSOL_MINT}&outputMint=${USDC_MINT}&amount=${rawAmount}&slippageBps=120&swapMode=ExactOut`)
    ).json();

    console.log(`Quote received. Maximum JitoSOL In: ${quoteResponse.inAmount}`);

    // 2. Execute Swap
    await executeJupiterSwapWithJito(quoteResponse);
}

/**
 * Helper Function: Builds the Jupiter Swap, attaches a Jito Tip, and sends the Bundle.
 */
/**
 * Helper Function: Builds the Jupiter Swap, attaches a Jito Tip, and "Shotguns" the Bundle.
 */
/**
 * Helper Function: Builds the Jupiter Swap, attaches a Jito Tip, and "Shotguns" the Bundle.
 */
async function executeJupiterSwapWithJito(quoteResponse: any) {
    try {
        console.log("Requesting swap transaction from Jupiter...");
        
        // 1. Get serialized transaction from Jupiter
        const swapResponse = await fetch('https://api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse,
                userPublicKey: wallet.publicKey.toString(),
                wrapAndUnwrapSol: true,
                // CRITICAL FIX: Tell Jupiter NOT to add priority fees, because we are tipping Jito directly
                prioritizationFeeLamports: 3000, 
                dynamicComputeUnitLimit: true
            })
        });
        
        const { swapTransaction, error: jupError } = await swapResponse.json();
        
        if (jupError) {
            console.error("❌ Jupiter Swap Error:", jupError);
            return;
        }

        // 2. Deserialize the Jupiter Swap Transaction
        const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        
        const recentBlockhash = transaction.message.recentBlockhash;

        // 3. Create the Jito Tip Transaction
        const randomTipAccount = new PublicKey(
            JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
        );

        const tipInstruction = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: randomTipAccount,
            lamports: JITO_TIP_AMOUNT, // 300,000 lamports
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

        const txid = bs58.encode(transaction.signatures[0]);
        const serializedSwapTx = bs58.encode(transaction.serialize());
        const serializedTipTx = bs58.encode(tipTransaction.serialize());

        console.log("Firing Bundle at multiple Jito Block Engines...");

        // 5. The "Shotgun" Approach
        const jitoEndpoints = [
            'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
            'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
            'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles'
        ];

        const payload = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [ [serializedSwapTx, serializedTipTx] ]
        });

        // CRITICAL FIX: Actually read Jito's response to see WHY it is failing
        const requests = jitoEndpoints.map(async (endpoint) => {
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload
                });
                const data = await res.json();
                
                if (data.error) {
                    console.error(`⚠️ Jito Rejected Bundle (${endpoint.split('//')[1].split('.')[0]}):`, data.error.message || data.error);
                } else {
                    console.log(`✅ Bundle Accepted by ${endpoint.split('//')[1].split('.')[0]} - ID: ${data.result}`);
                }
            } catch (e: any) {
                console.error(`🌐 Network Error (${endpoint}):`, e.message);
            }
        });

        // Wait for all Jito requests to respond
        await Promise.all(requests);

        console.log(`\nTracking Swap Signature: ${txid}`);
        console.log(`Waiting for on-chain confirmation (this may take 10-15 seconds)...`);
        
        // 6. Confirm the transaction via our Helius RPC
        let confirmed = false;
        let attempts = 0;
        
        while (!confirmed && attempts < 15) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000)); 
            
            const status = await connection.getSignatureStatus(txid, { searchTransactionHistory: true });
            
            if (status && status.value && status.value.confirmationStatus) {
                if (status.value.err) {
                    console.error("❌ Transaction landed but failed on-chain:", status.value.err);
                    return;
                }
                confirmed = true;
                console.log(`🎉 Swap Successful via Jito! https://solscan.io/tx/${txid}`);
            }
        }

        if (!confirmed) {
            console.log("⚠️ Bundle dropped by Jito (Likely outbid or slippage exceeded). Check the warning messages above.");
        }

    } catch (error) {
        console.error("❌ Swap Execution Failed:", error);
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