let STATE = null;
let selectedStrategy = 'avalanche';
let currentLesson = null;
let lastNudge = null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2800)}
async function api(path, opts={}){return window.GlimStorage.adapter.request(path, opts)}
function money(v){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2}).format(Number(v||0))}
function show(view){['setupView','onboardingView','dashboardView'].forEach(id=>$('#'+id)?.classList.toggle('hidden',id!==view));const logout=$('#logoutBtn');if(logout)logout.classList.toggle('hidden',view==='authView')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function profileIsReady(profile){return Number(profile?.monthly_income)>0 && !(profile?.sample_selected===true && profile?.setup_completed!==true && !String(profile?.name||'').trim())}

function render(){
  const s=STATE, debts=s.debts||[], activeDebts=debts.filter(d=>d.status==='active'), debt=activeDebts[0]||debts[0];
  if(!profileIsReady(s.profile)){show('setupView');return}
  show('dashboardView');
  $('#coachLine').textContent='Review your savings buffer, debt payoff estimate and next manageable step.';
  $('#dailyDrip').textContent=money(s.daily_drip);
  $('#streak').textContent=s.game.streak;
  $('#points').textContent=s.game.points;
  $('#level').textContent=s.game.level;
  $('#freezes').textContent=s.game.freezes;
  const stageLabel=({'Revolver':'Building momentum','Boss Slayer':'Debt paid off','debt Slayer':'Debt paid off','Shielded':'Savings buffer reached','Transactor':'Paying in full'}[s.game.evolution_stage]||s.game.evolution_stage);
  $('#stage').textContent=stageLabel;
  $('#evolution').textContent=stageLabel;
  $('#evolutionCopy').textContent=s.game.evolution_stage==='Transactor'?'Your buffer is funded and active debts are paid.':s.game.evolution_stage==='Shielded'?'Your savings buffer reached its first target.':s.game.evolution_stage==='Boss Slayer'?'You paid off a debt. Choose where the freed payment goes next.':'Build a savings buffer while steadily reducing debt.';
  $('#debtBalance').textContent=money(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0));
  $('#debtInfo').textContent=activeDebts.length?`${activeDebts.length} active ${activeDebts.length===1?'debt':'debts'} · Highest rate ${Math.max(...activeDebts.map(d=>Number(d.apr||0))).toFixed(2)}% APR`:'No active debt yet. Add a debt below to start a payoff plan.';
  $('#stashBalance').textContent=money(s.stash.balance);
  $('#shieldInfo').textContent=`First buffer target: ${money(s.stash.shield_threshold)}`;
  $('#planStrategy').textContent=s.plan?.strategy?({avalanche:'Highest rate first',snowball:'Smallest balance first',hybrid:'Balanced approach'}[s.plan.strategy]||s.plan.strategy):'Not set';
  $('#planMeta').textContent=s.plan?.projection?`${s.plan.projection.months} months estimated`:'Add a debt to see a projection.';
  const health=debt?Math.max(0,Math.min(100,(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0)/(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0)+(s.daily_drip*30*12||1)))*100)):0;
  $('#healthFill').style.width=health+'%';
  $('#stashFill').style.width=Math.min(100,s.stash.balance/Math.max(1,s.stash.shield_threshold)*100)+'%';
  $('#dripMsg').textContent=s.paused?'Practice steps are paused. Resume them in Settings to record a new step.':'This records practice progress only. It does not transfer money.';
  $('#approveDrip').disabled=s.paused||!activeDebts.length||!s.plan?.projection||Number(s.daily_drip)<=0;
  $('#planBtn').disabled=!activeDebts.length;$('#whatIfBtn').disabled=!s.plan?.projection;$$('.strategy').forEach(button=>button.disabled=!activeDebts.length);
  $('#approveDrip').textContent=s.paused?'Practice steps paused':!activeDebts.length?'Add a debt to begin':"Record today's step";
  if(s.plan?.projection){const stash=s.daily_drip*s.plan.stash_pct/100;$('#stashShare').textContent=money(stash);$('#bossShare').textContent=money(s.daily_drip-stash);renderProjection(s.plan.projection);$('#attackOrder').textContent=`Repayment order: ${(s.plan.attack_order||[]).join(' → ')}`;}
  else{$('#stashShare').textContent='—';$('#bossShare').textContent='—';$('#projection').innerHTML='<p class="muted">Add a debt from Overview to see a payoff estimate.</p>';$('#attackOrder').textContent='Your strategy will appear after you add a debt.';}
  renderDefeat(); renderNotifications(); renderAudit(); renderChart(); renderShop(); renderSquad(); renderStash();
  $('#pauseTitle').textContent=s.paused?'Practice steps are paused':'Practice steps are active';
  $('#pauseHelp').textContent=s.paused?'Resume when you are ready to record new steps again.':'Pause stops new practice-step records and streak progress. It does not change a payment or move money.';
  $('#pauseBtn').textContent=s.paused?'Resume progress tracking':'Pause progress tracking';
}
async function renderNotifications(){
  const data=await api('/api/notifications');
  const settings=data.settings||{};
  const start=$('#notifStart'), end=$('#notifEnd'), cap=$('#notifCap'), channel=$('#notifChannel');
  if(start)start.value=settings.quiet_start||STATE?.profile?.quiet_start||'22:00';
  if(end)end.value=settings.quiet_end||STATE?.profile?.quiet_end||'08:00';
  if(cap)cap.value=Number(settings.daily_cap??STATE?.profile?.notification_cap??3);
  if(channel)channel.value=settings.channel==='in_app'?'in_app':(settings.channel||'in_app');
  const inbox=$('#inbox');
  if(inbox){
    const items=Array.isArray(data.items)?data.items:[];
    inbox.innerHTML=items.length?items.map(item=>`<article class="inbox-item"><strong>${escapeHtml(item.message||'Glim check-in')}</strong><p>${escapeHtml(item.why||'A check-in was selected from your reminder settings.')}</p><span>${new Date(item.created_at).toLocaleString()}${item.response?` · Response: ${escapeHtml(({acted:'I took a step',opened:'I read this',snoozed:'Remind me later',dismissed:'Dismissed',muted:'Fewer check-ins'}[item.response]||item.response))}`:''}</span></article>`).join(''):'<p class="muted">No check-ins yet. Your reminders will appear here when you request one.</p>';
  }
  const stress=$('#stressCopy'), detail=$('#stressDetail');
  if(stress)stress.textContent=data.stress_mode?'Supportive check-ins':'Calm check-ins';
  if(detail)detail.textContent=data.stress_mode?'Glim keeps the language gentle while practice tracking is paused or recent check-ins have been skipped.':'Check-ins use your saved reminder preferences and daily limit.';
  return data;
}

