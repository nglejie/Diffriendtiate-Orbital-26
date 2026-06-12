# Services
Additional services / features to add to the main application

## Current Services

### server-chatbot
The server that hosts / manaages the endpoints to interact with LLM model

### ollama
Ollama to serve llm models for calling
Used by server-chatbot

Used local ollama server during dev to avoid setting up API keys and dealing with usage limits, also using lanchain makes it easier to switch to an API based online model

Could consider switching to gemini / other online models for deployment if difficult to host local model