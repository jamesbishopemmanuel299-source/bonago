(() => {
  const ENDPOINT = "wss://api.derivws.com/trading/v1/options/ws/public";
  const MAX_MARKETS = 48;
  const state = { socket: null, symbols: [], quotes: new Map(), nodes: new Map(), filter: "all", search: "", retry: 0, timer: null, connected: false };
  const $ = id => document.getElementById(id);
  const categoryOf = s => {
    const m = String(s.market || s.market_display_name || "").toLowerCase();
    const sub = String(s.submarket || s.submarket_display_name || "").toLowerCase();
    if (m.includes("forex") || sub.includes("forex")) return "forex";
    if (m.includes("synthetic") || m.includes("derived") || sub.includes("synthetic")) return "synthetic";
    if (m.includes("crypto") || sub.includes("cryptocurrency")) return "crypto";
    if (m.includes("commodit") || sub.includes("metal") || sub.includes("energy") || sub.includes("oil")) return "commodities";
    if (m.includes("stock") || m.includes("index") || m.includes("indice") || sub.includes("stock") || sub.includes("indice")) return "stocks";
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
    const list = (Array.isArray(raw)?raw:[]).filter(s=>s && s.symbol && s.display_name && categoryOf(s)!=="other" && !s.is_trading_suspended);
    const rank = {synthetic:0,forex:1,crypto:2,commodities:3,stocks:4};
    list.sort((a,b)=>(rank[categoryOf(a)]??9)-(rank[categoryOf(b)]??9) || String(a.display_name).localeCompare(String(b.display_name)));
    const seen=new Set();
    state.symbols=list.filter(s=>{if(seen.has(s.symbol))return false;seen.add(s.symbol);return true}).slice(0,MAX_MARKETS);
    render();
    if (!state.symbols.length) {setStatus("NO ACTIVE SYMBOLS",false);return}
    setStatus("LIVE · "+state.symbols.length+" MARKETS",true);
    // Deriv supports a symbol array for a single real-time tick subscription.
    try { state.socket.send(JSON.stringify({ticks:state.symbols.map(s=>s.symbol),subscribe:1,req_id:2})); }
    catch(e) { setStatus("SUBSCRIPTION ERROR",false); }
    const select=$("symbol");
    if(select){
      const synth=state.symbols.filter(s=>categoryOf(s)==="synthetic");
      if(synth.length){
        const current=select.value, frag=document.createDocumentFragment();
        synth.forEach(s=>{const o=document.createElement("option");o.value=s.symbol;o.textContent=(s.display_name||s.symbol)+" ("+s.symbol+")";frag.append(o)});
        select.replaceChildren(frag);
        select.value=synth.some(s=>s.symbol===current)?current:(synth.find(s=>s.symbol==="R_100")?.symbol||synth[0].symbol);
      }
    }
  }
  function connect() {
    clearTimeout(state.timer);
    setStatus("CONNECTING TO DERIV",false);
    const ws=new WebSocket(ENDPOINT);state.socket=ws;
    ws.onopen=()=>{state.connected=true;state.retry=0;setStatus("LOADING DERIV SYMBOLS",true);ws.send(JSON.stringify({active_symbols:"full",req_id:1}));};
    ws.onmessage=event=>{
      let data;try{data=JSON.parse(event.data)}catch{return}
      if(data.error){setStatus("DERIV FEED ERROR",false);console.warn("Deriv market feed:",data.error.message);return}
      if(data.msg_type==="active_symbols")pickSymbols(data.active_symbols||data.activeSymbols||[]);
      if(data.msg_type==="tick"&&data.tick)updateQuote(data.tick);
    };
    ws.onerror=()=>setStatus("FEED CONNECTION ERROR",false);
    ws.onclose=()=>{state.connected=false;setStatus("RECONNECTING",false);state.retry=Math.min(state.retry+1,6);state.timer=setTimeout(connect,Math.min(30000,1000*Math.pow(2,state.retry)));};
  }
  $("marketSearch")?.addEventListener("input",e=>{state.search=e.target.value.trim().toLowerCase();render()});
  $("marketTabs")?.addEventListener("click",e=>{const b=e.target.closest("[data-market-filter]");if(!b)return;state.filter=b.dataset.marketFilter;$("marketTabs").querySelectorAll("button").forEach(x=>x.classList.toggle("selected",x===b));render()});
  window.addEventListener("online",()=>{if(!state.connected)connect()});
  connect();
})();