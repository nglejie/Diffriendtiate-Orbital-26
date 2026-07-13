import os
import json
from typing import Optional, AsyncIterator
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage, AIMessage, ToolMessage
from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_litellm import ChatLiteLLM

from vectorstore import VectorStore
from tools import build_global_tools, build_room_tools, build_file_tool
from models import HistoryMessage
from logger import get_logger

logger = get_logger(__name__)

# Fallback Gemini Model stuff
GPU_ENABLED = os.getenv("GPU_ENABLED") == "true"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_KEY = None if GEMINI_API_KEY == "your-key-here" else GEMINI_API_KEY # check if gemini key was changed or still default
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# Ollama model stuff
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:7b")

# System Prompt
SYSTEM_PROMPT = """You are Diffriendtiate's LLM Buddy, a helpful study assistant for a shared study room. 

You have access to tools to help answer questions:
- search_corpus: searches uploaded documents in the room corpus
- read_file: reads the content of a file uploded with this request

Rules for answering:
- If the user references their notes during the query, answer strictly based on what you can retrieve or have retrieved from corpus.
- If a room_id is provided, ALWAYS call search_corpus first before answering if the question relates to the users notes
- If a file is uploaded, use read_file when the question may relate to the file
- Use both tools if needed, they may contain complementary information
- You can call search_corpus multiple times with different queries if needed
- Answer primarily from tool results, only use general knowledge if tools return no useful results
- When answering please also reply with which document the part of the response is from to help with grounding the response
- If tool return no relevant information, tell the user when replying and answer from general knowledge if possible
- Always be honest if you don't know something
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
        
        tools = build_global_tools() if enable_agent_tools else []
        if room_id and enable_agent_tools:
            tools += build_room_tools(self.vectorstore, room_id)
        if file_bytes and file_name and enable_agent_tools:
            tools += build_file_tool(file_bytes, file_name, self.vectorstore)
            
        logger.debug(f"Agent built | tools: {[t.name for t in tools]} | room_id: {room_id} | has_file: {file_bytes is not None}")
            
        @dynamic_prompt
        def generate_system_prompt_middleware(request) -> str:
            return self._build_system_prompt(room_id = room_id, has_file = file_bytes != None)
        
        return create_agent(model = llm, tools = tools, middleware = [generate_system_prompt_middleware])
    
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
            system_content += f"\n- A room corpus is available (room_id: {room_id}). If you need more context to provide an answer, you should search_corpus before answering"
        if has_file:
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
        if hasattr(message, "name") and message.name in ("search_corpus", "read_file"):
            content = self._extract_text_content(message.content)
            if content:
                for line in content.split("\n"):
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
        agent = self._build_agent(room_id = room_id, 
                                  file_bytes = file_bytes, 
                                  file_name = file_name, 
                                  enable_agent_tools = True,
                                  llm_model = llm_model,
                                  llm_api_key = llm_api_key,)
        messages = self._message_chain_to_messages(message_chain)
        
        logger.debug(f"Stream started | messages: {len(messages)} | room_id: {room_id} | custom_llm: {llm_model or 'system default'}")
        
        sources = []
        all_messages = list(messages)
        
        tool_call_in_progress = {}
        
        async for event in agent.astream_events({"messages": messages}, version="v2"):
            event_type = event["event"]
            
            # Handle model answers
            if event_type == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if (event.get("metadata", {}).get("langgraph_node") == "model" and chunk.content):
                    yield f"[TOKEN]{self._extract_text_content(chunk.content)}"
            
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
                    if source not in sources:
                        sources.append(source)
                
                tool_call_in_progress.pop(run_id, None)
                logger.info(f"Tool call complete | tool: {tool_name}")
                yield f"[TOOL_END]{json.dumps({"name": tool_name, 'result': tool_output})}"
            
            elif event_type == "on_chat_model_end":
                if event.get("metadata", {}).get("langgraph_node") == "model":
                    ai_message = event["data"]["output"]
                    if ai_message not in all_messages:
                        all_messages.append(ai_message)
            
            else: # catch any other events
                logger.debug(f"Unhandled event type: {event_type} | node: {event.get('metadata', {}).get('langgraph_node')}")
                
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
        agent = self._build_agent(room_id = room_id, 
                            file_bytes = file_bytes, 
                            file_name = file_name, 
                            enable_agent_tools = True,
                            llm_model = llm_model,
                            llm_api_key = llm_api_key,)
        messages = self._message_chain_to_messages(message_chain)
        logger.debug(f"Invoke started | messages: {len(messages)} | room_id: {room_id} | custom_llm: {llm_model or 'system default'}")
        
        result = await agent.ainvoke({"messages": messages})
        # answer = result["messages"][-1].content
        answer = self._extract_text_content(result["messages"][-1].content)
        sources = self._extract_sources(result["messages"])
        chain = self._convert_messages(result["messages"])
        
        logger.info(f"Invoke complete | surces: {sources}")
        return answer, sources, chain