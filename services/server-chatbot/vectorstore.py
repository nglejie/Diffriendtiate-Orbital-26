import os
import httpx
import tempfile
from typing import Optional
from langchain_community.vectorstores import Chroma
from langchain_ollama import OllamaEmbeddings
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

CHROMA_DIR = os.getenv("CHROMA_DIR", "/app/chroma_db")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
NODE_BASE_URL = os.getenv("NODE_BASE_URL", "http://server:4000")
SEARCH_MIN_RELEVANCE = float(os.getenv("SEARCH_MIN_RELEVANCE", "0.35"))

class VectorStore:
    def __init__(self):
        self.embeddings = OllamaEmbeddings(
            model= EMBED_MODEL,
            base_url = OLLAMA_BASE_URL,
        )
        
        # The document text splitter, to find appropriate chunks
        self.splitter = RecursiveCharacterTextSplitter( 
            chunk_size = 500,
            chunk_overlap = 50,
        )
        
        self.db = Chroma(
            persist_directory = CHROMA_DIR,
            embedding_function = self.embeddings,
        )
    
    def _load_file(self, file_path: str, file_name: str) -> list:
        """Load a file into LangChain documents based on file extention

        Args:
            file_path (str): path to file
            file_name (str): name of file

        Returns:
            list: returns the file content loader
        """
        ext = os.path.splitext(file_name)[-1].lower()
        if ext == ".pdf":
            loader = PyPDFLoader(file_path)
        elif ext == ".txt":
            loader = TextLoader(file_path)
        elif ext == ".docx":
            loader = Docx2txtLoader(file_path)
        else:
            raise ValueError(f"Unsupported file type: {ext}")
        docs = loader.load()
        return docs
    
    def load_file_content(self, file_path: str, file_name: str) -> str:
        """Load a file and return its raw text content
        Used when file is uploaded directly (no persistence to db)

        Args:
            file_path (str): file path
            file_name (str): file name

        Returns:
            str: raw file text content
        """
        docs = self._load_file(file_path, file_name)
        return "\n\n".join(doc.page_content for doc in docs)
    
    def load_file_content_from_bytes(self, file_bytes: bytes, file_name: str):
        """
        Write file bytes into a temp file, and using the tmp path to call load_file_content
        
        Args:
            file_bytes (bytes): raw file bytes
            file_name (str): file name used to get file extention to use correct file reader
        
        Returns:
            str: result of load_file_content
        """
        print("---Processing Uploaded File---")
        suffix = os.path.splitext(file_name or "")[-1]
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            tmp.write(file_bytes)
            tmp.close()
            return self.load_file_content(tmp.name, file_name)
        finally:
            tmp.close()
            os.remove(tmp.name)
    
    async def embed_room_documents(self, room_id: str, urls: list) -> int:
        """Load, chunk and store a document in ChromaDB

        Args:
            room_id (str): room_id the documents belongs to.
            urls list: list of file urls served by Node (e.g. ./uploads/filename.pdf) or objects with fields url and file name

        Returns:
            int: Number of chunks added
        """
        self.clear(room_id = room_id)
        
        results = {
            "success": [],
            "failed": [],
            "total_chunks": 0,
        }
        
        async with httpx.AsyncClient(base_url=NODE_BASE_URL, timeout=30) as client:
            for item in urls:
                if isinstance(item, str):
                    url = item
                    display_name = item.split("/")[-1]
                else:
                    url = item.url
                    display_name = item.file_name or url.split("/")[-1]

                url_file_name = url.split("/")[-1]
                suffix = os.path.splitext(display_name or url_file_name)[-1]
                
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    
                    # Save to temp file for loader
                    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                        tmp.write(response.content)
                        tmp_path = tmp.name
                    
                    try:
                        docs = self._load_file(tmp_path, display_name)
                        for doc in docs:
                            doc.metadata["file_name"] = display_name
                            doc.metadata["room_id"] = room_id
                            doc.metadata["source_url"] = url
                        
                        chunks = self.splitter.split_documents(docs)
                        self.db.add_documents(chunks)
                        
                        results["success"].append(display_name)
                        results["total_chunks"] += len(chunks)
                    finally:
                        tmp.close()
                        os.remove(tmp_path)
                except Exception as e:
                    results["failed"].append({"file": display_name, "error": str(e)})
                    
        return results
    
    def search(self, query: str, room_id: str, k: int = 5,) -> list:
        """Search ChromaDB for relevant chunks.

        Args:
            query (str): the query to search documents based off
            room_id (str): room id of documents to retrieve.
            k (int, optional): Number of chunks to retrieve. Defaults to 5.

        Returns:
            list: list of chunks retrieved
        """
        # retriever = self.db.as_retriever(
        #     search_kwargs={"k": k, "filter": {"room_id": room_id}}
        # )
        # return retriever.invoke(query)
        print("---Search for Chunks---")
        print("Chunk count:", self.db._collection.count())
    
        try:
            scored_results = self.db.similarity_search_with_relevance_scores(
                query=query,
                k=k,
                filter={"room_id": room_id},
            )
            
            best_score = max((float(score) for _, score in scored_results), default=0.0)
            # Keep documents that are both absolutely relevant and close enough to
            # the best match. This avoids citing weak side hits that share a keyword
            # but do not actually answer the question.
            relevance_floor = max(SEARCH_MIN_RELEVANCE, best_score * 0.7)

            filtered_results = []
            for document, score in scored_results:
                document.metadata["relevance_score"] = float(score)
                if score >= relevance_floor:
                    filtered_results.append(document)

            return filtered_results
        
        except Exception as error:
            print(f"DEBUG: relevance search failed, falling back to similarity search: {error}")
            documents = self.db.similarity_search(
                query=query,
                k=k,
                filter={"room_id": room_id},
            )
            return documents
    
    def clear(self, room_id: str):
        """Clear documents from ChromaDB
        
        If room_id is provided only clear that rooms documents

        Args:
            room_id (str): filter of room id to remove documents from.
        """
        self.db.delete(where={"room_id": room_id})