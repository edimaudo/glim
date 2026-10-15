let STATE = null;
let selectedStrategy = 'avalanche';
let currentLesson = null;
let lastNudge = null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2800)}
async function api(path, opts={}){
  try{return await window.GlimStorage.adapter.request(path, opts)}
  catch(error){
    const message=String(error?.message||'');
    if(/paypal|sandbox|gemini|GEMINI_API_KEY|server mode/i.test(message)){
      const friendly=path.includes('/api/paypal')?'The funding connection could not be completed. Review the connection settings or try again.':'This action is not available for this profile. Your plan and estimates remain available.';
      throw new Error(friendly);
    }
    throw error;
  }
}
function money(v){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2}).format(Number(v||0))}
function show(view){['onboardingView','dashboardView'].forEach(id=>$('#'+id)?.classList.toggle('hidden',id!==view));const logout=$('#logoutBtn');if(logout)logout.classList.toggle('hidden',view==='authView')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function friendlySystemText(value,limit=220){return String(value??'').replace(/\bPayPal(?:\s+Sandbox)?\b/gi,'funding service').replace(/\bSandbox\b/gi,'demo').replace(/\bGemini\b/gi,'plan assistant').replace(/\bGEMINI_API_KEY\b/gi,'AI settings').replace(/\bserver mode\b/gi,'this profile').replace(/\bwebhooks?\b/gi,'payment confirmations').replace(/\bidempotency key\b/gi,'duplicate-payment protection').slice(0,limit)}
function profileIsReady(profile){return Number(profile?.monthly_income)>0 && profile?.average_monthly_expenses!==null && profile?.average_monthly_expenses!==undefined && Number.isFinite(Number(profile.average_monthly_expenses))}

function render(){
  const s=STATE, debts=s.debts||[], activeDebts=debts.filter(d=>d.status==='active'), debt=activeDebts[0]||debts[0];
  if(!profileIsReady(s.profile)){show('onboardingView');return}
  show('dashboardView');
  $('#dailyDrip').textContent=money(s.daily_drip);
  $('#streak').textContent=s.game.streak;
  $('#points').textContent=s.game.points;
  $('#level').textContent=s.game.level;
  $('#freezes').textContent=s.game.freezes;
  const stageLabel=({'Revolver':'Building momentum','Boss Slayer':'Debt paid off','debt Slayer':'Debt paid off','Sprout':'Building consistency','Shielded':'Savings buffer reached','Transactor':'Paying in full'}[s.game.evolution_stage]||s.game.evolution_stage);
  $('#stage').textContent=stageLabel;
  $('#evolution').textContent=stageLabel;
  $('#evolutionCopy').textContent=s.game.evolution_stage==='Transactor'?'Your buffer is funded and active debts are paid.':s.game.evolution_stage==='Shielded'?'Your savings buffer reached its first target.':s.game.evolution_stage==='Boss Slayer'?'You paid off a debt. Choose where the freed payment goes next.':'Build a savings buffer while steadily reducing debt.';
  renderDebtList(debts);
  $('#strategySection')?.classList.toggle('hidden',activeDebts.length===0);
  $('#debtBalance').textContent=money(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0));
  $('#debtInfo').textContent=activeDebts.length?`${activeDebts.length} active ${activeDebts.length===1?'debt':'debts'} · Highest interest rate ${Math.max(...activeDebts.map(d=>Number(d.apr||0))).toFixed(2)}%`:'No active debt yet. Add a debt to start a payoff plan.';
  $('#stashBalance').textContent=money(s.stash.balance);
  $('#shieldInfo').textContent=`Savings target: ${money(s.stash.shield_threshold)}`;
  $('#planStrategy').textContent=s.plan?.strategy?({avalanche:'Highest rate first',snowball:'Smallest balance first',hybrid:'Balanced approach'}[s.plan.strategy]||s.plan.strategy):'Not set';
  $('#planMeta').textContent=s.plan?.projection?`${s.plan.projection.months} months estimated`:'Add a debt to see a projection.';
  const health=debt?Math.max(0,Math.min(100,(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0)/(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0)+(s.daily_drip*30*12||1)))*100)):0;
  $('#healthFill').style.width=health+'%';
  $('#stashFill').style.width=Math.min(100,s.stash.balance/Math.max(1,s.stash.shield_threshold)*100)+'%';
  const localMode=window.GlimStorage?.mode==='localStorage';
  const fundingReady=s.paypal?.status==='connected' && !localMode && s.payment_readiness!==false;
  const dripNote=$('#dripStatusNote');
  if(dripNote) dripNote.textContent=!activeDebts.length?'Add your first debt to calculate a payoff estimate.':s.paused?'Contributions are paused. You can review this in Settings.':localMode?'Suggested from your monthly income, expenses, and savings target.':(s.paypal?.status==='connected'&&s.payment_readiness===false)?'Review the funding connection in Settings before approving a contribution.':!fundingReady?'Connect a funding account in Settings to approve contributions.':'Balances update after your contribution is confirmed.';
  $('#planBtn').disabled=!activeDebts.length;$('#whatIfBtn').disabled=!s.plan?.projection;$$('.strategy').forEach(button=>button.disabled=!activeDebts.length);
  $('#approveDrip').textContent=!activeDebts.length?'Add your first debt':s.paused?'Review contribution settings':localMode?'Review debt plan':(s.paypal?.status==='connected'&&s.payment_readiness===false)?'Review contribution settings':!fundingReady?'Connect funding account':Number(s.daily_drip)<=0?'Review debt plan':'Review today’s contribution';
  if(s.plan?.projection){const stash=s.daily_drip*s.plan.stash_pct/100;$('#stashShare').textContent=money(stash);$('#bossShare').textContent=money(s.daily_drip-stash);renderProjection(s.plan.projection);$('#attackOrder').textContent=`Repayment order: ${(s.plan.attack_order||[]).join(' → ')}`;}
  else{$('#stashShare').textContent='—';$('#bossShare').textContent='—';$('#projection').innerHTML='<p class="muted">Add a debt above to see a payoff estimate.</p>';$('#attackOrder').textContent='Your strategy will appear after you add a debt.';}
  renderDefeat(); renderNotifications(); renderAudit(); renderChart(); renderShop(); renderSquad(); renderStash();
  $('#pauseTitle').textContent=s.paused?'Practice steps are paused':'Practice steps are active';
  $('#pauseHelp').textContent=s.paused?'Resume when you are ready to track daily steps again.':'Pause stops new daily-step records and streak updates.';
  $('#pauseBtn').textContent=s.paused?'Resume progress tracking':'Pause progress tracking';
}
async function renderNotifications(){
  const data=await api('/api/notifications');const settings=data.settings||{};const localMode=window.GlimStorage?.mode==='localStorage';
  const start=$('#notifStart'),end=$('#notifEnd'),cap=$('#notifCap'),channel=$('#notifChannel'),zone=$('#notifTimezone');
  if(start)start.value=settings.quiet_start||STATE?.profile?.quiet_start||'22:00';
  if(end)end.value=settings.quiet_end||STATE?.profile?.quiet_end||'08:00';
  if(cap)cap.value=Number(settings.daily_cap??STATE?.profile?.notification_cap??3);
  if(zone)zone.value=STATE?.profile?.timezone||'America/Toronto';
  if(channel){const config=localMode?{enabled:false,email_enabled:false}:await api('/api/push/config').catch(()=>({enabled:false,email_enabled:false}));const email=channel.querySelector('option[value="email"]'),push=channel.querySelector('option[value="web_push"]');if(email)email.disabled=!config.email_enabled;if(push)push.disabled=!config.enabled;channel.value=settings.channel==='in_app'?'in_app':(settings.channel||'in_app');if(channel.selectedOptions[0]?.disabled)channel.value='in_app';}
  const inbox=$('#inbox');if(inbox){const items=Array.isArray(data.items)?data.items:[];inbox.innerHTML=items.length?items.map(item=>`<article class="inbox-item"><strong>${escapeHtml(friendlySystemText(item.message||'Glim check-in'))}</strong><p>${escapeHtml(friendlySystemText(item.why||'A check-in was selected from your reminder settings.'))}</p><span>${new Date(item.created_at).toLocaleString()}${item.response?` · Response: ${escapeHtml(({acted:'I took a step',opened:'I read this',snoozed:'Remind me later',dismissed:'Dismissed',muted:'Fewer check-ins'}[item.response]||item.response))}`:''}</span></article>`).join(''):'<p class="muted">No check-ins yet. Your reminders appear here when you request one.</p>';}
  const stress=$('#stressCopy'),detail=$('#stressDetail');if(stress)stress.textContent=data.stress_mode?'Supportive reminders':'Calm reminders';if(detail)detail.textContent=data.stress_mode?'Reminders stay gentle while contributions are paused or recent reminders have been skipped.':'Reminders follow your saved preferences and daily limit.';
  return data;
}

