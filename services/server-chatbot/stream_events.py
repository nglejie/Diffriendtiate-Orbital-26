from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")


def extract_messages_from_event_value(value: Any, is_target_message: Callable[[Any], bool]) -> list[T]:
    """Collect target messages from nested LangGraph event payloads."""
    if is_target_message(value):
        return [value]
    if isinstance(value, dict):
        messages: list[T] = []
        for nested in value.values():
            messages.extend(extract_messages_from_event_value(nested, is_target_message))
        return messages
    if isinstance(value, (list, tuple)):
        messages: list[T] = []
        for nested in value:
            messages.extend(extract_messages_from_event_value(nested, is_target_message))
        return messages

    update = getattr(value, "update", None)
    if isinstance(update, dict):
        return extract_messages_from_event_value(update.get("messages"), is_target_message)
    return []
