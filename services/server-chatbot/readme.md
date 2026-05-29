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