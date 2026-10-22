"use client";

import { CSSProperties, Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  gradeQuiz,
  LearningProgress,
  LearningQuestion,
  recordQuizResult,
  recordRevisitAnswer,
  RevisitItem,
  RevealCard,
  saveRevisit,
  validQuestionSet,
} from "./learning-core";

type Stage = "answer-loading" | "reveal-loading" | "reveal" | "quiz-loading" | "quiz" | "grade" | "revisit" | "error";

type LearningExperienceProps = {
  term: string;
  query: string;
  apiUrl: string;
  progress: LearningProgress;
  relatedTerms: string[];
  revisitItem?: RevisitItem;
  onClose: () => void;
  onNextTerm: (term: string) => void;
  onProgress: (progress: LearningProgress) => void;
  onRevisitDone: (progress: LearningProgress) => void;
};

function isReveal(value: unknown): value is RevealCard {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<RevealCard>;
  return [item.term, item.story, item.meaning, item.example, item.commonMistake, item.relatedTerm]
    .every((field) => typeof field === "string");
}

function renderAnswer(content: string) {
  return content.split("\n").map((line, lineIndex) => (
    <Fragment key={`answer-line-${lineIndex}`}>
      {lineIndex > 0 && <br />}
      {line.split(/(\*\*.*?\*\*|`[^`]+`)/g).filter(Boolean).map((part, partIndex) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={`answer-part-${lineIndex}-${partIndex}`}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={`answer-part-${lineIndex}-${partIndex}`}>{part.slice(1, -1)}</code>;
        }
        return <Fragment key={`answer-part-${lineIndex}-${partIndex}`}>{part}</Fragment>;
      })}
    </Fragment>
  ));
}

export default function LearningExperience({
  term, query, apiUrl, progress, relatedTerms, revisitItem, onClose, onNextTerm, onProgress, onRevisitDone,
}: LearningExperienceProps) {
  const [stage, setStage] = useState<Stage>(revisitItem ? "revisit" : "answer-loading");
  const [answerText, setAnswerText] = useState("");
  const [reveal, setReveal] = useState<RevealCard | null>(null);
  const [questions, setQuestions] = useState<LearningQuestion[]>([]);
  const [answers, setAnswers] = useState<Array<number | null>>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [error, setError] = useState("");
  const [failedTask, setFailedTask] = useState<"answer" | "reveal" | "quiz">("answer");
  const [showFixes, setShowFixes] = useState(false);
  const [revisitAnswer, setRevisitAnswer] = useState<number | null>(null);
  const busyRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (revisitItem || startedRef.current) return;
    startedRef.current = true;
    void requestAnswer();
    // The component is keyed by the selected term and original query, so run this once per learning session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisitItem]);

  const question = questions[questionIndex];
  const answer = answers[questionIndex];
  const isAnswered = answer !== null && answer !== undefined;
  const isCorrect = isAnswered && answer === question?.correctIndex;
  const grade = gradeQuiz(questions, answers);

  async function requestAnswer() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError("");
    setFailedTask("answer");
    setStage("answer-loading");
    try {
      const answerResponse = await fetch(`${apiUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const answerPayload: unknown = await answerResponse.json().catch(() => null);
      if (!answerResponse.ok || typeof answerPayload !== "object" || answerPayload === null || !("answer" in answerPayload) || typeof answerPayload.answer !== "string" || !answerPayload.answer.trim()) {
        const detail = typeof answerPayload === "object" && answerPayload !== null && "detail" in answerPayload && typeof answerPayload.detail === "string"
          ? answerPayload.detail : "Could not get an answer. Please try again.";
        throw new Error(detail);
      }
      const generatedAnswer = answerPayload.answer.trim();
      setAnswerText(generatedAnswer);
      setStage("reveal-loading");
      await requestReveal(generatedAnswer);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Connection issue. Please try again.");
      setStage("error");
    } finally {
      busyRef.current = false;
    }
  }

  async function requestReveal(contextAnswer: string) {
    setFailedTask("reveal");
    setStage("reveal-loading");
    try {
      const response = await fetch(`${apiUrl}/learning/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, query, answer: contextAnswer }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = typeof payload === "object" && payload !== null && "detail" in payload && typeof payload.detail === "string"
          ? payload.detail : "Could not prepare this learning card. Please try again.";
        throw new Error(detail);
      }
      if (!isReveal(payload)) throw new Error("The learning card was incomplete. Please try again.");
      setReveal(payload);
      setStage("reveal");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Connection issue. Please try again.");
      setStage("error");
    }
  }

  async function requestQuiz() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError("");
    setFailedTask("quiz");
    setStage("quiz-loading");
    try {
      const response = await fetch(`${apiUrl}/learning/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, query, answer: answerText }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = typeof payload === "object" && payload !== null && "detail" in payload && typeof payload.detail === "string"
          ? payload.detail : "Could not prepare the challenge. Please try again.";
        throw new Error(detail);
      }
      if (!validQuestionSet(payload)) throw new Error("The challenge was incomplete. Please try again.");
      setQuestions(payload.questions);
      setAnswers(Array.from({ length: 4 }, () => null));
      setQuestionIndex(0);
      setStage("quiz");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Connection issue. Please try again.");
      setStage("error");
    } finally {
      busyRef.current = false;
    }
  }

  const chooseAnswer = useCallback((index: number) => {
    if (stage !== "quiz" || !question || isAnswered || index < 0 || index >= question.options.length) return;
    setAnswers((current) => current.map((item, i) => i === questionIndex ? index : item));
  }, [isAnswered, question, questionIndex, stage]);

  const continueQuiz = useCallback(() => {
    if (!isAnswered) return;
    if (questionIndex < 3) {
      setQuestionIndex((current) => current + 1);
      return;
    }
    const finalGrade = gradeQuiz(questions, answers);
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const withGrade = recordQuizResult(progress, term, finalGrade, localDate);
    onProgress(saveRevisit(withGrade, term, questions, answers, localDate));
    setStage("grade");
  }, [answers, isAnswered, onProgress, progress, questionIndex, questions, term]);

  function answerRevisit(index: number) {
    if (!revisitItem || revisitAnswer !== null) return;
    setRevisitAnswer(index);
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    onRevisitDone(recordRevisitAnswer(progress, revisitItem, index === revisitItem.question.correctIndex, localDate));
  }

  useEffect(() => {
    if (stage !== "quiz") return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Enter") {
        event.preventDefault();
        continueQuiz();
        return;
      }
      const choice = /^[1-4]$/.test(event.key) ? Number(event.key) - 1 : /^[a-d]$/i.test(event.key) ? event.key.toLowerCase().charCodeAt(0) - 97 : -1;
      if (choice >= 0) {
        event.preventDefault();
        chooseAnswer(choice);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stage, continueQuiz, chooseAnswer]);

  function renderChoices(item: LearningQuestion, selected: number | null, onChoose: (index: number) => void, locked: boolean) {
    return (
      <div className="learning-options" role="group" aria-label="Answer options">
        {item.options.map((option, index) => {
          const correct = selected !== null && selected !== undefined && index === item.correctIndex;
          const wrong = selected === index && index !== item.correctIndex;
          return (
            <button
              className={`learning-option ${correct ? "is-correct" : ""} ${wrong ? "is-wrong" : ""}`}
              type="button"
              key={`${item.id}-${index}`}
              onClick={() => onChoose(index)}
              disabled={locked}
              aria-pressed={selected === index}
            >
              <span className="learning-option-key">{String.fromCharCode(65 + index)}</span>
              <span>{option}</span>
              {correct && <span className="answer-label">Correct</span>}
              {wrong && <span className="answer-label">Your answer</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section className="learning-experience" aria-live="polite" aria-label={`Learn ${term}`}>
      <div className="learning-heading">
        <div><span className="learning-eyebrow">LEARN FROM YOUR QUESTION</span><h2>{term}</h2><p className="learning-query">{query}</p></div>
        <button className="learning-close" type="button" onClick={onClose} aria-label="Back to chat">Back to chat</button>
      </div>

      {stage === "answer-loading" && (
        <div className="learning-skeleton" role="status" aria-label="Preparing answer"><span /><span /><span /><span /></div>
      )}

      {answerText && !revisitItem && (
        <article className="learning-step-card answer-card">
          <span className="reveal-label">ANSWER TO YOUR QUESTION</span>
          <h3>{query}</h3>
          <div className="answer-copy">{renderAnswer(answerText)}</div>
        </article>
      )}

      {(stage === "reveal-loading" || stage === "quiz-loading") && (
        <div className="learning-skeleton" role="status" aria-label="Preparing learning activity"><span /><span /><span /><span /></div>
      )}

      {stage === "error" && (
        <div className="learning-error" role="alert"><p>{error}</p><button className="learning-primary" type="button" onClick={() => failedTask === "answer" ? void requestAnswer() : failedTask === "reveal" ? void requestReveal(answerText) : void requestQuiz()}>Try again</button></div>
      )}

      {stage === "reveal" && reveal && (
        <div className="learning-step-card reveal-card">
          <div className="reveal-part"><span className="reveal-label">MENTAL MODEL</span><p>{reveal.story}</p></div>
          <div className="reveal-part"><span className="reveal-label">IN SHORT</span><p>{reveal.meaning}</p></div>
          <div className="reveal-part"><span className="reveal-label">REAL-WORLD EXAMPLE</span><p>{reveal.example}</p></div>
          <div className="reveal-part"><span className="reveal-label">COMMON MISTAKE</span><p>{reveal.commonMistake}</p></div>
          <button className="learning-primary" type="button" onClick={() => void requestQuiz()}>Start challenge <span aria-hidden="true">→</span></button>
        </div>
      )}

      {stage === "quiz" && question && (
        <div className="learning-step-card quiz-card">
          <div className="quiz-progress-top"><span>CHALLENGE</span><span>{questionIndex + 1} / 4</span></div>
          <div className="quiz-progress-track"><span style={{ width: `${((questionIndex + 1) / 4) * 100}%` }} /></div>
          <div className="quiz-skill">{question.skill}</div>
          <h3>{question.prompt}</h3>
          {renderChoices(question, isAnswered ? answer : null, chooseAnswer, isAnswered)}
          {isAnswered && (
            <div className={`quiz-feedback ${isCorrect ? "feedback-correct" : "feedback-wrong"}`} role="status">
              <strong>{isCorrect ? "Correct answer" : "Wrong answer"}</strong><span>{question.explanation}</span>
            </div>
          )}
          <div className="quiz-controls">
            {questionIndex > 0 && <button className="learning-secondary" type="button" onClick={() => setQuestionIndex((current) => current - 1)}>← Review previous</button>}
            <span className="quiz-key-hint">Keys 1–4 / A–D · Enter to continue</span>
            <button className="learning-primary" type="button" onClick={continueQuiz} disabled={!isAnswered}>{questionIndex === 3 ? "See your score" : "Continue"} <span aria-hidden="true">→</span></button>
          </div>
        </div>
      )}

      {stage === "grade" && (
        <div className="learning-step-card grade-card">
          <div className="score-ring" style={{ "--score-angle": `${(grade.score / 4) * 360}deg` } as CSSProperties} aria-label={`Score ${grade.score} out of 4`}><span><strong>{grade.score}</strong><small>/ 4</small></span></div>
          <div className="grade-summary"><span className="reveal-label">YOUR RESULT</span><h3>{grade.level}</h3><p>+{grade.xpEarned} XP <span>·</span> {progress.streakDays || 1} day streak</p></div>
          <div className="grade-detail"><strong>Weak spot</strong><span>{grade.weakSkills.length ? grade.weakSkills.join(" · ") : "None — nicely done"}</span></div>
          <button className="fix-list-toggle" type="button" onClick={() => setShowFixes((visible) => !visible)} aria-expanded={showFixes}>Fix list ({grade.missed.length}) <span>{showFixes ? "−" : "+"}</span></button>
          {showFixes && <div className="fix-list">{grade.missed.length ? grade.missed.map((missed) => <p key={missed.id}><strong>{missed.skill}:</strong> {missed.explanation}</p>) : <p>All answers were right. Keep that understanding handy.</p>}</div>}
          <button className="related-term-chip" type="button" onClick={() => onNextTerm(reveal?.relatedTerm ?? relatedTerms[0] ?? term)}><span>Next term</span><strong>{reveal?.relatedTerm ?? relatedTerms[0] ?? term}</strong><span aria-hidden="true">→</span></button>
          <div className="grade-actions"><button className="learning-secondary" type="button" onClick={() => void requestQuiz()}>Retry quiz</button><button className="learning-tertiary" type="button" onClick={onClose}>Back to chat</button></div>
        </div>
      )}

      {stage === "revisit" && revisitItem && (
        <div className="learning-step-card quiz-card">
          <div className="quiz-progress-top"><span>DAILY REVIEW</span><span>{term}</span></div>
          <div className="quiz-skill">{revisitItem.question.skill}</div>
          <h3>{revisitItem.question.prompt}</h3>
          {renderChoices(revisitItem.question, revisitAnswer, answerRevisit, revisitAnswer !== null)}
          {revisitAnswer !== null && <div className={`quiz-feedback ${revisitAnswer === revisitItem.question.correctIndex ? "feedback-correct" : "feedback-wrong"}`} role="status"><strong>{revisitAnswer === revisitItem.question.correctIndex ? "Correct answer" : "Wrong answer"}</strong><span>{revisitItem.question.explanation}</span><button className="learning-primary" type="button" onClick={onClose}>Back to chat</button></div>}
        </div>
      )}

    </section>
  );
}