function visualIcon(key){const paths={leaf:'<path d="M19 3C10 3 5 7 5 13c0 4 3 6 6 6 6 0 8-7 8-16Z"/><path d="M3 21 14 10"/>',acorn:'<path d="M8 8c-2 1-3 4-3 7 0 4 3 6 7 6s7-2 7-6c0-3-1-6-3-7"/><path d="M7 8h10l-1-3H8Z"/><path d="M12 5V2"/>',moon:'<path d="M19 15A8 8 0 0 1 9 5 8 8 0 1 0 19 15Z"/>',tree:'<path d="M12 2 5 11h4l-5 6h6v5h4v-5h6l-5-6h4Z"/>',spark:'<path d="m12 2 2.1 6.2L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-1.8Z"/>'};return `<svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[key]||paths.spark}</svg>`}

function renderProjection(p){$('#projection').innerHTML=`<div><span class="data-label">Debt-free</span><strong>${p.months} mo</strong><span class="muted">modeled</span></div><div><span class="data-label">Interest</span><strong>${money(p.interest_paid)}</strong><span class="muted">modeled</span></div><div><span class="data-label">Interest saved</span><strong>${money(p.interest_saved)}</strong><span class="muted">vs minimum-only</span></div>`}
function renderDefeat(){const b=$('#defeatBanner');const p=STATE.pending_redirect;if(!p){b.classList.add('hidden');return}b.classList.remove('hidden');const others=(STATE.debts||[]).filter(d=>d.status==='active');b.innerHTML=`<strong>Debt paid off: ${escapeHtml(p.debt_name)}.</strong> The freed payment is ${money(p.freed_payment)}. Choose where it goes next. <div class="button-row" style="margin-top:10px"><button class="secondary" data-redirect="stash">Move to savings</button>${others.map(d=>`<button class="secondary" data-redirect="${d.id}">Next: ${escapeHtml(d.name)}</button>`).join('')}</div>`;b.querySelectorAll('[data-redirect]').forEach(btn=>btn.onclick=async()=>{try{await api('/api/debt/redirect',{method:'POST',body:JSON.stringify({destination:btn.dataset.redirect==='stash'?'stash':Number(btn.dataset.redirect)})});await load();toast('Freed payment redirected.')}catch(e){toast(e.message)}})}
async function renderChart(){try{const r=await api('/api/debt-chart');const svg=$('#debtChart');if(!r.balances.length){svg.innerHTML='<text x="24" y="40" class="chart-label">Add a debt from Overview to see an estimated payoff path.</text>';return}const W=640,H=220,P=30,max=Math.max(...r.minimum_only,1);const pts=a=>a.map((v,i)=>`${P+(W-2*P)*i/(a.length-1||1)},${H-P-(H-2*P)*v/max}`).join(' ');svg.innerHTML=`<line class="chart-grid" x1="${P}" y1="${P}" x2="${P}" y2="${H-P}"/><line class="chart-grid" x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}"/><polyline class="chart-line" points="${pts(r.balances)}"/><polyline class="chart-saving" points="${pts(r.minimum_only)}"/><text class="chart-label" x="${P}" y="15">Chosen strategy</text><text class="chart-label" x="${W-155}" y="15">Minimum payment</text>`}catch{}}
async function renderAudit(){
  try{
    const rows=await api('/api/audit');
    const names={build_plan:'Updated repayment plan',persona_seed:'Loaded an example starting point',seeded_activity_review:'Reviewed example activity',debt_created:'Added a debt',daily_drip:'Recorded a practice step',local_drip_recorded:'Recorded a practice step',pause_drips:'Paused practice steps',pause:'Paused practice steps',resume_drips:'Resumed practice steps',resume:'Resumed practice steps',nudge:'Created a check-in',nudge_response:'Saved a check-in response',coach_chat:'Answered a plan question',what_if:'Compared a scenario',freed_payment_redirect:'Chose where the freed payment should go',streak_freeze:'Used a streak freeze',stash_goal_created:'Added a savings goal',monthly_deposit_preference:'Saved a monthly savings target',lesson_complete:'Completed a lesson',cosmetic_purchase:'Unlocked a reward',profile_updated:'Updated plan preferences'};
    const describeResult=(raw)=>{
      const r=raw&&typeof raw==='object'?raw:{};
      if(r.amount!=null) return `Practice step: ${money(r.amount)} planned · savings ${money(r.stash_share)} · debt ${money(r.debt_share)}. No money moved.`;
      if(r.name&&r.target_amount!=null) return `Goal “${r.name}” · target ${money(r.target_amount)}.`;
      if(r.response) return `Your response: ${{acted:'I took a step',opened:'I read this',snoozed:'Remind me later',dismissed:'Dismissed',muted:'Fewer check-ins'}[r.response]||'Saved'}.`;
      if(r.strategy) return `Strategy: ${{avalanche:'highest interest rate first',snowball:'smallest balance first',hybrid:'balanced approach'}[r.strategy]||r.strategy}.`;
      if(r.points!=null) return `${r.points} points recorded.`;
      if(r.paused===true) return 'New practice steps are paused.';
      if(r.paused===false) return 'New practice steps can be recorded again.';
      if(r.message) return String(r.message).slice(0,220);
      return '';
    };
    $('#auditList').innerHTML=rows.length?rows.map(r=>{
      const key=String(r.input_ref||'').replaceAll('_',' ');
      const title=names[r.input_ref]||key.replace(/^./,c=>c.toUpperCase())||'Plan update';
      const rationaleByAction={build_plan:'Recalculated the estimate from your balances, interest rates and selected strategy.',persona_seed:'Loaded example figures that you can review and edit before saving.',seeded_activity_review:'Reviewed the illustrative activity supplied with your example starting point.',debt_created:'Added the debt details you entered to your plan.',what_if:'Compared a possible change against the current payoff estimate.',local_drip_recorded:'Recorded this practice step in your browser. It did not move money.',pause:'Paused new practice steps and streak tracking.',resume:'Allowed practice steps to be recorded again.',coach_chat:'Answered using your plan and built-in guidance.',nudge_response:'Saved your response so future check-ins can be adjusted.',stash_goal_created:'Created a savings goal.',monthly_deposit_preference:'Saved the monthly target as a reminder only; no transfer is scheduled.',lesson_complete:'Recorded the lesson completion and its points.',streak_freeze:'Used a monthly streak allowance without resetting your progress.'};
      const rationale=rationaleByAction[r.input_ref]||r.rationale||'This action was recorded from your choice in Glim.';
      const outcome=describeResult(r.result);
      return `<article class="audit-entry"><div class="audit-entry-head"><strong>${escapeHtml(title)}</strong><span>${new Date(r.created_at).toLocaleString()}</span></div><p>${escapeHtml(rationale)}</p>${outcome?`<p class="audit-outcome">${escapeHtml(outcome)}</p>`:''}</article>`;
    }).join(''):'<p class="muted">No activity recorded yet. Changes to your plan and practice progress will appear here with an explanation.</p>';
  }catch{}
}
async function renderShop(){try{const x=await api('/api/cosmetics');$('#shop').innerHTML=x.items.map(i=>`<article class="shop-item"><div class="shop-icon">${visualIcon(i.id===1?'leaf':i.id===2?'acorn':'moon')}</div><strong>${escapeHtml(i.name)}</strong><p class="muted">${escapeHtml(i.description)}</p><span class="price">${i.owned?'Unlocked':i.cost+' points'}</span>${i.owned?'<span class="owned-label">In your collection</span>':` <button class="secondary" data-buy="${i.id}" type="button">Unlock</button>`}</article>`).join('');$$('[data-buy]').forEach(b=>b.onclick=async()=>{try{await api(`/api/cosmetics/${b.dataset.buy}/buy`,{method:'POST'});await load();toast('Reward unlocked.')}catch(e){toast(e.message)}})}catch{}}
async function renderSquad(){try{const x=await api('/api/squads');const s=x.squad;if(!s){$('#squadInfo').innerHTML='<p class="muted">No squad yet. Create a group name to start a consistency challenge.</p>';$('#leaderboard').innerHTML='<p class="muted">Your progress board will appear after you create a squad.</p>';$('#cheerFeed').innerHTML='';$('#squadGoals').innerHTML='<p class="muted">Create a squad to set a goal.</p>';$('#squadRewards').innerHTML='';return}$('#squadInfo').innerHTML=`<div class="callout"><strong>${escapeHtml(s.name)}</strong><p class="muted">Saved in this browser. Other people cannot join across devices in this version.</p></div>`;$('#leaderboard').innerHTML=`<div class="leader-row"><strong>Your progress</strong><span>${Number(STATE?.game?.streak||0)}-day streak · ${Number(STATE?.game?.level||1)} level</span></div>`;$('#cheerFeed').innerHTML='<p class="muted">Group sharing is not enabled in this version, so this challenge is for your own tracking.</p>'; $('#squadGoals').innerHTML=x.goals?.length?x.goals.map(g=>{const pct=Math.min(100,Number(g.progress_count)/Math.max(1,Number(g.target_count))*100);return `<article class="stash-goal"><div class="goal-title"><strong>${escapeHtml(g.title)}</strong><span class="badge">${g.status==='completed'?'Complete':'In progress'}</span></div><div class="goal-amount"><strong>${g.progress_count} / ${g.target_count}</strong><span class="muted">practice days</span></div><div class="progressbar"><span style="width:${pct}%"></span></div><div class="goal-foot"><span>Reward: ${escapeHtml(g.reward_name)}</span><span>${pct.toFixed(0)}% complete</span></div></article>`}).join(''):'<p class="muted">No goal created yet.</p>';$('#squadRewards').innerHTML=x.unlocked_cosmetics?.length?`<h3>Unlocked group rewards</h3><div class="reward-list">${x.unlocked_cosmetics.map(r=>`<span class="reward-chip">${visualIcon(r.cosmetic_id===1?'leaf':r.cosmetic_id===2?'acorn':'moon')} ${escapeHtml(r.name)}</span>`).join('')}</div>`:''}catch(e){console.error(e)}}
async function renderStash(){
  try{
    const [x,deposit]=await Promise.all([api('/api/stash/goals'),api('/api/stash/auto-deposit')]);
    const balance=Number(x.stash_balance||0);const level=balance<100?'Getting started':balance<350?'Early growth':balance<800?'Growing':'Established';
    const target=Math.max(1,Number(STATE?.stash?.shield_threshold||500));
    const pct=Math.max(0,Math.min(100,balance/target*100));
    $('#forestLevel').textContent=pct>=100?'Target reached':pct>=50?'Halfway there':balance>0?'Getting started':'Not started';
    $('#forestSummary').textContent=`${money(balance)} recorded toward your savings buffer`;
    $('#forestProgress').textContent=`${pct.toFixed(0)}% of ${money(target)} target`;
    const fill=$('#bufferFill'); if(fill) fill.style.width=pct+'%';
    $('#stashGoals').innerHTML=x.goals.length?x.goals.map(g=>{const pct=Math.min(100,Number(g.saved_amount)/Math.max(1,Number(g.target_amount))*100);return `<article class="stash-goal"><div class="goal-title"><strong>${escapeHtml(g.name)}</strong><span class="badge">${g.status==='completed'?'Complete':'In progress'}</span></div><div class="goal-amount"><strong>${money(g.saved_amount)}</strong><span class="muted">of ${money(g.target_amount)}</span></div><div class="progressbar"><span style="width:${pct}%"></span></div><div class="goal-foot"><span>${pct.toFixed(0)}% funded</span><span>${Number(g.monthly_target)>0?money(g.monthly_target)+'/mo target':'No monthly target'}</span></div></article>`}).join(''):'<p class="muted">No named goals yet. Add one and future Stash contributions will be earmarked in the order shown here.</p>';
    $('#monthlyDepositEnabled').checked=!!deposit.enabled;$('#monthlyDepositAmount').value=Number(deposit.amount||0).toFixed(2);$('#monthlyDepositDay').value=deposit.due_day||1;
    let status=deposit.enabled?`Monthly planning target: ${money(deposit.amount)} on day ${deposit.due_day}.`:'No monthly savings target saved.';
    if(window.GlimStorage.mode==='localStorage') status += ' This is a reminder target only; it does not schedule a transfer.';
    $('#monthlyDepositStatus').textContent=status;
  }catch(e){console.error(e)}
}

