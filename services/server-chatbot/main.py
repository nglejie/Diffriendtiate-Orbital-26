from fastapi import FastAPI, UploadFile, File, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError
from typing import Literal, Optional
import json
 
from vectorstore import VectorStore
from agent import Agent
from models import (
    HistoryMessage,
    DomainCorpusSyncRequest,
    DomainCorpusSyncResponse,
    EmbedRequest,
    EmbedResponse,
    PredictResponse,
    LlmProviderCatalogProvider,
    LlmProviderCatalogResponse,
)
from logger import get_logger

logger = get_logger(__name__)
 
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
TEXT_LLM_MODEL_MODES = {"chat", "completion", "responses"}

def format_litellm_provider_name(provider_id: str) -> str:
    """Format a LiteLLM provider id into a readable name without owning the provider list."""
    parts = [part for part in provider_id.replace(".", "_").replace("-", "_").split("_") if part]
    display_parts = []
    for part in parts:
        if len(part) <= 3 and part.isalpha():
            display_parts.append(part.upper())
        elif part.endswith("ai") and len(part) > 2:
            display_parts.append(f"{part[:-2].capitalize()}AI")
        else:
            display_parts.append(part.capitalize())
    return " ".join(display_parts) or provider_id

def get_litellm_model_mode(model: str, provider_id: str, get_model_info, model_cost: dict) -> str:
    """Look up LiteLLM's model mode so Intelligrate only offers text-generation variants."""
    # LiteLLM's cost map is already loaded locally and is much cheaper than
    # asking get_model_info for every model in the catalog.
    provider_prefix = f"{provider_id}/"
    fallback_key = model.removeprefix(provider_prefix)
    model_pricing = model_cost.get(model) or model_cost.get(fallback_key) or {}
    mode = str(model_pricing.get("mode") or "").strip().lower()
    if mode:
        return mode

    try:
        model_info = get_model_info(model, custom_llm_provider=provider_id)
        mode = str(model_info.get("mode") or "").strip().lower()
        if mode:
            return mode
    except Exception as error:
        logger.debug(f"LiteLLM model metadata lookup failed | provider: {provider_id} | model: {model} | error: {error}")

    return ""

def normalize_litellm_model_list(raw_models, provider_id: str, get_model_info, model_cost: dict) -> list[str]:
    """Normalize LiteLLM model data into a stable, de-duplicated list of text model ids."""
    if isinstance(raw_models, dict):
        candidates = []
        for value in raw_models.values():
            if isinstance(value, (list, tuple, set)):
                candidates.extend(value)
            else:
                candidates.append(value)
    elif isinstance(raw_models, (list, tuple, set)):
        candidates = list(raw_models)
    else:
        candidates = [raw_models]

    seen = set()
    models = []
    for candidate in candidates:
        model = str(candidate or "").strip()
        if not model or any(character.isspace() for character in model):
            continue
        mode = get_litellm_model_mode(model, provider_id, get_model_info, model_cost)
        if mode not in TEXT_LLM_MODEL_MODES:
            continue
        if model in seen:
            continue
        seen.add(model)
        models.append((mode, model[:180]))
    mode_order = {"chat": 0, "completion": 1, "responses": 2}
    sorted_models = sorted(models, key=lambda item: (mode_order.get(item[0], 99), item[1].lower()))
    return [model for _, model in sorted_models]

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

def validate_custom_llm(llm_model: Optional[str], llm_api_key: Optional[str]):
    """Validate that custom LLM params are either both provided or both absent

    Args:
        llm_model (Optional[str]): LiteLLM model string
        llm_api_key (Optional[str]): API key for the model

    Raises:
        HTTPException: 400 if only one of the two is provided
    """
    if bool(llm_model) != bool(llm_api_key):
        raise HTTPException(status_code=400, detail="Both llm_model and llm_api_key must be provided together, or neither")

def resolve_custom_llm_api_key(query_api_key: Optional[str], header_api_key: Optional[str]) -> Optional[str]:
    """Prefer the internal header form so BYOK secrets do not appear in request URLs."""
    return header_api_key or query_api_key

def iter_exception_messages(error: BaseException) -> list[str]:
    """Collect nested exception messages so stream errors can name the failing layer."""
    messages: list[str] = []
    visited: set[int] = set()
    current: BaseException | None = error
    while current and id(current) not in visited:
        visited.add(id(current))
        messages.append(str(current))
        current = current.__cause__ or current.__context__
    return messages

def classify_stream_error(error: BaseException, llm_model: Optional[str]) -> str:
    """Return a user-facing stream failure without confusing BYOK auth with corpus auth."""
    combined = "\n".join(iter_exception_messages(error)).lower()
    has_api_key_failure = "api key" in combined or "invalid_api_key" in combined or "api_key_invalid" in combined
    has_embedding_failure = "embedding" in combined or "embed_query" in combined or "embed content" in combined

    if has_api_key_failure and has_embedding_failure:
        return "Intelligrate could not search room resources because the corpus embedding key is invalid. Check the chatbot embedding provider configuration and try again."
    if has_api_key_failure and llm_model:
        return "The selected provider rejected the API key. Save a valid key in User Settings and try again."
    if has_api_key_failure:
        return "Intelligrate's configured model API key is invalid. Check the chatbot service configuration and try again."
    return "Intelligrate could not complete this response."

