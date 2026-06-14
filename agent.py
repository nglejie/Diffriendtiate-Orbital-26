import os
import json
import re
from typing import Optional, AsyncIterator
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage, AIMessage, ToolMessage
from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt

from vectorstore import VectorStore
from tools import build_global_tools, build_room_tools, build_file_tool
from models import HistoryMessage

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:7b")
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")
CONTEXT_CHAR_LIMIT = int(os.getenv("CONTEXT_CHAR_LIMIT", "16000"))
SOURCE_STOP_WORDS = {
    "about", "after", "again", "also", "answer", "because", "before", "being",
    "could", "document", "documents", "friend", "friends", "from", "have",
    "into", "only", "question", "reply", "room", "should", "source", "that",
    "their", "there", "these", "this", "with", "would", "your",
}


SYSTEM_PROMPT = """You are Diffriendtiate's LLM Buddy, a helpful study assistant for a shared study room.

You have access to tools to help answer questions:
- search_corpus: searches uploaded documents in the room corpus
- read_file: reads the content of a file uploaded with this request

Rules for answering:
- If a room_id is provided, ALWAYS call search_corpus first before answering
- If a file is uploaded, use read_file when the question may relate to the file
- If direct room or file context is included in the conversation, use it before relying on tools
- Use both tools if needed, they may contain complementary information
- You can call search_corpus multiple times with different queries if needed
- Answer primarily from tool results, only use general knowledge if tools return no useful results
- If tools return no relevant information, briefly say the room documents did not contain enough information before using general knowledge
- Always be honest if you don't know something
- Return only the final answer that the student should read
- Do not reveal chain-of-thought, hidden reasoning, tool traces, search plans, or phrases like "let me check"
- Do not mention tool names unless the user explicitly asks how you found the answer
- Preserve normal spacing, paragraphs, and bullet formatting
- When giving steps, use a numbered list with each item on its own line
"""

DIRECT_SYSTEM_PROMPT = """You are Diffriendtiate's LLM Buddy, a helpful study assistant for a shared study room.

Rules for answering:
- Use the provided room or file context first when it answers the question
- Answer primarily from the provided context, only use general knowledge if the context is missing or insufficient
- If room context is unavailable or irrelevant, briefly say the room documents did not contain enough information before using general knowledge
- Always be honest if you do not know something
- Return only the final answer that the student should read
- Do not reveal chain-of-thought, hidden reasoning, search plans, or phrases like "let me check"
- Preserve normal spacing, paragraphs, and bullet formatting
- When giving steps, use a numbered list with each item on its own line
"""

