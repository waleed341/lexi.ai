"use client";

import { FormEvent, Fragment, KeyboardEvent, useEffect, useRef, useState } from "react";
import LearningExperience from "./learning-ui";
import {
  dueRevisits,
  EMPTY_PROGRESS,
  LearningProgress,
  masteryFor,
  nextDateKey,
  PROGRESS_KEY,
  readProgress,
  RevisitItem,
  resolveGlossaryTerm,
  writeProgress,
} from "./learning-core";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

type GlossaryEntry = {
  term: string;
  description: string;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api/proxy";

const starterPrompts = [
  { icon: "✳", text: "What is generative AI?", tint: "lavender" },
  { icon: "⌘", text: "Explain neural networks simply", tint: "mint" },
  { icon: "↗", text: "How are AI agents different from LLMs?", tint: "peach" },
  { icon: "◌", text: "What does RAG mean?", tint: "blue" },
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 36 36" fill="none">
        <path d="M18 4.5 21.8 14l9.7 4-9.7 4-3.8 9.5L14.2 22l-9.7-4 9.7-4L18 4.5Z" fill="currentColor" />
        <circle cx="27.7" cy="8.2" r="2.2" fill="#8BE6D1" />
      </svg>
    </span>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m3 9 13.5-6L12 17l-2.4-5.2L3 9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m9.6 11.8 3.8-4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m19 2 .8 2.2L22 5l-2.2.8L19 8l-.8-2.2L16 5l2.2-.8L19 2Z" fill="currentColor" />
    </svg>
  );
}

