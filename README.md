<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AlphaHODL | Bot Analytics</title>
    <style>
        :root {
            --bg-color: #0d1117;
            --surface-color: #161b22;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --accent-live: #2ea043;
            --accent-soon: #f0883e;
            --border-color: #30363d;
        }

        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            line-height: 1.6;
        }

        header {
            text-align: center;
            padding: 4rem 2rem 2rem;
            border-bottom: 1px solid var(--border-color);
        }

        h1 {
            margin: 0;
            font-size: 2.5rem;
            color: #ffffff;
        }

        .subtitle {
            color: var(--text-secondary);
            font-size: 1.2rem;
            margin-top: 0.5rem;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        /* Analytics Gallery */
        .analytics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin-top: 2rem;
        }

        .card {
            background-color: var(--surface-color);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }

        .card img {
            width: 100%;
            height: auto;
            display: block;
            border-bottom: 1px solid var(--border-color);
        }

        .card-body {
            padding: 1.5rem;
        }

        .card-title {
            margin: 0 0 0.5rem 0;
            color: #ffffff;
            font-size: 1.2rem;
        }

        /* Markets Section */
        .markets {
            margin-top: 4rem;
            background-color: var(--surface-color);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 2rem;
        }

        .market-list {
            display: flex;
            flex-wrap: wrap;
            gap: 1.5rem;
            margin-top: 1.5rem;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            padding: 0.5rem 1rem;
            border-radius: 999px;
            font-weight: 600;
            font-size: 0.9rem;
            border: 1px solid;
        }

        .badge-live {
            color: var(--accent-live);
            border-color: var(--accent-live);
            background-color: rgba(46, 160, 67, 0.1);
        }

        .badge-live::before {
            content: "●";
            margin-right: 8px;
            animation: pulse 2s infinite;
        }

        .badge-soon {
            color: var(--accent-soon);
            border-color: var(--accent-soon);
            background-color: rgba(240, 136, 62, 0.1);
        }

        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.4; }
            100% { opacity: 1; }
        }
    </style>
</head>
<body>

    <header>
        <h1>⚔️ AlphaHODL Engine</h1>
        <p class="subtitle">Live Strategy Performance & Analytics</p>
    </header>

    <main class="container">
        
        <section class="markets">
            <h2>Supported Markets</h2>
            <p style="color: var(--text-secondary); margin-top: -10px;">Current and upcoming trading environments for the grid bot.</p>
            
            <div class="market-list">
                <div class="badge badge-live">
                    LIVE: Jito Staked SOL (JitoSOL) / USDC
                </div>
                <div class="badge badge-soon">
                    COMING SOON: NVDAx (Tokenized NVIDIA)
                </div>
                <div class="badge badge-soon">
                    COMING SOON: Tokenized Apple Stock (AAPL)
                </div>
            </div>
        </section>

        <section>
            <h2 style="margin-top: 3rem;">Performance Dashboards</h2>
            
            <div class="analytics-grid">
                <div class="card">
                    <img src="images/1.jpg" alt="Bot Accumulation vs HODL Metric">
                    <div class="card-body">
                        <h3 class="card-title">Strategy Execution vs. HODL</h3>
                        <p style="color: var(--text-secondary); margin: 0;">Tracking net accumulated asset spread and impermanent loss metrics over time.</p>
                    </div>
                </div>

                <div class="card">
                    <img src="images/2.jpg" alt="Transaction Timeline and Fees">
                    <div class="card-body">
                        <h3 class="card-title">Timeline & Fee Drain Tracker</h3>
                        <p style="color: var(--text-secondary); margin: 0;">Chronological breakdown of network fee impact and dynamic grid readjustments.</p>
                    </div>
                </div>
            </div>
        </section>

    </main>

</body>
</html>