let STATE = null;
let selectedStrategy = 'smart';
let currentLesson = null;
let lastNudge = null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function cleanCopy(value){return String(value??'').replace(/PayPal(?:\s+Sandbox)?/gi,'connected account').replace(/Gemini/gi,'guidance service').replace(/sandbox/gi,'connected account').replace(/test[- ]mode/gi,'configured payment').replace(/server[- ]backed|server mode/gi,'connected').replace(/browser[- ]only mode/gi,'this version').replace(/GEMINI_API_KEY/gi,'guidance service').replace(/PAYPAL_[A-Z_]+/g,'account connection details').replace(/environment configuration/gi,'account connection')}
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
  setText('#debtBalance',money(activeDebts.reduce((sum,d)=>sum+Number(d.balance||0),0)));
  setText('#debtInfo',activeDebts.length?`${activeDebts.length} active ${activeDebts.length===1?'debt':'debts'} in your plan`:'Add a debt to start your plan.');
  setText('#savingsBalance',money(s.stash?.balance));
  setText('#shieldInfo',`Target: ${money(s.stash?.shield_threshold)}`);
  const savingsFill=$('#savingsFill');
  if(savingsFill)savingsFill.style.width=Math.min(100,Number(s.stash?.balance||0)/Math.max(1,Number(s.stash?.shield_threshold||0))*100)+'%';
  setText('#overviewStrategyCopy', activeDebts.length
    ? 'Smart Strategy uses your budget, debt interest, and savings goals together to compare the next steps.'
    : 'Set your budget and savings target, then add a debt to compare repayment and savings options together.');
  const planButton=$('#planBtn');if(planButton)planButton.disabled=!activeDebts.length;
  $$('.strategy').forEach(button=>{
    const active=button.dataset.strategy===selectedStrategy;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=!activeDebts.length;
  });
  if(s.plan?.projection){
    renderProjection(s.plan.projection);
    setText('#attackOrder',`Repayment order: ${(s.plan.attack_order||[]).join(' → ')}`);
    const explanation=$('#smartPlanExplanation');
    if(explanation){explanation.classList.toggle('hidden',selectedStrategy!=='smart');explanation.textContent=selectedStrategy==='smart'?(s.plan.smart_summary||s.plan.reason||'Smart Strategy compared modeled repayment approaches and selected an order based on your debt details.') : (s.plan.reason||'This strategy uses your entered balances, rates, and minimums.');}
  }else{
    const projection=$('#projection');if(projection)projection.innerHTML='<p class="muted">Add a debt to compare payoff approaches.</p>';
    setText('#attackOrder','Your repayment order will appear here.');
    $('#smartPlanExplanation')?.classList.add('hidden');
  }
  renderDebtList(debts);
  renderDebtPaidOffNotice();
  renderAudit();
  renderChart();
  renderStash();
  renderDebtProgress();
}

const DEBT_LABELS={credit_card:'Credit card',loan:'Loan',line_of_credit:'Line of credit',personal_loan:'Personal loan',student_loan:'Student loan',auto_loan:'Auto loan',mortgage:'Mortgage',buy_now_pay_later:'Buy now, pay later',medical_bill:'Medical bill',tax_debt:'Tax debt',payday_loan:'Payday loan',other:'Other obligation'};
function renderDebtList(debts){
  const host=$('#debtList');if(!host)return;
  if(!debts.length){host.innerHTML='<p class="muted">No debts yet. Add the details from your latest statement.</p>';return;}
  host.innerHTML=debts.map(debt=>{
    const active=debt.status==='active',kind=DEBT_LABELS[debt.type]||String(debt.type||'Debt');
    return `<article class="debt-row"><div class="debt-main"><h3>${escapeHtml(debt.name||'Debt')}</h3><p>${escapeHtml(kind)}${active?'':' · Paid off'}</p><p class="muted">Due day: ${Number(debt.due_day||15)}</p></div><div class="debt-metric">${money(debt.balance)}<span>Balance</span></div><div class="debt-metric">${Number(debt.apr||0).toFixed(2)}%<span>Annual interest</span></div><div class="debt-metric">${money(debt.minimum)}<span>Minimum / month</span></div><div class="debt-action">${active?`<button class="secondary" type="button" data-record-payment="${Number(debt.id)}">Record payment</button>`:'<span class="badge">Paid off</span>'}</div></article>`;
  }).join('');
  host.querySelectorAll('[data-record-payment]').forEach(button=>button.addEventListener('click',()=>{
    const debt=debts.find(d=>Number(d.id)===Number(button.dataset.recordPayment));if(!debt)return;
    const dialog=$('#debtPaymentDialog');if(!dialog)return;
    $('#debtPaymentDebtId').value=debt.id;$('#debtPaymentAmount').value=Number(debt.minimum||0).toFixed(2);$('#debtPaymentDate').value=new Date().toISOString().slice(0,10);$('#debtPaymentResult').textContent='';
    if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','open');
  }));
}

async function renderDebtProgress(){
  try{
    const progress=await api('/api/debt-progress');
    const setText=(selector,value)=>{const node=$(selector);if(node)node.textContent=value};
    const streak=Number(progress.on_time_streak||0);
    setText('#overviewStreakValue',`${streak} month${streak===1?'':'s'}`);
    setText('#overviewStreakStage',progress.next_due_date?`Next payment due ${new Date(`${progress.next_due_date}T12:00:00`).toLocaleDateString('en-CA',{month:'short',day:'numeric'})}`:'Payment consistency');
    setText('#overviewStreakCopy',(progress.debts||[]).length
      ? (progress.next_due_date?`Your next entered payment due date is ${new Date(`${progress.next_due_date}T12:00:00`).toLocaleDateString('en-CA',{month:'short',day:'numeric'})}. Record payments to track your streak.`:'Record payments to track your on-time streak.')
      : 'Add a debt to start tracking your on-time payment streak.');
    setText('#otterStageLabel','Your payment streak');
    setText('#otterStreakValue',`${streak} month${streak===1?'':'s'}`);
    setText('#otterInterestNote',money(progress.estimated_monthly_interest));
    const statuses=$('#debtPaymentProgressList');
    if(statuses)statuses.innerHTML=(progress.debts||[]).length?progress.debts.map(debt=>`<article class="debt-payment-status"><div><strong>${escapeHtml(debt.name)}</strong><span>${debt.payment_status==='paid'?'Minimum recorded by due day':debt.payment_status==='due'?'Due; minimum not recorded':'Due day '+Number(debt.due_day)}</span></div><div class="debt-mini-amount">${money(debt.paid_this_month)}<small>recorded this month</small></div></article>`).join(''):'<p class="muted">Add a debt to start tracking payments.</p>';
  }catch(error){console.error(error)}
}

