# Diffriendtiate

We are building Diffriendtiate as a NUS Orbital 2026 Project Gemini application for module-based study rooms.

Our app is a collaborative study hub where students can create or join module-specific rooms, chat in real time, share resources, schedule study sessions, and keep room context persistent across visits.

## Tech Stack

- React + Vite
- Node.js + Express
- Socket.io
- PostgreSQL
- Nginx
- Docker Compose
- JWT authentication
- bcrypt password hashing
- Local JSON persistence for the development build

## Prerequisites

- Node.js 22 LTS or newer
- npm 10 or newer
- Docker Desktop, for the containerized setup

## Project Structure

```text
apps/client/   React frontend, Vite config, and Nginx production config
apps/server/   Express API, Socket.io server, uploads, and persistence layer
services/      Independent services, including chatbot/RAG work
```

## Getting Started

Run from the project root:

```bash
npm install
npm run dev
```

The local app usually runs at:

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:4000`

## Docker Setup

Create a local `.env` file from `.env.example`, then run:

```cmd
docker compose up --build
```

The containerized app runs at `http://127.0.0.1:4000`. Docker Compose starts separate client, server, and PostgreSQL services. Uploaded files and database data are stored in Docker volumes.

When `DATABASE_URL` is set, the server initializes and uses PostgreSQL automatically. Without `DATABASE_URL`, local development falls back to the JSON store under `apps/server/data`.

## Features

- User registration and login
- Study room creation, editing, deletion, and public/private visibility
- Invite-link joining for private rooms
- Public room discovery and search
- Real-time room chat with persisted history
- URL and file resource sharing
- Room themes
- Basic study session scheduling

## Services

The `services/` folder is reserved for independently deployable supporting services. The chatbot/RAG service lives there and can be developed without coupling it to the web client or API server.
