let STATE = null;
let selectedStrategy = 'smart';
let currentLesson = null;
let lastNudge = null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function cleanCopy(value){return String(value??'').replace(/PayPal(?:\s+Sandbox)?/gi,'connected payment provider').replace(/Gemini/gi,'the service').replace(/sandbox/gi,'test environment').replace(/server mode/gi,'this setup').replace(/browser-only mode/gi,'this version').replace(/GEMINI_API_KEY/gi,'the service configuration').replace(/PAYPAL_[A-Z_]+/g,'the account connection settings').replace(/agentic AI/gi,'Smart Strategy')}
function toast(msg){const t=$('#toast');t.textContent=cleanCopy(msg);t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2800)}
async function api(path, opts={}){return window.GlimStorage.adapter.request(path, opts)}
function money(v){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2}).format(Number(v||0))}
function show(view){['onboardingView','dashboardView'].forEach(id=>$('#'+id)?.classList.toggle('hidden',id!==view));const logout=$('#logoutBtn');if(logout)logout.classList.toggle('hidden',view==='authView')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function profileIsReady(profile){return Number(profile?.monthly_income)>0 && profile?.average_monthly_expenses!==null && profile?.average_monthly_expenses!==undefined && Number.isFinite(Number(profile.average_monthly_expenses))}


function renderSettingsControls(profile){
  const p=profile||{};
  const floor=$('#settingsFloor'),pct=$('#settingsSavingsPct'),pctValue=$('#settingsSavingsPctValue');
  const mode=$('#settingsApprovalMode'),cap=$('#settingsWeeklyCap'),capRow=$('#settingsWeeklyCapRow');
  if(floor)floor.value=Number(p.floor_balance??1000);
  if(pct)pct.value=Number(p.savings_pct??5);
  if(pctValue)pctValue.textContent=`${Number(pct?.value??5)}%`;
  if(mode)mode.value=p.approval_mode||'each';
  if(cap)cap.value=Number(p.weekly_cap??60);
  if(capRow)capRow.classList.toggle('hidden',!['weekly_cap','standing_rule'].includes(mode?.value||'each'));
}

function render(){
  const s=STATE||{}, debts=s.debts||[], activeDebts=debts.filter(d=>d.status==='active');
  renderSettingsControls(s.profile);
  if(!profileIsReady(s.profile)){show('onboardingView');return}
  show('dashboardView');
  const setText=(selector,value)=>{const el=$(selector);if(el)el.textContent=value};
  const displayName=String(s.profile?.name||s.user?.display_name||'').trim();
  setText('#welcomeTitle',displayName?`Welcome, ${displayName}`:'Welcome to your plan');
  setText('#welcomeCopy','Your debt and savings at a glance, with a suggested next step.');
  if(s.plan?.strategy) selectedStrategy=s.plan.strategy;
  setText('#suggestedAmount',money(s.daily_drip));
  setText('#debtBalance',money(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0)));
  setText('#debtInfo',activeDebts.length?`${activeDebts.length} active ${activeDebts.length===1?'debt':'debts'} in your plan`:'Add a debt to see a repayment estimate.');
  setText('#savingsBalance',money(s.stash?.balance));
  setText('#shieldInfo',`Target: ${money(s.stash?.shield_threshold)}`);
  const savingsFill=$('#savingsFill');
  if(savingsFill)savingsFill.style.width=Math.min(100,Number(s.stash?.balance||0)/Math.max(1,Number(s.stash?.shield_threshold||0))*100)+'%';

  const localMode=window.GlimStorage?.mode==='localStorage';
  const accountConnected=s.paypal?.status==='connected'&&!localMode&&s.payment_readiness!==false;
  const canApprove=accountConnected&&activeDebts.length>0&&Boolean(s.plan?.projection)&&Number(s.daily_drip)>0&&!s.paused;
  const action=$('#approveDrip');
  if(action){
    action.disabled=Boolean(s.paused&&accountConnected);
    action.textContent=canApprove?'Approve suggested amount':s.paused&&accountConnected?'Transfers paused':'Review debt plan';
  }
  const note=$('#dripStatusNote');
  if(note){
    note.textContent=canApprove?'Review the amount and allocation before approving.':s.paused&&accountConnected?'Transfers are paused. Resume them in Settings when ready.':localMode?'Planning only in this version. No money moves from this app.':accountConnected?'Add a debt and review the estimate before approving a transfer.':'This is an estimate. Connect an account in Settings before approving a transfer.';
  }
  const planButton=$('#planBtn');if(planButton)planButton.disabled=!activeDebts.length;
  const whatIfButton=$('#whatIfBtn');if(whatIfButton)whatIfButton.disabled=!s.plan?.projection;
  $$('.strategy').forEach(button=>{button.disabled=!activeDebts.length;const active=button.dataset.strategy===selectedStrategy;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  const smartRecommendation=$('#smartRecommendation');
  if(smartRecommendation){smartRecommendation.classList.toggle('hidden',selectedStrategy!=='smart');setText('#smartRecommendationCopy',s.plan?.smart_summary||'Add your debts, then select Smart Strategy to compare the available repayment approaches.');setText('#smartResolvedStrategy',s.plan?.resolved_strategy?`Recommended repayment order: ${({avalanche:'highest interest rate first',snowball:'smallest balance first',hybrid:'balanced approach'})[s.plan.resolved_strategy]||s.plan.resolved_strategy}.`: '');}
  const visualizationButton=$('#togglePaymentVisualization');if(visualizationButton)visualizationButton.disabled=!Boolean(s.plan?.projection);
  if(s.plan?.projection){
    const savingsShare=Number(s.daily_drip||0)*Number(s.plan.stash_pct||0)/100;
    const debtShare=Number(s.daily_drip||0)-savingsShare;
    setText('#savingsAllocation',money(savingsShare));setText('#debtAllocation',money(debtShare));
    setText('#visualSavingsAllocation',money(savingsShare));setText('#visualDebtAllocation',money(debtShare));
    renderProjection(s.plan.projection);
    setText('#attackOrder',`Repayment order: ${(s.plan.attack_order||[]).join(' → ')}`);
  }else{
    setText('#savingsAllocation','—');setText('#debtAllocation','—');setText('#visualSavingsAllocation','—');setText('#visualDebtAllocation','—');
    const projection=$('#projection');if(projection)projection.innerHTML='<p class="muted">Add a debt to see a payoff estimate.</p>';
    setText('#attackOrder','Your repayment order will appear here.');
  }
  renderDebtList(debts);
  renderDebtPaidOffNotice();
  renderAudit();
  renderChart();
  renderStash();
  const pauseTitle=$('#pauseTitle');if(pauseTitle)pauseTitle.textContent=s.paused?'Transfers are paused':'Transfers are active';
  const pauseHelp=$('#pauseHelp');if(pauseHelp)pauseHelp.textContent=s.paused?'Resume when you are ready.':'Pause to stop new transfer approvals.';
  const pauseButton=$('#pauseBtn');if(pauseButton)pauseButton.textContent=s.paused?'Resume transfers':'Pause transfers';
}

function renderDebtList(debts){
  const host=$('#debtList');if(!host)return;
  if(!debts.length){host.innerHTML='<p class="muted">No debts added yet.</p>';return;}
  host.innerHTML=debts.map(debt=>{
    const active=debt.status==='active';
    const kind=debt.type==='credit_card'?'Credit card':debt.type==='loan'?'Loan or line of credit':String(debt.type||'Debt');
    return `<article class="debt-row"><div><h3>${escapeHtml(debt.name||'Debt')}</h3><p>${kind}${active?'':' · Paid off'}</p></div><div class="debt-metric">${money(debt.balance)}<span>Balance</span></div><div class="debt-metric">${Number(debt.apr||0).toFixed(2)}%<span>Annual interest</span></div><div class="debt-metric">${money(debt.minimum)}<span>Minimum payment / month</span></div></article>`;
  }).join('');
}

async function renderNotifications(){
  const data=await api('/api/notifications');const settings=data.settings||{};const localMode=window.GlimStorage?.mode==='localStorage';
  const start=$('#notifStart'),end=$('#notifEnd'),cap=$('#notifCap'),channel=$('#notifChannel'),zone=$('#notifTimezone');
  if(start)start.value=settings.quiet_start||STATE?.profile?.quiet_start||'22:00';
  if(end)end.value=settings.quiet_end||STATE?.profile?.quiet_end||'08:00';
  if(cap)cap.value=Number(settings.daily_cap??STATE?.profile?.notification_cap??3);
  if(zone)zone.value=STATE?.profile?.timezone||'America/Toronto';
  if(channel){const config=localMode?{enabled:false,email_enabled:false}:await api('/api/push/config').catch(()=>({enabled:false,email_enabled:false}));const email=channel.querySelector('option[value="email"]'),push=channel.querySelector('option[value="web_push"]');if(email){email.hidden=!config.email_enabled;email.disabled=!config.email_enabled}if(push){push.hidden=!config.enabled;push.disabled=!config.enabled}channel.value=settings.channel==='in_app'?'in_app':(settings.channel||'in_app');if(channel.selectedOptions[0]?.disabled)channel.value='in_app';}
  const inbox=$('#inbox');if(inbox){const items=Array.isArray(data.items)?data.items:[];inbox.innerHTML=items.length?items.map(item=>`<article class="inbox-item"><strong>${escapeHtml(cleanCopy(item.message||'Glim check-in'))}</strong><p>${escapeHtml(cleanCopy(item.why||'A check-in was selected from your reminder settings.'))}</p><span>${new Date(item.created_at).toLocaleString()}${item.response?` · Response: ${escapeHtml(({acted:'I took a step',opened:'I read this',snoozed:'Remind me later',dismissed:'Dismissed',muted:'Fewer check-ins'}[item.response]||item.response))}`:''}</span></article>`).join(''):'<p class="muted">No check-ins yet. Your reminders appear here when you request one.</p>';}
  const stress=$('#stressCopy'),detail=$('#stressDetail');if(stress)stress.textContent=data.stress_mode?'Supportive check-ins':'Calm check-ins';if(detail)detail.textContent=data.stress_mode?'Check-ins remain supportive when activity slows down.':'Check-ins follow your saved preferences and daily limit.';
  return data;
}

function visualIcon(key){const paths={leaf:'<path d="M19 3C10 3 5 7 5 13c0 4 3 6 6 6 6 0 8-7 8-16Z"/><path d="M3 21 14 10"/>',acorn:'<path d="M8 8c-2 1-3 4-3 7 0 4 3 6 7 6s7-2 7-6c0-3-1-6-3-7"/><path d="M7 8h10l-1-3H8Z"/><path d="M12 5V2"/>',moon:'<path d="M19 15A8 8 0 0 1 9 5 8 8 0 1 0 19 15Z"/>',tree:'<path d="M12 2 5 11h4l-5 6h6v5h4v-5h6l-5-6h4Z"/>',spark:'<path d="m12 2 2.1 6.2L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-1.8Z"/>'};return `<svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[key]||paths.spark}</svg>`}

function renderProjection(p){$('#projection').innerHTML=`<div><span class="data-label">Estimated debt-free time</span><strong>${p.months} mo</strong><span class="muted">based on this plan</span></div><div><span class="data-label">Estimated interest</span><strong>${money(p.interest_paid)}</strong><span class="muted">over the payoff period</span></div><div><span class="data-label">Potential interest avoided</span><strong>${money(p.interest_saved)}</strong><span class="muted">compared with minimum payments</span></div>`}
function renderDebtPaidOffNotice(){const b=$('#debtPaidOffNotice');if(!b)return;const p=STATE?.pending_redirect;if(!p){b.classList.add('hidden');return}b.classList.remove('hidden');const others=(STATE.debts||[]).filter(d=>d.status==='active');b.innerHTML=`<strong>Debt paid off: ${escapeHtml(p.debt_name)}.</strong> The freed payment is ${money(p.freed_payment)}. Choose where it goes next. <div class="button-row" style="margin-top:10px"><button class="secondary" data-redirect="stash">Move to savings</button>${others.map(d=>`<button class="secondary" data-redirect="${d.id}">Next: ${escapeHtml(d.name)}</button>`).join('')}</div>`;b.querySelectorAll('[data-redirect]').forEach(btn=>btn.onclick=async()=>{try{await api('/api/debt/redirect',{method:'POST',body:JSON.stringify({destination:btn.dataset.redirect==='stash'?'stash':Number(btn.dataset.redirect)})});await load();toast('Freed payment redirected.')}catch(e){toast(e.message)}})}
async function renderChart(){try{const r=await api('/api/debt-chart');const svg=$('#debtChart');if(!r.balances.length){svg.innerHTML='<text x="24" y="40" class="chart-label">Add a debt to see an estimated payoff path.</text>';return}const W=640,H=220,P=30,max=Math.max(...r.minimum_only,1);const pts=a=>a.map((v,i)=>`${P+(W-2*P)*i/(a.length-1||1)},${H-P-(H-2*P)*v/max}`).join(' ');svg.innerHTML=`<line class="chart-grid" x1="${P}" y1="${P}" x2="${P}" y2="${H-P}"/><line class="chart-grid" x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}"/><polyline class="chart-line" points="${pts(r.balances)}"/><polyline class="chart-saving" points="${pts(r.minimum_only)}"/><text class="chart-label" x="${P}" y="15">Chosen strategy</text><text class="chart-label" x="${W-155}" y="15">Minimum payment</text>`}catch{}}
async function renderAudit(){
  try{
    const rows=await api('/api/audit');
    const names={build_plan:'Updated repayment estimate',persona_seed:'Created a starting plan',seeded_activity_review:'Reviewed account activity',debt_created:'Added a debt',daily_drip:'Approved a planned transfer',local_drip_recorded:'Recorded a planned contribution',pause_drips:'Paused transfers',pause:'Paused transfers',resume_drips:'Resumed transfers',resume:'Resumed transfers',nudge:'Reviewed a reminder',nudge_response:'Updated reminder preferences',coach_chat:'Asked a question about the plan',what_if:'Compared a budget change',freed_payment_redirect:'Updated the repayment allocation',stash_goal_created:'Added a savings goal',monthly_deposit_preference:'Updated savings settings',profile_updated:'Updated plan settings'};
    const describeResult=(raw)=>{
      const r=raw&&typeof raw==='object'?raw:{};
      if(r.amount!=null) return `Amount: ${money(r.amount)} · savings allocation ${money(r.stash_share)} · debt allocation ${money(r.debt_share)}.`;
      if(r.name&&r.target_amount!=null) return `Goal “${r.name}” · target ${money(r.target_amount)}.`;
      if(r.response) return 'Reminder preference updated.';
      if(r.strategy) return `Strategy: ${{avalanche:'highest interest rate first',snowball:'smallest balance first',hybrid:'balanced approach'}[r.strategy]||r.strategy}.`;
      
      if(r.paused===true) return 'New transfer approvals are paused.';
      if(r.paused===false) return 'Transfer approvals are active.';
      if(r.message) return cleanCopy(String(r.message).slice(0,220));
      return '';
    };
    const visibleRows=rows.filter(r=>!/(squad|streak|freeze|lesson|cosmetic|nudge|chat|shop|game|reward|forest|level|point)/i.test(String(r.input_ref||'')));
    $('#auditList').innerHTML=visibleRows.length?visibleRows.map(r=>{
      const key=String(r.input_ref||'').replaceAll('_',' ');
      const title=cleanCopy(names[r.input_ref]||key.replace(/^./,c=>c.toUpperCase())||'Plan update');
      const rationaleByAction={build_plan:'Recalculated the estimate from your balances, interest rates and selected strategy.',persona_seed:'Created an initial plan.',seeded_activity_review:'Reviewed available account activity.',debt_created:'Added the debt details you entered to your plan.',what_if:'Compared a possible change against the current payoff estimate.',local_drip_recorded:'Recorded a planned contribution.',pause:'Paused new transfer approvals.',resume:'Resumed transfer approvals.',stash_goal_created:'Created a savings goal.',monthly_deposit_preference:'Updated savings settings.'};
      const rationale=cleanCopy(rationaleByAction[r.input_ref]||r.rationale||'This action was recorded from your choice in Glim.');
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
  if(!squad){$('#squadInfo').innerHTML='<p class="muted">No group yet. Create one to share small wins with friends.</p>';$('#leaderboard').innerHTML='<p class="muted">People you invite will appear here.</p>';$('#cheerFeed').innerHTML='';$('#squadGoals').innerHTML='';$('#squadRewards').innerHTML='';return;}
  const codeMarkup=localMode?'<p class="muted">Inviting friends is unavailable here.</p>':`<p>Invite code: <strong>${escapeHtml(squad.invite_code||'Unavailable')}</strong> <button class="secondary" type="button" id="copySquadCodeBtn">Copy code</button></p>`;
  $('#squadInfo').innerHTML=`<div><strong>${escapeHtml(squad.name)}</strong>${codeMarkup}<p class="muted">Only progress markers are shared. Balances, income and debt details stay private.</p></div>`;
  const members=Array.isArray(x.members)?x.members:[];
  $('#leaderboard').innerHTML=members.length?members.map((m,i)=>`<div class="leader-row"><strong>${i+1}. ${escapeHtml(m.display_name||'Member')}${m.is_self?' (you)':''}</strong><span>${Number(m.streak||0)} active days · ${Number(m.goal_pct||0).toFixed(0)}% of weekly goal</span>${!localMode&&!m.is_self?`<div class="button-row"><button class="secondary" data-cheer-member="${Number(m.id)}" data-cheer="Nice streak!">Well done</button><button class="secondary" data-cheer-member="${Number(m.id)}" data-cheer="Keep going!">Keep going</button></div>`:''}</div>`).join(''):'<p class="muted">No group activity yet.</p>';
  $('#cheerFeed').innerHTML=x.cheers?.length ? `<h4>Recent encouragement</h4>${x.cheers.map(ch=>`<div class="inbox-item"><strong>${escapeHtml(ch.sender_name||ch.sender||'Member')} → ${escapeHtml(ch.to_member_name||'member')}</strong><p>${escapeHtml(ch.cheer)}</p><span>${new Date(ch.created_at).toLocaleString()}</span></div>`).join('')}` : '';
  if(!localMode){if(leaveBtn)leaveBtn.classList.remove('hidden');$('#copySquadCodeBtn')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(squad.invite_code||''));toast('Invite code copied.')}catch{const note=$('#squadActionNote');if(note)note.textContent=`Copy this invite code: ${squad.invite_code||''}`}});}
  $('#leaderboard').querySelectorAll('[data-cheer-member]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/squads/cheer',{method:'POST',body:JSON.stringify({member_id:Number(button.dataset.cheerMember),cheer:button.dataset.cheer})});await renderSquad();toast('Message sent.')}catch(e){toast(cleanCopy(e.message));button.disabled=false}}));
 }catch(e){console.error(e);const host=$('#squadInfo');if(host)host.textContent=cleanCopy(e.message);}
}

