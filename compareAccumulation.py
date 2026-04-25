import pandas as pd
import matplotlib.pyplot as plt
import json
import glob
import os

def analyze_accumulation(folder_path='trades'):
    files = glob.glob(os.path.join(folder_path, '*.json'))
    trades = []
    
    for f in files:
        with open(f, 'r') as file:
            try:
                data = json.load(file)
                if data.get('status') == 'success':
                    trades.append(data)
            except json.JSONDecodeError:
                pass
                
    df = pd.DataFrame(trades)
    
    if df.empty:
        print("No successful trades found.")
        return

    # Split into buys and sells
    buys = df[df['type'] == 'buy']
    sells = df[df['type'] == 'sell']

    # --- JitoSOL Calculations ---
    # In a BUY, we receive JitoSOL (swapped_out)
    jitosol_bought = buys['actual_swapped_out'].sum() if not buys.empty else 0
    # In a SELL, we give JitoSOL (swapped_in)
    jitosol_sold = sells['actual_swapped_in'].sum() if not sells.empty else 0
    net_jitosol = jitosol_bought - jitosol_sold

    # --- USDC Calculations ---
    # In a BUY, we spend USDC (swapped_in)
    usdc_spent = buys['actual_swapped_in'].sum() if not buys.empty else 0
    # In a SELL, we earn USDC (swapped_out)
    usdc_earned = sells['actual_swapped_out'].sum() if not sells.empty else 0
    net_usdc = usdc_earned - usdc_spent

    # Print Terminal Summary
    print("\n" + "="*50)
    print("💰 INVENTORY ACCUMULATION BREAKDOWN")
    print("="*50)
    print(f"Total BUYS executed  : {len(buys)}")
    print(f"Total SELLS executed : {len(sells)}")
    print("-" * 50)
    print("🟣 JitoSOL Flow:")
    print(f"  (+) Bought        : {jitosol_bought:.5f} JitoSOL")
    print(f"  (-) Sold          : {jitosol_sold:.5f} JitoSOL")
    print(f"  (=) NET INVENTORY : {net_jitosol:.5f} JitoSOL")
    print("-" * 50)
    print("💵 USDC Flow:")
    print(f"  (+) Earned (Sells): {usdc_earned:.2f} USDC")
    print(f"  (-) Spent (Buys)  : {usdc_spent:.2f} USDC")
    print(f"  (=) NET INVENTORY : {net_usdc:.2f} USDC")
    print("="*50 + "\n")

    # --- Visualization ---
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    fig.suptitle('Asset Flow Comparison: Buys vs Sells', fontsize=16, weight='bold')

    # JitoSOL Chart
    labels_jito = ['Bought (+)', 'Sold (-)', 'Net']
    values_jito = [jitosol_bought, jitosol_sold, net_jitosol]
    colors_jito = ['green', 'red', 'purple' if net_jitosol > 0 else 'orange']
    
    bars1 = ax1.bar(labels_jito, values_jito, color=colors_jito)
    ax1.set_title('JitoSOL Cash Flow', fontsize=12)
    ax1.set_ylabel('Amount of JitoSOL')
    ax1.axhline(0, color='black', linewidth=1)
    
    # Add value labels on top of bars
    for bar in bars1:
        yval = bar.get_height()
        offset = 0.05 * max(values_jito) if yval >= 0 else -0.05 * max(values_jito)
        ax1.text(bar.get_x() + bar.get_width()/2, yval + offset, f'{yval:.3f}', ha='center', va='bottom' if yval >= 0 else 'top')

    # USDC Chart
    labels_usdc = ['Earned (+)', 'Spent (-)', 'Net']
    values_usdc = [usdc_earned, usdc_spent, net_usdc]
    colors_usdc = ['green', 'red', 'teal' if net_usdc > 0 else 'orange']
    
    bars2 = ax2.bar(labels_usdc, values_usdc, color=colors_usdc)
    ax2.set_title('USDC Cash Flow', fontsize=12)
    ax2.set_ylabel('Amount of USDC')
    ax2.axhline(0, color='black', linewidth=1)

    for bar in bars2:
        yval = bar.get_height()
        offset = 0.05 * max(abs(pd.Series(values_usdc))) if yval >= 0 else -0.05 * max(abs(pd.Series(values_usdc)))
        ax2.text(bar.get_x() + bar.get_width()/2, yval + offset, f'{yval:.2f}', ha='center', va='bottom' if yval >= 0 else 'top')

    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    analyze_accumulation('trades')