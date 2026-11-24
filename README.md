# BONAGO MT5 AI Trader

Android controller + Windows VPS trading engine for MetaTrader 5.

## Safety status
- Demo-only execution is enabled in this starter.
- Live execution is deliberately disabled until broker-specific testing, secure deployment, and explicit live-trading authorization are completed.
- Never put MT5 passwords, broker credentials, API keys, or server secrets in the Android app or GitHub source.

## Architecture
- Android: Kotlin + Jetpack Compose dashboard; controls the remote engine.
- Engine: Windows VPS running the official MetaTrader 5 desktop terminal and Python integration.
- Broker: any MT5 broker, configured by its exact server name and account credentials on the VPS.
- AI: signal provider is an optional future module. The starter does not let an LLM directly execute orders.

Official MT5 Python integration uses the installed desktop terminal. See https://www.mql5.com/en/docs/python_metatrader5 and https://www.metatrader5.com/en/metaeditor/help/development/python.

## Run the engine (Windows VPS)
1. Install MetaTrader 5 from your broker and log into a DEMO account.
2. Install Python 3.10+ (64-bit).
3. Copy `.env.example` to `.env`, set the terminal path, demo account login/server/password, and a long random `BOT_API_TOKEN`.
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

This is a starter implementation, not a promise of profitability. Backtest and forward-test on demo before considering live use.
