from pydantic import BaseModel, Field
from typing import Any, Literal

class EmbedDocument(BaseModel):
    """A document URL plus its user-facing filename."""
    url: str
    file_name: str | None = None

class EmbedRequest(BaseModel):
    """The template to expect for embedding request
    """
    room_id: str
    urls: list[str | EmbedDocument]
 
class EmbedResponse(BaseModel):
    """The embeddding response template
    """
    result: bool
    success: list[str]
    failed: list[dict]
    total_chunks: int

class DomainCorpusFile(EmbedDocument):
    """A room-owned file plus the app metadata needed to build source pills."""
    id: str | None = None
    source_type: str = "resource"
    source_ref: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

class DomainCorpusDocument(BaseModel):
    """A non-file Domain record that can be embedded into the room corpus."""
    id: str
    source_type: str
    title: str
    text: str
    source_ref: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

class DomainCorpusSyncRequest(BaseModel):
    """Full Domain corpus payload sent by the app server for one room."""
    room_id: str
    files: list[DomainCorpusFile] = Field(default_factory=list)
    documents: list[DomainCorpusDocument] = Field(default_factory=list)

class DomainCorpusSyncResponse(BaseModel):
    """Result of syncing typed Domain records into the vector store."""
    result: bool
    success: list[str]
    failed: list[dict]
    total_chunks: int

class PredictResponse(BaseModel):
    """The prediction response template
    """
    answer: str
    sources: list[str | dict[str, Any]] = Field(default_factory=list)
    message_chain: list[dict] = []

class LlmProviderCatalogProvider(BaseModel):
    """One LiteLLM provider and the model variants LiteLLM currently exposes."""
    id: str
    providerName: str
    defaultLabel: str
    defaultModel: str
    models: list[str]

class LlmProviderCatalogResponse(BaseModel):
    """The LiteLLM provider catalog returned to the Node API for BYOK settings."""
    providers: list[LlmProviderCatalogProvider]
    source: str

class HistoryMessage(BaseModel):
    """
    A single message in the message chain
    The final message in the message chain has to have role "user" as that is the main question prompt for the model
    """
    role: Literal["user", "assistant"]
    content: str
