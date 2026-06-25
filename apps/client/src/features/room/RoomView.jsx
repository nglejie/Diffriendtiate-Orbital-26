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
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe2,
  Hash,
  Headphones,
  House,
  Info,
  Link as LinkIcon,
  Lock,
  LogOut,
  MessageCircle,
  MicOff,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Search,
  Send,
  Star,
  Settings,
  Tag,
  Trash2,
  Upload,
  Video,
  Wand2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { api } from "../../api.js";
import { BuddyPanel } from "./BuddyPanel.jsx";
import { UPLOADS_FOLDER } from "./roomConstants.js";
import { createBuddyThread, normalizeBuddyThread } from "./buddyUtils.js";
import { ChannelDialog as ChatChannelDialog } from "./chat/ChannelDialog.jsx";
import { ChatPanel as DiscordChatPanel } from "./chat/ChatPanel.jsx";
import { ChatSidebar } from "./chat/ChatSidebar.jsx";
import {
  ResourceDriveSidebar,
  ResourceFileManager,
  useResourceDriveController,
} from "./resources/ResourceFileManager.jsx";
import {
  DEFAULT_CATEGORY_ID,
  addChannelToCategory,
  createCategoryId,
  moveChannelToCategory,
  normalizeChannelLayout,
  removeChannelFromLayout,
  renameChannelInLayout,
} from "./chat/chatLayout.js";
import {
  RESOURCE_TYPES,
  buildResourceStats,
  createDefaultResourceThreads,
  enrichResources,
  filterResources,
  getResourceDisplayName,
} from "./resourceWorkspace.js";
import AlertDialog from "../../shared/ui/AlertDialog.jsx";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.jsx";
import TextInputDialog from "../../shared/ui/TextInputDialog.jsx";
import {
  buildVisibleMembers,
  buildWeekDays,
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
  AcademicTermSelect,
  BackgroundSection,
  ModuleCodeCombobox,
} from "../dashboard/DashboardComponents.jsx";
import { MAX_ROOM_TAGS } from "../dashboard/dashboardConstants.js";
import {
  createAcademicTermOptions,
  normaliseTags,
} from "../dashboard/dashboardUtils.js";
import {
  backgroundPresets,
  createCustomBackgroundValue,
  createCustomImageBackgroundValue,
  defaultCustomBackgroundColors,
  getBackground,
  getTheme,
  moduleCodeOptions,
} from "../../constants.js";

const tabs = [
  { id: "focus", label: "Home", icon: House },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "buddy", label: "Intelligrate", icon: Bot },
  { id: "resources", label: "Resources", icon: FolderOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays, disabled: true },
];

