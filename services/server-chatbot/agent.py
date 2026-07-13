import os
import json
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Optional, AsyncIterator
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage, AIMessage, ToolMessage
from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_litellm import ChatLiteLLM
from litellm import supports_function_calling

from vectorstore import VectorStore
from tools import build_global_tools, build_room_tools, build_file_tool
from models import HistoryMessage
from logger import get_logger

logger = get_logger(__name__)

# Fallback Gemini Model stuff
GPU_ENABLED = os.getenv("GPU_ENABLED") == "true"
PLACEHOLDER_SECRETS = {"", "your-key-here", "ci-placeholder", "qa-compose-validation-placeholder"}

def normalise_optional_secret(value: str | None) -> str | None:
    """Treat local/CI placeholders as missing secrets before provider clients see them."""
    candidate = (value or "").strip()
    return None if candidate in PLACEHOLDER_SECRETS else candidate

GEMINI_API_KEY = normalise_optional_secret(os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# Ollama model stuff
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:7b")
APP_TIMEZONE = os.getenv("APP_TIMEZONE") or os.getenv("TZ") or "Asia/Singapore"

def app_now() -> datetime:
    """Return the current app-local datetime used in model instructions."""
    try:
        timezone = ZoneInfo(APP_TIMEZONE)
    except ZoneInfoNotFoundError:
        logger.warning(f"Invalid APP_TIMEZONE={APP_TIMEZONE!r}; falling back to UTC.")
        timezone = ZoneInfo("UTC")
    return datetime.now(timezone)

# System Prompt
SYSTEM_PROMPT = """You are Diffriendtiate's LLM Buddy, a helpful study assistant for a shared study room. 

You have access to tools to help answer questions:
- search_domain_context: searches the Domain corpus across Infilenite files, Convolution messages, annotations, and Coordidate records
- search_corpus: legacy alias that searches all available Domain corpus content
- read_file: reads the content of a file uploded with this request

Rules for answering:
- If the user references their notes during the query, answer strictly based on what you can retrieve or have retrieved from corpus.
- If a room_id is provided, call search_domain_context before answering if the question may depend on Domain files, messages, annotations, meetings, schedules, or shared context
- If the user names a Domain area, channel, file, or meeting, pass the most specific available scope into search_domain_context
- If the user asks about upcoming or future meetings/events/deadlines, search Coordidate with timeframe="upcoming" or a date_from filter and do not include records before the current date
- If the user asks to search only Infilenite, Convolution, annotations, Coordidate, a channel, or a specific file, keep the search scoped to that area/source rather than searching the whole Domain
- If a file is uploaded, use read_file when the question may relate to the file
- Use both tools if needed, they may contain complementary information
- You can call search_domain_context multiple times with different queries or scopes if needed
- Answer primarily from tool results, only use general knowledge if tools return no useful results
- When answering please also reply with which document the part of the response is from to help with grounding the response
- If tool return no relevant information, tell the user when replying and answer from general knowledge if possible
- Always be honest if you don't know something
"""

NO_TOOL_SYSTEM_PROMPT = """You are Diffriendtiate's LLM Buddy, a helpful study assistant for a shared study room.

Rules for answering:
- Answer from the conversation context and general knowledge only.
- Do not claim to search, read, or call tools unless a tool result is present in the conversation.
- If the user asks for information that requires uploaded documents or room resources, explain that this model is not connected to document tools for this request.
- Always be honest if you don't know something.
"""

class Agent:
    def __init__(self, vectorstore: VectorStore):
        self.vectorstore = vectorstore
    
    def _build_LLM(self, llm_model: Optional[str] = None, llm_api_key: Optional[str] = None):
        """Build LLM instance
        LLM Priority:
        1) User provided model + key via LiteLLM
        2) Ollama (if GPU_ENABLED or no Gemini Key provided)
        3) Gemini (fallback)

        Args:
            llm_model (Optional[str], optional): the LiteLLM model string, eg. "openai/gpt-4o". Defaults to None.
            llm_api_key (Optional[str], optional): API key for the user provided model. Defaults to None.
            
        Returns:
            LangChain chat model instance
        """
        if llm_model and llm_api_key:
            logger.info(f"Using custom LLM via LiteLLM | model: {llm_model}")
            return ChatLiteLLM(model = llm_model, api_key = llm_api_key)
        
        if GPU_ENABLED or not GEMINI_API_KEY:
            logger.info(f"Using system Ollama LLM | model: {LLM_MODEL} | url: {OLLAMA_BASE_URL}")
            return ChatOllama(model = LLM_MODEL, base_url=OLLAMA_BASE_URL)
            
        logger.info(f"Using system Gemini LLM | model: {GEMINI_MODEL}")
        return ChatGoogleGenerativeAI(model=GEMINI_MODEL, google_api_key=GEMINI_API_KEY)
        
    def _build_agent(
        self, 
        room_id: Optional[str] = None, 
        file_bytes: Optional[str] = None, 
        file_name: Optional[str] = None,
        enable_agent_tools: Optional[bool] = True,
        llm_model: Optional[str] = None,
        llm_api_key: Optional[str] = None,
        source_collector: Optional[list] = None,
    ):
        """Build a Langgraph agent with tools
        Global tools are always included
        Room tools only if room_id is provided
        File tool added if file_content is provided

        Args:
            room_id (Optional[str], optional): _description_. Defaults to None.
            file_bytes (Optional[bytes]): raw bytes of uploaded file. Defaults to None.
            file_name (Optional[str]): name of uploaded file. Defaults to None
            enable_agent_tools (Optional[bool]): Enable tools for models to use. Defaults to None
            llm_model (Optional[str]): custom LiteLLM model string. Defaults to None
            llm_api_key (Optional[str]): API key for custom model. Defaults to None
        """
        llm = self._build_LLM(llm_model = llm_model, llm_api_key = llm_api_key)
        effective_tools_enabled = enable_agent_tools
        if llm_model and llm_api_key and enable_agent_tools:
            try:
                effective_tools_enabled = supports_function_calling(model=llm_model)
            except Exception as error:
                logger.warning(
                    f"Unable to verify BYOK tool support; attempting tools anyway | model: {llm_model} | error: {error}"
                )
                effective_tools_enabled = True
            if not effective_tools_enabled:
                logger.info(f"BYOK model does not advertise tool calling support | model: {llm_model}")
        
        tools = build_global_tools() if effective_tools_enabled else []
        if room_id and effective_tools_enabled:
            tools += build_room_tools(self.vectorstore, room_id, source_collector=source_collector)
        if file_bytes and file_name and effective_tools_enabled:
            tools += build_file_tool(file_bytes, file_name, self.vectorstore, source_collector=source_collector)
            
        prompt_room_id = room_id if effective_tools_enabled else None
        prompt_has_file = bool(file_bytes and file_name and effective_tools_enabled)
        logger.debug(f"Agent built | tools: {[t.name for t in tools]} | room_id: {room_id} | has_file: {file_bytes is not None}")
            
        @dynamic_prompt
        def generate_system_prompt_middleware(request) -> str:
            return self._build_system_prompt(
                room_id = prompt_room_id,
                has_file = prompt_has_file,
                tools_enabled = effective_tools_enabled,
            )
        
        return create_agent(model = llm, tools = tools, middleware = [generate_system_prompt_middleware])
    
    def _build_system_prompt(
        self,
        has_file: bool = False,
        room_id: Optional[str] = None,
        tools_enabled: bool = True,
    ) -> list:
        """Build system prompt, letting the model know if there is uploaded file or corpus available

        Args:
            has_file (Optional[bool], optional): whether a file was uploaded. Defaults to False.
            room_id (Optional[str], optional): the room_id of the convo (if any). Defaults to None

        Returns:
            list: List of messages
        """
        system_content = SYSTEM_PROMPT if tools_enabled else NO_TOOL_SYSTEM_PROMPT
        
        # Additional context
        system_content += "\n\n Additional Context for this request (if any):"
        now = app_now()
        system_content += f"\n- Current app date: {now.date().isoformat()} ({APP_TIMEZONE})."
        
        if tools_enabled and room_id:
            system_content += f"\n- A Domain corpus is available (room_id: {room_id}). If you need more context to provide an answer, you should search_domain_context before answering"
        if tools_enabled and has_file:
            system_content += "\n- A file has been uploaded. Use read_file to access its content when relevant."
            
        return system_content
    
    def _extract_text_content(self, content) -> Optional[str]:
        """Nomralize message content into string
        Gemini return content generated as list of content blocks instead of string

        Args:
            content (_type_): the content to convert, in str or list format

        Returns:
            Optional[str]: the converted content to str
        """
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    parts.append(block)
            text = "".join(parts)
            return text

        return str(content) if content else None

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
            # content = msg.content if msg.content else None
            content = self._extract_text_content(msg.content)
            
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
        if hasattr(message, "name") and message.name in ("search_domain_context", "search_corpus", "read_file"):
            content = self._extract_text_content(message.content)
            if content:
                for line in content.split("\n"):
                    if line.startswith("[Source:"):
                        source = line.replace("[Source:", "").replace("]", "").strip()
                        sources.append(source)
        return sources

    def _source_key(self, source) -> str:
        """Build a stable key for string and structured source refs."""
        if isinstance(source, dict):
            return "|".join(
                str(source.get(key) or "")
                for key in ("type", "resourceId", "messageId", "annotationId", "sessionId", "pollId", "sourceId", "pageNumber", "slideNumber")
            )
        return str(source or "").strip().lower()

    def _append_unique_source(self, sources: list, source):
        """Append a source ref without duplicating the same chunk/source."""
        key = self._source_key(source)
        if not key:
            return
        if any(self._source_key(existing) == key for existing in sources):
            return
        sources.append(source)

    def _merge_collected_sources(self, sources: list, collected_sources: list):
        """Merge tool-side structured refs into the stream/non-stream source list."""
        for source in collected_sources:
            self._append_unique_source(sources, source)
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
                logger.warning(f"Unhandled role in message chain (omitted) | role: {item.role}")
                # print(f'DEBUG: Not handled message in message chain (message omitted). role: {item.role} | content: {item.content}')
        
        return messages
        
    async def stream(
        self, 
        message_chain: list[HistoryMessage], 
        room_id: Optional[str] = None, 
        file_bytes: Optional[bytes] = None, 
        file_name: Optional[str] = None,
        llm_model: Optional[str] = None,
        llm_api_key: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """Stream the agents responsetoken by token

        Args:
            message_chain (list[HistoryMessage]): the full message_chain between user and assistant, with the last message being current prompt
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_bytes (Optional[bytes], optional): raw bytes of uploaded file (if any). Defaults to None.
            file_name (Optional[str]), optional): file name of uploaded file (if any). Defaults to None.
            llm_model (Optional[str]): custom LiteLLM model string. Defaults to None
            llm_api_key (Optional[str]): API key for custom model. Defaults to None

        Returns:
            AsyncIterator[str]: yields generated string chunks, tagged with [TOKEN], [TOOL_START], [TOOL_END], [SOURCES, [CHAIN], [DONE]
        """
        source_collector = []
        agent = self._build_agent(room_id = room_id, 
                                  file_bytes = file_bytes, 
                                  file_name = file_name, 
                                  enable_agent_tools = True,
                                  llm_model = llm_model,
                                  llm_api_key = llm_api_key,
                                  source_collector = source_collector,)
        messages = self._message_chain_to_messages(message_chain)
        
        logger.debug(f"Stream started | messages: {len(messages)} | room_id: {room_id} | custom_llm: {llm_model or 'system default'}")
        
        sources = []
        all_messages = list(messages)
        streamed_answer_parts = []
        
        tool_call_in_progress = {}
        
        async for event in agent.astream_events({"messages": messages}, version="v2"):
            event_type = event["event"]
            
            # Handle model answers
            if event_type == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if (event.get("metadata", {}).get("langgraph_node") == "model" and chunk.content):
                    token_text = self._extract_text_content(chunk.content)
                    streamed_answer_parts.append(token_text)
                    yield f"[TOKEN]{token_text}"
            
            # Handle Tool starting
            elif event_type == "on_tool_start":
                run_id = event["run_id"]
                tool_name = event["name"]
                args = event["data"].get("input", {})
                
                tool_call_in_progress[run_id] = {"name": tool_name, "args": args}
                logger.info(f"Tool call started | tool: {tool_name} | args: {args})")
                yield f"[TOOL_START]{json.dumps({'name': tool_name, "args": args})}"
                    
            # Handle tool ending
            elif event_type == "on_tool_end":
                run_id = event["run_id"]
                tool_name = event["name"]
                tool_output = event["data"].get("output", "")
                
                if hasattr(tool_output, "content"):
                    tool_output = tool_output.content
                    
                tool_message = ToolMessage(content = tool_output, 
                                           name = tool_name, 
                                           tool_call_id = run_id,)
                all_messages.append(tool_message)
                
                # Store all sources given by tool
                for source in self._extract_sources_from_message(tool_message):
                    self._append_unique_source(sources, source)
                self._merge_collected_sources(sources, source_collector)
                
                tool_call_in_progress.pop(run_id, None)
                logger.info(f"Tool call complete | tool: {tool_name}")
                yield f"[TOOL_END]{json.dumps({"name": tool_name, 'result': tool_output})}"
            
            elif event_type == "on_chat_model_end":
                if event.get("metadata", {}).get("langgraph_node") == "model":
                    ai_message = event["data"]["output"]
                    if ai_message not in all_messages:
                        all_messages.append(ai_message)
                    final_text = self._extract_text_content(getattr(ai_message, "content", ""))
                    if final_text and not "".join(streamed_answer_parts).strip():
                        # Some LiteLLM providers produce a final message without token chunks.
                        # Emit it once so the web UI never has to invent a fallback answer.
                        logger.debug("Model produced final content without token chunks; emitting final text once.")
                        yield f"[TOKEN]{final_text}"
            
            else: # catch any other events
                logger.debug(f"Unhandled event type: {event_type} | node: {event.get('metadata', {}).get('langgraph_node')}")
                
        self._merge_collected_sources(sources, source_collector)
        logger.info(f"Stream complete | sources: {sources}")
        yield f"[SOURCES]{json.dumps(sources)}" # return sources after all tokens
        yield f"[CHAIN]{json.dumps(self._convert_messages(all_messages))}"
        yield f"[DONE]"
                
    async def invoke(
        self, 
        message_chain: list[HistoryMessage], 
        room_id: Optional[str] = None, 
        file_bytes: Optional[bytes] = None, 
        file_name: Optional[str] = None,
        llm_model: Optional[str] = None,
        llm_api_key: Optional[str] = None,
    ) -> tuple[str, list[str], list[dict]]:
        """Non-streaming invoke, returns full answer, sources, and message chain

        Args:
            message_chain (list[HistoryMessage]): the full message_chain between user and assistant, with the last message being current prompt
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_bytes (Optional[bytes], optional): the raw bytes of uploaded file (if any). Defaults to None.
            file_name (Optional[str], optional): the name of the uploaded file (if any). Defaults to None

        Returns:
            tuple[str, list[str], list[dict]]: LLM response, list of sources, message chain
        """
        # BYOK providers currently answer from chat history only. The RAG tools
        # rely on system embeddings and should not run with a member API key.
        source_collector = []
        agent = self._build_agent(room_id = room_id,
                            file_bytes = file_bytes,
                            file_name = file_name,
                            enable_agent_tools = True,
                            llm_model = llm_model,
                            llm_api_key = llm_api_key,
                            source_collector = source_collector,)
        messages = self._message_chain_to_messages(message_chain)
        logger.debug(f"Invoke started | messages: {len(messages)} | room_id: {room_id} | custom_llm: {llm_model or 'system default'}")
        
        result = await agent.ainvoke({"messages": messages})
        # answer = result["messages"][-1].content
        answer = self._extract_text_content(result["messages"][-1].content)
        sources = self._merge_collected_sources(self._extract_sources(result["messages"]), source_collector)
        chain = self._convert_messages(result["messages"])
        
        logger.info(f"Invoke complete | surces: {sources}")
        return answer, sources, chain
