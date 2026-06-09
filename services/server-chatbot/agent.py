import os
import json
from typing import Optional, AsyncIterator
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage, AIMessage, ToolMessage
from langgraph.prebuilt import create_react_agent

from vectorstore import VectorStore
from tools import build_global_tools, build_room_tools, build_file_tool

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:7b")


SYSTEM_PROMPT = """You are a helpful study assistant. 

You have access to tools to help answer questions:
- search_corpus: searches uploaded documents in the room corpus
- read_file: reads the content of a file uploded with this request

Rules for answering:
- If a room_id is provided, ALWAYS call search_corpus first before answering
- If a file is uploaded, use read_file when the question may relate to the file
- Use both tools if needed, they may contain complementary information
- You can call search_corpus multiple times with different queries if needed
- Answer primarily from tool results, only use general knowledge if tools return no useful results
- If tool return no relevant information, tell the user when replying and answer from general knowledge if possible
- Always be honest if you don't know something
"""

class Agent:
    def __init__(self, vectorstore: VectorStore):
        self.vectorstore = vectorstore
        self.llm = ChatOllama(
            model = LLM_MODEL,
            base_url=OLLAMA_BASE_URL,
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
            
        return create_react_agent(self.llm, tools)
    
    def _build_messages(self, question: str, has_file: bool = False, room_id: Optional[str] = None) -> list:
        """Build message list, including file content into system prompt if present

        Args:
            question (str): question to answer
            has_file (Optional[bool], optional): whether a file was uploaded. Defaults to False.
            room_id (Optional[str], optional): the room_id of the convo (if any). Defaults to None

        Returns:
            list: List of messages
        """
        system_content = SYSTEM_PROMPT
        
        # Additional context
        system_content += "\n\n Additional Context for this request (if any):"
        
        if room_id:
            system_content += f"\n- A room corpus is available (room_id: {room_id}). You SHOULD call search_corpus before answering"
        if has_file:
            system_content += "\n- A file has been uploaded. Use read_file to access its content when relevant."
            
        return [
            SystemMessage(content=system_content),
            HumanMessage(content=question),
        ]

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
        
    async def stream(self, question: str, room_id: Optional[str] = None, file_bytes: Optional[bytes] = None, file_name: Optional[str] = None) -> AsyncIterator[str]:
        """Stream the agents responsetoken by token

        Args:
            question (str): the question to answer
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_bytes (Optional[bytes], optional): raw bytes of uploaded file (if any). Defaults to None.
            file_name (Optional[str]), optional): file name of uploaded file (if any). Defaults to None.

        Returns:
            AsyncIterator[str]: yields generated string chunks, before yielding a [SOURCES] chunk, ending with a [DONE] indicating end of generation
        """
        agent = self._build_agent(room_id = room_id, file_bytes = file_bytes, file_name = file_name)
        messages = self._build_messages(question, has_file= file_bytes != None, room_id = room_id)
        sources = []
        all_messages = list(messages)
        
        tool_call_in_progress = {}
        
        async for event in agent.astream_events({"messages": messages}, version="v2"):
            # print(event)
            event_type = event["event"]
            
            # Handle model answers
            if event_type == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if (event.get("metadata", {}).get("langgraph_node") == "agent" and chunk.content):
                    yield f"[TOKEN]{chunk.content}"
            
            # Handle Tool starting
            elif event_type == "on_tool_start":
                run_id = event["run_id"]
                tool_name = event["name"]
                args = event["data"].get("input", {})
                
                tool_call_in_progress[run_id] = {"name": tool_name, "args": args}
                
                yield f"[TOOL_START]{json.dumps({'name': tool_name, "aegs": args})}"
                    
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
                
                yield f"[TOOL_END]{json.dumps({"name": tool_name, 'result': tool_output})}"
            
            elif event_type == "on_chat_model_end":
                if event.get("metadata", {}).get("langgraph_node") == "agent":
                    ai_message = event["data"]["output"]
                    if ai_message not in all_messages:
                        all_messages.append(ai_message)
                
        # return sources after all tokens
        yield f"[SOURCES]{json.dumps(sources)}"
        
        yield f"[CHAIN]{json.dumps(self._convert_messages(all_messages))}"
        
        yield f"[DONE]"
                
    async def invoke(self, question: str, room_id: Optional[str] = None, file_bytes: Optional[bytes] = None, file_name: Optional[str] = None) -> tuple[str, list[str], list[dict]]:
        """Non-streaming invoke, returns full answer, sources, and message chain

        Args:
            question (str): the question to answer
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_bytes (Optional[bytes], optional): the raw bytes of uploaded file (if any). Defaults to None.
            file_name (Optional[str], optional): the name of the uploaded file (if any). Defaults to None

        Returns:
            tuple[str, list[str], list[dict]]: LLM response, list of sources, message chain
        """
        agent = self._build_agent(room_id = room_id, file_bytes = file_bytes, file_name = file_name)
        messages = self._build_messages(question, has_file = file_bytes != None, room_id = room_id)
        
        result = await agent.ainvoke({"messages": messages})
        answer = result["messages"][-1].content
        sources = self._extract_sources(result["messages"])
        chain = self._convert_messages(result["messages"])
                            
        return answer, sources, chain