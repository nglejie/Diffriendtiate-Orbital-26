import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class Document:
    def __init__(self, page_content="", metadata=None):
        self.page_content = page_content
        self.metadata = metadata or {}


class FakeCollection:
    def count(self):
        return 3


class FakeChroma:
    def __init__(self, scored_results):
        self._scored_results = scored_results
        self._collection = FakeCollection()

    def similarity_search_with_relevance_scores(self, **_kwargs):
        return self._scored_results


def install_vectorstore_import_stubs():
    chroma_module = types.ModuleType("langchain_community.vectorstores")
    chroma_module.Chroma = object
    sys.modules["langchain_community.vectorstores"] = chroma_module

    loaders_module = types.ModuleType("langchain_community.document_loaders")
    loaders_module.PyPDFLoader = object
    loaders_module.TextLoader = object
    loaders_module.Docx2txtLoader = object
    sys.modules["langchain_community.document_loaders"] = loaders_module

    documents_module = types.ModuleType("langchain_core.documents")
    documents_module.Document = Document
    sys.modules["langchain_core.documents"] = documents_module

    splitters_module = types.ModuleType("langchain_text_splitters")
    splitters_module.RecursiveCharacterTextSplitter = object
    sys.modules["langchain_text_splitters"] = splitters_module

    ollama_module = types.ModuleType("langchain_ollama")
    ollama_module.OllamaEmbeddings = object
    sys.modules["langchain_ollama"] = ollama_module

    genai_module = types.ModuleType("langchain_google_genai")
    genai_module.GoogleGenerativeAIEmbeddings = object
    sys.modules["langchain_google_genai"] = genai_module

    pptx_module = types.ModuleType("pptx")
    pptx_module.Presentation = object
    sys.modules["pptx"] = pptx_module

    logger_module = types.ModuleType("logger")
    logger_module.get_logger = lambda _name: types.SimpleNamespace(
        debug=lambda *_args, **_kwargs: None,
        info=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
    )
    sys.modules["logger"] = logger_module


install_vectorstore_import_stubs()
sys.modules.pop("vectorstore", None)

from vectorstore import SEARCH_MIN_RELEVANCE, VectorStore


class VectorStoreSearchTests(unittest.TestCase):
    def test_search_filter_allows_human_filename_as_source_id(self):
        store = object.__new__(VectorStore)

        self.assertEqual(
            store._search_filter("room_test", {"source_type": "resource", "source_id": "Lecture Notes.pdf"}),
            {
                "$and": [
                    {"room_id": "room_test"},
                    {"source_type": "resource"},
                    {
                        "$or": [
                            {"source_id": "Lecture Notes.pdf"},
                            {"resource_id": "Lecture Notes.pdf"},
                            {"file_name": "Lecture Notes.pdf"},
                            {"label": "Lecture Notes.pdf"},
                            {"title": "Lecture Notes.pdf"},
                        ],
                    },
                ],
            },
        )

    def test_search_drops_best_available_matches_below_relevance_floor(self):
        store = object.__new__(VectorStore)
        weak_doc = Document("Unrelated Domain text", {"room_id": "room_test"})
        store.db = FakeChroma([(weak_doc, SEARCH_MIN_RELEVANCE - 0.01)])

        self.assertEqual(store.search("fictional chipset migration path", "room_test"), [])
        self.assertEqual(weak_doc.metadata["relevance_score"], SEARCH_MIN_RELEVANCE - 0.01)

    def test_search_keeps_relevant_matches_and_preserves_scores(self):
        store = object.__new__(VectorStore)
        strong_doc = Document("Amortization schedule definition", {"room_id": "room_test"})
        weak_side_hit = Document("Weak side hit", {"room_id": "room_test"})
        store.db = FakeChroma([(strong_doc, 0.76), (weak_side_hit, 0.40)])

        results = store.search("amortization schedule", "room_test")

        self.assertEqual(results, [strong_doc])
        self.assertEqual(strong_doc.metadata["relevance_score"], 0.76)
        self.assertEqual(weak_side_hit.metadata["relevance_score"], 0.40)


if __name__ == "__main__":
    unittest.main()
