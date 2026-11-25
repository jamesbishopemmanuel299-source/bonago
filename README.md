# BONAGO — Deriv Auto Trader

A browser-based, demo-first Deriv trading dashboard. It connects through Deriv's legacy WebSocket v3 API and can submit Rise/Fall CALL/PUT contracts when the included EMA crossover strategy signals.

## Run
Open `index.html` from a static web host (HTTPS recommended). The app uses no server and has no build step.

## Connect
1. Create a Deriv application and enter its numeric App ID.
2. Create an API token with **Read** and **Trade** permissions only.
3. Paste the token into the password field and choose Demo mode.
4. Connect, verify the account shown, configure stake/market/risk limits, then start.

The token is kept only in the active page memory and is not sent to BONAGO servers or saved to browser storage. Do not use a shared/public device. Disconnect when finished.

## Strategy
- One-minute candle close prices.
- Fast/slow EMA crossover: fast crossing above slow triggers CALL; crossing below triggers PUT.
- One open contract at a time; configurable contract duration and cooldown.
- Session stops at the configured max trade count, loss limit, or profit target.
- Stake is capped at 5% of the last balance returned by authorization.

This is a simple example strategy, not a validated or profitable system. Backtest and paper-trade before considering live execution. A stop button prevents new trades; it cannot guarantee cancellation of an already purchased contract.

## Live mode
Demo is the default. To use a real account, select Live mode, tick the explicit live-risk authorization checkbox, reconnect with a token authorized for the real account, review the account ID and balance, then press Start and confirm. Live trading can lose the entire stake on each contract.

## Important limitations
- The bot runs only while this browser tab remains open and connected. It is not a VPS/cloud 24/7 service.
- No guaranteed profits, no martingale, and no automatic recovery after a disconnect.
- Verify the current Deriv API requirements and your account's available contract types before use. Deriv's current documentation describes authenticated trading operations and contract proposals/buys.

## API
- Deriv WebSocket v3: `wss://ws.derivws.com/websockets/v3?app_id=...`
- Trading API docs: https://developers.deriv.com/docs/trading/
- Workflow docs: https://developers.deriv.com/docs/workflows/

BONAGO is experimental software, not financial advice. You are responsible for monitoring your account and trades.