async function renderStash(){
  try{
    const x=await api('/api/stash/goals');
    const balance=Number(x.stash_balance||0);
    const balanceInput=$('#savingsCurrentBalance');if(balanceInput&&document.activeElement!==balanceInput)balanceInput.value=balance.toFixed(2);
    const target=Math.max(1,Number(STATE?.stash?.shield_threshold||500));
    const pct=Math.max(0,Math.min(100,balance/target*100));
    const level=$('#savingsBufferStatus'); if(level) level.textContent=pct>=100?'Target reached':pct>=50?'Halfway there':balance>0?'In progress':'Not started';
    const summary=$('#savingsBufferSummary'); if(summary) summary.textContent=`${money(balance)} saved toward your buffer`;
    const progress=$('#savingsBufferProgress'); if(progress) progress.textContent=`${pct.toFixed(0)}% of ${money(target)}`;
    const fill=$('#bufferFill'); if(fill) fill.style.width=pct+'%';
    const goals=$('#savingsGoals'); if(!goals) return;
    goals.innerHTML=x.goals.length?x.goals.map(g=>{const goalPct=Math.min(100,Number(g.saved_amount)/Math.max(1,Number(g.target_amount))*100);return `<article class="stash-goal"><div class="goal-title"><strong>${escapeHtml(g.name)}</strong><span class="badge">${g.status==='completed'?'Complete':'In progress'}</span></div><div class="goal-amount"><strong>${money(g.saved_amount)}</strong><span class="muted">of ${money(g.target_amount)}</span></div><div class="progressbar"><span style="width:${goalPct}%"></span></div><div class="goal-foot"><span>${goalPct.toFixed(0)}% saved</span><span>${Number(g.monthly_target)>0?money(g.monthly_target)+'/month target':'No monthly target'}</span></div></article>`}).join(''):'<p class="muted">No savings goals yet. Add one to track another target.</p>';
  }catch(e){console.error(e)}
}

