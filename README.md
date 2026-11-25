# BONAGO — Deriv Auto Trader

BONAGO is a browser-based trading dashboard hosted as a Node.js web service on Render.

## Render environment

Configure these environment variables in the BONAGO Render service:

- `DERIV_CLIENT_ID`: your Deriv registered OAuth 2.0 Client ID.
- `DERIV_REDIRECT_URI`: `https://bonago-1.onrender.com/auth/deriv/callback` (must exactly match the redirect URL registered in your Deriv developer dashboard).
- `SESSION_SECRET`: a long, random secret. Render can generate this automatically from `render.yaml`.

Do not commit OAuth credentials, access tokens, or session secrets to GitHub. The server reads these values from `process.env`.

## OAuth setup

1. Register an OAuth 2.0 application with Deriv.
2. Whitelist exactly `https://bonago-1.onrender.com/auth/deriv/callback`.
3. Add the Client ID as `DERIV_CLIENT_ID` in Render.
4. Deploy and open `https://bonago-1.onrender.com/auth/deriv` to begin the OAuth Authorization Code + PKCE flow.

BONAGO exchanges the authorization code on the server and keeps the access token out of browser JavaScript. Deriv does not issue refresh tokens; users must authenticate again when the access token expires.

## Important status

This commit adds the Render environment configuration and secure OAuth sign-in foundation. The existing trading screen still uses the older WebSocket v3 App ID + manually entered token flow; it is **not yet migrated** to the new authenticated Options API WebSocket OTP flow. Do not treat OAuth sign-in alone as proof that automated trading is connected. The next integration step is to load the authorized Deriv account, request its one-time WebSocket URL from the server, and update trading requests to the current API.

Trading is high risk. Demo-test thoroughly; no strategy guarantees profit.
