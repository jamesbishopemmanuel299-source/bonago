
(()=>{
 const $=id=>document.getElementById(id);
 const messages=$("assistantMessages"),input=$("assistantCommand"),send=$("sendCommand");
 function addMessage(role,text){const el=document.createElement("div");el.className="chat-message "+role;el.textContent=text;messages.append(el);messages.scrollTop=messages.scrollHeight;return el}
 async function checkAI(){const el=$("aiConnectionStatus");if(!el)return;try{const r=await fetch("/api/ai/status",{cache:"no-store",credentials:"same-origin"});const d=await r.json();el.textContent=d.healthy?"● GROQ ONLINE":"● GROQ OFFLINE";el.title=d.message||"Groq status";el.style.opacity=d.healthy?"1":"0.8";}catch{el.textContent="● GROQ UNREACHABLE";}}
 function syncStats(){const s=window.BONAGO?.getState?.();if(!s)return;$("chatPL").textContent=(s.sessionProfit>=0?"+":"")+s.sessionProfit.toFixed(2)+(s.authorized?.currency?" "+s.authorized.currency:"");$("chatPL").style.color=s.sessionProfit>=0?"#54d6a5":"#ff8798";$("chatTrades").textContent=String(s.tradeCount);$("chatWinRate").textContent=(s.tradeCount?(s.winCount/s.tradeCount*100):0).toFixed(1)+"%";$("chatOpen").textContent=String(s.openPositions);$("chatBalance").textContent=s.authorized?s.accountBalance.toFixed(2)+" "+s.authorized.currency:"—";$("chatBotState").textContent=(s.botRunning?"BOT RUNNING":"BOT STOPPED")+" · DEMO"}
 async function submit(){const command=input.value.trim();if(!command)return;input.value="";addMessage("user",command);const wait=addMessage("assistant","Interpreting your command with Groq GPT-OSS 120B…");send.disabled=true;
 try{const r=await fetch("/api/ai/command",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({command})});const d=await r.json();if(!r.ok)throw Error(d.error||"Command failed");wait.remove();
 if(d.intent==="stop"){window.BONAGO?.stopBot("Stopped by your chat command.");addMessage("assistant","The Demo bot has been stopped. Any already-open contract may continue until its expiry.");syncStats();return}
 $("symbol").value=d.symbol;$("stake").value=d.stake;$("duration").value=String(d.duration_minutes);$("maxTrades").value=d.max_trades;$("lossLimit").value=d.loss_limit;$("profitTarget").value=d.profit_target;
 const summary="Settings applied (Demo only):\n• Market: "+d.symbol+"\n• Stake: "+d.stake+" "+(window.BONAGO?.getState?.().authorized?.currency||"account currency")+"\n• Contract duration: "+d.duration_minutes+" minute(s)\n• Maximum trades: "+d.max_trades+"\n• Session loss limit: "+d.loss_limit+"\n• Profit target: "+d.profit_target+"\n\n"+d.rationale;
 addMessage("assistant",summary);
 if(d.intent==="start"){addMessage("assistant","You explicitly requested automatic trading. Confirm the Demo-only start prompt to begin. If no Deriv Demo account is connected, connect it first.");if(window.BONAGO?.getState?.().authorized)await window.BONAGO.startBot()}
 else if(d.intent==="analyze"){addMessage("assistant","I’ve configured the requested market. To analyse live candles and act on signals, use Start automatic trading in the Trading tab. No trade has been placed.");}
 else addMessage("assistant","Configuration saved in this session. No trade has been placed. When ready, start Demo automation from Trading.");
 syncStats();
 }catch(e){wait.textContent="I couldn't process that command: "+e.message+" No trade was placed."}finally{send.disabled=false;syncStats()}}
 send.addEventListener("click",submit);input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit()}});
 document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>{input.value=b.dataset.prompt;submit()}));
 $("newChat").addEventListener("click",()=>{messages.replaceChildren();addMessage("assistant","New conversation started. Paste a Demo trading command when ready.");});
 setInterval(syncStats,1000);syncStats();checkAI();setInterval(checkAI,30000);
})();
