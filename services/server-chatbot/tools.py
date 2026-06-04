from langchain_core.tools import tool

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
        docs = vectorstore.search(query=query, room_id = room_id)
        
        print("ROOM:", room_id)
        print("DOCS FOUND:", len(docs))
        
        if not docs:
            return "No relevant documents found in the corpus for this room"
        
        results = []
        for doc in docs:
            source = doc.metadata.get("file_name", "unknown")
            results.append(f"[Source: {source}\n{doc.page_content}]")
        
        return "\n\n---\n\n".join(results)
    
    return [search_corpus]

def build_global_tools() -> list:
    """Tools that work regardless of room

    Currently nothing implemented (possible web search tool)
    
    Returns:
        list: list of global tools available
    """
    return []