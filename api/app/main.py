import json
import random
from pathlib import Path
from typing import Literal, TypeVar

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from langchain.agents import create_agent
from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


GLOSSARY_PATH = Path(__file__).resolve().parents[1] / "data" / "ai-glossary.json"


class GlossaryEntry(BaseModel):
    term: str
    description: str


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    answer: str


class LearningRequest(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    query: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=8000)


class StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RevealResponse(StrictResponse):
    term: str = Field(min_length=1, max_length=120)
    story: str = Field(min_length=1, max_length=1200)
    meaning: str = Field(min_length=1, max_length=500)
    example: str = Field(min_length=1, max_length=500)
    commonMistake: str = Field(min_length=1, max_length=500)
    relatedTerm: str = Field(min_length=1, max_length=120)

    @field_validator("relatedTerm")
    @classmethod
    def related_term_exists(cls, value: str) -> str:
        if value.casefold() not in {entry.term.casefold() for entry in GLOSSARY}:
            raise ValueError("relatedTerm must match an existing glossary entry")
        return value

    @model_validator(mode="after")
    def related_term_is_different(self) -> "RevealResponse":
        if self.relatedTerm.casefold() == self.term.casefold():
            raise ValueError("relatedTerm must be a different glossary term")
        return self


class GeneratedReveal(StrictResponse):
    story: str = Field(min_length=1, max_length=1200)
    meaning: str = Field(min_length=1, max_length=500)
    example: str = Field(min_length=1, max_length=500)
    commonMistake: str = Field(min_length=1, max_length=500)


QuestionType = Literal["mcq", "tf", "scenario", "fix"]
SkillTag = Literal["Concept", "Recall", "Application", "Misconception"]


class QuizQuestion(StrictResponse):
    id: str = Field(min_length=1, max_length=30)
    type: QuestionType
    skill: SkillTag
    prompt: str = Field(min_length=8, max_length=400)
    options: list[str] = Field(min_length=4, max_length=4)
    correctIndex: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=3, max_length=300)

    @model_validator(mode="after")
    def validate_options(self) -> "QuizQuestion":
        expected_count = 4
        if len(self.options) != expected_count or self.correctIndex >= len(self.options):
            raise ValueError("question has an invalid option count or correct answer")
        return self


class QuizResponse(StrictResponse):
    questions: list[QuizQuestion] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def validate_question_sequence(self) -> "QuizResponse":
        expected = [
            ("mcq", "Concept"),
            ("tf", "Recall"),
            ("scenario", "Application"),
            ("fix", "Misconception"),
        ]
        actual = [(question.type, question.skill) for question in self.questions]
        if actual != expected:
            raise ValueError("questions must follow the required four-step sequence")
        return self


def load_glossary() -> list[GlossaryEntry]:
    """Load the glossary entries used by both the API and the agent tool."""
    with GLOSSARY_PATH.open(encoding="utf-8") as glossary_file:
        raw_entries = json.load(glossary_file)
    return [GlossaryEntry.model_validate(entry) for entry in raw_entries]


GLOSSARY = load_glossary()


def related_glossary_term(entry: GlossaryEntry) -> str:
    """Choose an existing nearby term without asking the model to invent its label."""
    description = entry.description.casefold()
    candidates = [candidate for candidate in GLOSSARY if candidate.term.casefold() != entry.term.casefold()]
    if not candidates:
        return entry.term

    mentioned = next((candidate for candidate in candidates if candidate.term.casefold() in description), None)
    if mentioned:
        return mentioned.term

    description_words = set(description.replace("-", " ").split())
    return max(
        candidates,
        key=lambda candidate: len(
            {word.casefold().strip("(),.:;") for word in candidate.term.split()} & description_words
        ),
    ).term


def fallback_learning_quiz(entry: GlossaryEntry, answer: str) -> QuizResponse:
    """Build a conservative, answer-only quiz if the model cannot return valid JSON."""
    claim = " ".join(answer.split())[:240].rstrip(" .")
    if not claim:
        claim = entry.description[:240]
    options = [
        claim,
        f"The answer says {entry.term} cannot do what this explanation describes.",
        f"The answer says {entry.term} only does the opposite of this explanation.",
        f"The answer says {entry.term} has no connection to the example it describes.",
    ]
    prompts = [
        f"According to the answer, what best describes {entry.term}?",
        "Which statement is supported by the answer you just read?",
        f"In the situation described above, what does {entry.term} do?",
        f"Fix this misconception: {entry.term} only does the opposite of what the answer describes.",
    ]
    types: tuple[QuestionType, ...] = ("mcq", "tf", "scenario", "fix")
    skills: tuple[SkillTag, ...] = ("Concept", "Recall", "Application", "Misconception")
    questions = [
        QuizQuestion(
            id=f"q{index + 1}",
            type=question_type,
            skill=skills[index],
            prompt=prompts[index],
            options=options,
            correctIndex=0,
            explanation="This is the detail stated in the answer above.",
        )
        for index, question_type in enumerate(types)
    ]
    return QuizResponse(questions=questions)


