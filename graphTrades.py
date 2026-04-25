import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import json
import glob
import os
import numpy as np

# ==========================================
# 1. LOAD AND PREP DATA
# ==========================================
def load_trade_data(folder_path='trades'):
    files = glob.glob(os.path.join(folder_path, '*.json'))
    trades = []
    
    for f in files:
        with open(f, 'r') as file:
            try:
                data = json.load(file)
                if data.get('status') == 'success': # Only analyze successful trades
                    trades.append(data)
            except json.JSONDecodeError:
                print(f"Skipping invalid JSON: {f}")
                
    df = pd.DataFrame(trades)
    
    if df.empty:
        raise ValueError("No successful trades found in the directory.")

    # Convert timestamps and sort
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    return df

# ==========================================
# 2. CALCULATE STRATEGIC METRICS
# ==========================================
def calculate_metrics(df):
    # Total Fees
    df['cumulative_fees_sol'] = df['fee_sol'].cumsum()
    total_fees_sol = df['fee_sol'].sum()
    
    # Net JitoSOL Inventory Flow
    # Buy: We receive JitoSOL (actual_swapped_out)
    # Sell: We give JitoSOL (actual_swapped_in)
    df['jitosol_flow'] = np.where(
        df['type'] == 'buy', 
        df['actual_swapped_out'], 
        -df['actual_swapped_in']
    )
    df['cumulative_jitosol'] = df['jitosol_flow'].cumsum()
    
    # Net USDC Flow
    # Buy: We give USDC (actual_swapped_in)
    # Sell: We receive USDC (actual_swapped_out)
    df['usdc_flow'] = np.where(
        df['type'] == 'buy', 
        -df['actual_swapped_in'], 
        df['actual_swapped_out']
    )
    df['cumulative_usdc'] = df['usdc_flow'].cumsum()

    return df, total_fees_sol

# ==========================================
# 3. GENERATE STRATEGIC DASHBOARD
# ==========================================
def plot_dashboard(df, total_fees_sol):
    sns.set_theme(style="darkgrid")
    fig, axes = plt.subplots(3, 1, figsize=(12, 14), sharex=True)
    fig.suptitle('JitoSOL / USDC Grid Bot Strategic Dashboard', fontsize=18, weight='bold')

    # --- GRAPH 1: Price Action & Executions ---
    ax1 = axes[0]
    sns.lineplot(data=df, x='timestamp', y='price_usdc', ax=ax1, color='gray', alpha=0.5, label='Price Trend')
    
    # Scatter buys (Green) and sells (Red)
    buys = df[df['type'] == 'buy']
    sells = df[df['type'] == 'sell']
    ax1.scatter(buys['timestamp'], buys['price_usdc'], color='green', s=50, marker='^', label='Buy', zorder=5)
    ax1.scatter(sells['timestamp'], sells['price_usdc'], color='red', s=50, marker='v', label='Sell', zorder=5)
    
    ax1.set_title('Grid Execution Accuracy (Price vs. Trades)', fontsize=14)
    ax1.set_ylabel('JitoSOL Price (USDC)')
    ax1.legend()

    # --- GRAPH 2: Cumulative Fees Paid ---
    ax2 = axes[1]
    sns.lineplot(data=df, x='timestamp', y='cumulative_fees_sol', ax=ax2, color='orange', linewidth=2)
    ax2.fill_between(df['timestamp'], df['cumulative_fees_sol'], color='orange', alpha=0.2)
    
    ax2.set_title(f'Network Cost Drain (Total Fees Paid: {total_fees_sol:.6f} SOL)', fontsize=14)
    ax2.set_ylabel('Cumulative Fees (SOL)')

    # --- GRAPH 3: Net Asset Flow (Inventory Management) ---
    ax3 = axes[2]
    # Plot JitoSOL accumulation on left axis
    sns.lineplot(data=df, x='timestamp', y='cumulative_jitosol', ax=ax3, color='purple', label='Net JitoSOL Balance')
    ax3.set_ylabel('Net JitoSOL', color='purple')
    ax3.tick_params(axis='y', labelcolor='purple')
    
    # Plot USDC accumulation on right axis
    ax3_twin = ax3.twinx()
    sns.lineplot(data=df, x='timestamp', y='cumulative_usdc', ax=ax3_twin, color='teal', label='Net USDC Balance', linestyle='--')
    ax3_twin.set_ylabel('Net USDC', color='teal')
    ax3_twin.tick_params(axis='y', labelcolor='teal')
    
    ax3.set_title('Asset Accumulation vs. Base Currency (Impermanent Loss Tracker)', fontsize=14)
    ax3.set_xlabel('Time')
    
    # Combine legends for Graph 3
    lines_1, labels_1 = ax3.get_legend_handles_labels()
    lines_2, labels_2 = ax3_twin.get_legend_handles_labels()
    ax3.legend(lines_1 + lines_2, labels_1 + labels_2, loc='upper left')

    plt.tight_layout(rect=[0, 0, 1, 0.97]) # Adjust for suptitle
    plt.show()

# ==========================================
# EXECUTE
# ==========================================
if __name__ == "__main__":
    try:
        # Assumes your script is running in the same directory as the 'trades' folder
        df = load_trade_data('trades') 
        df, total_fees_sol = calculate_metrics(df)
        
        print("\n" + "="*40)
        print("📊 BOT PERFORMANCE SUMMARY")
        print("="*40)
        print(f"Total Successful Trades : {len(df)}")
        print(f"Total Network Fees      : {total_fees_sol:.6f} SOL")
        print(f"Net JitoSOL Change      : {df['cumulative_jitosol'].iloc[-1]:.4f} JitoSOL")
        print(f"Net USDC Change         : {df['cumulative_usdc'].iloc[-1]:.2f} USDC")
        print("="*40 + "\n")
        
        plot_dashboard(df, total_fees_sol)
        
    except Exception as e:
        print(f"Error: {e}")