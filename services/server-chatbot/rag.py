import os
from typing import Optional
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings, OllamaLLM
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from langchain_ollama import OllamaEmbeddings, OllamaLLM

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
        self.llm = OllamaLLM(
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
        if temp_file_path and temp_file_name:
            docs = self._load_file(temp_file_path, temp_file_name)
            chunks = self.splitter.split_documents(docs)
            temp_store = Chroma.from_documents(chunks, self.embeddings)
            retriever = temp_store.as_retriever(search_kwargs={"k": 4})
        else:
            search_kwargs = {"k": 4}
            if room_id:
                search_kwargs["filter"] = {"room_id": room_id}
            retriever = self.vectorstore.as_retriever(search_kwargs=search_kwargs)

        # Retrieve docs first so we can return sources
        retrieved_docs = retriever.invoke(question)
        context = "\n\n".join(doc.page_content for doc in retrieved_docs)

        # Build LCEL chain
        chain = self.prompt | self.llm | StrOutputParser()
        answer = chain.invoke({"context": context, "question": question})

        sources = list({
            doc.metadata.get("file_name", "unknown")
            for doc in retrieved_docs
        })

        return answer, sources

    def clear(self, room_id: Optional[str] = None):
        """Delete documents from vectorstore, optionally filtered by room_id."""
        if room_id:
            self.vectorstore.delete(where={"room_id": room_id})
        else:
            # Nuclear option — wipe everything
            self.vectorstore.delete_collection()