@tool
def lookup_term(term: str) -> str:
    """Find AI glossary entries matching a term or its description."""
    search = term.strip().casefold()
    if not search:
        return "Please provide an AI term to look up."

    matches = [
        entry
        for entry in GLOSSARY
        if search in entry.term.casefold()
        or search in entry.description.casefold()
    ]
    if not matches:
        return f"No glossary entry found for '{term}'."

    return "\n".join(
        f"{entry.term}: {entry.description}" for entry in matches[:8]
    )


SYSTEM = """You are Lexi-AI, a warm and knowledgeable AI terminology guide.
Use lookup_term whenever a question involves AI terminology. Explain ideas in
plain language, keep answers focused, and use a short example when it helps.
If the glossary has no matching entry, say that and still help from general
knowledge when appropriate. Never claim a glossary lookup found something it did not.
Reply in English by default, even when the user's question is in Urdu or Roman Urdu.
Use another language only when the user explicitly asks for it. Use Roman Urdu only
when explicitly requested; a question written in Roman Urdu is not such a request.
If Urdu is explicitly requested, use Urdu script unless Roman Urdu is requested.
Preserve technical terms in English. Apply these language rules to chat answers,
learning cards, quiz questions, options, and explanations. For learning-generation
requests, follow the requested strict JSON schema."""

agent = create_agent(
    model="ollama:gemma4:31b-cloud",
    tools=[lookup_term],
    system_prompt=SYSTEM,
)

app = FastAPI(title="Lexi-AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ResponseModel = TypeVar("ResponseModel", bound=BaseModel)


def generate_learning_response(prompt: str, schema: type[ResponseModel]) -> ResponseModel:
    """Ask the configured LangChain agent for strict JSON and validate it, retrying once."""
    correction = ""
    for attempt in range(2):
        try:
            result = agent.invoke(
                {"messages": [{"role": "user", "content": f"{prompt}\n{correction}"}]}
            )
            content = result["messages"][-1].text.strip()
            json_start = content.find("{")
            json_end = content.rfind("}")
            if json_start < 0 or json_end <= json_start:
                raise ValueError("No JSON object found")
            payload = json.loads(content[json_start : json_end + 1])
            return schema.model_validate(payload)
        except (json.JSONDecodeError, ValueError) as exc:
            correction = (
                f"Your previous response was invalid ({exc}). Retry the task from scratch. "
                "Return one valid JSON object only, matching the schema exactly."
            )
            if attempt == 1:
                raise HTTPException(
                    status_code=502,
                    detail="The learning activity could not be prepared. Please try again.",
                ) from exc
        except Exception as exc:
            if attempt == 1:
                raise HTTPException(
                    status_code=502,
                    detail="The learning activity could not be prepared. Please try again.",
                ) from exc
            correction = "Retry once. Return only a valid JSON object matching the requested schema."
    raise HTTPException(status_code=502, detail="Please try generating the activity again.")


@app.get("/")
def read_root() -> dict[str, str]:
    return {"status": "ok", "glossary": "/glossary", "chat": "/chat"}


@app.get("/glossary", response_model=list[GlossaryEntry])
def read_glossary(q: str | None = Query(default=None, min_length=1)) -> list[GlossaryEntry]:
    """List glossary entries, optionally searching terms and descriptions."""
    if q is None:
        return GLOSSARY

    search = q.strip().casefold()
    return [
        entry
        for entry in GLOSSARY
        if search in entry.term.casefold()
        or search in entry.description.casefold()
    ]


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    """Send a question to the Lexi-AI agent."""
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="Please enter a question.")

    try:
        result = agent.invoke(
            {"messages": [{"role": "user", "content": query}]}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="The Lexi-AI agent could not respond. Check that the model is available and try again.",
        ) from exc

    answer = result["messages"][-1].text
    return ChatResponse(answer=answer)


