from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import tempfile
import os
 
from vectorstore import VectorStore
from agent import Agent
 
# Init Application
app = FastAPI(title="Diffriendtiate Chat API")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
 
# Init RAG pipeline (loads ChromaDB on startup)
store = VectorStore()
agent = Agent(vectorstore=store)

# --- Request/Response Models ---

class EmbedRequest(BaseModel):
    room_id: str
    urls: list[str]
 
class EmbedResponse(BaseModel):
    result: bool
    success: list[str]
    failed: list[dict]
    total_chunks: int

class PredictResponse(BaseModel):
    answer: str
    sources: list[str] = []
    message_chain: list[dict] = []

# --- Routes ---

@app.get("/health")
async def check_health():
    """
    Check Health of Server
    
    Returns:
        dict[str, str]: server health
    """
    return {"message": "Success"}

@app.post("/embed", response_model = EmbedResponse)
async def embed_documents(body: EmbedRequest):
    """
    Fetch files from Node Server and embed them into ChromaDB for a room.
    Wipes existing corpus for the room before re-embedding
    Called by Node server with room_id and list of file URLs.

    Args:
        body (EmbedRequest): room_id and document urls (the url to visit to retrieve a documents)

    Returns:
        EmbedResponse: contains the result of the operation, files that succeeded, files that failed, and total chunks embeded
    """
    print(f"---Embed API for {body.room_id}")
    if not body.room_id:
        raise HTTPException(status_code=400, detail="room_id is required")
    if not body.urls:
        raise HTTPException(status_code=400, detail="At least one url is required")
    
    results = await store.embed_room_documents(
        room_id = body.room_id,
        urls = body.urls
    )
    
    return EmbedResponse(
        result = len(results["failed"]) == 0, # True if no failures
        success = results["success"],
        failed = results["failed"],
        total_chunks = results["total_chunks"],
    )
    
@app.post("/predict", response_model=PredictResponse)
async def predict(question: str, room_id: Optional[str] = None, file: Optional[UploadFile] = File(default=None),):
    """ The base predict API
    Answer a question using the agent

    Args:
        question (str): the question to be answered
        room_id (Optional[str], optional): the room id to scope response (e.g. RAG). Defaults to None.
        file (Optional[UploadFile], optional): any user updated file, file content is always fed directly to the agent. Defaults to File(default=None).
        history (Optional[str], optional): A conversation history (if any). Defaults to None

    Returns:
        PredictResponse: contains the answer to the question, the sources referenced, as well as the chain of messages and tool calls
    """
    print("---Predict API---")
    if not question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    
    file_bytes = None
    file_name = None
    if file:
        file_bytes = await file.read()
        file_name = file.filename
    
    print("---Calling Agent Invoke---")        
    answer, sources, chain = await agent.invoke(
        question = question,
        room_id = room_id,
        file_bytes = file_bytes,
        file_name = file_name,
    )
    
    return PredictResponse(answer = answer, sources = sources, message_chain = chain)

@app.post("/predict/stream")
async def predict_stream(question: str, room_id: Optional[str] = None, file: Optional[UploadFile] = File(default=None),):
    """
    Similar to predict
    But streams the response token by token using Server-Sent Events
    Sends a "sources" event at the end with list of sources used

    Args:
        question (str): the question to be answered
        room_id (Optional[str], optional): the room id to scope response (e.g. RAG). Defaults to None.
        file (Optional[UploadFile], optional): any user updated file, file content is always fed directly to the agent. Defaults to File(default=None).

    Returns:
        StreamingResponse: streamed response of the agent, including a sources event
    """
    print("---Predict Stream API---")
    if not question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    
    file_bytes = None
    file_name = None
    if file:
        file_bytes = await file.read()
        file_name = file.filename
    
    print("---Define Token Generator---")
    # PREFIX MAP to determine event name tag
    PREFIX_MAP = {
        "[TOKEN]": "token",
        "[TOOL_START]": "tool_start",
        "[TOOL_END]": "tool_end",
        "[SOURCES]": "sources",
        "[CHAIN]": "chain",
        "[DONE]": "done",
    }
    
    async def token_generator():
        async for chunk in agent.stream(question = question, room_id = room_id, file_bytes = file_bytes, file_name = file_name):
            # print("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chunk)
            for prefix, event_name in PREFIX_MAP.items():
                if chunk.startswith(prefix):
                    data = chunk[len(prefix):]  # get data from end of prefix onwards ([TOKEN]{...}) will retrieve {...}
                    yield f"event: {event_name}\ndata: {data}\n\n"
                    break
        
    print("---Streaming Response---")
    return StreamingResponse(token_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},)
    

@app.delete("/corpus")
async def clear_corpus(room_id: str):
    """
    Clear all documents for a specific room from vector store.
    
    Args:
        room_id (str): the room filter to clear documents from vector store
    
    Returns:
        dict[str, str]: operation result
    """
    print(f"---Deleting Corupus API for {room_id}")
    if not room_id:
        raise HTTPException(status_code=400, detail="room_id is required.")
    store.clear(room_id=room_id)
    return {"result": True, "message": f"Corpus cleared for room {room_id}."}