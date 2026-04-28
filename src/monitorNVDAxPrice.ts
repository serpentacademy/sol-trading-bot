import { Connection, PublicKey } from '@solana/web3.js';
import * as borsh from '@coral-xyz/borsh';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import * as dotenv from 'dotenv';

// Load Environment Variables
dotenv.config();

// INCREASE PRECISION: Critical for CLMM 128-bit math
Decimal.set({ precision: 100 });

// Helius RPC endpoint
const HELIUS_RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';

// Pool address (NVDAx / USDC)
const POOL_ADDRESS = new PublicKey('4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN');


export const RewardInfo = borsh.struct([
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

// Standard Raydium CLMM Layout
const poolLayout = borsh.struct([
  borsh.array(borsh.u8(), 8, 'discriminator'),
  borsh.array(borsh.u8(), 1, 'bump'),
  borsh.publicKey('ammConfig'),
  borsh.publicKey('owner'),
  borsh.publicKey('mintA'), // NVDAx

  borsh.publicKey('mintB'), // USDC
    borsh.publicKey('tokenMint0'), // NVDAx

  borsh.publicKey('tokenVault1'),
  borsh.publicKey('observationKey'),
  borsh.u8('mintDecimals0'), // 8
  borsh.u8('mintDecimals1'), // 6
  borsh.u16('tickSpacing'),
  borsh.u128('liquidity'),
  borsh.u128('sqrtPriceX64'), // Stored as sqrt(Price) * 2^64
  borsh.i32('tickCurrent'),
  // ... rest of the layout (truncated for brevity, we only need up to sqrtPrice)
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

/**
 * Calculates the price of Token0 (NVDAx) in terms of Token1 (USDC).
 * Formula: (sqrtPrice / 2^64)^2 * (10^dec0 / 10^dec1)
 */
function calculatePrice(sqrtPriceX64: BN, dec0: number, dec1: number): string {
  const sqrtPrice = new Decimal(sqrtPriceX64.toString());
  const Q64 = new Decimal(2).pow(64);
  
  // Calculate P_raw = (sqrtPrice / Q64)^2
  const rawPrice = sqrtPrice.div(Q64).pow(2);

  // Adjust for decimals: Price_human = RawPrice * 10^(dec0 - dec1)
  const decimalAdjustment = new Decimal(10).pow(dec0 - dec1);
  const price = rawPrice.mul(decimalAdjustment);

  return price.toFixed(4);
}

async function processPoolData(connection: Connection, isInitial: boolean = false) {
  try {
    const accountInfo = await connection.getAccountInfo(POOL_ADDRESS);
    if (!accountInfo) {
      console.error('Failed to fetch pool data: Account not found');
      return;
    }

    // Decode only the necessary part of the buffer to save CPU/safety
    // Note: We use the full layout logic but wrapped safely
    const decoded = poolLayout.decode(accountInfo.data);

    // Identify Tokens
    // Token0: NVDAx (8 decimals)
    // Token1: USDC (6 decimals)
    const dec0 = decoded.mintDecimals0;
    const dec1 = decoded.mintDecimals1;
// LOGGING TO CHECK MINTS
    console.log("------------------------------------------------");
    console.log("Decoded Mint 0:", decoded.mintA.toBase58());
    console.log("Decoded Mint 1:", decoded.mintB.toBase58());
      console.log("decoded.sqrtPriceX64: "+decoded.sqrtPriceX64);
            console.log("start time: "+decoded.startTime);
            console.log("totalFeesClaimedTokenA: "+decoded.totalFeesClaimedTokenA/10**(decoded.mintDecimals0))
            console.log("totalFeesClaimedTokenB: "+decoded.totalFeesClaimedTokenB/10**decoded.mintDecimals1)

      console.log("start time: "+decoded.startTime);



    // Direct calculation (NVDAx -> USDC)
    const price = calculatePrice(decoded.sqrtPriceX64, dec0, dec1);

    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${isInitial ? 'Initial' : 'Update'} NVDAx Price: $${price} USDC`);

  } catch (error) {
    console.error('Error processing pool data:', error);
  }
}

async function main() {
  console.log(`Starting NVDAx Price Monitor...`);
  console.log(`Target Pool: ${POOL_ADDRESS.toBase58()}`);
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');

  // 1. Fetch Initial Price
  await processPoolData(connection, true);

  // 2. Subscribe to WebSocket Updates
  const subscriptionId = connection.onAccountChange(
    POOL_ADDRESS,
    (accountInfo) => {
      // Manually decode inside the callback to keep it self-contained
      const decoded = poolLayout.decode(accountInfo.data);
      const price = calculatePrice(decoded.sqrtPriceX64, decoded.mintDecimals0, decoded.mintDecimals1);
      const timestamp = new Date().toLocaleTimeString();
      console.log(`[${timestamp}] Update NVDAx Price: $${price} USDC`);
    },
    'confirmed'
  );

  console.log(`Subscribed to live updates (ID: ${subscriptionId}). Press Ctrl+C to exit.`);

  // Cleanup
  process.on('SIGINT', async () => {
    console.log('\nStopping monitor...');
    await connection.removeAccountChangeListener(subscriptionId);
    process.exit(0);
  });
}

main().catch(console.error);