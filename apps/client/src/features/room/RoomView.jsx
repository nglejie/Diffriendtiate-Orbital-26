import {
  ArrowLeft,
  Bot,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Hash,
  House,
  Info,
  Link as LinkIcon,
  Lock,
  LogOut,
  MessageCircle,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api } from "../../api.js";
import { BuddyPanel } from "./BuddyPanel.jsx";
import { UPLOADS_FOLDER } from "./roomConstants.js";
import { createBuddyThread, normalizeBuddyThread } from "./buddyUtils.js";
import AlertDialog from "../../shared/ui/AlertDialog.jsx";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.jsx";
import TextInputDialog from "../../shared/ui/TextInputDialog.jsx";
import {
  buildVisibleMembers,
  buildWeekDays,
  formatBytes,
  formatDateTime,
  formatMonthYear,
  formatTimeOnly,
  formatWeekday,
  getInitial,
  getWeekStart,
  resourceToAttachment,
  sessionFallsInSlot,
} from "../../shared/utils/room.js";
import {
  backgroundPresets,
  getBackground,
  getTheme,
  themePresets,
} from "../../constants.js";

const tabs = [
  { id: "focus", label: "Home", icon: House },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "buddy", label: "Intelligrate", icon: Bot },
  { id: "resources", label: "Resources", icon: FolderOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

function RoomView({ inviteCode, onBack, onOpenRoom, roomId, token, user }) {
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [resources, setResources] = useState([]);
  const [customResourceFolders, setCustomResourceFolders] = useState([]);
  const [selectedResourceFolder, setSelectedResourceFolder] = useState("All files");
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState("focus");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteNeedsPassword, setInviteNeedsPassword] = useState(false);
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [activeChatChannel, setActiveChatChannel] = useState("general");
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [channelActionLoading, setChannelActionLoading] = useState(false);
  const [buddySyncing, setBuddySyncing] = useState(false);
  const [buddyThreads, setBuddyThreads] = useState([]);
  const [activeBuddyThreadId, setActiveBuddyThreadId] = useState("");
  const [draftBuddyThread, setDraftBuddyThread] = useState(null);
  const [buddyRenameTarget, setBuddyRenameTarget] = useState(null);
  const [buddyDeleteTarget, setBuddyDeleteTarget] = useState(null);
  const [roomToast, setRoomToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const theme = getTheme(room?.theme);
  const background = getBackground(room?.background);
  const resourceFolders = useMemo(() => {
    const names = new Set([UPLOADS_FOLDER, "General", ...customResourceFolders]);
    resources.forEach((resource) => names.add(resource.folder || "General"));
    return ["All files", ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [customResourceFolders, resources]);
  const activeBuddyThread =
    draftBuddyThread ||
    buddyThreads.find((thread) => thread.id === activeBuddyThreadId) ||
    buddyThreads[0];

  /** Builds an unsaved Intelligrate chat that becomes persistent after first send. */
  function createDraftBuddyThread() {
    return createBuddyThread("New Chat", `draft-buddy-${Date.now()}`, {
      isDraft: true,
      ownerId: user?.id || "",
      owner: user,
    });
  }

  useEffect(() => {
    if (!notice) return undefined;
    const timeoutId = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    return () => window.clearTimeout(toastTimeoutRef.current);
  }, []);

  // Keep the Intelligrate tab usable even before a saved chat exists.
  useEffect(() => {
    if (loading || !room?.isMember || activeTab !== "buddy") return;
    if (!draftBuddyThread && !buddyThreads.length) {
      setDraftBuddyThread(createDraftBuddyThread());
      setActiveBuddyThreadId("");
    }
  }, [activeTab, buddyThreads.length, draftBuddyThread, loading, room?.isMember]);

  /** Shows compact room feedback without interrupting the current workflow. */
  function showRoomToast(message) {
    if (!message) return;

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.clearTimeout(toastTimeoutRef.current);
    setRoomToast({ id, message });
    toastTimeoutRef.current = window.setTimeout(() => {
      setRoomToast((current) => (current?.id === id ? null : current));
    }, 3600);
  }

  useEffect(() => {
    if (inviteCode) {
      joinInviteRoom();
      return;
    }

    if (roomId) {
      loadRoomBundle(roomId);
    }
  }, [inviteCode, roomId]);

  useEffect(() => {
    if (!room?.id || !room.isMember) return undefined;

    const socket = io("/", {
      auth: { token },
      path: "/socket.io",
    });

    socket.on("connect", () => {
      socket.emit("room:join", room.id, (ack) => {
        if (!ack?.ok) showError(ack?.message || "Unable to join chat.");
      });
    });

    socket.on("message:new", (message) => {
      if (message.roomId !== room.id) return;
      setMessages((current) =>
        current.some((existing) => existing.id === message.id)
          ? current
          : [...current, message],
      );
    });

    socket.on("room:deleted", (payload) => {
      if (payload.roomId === room.id) onBack();
    });

    socket.on("room:updated", (updatedRoom) => {
      if (updatedRoom.id === room.id) {
        setRoom((current) => ({ ...current, ...updatedRoom }));
      }
    });

    // Chat panel children send messages through this room-scoped socket.
    // The reference is cleared on unmount to avoid leaking a stale connection.
    window.diffriendtiateSocket = socket;

    return () => {
      socket.disconnect();
      if (window.diffriendtiateSocket === socket) {
        delete window.diffriendtiateSocket;
      }
    };
  }, [room?.id, room?.isMember, token]);

  /**
   * Fetches the room and all member-only data needed by the active room workspace.
   * Loading the bundle together prevents panels from briefly showing stale room data.
   */
  async function loadRoomBundle(nextRoomId = room?.id) {
    if (!nextRoomId) return;
    setLoading(true);
    setError("");

    try {
      const { room: loadedRoom } = await api.getRoom(nextRoomId);
      setRoom(loadedRoom);

      if (loadedRoom.isMember) {
        const [messagePayload, resourcePayload, sessionPayload, buddyPayload] = await Promise.all([
          api.getMessages(loadedRoom.id),
          api.getResources(loadedRoom.id),
          api.getSessions(loadedRoom.id),
          api.getBuddyThreads(loadedRoom.id),
        ]);
        setMessages(messagePayload.messages);
        setResources(resourcePayload.resources);
        setSessions(sessionPayload.sessions);
        const loadedThreads = (buddyPayload.threads || []).map((thread) =>
          normalizeBuddyThread(thread, user),
        );

        if (loadedThreads.length) {
          setBuddyThreads(loadedThreads);
          setActiveBuddyThreadId((current) =>
            loadedThreads.some((thread) => thread.id === current)
              ? current
              : loadedThreads[0].id,
          );
        } else {
          setBuddyThreads([]);
          setActiveBuddyThreadId("");
          setDraftBuddyThread(createDraftBuddyThread());
        }
      } else {
        setMessages([]);
        setResources([]);
        setSessions([]);
        setBuddyThreads([]);
        setActiveBuddyThreadId("");
        setDraftBuddyThread(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Resolves invite links, including the password retry path for private rooms.
   */
  async function joinInviteRoom(password = "") {
    if (!inviteCode) return;

    setLoading(!inviteNeedsPassword);
    setJoiningInvite(Boolean(inviteNeedsPassword));
    setError("");

    try {
      const payload = await api.joinInvite(
        inviteCode,
        password ? { password } : undefined,
      );
      setInviteNeedsPassword(false);
      onOpenRoom(payload.room.id);
    } catch (err) {
      const message = err.message || "Unable to join room.";
      setError(message);
      setInviteNeedsPassword(message.toLowerCase().includes("password"));
      setLoading(false);
    } finally {
      setJoiningInvite(false);
    }
  }

  /**
   * Lets a signed-in user join a public room after previewing it.
   */
  async function joinPublicRoom() {
    if (!room) return;
    setError("");

    try {
      const payload = await api.joinRoom(room.id);
      setRoom(payload.room);
      await loadRoomBundle(payload.room.id);
      setNotice("Joined room.");
    } catch (err) {
      showError(err.message);
    }
  }

  /**
   * Routes feature errors through the shared modal instead of browser alerts.
   */
  function showError(message) {
    setAlertMessage(message || "Something went wrong.");
  }

  /**
   * Reloads resources after uploads, deletes, or Intelligrate corpus syncs.
   */
  async function refreshResources() {
    if (!room?.id) return [];
    const payload = await api.getResources(room.id);
    setResources(payload.resources);
    return payload.resources;
  }

  /**
   * Uploads files into the room resource library, then returns the saved resources
   * so chat/Intelligrate can attach the canonical server records.
   */
  async function uploadSharedFiles(fileList, folder = UPLOADS_FOLDER) {
    const files = Array.from(fileList || []);
    if (!files.length || !room?.id) return [];

    const uploaded = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);
      formData.append("folder", folder);
      const payload = await api.uploadFileResource(room.id, formData);
      uploaded.push(payload.resource);
    }

    await refreshResources();
    return uploaded;
  }

  /**
   * Requests a room-corpus sync for Intelligrate and refreshes visible resources after it.
   */
  async function syncBuddyResources() {
    if (!room?.id || buddySyncing) return null;

    setBuddySyncing(true);
    try {
      const payload = await api.syncBuddyResources(room.id);
      await refreshResources();
      return payload;
    } finally {
      setBuddySyncing(false);
    }
  }

  /**
   * Adapts Intelligrate's SSE stream into UI callbacks for tokens, tool events, sources,
   * and persisted chain data. The backend owns model behavior; this layer only
   * translates stream events into React state updates.
   */
  async function askBuddy(messagesForThread, attachmentResources = [], handlers = {}) {
    if (!room?.id) throw new Error("Open a room before asking Intelligrate.");

    return api.streamBuddy(
      room.id,
      {
        messages: messagesForThread,
        attachmentResourceIds: attachmentResources.map((resource) => resource.id),
      },
      (event, data) => {
        if (event === "token") {
          handlers.onToken?.(data);
          return;
        }

        if (event === "thinking") {
          handlers.onThinking?.(data);
          return;
        }

        if (event === "tool_start" || event === "tool_end") {
          handlers.onThinking?.({ event, payload: data });
          return;
        }

        if (event === "answer") {
          handlers.onAnswer?.(data);
          return;
        }

        if (event === "sources") {
          try {
            handlers.onSources?.(JSON.parse(data || "[]"));
          } catch {
            handlers.onSources?.([]);
          }
          return;
        }

        if (event === "chain") {
          try {
            handlers.onChain?.(JSON.parse(data || "[]"));
          } catch {
            handlers.onChain?.([]);
          }
          return;
        }

        if (event === "error") {
          let payload = {};
          try {
            payload = JSON.parse(data || "{}");
          } catch {
            payload = {};
          }
          throw new Error(payload.message || "Unable to stream Intelligrate's response.");
        }
      },
      { signal: handlers.signal },
    );
  }

  /**
   * Sends a chat message over the active room socket and exposes Socket.IO acks as
   * a Promise so panels can use normal async error handling.
   */
  function sendViaSocket(body, options = {}) {
    return new Promise((resolve, reject) => {
      const socket = window.diffriendtiateSocket;
      if (!socket?.connected) {
        reject(new Error("Chat is reconnecting. Try again in a moment."));
        return;
      }

      socket.emit(
        "message:send",
        {
          roomId: room.id,
          body,
          channel: options.channel || activeChatChannel,
          attachments: options.attachments || [],
        },
        (ack) => {
          if (ack?.ok) resolve(ack.message);
          else reject(new Error(ack?.message || "Message failed."));
        },
      );
    });
  }

  async function copyInviteLink() {
    const inviteUrl = `${window.location.origin}${window.location.pathname}#/invite/${room.inviteCode}`;
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1800);

    try {
      await navigator.clipboard?.writeText(inviteUrl);
    } catch {
      // Some browser contexts block clipboard writes, but the control should still acknowledge the click.
    }
  }

  /** Creates a new text channel and immediately switches the room chat to it. */
  async function createChatChannel(name) {
    if (!room?.id) return;

    try {
      const payload = await api.createChannel(room.id, { name });
      setRoom(payload.room);
      setActiveChatChannel(payload.channel);
      setChannelModalOpen(false);
    } catch (err) {
      showError(err.message);
    }
  }

  /** Renames a channel locally after the API confirms the change. */
  async function renameChatChannel(channel, name) {
    if (!room?.id) return;

    setChannelActionLoading(true);
    try {
      const payload = await api.renameChannel(room.id, channel, { name });
      setRoom(payload.room);
      setActiveChatChannel((current) => (current === channel ? payload.channel : current));
      setMessages((current) =>
        current.map((message) =>
          (message.channel || "general") === channel
            ? { ...message, channel: payload.channel }
            : message,
        ),
      );
    } catch (err) {
      showError(err.message);
    } finally {
      setChannelActionLoading(false);
    }
  }

  /** Removes a channel and refreshes messages so deleted-channel content disappears. */
  async function deleteChatChannel(channel) {
    if (!room?.id) return;

    setChannelActionLoading(true);
    try {
      const payload = await api.deleteChannel(room.id, channel);
      const messagePayload = await api.getMessages(room.id);
      setRoom(payload.room);
      setActiveChatChannel((current) => (current === channel ? payload.channel : current));
      setMessages(messagePayload.messages);
    } catch (err) {
      showError(err.message);
    } finally {
      setChannelActionLoading(false);
    }
  }

  /** Keeps the detail sidebar open whenever a room tool is selected. */
  function selectRoomTab(tabId) {
    setActiveTab(tabId);
    setContextOpen(true);
  }

  /** Opens a local draft chat; persistence starts only after the first message. */
  async function startBuddyThread() {
    if (!room?.id) return;

    setDraftBuddyThread(createDraftBuddyThread());
    setActiveBuddyThreadId("");
    setActiveTab("buddy");
    setContextOpen(true);
  }

  /** Creates the saved Intelligrate chat once the first message is actually sent. */
  async function ensureBuddyThreadForFirstMessage(userMessage) {
    if (!room?.id) throw new Error("Open a room before asking Intelligrate.");
    if (activeBuddyThread && !activeBuddyThread.isDraft) return activeBuddyThread;

    const fallbackTitle = userMessage.body
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48) || "New Chat";
    let title = fallbackTitle;

    try {
      const payload = await api.generateBuddyTitle(room.id, { message: userMessage.body });
      title = payload.title || fallbackTitle;
    } catch {
      title = fallbackTitle;
    }

    const payload = await api.createBuddyThread(room.id, {
      title,
      visibility: "private",
      messages: [userMessage],
    });
    const thread = normalizeBuddyThread(payload.thread, user);
    setDraftBuddyThread(null);
    setBuddyThreads((current) => [thread, ...current]);
    setActiveBuddyThreadId(thread.id);
    return thread;
  }

  /** Updates the saved title for an Intelligrate chat without touching its messages. */
  async function renameBuddyThread(threadId, title) {
    const trimmedTitle = String(title || "").trim();
    if (!trimmedTitle || !room?.id) return;

    try {
      const payload = await api.updateBuddyThread(room.id, threadId, {
        title: trimmedTitle.slice(0, 60),
      });
      const updatedThread = normalizeBuddyThread(payload.thread, user);
      setBuddyThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
              ...updatedThread,
              // Preserve in-flight optimistic messages while metadata updates return.
              messages: thread.messages,
            }
            : thread,
        ),
      );
    } catch (err) {
      showError(err.message);
    }
  }

  /** Deletes one Intelligrate chat and moves selection to the next available chat. */
  async function deleteBuddyThread(threadId) {
    if (!room?.id) return;

    try {
      await api.deleteBuddyThread(room.id, threadId);
      setBuddyThreads((current) => {
        const nextThreads = current.filter((thread) => thread.id !== threadId);
        if (activeBuddyThreadId === threadId) {
          setActiveBuddyThreadId(nextThreads[0]?.id || "");
        }

        return nextThreads;
      });
      showRoomToast("Chat deleted");
    } catch (err) {
      showError(err.message);
    }
  }

  /** Duplicates a private Intelligrate chat into a public room-visible thread. */
  async function startGroupBuddyThread(threadId) {
    if (!room?.id) return;

    const sourceThread = buddyThreads.find((thread) => thread.id === threadId);
    if (!sourceThread) return;

    const baseTitle =
      sourceThread.title && sourceThread.title !== "New Chat"
        ? sourceThread.title.trim()
        : "Group Chat";
    const groupTitle = baseTitle.toLowerCase().includes("group chat")
      ? baseTitle
      : `${baseTitle} Group Chat`;

    try {
      const payload = await api.createBuddyThread(room.id, {
        title: groupTitle.slice(0, 60),
        visibility: "public",
        messages: sourceThread.messages,
      });
      const groupThread = normalizeBuddyThread(payload.thread, user);
      setBuddyThreads((current) => [groupThread, ...current]);
      setActiveBuddyThreadId(groupThread.id);
      setContextOpen(true);
    } catch (err) {
      showError(err.message);
    }
  }

  /** Persists Intelligrate messages after each successful or interrupted response. */
  async function saveBuddyThreadMessages(threadId, nextMessages) {
    if (!room?.id || !threadId) return;

    try {
      const payload = await api.updateBuddyThread(room.id, threadId, {
        messages: nextMessages,
      });
      const updatedThread = normalizeBuddyThread(payload.thread, user);
      setBuddyThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
              ...thread,
              messages: updatedThread.messages,
              updatedAt: updatedThread.updatedAt,
            }
            : thread,
        ),
      );
    } catch (err) {
      showError(err.message);
    }
  }

  /** Adds a local resource folder option for organizing future uploads. */
  function createResourceFolder(folderName) {
    setCustomResourceFolders((current) =>
      current.includes(folderName) ? current : [...current, folderName],
    );
    setSelectedResourceFolder(folderName);
  }

  /** Applies message updates to a saved or draft Intelligrate thread. */
  function updateBuddyMessages(targetThreadId, updater) {
    if (draftBuddyThread?.id === targetThreadId) {
      setDraftBuddyThread((current) =>
        current
          ? {
            ...current,
            messages:
              typeof updater === "function" ? updater(current.messages) : updater,
          }
          : current,
      );
      return;
    }

    setBuddyThreads((current) =>
      current.map((thread) =>
        thread.id === targetThreadId
          ? {
            ...thread,
            messages:
              typeof updater === "function" ? updater(thread.messages) : updater,
          }
          : thread,
      ),
    );
  }

  /** Renames the active Intelligrate thread from the sidebar text dialog. */
  async function renameActiveBuddyThread(title) {
    if (!activeBuddyThread?.id) return;
    await renameBuddyThread(activeBuddyThread.id, title);
  }

  if (loading) {
    return <p className="empty-state">Loading room...</p>;
  }

  if (inviteNeedsPassword && !room) {
    return (
      <section className="surface invite-password-surface">
        <button className="ghost-button" onClick={onBack} type="button">
          <ArrowLeft size={17} />
          Back
        </button>
        <form
          className="stacked-form plain"
          onSubmit={(event) => {
            event.preventDefault();
            joinInviteRoom(invitePassword);
          }}
        >
          <div className="section-header compact">
            <div>
              <p className="eyebrow">Private Room</p>
              <h2>Enter Room Password</h2>
            </div>
            <Lock size={20} />
          </div>
          <label className="field">
            <span>Password</span>
            <input
              onChange={(event) => setInvitePassword(event.target.value)}
              placeholder="Room password"
              type="password"
              value={invitePassword}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" disabled={joiningInvite} type="submit">
            {joiningInvite ? "Joining" : "Join Room"}
          </button>
        </form>
      </section>
    );
  }

  if (error && !room) {
    return (
      <section className="surface error-surface">
        <button className="ghost-button" onClick={onBack} type="button">
          <ArrowLeft size={17} />
          Back
        </button>
        <p className="form-error">{error}</p>
      </section>
    );
  }

  if (!room) return null;

  return (
    <div
      className={`room-workspace ${contextOpen ? "context-open" : "context-collapsed"}`}
      style={{
        "--theme-a": theme.colors[0],
        "--theme-b": theme.colors[1],
        "--theme-c": theme.colors[2],
        "--room-bg": background.css,
      }}
    >
      <nav className="room-icon-rail" aria-label="Room tools">
        <div className="room-rail-top">
          <button
            className={contextOpen ? "room-rail-logo" : "room-rail-logo collapsed-toggle"}
            onClick={() => (contextOpen ? selectRoomTab("focus") : setContextOpen(true))}
            title={contextOpen ? room.name : "Open sidebar"}
            type="button"
          >
            <span>D</span>
            {!contextOpen ? <PanelLeftOpen size={15} /> : null}
          </button>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                aria-label={tab.label}
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => selectRoomTab(tab.id)}
                title={tab.label}
                type="button"
              >
                <Icon size={22} />
              </button>
            );
          })}
        </div>

        <div className="room-rail-bottom">
          <button
            aria-label="Room settings"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            type="button"
          >
            <Settings size={22} />
          </button>
          <button aria-label="Exit room" onClick={onBack} title="Exit room" type="button">
            <LogOut size={22} />
          </button>
        </div>
      </nav>

      <aside className="room-context-panel" aria-label={`${activeTab} details`}>
        <RoomContextPanel
          activeTab={activeTab}
          activeChannel={activeChatChannel}
          activeBuddyThreadId={activeBuddyThread?.id}
          buddyThreads={buddyThreads}
          channels={room.channels || ["general"]}
          copyInviteLink={copyInviteLink}
          inviteCopied={inviteCopied}
          onCloseSidebar={() => setContextOpen(false)}
          onCreateChannel={() => setChannelModalOpen(true)}
          onDeleteChannel={deleteChatChannel}
          onRequestDeleteBuddyThread={setBuddyDeleteTarget}
          onRequestRenameBuddyThread={setBuddyRenameTarget}
          onStartGroupBuddyThread={startGroupBuddyThread}
          onNewBuddyThread={startBuddyThread}
          onRenameChannel={renameChatChannel}
          onSelectChannel={setActiveChatChannel}
          onSelectBuddyThread={(threadId) => {
            setDraftBuddyThread(null);
            setActiveBuddyThreadId(threadId);
          }}
          room={room}
          resourceFolders={resourceFolders}
          selectedResourceFolder={selectedResourceFolder}
          sessions={sessions}
          channelActionLoading={channelActionLoading}
          onSelectResourceFolder={setSelectedResourceFolder}
          user={user}
        />
      </aside>

      <main className="room-main-stage">
        <div className="room-floating-notices" aria-live="polite">
          {notice ? <p className="form-notice">{notice}</p> : null}
        </div>

        {!room.isMember ? (
          <section className="room-content-panel join-surface">
            <h2>{room.name}</h2>
            <p>{room.description || "This public room is open to join."}</p>
            <button className="primary-button compact" onClick={joinPublicRoom} type="button">
              <Users size={18} />
              Join Room
            </button>
          </section>
        ) : null}

        {room.isMember && activeTab === "focus" ? <HomePanel room={room} /> : null}

        {room.isMember && activeTab === "chat" ? (
          <section className="room-content-panel">
            <ChatPanel
              channel={activeChatChannel}
              messages={messages}
              onError={showError}
              onSend={sendViaSocket}
              onUploadFiles={uploadSharedFiles}
              user={user}
            />
          </section>
        ) : null}

        {room.isMember && activeTab === "buddy" ? (
          <section className="room-content-panel buddy-content-panel">
            {activeBuddyThread ? (
              <BuddyPanel
                isDraftThread={Boolean(activeBuddyThread.isDraft)}
                messages={activeBuddyThread.messages || []}
                onAskBuddy={askBuddy}
                onEnsureThread={ensureBuddyThreadForFirstMessage}
                onMessagesChange={(updater, targetThreadId) =>
                  updateBuddyMessages(targetThreadId || activeBuddyThread.id, updater)
                }
                onError={showError}
                onPersistMessages={(nextMessages, targetThreadId) =>
                  saveBuddyThreadMessages(targetThreadId || activeBuddyThread.id, nextMessages)
                }
                onSyncResources={syncBuddyResources}
                onUploadFiles={uploadSharedFiles}
                onNotify={showRoomToast}
                resources={resources}
                syncingResources={buddySyncing}
                threadId={activeBuddyThread.id}
                threadTitle={activeBuddyThread.title || "New Chat"}
                user={user}
              />
            ) : null}
          </section>
        ) : null}

        {room.isMember && activeTab === "resources" ? (
          <section className="room-content-panel">
            <ResourcePanel
              onChanged={() => loadRoomBundle(room.id)}
              onError={showError}
              onCreateFolder={createResourceFolder}
              onUploadFiles={uploadSharedFiles}
              resources={resources}
              room={room}
              selectedFolder={selectedResourceFolder}
            />
          </section>
        ) : null}

        {room.isMember && activeTab === "calendar" ? (
          <section className="room-content-panel">
            <SessionPanel
              onChanged={() => loadRoomBundle(room.id)}
              onError={showError}
              room={room}
              sessions={sessions}
            />
          </section>
        ) : null}

        {room.isMember && settingsOpen ? (
          <div className="settings-modal-backdrop" role="dialog" aria-modal="true">
            <div className="settings-modal">
              <button
                className="modal-close-button"
                onClick={() => setSettingsOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
              <SettingsPanel
                onBack={onBack}
                onChanged={(updatedRoom) => {
                  setRoom(updatedRoom);
                  setNotice("Room updated.");
                }}
                onError={showError}
                room={room}
              />
            </div>
          </div>
        ) : null}

        {alertMessage ? (
          <AlertDialog message={alertMessage} onClose={() => setAlertMessage("")} />
        ) : null}

        {roomToast ? (
          <div className="room-toast" role="status" aria-live="polite">
            <Info size={18} />
            <span>{roomToast.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setRoomToast(null)}
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        ) : null}

        {channelModalOpen ? (
          <ChannelDialog
            onCancel={() => setChannelModalOpen(false)}
            onCreate={createChatChannel}
          />
        ) : null}

        {buddyDeleteTarget ? (
          <ConfirmDialog
            confirmLabel="Delete"
            message={`Delete "${buddyDeleteTarget.title}"?`}
            onCancel={() => setBuddyDeleteTarget(null)}
            onConfirm={async () => {
              await deleteBuddyThread(buddyDeleteTarget.id);
              setBuddyDeleteTarget(null);
            }}
            title="Delete Chat"
          />
        ) : null}

        {buddyRenameTarget ? (
          <TextInputDialog
            confirmLabel="Rename"
            initialValue={buddyRenameTarget.title}
            label="Chat name"
            onCancel={() => setBuddyRenameTarget(null)}
            onSubmit={async (title) => {
              await renameBuddyThread(buddyRenameTarget.id, title);
              setBuddyRenameTarget(null);
            }}
            placeholder="Study plan"
            title="Rename Chat"
          />
        ) : null}
      </main>
    </div>
  );
}