async function renderMonthlyRecap(){
  try{
    const month=$('#recapMonth').value||new Date().toISOString().slice(0,7);const r=await api('/api/monthly-recap?month='+encodeURIComponent(month));
    const metrics=[['Recorded steps',r.drip_count],['Active days',r.active_days],['Behavior points',r.points_earned],['Goals completed',r.goals_completed]];
    const max=Math.max(Number(r.stash_contribution),Number(r.debt_contribution),1);
    $('#monthlyRecap').innerHTML=`<div class="recap-heading"><div><span class="data-label">${escapeHtml(r.month)} recap</span><h3>${money(r.total_moved)} in recorded practice contributions</h3></div><span class="badge">CAD</span></div><div class="recap-metrics">${metrics.map(([label,val])=>`<div class="recap-metric"><span>${label}</span><strong>${val}</strong></div>`).join('')}</div><div class="recap-allocation"><div class="recap-bar-row"><div><span>Savings contribution</span><strong>${money(r.stash_contribution)}</strong></div><div class="recap-track"><span style="width:${Math.max(0,Math.min(100,Number(r.stash_contribution)/max*100))}%"></span></div></div><div class="recap-bar-row"><div><span>Debt contribution</span><strong>${money(r.debt_contribution)}</strong></div><div class="recap-track"><span style="width:${Math.max(0,Math.min(100,Number(r.debt_contribution)/max*100))}%"></span></div></div></div><div class="recap-current"><div><span>Current savings</span><strong>${money(r.current_stash_balance)}</strong></div><div><span>Current active debt</span><strong>${money(r.current_active_debt)}</strong></div><div><span>Current streak</span><strong>${r.streak} days</strong></div></div><p class="muted recap-note">${escapeHtml(r.note)}</p>`;
  }catch(e){$('#monthlyRecap').innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`}
}

async function load(){
  try{
    const me=await api('/api/auth/me');
    if(!me.authenticated){STATE=null;window.location.replace('/signin');return}
    STATE=await api('/api/state');
    if(!profileIsReady(STATE.profile)){
      if(window.location.pathname!=='/setup') window.location.replace('/setup');
      else show('setupView');
      return;
    }
    if(window.location.pathname==='/setup') { window.location.replace('/app/overview'); return; }
    show('dashboardView');
    if(!STATE.plan?.projection && (STATE.debts||[]).some(d=>d.status==='active')){STATE.plan=await api('/api/plan',{method:'POST',body:JSON.stringify({strategy:selectedStrategy,stash_pct:65})})}
    await Promise.all([runScout(false), renderNotifications(), renderShop(), renderSquad(), renderStash()]);
    render();
    maybeStartWalkthrough();
  }catch(e){console.error(e);toast(e.message||'Unable to load your Glim plan.');}
}

async function seed(key){try{STATE=await api('/api/personas/'+key,{method:'POST'});show('onboardingView');$('#pPersona').value=key;$('#pName').value='';$('#pIncome').value=STATE.profile.monthly_income;$('#pRange').value=STATE.profile.income_range;$('#pPct').value=STATE.profile.savings_pct;$('#pctOut').value=STATE.profile.savings_pct+'%';$('#pFloor').value=STATE.profile.floor_balance;$('#pCap').value=STATE.profile.weekly_cap;$('#pApproval').value='each';$('#pQuietStart').value=STATE.profile.quiet_start||'22:00';$('#pQuietEnd').value=STATE.profile.quiet_end||'08:00';toast('Starting figures loaded. Review or change them before saving.')}catch(e){toast(e.message)}}
async function startCustomPlan(){try{STATE=await api('/api/state');show('onboardingView');$('#profileForm').reset();$('#pPersona').value='custom';$('#pName').value=STATE.profile?.name&&!['Riley','Sam'].includes(STATE.profile.name)?STATE.profile.name:'';$('#pIncome').value='';$('#pRange').value='';$('#pPct').value='5';$('#pctOut').value='5%';$('#pCap').value='60';$('#pFloor').value='0';$('#pApproval').value='each';$('#pQuietStart').value='22:00';$('#pQuietEnd').value='08:00';$('#pChannel').value='in_app'}catch(e){toast(e.message)}}
async function runScout(showToast=true){const r=await api('/api/scout',{method:'POST'});const rows=[];if(r.subscriptions?.length){rows.push(...r.subscriptions.map(x=>`<div class="finding"><div><strong>${escapeHtml(x.merchant)}</strong><span>${escapeHtml(x.signal||'Example recurring payment')}</span></div><b>${money(x.monthly)}/month</b></div>`))}else{rows.push('<p class="muted">No recurring expenses were identified in this example. You can still add your debts below and build a payoff plan.</p>')}if(r.safe_to_move_daily>0)rows.unshift(`<div class="finding"><div><strong>Estimated available amount</strong><span>Calculated from the example income, expenses and safety floor.</span></div><b>${money(r.safe_to_move_daily)}/day</b></div>`);$('#scoutResults').innerHTML=rows.join('');if(showToast)toast('Spending patterns refreshed.')}
async function buildPlan(){if(!(STATE?.debts||[]).some(d=>d.status==='active')){toast('Add a debt from Overview before building a payoff plan.');return}try{STATE.plan=await api('/api/plan',{method:'POST',body:JSON.stringify({strategy:selectedStrategy,stash_pct:65})});render();toast('Plan recalculated.')}catch(e){toast(e.message)}}

$('#customPlanBtn')?.addEventListener('click',()=>startCustomPlan());

$('#pPct').addEventListener('input',e=>$('#pctOut').value=e.target.value+'%');
$('#profileForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/profile',{method:'POST',body:JSON.stringify({name:$('#pName').value,persona:$('#pPersona').value,monthly_income:+$('#pIncome').value,income_range:$('#pRange').value,savings_pct:+$('#pPct').value,approval_mode:$('#pApproval').value,weekly_cap:+$('#pCap').value,floor_balance:+$('#pFloor').value,quiet_start:$('#pQuietStart').value,quiet_end:$('#pQuietEnd').value,notification_cap:+$('#notifCap').value||3,notification_channel:$('#pChannel').value})});window.location.assign('/app/overview')}catch(e){toast(e.message)}});
$('#debtForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/debts',{method:'POST',body:JSON.stringify({name:$('#dName').value,type:$('#dType').value,balance:+$('#dBalance').value,apr:+$('#dApr').value,minimum:+$('#dMin').value,due_day:15})});$('#debtForm').reset();await load();toast('Debt added.')}catch(e){toast(e.message)}});
$('#scanBtn').addEventListener('click',()=>runScout(true));
$$('.strategy').forEach(b=>b.addEventListener('click',()=>{$$('.strategy').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedStrategy=b.dataset.strategy;buildPlan()}));
$('#planBtn').addEventListener('click',buildPlan);
$('#whatIfBtn').addEventListener('click',async()=>{if(!STATE?.plan?.projection){$('#whatIfResult').textContent='Add a debt from Overview before comparing scenarios.';return}try{const r=await api('/api/what-if',{method:'POST',body:JSON.stringify({text:$('#whatIfInput').value})});if(!r.what_if){$('#whatIfResult').textContent='Add a more specific what-if phrase.';return}$('#whatIfResult').textContent=`${r.parsed.label}. What-if payoff: ${r.what_if.months} months and ${money(r.what_if.interest_paid)} interest.`;$('#scenarioComparison').innerHTML=`<div><strong>Current</strong><br>${STATE.plan.projection.months} months · ${money(STATE.plan.projection.interest_paid)} interest</div><hr/><div><strong>What-if</strong><br>${r.what_if.months} months · ${money(r.what_if.interest_paid)} interest</div>`}catch(e){$('#whatIfResult').textContent=e.message}});
$('#approveDrip').addEventListener('click',async()=>{try{const r=await api('/api/drip/approve',{method:'POST',body:JSON.stringify({approve:true})});toast(`Practice step recorded: ${money(r.amount)} in your plan. No money moved.`);await load()}catch(e){toast(e.message)}});
$('#freezeBtn').addEventListener('click',async()=>{try{await api('/api/game/freeze',{method:'POST'});await load();toast('Streak freeze used.')}catch(e){toast(e.message)}});
$('#pauseBtn').addEventListener('click',async()=>{const wasPaused=Boolean(STATE?.paused);try{await api(wasPaused?'/api/resume':'/api/pause',{method:'POST'});await load();toast(wasPaused?'Progress tracking resumed.':'Progress tracking paused.')}catch(e){toast(e.message)}});
$$('.question-suggestion').forEach(button=>button.addEventListener('click',()=>{const input=$('#chatInput');input.value=button.dataset.question||'';$('#chatForm').requestSubmit()}));
$('#chatForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('#chatInput');const text=input.value.trim();if(!text)return;$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble user"><strong>You</strong><br>${escapeHtml(text)}</div>`);input.value='';try{const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message:text})});$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble"><strong>${escapeHtml(r.agent||'Glim')}</strong><br>${escapeHtml(r.message)}</div>`);$('#chatWindow').scrollTop=$('#chatWindow').scrollHeight}catch(e){toast(e.message)}});
$('#nudgeBtn').addEventListener('click',async()=>{try{lastNudge=await api('/api/nudge');$('#nudgeText').textContent=lastNudge.message;$('#nudgeWhy').textContent=lastNudge.why||'Why will appear here.';await renderNotifications()}catch(e){toast(e.message)}});
$$('.nudge-action').forEach(b=>b.addEventListener('click',async()=>{try{await api('/api/nudge/response',{method:'POST',body:JSON.stringify({response:b.dataset.response})});await load();toast('Check-in response saved.')}catch(e){toast(e.message)}}));
$('#saveNotifBtn').addEventListener('click',async()=>{try{const p=STATE.profile||{};await api('/api/profile',{method:'POST',body:JSON.stringify({...p,quiet_start:$('#notifStart').value,quiet_end:$('#notifEnd').value,notification_cap:+$('#notifCap').value,notification_channel:$('#notifChannel').value})});await load();toast('Notification settings saved.')}catch(e){toast(e.message)}});

