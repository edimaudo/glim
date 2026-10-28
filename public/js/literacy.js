(function () {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const LEVELS = {
    novice: { label: "Beginner", description: "Start with the building blocks: budgets, credit, interest, and emergency savings." },
    intermediate: { label: "Intermediate", description: "Strengthen how you compare credit, registered accounts, borrowing costs, and financial trade-offs." },
    advanced: { label: "Advanced", description: "Practice comparing more complex concepts, account rules, diversification, and risk." },
  };

  const ASSESSMENT_QUESTIONS = [
    { question: "What is the main purpose of an emergency fund?", options: ["To invest in high-risk opportunities", "To cover unexpected costs without relying immediately on new debt", "To replace every type of insurance", "To guarantee investment returns"], correct: 1, explanation: "An emergency fund is cash set aside for unexpected expenses or a disruption in income." },
    { question: "What does a credit card APR describe?", options: ["The annualized borrowing rate", "The required savings amount", "The amount of a credit limit you have used", "The exact fee charged on every purchase"], correct: 0, explanation: "APR is an annualized rate. The actual interest charged depends on the balance, transactions, payment timing, and card agreement." },
    { question: "What is compound interest?", options: ["Interest charged only once", "A fee for opening a bank account", "Interest earned or charged on principal and previously accumulated interest", "A government tax rate"], correct: 2, explanation: "With compounding, interest can accumulate on both the original amount and prior interest." },
    { question: "Which statement about a Canadian TFSA is generally correct?", options: ["All withdrawals are taxable income", "Eligible investment growth and withdrawals are generally tax-free", "It can only hold cash", "It guarantees that investments cannot lose value"], correct: 1, explanation: "Eligible TFSA investment income and withdrawals are generally tax-free. Contribution room and investment risks still matter." },
    { question: "What is a sensible way to think about investment risk and return?", options: ["Higher risk always guarantees higher returns", "Risk can be ignored over long periods", "Diversification removes all investment risk", "Higher potential returns usually involve higher risk, and returns are not guaranteed"], correct: 3, explanation: "Risk and potential return are related, but higher returns are never guaranteed. Diversification can reduce some risks, not eliminate them." },
  ];

  const PRACTICE_QUIZZES = {
    novice: [
      { q: "Why is paying at least the minimum amount on a credit card important?", options: ["It always clears the full balance", "It helps avoid missing the required payment, although interest may still accrue", "It removes the APR", "It increases savings automatically"], correct: 1, explanation: "A minimum payment helps keep the account current when paid on time, but it usually does not clear the balance and interest may continue." },
      { q: "Which expense is an emergency fund meant to help with?", options: ["A planned monthly subscription", "An unexpected car repair", "A routine grocery trip", "A purchase you have already budgeted for"], correct: 1, explanation: "An emergency reserve is for unplanned, necessary expenses or income disruptions." },
      { q: "What is a budget used for?", options: ["Tracking income and spending to make choices", "Guaranteeing that income increases", "Removing all financial risk", "Calculating a credit score exactly"], correct: 0, explanation: "A budget compares money coming in with planned and actual spending, helping you make informed trade-offs." },
      { q: "What does an interest rate tell you?", options: ["The colour of a bank card", "The rate at which borrowing costs or savings returns are calculated", "Your total monthly income", "The exact amount of every future bill"], correct: 1, explanation: "An interest rate is applied to a balance under the account's terms. Fees and timing can also affect the total cost or return." },
      { q: "If your savings goal feels unaffordable this month, what is a reasonable response?", options: ["Borrow at any rate to meet it", "Ignore essential bills", "Review the contribution and adjust it to fit essentials and required payments", "Assume the goal has failed permanently"], correct: 2, explanation: "Savings targets can be adjusted. Essential expenses and required debt payments should be considered before setting optional contributions." },
    ],
    intermediate: [
      { q: "When does the debt avalanche method prioritize a balance?", options: ["When its APR is highest", "When its name is shortest", "When it has no minimum payment", "Only after every other balance is paid"], correct: 0, explanation: "Avalanche prioritizes the highest interest rate after minimums are covered on all debts; it often reduces interest when other factors are equal." },
      { q: "What can credit utilization help describe?", options: ["Savings growth", "The balance used relative to available revolving credit", "The number of bank branches", "A guaranteed loan approval"], correct: 1, explanation: "Utilization compares revolving balances with credit limits. It can be one factor considered in credit scoring, but scoring models vary." },
      { q: "What is an important TFSA contribution-room consideration?", options: ["Withdrawals never affect future room", "Withdrawn amounts are generally added back to contribution room in the next calendar year", "Every TFSA investment is guaranteed", "TFSA room depends only on income"], correct: 1, explanation: "A TFSA withdrawal is generally added back to contribution room on January 1 of the following calendar year. Check your CRA records before contributing to avoid overcontribution." },
      { q: "Why compare total borrowing cost rather than only a promotional rate?", options: ["Fees and the rate after a promotion can change the total cost", "A promotion always lasts for the full loan", "Annual fees never matter", "The lowest advertised rate is always the cheapest option"], correct: 0, explanation: "Fees, promotional duration, post-promotion rates, payment schedules, and eligibility can affect the overall cost." },
      { q: "Why can diversification help an investment portfolio?", options: ["It guarantees gains", "It spreads exposure across different investments and can reduce some concentration risk", "It eliminates market risk", "It guarantees a fixed return"], correct: 1, explanation: "Diversification can reduce concentration risk, but it cannot eliminate market losses or guarantee a return." },
    ],
    advanced: [
      { q: "How are RRSP contributions generally treated for Canadian income tax?", options: ["They are always taxed twice", "Eligible contributions can reduce taxable income, with tax generally applying to withdrawals", "Contributions guarantee a refund equal to the amount contributed", "RRSPs cannot hold investments"], correct: 1, explanation: "Eligible RRSP contributions can generally deduct from taxable income within available limits. Withdrawals are generally taxable, and the actual tax impact depends on individual circumstances." },
      { q: "What is a key difference between a fixed and variable borrowing rate?", options: ["A fixed rate never has any conditions", "A variable rate can change with its reference rate, affecting interest costs", "A variable rate is always lower", "A fixed rate removes the need to make payments"], correct: 1, explanation: "Variable rates can rise or fall with the terms of the product, changing borrowing costs. Product details determine how changes apply." },
      { q: "What does a GIC typically offer?", options: ["Guaranteed stock-market returns", "A deposit held for agreed terms, often with a stated rate, subject to product conditions", "Unlimited instant access without any conditions", "Automatic exemption from every tax"], correct: 1, explanation: "A Guaranteed Investment Certificate has defined terms and conditions. Early redemption, rate, and deposit-insurance eligibility vary by product and institution." },
      { q: "Which statement about diversification is most accurate?", options: ["It removes every type of risk", "It can reduce specific or concentration risk but cannot eliminate market-wide risk", "It means owning only one broad-market stock", "It guarantees positive returns"], correct: 1, explanation: "Diversification can spread exposure but cannot prevent losses caused by broader market movements or all other risks." },
      { q: "When comparing two savings products with different rates and fees, what is most useful?", options: ["Pick whichever has the largest headline rate", "Compare projected net returns over the same balance and time period, including applicable fees and conditions", "Ignore minimum balances", "Assume every promotional rate is permanent"], correct: 1, explanation: "A fair comparison uses the same balance and period and includes fees, eligibility, promotional duration, and other relevant terms." },
    ],
  };

  const GLOSSARY = [
    { term: "APR", category: "borrowing", definition: "Annual percentage rate: an annualized measure of borrowing cost. The actual amount charged depends on balances, transactions, payments, fees, and the agreement." },
    { term: "Amortization", category: "borrowing", definition: "The process of paying down a loan through scheduled payments over time. Each payment may cover interest and principal." },
    { term: "Credit utilization", category: "borrowing", definition: "The amount of revolving credit used relative to the available limit. It can affect credit scores, depending on the scoring model." },
    { term: "Debt avalanche", category: "borrowing", definition: "A repayment approach that covers all required minimums, then directs extra money to the debt with the highest interest rate." },
    { term: "Debt snowball", category: "borrowing", definition: "A repayment approach that covers all required minimums, then directs extra money to the smallest balance first." },
    { term: "Minimum payment", category: "borrowing", definition: "The minimum amount the lender requires for a billing period. Paying only this amount can leave the balance accruing interest for a long time." },
    { term: "Line of credit", category: "borrowing", definition: "A borrowing facility that lets an eligible customer draw funds up to a limit and pay interest on the amount borrowed, subject to its terms." },
    { term: "Emergency fund", category: "saving", definition: "Money set aside for unexpected necessary costs or income interruptions, helping reduce the need to borrow when a surprise occurs." },
    { term: "Compound interest", category: "saving", definition: "Interest calculated on the original amount and previously accumulated interest. Compounding can increase savings growth or borrowing costs over time." },
    { term: "High-interest savings account", category: "saving", definition: "A deposit account that pays interest on a balance. Rates, fees, withdrawal conditions, and promotional periods can vary." },
    { term: "TFSA", category: "canada", definition: "Tax-Free Savings Account. Eligible investment income and withdrawals are generally tax-free. Contribution room and overcontribution rules apply." },
    { term: "RRSP", category: "canada", definition: "Registered Retirement Savings Plan. Eligible contributions can generally reduce taxable income, while withdrawals are generally taxable." },
    { term: "FHSA", category: "canada", definition: "First Home Savings Account, a registered account for eligible first-home buyers, subject to annual and lifetime limits and qualifying withdrawal rules." },
    { term: "GIC", category: "canada", definition: "Guaranteed Investment Certificate. A deposit held under stated terms, often for a set period. Rates, redemption options, and deposit-insurance eligibility vary." },
    { term: "Credit score", category: "borrowing", definition: "A score generated from credit-report information using a scoring model. Lenders may use it alongside other information when assessing applications." },
    { term: "Principal", category: "borrowing", definition: "The amount originally borrowed or the remaining amount on which interest is calculated, before applicable interest and fees." },
    { term: "Diversification", category: "investing", definition: "Spreading investments across assets or exposures to reduce concentration risk. It does not eliminate all investment risk or guarantee returns." },
    { term: "Risk tolerance", category: "investing", definition: "An investor's ability and willingness to withstand fluctuations or losses. It is one factor when making investment decisions." },
    { term: "Management expense ratio (MER)", category: "investing", definition: "An annual percentage representing certain operating expenses of a fund, generally reflected in the fund's returns rather than billed separately." },
    { term: "Net return", category: "investing", definition: "The return remaining after relevant expenses, fees, and other costs have been considered over a specified period." },
  ];

  let assessmentIndex = 0;
  let assessmentAnswers = [];
  let activeQuizLevel = "novice";

  function openPanel(id) {
    const panel = $(id);
    if (!panel) return;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function renderAssessmentQuestion() {
    const item = ASSESSMENT_QUESTIONS[assessmentIndex];
    const container = $("assessment-question-container");
    if (!container || !item) return;
    if ($("assessment-progress")) $("assessment-progress").textContent = `Question ${assessmentIndex + 1} of ${ASSESSMENT_QUESTIONS.length}`;
    if ($("assessment-progress-fill")) $("assessment-progress-fill").style.width = `${((assessmentIndex + 1) / ASSESSMENT_QUESTIONS.length) * 100}%`;
    container.innerHTML = `<fieldset><legend>${escapeHtml(item.question)}</legend><div class="assessment-options">${item.options.map((option, index) => `<label class="assessment-option"><input type="radio" name="assessment-answer" value="${index}" ${assessmentAnswers[assessmentIndex] === index ? "checked" : ""}><span>${escapeHtml(option)}</span></label>`).join("")}</div></fieldset>`;
    const hasAnswer = Number.isInteger(assessmentAnswers[assessmentIndex]);
    if ($("assessment-previous")) $("assessment-previous").disabled = assessmentIndex === 0;
    if ($("assessment-next")) { $("assessment-next").hidden = assessmentIndex === ASSESSMENT_QUESTIONS.length - 1; $("assessment-next").disabled = !hasAnswer; }
    if ($("assessment-submit")) { $("assessment-submit").hidden = assessmentIndex !== ASSESSMENT_QUESTIONS.length - 1; $("assessment-submit").disabled = !hasAnswer; }
  }

  function startAssessment() {
    assessmentIndex = 0;
    assessmentAnswers = [];
    $("assessment-result").hidden = true;
    renderAssessmentQuestion();
    openPanel("assessment-panel");
  }

  function submitAssessment(event) {
    event.preventDefault();
    if (ASSESSMENT_QUESTIONS.some((_, index) => !Number.isInteger(assessmentAnswers[index]))) {
      window.GlimApp.toast("Answer each question to see your result.");
      return;
    }
    const score = assessmentAnswers.reduce((sum, answer, index) => sum + (answer === ASSESSMENT_QUESTIONS[index].correct ? 1 : 0), 0);
    const level = score <= 1 ? "novice" : score <= 3 ? "intermediate" : "advanced";
    const state = window.GlimApp.state;
    state.literacyLevel = level;
    state.literacyAssessmentScore = score;
    state.literacyAssessmentAt = new Date().toISOString();
    const selectedLevel = $("quiz-level"); if (selectedLevel) selectedLevel.value = level;
    const info = LEVELS[level];
    const result = $("assessment-result");
    result.hidden = false;
    result.innerHTML = `<div class="assessment-result-header"><span class="assessment-result-score">${score}/${ASSESSMENT_QUESTIONS.length}</span><div><h3>${info.label} learner</h3><p>${escapeHtml(info.description)}</p></div></div><p>Your level sets a starting point for the practice quiz. It is a learning guide, not a judgment of your financial decisions.</p><button type="button" id="assessment-start-quiz" class="button button-primary">Practice at this level</button>`;
    $("literacy-level-label").textContent = `${info.label} learner · ${score}/5`;
    result.querySelector("#assessment-start-quiz")?.addEventListener("click", () => startPracticeQuiz(level));
    window.GlimApp.saveState().catch(() => window.GlimApp.toast("Your assessment result could not be saved. Please try again."));
  }

  function renderPracticeQuiz(level) {
    activeQuizLevel = LEVELS[level] ? level : "novice";
    const questions = PRACTICE_QUIZZES[activeQuizLevel];
    const container = $("practice-quiz-content");
    if (!container) return;
    $("practice-quiz-description").textContent = `${LEVELS[activeQuizLevel].label} level · ${questions.length} questions with explanations.`;
    container.innerHTML = `<form id="practice-quiz-form" class="practice-quiz-form">${questions.map((item, index) => `<fieldset class="practice-question"><legend><span>Question ${index + 1}</span>${escapeHtml(item.q)}</legend><div class="assessment-options">${item.options.map((option, optionIndex) => `<label class="assessment-option"><input type="radio" name="practice-answer-${index}" value="${optionIndex}"><span>${escapeHtml(option)}</span></label>`).join("")}</div></fieldset>`).join("")}<button type="submit" class="button button-primary">Check answers</button></form>`;
    $("practice-quiz-result").hidden = true;
    container.querySelector("form")?.addEventListener("submit", submitPracticeQuiz);
  }

  function submitPracticeQuiz(event) {
    event.preventDefault();
    const questions = PRACTICE_QUIZZES[activeQuizLevel];
    const answers = questions.map((_, index) => {
      const selected = document.querySelector(`input[name="practice-answer-${index}"]:checked`);
      return selected ? Number(selected.value) : null;
    });
    if (answers.some((answer) => answer === null)) {
      window.GlimApp.toast("Answer each question before checking your quiz.");
      return;
    }
    const correct = answers.reduce((sum, answer, index) => sum + (answer === questions[index].correct ? 1 : 0), 0);
    const result = $("practice-quiz-result");
    result.hidden = false;
    result.innerHTML = `<div class="assessment-result-header"><span class="assessment-result-score">${correct}/${questions.length}</span><div><h3>${correct === questions.length ? "Excellent work" : correct >= 3 ? "Good progress" : "Keep building your knowledge"}</h3><p>${Math.round(correct / questions.length * 100)}% correct · ${LEVELS[activeQuizLevel].label} level</p></div></div><div class="quiz-explanations">${questions.map((item, index) => `<article class="quiz-explanation"><strong>${index + 1}. ${answers[index] === item.correct ? "Correct" : "Review this concept"}: ${escapeHtml(item.q)}</strong><p>${escapeHtml(item.explanation)}</p></article>`).join("")}</div><button type="button" id="retry-practice-quiz" class="button button-secondary">Try another attempt</button>`;
    const state = window.GlimApp.state;
    state.quizAttempts = Number(state.quizAttempts || 0) + 1;
    state.quizLastScore = correct;
    state.quizLastLevel = activeQuizLevel;
    state.quizBestScore = Math.max(Number(state.quizBestScore || 0), correct);
    state.quizHistory = [...(state.quizHistory || []), { level: activeQuizLevel, score: correct, total: questions.length, completed_at: new Date().toISOString() }].slice(-20);
    result.querySelector("#retry-practice-quiz")?.addEventListener("click", () => renderPracticeQuiz(activeQuizLevel));
    window.GlimApp.saveState().catch(() => window.GlimApp.toast("Your quiz result could not be saved. Please try again."));
  }

  function startPracticeQuiz(level) {
    const selectedLevel = $("quiz-level")?.value || level || window.GlimApp?.state?.literacyLevel || "novice";
    renderPracticeQuiz(selectedLevel);
    openPanel("practice-quiz-panel");
  }

  function renderGlossary() {
    const container = $("glossary-results");
    if (!container) return;
    const query = ($("glossary-search")?.value || "").trim().toLowerCase();
    const activeFilter = document.querySelector("[data-glossary-filter].is-active")?.dataset.glossaryFilter || "all";
    const filtered = GLOSSARY.filter((item) => (activeFilter === "all" || item.category === activeFilter) && (!query || `${item.term} ${item.definition}`.toLowerCase().includes(query)));
    $("glossary-term-count").textContent = `${filtered.length} ${filtered.length === 1 ? "term" : "terms"}`;
    if (!filtered.length) {
      container.innerHTML = '<p class="glossary-empty">No matching terms. Try another search or topic.</p>';
      return;
    }
    container.innerHTML = filtered.map((item) => `<article class="glossary-term"><div><h3>${escapeHtml(item.term)}</h3><span class="glossary-category">${escapeHtml(item.category === "canada" ? "Canadian accounts" : item.category.charAt(0).toUpperCase() + item.category.slice(1))}</span></div><p>${escapeHtml(item.definition)}</p></article>`).join("");
  }

  function init() {
    const state = window.GlimApp?.state || {};
    const levelLabel = $("literacy-level-label");
    const quizLevel = $("quiz-level");
    if (state.literacyLevel && LEVELS[state.literacyLevel]) {
      if (levelLabel) levelLabel.textContent = `${LEVELS[state.literacyLevel].label} learner · ${Number(state.literacyAssessmentScore ?? 0)}/5`;
      if (quizLevel) quizLevel.value = state.literacyLevel;
    }
    $("start-assessment")?.addEventListener("click", startAssessment);
    $("close-assessment")?.addEventListener("click", () => { $("assessment-panel").hidden = true; });
    $("assessment-question-container")?.addEventListener("change", (event) => {
      const answer = event.target.closest('input[name="assessment-answer"]');
      if (!answer) return;
      assessmentAnswers[assessmentIndex] = Number(answer.value);
      if ($("assessment-next")) $("assessment-next").disabled = false;
      if ($("assessment-submit")) $("assessment-submit").disabled = false;
    });
    $("assessment-previous")?.addEventListener("click", () => { if (assessmentIndex > 0) assessmentIndex--; renderAssessmentQuestion(); });
    $("assessment-next")?.addEventListener("click", () => { if (assessmentIndex < ASSESSMENT_QUESTIONS.length - 1) assessmentIndex++; renderAssessmentQuestion(); });
    $("assessment-form")?.addEventListener("submit", submitAssessment);
    $("start-practice-quiz")?.addEventListener("click", () => startPracticeQuiz());
    $("close-practice-quiz")?.addEventListener("click", () => { $("practice-quiz-panel").hidden = true; });
    $("glossary-search")?.addEventListener("input", renderGlossary);
    document.querySelectorAll("[data-glossary-filter]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-glossary-filter]").forEach((item) => { item.classList.toggle("is-active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
      renderGlossary();
    }));
    document.querySelectorAll("[data-focus-glossary]").forEach((button) => button.addEventListener("click", () => { $("glossary-search")?.focus(); $("glossary-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    renderGlossary();
  }

  window.GlimLiteracy = { init, startAssessment, startPracticeQuiz };
})();
