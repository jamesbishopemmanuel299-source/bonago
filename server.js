const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const ROOT = __dirname;
const DERIV_CLIENT_ID = process.env.DERIV_CLIENT_ID || "";
const DERIV_APP_ID = process.env.DERIV_APP_ID || "";
const DERIV_ACCESS_TOKEN = process.env.DERIV_ACCESS_TOKEN || "";
const DERIV_REDIRECT_URI = process.env.DERIV_REDIRECT_URI || "https://bonago-1.onrender.com/auth/deriv/callback";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const DEMO_ONLY = true; // Server-enforced: this deployment cannot authorize Real accounts.

// Deriv PAT requests require Deriv-App-ID. For this deployment, use the configured
// client/app identifier without exposing it to the browser.
function derivHeaders(accessToken = DERIV_ACCESS_TOKEN, extra = {}) {
  return {
    Authorization: "Bearer " + accessToken,
    ...((DERIV_APP_ID || DERIV_CLIENT_ID) ? { "Deriv-App-ID": DERIV_APP_ID || DERIV_CLIENT_ID } : {}),
    ...extra
  };
}
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
  derivOAuthConfigured: Boolean(DERIV_CLIENT_ID && SESSION_SECRET),
  derivSecretConfigured: Boolean((DERIV_APP_ID || DERIV_CLIENT_ID) && DERIV_ACCESS_TOKEN),
  derivAppIdConfigured: Boolean(DERIV_APP_ID || DERIV_CLIENT_ID),
  mode: "demo-only"
}));

// OAuth client configuration stays on the server. The client ID is public OAuth metadata;
// access tokens and PKCE verifiers are never returned by this endpoint.
app.get("/api/config", (_req, res) => res.json({
  derivOAuthConfigured: Boolean(DERIV_CLIENT_ID && SESSION_SECRET),
  derivAppIdConfigured: Boolean(DERIV_APP_ID || DERIV_CLIENT_ID),
  mode: "demo-only",
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

function getDerivSession(req) {
  if ((DERIV_APP_ID || DERIV_CLIENT_ID) && DERIV_ACCESS_TOKEN) return { accessToken: DERIV_ACCESS_TOKEN, expiresAt: Number.MAX_SAFE_INTEGER };
  const sid = verifyCookie(cookieValue(req, "bonago_sid"));
  const session = sid && sessions.get(sid);
  if (!session || session.expiresAt <= Date.now()) {
    if (sid) sessions.delete(sid);
    return null;
  }
  return session;
}

app.get("/api/deriv/accounts", async (req, res) => {
  const session = getDerivSession(req);
  if (!session) return res.status(401).json({ error: "Connect your Deriv account first." });
  try {
    const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: derivHeaders(session.accessToken)
    });
    const body = await response.json();
    if (!response.ok) {
      const message = body.errors?.[0]?.message || "Could not load Deriv accounts.";
      console.error("Deriv accounts API rejected request:", response.status, message);
      return res.status(response.status).json({ error: message, code: body.errors?.[0]?.code || "DerivAPIError", upstreamStatus: response.status });
    }
    const raw = body.data?.accounts || body.data || [];
    const accounts = (Array.isArray(raw) ? raw : []).map(account => ({
      account_id: account.account_id || account.id,
      account_type: account.account_type || account.account_category || (account.is_virtual ? "demo" : "real"),
      currency: account.currency || "USD",
      balance: Number(account.balance || 0),
      loginid: account.loginid || account.account_id || account.id,
      is_virtual: account.is_virtual === true || String(account.account_type || account.account_category || "").toLowerCase() === "demo"
    })).filter(account => account.account_id && account.is_virtual);
    return res.json({ accounts, mode: "demo-only" });
  } catch (error) {
    console.error("Deriv accounts request failed:", error.message);
    return res.status(502).json({ error: "Could not reach Deriv account service." });
  }
});

app.post("/api/deriv/otp", express.json(), async (req, res) => {
  const session = getDerivSession(req);
  if (!session) return res.status(401).json({ error: "Your Deriv session has expired. Connect again." });
  const accountId = String(req.body?.accountId || "");
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(accountId)) return res.status(400).json({ error: "Choose a valid Deriv Demo account." });
  try {
    // Re-check account type on the server; never trust the browser's selected account or mode.
    const accountsResponse = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: derivHeaders(session.accessToken)
    });
    const accountsBody = await accountsResponse.json();
    if (!accountsResponse.ok) return res.status(502).json({ error: "Could not verify the selected Deriv account type." });
    const rawAccounts = accountsBody.data?.accounts || accountsBody.data || [];
    const selected = (Array.isArray(rawAccounts) ? rawAccounts : []).find(a => String(a.account_id || a.id || "") === accountId);
    const isVirtual = selected && (selected.is_virtual === true || String(selected.account_type || selected.account_category || "").toLowerCase() === "demo");
    if (DEMO_ONLY && !isVirtual) return res.status(403).json({ error: "BONAGO is locked to Demo accounts. Real-account connections are disabled." });
    if (!selected) return res.status(404).json({ error: "The selected account was not found on this Deriv login." });
    const response = await fetch("https://api.derivws.com/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp", {
      method: "POST",
      headers: derivHeaders(session.accessToken)
    });
    const body = await response.json();
    if (!response.ok || !body.data?.url) {
      const message = body.errors?.[0]?.message || "Could not create an authenticated Deriv connection.";
      console.error("Deriv OTP API rejected request:", response.status, message);
      return res.status(response.status || 502).json({ error: message, code: body.errors?.[0]?.code || "DerivOTPError", upstreamStatus: response.status });
    }
    return res.json({ url: body.data.url });
  } catch (error) {
    console.error("Deriv OTP request failed:", error.message);
    return res.status(502).json({ error: "Could not reach Deriv authentication service." });
  }
});

