from langchain_core.tools import tool
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import re
from logger import get_logger

logger = get_logger(__name__)

APP_TIMEZONE = os.getenv("APP_TIMEZONE") or os.getenv("TZ") or "Asia/Singapore"

def _app_timezone() -> ZoneInfo:
    """Return the configured app timezone, falling back to UTC if misconfigured."""
    try:
        return ZoneInfo(APP_TIMEZONE)
    except ZoneInfoNotFoundError:
        logger.warning(f"Invalid APP_TIMEZONE={APP_TIMEZONE!r}; falling back to UTC.")
        return ZoneInfo("UTC")

def _source_key(source) -> str:
    """Build a stable identity for deduplicating string and structured sources."""
    if isinstance(source, dict):
        return "|".join(
            str(source.get(key) or "")
            for key in ("type", "resourceId", "messageId", "annotationId", "sessionId", "pollId", "sourceId", "pageNumber", "slideNumber")
        )
    return str(source or "").strip().lower()

def _append_unique_source(source_collector, source) -> None:
    """Collect a source ref exactly once for this request."""
    if source_collector is None or not source:
        return
    key = _source_key(source)
    if not key:
        return
    if any(_source_key(existing) == key for existing in source_collector):
        return
    source_collector.append(source)

def _source_kind_label(source_type: str) -> str:
    """Translate internal source types into member-facing Domain areas."""
    return {
        "resource": "Infilenite",
        "convolution_message": "Convolution",
        "annotation": "Annotation",
        "coordidate_session": "Coordidate",
        "coordidate_poll": "Coordidate",
    }.get(source_type, "Domain")

def _format_search_results(docs, vectorstore, source_collector) -> str:
    """Format retrieved chunks for the model while collecting structured refs for the UI."""
    if not docs:
        return "No relevant Domain sources found for this room"

    results = []
    for doc in docs:
        source_ref = vectorstore.source_ref_for_document(doc)
        _append_unique_source(source_collector, source_ref)
        label = source_ref.get("label") or doc.metadata.get("file_name", "Domain source")
        source_type = source_ref.get("type") or doc.metadata.get("source_type", "resource")
        location_bits = []
        if source_ref.get("channel"):
            location_bits.append(f"channel #{source_ref['channel']}")
        if source_ref.get("pageNumber"):
            location_bits.append(f"page {source_ref['pageNumber']}")
        if source_ref.get("slideNumber"):
            location_bits.append(f"slide {source_ref['slideNumber']}")
        if source_ref.get("startsAt"):
            location_bits.append(f"starts {source_ref['startsAt']}")
        location = f" ({', '.join(location_bits)})" if location_bits else ""
        results.append(
            f"[Source: {label}]\n"
            f"[Domain area: {_source_kind_label(source_type)}{location}]\n"
            f"{doc.page_content}"
        )

    return "\n\n---\n\n".join(results)

def _today_iso() -> str:
    """Return today's date in the app timezone for temporal retrieval filters."""
    return datetime.now(_app_timezone()).date().isoformat()

