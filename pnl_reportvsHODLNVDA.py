import json
import glob
import os
import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

def load_bot_state(filepath='BotNVDAx.json'):
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"❌ Error: {filepath} not found.")
        return None

def load_trades(folder_path='nvdatrades'):
    files = glob.glob(os.path.join(folder_path, '*.json'))
    trades = []
    for f in files:
        with open(f, 'r') as file:
            try:
                data = json.load(file)
                # Ensure we only grab successful trades, defaulting to success if 'status' is missing in new bot version
                if data.get('status', 'success') == 'success':
                    trades.append(data)
            except json.JSONDecodeError:
                pass
    return pd.DataFrame(trades)

def generate_pnl_report():
    console = Console()
    
    # 1. Load Data
    bot_state = load_bot_state()
    if not bot_state:
        return
        
    df_trades = load_trades()
    
    # Extract Initial Values for NVDAx
    start_price = bot_state.get('start_price', 0)
    last_price = bot_state.get('last_trade_price', start_price) 
    initial_nvdax = bot_state.get('start_token_quantity', 0)
    initial_usdc = bot_state.get('USDC_start_token_quantity', 0)
    
    # 2. Initial Portfolio Value
    initial_total_value_usdc = (initial_nvdax * start_price) + initial_usdc

    # 3. Calculate Variations from Trades
    nvdax_bought = 0
    nvdax_sold = 0
    usdc_spent = 0
    usdc_earned = 0
    total_fees_sol = 0
    
    if not df_trades.empty:
        # Calculate implied NVDAx amounts based on USD size and execution price
        df_trades['nvdax_amount'] = df_trades['size_usdc'] / df_trades['price_usdc']
        
        buys = df_trades[df_trades['type'] == 'buy']
        sells = df_trades[df_trades['type'] == 'sell']
        
        nvdax_bought = buys['nvdax_amount'].sum() if not buys.empty else 0
        nvdax_sold = sells['nvdax_amount'].sum() if not sells.empty else 0
        usdc_spent = buys['size_usdc'].sum() if not buys.empty else 0
        usdc_earned = sells['size_usdc'].sum() if not sells.empty else 0
        
        # If 'fee_sol' isn't explicitly saved by your JS, estimate it based on priority fee
        if 'fee_sol' in df_trades.columns:
            total_fees_sol = df_trades['fee_sol'].sum()
        else:
            total_fees_sol = len(df_trades) * 0.000022  # Base + 17k lamport priority fee

    nvdax_change = nvdax_bought - nvdax_sold
    usdc_change = usdc_earned - usdc_spent

    # 4. Final Portfolio & TRUE PnL Calculation
    final_nvdax = initial_nvdax + nvdax_change
    final_usdc = initial_usdc + usdc_change
    
    final_total_value_usdc = (final_nvdax * last_price) + final_usdc
    
    current_sol_price = 145.00 # <-- UPDATE THIS TO CURRENT SOL PRICE
    fees_in_usdc = total_fees_sol * current_sol_price
    
    gross_pnl_usdc = final_total_value_usdc - initial_total_value_usdc
    true_net_pnl_usdc = gross_pnl_usdc - fees_in_usdc
    pnl_percentage = (true_net_pnl_usdc / initial_total_value_usdc) * 100 if initial_total_value_usdc > 0 else 0

    # 5. HODL vs BOT Calculation (Impermanent Loss Metric)
    # What if you just held the initial tokens and did nothing?
    hodl_current_value = (initial_nvdax * last_price) + initial_usdc
    hodl_pnl = hodl_current_value - initial_total_value_usdc
    bot_vs_hodl_diff = true_net_pnl_usdc - hodl_pnl

    # ==========================================
    # BUILD BEAUTIFUL UI REPORT (RICH)
    # ==========================================
    console.print("\n")
    console.print(Panel(Text("📈 NVDAx/USDC GRID BOT STRATEGY & PNL REPORT", style="bold cyan", justify="center"), style="cyan"))
    
    # Table 1: Initial vs Final Inventory
    inv_table = Table(show_header=True, header_style="bold magenta", expand=True)
    inv_table.add_column("Metric", style="dim", width=20)
    inv_table.add_column("Initial State", justify="right")
    inv_table.add_column("Net Variation", justify="right")
    inv_table.add_column("Final State", justify="right", style="bold")
    
    inv_table.add_row(
        "NVDAx Stack", 
        f"{initial_nvdax:.6f}", 
        f"[green if nvdax_change >= 0 else red]{'+' if nvdax_change >=0 else ''}{nvdax_change:.6f}[/]", 
        f"{final_nvdax:.6f}"
    )
    inv_table.add_row(
        "USDC Stack", 
        f"${initial_usdc:.2f}", 
        f"[green if usdc_change >= 0 else red]{'+' if usdc_change >=0 else ''}{usdc_change:.2f}[/]", 
        f"${final_usdc:.2f}"
    )
    inv_table.add_row("Reference Price", f"${start_price:.4f}", "-->", f"${last_price:.4f}")
    console.print(inv_table)

    # ------------------------------------------
    # IN-TERMINAL GRAPHIC FOR ACCUMULATION
    # ------------------------------------------
    max_vol = max(nvdax_bought, nvdax_sold) if (nvdax_bought > 0 or nvdax_sold > 0) else 1
    bar_width = 40
    buy_bar = "█" * int((nvdax_bought / max_vol) * bar_width)
    sell_bar = "█" * int((nvdax_sold / max_vol) * bar_width)

    accum_pct = (nvdax_change / initial_nvdax) * 100 if initial_nvdax > 0 else 0
    accum_color = "bold green" if nvdax_change >= 0 else "bold red"

    graphic_text = Text()
    graphic_text.append(f"Volume Bought (+) : {buy_bar} {nvdax_bought:.6f} NVDAx\n", style="green")
    graphic_text.append(f"Volume Sold   (-) : {sell_bar} {nvdax_sold:.6f} NVDAx\n", style="red")
    graphic_text.append("-----------------------------------------------------------------------\n", style="dim")
    graphic_text.append(f"Net Accumulated from Spread: ", style="bold white")
    graphic_text.append(f"{'+' if nvdax_change >= 0 else ''}{nvdax_change:.6f} NVDAx ({'+' if accum_pct >= 0 else ''}{accum_pct:.2f}% of start stack)", style=accum_color)
    
    console.print(Panel(graphic_text, title="📊 NVDAx Accumulation Graph", border_style="purple"))

    # Table 2: Bot vs HODL (Impermanent Loss Metric)
    vs_table = Table(show_header=True, header_style="bold blue", expand=True)
    vs_table.add_column("Strategy", style="dim", width=20)
    vs_table.add_column("Current USD Value", justify="right")
    vs_table.add_column("Total Net PnL", justify="right", style="bold")
    
    vs_table.add_row(
        "HODL (Do Nothing)", 
        f"${hodl_current_value:.2f}", 
        f"[{'green' if hodl_pnl >= 0 else 'red'}]{'+' if hodl_pnl >=0 else ''}${hodl_pnl:.2f}[/]"
    )
    vs_table.add_row(
        "Grid Bot (After Fees)", 
        f"${(final_total_value_usdc - fees_in_usdc):.2f}", 
        f"[{'green' if true_net_pnl_usdc >= 0 else 'red'}]{'+' if true_net_pnl_usdc >=0 else ''}${true_net_pnl_usdc:.2f}[/]"
    )
    console.print(vs_table)

    # Final Result Panel
    pnl_color = "bold green" if true_net_pnl_usdc >= 0 else "bold red"
    pnl_sign = "+" if true_net_pnl_usdc >= 0 else ""
    
    vs_color = "bold green" if bot_vs_hodl_diff >= 0 else "bold red"
    vs_sign = "+" if bot_vs_hodl_diff >= 0 else ""
    vs_text = "Bot BEAT the market" if bot_vs_hodl_diff >= 0 else "Impermanent Loss (Bot underperformed holding)"

    result_text = Text()
    result_text.append(f"Gross PnL (Before Fees): ${gross_pnl_usdc:.2f}\n", style="dim white")
    result_text.append(f"Network Fees Paid:       {total_fees_sol:.6f} SOL (-${fees_in_usdc:.2f})\n", style="dim orange1")
    result_text.append("------------------------------------------------\n", style="dim")
    result_text.append(f"TRUE NET PNL:            ", style="bold white")
    result_text.append(f"{pnl_sign}${true_net_pnl_usdc:.2f} ({pnl_sign}{pnl_percentage:.2f}%)\n\n", style=pnl_color)
    
    result_text.append(f"BOT vs HODL METRIC:      ", style="bold white")
    result_text.append(f"{vs_sign}${bot_vs_hodl_diff:.2f} -> {vs_text}", style=vs_color)

    console.print(Panel(result_text, title="Bottom Line (After Fees)", border_style=pnl_color))
    console.print("\n")

if __name__ == "__main__":
    generate_pnl_report()