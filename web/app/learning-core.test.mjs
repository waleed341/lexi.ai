import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PROGRESS,
  PROGRESS_KEY,
  dueRevisits,
  getLevel,
  gradeQuiz,
  masteryFor,
  nextDateKey,
  readProgress,
  recordQuizResult,
  resolveGlossaryTerm,
  saveRevisit,
  validQuestionSet,
  writeProgress,
} from "./learning-core.ts";

const questions = [
  { id: "q1", type: "mcq", skill: "Concept", prompt: "Choose the meaning.", options: ["Right", "No", "No", "No"], correctIndex: 0, explanation: "This is the definition." },
  { id: "q2", type: "tf", skill: "Recall", prompt: "Which statement is accurate?", options: ["True: the stated concept applies.", "False: unrelated claim.", "True: a conflicting claim.", "False: another unrelated claim."], correctIndex: 0, explanation: "The statement matches the concept." },
  { id: "q3", type: "scenario", skill: "Application", prompt: "Which idea helps here?", options: ["Right", "No", "No", "No"], correctIndex: 0, explanation: "It fits the problem." },
  { id: "q4", type: "fix", skill: "Misconception", prompt: "Fix this incorrect explanation.", options: ["Right", "No", "No", "No"], correctIndex: 0, explanation: "This corrects the mistake." },
];

test("gradeQuiz covers all score and level outcomes with 25 XP per correct answer", () => {
  const levels = ["Starter", "Starter", "Rising", "Sharp", "Master"];
  for (let score = 0; score <= 4; score += 1) {
    const answers = questions.map((question, index) => (index < score ? question.correctIndex : -1));
    const grade = gradeQuiz(questions, answers);
    assert.equal(grade.score, score);
    assert.equal(grade.xpEarned, score * 25);
    assert.equal(grade.level, levels[score]);
    assert.equal(grade.missed.length, 4 - score);
  }
});

test("gradeQuiz reports only the weak skill tags from missed answers", () => {
  const grade = gradeQuiz(questions, [0, -1, 0, -1]);
  assert.deepEqual(grade.weakSkills, ["Recall", "Misconception"]);
});

test("XP level names follow the requested score thresholds", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(getLevel), ["Starter", "Starter", "Rising", "Sharp", "Master"]);
});

test("progress storage round trips and malformed or old values reset safely", () => {
  const progress = { ...EMPTY_PROGRESS, xp: 75, streakDays: 2 };
  assert.equal(readProgress(writeProgress(progress)).xp, 75);
  assert.equal(readProgress("not-json").xp, 0);
  assert.equal(readProgress(JSON.stringify({ version: 1 })).version, 2);
  assert.equal(PROGRESS_KEY, "lexi:v2");
});

test("records XP, streak and mastery and queues the first missed item for tomorrow", () => {
  let progress = { ...EMPTY_PROGRESS, lastActiveDate: "2026-10-21", streakDays: 2, terms: {}, revisitQueue: [] };
  const grade = gradeQuiz(questions, [0, 0, -1, 0]);
  progress = recordQuizResult(progress, "Neural network", grade, "2026-10-22");
  progress = saveRevisit(progress, "Neural network", questions, [0, 0, -1, 0], "2026-10-22");
  assert.equal(progress.xp, 75);
  assert.equal(progress.streakDays, 3);
  assert.equal(progress.terms["Neural network"].attempts, 1);
  assert.equal(masteryFor(progress, "Neural network"), "mastered");
  assert.equal(dueRevisits(progress, "2026-10-22").length, 0);
  assert.equal(dueRevisits(progress, "2026-10-23")[0].question.id, "q3");
  assert.equal(nextDateKey("2026-10-22"), "2026-10-23");
});

test("quiz schema accepts exactly the required four question types", () => {
  assert.equal(validQuestionSet({ questions }), true);
  assert.equal(validQuestionSet({ questions: questions.slice(0, 3) }), false);
  assert.equal(validQuestionSet({ questions: [{ ...questions[0], type: "tf" }, ...questions.slice(1)] }), false);
  assert.equal(validQuestionSet({ questions: [{ ...questions[1], options: ["True"], correctIndex: 1 }, ...questions.slice(1)] }), false);
});

test("term matching starts a loop for glossary prompts and leaves broad questions alone", () => {
  const terms = ["Generative AI (GenAI)", "Neural network", "Retrieval-augmented generation (RAG)"];
  assert.equal(resolveGlossaryTerm("What is generative AI?", terms), terms[0]);
  assert.equal(resolveGlossaryTerm("Explain neural networks simply", terms), terms[1]);
  assert.equal(resolveGlossaryTerm("What does RAG mean?", terms), terms[2]);
  assert.equal(resolveGlossaryTerm("How can I use RAG with my own files?", terms), null);
});
