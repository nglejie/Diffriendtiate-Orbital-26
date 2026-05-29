# Diffriendtiate-Orbital-26
NUS Orbital 2026

Diffriendtiate is a NUS Orbital project for module-based study rooms.

## Local MVP

This local version includes:

- Email/password registration and login
- Study room creation, editing, deletion, and public/private visibility
- Invite-link joining for private rooms
- Public room discovery by module, room name, description, or tag
- Real-time room chat with persisted history
- Resource sharing through URLs and uploaded files
- Room themes
- Simple study session scheduling

### Getting started

```bash
npm install
npm run dev
```

The app runs the React client and local Express API together. The client URL is usually `http://127.0.0.1:5173`, and the API runs on `http://127.0.0.1:4000`.

Local app data is stored in `server/data/db.json`, and uploaded files are stored in `server/uploads`. Both are ignored by Git.

### Not Yet Implemented
- Chatbot server
