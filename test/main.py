from fastapi import FastAPI
from pydantic import BaseModel

# Init Application
app = FastAPI()

@app.get("/health")
async def check_health():
    """
    Check Health of Server
    
    Returns:
        dict[str, str]: server health
    """
    return {"message": "Success"}

@app.post("/load_corpus")
async def load_corpus():
    """Load and Process corpus, saving into vector database

    Returns:
        dict[bool, str]: operation success
    """
    return {"result": True}

@app.post("/predict")
async def predict():
    """
    Send to pipeline for model
    
    Returns:
        dict[str, str]: model response
    """
    return {"result": "Success"}