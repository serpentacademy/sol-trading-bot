import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { 
    buildWhirlpoolClient, 
    WhirlpoolContext, 
    ORCA_WHIRLPOOL_PROGRAM_ID, 
    PriceMath, 
    IGNORE_CACHE,
    buildDefaultAccountFetcher // <--- Add this new import!
} from '@orca-so/whirlpools-sdk';
import { Wallet } from '@coral-xyz/anchor';
import Decimal from 'decimal.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

// ==========================================
// CONFIGURATION & SETUP
// ==========================================
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PRIVATE_KEY_STRING = process.env.PRIVATE_KEY;

if (!HELIUS_API_KEY || !PRIVATE_KEY_STRING) {
    throw new Error("Missing HELIUS_API_KEY or PRIVATE_KEY in .env file!");
}

const HTTP_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const WSS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(HTTP_URL, { wsEndpoint: WSS_URL, commitment: 'confirmed' });
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_STRING));

// Token & AMM Constants
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const USDC_JITOSOL_WHIRLPOOL = new PublicKey('5hWJUNTtEtKmKgDXpthJXXRRmJrz5vJ7uJzrUNVdrwLg');
const USDC_DECIMALS = 6; 

// Bot State & Locks
const BOT_JSON_PATH = path.join(process.cwd(), 'Bot.json');
const TRADES_DIR = path.join(process.cwd(), 'trades');
const TRADE_SIZE_USDC = 3; // The exact USDC value to trade at each grid level
let isTrading = false; // Mutex lock to prevent multiple trades from firing at the exact same millisecond

// ==========================================
// FILE I/O HELPERS
// ==========================================
function loadBotState() {
    return JSON.parse(fs.readFileSync(BOT_JSON_PATH, 'utf-8'));
}

function saveBotState(state: any) {
    fs.writeFileSync(BOT_JSON_PATH, JSON.stringify(state, null, 2));
}

function saveTradeReceipt(txid: string, type: string, price: number) {
    if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR);
    
    const now = new Date();
    // Format: DD-MM-YYYY-HH-MM-SS
    const filename = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.json`;
    
    const receipt = { timestamp: now.toISOString(), txid, type, price_usdc: price, size_usdc: TRADE_SIZE_USDC };
    fs.writeFileSync(path.join(TRADES_DIR, filename), JSON.stringify(receipt, null, 2));
    console.log(`📁 Trade receipt saved: trades/${filename}`);
}

// ==========================================
// JUPITER EXECUTION (STANDARD WITH PRIORITY FEES)
// ==========================================
async function executeGridTrade(tradeType: 'buy' | 'sell', currentPrice: number) {
    console.log(`\n🚨 GRID TRIGGERED! Executing ${tradeType.toUpperCase()} at $${currentPrice.toFixed(2)}`);
    const rawAmount = Math.floor(TRADE_SIZE_USDC * (10 ** USDC_DECIMALS));

    try {
        // 1. Get Quote
        let quoteUrl = tradeType === 'buy' 
            ? `https://api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${JITOSOL_MINT}&amount=${rawAmount}&slippageBps=50`
            : `https://api.jup.ag/swap/v1/quote?inputMint=${JITOSOL_MINT}&outputMint=${USDC_MINT}&amount=${rawAmount}&slippageBps=50&swapMode=ExactOut`;

        const quoteResponse = await (await fetch(quoteUrl)).json();

        // 2. Request Transaction
        const { swapTransaction } = await (await fetch('https://api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                quoteResponse, 
                userPublicKey: wallet.publicKey.toString(), 
                wrapAndUnwrapSol: true,
                dynamicComputeUnitLimit: true,
                prioritizationFeeLamports: 12000 // Slightly higher for reliability
            })
        })).json();

        const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        transaction.sign([wallet]);

        // 3. Send Transaction
        const txid = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 2
        });
        console.log(`📡 Transaction Sent: ${txid}. Waiting for confirmation...`);

        // 4. Custom Polling Logic (The Fix)
        const confirmed = await pollForSignature(txid);

        if (confirmed) {
            console.log(`✅ Swap Successful! https://solscan.io/tx/${txid}`);
            let state = loadBotState();
            state.last_trade_type = tradeType;
            state.last_trade_price = currentPrice;
            saveBotState(state);
            saveTradeReceipt(txid, tradeType, currentPrice);
        } else {
            console.error("❌ Transaction failed to confirm within 60 seconds.");
        }

    } catch (error) {
        console.error("❌ Trade Execution Failed:", error);
    } finally {
        isTrading = false; 
    }
}

/**
 * Manually polls the RPC for 60 seconds to check if a signature has landed.
 */
async function pollForSignature(signature: string): Promise<boolean> {
    const start = Date.now();
    const timeout = 60000; // 1 minute
    const interval = 3000; // Poll every 3 seconds

    while (Date.now() - start < timeout) {
        const { value: status } = await connection.getSignatureStatus(signature);
        
        if (status) {
            if (status.err) {
                console.error("⚠️ Transaction landed but failed with error:", status.err);
                return false;
            }
            if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
                return true;
            }
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    return false;
}

// ==========================================
// ORCA LIVE PRICE MONITOR & GRID LOGIC
// ==========================================
async function startGridBot() {
    console.log(`🤖 Starting Grid Bot. Monitoring JitoSOL/USDC...`);
    console.log(`Wallet loaded: ${wallet.publicKey.toBase58()}`);
    console.log(`Grid configuration loaded from Bot.json.`);
    
  

       // 1. Setup the dummy wallet
       const dummyWallet = new Wallet(Keypair.generate());
       
       // 2. Initialize the context 
       const ctx = WhirlpoolContext.from(
           connection,
           dummyWallet, 
            // Added this back!
       );
       const client = buildWhirlpoolClient(ctx);
   

    connection.onAccountChange(USDC_JITOSOL_WHIRLPOOL, async (accountInfo, context) => {
        if (isTrading) return; // Skip checking if a trade is actively routing
            console.log(`\n[Slot ${context.slot}] Trade detected!`);

        try {
            // Force bypass the cache to get the live data
            const pool = await client.getPool(USDC_JITOSOL_WHIRLPOOL, IGNORE_CACHE);
            const poolData = pool.getData();
            
            // Calculate the USD value of JitoSOL
            const priceOfUsdcInJitoSol = PriceMath.sqrtPriceX64ToPrice(poolData.sqrtPrice, 6, 9);
            const currentPrice = new Decimal(1).div(priceOfUsdcInJitoSol).toNumber();
            console.log("currentPrice: "+currentPrice)
            let state = loadBotState();

            // Ignore prices outside our min/max bounds
            if (currentPrice < state.min_price || currentPrice > state.max_price) return;

            const priceDifference = currentPrice - state.last_trade_price;
            console.log(priceDifference+" -> priceDifference")
            // SELL Logic: Price went UP by the grid size
            if (priceDifference >= state.grid_size) {
                isTrading = true;
                console.log("sell");
                await executeGridTrade('sell', currentPrice);
            } 
            // BUY Logic: Price went DOWN by the grid size
            else if (priceDifference <= -state.grid_size) {
                isTrading = true;
                console.log("buy");

                await executeGridTrade('buy', currentPrice);
            }

        } catch (error) {
            console.error("Error evaluating grid conditions:", error);
            isTrading = false; // Ensure lock releases if the price fetch fails
        }
    }, 'confirmed');
}

// Start the engine!
startGridBot().catch(console.error);