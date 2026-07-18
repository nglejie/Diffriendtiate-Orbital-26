import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def install_tool_import_stubs():
    tools_module = types.ModuleType("langchain_core.tools")
    tools_module.tool = lambda func=None, **_kwargs: func if func is not None else (lambda wrapped: wrapped)
    sys.modules["langchain_core.tools"] = tools_module

    logger_module = types.ModuleType("logger")
    logger_module.get_logger = lambda _name: types.SimpleNamespace(
        debug=lambda *_args, **_kwargs: None,
        info=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
    )
    sys.modules["logger"] = logger_module


install_tool_import_stubs()
sys.modules.pop("tools", None)

from tools import _infer_source_type


class ToolScopeTests(unittest.TestCase):
    def test_amortization_schedule_does_not_infer_coordidate(self):
        self.assertEqual(_infer_source_type("what is an amortization schedule"), "")

    def test_calendar_words_still_infer_coordidate(self):
        self.assertEqual(_infer_source_type("what meetings are coming up"), "meeting")
        self.assertEqual(_infer_source_type("check Coordidate availability"), "meeting")


if __name__ == "__main__":
    unittest.main()