class Agent:
    def __init__(self, vectorstore: VectorStore):
        self.vectorstore = vectorstore
        self.llm = ChatOllama(
            model = LLM_MODEL,
            base_url=OLLAMA_BASE_URL,
            keep_alive=OLLAMA_KEEP_ALIVE,
        )
        
    def _build_agent(self, room_id: Optional[str] = None, file_bytes: Optional[str] = None, file_name: Optional[str] = None):
        """Build a Langgraph agent with tools
        Global tools are always included
        Room tools only if room_id is provided
        File tool added if file_content is provided

        Args:
            room_id (Optional[str], optional): _description_. Defaults to None.
            file_bytes (Optional[bytes]): raw bytes of uploaded file. Defaults to None.
            file_name = (Optional[str]): name of uploaded file. Defaults to None
        """
        tools = build_global_tools()
        if room_id:
            tools += build_room_tools(self.vectorstore, room_id)
        if file_bytes and file_name:
            tools += build_file_tool(file_bytes, file_name, self.vectorstore)
            
        @dynamic_prompt
        def generate_system_prompt_middleware(request) -> str:
            return self._build_system_prompt(room_id = room_id, has_file = file_bytes != None)
        
        return create_agent(model = self.llm, tools = tools, middleware = [generate_system_prompt_middleware])
    
    def _build_system_prompt(self, has_file: bool = False, room_id: Optional[str] = None) -> list:
        """Build system prompt, letting the model know if there is uploaded file or corpus available

        Args:
            has_file (Optional[bool], optional): whether a file was uploaded. Defaults to False.
            room_id (Optional[str], optional): the room_id of the convo (if any). Defaults to None

        Returns:
            list: List of messages
        """
        system_content = SYSTEM_PROMPT
        
        # Additional context
        system_content += "\n\n Additional Context for this request (if any):"
        
        if room_id:
            system_content += f"\n- A room corpus is available (room_id: {room_id}). Call search_corpus before answering and use retrieved room content when it is relevant."
        if has_file:
            system_content += "\n- A file has been uploaded. Use read_file to access its content when relevant."
            
        return system_content

    def _build_direct_system_prompt(
        self,
        has_context: bool = False,
        has_file: bool = False,
        room_id: Optional[str] = None,
    ) -> str:
        """Build a non-agent prompt for direct model streaming.

        The streamed path injects retrieved context before calling the model, so
        it does not need a tool-calling agent. This keeps the first answer token
        responsive while still grounding answers in the room corpus.
        """
        system_content = DIRECT_SYSTEM_PROMPT

        if room_id:
            system_content += f"\n- This answer is scoped to room_id: {room_id}."
        if has_context:
            system_content += "\n- Relevant context has been inserted before the latest question."
        if has_file:
            system_content += "\n- The uploaded file content has been inserted when readable."

        return system_content

    def _convert_messages(self, messages: list) -> list[dict]:
        """Convert LangGraph messages into dictionary for response

        Args:
            messages (list): list of LangGraph messages

        Returns:
            list[dict]: convert messages with type, role, content, tool_name, tool_calls
        """
        output = []
        for msg in messages:
            if isinstance(msg, SystemMessage):
                msg_type = "SystemMessage"
                role = "system"
            elif isinstance(msg, HumanMessage):
                msg_type = "HumanMessage"
                role = "user"
            elif isinstance(msg, AIMessage):
                msg_type = "AIMessage"
                role = "assistant"
            elif isinstance(msg, ToolMessage):
                msg_type = "ToolMessage"
                role = "tool"
            else:
                msg_type = "unknown"
                role = "unknown"
        
            # tools
            tool_calls = None
            if isinstance(msg, AIMessage)  and msg.tool_calls:
                tool_calls = [
                    {"name": tool["name"], "args": tool["args"]} for tool in msg.tool_calls
                ]
            
            tool_name = getattr(msg, "name", None)
            
            # message content
            content = msg.content if msg.content else None
            
            output.append({
                "type": msg_type,
                "role": role,
                "tool_name": tool_name,
                "content": content,
                "tool_calls": tool_calls,
            })
        
        return output
        
    def _extract_sources_from_message(self, message: BaseMessage) -> list[str]:
        """Extract sources from a single message

        Args:
            message (BaseMessage): a langgraph message

        Returns:
            list[str]: a list of sources filenames found in the message
        """
        sources = []
        if hasattr(message, "name") and message.name in ("search_corpus", "read_file"):
                for line in message.content.split("\n"):
                    if line.startswith("[Source:"):
                        source = line.replace("[Source:", "").replace("]", "").strip()
                        sources.append(source)
        return sources
        
    def _extract_sources(self, messages: list) -> list[str]:
        """Extract unique source filenames from a list of messages

        Args:
            messages (list): the message list to extract sources from

        Returns:
            list[str]: all of sources
        """
        # Extract Sources from tool call results
        sources = []
        for msg in messages:
            for source in self._extract_sources_from_message(msg):
                if source not in sources:
                    sources.append(source)
        return sources

    def _message_chain_to_messages(self, message_chain: list[HistoryMessage]) -> list:
        """ Convert generic messages into langchain messages to parse into model

        Args:
            message_chain (list[HistoryMessage]): full list of HistoryMessage objects, each HistoryMessage is a message in the conversation

        Returns:
            list: list of HistoryMessage converted to HumanMessage and AIMessages
        """
        messages = []
        for item in message_chain:
            if item.role == 'user':
                messages.append(HumanMessage(content = item.content))
            elif item.role == 'assistant':
                messages.append(AIMessage(content = item.content))
            else:
                print(f'DEBUG: Not handled message in message chain (message omitted). role: {item.role} | content: {item.content}')
        
        return messages

    def _last_user_query(self, message_chain: list[HistoryMessage]) -> str:
        """Return the latest user question used to retrieve room context."""
        for item in reversed(message_chain):
            if item.role == "user":
                return item.content or ""
        return ""

    def _clip_context(self, text: str) -> str:
        """Keep injected context within a predictable size for local models."""
        if len(text) <= CONTEXT_CHAR_LIMIT:
            return text
        return f"{text[:CONTEXT_CHAR_LIMIT]}\n\n[Context truncated because the source is long.]"

    def _source_tokens(self, text: str) -> set[str]:
        """Return meaningful lowercase tokens for source matching."""
        return {
            token
            for token in re.findall(r"[a-zA-Z][a-zA-Z0-9']{2,}", text.lower())
            if token not in SOURCE_STOP_WORDS and len(token) >= 3
        }

    def _filter_answer_sources(
        self,
        answer: str,
        candidates: list[dict],
        fallback_sources: list[str],
    ) -> list[str]:
        """Keep source chips focused on documents that support the final answer."""
        answer_text = (answer or "").strip()
        answer_tokens = self._source_tokens(answer_text)
        matched = []

        for candidate in candidates:
            source = candidate["source"]
            content = candidate["content"].lower()
            source_tokens = self._source_tokens(candidate["content"])
            score = len(answer_tokens.intersection(source_tokens))

            if answer_text and len(answer_text) >= 4 and answer_text.lower() in content:
                score += 4

            if score > 0 and source not in matched:
                matched.append(source)

        if matched:
            return matched

        return fallback_sources

    def _build_direct_context(
        self,
        message_chain: list[HistoryMessage],
        room_id: Optional[str] = None,
        file_bytes: Optional[bytes] = None,
        file_name: Optional[str] = None,
    ) -> tuple[list[BaseMessage], list[str], list[dict]]:
        """Convert history to messages and inject retrieved file/room context.

        The agent still has tools available, but providing the most relevant
        context directly makes short factual file questions reliable instead
        of depending on whether the model decides to call a tool.
        """
        messages = self._message_chain_to_messages(message_chain)
        query = self._last_user_query(message_chain)
        context_blocks = []
        sources = []
        source_candidates = []

        if room_id and query:
            try:
                docs = self.vectorstore.search(query=query, room_id=room_id)
            except Exception as error:
                print(f"DEBUG: room context retrieval failed: {error}")
                docs = []

            for index, doc in enumerate(docs, start=1):
                source = doc.metadata.get("file_name", "Room document")
                if source not in sources:
                    sources.append(source)
                source_candidates.append({
                    "source": source,
                    "content": doc.page_content,
                })
                context_blocks.append(
                    f"Room document {index} [Source: {source}]\n{doc.page_content}"
                )

        if file_bytes and file_name:
            try:
                file_content = self.vectorstore.load_file_content_from_bytes(file_bytes, file_name)
                if file_name not in sources:
                    sources.insert(0, file_name)
                source_candidates.insert(0, {
                    "source": file_name,
                    "content": file_content,
                })
                context_blocks.insert(
                    0,
                    f"Attached file [Source: {file_name}]\n{file_content}",
                )
            except Exception as error:
                print(f"DEBUG: direct file context extraction failed: {error}")

        if not context_blocks:
            return messages, sources, source_candidates

        context_text = self._clip_context(
            "\n\n---\n\n".join(context_blocks)
        )
        context_message = HumanMessage(
            content=(
                "Relevant context for the next question is provided below. "
                "Use it first when it answers the question. Return only the final answer.\n\n"
                f"{context_text}"
            )
        )

        if messages:
            return [*messages[:-1], context_message, messages[-1]], sources, source_candidates
        return [context_message], sources, source_candidates
        
    async def stream(self, message_chain: list[HistoryMessage], room_id: Optional[str] = None, file_bytes: Optional[bytes] = None, file_name: Optional[str] = None) -> AsyncIterator[str]:
        """Stream the agents responsetoken by token

        Args:
            message_chain (list[HistoryMessage]): the full message_chain between user and assistant, with the last message being current prompt
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_bytes (Optional[bytes], optional): raw bytes of uploaded file (if any). Defaults to None.
            file_name (Optional[str]), optional): file name of uploaded file (if any). Defaults to None.

        Returns:
            AsyncIterator[str]: yields generated string chunks, before yielding a [SOURCES] chunk, ending with a [DONE] indicating end of generation
        """
        messages, sources, source_candidates = self._build_direct_context(
            message_chain=message_chain,
            room_id=room_id,
            file_bytes=file_bytes,
            file_name=file_name,
        )
        answer_chunks = []

        model_messages = [
            SystemMessage(
                content=self._build_direct_system_prompt(
                    has_context=bool(source_candidates),
                    has_file=bool(file_bytes and file_name),
                    room_id=room_id,
                )
            ),
            *messages,
        ]

        async for chunk in self.llm.astream(model_messages):
            if chunk.content:
                answer_chunks.append(chunk.content)
                yield f"[TOKEN]{chunk.content}"
                
        # Show the files that actually support the final answer when that can be inferred.
        answer_text = "".join(answer_chunks)
        yield f"[SOURCES]{json.dumps(self._filter_answer_sources(answer_text, source_candidates, sources))}"
        
        yield f"[CHAIN]{json.dumps(self._convert_messages([*messages, AIMessage(content=answer_text)]))}"
        
        yield f"[DONE]"
                
    async def invoke(self, message_chain: list[HistoryMessage], room_id: Optional[str] = None, file_bytes: Optional[bytes] = None, file_name: Optional[str] = None) -> tuple[str, list[str], list[dict]]:
        """Non-streaming invoke, returns full answer, sources, and message chain

        Args:
            message_chain (list[HistoryMessage]): the full message_chain between user and assistant, with the last message being current prompt
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_bytes (Optional[bytes], optional): the raw bytes of uploaded file (if any). Defaults to None.
            file_name (Optional[str], optional): the name of the uploaded file (if any). Defaults to None

        Returns:
            tuple[str, list[str], list[dict]]: LLM response, list of sources, message chain
        """
        messages, direct_sources, source_candidates = self._build_direct_context(
            message_chain=message_chain,
            room_id=room_id,
            file_bytes=file_bytes,
            file_name=file_name,
        )

        model_messages = [
            SystemMessage(
                content=self._build_direct_system_prompt(
                    has_context=bool(source_candidates),
                    has_file=bool(file_bytes and file_name),
                    room_id=room_id,
                )
            ),
            *messages,
        ]

        result = await self.llm.ainvoke(model_messages)
        answer = result.content
        sources = direct_sources
        sources = self._filter_answer_sources(answer, source_candidates, sources)
        chain = self._convert_messages([*messages, result])
                            
        return answer, sources, chain