# --- Routes ---

@app.get("/health")
async def check_health():
    """
    Check Health of Server
    
    Returns:
        dict[str, str]: server health
    """
    return {"message": "Success"}

@app.get("/llm/providers", response_model=LlmProviderCatalogResponse)
async def list_litellm_providers():
    """
    Return the provider/model catalog from LiteLLM for BYOK settings.

    The Node API owns encryption and user-key storage; this service only exposes
    LiteLLM's current registry so providers and variants are not duplicated in
    the web app code.
    """
    try:
        from litellm import get_model_info, model_cost, models_by_provider

        if not isinstance(models_by_provider, dict):
            raise TypeError("litellm.models_by_provider is not a dictionary")

        providers = []
        for provider_id, raw_models in sorted(models_by_provider.items()):
            provider_id = str(provider_id or "").strip()
            models = normalize_litellm_model_list(raw_models, provider_id, get_model_info, model_cost)
            if not provider_id or not models:
                continue

            provider_name = format_litellm_provider_name(provider_id)
            providers.append(
                LlmProviderCatalogProvider(
                    id=provider_id,
                    providerName=provider_name,
                    defaultLabel=provider_name,
                    defaultModel=models[0],
                    models=models,
                )
            )

        if not providers:
            raise ValueError("LiteLLM returned an empty provider catalog")

        logger.info(f"LiteLLM provider catalog requested | providers: {len(providers)}")
        return LlmProviderCatalogResponse(
            providers=providers,
            source="litellm.models_by_provider",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unable to read LiteLLM provider catalog: {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="Unable to load LiteLLM provider catalog")

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
    try:
        # print(f"---Embed API for {body.room_id}")
        logger.info(f"Embed request for room {body.room_id} | {len(body.urls)} file(s)")
        
        if not body.room_id:
            raise HTTPException(status_code=400, detail="room_id is required")
        if not body.urls:
            raise HTTPException(status_code=400, detail="At least one url is required")
        
        results = await store.embed_room_documents(
            room_id = body.room_id,
            urls = body.urls
        )
        
        logger.info(f"Embed request for room {body.room_id} | success: {len(results['success'])} | failed: {len(results['failed'])} | chunks: {results['total_chunks']}")
        
        return EmbedResponse(
            result = len(results["failed"]) == 0, # True if no failures
            success = results["success"],
            failed = results["failed"],
            total_chunks = results["total_chunks"],
        )
    
    except HTTPException as e:
        raise # reraise http exception
    except Exception as e:
        # print(f"Unexpected Error {e}")
        logger.error(f"Unexpected error in embed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occured")

@app.post("/corpus/sync", response_model=DomainCorpusSyncResponse)
async def sync_domain_corpus(body: DomainCorpusSyncRequest):
    """
    Replace one room's searchable Domain corpus with typed app-owned records.

    The Node app remains the source of truth for permissions and canonical IDs.
    This service only stores retrievable chunks plus flat metadata that can be
    returned as structured source refs after a tool search.
    """
    try:
        logger.info(
            f"Domain corpus sync request | room: {body.room_id} | files: {len(body.files)} | records: {len(body.documents)}"
        )
        if not body.room_id:
            raise HTTPException(status_code=400, detail="room_id is required")

        results = await store.sync_domain_corpus(
            room_id=body.room_id,
            files=body.files,
            documents=body.documents,
        )

        return DomainCorpusSyncResponse(
            result=len(results["failed"]) == 0,
            success=results["success"],
            failed=results["failed"],
            total_chunks=results["total_chunks"],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in domain corpus sync: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occured")
    
@app.post("/predict", response_model=PredictResponse)
async def predict(
    message_chain: str, 
    room_id: Optional[str] = None, 
    file: Optional[UploadFile] = File(default=None), 
    llm_model: Optional[str] = None,
    llm_api_key: Optional[str] = None,
    x_diffriendtiate_llm_api_key: Optional[str] = Header(default=None, alias="X-Diffriendtiate-Llm-Api-Key"),
):
    """ The base predict API
    Answer a question using the agent
    
    Currently acceptable roles in message chain is "user" and "assistant"
    
    Args:
        message_chain (str): the json format string of full message_chain / history, where the current question to be answered is positioned as the last item
        room_id (Optional[str], optional): the room id to scope response (e.g. RAG). Defaults to None.
        file (Optional[UploadFile], optional): any user updated file, file content is always fed directly to the agent. Defaults to File(default=None).
        llm_model (Optional[str], optional): LiteLLM model string. Defaults to None
        llm_api_key (Optional[str], optional): LiteLLM model api key. Defaults to None

    Returns:
        PredictResponse: contains the answer to the question, the sources referenced, as well as the chain of messages and tool calls
    """
    try:
        effective_llm_api_key = resolve_custom_llm_api_key(llm_api_key, x_diffriendtiate_llm_api_key)
        validate_custom_llm(llm_model, effective_llm_api_key)
        logger.info(f"Predict request | room_id: {room_id} | file: {file.filename if file else None} | custom_llm: {llm_model or 'system default'}")
        message_chain = parse_message_chain(message_chain)
        
        file_bytes = None
        file_name = None
        if file:
            file_bytes = await file.read()
            file_name = file.filename
            logger.debug(f"File uploaded: {file_name} ({len(file_bytes)} bytes)")
        
        # print("---Calling Agent Invoke---")       
        logger.debug(f"Invoking agent | messages: {len(message_chain)}")     
        answer, sources, chain = await agent.invoke(
            message_chain = message_chain,
            room_id = room_id,
            file_bytes = file_bytes,
            file_name = file_name,
            llm_model = llm_model,
            llm_api_key = effective_llm_api_key,
        )
        
        logger.info(f"Predict complete | soruces: {sources}")
        return PredictResponse(answer = answer, sources = sources, message_chain = chain)
    
    except HTTPException:
        raise # reraise http exception
    except Exception as e:
        logger.error(f"Unexpected error in embed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occured")

@app.post("/predict/stream")
async def predict_stream(
    message_chain: str, 
    room_id: Optional[str] = None, 
    file: Optional[UploadFile] = File(default=None),
    llm_model: Optional[str] = None,
    llm_api_key: Optional[str] = None,
    x_diffriendtiate_llm_api_key: Optional[str] = Header(default=None, alias="X-Diffriendtiate-Llm-Api-Key"),
):
    """
    Similar to predict
    But streams the response token by token using Server-Sent Events
    Sends a "sources" event at the end with list of sources used
    
    Currently acceptable roles in message chain is "user" and "assistant"

    Args:
        message_chain (str): the json format string of full message_chain / history, where the current question to be answered is positioned as the last item
        room_id (Optional[str], optional): the room id to scope response (e.g. RAG). Defaults to None.
        file (Optional[UploadFile], optional): any user updated file, file content is always fed directly to the agent. Defaults to File(default=None).
        llm_model (Optional[str], optional): LiteLLM model string, eg. "openai/gpt-4o". Defaults to None
        llm_api_key (Optional[str], optional): API key for LiteLLM model. Defaults to None

    Returns:
        StreamingResponse: streamed response of the agent, including a sources event
    """
    try:
        effective_llm_api_key = resolve_custom_llm_api_key(llm_api_key, x_diffriendtiate_llm_api_key)
        validate_custom_llm(llm_model, effective_llm_api_key)
        logger.info(f"Predict stream request | room_id {room_id} | file: {file.filename if file else None} | custom_llm: {llm_model or 'system default'}")
        message_chain = parse_message_chain(message_chain)
        
        file_bytes = None
        file_name = None
        if file:
            file_bytes = await file.read()
            file_name = file.filename
            logger.debug(f"File uploaded: {file_name} ({len(file_bytes)} bytes)")
        
        # print("---Define Token Generator---")
        # PREFIX MAP to determine event name tag
        PREFIX_MAP = {
            "[TOKEN]": "token",
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
            try:
                async for chunk in agent.stream(message_chain = message_chain,
                                                room_id = room_id,
                                                file_bytes = file_bytes,
                                                file_name = file_name,
                                                llm_model = llm_model,
                                                llm_api_key = effective_llm_api_key):

                    for prefix, event_name in PREFIX_MAP.items():
                        if chunk.startswith(prefix):
                            data = chunk[len(prefix):]  # get data from end of prefix onwards ([TOKEN]{...}) will retrieve {...}
                            # yield f"event: {event_name}\ndata: {data}\n\n"
                            yield format_sse(event_name, data)
                            break
            except Exception as e:
                logger.error(f"Stream generation failed | custom_llm: {llm_model or 'system default'} | error: {e}", exc_info=True)
                message = classify_stream_error(e, llm_model)
                yield format_sse("error", json.dumps({"message": message}))
            
        # print("---Streaming Response---")
        logger.debug("Starting stream response")
        return StreamingResponse(token_generator(), 
                                 media_type="text/event-stream", 
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},)
    
    except HTTPException:
        raise # reraise http exception
    except Exception as e:
        print(f"Unexpected Error {e}")
        logger.error(f"Unexpected error in predict_stream: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occured")
    

@app.delete("/corpus")
async def clear_corpus(room_id: str):
    """
    Clear all documents for a specific room from vector store.
    
    Args:
        room_id (str): the room filter to clear documents from vector store
    
    Returns:
        dict[str, str]: operation result
    """
    try:
        # print(f"---Deleting Corupus API for {room_id}")
        logger.info(f"Clear corpus request | room_id: {room_id}")
        if not room_id:
            raise HTTPException(status_code=400, detail="room_id is required.")
        store.clear(room_id=room_id)
        logger.info(f"Corpus cleared for room: {room_id}")
        return {"result": True, "message": f"Corpus cleared for room {room_id}."}
    
    except HTTPException:
        raise
    except Exception as e:
        # print(f"Unexpected Error {e}")
        logger.error(f"Unexpected error in clear_corpus: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occured")
