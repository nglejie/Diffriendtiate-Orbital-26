from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError
from typing import Literal, Optional
import tempfile, os, json
 
from vectorstore import VectorStore
from agent import Agent
from models import HistoryMessage, EmbedRequest, EmbedResponse, PredictResponse
 
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

# --- Helper Functions ---
def parse_message_chain(message_chain: str) -> list[HistoryMessage]:
    """ Help to validate and convert message chain / history passed in.
    
    Args:
        message_chain (str): _description_

    Raises:
        HTTPException: 400, Invalid History Format
        HTTPException: 400, Empty message chain
        HTTPException: 400, Last message is not user (needed as last message is treated as current question)
        HTTPException: 400, current question cannot be empty

    Returns:
        list[HistoryMessage]: full message chain
    """
    try:
        parsed = json.loads(message_chain)
        message_chain = [HistoryMessage(**msg) for msg in parsed]
    except (json.JSONDecodeError, ValidationError) as e:
        raise HTTPException(status_code = 400, detail = f"Invalid History Format: {e}")

    if not message_chain:
        raise HTTPException(status_code = 400, detail = "Message chain cannot be empty")
    if message_chain[-1].role != "user":
        raise HTTPException(status_code = 400, detail = "Last History must have role 'user'")
    if message_chain[-1].content in [None, ""]:
        raise HTTPException(status_code = 400, detail = "Question cannot be empty")
    
    return message_chain

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
async def predict(message_chain: str, room_id: Optional[str] = None, file: Optional[UploadFile] = File(default=None),):
    """ The base predict API
    Answer a question using the agent
    
    Currently acceptable roles in message chain is "user" and "assistant"
    
    Args:
        message_chain (str): the json format string of full message_chain / history, where the current question to be answered is positioned as the last item
        room_id (Optional[str], optional): the room id to scope response (e.g. RAG). Defaults to None.
        file (Optional[UploadFile], optional): any user updated file, file content is always fed directly to the agent. Defaults to File(default=None).

    Returns:
        PredictResponse: contains the answer to the question, the sources referenced, as well as the chain of messages and tool calls
    """
    print("---Predict API---")
    message_chain = parse_message_chain(message_chain)
    
    file_bytes = None
    file_name = None
    if file:
        file_bytes = await file.read()
        file_name = file.filename
    
    print("---Calling Agent Invoke---")        
    answer, sources, chain = await agent.invoke(
        message_chain = message_chain,
        room_id = room_id,
        file_bytes = file_bytes,
        file_name = file_name,
    )
    
    return PredictResponse(answer = answer, sources = sources, message_chain = chain)

@app.post("/predict/stream")
async def predict_stream(message_chain: str, room_id: Optional[str] = None, file: Optional[UploadFile] = File(default=None),):
    """
    Similar to predict
    But streams the response token by token using Server-Sent Events
    Sends a "sources" event at the end with list of sources used
    
    Currently acceptable roles in message chain is "user" and "assistant"

    Args:
        message_chain (str): the json format string of full message_chain / history, where the current question to be answered is positioned as the last item
        room_id (Optional[str], optional): the room id to scope response (e.g. RAG). Defaults to None.
        file (Optional[UploadFile], optional): any user updated file, file content is always fed directly to the agent. Defaults to File(default=None).

    Returns:
        StreamingResponse: streamed response of the agent, including a sources event
    """
    print("---Predict Stream API---")
    message_chain = parse_message_chain(message_chain)
    
    file_bytes = None
    file_name = None
    if file:
        file_bytes = await file.read()
        file_name = file.filename
    
    print("---Define Token Generator---")
    # PREFIX MAP to determine event name tag
    PREFIX_MAP = {
        "[THINKING]": "thinking",
        "[TOKEN]": "token",
        "[ANSWER]": "answer",
        "[TOOL_START]": "tool_start",
        "[TOOL_END]": "tool_end",
        "[SOURCES]": "sources",
        "[CHAIN]": "chain",
        "[DONE]": "done",
    }

    def format_sse(event_name: str, data: str = "") -> str:
        """Format Server-Sent Events safely, including multi-line answers."""
        lines = str(data).splitlines() or [""]
        payload = "\n".join(f"data: {line}" for line in lines)
        return f"event: {event_name}\n{payload}\n\n"
    
    async def token_generator():
        async for chunk in agent.stream(message_chain = message_chain, 
                                        room_id = room_id, 
                                        file_bytes = file_bytes, 
                                        file_name = file_name):
            # print("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chunk)
            for prefix, event_name in PREFIX_MAP.items():
                if chunk.startswith(prefix):
                    data = chunk[len(prefix):]  # get data from end of prefix onwards ([TOKEN]{...}) will retrieve {...}
                    yield format_sse(event_name, data)
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
