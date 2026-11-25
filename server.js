const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const ROOT = __dirname;
const DERIV_CLIENT_ID = process.env.DERIV_CLIENT_ID || "";
const DERIV_REDIRECT_URI = process.env.DERIV_REDIRECT_URI || "https://bonago-1.onrender.com/auth/deriv/callback";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const pendingOAuth = new Map();
const sessions = new Map();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store");
  next();
});

function b64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  const part = raw.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
function signedCookie(value) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
  return value + "." + sig;
}
function verifyCookie(value) {
  const i = value.lastIndexOf(".");
  if (i < 1) return null;
  const raw = value.slice(0, i), sig = value.slice(i + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(raw).digest();
  let actual;
  try { actual = Buffer.from(sig, "base64url"); } catch { return null; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? raw : null;
}

app.get("/health", (_req, res) => res.status(200).json({
  ok: true,
  service: "BONAGO",
  derivOAuthConfigured: Boolean(DERIV_CLIENT_ID && SESSION_SECRET)
}));

// OAuth client configuration stays on the server. The client ID is public OAuth metadata;
// access tokens and PKCE verifiers are never returned by this endpoint.
app.get("/api/config", (_req, res) => res.json({
  derivOAuthConfigured: Boolean(DERIV_CLIENT_ID && SESSION_SECRET),
  redirectUri: DERIV_REDIRECT_URI
}));

app.get("/auth/deriv", (req, res) => {
  if (!DERIV_CLIENT_ID || !SESSION_SECRET) {
    return res.status(503).send("BONAGO is not configured. Add DERIV_CLIENT_ID and SESSION_SECRET to Render environment variables.");
  }
  const state = b64url(crypto.randomBytes(32));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  pendingOAuth.set(state, { verifier, createdAt: Date.now() });
  for (const [key, value] of pendingOAuth) if (Date.now() - value.createdAt > 10 * 60 * 1000) pendingOAuth.delete(key);

  const url = new URL("https://auth.deriv.com/oauth2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", DERIV_CLIENT_ID);
  url.searchParams.set("redirect_uri", DERIV_REDIRECT_URI);
  url.searchParams.set("scope", "trade account_manage");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  res.redirect(url.toString());
});

app.get("/auth/deriv/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send("Deriv authorization was not completed. Return to BONAGO and try again.");
  const pending = pendingOAuth.get(String(state || ""));
  pendingOAuth.delete(String(state || ""));
  if (!code || !pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    return res.status(400).send("Deriv sign-in could not be verified. Please restart the connection from BONAGO.");
  }
  try {
    const response = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: DERIV_CLIENT_ID,
        code: String(code),
        code_verifier: pending.verifier,
        redirect_uri: DERIV_REDIRECT_URI
      })
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      console.error("Deriv OAuth token exchange failed:", response.status);
      return res.status(502).send("Deriv sign-in could not be completed. Check the registered redirect URL and Client ID in Render.");
    }
    const sessionId = crypto.randomBytes(32).toString("base64url");
    sessions.set(sessionId, { accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 0) * 1000 });
    res.setHeader("Set-Cookie", "bonago_sid=" + encodeURIComponent(signedCookie(sessionId)) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + Math.max(60, Number(data.expires_in || 0)));
    return res.redirect("/?deriv=connected");
  } catch (e) {
    console.error("Deriv OAuth callback error:", e.message);
    return res.status(502).send("Could not reach Deriv authentication. Please try again.");
  }
});

app.get("/api/deriv/status", (req, res) => {
  const sid = verifyCookie(cookieValue(req, "bonago_sid"));
  const session = sid && sessions.get(sid);
  if (!session || session.expiresAt <= Date.now()) {
    if (sid) sessions.delete(sid);
    return res.json({ connected: false });
  }
  res.json({ connected: true });
});

app.post("/auth/deriv/logout", (req, res) => {
  const sid = verifyCookie(cookieValue(req, "bonago_sid"));
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "bonago_sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

app.use(express.static(ROOT, {
  index: "index.html",
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (path.basename(filePath) === "index.html") {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  }
}));

app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BONAGO web service listening on 0.0.0.0:${PORT}`);
});