function applyOptionalModulePreferences(){
  const p=STATE?.profile||{};
  const prefs={consistency:p.show_consistency!==false,learningTips:p.show_learning_tips!==false,friendSupport:p.show_friend_support===true,planHelp:p.show_plan_help!==false};
  $$('[data-optional-module]').forEach(node=>{const key=node.dataset.optionalModule;if(key in prefs)node.classList.toggle('hidden',!prefs[key])});
  const toggles={showConsistency:prefs.consistency,showLearningTips:prefs.learningTips,showFriendSupport:prefs.friendSupport,showPlanHelp:prefs.planHelp};
  Object.entries(toggles).forEach(([id,value])=>{const el=$('#'+id);if(el)el.checked=value});
}

async function renderMonthlyRecap(){
  try{
    const month=$('#recapMonth').value||new Date().toISOString().slice(0,7);const r=await api('/api/monthly-recap?month='+encodeURIComponent(month));
    const metrics=[['Contributions recorded',r.drip_count],['Days on track',r.active_days],['Progress rewards',r.points_earned],['Goals completed',r.goals_completed]];
    const max=Math.max(Number(r.stash_contribution),Number(r.debt_contribution),1);
    $('#monthlyRecap').innerHTML=`<div class="recap-heading"><div><span class="data-label">${escapeHtml(r.month)} recap</span><h3>${money(r.total_moved)} in recorded practice contributions</h3></div><span class="badge">CAD</span></div><div class="recap-metrics">${metrics.map(([label,val])=>`<div class="recap-metric"><span>${label}</span><strong>${val}</strong></div>`).join('')}</div><div class="recap-allocation"><div class="recap-bar-row"><div><span>Savings contribution</span><strong>${money(r.stash_contribution)}</strong></div><div class="recap-track"><span style="width:${Math.max(0,Math.min(100,Number(r.stash_contribution)/max*100))}%"></span></div></div><div class="recap-bar-row"><div><span>Debt contribution</span><strong>${money(r.debt_contribution)}</strong></div><div class="recap-track"><span style="width:${Math.max(0,Math.min(100,Number(r.debt_contribution)/max*100))}%"></span></div></div></div><div class="recap-current"><div><span>Current savings</span><strong>${money(r.current_stash_balance)}</strong></div><div><span>Current active debt</span><strong>${money(r.current_active_debt)}</strong></div><div><span>Current streak</span><strong>${r.streak} days</strong></div></div><p class="muted recap-note">${escapeHtml(r.note)}</p>`;
  }catch(e){$('#monthlyRecap').innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`}
}

async function load(){
  try{
    const me=await api('/api/auth/me');
    if(!me.authenticated){
      const startRequested=new URLSearchParams(window.location.search).get('start')==='1';
      if(window.GlimStorage?.mode==='localStorage' && startRequested){
        await api('/api/auth/guest',{method:'POST'});
        window.history.replaceState({},'', '/app/overview');
      }else{STATE=null;window.location.replace('/signin');return}
    }
    STATE=await api('/api/state');
    selectedStrategy=STATE.plan?.strategy||'smart';
    const nameField=$('#pName');if(nameField&&!nameField.value)nameField.value=String(STATE.profile?.name||'');
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
    if(!STATE.plan?.projection && (STATE.debts||[]).some(d=>d.status==='active')){STATE.plan=await api('/api/plan',{method:'POST',body:JSON.stringify({strategy:selectedStrategy,stash_pct:65})})}
    await Promise.all([renderNotifications(), renderSettlements(), setIntegrationStatus()]);
    render();
    maybeStartWalkthrough();
  }catch(e){console.error(e);toast(e.message||'Unable to load your Glim plan.');}
}

async function renderScoutDebtSuggestions(suggestions){
  const host=$('#scoutDebtSuggestions'); if(!host)return;
  if(window.GlimStorage?.mode==='localStorage'){
    host.innerHTML='<p class="muted">No account activity is available to review yet. Glim will not invent recurring charges or debt suggestions.</p>';return;
  }
  const items=Array.isArray(suggestions)?suggestions:[];
  if(!items.length){host.innerHTML='<p class="muted">No recurring payment appears to need review. Glim never adds a debt without your confirmation and account figures.</p>';return;}
  host.innerHTML=`<h3>Review possible debt payments</h3>${items.map(item=>{const ev=item.evidence||{};return `<article class="finding scout-debt-card" data-scout-id="${Number(item.id)}"><div><strong>${escapeHtml(item.name)}</strong><p class="muted">Observed ${Number(ev.transactions_observed||0)} similar transactions; cadence about ${Number(ev.median_interval_days||0)} days. Verify this is a debt before adding it.</p></div><div class="settings-grid"><label>Account type<select data-field="type"><option value="credit_card">Credit card</option><option value="loan">Loan / line of credit</option></select></label><label>Current balance (CAD)<input data-field="balance" type="number" min="0.01" step="0.01" required placeholder="Enter balance"/></label><label>APR (%)<input data-field="apr" type="number" min="0" max="100" step="0.01" required placeholder="Enter APR"/></label><label>Minimum payment (CAD)<input data-field="minimum" type="number" min="0.01" step="0.01" required placeholder="Enter minimum"/></label><label>Due day<input data-field="due_day" type="number" min="1" max="31" value="15" required/></label></div><div class="button-row"><button class="primary" type="button" data-scout-confirm="${Number(item.id)}">Confirm and add debt</button><button class="secondary" type="button" data-scout-dismiss="${Number(item.id)}">Dismiss</button></div><p class="muted" data-scout-message></p></article>`}).join('')}`;
  host.querySelectorAll('[data-scout-confirm]').forEach(button=>button.addEventListener('click',async()=>{const card=button.closest('[data-scout-id]');const read=f=>card.querySelector(`[data-field="${f}"]`)?.value;const balance=Number(read('balance')),apr=Number(read('apr')),minimum=Number(read('minimum')),due_day=Number(read('due_day'));const note=card.querySelector('[data-scout-message]');if(!(balance>0)||apr<0||apr>100||!(minimum>0)||due_day<1||due_day>31){note.textContent='Enter the verified balance, APR, minimum payment and due day.';return;}button.disabled=true;try{await api(`/api/scout/suggestions/${button.dataset.scoutConfirm}/confirm`,{method:'POST',body:JSON.stringify({type:read('type'),balance,apr,minimum,due_day})});toast('Confirmed debt added to your plan.');await load()}catch(e){note.textContent=cleanCopy(e.message);button.disabled=false}}));
  host.querySelectorAll('[data-scout-dismiss]').forEach(button=>button.addEventListener('click',async()=>{const card=button.closest('[data-scout-id]');const note=card.querySelector('[data-scout-message]');button.disabled=true;try{await api(`/api/scout/suggestions/${button.dataset.scoutDismiss}/dismiss`,{method:'POST'});card.remove();toast('Suggestion dismissed.')}catch(e){note.textContent=cleanCopy(e.message);button.disabled=false}}));
}
async function runScout(showToast=true){
  try{const r=await api('/api/scout',{method:'POST'});const rows=[];
    if(r.subscriptions?.length) rows.push(...r.subscriptions.map(x=>`<div class="finding"><div><strong>${escapeHtml(x.merchant)}</strong><span>${escapeHtml(x.signal||'From connected account activity')}</span></div><b>${money(x.monthly)}/month</b></div>`));
    else rows.push(`<p class="muted">${escapeHtml(cleanCopy(r.source||'No verified recurring activity is available to review yet.'))}</p>`);
    $('#scoutResults').innerHTML=rows.join('');await renderScoutDebtSuggestions(r.debt_suggestions||[]);if(showToast)toast('Available account activity refreshed.');
  }catch(e){$('#scoutResults').innerHTML=`<p class="muted">${escapeHtml(cleanCopy(e.message))}</p>`;await renderScoutDebtSuggestions([])}
}
async function buildPlan(){if(!(STATE?.debts||[]).some(d=>d.status==='active')){toast('Add a debt in Debt plan before building a payoff plan.');return}try{STATE.plan=await api('/api/plan',{method:'POST',body:JSON.stringify({strategy:selectedStrategy,stash_pct:65})});render();toast('Plan recalculated.')}catch(e){toast(e.message)}}

$('#pPct')?.addEventListener('input',e=>$('#pctOut').value=e.target.value+'%');
$('#pApprovalMode')?.addEventListener('change',e=>$('#weeklyCapRow')?.classList.toggle('hidden',!['weekly_cap','standing_rule'].includes(e.target.value)));
$('#setupContinueBtn')?.addEventListener('click',()=>{const first=$('#setupStepOne');const form=$('#profileForm');if(!form?.reportValidity())return;first?.classList.add('hidden');$('#setupStepTwo')?.classList.remove('hidden');if($('#setupStepLabel'))$('#setupStepLabel').textContent='Step 2 of 2 · Preferences and first debt';$('#setupStepTwo')?.scrollIntoView({behavior:'smooth',block:'start'});$('#setupBackBtn')?.focus();});
$('#setupBackBtn')?.addEventListener('click',()=>{const second=$('#setupStepTwo');second?.classList.add('hidden');$('#setupStepOne')?.classList.remove('hidden');if($('#setupStepLabel'))$('#setupStepLabel').textContent='Step 1 of 2 · Monthly budget';$('#setupContinueBtn')?.focus();});
$('#weeklyCapRow')?.classList.toggle('hidden',!['weekly_cap','standing_rule'].includes($('#pApprovalMode')?.value));
$('#profileForm')?.addEventListener('submit',async e=>{
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
    await api('/api/profile',{method:'POST',body:JSON.stringify({name:$('#pName')?.value.trim()||'',persona:'custom',monthly_income:income,average_monthly_expenses:expenses,savings_pct:Number($('#pPct').value),approval_mode:$('#pApprovalMode')?.value||'each',weekly_cap:Number($('#pWeeklyCap')?.value||60),floor_balance:floor,quiet_start:'22:00',quiet_end:'08:00',notification_cap:3,notification_channel:'in_app',show_consistency:true,show_learning_tips:true,show_friend_support:false,show_plan_help:true})});
    if(debtStarted) await api('/api/debts',{method:'POST',body:JSON.stringify({name:debtName,type:$('#setupDebtType').value,balance:Number(debtBalance),apr:Number(debtApr),minimum:Number(debtMinimum),due_day:15})});
    window.location.assign('/app/overview');
  }catch(error){toast(error.message||'Unable to save your plan.');}
});
$('#debtForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/debts',{method:'POST',body:JSON.stringify({name:$('#dName').value,type:$('#dType').value,balance:+$('#dBalance').value,apr:+$('#dApr').value,minimum:+$('#dMin').value,due_day:15})});$('#debtForm').reset();await load();toast('Debt added.')}catch(e){toast(e.message)}});
$('#scanBtn')?.addEventListener('click',()=>runScout(true));
$$('.strategy').forEach(b=>b.addEventListener('click',()=>{selectedStrategy=b.dataset.strategy;$$('.strategy').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});buildPlan()}));
$('#togglePaymentVisualization')?.addEventListener('click',()=>{const panel=$('#paymentVisualizationPanel'),button=$('#togglePaymentVisualization');if(!panel||!button)return;const open=panel.classList.contains('hidden');panel.classList.toggle('hidden',!open);button.textContent=open?'Hide payment visualization':'View payment visualization';button.setAttribute('aria-expanded',String(open));if(open)panel.scrollIntoView({behavior:'smooth',block:'nearest'});});
$('#planBtn')?.addEventListener('click',buildPlan);
$('#approveDrip')?.addEventListener('click',async()=>{const connected=STATE?.paypal?.status==='connected'&&window.GlimStorage?.mode!=='localStorage'&&STATE?.payment_readiness!==false;if(!connected){activateSection('plan',{push:true});return}try{await api('/api/drip/approve',{method:'POST',body:JSON.stringify({approve:true})});toast('Today’s amount has been approved.');await load()}catch(e){toast(cleanCopy(e.message))}});
$('#freezeBtn')?.addEventListener('click',async()=>{try{await api('/api/game/freeze',{method:'POST'});await load();toast('Missed-day safeguard used.')}catch(e){toast(e.message)}});
$('#pauseBtn')?.addEventListener('click',async()=>{const wasPaused=Boolean(STATE?.paused);try{await api(wasPaused?'/api/resume':'/api/pause',{method:'POST'});await load();toast(wasPaused?'Progress tracking resumed.':'Progress tracking paused.')}catch(e){toast(e.message)}});
$$('.question-suggestion').forEach(button=>button.addEventListener('click',()=>{const input=$('#chatInput');input.value=button.dataset.question||'';$('#chatForm').requestSubmit()}));
$('#chatForm')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#chatInput');const text=input.value.trim();if(!text)return;$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble user"><strong>You</strong><br>${escapeHtml(text)}</div>`);input.value='';try{const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message:text})});$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble"><strong>Glim</strong><br>${escapeHtml(cleanCopy(r.message))}</div>`);$('#chatWindow').scrollTop=$('#chatWindow').scrollHeight}catch(e){toast(e.message)}});
$('#nudgeBtn')?.addEventListener('click',async()=>{try{lastNudge=await api('/api/nudge');$('#nudgeText').textContent=cleanCopy(lastNudge.message);$('#nudgeWhy').textContent=cleanCopy(lastNudge.why||'This check-in was selected from your reminder preferences.');await renderNotifications()}catch(e){toast(e.message)}});
$$('.nudge-action').forEach(b=>b.addEventListener('click',async()=>{try{await api('/api/nudge/response',{method:'POST',body:JSON.stringify({response:b.dataset.response})});await load();toast('Check-in response saved.')}catch(e){toast(e.message)}}));
$('#saveNotifBtn')?.addEventListener('click',async()=>{try{const p=STATE.profile||{};await api('/api/profile',{method:'POST',body:JSON.stringify({...p,quiet_start:$('#notifStart').value,quiet_end:$('#notifEnd').value,notification_cap:+$('#notifCap').value,notification_channel:$('#notifChannel').value,timezone:$('#notifTimezone').value||'America/Toronto'})});await load();toast('Notification settings saved.')}catch(e){toast(e.message)}});


