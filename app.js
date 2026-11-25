const $=id=>document.getElementById(id);
let ws=null,req=0,pending=new Map(),activeSubscriptions=new Map(),authorized=null,accountBalance=0,botRunning=false,historySub=null,tickSub=null,openContract=null,lastCandleEpoch=null,sessionProfit=0,tradeCount=0,winCount=0,lossCount=0,lastTradeAt=0,prices=[],candleData=[],lastFast=null,lastSlow=null,sessionStart=0,portfolioRows=[],transactionSub=null,tradeHistoryRows=[],aiRequestInFlight=false,previousSymbol="";
function riskDateKey(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")}
function loadDailyRisk(){const date=riskDateKey();try{const saved=JSON.parse(localStorage.getItem("bonago-demo-risk-v1")||"null");if(saved&&saved.date===date)return {...saved}}catch{}return {date,pnl:0,trades:0,startBalance:0,locked:false}}
let dailyRisk=loadDailyRisk();
function saveDailyRisk(){try{localStorage.setItem("bonago-demo-risk-v1",JSON.stringify(dailyRisk))}catch{}}
function dailyLossCap(){const configured=Number($("lossLimit")?.value);const equityCap=dailyRisk.startBalance>0?dailyRisk.startBalance*.05:configured;return Math.max(0,Math.min(Number.isFinite(configured)&&configured>0?configured:equityCap,equityCap))}

const log=(m)=>{const row=document.createElement("div");row.className="logrow";row.textContent=new Date().toLocaleTimeString()+" — "+m;$("log").prepend(row)};
function setMsg(id,m){$(id).textContent=m}
function syncBalances(){const value=authorized?accountBalance.toFixed(2)+" "+authorized.currency:"—";for(const id of ["balance","assetsBalance","tradeAccountBalance"]){const el=$(id);if(el)el.textContent=value}const market=$("marketAccountBalance");if(market)market.textContent="Balance "+value;const type=authorized?(authorized.is_virtual?"Demo":"Real")+" account · "+authorized.loginid:"Not connected";if($("accountType"))$("accountType").textContent=type;if($("assetsAccountType"))$("assetsAccountType").textContent=type;}
function renderPortfolio(){const list=$("positionsList");if(!list)return;list.replaceChildren();const count=portfolioRows.length;$("openPositions").textContent=String(count);$("positionsUpdated").textContent="Updated "+new Date().toLocaleTimeString();if(!count){const empty=document.createElement("div");empty.className="feed-placeholder";empty.textContent="No open Deriv positions.";list.append(empty);return}portfolioRows.forEach(c=>{const card=document.createElement("article");card.className="position-detail-card";card.dataset.contractId=String(c.contract_id||"");const head=document.createElement("div");head.className="position-detail-head";const title=document.createElement("b");title.textContent=(c.symbol||"Market")+" · "+String(c.contract_type||"Contract").toUpperCase();const profit=document.createElement("b");profit.className=Number(c.profit||0)>=0?"positive":"negative";profit.textContent=(Number(c.profit||0)>0?"+":"")+Number(c.profit||0).toFixed(2)+" "+(authorized?.currency||"");head.append(title,profit);const direction=document.createElement("div");direction.className="position-detail-direction";direction.textContent=(c.longcode||c.shortcode||"Open Demo contract");const detail=document.createElement("div");detail.className="position-detail-grid";const fields=[["Order No.",c.contract_id||"—"],["Entry price",c.entry_spot??c.entry_tick??"—"],["Current price",c.current_spot??c.exit_tick??"—"],["Take Profit / Stop Loss","Not set"],["Open time",c.date_start?new Date(Number(c.date_start)*1000).toLocaleString():"Active"],["Stake / Fee",Number(c.buy_price||c.purchase_price||0).toFixed(2)+" / "+(c.fee??"—")]];fields.forEach(([k,v])=>{const cell=document.createElement("div");cell.className="position-detail-cell";const label=document.createElement("small");label.textContent=k;const val=document.createElement("b");val.textContent=String(v);cell.append(label,val);detail.append(cell)});const actions=document.createElement("div");actions.className="position-detail-actions";const add=document.createElement("button");add.type="button";add.dataset.positionAction="add";add.textContent="Add Position";const change=document.createElement("button");change.type="button";change.dataset.positionAction="change";change.textContent="Change";const close=document.createElement("button");close.type="button";close.dataset.positionAction="close";close.textContent="Close";close.className="position-close";actions.append(add,change,close);card.append(head,direction,detail,actions);list.append(card)});}
async function refreshPortfolio(){if(!authorized||!ws||ws.readyState!==1)return;try{const r=await send({portfolio:1});portfolioRows=r.portfolio?.contracts||[];renderPortfolio()}catch(e){log("Portfolio refresh failed: "+e.message)}}
function renderTradeHistory(){
 const list=$("tradeHistoryList");if(!list)return;list.replaceChildren();
 const rows=tradeHistoryRows.filter(x=>/buy|sell|contract|trade/i.test(String(x.action_type||x.transaction_type||x.type||"")));
 $("historyCount").textContent=String(rows.length);
 if(!rows.length){const empty=document.createElement("div");empty.className="feed-placeholder";empty.textContent="No trade records returned by Deriv for this account yet.";list.append(empty);return}
 rows.slice(0,100).forEach(t=>{
  const row=document.createElement("article");row.className="account-row";
  const left=document.createElement("div");
  const title=document.createElement("b");title.textContent=String(t.longcode||t.action_type||t.transaction_type||t.type||"Deriv transaction")+" · "+String(t.symbol||t.underlying||"");
  const meta=document.createElement("small");const epoch=Number(t.transaction_time||t.date||t.purchase_time||0);meta.textContent=(epoch?new Date(epoch*1000).toLocaleString():"Time unavailable")+" · Ref "+String(t.transaction_id||t.contract_id||"—");
  left.append(title,meta);const right=document.createElement("div");right.className="account-value";
  const amount=document.createElement("b");const value=Number(t.amount??t.buy_price??t.sell_price??0);amount.textContent=(value>0?"+":"")+value.toFixed(2)+" "+(t.currency||authorized?.currency||"");
  const status=document.createElement("small");status.textContent=String(t.action_type||t.transaction_type||t.type||"Transaction").toUpperCase();right.append(amount,status);row.append(left,right);list.append(row);
 });
}
async function loadTradeHistory(){
 if(!authorized||!ws||ws.readyState!==1)return;
 const list=$("tradeHistoryList");if(list&&tradeHistoryRows.length===0)list.textContent="Loading account trade history…";
 try{const r=await send({statement:1,description:1,limit:100});const data=r.statement?.transactions||r.statement?.transactions||[];tradeHistoryRows=Array.isArray(data)?data:[];renderTradeHistory();}
 catch(e){if(list)list.textContent="Could not load Deriv trade history: "+e.message;log("Trade history request failed: "+e.message)}
}
function send(payload){if(!ws||ws.readyState!==1)throw Error("Deriv connection is not open");const id=++req;payload.req_id=id;ws.send(JSON.stringify(payload));return new Promise((resolve,reject)=>{pending.set(id,{resolve:d=>{if(payload.forget)activeSubscriptions.delete(String(payload.forget));if(payload.subscribe===1&&d.subscription?.id)activeSubscriptions.set(String(d.subscription.id),{msgType:d.msg_type||"unknown",request:payload});resolve(d)},reject});setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(Error("Deriv request timed out"))}},15000)})}
function forgetSubscription(subscriptionId){if(!subscriptionId||!ws||ws.readyState!==1)return;const id=String(subscriptionId);if(!activeSubscriptions.has(id))return;activeSubscriptions.delete(id);const requestId=++req;ws.send(JSON.stringify({forget:id,req_id:requestId}));}
function clearSubscriptions(){if(!ws||ws.readyState!==1){activeSubscriptions.clear();return}for(const id of activeSubscriptions.keys()){const requestId=++req;try{ws.send(JSON.stringify({forget:id,req_id:requestId}))}catch{break}}activeSubscriptions.clear();historySub=null;tickSub=null;}
function disconnect(){clearSubscriptions();const positionCount=document.getElementById("openPositions");if(positionCount)positionCount.textContent="0";botRunning=false;try{if(ws&&ws.readyState===1)ws.close()}catch{}ws=null;authorized=null;historySub=null;tickSub=null;openContract=null;pending.forEach(p=>p.reject(Error("Disconnected")));pending.clear();$("connectionBadge").textContent="DISCONNECTED";$("connectionBadge").className="badge off";accountBalance=0;portfolioRows=[];syncBalances();renderPortfolio();$("accountType").textContent="Not connected";$("connectBtn").disabled=false;$("disconnectBtn").disabled=true;$("startBtn").disabled=true;$("stopBtn").disabled=true;if($("manualCallBtn"))$("manualCallBtn").disabled=true;if($("manualPutBtn"))$("manualPutBtn").disabled=true;$("botStatus").textContent="STOPPED";$("modeLabel").textContent="Demo mode";setMsg("connectMessage","Disconnected.");setMsg("botMessage","Bot stopped.");}
function handleMessage(ev){let d;try{d=JSON.parse(ev.data)}catch{return}if(d.req_id&&pending.has(d.req_id)){const p=pending.get(d.req_id);pending.delete(d.req_id);d.error?p.reject(Error(d.error.message||"Deriv error")):p.resolve(d)}if(d.error){log("API error: "+d.error.message);return}if(d.msg_type==="balance"&&d.balance){accountBalance=Number(d.balance.balance);if(d.balance.currency)authorized.currency=d.balance.currency;syncBalances()}if(d.msg_type==="portfolio"&&d.portfolio){portfolioRows=d.portfolio.contracts||[];renderPortfolio()}if(d.msg_type==="transaction"&&d.transaction){refreshPortfolio();loadTradeHistory()}if(d.msg_type==="statement"&&d.statement){tradeHistoryRows=d.statement.transactions||[];renderTradeHistory()}if(d.msg_type==="tick"&&botRunning){/* tick stream is a connection heartbeat; candle stream drives signals */}if(d.msg_type==="candles"&&botRunning){const cs=d.candles||[];if(cs.length)onCandle(cs[cs.length-1])}if(d.msg_type==="ohlc"&&botRunning&&d.ohlc){onCandle(d.ohlc)}if(d.msg_type==="proposal_open_contract"&&d.proposal_open_contract){const c=d.proposal_open_contract;if(c.is_sold){const profit=Number(c.profit||0);sessionProfit+=profit;tradeCount++;dailyRisk.pnl+=profit;dailyRisk.trades++;if(dailyRisk.pnl<=-dailyLossCap()||dailyRisk.trades>=Number($("maxTrades").value))dailyRisk.locked=true;saveDailyRisk();if(profit>0)winCount++;else if(profit<0)lossCount++;$("sessionPL").textContent=(sessionProfit>0?"+":"")+sessionProfit.toFixed(2)+" "+(authorized?.currency||"");$("tradeCount").textContent=tradeCount+" trades";$("winCount").textContent=String(winCount);$("lossCount").textContent=String(lossCount);$("winRate").textContent=(tradeCount?((winCount/tradeCount)*100).toFixed(1):"0.0")+"%";log("Contract "+c.contract_id+" closed. P/L: "+profit.toFixed(2));if(d.subscription?.id)forgetSubscription(d.subscription.id);if(Number(openContract)===Number(c.contract_id))openContract=null;refreshPortfolio();if(sessionProfit<=-Number($("lossLimit").value)||sessionProfit>=Number($("profitTarget").value)||tradeCount>=Number($("maxTrades").value)||dailyRisk.locked){stopBot(dailyRisk.locked?"Daily risk lock reached. No further Demo trades today.":"Session limit reached. No further trades.");}}}}
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
    accountBalance=authorized.balance;if(!dailyRisk.startBalance||dailyRisk.startBalance<=0){dailyRisk.startBalance=accountBalance;saveDailyRisk()}
    $("connectionBadge").textContent="CONNECTED";$("connectionBadge").className="badge on";
    syncBalances();
    $("botStatus").textContent="STOPPED";$("modeLabel").textContent=isVirtual?"Demo mode":"LIVE account";
    $("connectBtn").disabled=true;$("disconnectBtn").disabled=false;$("startBtn").disabled=false;$("manualCallBtn").disabled=false;$("manualPutBtn").disabled=false;
    setMsg("connectMessage","Securely connected to "+(isVirtual?"Deriv Demo":"Deriv Real")+" account.");
    log("Automatically connected to "+authorized.loginid+" using the server-side Render credentials and Deriv OTP.");
    try{await send({balance:1,subscribe:1})}catch(e){log("Balance subscription unavailable: "+e.message)}
    try{await send({transaction:1,subscribe:1})}catch(e){log("Transaction notifications unavailable: "+e.message)}
    await refreshPortfolio();
    await loadTradeHistory();
  }catch(e){disconnect();$("connectBtn").disabled=false;setMsg("connectMessage",e.message);log("Connection failed: "+e.message)}
}
function ema(vals,period){if(vals.length<period)return null;const k=2/(period+1);let v=vals.slice(0,period).reduce((a,b)=>a+b,0)/period;for(let i=period;i<vals.length;i++)v=vals[i]*k+v*(1-k);return v}
async function startBot(){if(!authorized){setMsg("botMessage","Connect first.");return}if(!authorized.is_virtual){stopBot("Safety lock: BONAGO can trade Demo accounts only.");return}if(dailyRisk.date!==riskDateKey())dailyRisk=loadDailyRisk();if(dailyRisk.locked||dailyRisk.pnl<=-dailyLossCap()||dailyRisk.trades>=Number($("maxTrades").value)){dailyRisk.locked=true;saveDailyRisk();setMsg("botMessage","Daily risk lock is active. Automation is disabled until the next local day.");return}if(portfolioRows.length>=10){setMsg("botMessage","Maximum of 10 simultaneous Demo positions reached.");return}const confidence=Number($("aiConfidence").value),stakePct=Number($("maxStakePercent").value),stake=Number($("stake").value),loss=Number($("lossLimit").value),target=Number($("profitTarget").value);if(!(confidence>=60&&confidence<=95&&stakePct>=0.5&&stakePct<=2&&stake>0&&loss>0&&target>0)){setMsg("botMessage","Check settings: slow EMA must be greater than fast EMA; stake and limits must be positive.");return}if(!confirm("Start automatic DEMO trading on "+$("symbol").value+"? This uses virtual funds only. The bot can place demo trades until stopped or a risk limit is reached."))return;
sessionProfit=0;tradeCount=0;winCount=0;lossCount=0;$("sessionPL").textContent="0.00";$("tradeCount").textContent="0 trades";$("winCount").textContent="0";$("lossCount").textContent="0";$("winRate").textContent="0.0%";prices=[];candleData=[];lastFast=null;lastSlow=null;lastCandleEpoch=null;openContract=null;lastTradeAt=0;sessionStart=Date.now();$("sessionPL").textContent="0.00";$("tradeCount").textContent="0 trades";botRunning=true;$("botStatus").textContent="RUNNING";$("startBtn").disabled=true;$("stopBtn").disabled=false;$("manualCallBtn").disabled=true;$("manualPutBtn").disabled=true;setMsg("botMessage","Loading candle history and waiting for a confirmed EMA crossover…");log("Bot started in DEMO mode.");
try{const r=await send({ticks_history:$("symbol").value,end:"latest",style:"candles",granularity:60,count:100,subscribe:1});historySub=r.subscription?.id||null;(r.candles||[]).forEach(c=>{const p=Number(c.close);if(Number.isFinite(p)){prices.push(p);candleData.push({open:Number(c.open),high:Number(c.high),low:Number(c.low),close:p})}});prices=prices.slice(-100);candleData=candleData.slice(-60);if(candleData.length<20)throw Error("Not enough candle history for AI analysis. Need at least 20 one-minute candles.");log("Loaded "+prices.length+" one-minute candles. Strategy is active.");setMsg("botMessage","Running. Waiting for the next EMA crossover. No trade is placed until a signal appears.");}catch(e){stopBot("Could not start strategy: "+e.message)}}
function renderAiDecision(d,checks){
 const put=(id,value)=>{const el=$(id);if(el)el.textContent=String(value)};
 const action=d?.action||"ERROR",confidence=Number.isFinite(Number(d?.confidence))?Number(d.confidence):null;
 put("aiDecisionAction",action);put("aiDecisionConfidence",confidence===null?"—":confidence+"%");
 put("aiDecisionReason",d?.rationale||"No explanation was returned by Groq.");
 const setupValues=[["aiEntryPrice",d?.entry_price],["aiStopLoss",d?.stop_loss],["aiTakeProfit",d?.take_profit]];
 setupValues.forEach(([id,value])=>put(id,value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value).toString():"—"));
 put("aiTradeDirection",d?.action==="CALL"?"BUY / CALL":d?.action==="PUT"?"BUY / PUT":"WAIT / NO TRADE");
 put("aiSetupNote",d?.setup_note||"No trade setup available.");
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
   {label:"AI confidence is at least 75%",ok:Number(d.confidence)>=Number($("aiConfidence").value)},
   {label:"Groq returned no risk flags",ok:Array.isArray(d.risk_flags)&&d.risk_flags.length===0},
   {label:"Bot is still running",ok:botRunning},
   {label:"Connected account is Deriv Demo",ok:!!authorized&&authorized.is_virtual===true},
   {label:"No other open contract",ok:!openContract},
   {label:"Stake is positive and within 2% of current balance",ok:Number.isFinite(stake)&&stake>0&&Math.min(stake,Math.max(0,accountBalance*Number($("maxStakePercent").value)/100))>=0.35},{label:"Daily loss and trade limits remain clear",ok:!dailyRisk.locked&&dailyRisk.pnl>-dailyLossCap()&&dailyRisk.trades<Number($("maxTrades").value)}
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
async function placeTrade(direction,options={}){const manual=options.manual===true;if((!manual&&!botRunning)||!authorized||!authorized.is_virtual)throw Error("Connect a Deriv Demo account first.");if(portfolioRows.length>=10)throw Error("Maximum of 10 simultaneous Demo positions reached. Close a position before adding another.");if(dailyRisk.locked||dailyRisk.pnl<=-dailyLossCap()||dailyRisk.trades>=Number($("maxTrades").value))throw Error("Daily risk lock: loss or trade limit reached.");if(tradeCount>=Number($("maxTrades").value)||sessionProfit<=-Number($("lossLimit").value)||sessionProfit>=Number($("profitTarget").value))throw Error("Session trade limit or profit/loss limit reached.");if(!["CALL","PUT"].includes(direction))throw Error("Choose CALL or PUT.");const balance=accountBalance;const requested=Number($("stake").value);if(!Number.isFinite(requested)||requested<=0)throw Error("Enter a valid stake.");const stake=Math.min(requested,Math.max(0,balance*Number($("maxStakePercent").value)/100));if(stake<0.35)throw Error("Safe stake is below Deriv minimum. Increase Demo balance or lower exposure constraints.");if(stake<requested)log("Stake capped to "+$("maxStakePercent").value+"% of the displayed Demo balance: "+stake.toFixed(2));const p=await send({proposal:1,amount:Number(stake.toFixed(2)),basis:"stake",contract_type:direction,currency:authorized.currency,duration:Number($("duration").value),duration_unit:"m",underlying_symbol:$("symbol").value});if(!p.proposal?.id)throw Error("No valid price proposal returned.");const b=await send({buy:p.proposal.id,price:Number(p.proposal.ask_price)});if(!b.buy?.contract_id)throw Error("Deriv did not confirm the purchase.");openContract=b.buy.contract_id;lastTradeAt=Date.now();await refreshPortfolio();log((manual?"MANUAL ":"AUTOMATIC ")+ "PURCHASED "+direction+" · contract "+openContract+" · stake "+stake.toFixed(2)+" "+authorized.currency);setMsg("botMessage",(manual?"Manual ":"")+"Demo trade placed: "+direction+". Monitoring contract "+openContract+".");await send({proposal_open_contract:1,contract_id:openContract,subscribe:1})}
async function manualTrade(direction){if(!authorized||!authorized.is_virtual){setMsg("manualTradeMessage","Connect a Deriv Demo account before trading.");if($("chatTradeStatus"))$("chatTradeStatus").textContent="Connect your Deriv Demo account first.";return}if(botRunning){setMsg("manualTradeMessage","Stop automatic trading before placing a manual trade.");return}if(portfolioRows.length>=10){setMsg("manualTradeMessage","Maximum of 10 simultaneous Demo positions reached.");return}if(dailyRisk.locked||dailyRisk.pnl<=-dailyLossCap()||dailyRisk.trades>=Number($("maxTrades").value)){setMsg("manualTradeMessage","Daily risk lock is active. No more trades today.");return}const requested=Number($("stake").value),safe=Math.min(requested,Math.max(0,accountBalance*Number($("maxStakePercent").value)/100));if(!Number.isFinite(requested)||requested<=0||safe<=0){setMsg("manualTradeMessage","Enter a valid stake and ensure your Demo balance is sufficient.");return}const message="Confirm MANUAL DEMO "+direction+" trade?\nMarket: "+$("symbol").selectedOptions[0].text+"\nStake: "+safe.toFixed(2)+" "+authorized.currency+(safe<requested?" (capped to "+$("maxStakePercent").value+"% of balance)":"")+"\nDuration: "+$("duration").value+" minute(s).";if(!confirm(message))return;if($("chatTradeStatus"))$("chatTradeStatus").textContent="Submitting "+direction+" order to Deriv Demo…";$("manualCallBtn").disabled=true;$("manualPutBtn").disabled=true;setMsg("manualTradeMessage","Submitting your manual "+direction+" order to Deriv Demo…");try{await placeTrade(direction,{manual:true});setMsg("manualTradeMessage","Manual "+direction+" trade placed successfully. Position is being monitored.");if($("chatTradeStatus"))$("chatTradeStatus").textContent="Demo "+direction+" order placed. Monitoring position."}catch(e){setMsg("manualTradeMessage","Manual trade not placed: "+e.message);if($("chatTradeStatus"))$("chatTradeStatus").textContent="Order not placed: "+e.message;log("Manual trade failed: "+e.message)}finally{$("manualCallBtn").disabled=!authorized;$("manualPutBtn").disabled=!authorized}}
function stopBot(reason="Bot stopped by user."){botRunning=false;$("botStatus").textContent="STOPPED";$("startBtn").disabled=!authorized;$("stopBtn").disabled=true;if($("manualCallBtn"))$("manualCallBtn").disabled=!authorized;if($("manualPutBtn"))$("manualPutBtn").disabled=!authorized;setMsg("botMessage",reason);log(reason);if(historySub&&ws&&ws.readyState===1){forgetSubscription(historySub);historySub=null}}
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
 const chatMarket=$("chatMarketSelect");if(chatMarket&&chatMarket.value!==selected)chatMarket.value=selected;
 log("Selected market: "+selected);
});
window.BONAGO={startBot,stopBot,manualTrade,getState:()=>({botRunning,sessionProfit,tradeCount,winCount,lossCount,accountBalance,authorized,openPositions:portfolioRows.length,hasOpenContract:!!openContract,dailyRisk:{...dailyRisk},dailyLossCap:dailyLossCap()})};
$("chatMarketSelect")?.addEventListener("change",()=>{const selected=$("chatMarketSelect").value;if(!selected)return;$("symbol").value=selected;$("symbol").dispatchEvent(new Event("change",{bubbles:true}));});
$("connectBtn").addEventListener("click",connect);
document.querySelectorAll("[data-order-tab]").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll("[data-order-tab]").forEach(x=>x.classList.toggle("selected",x===btn));const title=$("positionsTitle"),list=$("positionsList");list.dataset.activeTab=btn.dataset.orderTab;if(btn.dataset.orderTab==="positions"){title.textContent="Open positions";renderPortfolio()}else{title.textContent=btn.dataset.orderTab==="weekly"?"Weekly orders":"Pending orders";list.replaceChildren();const note=document.createElement("div");note.className="feed-placeholder";note.textContent=btn.dataset.orderTab==="weekly"?"Weekly order scheduling is not available for Deriv contracts in this BONAGO build.":"Pending orders are not supported for these purchased Deriv contracts. This tab does not represent queued trades.";list.append(note)}}));$("positionsList")?.addEventListener("click",async ev=>{const button=ev.target.closest("button[data-position-action]");if(!button)return;const card=button.closest("[data-contract-id]");const id=Number(card?.dataset.contractId);if(!id)return;const action=button.dataset.positionAction;if(action==="add"){const side=prompt("Add another Demo position. Enter CALL or PUT:","CALL");if(side&&["CALL","PUT"].includes(side.trim().toUpperCase()))await manualTrade(side.trim().toUpperCase());else if(side)alert("Enter CALL or PUT.");return}if(action==="change"){alert("Deriv does not support changing the stake or duration of an already purchased contract. Close it and place a new position with the settings you want.");return}if(action==="close"){if(!confirm("Close Demo contract #"+id+" at the current available market price?"))return;button.disabled=true;try{const result=await send({sell:id,price:0});if(result.error)throw Error(result.error.message||"Deriv could not close this contract.");log("Close request accepted for contract #"+id+".");await refreshPortfolio()}catch(error){alert("Close failed: "+error.message);log("Close failed for #"+id+": "+error.message)}finally{button.disabled=false}}});
$("disconnectBtn").addEventListener("click",()=>{stopBot("Disconnected by user.");disconnect()});$("startBtn").addEventListener("click",startBot);$("manualCallBtn").addEventListener("click",()=>manualTrade("CALL"));$("manualPutBtn").addEventListener("click",()=>manualTrade("PUT"));$("exchangeBuy")?.addEventListener("click",()=>manualTrade("CALL"));$("exchangeSell")?.addEventListener("click",()=>manualTrade("PUT"));$("stake")?.addEventListener("input",()=>{if($("exchangeStakeValue"))$("exchangeStakeValue").textContent=Number($("stake").value||0).toFixed(2)});$("stopBtn").addEventListener("click",()=>stopBot());$("panicBtn").addEventListener("click",()=>{stopBot("Emergency stop: bot disconnected. Any already-open contract may continue until expiry.");disconnect()});$("liveMode").disabled=true;$("liveConfirm").disabled=true;$("modePill").textContent="DEMO ONLY · LOCKED";$("clearLog").addEventListener("click",()=>$("log").replaceChildren());$("refreshTradeHistory")?.addEventListener("click",loadTradeHistory);window.addEventListener("beforeunload",()=>{if(botRunning)stopBot("Page closing.")});
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