$('#stashGoalForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/stash/goals',{method:'POST',body:JSON.stringify({name:$('#stashGoalName').value.trim(),target_amount:+$('#stashGoalTarget').value,monthly_target:+$('#stashGoalMonthly').value||0})});$('#stashGoalForm').reset();$('#stashGoalMonthly').value='0';await renderStash();toast('Savings goal added.')}catch(e){toast(e.message)}});
$('#monthlyDepositForm').addEventListener('submit',async e=>{e.preventDefault();try{const enabled=$('#monthlyDepositEnabled').checked;const payload={enabled,amount:+$('#monthlyDepositAmount').value,due_day:+$('#monthlyDepositDay').value,consent:$('#monthlyDepositConsent').checked};const r=await api('/api/stash/auto-deposit',{method:'PUT',body:JSON.stringify(payload)});await renderStash();$('#monthlyDepositConsent').checked=false;toast(enabled?'Monthly savings target saved.':'Monthly savings target updated.')}catch(e){toast(e.message)}});
$('#loadRecapBtn').addEventListener('click',renderMonthlyRecap);
$('#auditBtn')?.addEventListener('click',renderAudit);
$('#squadGoalForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads/goals',{method:'POST',body:JSON.stringify({title:$('#squadGoalTitle').value.trim(),target_count:+$('#squadGoalTarget').value,reward_cosmetic_id:+$('#squadGoalReward').value})});await renderSquad();$('#squadGoalTitle').value='';toast('Shared goal created.')}catch(e){toast(e.message)}});
$('#createSquadForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads',{method:'POST',body:JSON.stringify({name:$('#squadName').value.trim()})});await load();toast('Squad created.')}catch(e){toast(e.message)}});
$('#loadLessonBtn').addEventListener('click',async()=>{try{const r=await api('/api/lessons/next');currentLesson=r.lesson||null;if(!currentLesson){$('#lessonCard').innerHTML='<strong>Path complete.</strong><p>You finished the current Sage path.</p>';return}$('#lessonCard').innerHTML=`<strong>${escapeHtml(currentLesson.title)}</strong><p>${escapeHtml(currentLesson.description)}</p><p>${escapeHtml(r.prompt)}</p><div class="input-row"><input id="lessonAnswer" placeholder="Your answer"/><button class="primary" id="lessonSubmit">Check</button></div><p class="muted">${r.points} points</p>`;$('#lessonSubmit').onclick=async()=>{try{const x=await api('/api/lessons/complete',{method:'POST',body:JSON.stringify({lesson_id:currentLesson.id,answer:$('#lessonAnswer').value})});$('#lessonCard').innerHTML=`<strong>Nice. +${x.points} points.</strong><p>Glim logged the applied challenge.</p>`;await load();}catch(e){toast(e.message)}}}catch(e){toast(e.message)}});
$('#exportBtn').addEventListener('click',async()=>{try{const data=await api('/api/data/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='glim-data-export.json';a.click();URL.revokeObjectURL(a.href);$('#dataMsg').textContent='Export created.'}catch(e){toast(e.message)}});
$('#deleteBtn').addEventListener('click',async()=>{if(!confirm('Delete the Glim account and all prototype data?'))return;try{await api('/api/account',{method:'DELETE'});STATE=null;window.location.assign('/signin')}catch(e){toast(e.message)}});
const APP_SECTIONS=['overview','savings','plan','coach','game','squad','learn','settings'];
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
$$('.persona-card').forEach(b=>b.addEventListener('click',()=>seed(b.dataset.persona)));
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});STATE=null;window.location.assign('/signin')}catch(e){toast(e.message)}});
$('#pushEnableBtn').addEventListener('click',async()=>{try{if(window.GlimStorage.mode==='localStorage')throw new Error('Browser push notifications are not configured in this prototype.');if(!('serviceWorker' in navigator))throw new Error('This browser does not support service workers.');const cfg=await api('/api/push/config');if(!cfg.enabled)throw new Error('Web push is not configured. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server.');const reg=await navigator.serviceWorker.register('/sw.js');const perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('Browser notifications were not granted.');const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.public_key)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});toast('Web push enabled.')}catch(e){toast(e.message)}});
function urlBase64ToUint8Array(base64){const pad='='.repeat((4-base64.length%4)%4);const raw=atob((base64+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}


const WALKTHROUGH_KEY='glim.walkthrough.completed.v1';
const WALKTHROUGH_STEPS=[
  {section:'overview',title:'Start with Overview',copy:'This is your starting point. Review your current savings buffer, active debt, practice amount and the next available action.'},
  {section:'savings',title:'Plan your savings',copy:'Track your buffer, create named savings goals and set monthly targets. Targets are planning reminders in this browser; they do not make transfers.'},
  {section:'plan',title:'Compare debt payoff options',copy:'Add debt details from Overview, then compare highest-interest-first, smallest-balance-first and balanced strategies with estimated timelines and interest.'},
  {section:'coach',title:'Ask for guidance',copy:'Use the suggested questions or enter a question about your saved plan. This prototype uses built-in guidance, not a live AI service.'},
  {section:'game',title:'Track habits and milestones',copy:'Practice steps, streaks and lessons earn points. Points unlock app themes only; they are not money and do not change debt calculations.'},
  {section:'squad',title:'Use a personal consistency challenge',copy:'The current version records a challenge in this browser only. It does not send invites, sync members or create a shared leaderboard.'},
  {section:'learn',title:'Learn one concept at a time',copy:'Complete short lessons about safety buffers, consistency and repayment approaches. Your progress is recorded in the prototype.'},
  {section:'settings',title:'Adjust Glim to fit you',copy:'Change text size and appearance, set quiet hours, review activity history, export your local data or delete the local profile.'}
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

$('#recapMonth').value=new Date().toISOString().slice(0,7);
load();