/** Sidebar content that changes based on the active room tool. */
function RoomContextPanel({
  activeTab,
  activeChannel,
  activeBuddyThreadId,
  buddyThreads,
  channelActionLoading,
  channels,
  copyInviteLink,
  inviteCopied,
  onCloseSidebar,
  onCreateChannel,
  onDeleteChannel,
  onNewBuddyThread,
  onRenameChannel,
  onRequestRenameBuddyThread,
  onRequestDeleteBuddyThread,
  onSelectChannel,
  onSelectBuddyThread,
  onSelectResourceFolder,
  onStartGroupBuddyThread,
  room,
  resourceFolders,
  selectedResourceFolder,
  sessions,
  user,
}) {
  const members = buildVisibleMembers(room, user);
  const [buddySearch, setBuddySearch] = useState("");
  const [buddyMenuTargetId, setBuddyMenuTargetId] = useState("");
  const [channelRenameTarget, setChannelRenameTarget] = useState(null);
  const [channelDeleteTarget, setChannelDeleteTarget] = useState(null);
  const filteredBuddyThreads = buddyThreads.filter((thread) =>
    thread.title.toLowerCase().includes(buddySearch.trim().toLowerCase()),
  );

  // Chat option menus should behave like native popovers: click elsewhere to close.
  useEffect(() => {
    if (!buddyMenuTargetId) return undefined;

    function closeBuddyMenu() {
      setBuddyMenuTargetId("");
    }

    window.addEventListener("click", closeBuddyMenu);
    return () => window.removeEventListener("click", closeBuddyMenu);
  }, [buddyMenuTargetId]);

  if (activeTab === "chat") {
    return (
      <>
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Chat" />
        <PanelDivider />
        <label className="context-search">
          <Search size={16} />
          <input placeholder="Search or navigate..." type="search" />
        </label>
        <section className="context-section roomy">
          <div className="context-section-title">
            <h3>Channels</h3>
            <button
              aria-label="New channel"
              onClick={onCreateChannel}
              title="New channel"
              type="button"
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="room-channel-list">
            {channels.map((channel) => (
              <article
                className={
                  channel === activeChannel ? "channel-list-item active" : "channel-list-item"
                }
                key={channel}
              >
                <button
                  className="channel-main"
                  onClick={(event) => {
                    onSelectChannel(channel);
                    event.currentTarget.blur();
                  }}
                  type="button"
                >
                  <Hash size={17} />
                  <span>{channel}</span>
                </button>
                {channel !== "general" ? (
                  <span className="channel-actions">
                    <button
                      aria-label={`Rename ${channel}`}
                      disabled={channelActionLoading}
                      onClick={() => setChannelRenameTarget(channel)}
                      title="Rename channel"
                      type="button"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      aria-label={`Delete ${channel}`}
                      disabled={channelActionLoading}
                      onClick={() => setChannelDeleteTarget(channel)}
                      title="Delete channel"
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                ) : null}
              </article>
            ))}
          </div>
        </section>
        {channelRenameTarget ? (
          <TextInputDialog
            confirmLabel="Rename"
            initialValue={channelRenameTarget}
            label="Channel name"
            onCancel={() => setChannelRenameTarget(null)}
            onSubmit={async (name) => {
              await onRenameChannel(channelRenameTarget, name);
              setChannelRenameTarget(null);
            }}
            placeholder="tutorials"
            title="Rename Channel"
          />
        ) : null}
        {channelDeleteTarget ? (
          <ConfirmDialog
            confirmLabel="Delete"
            message={`Delete #${channelDeleteTarget} and its messages?`}
            onCancel={() => setChannelDeleteTarget(null)}
            onConfirm={async () => {
              await onDeleteChannel(channelDeleteTarget);
              setChannelDeleteTarget(null);
            }}
            title="Delete Channel"
          />
        ) : null}
      </>
    );
  }

  if (activeTab === "buddy") {
    return (
      <>
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Intelligrate" />
        <PanelDivider />
        <div className="buddy-sidebar-nav">
          <button className="buddy-nav-action" onClick={onNewBuddyThread} type="button">
            <Edit3 size={17} />
            New Chat
          </button>
          <label className="buddy-nav-search">
            <Search size={16} />
            <input
              onChange={(event) => setBuddySearch(event.target.value)}
              placeholder="Search chats"
              type="search"
              value={buddySearch}
            />
          </label>
        </div>
        <section className="context-section roomy buddy-recents-section">
          <h3>Recents</h3>
          <div className="recent-chat-list chatgpt-style">
            {filteredBuddyThreads.map((thread) => (
              <article
                className={
                  thread.id === activeBuddyThreadId
                    ? "recent-chat-item active"
                    : "recent-chat-item"
                }
                key={thread.id}
              >
                <button
                  className="recent-chat-main"
                  onClick={() => onSelectBuddyThread(thread.id)}
                  type="button"
                >
                  {thread.visibility === "public" ? (
                    <Users size={13} />
                  ) : (
                    <Lock size={13} />
                  )}
                  <span>{thread.title}</span>
                </button>
                <span className="recent-chat-actions">
                  <button
                    aria-expanded={buddyMenuTargetId === thread.id}
                    aria-label={`Open ${thread.title} menu`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setBuddyMenuTargetId((current) =>
                        current === thread.id ? "" : thread.id,
                      );
                    }}
                    title="Chat options"
                    type="button"
                  >
                    <MoreVertical size={15} />
                  </button>
                </span>
                {buddyMenuTargetId === thread.id ? (
                  <div
                    className="recent-chat-menu"
                    onClick={(event) => event.stopPropagation()}
                    role="menu"
                  >
                    <button
                      disabled={!thread.isOwner}
                      onClick={() => {
                        onRequestRenameBuddyThread(thread);
                        setBuddyMenuTargetId("");
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Edit3 size={15} />
                      Rename
                    </button>
                    {thread.visibility === "private" ? (
                      <button
                        disabled={!thread.isOwner}
                        onClick={() => {
                          onStartGroupBuddyThread(thread.id);
                          setBuddyMenuTargetId("");
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Users size={15} />
                        Start Group Chat
                      </button>
                    ) : null}
                    <button
                      className="danger"
                      disabled={!thread.isOwner}
                      onClick={() => {
                        onRequestDeleteBuddyThread(thread);
                        setBuddyMenuTargetId("");
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!filteredBuddyThreads.length && buddySearch.trim() ? (
              <p>No chats found.</p>
            ) : null}
          </div>
        </section>
      </>
    );
  }

  if (activeTab === "resources") {
    return (
      <>
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Resources" />
        <PanelDivider />
        <section className="context-section roomy">
          <h3>Folders</h3>
          <div className="room-folder-list">
            {resourceFolders.map((folder) => (
              <button
                className={folder === selectedResourceFolder ? "active" : ""}
                key={folder}
                onClick={() => onSelectResourceFolder(folder)}
                type="button"
              >
                <FolderOpen size={16} />
                {folder}
              </button>
            ))}
          </div>
        </section>
      </>
    );
  }

  if (activeTab === "calendar") {
    return (
      <>
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Calendar" />
        <PanelDivider />
        <section className="context-section roomy">
          <h3>Scheduled</h3>
          <div className="mini-session-list">
            {sessions.length ? (
              sessions.map((session) => (
                <article key={session.id}>
                  <strong>{session.title}</strong>
                  <span>{formatDateTime(session.startsAt)}</span>
                </article>
              ))
            ) : (
              <p>No meetings yet.</p>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        onCloseSidebar={onCloseSidebar}
        title="Home"
      />
      <button
        className="room-invite-button"
        disabled={!room.inviteCode}
        onClick={copyInviteLink}
        title={inviteCopied ? "Link copied" : "Copy invite link"}
        type="button"
      >
        <span>
          <Users size={18} />
          Invite
        </span>
        <span className="invite-link-state">
          {inviteCopied ? <Check size={18} /> : <LinkIcon size={17} />}
        </span>
      </button>
      <PanelDivider />
      <section className="context-section roomy">
        <h3>Members</h3>
        <div className="member-list">
          {members.map((member) => (
            <article key={member.id}>
              <span className="member-avatar">{member.initial}</span>
              <div>
                <strong>{member.name}</strong>
                <p>{member.role}</p>
              </div>
              {member.owner ? <CrownBadge /> : null}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

/** Landing view for a room, intentionally limited to core room identity. */
function HomePanel({ room }) {
  return (
    <section className="room-home-panel" aria-label="Room overview">
      <article className="room-home-overview">
        <span className="room-home-module">{room.moduleCode}</span>
        <h2>{room.name}</h2>
        <p>{room.description || "No description has been added for this room yet."}</p>
      </article>
    </section>
  );
}

/** Shared sidebar header with a collapse control aligned to the title. */
function PanelHeader({ eyebrow, onCloseSidebar, title, subtitle }) {
  return (
    <div className="context-panel-topline">
      <header className="context-panel-header">
        {eyebrow ? <p>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <span>{subtitle}</span> : null}
      </header>
      <button
        className="context-collapse-button"
        onClick={onCloseSidebar}
        title="Close sidebar"
        type="button"
      >
        <PanelLeftClose size={18} />
      </button>
    </div>
  );
}

/** Simple visual separator used between sidebar headings and controls. */
function PanelDivider() {
  return <span className="context-divider" aria-hidden="true" />;
}

/** Modal for creating a new room chat channel. */
function ChannelDialog({ onCancel, onCreate }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /** Validates the typed channel name before passing it to the room API. */
  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSubmitting(true);
    await onCreate(trimmed);
    setSubmitting(false);
  }

  return (
    <div
      className="modal-backdrop room-form-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <form className="room-form-modal" onSubmit={handleSubmit}>
        <header>
          <h2>New Channel</h2>
          <button onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>
        <label className="field">
          <span>Channel Name</span>
          <input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. tutorials"
            value={name}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button compact" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={submitting || !name.trim()} type="submit">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

/** Modal for scheduling a study session on the room calendar. */
function MeetingDialog({ form, onCancel, onChange, onSubmit, submitting }) {
  /** Updates one meeting field while preserving the rest of the draft. */
  function updateField(event) {
    onChange((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  return (
    <div
      className="modal-backdrop room-form-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <form className="room-form-modal" onSubmit={onSubmit}>
        <header>
          <h2>New Meeting</h2>
          <button onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>
        <label className="field">
          <span>Title</span>
          <input
            name="title"
            onChange={updateField}
            placeholder="Revision session"
            value={form.title}
          />
        </label>
        <label className="field">
          <span>Date and Time</span>
          <input
            name="startsAt"
            onChange={updateField}
            type="datetime-local"
            value={form.startsAt}
          />
        </label>
        <label className="field">
          <span>Agenda</span>
          <textarea
            name="agenda"
            onChange={updateField}
            placeholder="Topics to cover"
            rows={4}
            value={form.agenda}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button compact" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={submitting} type="submit">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** Small owner label used beside room members. */
function CrownBadge() {
  return <span className="crown-badge">Owner</span>;
}

/** Discord-style room chat panel with channel messages and shared attachments. */
function ChatPanel({ channel, messages, onError, onSend, onUploadFiles, user }) {
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef(null);
  const listRef = useRef(null);
  const channelMessages = messages.filter(
    (message) => (message.channel || "general") === channel,
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [channelMessages.length]);

  /** Adds files to the pending chat message without uploading until send. */
  function addAttachments(fileList) {
    setAttachments((current) => [...current, ...Array.from(fileList || [])]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** Removes one pending attachment from the chat composer. */
  function removeAttachment(indexToRemove) {
    setAttachments((current) =>
      current.filter((_file, index) => index !== indexToRemove),
    );
  }

  /** Uploads pending files, sends the socket message, then clears the composer. */
  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed && !attachments.length) return;

    setSending(true);

    try {
      const uploaded = attachments.length
        ? await onUploadFiles(attachments, UPLOADS_FOLDER)
        : [];
      await onSend(trimmed, {
        channel,
        attachments: uploaded.map(resourceToAttachment),
      });
      setBody("");
      setAttachments([]);
    } catch (err) {
      onError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="chat-room-panel">
      <header className="chat-channel-bar">
        <span>
          <Hash size={18} />
          {channel}
        </span>
      </header>

      <div className="message-list discord-messages" ref={listRef}>
        {channelMessages.length ? (
          channelMessages.map((message) => (
            <article className="message chat-message-row" key={message.id}>
              <span className="message-avatar">
                {getInitial(message.sender?.name || message.sender?.email || "U")}
              </span>
              <div className="message-body">
                <div className="message-meta">
                  <strong>
                    {message.sender?.id === user.id
                      ? "You"
                      : message.sender?.name || "Unknown"}
                  </strong>
                  <span>{formatDateTime(message.createdAt)}</span>
                </div>
                {message.body ? <p>{message.body}</p> : null}
                {message.attachments?.length ? (
                  <div className="message-attachment-list">
                    {message.attachments.map((attachment) => (
                      <a
                        href={attachment.url}
                        key={attachment.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Paperclip size={14} />
                        {attachment.title}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="chat-empty">
            <MessageCircle size={28} />
            <strong>Say hello in #{channel}</strong>
            <p>Messages sent here are visible to everyone in the room.</p>
          </div>
        )}
      </div>

      {attachments.length ? (
        <div className="attachment-preview-row">
          {attachments.map((file, index) => (
            <button
              key={`${file.name}-${file.size}-${index}`}
              onClick={() => removeAttachment(index)}
              title="Remove attachment"
              type="button"
            >
              <Paperclip size={13} />
              {file.name}
              <X size={13} />
            </button>
          ))}
        </div>
      ) : null}

      <form className="message-form room-composer" onSubmit={handleSubmit}>
        <input
          multiple
          onChange={(event) => addAttachments(event.target.files)}
          ref={fileInputRef}
          type="file"
        />
        <button
          className="chat-attach-button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
          type="button"
        >
          <Paperclip size={18} />
        </button>
        <input
          onChange={(event) => setBody(event.target.value)}
          placeholder={`Message #${channel}`}
          value={body}
        />
        <button
          className="icon-button filled"
          disabled={sending || (!body.trim() && !attachments.length)}
          title="Send"
          type="submit"
        >
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

/** Dropbox-style resource library for room files and links. */
function ResourcePanel({
  onChanged,
  onCreateFolder,
  onError,
  onUploadFiles,
  resources,
  room,
  selectedFolder,
}) {
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [urlForm, setUrlForm] = useState({ title: "", url: "" });
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);
  const visibleResources =
    selectedFolder === "All files"
      ? resources
      : resources.filter((resource) => (resource.folder || "General") === selectedFolder);

  /** Saves an external URL resource into the selected folder. */
  async function addUrl(event) {
    event.preventDefault();
    setSubmitting(true);

    try {
      await api.addUrlResource(room.id, {
        ...urlForm,
        folder: selectedFolder === "All files" ? "General" : selectedFolder,
      });
      setUrlForm({ title: "", url: "" });
      setShowLinkForm(false);
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  /** Uploads dropped or selected files into the selected resource folder. */
  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setSubmitting(true);

    try {
      await onUploadFiles(
        files,
        selectedFolder === "All files" ? UPLOADS_FOLDER : selectedFolder,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setSubmitting(false);
      setDragging(false);
    }
  }

  /** Removes one resource from the room library. */
  async function removeResource(resourceId) {
    try {
      await api.deleteResource(resourceId);
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <section
      className={`resource-docs-shell ${dragging ? "dragging" : ""}`}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        uploadFiles(event.dataTransfer.files);
      }}
    >
      <input
        multiple
        onChange={(event) => uploadFiles(event.target.files)}
        ref={fileInputRef}
        type="file"
      />

      <div className="docs-toolbar">
        <div className="docs-search">
          <Search size={17} />
          <input placeholder="Search resources" type="search" />
        </div>
        <button className="secondary-button compact" onClick={() => setFolderDialogOpen(true)} type="button">
          <FolderPlus size={17} />
          New Folder
        </button>
        <button
          className="secondary-button compact"
          disabled={submitting}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Upload size={17} />
          Upload
        </button>
        <button
          className="secondary-button compact"
          onClick={() => setShowLinkForm((current) => !current)}
          type="button"
        >
          <LinkIcon size={17} />
          Add Link
        </button>
      </div>

      <div className="docs-body">
        <div className="docs-main">
          <header className="docs-breadcrumb">
            <span>Resources</span>
            <ChevronRight size={16} />
            <strong>{selectedFolder}</strong>
          </header>

          {showLinkForm ? (
            <form className="docs-link-form" onSubmit={addUrl}>
              <input
                onChange={(event) =>
                  setUrlForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Link title"
                value={urlForm.title}
              />
              <input
                onChange={(event) =>
                  setUrlForm((current) => ({ ...current, url: event.target.value }))
                }
                placeholder="https://..."
                value={urlForm.url}
              />
              <button className="primary-button compact" disabled={submitting} type="submit">
                Save
              </button>
            </form>
          ) : null}

          <div className="docs-drop-hint">
            <Upload size={17} />
            Drop files here to upload them into{" "}
            {selectedFolder === "All files" ? UPLOADS_FOLDER : selectedFolder}.
          </div>

          <div className="docs-table" role="table" aria-label={`${selectedFolder} resources`}>
            <div className="docs-table-row header" role="row">
              <span>Name</span>
              <span>Modified</span>
              <span>Modified By</span>
              <span>Size</span>
              <span aria-label="Actions" />
            </div>
            {visibleResources.length ? (
              visibleResources.map((resource) => (
                <div className="docs-table-row" key={resource.id} role="row">
                  <a href={resource.url} rel="noreferrer" target="_blank">
                    {resource.type === "url" ? <LinkIcon size={17} /> : <FileText size={17} />}
                    {resource.title}
                    <ExternalLink size={13} />
                  </a>
                  <span>{formatDateTime(resource.createdAt)}</span>
                  <span>{resource.uploader?.name || "Unknown"}</span>
                  <span>{resource.type === "file" ? formatBytes(resource.size) : "Link"}</span>
                  <button
                    className="icon-button subtle"
                    onClick={() => removeResource(resource.id)}
                    title="Delete resource"
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <div className="docs-empty">
                <FolderOpen size={26} />
                <strong>This folder is empty.</strong>
                <p>Upload files or add links to start building the room library.</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {folderDialogOpen ? (
        <TextInputDialog
          confirmLabel="Create"
          label="Folder name"
          onCancel={() => setFolderDialogOpen(false)}
          onSubmit={async (folderName) => {
            onCreateFolder(folderName);
            setFolderDialogOpen(false);
          }}
          placeholder="Tutorial notes"
          title="New Folder"
        />
      ) : null}
    </section>
  );
}

/** Weekly calendar view for scheduled room sessions. */
function SessionPanel({ onChanged, onError, room, sessions }) {
  const [form, setForm] = useState({ title: "", startsAt: "", agenda: "" });
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const weekStart = useMemo(() => getWeekStart(new Date(), weekOffset), [weekOffset]);
  const weekDays = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const calendarHours = Array.from({ length: 14 }, (_, index) => index + 10);

  /** Creates a calendar session from the modal form. */
  async function addSession(event) {
    event.preventDefault();
    setSubmitting(true);

    try {
      await api.addSession(room.id, form);
      setForm({ title: "", startsAt: "", agenda: "" });
      setShowMeetingForm(false);
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  /** Deletes a scheduled session and refreshes the calendar. */
  async function removeSession(sessionId) {
    try {
      await api.deleteSession(sessionId);
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <section className="calendar-shell">
      <div className="calendar-board">
        <header className="calendar-toolbar">
          <div>
            <button onClick={() => setWeekOffset((current) => current - 1)} type="button">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => setWeekOffset(0)} type="button">
              Today
            </button>
            <button onClick={() => setWeekOffset((current) => current + 1)} type="button">
              <ChevronRight size={18} />
            </button>
            <strong>{formatMonthYear(weekDays[0])}</strong>
          </div>
          <button
            className="primary-button compact"
            onClick={() => setShowMeetingForm(true)}
            type="button"
          >
            <CalendarPlus size={17} />
            New Meeting
          </button>
        </header>

        {showMeetingForm ? (
          <MeetingDialog
            form={form}
            onCancel={() => setShowMeetingForm(false)}
            onChange={setForm}
            onSubmit={addSession}
            submitting={submitting}
          />
        ) : null}

        <div className="week-grid">
          <span className="calendar-corner" />
          {weekDays.map((day) => (
            <div className="day-heading" key={day.toISOString()}>
              <span>{formatWeekday(day)}</span>
              <strong className={isSameDate(day, new Date()) ? "today" : ""}>
                {day.getDate()}
              </strong>
            </div>
          ))}
          {calendarHours.map((hour) => (
            <div className="calendar-hour-row" key={hour}>
              <span className="hour-label">{String(hour).padStart(2, "0")}:00</span>
              {weekDays.map((day) => (
                <div className="calendar-cell" key={`${day.toISOString()}-${hour}`}>
                  {sessions
                    .filter((session) => sessionFallsInSlot(session, day, hour))
                    .map((session) => (
                      <article className="calendar-event" key={session.id}>
                        <button
                          aria-label="Delete meeting"
                          onClick={() => removeSession(session.id)}
                          type="button"
                        >
                          <X size={13} />
                        </button>
                        <strong>{session.title}</strong>
                        <span>{formatTimeOnly(session.startsAt)}</span>
                      </article>
                    ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Room owner settings modal for metadata, theme, and destructive actions. */
function SettingsPanel({ onBack, onChanged, onError, room }) {
  const [form, setForm] = useState({
    name: room.name,
    moduleCode: room.moduleCode,
    description: room.description,
    visibility: room.visibility,
    tags: room.tags.join(", "),
    theme: room.theme,
    background: room.background || "aurora",
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  /** Updates one settings field while keeping the rest of the form intact. */
  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  /** Persists room metadata edits and notifies the parent room view. */
  async function saveRoom(event) {
    event.preventDefault();
    setSaving(true);

    try {
      const payload = await api.updateRoom(room.id, form);
      onChanged(payload.room);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /** Deletes the entire room after the confirmation dialog has approved it. */
  async function deleteRoom() {
    try {
      await api.deleteRoom(room.id);
      onBack();
    } catch (err) {
      onError(err.message);
    }
  }

  if (!room.isOwner) {
    return (
      <section className="surface">
        <p className="empty-state">Only the room owner can change settings.</p>
      </section>
    );
  }

  return (
    <section className="workspace-grid settings-grid">
      <form className="surface stacked-form" onSubmit={saveRoom}>
        <div className="section-header compact">
          <div>
            <h2>Settings</h2>
          </div>
          <Edit3 size={20} />
        </div>

        <label className="field">
          <span>Room Name</span>
          <input name="name" onChange={updateField} value={form.name} />
        </label>
        <label className="field">
          <span>Module Code</span>
          <input name="moduleCode" onChange={updateField} value={form.moduleCode} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            name="description"
            onChange={updateField}
            rows={4}
            value={form.description}
          />
        </label>
        <label className="field">
          <span>Tags</span>
          <input name="tags" onChange={updateField} value={form.tags} />
        </label>
        <label className="field">
          <span>Visibility</span>
          <select name="visibility" onChange={updateField} value={form.visibility}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        <SettingsPicker
          activeId={form.theme}
          items={themePresets}
          label="Theme"
          onSelect={(themeId) => setForm((current) => ({ ...current, theme: themeId }))}
          type="theme"
        />

        <SettingsPicker
          activeId={form.background}
          items={backgroundPresets}
          label="Background"
          onSelect={(backgroundId) =>
            setForm((current) => ({ ...current, background: backgroundId }))
          }
          type="background"
        />
        <button className="primary-button" disabled={saving} type="submit">
          <Edit3 size={18} />
          {saving ? "Saving" : "Save Changes"}
        </button>
      </form>

      <aside className="surface danger-zone">
        <h3>Delete Room</h3>
        <p>Messages, resources, uploaded files, and sessions will be removed locally.</p>
        <button className="danger-button" onClick={() => setDeleteConfirmOpen(true)} type="button">
          <Trash2 size={17} />
          Delete Room
        </button>
      </aside>

      {deleteConfirmOpen ? (
        <ConfirmDialog
          confirmLabel="Delete"
          message={`Delete "${room.name}" and all of its local data?`}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={deleteRoom}
          title="Delete Room"
        />
      ) : null}
    </section>
  );
}

/** Compact picker shared by settings theme and background choices. */
function SettingsPicker({ activeId, items, label, onSelect, type }) {
  return (
    <div className="picker-group compact-picker">
      <div className="picker-heading">
        <span>{label}</span>
      </div>
      <div className="picker-grid">
        {items.map((item) => (
          <button
            className={activeId === item.id ? "picker-card active" : "picker-card"}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span
              className={type === "theme" ? "theme-swatch" : "background-swatch"}
              style={
                type === "theme"
                  ? {
                    "--swatch-a": item.colors[0],
                    "--swatch-b": item.colors[1],
                    "--swatch-c": item.colors[2],
                  }
                  : { "--background-swatch": item.css }
              }
            />
            <span>
              <strong>{item.name}</strong>
            </span>
            {activeId === item.id ? <CheckCircle2 size={16} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export default RoomView;
