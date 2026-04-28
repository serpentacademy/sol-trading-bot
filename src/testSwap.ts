import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';

// ==========================================
// CONFIGURATION
// ==========================================
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
    throw new Error("Missing PRIVATE_KEY in .env file!");
}

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

// Token Mints
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NVDAX_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'; 

const USDC_DECIMALS = 6;
const TEST_AMOUNT_USDC = 1; // 1 USDC

// ==========================================
// CORE SWAP EXECUTION ENGINE
// ==========================================
async function executeJupiterSwap(quoteUrl: string, tradeDescription: string) {
    console.log(`\n🔄 Starting Trade: ${tradeDescription}`);
    console.log(`📡 Fetching quote...`);

    try {
        // 1. Get Quote
        const quoteResponse = await (await fetch(quoteUrl)).json();
        
        if (quoteResponse.error) {
            console.error(`❌ Jupiter Quote Failed:`, quoteResponse.error);
            return;
        }
        
        console.log(`✅ Quote received! Expected Out: ${quoteResponse.outAmount}`);

        // 2. Get Swap Transaction
        console.log(`🛠️ Building transaction...`);
        const { swapTransaction, error: swapError } = await (await fetch('https://api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse,
                userPublicKey: wallet.publicKey.toString(),
                wrapAndUnwrapSol: true,
                dynamicComputeUnitLimit: true, // Automatically set ideal compute units
                prioritizationFeeLamports: 20000 // Priority fee to ensure it lands
            })
        })).json();

        if (swapError || !swapTransaction) {
            console.error(`❌ Swap Build Failed:`, swapError || "No transaction returned");
            return;
        }

        // 3. Deserialize and Sign
        const transactionBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuf);
        transaction.sign([wallet]);

        // 4. Send Transaction
        console.log(`🚀 Sending to network...`);
        const txid = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 2
        });
        
        console.log(`⏳ Waiting for confirmation (TxID: ${txid})...`);

        // 5. Confirm Transaction
        const confirmed = await pollForSignature(txid);
        if (confirmed) {
            console.log(`🎉 SUCCESS! View on Solscan: https://solscan.io/tx/${txid}`);
        } else {
            console.log(`⚠️ Transaction sent, but took too long to confirm. Check Solscan: https://solscan.io/tx/${txid}`);
        }

    } catch (error) {
        console.error(`🚨 Fatal Error during execution:`, error);
    }
}

// Simple polling function to check if the transaction landed
async function pollForSignature(signature: string): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < 45000) { // 45 second timeout
        const { value: status } = await connection.getSignatureStatus(signature);
        if (status) {
            if (status.err) {
                console.error("❌ Transaction failed on-chain:", status.err);
                return false;
            }
            if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
                return true;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
    }
    return false;
}

// ==========================================
// TEST SCENARIOS
// ==========================================

async function buyNvdaxWithOneUsdc() {
    const rawAmountUsdc = TEST_AMOUNT_USDC * (10 ** USDC_DECIMALS);
    // slippageBps = 100 is 1.0%
    const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${NVDAX_MINT}&amount=${rawAmountUsdc}&slippageBps=100`;
    
    await executeJupiterSwap(quoteUrl, "BUY NVDAx with 1 USDC");
}

async function sellNvdaxForOneUsdc() {
    const rawAmountUsdc = TEST_AMOUNT_USDC * (10 ** USDC_DECIMALS);
    // swapMode=ExactOut means "I want exactly 'amount' of outputMint, figure out the inputMint cost"
    const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${NVDAX_MINT}&outputMint=${USDC_MINT}&amount=${rawAmountUsdc}&slippageBps=100&swapMode=ExactOut`;
    
    await executeJupiterSwap(quoteUrl, "SELL NVDAx for exactly 1 USDC out");
}

// ==========================================
// RUNNER
// ==========================================
async function main() {
    console.log(`🤖 Starting Jupiter Swap Tests...`);
    console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
    
    // --- Test 1: Buy ---
    await buyNvdaxWithOneUsdc();

    console.log(`\n⏸️ Waiting 10 seconds before executing the reverse swap to let the RPC sync...`);
    await new Promise(r => setTimeout(r, 10000));

    // --- Test 2: Sell ---
    // NOTE: If ExactOut fails for this pool due to liquidity routing, 
    // it will safely catch the "No routes found" error and print it.
   //await sellNvdaxForOneUsdc();
}

main();