function visualIcon(key){const paths={leaf:'<path d="M19 3C10 3 5 7 5 13c0 4 3 6 6 6 6 0 8-7 8-16Z"/><path d="M3 21 14 10"/>',acorn:'<path d="M8 8c-2 1-3 4-3 7 0 4 3 6 7 6s7-2 7-6c0-3-1-6-3-7"/><path d="M7 8h10l-1-3H8Z"/><path d="M12 5V2"/>',moon:'<path d="M19 15A8 8 0 0 1 9 5 8 8 0 1 0 19 15Z"/>',tree:'<path d="M12 2 5 11h4l-5 6h6v5h4v-5h6l-5-6h4Z"/>',spark:'<path d="m12 2 2.1 6.2L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-1.8Z"/>'};return `<svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[key]||paths.spark}</svg>`}

function renderProjection(p){$('#projection').innerHTML=`<div><span class="data-label">Debt-free</span><strong>${p.months} mo</strong><span class="muted">modeled</span></div><div><span class="data-label">Interest</span><strong>${money(p.interest_paid)}</strong><span class="muted">modeled</span></div><div><span class="data-label">Interest saved</span><strong>${money(p.interest_saved)}</strong><span class="muted">vs minimum-only</span></div>`}
function renderDebtList(debts){
 const host=$('#debtList');if(!host)return;
 if(!debts.length){host.innerHTML='<p class="muted">No debts added yet. Add your first debt to build a payoff plan.</p>';return;}
 const sorted=[...debts].sort((a,b)=>(a.status==='active'?0:1)-(b.status==='active'?0:1));
 host.innerHTML=sorted.map(d=>`<article class="debt-row"><div class="debt-row-main"><strong>${escapeHtml(d.name)}</strong><span class="muted">${d.type==='loan'?'Loan':'Credit card'} · ${d.status==='active'?'Active':'Paid off'}</span></div><div class="debt-row-numbers"><strong>${money(d.balance)}</strong><span class="muted">${Number(d.apr||0).toFixed(2)}% APR · ${money(d.minimum)} minimum / month</span></div></article>`).join('');
}