async function renderNotifications(){
  const data=await api('/api/notifications');const settings=data.settings||{};const localMode=window.GlimStorage?.mode==='indexedDB';
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

function renderProjection(p){const host=$('#projection');if(!host)return;host.innerHTML=`<div><span class="data-label">Estimated debt-free time</span><strong>${p.months} mo</strong><span class="muted">based on this plan</span></div><div><span class="data-label">Estimated interest</span><strong>${money(p.interest_paid)}</strong><span class="muted">over the payoff period</span></div><div><span class="data-label">Potential interest avoided</span><strong>${money(p.interest_saved)}</strong><span class="muted">compared with minimum payments</span></div>`}
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
  const x=await api('/api/squads');const squad=x.squad;const localMode=window.GlimStorage?.mode==='indexedDB';
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

function activateDebtPanel(name){
  $$('.debt-subtab').forEach(button=>{const active=button.dataset.debtTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  $$('.debt-subpanel').forEach(panel=>{const active=panel.id===`debtPanel${name[0].toUpperCase()}${name.slice(1)}`;panel.classList.toggle('hidden',!active);panel.classList.toggle('active',active);panel.hidden=!active;});
  if(name==='strategy')renderChart();
}
$$('[data-debt-tab]').forEach(button=>button.addEventListener('click',()=>activateDebtPanel(button.dataset.debtTab)));

function activateSavingsPanel(name){
  const donationAllowed=!$('#savingsTabDonations')?.classList.contains('hidden');
  if(name==='donations'&&!donationAllowed)name='goals';
  $$('.savings-subtab').forEach(button=>{const active=button.dataset.savingsTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  $$('.savings-subpanel').forEach(panel=>{const active=panel.id===`savingsPanel${name[0].toUpperCase()}${name.slice(1)}`;panel.classList.toggle('hidden',!active);panel.classList.toggle('active',active);panel.hidden=!active;});
}
$$('[data-savings-tab]').forEach(button=>button.addEventListener('click',()=>activateSavingsPanel(button.dataset.savingsTab)));

async function renderStash(){
  try{
    const [goalResult,progress,recommendation,schedule,donations]=await Promise.all([
      api('/api/stash/goals'),
      api('/api/savings/progress').catch(()=>({goals:[],savings_streak:0,contributions:[]})),
      api('/api/savings/recommendation').catch(()=>({recommended_pct:Number(STATE?.profile?.savings_pct||0),monthly_amount:0,monthly_surplus:0,reason:'Adjust the amount to fit your budget.'})),
      api('/api/stash/auto-deposit').catch(()=>({})),
      api('/api/savings/donations').catch(()=>[])
    ]);
    const goals=Array.isArray(goalResult.goals)?goalResult.goals:[];
    const balance=Number(goalResult.stash_balance||0);
    const target=Math.max(1,Number(STATE?.stash?.shield_threshold||500));
    const pct=Math.max(0,Math.min(100,balance/target*100));
    const setText=(selector,value)=>{const element=$(selector);if(element)element.textContent=value;};
    const level=$('#savingsBufferStatus');if(level)level.textContent=pct>=100?'Target reached':pct>=50?'Halfway there':balance>0?'In progress':'Not started';
    setText('#savingsBufferSummary',`${money(balance)} saved toward your buffer`);
    setText('#savingsBufferProgress',`${pct.toFixed(0)}% of ${money(target)}`);
    const fill=$('#bufferFill');if(fill)fill.style.width=`${pct}%`;
    const balanceInput=$('#savingsCurrentBalance');if(balanceInput&&document.activeElement!==balanceInput)balanceInput.value=balance.toFixed(2);

    const progressById=new Map((progress.goals||[]).map(goal=>[Number(goal.id),goal]));
    const goalsHost=$('#savingsGoals');
    if(goalsHost)goalsHost.innerHTML=goals.length?goals.map(goal=>{
      const extra=progressById.get(Number(goal.id))||goal;
      const goalPct=Math.max(0,Math.min(100,Number(goal.saved_amount||0)/Math.max(1,Number(goal.target_amount||0))*100));
      const streak=Number(extra.monthly_streak||0);
      return `<article class="stash-goal"><div class="goal-title"><strong>${escapeHtml(goal.name)}</strong><span class="badge">${goal.status==='completed'?'Complete':'In progress'}</span></div><div class="goal-amount"><strong>${money(goal.saved_amount)}</strong><span class="muted">of ${money(goal.target_amount)}</span></div><div class="progressbar"><span style="width:${goalPct}%"></span></div><div class="goal-foot"><span>${goalPct.toFixed(0)}% saved</span><span>${Number(goal.monthly_target)>0?`${money(goal.monthly_target)}/month target`:'No monthly target'}</span></div>${Number(goal.monthly_target)>0?`<p class="muted goal-month-note">${money(extra.current_month_contribution||0)} recorded this month · ${streak} month streak</p>`:''}</article>`;
    }).join(''):'<p class="muted">No savings goals yet. Add a goal to track your progress.</p>';

    const completeGoal=goals.some(goal=>goal.status==='completed');
    const donationTab=$('#savingsTabDonations'),donationPanel=$('#savingsPanelDonations'),donationSection=$('#donationSection');
    donationTab?.classList.toggle('hidden',!completeGoal);
    donationPanel?.classList.toggle('hidden',!completeGoal);if(donationPanel)donationPanel.hidden=!completeGoal;
    donationSection?.classList.toggle('hidden',!completeGoal);
    if(!completeGoal&&document.querySelector('[data-savings-tab].active')?.dataset.savingsTab==='donations')activateSavingsPanel('goals');
    const donationAmount=$('#donationAmount');if(donationAmount){donationAmount.max=String(balance);donationAmount.placeholder=balance>0?`Up to ${money(balance)}`:'Available after a goal is complete';}

    const smartPct=Number(recommendation.recommended_pct||0),monthlyAmount=Number(recommendation.monthly_amount||0);
    setText('#smartSavingsMonthlyAmount',money(monthlyAmount));
    setText('#smartSavingsPctLabel',`${smartPct}% of monthly income`);
    setText('#smartSavingsReason',`${recommendation.reason||'Based on your income and expenses.'}${recommendation.monthly_surplus!=null?` Monthly surplus entered: ${money(recommendation.monthly_surplus)}.`:''}`);
    setText('#smartSavingsTitle','Suggested savings contribution');

    const activeGoals=goals.filter(goal=>goal.status==='active');
    const options=activeGoals.map(goal=>`<option value="${Number(goal.id)}">${escapeHtml(goal.name)}</option>`).join('');
    for(const id of ['monthlyDepositGoalId','savingsContributionGoal']){
      const select=$('#'+id);if(!select)continue;const old=select.value;
      select.innerHTML='<option value="">General savings</option>'+options;
      if(old&&[...select.options].some(option=>option.value===old))select.value=old;
    }
    const pctInput=$('#monthlyDepositPct');if(pctInput&&document.activeElement!==pctInput)pctInput.value=Number(schedule.income_pct??recommendation.recommended_pct??STATE?.profile?.savings_pct??5);
    const monthsInput=$('#monthlyDepositMonths');if(monthsInput&&document.activeElement!==monthsInput)monthsInput.value=Number(schedule.duration_months||6);
    const dayInput=$('#monthlyDepositDay');if(dayInput&&document.activeElement!==dayInput)dayInput.value=Number(schedule.due_day||1);
    const enabledInput=$('#monthlyDepositEnabled');if(enabledInput&&document.activeElement!==enabledInput)enabledInput.checked=Boolean(schedule.enabled);
    const consentInput=$('#monthlyDepositConsent');if(consentInput&&document.activeElement!==consentInput)consentInput.checked=false;
    const goalInput=$('#monthlyDepositGoalId');if(goalInput&&schedule.goal_id!=null&&document.activeElement!==goalInput)goalInput.value=String(schedule.goal_id);
    const pctValue=Number(pctInput?.value||0),monthsValue=Number(monthsInput?.value||6),estimatedMonthly=Number(STATE?.profile?.monthly_income||0)*pctValue/100;
    setText('#monthlyDepositEstimate',money(estimatedMonthly));
    setText('#monthlyDepositEstimateDetail',`${pctValue}% of ${money(STATE?.profile?.monthly_income||0)} monthly income · ${monthsValue} months · ${money(estimatedMonthly*monthsValue)} total planned`);
    const scheduleStatus=$('#monthlyDepositStatus');
    if(scheduleStatus){const status=String(schedule.status||'disabled');scheduleStatus.textContent=status==='scheduled'?'Savings schedule is active.':status==='saved'?'Savings schedule saved.':status==='duration_complete'?'Your selected savings period is complete.':status==='error'?'Savings schedule needs attention. Review the amount and payment details.':status==='disabled'?'Savings schedule is off.':'Savings schedule saved.';}
    const streakSummary=$('#savingsStreakSummary');if(streakSummary)streakSummary.innerHTML=`<strong>${Number(progress.savings_streak||0)} month savings streak</strong><p class="muted">A goal streak grows when its monthly contribution target is met.</p>`;
    setText('#savingsOtterStreak',`${Number(progress.savings_streak||0)} month${Number(progress.savings_streak||0)===1?'':'s'}`);
    setText('#savingsOtterCaption',goals.some(goal=>Number(goal.monthly_target||0)>0)?'Your streak counts consecutive months when a savings goal meets its monthly target.':'Add a monthly target to start tracking savings consistency.');
    const contributionDate=$('#savingsContributionDate');if(contributionDate&&!contributionDate.value)contributionDate.value=new Date().toISOString().slice(0,10);
    const history=$('#savingsContributionHistory');
    if(history){const rows=Array.isArray(progress.contributions)?progress.contributions:[];history.innerHTML=rows.length?rows.map(item=>`<article class="history-row"><strong>${money(item.amount)}</strong><span>${item.contribution_date?new Date(`${item.contribution_date}T12:00:00`).toLocaleDateString():'Recorded'}</span></article>`).join(''):'<p class="muted">No contributions recorded yet.</p>';}
    const donationHistory=$('#donationHistory');
    if(donationHistory){const rows=Array.isArray(donations)?donations:(donations?.donations||[]);donationHistory.innerHTML=rows.length?rows.map(item=>`<article class="donation-row"><div><strong>${escapeHtml(item.charity_name||'Charity')}</strong><span class="muted">${money(item.amount)} · ${escapeHtml(String(item.status||'saved').replaceAll('_',' '))}</span></div><time>${item.created_at?new Date(item.created_at).toLocaleDateString():'Saved'}</time><p class="muted">${escapeHtml(cleanCopy(item.message||item.note||item.last_error||'Donation status updated.'))}</p></article>`).join(''):'<p class="muted">No donations recorded yet.</p>';}
  }catch(error){console.error(error)}
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
    const metrics=[['Contributions recorded',r.drip_count],['Days on track',r.active_days],['Goals completed',r.goals_completed],['Goals completed',r.goals_completed]];
    const max=Math.max(Number(r.stash_contribution),Number(r.debt_contribution),1);
    $('#monthlyRecap').innerHTML=`<div class="recap-heading"><div><span class="data-label">${escapeHtml(r.month)} recap</span><h3>${money(r.total_moved)} in recorded practice contributions</h3></div><span class="badge">CAD</span></div><div class="recap-metrics">${metrics.map(([label,val])=>`<div class="recap-metric"><span>${label}</span><strong>${val}</strong></div>`).join('')}</div><div class="recap-allocation"><div class="recap-bar-row"><div><span>Savings contribution</span><strong>${money(r.stash_contribution)}</strong></div><div class="recap-track"><span style="width:${Math.max(0,Math.min(100,Number(r.stash_contribution)/max*100))}%"></span></div></div><div class="recap-bar-row"><div><span>Debt contribution</span><strong>${money(r.debt_contribution)}</strong></div><div class="recap-track"><span style="width:${Math.max(0,Math.min(100,Number(r.debt_contribution)/max*100))}%"></span></div></div></div><div class="recap-current"><div><span>Current savings</span><strong>${money(r.current_stash_balance)}</strong></div><div><span>Current active debt</span><strong>${money(r.current_active_debt)}</strong></div><div><span>Current streak</span><strong>${r.streak} days</strong></div></div><p class="muted recap-note">${escapeHtml(r.note)}</p>`;
  }catch(e){$('#monthlyRecap').innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`}
}

async function load(){
  try{
    const me=await api('/api/auth/me');
    if(!me.authenticated){STATE=null;window.location.replace('/signin');return}
    STATE=await api('/api/state');
    selectedStrategy=STATE.plan?.strategy||'smart';
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
    await initFinanceInsights();
    maybeStartWalkthrough();
  }catch(e){console.error(e);toast(e.message||'Unable to load your Glim plan.');}
}

async function renderScoutDebtSuggestions(suggestions){
  const host=$('#scoutDebtSuggestions'); if(!host)return;
  if(window.GlimStorage?.mode==='indexedDB'){
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
    await api('/api/profile',{method:'POST',body:JSON.stringify({name:'',persona:'custom',monthly_income:income,average_monthly_expenses:expenses,savings_pct:Number($('#pPct').value),approval_mode:$('#pApprovalMode')?.value||'each',weekly_cap:Number($('#pWeeklyCap')?.value||60),floor_balance:floor,quiet_start:'22:00',quiet_end:'08:00',notification_cap:3,notification_channel:'in_app',debt_reminder_tone:'zen',show_consistency:true,show_learning_tips:true,show_friend_support:false,show_plan_help:true})});
    if(debtStarted) await api('/api/debts',{method:'POST',body:JSON.stringify({name:debtName,type:$('#setupDebtType').value,balance:Number(debtBalance),apr:Number(debtApr),minimum:Number(debtMinimum),due_day:Number($('#setupDebtDueDay')?.value||15)})});
    window.location.assign('/app/overview');
  }catch(error){toast(error.message||'Unable to save your plan.');}
});
$('#debtForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/debts',{method:'POST',body:JSON.stringify({name:$('#dName').value,type:$('#dType').value,balance:+$('#dBalance').value,apr:+$('#dApr').value,minimum:+$('#dMin').value,due_day:+($('#dDueDay')?.value||15)})});$('#debtForm').reset();if($('#dDueDay'))$('#dDueDay').value=15;await load();toast('Debt added.')}catch(e){toast(e.message)}});
$('#scanBtn')?.addEventListener('click',()=>runScout(true));
$$('.strategy').forEach(b=>b.addEventListener('click',()=>{selectedStrategy=b.dataset.strategy;$$('.strategy').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});buildPlan()}));
$('#planBtn')?.addEventListener('click',buildPlan);
$('#whatIfBtn')?.addEventListener('click',async()=>{if(!STATE?.plan?.projection){$('#whatIfResult').textContent='Add a debt in Debt plan before comparing scenarios.';return}try{const r=await api('/api/what-if',{method:'POST',body:JSON.stringify({text:$('#whatIfInput').value})});if(!r.what_if){$('#whatIfResult').textContent='Describe one specific change, such as spending less on takeout each week.';return}$('#whatIfResult').textContent=`${r.parsed.label}${r.parsed.assumptions?.length?' Assumptions: '+r.parsed.assumptions.join(' '):''}${r.parsed.needs_clarification?' Add the missing detail before Glim estimates the impact.':r.what_if?` Estimated payoff: ${r.what_if.months} months and ${money(r.what_if.interest_paid)} modeled interest.`:''}`;$('#scenarioComparison').innerHTML=r.what_if?`<div><strong>Current</strong><br>${STATE.plan.projection.months} months · ${money(STATE.plan.projection.interest_paid)} interest</div><hr/><div><strong>What-if</strong><br>${r.what_if.months} months · ${money(r.what_if.interest_paid)} interest<br><span class="muted">${Number(r.what_if.months_saved_vs_baseline||0)} months and ${money(r.what_if.interest_saved_vs_baseline||0)} interest difference versus current plan</span></div>`:''}catch(e){$('#whatIfResult').textContent=cleanCopy(e.message)}});
$('#approveDrip')?.addEventListener('click',async()=>{const connected=STATE?.paypal?.status==='connected'&&window.GlimStorage?.mode!=='indexedDB'&&STATE?.payment_readiness!==false;if(!connected){activateSection('plan',{push:true});return}try{await api('/api/drip/approve',{method:'POST',body:JSON.stringify({approve:true})});toast('Today’s amount has been approved.');await load()}catch(e){toast(cleanCopy(e.message))}});
$('#freezeBtn')?.addEventListener('click',async()=>{try{await api('/api/game/freeze',{method:'POST'});await load();toast('Missed-day safeguard used.')}catch(e){toast(e.message)}});
$('#pauseBtn')?.addEventListener('click',async()=>{const wasPaused=Boolean(STATE?.paused);try{await api(wasPaused?'/api/resume':'/api/pause',{method:'POST'});await load();toast(wasPaused?'Progress tracking resumed.':'Progress tracking paused.')}catch(e){toast(e.message)}});
$$('.question-suggestion').forEach(button=>button.addEventListener('click',()=>{const input=$('#chatInput');input.value=button.dataset.question||'';$('#chatForm').requestSubmit()}));
$('#chatForm')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#chatInput');const text=input.value.trim();if(!text)return;$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble user"><strong>You</strong><br>${escapeHtml(text)}</div>`);input.value='';try{const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message:text})});$('#chatWindow').insertAdjacentHTML('beforeend',`<div class="bubble"><strong>Glim</strong><br>${escapeHtml(cleanCopy(r.message))}</div>`);$('#chatWindow').scrollTop=$('#chatWindow').scrollHeight}catch(e){toast(e.message)}});
$('#nudgeBtn')?.addEventListener('click',async()=>{try{lastNudge=await api('/api/nudge');$('#nudgeText').textContent=cleanCopy(lastNudge.message);$('#nudgeWhy').textContent=cleanCopy(lastNudge.why||'This reminder uses your saved preferences and due dates.');$('#nudgePreview')?.classList.remove('hidden');await renderNotifications()}catch(e){toast(e.message)}});
$$('.nudge-action').forEach(b=>b.addEventListener('click',async()=>{try{await api('/api/nudge/response',{method:'POST',body:JSON.stringify({response:b.dataset.response})});await load();toast('Check-in response saved.')}catch(e){toast(e.message)}}));
$('#saveNotifBtn')?.addEventListener('click',async()=>{try{const p=STATE.profile||{};await api('/api/profile',{method:'POST',body:JSON.stringify({...p,quiet_start:$('#notifStart').value,quiet_end:$('#notifEnd').value,notification_cap:+$('#notifCap').value,notification_channel:$('#notifChannel').value,debt_reminder_tone:$('#debtReminderTone')?.value||'zen',timezone:$('#notifTimezone').value||'America/Toronto'})});await load();toast('Notification settings saved.')}catch(e){toast(e.message)}});


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

