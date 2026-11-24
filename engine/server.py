import os
import threading
from datetime import datetime, timezone
from typing import Optional

import MetaTrader5 as mt5
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException

load_dotenv()
app = FastAPI(title="BONAGO MT5 Engine", version="0.1.0")
running = False
state_lock = threading.Lock()

def authorize(token: Optional[str]):
    expected = os.getenv("BOT_API_TOKEN", "")
    if not expected or not token or token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

def connect_mt5():
    path = os.getenv("MT5_PATH") or None
    login = int(os.getenv("MT5_LOGIN", "0"))
    password = os.getenv("MT5_PASSWORD", "")
    server = os.getenv("MT5_SERVER", "")
    if not login or not password or not server:
        raise RuntimeError("MT5 demo credentials are not configured on the VPS")
    if not mt5.initialize(path, login=login, password=password, server=server):
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
    info = mt5.account_info()
    if info is None:
        mt5.shutdown()
        raise RuntimeError("Unable to read MT5 account")
    # Fail closed: this starter must only run on a broker demo account.
    if getattr(info, "trade_mode", -1) != mt5.ACCOUNT_TRADE_MODE_DEMO:
        mt5.shutdown()
        raise RuntimeError("Non-demo account detected. This starter is DEMO-ONLY; execution blocked.")
    return info

@app.get("/health")
def health():
    return {"service": "BONAGO MT5 Engine", "utc": datetime.now(timezone.utc).isoformat(), "configured": bool(os.getenv("BOT_API_TOKEN"))}

@app.get("/account")
def account(x_bot_token: Optional[str] = Header(default=None)):
    authorize(x_bot_token)
    try:
        info = connect_mt5()
        data = {"login": info.login, "server": info.server, "currency": info.currency,
                "balance": info.balance, "equity": info.equity, "profit": info.profit,
                "mode": "DEMO"}
        mt5.shutdown()
        return data
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

@app.get("/bot/status")
def bot_status(x_bot_token: Optional[str] = Header(default=None)):
    authorize(x_bot_token)
    with state_lock:
        return {"running": running, "mode": "DEMO", "live_enabled": False}

@app.post("/bot/start")
def bot_start(x_bot_token: Optional[str] = Header(default=None)):
    authorize(x_bot_token)
    # No order strategy is enabled until demo validation and broker-specific settings exist.
    raise HTTPException(status_code=409, detail="Execution is not enabled in this scaffold. Connect and validate a demo account, then add and test a strategy before enabling order placement.")

@app.post("/bot/stop")
def bot_stop(x_bot_token: Optional[str] = Header(default=None)):
    authorize(x_bot_token)
    global running
    with state_lock:
        running = False
    return {"running": False, "message": "New entries stopped"}
