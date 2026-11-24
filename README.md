# BONAGO MT5 AI Trader

Android controller + Windows VPS trading engine for MetaTrader 5.

## Safety status
- Demo-only execution is enabled in this starter.
- Live execution is deliberately disabled until broker-specific testing, secure deployment, and explicit live-trading authorization are completed.
- Never put MT5 passwords, broker credentials, API keys, or server secrets in the Android app or GitHub source.

## Architecture
- Android: Kotlin + Jetpack Compose dashboard; controls the remote engine.
- Engine: Windows VPS running the official MetaTrader 5 desktop terminal and Python integration.
- Broker: broker-independent. Use any broker that provides an MT5 trading account; install that broker's MT5 terminal (or a compatible MT5 terminal) and enter the exact account server name and credentials on the VPS. No broker is hard-coded.
- AI: signal provider is an optional future module. The starter does not let an LLM directly execute orders.

Official MT5 Python integration uses the installed desktop terminal. See https://www.mql5.com/en/docs/python_metatrader5 and https://www.metatrader5.com/en/metaeditor/help/development/python.

## Run the engine (Windows VPS)
1. Install MetaTrader 5 from your broker and log into a DEMO account.
2. Install Python 3.10+ (64-bit).
3. Copy `.env.example` to `.env`, set the terminal path, demo account login, password, and the exact `MT5_SERVER` value shown in the broker's MT5 login/server list. Set a long random `BOT_API_TOKEN`. The same engine configuration works with different MT5 brokers by changing these VPS environment values; do not add credentials to GitHub source or the Android app.
4. Install: `python -m pip install -r requirements.txt`
5. Run: `uvicorn server:app --host 0.0.0.0 --port 8000`
6. Put the API behind HTTPS (reverse proxy/VPN/firewall). Do not expose port 8000 publicly without TLS and access controls.

## Android
Open this repository in Android Studio. Set the engine HTTPS URL and API token using a secure local configuration mechanism before connecting. Do not commit either value.

## Current API
- `GET /health` — engine/terminal status
- `GET /account` — demo account summary
- `POST /bot/start` — starts the guarded demo loop
- `POST /bot/stop` — stops new entries
- `GET /bot/status` — bot status

The current engine is DEMO-ONLY and rejects non-demo accounts. Switching brokers is supported through VPS configuration, but the Android dashboard is not yet wired to submit broker credentials or control the engine end-to-end. This is a starter implementation, not a promise of profitability. Backtest and forward-test on demo before considering live use.