app.get("/api/deriv/status", (req, res) => {
  if ((DERIV_APP_ID || DERIV_CLIENT_ID) && DERIV_ACCESS_TOKEN) return res.json({ connected: true, source: "render-secrets" });
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

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function groqFailure(status, body) {
  const rawCode = body?.error?.code || body?.error?.type || "";
  const rawMessage = String(body?.error?.message || "No provider detail returned").replace(/[\\r\\n\\t]+/g, " ").slice(0, 240);
  const message = rawMessage.toLowerCase();
  const detail = { providerStatus: status, providerCode: String(rawCode).slice(0, 80), providerMessage: rawMessage };
  if (status === 401 || status === 403) return { status: 503, code: "GROQ_AUTH", message: "Groq rejected GROQ_API_KEY. Check the key in Render Environment and redeploy.", ...detail };
  if (status === 429 || /rate limit|quota|tokens per|requests per/.test(message)) return { status: 503, code: "GROQ_LIMIT", message: "Groq rate limit or account quota reached. Check Groq usage and limits, then retry.", ...detail };
  if (/model/.test(message) || rawCode === "model_not_found") return { status: 503, code: "GROQ_MODEL", message: "Groq model is unavailable or not enabled for this key. Check GROQ_MODEL in Render.", ...detail };
  if (status >= 500) return { status: 503, code: "GROQ_UPSTREAM", message: "Groq is temporarily unavailable. No trade was placed.", ...detail };
  return { status: 503, code: "GROQ_REQUEST", message: "Groq rejected the request. See provider detail for the exact reason.", ...detail };
}
async function groqChat(payload) {
  if (!GROQ_API_KEY) throw Object.assign(new Error("Add GROQ_API_KEY to Render Environment, then redeploy."), { publicCode: "GROQ_KEY_MISSING" });
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + GROQ_API_KEY, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(payload)
      });
    } catch (error) {
      if (attempt === 0 && (error.name === "TimeoutError" || error.name === "TypeError")) {
        await new Promise(resolve => setTimeout(resolve, 700));
        continue;
      }
      throw Object.assign(new Error(error.name === "TimeoutError" ? "Groq timed out twice. No trade was placed." : "Could not reach Groq. Check Render outbound connectivity. No trade was placed."), { publicCode: "GROQ_NETWORK" });
    }
    if (response.ok) return response.json();
    let body = {};
    try { body = await response.json(); } catch {}
    const failure = groqFailure(response.status, body);
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const retryAfter = Math.min(2, Math.max(0.5, Number(response.headers.get("retry-after")) || 1));
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    throw Object.assign(new Error(failure.message), { publicCode: failure.code, providerStatus: failure.providerStatus, providerCode: failure.providerCode, providerMessage: failure.providerMessage });
  }
  throw Object.assign(new Error("Groq did not respond after retry. No trade was placed."), { publicCode: "GROQ_RETRY" });
}

