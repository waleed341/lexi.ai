import unittest
import json
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.main import LearningRequest, QuizResponse, RevealResponse, create_learning_quiz, create_learning_reveal, generate_learning_response


def question(question_id: str, question_type: str, skill: str, option_count: int) -> dict[str, object]:
    return {
        "id": question_id,
        "type": question_type,
        "skill": skill,
        "prompt": "Choose the best answer for this term.",
        "options": [f"Option {index}" for index in range(option_count)],
        "correctIndex": 0,
        "explanation": "This choice is accurate.",
    }


class LearningSchemaTests(unittest.TestCase):
    def test_reveal_schema_accepts_a_short_glossary_grounded_card(self) -> None:
        reveal = RevealResponse.model_validate({
            "term": "Neural network",
            "story": "It is like a team passing clues. Each person adds a small piece before the final answer.",
            "meaning": "A trainable model made of connected computational units.",
            "example": "Image recognition in Google Photos.",
            "commonMistake": "It does not think exactly like a human brain.",
            "relatedTerm": "Deep learning",
        })
        self.assertEqual(reveal.term, "Neural network")

    def test_reveal_schema_accepts_a_concise_explanation(self) -> None:
        reveal = RevealResponse.model_validate({
            "term": "Neural network", "story": "A team passes clues. Each member adds a useful piece.",
            "meaning": "A model of connected computational units that learns patterns from examples.",
            "example": "Google Photos image search.", "commonMistake": "It is not a literal human brain.",
            "relatedTerm": "Deep learning",
        })
        self.assertEqual(reveal.term, "Neural network")

    def test_reveal_schema_rejects_unknown_fields_and_self_related_term(self) -> None:
        data = {
            "term": "Neural network",
            "story": "It is like a team passing clues. Each person adds a small piece before the final answer.",
            "meaning": "A trainable model made of connected computational units.",
            "example": "Google Photos image search.",
            "commonMistake": "It is not a human brain.", "relatedTerm": "Neural network",
        }
        with self.assertRaises(ValidationError):
            RevealResponse.model_validate({**data, "extra": "not allowed"})
        with self.assertRaises(ValidationError):
            RevealResponse.model_validate(data)

    def test_generation_retries_once_after_invalid_json(self) -> None:
        valid = {
            "term": "Neural network",
            "story": "It is like a team passing clues. Each person adds a small piece before the final answer.",
            "meaning": "A trainable model made of connected computational units.",
            "example": "Google Photos image search.",
            "commonMistake": "It is not a human brain.", "relatedTerm": "Deep learning",
        }
        responses = [
            {"messages": [SimpleNamespace(text="not valid JSON")]},
            {"messages": [SimpleNamespace(text=json.dumps(valid))]},
        ]
        with patch("app.main.agent.invoke", side_effect=responses) as invoke:
            result = generate_learning_response("Make a reveal", RevealResponse)
        self.assertEqual(result.relatedTerm, "Deep learning")
        self.assertEqual(invoke.call_count, 2)

    def test_reveal_keeps_answer_first_flow_available_when_model_json_fails(self) -> None:
        request = LearningRequest(
            term="Neural network",
            query="What is a neural network?",
            answer="It learns patterns from examples using connected computational units.",
        )
        with patch("app.main.generate_learning_response", side_effect=HTTPException(status_code=502)):
            reveal = create_learning_reveal(request)
        self.assertIn("connected computational units", reveal.example)
        self.assertTrue(reveal.relatedTerm)

    def test_quiz_schema_requires_the_exact_four_ordered_types_and_skills(self) -> None:
        questions = [
            question("q1", "mcq", "Concept", 4),
            question("q2", "tf", "Recall", 4),
            question("q3", "scenario", "Application", 4),
            question("q4", "fix", "Misconception", 4),
        ]
        self.assertEqual(len(QuizResponse.model_validate({"questions": questions}).questions), 4)
        questions[2]["type"] = "fix"
        with self.assertRaises(ValidationError):
            QuizResponse.model_validate({"questions": questions})

    def test_quiz_schema_rejects_invalid_correct_option_indices(self) -> None:
        questions = [
            question("q1", "mcq", "Concept", 4),
            question("q2", "tf", "Recall", 4),
            question("q3", "scenario", "Application", 4),
            question("q4", "fix", "Misconception", 4),
        ]
        questions[1]["correctIndex"] = 2
        with self.assertRaises(ValidationError):
            QuizResponse.model_validate({"questions": questions})

    def test_quiz_generation_shuffles_correct_positions_and_options(self) -> None:
        generated = QuizResponse.model_validate({"questions": [
            question("q1", "mcq", "Concept", 4),
            question("q2", "tf", "Recall", 4),
            question("q3", "scenario", "Application", 4),
            question("q4", "fix", "Misconception", 4),
        ]})
        with patch("app.main.generate_learning_response", return_value=generated):
            result = create_learning_quiz(LearningRequest(term="Neural network", query="Explain neural networks", answer="A network learns patterns from connected units."))
        self.assertEqual(len({item.correctIndex for item in result.questions}), 4)
        self.assertEqual([len(item.options) for item in result.questions], [4, 4, 4, 4])

    def test_quiz_has_answer_grounded_four_option_fallback(self) -> None:
        answer = "Generative AI creates new content from patterns it learned during training."
        request = LearningRequest(term="Generative AI (GenAI)", query="What is generative AI?", answer=answer)
        with patch("app.main.generate_learning_response", side_effect=HTTPException(status_code=502)):
            result = create_learning_quiz(request)
        self.assertEqual(len(result.questions), 4)
        self.assertTrue(all(len(item.options) == 4 for item in result.questions))
        self.assertIn(answer.split(".")[0], result.questions[0].options)


if __name__ == "__main__":
    unittest.main()
