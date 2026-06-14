from pydantic import BaseModel
from typing import Literal

class EmbedDocument(BaseModel):
    """A document URL plus its user-facing filename."""
    url: str
    file_name: str | None = None

class EmbedRequest(BaseModel):
    """The template to expect for embedding request
    """
    room_id: str
    urls: list[str]
 
class EmbedResponse(BaseModel):
    """The embeddding response template
    """
    result: bool
    success: list[str]
    failed: list[dict]
    total_chunks: int

class PredictResponse(BaseModel):
    """The prediction response template
    """
    answer: str
    sources: list[str] = []
    message_chain: list[dict] = []

class HistoryMessage(BaseModel):
    """
    A single message in the message chain
    The final message in the message chain has to have role "user" as that is the main question prompt for the model
    """
    role: Literal["user", "assistant"]
    content: str