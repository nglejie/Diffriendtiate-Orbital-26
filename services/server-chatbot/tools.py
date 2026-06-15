from langchain_core.tools import tool

def build_file_tool(file_bytes: bytes, file_name: str, vectorstore):
    """Tool for accessing uploaded file content
    Built if file is uploaded manually thorugh calling API with file attached
    Uses a cache so the file is processed once even if multiple calls are made

    Args:
        file_content (bytes): raw bytes of uploaded file
        file_name (str): name of uploaded file
        vectorstore: used to extract text from bytes

    Returns:
        list: list containing read_file tool
    """
    cache = {}
    
    @tool
    def read_file(reason: str) -> str:
        """Read the content of the uploaded file
        Use this when the question may relate to the uploaded file or when you need to reference its content.
        
        Args:
            reason (str): reason why you are accessing the file

        Returns:
            str: the full content of uploaded file
        """
        print(f"---Using Read File Tool: {reason}---")
        if "content" not in cache:
            cache["content"] = vectorstore.load_file_content_from_bytes(file_bytes, file_name)
            
        return f"[Source: {file_name}]\n{cache['content']}"
    
    return [read_file]

def build_room_tools(vectorstore, room_id: str) -> list:
    """Define the tools available to the agentic LLM that require a room scope

    Args:
        vectorstore (_type_): used for search corpus (RAG)
        room_id (str): the room id of the request

    Returns:
        list: list of room tools available to model
    """
    
    @tool
    def search_corpus(query: str) -> str:
        """RAG Tool, searches for relevant content from corpus if present and returns hem to the model

        Args:
            query (str): query to RAG based off of

        Returns:
            str: results of the retrieval
        """
        print("---Using Search Corpus Tool---")
        print(f"Search Query: {query}")
        docs = vectorstore.search(query=query, room_id = room_id)
        
        print("Room:", room_id)
        print("Docs Found:", len(docs))
        
        if not docs:
            return "No relevant documents found in the corpus for this room"
        
        results = []
        for doc in docs:
            source = doc.metadata.get("file_name", "unknown")
            results.append(f"[Source: {source}]\n{doc.page_content}")
        
        return "\n\n---\n\n".join(results)
    
    return [search_corpus]

def build_global_tools() -> list:
    """Tools that work regardless of room

    Currently nothing implemented (possible web search tool)
    
    Returns:
        list: list of global tools available
    """
    return []