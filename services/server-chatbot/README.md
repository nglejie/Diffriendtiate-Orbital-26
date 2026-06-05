# Chatbot Service

Feature to ask questions to an LLM and retrieve contextually grounded answers

By using an agentic LLM with access to tools, such as information retrieval

If user uploaded file, file content is passed into the model whole.

Else the LLM would determine the need for additional tool usage to provide an answer such as searching the database

If all is well (pray), LLM will send correct response back to user

## Design Diagram

TBD

## Endpoints
![alt ](./static/fastapi_ss.png "FastAPI Endpoints")

| Method | Endpoint | Description | Inputs | Return |
| :--- | :--- | :--- | :--- | :--- | 
| **GET** | `/health` | Returns server healthy | None | Success if healthy
| **POST** | `/embed` | Embed documents into vectorstore | room_id, <br> document urls | result of operation, <br> successful file names, <br> dictionary of unsuccessful file names + reasons, <br> total chunks embeded, |
| **POST** | `/predict` | Post a question for answering, returns response in one shot | question, <br>room_id,<br>directly uploaded file | answer,<br>sources of information, <br> full message chain,|
| **POST**| `/predict/stream` | Post a question for answering, streams response | question, <br>room_id,<br>directly uploaded file | streamed response of /predict |
| **DELETE**| `/corpus` | Delete the corpus of the provided room id | room_id | result of operation |

## Techstack
- FASTAPI
- LangChain
- LangGraph
- ChromaDB (Database)

## Models
- Embedding: nomic-embed-text
- Generation: Qwen2.5:7b

## Files
### main.py
- Handles the FASTAPI server, routing and return of all APIs
- handles routing to relevant components, agent, vectorstore, etc.
- Uses pydantic to validate input and outputs

### agent.py
- Handles the code for the agentic model
- Uses langgraph to expose tools for model to use

### tools.py
- Handles and defines the tools accessible to the model
- Global tools are given to every agent
- Room Specific tools are only available if room_id is specified in API
- Current Tools:

  | Tool | Description | Type |
  | :--- | :--- | :--- |
  | search_corpus | Perform retrieval of relevant information from database | Room Specific |
  | read_file | reads file content of uploaded file | Only if file is uploaded manually |

### vectorstore.py
- Handles tasks related to the vectorstore / documents
    - Reading Documents
    - Embed
    - Retrieve documnt chunks
    - Delete corpus

## Limitations
- Currently only accepts manually uploading of 1 file
- Stream response does not seem to call tools
    - Possibly change to static agent before using a stream responder
- Limited to only text based documents (PDF, TXT, DOCX)
- Does not extract information from images or any other media type
- Have not tested extensively
    - Multiple file in database (same / different room documents)
    - Both uploaded file and search
    - Response accuracy
    - Consistentency of tool usage
    - Simultaneous requests
    - Edge cases