function renderDefeat(){const b=$('#defeatBanner');const p=STATE.pending_redirect;if(!p){b.classList.add('hidden');return}b.classList.remove('hidden');const others=(STATE.debts||[]).filter(d=>d.status==='active');b.innerHTML=`<strong>Debt paid off: ${escapeHtml(p.debt_name)}.</strong> The freed payment is ${money(p.freed_payment)}. Choose where it goes next. <div class="button-row" style="margin-top:10px"><button class="secondary" data-redirect="stash">Move to savings</button>${others.map(d=>`<button class="secondary" data-redirect="${d.id}">Next: ${escapeHtml(d.name)}</button>`).join('')}</div>`;b.querySelectorAll('[data-redirect]').forEach(btn=>btn.onclick=async()=>{try{await api('/api/debt/redirect',{method:'POST',body:JSON.stringify({destination:btn.dataset.redirect==='stash'?'stash':Number(btn.dataset.redirect)})});await load();toast('Freed payment redirected.')}catch(e){toast(e.message)}})}
async function renderChart(){try{const r=await api('/api/debt-chart');const svg=$('#debtChart');if(!r.balances.length){svg.innerHTML='<text x="24" y="40" class="chart-label">Add a debt above to see an estimated payoff path.</text>';return}const W=640,H=220,P=30,max=Math.max(...r.minimum_only,1);const pts=a=>a.map((v,i)=>`${P+(W-2*P)*i/(a.length-1||1)},${H-P-(H-2*P)*v/max}`).join(' ');svg.innerHTML=`<line class="chart-grid" x1="${P}" y1="${P}" x2="${P}" y2="${H-P}"/><line class="chart-grid" x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}"/><polyline class="chart-line" points="${pts(r.balances)}"/><polyline class="chart-saving" points="${pts(r.minimum_only)}"/><text class="chart-label" x="${P}" y="15">Chosen strategy</text><text class="chart-label" x="${W-155}" y="15">Minimum payment</text>`}catch{}}
async function renderAudit(){
  try{
    const rows=await api('/api/audit');
    const names={build_plan:'Updated repayment plan',persona_seed:'Loaded an example starting point',seeded_activity_review:'Reviewed example activity',debt_created:'Added a debt',daily_drip:'Recorded a daily contribution',local_drip_recorded:'Recorded a daily contribution',pause_drips:'Paused daily contributions',pause:'Paused daily contributions',resume_drips:'Resumed daily contributions',resume:'Resumed daily contributions',nudge:'Created a check-in',nudge_response:'Saved a check-in response',coach_chat:'Answered a plan question',what_if:'Compared a scenario',freed_payment_redirect:'Chose where the freed payment should go',streak_freeze:'Used a monthly grace day',stash_goal_created:'Added a savings goal',monthly_deposit_preference:'Saved a monthly savings target',lesson_complete:'Completed a lesson',cosmetic_purchase:'Unlocked a reward',profile_updated:'Updated plan preferences'};
    const describeResult=(raw)=>{
      const r=raw&&typeof raw==='object'?raw:{};
      if(r.amount!=null) return `Suggested allocation: ${money(r.stash_share)} to savings and ${money(r.debt_share)} to debt.`;
      if(r.name&&r.target_amount!=null) return `Goal “${r.name}” · target ${money(r.target_amount)}.`;
      if(r.response) return `Your response: ${{acted:'I took a step',opened:'I read this',snoozed:'Remind me later',dismissed:'Dismissed',muted:'Fewer check-ins'}[r.response]||'Saved'}.`;
      if(r.strategy) return `Strategy: ${{avalanche:'highest interest rate first',snowball:'smallest balance first',hybrid:'balanced approach'}[r.strategy]||r.strategy}.`;
      if(r.points!=null) return `${r.points} points recorded.`;
      if(r.paused===true) return 'New practice steps are paused.';
      if(r.paused===false) return 'New practice steps can be recorded again.';
      if(r.message) return friendlySystemText(r.message,220);
      return '';
    };
    $('#auditList').innerHTML=rows.length?rows.map(r=>{
      const key=String(r.input_ref||'').replaceAll('_',' ');
      const title=names[r.input_ref]||key.replace(/^./,c=>c.toUpperCase())||'Plan update';
      const rationaleByAction={build_plan:'Recalculated the estimate from your balances, interest rates and selected strategy.',persona_seed:'Loaded an example starting point.',seeded_activity_review:'Reviewed available connected-account activity.',debt_created:'Added the debt details you entered to your plan.',what_if:'Compared a possible change against the current payoff estimate.',local_drip_recorded:'Recorded the daily step and updated the planning totals.',pause:'Paused daily-step and streak tracking.',resume:'Resumed daily-step and streak tracking.',coach_chat:'Answered using your plan and available guidance.',nudge_response:'Saved your response to adjust future check-ins.',stash_goal_created:'Created a savings goal.',monthly_deposit_preference:'Saved the monthly savings target.',lesson_complete:'Recorded the lesson completion and its points.',streak_freeze:'Used a monthly grace day without losing your progress.'};
      const rationale=friendlySystemText(rationaleByAction[r.input_ref]||r.rationale||'This action was recorded from your choice in Glim.');
      const outcome=describeResult(r.result);
      return `<article class="audit-entry"><div class="audit-entry-head"><strong>${escapeHtml(title)}</strong><span>${new Date(r.created_at).toLocaleString()}</span></div><p>${escapeHtml(rationale)}</p>${outcome?`<p class="audit-outcome">${escapeHtml(outcome)}</p>`:''}</article>`;
    }).join(''):'<p class="muted">No activity recorded yet. Changes to your plan and practice progress will appear here with an explanation.</p>';
  }catch{}
}
async function renderShop(){try{const x=await api('/api/cosmetics');$('#shop').innerHTML=x.items.map(i=>`<article class="shop-item"><div class="shop-icon">${visualIcon(i.id===1?'leaf':i.id===2?'acorn':'moon')}</div><strong>${escapeHtml(i.name)}</strong><p class="muted">${escapeHtml(i.description)}</p><span class="price">${i.owned?'Unlocked':i.cost+' points'}</span>${i.owned?'<span class="owned-label">In your collection</span>':` <button class="secondary" data-buy="${i.id}" type="button">Unlock</button>`}</article>`).join('');$$('[data-buy]').forEach(b=>b.onclick=async()=>{try{await api(`/api/cosmetics/${b.dataset.buy}/buy`,{method:'POST'});await load();toast('Reward unlocked.')}catch(e){toast(e.message)}})}catch{}}
async function renderSquad(){
 try{
  const x=await api('/api/squads');const squad=x.squad;const localMode=window.GlimStorage?.mode==='localStorage';
  const joinForm=$('#joinSquadForm'),joinBtn=$('#joinSquadBtn'),leaveBtn=$('#leaveSquadBtn'),createBtn=$('#createSquadBtn');
  if(joinForm)joinForm.classList.toggle('hidden',localMode);if(joinBtn)joinBtn.disabled=localMode;if(createBtn)createBtn.disabled=false;if(leaveBtn)leaveBtn.classList.add('hidden');
  if(!squad){$('#squadInfo').innerHTML=localMode?'<p class="muted">Group invitations are not available for this profile yet. You can still track your own progress.</p>':'<p class="muted">Create a group and invite friends to encourage each other.</p>';$('#leaderboard').innerHTML='<p class="muted">Group progress appears here after you create or join a group.</p>';$('#cheerFeed').innerHTML='';$('#squadGoals').innerHTML='<p class="muted">Create a group before setting a shared challenge.</p>';$('#squadRewards').innerHTML='';return;}
  const codeMarkup=localMode?'<p class="muted">Invite sharing is not available for this profile.</p>':`<p>Invite code: <strong>${escapeHtml(squad.invite_code||'Unavailable')}</strong> <button class="secondary" type="button" id="copySquadCodeBtn">Copy code</button></p>`;
  $('#squadInfo').innerHTML=`<div class="callout"><strong>${escapeHtml(squad.name)}</strong>${codeMarkup}<p class="muted">Only days on track and goal progress are shared. Balances, income and debt details are not included.</p></div>`;
  const members=Array.isArray(x.members)?x.members:[];
  $('#leaderboard').innerHTML=members.length?members.map((m,i)=>`<div class="leader-row"><strong>${i+1}. ${escapeHtml(m.display_name||'Member')}${m.is_self?' (you)':''}</strong><span>${Number(m.streak||0)} days on track · ${Number(m.goal_pct||0).toFixed(0)}% consistency</span>${!localMode&&!m.is_self?`<div class="button-row"><button class="secondary" data-cheer-member="${Number(m.id)}" data-cheer="Great progress!">Great progress!</button><button class="secondary" data-cheer-member="${Number(m.id)}" data-cheer="Keep going!">Keep going!</button></div>`:''}</div>`).join(''):'<p class="muted">No members to show yet.</p>';
  $('#cheerFeed').innerHTML=x.cheers?.length?`<h3>Recent cheers</h3>${x.cheers.map(ch=>`<div class="inbox-item"><strong>${escapeHtml(ch.sender_name||ch.sender||'Member')} → ${escapeHtml(ch.to_member_name||'member')}</strong><p>${escapeHtml(ch.cheer)}</p><span>${new Date(ch.created_at).toLocaleString()}</span></div>`).join('')}`:'<p class="muted">Cheer activity will appear here when a member sends one.</p>';
  $('#squadGoals').innerHTML=x.goals?.length?x.goals.map(g=>{const pct=Math.min(100,Number(g.progress_count)/Math.max(1,Number(g.target_count))*100);return `<article class="stash-goal"><div class="goal-title"><strong>${escapeHtml(g.title)}</strong><span class="badge">${g.status==='completed'?'Complete':'In progress'}</span></div><div class="goal-amount"><strong>${Number(g.progress_count||0)} / ${Number(g.target_count||0)}</strong><span class="muted">member-days</span></div><div class="progressbar"><span style="width:${pct}%"></span></div><div class="goal-foot"><span>Reward: ${escapeHtml(g.reward_name||'Reward')}</span><span>${pct.toFixed(0)}% complete</span></div></article>`}).join(''):'<p class="muted">No shared goal created yet.</p>';
  $('#squadRewards').innerHTML=x.unlocked_cosmetics?.length?`<h3>Group rewards unlocked</h3><div class="reward-list">${x.unlocked_cosmetics.map(r=>`<span class="reward-chip">${visualIcon(r.cosmetic_id===1?'leaf':r.cosmetic_id===2?'acorn':'moon')} ${escapeHtml(r.name)}</span>`).join('')}</div>`:'';
  if(!localMode){if(leaveBtn)leaveBtn.classList.remove('hidden');$('#copySquadCodeBtn')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(squad.invite_code||''));toast('Invite code copied.')}catch{const note=$('#squadActionNote');if(note)note.textContent=`Copy this invite code: ${squad.invite_code||''}`}});}
  $('#leaderboard').querySelectorAll('[data-cheer-member]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/squads/cheer',{method:'POST',body:JSON.stringify({member_id:Number(button.dataset.cheerMember),cheer:button.dataset.cheer})});await renderSquad();toast('Cheer sent.')}catch(e){toast(e.message);button.disabled=false}}));
 }catch(e){console.error(e);const host=$('#squadInfo');if(host)host.textContent=e.message;}
}
async function renderStash(){
  try{
    const x=await api('/api/stash/goals');
    const balance=Number(x.stash_balance||0);
    const target=Math.max(1,Number(STATE?.stash?.shield_threshold||500));
    const pct=Math.max(0,Math.min(100,balance/target*100));
    const label=$('#bufferStatus'),summary=$('#bufferSummary'),progress=$('#bufferProgressText'),fill=$('#bufferFill'),host=$('#stashGoals');
    if(label)label.textContent=pct>=100?'Target reached':pct>=50?'Halfway there':balance>0?'Getting started':'Not started';
    if(summary)summary.textContent=`${money(balance)} saved toward your buffer`;
    if(progress)progress.textContent=`${pct.toFixed(0)}% of ${money(target)} target`;
    if(fill)fill.style.width=pct+'%';
    if(host)host.innerHTML=x.goals.length?x.goals.map(g=>{const goalPct=Math.min(100,Number(g.saved_amount)/Math.max(1,Number(g.target_amount))*100);return `<article class="stash-goal"><div class="goal-title"><strong>${escapeHtml(g.name)}</strong><span class="badge">${g.status==='completed'?'Complete':'In progress'}</span></div><div class="goal-amount"><strong>${money(g.saved_amount)}</strong><span class="muted">of ${money(g.target_amount)}</span></div><div class="progressbar"><span style="width:${goalPct}%"></span></div><div class="goal-foot"><span>${goalPct.toFixed(0)}% complete</span><span>${Number(g.monthly_target)>0?money(g.monthly_target)+'/mo target':'No monthly target'}</span></div></article>`}).join(''):'<p class="muted">No savings goals yet. Add one to track progress toward a specific target.</p>';
  }catch(e){console.error(e)}
}