$('#settingsSavingsPct')?.addEventListener('input',e=>{if($('#settingsSavingsPctValue'))$('#settingsSavingsPctValue').textContent=`${e.target.value}%`});
$('#settingsApprovalMode')?.addEventListener('change',e=>$('#settingsWeeklyCapRow')?.classList.toggle('hidden',!['weekly_cap','standing_rule'].includes(e.target.value)));
$('#saveContributionRulesBtn')?.addEventListener('click',async()=>{
  const status=$('#contributionRulesStatus');
  const p=STATE?.profile||{};
  const floor=Number($('#settingsFloor')?.value), savingsPct=Number($('#settingsSavingsPct')?.value), weeklyCap=Number($('#settingsWeeklyCap')?.value);
  if(!Number.isFinite(floor)||floor<0||!Number.isFinite(savingsPct)||savingsPct<0||savingsPct>50||!Number.isFinite(weeklyCap)||weeklyCap<0){if(status)status.textContent='Check the minimum balance, savings target and weekly limit.';return;}
  try{
    await api('/api/profile',{method:'POST',body:JSON.stringify({...p,floor_balance:floor,savings_pct:savingsPct,weekly_cap:weeklyCap,approval_mode:$('#settingsApprovalMode')?.value||'each'})});
    await load();
    if(status)status.textContent='Plan rules saved.';
    toast('Plan rules saved.');
  }catch(e){if(status)status.textContent=cleanCopy(e.message||'Unable to save contribution rules.');}
});

