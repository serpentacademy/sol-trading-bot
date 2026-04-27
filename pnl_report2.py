import json
import glob
import os
import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from rich.layout import Layout

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
    last_price = bot_state.get('last_trade_price', start_price) # Fallback to start if missing
    initial_jito = bot_state.get('jitoSol_start_token_quantity', 0)
    initial_usdc = bot_state.get('USDC_start_token_quantity', 0)
    
    # 2. Part A: Initial Portfolio Value
    initial_jito_value_usdc = initial_jito * start_price
    initial_total_value_usdc = initial_jito_value_usdc + initial_usdc

    # 3. Part B: Calculate Variations from Trades
    jitosol_change = 0
    usdc_change = 0
    total_fees_sol = 0
    
    if not df_trades.empty:
        buys = df_trades[df_trades['type'] == 'buy']
        sells = df_trades[df_trades['type'] == 'sell']
        
        # JitoSOL variation
        jito_bought = buys['actual_swapped_out'].sum() if not buys.empty else 0
        jito_sold = sells['actual_swapped_in'].sum() if not sells.empty else 0
        jitosol_change = jito_bought - jito_sold
        
        # USDC variation
        usdc_spent = buys['actual_swapped_in'].sum() if not buys.empty else 0
        usdc_earned = sells['actual_swapped_out'].sum() if not sells.empty else 0
        usdc_change = usdc_earned - usdc_spent
        
        # Fees
        total_fees_sol = df_trades['fee_sol'].sum() if 'fee_sol' in df_trades.columns else 0

# ... (Keep everything above Step 4 the same) ...

    # 4. Final Portfolio Calculation
    final_jito = initial_jito + jitosol_change
    final_usdc = initial_usdc + usdc_change
    
    final_jito_value_usdc = final_jito * last_price
    final_total_value_usdc = final_jito_value_usdc + final_usdc
    
    # 5. TRUE PnL Calculation (Deducting SOL Fees)
    current_sol_price = 145.00 # <-- UPDATE THIS TO CURRENT SOL PRICE
    fees_in_usdc = total_fees_sol * current_sol_price
    
    gross_pnl_usdc = final_total_value_usdc - initial_total_value_usdc
    true_net_pnl_usdc = gross_pnl_usdc - fees_in_usdc
    
    pnl_percentage = (true_net_pnl_usdc / initial_total_value_usdc) * 100 if initial_total_value_usdc > 0 else 0

    # ==========================================
    # BUILD BEAUTIFUL UI REPORT (RICH)
    # ==========================================
    console.print("\n")
    
    # Header
    title = Text("📈 GRID BOT PNL REPORT", style="bold cyan", justify="center")
    console.print(Panel(title, style="cyan"))
    
    # Table 1: Initial vs Final Inventory
    inv_table = Table(show_header=True, header_style="bold magenta", expand=True)
    inv_table.add_column("Metric", style="dim", width=20)
    inv_table.add_column("Initial State", justify="right")
    inv_table.add_column("Net Variation", justify="right")
    inv_table.add_column("Final State", justify="right", style="bold")
    
    jito_var_style = "green" if jitosol_change >= 0 else "red"
    usdc_var_style = "green" if usdc_change >= 0 else "red"
    
    inv_table.add_row(
        "JitoSOL Stack", 
        f"{initial_jito:.5f}", 
        f"[{jito_var_style}]{'+' if jitosol_change >=0 else ''}{jitosol_change:.5f}[/]", 
        f"{final_jito:.5f}"
    )
    inv_table.add_row(
        "USDC Stack", 
        f"${initial_usdc:.2f}", 
        f"[{usdc_var_style}]{'+' if usdc_change >=0 else ''}{usdc_change:.2f}[/]", 
        f"${final_usdc:.2f}"
    )
    inv_table.add_row(
        "Reference Price", 
        f"${start_price:.2f}", 
        f"-->", 
        f"${last_price:.2f}"
    )
    
    console.print(inv_table)
    
    # Table 2: Valuation & PNL
    pnl_table = Table(show_header=True, header_style="bold yellow", expand=True)
    pnl_table.add_column("Portfolio Value", style="dim", width=20)
    pnl_table.add_column("In USDC", justify="right", style="bold")
    
    pnl_table.add_row("Starting Value", f"${initial_total_value_usdc:.2f}")
    pnl_table.add_row("Gross Current Value", f"${final_total_value_usdc:.2f}")
    
    console.print(pnl_table)
    
    # Final Result Panel
    pnl_color = "bold green" if true_net_pnl_usdc >= 0 else "bold red"
    pnl_sign = "+" if true_net_pnl_usdc >= 0 else ""
    
    result_text = Text()
    result_text.append(f"Gross PnL (Before Fees): ${gross_pnl_usdc:.2f}\n", style="dim white")
    result_text.append(f"Network Fees Paid:       {total_fees_sol:.6f} SOL (-${fees_in_usdc:.2f})\n", style="dim orange1")
    result_text.append("------------------------------------------------\n", style="dim")
    result_text.append(f"TRUE NET PNL:            ", style="bold white")
    result_text.append(f"{pnl_sign}${true_net_pnl_usdc:.2f} ({pnl_sign}{pnl_percentage:.2f}%)", style=pnl_color)
    
    console.print(Panel(result_text, title="Bottom Line (After Fees)", border_style=pnl_color))
    console.print("\n")

if __name__ == "__main__":
    generate_pnl_report()