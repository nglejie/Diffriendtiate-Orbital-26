# Chatbot Service (NYI)

Feature to ask questions to an LLM and retrieve contextually grounded answers

This is achieved through usage of Retrieval Augmented Generation (RAG) technologies

## Current implementation
### Models
Embedding: nomic-embed-text

Generation: Qwen2.5:3b

Database: ChromaDB

## Endpoints
### Health
Returns server health

### Predict
Post a question for answering

### Load Corpus
Loads documents into vector database to be used for information retrieval

### Clear Corpus
Removes vector database


## Planned Implementation
Tool based LLM with acces to
- RAG Tool

If user uploaded file, file content is passed into the model whole.

Else the LLM would determine the need for additional information to provide an answer (To RAG or not to RAG)

If all is well (pray), LLM will send response back to user

### FIles
main.py
- handles handling of APIs
- handles tool based LLM
rag.py
- Handles tools for RAG
- Handles tools dealing with chroma db