async function load(){
  try{
    const me=await api('/api/auth/me');
    if(!me.authenticated){STATE=null;window.location.replace('/signin');return}
    STATE=await api('/api/state');
    if(!profileIsReady(STATE.profile)){
      if(window.location.pathname==='/setup') window.history.replaceState({}, '', '/app/overview');
      else if(window.location.pathname!=='/app/overview') { window.location.replace('/app/overview'); return; }
      if(Number(STATE.profile?.monthly_income)>0) $('#pIncome').value=STATE.profile.monthly_income;
      if(STATE.profile?.average_monthly_expenses!==null && STATE.profile?.average_monthly_expenses!==undefined && Number.isFinite(Number(STATE.profile.average_monthly_expenses))) $('#pExpenses').value=STATE.profile.average_monthly_expenses;
      if(Number.isFinite(Number(STATE.profile?.savings_pct))) { $('#pPct').value=STATE.profile.savings_pct; $('#pctOut').value=STATE.profile.savings_pct+'%'; }
      if(Number.isFinite(Number(STATE.profile?.floor_balance))) $('#pFloor').value=STATE.profile.floor_balance;
      show('onboardingView');
      return;
    }
    if(window.location.pathname==='/setup') { window.location.replace('/app/overview'); return; }
    show('dashboardView');
    applyOverviewPrefs();
    if(!STATE.plan?.projection && (STATE.debts||[]).some(d=>d.status==='active')){STATE.plan=await api('/api/plan',{method:'POST',body:JSON.stringify({strategy:selectedStrategy,stash_pct:65})})}
    await Promise.all([runScout(false), renderNotifications(), renderShop(), renderSquad(), renderStash(), renderSettlements(), setIntegrationStatus()]);
    render();
    maybeStartWalkthrough();
  }catch(e){console.error(e);toast(e.message||'Unable to load your Glim plan.');}
}

