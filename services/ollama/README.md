# Code for Ollama model

## Dockerfile & Entrypoint
Handles pulling of models on first time container start up

The first run of the container will take longer as models are pulled and stored into volume (see entrypont.sh)