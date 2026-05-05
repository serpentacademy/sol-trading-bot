<div align="center">
  <h1>⚔️ AlphaHODL Engine</h1>
  <p><b>24/7 Automated Grid Accumulation on Solana</b></p>
  <p><i>Open-Source • High-Frequency • Yield-Focused</i></p>
  <br>
</div>

## 🌍 Supported Markets
*Current trading environments utilizing Jito-Bundles and Tokenized Stocks:*

🟢 **LIVE:** `Jito Staked SOL (JitoSOL) / USDC`  
🟢 **LIVE:** `NVDAx (Tokenized NVIDIA) / USDC`  
🟠 **COMING SOON:** `Tokenized Apple Stock (AAPL)`

---

## 📊 Performance Analytics

<table align="center">
  <tr>
    <td align="center" width="50%">
      <img src="images/1.jpg" alt="Bot Accumulation vs HODL Metric" width="100%">
      <br><br>
      <b>Strategy Execution vs. HODL</b>
      <br>
      <sub>Tracking net accumulated asset spread and impermanent loss metrics over time.</sub>
    </td>
    <td align="center" width="50%">
      <img src="images/2.jpg" alt="Transaction Timeline and Fees" width="100%">
      <br><br>
      <b>Timeline & Fee Drain Tracker</b>
      <br>
      <sub>Chronological breakdown of network fee impact and dynamic grid readjustments.</sub>
    </td>
  </tr>
</table>

### 🛡️ AlphaHODL Logic: TRUE NET PnL
The engine calculates performance based on **Opportunity Cost**.
*   **BOT vs HODL METRIC:** If the Bot "Beats the Market," it means the automated grid rebalancing generated enough quote currency (USDC) and compounding fees to outperform simply holding the base asset during the same volatility window. 
*   **Accumulation Focus:** The bot prioritizes increasing the total unit count of `JitoSOL` or `NVDAx` regardless of USD fluctuations.

---

## 🛠️ Implementation & Scripts

This project is open-source. Use the following scripts to initialize the bots and generate analytics.

### ⚡ Execution Engines
| Script | Command | Description |
| :--- | :--- | :--- |
| **Jito Grid** | `npx tsx GridBot.ts` | Runs the 24/7 JitoSOL/USDC grid accumulator. |
| **NVDA Grid** | `npx tsx GridBotNVDA.ts` | Runs the 24/7 NVDAx/USDC grid accumulator. |
| **Data Sync** | `npx tsx updateTrades.ts` | Fetches latest on-chain transaction details and logs. |

### 📈 Reporting & Visualization
| Script | Command | Description |
| :--- | :--- | :--- |
| **Visualizer** | `python graphTrades.py` | Generates technical charts of trade execution points. |
| **Jito Report** | `python pnl_reportvsHODL.py` | Calculates True Net PnL vs HODL for JitoSOL. |
| **NVDA Report** | `python pnl_reportvsHODLNVDA.py` | Calculates True Net PnL vs HODL for NVDAx. |

---

## 🤝 Collaboration & Open Source
This is a community-driven project. We encourage:
1. **Forking** the repo to test new grid parameters.
2. **PRs** for new tokenized asset pairs.
3. **Optimizing** the Python PnL engine for better tax-lot reporting.

---

## ⚠️ Disclaimer (NAFA)
**Not Financial Advice (NAFA).** AlphaHODL Engine is an experimental open-source tool. Cryptocurrency and tokenized assets involve high risk. Automated bots can fail due to smart contract bugs, API downtime, or extreme market volatility. Use at your own risk.

<div align="center">
  <sub><i>Data is updated automatically via the Python PnL engine.</i></sub>
</div>