(function () {
  const $ = (id) => document.getElementById(id);
  const LESSONS = {
    interest: {
      title: "Understand credit card interest",
      body: "APR is an annualized rate, but your card issuer may calculate interest daily and apply it according to your agreement. The balance used, transaction type, payment due date, and grace-period rules can all matter. A simple estimate such as balance × APR ÷ 12 can help with rough comparisons, but it is not an issuer quote.",
      bullets: ["Check the purchase APR and any separate cash-advance or promotional rates.", "Make at least the required minimum payment by the due date.", "If you can pay more, compare how an extra payment affects the estimated interest over time."]
    },
    strategies: {
      title: "Choose a repayment strategy",
      body: "Both methods start by protecting required minimum payments on all debts. Then you direct extra money to one target debt at a time.",
      bullets: ["Avalanche: target the highest APR first. This often minimizes interest when other factors are equal.", "Snowball: target the smallest balance first. A quicker payoff milestone may help some people stay engaged.", "Compare both with your own balances, APRs, and budget; neither makes an unaffordable budget safe."]
    },
    emergency: {
      title: "Start an emergency fund",
      body: "An emergency fund is cash reserved for unexpected expenses such as urgent travel, a repair, or a temporary income disruption. A reserve can help keep a surprise bill from becoming new high-interest debt.",
      bullets: ["Start with a small, meaningful milestone rather than a target that feels impossible.", "Keep required bills and debt minimums in the plan.", "Review the contribution when expenses, income, or debts change. The right size depends on your circumstances."]
    }
  };

  function openLesson(key) {
    const lesson = LESSONS[key]; const target = $("lesson-detail");
    if (!lesson || !target) return;
    target.hidden = false;
    target.innerHTML = `<h3>${lesson.title}</h3><p>${lesson.body}</p><ul>${lesson.bullets.map((bullet) => `<li>${bullet}</li>`).join("")}</ul><button type="button" class="button button-secondary" id="lesson-ask-coach">Ask the coach about this <span aria-hidden="true">→</span></button>`;
    $("lesson-ask-coach")?.addEventListener("click", () => {
      window.GlimApp.navigate("overview");
      const question = `Explain the following financial literacy topic and relate it to my Glim plan: ${lesson.title}.`;
      const field = $("coach-question"); if (field) { field.value = question; field.focus(); }
    });
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }

  function init() {
    document.querySelectorAll("[data-lesson]").forEach((button) => button.addEventListener("click", () => openLesson(button.dataset.lesson)));
    $("quiz-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const selected = document.querySelector('input[name="quiz-answer"]:checked');
      const feedback = $("quiz-feedback");
      if (!selected) {
        feedback.hidden = false; feedback.className = "quiz-feedback incorrect"; feedback.textContent = "Choose an answer first, then check your understanding."; return;
      }
      feedback.hidden = false;
      if (selected.value === "a") {
        feedback.className = "quiz-feedback correct";
        feedback.textContent = "That's right. APR is an annualized borrowing-cost rate. The actual interest charged depends on your account agreement, balances, transaction types, and payments.";
      } else {
        feedback.className = "quiz-feedback incorrect";
        feedback.textContent = "Not quite. APR is an annualized borrowing-cost rate. It does not set a required savings amount and does not determine the exact interest regardless of balance or payment timing.";
      }
    });
    $("start-assessment")?.addEventListener("click", () => { $("assessment-panel").hidden = false; $("assessment-panel").scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("close-assessment")?.addEventListener("click", () => { $("assessment-panel").hidden = true; });
    $("assessment-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const choices = [...document.querySelectorAll('input[name="assessment-topic"]:checked')].map((input) => input.value);
      const result = $("assessment-result");
      result.hidden = false;
      const mapping = { debt: "Understand and manage debt", savings: "Build savings consistently", credit: "Credit, interest, and borrowing", products: "Compare financial products carefully" };
      if (!choices.length) {
        result.textContent = "Choose at least one topic to create a learning focus."; return;
      }
      result.innerHTML = `<strong>Your learning focus</strong><p>${choices.map((choice) => mapping[choice]).join(" · ")}</p><p>Start with the lesson that most closely matches your next financial decision. You can revisit this check-in as your priorities change.</p>`;
    });
  }

  window.GlimLiteracy = { init, openLesson };
})();