@app.post("/learning/reveal", response_model=RevealResponse)
def create_learning_reveal(request: LearningRequest) -> RevealResponse:
    """Generate a mental model grounded in the answer already shown to the learner."""
    entry = next(
        (item for item in GLOSSARY if item.term.casefold() == request.term.strip().casefold()),
        None,
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Choose a term from the glossary and try again.")

    prompt = f"""Create the reveal card for this glossary item.
Term: {entry.term}
Verified meaning: {entry.description}
Learner question: {request.query}
Answer already shown to the learner: {request.answer}

Return STRICT JSON with exactly these string fields: story, meaning, example,
commonMistake. story must be exactly two short everyday analogy
sentences and explain the concept from the answer already shown. meaning must be an
accurate, concise definition.
example and commonMistake must be consistent with the supplied answer and glossary.
Write in English unless the learner explicitly requests another language in their
question. Use Roman Urdu only if explicitly requested, and preserve technical terms
in English. Do not contradict or add
claims beyond the supplied answer and verified meaning.
Use this compact JSON shape and no markdown: {{"story":"...","meaning":"...","example":"...","commonMistake":"..."}}"""
    try:
        generated = generate_learning_response(prompt, GeneratedReveal)
    except HTTPException:
        # Keep the answer-first learning flow usable if the model cannot format its reveal JSON.
        answer_excerpt = request.answer.split("\n", 1)[0].strip()[:260]
        generated = GeneratedReveal(
            story=(
                f"Think of {entry.term} as a helper following this rule: {entry.description} "
                "The example in your answer shows what that idea looks like in practice."
            ),
            meaning=entry.description[:500],
            example=answer_excerpt or f"Your answer explains {entry.term} in context.",
            commonMistake=(
                "The analogy is a guide; use the specific details in the answer above "
                "to understand this term."
            ),
        )
    return RevealResponse(
        term=entry.term,
        relatedTerm=related_glossary_term(entry),
        **generated.model_dump(),
    )


@app.post("/learning/quiz", response_model=QuizResponse)
def create_learning_quiz(request: LearningRequest) -> QuizResponse:
    """Generate a four-question quiz. Answers are graded by the client."""
    entry = next(
        (item for item in GLOSSARY if item.term.casefold() == request.term.strip().casefold()),
        None,
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Choose a term from the glossary and try again.")

    prompt = f"""Create a four-question quiz for the glossary concept below.
Term: {entry.term}
Learner question: {request.query}
Answer already shown to the learner: {request.answer}
Write in English unless the learner explicitly requests another language in their
question. Use Roman Urdu only if explicitly requested, and preserve technical terms
in English. Keep every explanation to one short line. All answers must
be factual and unambiguous. Every question must have exactly four options. Base every
question, correct answer, distractor, and explanation only on facts stated in the answer
already shown above; do not use outside facts or unrelated glossary trivia. Scenario and
misconception questions must apply or correct ideas stated in that answer. Shuffle the
correct answer positions; do not repeat one position four times. Return STRICT JSON only, with shape {{"questions":[{{"id":"q1",
"type":"mcq","skill":"Concept","prompt":"...","options":["A","B","C","D"],
"correctIndex":0,"explanation":"..."}}]}}. Include exactly these four questions, in order:
1. mcq / Concept: easy definition question, four options.
2. tf / Recall: tricky true-or-false style question asking which of four statements is accurate.
3. scenario / Application: practical app problem asking which concept to use, four options.
4. fix / Misconception: one wrong sentence, then four possible corrections.
Every question must have id, type, skill, prompt, options, zero-based correctIndex, and explanation.
The exact skill tags are Concept, Recall, Application, Misconception."""
    try:
        response = generate_learning_response(prompt, QuizResponse)
    except HTTPException:
        response = fallback_learning_quiz(entry, request.answer)
    correct_positions = list(range(4))
    random.shuffle(correct_positions)
    shuffled_questions: list[QuizQuestion] = []
    for question, correct_position in zip(response.questions, correct_positions, strict=True):
        correct_option = question.options[question.correctIndex]
        distractors = [option for index, option in enumerate(question.options) if index != question.correctIndex]
        random.shuffle(distractors)
        options = distractors
        options.insert(correct_position, correct_option)
        shuffled_questions.append(
            QuizQuestion.model_validate(
                {**question.model_dump(), "options": options, "correctIndex": correct_position}
            )
        )
    return QuizResponse(questions=shuffled_questions)