/** Reads optional room-local UI state without involving the shared backend. */
function readRoomStorage(roomId, key, fallback) {
  if (!roomId) return fallback;

  try {
    const value = window.localStorage.getItem(`diffriendtiate:room:${roomId}:${key}`);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/** Persists room-local UI state that does not need a backend schema yet. */
function writeRoomStorage(roomId, key, value) {
  if (!roomId) return;
  window.localStorage.setItem(`diffriendtiate:room:${roomId}:${key}`, JSON.stringify(value));
}

/** Narrows unknown persisted values to a plain object before child components read them. */
function asObjectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Narrows unknown API/local values to an array so render paths cannot crash on map/filter. */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Returns the room channel list with the default channel always available. */
function getRoomChannels(room) {
  const channels = asArray(room?.channels).filter((channel) => typeof channel === "string" && channel.trim());
  return channels.length ? channels : ["general"];
}

function RoomView({ inviteCode, onBack, onOpenRoom, roomId, token, user }) {
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [resources, setResources] = useState([]);
  const [customResourceFolders, setCustomResourceFolders] = useState([]);
  const [resourceFoldersLoadedRoomId, setResourceFoldersLoadedRoomId] = useState("");
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
  const [chatDialog, setChatDialog] = useState(null);
  const [channelLayout, setChannelLayout] = useState([]);
  const [chatDrafts, setChatDrafts] = useState({});
  const [starredMessageIds, setStarredMessageIds] = useState([]);
  const [channelActionLoading, setChannelActionLoading] = useState(false);
  const [buddySyncing, setBuddySyncing] = useState(false);
  const [buddyThreads, setBuddyThreads] = useState([]);
  const [activeBuddyThreadId, setActiveBuddyThreadId] = useState("");
  const [draftBuddyThread, setDraftBuddyThread] = useState(null);
  const [buddyRenameTarget, setBuddyRenameTarget] = useState(null);
  const [buddyDeleteTarget, setBuddyDeleteTarget] = useState(null);
  const [roomToast, setRoomToast] = useState(null);
  const [importantMessages, setImportantMessages] = useState([]);
  const [resourceThreads, setResourceThreads] = useState({});
  const toastTimeoutRef = useRef(null);

  const theme = getTheme(room?.theme);
  const background = getBackground(room?.background);
  const resourceFolders = useMemo(() => {
    const names = new Set([UPLOADS_FOLDER, "General", ...customResourceFolders]);
    asArray(resources).forEach((resource) => names.add(resource?.folder || "General"));
    return ["All files", ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [customResourceFolders, resources]);
  const resourceDrive = useResourceDriveController({
    onChanged: () => loadRoomBundle(room?.id),
    onDeleteFolder: deleteResourceFolder,
    onCreateFolder: createResourceFolder,
    onError: showError,
    onUploadFiles: uploadSharedFiles,
    resourceFolders,
    resources,
    room,
  });
  const buddyThreadList = asArray(buddyThreads);
  const activeBuddyThread =
    draftBuddyThread ||
    buddyThreadList.find((thread) => thread.id === activeBuddyThreadId) ||
    buddyThreadList[0];

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

  useEffect(() => {
    if (!room?.id) {
      setCustomResourceFolders([]);
      setResourceFoldersLoadedRoomId("");
      return;
    }

    const savedFolders = readRoomStorage(room.id, "resourceFolders", []);
    setCustomResourceFolders(
      Array.isArray(savedFolders)
        ? savedFolders.map((folder) => String(folder || "").trim()).filter(Boolean)
        : [],
    );
    setResourceFoldersLoadedRoomId(room.id);
  }, [room?.id]);

  useEffect(() => {
    if (!room?.id || resourceFoldersLoadedRoomId !== room.id) return;
    writeRoomStorage(room.id, "resourceFolders", customResourceFolders);
  }, [customResourceFolders, resourceFoldersLoadedRoomId, room?.id]);

  useEffect(() => {
    if (!room?.id) return;
    const savedImportantMessages = readRoomStorage(room.id, "importantMessages", []);
    const savedResourceThreads = readRoomStorage(room.id, "resourceThreads", {});
    const savedChatDrafts = readRoomStorage(room.id, "chatDrafts", {});
    const savedStarredMessageIds = readRoomStorage(room.id, "starredMessageIds", []);

    // Local room UI state may outlive refactors. Validate shapes before using
    // them so one stale localStorage value cannot crash the entire room view.
    setImportantMessages(Array.isArray(savedImportantMessages) ? savedImportantMessages : []);
    setResourceThreads(asObjectRecord(savedResourceThreads));
    setChatDrafts(asObjectRecord(savedChatDrafts));
    setStarredMessageIds(Array.isArray(savedStarredMessageIds) ? savedStarredMessageIds : []);
    setChannelLayout(
      normalizeChannelLayout(
        readRoomStorage(room.id, "channelLayout", null),
        getRoomChannels(room),
      ),
    );
  }, [room?.id]);

  useEffect(() => {
    if (!room?.id) return;
    setChannelLayout((current) =>
      normalizeChannelLayout(current, getRoomChannels(room)),
    );
  }, [room?.id, room?.channels]);

  useEffect(() => {
    writeRoomStorage(room?.id, "chatDrafts", chatDrafts);
  }, [chatDrafts, room?.id]);

  useEffect(() => {
    writeRoomStorage(room?.id, "starredMessageIds", starredMessageIds);
  }, [starredMessageIds, room?.id]);

  useEffect(() => {
    writeRoomStorage(room?.id, "channelLayout", channelLayout);
  }, [channelLayout, room?.id]);

  useEffect(() => {
    writeRoomStorage(room?.id, "importantMessages", importantMessages);
  }, [importantMessages, room?.id]);

  useEffect(() => {
    writeRoomStorage(room?.id, "resourceThreads", resourceThreads);
  }, [resourceThreads, room?.id]);

  /** Stars or unstarrs a chat message so the Resources tab can surface reusable context. */
  function toggleImportantMessage(message) {
    if (!message?.id) return;

    setImportantMessages((current) => {
      if (current.some((item) => item.id === message.id)) {
        return current.filter((item) => item.id !== message.id);
      }

      const pinnedMessage = {
        id: message.id,
        body: message.body || "",
        channel: message.channel || "general",
        senderName: message.sender?.name || message.sender?.email || "Unknown",
        createdAt: message.createdAt,
        attachments: message.attachments || [],
      };

      return [pinnedMessage, ...current].slice(0, 40);
    });
  }

  /** Toggles the small Discord-style star shown in the chat message hover toolbar. */
  function toggleStarredMessage(message) {
    if (!message?.id) return;

    setStarredMessageIds((current) =>
      current.includes(message.id)
        ? current.filter((id) => id !== message.id)
        : [message.id, ...current].slice(0, 200),
    );
  }

  /** Stores unsent text per channel so the Drafts section can point users back to it. */
  function updateChatDraft(channel, value) {
    setChatDrafts((current) => {
      const next = { ...current };
      if (value.trim()) next[channel] = value;
      else delete next[channel];
      return next;
    });
  }

  /** Updates discussion threads for one artifact while keeping other resource state intact. */
  function updateResourceThreads(resourceId, updater) {
    if (!resourceId) return;

    setResourceThreads((current) => ({
      ...current,
      [resourceId]:
        typeof updater === "function" ? updater(current[resourceId] || []) : updater,
    }));
  }

  // Keep the Intelligrate tab usable even before a saved chat exists.
  useEffect(() => {
    if (loading || !room?.isMember || activeTab !== "buddy") return;
    if (!draftBuddyThread && !buddyThreadList.length) {
      setDraftBuddyThread(createDraftBuddyThread());
      setActiveBuddyThreadId("");
    }
  }, [activeTab, buddyThreadList.length, draftBuddyThread, loading, room?.isMember]);

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

    socket.on("message:updated", (message) => {
      if (message.roomId !== room.id) return;
      setMessages((current) =>
        current.map((existing) => (existing.id === message.id ? message : existing)),
      );
    });

    socket.on("message:deleted", (payload) => {
      if (payload.roomId !== room.id) return;
      setMessages((current) => current.filter((message) => message.id !== payload.id));
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
          api.getResources(loadedRoom.id, { includeDeleted: true }),
          api.getSessions(loadedRoom.id),
          api.getBuddyThreads(loadedRoom.id),
        ]);
        setMessages(asArray(messagePayload.messages));
        setResources(asArray(resourcePayload.resources));
        setSessions(asArray(sessionPayload.sessions));
        const loadedThreads = asArray(buddyPayload.threads).map((thread) =>
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
    const payload = await api.getResources(room.id, { includeDeleted: true });
    const nextResources = asArray(payload.resources);
    setResources(nextResources);
    return nextResources;
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

  /**
   * Edits one of the signed-in user's messages through the active room socket.
   * Keeping this beside sendViaSocket makes the chat panel's socket contract easy
   * to audit: create, edit, and delete all flow through the same room channel.
   */
  function editViaSocket(messageId, body) {
    return new Promise((resolve, reject) => {
      const socket = window.diffriendtiateSocket;
      if (!socket?.connected) {
        reject(new Error("Chat is reconnecting. Try again in a moment."));
        return;
      }

      socket.emit(
        "message:update",
        {
          roomId: room.id,
          messageId,
          body,
        },
        (ack) => {
          if (ack?.ok) resolve(ack.message);
          else reject(new Error(ack?.message || "Unable to edit the message."));
        },
      );
    });
  }

  /**
   * Deletes one of the signed-in user's messages and lets the server broadcast
   * the removal to other members currently viewing the room.
   */
  function deleteViaSocket(messageId) {
    return new Promise((resolve, reject) => {
      const socket = window.diffriendtiateSocket;
      if (!socket?.connected) {
        reject(new Error("Chat is reconnecting. Try again in a moment."));
        return;
      }

      socket.emit(
        "message:delete",
        {
          roomId: room.id,
          messageId,
        },
        (ack) => {
          if (ack?.ok) resolve(ack.id);
          else reject(new Error(ack?.message || "Unable to delete the message."));
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

  /** Opens the channel creation dialog for the selected sidebar category. */
  function openCreateChannelDialog(categoryId = DEFAULT_CATEGORY_ID) {
    if (!room?.isOwner) return;
    setChatDialog({ mode: "channel", categoryId: categoryId || DEFAULT_CATEGORY_ID });
  }

  /** Opens the category creation dialog from the chat sidebar context menu. */
  function openCreateCategoryDialog() {
    if (!room?.isOwner) return;
    setChatDialog({ mode: "category" });
  }

  /** Creates a local category used for organising server-backed text channels. */
  function createChatCategory(name) {
    if (!room?.isOwner) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setChannelLayout((current) => [
      ...normalizeChannelLayout(current, getRoomChannels(room)),
      { id: createCategoryId(trimmed), name: trimmed, channels: [] },
    ]);
    setChatDialog(null);
  }

  /** Removes a local category while keeping its channels available in the room. */
  function deleteChatCategory(categoryId) {
    if (!room?.isOwner || !categoryId) return;

    setChannelLayout((current) => {
      const normalized = normalizeChannelLayout(current, getRoomChannels(room));
      const target = normalized.find((category) => category.id === categoryId);
      if (!target) return normalized;

      const remaining = normalized.filter((category) => category.id !== categoryId);
      const targetChannels = Array.from(new Set(target.channels || []));
      if (!remaining.length) {
        return [
          {
            id: DEFAULT_CATEGORY_ID,
            name: "Text Channels",
            channels: targetChannels,
          },
        ];
      }

      const fallbackIndex = Math.max(
        0,
        remaining.findIndex((category) => category.id === DEFAULT_CATEGORY_ID),
      );

      return remaining.map((category, index) =>
        index === fallbackIndex
          ? {
            ...category,
            channels: Array.from(new Set([...category.channels, ...targetChannels])),
          }
          : category,
      );
    });
  }

  /** Moves an existing channel between local categories without touching messages. */
  function moveChatChannel(channel, categoryId, beforeChannel = "") {
    if (!room?.isOwner) return;
    setChannelLayout((current) =>
      moveChannelToCategory(
        normalizeChannelLayout(current, getRoomChannels(room)),
        channel,
        categoryId,
        beforeChannel,
      ),
    );
  }

  /** Creates a new text channel and immediately switches the room chat to it. */
  async function createChatChannel(input) {
    if (!room?.id || !room.isOwner) return;

    const name = typeof input === "string" ? input : input?.name;
    const categoryId =
      typeof input === "string" ? DEFAULT_CATEGORY_ID : input?.categoryId || chatDialog?.categoryId;

    try {
      const payload = await api.createChannel(room.id, { name });
      setRoom(payload.room);
      setActiveChatChannel(payload.channel);
      setChannelLayout((current) =>
        addChannelToCategory(
          normalizeChannelLayout(current, getRoomChannels(payload.room)),
          payload.channel,
          categoryId || DEFAULT_CATEGORY_ID,
        ),
      );
      setChatDialog(null);
    } catch (err) {
      showError(err.message);
    }
  }

  /** Renames a channel locally after the API confirms the change. */
  async function renameChatChannel(channel, name) {
    if (!room?.id || !room.isOwner) return;

    setChannelActionLoading(true);
    try {
      const payload = await api.renameChannel(room.id, channel, { name });
      setRoom(payload.room);
      setActiveChatChannel((current) => (current === channel ? payload.channel : current));
      setChannelLayout((current) =>
        renameChannelInLayout(
          normalizeChannelLayout(current, getRoomChannels(payload.room)),
          channel,
          payload.channel,
        ),
      );
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
    if (!room?.id || !room.isOwner) return;

    setChannelActionLoading(true);
    try {
      const payload = await api.deleteChannel(room.id, channel);
      const messagePayload = await api.getMessages(room.id);
      setRoom(payload.room);
      setActiveChatChannel((current) => (current === channel ? payload.channel : current));
      setChannelLayout((current) =>
        removeChannelFromLayout(
          normalizeChannelLayout(current, getRoomChannels(payload.room)),
          channel,
        ),
      );
      setMessages(asArray(messagePayload.messages));
    } catch (err) {
      showError(err.message);
    } finally {
      setChannelActionLoading(false);
    }
  }

  /** Keeps the detail sidebar open whenever a room tool is selected. */
  function selectRoomTab(tabId) {
    if (tabs.some((tab) => tab.id === tabId && tab.disabled)) {
      setNotice("Calendar is currently disabled.");
      return;
    }

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
  }

  /** Removes empty local folders after the resource manager deletes their contents. */
  function deleteResourceFolder(folderName) {
    setCustomResourceFolders((current) =>
      current.filter((name) => name !== folderName && !name.startsWith(`${folderName}/`)),
    );
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

  // Render guards keep old localStorage or partial API responses from taking
  // down the active room tab while the current room data refreshes.
  const safeChannels = getRoomChannels(room);
  const safeChannelLayout = asArray(channelLayout);
  const safeChatDrafts = asObjectRecord(chatDrafts);
  const safeMessages = asArray(messages);
  const safeSessions = asArray(sessions);
  const safeStarredMessageIds = asArray(starredMessageIds);

  return (
    <div
      className={`room-workspace ${contextOpen ? "context-open" : "context-collapsed"} ${
        activeTab === "focus" ? "home-active" : ""
      }`}
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
            {room.roomLogo ? (
              <img src={room.roomLogo} alt="" />
            ) : (
              <span>{String(room.name || "R").trim().charAt(0).toUpperCase() || "R"}</span>
            )}
            {!contextOpen ? <PanelLeftOpen size={15} /> : null}
          </button>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                aria-label={tab.label}
                aria-disabled={tab.disabled || undefined}
                className={`${activeTab === tab.id ? "active" : ""} ${tab.disabled ? "disabled" : ""}`.trim()}
                disabled={tab.disabled}
                key={tab.id}
                onClick={() => selectRoomTab(tab.id)}
                title={tab.disabled ? `${tab.label} is currently disabled` : tab.label}
                type="button"
              >
                <Icon size={22} />
              </button>
            );
          })}
        </div>

        <div className="room-rail-bottom">
          {room.isOwner ? (
            <button
              aria-label="Room settings"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              type="button"
            >
              <Settings size={22} />
            </button>
          ) : null}
          <button aria-label="Exit room" onClick={onBack} title="Exit room" type="button">
            <LogOut size={22} />
          </button>
        </div>
      </nav>

      <aside className="room-context-panel" aria-label={`${activeTab} details`}>
        <div className="room-context-content">
          <RoomContextPanel
            activeTab={activeTab}
            activeChannel={activeChatChannel}
            activeBuddyThreadId={activeBuddyThread?.id}
            buddyThreads={buddyThreads}
            channels={safeChannels}
            channelLayout={safeChannelLayout}
            chatDrafts={safeChatDrafts}
            copyInviteLink={copyInviteLink}
            inviteCopied={inviteCopied}
            onCloseSidebar={() => setContextOpen(false)}
            onCreateCategory={openCreateCategoryDialog}
            onCreateChannel={openCreateChannelDialog}
            onDeleteCategory={deleteChatCategory}
            onDeleteChannel={deleteChatChannel}
            onMoveChannel={moveChatChannel}
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
            resourceDrive={resourceDrive}
            sessions={safeSessions}
            channelActionLoading={channelActionLoading}
            user={user}
          />
        </div>
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
          <section className="room-content-panel chat-content-panel">
            <DiscordChatPanel
              activeChannel={activeChatChannel}
              channelLayout={safeChannelLayout}
              draft={safeChatDrafts[activeChatChannel] || ""}
              drafts={safeChatDrafts}
              messages={safeMessages}
              onDeleteMessage={deleteViaSocket}
              onDraftChange={updateChatDraft}
              onEditMessage={editViaSocket}
              onError={showError}
              onSelectChannel={(channel) => {
                setActiveChatChannel(channel || "general");
              }}
              onSend={sendViaSocket}
              onToggleStarredMessage={toggleStarredMessage}
              onUploadFiles={uploadSharedFiles}
              starredMessageIds={safeStarredMessageIds}
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
          <section className="room-content-panel resource-content-panel">
            <ResourceFileManager drive={resourceDrive} />
          </section>
        ) : null}

        {room.isMember && activeTab === "calendar" ? (
          <section className="room-content-panel">
            <SessionPanel
              onChanged={() => loadRoomBundle(room.id)}
              onError={showError}
              room={room}
              sessions={safeSessions}
            />
          </section>
        ) : null}

        {room.isMember && room.isOwner && settingsOpen ? (
          <RoomSettingsScreen
            onBack={onBack}
            onChanged={(updatedRoom) => {
              setRoom(updatedRoom);
              setNotice("Room updated.");
            }}
            onClose={() => setSettingsOpen(false)}
            onError={showError}
            room={room}
          />
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

        {room.isOwner && chatDialog ? (
          <ChatChannelDialog
            categoryName={
              safeChannelLayout.find((category) => category.id === chatDialog.categoryId)?.name
            }
            mode={chatDialog.mode}
            onCancel={() => setChatDialog(null)}
            onCreateCategory={createChatCategory}
            onCreateChannel={(payload) =>
              createChatChannel({ ...payload, categoryId: chatDialog.categoryId })
            }
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
  channelLayout,
  chatDrafts,
  copyInviteLink,
  inviteCopied,
  onCloseSidebar,
  onCreateCategory,
  onCreateChannel,
  onDeleteCategory,
  onDeleteChannel,
  onMoveChannel,
  onNewBuddyThread,
  onRenameChannel,
  onRequestRenameBuddyThread,
  onRequestDeleteBuddyThread,
  onSelectChannel,
  onSelectBuddyThread,
  onStartGroupBuddyThread,
  room,
  resourceDrive,
  sessions,
  user,
}) {
  const members = buildVisibleMembers(room, user);
  const [buddySearch, setBuddySearch] = useState("");
  const [buddyMenuTargetId, setBuddyMenuTargetId] = useState("");
  const [buddyMenuPosition, setBuddyMenuPosition] = useState({ left: 0, top: 0 });
  const [channelRenameTarget, setChannelRenameTarget] = useState(null);
  const [channelDeleteTarget, setChannelDeleteTarget] = useState(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState(null);
  const safeBuddyThreads = asArray(buddyThreads);
  const safeChannelLayout = asArray(channelLayout);
  const safeChatDrafts = asObjectRecord(chatDrafts);
  const safeSessions = asArray(sessions);
  const canManageRoom = Boolean(room?.isOwner);
  const filteredBuddyThreads = safeBuddyThreads.filter((thread) =>
    String(thread?.title || "New Chat")
      .toLowerCase()
      .includes(buddySearch.trim().toLowerCase()),
  );
  const buddyMenuTarget = safeBuddyThreads.find((thread) => thread.id === buddyMenuTargetId);

  // Chat option menus should behave like native popovers: click elsewhere to close.
  useEffect(() => {
    if (!buddyMenuTargetId) return undefined;

    function closeBuddyMenu() {
      setBuddyMenuTargetId("");
    }

    window.addEventListener("click", closeBuddyMenu);
    return () => window.removeEventListener("click", closeBuddyMenu);
  }, [buddyMenuTargetId]);

  function openBuddyMenu(event, threadId) {
    event.stopPropagation();

    const buttonBounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = 196;
    const menuHeight = 150;

    // Render the menu in viewport coordinates so it cannot be clipped by the
    // sidebar's scroll container. The small clamp keeps it visible near edges.
    setBuddyMenuPosition({
      left: Math.max(
        8,
        Math.min(buttonBounds.right - menuWidth, window.innerWidth - menuWidth - 8),
      ),
      top: Math.max(
        8,
        Math.min(buttonBounds.bottom + 8, window.innerHeight - menuHeight - 8),
      ),
    });
    setBuddyMenuTargetId((current) => (current === threadId ? "" : threadId));
  }

  if (activeTab === "chat") {
    return (
      <>
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Chat" />
        <PanelDivider />
        <ChatSidebar
          activeChannel={activeChannel}
          channelLayout={safeChannelLayout}
          drafts={safeChatDrafts}
          isOwner={canManageRoom}
          onCreateCategory={onCreateCategory}
          onCreateChannel={onCreateChannel}
          onDeleteCategory={(categoryId, categoryName) =>
            setCategoryDeleteTarget({ id: categoryId, name: categoryName })
          }
          onMoveChannel={onMoveChannel}
          onRequestDeleteChannel={setChannelDeleteTarget}
          onSelectChannel={onSelectChannel}
        />
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
        {categoryDeleteTarget ? (
          <ConfirmDialog
            confirmLabel="Delete"
            message={`Delete "${categoryDeleteTarget.name}"? Channels inside it will stay in the room.`}
            onCancel={() => setCategoryDeleteTarget(null)}
            onConfirm={() => {
              onDeleteCategory(categoryDeleteTarget.id);
              setCategoryDeleteTarget(null);
            }}
            title="Delete Category"
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
                    onClick={(event) => openBuddyMenu(event, thread.id)}
                    title="Chat options"
                    type="button"
                  >
                    <MoreVertical size={15} />
                  </button>
                </span>
              </article>
            ))}
            {!filteredBuddyThreads.length && buddySearch.trim() ? (
              <p>No chats found.</p>
            ) : null}
          </div>
        </section>
        {buddyMenuTarget
          ? createPortal(
              <div
                className="recent-chat-menu floating"
                onClick={(event) => event.stopPropagation()}
                role="menu"
                style={{
                  left: `${buddyMenuPosition.left}px`,
                  top: `${buddyMenuPosition.top}px`,
                }}
              >
                <button
                  disabled={!buddyMenuTarget.isOwner}
                  onClick={() => {
                    onRequestRenameBuddyThread(buddyMenuTarget);
                    setBuddyMenuTargetId("");
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Edit3 size={15} />
                  Rename
                </button>
                {buddyMenuTarget.visibility === "private" ? (
                  <button
                    disabled={!buddyMenuTarget.isOwner}
                    onClick={() => {
                      onStartGroupBuddyThread(buddyMenuTarget.id);
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
                  disabled={!buddyMenuTarget.isOwner}
                  onClick={() => {
                    onRequestDeleteBuddyThread(buddyMenuTarget);
                    setBuddyMenuTargetId("");
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>,
              document.body,
            )
          : null}
      </>
    );
  }

  if (activeTab === "resources") {
    return (
      <>
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Resources" />
        <PanelDivider />
        <ResourceDriveSidebar drive={resourceDrive} />
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
            {safeSessions.length ? (
              safeSessions.map((session) => (
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
  const metadata = [room.academicTerm, room.moduleCode].filter(Boolean);

  return (
    <section className="room-home-panel" aria-label="Room overview">
      <article className="room-home-overview">
        {metadata.length ? (
          <p className="room-home-meta" aria-label="Room academic details">
            {metadata.join(" · ")}
          </p>
        ) : null}
        <h2>{room.name}</h2>
        <p>{room.description || "No description has been added for this room yet."}</p>
      </article>
    </section>
  );
}

/** Persistent voice/video dock that keeps future call controls visible in every room. */
function RoomCallDock({ user, variant = "embedded" }) {
  const displayName = user?.name || user?.email || "You";
  const avatarUrl = user?.avatarUrl || user?.avatar || user?.photoUrl || "";

  return (
    <section className={`room-call-dock ${variant}`} aria-label="Room voice and video controls">
      <div className="room-call-user">
        <span className="room-call-avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : getInitial(displayName)}
          <i />
        </span>
        {variant === "embedded" ? (
          <span className="room-call-name" title={displayName}>
            {displayName}
          </span>
        ) : null}
      </div>
      <div className="room-call-actions" aria-label="Call controls">
        <button aria-label="Mute microphone" title="Mute microphone" type="button">
          <MicOff size={18} />
        </button>
        <button aria-label="Deafen" title="Deafen" type="button">
          <Headphones size={18} />
        </button>
        <button aria-label="Toggle video" title="Toggle video" type="button">
          <Video size={18} />
        </button>
      </div>
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

/** Artifact-linked discussion board for room conversations and reusable study context. */
function ChatPanel({
  channel,
  importantMessages = [],
  messages,
  onError,
  onSend,
  onToggleImportantMessage,
  onUploadFiles,
  resources = [],
  room,
  user,
}) {
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [acceptedIds, setAcceptedIds] = useState([]);
  const fileInputRef = useRef(null);
  const listRef = useRef(null);
  const enrichedResources = useMemo(() => enrichResources(resources, room), [resources, room]);
  const importantIds = useMemo(
    () => new Set(importantMessages.map((message) => message.id)),
    [importantMessages],
  );
  const channelMessages = useMemo(
    () => messages.filter((message) => (message.channel || "general") === channel),
    [channel, messages],
  );
  const visibleMessages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return channelMessages.filter((message) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "starred" && importantIds.has(message.id)) ||
        (filter === "accepted" && acceptedIds.includes(message.id));
      const searchable = [
        message.body,
        message.sender?.name,
        ...(message.attachments || []).map((attachment) => attachment.title),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesFilter && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [acceptedIds, channelMessages, filter, importantIds, query]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [visibleMessages.length]);

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

  /** Marks one reply as accepted so important explanations stand out later. */
  function toggleAccepted(messageId) {
    setAcceptedIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId],
    );
  }

  return (
    <section className="discussion-workspace">
      <header className="discussion-header">
        <div>
          <span className="eyebrow-label">Discussion board</span>
          <h2>#{channel}</h2>
          <p>
            Connect questions to files, star useful explanations, and keep study context reusable.
          </p>
        </div>
        <div className="discussion-search">
          <Search size={17} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search discussions"
            type="search"
            value={query}
          />
        </div>
      </header>

      <div className="discussion-filter-row" aria-label="Discussion filters">
        {[
          ["all", "All"],
          ["starred", "Starred"],
          ["accepted", "Accepted"],
        ].map(([id, label]) => (
          <button
            className={filter === id ? "active" : ""}
            key={id}
            onClick={() => setFilter(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {enrichedResources.length ? (
        <div className="discussion-artifact-strip" aria-label="Room artifacts">
          {enrichedResources.slice(0, 5).map((resource) => (
            <button
              key={resource.id}
              onClick={() => setQuery(resource.displayName)}
              title={`Find discussions linked to ${resource.displayName}`}
              type="button"
            >
              <FileText size={15} />
              <span>{resource.displayName}</span>
              <small>{resource.metadata.type}</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className="discussion-list" ref={listRef}>
        {visibleMessages.length ? (
          visibleMessages.map((message) => (
            <article
              className={`discussion-card ${importantIds.has(message.id) ? "starred" : ""}`}
              key={message.id}
            >
              <div className="discussion-avatar">
                {getInitial(message.sender?.name || message.sender?.email || "U")}
              </div>
              <div className="discussion-card-body">
                <div className="discussion-meta">
                  <span>{message.sender?.id === user?.id ? "You" : message.sender?.name || "Unknown"}</span>
                  <time>{formatDateTime(message.createdAt)}</time>
                  {acceptedIds.includes(message.id) ? <mark>Accepted answer</mark> : null}
                </div>
                {message.body ? <p>{message.body}</p> : null}
                {message.attachments?.length ? (
                  <div className="discussion-linked-artifacts">
                    {message.attachments.map((attachment) => (
                      <a
                        href={attachment.url}
                        key={attachment.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <FileText size={14} />
                        {attachment.title}
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="discussion-actions">
                  <button onClick={() => onToggleImportantMessage?.(message)} type="button">
                    <Star
                      fill={importantIds.has(message.id) ? "currentColor" : "none"}
                      size={15}
                    />
                    {importantIds.has(message.id) ? "Starred" : "Star"}
                  </button>
                  <button onClick={() => toggleAccepted(message.id)} type="button">
                    <CheckCircle2 size={15} />
                    {acceptedIds.includes(message.id) ? "Unaccept" : "Accept"}
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="discussion-empty">
            <MessageCircle size={28} />
            <strong>No discussions yet.</strong>
            <p>Ask a question, attach a resource, or star useful answers once they appear.</p>
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

      <form className="message-form room-composer discussion-composer" onSubmit={handleSubmit}>
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
          placeholder={`Ask or add a discussion in #${channel}`}
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

/** Resource-centered study workspace with browse filters and artifact discussions. */
function ResourcePanel({
  onChanged,
  onCreateFolder,
  onError,
  importantMessages = [],
  onUploadFiles,
  onUpdateThreads,
  resourceThreads = {},
  resources,
  room,
  selectedFolder,
  user,
}) {
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [urlForm, setUrlForm] = useState({ title: "", url: "" });
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [activeResourceId, setActiveResourceId] = useState("");
  const [activeThreadId, setActiveThreadId] = useState("");
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const fileInputRef = useRef(null);
  const enrichedResources = useMemo(() => enrichResources(resources, room), [resources, room]);
  const visibleResources = useMemo(
    () =>
      filterResources(enrichedResources, {
        folder: selectedFolder,
        query,
        type: typeFilter,
      }),
    [enrichedResources, query, selectedFolder, typeFilter],
  );
  const stats = useMemo(() => buildResourceStats(enrichedResources), [enrichedResources]);
  const activeResource =
    enrichedResources.find((resource) => resource.id === activeResourceId) ||
    visibleResources[0] ||
    enrichedResources[0];
  const activeThreads = activeResource
    ? resourceThreads[activeResource.id]?.length
      ? resourceThreads[activeResource.id]
      : createDefaultResourceThreads(activeResource)
    : [];
  const activeThread =
    activeThreads.find((thread) => thread.id === activeThreadId) || activeThreads[0];

  useEffect(() => {
    if (!activeResource && activeResourceId) setActiveResourceId("");
    if (activeResource && activeResource.id !== activeResourceId) {
      setActiveResourceId(activeResource.id);
    }
  }, [activeResource, activeResourceId]);

  useEffect(() => {
    if (activeThread && activeThread.id !== activeThreadId) {
      setActiveThreadId(activeThread.id);
    }
  }, [activeThread, activeThreadId]);

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

  /** Creates a discussion topic inside the selected resource artifact. */
  function createResourceThread(event) {
    event.preventDefault();
    if (!activeResource || !newThreadTitle.trim()) return;

    const nextThread = {
      id: `${activeResource.id}-thread-${Date.now()}`,
      title: newThreadTitle.trim(),
      acceptedAnswerId: "",
      comments: [],
    };

    onUpdateThreads(activeResource.id, (current) => [
      ...(current.length ? current : createDefaultResourceThreads(activeResource)),
      nextThread,
    ]);
    setNewThreadTitle("");
    setActiveThreadId(nextThread.id);
  }

  /** Adds a comment under the active artifact discussion. */
  function addThreadComment(event) {
    event.preventDefault();
    if (!activeResource || !activeThread || !commentBody.trim()) return;

    const nextComment = {
      id: `${activeThread.id}-comment-${Date.now()}`,
      body: commentBody.trim(),
      authorName: user?.name || user?.email || "You",
      createdAt: new Date().toISOString(),
    };

    onUpdateThreads(activeResource.id, (current) => {
      const threads = current.length ? current : createDefaultResourceThreads(activeResource);
      return threads.map((thread) =>
        thread.id === activeThread.id
          ? { ...thread, comments: [...thread.comments, nextComment] }
          : thread,
      );
    });
    setCommentBody("");
  }

  /** Marks the clearest explanation in a thread so future visitors can find it quickly. */
  function toggleAcceptedComment(commentId) {
    if (!activeResource || !activeThread) return;

    onUpdateThreads(activeResource.id, (current) => {
      const threads = current.length ? current : createDefaultResourceThreads(activeResource);
      return threads.map((thread) =>
        thread.id === activeThread.id
          ? {
              ...thread,
              acceptedAnswerId:
                thread.acceptedAnswerId === commentId ? "" : commentId,
            }
          : thread,
      );
    });
  }

  return (
    <section
      className={`resource-knowledge-shell ${dragging ? "dragging" : ""}`}
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

      <div className="resource-knowledge-toolbar">
        <div className="docs-search">
          <Search size={17} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by topic, filename, contributor"
            type="search"
            value={query}
          />
        </div>
        <select
          aria-label="Filter by resource type"
          onChange={(event) => setTypeFilter(event.target.value)}
          value={typeFilter}
        >
          {RESOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
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

      <div className="resource-stats-row" aria-label="Resource library summary">
        <span>{stats.total} resources</span>
        <span>{stats.types} categories</span>
        <span>{stats.duplicates} duplicate groups</span>
      </div>

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

      <div className="resource-knowledge-layout">
        <div className="resource-browser-column">
          <div className="docs-drop-hint">
            <Upload size={17} />
            Drop files here to upload into{" "}
            {selectedFolder === "All files" ? UPLOADS_FOLDER : selectedFolder}.
          </div>

          <div className="resource-card-grid" aria-label={`${selectedFolder} resources`}>
            {visibleResources.length ? (
              visibleResources.map((resource) => (
                <article
                  className={activeResource?.id === resource.id ? "active resource-card" : "resource-card"}
                  key={resource.id}
                >
                  <button
                    className="resource-card-main"
                    onClick={() => setActiveResourceId(resource.id)}
                    type="button"
                  >
                    {resource.type === "url" ? <LinkIcon size={18} /> : <FileText size={18} />}
                    <span>{resource.displayName}</span>
                    <small>{resource.metadata.type}</small>
                  </button>
                  <div className="resource-card-tags">
                    {resource.metadata.tags.slice(0, 3).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <dl className="resource-card-meta">
                    <div>
                      <dt>Topic</dt>
                      <dd>{resource.metadata.topic}</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>
                        {resource.metadata.version}
                        {resource.metadata.duplicateCount > 1
                        ? ` - ${resource.metadata.duplicateCount} similar`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Contributor</dt>
                      <dd>{resource.metadata.contributor}</dd>
                    </div>
                  </dl>
                  <div className="resource-card-actions">
                    <a href={resource.url} rel="noreferrer" target="_blank">
                      Open
                    </a>
                    <button
                      className="icon-button subtle"
                      onClick={() => removeResource(resource.id)}
                      title="Delete resource"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="docs-empty resource-empty">
                <FolderOpen size={26} />
                <strong>No matching resources.</strong>
                <p>Upload files, add links, or adjust the folder/type filters.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="resource-detail-pane">
          {activeResource ? (
            <>
              <header>
                <span className="eyebrow-label">Artifact workspace</span>
                <h2>{getResourceDisplayName(activeResource)}</h2>
                <p>
                  {activeResource.metadata.type} - {activeResource.metadata.module} -{" "}
                  {activeResource.metadata.semester}
                </p>
              </header>

              <div className="resource-topic-list">
                {activeResource.metadata.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>

              <form className="resource-thread-form" onSubmit={createResourceThread}>
                <input
                  onChange={(event) => setNewThreadTitle(event.target.value)}
                  placeholder="Start a Q&A thread for this resource"
                  value={newThreadTitle}
                />
                <button className="primary-button compact" type="submit">
                  Add Thread
                </button>
              </form>

              <div className="artifact-thread-layout">
                <nav className="artifact-thread-list" aria-label="Resource discussion threads">
                  {activeThreads.map((thread) => (
                    <button
                      className={activeThread?.id === thread.id ? "active" : ""}
                      key={thread.id}
                      onClick={() => setActiveThreadId(thread.id)}
                      type="button"
                    >
                      <span>{thread.title}</span>
                      <small>{thread.comments.length} comments</small>
                    </button>
                  ))}
                </nav>

                <section className="artifact-thread-detail">
                  {activeThread ? (
                    <>
                      <header>
                        <h3>{activeThread.title}</h3>
                        {activeThread.acceptedAnswerId ? <mark>Accepted answer selected</mark> : null}
                      </header>
                      <div className="artifact-comment-list">
                        {activeThread.comments.length ? (
                          activeThread.comments.map((comment) => (
                            <article
                              className={
                                activeThread.acceptedAnswerId === comment.id
                                  ? "accepted artifact-comment"
                                  : "artifact-comment"
                              }
                              key={comment.id}
                            >
                              <div>
                                <strong>{comment.authorName}</strong>
                                <time>{formatDateTime(comment.createdAt)}</time>
                              </div>
                              <p>{comment.body}</p>
                              <button onClick={() => toggleAcceptedComment(comment.id)} type="button">
                                <CheckCircle2 size={15} />
                                {activeThread.acceptedAnswerId === comment.id
                                  ? "Accepted"
                                  : "Mark accepted"}
                              </button>
                            </article>
                          ))
                        ) : (
                          <p className="muted-copy">No comments yet. Start by asking about this artifact.</p>
                        )}
                      </div>
                      <form className="artifact-comment-form" onSubmit={addThreadComment}>
                        <textarea
                          onChange={(event) => setCommentBody(event.target.value)}
                          placeholder="Add an explanation, question, or note"
                          rows={3}
                          value={commentBody}
                        />
                        <button className="primary-button compact" type="submit">
                          Comment
                        </button>
                      </form>
                    </>
                  ) : null}
                </section>
              </div>

              {importantMessages.length ? (
                <section className="important-message-bank">
                  <h3>Starred discussion context</h3>
                  {importantMessages.slice(0, 5).map((message) => (
                    <article key={message.id}>
                      <span>#{message.channel}</span>
                      <p>{message.body || "Attachment-only message"}</p>
                    </article>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            <div className="docs-empty resource-empty">
              <FolderOpen size={26} />
              <strong>No resources yet.</strong>
              <p>Upload the first file to create an artifact workspace.</p>
            </div>
          )}
        </aside>
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

function createRoomSettingsForm(room) {
  return {
    name: room.name || "",
    moduleCode: room.moduleCode || "",
    academicTerm: room.academicTerm || "",
    description: room.description || "",
    visibility: room.visibility === "private" ? "private" : "public",
    password: "",
    tags: normaliseTags(room.tags).join(", "),
    theme: room.theme || "twilight",
    background: room.background || "aurora",
    roomLogo: room.roomLogo || "",
  };
}

/** Full-screen owner settings surface modelled after the create-room flow. */
function RoomSettingsScreen({ onBack, onChanged, onClose, onError, room }) {
  const academicTermOptions = useMemo(() => createAcademicTermOptions(), []);
  const [activePage, setActivePage] = useState("profile");
  const [form, setForm] = useState(() => createRoomSettingsForm(room));
  const [customBackground, setCustomBackground] = useState({
    colors: defaultCustomBackgroundColors,
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPrivatePassword, setShowPrivatePassword] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const logoInputRef = useRef(null);
  const selectedAcademicTerm = form.academicTerm || academicTermOptions[0] || "";
  const roomTags = normaliseTags(form.tags).slice(0, MAX_ROOM_TAGS);
  const roomInitial = String(form.name || "R").trim().charAt(0).toUpperCase() || "R";
  const background = getBackground(form.background);
  const gradientBackgrounds = backgroundPresets.filter((item) => item.type === "Gradient");
  const ambientBackgrounds = backgroundPresets.filter((item) => item.type !== "Gradient");
  const requiresNewPrivatePassword = form.visibility === "private" && room.visibility !== "private";
  const profileReady =
    Boolean(form.name.trim()) &&
    Boolean(form.moduleCode.trim()) &&
    Boolean(selectedAcademicTerm.trim()) &&
    (!requiresNewPrivatePassword || Boolean(form.password.trim()));

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  /** Mirrors the create-room form's simple field update behavior. */
  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  /** Updates non-native controls such as comboboxes, chips, and swatches. */
  function updateFormValue(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateTags(nextTags) {
    setForm((current) => ({ ...current, tags: nextTags.join(", ") }));
  }

  function addTag() {
    const nextTag = tagDraft.trim();
    if (!nextTag || roomTags.length >= MAX_ROOM_TAGS) return;
    if (roomTags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    updateTags([...roomTags, nextTag]);
    setTagDraft("");
  }

  function handleTagKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
  }

  function handleLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      onError("Please upload an image file for the room logo.");
      return;
    }

    if (file.size > 500 * 1024) {
      onError("Please keep room logo images under 500KB for now.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => updateFormValue("roomLogo", String(reader.result));
    reader.onerror = () => onError("Unable to read that room logo.");
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function handleLogoPreviewClick(event) {
    event.preventDefault();

    if (form.roomLogo) {
      updateFormValue("roomLogo", "");
      return;
    }

    logoInputRef.current?.click();
  }

  function handleBackgroundUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      onError("Please upload an image file.");
      return;
    }

    if (file.size > 900 * 1024) {
      onError("Please keep custom background images under 900KB for now.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateFormValue(
        "background",
        createCustomImageBackgroundValue({
          name: "Uploaded Background",
          dataUrl: String(reader.result),
        }),
      );
    };
    reader.onerror = () => onError("Unable to read that image.");
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function updateCustomColor(index, value) {
    setCustomBackground((current) => ({
      ...current,
      colors: current.colors.map((color, colorIndex) =>
        colorIndex === index ? value : color,
      ),
    }));
  }

  function useCustomBackground() {
    updateFormValue(
      "background",
      createCustomBackgroundValue({
        name: "Custom Background",
        colors: customBackground.colors,
      }),
    );
  }

  async function saveRoom(event) {
    event.preventDefault();
    if (!profileReady) {
      onError("Room name, module code, academic term, and private password are required.");
      return;
    }

    setSaving(true);

    try {
      const payload = await api.updateRoom(room.id, {
        ...form,
        academicTerm: selectedAcademicTerm,
        moduleCode: form.moduleCode.trim().toUpperCase(),
        tags: roomTags,
        password: form.visibility === "private" ? form.password : "",
      });
      onChanged(payload.room);
      setForm(createRoomSettingsForm(payload.room));
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoom() {
    setDeleting(true);

    try {
      await api.deleteRoom(room.id);
      onBack();
    } catch (err) {
      onError(err.message);
      setDeleting(false);
    }
  }

  return (
    <section className="room-settings-screen" role="dialog" aria-modal="true" aria-labelledby="room-settings-title">
      <aside className="room-settings-sidebar" aria-label="Room settings sections">
        <div className="room-settings-server-name">{room.name}</div>
        <nav>
          <button
            className={activePage === "profile" ? "active" : ""}
            onClick={() => setActivePage("profile")}
            type="button"
          >
            <Edit3 size={16} />
            Room Profile
          </button>
          <button
            className={activePage === "delete" ? "active danger" : "danger"}
            onClick={() => setActivePage("delete")}
            type="button"
          >
            <Trash2 size={16} />
            Delete Room
          </button>
        </nav>
      </aside>

      <main className="room-settings-main">
        <button className="room-settings-close" onClick={onClose} type="button">
          <X size={24} />
          <span>ESC</span>
        </button>

        {activePage === "profile" ? (
          <form className="room-settings-profile" onSubmit={saveRoom}>
            <header className="room-settings-header">
              <h1 id="room-settings-title">Room Profile</h1>
              <p>Update how this study room appears to members and invite links.</p>
            </header>

            <div className="room-settings-profile-grid">
              <div className="room-settings-fields">
                <section className="room-settings-section">
                  <div className="room-logo-uploader">
                    <button
                      className="room-logo-button"
                      onClick={handleLogoPreviewClick}
                      title={form.roomLogo ? "Click to remove room logo" : "Upload room logo"}
                      type="button"
                    >
                      <span className="room-logo-preview">
                        {form.roomLogo ? <img src={form.roomLogo} alt="" /> : roomInitial}
                      </span>
                    </button>
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className="room-logo-file-input"
                      onChange={handleLogoUpload}
                      ref={logoInputRef}
                      type="file"
                    />
                    <div>
                      <h3>Room Logo</h3>
                      <p>Upload a square image, or use the first letter of the room name.</p>
                    </div>
                  </div>
                </section>

                <section className="room-settings-section">
                  <div className="form-grid">
                    <label className="field">
                      <span>Room Name</span>
                      <input
                        autoComplete="off"
                        name="name"
                        onChange={updateField}
                        value={form.name}
                      />
                    </label>
                    <label className="field">
                      <span>Module Code</span>
                      <ModuleCodeCombobox
                        onChange={(moduleCode) => updateFormValue("moduleCode", moduleCode)}
                        options={moduleCodeOptions}
                        value={form.moduleCode}
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>NUS Academic Year</span>
                    <AcademicTermSelect
                      onChange={(term) => updateFormValue("academicTerm", term)}
                      options={academicTermOptions}
                      value={selectedAcademicTerm}
                    />
                  </label>

                  <label className="field">
                    <span>Description</span>
                    <textarea
                      name="description"
                      autoComplete="off"
                      onChange={updateField}
                      placeholder="Revision plan, focus areas, and group notes."
                      rows={4}
                      value={form.description}
                    />
                  </label>

                  <div className="field">
                    <span>Tags</span>
                    <div className="tag-editor">
                      <div className="tag-editor-list">
                        {roomTags.map((tag) => (
                          <button
                            className="tag-chip-button"
                            key={tag}
                            onClick={() => updateTags(roomTags.filter((currentTag) => currentTag !== tag))}
                            title={`Remove ${tag}`}
                            type="button"
                          >
                            <Tag size={13} />
                            {tag}
                            <X size={13} />
                          </button>
                        ))}
                      </div>
                      <div className="tag-editor-input">
                        <input
                          autoComplete="off"
                          disabled={roomTags.length >= MAX_ROOM_TAGS}
                          onChange={(event) => setTagDraft(event.target.value)}
                          onKeyDown={handleTagKeyDown}
                          placeholder={roomTags.length >= MAX_ROOM_TAGS ? "Maximum 3 tags" : ""}
                          value={tagDraft}
                        />
                        <button
                          className="secondary-button compact"
                          disabled={roomTags.length >= MAX_ROOM_TAGS}
                          onClick={addTag}
                          type="button"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="visibility-settings">
                    <div className="segmented-control" role="group" aria-label="Room visibility">
                      <button
                        className={form.visibility === "public" ? "active" : ""}
                        onClick={() => updateFormValue("visibility", "public")}
                        type="button"
                      >
                        <Globe2 size={16} />
                        Public
                      </button>
                      <button
                        className={form.visibility === "private" ? "active" : ""}
                        onClick={() => updateFormValue("visibility", "private")}
                        type="button"
                      >
                        <Lock size={16} />
                        Private
                      </button>
                    </div>

                    {form.visibility === "private" ? (
                      <label className="private-password-field">
                        <input
                          aria-label="Private room password"
                          autoComplete="new-password"
                          name="private-room-passcode"
                          onChange={(event) => updateFormValue("password", event.target.value)}
                          placeholder={
                            room.visibility === "private"
                              ? "Leave blank to keep current password"
                              : "Password"
                          }
                          type={showPrivatePassword ? "text" : "password"}
                          value={form.password}
                        />
                        <button
                          onClick={() => setShowPrivatePassword((current) => !current)}
                          title={showPrivatePassword ? "Hide password" : "Show password"}
                          type="button"
                        >
                          {showPrivatePassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </label>
                    ) : null}
                  </div>
                </section>

                <section className="room-settings-section">
                  <div className="settings-section-heading">
                    <h2>Room Background</h2>
                    <p>Use the same scene controls from room creation.</p>
                  </div>

                  <div className="custom-background-panel settings-background-builder" aria-label="Custom background">
                    <div>
                      <h4>Custom Background</h4>
                      <p>Upload an image or create a custom gradient for this room.</p>
                    </div>
                    <label className="upload-dropzone">
                      <Upload size={18} />
                      <span>Upload image</span>
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleBackgroundUpload}
                        type="file"
                      />
                    </label>
                    <div className="color-row">
                      {customBackground.colors.map((color, index) => (
                        <label key={`${color}-${index}`}>
                          <span>Color {index + 1}</span>
                          <input
                            onChange={(event) => updateCustomColor(index, event.target.value)}
                            type="color"
                            value={color}
                          />
                        </label>
                      ))}
                    </div>
                    <button className="secondary-button compact" onClick={useCustomBackground} type="button">
                      <Wand2 size={17} />
                      Use Custom Gradient
                    </button>
                  </div>

                  <BackgroundSection
                    activeId={form.background}
                    items={gradientBackgrounds}
                    onSelect={(backgroundId) => updateFormValue("background", backgroundId)}
                    title="Gradients & Colors"
                  />
                  <BackgroundSection
                    activeId={form.background}
                    items={ambientBackgrounds}
                    onSelect={(backgroundId) => updateFormValue("background", backgroundId)}
                    title="Ambient Worlds"
                  />
                </section>
              </div>

              <aside
                className="room-settings-preview"
                style={{
                  "--room-bg": background.css,
                }}
              >
                <div className="settings-preview-cover">
                  <span className="settings-preview-logo">
                    {form.roomLogo ? <img src={form.roomLogo} alt="" /> : roomInitial}
                  </span>
                </div>
                <div className="settings-preview-body">
                  <strong>{form.name || "Your Room"}</strong>
                  <p>
                    {[form.moduleCode || "MODULE", selectedAcademicTerm].filter(Boolean).join(" · ")}
                  </p>
                  <span>{form.visibility === "private" ? "Private room" : "Public room"}</span>
                </div>
              </aside>
            </div>

            <footer className="room-settings-actions">
              <button className="secondary-button compact" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="primary-button compact" disabled={saving || !profileReady} type="submit">
                <Edit3 size={17} />
                {saving ? "Saving" : "Save Changes"}
              </button>
            </footer>
          </form>
        ) : null}

        {activePage === "delete" ? (
          <section className="room-settings-delete">
            <header className="room-settings-header">
              <h1>Delete Room</h1>
              <p>This permanently removes the room and its local room data.</p>
            </header>
            <div className="delete-room-panel">
              <div>
                <h2>Delete {room.name}</h2>
                <p>Messages, resources, uploaded files, and sessions tied to this room will be removed.</p>
              </div>
              <button
                className="danger-button compact"
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(true)}
                type="button"
              >
                <Trash2 size={17} />
                {deleting ? "Deleting" : "Delete Room"}
              </button>
            </div>
          </section>
        ) : null}

        {deleteConfirmOpen ? (
          <ConfirmDialog
            confirmLabel="Delete"
            message={`Delete "${room.name}" and all of its local data?`}
            onCancel={() => setDeleteConfirmOpen(false)}
            onConfirm={deleteRoom}
            title="Delete Room"
          />
        ) : null}
      </main>
    </section>
  );
}

export default RoomView;
