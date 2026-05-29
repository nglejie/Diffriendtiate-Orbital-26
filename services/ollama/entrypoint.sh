#!/bin/sh
ollama serve &

# Wait until ollama is actually responding
echo "Waiting for Ollama to start..."
until curl -sf http://localhost:11434 > /dev/null 2>&1; do
    sleep 2
done
echo "Ollama is up!"

# Pull models if not already present
ollama list | grep -q "qwen2.5:3b" || ollama pull qwen2.5:3b
ollama list | grep -q "nomic-embed-text" || ollama pull nomic-embed-text

echo "Models ready!"
wait