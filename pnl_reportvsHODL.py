import json
import glob
import os
import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from rich.layout import Layout
from rich.align import Align

def load_bot_state(filepath='Bot.json'):
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"❌ Error: {filepath} not found.")
        return None

def load_trades(folder_path='trades'):
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
    return pd.DataFrame(trades)

def generate_pnl_report():
    console = Console()
    
    # 1. Load Data
    bot_state = load_bot_state()
    if not bot_state:
        return
        
    df_trades = load_trades()
    
    # Extract Initial Values
    start_price = bot_state.get('start_price', 0)
    last_price = bot_state.get('last_trade_price', start_price) 
    initial_jito = bot_state.get('jitoSol_start_token_quantity', 0)
    initial_usdc = bot_state.get('USDC_start_token_quantity', 0)
    
    # 2. Initial Portfolio Value
    initial_total_value_usdc = (initial_jito * start_price) + initial_usdc

    # 3. Calculate Variations from Trades
    jito_bought = 0
    jito_sold = 0
    usdc_spent = 0
    usdc_earned = 0
    total_fees_sol = 0
    
    if not df_trades.empty:
        buys = df_trades[df_trades['type'] == 'buy']
        sells = df_trades[df_trades['type'] == 'sell']
        
        jito_bought = buys['actual_swapped_out'].sum() if not buys.empty else 0
        jito_sold = sells['actual_swapped_in'].sum() if not sells.empty else 0
        usdc_spent = buys['actual_swapped_in'].sum() if not buys.empty else 0
        usdc_earned = sells['actual_swapped_out'].sum() if not sells.empty else 0
        total_fees_sol = df_trades['fee_sol'].sum() if 'fee_sol' in df_trades.columns else 0

    jitosol_change = jito_bought - jito_sold
    usdc_change = usdc_earned - usdc_spent

    # 4. Final Portfolio & TRUE PnL Calculation
    final_jito = initial_jito + jitosol_change
    final_usdc = initial_usdc + usdc_change
    
    final_total_value_usdc = (final_jito * last_price) + final_usdc
    
    current_sol_price = 145.00 # <-- UPDATE THIS TO CURRENT SOL PRICE
    fees_in_usdc = total_fees_sol * current_sol_price
    
    gross_pnl_usdc = final_total_value_usdc - initial_total_value_usdc
    true_net_pnl_usdc = gross_pnl_usdc - fees_in_usdc
    pnl_percentage = (true_net_pnl_usdc / initial_total_value_usdc) * 100 if initial_total_value_usdc > 0 else 0

    # 5. HODL vs BOT Calculation (Impermanent Loss Metric)
    # What if you just held the initial tokens and did nothing?
    hodl_current_value = (initial_jito * last_price) + initial_usdc
    hodl_pnl = hodl_current_value - initial_total_value_usdc
    bot_vs_hodl_diff = true_net_pnl_usdc - hodl_pnl

    # ==========================================
    # BUILD BEAUTIFUL UI REPORT (RICH)
    # ==========================================
    console.print("\n")
    console.print(Panel(Text("📈 GRID BOT STRATEGY & PNL REPORT", style="bold cyan", justify="center"), style="cyan"))
    
    # Table 1: Initial vs Final Inventory
    inv_table = Table(show_header=True, header_style="bold magenta", expand=True)
    inv_table.add_column("Metric", style="dim", width=20)
    inv_table.add_column("Initial State", justify="right")
    inv_table.add_column("Net Variation", justify="right")
    inv_table.add_column("Final State", justify="right", style="bold")
    
    inv_table.add_row(
        "JitoSOL Stack", 
        f"{initial_jito:.5f}", 
        f"[green if jitosol_change >= 0 else red]{'+' if jitosol_change >=0 else ''}{jitosol_change:.5f}[/]", 
        f"{final_jito:.5f}"
    )
    inv_table.add_row(
        "USDC Stack", 
        f"${initial_usdc:.2f}", 
        f"[green if usdc_change >= 0 else red]{'+' if usdc_change >=0 else ''}{usdc_change:.2f}[/]", 
        f"${final_usdc:.2f}"
    )
    inv_table.add_row("Reference Price", f"${start_price:.2f}", "-->", f"${last_price:.2f}")
    console.print(inv_table)

    # ------------------------------------------
    # NEW FEATURE: IN-TERMINAL GRAPHIC FOR ACCUMULATION
    # ------------------------------------------
    max_vol = max(jito_bought, jito_sold) if (jito_bought > 0 or jito_sold > 0) else 1
    bar_width = 40
    buy_bar = "█" * int((jito_bought / max_vol) * bar_width)
    sell_bar = "█" * int((jito_sold / max_vol) * bar_width)

    accum_pct = (jitosol_change / initial_jito) * 100 if initial_jito > 0 else 0
    accum_color = "bold green" if jitosol_change >= 0 else "bold red"

    graphic_text = Text()
    graphic_text.append(f"Volume Bought (+) : {buy_bar} {jito_bought:.5f} Jito\n", style="green")
    graphic_text.append(f"Volume Sold   (-) : {sell_bar} {jito_sold:.5f} Jito\n", style="red")
    graphic_text.append("-----------------------------------------------------------------------\n", style="dim")
    graphic_text.append(f"Net Accumulated from Spread: ", style="bold white")
    graphic_text.append(f"{'+' if jitosol_change >= 0 else ''}{jitosol_change:.5f} JitoSOL ({'+' if accum_pct >= 0 else ''}{accum_pct:.2f}% of start stack)", style=accum_color)
    
    console.print(Panel(graphic_text, title="📊 JitoSOL Accumulation Graph", border_style="purple"))

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