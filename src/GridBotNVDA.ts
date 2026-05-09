import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import * as borsh from '@coral-xyz/borsh';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';
import * as dns from 'dns';
dns.setDefaultResultOrder('ipv4first'); // Forces Node to use the working IPv4 route
// ==========================================
// CONFIGURATION & SETUP
// ==========================================
Decimal.set({ precision: 100 }); // Critical for CLMM 128-bit math

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PRIVATE_KEY_STRING = process.env.PRIVATE_KEY;

if (!HELIUS_API_KEY || !PRIVATE_KEY_STRING) {
    throw new Error("Missing HELIUS_API_KEY or PRIVATE_KEY in .env file!");
}

const HTTP_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const WSS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(HTTP_URL, { wsEndpoint: WSS_URL, commitment: 'confirmed' });
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_STRING));

// --- UPDATE THESE FOR NVDAx ---
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NVDAX_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'; // Replace with actual NVDAx mint
const POOL_ADDRESS = new PublicKey('4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN'); // Replace with actual Raydium Pool Address
const USDC_DECIMALS = 6;
const NVDAX_DECIMALS = 8; // Raydium layout showed mint0 has 8 decimals

// Bot State & Locks
const BOT_JSON_PATH = path.join(process.cwd(), 'BotNVDAx.json');
const TRADES_DIR = path.join(process.cwd(), 'nvdatrades');
const TRADE_SIZE_USDC = 3; // Adjust your trade size here
let isTrading = false; // Memory Mutex

// ==========================================
// RAYDIUM CLMM DECODING LAYOUTS
// ==========================================
const RewardInfo = borsh.struct([
    borsh.u8("rewardState"),
    borsh.u64("openTime"),
    borsh.u64("endTime"),
    borsh.u64("lastUpdateTime"),
    borsh.u128("emissionsPerSecondX64"),
    borsh.u64("rewardTotalEmissioned"),
    borsh.u64("rewardClaimed"),
    borsh.publicKey("tokenMint"),
    borsh.publicKey("tokenVault"),
    borsh.publicKey("creator"),
    borsh.u128("rewardGrowthGlobalX64"),
]);

const poolLayout = borsh.struct([
    borsh.array(borsh.u8(), 8, 'discriminator'),
    borsh.array(borsh.u8(), 1, 'bump'),
    borsh.publicKey('ammConfig'),
    borsh.publicKey('owner'),
    borsh.publicKey('mintA'),
    borsh.publicKey('mintB'),
    borsh.publicKey('tokenMint0'),
    borsh.publicKey('tokenVault1'),
    borsh.publicKey('observationKey'),
    borsh.u8('mintDecimals0'),
    borsh.u8('mintDecimals1'),
    borsh.u16('tickSpacing'),
    borsh.u128('liquidity'),
    borsh.u128('sqrtPriceX64'), 
    borsh.i32('tickCurrent'),
    borsh.u32(),
    borsh.u128("feeGrowthGlobalX64A"),
    borsh.u128("feeGrowthGlobalX64B"),
    borsh.u64("protocolFeesTokenA"),
    borsh.u64("protocolFeesTokenB"),
    borsh.u128("swapInAmountTokenA"),
    borsh.u128("swapOutAmountTokenB"),
    borsh.u128("swapInAmountTokenB"),
    borsh.u128("swapOutAmountTokenA"),
    borsh.u8("status"),
    borsh.array(borsh.u8(), 7, ""),
    borsh.array(RewardInfo, 3, "rewardInfos"),
    borsh.array(borsh.u64(), 16, "tickArrayBitmap"),
    borsh.u64("totalFeesTokenA"),
    borsh.u64("totalFeesClaimedTokenA"),
    borsh.u64("totalFeesTokenB"),
    borsh.u64("totalFeesClaimedTokenB"),
    borsh.u64("fundFeesTokenA"),
    borsh.u64("fundFeesTokenB"),
    borsh.u64("startTime"),
    borsh.array(borsh.u64(), 15 * 4 - 3, "padding"),
]);

