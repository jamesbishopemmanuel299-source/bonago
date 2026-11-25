const $=id=>document.getElementById(id);
let ws=null,req=0,pending=new Map(),authorized=null,accountBalance=0,botRunning=false,historySub=null,tickSub=null,openContract=null,lastCandleEpoch=null,sessionProfit=0,tradeCount=0,winCount=0,lossCount=0,lastTradeAt=0,prices=[],candleData=[],lastFast=null,lastSlow=null,sessionStart=0,portfolioRows=[],transactionSub=null,aiRequestInFlight=false,previousSymbol="";
const log=(m)=>{const row=document.createElement("div");row.className="logrow";row.textContent=new Date().toLocaleTimeString()+" — "+m;$("log").prepend(row)};
function setMsg(id,m){$(id).textContent=m}
function syncBalances(){const value=authorized?accountBalance.toFixed(2)+" "+authorized.currency:"—";for(const id of ["balance","assetsBalance","tradeAccountBalance"]){const el=$(id);if(el)el.textContent=value}const market=$("marketAccountBalance");if(market)market.textContent="Balance "+value;const type=authorized?(authorized.is_virtual?"Demo":"Real")+" account · "+authorized.loginid:"Not connected";if($("accountType"))$("accountType").textContent=type;if($("assetsAccountType"))$("assetsAccountType").textContent=type;}
function renderPortfolio(){const list=$("positionsList");if(!list)return;list.replaceChildren();const count=portfolioRows.length;$("openPositions").textContent=String(count);$("positionsUpdated").textContent="Updated "+new Date().toLocaleTimeString();if(!count){const empty=document.createElement("div");empty.className="feed-placeholder";empty.textContent="No open Deriv positions.";list.append(empty);return}portfolioRows.forEach(c=>{const row=document.createElement("article");row.className="account-row";const left=document.createElement("div");const title=document.createElement("b");title.textContent=(c.longcode||c.contract_type||"Open contract")+" · "+(c.symbol||"");const meta=document.createElement("small");meta.textContent="Contract #"+(c.contract_id||"—")+" · "+(c.date_start?new Date(Number(c.date_start)*1000).toLocaleString():"Active");left.append(title,meta);const right=document.createElement("div");right.className="account-value";const value=document.createElement("b");value.textContent=Number(c.profit||0).toFixed(2)+" "+(authorized?.currency||"");const sub=document.createElement("small");sub.textContent="Stake "+Number(c.buy_price||c.purchase_price||0).toFixed(2);right.append(value,sub);row.append(left,right);list.append(row)});}
async function refreshPortfolio(){if(!authorized||!ws||ws.readyState!==1)return;try{const r=await send({portfolio:1});portfolioRows=r.portfolio?.contracts||[];renderPortfolio()}catch(e){log("Portfolio refresh failed: "+e.message)}}
function send(payload){if(!ws||ws.readyState!==1)throw Error("Deriv connection is not open");const id=++req;payload.req_id=id;ws.send(JSON.stringify(payload));return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(Error("Deriv request timed out"))}},15000)})}
function disconnect(){const positionCount=document.getElementById("openPositions");if(positionCount)positionCount.textContent="0";botRunning=false;try{if(ws&&ws.readyState===1)ws.close()}catch{}ws=null;authorized=null;historySub=null;tickSub=null;openContract=null;pending.forEach(p=>p.reject(Error("Disconnected")));pending.clear();$("connectionBadge").textContent="DISCONNECTED";$("connectionBadge").className="badge off";accountBalance=0;portfolioRows=[];syncBalances();renderPortfolio();$("accountType").textContent="Not connected";$("connectBtn").disabled=false;$("disconnectBtn").disabled=true;$("startBtn").disabled=true;$("stopBtn").disabled=true;if($("manualCallBtn"))$("manualCallBtn").disabled=true;if($("manualPutBtn"))$("manualPutBtn").disabled=true;$("botStatus").textContent="STOPPED";$("modeLabel").textContent="Demo mode";setMsg("connectMessage","Disconnected.");setMsg("botMessage","Bot stopped.");}
function handleMessage(ev){let d;try{d=JSON.parse(ev.data)}catch{return}if(d.req_id&&pending.has(d.req_id)){const p=pending.get(d.req_id);pending.delete(d.req_id);d.error?p.reject(Error(d.error.message||"Deriv error")):p.resolve(d)}if(d.error){log("API error: "+d.error.message);return}if(d.msg_type==="balance"&&d.balance){accountBalance=Number(d.balance.balance);if(d.balance.currency)authorized.currency=d.balance.currency;syncBalances()}if(d.msg_type==="portfolio"&&d.portfolio){portfolioRows=d.portfolio.contracts||[];renderPortfolio()}if(d.msg_type==="transaction"&&d.transaction){refreshPortfolio()}if(d.msg_type==="tick"&&botRunning){/* tick stream is a connection heartbeat; candle stream drives signals */}if(d.msg_type==="candles"&&botRunning){const cs=d.candles||[];if(cs.length)onCandle(cs[cs.length-1])}if(d.msg_type==="ohlc"&&botRunning&&d.ohlc){onCandle(d.ohlc)}if(d.msg_type==="proposal_open_contract"&&d.proposal_open_contract){const c=d.proposal_open_contract;if(c.is_sold){const profit=Number(c.profit||0);sessionProfit+=profit;tradeCount++;if(profit>0)winCount++;else if(profit<0)lossCount++;$("sessionPL").textContent=(sessionProfit>0?"+":"")+sessionProfit.toFixed(2)+" "+(authorized?.currency||"");$("tradeCount").textContent=tradeCount+" trades";$("winCount").textContent=String(winCount);$("lossCount").textContent=String(lossCount);$("winRate").textContent=(tradeCount?((winCount/tradeCount)*100).toFixed(1):"0.0")+"%";log("Contract "+c.contract_id+" closed. P/L: "+profit.toFixed(2));openContract=null;refreshPortfolio();if(sessionProfit<=-Number($("lossLimit").value)||sessionProfit>=Number($("profitTarget").value)||tradeCount>=Number($("maxTrades").value)){stopBot("Session limit reached. No further trades.");}}}}
async function loadDerivAccounts(){
  const statusResponse=await fetch("/api/deriv/status",{credentials:"same-origin"});
  const status=await statusResponse.json();
  if(!status.connected){$("derivAccount").innerHTML='<option value="">Deriv connection unavailable</option>';$("connectBtn").disabled=true;setMsg("connectMessage",status.error||"Add DERIV_CLIENT_ID (or DERIV_APP_ID) and DERIV_ACCESS_TOKEN in Render Environment, then redeploy.");return false}
  const response=await fetch("/api/deriv/accounts",{credentials:"same-origin"});
  const data=await response.json();
  if(!response.ok)throw Error("Deriv account request failed (HTTP "+response.status+"): "+(data.error||"Unknown Deriv API error")+(data.code?" ["+data.code+"]":""));
  const select=$("derivAccount");select.replaceChildren();
  data.accounts.forEach(account=>{
    const option=document.createElement("option");
    option.value=account.account_id;
    option.dataset.virtual=String(account.is_virtual);
    option.dataset.currency=account.currency;
    option.dataset.balance=String(account.balance);
    option.dataset.loginid=account.loginid;
    option.textContent=(account.is_virtual?"DEMO":"REAL")+" · "+account.loginid+" · "+account.currency;
    select.append(option);
  });
  $("connectBtn").disabled=data.accounts.length===0;
  if(!data.accounts.length)setMsg("connectMessage","No Options accounts were returned for this Deriv login.");
  else setMsg("connectMessage","Demo account detected. BONAGO will connect automatically; Real accounts are blocked.");
  return data.accounts.length>0;
}
async function connect(){
  const accountSelect=$("derivAccount"),option=accountSelect.options[accountSelect.selectedIndex];
  if(!option||!option.value){setMsg("connectMessage","No Demo account was found for the Render access token.");return}
  const isVirtual=option.dataset.virtual==="true";
  if(!isVirtual){setMsg("connectMessage","BONAGO is locked to Demo accounts. Real-account connections are disabled.");return}
  $("connectBtn").disabled=true;setMsg("connectMessage","Requesting a secure one-time WebSocket connection from Deriv…");
  try{
    const otpResponse=await fetch("/api/deriv/otp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:option.value})});
    const otpData=await otpResponse.json();
    if(!otpResponse.ok||!otpData.url)throw Error("Deriv OTP request failed (HTTP "+otpResponse.status+"): "+(otpData.error||"Could not authenticate this account")+(otpData.code?" ["+otpData.code+"]":""));
    ws=new WebSocket(otpData.url);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Connection timed out")),12000);ws.onopen=()=>{clearTimeout(timer);resolve()};ws.onerror=()=>{clearTimeout(timer);reject(Error("Could not open authenticated Deriv WebSocket"))}});
    ws.onmessage=handleMessage;
    ws.onclose=()=>{if(authorized){log("Deriv connection closed.");disconnect()}};
    authorized={loginid:option.dataset.loginid||option.value,currency:option.dataset.currency||"USD",balance:Number(option.dataset.balance||0),is_virtual:isVirtual,account_id:option.value};
    accountBalance=authorized.balance;
    $("connectionBadge").textContent="CONNECTED";$("connectionBadge").className="badge on";
    syncBalances();
    $("botStatus").textContent="STOPPED";$("modeLabel").textContent=isVirtual?"Demo mode":"LIVE account";
    $("connectBtn").disabled=true;$("disconnectBtn").disabled=false;$("startBtn").disabled=false;$("manualCallBtn").disabled=false;$("manualPutBtn").disabled=false;
    setMsg("connectMessage","Securely connected to "+(isVirtual?"Deriv Demo":"Deriv Real")+" account.");
    log("Automatically connected to "+authorized.loginid+" using the server-side Render credentials and Deriv OTP.");
    try{await send({balance:1,subscribe:1})}catch(e){log("Balance subscription unavailable: "+e.message)}
    try{await send({transaction:1,subscribe:1})}catch(e){log("Transaction notifications unavailable: "+e.message)}
    await refreshPortfolio();
  }catch(e){disconnect();$("connectBtn").disabled=false;setMsg("connectMessage",e.message);log("Connection failed: "+e.message)}
}
function ema(vals,period){if(vals.length<period)return null;const k=2/(period+1);let v=vals.slice(0,period).reduce((a,b)=>a+b,0)/period;for(let i=period;i<vals.length;i++)v=vals[i]*k+v*(1-k);return v}
async function startBot(){if(!authorized){setMsg("botMessage","Connect first.");return}if(!authorized.is_virtual){stopBot("Safety lock: BONAGO can trade Demo accounts only.");return}const fast=Number($("fastEma").value),slow=Number($("slowEma").value),stake=Number($("stake").value),loss=Number($("lossLimit").value),target=Number($("profitTarget").value);if(!(fast>=2&&slow>fast&&stake>0&&loss>0&&target>0)){setMsg("botMessage","Check settings: slow EMA must be greater than fast EMA; stake and limits must be positive.");return}if(!confirm("Start automatic DEMO trading on "+$("symbol").value+"? This uses virtual funds only. The bot can place demo trades until stopped or a risk limit is reached."))return;
sessionProfit=0;tradeCount=0;winCount=0;lossCount=0;$("sessionPL").textContent="0.00";$("tradeCount").textContent="0 trades";$("winCount").textContent="0";$("lossCount").textContent="0";$("winRate").textContent="0.0%";prices=[];candleData=[];lastFast=null;lastSlow=null;lastCandleEpoch=null;openContract=null;lastTradeAt=0;sessionStart=Date.now();$("sessionPL").textContent="0.00";$("tradeCount").textContent="0 trades";botRunning=true;$("botStatus").textContent="RUNNING";$("startBtn").disabled=true;$("stopBtn").disabled=false;$("manualCallBtn").disabled=true;$("manualPutBtn").disabled=true;setMsg("botMessage","Loading candle history and waiting for a confirmed EMA crossover…");log("Bot started in DEMO mode.");
try{const r=await send({ticks_history:$("symbol").value,end:"latest",style:"candles",granularity:60,count:100,subscribe:1});historySub=r.subscription?.id||null;(r.candles||[]).forEach(c=>{const p=Number(c.close);if(Number.isFinite(p)){prices.push(p);candleData.push({open:Number(c.open),high:Number(c.high),low:Number(c.low),close:p})}});prices=prices.slice(-100);candleData=candleData.slice(-60);if(prices.length<Number($("slowEma").value)+2)throw Error("Not enough candle history for selected EMA values.");log("Loaded "+prices.length+" one-minute candles. Strategy is active.");setMsg("botMessage","Running. Waiting for the next EMA crossover. No trade is placed until a signal appears.");}catch(e){stopBot("Could not start strategy: "+e.message)}}
function renderAiDecision(d,checks){
 const put=(id,value)=>{const el=$(id);if(el)el.textContent=String(value)};
 const action=d?.action||"ERROR",confidence=Number.isFinite(Number(d?.confidence))?Number(d.confidence):null;
 put("aiDecisionAction",action);put("aiDecisionConfidence",confidence===null?"—":confidence+"%");
 put("aiDecisionReason",d?.rationale||"No explanation was returned by Groq.");
 put("aiDecisionRisks",Array.isArray(d?.risk_flags)&&d.risk_flags.length?d.risk_flags.join(" · "):"No AI risk flags returned.");
 const list=$("aiTradeChecks");if(list){list.replaceChildren();(checks||[]).forEach(item=>{const li=document.createElement("li");li.textContent=(item.ok?"PASS · ":"BLOCK · ")+item.label;li.style.color=item.ok?"#72ddb3":"#ff9ba8";list.append(li)})}
 const allowed=!!checks?.length&&checks.every(x=>x.ok);
 put("aiDecisionEligibility",allowed?"ELIGIBLE":"BLOCKED");
 put("aiDecisionBadge",allowed?"TRADE GATES PASSED":action==="HOLD"?"AI SAYS HOLD":"TRADE BLOCKED");
 const badge=$("aiDecisionBadge");if(badge){badge.style.color=allowed?"#72ddb3":"#ff9ba8";badge.style.background=allowed?"#10372e":"#3b2028"}
}
async function onCandle(c){
 const epoch=Number(c.epoch),close=Number(c.close); if(!Number.isFinite(close)||epoch===lastCandleEpoch)return; lastCandleEpoch=epoch;
 const candle={open:Number(c.open),high:Number(c.high),low:Number(c.low),close}; if(!Object.values(candle).every(Number.isFinite))return;
 prices.push(close);prices=prices.slice(-150);candleData.push(candle);candleData=candleData.slice(-60); if(candleData.length<20)return;
 if(openContract){log("AI skipped: one contract is already open.");return} if(aiRequestInFlight)return;
 if(Date.now()-lastTradeAt<Number($("cooldown").value)*60000)return;
 if(tradeCount>=Number($("maxTrades").value)||sessionProfit<=-Number($("lossLimit").value)||sessionProfit>=Number($("profitTarget").value)){stopBot("Session risk limit reached.");return}
 aiRequestInFlight=true; setMsg("botMessage","Groq GPT-OSS 120B analysing market candles…");
 try {
  const r=await fetch("/api/ai/analyze",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:$("symbol").value,candles:candleData.slice(-60)})});
  const d=await r.json(); if(!r.ok){const detail=[d.providerStatus?"HTTP "+d.providerStatus:"",d.providerCode||"",d.providerMessage||""].filter(Boolean).join(" · ");throw Error([d.error||"AI analysis failed",detail].filter(Boolean).join(" | "))}
  const stake=Number($("stake").value);
  const checks=[
   {label:"AI signal is CALL or PUT (not HOLD)",ok:d.action==="CALL"||d.action==="PUT"},
   {label:"AI confidence is at least 75%",ok:Number(d.confidence)>=75},
   {label:"Groq returned no risk flags",ok:Array.isArray(d.risk_flags)&&d.risk_flags.length===0},
   {label:"Bot is still running",ok:botRunning},
   {label:"Connected account is Deriv Demo",ok:!!authorized&&authorized.is_virtual===true},
   {label:"No other open contract",ok:!openContract},
   {label:"Stake is positive and within 5% of current balance",ok:Number.isFinite(stake)&&stake>0&&Math.min(stake,Math.max(0,accountBalance*0.05))>0}
  ];
  renderAiDecision(d,checks);
  log("Groq GPT-OSS 120B: "+d.action+" · "+d.confidence+"% · "+d.rationale);
  if(!checks.every(x=>x.ok)){
   const blockers=checks.filter(x=>!x.ok).map(x=>x.label).join("; ");
   setMsg("botMessage",(d.action==="HOLD"?"AI HOLD. ":"Trade blocked. ")+blockers);
   log("Trade eligibility blocked: "+blockers);
   return;
  }
  if(!botRunning||openContract)return;
  setMsg("botMessage","AI signal "+d.action+" ("+d.confidence+"%). All trade checks passed. Applying final risk controls…");
  placeTrade(d.action).catch(e=>{log("Trade failed: "+e.message);setMsg("botMessage","Trade failed: "+e.message)});
 } catch(e) { renderAiDecision({action:"ERROR",rationale:e.message,risk_flags:[e.message]},[{label:"Groq analysis completed successfully",ok:false}]);log("EMERGENCY STOP — AI unavailable: "+e.message); stopBot("Emergency disconnect: AI unavailable. No trade placed. "+e.message); }
 finally { aiRequestInFlight=false; }
}
async function placeTrade(direction,options={}){const manual=options.manual===true;if((!manual&&!botRunning)||!authorized||!authorized.is_virtual)throw Error("Connect a Deriv Demo account first.");if(openContract)throw Error("A contract is already open. Wait for it to close before placing another.");if(tradeCount>=Number($("maxTrades").value)||sessionProfit<=-Number($("lossLimit").value)||sessionProfit>=Number($("profitTarget").value))throw Error("Session trade limit or profit/loss limit reached.");if(!["CALL","PUT"].includes(direction))throw Error("Choose CALL or PUT.");const balance=accountBalance;const requested=Number($("stake").value);if(!Number.isFinite(requested)||requested<=0)throw Error("Enter a valid stake.");const stake=Math.min(requested,Math.max(0,balance*0.05));if(stake<=0)throw Error("Insufficient balance for a safe stake.");if(stake<requested)log("Stake capped to 5% of the displayed account balance: "+stake.toFixed(2));const p=await send({proposal:1,amount:Number(stake.toFixed(2)),basis:"stake",contract_type:direction,currency:authorized.currency,duration:Number($("duration").value),duration_unit:"m",underlying_symbol:$("symbol").value});if(!p.proposal?.id)throw Error("No valid price proposal returned.");const b=await send({buy:p.proposal.id,price:Number(p.proposal.ask_price)});if(!b.buy?.contract_id)throw Error("Deriv did not confirm the purchase.");openContract=b.buy.contract_id;lastTradeAt=Date.now();await refreshPortfolio();log((manual?"MANUAL ":"AUTOMATIC ")+ "PURCHASED "+direction+" · contract "+openContract+" · stake "+stake.toFixed(2)+" "+authorized.currency);setMsg("botMessage",(manual?"Manual ":"")+"Demo trade placed: "+direction+". Monitoring contract "+openContract+".");await send({proposal_open_contract:1,contract_id:openContract,subscribe:1})}
async function manualTrade(direction){if(!authorized||!authorized.is_virtual){setMsg("manualTradeMessage","Connect a Deriv Demo account before trading.");return}if(botRunning){setMsg("manualTradeMessage","Stop automatic trading before placing a manual trade.");return}if(openContract){setMsg("manualTradeMessage","A position is already open. Wait until it closes.");return}const requested=Number($("stake").value),safe=Math.min(requested,Math.max(0,accountBalance*0.05));if(!Number.isFinite(requested)||requested<=0||safe<=0){setMsg("manualTradeMessage","Enter a valid stake and ensure your Demo balance is sufficient.");return}const message="Confirm MANUAL DEMO "+direction+" trade?\nMarket: "+$("symbol").selectedOptions[0].text+"\nStake: "+safe.toFixed(2)+" "+authorized.currency+(safe<requested?" (capped to 5% of balance)":"")+"\nDuration: "+$("duration").value+" minute(s).";if(!confirm(message))return;$("manualCallBtn").disabled=true;$("manualPutBtn").disabled=true;setMsg("manualTradeMessage","Submitting your manual "+direction+" order to Deriv Demo…");try{await placeTrade(direction,{manual:true});setMsg("manualTradeMessage","Manual "+direction+" trade placed successfully. Position is being monitored.")}catch(e){setMsg("manualTradeMessage","Manual trade not placed: "+e.message);log("Manual trade failed: "+e.message)}finally{$("manualCallBtn").disabled=!authorized;$("manualPutBtn").disabled=!authorized}}
function stopBot(reason="Bot stopped by user."){botRunning=false;$("botStatus").textContent="STOPPED";$("startBtn").disabled=!authorized;$("stopBtn").disabled=true;if($("manualCallBtn"))$("manualCallBtn").disabled=!authorized;if($("manualPutBtn"))$("manualPutBtn").disabled=!authorized;setMsg("botMessage",reason);log(reason);if(historySub&&ws&&ws.readyState===1){send({forget:historySub}).catch(()=>{});historySub=null}}
$("symbol")?.addEventListener("change",()=>{
 const selected=$("symbol").value;
 if(botRunning&&previousSymbol&&selected!==previousSymbol){
   $("symbol").value=previousSymbol;
   setMsg("botMessage","Stop automatic trading before changing markets. The active strategy remains on "+previousSymbol+".");
   return;
 }
 previousSymbol=selected;
 prices=[];candleData=[];lastCandleEpoch=null;lastFast=null;lastSlow=null;
 if($("selectedMarketName"))$("selectedMarketName").textContent=$("symbol").selectedOptions[0]?.textContent||selected;
 if($("activeMarketLabel"))$("activeMarketLabel").textContent=selected||"No market selected";
 log("Selected market: "+selected);
});
window.BONAGO={startBot,stopBot,getState:()=>({botRunning,sessionProfit,tradeCount,winCount,lossCount,accountBalance,authorized,openPositions:portfolioRows.length})};
$("connectBtn").addEventListener("click",connect);
document.querySelectorAll("[data-order-tab]").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll("[data-order-tab]").forEach(x=>x.classList.toggle("selected",x===btn));const title=$("positionsTitle"),list=$("positionsList");if(btn.dataset.orderTab==="positions"){title.textContent="Open positions";renderPortfolio()}else{title.textContent="Pending orders";list.replaceChildren();const note=document.createElement("div");note.className="feed-placeholder";note.textContent="Deriv Options API does not expose a pending-orders list for these contracts. No pending orders can be confirmed here.";list.append(note)}}));$("disconnectBtn").addEventListener("click",()=>{stopBot("Disconnected by user.");disconnect()});$("startBtn").addEventListener("click",startBot);$("manualCallBtn").addEventListener("click",()=>manualTrade("CALL"));$("manualPutBtn").addEventListener("click",()=>manualTrade("PUT"));$("stopBtn").addEventListener("click",()=>stopBot());$("panicBtn").addEventListener("click",()=>{stopBot("Emergency stop: bot disconnected. Any already-open contract may continue until expiry.");disconnect()});$("liveMode").disabled=true;$("liveConfirm").disabled=true;$("modePill").textContent="DEMO ONLY · LOCKED";$("clearLog").addEventListener("click",()=>$("log").replaceChildren());window.addEventListener("beforeunload",()=>{if(botRunning)stopBot("Page closing.")});
(async()=>{
  try{
    const available=await loadDerivAccounts();
    if(available){
      setMsg("connectMessage","Demo account found. Connecting automatically…");
      log("Demo account found. Starting secure automatic connection; no manual broker sign-in is needed.");
      await connect();
    }
  }catch(error){
    $("derivAccount").innerHTML='<option value="">Unable to load accounts</option>';
    $("connectBtn").disabled=true;
    setMsg("connectMessage",error.message);
    log("Automatic account connection failed: "+error.message);
  }
})();
