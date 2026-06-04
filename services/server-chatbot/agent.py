import os
import json
from typing import Optional, AsyncIterator
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage
from langgraph.prebuilt import create_react_agent

from vectorstore import VectorStore
from tools import build_global_tools, build_room_tools

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:7b")


SYSTEM_PROMPT = """You are a helpful study assistant. 

You have access to a search_corpus tool that searches uploaded study documents.
- Use search_corpus when the question might relate to course materials or uploaded documents
- You can search multiple times with different queries if needed
- If the context doesn't contain enough information, say so honestly and answer from general knowledge if you can.
- Always be honest if you don't know something

If file content is provided below, this is a user uploaded file not in corpus that could provide additional information to help answer the question
- Note that the file content might not be able to answer the question provided, in which case you should still search the corpus for information
"""


class Agent:
    def __init__(self, vectorstore: VectorStore):
        self.vectorstore = vectorstore
        self.llm = ChatOllama(
            model = LLM_MODEL,
            base_url=OLLAMA_BASE_URL,
        )
        
    def _build_agent(self, room_id: Optional[str] = None):
        """Build a Langgraph agent with tools
        
        Add room specific tools only if room id is provided

        Args:
            room_id (Optional[str], optional): _description_. Defaults to None.
        """
        tools = build_global_tools()
        if room_id:
            tools += build_room_tools(self.vectorstore, room_id)
        return create_react_agent(self.llm, tools)
    
    def _build_messages(self, question: str, file_content: Optional[str] = None,) -> list:
        """Build message list, including file content into system prompt if present

        Args:
            question (str): question to answer
            file_content (Optional[str], optional): content of uploaded file (if any). Defaults to None.

        Returns:
            list: List of messages
        """
        system_content = SYSTEM_PROMPT
        if file_content:
            system_content += f"n\n--- Attached File Content ---\n{file_content}\n---End of File---"
            
        return [
            SystemMessage(content=system_content),
            HumanMessage(content=question),
        ]
        
    def _extract_sources_from_message(self, message: BaseMessage) -> list[str]:
        """Extract sources from a single message

        Args:
            message (BaseMessage): a langgraph message

        Returns:
            list[str]: a list of sources filenames found in the message
        """
        sources = []
        if hasattr(message, "name") and message.name == "search_corpus":
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
        
    async def stream(self, question: str, room_id: Optional[str] = None, file_content: Optional[str] = None,) -> AsyncIterator[str]:
        """Stream the agents responsetoken by token

        Args:
            question (str): the question to answer
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_content (Optional[str], optional): the content of uploaded file (if any). Defaults to None.

        Returns:
            AsyncIterator[str]: yields generated string chunks, before yielding all sources
        """
        agent = self._build_agent(room_id=room_id)
        messages = self._build_messages(question, file_content=file_content)
        sources = []
        
        async for chunk in agent.astream(
            {"messages": messages},
            stream_mode="messages",
        ):
            message, metadata = chunk
            
            # store sources from tool
            for source in self._extract_sources_from_message(message):
                if source not in sources:
                    sources.append(source)
            
            # stream answers
            if (metadata.get("langgraph_node") == "agent" and hasattr(message, "content") and message.content):
                yield message.content
                
        # return sources after all tokens
        yield f"[SOURCES]{json.dumps(sources)}"
                
    async def invoke(self, question: str, room_id: Optional[str] = None, file_content: Optional[str] = None,) -> tuple[str, list[str]]:
        """Non-streaming invoke, returns full answer and sources

        Args:
            question (str): the question to answer
            room_id (Optional[str], optional): the room id scope. Defaults to None.
            file_content (Optional[str], optional): the content of uploaded file (if any). Defaults to None.

        Returns:
            tuple[str, list[str]]: LLM response, list of sources
        """
        agent = self._build_agent(room_id=room_id)
        
        messages = self._build_messages(question, file_content=file_content)
        
        result = await agent.ainvoke({"messages": messages})
        answer = result["messages"][-1].content
        sources = self._extract_sources(result["messages"])
                            
        return answer, sources