# BONAGO — Deriv Auto Trader

BONAGO is a browser-based trading dashboard hosted as a Node.js web service on Render.

## Render environment

Configure these environment variables in the BONAGO Render service:

- `DERIV_CLIENT_ID`: your registered Deriv OAuth 2.0 Client ID (used for Deriv sign-in).
- `DERIV_APP_ID`: your numeric Deriv application ID (used in the `Deriv-App-ID` API header; keep it separate from the OAuth Client ID).
- `DERIV_ACCESS_TOKEN`: optional primary Deriv token; stored only in Render and checked first.
- `DERIV_DEMO_ACCESS_TOKEN`: optional Demo fallback token; used automatically if the primary token is missing, rejected, or cannot find the selected Demo account.
- `DERIV_REDIRECT_URI`: `https://bonago-1.onrender.com/auth/deriv/callback` (must exactly match the redirect URL registered with Deriv).
- `SESSION_SECRET`: a long, random secret. Render can generate this automatically from `render.yaml`.

Do not commit access tokens, OAuth credentials, or session secrets to GitHub.

## Deriv sign-in and connection

1. Register an OAuth 2.0 application with Deriv.
2. Register exactly `https://bonago-1.onrender.com/auth/deriv/callback` as its redirect URL.
3. Add the OAuth Client ID to Render as `DERIV_CLIENT_ID` and your numeric application ID as `DERIV_APP_ID`.
4. Deploy the service and open BONAGO.
5. Select **Sign in with Deriv**, approve the requested permissions, and select a Demo or Real account.
6. BONAGO's server exchanges the authorization code using PKCE, keeps the access token server-side, and requests a short-lived authenticated WebSocket URL for the selected account.

Token selection: BONAGO prefers `DERIV_ACCESS_TOKEN`; if it is absent, it automatically falls back to `DERIV_DEMO_ACCESS_TOKEN`. If neither is configured, it uses the secure Deriv OAuth sign-in session. The deployment remains server-locked to Demo accounts and never returns either token to the browser.

The browser never receives the long-lived OAuth access token. The OTP URL is short-lived and one-use; BONAGO requests a new one when the user reconnects. Deriv access tokens expire and Deriv does not issue refresh tokens, so users must sign in again after expiry.

## API migration status

The connection UI no longer asks for a legacy numeric App ID or a manually pasted API token. The server uses the current OAuth Bearer-token and account OTP flow. The frontend connects to the authenticated Options WebSocket returned by Deriv. Trading requests use the documented proposal, buy, tick-history, and open-contract message types.

The repository changes have not been validated against a live Deriv account from this environment. First connect a Demo account and verify balance, candle streaming, proposals, and contract monitoring before considering any Real-account use. A successful OAuth login alone does not prove that trading is functioning.

## Session storage limitation

OAuth sessions and pending PKCE state are currently held in the Node.js process memory. They are cleared when Render restarts the service and are not shared across multiple instances. A production multi-instance deployment should use a secure shared session store with encryption and expiry.

Trading is high risk. Demo-test thoroughly; no strategy guarantees profit.
