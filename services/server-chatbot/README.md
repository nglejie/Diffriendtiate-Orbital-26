# Chatbot Service

Feature to ask questions to an LLM and retrieve contextually grounded answers

By deploying an agentic LLM with access to tools, such as information retrieval

If user uploaded file, file content is passed into the model whole.

Else the LLM would determine the need for additional information to provide an answer (To RAG or not to RAG)

If all is well (pray), LLM will send response back to user

## Models
Embedding: nomic-embed-text

Generation: Qwen2.5:7b

Database: ChromaDB

## Endpoints
| Method | Endpoint | Description | Inputs | Return
| :--- | :--- | :--- | :--- | :--- | 
| **GET** | `/health` | Returns server healthy | None | Success if healthy
| **POST** | `/embed` | Embed documents into vectorstore | room_id, <br> document urls | result of operation, <br> successful file names, <br> dictionary of unsuccessful file names + reasons, <br> total chunks embeded, |
| **POST** | `/predict` | Post a question for answering | question, <br>room_id,<br>directly uploaded file | answer,<br>sources of information, |
| **POST**| `/predict/stream` | Post a question for answering, streams response | question, <br>room_id,<br>directly uploaded file | streamed response of /predict |
| **DELETE**| `/corpus` | Delete the corpus of the provided room id | room_id | result of operation |

## FIles
### main.py
- handles routing and return of all the APIs

### agent.py
- Handles the code for the agentic model

### tools.py
- Handles and defines the tools accessible to the model
- Current Tools
    - RAG

### vectorstore.py
- Handles tasks related to the vectorstore
    - Reading Documents
    - Embed
    - Retrieve
    - Delete