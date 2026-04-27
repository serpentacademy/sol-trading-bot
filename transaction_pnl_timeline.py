import json
import glob
import os
import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

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
    
    df = pd.DataFrame(trades)
    if not df.empty:
        # CRITICAL: Sort chronologically to simulate timeline accurately
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp').reset_index(drop=True)
    return df

def generate_timeline_report():
    console = Console()
    
    bot_state = load_bot_state()
    if not bot_state:
        return
        
    df_trades = load_trades()
    if df_trades.empty:
        console.print("[red]No successful trades found to analyze.[/red]")
        return
        
    initial_jito = bot_state.get('jitoSol_start_token_quantity', 0)
    initial_usdc = bot_state.get('USDC_start_token_quantity', 0)
    start_price = bot_state.get('start_price', 0)
    
    # Define SOL price for historical fee deduction (You can update this)
    SOL_PRICE_ASSUMPTION = 145.00 

    console.print("\n")
    console.print(Panel(Text("⏳ TRANSACTION TIMELINE: PNL & EXIT SCENARIOS", style="bold cyan", justify="center"), style="cyan"))

    # Create the Rich Table
    table = Table(show_header=True, header_style="bold magenta", expand=True)
    table.add_column("Time", style="dim", width=18)
    table.add_column("Type", justify="center", width=6)
    table.add_column("Trade Price", justify="right")
    table.add_column("Inv: JitoSOL", justify="right")
    table.add_column("Inv: USDC", justify="right")
    table.add_column("Bot Value", justify="right", style="bold")
    table.add_column("HODL Value", justify="right", style="dim")
    table.add_column("Exit vs HODL (IL)", justify="right", style="bold")

    # Running Totals
    running_jito = initial_jito
    running_usdc = initial_usdc
    running_fees_sol = 0

    # Process row by row in chronological order
    for index, row in df_trades.iterrows():
        trade_type = row['type'].upper()
        current_price = row['price_usdc']
        
        # 1. Update Inventory Based on Trade
        if trade_type == 'BUY':
            running_jito += row.get('actual_swapped_out', 0)
            running_usdc -= row.get('actual_swapped_in', 0)
        elif trade_type == 'SELL':
            running_jito -= row.get('actual_swapped_in', 0)
            running_usdc += row.get('actual_swapped_out', 0)

        # 2. Update Fees
        running_fees_sol += row.get('fee_sol', 0)
        cumulative_fees_usd = running_fees_sol * SOL_PRICE_ASSUMPTION

        # 3. Calculate Valuations exactly at this timestamp
        bot_current_value = (running_jito * current_price) + running_usdc - cumulative_fees_usd
        hodl_current_value = (initial_jito * current_price) + initial_usdc
        
        # 4. Compare: What if we exited right now?
        exit_vs_hodl = bot_current_value - hodl_current_value
        
        # Formatting for UI
        time_str = row['timestamp'].strftime('%Y-%m-%d %H:%M')
        type_color = "green" if trade_type == 'BUY' else "red"
        type_str = f"[{type_color}]{trade_type}[/]"
        
        il_color = "green" if exit_vs_hodl >= 0 else "red"
        il_sign = "+" if exit_vs_hodl >= 0 else ""
        il_str = f"[{il_color}]{il_sign}${exit_vs_hodl:.2f}[/]"
        
        table.add_row(
            time_str,
            type_str,
            f"${current_price:.2f}",
            f"{running_jito:.4f}",
            f"${running_usdc:.2f}",
            f"${bot_current_value:.2f}",
            f"${hodl_current_value:.2f}",
            il_str
        )

    console.print(table)
    
    # Print a final summary at the bottom
    final_exit_vs_hodl = bot_current_value - hodl_current_value
    summary_color = "bold green" if final_exit_vs_hodl >= 0 else "bold red"
    summary_text = "BOT IS WINNING" if final_exit_vs_hodl >= 0 else "EXPERIENCING IMPERMANENT LOSS"
    
    console.print(f"\n[bold]Current Status:[/] [{summary_color}]{summary_text}[/] (If you stop now, you are {'up' if final_exit_vs_hodl >= 0 else 'down'} ${abs(final_exit_vs_hodl):.2f} compared to holding)")
    console.print(f"[dim]Total Fees Deducted in Timeline: {running_fees_sol:.6f} SOL (~${cumulative_fees_usd:.2f})[/]\n")

if __name__ == "__main__":
    generate_timeline_report()