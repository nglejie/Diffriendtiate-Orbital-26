# Code for Ollama server

## Dockerfile & Entrypoint
Uses base ollama image

Handles pulling of models on first time container start up

The models pulled is defined in .env file

The first run of the container will take longer as models are pulled and stored into volume (see entrypont.sh)