async function renderScoutDebtSuggestions(suggestions){
  const host=$('#scoutDebtSuggestions'); if(!host)return;
  if(window.GlimStorage?.mode==='localStorage'){
    host.innerHTML='<p class="muted">Recurring-activity review is unavailable for this profile. No sample findings are shown.</p>';return;
  }
  const items=Array.isArray(suggestions)?suggestions:[];
  if(!items.length){host.innerHTML='<p class="muted">No debt-related recurring payment needs review. Scout never adds a debt without your confirmation and account figures.</p>';return;}
  host.innerHTML=`<h3>Review possible debt payments</h3>${items.map(item=>{const ev=item.evidence||{};return `<article class="finding scout-debt-card" data-scout-id="${Number(item.id)}"><div><strong>${escapeHtml(item.name)}</strong><p class="muted">Observed ${Number(ev.transactions_observed||0)} similar transactions; cadence about ${Number(ev.median_interval_days||0)} days. Verify this is a debt before adding it.</p></div><div class="settings-grid"><label>Account type<select data-field="type"><option value="credit_card">Credit card</option><option value="loan">Loan / line of credit</option></select></label><label>Current balance (CAD)<input data-field="balance" type="number" min="0.01" step="0.01" required placeholder="Enter balance"/></label><label>APR (%)<input data-field="apr" type="number" min="0" max="100" step="0.01" required placeholder="Enter APR"/></label><label>Minimum payment (CAD)<input data-field="minimum" type="number" min="0.01" step="0.01" required placeholder="Enter minimum"/></label><label>Due day<input data-field="due_day" type="number" min="1" max="31" value="15" required/></label></div><div class="button-row"><button class="primary" type="button" data-scout-confirm="${Number(item.id)}">Confirm and add debt</button><button class="secondary" type="button" data-scout-dismiss="${Number(item.id)}">Dismiss</button></div><p class="muted" data-scout-message></p></article>`}).join('')}`;
  host.querySelectorAll('[data-scout-confirm]').forEach(button=>button.addEventListener('click',async()=>{const card=button.closest('[data-scout-id]');const read=f=>card.querySelector(`[data-field="${f}"]`)?.value;const balance=Number(read('balance')),apr=Number(read('apr')),minimum=Number(read('minimum')),due_day=Number(read('due_day'));const note=card.querySelector('[data-scout-message]');if(!(balance>0)||apr<0||apr>100||!(minimum>0)||due_day<1||due_day>31){note.textContent='Enter the verified balance, APR, minimum payment and due day.';return;}button.disabled=true;try{await api(`/api/scout/suggestions/${button.dataset.scoutConfirm}/confirm`,{method:'POST',body:JSON.stringify({type:read('type'),balance,apr,minimum,due_day})});toast('Confirmed debt added to your plan.');await load()}catch(e){note.textContent=e.message;button.disabled=false}}));
  host.querySelectorAll('[data-scout-dismiss]').forEach(button=>button.addEventListener('click',async()=>{const card=button.closest('[data-scout-id]');const note=card.querySelector('[data-scout-message]');button.disabled=true;try{await api(`/api/scout/suggestions/${button.dataset.scoutDismiss}/dismiss`,{method:'POST'});card.remove();toast('Suggestion dismissed.')}catch(e){note.textContent=e.message;button.disabled=false}}));
}
async function runScout(showToast=true){
  try{const r=await api('/api/scout',{method:'POST'});const rows=[];
    if(r.subscriptions?.length) rows.push(...r.subscriptions.map(x=>`<div class="finding"><div><strong>${escapeHtml(x.merchant)}</strong><span>${escapeHtml(x.signal||'From connected account activity')}</span></div><b>${money(x.monthly)}/month</b></div>`));
    else rows.push(`<p class="muted">${escapeHtml(r.source||'No verified recurring activity is available to review yet.')}</p>`);
    $('#scoutResults').innerHTML=rows.join('');await renderScoutDebtSuggestions(r.debt_suggestions||[]);if(showToast)toast('Available account activity refreshed.');
  }catch(e){$('#scoutResults').innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`;await renderScoutDebtSuggestions([])}
}
async function buildPlan(){if(!(STATE?.debts||[]).some(d=>d.status==='active')){toast('Add a debt before building a payoff plan.');return}try{STATE.plan=await api('/api/plan',{method:'POST',body:JSON.stringify({strategy:selectedStrategy,stash_pct:65})});render();toast('Plan recalculated.')}catch(e){toast(e.message)}}

$('#pPct').addEventListener('input',e=>$('#pctOut').value=e.target.value+'%');
$('#profileForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const debtName=$('#setupDebtName').value.trim();
  const debtBalance=$('#setupDebtBalance').value;
  const debtApr=$('#setupDebtApr').value;
  const debtMinimum=$('#setupDebtMinimum').value;
  const debtStarted=Boolean(debtName||debtBalance||debtApr||debtMinimum);
  if(debtStarted && (!debtName || debtBalance==='' || debtApr==='' || debtMinimum==='')){toast('Complete the first-debt fields, or leave them all blank.');return}
  if(debtStarted && (!(Number(debtBalance)>0)||Number(debtApr)<0||!(Number(debtMinimum)>0))){toast('Enter a positive balance and minimum payment, with a valid interest rate.');return}
  const income=Number($('#pIncome').value), expenses=Number($('#pExpenses').value), floor=Number($('#pFloor').value);
  if(!(income>0)||expenses<0||floor<0){toast('Check your monthly income, expenses and minimum balance.');return}
  try{
    await api('/api/profile',{method:'POST',body:JSON.stringify({name:'',persona:'custom',monthly_income:income,average_monthly_expenses:expenses,savings_pct:Number($('#pPct').value),approval_mode:'each',weekly_cap:60,floor_balance:floor,quiet_start:'22:00',quiet_end:'08:00',notification_cap:3,notification_channel:'in_app'})});
    if(debtStarted) await api('/api/debts',{method:'POST',body:JSON.stringify({name:debtName,type:$('#setupDebtType').value,balance:Number(debtBalance),apr:Number(debtApr),minimum:Number(debtMinimum),due_day:15})});
    window.location.assign('/app/overview');
  }catch(error){toast(error.message||'Unable to save your plan.');}
});
$('#debtForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/debts',{method:'POST',body:JSON.stringify({name:$('#dName').value,type:$('#dType').value,balance:+$('#dBalance').value,apr:+$('#dApr').value,minimum:+$('#dMin').value,due_day:15})});$('#debtForm').reset();await load();toast('Debt added.')}catch(e){toast(e.message)}});
$('#scanBtn').addEventListener('click',()=>runScout(true));
$$('.strategy').forEach(b=>b.addEventListener('click',()=>{$$('.strategy').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedStrategy=b.dataset.strategy;buildPlan()}));
$('#planBtn').addEventListener('click',buildPlan);
$('#whatIfBtn').addEventListener('click',async()=>{if(!STATE?.plan?.projection){$('#whatIfResult').textContent='Add a debt in Debt plan before comparing scenarios.';return}try{const r=await api('/api/what-if',{method:'POST',body:JSON.stringify({text:$('#whatIfInput').value})});if(!r.what_if){$('#whatIfResult').textContent='Add a more specific what-if phrase.';return}$('#whatIfResult').textContent=`${r.parsed.label}${r.parsed.assumptions?.length?' Assumptions: '+r.parsed.assumptions.join(' '):''}${r.parsed.needs_clarification?' Add the missing detail before Glim estimates the impact.':r.what_if?` Estimated payoff: ${r.what_if.months} months and ${money(r.what_if.interest_paid)} modeled interest.`:''}`;$('#scenarioComparison').innerHTML=r.what_if?`<div><strong>Current</strong><br>${STATE.plan.projection.months} months · ${money(STATE.plan.projection.interest_paid)} interest</div><hr/><div><strong>What-if</strong><br>${r.what_if.months} months · ${money(r.what_if.interest_paid)} interest<br><span class="muted">${Number(r.what_if.months_saved_vs_baseline||0)} months and ${money(r.what_if.interest_saved_vs_baseline||0)} interest difference versus current plan</span></div>`:''}catch(e){$('#whatIfResult').textContent=e.message}});
$('#approveDrip').addEventListener('click',async()=>{const hasActiveDebt=(STATE?.debts||[]).some(d=>d.status==='active');const localMode=window.GlimStorage?.mode==='localStorage';const fundingReady=STATE?.paypal?.status==='connected'&&!localMode&&STATE?.payment_readiness!==false;if(!hasActiveDebt){activateSection('plan',{push:true});const form=$('#debtDetails');if(form)form.open=true;$('#dName')?.focus();return;}if(STATE?.paused||(!localMode&&!fundingReady)){activateSection('settings',{push:true});return;}if(localMode||!STATE?.plan?.projection||Number(STATE?.daily_drip)<=0){activateSection('plan',{push:true});return;}try{await api('/api/drip/approve',{method:'POST',body:JSON.stringify({approve:true})});toast('Today’s contribution has been recorded.');await load()}catch(e){toast(e.message)}});
$('#freezeBtn').addEventListener('click',async()=>{try{await api('/api/game/freeze',{method:'POST'});await load();toast('Grace day used; your progress is saved.')}catch(e){toast(e.message)}});
$('#pauseBtn').addEventListener('click',async()=>{const wasPaused=Boolean(STATE?.paused);try{await api(wasPaused?'/api/resume':'/api/pause',{method:'POST'});await load();toast(wasPaused?'Progress tracking resumed.':'Progress tracking paused.')}catch(e){toast(e.message)}});
$$('.question-suggestion').forEach(button=>button.addEventListener('click',()=>{const input=$('#chatInput');input.value=button.dataset.question||'';$('#chatForm').requestSubmit()}));
$('#chatForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('#chatInput');const text=input.value.trim();if(!text)return;$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble user"><strong>You</strong><br>${escapeHtml(text)}</div>`);input.value='';try{const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message:text})});$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble"><strong>${escapeHtml(r.agent||'Glim')}</strong><br>${escapeHtml(r.message)}</div>`);$('#chatWindow').scrollTop=$('#chatWindow').scrollHeight}catch(e){toast(e.message)}});
$('#nudgeBtn').addEventListener('click',async()=>{try{lastNudge=await api('/api/nudge');$('#nudgeText').textContent=lastNudge.message;$('#nudgeWhy').textContent=lastNudge.why||'Why will appear here.';await renderNotifications()}catch(e){toast(e.message)}});
$$('.nudge-action').forEach(b=>b.addEventListener('click',async()=>{try{await api('/api/nudge/response',{method:'POST',body:JSON.stringify({response:b.dataset.response})});await load();toast('Check-in response saved.')}catch(e){toast(e.message)}}));
$('#saveNotifBtn').addEventListener('click',async()=>{try{const p=STATE.profile||{};await api('/api/profile',{method:'POST',body:JSON.stringify({...p,quiet_start:$('#notifStart').value,quiet_end:$('#notifEnd').value,notification_cap:+$('#notifCap').value,notification_channel:$('#notifChannel').value,timezone:$('#notifTimezone').value||'America/Toronto'})});await load();toast('Notification settings saved.')}catch(e){toast(e.message)}});