/** Calculates the price of Token0 in terms of Token1. */
function calculatePrice(sqrtPriceX64: BN, dec0: number, dec1: number): number {
    const sqrtPrice = new Decimal(sqrtPriceX64.toString());
    const Q64 = new Decimal(2).pow(64);
    const rawPrice = sqrtPrice.div(Q64).pow(2);
    const decimalAdjustment = new Decimal(10).pow(dec0 - dec1);
    const price = rawPrice.mul(decimalAdjustment);
    return price.toNumber();
}

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
    const filename = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.json`;
    
    const receipt = { timestamp: now.toISOString(), txid, type, price_usdc: price, size_usdc: TRADE_SIZE_USDC };
    fs.writeFileSync(path.join(TRADES_DIR, filename), JSON.stringify(receipt, null, 2));
    console.log(`📁 Trade receipt saved: trades/${filename}`);
}

// ==========================================
// JUPITER EXECUTION (GRID)
// ==========================================

async function executeGridTrade(tradeType: 'buy' | 'sell', currentPrice: number) {
    console.log(`\n🚨 GRID TRIGGERED! Executing ${tradeType.toUpperCase()} at $${currentPrice.toFixed(4)}`);
    
    let quoteUrl = '';

    if (tradeType === 'buy') {
        // BUY: Spend exactly 3 USDC to get NVDAx
        const rawAmountUsdc = Math.floor(TRADE_SIZE_USDC * (10 ** USDC_DECIMALS));
        quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${NVDAX_MINT}&amount=${rawAmountUsdc}&slippageBps=100`;
    } else {
        // SELL: Calculate how much NVDAx is equal to $3 at the current price, and sell that amount.
        const nvdaxAmountToSell = TRADE_SIZE_USDC / currentPrice;
        const rawAmountNvdax = Math.floor(nvdaxAmountToSell * (10 ** NVDAX_DECIMALS));
        console.log(`Calculated Sell Amount: ${nvdaxAmountToSell.toFixed(6)} NVDAx`);
        quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${NVDAX_MINT}&outputMint=${USDC_MINT}&amount=${rawAmountNvdax}&slippageBps=100`;
    }

    try {
        // 1. Fetch Quote
        const quoteRes = await fetch(quoteUrl);
        const quoteResponse = await quoteRes.json();

        if (quoteResponse.error) {
            console.error(`❌ Jupiter Quote Failed: ${quoteResponse.error}`);
            return; 
        }

        // 2. Fetch Swap Transaction
        const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                quoteResponse, 
                userPublicKey: wallet.publicKey.toString(), 
                wrapAndUnwrapSol: true,
                dynamicComputeUnitLimit: true,
                prioritizationFeeLamports: 17000 
            })
        });
        const swapData = await swapRes.json();

        if (swapData.error || !swapData.swapTransaction) {
            console.error(`❌ Jupiter Swap Construction Failed:`, swapData.error || "Missing swapTransaction");
            return; 
        }

        // 3. Deserialize and Sign
        const transaction = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
        transaction.sign([wallet]);

        // 4. Send Transaction
        const txid = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 2
        });
        console.log(`📡 Transaction Sent: ${txid}. Waiting for confirmation...`);

        const confirmed = await pollForSignature(txid);

        if (confirmed) {
            console.log(`✅ Swap Successful! https://solscan.io/tx/${txid}`);
            let state = loadBotState();
            state.last_trade_type = tradeType;
            state.last_trade_price = currentPrice;
            state.last_tx = txid;
            saveBotState(state);
            saveTradeReceipt(txid, tradeType, currentPrice);
        } else {
            console.error("❌ Transaction failed to confirm within 60 seconds.");
        }

    } catch (error) {
        console.error("❌ Trade Execution Exception:", error);
    } finally {
        isTrading = false; 
        try {
            let state = loadBotState();
            state.block_trade = false;
            saveBotState(state);
            console.log("🔓 Trade block released.");
        } catch (fileErr) {
            console.error("Failed to release file lock:", fileErr);
        }
    }
}

async function pollForSignature(signature: string): Promise<boolean> {
    const start = Date.now();
    const timeout = 60000;
    const interval = 3000; 

    while (Date.now() - start < timeout) {
        const { value: status } = await connection.getSignatureStatus(signature);
        if (status) {
            if (status.err) return false;
            if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
                return true;
            }
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    return false;
}

// ==========================================
// RAYDIUM LIVE PRICE MONITOR & GRID LOGIC
// ==========================================
async function startGridBot() {
    console.log(`🤖 Starting NVDAx/USDC Grid Bot...`);
    console.log(`Wallet loaded: ${wallet.publicKey.toBase58()}`);
    console.log(`Monitoring Raydium Pool: ${POOL_ADDRESS.toBase58()}`);

    const subscriptionId = connection.onAccountChange(
        POOL_ADDRESS,
        async (accountInfo) => {
            // 1. Immediately engage memory lock
            if (isTrading) return; 
            isTrading = true; 

            try {
                // 2. Check hard file lock
                let state = loadBotState();
                if (state.block_trade === true) {
                    isTrading = false;
                    return;
                }

                // 3. Decode Price directly from on-chain buffer
                const decoded = poolLayout.decode(accountInfo.data);
                const currentPrice = calculatePrice(decoded.sqrtPriceX64, decoded.mintDecimals0, decoded.mintDecimals1);
                
                // Ensure state matches file updates
                state = loadBotState(); 

                if (currentPrice < state.min_price || currentPrice > state.max_price) {
                    isTrading = false;
                    return; // Out of grid bounds
                }

                const priceDifference = currentPrice - state.last_trade_price;
                
                // If it's a new bot run, print the status occasionally or on change.
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] NVDAx Price: $${currentPrice.toFixed(4)} USDC | Diff: ${priceDifference.toFixed(4)}`);

                // 4. Grid Trigger Execution Check
                if (priceDifference >= state.grid_size) {
                    console.log(`\n📈 +$${state.grid_size} hit. SELL condition met.`);
                    state.block_trade = true; 
                    saveBotState(state);
                    await executeGridTrade('sell', currentPrice);
                } 
                else if (priceDifference <= -state.grid_size) {
                    console.log(`\n📉 -$${state.grid_size} hit. BUY condition met.`);
                    state.block_trade = true; 
                    saveBotState(state);
                    await executeGridTrade('buy', currentPrice);
                } 
                else {
                    // Not enough movement yet, release memory lock for next tick
                    isTrading = false;
                }

            } catch (error) {
                console.error("Error evaluating grid conditions:", error);
                isTrading = false; 
            }
        },
        'confirmed'
    );

    console.log(`Subscribed to live updates (ID: ${subscriptionId}). Press Ctrl+C to exit.`);
}

// Start the engine
startGridBot().catch(console.error);