(() => {
  const ENDPOINT = "wss://api.derivws.com/trading/v1/options/ws/public";
  const MAX_MARKETS = 500;
  const state = { socket: null, symbols: [], quotes: new Map(), nodes: new Map(), filter: "all", search: "", retry: 0, timer: null, connected: false, subscriptions: new Map(), pendingSubs: new Map(), nextReq: 2000 };
  const $ = id => document.getElementById(id);
  const categoryOf = s => {
    const m = String(s.market || s.market_display_name || "").toLowerCase();
    const sub = String(s.submarket || s.submarket_display_name || "").toLowerCase();
    if (m.includes("forex") || sub.includes("forex")) return "forex";
    if (m.includes("synthetic") || m.includes("derived") || sub.includes("synthetic")) return "synthetic";
    if (m.includes("crypto") || sub.includes("cryptocurrency")) return "crypto";
    if (m.includes("commodit") || sub.includes("metal") || sub.includes("energy") || sub.includes("oil")) return "commodities";
    if (m.includes("stock") || m.includes("index") || m.includes("indice") || m.includes("indices") || sub.includes("stock") || sub.includes("indice") || sub.includes("indices")) return "stocks";
    if (m.includes("derived") || sub.includes("derived") || m.includes("random") || sub.includes("random")) return "synthetic";
    return "other";
  };
  const categoryLabel = c => ({forex:"Forex",synthetic:"Synthetic",crypto:"Crypto",commodities:"Commodity",stocks:"Stock / Index",other:"Market"}[c] || "Market");
  const iconFor = c => ({forex:"FX",synthetic:"V",crypto:"₿",commodities:"Au",stocks:"IDX",other:"•"}[c] || "•");
  const priceText = (value, pip) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    let digits = Number.isFinite(Number(pip)) && Number(pip) > 0 ? Math.max(0, Math.min(8, Math.round(-Math.log10(Number(pip))))) : (n < 1 ? 5 : n < 100 ? 3 : 2);
    return n.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
  };
  function setStatus(text, ok) {
    const el = $("marketFeedStatus");
    if (el) { el.textContent = (ok ? "● " : "● ") + text; el.classList.toggle("feed-ok",!!ok); el.classList.toggle("feed-off",!ok); }
    const ticker = $("tickerStrip");
    if (!state.symbols.length && ticker) ticker.innerHTML = '<span class="ticker-status">' + text + '</span>';
  }
  function makeRow(symbol, compact) {
    const wrap = document.createElement("div");
    wrap.className = "market-row live-market-row";
    wrap.dataset.symbol = symbol.symbol;
    wrap.dataset.search = (symbol.display_name + " " + symbol.symbol + " " + categoryLabel(categoryOf(symbol))).toLowerCase();
    const icon = document.createElement("span");
    icon.className = "coin live-coin";
    icon.textContent = iconFor(categoryOf(symbol));
    const name = document.createElement("div"); name.className = "market-name";
    const title = document.createElement("b"); title.textContent = symbol.display_name || symbol.symbol;
    const sub = document.createElement("small"); sub.textContent = symbol.symbol + " · " + categoryLabel(categoryOf(symbol));
    name.append(title,sub);
    const price = document.createElement("div"); price.className = "market-price";
    const quote = document.createElement("b"); quote.textContent = "Waiting…";
    const time = document.createElement("small"); time.textContent = "Deriv live feed";
    price.append(quote,time);
    const change = document.createElement("span"); change.className = "change neutral"; change.textContent = "LIVE";
    wrap.append(icon,name,price,change);
    return wrap;
  }
  function updateQuote(tick) {
    const symbol = tick.symbol;
    const meta = state.symbols.find(s=>s.symbol===symbol);
    if (!meta || !Number.isFinite(Number(tick.quote))) return;
    const quote = Number(tick.quote), prior = state.quotes.get(symbol);
    if (!prior) state.quotes.set(symbol,{first:quote,last:quote,epoch:Number(tick.epoch||0)});
    else { prior.last=quote; prior.epoch=Number(tick.epoch||prior.epoch); }
    const q = state.quotes.get(symbol);
    for (const node of (state.nodes.get(symbol)||[])) {
      node.quote.textContent = priceText(quote,meta.pip);
      node.time.textContent = q.epoch ? new Date(q.epoch*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "Live from Deriv";
      if (q.first && q.first !== quote) {
        const pct = ((quote-q.first)/q.first)*100;
        node.change.textContent = (pct>0?"+":"")+pct.toFixed(2)+"%";
        node.change.className = "change " + (pct>0?"positive":pct<0?"negative":"neutral");
      } else { node.change.textContent = "LIVE"; node.change.className="change neutral"; }
    }
    const ticker = $("tickerStrip");
    if (ticker) {
      const tickerNode = ticker.querySelector('[data-ticker="'+CSS.escape(symbol)+'"]');
      if (tickerNode) tickerNode.querySelector("b").textContent = priceText(quote,meta.pip);
    }
  }
  function render() {
    const rows = $("marketRows"), home = $("homeMarkets");
    if (!rows || !home) return;
    rows.replaceChildren(); home.replaceChildren();
    const filtered = state.symbols.filter(s => (state.filter==="all" || categoryOf(s)===state.filter) && ((s.display_name+" "+s.symbol+" "+categoryLabel(categoryOf(s))).toLowerCase().includes(state.search)));
    if (!filtered.length) {
      const empty = document.createElement("div"); empty.className="feed-placeholder"; empty.textContent=state.symbols.length?"No Deriv markets match this filter.":"Waiting for Deriv market symbols…"; rows.append(empty);
    } else filtered.forEach(s=>rows.append(makeRow(s,false)));
    const popular = state.symbols.slice(0,4);
    popular.forEach(s=>home.append(makeRow(s,true)));
    filtered.slice(0,MAX_MARKETS).forEach(s=>{const q=state.quotes.get(s.symbol);if(q)updateQuote({symbol:s.symbol,quote:q.last,epoch:q.epoch})});
    const ticker = $("tickerStrip");
    if (ticker) {
      ticker.replaceChildren();
      state.symbols.slice(0,8).forEach(s=>{
        const item=document.createElement("span");item.dataset.ticker=s.symbol;
        const label=document.createTextNode((s.display_name||s.symbol)+" ");
        const value=document.createElement("b");value.textContent=state.quotes.has(s.symbol)?priceText(state.quotes.get(s.symbol).last,s.pip):"…";
        item.append(label,value);ticker.append(item);
      });
    }
    state.nodes.clear();
    document.querySelectorAll(".live-market-row").forEach(row=>{
      const s=state.symbols.find(x=>x.symbol===row.dataset.symbol);
      if(!s)return;
      const children=row.children;
      const refs={quote:children[2].querySelector("b"),time:children[2].querySelector("small"),change:children[3]};
      const existing=state.nodes.get(s.symbol)||[];existing.push(refs);state.nodes.set(s.symbol,existing);
      const q=state.quotes.get(s.symbol);if(q)updateQuote({symbol:s.symbol,quote:q.last,epoch:q.epoch});
    });
  }
  function pickSymbols(raw) {
    const source = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.active_symbols) ? raw.active_symbols : (raw && Array.isArray(raw.data) ? raw.data : []));
    const list = source.filter(s=>s && typeof (s.symbol||s.underlying_symbol)==="string" && (s.symbol||s.underlying_symbol).length>0 && !s.is_trading_suspended).map(s=>({...s,symbol:s.symbol||s.underlying_symbol,display_name:s.display_name||s.underlying_symbol||s.symbol}));
    const rank = {synthetic:0,forex:1,crypto:2,commodities:3,stocks:4};
    list.sort((a,b)=>(rank[categoryOf(a)]??9)-(rank[categoryOf(b)]??9) || String(a.display_name).localeCompare(String(b.display_name)));
    const seen=new Set();
    state.symbols=list.filter(s=>{if(seen.has(s.symbol))return false;seen.add(s.symbol);return true}).slice(0,MAX_MARKETS);
    render();
    if (!state.symbols.length) {setStatus("NO SYMBOLS · "+(Array.isArray(raw)?raw.length:0)+" RETURNED",false);console.warn("Deriv active_symbols returned no usable symbols",raw);return}
    setStatus("LIVE · "+state.symbols.length+" MARKETS",true);
    syncTickSubscriptions();
    const select=$("symbol");
    if(select){
      const current=select.value, frag=document.createDocumentFragment();
      state.symbols.forEach(s=>{const o=document.createElement("option");o.value=s.symbol;o.textContent=(s.display_name||s.symbol)+" ("+s.symbol+") · "+categoryLabel(categoryOf(s));frag.append(o)});
      select.replaceChildren(frag);
      select.value=state.symbols.some(s=>s.symbol===current)?current:(state.symbols.find(s=>s.symbol==="R_75")?.symbol||state.symbols[0].symbol);
      const chatSelect=$("chatMarketSelect");
      if(chatSelect){chatSelect.replaceChildren(...[...select.options].map(option=>option.cloneNode(true)));chatSelect.value=select.value;}
      select.dispatchEvent(new Event("change",{bubbles:true}));
    }
  }
  function syncTickSubscriptions() {
    const ws=state.socket;
    if(!ws || ws.readyState!==WebSocket.OPEN || !state.symbols.length) return;
    const selected=$("symbol")?.value;
    const filtered=state.symbols.filter(s=>(state.filter==="all"||categoryOf(s)===state.filter)&&((s.display_name+" "+s.symbol+" "+categoryLabel(categoryOf(s))).toLowerCase().includes(state.search)));
    const wanted=new Set([selected,...filtered.slice(0,7).map(s=>s.symbol)].filter(Boolean).slice(0,8));
    for(const [symbol,id] of state.subscriptions) { if(!wanted.has(symbol)) { try{ws.send(JSON.stringify({forget:id,req_id:state.nextReq++}));}catch{} state.subscriptions.delete(symbol); } }
    for(const symbol of wanted) { if(state.subscriptions.has(symbol)||[...state.pendingSubs.values()].includes(symbol)) continue; const reqId=state.nextReq++; state.pendingSubs.set(reqId,symbol); try{ws.send(JSON.stringify({ticks:symbol,subscribe:1,req_id:reqId}));}catch(error){state.pendingSubs.delete(reqId);console.warn("Deriv tick subscription failed:",symbol,error);} }
  }
  function connect() {
    clearTimeout(state.timer);
    setStatus("CONNECTING TO DERIV",false);
    const ws=new WebSocket(ENDPOINT);state.socket=ws;
    ws.onopen=()=>{state.connected=true;state.retry=0;state.subscriptions.clear();state.pendingSubs.clear();setStatus("LOADING DERIV SYMBOLS",true);ws.send(JSON.stringify({active_symbols:"brief",req_id:1}));};
    ws.onmessage=event=>{
      let data;try{data=JSON.parse(event.data)}catch{return}
      if(data.req_id && state.pendingSubs.has(Number(data.req_id))) {
        const symbol=state.pendingSubs.get(Number(data.req_id));state.pendingSubs.delete(Number(data.req_id));
        if(data.subscription?.id) { state.subscriptions.set(symbol,String(data.subscription.id)); syncTickSubscriptions(); }
      }
      if(data.error){
        if(data.req_id) state.pendingSubs.delete(Number(data.req_id));
        const err=data.error;
        setStatus("DERIV ERROR · "+String(err.code||"API")+" · "+String(err.message||"Unknown Deriv error"),false);
        console.error("Deriv market feed error:", {code:err.code,message:err.message,echo_req:data.echo_req,req_id:data.req_id,raw:data});
        const status=$("marketFeedStatus");
        if(status) status.title="Code: "+(err.code||"unknown")+" | Message: "+(err.message||"Unknown")+" | Request: "+JSON.stringify(data.echo_req||{});
        return;
      }
      if(data.msg_type==="active_symbols" || data.active_symbols || data.activeSymbols)pickSymbols(data.active_symbols||data.activeSymbols||data?.data?.active_symbols||[]);
      if(data.msg_type==="tick"&&data.tick)updateQuote(data.tick);
    };
    ws.onerror=()=>setStatus("FEED CONNECTION ERROR",false);
    ws.onclose=()=>{state.connected=false;state.subscriptions.clear();state.pendingSubs.clear();setStatus("RECONNECTING",false);state.retry=Math.min(state.retry+1,6);state.timer=setTimeout(connect,Math.min(30000,1000*Math.pow(2,state.retry)));};
  }
  document.addEventListener("click",e=>{
    const row=e.target.closest(".live-market-row");
    if(!row)return;
    const symbol=row.dataset.symbol,select=$("symbol");
    if(!select||![...select.options].some(o=>o.value===symbol))return;
    select.value=symbol;select.dispatchEvent(new Event("change",{bubbles:true}));
    document.querySelectorAll(".live-market-row").forEach(n=>n.classList.toggle("market-selected",n.dataset.symbol===symbol));
    const tradingTab=document.querySelector('[data-tab="trading"]');
    if(tradingTab)tradingTab.click();
  });
  $("marketSearch")?.addEventListener("input",e=>{state.search=e.target.value.trim().toLowerCase();render();syncTickSubscriptions()});
  $("marketTabs")?.addEventListener("click",e=>{const b=e.target.closest("[data-market-filter]");if(!b)return;state.filter=b.dataset.marketFilter;$("marketTabs").querySelectorAll("button").forEach(x=>x.classList.toggle("selected",x===b));render();syncTickSubscriptions()});
  window.addEventListener("online",()=>{if(!state.connected)connect()});

  // Live chart: independent public Deriv feed, never sends trade orders.
  const chartState={ws:null,symbol:"",granularity:60,points:[],subscription:null};
  const chartCanvas=$("marketChart"),chartCtx=chartCanvas?.getContext("2d");
  function chartStatus(t){const el=$("chartFeedStatus");if(el)el.textContent=t;}
  function drawChart(){
    if(!chartCanvas||!chartCtx)return;
    const rect=chartCanvas.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1),w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    if(chartCanvas.width!==Math.round(w*dpr)||chartCanvas.height!==Math.round(h*dpr)){chartCanvas.width=Math.round(w*dpr);chartCanvas.height=Math.round(h*dpr);}
    chartCtx.setTransform(dpr,0,0,dpr,0,0);chartCtx.clearRect(0,0,w,h);
    const pts=chartState.points;if(pts.length<2){chartCtx.fillStyle="#8796a9";chartCtx.font="12px sans-serif";chartCtx.fillText("Loading live Deriv candles…",14,h/2);return;}
    const values=pts.flatMap(p=>[p.high,p.low,p.open,p.close]).filter(Number.isFinite),min=Math.min(...values),max=Math.max(...values),range=max-min||Math.max(Math.abs(max)*.0001,1),left=8,right=w-66,top=14,bottom=h-24;
    chartCtx.font="9px sans-serif";chartCtx.strokeStyle="#243243";chartCtx.fillStyle="#8796a9";chartCtx.lineWidth=1;
    for(let i=0;i<4;i++){const gy=top+(bottom-top)*i/3;chartCtx.beginPath();chartCtx.moveTo(left,gy);chartCtx.lineTo(right,gy);chartCtx.stroke();const v=max-(range*i/3);chartCtx.fillText(v.toFixed(Math.abs(v)<10?4:2),right+5,gy+3);}
    const y=v=>bottom-(v-min)/range*(bottom-top),step=(right-left)/pts.length,bodyWidth=Math.max(2,Math.min(11,step*.62));
    pts.forEach((p,i)=>{const cx=left+step*(i+.5),up=p.close>=p.open,col=up?"#18c995":"#ef5d72";chartCtx.strokeStyle=col;chartCtx.fillStyle=col;chartCtx.lineWidth=1;chartCtx.beginPath();chartCtx.moveTo(cx,y(p.high));chartCtx.lineTo(cx,y(p.low));chartCtx.stroke();const topBody=Math.min(y(p.open),y(p.close)),bodyHeight=Math.max(1,Math.abs(y(p.open)-y(p.close)));chartCtx.fillRect(cx-bodyWidth/2,topBody,bodyWidth,bodyHeight);});
    const last=pts[pts.length-1],py=y(last.close);chartCtx.setLineDash([4,4]);chartCtx.strokeStyle="#7da9ff";chartCtx.beginPath();chartCtx.moveTo(left,py);chartCtx.lineTo(right,py);chartCtx.stroke();chartCtx.setLineDash([]);
    const price=$("chartCurrentPrice");if(price)price.textContent=priceText(last.close,chartState.pip);
    const change=$("chartPriceChange");if(change){const first=pts[0].close,pct=first?((last.close-first)/first)*100:0;change.textContent=(pct>=0?"+":"")+pct.toFixed(2)+"% over visible candles";change.style.color=pct>=0?"#49d6a4":"#ff8297";}
    const updated=$("chartLastUpdated");if(updated)updated.textContent="Updated "+new Date().toLocaleTimeString();
  }
  function chartConnect(){
    if(!chartCanvas)return;
    if(chartState.ws){try{chartState.ws.close()}catch{}}
    chartState.symbol=$("symbol")?.value||"R_100";chartState.points=[];chartState.subscription=null;
    const name=$("symbol")?.selectedOptions[0]?.textContent||chartState.symbol;if($("chartMarketName"))$("chartMarketName").textContent=name;
    chartStatus("CONNECTING");drawChart();
    const ws=new WebSocket(ENDPOINT);chartState.ws=ws;
    ws.onopen=()=>{if(chartState.ws!==ws)return;chartStatus("LOADING");ws.send(JSON.stringify({ticks_history:chartState.symbol,end:"latest",style:"candles",granularity:chartState.granularity,count:80,subscribe:1,req_id:71}));};
    ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return}if(chartState.ws!==ws)return;
      if(d.error){chartStatus("FEED ERROR");console.warn("Deriv chart feed:",d.error);return}
      if(d.msg_type==="candles"||d.candles){chartState.points=(d.candles||[]).map(c=>({epoch:Number(c.epoch),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter(c=>Number.isFinite(c.close)).slice(-100);chartState.subscription=d.subscription?.id||null;chartStatus("LIVE");drawChart();}
      if(d.msg_type==="ohlc"&&d.ohlc){const c=d.ohlc,p={epoch:Number(c.open_time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)};const last=chartState.points[chartState.points.length-1];if(last&&last.epoch===p.epoch)chartState.points[chartState.points.length-1]=p;else chartState.points.push(p);chartState.points=chartState.points.slice(-100);chartStatus("LIVE");drawChart();}
    };
    ws.onerror=()=>chartStatus("CONNECTION ERROR");
    ws.onclose=()=>{if(chartState.ws===ws)chartStatus("DISCONNECTED");};
  }
  $("symbol")?.addEventListener("change",()=>{syncTickSubscriptions();chartConnect();});
  document.querySelectorAll("[data-chart-time]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-chart-time]").forEach(x=>x.classList.toggle("selected",x===b));chartState.granularity=Number(b.dataset.chartTime);chartConnect();}));
  window.addEventListener("resize",drawChart);
  setTimeout(chartConnect,1200);

  connect();
})();