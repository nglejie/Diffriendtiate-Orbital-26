#!/bin/sh
ollama serve &

echo "Waiting for Ollama to start..."
until ollama list > /dev/null 2>&1; do
    sleep 2
done
echo "Ollama is up!"

# Read from env, fallback to defaults
LLM_MODEL=${LLM_MODEL:-qwen2.5:7b}
EMBED_MODEL=${EMBED_MODEL:-nomic-embed-text}

ollama list | grep -q "$LLM_MODEL" || (echo "Pulling $LLM_MODEL..." && ollama pull "$LLM_MODEL")
ollama list | grep -q "$EMBED_MODEL" || (echo "Pulling $EMBED_MODEL..." && ollama pull "$EMBED_MODEL")

echo "All models ready!"
wait