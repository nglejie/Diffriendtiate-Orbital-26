import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from stream_events import extract_messages_from_event_value


class FakeAIMessage:
    def __init__(self, content: str):
        self.content = content


class FakeCommand:
    def __init__(self, update):
        self.update = update


def is_fake_ai_message(value):
    return isinstance(value, FakeAIMessage)


class StreamEventExtractionTests(unittest.TestCase):
    def test_extracts_ai_message_from_langgraph_command_update(self):
        message = FakeAIMessage("Intelligrate Singapore check passed.")
        payload = {
            "chunk": [
                FakeCommand(
                    update={
                        "messages": [message],
                    },
                ),
            ],
        }

        self.assertEqual(extract_messages_from_event_value(payload, is_fake_ai_message), [message])

    def test_recurses_through_dicts_lists_and_tuples(self):
        first = FakeAIMessage("first")
        second = FakeAIMessage("second")
        payload = {
            "output": (
                {"messages": [first]},
                [{"nested": second}],
            ),
        }

        self.assertEqual(extract_messages_from_event_value(payload, is_fake_ai_message), [first, second])

    def test_ignores_non_matching_payloads(self):
        payload = {"chunk": [FakeCommand(update={"messages": ["not ai"]})]}

        self.assertEqual(extract_messages_from_event_value(payload, is_fake_ai_message), [])


if __name__ == "__main__":
    unittest.main()
