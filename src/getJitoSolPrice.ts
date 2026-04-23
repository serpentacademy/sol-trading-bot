import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { 
    buildWhirlpoolClient, 
    WhirlpoolContext, 
    ORCA_WHIRLPOOL_PROGRAM_ID,
    PriceMath,
    IGNORE_CACHE // <--- Add this!
} from '@orca-so/whirlpools-sdk';
import { Wallet } from '@coral-xyz/anchor';
import Decimal from 'decimal.js'; // Needed to invert the price

// 1. Set up Helius Endpoints
const HELIUS_API_KEY = '5cfa95c2-0ded-4a87-9c7c-2a34a59b841a';
const HTTP_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const WSS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// 2. Identify the Top Pool (USDC / JitoSOL)
const USDC_JITOSOL_WHIRLPOOL = new PublicKey('5hWJUNTtEtKmKgDXpthJXXRRmJrz5vJ7uJzrUNVdrwLg');

// Establish the WebSocket-enabled connection via Helius
const connection = new Connection(HTTP_URL, {
    wsEndpoint: WSS_URL,
    commitment: 'confirmed'
});

async function monitorJitoSolPrice() {
    console.log(`Connecting to Helius WSS to monitor JitoSOL/USDC pool: ${USDC_JITOSOL_WHIRLPOOL.toBase58()}...`);

    // 1. Setup the dummy wallet
    const dummyWallet = new Wallet(Keypair.generate());
    
    // 2. Initialize the context 
    const ctx = WhirlpoolContext.from(
        connection,
        dummyWallet, 
         // Added this back!
    );
    const client = buildWhirlpoolClient(ctx);

    // 3. Subscribe to the Pool Account
    connection.onAccountChange(
        USDC_JITOSOL_WHIRLPOOL,
        async (accountInfo, context) => {
            console.log(`\n[Slot ${context.slot}] Trade detected!`);
            
            try {
                // Fetch the cleanly decoded pool state
                const pool = await client.getPool(USDC_JITOSOL_WHIRLPOOL, IGNORE_CACHE);
                const poolData = pool.getData();
                
                // Decode the price using correct decimals: Token A (USDC) has 6, Token B (JitoSOL) has 9.
                // This returns the price of 1 USDC in terms of JitoSOL.
                const priceOfUsdcInJitoSol = PriceMath.sqrtPriceX64ToPrice(poolData.sqrtPrice, 6, 9);

                // To get the USD value of 1 JitoSOL, we invert the price (1 / price)
                const jitoSolPriceInUsdc = new Decimal(1).div(priceOfUsdcInJitoSol);

                console.log(`Live Price: $${jitoSolPriceInUsdc.toFixed(2)} USDC per JitoSOL`);
                
            } catch (error) {
                console.error("Failed to decode new pool price:", error);
            }
        },
        'confirmed'
    );
}

// Run the listener
monitorJitoSolPrice().catch(console.error);