def _now_epoch_ms() -> int:
    """Return the current timestamp in milliseconds for precise upcoming/past filters."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)

def _infer_source_type(query: str, explicit_source_type: str = "") -> str:
    """Infer a Domain area filter from plain-language user wording.

    The model is still encouraged to pass tool arguments explicitly, but this
    fallback keeps retrieval precise for common member phrasing such as
    "look in Infilenite" or "any meetings coming up".
    """
    if explicit_source_type:
        return explicit_source_type

    text = f" {query.lower()} "
    matches = []
    if re.search(r"\b(infilenite|resource|resources|file|files|attachment|attachments)\b", text):
        matches.append("resource")
    if re.search(r"\b(convolution|channel|channels|message|messages|discussion|discussions|chat)\b", text):
        matches.append("convolution")
    if re.search(r"\b(annotation|annotations|comment|comments)\b", text):
        matches.append("annotation")
    if re.search(r"\b(coordidate|calendar|meeting|meetings|event|events|schedule|schedules|deadline|deadlines|availability)\b", text):
        matches.append("meeting")

    # Only infer when the member clearly names one Domain area. Mixed requests
    # such as "files and messages" should remain broad unless the tool caller
    # supplies an explicit source_type argument.
    unique_matches = list(dict.fromkeys(matches))
    if len(unique_matches) == 1:
        return unique_matches[0]
    return ""

def _infer_timeframe(query: str, explicit_timeframe: str = "") -> str:
    """Map temporal wording to a retrieval timeframe understood by vectorstore."""
    normalized = explicit_timeframe.strip().lower()
    if normalized in {"upcoming", "future", "past", "previous"}:
        return "past" if normalized == "previous" else normalized

    text = query.lower()
    if re.search(r"\b(upcoming|coming up|future|next|later|scheduled)\b", text):
        return "upcoming"
    if re.search(r"\b(past|previous|earlier|old|last)\b", text):
        return "past"
    return ""

def _build_search_scope(
    query: str,
    source_type: str = "",
    source_id: str = "",
    channel: str = "",
    date: str = "",
    timeframe: str = "",
    date_from: str = "",
    date_to: str = "",
) -> dict:
    """Create the structured metadata scope sent to Chroma."""
    resolved_timeframe = _infer_timeframe(query, timeframe)
    resolved_date_from = date_from
    resolved_date_to = date_to

    if resolved_timeframe == "upcoming" and not resolved_date_from:
        resolved_date_from = _today_iso()
    elif resolved_timeframe == "past" and not resolved_date_to:
        resolved_date_to = _today_iso()

    scope = {
        "source_type": _infer_source_type(query, source_type),
        "source_id": source_id,
        "channel": channel,
        "date": date,
        "timeframe": resolved_timeframe,
        "date_from": resolved_date_from,
        "date_to": resolved_date_to,
    }
    if resolved_timeframe == "upcoming" and not date_from:
        scope["date_from_ts"] = _now_epoch_ms()
    if resolved_timeframe == "past" and not date_to:
        scope["date_to_ts"] = _now_epoch_ms()
    return scope

def build_file_tool(file_bytes: bytes, file_name: str, vectorstore, source_collector=None):
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
        # print(f"---Using Read File Tool: {reason}---")
        logger.info(f"Tool: read_file | reason: {reason} | file: {file_name}")
        if "content" not in cache:
            cache["content"] = vectorstore.load_file_content_from_bytes(file_bytes, file_name)
        _append_unique_source(source_collector, {
            "type": "uploaded_file",
            "label": file_name,
            "sourceId": file_name,
        })
            
        return f"[Source: {file_name}]\n{cache['content']}"
    
    return [read_file]

def build_room_tools(vectorstore, room_id: str, source_collector=None) -> list:
    """Define the tools available to the agentic LLM that require a room scope

    Args:
        vectorstore (_type_): used for search corpus (RAG)
        room_id (str): the room id of the request

    Returns:
        list: list of room tools available to model
    """
    
    @tool
    def search_domain_context(
        query: str,
        source_type: str = "",
        source_id: str = "",
        channel: str = "",
        date: str = "",
        timeframe: str = "",
        date_from: str = "",
        date_to: str = "",
    ) -> str:
        """Search Domain context from Infilenite, Convolution, annotations, and Coordidate.

        Args:
            query (str): natural-language retrieval query.
            source_type (str): optional area filter such as resource, infilenite, convolution, annotation, coordidate, meeting, or poll.
            source_id (str): optional exact source id when the user names a specific indexed item.
            channel (str): optional Convolution channel name such as general.
            date (str): optional Coordidate date in YYYY-MM-DD format.
            timeframe (str): optional temporal filter: upcoming, future, past, or previous.
            date_from (str): optional lower date bound in YYYY-MM-DD or ISO format.
            date_to (str): optional upper date bound in YYYY-MM-DD or ISO format.

        Returns:
            str: relevant Domain excerpts with source labels.
        """
        scope = _build_search_scope(query, source_type, source_id, channel, date, timeframe, date_from, date_to)
        logger.info(
            f"Tool: search_domain_context | room: {room_id} | query: {query!r} | scope: {scope}"
        )
        docs = vectorstore.search(query=query, room_id=room_id, scope=scope)
        logger.debug(f"search_domain_context results | room: {room_id} | docs found: {len(docs)}")
        return _format_search_results(docs, vectorstore, source_collector)

    @tool
    def search_corpus(query: str) -> str:
        """Legacy RAG tool for searching all available Domain corpus content.

        Args:
            query (str): query to RAG based off of

        Returns:
            str: results of the retrieval
        """
        # print("---Using Search Corpus Tool---")
        # print(f"Search Query: {query}")
        scope = _build_search_scope(query)
        logger.info(f"Tool: search_corpus | room: {room_id} | query: {query!r} | inferred scope: {scope}")
        docs = vectorstore.search(query=query, room_id = room_id, scope=scope)
        logger.debug(f"search_corpus results | room: {room_id} | docs found: {len(docs)}")

        return _format_search_results(docs, vectorstore, source_collector)
    
    return [search_domain_context, search_corpus]

def build_global_tools() -> list:
    """Tools that work regardless of room

    Currently nothing implemented (possible web search tool)
    
    Returns:
        list: list of global tools available
    """
    return []