function renderMessage(content: string) {
  const lines = content.split("\n");
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*.*?\*\*|`[^`]+`)/g).filter(Boolean);
    return (
      <Fragment key={`line-${lineIndex}`}>
        {lineIndex > 0 && <br />}
        {parts.map((part, partIndex) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return <strong key={`part-${partIndex}`}>{part.slice(2, -2)}</strong>;
          }
          if (part.startsWith("`") && part.endsWith("`")) {
            return <code key={`part-${partIndex}`}>{part.slice(1, -1)}</code>;
          }
          return <Fragment key={`part-${partIndex}`}>{part}</Fragment>;
        })}
      </Fragment>
    );
  });
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatHistory, setChatHistory] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [glossarySearch, setGlossarySearch] = useState("");
  const [glossaryError, setGlossaryError] = useState(false);
  const [apiReady, setApiReady] = useState<boolean | null>(null);
  const [learningTerm, setLearningTerm] = useState<string | null>(null);
  const [learningQuery, setLearningQuery] = useState("");
  const [revisitItem, setRevisitItem] = useState<RevisitItem | null>(null);
  const [learningProgress, setLearningProgress] = useState<LearningProgress>(EMPTY_PROGRESS);
  const [progressReady, setProgressReady] = useState(false);
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const conversationUpdateRef = useRef(0);
  const activeConversationRef = useRef<string | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("lexi-ai-theme");
    const initialTheme = savedTheme === "dark" ? "dark" : "light";
    // Hydrate the saved theme after mount so server and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;

    const savedSidebarState = window.localStorage.getItem("lexi-ai-sidebar-collapsed");
    setSidebarCollapsed(
      savedSidebarState === null
        ? window.matchMedia("(max-width: 760px)").matches
        : savedSidebarState === "true",
    );

    try {
      const savedHistory = window.localStorage.getItem("lexi-ai-conversations");
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory) as {
          conversations?: Conversation[];
          activeConversationId?: string | null;
        };
        const conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
        conversationUpdateRef.current = conversations.reduce((highest, conversation) => Math.max(highest, conversation.updatedAt), 0);
        nextIdRef.current = conversations
          .flatMap((conversation) => conversation.messages)
          .reduce((highest, message) => Math.max(highest, message.id), -1) + 1;
        const savedActiveId = parsed.activeConversationId ?? null;
        const activeConversation = conversations.find((conversation) => conversation.id === savedActiveId);
        setChatHistory(conversations);
        setActiveConversationId(activeConversation?.id ?? null);
        activeConversationRef.current = activeConversation?.id ?? null;
        setMessages(activeConversation?.messages ?? []);
      }
    } catch {
      window.localStorage.removeItem("lexi-ai-conversations");
    } finally {
      setHistoryReady(true);
    }
  }, []);

  useEffect(() => {
    // Restore browser-only learning data after hydration; the server has no localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLearningProgress(readProgress(window.localStorage.getItem(PROGRESS_KEY)));
    setProgressReady(true);
  }, []);

  useEffect(() => {
    function refreshLocalDay() {
      const today = new Date();
      // The local day is browser state; update it after prerendering and across midnight.
      setTodayKey(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
    }
    refreshLocalDay();
    const interval = window.setInterval(refreshLocalDay, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!progressReady) return;
    try {
      window.localStorage.setItem(PROGRESS_KEY, writeProgress(learningProgress));
    } catch {
      // Learning still works for this session if browser storage is unavailable.
    }
  }, [learningProgress, progressReady]);

  useEffect(() => {
    if (!historyReady) return;
    window.localStorage.setItem(
      "lexi-ai-conversations",
      JSON.stringify({ conversations: chatHistory, activeConversationId }),
    );
  }, [chatHistory, activeConversationId, historyReady]);

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/glossary`)
      .then((response) => {
        if (!response.ok) throw new Error("Glossary unavailable");
        return response.json() as Promise<GlossaryEntry[]>;
      })
      .then((entries) => {
        if (active) {
          setGlossary(entries);
          setApiReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setGlossaryError(true);
          setApiReady(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const visibleTerms = glossary
    .filter((entry) =>
      `${entry.term} ${entry.description}`.toLocaleLowerCase().includes(glossarySearch.toLocaleLowerCase()),
    )
    .slice(0, 6);
  const pendingRevisit = todayKey ? dueRevisits(learningProgress, todayKey)[0] ?? null : null;

  function startLearning(term: string, revisiting: RevisitItem | null = null, query = `Explain ${term} in simple terms.`) {
    setLearningTerm(term);
    setRevisitItem(revisiting);
    setLearningQuery(revisiting ? revisiting.question.prompt : query);
  }

  function updateLearningProgress(next: LearningProgress) {
    setLearningProgress(next);
  }

  function finishRevisit(next: LearningProgress) {
    setLearningProgress(next);
  }

  function deferRevisit(item: RevisitItem) {
    setLearningProgress((current) => ({
      ...current,
      revisitQueue: current.revisitQueue.map((queued) => queued.term === item.term
        ? { ...queued, dueOn: nextDateKey(todayKey ?? item.dueOn) }
        : queued),
    }));
  }

  function startSuggestion(prompt: string) {
    const glossaryTerms = glossary.map((entry) => entry.term);
    const match = resolveGlossaryTerm(prompt, glossaryTerms)
      ?? (prompt.toLocaleLowerCase().includes("agents") ? glossaryTerms.find((term) => term.toLocaleLowerCase() === "ai agent") ?? null : null);
    if (match) startLearning(match, null, prompt);
    else void sendMessage(prompt);
  }

  function saveConversation(conversationId: string, title: string, conversationMessages: Message[], updatedAt: number) {
    setChatHistory((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId);
      const conversation = {
        id: conversationId,
        title: existing?.title ?? (title.length > 38 ? `${title.slice(0, 38).trimEnd()}…` : title),
        messages: conversationMessages,
        updatedAt,
      };
      return [conversation, ...current.filter((item) => item.id !== conversationId)]
        .sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async function sendMessage(value: string) {
    const query = value.trim();
    if (!query || isLoading) return;
    const matchedTerm = resolveGlossaryTerm(query, glossary.map((entry) => entry.term));
    if (matchedTerm) {
      startLearning(matchedTerm, null, query);
      setDraft("");
      return;
    }

    const userMessage: Message = { id: nextIdRef.current++, role: "user", content: query };
    const updatedAt = ++conversationUpdateRef.current;
    let conversationId = activeConversationRef.current;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      activeConversationRef.current = conversationId;
      setActiveConversationId(conversationId);
    }
    const currentConversationId = conversationId;
    const conversationMessages = [...messages, userMessage];
    setMessages(conversationMessages);
    saveConversation(currentConversationId, query, conversationMessages, updatedAt);
    setDraft("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = (await response.json()) as { answer?: string; detail?: string };
      if (!response.ok) throw new Error(data.detail ?? "The assistant could not respond. Please try again.");
      setApiReady(true);
      const assistantMessage: Message = {
        id: nextIdRef.current++,
        role: "assistant",
        content: data.answer ?? "I couldn't find an answer to that.",
      };
      const updatedMessages = [...conversationMessages, assistantMessage];
      if (activeConversationRef.current === currentConversationId) setMessages(updatedMessages);
      conversationUpdateRef.current = Math.max(conversationUpdateRef.current, updatedAt + 1);
      saveConversation(currentConversationId, query, updatedMessages, updatedAt + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      setApiReady(false);
      const errorMessage: Message = {
        id: nextIdRef.current++,
        role: "assistant",
        content: `${message} Make sure the FastAPI server and AI model are running.`,
      };
      const updatedMessages = [...conversationMessages, errorMessage];
      if (activeConversationRef.current === currentConversationId) setMessages(updatedMessages);
      conversationUpdateRef.current = Math.max(conversationUpdateRef.current, updatedAt + 1);
      saveConversation(currentConversationId, query, updatedMessages, updatedAt + 1);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  function startNewChat() {
    activeConversationRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setDraft("");
    setLearningTerm(null);
    setRevisitItem(null);
  }

  function openConversation(conversation: Conversation) {
    activeConversationRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setDraft("");
  }

  function toggleSidebar() {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    window.localStorage.setItem("lexi-ai-sidebar-collapsed", String(nextCollapsed));
  }

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("lexi-ai-theme", nextTheme);
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Lexi-AI home">
          <BrandMark />
          <span>lexi-ai<span className="brand-period">.</span></span>
        </a>
        <button className="mobile-sidebar-close" onClick={toggleSidebar} aria-label="Close sidebar" title="Close sidebar">×</button>

        <button className="new-chat-button" onClick={startNewChat} aria-label="New conversation" title="New conversation">
          <span className="plus-icon">＋</span> New conversation
          <span className="shortcut">⌘ K</span>
        </button>

        <div className="sidebar-section-title">
          <span>YOUR CHATS</span>
          <span className="sidebar-label">{chatHistory.length}</span>
        </div>
        <div className="recent-chat-list">
          {chatHistory.length === 0 ? (
            <p className="sidebar-hint">Your conversations will appear here.</p>
          ) : chatHistory.map((conversation) => (
            <button
              className={`history-item ${activeConversationId === conversation.id ? "history-item-active" : ""}`}
              key={conversation.id}
              onClick={() => openConversation(conversation)}
              title={conversation.title}
            >
              <span className="history-icon" aria-hidden="true">▤</span>
              <span className="history-title">{conversation.title}</span>
              {activeConversationId === conversation.id && <span className="active-dot" />}
            </button>
          ))}
        </div>

        <div className="sidebar-section-title glossary-title">
          <span>EXPLORE GLOSSARY</span>
          <span className="sidebar-label">{glossary.length || "—"}</span>
        </div>
        <label className="glossary-search">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.5" />
            <path d="m13.2 13.2 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            aria-label="Search the glossary"
            placeholder="Find a term..."
            value={glossarySearch}
            onChange={(event) => setGlossarySearch(event.target.value)}
          />
          <span className="search-key">/</span>
        </label>

        <div className="term-list" aria-live="polite">
          {visibleTerms.map((entry) => (
            <button
              className="term-link"
              key={entry.term}
              onClick={() => startLearning(entry.term)}
              title={entry.description}
            >
              <span className={`term-dot mastery-${masteryFor(learningProgress, entry.term)}`} aria-label={`${masteryFor(learningProgress, entry.term)} mastery`} />
              <span>{entry.term}</span>
            </button>
          ))}
          {glossaryError && <p className="sidebar-hint">Start the API to browse terms.</p>}
          {!glossaryError && glossarySearch && visibleTerms.length === 0 && (
            <p className="sidebar-hint">No matching terms yet.</p>
          )}
        </div>

        <div className="sidebar-spacer" />
        <div className="plan-card">
          <div className="plan-card-icon"><SparkleIcon /></div>
          <p className="plan-eyebrow">A LITTLE MORE CLARITY</p>
          <p className="plan-copy">Big AI ideas, made human.</p>
          <div className="plan-progress"><span /></div>
          <div className="plan-foot"><span>Curiosity level</span><span>∞</span></div>
        </div>

        <button className="profile-row" aria-label="Your profile">
          <span className="avatar">W</span>
          <span className="profile-text"><strong>Welcome back</strong><small>Keep exploring</small></span>
              <span className="xp-streak" aria-label={`${learningProgress.xp} experience points, ${learningProgress.streakDays} day streak`}><span>{learningProgress.xp} XP</span><i /> <span>🔥 {learningProgress.streakDays}</span></span>
          <span className="profile-menu">•••</span>
        </button>
      </aside>

      <section className="main-panel" id="home">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2.5" y="3" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M7.5 3.5v13" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
            <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{messages.length ? chatHistory.find((conversation) => conversation.id === activeConversationId)?.title ?? "New conversation" : "New conversation"}</strong></div>
          </div>
          <div className="topbar-actions">
            <span className={`connection-status ${apiReady === false ? "connection-offline" : ""}`}>
              <span /> {apiReady === null ? "Connecting…" : apiReady ? "AI assistant ready" : "API offline"}
            </span>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            >
              {theme === "light" ? (
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M16.5 11.1A6.7 6.7 0 0 1 8.9 3.5 6.8 6.8 0 1 0 16.5 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="m14.5 3 .4 1.2 1.1.4-1.1.4-.4 1.2-.4-1.2-1.1-.4 1.1-.4.4-1.2Z" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 2v1.5M10 16.5V18M18 10h-1.5M3.5 10H2m13.7-5.7-1.1 1.1M5.4 14.6l-1.1 1.1m11.4 0-1.1-1.1M5.4 5.4 4.3 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
              <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
            </button>
            <button className="icon-button" onClick={startNewChat} aria-label="Start a new chat" title="New chat">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 5.5A7 7 0 1 1 3 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M3 3v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="help-button" onClick={() => void sendMessage("What can you help me understand about AI?")}>How it works <span>↗</span></button>
          </div>
        </header>

        <div className={`chat-scroll-area ${messages.length === 0 && learningTerm === null ? "chat-scroll-area-welcome" : ""}`}>
          <div className={`chat-content ${messages.length === 0 ? "chat-content-empty" : ""}`}>
            {learningTerm ? (
              <LearningExperience
                key={`${learningTerm}:${revisitItem?.term ?? ""}:${learningQuery}`}
                term={learningTerm}
                query={learningQuery}
                apiUrl={API_URL}
                progress={learningProgress}
                relatedTerms={glossary.map((entry) => entry.term)}
                revisitItem={revisitItem ?? undefined}
                onClose={() => { setLearningTerm(null); setRevisitItem(null); }}
                onNextTerm={(nextTerm) => { setRevisitItem(null); setLearningTerm(nextTerm); setLearningQuery(`Explain ${nextTerm} in simple terms.`); }}
                onProgress={updateLearningProgress}
                onRevisitDone={finishRevisit}
              />
            ) : messages.length === 0 ? (
              <section className="welcome-state">
                <div className="welcome-badges">
                  <div className="welcome-kicker"><span className="kicker-stars">✳</span> YOUR FRIENDLY AI GLOSSARY</div>
                  <div className="welcome-greeting"><span className="greeting-spark">✦</span><span>Welcome <strong>Waleed</strong></span></div>
                </div>
                <h1>AI can feel like<br />a <span>different language.</span></h1>
                <p className="welcome-subtitle">Let’s make it make sense. Ask anything, explore a term, or start with one of these.</p>

                {pendingRevisit && (
                  <div className="revisit-banner">
                    <div><span className="revisit-eyebrow">DAILY REVIEW</span><strong>{pendingRevisit.term}</strong></div>
                    <div className="revisit-actions"><button type="button" className="revisit-answer" onClick={() => startLearning(pendingRevisit.term, pendingRevisit)}>Answer now</button><button type="button" className="revisit-later" onClick={() => deferRevisit(pendingRevisit)}>Later</button></div>
                  </div>
                )}

                <div className="prompt-grid">
                  {starterPrompts.map((prompt) => (
                    <button className="prompt-card" key={prompt.text} onClick={() => startSuggestion(prompt.text)}>
                      <span className={`prompt-icon ${prompt.tint}`}>{prompt.icon}</span>
                      <span>{prompt.text}</span>
                      <span className="prompt-arrow">↗</span>
                    </button>
                  ))}
                </div>

                <div className="welcome-footnote"><span className="footnote-spark">✳</span> Curious minds welcome. Jargon not required.</div>
              </section>
            ) : (
              <section className="conversation" aria-live="polite" aria-label="Conversation">
                <div className="conversation-intro"><span>YOUR CONVERSATION</span><i /></div>
                {messages.map((message) => (
                  <article className={`message-row ${message.role}`} key={message.id}>
                    {message.role === "assistant" && <span className="message-avatar"><BrandMark /></span>}
                    <div className="message-body">
                      <span className="message-author">{message.role === "user" ? "You" : "Lexi-AI"}</span>
                      <div className="message-bubble">{renderMessage(message.content)}</div>
                    </div>
                    {message.role === "user" && <span className="user-message-avatar">W</span>}
                  </article>
                ))}
                {isLoading && (
                  <article className="message-row assistant">
                    <span className="message-avatar"><BrandMark /></span>
                    <div className="message-body"><span className="message-author">Lexi-AI</span><div className="message-bubble typing-bubble"><i /><i /><i /><span>Thinking it through</span></div></div>
                  </article>
                )}
                <div ref={endOfMessagesRef} />
              </section>
            )}
          </div>
        </div>

        {learningTerm === null && <footer className="composer-wrap">
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              aria-label="Ask Lexi-AI a question"
              placeholder="Ask anything about AI..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              maxLength={4000}
              disabled={isLoading}
            />
            <div className="composer-bottom">
              <span className="composer-tip">Enter to send <b>·</b> Shift + Enter for a new line</span>
              <button className="send-button" type="submit" disabled={!draft.trim() || isLoading} aria-label="Send message">
                <span>{isLoading ? "Thinking" : "Send"}</span><SendIcon />
              </button>
            </div>
          </form>
          <p className="disclaimer">Lexi-AI can make mistakes. For learning and exploration, always keep your curiosity switched on.</p>
        </footer>}
      </section>
    </main>
  );
}
