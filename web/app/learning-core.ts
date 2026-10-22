export type SkillTag = "Concept" | "Recall" | "Application" | "Misconception";
export type QuestionType = "mcq" | "tf" | "scenario" | "fix";

export type LearningQuestion = {
  id: string;
  type: QuestionType;
  skill: SkillTag;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type RevealCard = {
  term: string;
  story: string;
  meaning: string;
  example: string;
  commonMistake: string;
  relatedTerm: string;
};

export type TermMastery = {
  bestScore: number;
  attempts: number;
  lastScore: number;
  lastSeen: string;
  weakSkills: SkillTag[];
};

export type RevisitItem = {
  term: string;
  question: LearningQuestion;
  dueOn: string;
};

export type LearningProgress = {
  version: 2;
  xp: number;
  streakDays: number;
  lastActiveDate: string | null;
  terms: Record<string, TermMastery>;
  revisitQueue: RevisitItem[];
};

export type QuizGrade = {
  score: number;
  xpEarned: number;
  level: "Starter" | "Rising" | "Sharp" | "Master";
  weakSkills: SkillTag[];
  missed: LearningQuestion[];
};

export const PROGRESS_KEY = "lexi:v2";
export const EMPTY_PROGRESS: LearningProgress = {
  version: 2,
  xp: 0,
  streakDays: 0,
  lastActiveDate: null,
  terms: {},
  revisitQueue: [],
};

const SKILLS: readonly SkillTag[] = ["Concept", "Recall", "Application", "Misconception"];
const QUESTION_TYPES: readonly QuestionType[] = ["mcq", "tf", "scenario", "fix"];

function isQuestion(value: unknown): value is LearningQuestion {
  if (typeof value !== "object" || value === null) return false;
  const question = value as Partial<LearningQuestion>;
  const optionCount = 4;
  return Boolean(
    typeof question.id === "string" && QUESTION_TYPES.includes(question.type as QuestionType) &&
    SKILLS.includes(question.skill as SkillTag) && typeof question.prompt === "string" &&
    Array.isArray(question.options) && question.options.length === optionCount &&
    question.options.every((option) => typeof option === "string") &&
    Number.isInteger(question.correctIndex) && question.correctIndex! >= 0 && question.correctIndex! < optionCount &&
    typeof question.explanation === "string",
  );
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextDateKey(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  return dateKey(new Date(year, month - 1, day + 1));
}

export function getLevel(score: number): QuizGrade["level"] {
  if (score >= 4) return "Master";
  if (score === 3) return "Sharp";
  if (score === 2) return "Rising";
  return "Starter";
}

export function gradeQuiz(questions: LearningQuestion[], answers: Array<number | null>): QuizGrade {
  const missed = questions.filter((question, index) => answers[index] !== question.correctIndex);
  const score = questions.length - missed.length;
  const weakSkills = [...new Set(missed.map((question) => question.skill))];
  return { score, xpEarned: score * 25, level: getLevel(score), weakSkills, missed };
}

export function readProgress(raw: string | null): LearningProgress {
  if (!raw) return { ...EMPTY_PROGRESS, terms: {}, revisitQueue: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return { ...EMPTY_PROGRESS, terms: {}, revisitQueue: [] };
    const record = value as Partial<LearningProgress>;
    if (
      record.version !== 2 || !Number.isFinite(record.xp) || !Number.isFinite(record.streakDays) ||
      typeof record.terms !== "object" || record.terms === null || Array.isArray(record.terms) || !Array.isArray(record.revisitQueue)
    ) return { ...EMPTY_PROGRESS, terms: {}, revisitQueue: [] };
    const validTerms: Record<string, TermMastery> = {};
    for (const [term, item] of Object.entries(record.terms)) {
      if (
        typeof item === "object" && item !== null &&
        Number.isInteger(item.bestScore) && item.bestScore >= 0 && item.bestScore <= 4 &&
        Number.isInteger(item.attempts) && item.attempts >= 0 &&
        Number.isInteger(item.lastScore) && item.lastScore >= 0 && item.lastScore <= 4 &&
        typeof item.lastSeen === "string" && Array.isArray(item.weakSkills) &&
        item.weakSkills.every((skill) => SKILLS.includes(skill))
      ) validTerms[term] = item;
    }
    const validRevisits = record.revisitQueue.filter((item): item is RevisitItem =>
      typeof item === "object" && item !== null && typeof item.term === "string" &&
      typeof item.dueOn === "string" && isQuestion(item.question),
    );
    return {
      version: 2,
      xp: Math.max(0, Math.floor(record.xp ?? 0)),
      streakDays: Math.max(0, Math.floor(record.streakDays ?? 0)),
      lastActiveDate: typeof record.lastActiveDate === "string" ? record.lastActiveDate : null,
      terms: validTerms,
      revisitQueue: validRevisits,
    };
  } catch {
    return { ...EMPTY_PROGRESS, terms: {}, revisitQueue: [] };
  }
}

export function writeProgress(progress: LearningProgress): string {
  return JSON.stringify(progress);
}

function applyDailyActivity(progress: LearningProgress, today: string): Pick<LearningProgress, "streakDays" | "lastActiveDate"> {
  if (progress.lastActiveDate === today) return { streakDays: progress.streakDays, lastActiveDate: today };
  const prior = new Date(`${today}T12:00:00`);
  prior.setDate(prior.getDate() - 1);
  const previousDay = dateKey(prior);
  return {
    streakDays: progress.lastActiveDate === previousDay ? progress.streakDays + 1 : 1,
    lastActiveDate: today,
  };
}

export function recordQuizResult(
  progress: LearningProgress,
  term: string,
  grade: QuizGrade,
  today: string,
): LearningProgress {
  const existing = progress.terms[term] ?? { bestScore: 0, attempts: 0, lastScore: 0, lastSeen: today, weakSkills: [] };
  return {
    ...progress,
    ...applyDailyActivity(progress, today),
    xp: progress.xp + grade.xpEarned,
    terms: {
      ...progress.terms,
      [term]: {
        bestScore: Math.max(existing.bestScore, grade.score),
        attempts: existing.attempts + 1,
        lastScore: grade.score,
        lastSeen: today,
        weakSkills: grade.weakSkills,
      },
    },
  };
}

export function saveRevisit(
  progress: LearningProgress,
  term: string,
  questions: LearningQuestion[],
  answers: Array<number | null>,
  today: string,
): LearningProgress {
  const index = questions.findIndex((question, questionIndex) => answers[questionIndex] !== question.correctIndex);
  const question = questions[index < 0 ? Math.min(2, questions.length - 1) : index];
  if (!question) return progress;
  return {
    ...progress,
    revisitQueue: [
      ...progress.revisitQueue.filter((item) => item.term !== term),
      { term, question, dueOn: nextDateKey(today) },
    ],
  };
}

export function recordRevisitAnswer(
  progress: LearningProgress,
  item: RevisitItem,
  correct: boolean,
  today: string,
): LearningProgress {
  const previous = progress.terms[item.term] ?? { bestScore: 0, attempts: 0, lastScore: 0, lastSeen: today, weakSkills: [] };
  const weakSkills = correct
    ? previous.weakSkills.filter((skill) => skill !== item.question.skill)
    : [...new Set([...previous.weakSkills, item.question.skill])];
  return {
    ...progress,
    ...applyDailyActivity(progress, today),
    xp: progress.xp + (correct ? 25 : 0),
    terms: {
      ...progress.terms,
      [item.term]: {
        ...previous,
        bestScore: Math.max(previous.bestScore, correct ? 1 : 0),
        attempts: previous.attempts + 1,
        lastScore: correct ? 1 : 0,
        lastSeen: today,
        weakSkills,
      },
    },
    revisitQueue: progress.revisitQueue.filter((queued) => queued.term !== item.term),
  };
}

export function dueRevisits(progress: LearningProgress, today: string): RevisitItem[] {
  return progress.revisitQueue.filter((item) => item.dueOn <= today);
}

export function resolveGlossaryTerm(query: string, terms: string[]): string | null {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    rag: "retrieval augmented generation",
    agi: "artificial general intelligence",
    genai: "generative ai",
    llm: "large language model",
    llms: "large language model",
    ml: "machine learning",
    ai: "artificial intelligence",
    "neural networks": "neural network",
  };
  const stripQuestion = (value: string) => normalize(value
    .replace(/^(?:please\s+)?(?:what is|what does|explain|define|tell me about)\s+/i, "")
    .replace(/\s+(?:in simple terms|simply|mean)\??$/i, ""));
  const queryKey = stripQuestion(query);
  if (!queryKey || queryKey.split(" ").length > 8) return null;
  const candidates = [queryKey, aliases[queryKey]].filter((value): value is string => Boolean(value));
  for (const term of terms) {
    const termKey = normalize(term);
    const shortKey = normalize(term.split("(")[0] ?? term);
    if (candidates.some((candidate) => candidate === termKey || candidate === shortKey)) return term;
  }
  return null;
}

export function masteryFor(progress: LearningProgress, term: string): "none" | "learning" | "mastered" {
  const mastery = progress.terms[term];
  if (!mastery) return "none";
  return mastery.bestScore >= 3 ? "mastered" : "learning";
}

export function validQuestionSet(value: unknown): value is { questions: LearningQuestion[] } {
  if (typeof value !== "object" || value === null || !("questions" in value)) return false;
  const questions = (value as { questions: unknown }).questions;
  if (!Array.isArray(questions) || questions.length !== 4) return false;
  const expectedTypes: QuestionType[] = ["mcq", "tf", "scenario", "fix"];
  const expectedSkills: SkillTag[] = ["Concept", "Recall", "Application", "Misconception"];
  return questions.every((question, index) => {
    return isQuestion(question) && question.type === expectedTypes[index] && question.skill === expectedSkills[index];
  });
}
