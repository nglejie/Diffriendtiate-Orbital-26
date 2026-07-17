import sys
import types
import unittest
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class BaseMessage:
    def __init__(self, content="", **kwargs):
        self.content = content
        self.name = kwargs.get("name")
        self.tool_call_id = kwargs.get("tool_call_id")
        self.tool_calls = kwargs.get("tool_calls", [])


class SystemMessage(BaseMessage):
    pass


class HumanMessage(BaseMessage):
    pass


class AIMessage(BaseMessage):
    pass


class ToolMessage(BaseMessage):
    pass


@dataclass
class HistoryMessage:
    role: str
    content: str


class StubLogger:
    def debug(self, *_args, **_kwargs):
        pass

    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass

    def error(self, *_args, **_kwargs):
        pass


def install_agent_import_stubs():
    messages_module = types.ModuleType("langchain_core.messages")
    messages_module.BaseMessage = BaseMessage
    messages_module.SystemMessage = SystemMessage
    messages_module.HumanMessage = HumanMessage
    messages_module.AIMessage = AIMessage
    messages_module.ToolMessage = ToolMessage
    sys.modules.setdefault("langchain_core.messages", messages_module)

    agents_module = types.ModuleType("langchain.agents")
    agents_module.create_agent = lambda **_kwargs: None
    sys.modules.setdefault("langchain.agents", agents_module)

    middleware_module = types.ModuleType("langchain.agents.middleware")
    middleware_module.dynamic_prompt = lambda func: func
    sys.modules.setdefault("langchain.agents.middleware", middleware_module)

    ollama_module = types.ModuleType("langchain_ollama")
    ollama_module.ChatOllama = lambda **_kwargs: object()
    sys.modules.setdefault("langchain_ollama", ollama_module)

    google_module = types.ModuleType("langchain_google_genai")
    google_module.ChatGoogleGenerativeAI = lambda **_kwargs: object()
    sys.modules.setdefault("langchain_google_genai", google_module)

    litellm_chat_module = types.ModuleType("langchain_litellm")
    litellm_chat_module.ChatLiteLLM = lambda **_kwargs: object()
    sys.modules.setdefault("langchain_litellm", litellm_chat_module)

    litellm_module = types.ModuleType("litellm")
    litellm_module.supports_function_calling = lambda **_kwargs: True
    sys.modules.setdefault("litellm", litellm_module)

    vectorstore_module = types.ModuleType("vectorstore")
    vectorstore_module.VectorStore = object
    sys.modules.setdefault("vectorstore", vectorstore_module)

    tools_module = types.ModuleType("tools")
    tools_module.build_global_tools = lambda: []
    tools_module.build_room_tools = lambda *_args, **_kwargs: []
    tools_module.build_file_tool = lambda *_args, **_kwargs: []
    sys.modules.setdefault("tools", tools_module)

    logger_module = types.ModuleType("logger")
    logger_module.get_logger = lambda _name: StubLogger()
    sys.modules.setdefault("logger", logger_module)

    models_module = types.ModuleType("models")
    models_module.HistoryMessage = HistoryMessage
    sys.modules.setdefault("models", models_module)


install_agent_import_stubs()

from agent import Agent


class FakeGraphAgent:
    def __init__(self, events, invoke_result=None):
        self.events = events
        self.invoke_result = invoke_result
        self.ainvoke_calls = 0

    async def astream_events(self, _state, version="v2"):
        for event in self.events:
            yield event

    async def ainvoke(self, state):
        self.ainvoke_calls += 1
        return self.invoke_result if self.invoke_result is not None else state


def model_stream_event(content, metadata=None):
    return {
        "event": "on_chat_model_stream",
        "metadata": metadata if metadata is not None else {"langgraph_node": "model"},
        "data": {"chunk": AIMessage(content=content)},
    }


def model_end_event(content, metadata=None):
    return {
        "event": "on_chat_model_end",
        "metadata": metadata if metadata is not None else {"langgraph_node": "model"},
        "data": {"output": AIMessage(content=content)},
    }


def model_chain_end_event(content, metadata=None):
    return {
        "event": "on_chain_end",
        "metadata": metadata if metadata is not None else {"langgraph_node": "model"},
        "data": {"output": AIMessage(content=content)},
    }


def model_chain_stream_event(content, metadata=None):
    return {
        "event": "on_chain_stream",
        "metadata": metadata if metadata is not None else {"langgraph_node": "model"},
        "data": {"chunk": {"messages": [AIMessage(content=content)]}},
    }


class AgentStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def collect_stream(self, events, history=None, invoke_result=None):
        agent = Agent(vectorstore=None)
        agent._build_agent = lambda **_kwargs: FakeGraphAgent(events, invoke_result=invoke_result)
        message_chain = history or [HistoryMessage(role="user", content="Second question")]
        return [
            chunk
            async for chunk in agent.stream(
                message_chain=message_chain,
                room_id="room_test",
            )
        ]

    async def test_chain_state_events_do_not_replay_previous_assistant_tokens(self):
        chunks = await self.collect_stream(
            [
                model_stream_event("Second answer only."),
                {
                    "event": "on_chain_end",
                    "metadata": {"langgraph_node": None},
                    "data": {
                        "output": {
                            "messages": [
                                AIMessage(content="First answer must not be replayed."),
                                AIMessage(content="First answer must not be replayed.\n\nSecond answer only."),
                            ],
                        },
                    },
                },
            ],
            [
                HistoryMessage(role="user", content="First question"),
                HistoryMessage(role="assistant", content="First answer must not be replayed."),
                HistoryMessage(role="user", content="Second question"),
            ],
        )

        token_chunks = [chunk for chunk in chunks if chunk.startswith("[TOKEN]")]
        self.assertEqual(token_chunks, ["[TOKEN]Second answer only."])
        self.assertNotIn("First answer must not be replayed", "".join(token_chunks))

    async def test_chat_model_end_can_supply_non_streaming_answer_fallback(self):
        chunks = await self.collect_stream([model_end_event("Final provider answer.")])

        self.assertIn("[TOKEN]Final provider answer.", chunks)
        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]Final provider answer."],
        )

    async def test_model_chain_end_can_supply_non_streaming_answer_fallback(self):
        chunks = await self.collect_stream([model_chain_end_event("Final Gemini chain answer.")])

        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]Final Gemini chain answer."],
        )

    async def test_model_chain_stream_can_supply_answer_when_chat_events_are_missing(self):
        chunks = await self.collect_stream([model_chain_stream_event("Final Gemini chain-stream answer.")])

        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]Final Gemini chain-stream answer."],
        )

    async def test_empty_stream_events_fall_back_to_non_streaming_invoke(self):
        chunks = await self.collect_stream(
            [
                {"event": "on_chain_start", "metadata": {"langgraph_node": None}, "data": {}},
                {"event": "on_chain_start", "metadata": {"langgraph_node": "model"}, "data": {}},
            ],
            invoke_result={
                "messages": [
                    HumanMessage(content="Reply with exactly: diagnostic ok"),
                    AIMessage(content="diagnostic ok"),
                ],
            },
        )

        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]diagnostic ok"],
        )

    async def test_model_chain_stream_does_not_duplicate_streamed_tokens(self):
        chunks = await self.collect_stream(
            [
                model_stream_event("Already streamed."),
                model_chain_stream_event("Duplicate chain stream."),
            ],
        )

        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]Already streamed."],
        )

    async def test_model_chain_end_does_not_duplicate_streamed_tokens(self):
        chunks = await self.collect_stream(
            [
                model_stream_event("Already streamed."),
                model_chain_end_event("Already streamed."),
            ],
        )

        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]Already streamed."],
        )

    async def test_root_chain_end_state_is_not_answer_fallback(self):
        chunks = await self.collect_stream(
            [
                {
                    "event": "on_chain_end",
                    "metadata": {"langgraph_node": None},
                    "data": {
                        "output": {
                            "messages": [
                                AIMessage(content="Old assistant answer."),
                                AIMessage(content="Old assistant answer.\n\nNew assistant answer."),
                            ],
                        },
                    },
                },
            ],
        )

        self.assertEqual([chunk for chunk in chunks if chunk.startswith("[TOKEN]")], [])

    async def test_chat_model_stream_does_not_require_langgraph_node_metadata(self):
        chunks = await self.collect_stream(
            [
                model_stream_event("Provider text without node metadata.", metadata={}),
            ],
        )

        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]Provider text without node metadata."],
        )

    async def test_chat_model_end_does_not_require_langgraph_node_metadata(self):
        chunks = await self.collect_stream(
            [
                model_end_event("Final provider text without node metadata.", metadata={}),
            ],
        )

        self.assertEqual(
            [chunk for chunk in chunks if chunk.startswith("[TOKEN]")],
            ["[TOKEN]Final provider text without node metadata."],
        )

    async def test_tool_events_are_forwarded_once_per_real_tool_event(self):
        chunks = await self.collect_stream(
            [
                {
                    "event": "on_tool_start",
                    "run_id": "tool_run_1",
                    "name": "search_domain_context",
                    "data": {"input": {"query": "static hazards"}},
                    "metadata": {},
                },
                {
                    "event": "on_tool_end",
                    "run_id": "tool_run_1",
                    "name": "search_domain_context",
                    "data": {"output": "[Source: Static1Hazard.pdf] Static hazards are glitches."},
                    "metadata": {},
                },
                model_stream_event("Static hazards are glitches."),
            ],
        )

        self.assertEqual(len([chunk for chunk in chunks if chunk.startswith("[TOOL_START]")]), 1)
        self.assertEqual(len([chunk for chunk in chunks if chunk.startswith("[TOOL_END]")]), 1)
        self.assertIn("[TOKEN]Static hazards are glitches.", chunks)


if __name__ == "__main__":
    unittest.main()