app.get("/api/ai/status", async (_req, res) => {
  if (!GROQ_API_KEY) return res.status(503).json({ configured: false, healthy: false, provider: "Groq", model: GROQ_MODEL, code: "GROQ_KEY_MISSING", message: "GROQ_API_KEY is missing from Render Environment." });
  try {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: "Bearer " + GROQ_API_KEY },
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) return res.json({ configured: true, healthy: true, provider: "Groq", model: GROQ_MODEL, message: "Groq connection healthy." });
    let body = {}; try { body = await response.json(); } catch {}
    const failure = groqFailure(response.status, body);
    return res.status(failure.status).json({ configured: true, healthy: false, provider: "Groq", model: GROQ_MODEL, code: failure.code, message: failure.message, providerStatus: failure.providerStatus, providerCode: failure.providerCode, providerMessage: failure.providerMessage });
  } catch (error) {
    return res.status(503).json({ configured: true, healthy: false, provider: "Groq", model: GROQ_MODEL, code: "GROQ_NETWORK", message: "Could not reach Groq. Check Render outbound connectivity." });
  }
});

app.post("/api/ai/analyze", express.json({limit:"32kb"}), async (req,res) => {
 if (!getDerivSession(req)) return res.status(401).json({error:"Connect Deriv Demo first."});
 const symbol=String(req.body?.symbol||""); const candles=req.body?.candles;
 if (!/^[A-Za-z0-9_]{2,24}$/.test(symbol) || !Array.isArray(candles) || candles.length<20 || candles.length>60) return res.status(400).json({error:"Need 20–60 recent candles."});
 const data=candles.map(c=>({open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)}));
 if(data.some(c=>!Object.values(c).every(Number.isFinite)||c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))) return res.status(400).json({error:"Invalid candles."});
 try {
  const b=await groqChat({model:GROQ_MODEL,reasoning_effort:"medium",temperature:0.1,max_completion_tokens:500,messages:[{role:"system",content:"Cautious technical analyst. Use only supplied OHLC candles. Never promise profit. Prefer HOLD if evidence is mixed or weak. CALL means up, PUT means down. Confidence 0-100 is only an estimate. Flag high volatility, conflicting momentum or insufficient evidence. Never advise bypassing risk controls."},{role:"user",content:"Analyse one-minute candles for "+symbol+", oldest to newest: "+JSON.stringify(data)}],response_format:{type:"json_schema",json_schema:{name:"bonago_decision",strict:true,schema:{type:"object",properties:{action:{type:"string",enum:["CALL","PUT","HOLD"]},confidence:{type:"integer"},rationale:{type:"string"},risk_flags:{type:"array",items:{type:"string"}}},required:["action","confidence","rationale","risk_flags"],additionalProperties:false}}}});
  const d=JSON.parse(b.choices?.[0]?.message?.content||"{}");
  if(!["CALL","PUT","HOLD"].includes(d.action)||!Number.isInteger(d.confidence)||d.confidence<0||d.confidence>100||typeof d.rationale!=="string"||!Array.isArray(d.risk_flags)) return res.status(502).json({error:"Invalid AI decision. No trade was placed.",code:"GROQ_INVALID_OUTPUT"});
  return res.json({...d,model:GROQ_MODEL,provider:"Groq"});
 } catch(e) { console.error("Groq analysis failed:", JSON.stringify({code:e.publicCode||"GROQ_FAILURE",providerStatus:e.providerStatus,providerCode:e.providerCode,providerMessage:e.providerMessage||e.message})); return res.status(503).json({error:e.message||"Groq unavailable; no trade placed.",code:e.publicCode||"GROQ_FAILURE",providerStatus:e.providerStatus,providerCode:e.providerCode,providerMessage:e.providerMessage}); }
});

