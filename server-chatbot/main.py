from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import tempfile
import os
 
from rag import RAGPipeline
 
# Init Application
app = FastAPI(title="Diffriendtiate RAG API")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
 
# Init RAG pipeline (loads ChromaDB on startup)
rag = RAGPipeline()

# --- Request/Response Models ---
 
class PredictRequest(BaseModel):
    question: str
    room_id: Optional[str] = None   # optional: scope answers to a room's docs
 
 
class PredictResponse(BaseModel):
    answer: str
    sources: list[str] = []         # filenames used to answer
 
 
class LoadCorpusResponse(BaseModel):
    result: bool
    message: str
    chunks_added: int
 
 
# --- Routes ---

@app.get("/health")
async def check_health():
    """
    Check Health of Server
    
    Returns:
        dict[str, str]: server health
    """
    return {"message": "Success"}

@app.post("/load_corpus", response_model=LoadCorpusResponse)
async def load_corpus(
    file: UploadFile = File(...),
    room_id: Optional[str] = None,
):
    """
    Upload and vectorise a document into ChromaDB.
    Supports PDF, TXT, and DOCX files.
    Optionally scope the document to a room via room_id.

    Returns:
        dict[str, bool]: operation success
    """
    allowed_types = {"application/pdf", "text/plain",
                     "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
 
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only PDF, TXT, and DOCX files are supported.")
 
    # Save upload to a temp file so LangChain loaders can read it
    suffix = os.path.splitext(file.filename or "")[-1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
 
    try:
        chunks_added = rag.load_document(
            file_path=tmp_path,
            file_name=file.filename or "unknown",
            room_id=room_id,
        )
    finally:
        os.unlink(tmp_path)  # clean up temp file
 
    return LoadCorpusResponse(
        result=True,
        message=f"Successfully loaded '{file.filename}'",
        chunks_added=chunks_added,
    )

@app.post("/predict", response_model=PredictResponse)
async def predict(
    question: str,
    room_id: Optional[str] = None,
    file: Optional[UploadFile] = File(default=None),
):
    """ 
    Answer a question using RAG.
    Optionally attach a file to answer from directly (no persistence).
    Optionally filter context to a specific room's documents via room_id.
    
    Returns:
        dict[str, str]: model response
    """
    if not question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
 
    # If a file is attached, load it temporarily for this request only
    temp_path = None
    if file:
        suffix = os.path.splitext(file.filename or "")[-1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            temp_path = tmp.name
 
    try:
        answer, sources = rag.answer(
            question=question,
            room_id=room_id,
            temp_file_path=temp_path,
            temp_file_name=file.filename if file else None,
        )
    finally:
        if temp_path:
            os.unlink(temp_path)
 
    return PredictResponse(answer=answer, sources=sources)

@app.delete("/corpus")
async def clear_corpus(room_id: Optional[str] = None):
    """
    Clear all documents from the vector store.
    If room_id is provided, only clears that room's documents.
    
    Returns:
        dict[str, str]: operation result
    """
    rag.clear(room_id=room_id)
    return {"result": True, "message": "Corpus cleared."}