$('#stashGoalForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/stash/goals',{method:'POST',body:JSON.stringify({name:$('#stashGoalName').value.trim(),target_amount:+$('#stashGoalTarget').value,monthly_target:+$('#stashGoalMonthly').value||0})});$('#stashGoalForm').reset();$('#stashGoalMonthly').value='0';await renderStash();toast('Savings goal added.')}catch(e){toast(e.message)}});
$('#auditBtn')?.addEventListener('click',renderAudit);
$('#squadGoalForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads/goals',{method:'POST',body:JSON.stringify({title:$('#squadGoalTitle').value.trim(),target_count:+$('#squadGoalTarget').value,reward_cosmetic_id:+$('#squadGoalReward').value})});await renderSquad();$('#squadGoalTitle').value='';toast('Shared goal created.')}catch(e){toast(e.message)}});
$('#createSquadForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads',{method:'POST',body:JSON.stringify({name:$('#squadName').value.trim()})});await load();toast('Group created.')}catch(e){toast(e.message)}});
$('#loadLessonBtn').addEventListener('click',async()=>{try{const r=await api('/api/lessons/next');currentLesson=r.lesson||null;if(!currentLesson){$('#lessonCard').innerHTML='<strong>Path complete.</strong><p>You finished the current Sage path.</p>';return}$('#lessonCard').innerHTML=`<strong>${escapeHtml(currentLesson.title)}</strong><p>${escapeHtml(currentLesson.description)}</p><p>${escapeHtml(r.prompt)}</p><div class="input-row"><input id="lessonAnswer" placeholder="Your answer"/><button class="primary" id="lessonSubmit">Check</button></div><p class="muted">${r.points} points</p>`;$('#lessonSubmit').onclick=async()=>{try{const x=await api('/api/lessons/complete',{method:'POST',body:JSON.stringify({lesson_id:currentLesson.id,answer:$('#lessonAnswer').value})});$('#lessonCard').innerHTML=`<strong>Nice. +${x.points} points.</strong><p>Glim logged the applied challenge.</p>`;await load();}catch(e){toast(e.message)}}}catch(e){toast(e.message)}});
$('#exportBtn').addEventListener('click',async()=>{try{const data=await api('/api/data/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='glim-data-export.json';a.click();URL.revokeObjectURL(a.href);$('#dataMsg').textContent='Export created.'}catch(e){toast(e.message)}});
$('#deleteBtn').addEventListener('click',async()=>{if(!confirm('Delete your Glim account data? This cannot be undone.'))return;try{await api('/api/account',{method:'DELETE'});STATE=null;window.location.assign('/signin')}catch(e){toast(e.message)}});
const APP_SECTIONS=['overview','plan','settings'];
function activeSectionFromPath(){const part=window.location.pathname.split('/').filter(Boolean).pop();return APP_SECTIONS.includes(part)?part:'overview'}
function activateSection(section,{push=false,replace=false}={}){
  if(!APP_SECTIONS.includes(section))section='overview';
  $$('.tab').forEach(link=>{const active=link.dataset.tab===section;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
  $$('.tab-panel').forEach(panel=>panel.classList.toggle('hidden',panel.id!=='tab-'+section));
  if(push)history.pushState({section},'',`/app/${section}`);
  else if(replace && window.location.pathname!==`/app/${section}`)history.replaceState({section},'',`/app/${section}`);
}
$$('.tab').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();const section=link.dataset.tab;activateSection(section,{push:true});}));
window.addEventListener('popstate',()=>activateSection(activeSectionFromPath()));
activateSection(activeSectionFromPath());
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});STATE=null;window.location.assign('/signin')}catch(e){toast(e.message)}});
$('#fundingConnectBtn')?.addEventListener('click',async()=>{const b=$('#fundingConnectBtn');b.disabled=true;try{const r=await api('/api/paypal/connect',{method:'POST'});if(r.approval_url){$('#fundingApprovalLink').innerHTML=`<a class="text-link" href="${escapeHtml(r.approval_url)}" rel="noopener">Continue account approval</a>`;window.location.assign(r.approval_url);return;}await load();}catch(e){toast(e.message)}finally{b.disabled=false;await setIntegrationStatus()}});
$('#fundingDisconnectBtn')?.addEventListener('click',async()=>{if(!confirm('Disconnect this funding account? Existing pending contributions must be reconciled first.'))return;const b=$('#fundingDisconnectBtn');b.disabled=true;try{await api('/api/paypal/disconnect',{method:'POST'});await load();toast('Funding account disconnected.')}catch(e){toast(e.message)}finally{b.disabled=false;await setIntegrationStatus()}});
$('#settleWeekBtn')?.addEventListener('click',async()=>{const b=$('#settleWeekBtn');b.disabled=true;const out=$('#settlementActionResult');try{const r=await api('/api/drip/settle',{method:'POST'});out.textContent=`Contribution status: ${r.status||'submitted'} · ${r.amount==null?'':money(r.amount)+' CAD'}.`;if(r.approval_url)out.innerHTML+=` <a class="text-link" href="${escapeHtml(r.approval_url)}" rel="noopener">Continue approval</a>`;await load()}catch(e){out.textContent=e.message;await setIntegrationStatus()}finally{b.disabled=false}});
$('#reconcileBtn')?.addEventListener('click',async()=>{const b=$('#reconcileBtn'),out=$('#settlementActionResult');b.disabled=true;try{const r=await api('/api/drip/reconcile',{method:'POST'});out.textContent=`Payment status refreshed. ${Number(r.reconciled||0)} settlement(s) reconciled.`;await load()}catch(e){out.textContent=e.message}finally{b.disabled=false}});
$('#joinSquadForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads/join',{method:'POST',body:JSON.stringify({invite_code:$('#squadInviteCode').value.trim()})});$('#squadActionNote').textContent='Joined group.';$('#squadInviteCode').value='';await load()}catch(error){$('#squadActionNote').textContent=error.message}});
$('#leaveSquadBtn')?.addEventListener('click',async()=>{if(!confirm('Leave this group? Your shared membership and encouragement will be removed.'))return;try{await api('/api/squads/leave',{method:'POST'});await load();toast('Left group.')}catch(e){toast(e.message)}});
$('#pushEnableBtn').addEventListener('click',async()=>{try{if(window.GlimStorage.mode==='localStorage')throw new Error('Additional reminders are not available for this profile. In-app reminders remain available.');if(!('serviceWorker' in navigator))throw new Error('This browser does not support service workers.');const cfg=await api('/api/push/config');if(!cfg.enabled)throw new Error('Additional reminders are not available right now. In-app reminders remain available.');const reg=await navigator.serviceWorker.register('/sw.js');const perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('Browser notifications were not granted.');const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.public_key)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});toast('Web push enabled.')}catch(e){toast(e.message)}});
function urlBase64ToUint8Array(base64){const pad='='.repeat((4-base64.length%4)%4);const raw=atob((base64+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}


async function setIntegrationStatus(){
 const localMode=window.GlimStorage?.mode==='localStorage';
 const mode=$('#integrationModeStatus'),connection=$('#fundingStatus');
 const connect=$('#fundingConnectBtn'),disconnect=$('#fundingDisconnectBtn'),scopeHost=$('#fundingPermissions'),approvalHost=$('#fundingApprovalLink'),pushBtn=$('#pushEnableBtn'),external=$('#externalNotificationStatus'),privacy=$('#privacyStorageStatus');
 if(localMode){
   if(mode)mode.textContent='Planning and estimates are available for this profile; transfers and external reminders are not enabled.';
   if(connection)connection.textContent='Not connected';
   if(connect){connect.disabled=true;connect.textContent='Connection unavailable';}
   if(disconnect)disconnect.classList.add('hidden');
   if(scopeHost)scopeHost.textContent='No funding account is connected.';
   if(approvalHost)approvalHost.textContent='';
   if(pushBtn)pushBtn.disabled=true;
   if(external)external.textContent='In-app reminders are available. Additional reminder channels are not enabled.';
   if(privacy)privacy.textContent='Your plan is saved in this browser profile and does not sync across devices.';
   const settle=$('#settleWeekBtn'),rec=$('#reconcileBtn');if(settle)settle.disabled=true;if(rec)rec.disabled=true;
   return;
 }
 if(mode)mode.textContent='Manage the account used for approved contributions.';
 if(privacy)privacy.textContent='Your plan is saved to your account. Export or delete controls apply to this account.';
 const [health,cfg]=await Promise.all([api('/api/paypal/health').catch(e=>({configured:false,authenticated:false,error:e.message,status:STATE?.paypal?.status||'disconnected'})),api('/api/push/config').catch(()=>({enabled:false,email_enabled:false}))]);
 const status=STATE?.paypal?.status||health.status||'disconnected';
 if(connection)connection.textContent=status==='connected'?(health.settlement_ready?'Connected':'Needs attention before contributions can be processed'):status==='awaiting_approval'?'Approval in progress':health.configured?(health.authenticated?'Ready to connect':'Connection needs attention'):'Not available';
 if(connect){connect.disabled=!health.configured||status==='connected'||status==='awaiting_approval';connect.textContent=status==='awaiting_approval'?'Waiting for approval':'Connect funding account';}
 if(disconnect)disconnect.classList.toggle('hidden',status!=='connected');
 if(scopeHost)scopeHost.textContent=status==='connected'?'Approved account permissions are active.':health.configured?'Permissions will be explained during account approval.':'A funding connection is not available here.';
 const approval=STATE?.paypal?.approval_url||health.approval_url;
 if(approvalHost)approvalHost.innerHTML=status==='awaiting_approval'&&approval?`<a class="text-link" href="${escapeHtml(approval)}" rel="noopener">Continue account approval</a>`:'';
 const emailOption=$('#notifChannel option[value="email"]'),pushOption=$('#notifChannel option[value="web_push"]');if(emailOption)emailOption.disabled=!cfg.email_enabled;if(pushOption)pushOption.disabled=!cfg.enabled;
 if(external)external.textContent=`Email ${cfg.email_enabled?'available':'unavailable'}; browser notifications ${cfg.enabled?'available':'unavailable'}.`;
 if(pushBtn)pushBtn.disabled=!cfg.enabled||!('serviceWorker' in navigator)||!('PushManager' in window);
 if(pushBtn)pushBtn.textContent=cfg.enabled?'Enable browser notifications':'Browser notifications unavailable';
}

function settlementStatusLabel(status){
 const value=String(status||'').toLowerCase();
 if(['paid','complete','completed','settled','success','succeeded','payout_succeeded'].includes(value))return 'Complete';
 if(value==='awaiting_approval')return 'Action required';
 if(['creating_order','capture_pending','capture_unknown','creating_payout','payout_pending','pending','processing','in_progress','submitted'].includes(value))return 'In progress';
 if(['capture_failed','payout_error','payout_failed','failed','error','cancelled','canceled'].includes(value))return 'Needs attention';
 if(value==='accrued')return 'Waiting for settlement';
 return 'Pending';
}
async function renderSettlements(){
 const host=$('#settlementList');if(!host)return;
 const localMode=window.GlimStorage?.mode==='localStorage';
 if(localMode){host.innerHTML='<p class="muted">Contributions cannot be submitted from this profile. Your estimates remain available.</p>';return;}
 try{
  const rows=await api('/api/ledger');
  const pending=Array.isArray(STATE?.settlements)?STATE.settlements:[];
  const accrued=(rows||[]).filter(r=>r.status==='accrued');
  const details=pending.map(r=>{
    const status=settlementStatusLabel(r.status);
    const retryable=['creating_order','capture_pending','capture_unknown','capture_failed','payout_error','payout_failed','creating_payout'].includes(String(r.status||'').toLowerCase());
    const ref=escapeHtml(r.reference||'');
    return `<article class="inbox-item"><strong>Contribution · ${status}</strong><p>${money(r.amount)} CAD</p>${r.status==='awaiting_approval'&&STATE?.paypal?.pending_settlement_approval_url?`<p><a class="text-link" href="${escapeHtml(STATE.paypal.pending_settlement_approval_url)}" rel="noopener">Continue account approval</a></p>`:''}<div class="button-row"><button class="secondary" type="button" data-reconcile-ref="${ref}">Review status</button>${retryable?`<button class="secondary" type="button" data-retry-ref="${ref}">Try again</button>`:''}</div></article>`;
  });
  if(accrued.length)details.unshift(`<p class="muted">${accrued.length} approved daily contribution(s), ${money(accrued.reduce((a,r)=>a+Number(r.amount||0),0))} CAD, waiting for the next settlement.</p>`);
  host.innerHTML=details.length?details.join(''):'<p class="muted">No pending contributions.</p>';
  host.querySelectorAll('[data-retry-ref]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api(`/api/drip/settlements/${encodeURIComponent(btn.dataset.retryRef)}/retry`,{method:'POST'});$('#settlementActionResult').textContent=`Contribution status: ${settlementStatusLabel(r.status)}.`;await load()}catch(e){$('#settlementActionResult').textContent=friendlySystemText(e.message);btn.disabled=false}}));
  host.querySelectorAll('[data-reconcile-ref]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api('/api/drip/reconcile',{method:'POST'});$('#settlementActionResult').textContent=`Contribution status reviewed. ${Number(r.reconciled||0)} item(s) updated.`;await load()}catch(e){$('#settlementActionResult').textContent=friendlySystemText(e.message);btn.disabled=false}}));
 }catch(e){host.innerHTML=`<p class="muted">${escapeHtml(friendlySystemText(e.message))}</p>`;}
}


const OVERVIEW_PREFS_KEY='glim.overview.preferences.v1';
const DEFAULT_OVERVIEW_PREFS={milestones:true,lessons:true,squad:true,coach:true,savings:true};
function readOverviewPrefs(){try{return {...DEFAULT_OVERVIEW_PREFS,...JSON.parse(localStorage.getItem(OVERVIEW_PREFS_KEY)||'{}')}}catch{return {...DEFAULT_OVERVIEW_PREFS}}}
function applyOverviewPrefs(){
 const prefs=readOverviewPrefs();
 document.querySelectorAll('[data-overview-extra]').forEach(node=>{const key=node.dataset.overviewExtra;node.classList.toggle('hidden',prefs[key]===false)});
 const support=$('#progressSupportDetails');
 if(support) support.classList.toggle('hidden',['milestones','lessons','squad','coach'].every(key=>prefs[key]===false));
 [['extraSavings','savings'],['extraMilestones','milestones'],['extraLessons','lessons'],['extraSquad','squad'],['extraCoach','coach']].forEach(([id,key])=>{const input=$('#'+id);if(input)input.checked=prefs[key]!==false});
}
[['extraSavings','savings'],['extraMilestones','milestones'],['extraLessons','lessons'],['extraSquad','squad'],['extraCoach','coach']].forEach(([id,key])=>$('#'+id)?.addEventListener('change',()=>{const prefs=readOverviewPrefs();prefs[key]=$('#'+id).checked;try{localStorage.setItem(OVERVIEW_PREFS_KEY,JSON.stringify(prefs))}catch{}applyOverviewPrefs()}));
applyOverviewPrefs();

const WALKTHROUGH_KEY='glim.walkthrough.completed.v1';
const WALKTHROUGH_STEPS=[
  {section:'overview',title:'Start with your progress',copy:'Overview shows your current debt, savings buffer, and the next suggested step. Optional features stay tucked away until you open them.'},
  {section:'plan',title:'Choose how to pay down debt',copy:'Add your debts, compare highest-interest-first and smallest-balance-first strategies, and review the estimated time and interest.'},
  {section:'settings',title:'Adjust Glim to fit you',copy:'Set reminder preferences, choose which optional Overview sections appear, manage your funding connection, and export or delete your data.'}
];
let walkthroughIndex=0;
let walkthroughReturnSection='overview';
function showWalkthroughStep(){
  const step=WALKTHROUGH_STEPS[walkthroughIndex];
  activateSection(step.section,{replace:true});
  $('#walkthroughStepLabel').textContent=`Step ${walkthroughIndex+1} of ${WALKTHROUGH_STEPS.length}`;
  $('#walkthroughTitle').textContent=step.title;
  $('#walkthroughCopy').textContent=step.copy;
  $('#walkthroughBackBtn').disabled=walkthroughIndex===0;
  $('#walkthroughNextBtn').textContent=walkthroughIndex===WALKTHROUGH_STEPS.length-1?'Finish tour':'Next';
}
function startWalkthrough(force=false){
  if(!force && localStorage.getItem(WALKTHROUGH_KEY))return;
  walkthroughReturnSection=activeSectionFromPath();walkthroughIndex=0;
  $('#walkthroughOverlay')?.classList.remove('hidden');
  if($('#walkthroughOverlay'))$('#walkthroughOverlay').setAttribute('aria-hidden','false');
  showWalkthroughStep();$('#walkthroughNextBtn')?.focus();
}
function closeWalkthrough(){
  $('#walkthroughOverlay')?.classList.add('hidden');
  if($('#walkthroughOverlay'))$('#walkthroughOverlay').setAttribute('aria-hidden','true');
  try{localStorage.setItem(WALKTHROUGH_KEY,'1')}catch{}
  activateSection(walkthroughReturnSection,{replace:true});
}
function maybeStartWalkthrough(){
  if(!$('#walkthroughOverlay')||!STATE||!profileIsReady(STATE.profile))return;
  if(!localStorage.getItem(WALKTHROUGH_KEY))startWalkthrough();
}
$('#startWalkthroughBtn')?.addEventListener('click',()=>startWalkthrough(true));
$('#walkthroughNextBtn')?.addEventListener('click',()=>{if(walkthroughIndex>=WALKTHROUGH_STEPS.length-1){closeWalkthrough();return}walkthroughIndex++;showWalkthroughStep()});
$('#walkthroughBackBtn')?.addEventListener('click',()=>{if(walkthroughIndex>0){walkthroughIndex--;showWalkthroughStep()}});
$('#walkthroughSkipBtn')?.addEventListener('click',closeWalkthrough);

setIntegrationStatus();
load();