app.post("/api/ai/command", express.json({limit:"8kb"}), async (req,res) => {
  if (!getDerivSession(req)) return res.status(401).json({error:"Connect Deriv Demo first."});
  const command=String(req.body?.command||"").trim();
  if (!command || command.length>3000) return res.status(400).json({error:"Enter a command under 3,000 characters."});
  try {
    const body=await groqChat({model:GROQ_MODEL,reasoning_effort:"medium",temperature:0.1,max_completion_tokens:500,
      messages:[
        {role:"system",content:"You are BONAGO, a cautious Deriv Demo trading-command parser. Convert the user's command into settings only. Never promise profit. Never select live trading. Never invent market prices or claim to have analysed live candles. Set intent=start ONLY if the user explicitly commands starting/activating/automatically trading now. intent=stop for explicit stop commands. intent=analyze for analyse/check/forecast requests. Otherwise configure. The user may request any exact symbol currently listed by Deriv. Return the requested symbol exactly as written, using a safe symbol identifier (letters, digits, underscore; 2-32 chars). Never invent or silently substitute a symbol. The frontend verifies the symbol against the live Deriv catalogue. timeframe is one-minute candles only (60 seconds). duration_minutes allowed 1,3,5. Stake must be 0.35 to 100, max_trades 1 to 20, loss_limit and profit_target 0.01 to 1000. Use conservative defaults when omitted: R_75, stake 1, duration 1, max_trades 3, loss_limit 3, profit_target 2. Never override user values with larger risk. If unclear, use defaults and explain assumptions. Return only schema."},
        {role:"user",content:command}
      ],
      response_format:{type:"json_schema",json_schema:{name:"bonago_command",strict:true,schema:{type:"object",properties:{
        intent:{type:"string",enum:["configure","start","stop","analyze"]},
        symbol:{type:"string"},
        stake:{type:"number",minimum:0.35,maximum:100},
        duration_minutes:{type:"integer",enum:[1,3,5]},
        max_trades:{type:"integer",minimum:1,maximum:20},
        loss_limit:{type:"number",minimum:0.01,maximum:1000},
        profit_target:{type:"number",minimum:0.01,maximum:1000},
        rationale:{type:"string"}
      },required:["intent","symbol","stake","duration_minutes","max_trades","loss_limit","profit_target","rationale"],additionalProperties:false}}}
    });
    const parsed=JSON.parse(body.choices?.[0]?.message?.content||"{}");
    if(parsed.intent==="start" && !/\b(start|start trading|activate|enable|begin|trade automatically|turn on)\b/i.test(command)) parsed.intent="configure";
    if(parsed.intent==="stop" && !/\b(stop|halt|disable|turn off|emergency)\b/i.test(command)) parsed.intent="configure";
    if(!["configure","start","stop","analyze"].includes(parsed.intent)||!/^[A-Za-z0-9_]{2,32}$/.test(parsed.symbol)||![1,3,5].includes(parsed.duration_minutes)||!Number.isFinite(parsed.stake)||parsed.stake<0.35||parsed.stake>100||!Number.isInteger(parsed.max_trades)||parsed.max_trades<1||parsed.max_trades>20||!Number.isFinite(parsed.loss_limit)||parsed.loss_limit<=0||!Number.isFinite(parsed.profit_target)||parsed.profit_target<=0) return res.status(502).json({error:"The AI returned invalid settings. No changes were made.",code:"GROQ_INVALID_OUTPUT"});
    return res.json({...parsed,model:GROQ_MODEL,mode:"demo-only"});
  } catch(e) { console.error("Groq command parse failed:", JSON.stringify({code:e.publicCode||"GROQ_FAILURE",providerStatus:e.providerStatus,providerCode:e.providerCode,providerMessage:e.providerMessage||e.message})); return res.status(503).json({error:e.message||"AI command service unavailable. No trade was placed.",code:e.publicCode||"GROQ_FAILURE",providerStatus:e.providerStatus,providerCode:e.providerCode,providerMessage:e.providerMessage}); }
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
