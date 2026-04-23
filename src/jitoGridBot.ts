import { Connection, Keypair, VersionedTransaction, PublicKey, SystemProgram, TransactionMessage } from '@solana/web3.js';
import { buildWhirlpoolClient, WhirlpoolContext, ORCA_WHIRLPOOL_PROGRAM_ID, PriceMath, IGNORE_CACHE } from '@orca-so/whirlpools-sdk';
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

// Jito Configuration
const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
const JITO_TIP_AMOUNT = 10_000; // 0.00001 SOL
const JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', 'HFqU5xCUoS5nc8ZX3eQ2aM24E9sWeE8b2P3LzXjSBNdM',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvVkY', 'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iMgaSka',
    'DfXygSm4jMs88fU1jqWeaX8ouYpA7H4hR4xP41a9Drtq', 'ADuUkR4w7EokP1NqB9f2GZp7qGZ4Mowt8T9F48vVzS85',
    '3AVi9Tg9Uo68tJfuvoKwPe2yYMBYjSMEy2A6U6Z8NKhN', 'AHT34nB7T9T62zV2kU2U7FfG9pG12g11hD9Wq1tEaB1R'
];

// Bot State & Locks
const BOT_JSON_PATH = path.join(process.cwd(), 'Bot.json');
const TRADES_DIR = path.join(process.cwd(), 'trades');
const TRADE_SIZE_USDC = 3; // Default size of each grid trade
let isTrading = false; // Mutex lock to prevent multiple trades firing at once

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
    
    const receipt = { timestamp: now.toISOString(), txid, type, price, size_usdc: TRADE_SIZE_USDC };
    fs.writeFileSync(path.join(TRADES_DIR, filename), JSON.stringify(receipt, null, 2));
    console.log(`📁 Trade receipt saved: trades/${filename}`);
}

// ==========================================
// JUPITER + JITO EXECUTION
// ==========================================
async function executeGridTrade(tradeType: 'buy' | 'sell', currentPrice: number) {
    console.log(`\n🚨 GRID TRIGGERED! Executing ${tradeType.toUpperCase()} at $${currentPrice.toFixed(2)}`);
    const rawAmount = Math.floor(TRADE_SIZE_USDC * (10 ** USDC_DECIMALS));

    try {
        // 1. Get Quote based on trade type
        let quoteUrl = '';
        if (tradeType === 'buy') {
            // BUY: Spend exact USDC for JitoSOL (ExactIn)
            quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${JITOSOL_MINT}&amount=${rawAmount}&slippageBps=50`;
        } else {
            // SELL: Sell JitoSOL for exact USDC (ExactOut)
            quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${JITOSOL_MINT}&outputMint=${USDC_MINT}&amount=${rawAmount}&slippageBps=50&swapMode=ExactOut`;
        }

        const quoteResponse = await (await fetch(quoteUrl)).json();

        // 2. Build Transaction
        const { swapTransaction } = await (await fetch('https://api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteResponse, userPublicKey: wallet.publicKey.toString(), wrapAndUnwrapSol: true })
        })).json();

        const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        const recentBlockhash = transaction.message.recentBlockhash;

        // 3. Attach Jito Tip
        const randomTipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
        const tipInstruction = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: randomTipAccount, lamports: JITO_TIP_AMOUNT });
        const tipTransaction = new VersionedTransaction(new TransactionMessage({
            payerKey: wallet.publicKey, recentBlockhash: recentBlockhash, instructions: [tipInstruction],
        }).compileToV0Message());

        transaction.sign([wallet]);
        tipTransaction.sign([wallet]);
        
        const txid = bs58.encode(transaction.signatures[0]);

        // 4. Send Bundle
        console.log("Sending Jito Bundle...");
        const jitoResponse = await fetch(JITO_BLOCK_ENGINE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "sendBundle",
                params: [[bs58.encode(transaction.serialize()), bs58.encode(tipTransaction.serialize())]]
            })
        });

        const jitoResult = await jitoResponse.json();
        if (jitoResult.error) throw new Error(`Jito Error: ${JSON.stringify(jitoResult.error)}`);

        // 5. Confirm Transaction
        await connection.confirmTransaction({
            blockhash: recentBlockhash,
            lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
            signature: txid
        });

        console.log(`✅ Swap Successful! https://solscan.io/tx/${txid}`);

        // 6. Update State & Save Receipt
        let state = loadBotState();
        state.last_trade_type = tradeType;
        state.last_trade_price = currentPrice;
        saveBotState(state);
        saveTradeReceipt(txid, tradeType, currentPrice);

    } catch (error) {
        console.error("❌ Trade Execution Failed:", error);
    } finally {
        isTrading = false; // Release the lock
    }
}

// ==========================================
// ORCA LIVE PRICE MONITOR & GRID LOGIC
// ==========================================
async function startGridBot() {
    console.log(`🤖 Starting Grid Bot. Monitoring JitoSOL/USDC...`);
    console.log(`Wallet loaded: ${wallet.publicKey.toBase58()}`);
    
    const dummyWallet = new Wallet(Keypair.generate());
    const ctx = WhirlpoolContext.from(connection, dummyWallet, ORCA_WHIRLPOOL_PROGRAM_ID);
    const client = buildWhirlpoolClient(ctx);

    connection.onAccountChange(USDC_JITOSOL_WHIRLPOOL, async () => {
        if (isTrading) return; // Skip checking if a trade is actively routing

        try {
            const pool = await client.getPool(USDC_JITOSOL_WHIRLPOOL, IGNORE_CACHE);
            const poolData = pool.getData();
            const priceOfUsdcInJitoSol = PriceMath.sqrtPriceX64ToPrice(poolData.sqrtPrice, 6, 9);
            const currentPrice = new Decimal(1).div(priceOfUsdcInJitoSol).toNumber();

            let state = loadBotState();

            // Ignore prices outside our min/max bounds
            if (currentPrice < state.min_price || currentPrice > state.max_price) return;

            const priceDifference = currentPrice - state.last_trade_price;

            // Check if price went UP by the grid size
            if (priceDifference >= state.grid_size) {
                isTrading = true;
                await executeGridTrade('sell', currentPrice);
            } 
            // Check if price went DOWN by the grid size
            else if (priceDifference <= -state.grid_size) {
                isTrading = true;
                await executeGridTrade('buy', currentPrice);
            }

        } catch (error) {
            console.error("Error evaluating grid conditions:", error);
        }
    }, 'confirmed');
}

startGridBot().catch(console.error);