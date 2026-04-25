import { Connection } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

// ==========================================
// CONFIGURATION
// ==========================================
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_API_KEY) {
    throw new Error("Missing HELIUS_API_KEY in .env file!");
}

const HTTP_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(HTTP_URL, { commitment: 'confirmed' });

const TRADES_DIR = path.join(process.cwd(), 'trades');

// Helper to avoid hitting RPC rate limits
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// MAIN PROCESSING FUNCTION
// ==========================================
async function processTrades() {
    console.log(`📂 Scanning directory: ${TRADES_DIR}`);
    
    if (!fs.existsSync(TRADES_DIR)) {
        console.error("❌ Trades directory does not exist.");
        return;
    }

    const files = fs.readdirSync(TRADES_DIR).filter(file => file.endsWith('.json'));
    console.log(`Found ${files.length} JSON files. Starting process...\n`);

    for (const file of files) {
        const filePath = path.join(TRADES_DIR, file);
        const rawData = fs.readFileSync(filePath, 'utf-8');
        let tradeData;

        try {
            tradeData = JSON.parse(rawData);
        } catch (e) {
            console.error(`⚠️ Could not parse ${file}, skipping.`);
            continue;
        }

        // 1. Check conditions: size_usdc == 3
        if (tradeData.size_usdc !== 3) {
            continue;
        }

        // Optional: Skip if already processed to save RPC calls
        if (tradeData.fee_sol !== undefined) {
            console.log(`⏭️  Skipping ${file} - already processed.`);
            continue;
        }

        console.log(`🔍 Processing ${file} (TXID: ${tradeData.txid})`);

        try {
            // 2. Fetch the parsed transaction (maxSupportedTransactionVersion: 0 is required for Jupiter v6 txs)
            const tx = await connection.getParsedTransaction(tradeData.txid, {
                maxSupportedTransactionVersion: 0,
            });

            if (!tx || !tx.meta) {
                console.log(`   ❌ Transaction not found on-chain or lacks metadata.`);
                tradeData.status = "not_found";
                fs.writeFileSync(filePath, JSON.stringify(tradeData, null, 2));
                continue;
            }

            if (tx.meta.err) {
                console.log(`   ❌ Transaction failed on-chain.`);
                tradeData.status = "failed";
                fs.writeFileSync(filePath, JSON.stringify(tradeData, null, 2));
                continue;
            }

            // 3. Extract Fee
            const feeLamports = tx.meta.fee;
            const feeSol = feeLamports / 1e9;
            
            // 4. Extract exact swap amounts from Token Balances
            // The first account in the list is the fee payer (your bot's wallet)
            const walletAddress = tx.transaction.message.accountKeys[0].pubkey.toString();

            const preBalances = new Map<string, number>();
            const postBalances = new Map<string, number>();

            // Map Pre-Balances for the wallet
            tx.meta.preTokenBalances?.forEach(balance => {
                if (balance.owner === walletAddress) {
                    preBalances.set(balance.mint, balance.uiTokenAmount.uiAmount || 0);
                }
            });

            // Map Post-Balances for the wallet
            tx.meta.postTokenBalances?.forEach(balance => {
                if (balance.owner === walletAddress) {
                    postBalances.set(balance.mint, balance.uiTokenAmount.uiAmount || 0);
                }
            });

            // Calculate differences
            let amountIn = 0;
            let amountInMint = "";
            let amountOut = 0;
            let amountOutMint = "";

            // Combine all unique mints from pre and post
            const allMints = new Set([...preBalances.keys(), ...postBalances.keys()]);

            allMints.forEach(mint => {
                const pre = preBalances.get(mint) || 0;
                const post = postBalances.get(mint) || 0;
                const diff = post - pre;

                // Tolerance for tiny dust differences, only track meaningful swaps
                if (diff < -0.000001) {
                    amountIn = Math.abs(diff); // Amount given to the pool
                    amountInMint = mint;
                } else if (diff > 0.000001) {
                    amountOut = diff; // Amount received from the pool
                    amountOutMint = mint;
                }
            });

            // 5. Update the JSON Object
            tradeData.status = "success";
            tradeData.fee_sol = feeSol;
            tradeData.actual_swapped_in = amountIn;
            tradeData.actual_swapped_in_mint = amountInMint;
            tradeData.actual_swapped_out = amountOut;
            tradeData.actual_swapped_out_mint = amountOutMint;

            // 6. Save back to the file
            fs.writeFileSync(filePath, JSON.stringify(tradeData, null, 2));
            console.log(`   ✅ Saved! Fee: ${feeSol} SOL | In: ${amountIn.toFixed(4)} | Out: ${amountOut.toFixed(4)}`);

            // Sleep to avoid Helius rate limits (e.g., 5-10 requests per second)
            await sleep(250); 

        } catch (error) {
            console.error(`   ❌ Error fetching tx ${tradeData.txid}:`, error);
        }
    }

    console.log(`\n🎉 Finished processing all trades!`);
}

processTrades().catch(console.error);