import os
from typing import Optional
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.llms import Ollama
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate

CHROMA_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")   # fast, small embedding model
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")            # swap to any ollama model


PROMPT_TEMPLATE = """You are a helpful study assistant. Use the context below to answer the question.
If the context doesn't contain enough information, say so honestly and answer from general knowledge if you can.

Context:
{context}

Question: {question}

Answer:"""


class RAGPipeline:
    def __init__(self):
        self.embeddings = OllamaEmbeddings(
            model=EMBED_MODEL,
            base_url=OLLAMA_BASE_URL,
        )
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50,
        )
        self.vectorstore = Chroma(
            persist_directory=CHROMA_DIR,
            embedding_function=self.embeddings,
        )
        self.llm = Ollama(
            model=LLM_MODEL,
            base_url=OLLAMA_BASE_URL,
        )
        self.prompt = PromptTemplate(
            input_variables=["context", "question"],
            template=PROMPT_TEMPLATE,
        )

    def _load_file(self, file_path: str, file_name: str) -> list:
        """Load a file into LangChain documents based on extension."""
        ext = os.path.splitext(file_name)[-1].lower()
        if ext == ".pdf":
            loader = PyPDFLoader(file_path)
        elif ext == ".txt":
            loader = TextLoader(file_path)
        elif ext == ".docx":
            loader = Docx2txtLoader(file_path)
        else:
            raise ValueError(f"Unsupported file type: {ext}")
        return loader.load()

    def load_document(
        self,
        file_path: str,
        file_name: str,
        room_id: Optional[str] = None,
    ) -> int:
        """
        Load and vectorise a document, storing it in ChromaDB.
        Metadata includes file_name and room_id for filtering later.
        Returns number of chunks added.
        """
        docs = self._load_file(file_path, file_name)

        # Tag each chunk with metadata for filtering
        for doc in docs:
            doc.metadata["file_name"] = file_name
            doc.metadata["room_id"] = room_id or "global"

        chunks = self.splitter.split_documents(docs)
        self.vectorstore.add_documents(chunks)

        return len(chunks)

    def answer(
        self,
        question: str,
        room_id: Optional[str] = None,
        temp_file_path: Optional[str] = None,
        temp_file_name: Optional[str] = None,
    ) -> tuple[str, list[str]]:
        """
        Answer a question using RAG.
        If temp_file_path is provided, use that file as context (not persisted).
        Otherwise search ChromaDB, optionally filtered by room_id.
        """
        if temp_file_path and temp_file_name:
            # One-shot: load the file, chunk it, use as context without storing
            docs = self._load_file(temp_file_path, temp_file_name)
            chunks = self.splitter.split_documents(docs)

            # Build a temporary in-memory vectorstore just for this request
            temp_store = Chroma.from_documents(chunks, self.embeddings)
            retriever = temp_store.as_retriever(search_kwargs={"k": 4})
        else:
            # Search persistent ChromaDB, filter by room_id if provided
            search_kwargs = {"k": 4}
            if room_id:
                search_kwargs["filter"] = {"room_id": room_id}

            retriever = self.vectorstore.as_retriever(search_kwargs=search_kwargs)

        chain = RetrievalQA.from_chain_type(
            llm=self.llm,
            retriever=retriever,
            return_source_documents=True,
            chain_type_kwargs={"prompt": self.prompt},
        )

        result = chain.invoke({"query": question})
        answer = result["result"]

        # Extract unique source filenames
        sources = list({
            doc.metadata.get("file_name", "unknown")
            for doc in result.get("source_documents", [])
        })

        return answer, sources

    def clear(self, room_id: Optional[str] = None):
        """Delete documents from vectorstore, optionally filtered by room_id."""
        if room_id:
            self.vectorstore.delete(where={"room_id": room_id})
        else:
            # Nuclear option — wipe everything
            self.vectorstore.delete_collection()