$('#savingsGoalForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/stash/goals',{method:'POST',body:JSON.stringify({name:$('#savingsGoalName').value.trim(),target_amount:+$('#savingsGoalTarget').value,monthly_target:+($('#savingsGoalMonthlyTarget')?.value||0)})});$('#savingsGoalForm').reset();await renderStash();toast('Savings goal added.')}catch(e){toast(cleanCopy(e.message))}});
$('#monthlyDepositPct')?.addEventListener('input',()=>{const pct=Number($('#monthlyDepositPct').value||0),income=Number(STATE?.profile?.monthly_income||0),months=Number($('#monthlyDepositMonths')?.value||6),amount=income*pct/100;if($('#monthlyDepositEstimate'))$('#monthlyDepositEstimate').textContent=money(amount);if($('#monthlyDepositEstimateDetail'))$('#monthlyDepositEstimateDetail').textContent=`${pct}% of ${money(income)} monthly income · ${months} months · ${money(amount*months)} planned in total`;});
$('#monthlyDepositMonths')?.addEventListener('input',()=>$('#monthlyDepositPct')?.dispatchEvent(new Event('input')));
$('#monthlyDepositDay')?.addEventListener('input',()=>$('#monthlyDepositPct')?.dispatchEvent(new Event('input')));
$('#applySmartSavingsBtn')?.addEventListener('click',async()=>{try{const r=await api('/api/savings/recommendation');const p=STATE?.profile||{};await api('/api/profile',{method:'POST',body:JSON.stringify({...p,savings_pct:Number(r.recommended_pct||0)})});STATE=await api('/api/state');if($('#monthlyDepositPct'))$('#monthlyDepositPct').value=Number(r.recommended_pct||0)||0.1;$('#monthlyDepositPct')?.dispatchEvent(new Event('input'));await renderStash();toast('Savings recommendation applied.')}catch(e){toast(cleanCopy(e.message))}});
$('#monthlyDepositForm')?.addEventListener('submit',async e=>{e.preventDefault();const status=$('#monthlyDepositStatus');try{const enabled=$('#monthlyDepositEnabled').checked;const payload={enabled,amount:0,income_pct:+$('#monthlyDepositPct').value,duration_months:+$('#monthlyDepositMonths').value,goal_id:$('#monthlyDepositGoalId').value?+$('#monthlyDepositGoalId').value:null,due_day:+$('#monthlyDepositDay').value,consent:$('#monthlyDepositConsent').checked};const result=await api('/api/stash/auto-deposit',{method:'PUT',body:JSON.stringify(payload)});if(status)status.textContent=result.enabled?'Savings plan saved.': 'Savings plan turned off.';await renderStash();if($('#monthlyDepositConsent'))$('#monthlyDepositConsent').checked=false;toast(enabled?'Savings schedule saved.':'Savings schedule disabled.')}catch(e){if(status)status.textContent=cleanCopy(e.message);else toast(cleanCopy(e.message))}});
$('#savingsBalanceForm')?.addEventListener('submit',async e=>{e.preventDefault();const amount=Number($('#savingsCurrentBalance').value);try{await api('/api/stash/balance',{method:'POST',body:JSON.stringify({balance:amount})});await load();toast('Savings balance updated.')}catch(e){toast(cleanCopy(e.message))}});
$('#savingsContributionForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const r=await api('/api/savings/contributions',{method:'POST',body:JSON.stringify({amount:+$('#savingsContributionAmount').value,contribution_date:$('#savingsContributionDate').value,goal_id:$('#savingsContributionGoal').value?+$('#savingsContributionGoal').value:null})});$('#savingsContributionAmount').value='';await load();toast(r.recorded?.monthly_target_met?'Monthly target met. Your savings streak is updated.':'Savings contribution recorded.')}catch(e){toast(cleanCopy(e.message))}});
$('#donationForm')?.addEventListener('submit',async e=>{e.preventDefault();const status=$('#donationStatus');try{const r=await api('/api/savings/donations',{method:'POST',body:JSON.stringify({charity_name:$('#donationCharityName').value.trim(),recipient_email:$('#donationRecipientEmail').value.trim(),amount:+$('#donationAmount').value})});if(status)status.textContent=r.status==='planned'?'Donation request saved. No payment was completed.':r.message||`Donation status: ${r.status}.`;await renderStash();toast(r.status==='planned'?'Donation request saved.':'Donation submitted.')}catch(e){if(status)status.textContent=cleanCopy(e.message);else toast(cleanCopy(e.message))}});
$('#debtPaymentForm')?.addEventListener('submit',async e=>{e.preventDefault();const id=Number($('#debtPaymentDebtId').value),status=$('#debtPaymentResult');try{const r=await api(`/api/debts/${id}/payments`,{method:'POST',body:JSON.stringify({amount:+$('#debtPaymentAmount').value,payment_date:$('#debtPaymentDate').value})});if(status)status.textContent=r.recorded?.paid_on_time?'Minimum payment recorded by the due day.':'Payment saved. It did not meet the minimum by the entered due day.';$('#debtPaymentDialog')?.close();await load();toast(r.recorded?.currency_awarded?`On-time payment recorded. Earned ${r.recorded.currency_awarded} shells.`:'Payment record saved.')}catch(e){if(status)status.textContent=cleanCopy(e.message);else toast(cleanCopy(e.message))}});
$('#cancelDebtPayment')?.addEventListener('click',()=>$('#debtPaymentDialog')?.close());
$('#loadRecapBtn')?.addEventListener('click',renderMonthlyRecap);
$('#auditBtn')?.addEventListener('click',renderAudit);
$('#squadGoalForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads/goals',{method:'POST',body:JSON.stringify({title:$('#squadGoalTitle').value.trim(),target_count:+$('#squadGoalTarget').value,reward_cosmetic_id:+$('#squadGoalReward').value})});await renderSquad();$('#squadGoalTitle').value='';toast('Shared goal created.')}catch(e){toast(e.message)}});
$('#createSquadForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads',{method:'POST',body:JSON.stringify({name:$('#squadName').value.trim()})});await load();toast('Group created.')}catch(e){toast(e.message)}});
$('#loadLessonBtn')?.addEventListener('click',async()=>{try{const r=await api('/api/lessons/next');currentLesson=r.lesson||null;if(!currentLesson){$('#lessonCard').innerHTML='<strong>Path complete.</strong><p>You finished the current Sage path.</p>';return}$('#lessonCard').innerHTML=`<strong>${escapeHtml(currentLesson.title)}</strong><p>${escapeHtml(currentLesson.description)}</p><p>${escapeHtml(r.prompt)}</p><div class="input-row"><input id="lessonAnswer" placeholder="Your answer"/><button class="primary" id="lessonSubmit">Check</button></div><p class="muted">A quick check helps apply this to your own plan.</p>`;$('#lessonSubmit').onclick=async()=>{try{const x=await api('/api/lessons/complete',{method:'POST',body:JSON.stringify({lesson_id:currentLesson.id,answer:$('#lessonAnswer').value})});$('#lessonCard').innerHTML=`<strong>Completed.</strong><p>Keep the useful idea in mind when reviewing your plan.</p>`;await load();}catch(e){toast(e.message)}}}catch(e){toast(e.message)}});
$('#exportBtn')?.addEventListener('click',async()=>{try{const data=await api('/api/data/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='glim-data-export.json';a.click();URL.revokeObjectURL(a.href);$('#dataMsg').textContent='Export created.'}catch(e){toast(e.message)}});
$('#deleteBtn')?.addEventListener('click',async()=>{if(!confirm('Delete all your Glim data? This cannot be undone.'))return;try{await api('/api/account',{method:'DELETE'});STATE=null;window.location.assign('/')}catch(e){toast(e.message)}});
const APP_SECTIONS=['overview','plan','savings','insights','settings','help'];
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
activateSavingsPanel('goals');
$('#logoutBtn')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});STATE=null;window.location.assign('/')}catch(e){toast(cleanCopy(e.message))}});
$('#paypalConnectBtn')?.addEventListener('click',async()=>{const b=$('#paypalConnectBtn');b.disabled=true;try{const r=await api('/api/paypal/connect',{method:'POST'});if(r.approval_url){$('#paypalApprovalLink').innerHTML=`<a class="text-link" href="${escapeHtml(r.approval_url)}" rel="noopener">Continue secure connection</a>`;window.location.assign(r.approval_url);return;}await load();}catch(e){toast(cleanCopy(e.message))}finally{b.disabled=false;await setIntegrationStatus()}});
$('#paypalDisconnectBtn')?.addEventListener('click',async()=>{if(!confirm('Disconnect this funding source? Pending contributions must be checked first.'))return;const b=$('#paypalDisconnectBtn');b.disabled=true;try{await api('/api/paypal/disconnect',{method:'POST'});await load();toast('Funding source disconnected.')}catch(e){toast(cleanCopy(e.message))}finally{b.disabled=false;await setIntegrationStatus()}});
$('#settleWeekBtn')?.addEventListener('click',async()=>{const b=$('#settleWeekBtn');b.disabled=true;const out=$('#settlementActionResult');try{const r=await api('/api/drip/settle',{method:'POST'});out.textContent=`Transfer status: ${settlementLabel(r.status||'submitted')}${r.amount==null?'':' · '+money(r.amount)+' CAD'}.`;if(r.approval_url)out.innerHTML+=` <a class="text-link" href="${escapeHtml(r.approval_url)}" rel="noopener">Continue secure approval</a>`;await load()}catch(e){out.textContent=cleanCopy(e.message);await setIntegrationStatus()}finally{b.disabled=false}});
$('#reconcileBtn')?.addEventListener('click',async()=>{const b=$('#reconcileBtn'),out=$('#settlementActionResult');b.disabled=true;try{const r=await api('/api/drip/reconcile',{method:'POST'});out.textContent=`Payment status refreshed. ${Number(r.reconciled||0)} settlement(s) reconciled.`;await load()}catch(e){out.textContent=cleanCopy(e.message)}finally{b.disabled=false}});
$('#joinSquadForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/squads/join',{method:'POST',body:JSON.stringify({invite_code:$('#squadInviteCode').value.trim()})});$('#squadActionNote').textContent='Joined group.';$('#squadInviteCode').value='';await load()}catch(error){$('#squadActionNote').textContent=error.message}});
$('#leaveSquadBtn')?.addEventListener('click',async()=>{if(!confirm('Leave this group? Your shared progress and messages will be removed.'))return;try{await api('/api/squads/leave',{method:'POST'});await load();toast('Left group.')}catch(e){toast(e.message)}});
$('#pushEnableBtn')?.addEventListener('click',async()=>{try{if(window.GlimStorage.mode==='indexedDB')throw new Error('Browser alerts are not available right now.');if(!('serviceWorker' in navigator))throw new Error('This browser does not support service workers.');const cfg=await api('/api/push/config');if(!cfg.enabled)throw new Error(cfg.reason||'Browser alerts are not available right now.');const reg=await navigator.serviceWorker.register('/sw.js');const perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('Browser notifications were not granted.');const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.public_key)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});toast('Browser alerts enabled.')}catch(e){toast(cleanCopy(e.message))}});
function urlBase64ToUint8Array(base64){const pad='='.repeat((4-base64.length%4)%4);const raw=atob((base64+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}


async function setIntegrationStatus(){
 const localMode=window.GlimStorage?.mode==='indexedDB';
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
   if(privacy)privacy.textContent='You can export a copy of your plan from this section.';
   const settle=$('#settleWeekBtn'),rec=$('#reconcileBtn');if(settle)settle.classList.add('hidden');if(rec)rec.classList.add('hidden');
   const activity=$('#contributionActivitySection');if(activity)activity.classList.add('hidden');
   const conn=$('.connection-row .button-row');if(conn)conn.classList.add('hidden');
   $('#fundingConnectionSection')?.classList.add('hidden');
   return;
 }
 $('#accountTransferDetails')?.classList.remove('hidden');
 if(mode)mode.textContent='Your plan stays available without an account connection.';
 if(privacy)privacy.textContent='Export a copy of your plan or delete your data from this section.';
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
 const host=$('#settlementList');if(!host)return;const localMode=window.GlimStorage?.mode==='indexedDB';if(localMode){host.innerHTML='<p class="muted">Transfers are not connected. Nothing will be sent from this page.</p>';return;}
 try{const rows=await api('/api/ledger');const pending=Array.isArray(STATE?.settlements)?STATE.settlements:[];const accrued=(rows||[]).filter(r=>r.status==='accrued');const details=pending.map(r=>`<article class="inbox-item"><strong>Transfer ${escapeHtml(r.reference)} · ${escapeHtml(settlementLabel(r.status))}</strong><p>${money(r.amount)} CAD${r.last_error?` · ${escapeHtml(cleanCopy(r.last_error))}`:''}</p>${r.status==='awaiting_approval'&&STATE?.paypal?.pending_settlement_approval_url?`<p><a class="text-link" href="${escapeHtml(STATE.paypal.pending_settlement_approval_url)}" rel="noopener">Continue secure approval</a></p>`:''}<div class="button-row"><button class="secondary" type="button" data-reconcile-ref="${escapeHtml(r.reference)}">Refresh status</button>${['creating_order','capture_pending','capture_unknown','capture_failed','payout_error','payout_failed','creating_payout'].includes(r.status)?`<button class="secondary" type="button" data-retry-ref="${escapeHtml(r.reference)}">Resolve issue</button>`:''}</div></article>`);
  if(accrued.length)details.unshift(`<p class="muted">${accrued.length} approved transfer(s), ${money(accrued.reduce((a,r)=>a+Number(r.amount||0),0))} CAD, waiting to be sent.</p>`);
  host.innerHTML=details.length?details.join(''):'<p class="muted">No pending transfers or unresolved payment issues.</p>';
  host.querySelectorAll('[data-retry-ref]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api(`/api/drip/settlements/${encodeURIComponent(btn.dataset.retryRef)}/retry`,{method:'POST'});$('#settlementActionResult').textContent=`Transfer status: ${settlementLabel(r.status||'pending')}.`;await load()}catch(e){$('#settlementActionResult').textContent=cleanCopy(e.message);btn.disabled=false}}));
  host.querySelectorAll('[data-reconcile-ref]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api('/api/drip/reconcile',{method:'POST'});$('#settlementActionResult').textContent=`Payment status refreshed. ${Number(r.reconciled||0)} settlement(s) reconciled.`;await load()}catch(e){$('#settlementActionResult').textContent=cleanCopy(e.message);btn.disabled=false}}));
 }catch(e){host.innerHTML=`<p class="muted">${escapeHtml(cleanCopy(e.message))}</p>`;}
}


let lastFinanceScenario = null;
function localIsoDate(date = new Date()) { const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
function monthInputValue() { return localIsoDate().slice(0,7); }
function activateInsightsPanel(name) {
  $$('.insights-subtab').forEach(button=>{const active=button.dataset.insightsTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  $$('.insights-subpanel').forEach(panel=>{const active=panel.id===`insightsPanel${name[0].toUpperCase()}${name.slice(1)}`;panel.classList.toggle('hidden',!active);panel.classList.toggle('active',active);panel.hidden=!active;});
  if(name==='calendar')renderFinancialCalendar();
  if(name==='reports')renderFinancialReport();
  if(name==='connections')renderBankConnection();
}
$$('[data-insights-tab]').forEach(button=>button.addEventListener('click',()=>activateInsightsPanel(button.dataset.insightsTab)));
function csvParse(text) {
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&quoted&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"'){quoted=!quoted;}else if(ch===','&&!quoted){row.push(field.trim());field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field.trim());field='';if(row.some(cell=>cell!==''))rows.push(row);row=[];}else field+=ch;}
  row.push(field.trim());if(row.some(cell=>cell!==''))rows.push(row);if(rows.length<2)throw new Error('The CSV file needs a header row and at least one transaction.');
  const key = value => String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const headers=rows.shift().map(key);const get=(cells,names)=>{const i=headers.findIndex(h=>names.includes(h));return i>=0?String(cells[i]||'').trim():'';};
  return rows.map(cells=>{
    const dateRaw=get(cells,['date','transactiondate','posteddate','txn date','valuedate']);
    let date=dateRaw.slice(0,10);
    if(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(dateRaw)){const parts=dateRaw.split(/[/-]/).map(Number);let [a,b,c]=parts;if(c<100)c+=2000;date=`${c}-${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}`;}
    const description=get(cells,['description','transactiondescription','merchant','name','payee','details']);
    const typeRaw=get(cells,['type','transactiontype','debitcredit','direction']).toLowerCase();
    const debitRaw=get(cells,['debit','withdrawal','withdrawals','charge']);const creditRaw=get(cells,['credit','deposit','deposits']);
    const amountRaw=get(cells,['amount','transactionamount','value']);
    const cleanNumber=value=>Number(String(value||'').replace(/[$,\s]/g,'').replace(/[()]/g,'-'));
    let amount, type;
    if(debitRaw!==''&&creditRaw!==''){const debit=Math.abs(cleanNumber(debitRaw)||0),credit=Math.abs(cleanNumber(creditRaw)||0);if(credit>0){amount=credit;type='income';}else{amount=debit;type='expense';}}
    else {amount=cleanNumber(amountRaw);if(!Number.isFinite(amount))amount=0;if(typeRaw.includes('income')||typeRaw.includes('credit')||typeRaw.includes('deposit'))type='income';else if(typeRaw.includes('transfer'))type='transfer';else if(typeRaw.includes('expense')||typeRaw.includes('debit')||typeRaw.includes('withdraw')||typeRaw.includes('payment'))type='expense';else type=amount<0?'income':'expense';}
    const category=get(cells,['category','personalfinancecategory','transactioncategory'])||(/pay|salary|payroll/i.test(description)&&type==='income'?'Income':type==='transfer'?'Transfer':'Uncategorized');
    return {date,description,amount:Math.abs(amount),type,category,source:'CSV import'};
  }).filter(row=>row.date&&row.description&&row.amount>0);
}
function renderCashflowTransactions(transactions, month) {
  const rows=(transactions||[]).filter(t=>String(t.date).slice(0,7)===month);
  const sum=type=>rows.filter(t=>t.type===type).reduce((a,t)=>a+Number(t.amount||0),0);
  const set=(selector,value)=>{const el=$(selector);if(el)el.textContent=value;};
  set('#cashflowIncome',money(sum('income')));set('#cashflowExpenses',money(sum('expense')));set('#cashflowNet',money(sum('income')-sum('expense')));
  const host=$('#cashflowTransactions');
  if(host)host.innerHTML=rows.length?rows.slice(0,60).map(t=>`<article class="transaction-row"><div class="transaction-description"><strong>${escapeHtml(t.description)}</strong><span>${escapeHtml(t.category||'Uncategorized')}</span></div><div class="transaction-meta">${new Date(`${t.date}T12:00:00`).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'})} · ${escapeHtml(t.source||'Manual')}</div><strong class="transaction-amount ${t.type==='income'?'income':'expense'}">${t.type==='income'?'+':t.type==='expense'?'−':''}${money(t.amount)}</strong></article>`).join(''):'<p class="muted">No transactions for this month. Add an entry or import a CSV statement.</p>';
  const categories={};rows.filter(t=>t.type==='expense').forEach(t=>categories[t.category||'Uncategorized']=(categories[t.category||'Uncategorized']||0)+Number(t.amount||0));
  const categoryHost=$('#spendingCategories'),list=Object.entries(categories).sort((a,b)=>b[1]-a[1]),max=Math.max(1,...list.map(([,v])=>v));
  if(categoryHost)categoryHost.innerHTML=list.length?list.map(([name,amount])=>`<div class="category-row"><span>${escapeHtml(name)}</span><div class="category-track" role="progressbar" aria-label="${escapeHtml(name)} spending" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(amount/max*100)}"><span style="width:${amount/max*100}%"></span></div><strong>${money(amount)}</strong></div>`).join(''):'<p class="muted">No categorized spending has been recorded for this month.</p>';
}
async function loadFinanceTransactions() {
  const transactions=await api('/api/finance/transactions');
  renderCashflowTransactions(Array.isArray(transactions)?transactions:[],$('#cashflowMonth')?.value||monthInputValue());
  return transactions;
}
async function renderFinancialCalendar() {
  const month=$('#calendarMonth')?.value||monthInputValue(),host=$('#financialCalendarEvents');if(!host)return;
  try{const items=await api(`/api/finance/calendar?month=${encodeURIComponent(month)}`);host.innerHTML=items.length?items.map(item=>`<article class="calendar-event"><div class="calendar-date">${new Date(`${item.date}T12:00:00`).toLocaleDateString('en-CA',{month:'short',day:'numeric'})}<span>${new Date(`${item.date}T12:00:00`).toLocaleDateString('en-CA',{weekday:'short'})}</span></div><div class="calendar-event-main"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail||'')}</span><span class="event-status">${escapeHtml(item.status||'upcoming')}</span></div><strong class="calendar-event-amount">${Number(item.amount||0)>0?money(item.amount):'—'}</strong></article>`).join(''):'<p class="muted">No scheduled events for this month.</p>';}catch(e){host.innerHTML=`<p class="muted">${escapeHtml(cleanCopy(e.message))}</p>`;}
}
function renderTrend(container, months, fields) {
  const host=$(container);if(!host)return;
  const max=Math.max(1,...months.flatMap(m=>fields.map(f=>Number(m[f.key]||0))));
  host.innerHTML=months.map(m=>`<div class="trend-row"><span class="trend-month">${escapeHtml(new Date(`${m.month}-01T12:00:00`).toLocaleDateString('en-CA',{month:'short',year:'2-digit'}))}</span><div class="trend-bars">${fields.map(f=>`<span class="trend-bar ${f.className||''}" style="width:${Math.max(0,Math.min(100,Number(m[f.key]||0)/max*100))}%" title="${escapeHtml(f.label)}: ${money(m[f.key])}"></span>`).join('')}</div><span class="trend-value">${money(Number(m[fields[0].key]||0))}</span></div>`).join('');
  const labels=fields.map(f=>`<span><i class="trend-key ${f.className||''}"></i>${escapeHtml(f.label)}</span>`).join(' ');
  host.insertAdjacentHTML('beforeend',`<div class="trend-legend">${labels}</div>`);
}
async function renderFinancialReport() {
  const month=$('#reportMonth')?.value||monthInputValue(),host=$('#financialReportSummary');if(!host)return;
  try{const r=await api(`/api/finance/report?month=${encodeURIComponent(month)}`);const metrics=[['Net cash flow',money(r.net_cash_flow)],['Debt payments recorded',money(r.debt_payments)],['Savings contributions',money(r.savings_contributions)],['Estimated interest avoided',money(r.modeled_interest_avoided)]];host.innerHTML=metrics.map(([label,value])=>`<article class="report-summary-item"><span>${label}</span><strong>${value}</strong></article>`).join('');renderTrend('#cashflowTrend',r.months||[],[{key:'income',label:'Income'},{key:'expenses',label:'Expenses',className:'secondary'}]);renderTrend('#progressTrend',r.months||[],[{key:'debt_payments',label:'Debt payments'},{key:'savings_contributions',label:'Savings',className:'secondary'}]);const caveat=$('#reportCaveat');if(caveat)caveat.textContent=`Current balances: ${money(r.active_debt_balance)} active debt · ${money(r.savings_balance)} savings. Report values reflect entries and imports; historical lender balances are not inferred.`;}catch(e){host.innerHTML=`<p class="muted">${escapeHtml(cleanCopy(e.message))}</p>`;}
}
async function renderSavedScenarios() {
  const host=$('#savedScenarios');if(!host)return;
  try{const rows=await api('/api/finance/scenarios');host.innerHTML=rows.length?`<h3>Saved scenarios</h3>`+rows.slice().reverse().slice(0,8).map(r=>`<article class="saved-scenario-row"><div><strong>${escapeHtml(r.name||'Scenario')}</strong><span>${Number(r.projection?.months||0)} months · ${money(r.projection?.interest_paid||0)} interest · ${Number(r.months_saved||0)} months vs baseline</span></div><span>${new Date(r.created_at||Date.now()).toLocaleDateString('en-CA')}</span></article>`).join(''):'<p class="muted">Saved comparisons will appear here.</p>';}catch(e){host.textContent=cleanCopy(e.message);}
}
function renderScenarioResult(scenario) {
  const host=$('#financeScenarioResult');if(!host)return;
  host.innerHTML=`<div class="scenario-result-grid"><div class="scenario-result-metric"><span>Current-plan estimate</span><strong>${Number(scenario.baseline.months)>=600?'600+':scenario.baseline.months} months</strong><span>${money(scenario.baseline.interest_paid)} estimated interest</span></div><div class="scenario-result-metric"><span>What-if estimate</span><strong>${Number(scenario.projection.months)>=600?'600+':scenario.projection.months} months</strong><span>${money(scenario.projection.interest_paid)} estimated interest</span></div><div class="scenario-result-metric"><span>Change in interest</span><strong>${money(scenario.interest_saved)}</strong><span>${scenario.interest_saved>=0?'potentially avoided':'additional modeled interest'}</span></div></div><p class="scenario-difference">${scenario.months_saved>=0?`${scenario.months_saved} fewer modeled months to repay debt.`:`${Math.abs(scenario.months_saved)} more modeled months to repay debt.`} Estimated monthly surplus after the changes: ${money(scenario.available_monthly_surplus)}. Savings after the unexpected expense: ${money(scenario.savings_balance_after_unexpected_expense)}.${Number(scenario.unexpected_expense_from_debt)>0?` The remaining ${money(scenario.unexpected_expense_from_debt)} is modeled as added debt because it exceeds your current recorded savings.`:''}</p>`;
}
async function renderBankConnection() {
  const title=$('#bankConnectionTitle'),copy=$('#bankConnectionCopy'),connect=$('#bankConnectBtn'),sync=$('#bankSyncBtn'),disconnect=$('#bankDisconnectBtn');
  if(!title)return;
  try{
    const status=await api('/api/bank/status');title.textContent=status.connected?'Canadian bank connected':'Bank connection status';
    copy.textContent=status.connected?'A connected institution is ready to sync transactions. Liability details appear only when the institution provides them.':status.configured?'Connect a supported Canadian institution to import available transaction data.':'Manual CSV import is ready. Direct bank connection is not enabled for this account.';
    connect?.classList.toggle('hidden',!status.configured||status.connected);sync?.classList.toggle('hidden',!status.connected);disconnect?.classList.toggle('hidden',!status.connected);
    const panel=$('#bankLiabilitiesPanel'),list=$('#bankLiabilitiesList');
    const liabilities=status.connected?await api('/api/bank/liabilities'):[];
    if(panel)panel.classList.toggle('hidden',!liabilities.length);
    if(list)list.innerHTML=liabilities.map((row,index)=>`<article class="bank-liability-row"><div class="bank-liability-detail"><strong>${escapeHtml(row.account_name)}</strong><span>${escapeHtml(row.institution_name)} · ${escapeHtml(row.account_type||'Account')}</span><div class="bank-liability-values"><span>Balance: ${row.reported_balance==null?'Not provided':money(row.reported_balance)}</span><span>APR: ${row.reported_apr==null?'Not provided':`${Number(row.reported_apr).toFixed(2)}%`}</span><span>Minimum: ${row.reported_minimum==null?'Not provided':money(row.reported_minimum)}</span></div><span>Observed ${new Date(row.observed_at||Date.now()).toLocaleDateString('en-CA')}</span></div><div class="bank-liability-action"><label>Match to a tracked debt<select data-liability-select="${index}"><option value="">Choose a debt</option>${(STATE?.debts||[]).filter(d=>d.status==='active').map(d=>`<option value="${Number(d.id)}">${escapeHtml(d.name)}</option>`).join('')}</select></label><button type="button" class="secondary" data-liability-use="${index}">Review statement</button></div></article>`).join('');
    if(list)list.querySelectorAll('[data-liability-use]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.liabilityUse),row=liabilities[index],chosen=list.querySelector(`[data-liability-select="${index}"]`)?.value;if(!chosen){toast('Choose the tracked debt to compare with this account.');return;}$('#reconcileDebtId').value=chosen;if(row.reported_balance!=null)$('#reconcileBalance').value=Number(row.reported_balance).toFixed(2);if(row.reported_apr!=null)$('#reconcileApr').value=Number(row.reported_apr).toFixed(2);if(row.reported_minimum!=null)$('#reconcileMinimum').value=Number(row.reported_minimum).toFixed(2);if(row.next_due_date){$('#reconcileDate').value=String(row.next_due_date).slice(0,10);$('#reconcileDueDay').value=Number(String(row.next_due_date).slice(8,10));}$('#reconcileApplyChanges').checked=false;activateInsightsPanel('connections');$('#reconcileBalance').focus();toast('Review the imported account details before applying any updates.');}));
  }catch{title.textContent='Manual statement import';copy.textContent='Use CSV statements and lender reconciliation to keep your records current.';connect?.classList.add('hidden');sync?.classList.add('hidden');disconnect?.classList.add('hidden');}
}
async function initFinanceInsights() {
  const today=localIsoDate(),month=monthInputValue();
  for(const id of ['cashflowMonth','calendarMonth','reportMonth']){const input=$('#'+id);if(input&&!input.value)input.value=month;}
  if($('#cashTxnDate')&&!$('#cashTxnDate').value)$('#cashTxnDate').value=today;
  if($('#reconcileDate')&&!$('#reconcileDate').value)$('#reconcileDate').value=today;
  await Promise.all([loadFinanceTransactions().catch(()=>{}),renderSavedScenarios(),renderFinancialCalendar(),renderFinancialReport(),renderBankConnection()]);
  const debtSelect=$('#reconcileDebtId');if(debtSelect){const old=debtSelect.value;debtSelect.innerHTML='<option value="">Choose a debt</option>'+((STATE?.debts||[]).map(d=>`<option value="${Number(d.id)}">${escapeHtml(d.name)} (${money(d.balance)})</option>`).join(''));if(old)debtSelect.value=old;}
}
$('#cashTransactionForm')?.addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter||$('#cashTransactionForm button[type="submit"]');if(button)button.disabled=true;try{await api('/api/finance/transactions',{method:'POST',body:JSON.stringify({date:$('#cashTxnDate').value,type:$('#cashTxnType').value,description:$('#cashTxnDescription').value.trim(),category:$('#cashTxnCategory').value,amount:Number($('#cashTxnAmount').value),source:'manual'})});$('#cashTransactionForm').reset();$('#cashTxnDate').value=localIsoDate();await loadFinanceTransactions();await renderFinancialReport();toast('Transaction added.');}catch(error){toast(cleanCopy(error.message));}finally{if(button)button.disabled=false;}});
$('#cashflowMonth')?.addEventListener('change',()=>loadFinanceTransactions().catch(e=>toast(cleanCopy(e.message))));
$('#calendarMonth')?.addEventListener('change',()=>renderFinancialCalendar());
$('#reportMonth')?.addEventListener('change',()=>renderFinancialReport());
$('#financeScenarioForm')?.addEventListener('submit',async e=>{e.preventDefault();const button=$('#runScenarioBtn');button.disabled=true;try{const payload={name:$('#scenarioName').value.trim()||'My scenario',extra_monthly_payment:Number($('#scenarioExtraPayment').value||0),income_delta:Number($('#scenarioIncomeDelta').value||0),expense_delta:Number($('#scenarioExpenseDelta').value||0),unexpected_expense:Number($('#scenarioUnexpectedExpense').value||0),lump_sum_payment:Number($('#scenarioLumpSum').value||0),apr_delta:Number($('#scenarioAprDelta').value||0),save:false};lastFinanceScenario=await api('/api/finance/scenarios',{method:'POST',body:JSON.stringify(payload)});renderScenarioResult(lastFinanceScenario);$('#saveScenarioBtn').disabled=false;}catch(error){$('#financeScenarioResult').textContent=cleanCopy(error.message);$('#saveScenarioBtn').disabled=true;}finally{button.disabled=false;}});
$('#saveScenarioBtn')?.addEventListener('click',async()=>{if(!lastFinanceScenario)return;const button=$('#saveScenarioBtn');button.disabled=true;try{const payload={name:lastFinanceScenario.name,...(lastFinanceScenario.inputs||{}),save:true};const saved=await api('/api/finance/scenarios',{method:'POST',body:JSON.stringify(payload)});lastFinanceScenario=saved;await renderSavedScenarios();toast('Scenario saved.');}catch(error){toast(cleanCopy(error.message));}finally{button.disabled=false;}});
$('#transactionImportForm')?.addEventListener('submit',async e=>{e.preventDefault();const file=$('#transactionCsvFile')?.files?.[0],status=$('#transactionImportStatus'),button=e.submitter||$('#transactionImportForm button[type="submit"]');if(!file)return;if(button)button.disabled=true;if(status)status.textContent='';try{const rows=csvParse(await file.text());const result=await api('/api/finance/import',{method:'POST',body:JSON.stringify({rows})});if(status)status.textContent=`Imported ${result.imported} transactions; skipped ${result.skipped} duplicate or invalid rows.`;await Promise.all([loadFinanceTransactions(),renderFinancialReport()]);$('#transactionCsvFile').value='';toast('Statement imported.');}catch(error){if(status)status.textContent=cleanCopy(error.message);}finally{if(button)button.disabled=false;}});
$('#debtReconcileForm')?.addEventListener('submit',async e=>{e.preventDefault();const output=$('#debtReconciliationResults'),debtId=Number($('#reconcileDebtId').value);if(!debtId){output.textContent='Choose a debt to reconcile.';return;}const rows=[{debt_id:debtId,statement_balance:Number($('#reconcileBalance').value),statement_date:$('#reconcileDate').value,apr:$('#reconcileApr').value,minimum_payment:$('#reconcileMinimum').value,due_day:$('#reconcileDueDay').value}];try{const r=await api('/api/finance/reconcile-debts',{method:'POST',body:JSON.stringify({rows,apply_changes:$('#reconcileApplyChanges').checked})});output.innerHTML=r.results.map(x=>`<article class="reconciliation-row"><div><strong>${escapeHtml(x.name)}</strong><p>Tracked: ${money(x.tracked_balance)} · Statement: ${money(x.statement_balance)} · ${x.applied?'Statement values applied':'Review only'}</p></div><strong class="${x.variance>0?'positive-variance':''}">${x.variance>0?'+':''}${money(x.variance)}</strong></article>`).join('');if(r.applied)await load();toast(r.applied?'Statement reconciled and tracked debt updated.':'Statement comparison saved.');}catch(error){output.textContent=cleanCopy(error.message);}});
async function loadPlaidScript(){if(window.Plaid?.create)return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';script.onload=resolve;script.onerror=()=>reject(new Error('The secure bank connection could not be loaded.'));document.head.appendChild(script);});}
$('#bankConnectBtn')?.addEventListener('click',async()=>{const button=$('#bankConnectBtn'),status=$('#bankActionStatus');button.disabled=true;try{await loadPlaidScript();const token=await api('/api/bank/link-token',{method:'POST',body:JSON.stringify({})});const handler=window.Plaid.create({token:token.link_token,onSuccess:async(publicToken,metadata)=>{try{await api('/api/bank/exchange',{method:'POST',body:JSON.stringify({public_token:publicToken,institution_name:metadata?.institution?.name||'Canadian bank'})});status.textContent='Bank connected. Syncing available transactions.';await api('/api/bank/sync',{method:'POST',body:JSON.stringify({})});await initFinanceInsights();}catch(error){status.textContent=cleanCopy(error.message);}},onExit:()=>{button.disabled=false;}});handler.open();}catch(error){status.textContent=cleanCopy(error.message);button.disabled=false;}});
$('#bankSyncBtn')?.addEventListener('click',async()=>{const button=$('#bankSyncBtn'),status=$('#bankActionStatus');button.disabled=true;try{const r=await api('/api/bank/sync',{method:'POST',body:JSON.stringify({})});status.textContent=`Imported ${Number(r.imported||0)} transactions; ${Number(r.updated||0)} updated.`;await Promise.all([loadFinanceTransactions(),renderFinancialReport(),renderBankConnection()]);}catch(error){status.textContent=cleanCopy(error.message);}finally{button.disabled=false;}});
$('#bankDisconnectBtn')?.addEventListener('click',async()=>{if(!confirm('Disconnect the linked bank account? Existing imported transactions will remain in your plan.'))return;try{await api('/api/bank/disconnect',{method:'POST',body:JSON.stringify({})});await renderBankConnection();$('#bankActionStatus').textContent='Bank disconnected.';}catch(error){$('#bankActionStatus').textContent=cleanCopy(error.message);}});

const WALKTHROUGH_STEPS=[
  {section:'overview',title:'Overview',copy:'Review current debt, savings, and your on-time payment streak.'},
  {section:'plan',title:'Debt plan',copy:'Add debts, compare repayment strategies, and record payments you have made.'},
  {section:'savings',title:'Savings',copy:'Set savings goals, apply Smart Strategy to your budget, and track contributions.'},
  {section:'insights',title:'Insights',copy:'Track cash flow, compare repayment scenarios, import statements, and review your financial calendar.'},
  {section:'settings',title:'Settings',copy:'Choose your reminder tone, quiet hours, and budget rules.'},
  {section:'help',title:'Help',copy:'Find answers and reopen the walkthrough whenever you need it.'}
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
async function startWalkthrough(force=false){
  await (window.GlimPreferencesReady || Promise.resolve());
  if(!force && await window.GlimPreferences?.get('guideCompleted'))return;
  walkthroughReturnSection=activeSectionFromPath();walkthroughIndex=0;
  $('#walkthroughOverlay')?.classList.remove('hidden');
  if($('#walkthroughOverlay'))$('#walkthroughOverlay').setAttribute('aria-hidden','false');
  showWalkthroughStep();$('#walkthroughNextBtn')?.focus();
}
async function closeWalkthrough(){
  $('#walkthroughOverlay')?.classList.add('hidden');
  if($('#walkthroughOverlay'))$('#walkthroughOverlay').setAttribute('aria-hidden','true');
  try{await window.GlimPreferences?.set('guideCompleted',true)}catch{}
  activateSection(walkthroughReturnSection,{replace:true});
}
function maybeStartWalkthrough(){
  if(!$('#walkthroughOverlay')||!STATE||!profileIsReady(STATE.profile))return;
  if(!window.__glimGuideStarted){window.__glimGuideStarted=true;startWalkthrough();}
}
$$('[data-start-walkthrough]').forEach(button=>button.addEventListener('click',()=>startWalkthrough(true)));
window.addEventListener('glim-preferences-ready',()=>{if(STATE&&profileIsReady(STATE.profile))maybeStartWalkthrough();});
$('#walkthroughNextBtn')?.addEventListener('click',()=>{if(walkthroughIndex>=WALKTHROUGH_STEPS.length-1){closeWalkthrough();return}walkthroughIndex++;showWalkthroughStep()});
$('#walkthroughBackBtn')?.addEventListener('click',()=>{if(walkthroughIndex>0){walkthroughIndex--;showWalkthroughStep()}});
$('#walkthroughSkipBtn')?.addEventListener('click',closeWalkthrough);

if($('#recapMonth')) $('#recapMonth').value=new Date().toISOString().slice(0,7);
setIntegrationStatus();
load();