$('#saveModulePreferencesBtn')?.addEventListener('click',async()=>{
  const status=$('#modulePreferencesStatus');
  try{
    const p=STATE?.profile||{};
    const payload={...p,show_consistency:!!$('#showConsistency')?.checked,show_learning_tips:!!$('#showLearningTips')?.checked,show_friend_support:!!$('#showFriendSupport')?.checked,show_plan_help:!!$('#showPlanHelp')?.checked};
    await api('/api/profile',{method:'POST',body:JSON.stringify(payload)});
    STATE=await api('/api/state');applyOptionalModulePreferences();
    if(status)status.textContent='Preferences saved.';
    toast('Overview preferences saved.');
  }catch(e){if(status)status.textContent=cleanCopy(e.message||'Unable to save preferences.');}
});

$('#savingsBalanceForm')?.addEventListener('submit',async e=>{e.preventDefault();const status=$('#savingsBalanceStatus');try{const balance=Number($('#savingsCurrentBalance').value);if(!Number.isFinite(balance)||balance<0)throw new Error('Enter a savings balance of zero or more.');await api('/api/stash/balance',{method:'POST',body:JSON.stringify({balance})});if(status)status.textContent='Savings balance updated.';await load();toast('Savings balance updated.')}catch(error){if(status)status.textContent=cleanCopy(error.message);else toast(cleanCopy(error.message))}});
$('#savingsGoalForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/stash/goals',{method:'POST',body:JSON.stringify({name:$('#savingsGoalName').value.trim(),target_amount:+$('#savingsGoalTarget').value,monthly_target:0})});$('#savingsGoalForm').reset();await renderStash();toast('Savings goal added.')}catch(e){toast(cleanCopy(e.message))}});
$('#monthlyDepositForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const enabled=$('#monthlyDepositEnabled').checked;const payload={enabled,amount:+$('#monthlyDepositAmount').value,due_day:+$('#monthlyDepositDay').value,consent:$('#monthlyDepositConsent').checked};const r=await api('/api/stash/auto-deposit',{method:'PUT',body:JSON.stringify(payload)});await renderStash();$('#monthlyDepositConsent').checked=false;toast(enabled?'Monthly savings target saved.':'Monthly savings target updated.')}catch(e){toast(e.message)}});
$('#loadRecapBtn')?.addEventListener('click',renderMonthlyRecap);
$('#auditBtn')?.addEventListener('click',renderAudit);
$('#squadGoalForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads/goals',{method:'POST',body:JSON.stringify({title:$('#squadGoalTitle').value.trim(),target_count:+$('#squadGoalTarget').value,reward_cosmetic_id:+$('#squadGoalReward').value})});await renderSquad();$('#squadGoalTitle').value='';toast('Shared goal created.')}catch(e){toast(e.message)}});
$('#createSquadForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads',{method:'POST',body:JSON.stringify({name:$('#squadName').value.trim()})});await load();toast('Group created.')}catch(e){toast(e.message)}});
$('#loadLessonBtn')?.addEventListener('click',async()=>{try{const r=await api('/api/lessons/next');currentLesson=r.lesson||null;if(!currentLesson){$('#lessonCard').innerHTML='<strong>Path complete.</strong><p>You finished the current Sage path.</p>';return}$('#lessonCard').innerHTML=`<strong>${escapeHtml(currentLesson.title)}</strong><p>${escapeHtml(currentLesson.description)}</p><p>${escapeHtml(r.prompt)}</p><div class="input-row"><input id="lessonAnswer" placeholder="Your answer"/><button class="primary" id="lessonSubmit">Check</button></div><p class="muted">A quick check helps apply this to your own plan.</p>`;$('#lessonSubmit').onclick=async()=>{try{const x=await api('/api/lessons/complete',{method:'POST',body:JSON.stringify({lesson_id:currentLesson.id,answer:$('#lessonAnswer').value})});$('#lessonCard').innerHTML=`<strong>Completed.</strong><p>Keep the useful idea in mind when reviewing your plan.</p>`;await load();}catch(e){toast(e.message)}}}catch(e){toast(e.message)}});
$('#exportBtn')?.addEventListener('click',async()=>{try{const data=await api('/api/data/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='glim-data-export.json';a.click();URL.revokeObjectURL(a.href);$('#dataMsg').textContent='Export created.'}catch(e){toast(e.message)}});
$('#deleteBtn')?.addEventListener('click',async()=>{if(!confirm('Delete all your Glim data? This cannot be undone.'))return;try{await api('/api/account',{method:'DELETE'});STATE=null;window.location.assign('/')}catch(e){toast(e.message)}});
const APP_SECTIONS=['overview','plan','savings','settings','help'];
function activeSectionFromPath(){const part=window.location.pathname.split('/').filter(Boolean).pop();return APP_SECTIONS.includes(part)?part:'overview'}
function activateSection(section,{push=false,replace=false}={}){
  if(!APP_SECTIONS.includes(section))section='overview';
  $$('.tab').forEach(link=>{const active=link.dataset.tab===section;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
  $$('.tab-panel').forEach(panel=>panel.classList.toggle('hidden',panel.id!=='tab-'+section));
  if(push)history.pushState({section},'',`/app/${section}`);
  else if(replace && window.location.pathname!==`/app/${section}`)history.replaceState({section},'',`/app/${section}`);
}
$$('[data-tab]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();const section=link.dataset.tab;activateSection(section,{push:true});}));
window.addEventListener('popstate',()=>activateSection(activeSectionFromPath()));
activateSection(activeSectionFromPath());
$('#logoutBtn')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});STATE=null;window.location.assign('/')}catch(e){toast(e.message)}});
$('#paypalConnectBtn')?.addEventListener('click',async()=>{const b=$('#paypalConnectBtn');b.disabled=true;try{const r=await api('/api/paypal/connect',{method:'POST'});if(r.approval_url){$('#paypalApprovalLink').innerHTML=`<a class="text-link" href="${escapeHtml(r.approval_url)}" rel="noopener">Continue secure connection</a>`;window.location.assign(r.approval_url);return;}await load();}catch(e){toast(cleanCopy(e.message))}finally{b.disabled=false;await setIntegrationStatus()}});
$('#paypalDisconnectBtn')?.addEventListener('click',async()=>{if(!confirm('Disconnect this funding source? Pending contributions must be checked first.'))return;const b=$('#paypalDisconnectBtn');b.disabled=true;try{await api('/api/paypal/disconnect',{method:'POST'});await load();toast('Funding source disconnected.')}catch(e){toast(cleanCopy(e.message))}finally{b.disabled=false;await setIntegrationStatus()}});
$('#settleWeekBtn')?.addEventListener('click',async()=>{const b=$('#settleWeekBtn');b.disabled=true;const out=$('#settlementActionResult');try{const r=await api('/api/drip/settle',{method:'POST'});out.textContent=`Transfer status: ${settlementLabel(r.status||'submitted')}${r.amount==null?'':' · '+money(r.amount)+' CAD'}.`;if(r.approval_url)out.innerHTML+=` <a class="text-link" href="${escapeHtml(r.approval_url)}" rel="noopener">Continue secure approval</a>`;await load()}catch(e){out.textContent=cleanCopy(e.message);await setIntegrationStatus()}finally{b.disabled=false}});
$('#reconcileBtn')?.addEventListener('click',async()=>{const b=$('#reconcileBtn'),out=$('#settlementActionResult');b.disabled=true;try{const r=await api('/api/drip/reconcile',{method:'POST'});out.textContent=`Payment status refreshed. ${Number(r.reconciled||0)} settlement(s) reconciled.`;await load()}catch(e){out.textContent=cleanCopy(e.message)}finally{b.disabled=false}});
$('#joinSquadForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads/join',{method:'POST',body:JSON.stringify({invite_code:$('#squadInviteCode').value.trim()})});$('#squadActionNote').textContent='Joined group.';$('#squadInviteCode').value='';await load()}catch(error){$('#squadActionNote').textContent=error.message}});
$('#leaveSquadBtn')?.addEventListener('click',async()=>{if(!confirm('Leave this group? Your shared progress and messages will be removed.'))return;try{await api('/api/squads/leave',{method:'POST'});await load();toast('Left group.')}catch(e){toast(e.message)}});
$('#pushEnableBtn')?.addEventListener('click',async()=>{try{if(window.GlimStorage.mode==='localStorage')throw new Error('Browser alerts are not available right now.');if(!('serviceWorker' in navigator))throw new Error('This browser does not support service workers.');const cfg=await api('/api/push/config');if(!cfg.enabled)throw new Error(cfg.reason||'Browser alerts are not available right now.');const reg=await navigator.serviceWorker.register('/sw.js');const perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('Browser notifications were not granted.');const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.public_key)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});toast('Browser alerts enabled.')}catch(e){toast(cleanCopy(e.message))}});
function urlBase64ToUint8Array(base64){const pad='='.repeat((4-base64.length%4)%4);const raw=atob((base64+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}


async function setIntegrationStatus(){
 const localMode=window.GlimStorage?.mode==='localStorage';
 const mode=$('#integrationModeStatus'), funding=$('#paypalIntegrationStatus');
 const connect=$('#paypalConnectBtn'),disconnect=$('#paypalDisconnectBtn'),scopeHost=$('#paypalScopes'),approvalHost=$('#paypalApprovalLink'),pushBtn=$('#pushEnableBtn'),external=$('#externalNotificationStatus'),privacy=$('#privacyStorageStatus');
 if(localMode){
   $('#accountTransferDetails')?.classList.add('hidden');
   if(mode)mode.textContent='Your plan remains available without an account connection.';
   if(funding)funding.textContent='Account transfers are not available here.';
   if(connect)connect.classList.add('hidden');
   if(disconnect)disconnect.classList.add('hidden');
   if(scopeHost)scopeHost.textContent='';
   if(approvalHost)approvalHost.textContent='';
   if(pushBtn){pushBtn.disabled=true;pushBtn.classList.add('hidden');}
   if(external)external.textContent='In-app check-ins are available.';
   if(privacy)privacy.textContent='Your plan is saved on this device. Export a copy before changing devices.';
   const settle=$('#settleWeekBtn'),rec=$('#reconcileBtn');if(settle)settle.classList.add('hidden');if(rec)rec.classList.add('hidden');
   const activity=$('#contributionActivitySection');if(activity)activity.classList.add('hidden');
   const conn=$('.connection-row .button-row');if(conn)conn.classList.add('hidden');
   $('#fundingConnectionSection')?.classList.add('hidden');
   return;
 }
 $('#accountTransferDetails')?.classList.remove('hidden');
 if(mode)mode.textContent='Your plan stays available without an account connection.';
 if(privacy)privacy.textContent='Your plan is saved with your account. Export a copy or delete your data here.';
 $('#fundingConnectionSection')?.classList.remove('hidden');
 const settleBtn=$('#settleWeekBtn'),reconcileBtn=$('#reconcileBtn');if(settleBtn)settleBtn.classList.remove('hidden');if(reconcileBtn)reconcileBtn.classList.remove('hidden');const activity=$('#contributionActivitySection');if(activity)activity.classList.remove('hidden');
 const [health,cfg]=await Promise.all([api('/api/paypal/health').catch(()=>({configured:false,authenticated:false,error:true,status:STATE?.paypal?.status||'disconnected'})),api('/api/push/config').catch(()=>({enabled:false,email_enabled:false}))]);
 const status=STATE?.paypal?.status||health.status||'disconnected';
 if(funding){
   funding.textContent=status==='connected'?(health.settlement_ready?'Connected and ready':'Connected, but needs attention'):status==='awaiting_approval'?'Waiting for your approval':health.error?'Connection status unavailable':health.configured?'Ready to connect':'No funding source connected';
 }
 if(connect){connect.classList.toggle('hidden',!health.configured||status==='connected'||status==='awaiting_approval');connect.disabled=!health.configured||status==='connected'||status==='awaiting_approval';connect.textContent=status==='awaiting_approval'?'Waiting for approval':'Connect funding source';}
 if(disconnect)disconnect.classList.toggle('hidden',status!=='connected');
 if(scopeHost)scopeHost.textContent='';
 const approval=STATE?.paypal?.approval_url||health.approval_url;
 if(approvalHost)approvalHost.innerHTML=status==='awaiting_approval'&&approval?`<a class="text-link" href="${escapeHtml(approval)}" rel="noopener">Continue secure connection</a>`:'';
 const emailOption=$('#notifChannel option[value="email"]'),pushOption=$('#notifChannel option[value="web_push"]');if(emailOption)emailOption.disabled=!cfg.email_enabled;if(pushOption)pushOption.disabled=!cfg.enabled;
 if(external)external.textContent='Your available reminder methods are shown above.';
 if(pushBtn){const canPush=cfg.enabled&&('serviceWorker' in navigator)&&('PushManager' in window);pushBtn.disabled=!canPush;pushBtn.classList.toggle('hidden',!canPush);pushBtn.textContent='Enable browser alerts';}
}

function settlementLabel(status){return ({accrued:'Approved, waiting to be sent',awaiting_approval:'Needs your approval',creating_order:'Preparing transfer',capture_pending:'Confirmation pending',capture_unknown:'Checking payment status',capture_failed:'Transfer not completed',payout_error:'Needs attention',payout_failed:'Transfer not completed',creating_payout:'Sending transfer',completed:'Complete',paid:'Complete',settled:'Complete',failed:'Not completed',cancelled:'Cancelled'})[String(status||'').toLowerCase()]||'Pending';}
async function renderSettlements(){
 const host=$('#settlementList');if(!host)return;const localMode=window.GlimStorage?.mode==='localStorage';if(localMode){host.innerHTML='<p class="muted">Transfers are not connected. Nothing will be sent from this page.</p>';return;}
 try{const rows=await api('/api/ledger');const pending=Array.isArray(STATE?.settlements)?STATE.settlements:[];const accrued=(rows||[]).filter(r=>r.status==='accrued');const details=pending.map(r=>`<article class="inbox-item"><strong>Transfer ${escapeHtml(r.reference)} · ${escapeHtml(settlementLabel(r.status))}</strong><p>${money(r.amount)} CAD${r.last_error?` · ${escapeHtml(cleanCopy(r.last_error))}`:''}</p>${r.status==='awaiting_approval'&&STATE?.paypal?.pending_settlement_approval_url?`<p><a class="text-link" href="${escapeHtml(STATE.paypal.pending_settlement_approval_url)}" rel="noopener">Continue secure approval</a></p>`:''}<div class="button-row"><button class="secondary" type="button" data-reconcile-ref="${escapeHtml(r.reference)}">Refresh status</button>${['creating_order','capture_pending','capture_unknown','capture_failed','payout_error','payout_failed','creating_payout'].includes(r.status)?`<button class="secondary" type="button" data-retry-ref="${escapeHtml(r.reference)}">Resolve issue</button>`:''}</div></article>`);
  if(accrued.length)details.unshift(`<p class="muted">${accrued.length} approved transfer(s), ${money(accrued.reduce((a,r)=>a+Number(r.amount||0),0))} CAD, waiting to be sent.</p>`);
  host.innerHTML=details.length?details.join(''):'<p class="muted">No pending transfers or unresolved payment issues.</p>';
  host.querySelectorAll('[data-retry-ref]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api(`/api/drip/settlements/${encodeURIComponent(btn.dataset.retryRef)}/retry`,{method:'POST'});$('#settlementActionResult').textContent=`Transfer status: ${settlementLabel(r.status||'pending')}.`;await load()}catch(e){$('#settlementActionResult').textContent=cleanCopy(e.message);btn.disabled=false}}));
  host.querySelectorAll('[data-reconcile-ref]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api('/api/drip/reconcile',{method:'POST'});$('#settlementActionResult').textContent=`Payment status refreshed. ${Number(r.reconciled||0)} settlement(s) reconciled.`;await load()}catch(e){$('#settlementActionResult').textContent=cleanCopy(e.message);btn.disabled=false}}));
 }catch(e){host.innerHTML=`<p class="muted">${escapeHtml(cleanCopy(e.message))}</p>`;}
}

const WALKTHROUGH_KEY='glim.guide.completed.v5';
const WALKTHROUGH_STEPS=[
  {section:'overview',title:'Overview',copy:'See your total debt, savings balance, and suggested allocation in one place.'},
  {section:'plan',title:'Debt plan',copy:'Enter each debt and use Smart Strategy or choose a repayment method yourself. Review the payoff estimate before making changes.'},
  {section:'savings',title:'Savings',copy:'Track your cash buffer and add other savings targets.'},
  {section:'settings',title:'Settings',copy:'Update the monthly budget, savings target, safety balance, and reminders.'},
  {section:'help',title:'Help',copy:'Find answers to common questions and reopen this walkthrough whenever you need it.'}
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
  $('#walkthroughNextBtn').textContent=walkthroughIndex===WALKTHROUGH_STEPS.length-1?'Finish':'Next';
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

if($('#recapMonth')) $('#recapMonth').value=new Date().toISOString().slice(0,7);
setIntegrationStatus();
load();
