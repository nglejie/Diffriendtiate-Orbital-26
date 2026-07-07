import {
  ArrowLeft,
  Bot,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
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
  Info,
  Link as LinkIcon,
  Lock,
  LogOut,
  Map as MapIcon,
  MessageCircle,
  Mic,
  MicOff,
  MoreVertical,
  MonitorUp,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PhoneOff,
  Plus,
  Search,
  Send,
  Star,
  Settings,
  ScreenShare,
  ScreenShareOff,
  Tag,
  Trash2,
  Upload,
  Video,
  VideoOff,
  VolumeX,
  Wand2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { api, resolveServerAssetUrl } from "../../api.ts";
import { BuddyPanel } from "./BuddyPanel.tsx";
import { UPLOADS_FOLDER } from "./roomConstants.ts";
import { createBuddyThread, normalizeBuddyThread } from "./buddyUtils.ts";
import { ChannelDialog as ChatChannelDialog } from "./chat/ChannelDialog.tsx";
import { ChatPanel as DiscordChatPanel } from "./chat/ChatPanel.tsx";
import { ChatSidebar } from "./chat/ChatSidebar.tsx";
import { DocumentChannelPanel } from "./chat/DocumentChannelPanel.tsx";
import { ImageAnnotatorPanel } from "./chat/ImageAnnotatorPanel.tsx";
import { CoordinatePanel } from "./coordinate/CoordinatePanel.tsx";
import {
  MeetingDisplayStage,
  MeetingDockPreview,
  MeetingMediaStrip,
} from "./meeting/MeetingMediaTiles.tsx";
import { MeetingSidebarPanel } from "./meeting/MeetingSidebarPanel.tsx";
import { useLimeetsMeeting } from "./meeting/useLimeetsMeeting.ts";
import {
  UserProfileControls,
  getStoredProfileStatus,
} from "./profile/UserProfileControls.tsx";
import {
  ResourceDriveSidebar,
  ResourceFileManager,
  useResourceDriveController,
} from "./resources/ResourceFileManager.tsx";
import { VirtualStudySpace } from "./space/VirtualStudySpace.tsx";
import { CUSTOM_WORLD_MAP_ID } from "./space/worldConfig.ts";
import {
  DEFAULT_CATEGORY_ID,
  addChannelToCategory,
  createCategoryId,
  moveCategoryInLayout,
  moveChannelToCategory,
  normalizeChannelLayout,
  renameCategoryInLayout,
} from "./chat/chatLayout.ts";
import {
  RESOURCE_TYPES,
  buildResourceStats,
  createDefaultResourceThreads,
  enrichResources,
  filterResources,
  getResourceDisplayName,
} from "./resourceWorkspace.ts";
import AlertDialog from "../../shared/ui/AlertDialog.tsx";
import { AppSelectMenu } from "../../shared/ui/AppSelectMenu.tsx";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.tsx";
import TextInputDialog from "../../shared/ui/TextInputDialog.tsx";
import {
  buildVisibleMembers,
  buildWeekDays,
  formatDateTime,
  formatMonthYear,
  formatTimeOnly,
  formatWeekday,
  getInitial,
  getWeekStart,
  isSameDate,
  resourceToAttachment,
  sessionFallsInSlot,
} from "../../shared/utils/room.ts";
import {
  AcademicTermSelect,
  BackgroundSection,
  ModuleCodeCombobox,
} from "../dashboard/DashboardComponents.tsx";
import { MAX_ROOM_TAGS } from "../dashboard/dashboardConstants.ts";
import {
  createAcademicTermOptions,
  normaliseTags,
} from "../dashboard/dashboardUtils.ts";
import {
  backgroundPresets,
  createCustomBackgroundValue,
  createCustomImageBackgroundValue,
  defaultCustomBackgroundColors,
  getBackground,
  getTheme,
  moduleCodeOptions,
} from "../../constants.ts";

const BASE_ROOM_TABS = [
  { id: "space", label: "World", icon: MapIcon },
  { id: "chat", label: "Convolution", icon: MessageCircle },
  { id: "buddy", label: "Intelligrate", icon: Bot },
  { id: "resources", label: "Infilenite", icon: FolderOpen },
  { id: "calendar", label: "Coordidate", icon: CalendarDays },
];

function getRoomTabs(meetingActive) {
  return meetingActive
    ? [
        ...BASE_ROOM_TABS,
        { id: "meetings", label: "Limeets", icon: Video },
      ]
    : BASE_ROOM_TABS;
}

function getRoomActivityLabel(tabId) {
  const tab = getRoomTabs(true).find((candidate) => candidate.id === tabId);
  return tab?.label || "World";
}

const DEFAULT_BUDDY_AVAILABILITY = {
  ok: null,
  available: false,
  code: "checking",
  provider: "unknown",
  providerLabel: "Checking provider",
  message: "Checking Intelligrate availability.",
  setupRequired: false,
  canConfigure: false,
};
const DOCUMENT_CHANNEL_UPLOAD_MESSAGE =
  "Document channels support PDF, DOCX, PPTX, PNG, JPG, JPEG, or WEBP files only.";
const DOCUMENT_CHANNEL_UPLOAD_EXTENSIONS = /\.(pdf|docx|pptx|png|jpe?g|webp)$/i;
const DOCUMENT_CHANNEL_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
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

function isDocumentChannelUploadFile(file: File) {
  const mimeType = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();

  return (
    DOCUMENT_CHANNEL_UPLOAD_MIME_TYPES.includes(mimeType) ||
    DOCUMENT_CHANNEL_UPLOAD_EXTENSIONS.test(name)
  );
}

/** Returns the room channel list with the default channel always available. */
function getRoomChannels(room) {
  const seen = new Set();
  const channels = [];

  for (const channel of ["general", ...asArray(room?.channels)]) {
    const name =
      typeof channel === "string"
        ? channel.trim()
        : typeof channel?.name === "string"
          ? channel.name.trim()
          : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    channels.push(name);
  }

  return channels.length ? channels : ["general"];
}

const DEADLINE_SOON_WINDOW_MS = 60 * 60 * 1000;

function parseSessionTime(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function getSessionEndTime(session) {
  const start = parseSessionTime(session?.startsAt);
  if (start == null) return null;

  const explicitEnd = parseSessionTime(session?.endsAt);
  if (explicitEnd != null && explicitEnd > start) return explicitEnd;
  if (session?.kind === "deadline") return start;
  if (session?.metadata?.allDay) return start + 24 * 60 * 60 * 1000;
  return start + 60 * 60 * 1000;
}

function isSessionOngoing(session, now = Date.now()) {
  if (session?.kind === "deadline") return false;
  const start = parseSessionTime(session?.startsAt);
  const end = getSessionEndTime(session);
  return start != null && end != null && start <= now && now < end;
}

function isDeadlineDueSoon(session, now = Date.now()) {
  if (session?.kind !== "deadline") return false;
  const start = parseSessionTime(session?.startsAt);
  return start != null && start >= now && start - now <= DEADLINE_SOON_WINDOW_MS;
}

function normalizeAreaLookup(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getRoomMeetingAreas(room) {
  return asArray(room?.worldConfig?.privateAreas).filter((area) => area?.effects?.meeting);
}

function findSessionWorldMeetingArea(session, room) {
  if (session?.kind !== "meeting") return null;
  const location = normalizeAreaLookup(session?.location);
  if (!location) return null;

  return (
    getRoomMeetingAreas(room).find((area) =>
      [area?.id, area?.name, area?.label].some((candidate) => normalizeAreaLookup(candidate) === location),
    ) || null
  );
}

function getAreaTeleportTarget(area, room) {
  const bounds = area?.bounds || area;
  const col = Number(bounds?.col ?? bounds?.x);
  const row = Number(bounds?.row ?? bounds?.y);
  const width = Number(bounds?.width ?? bounds?.w);
  const height = Number(bounds?.height ?? bounds?.h);
  if (![col, row, width, height].every(Number.isFinite)) return null;

  return {
    areaId: area?.id || "",
    areaName: area?.name || area?.label || "Meeting Area",
    worldRoomId: String(area?.roomId || area?.mapId || room?.worldConfig?.activeRoomId || CUSTOM_WORLD_MAP_ID),
    x: Math.floor(col + width / 2),
    y: Math.floor(row + height / 2),
  };
}

function mergeUserProfile(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.id !== nextUser.id) return currentUser;
  return { ...currentUser, ...nextUser };
}

function RoomView({ inviteCode, onBack, onOpenRoom, onUserUpdated, roomId, token, user }) {
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [resources, setResources] = useState([]);
  const [customResourceFolders, setCustomResourceFolders] = useState([]);
  const [resourceFoldersLoadedRoomId, setResourceFoldersLoadedRoomId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [coordinate, setCoordinate] = useState({ poll: null, polls: [], responses: [] });
  const [activeTab, setActiveTab] = useState("space");
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
  const [buddyAvailability, setBuddyAvailability] = useState(DEFAULT_BUDDY_AVAILABILITY);
  const [buddyRenameTarget, setBuddyRenameTarget] = useState(null);
  const [buddyDeleteTarget, setBuddyDeleteTarget] = useState(null);
  const [roomToast, setRoomToast] = useState(null);
  const [roomSocket, setRoomSocket] = useState(null);
  const [roomActivityMembers, setRoomActivityMembers] = useState([]);
  const [profileStatus, setProfileStatus] = useState(getStoredProfileStatus);
  const [activeMeetingArea, setActiveMeetingArea] = useState(null);
  const [spaceReturnToSpawnSignal, setSpaceReturnToSpawnSignal] = useState(0);
  const [spaceTeleportTarget, setSpaceTeleportTarget] = useState(null);
  const [worldHasUnsavedChanges, setWorldHasUnsavedChanges] = useState(false);
  const [importantMessages, setImportantMessages] = useState([]);
  const [resourceThreads, setResourceThreads] = useState({});
  const toastTimeoutRef = useRef(null);
  const documentChannelUploadInputRef = useRef<HTMLInputElement | null>(null);
  const onUserUpdatedRef = useRef(onUserUpdated);
  const userRef = useRef(user);
  const limeetsMeeting = useLimeetsMeeting({ profileStatus, room, socket: roomSocket, user });
  const availableTabs = useMemo(
    () => getRoomTabs(Boolean(limeetsMeeting.isActive)),
    [limeetsMeeting.isActive],
  );

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
  const documentPresence = useMemo(
    () =>
      asArray(roomActivityMembers)
        .filter((entry) => {
          const entryUserId = String(entry?.userId || entry?.user?.id || "");
          const page = Number(entry?.documentPage);
          return (
            entryUserId &&
            entryUserId !== user?.id &&
            entry?.tabId === "chat" &&
            entry?.documentChannel === activeChatChannel &&
            Number.isFinite(page)
          );
        })
        .map((entry) => {
          const profile = entry?.user || entry;
          const name = String(profile?.name || profile?.email || entry?.name || "Unknown");
          const userId = String(entry?.userId || entry?.user?.id || "");
          const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
          return {
            avatarPreset: profile?.avatarPreset,
            avatarUrl: profile?.avatarUrl || profile?.avatar || profile?.photoUrl || "",
            email: profile?.email || "",
            userId,
            name,
            page: Number(entry?.documentPage),
            initial,
          };
        }),
    [activeChatChannel, roomActivityMembers, user?.id],
  );
  const handleDocumentPageChange = useCallback(
    (page: number) => {
      if (!roomSocket?.connected) return;
      roomSocket.emit("room:activity:set", {
        documentChannel: activeChatChannel,
        documentPage: page,
      });
    },
    [activeChatChannel, roomSocket],
  );

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
        asArray(room.channelLayout).length
          ? room.channelLayout
          : readRoomStorage(room.id, "channelLayout", null),
        getRoomChannels(room),
      ),
    );
  }, [room?.id]);

  useEffect(() => {
    if (!room?.id) return;
    setChannelLayout((current) =>
      normalizeChannelLayout(
        asArray(room.channelLayout).length ? room.channelLayout : current,
        getRoomChannels(room),
      ),
    );
  }, [room?.id, room?.channels, room?.channelLayout]);

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

  useEffect(() => {
    if (activeTab === "buddy" && room?.isMember) {
      refreshBuddyAvailability(room.id);
    }
  }, [activeTab, room?.id, room?.isMember]);

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
    if (!buddyAvailability.available) return;
    if (!draftBuddyThread && !buddyThreadList.length) {
      setDraftBuddyThread(createDraftBuddyThread());
      setActiveBuddyThreadId("");
    }
  }, [
    activeTab,
    buddyAvailability.available,
    buddyThreadList.length,
    draftBuddyThread,
    loading,
    room?.isMember,
  ]);

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
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    onUserUpdatedRef.current = onUserUpdated;
  }, [onUserUpdated]);

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
    setRoomSocket(socket);

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

    socket.on("annotation:new", (annotation) => {
      if (annotation.roomId && annotation.roomId !== room.id) return;
      setAnnotations((current) =>
        current.some((existing) => existing.id === annotation.id)
          ? current
          : [...current, annotation],
      );
    });

    socket.on("annotation:updated", (annotation) => {
      if (annotation.roomId && annotation.roomId !== room.id) return;
      setAnnotations((current) =>
        current.map((existing) => (existing.id === annotation.id ? annotation : existing)),
      );
    });

    socket.on("annotation:deleted", (payload) => {
      if (payload.roomId && payload.roomId !== room.id) return;
      setAnnotations((current) => current.filter((annotation) => annotation.id !== payload.id));
    });

    socket.on("resource:conversion-done", (payload) => {
      if (payload?.roomId && payload.roomId !== room.id) return;
      if (!payload?.resourceId) return;

      setResources((current) =>
        asArray(current).map((resource) =>
          resource.id === payload.resourceId
            ? {
                ...resource,
                conversionStatus: payload.conversionStatus || resource.conversionStatus,
                pdfUrl: resolveServerAssetUrl(payload.pdfUrl || resource.pdfUrl || null),
              }
            : resource,
        ),
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

    socket.on("room:activity:state", (payload) => {
      if (payload?.roomId !== room.id) return;
      setRoomActivityMembers(
        asArray(payload.members).map((member) => {
          const documentPage = Number(member?.documentPage);
          return {
            ...member,
            documentChannel: String(member?.documentChannel || ""),
            documentPage: Number.isFinite(documentPage) ? documentPage : undefined,
          };
        }),
      );
    });

    socket.on("user:profile-updated", (payload) => {
      if (payload?.roomId !== room.id || !payload.user?.id) return;
      const nextUser = payload.user;

      if (nextUser.id === userRef.current?.id) {
        onUserUpdatedRef.current?.(mergeUserProfile(userRef.current, nextUser));
      }

      setRoom((current) => {
        if (!current) return current;
        return {
          ...current,
          members: asArray(current.members).map((member) => mergeUserProfile(member, nextUser)),
          owner: mergeUserProfile(current.owner, nextUser),
        };
      });
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          sender: mergeUserProfile(message.sender, nextUser),
        })),
      );
      setRoomActivityMembers((current) =>
        current.map((member) => ({
          ...member,
          user: mergeUserProfile(member.user, nextUser),
        })),
      );
    });

    // Chat panel children send messages through this room-scoped socket.
    // The reference is cleared on unmount to avoid leaking a stale connection.
    window.diffriendtiateSocket = socket;

    return () => {
      socket.disconnect();
      if (window.diffriendtiateSocket === socket) {
        delete window.diffriendtiateSocket;
      }
      setRoomSocket((currentSocket) => (currentSocket === socket ? null : currentSocket));
      setRoomActivityMembers([]);
    };
  }, [room?.id, room?.isMember, token]);

  useEffect(() => {
    if (!room?.id || !room.isMember) return undefined;

    const activeChannelMeta = getActiveChannelMeta();
    if (activeChannelMeta?.type !== "document") return undefined;

    let cancelled = false;
    api
      .getAnnotations(room.id, activeChatChannel)
      .then((payload) => {
        if (cancelled) return;
        const loadedAnnotations = asArray(payload.annotations);
        setAnnotations((current) => [
          ...current.filter((annotation) => annotation.channel !== activeChatChannel),
          ...loadedAnnotations,
        ]);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeChatChannel, room?.channels, room?.id, room?.isMember]);

  useEffect(() => {
    if (!room?.id || !room.isMember || activeTab !== "chat") return undefined;

    const activeChannelMeta = getActiveChannelMeta();
    if (activeChannelMeta?.type !== "document" || !activeChannelMeta.resourceId) return undefined;

    const activeResource = asArray(resources).find(
      (resource) => resource.id === activeChannelMeta.resourceId,
    );
    if (
      !["docx", "pptx"].includes(String(activeResource?.resourceType || "")) ||
      activeResource?.conversionStatus !== "pending"
    ) {
      return undefined;
    }

    let cancelled = false;
    async function refreshPendingConversion() {
      try {
        const payload = await api.getResources(room.id, { includeDeleted: true });
        if (!cancelled) {
          setResources(asArray(payload.resources));
        }
      } catch {
        // Socket updates are still the primary path; this polling fallback should
        // never interrupt document reading if one refresh fails.
      }
    }

    const initialRefreshId = window.setTimeout(refreshPendingConversion, 800);
    const intervalId = window.setInterval(refreshPendingConversion, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(initialRefreshId);
      window.clearInterval(intervalId);
    };
  }, [activeChatChannel, activeTab, resources, room?.channels, room?.id, room?.isMember]);

  useEffect(() => {
    if (!roomSocket || !room?.id || !room.isMember || !activeTab) return undefined;

    roomSocket.emit("room:activity:set", {
      profileStatus,
      roomId: room.id,
      tabId: activeTab,
    });

    return undefined;
  }, [activeTab, profileStatus, room?.id, room?.isMember, roomSocket]);

  useEffect(() => {
    if (!roomSocket || !room?.id || !room.isMember || activeTab !== "chat") return undefined;

    roomSocket.emit("room:activity:set", {
      documentChannel: "",
      documentPage: null,
      roomId: room.id,
      tabId: activeTab,
    });

    return undefined;
  }, [activeChatChannel, activeTab, room?.id, room?.isMember, roomSocket]);

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
        const [
          messagePayload,
          resourcePayload,
          sessionPayload,
          coordinatePayload,
          buddyPayload,
          buddyHealthPayload,
        ] = await Promise.all([
          api.getMessages(loadedRoom.id),
          api.getResources(loadedRoom.id, { includeDeleted: true }),
          api.getSessions(loadedRoom.id),
          api.getCoordinate(loadedRoom.id),
          api.getBuddyThreads(loadedRoom.id),
          api.getBuddyHealth(loadedRoom.id).catch((err) => ({
            ok: false,
            available: false,
            code: "health_check_failed",
            providerLabel: "Unavailable",
            setupRequired: true,
            canConfigure: loadedRoom.isOwner,
            message: err.message || "Unable to check Intelligrate availability.",
          })),
        ]);
        setMessages(asArray(messagePayload.messages));
        setAnnotations([]);
        setResources(asArray(resourcePayload.resources));
        setSessions(asArray(sessionPayload.sessions));
        setCoordinate({
          poll: coordinatePayload.poll || null,
          polls: asArray(coordinatePayload.polls),
          responses: asArray(coordinatePayload.responses),
        });
        setBuddyAvailability({
          ...DEFAULT_BUDDY_AVAILABILITY,
          ...buddyHealthPayload,
          available: Boolean(buddyHealthPayload.available ?? buddyHealthPayload.ok),
          ok: Boolean(buddyHealthPayload.ok),
        });
        const loadedThreads = asArray(buddyPayload.threads).map((thread) =>
          normalizeBuddyThread(thread, user),
        );
        const buddyAvailable = Boolean(buddyHealthPayload.available ?? buddyHealthPayload.ok);

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
          setDraftBuddyThread(buddyAvailable ? createDraftBuddyThread() : null);
        }
      } else {
        setMessages([]);
        setAnnotations([]);
        setResources([]);
        setSessions([]);
        setCoordinate({ poll: null, polls: [], responses: [] });
        setBuddyThreads([]);
        setActiveBuddyThreadId("");
        setDraftBuddyThread(null);
        setBuddyAvailability(DEFAULT_BUDDY_AVAILABILITY);
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

  /** Checks whether Intelligrate has a usable provider before exposing the chat UI. */
  async function refreshBuddyAvailability(nextRoomId = room?.id) {
    if (!nextRoomId) return DEFAULT_BUDDY_AVAILABILITY;

    setBuddyAvailability((current) => ({
      ...current,
      code: current.available ? current.code : "checking",
      message: current.available
        ? current.message
        : "Checking Intelligrate availability.",
    }));

    try {
      const payload = await api.getBuddyHealth(nextRoomId);
      const nextAvailability = {
        ...DEFAULT_BUDDY_AVAILABILITY,
        ...payload,
        available: Boolean(payload.available ?? payload.ok),
        ok: Boolean(payload.ok),
      };
      setBuddyAvailability(nextAvailability);
      return nextAvailability;
    } catch (err) {
      const nextAvailability = {
        ...DEFAULT_BUDDY_AVAILABILITY,
        ok: false,
        available: false,
        code: "health_check_failed",
        providerLabel: "Unavailable",
        setupRequired: true,
        canConfigure: Boolean(room?.isOwner),
        message: err.message || "Unable to check Intelligrate availability.",
      };
      setBuddyAvailability(nextAvailability);
      return nextAvailability;
    }
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
  async function uploadSharedFiles(fileList, folder = UPLOADS_FOLDER, options: { purpose?: string } = {}) {
    const files = Array.from(fileList || []) as File[];
    if (!files.length || !room?.id) return [];

    const uploaded = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);
      formData.append("folder", folder);
      if (options.purpose) {
        formData.append("purpose", options.purpose);
      }
      const payload = await api.uploadFileResource(room.id, formData);
      uploaded.push(payload.resource);
    }

    await refreshResources();
    return uploaded;
  }

  function requestDocumentChannelUpload() {
    documentChannelUploadInputRef.current?.click();
  }

  async function handleDocumentChannelUpload(fileList) {
    if (!fileList?.length) return;

    const files = Array.from(fileList) as File[];
    const invalidFiles = files.filter((file) => !isDocumentChannelUploadFile(file));
    if (invalidFiles.length) {
      const names = invalidFiles
        .map((file) => file.name)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
      showError(names ? `${DOCUMENT_CHANNEL_UPLOAD_MESSAGE} Remove: ${names}.` : DOCUMENT_CHANNEL_UPLOAD_MESSAGE);
      if (documentChannelUploadInputRef.current) {
        documentChannelUploadInputRef.current.value = "";
      }
      return;
    }

    try {
      await uploadSharedFiles(files, UPLOADS_FOLDER, { purpose: "document-channel" });
    } catch (error) {
      showError(error.message);
    } finally {
      if (documentChannelUploadInputRef.current) {
        documentChannelUploadInputRef.current.value = "";
      }
    }
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
  async function askBuddy(messagesForThread, attachmentResources = [], handlers: any = {}) {
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
          let payload: any = {};
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
   * Sends a Convolution message over the active room socket and exposes Socket.IO acks as
   * a Promise so panels can use normal async error handling.
   */
  function sendViaSocket(body, options: any = {}) {
    return new Promise((resolve, reject) => {
      const socket = window.diffriendtiateSocket;
      if (!socket?.connected) {
        reject(new Error("Convolution is reconnecting. Try again in a moment."));
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
        reject(new Error("Convolution is reconnecting. Try again in a moment."));
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
        reject(new Error("Convolution is reconnecting. Try again in a moment."));
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

  function getActiveChannelMeta() {
    const channel = asArray(room?.channels).find((candidate) => {
      const name = typeof candidate === "string" ? candidate : candidate?.name;
      return name === activeChatChannel;
    });

    if (!channel && activeChatChannel !== "general") return null;
    if (!channel || typeof channel === "string") {
      return { name: channel || activeChatChannel || "general", type: "text", resourceId: "" };
    }

    return {
      name: String(channel.name || "general"),
      type: channel.type === "document" ? "document" : "text",
      resourceId: String(channel.resourceId || ""),
    };
  }

  async function createAnnotation(annotationData) {
    if (!room?.id) throw new Error("Room is not ready.");
    const payload = await api.createAnnotation(room.id, activeChatChannel, annotationData);
    if (payload?.annotation) {
      setAnnotations((current) =>
        current.some((annotation) => annotation.id === payload.annotation.id)
          ? current.map((annotation) =>
              annotation.id === payload.annotation.id ? payload.annotation : annotation,
            )
          : [...current, payload.annotation],
      );
    }
  }

  async function updateAnnotation(id, patch) {
    if (!room?.id) throw new Error("Room is not ready.");
    const payload = await api.updateAnnotation(room.id, activeChatChannel, id, patch);
    if (payload?.annotation) {
      setAnnotations((current) =>
        current.map((annotation) => (annotation.id === id ? payload.annotation : annotation)),
      );
    }
  }

  async function deleteAnnotation(id) {
    if (!room?.id) throw new Error("Room is not ready.");
    await api.deleteAnnotation(room.id, activeChatChannel, id);
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  }

  async function addAnnotationReply(annotationId, comment) {
    if (!room?.id) throw new Error("Room is not ready.");
    const payload = await api.addAnnotationReply(room.id, activeChatChannel, annotationId, { comment });
    if (payload?.annotation) {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === annotationId ? payload.annotation : annotation,
        ),
      );
    }
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

  async function saveChatChannelLayout(nextLayout, sourceRoom = room) {
    if (!sourceRoom?.id) return;

    const normalized = normalizeChannelLayout(nextLayout, getRoomChannels(sourceRoom));
    setChannelLayout(normalized);

    if (!sourceRoom.isOwner) return;

    try {
      const payload = await api.updateChannelLayout(sourceRoom.id, normalized);
      if (payload?.room) {
        setRoom(payload.room);
        setChannelLayout(normalizeChannelLayout(payload.room.channelLayout, getRoomChannels(payload.room)));
      }
    } catch (err) {
      showError(err.message);
    }
  }

  /** Creates a local category used for organising server-backed text channels. */
  function createChatCategory(name) {
    if (!room?.isOwner) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const nextLayout = [
      ...normalizeChannelLayout(channelLayout, getRoomChannels(room)),
      { id: createCategoryId(trimmed), name: trimmed, channels: [] },
    ];
    void saveChatChannelLayout(nextLayout);
    setChatDialog(null);
  }

  /** Removes a local category while keeping its channels available in the room. */
  function deleteChatCategory(categoryId) {
    if (!room?.isOwner || !categoryId) return;

    const normalized = normalizeChannelLayout(channelLayout, getRoomChannels(room));
    const target = normalized.find((category) => category.id === categoryId);
    if (!target) return;

    const remaining = normalized.filter((category) => category.id !== categoryId);
    const targetChannels = Array.from(new Set(target.channels || []));
    if (!remaining.length) {
      void saveChatChannelLayout([
        {
          id: DEFAULT_CATEGORY_ID,
          name: "Text Channels",
          channels: targetChannels,
        },
      ]);
      return;
    }

    const fallbackIndex = Math.max(
      0,
      remaining.findIndex((category) => category.id === DEFAULT_CATEGORY_ID),
    );

    void saveChatChannelLayout(
      remaining.map((category, index) =>
        index === fallbackIndex
          ? {
            ...category,
            channels: Array.from(new Set([...category.channels, ...targetChannels])),
          }
          : category,
      ),
    );
  }

  /** Renames a local sidebar category without changing its channels. */
  function renameChatCategory(categoryId, name) {
    if (!room?.isOwner || !categoryId) return;
    void saveChatChannelLayout(
      renameCategoryInLayout(
        normalizeChannelLayout(channelLayout, getRoomChannels(room)),
        categoryId,
        name,
      ),
    );
  }

  /** Reorders whole local categories in the Convolution sidebar. */
  function moveChatCategory(categoryId, beforeCategoryId = "") {
    if (!room?.isOwner || !categoryId) return;
    void saveChatChannelLayout(
      moveCategoryInLayout(
        normalizeChannelLayout(channelLayout, getRoomChannels(room)),
        categoryId,
        beforeCategoryId,
      ),
    );
  }

  /** Moves an existing channel between local categories without touching messages. */
  function moveChatChannel(channel, categoryId, beforeChannel = "") {
    if (!room?.isOwner) return;
    void saveChatChannelLayout(
      moveChannelToCategory(
        normalizeChannelLayout(channelLayout, getRoomChannels(room)),
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
    const type = typeof input === "string" || input?.type !== "document" ? "text" : "document";
    const resourceId = type === "document" ? input?.resourceId || "" : "";
    const categoryId =
      typeof input === "string" ? DEFAULT_CATEGORY_ID : input?.categoryId || chatDialog?.categoryId;

    try {
      const payload = await api.createChannel(room.id, { name, type, resourceId });
      setRoom(payload.room);
      setActiveChatChannel(payload.channel);
      const nextLayout =
        addChannelToCategory(
          normalizeChannelLayout(channelLayout, getRoomChannels(payload.room)),
          payload.channel,
          categoryId || DEFAULT_CATEGORY_ID,
        );
      void saveChatChannelLayout(nextLayout, payload.room);
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
      setChannelLayout(normalizeChannelLayout(payload.room.channelLayout, getRoomChannels(payload.room)));
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
      setChannelLayout(normalizeChannelLayout(payload.room.channelLayout, getRoomChannels(payload.room)));
      setMessages(asArray(messagePayload.messages));
    } catch (err) {
      showError(err.message);
    } finally {
      setChannelActionLoading(false);
    }
  }

  /** Keeps the room sidebar dock available across room tools. */
  function selectRoomTab(tabId) {
    const nextTabId = tabId === "focus" ? "space" : tabId;
    if (
      room?.isOwner &&
      activeTab === "space" &&
      nextTabId !== "space" &&
      worldHasUnsavedChanges &&
      !window.confirm("You have unsaved World changes. Leave without saving?")
    ) {
      return;
    }

    const nextTabs = getRoomTabs(Boolean(limeetsMeeting.isActive));
    if (nextTabs.some((tab) => tab.id === nextTabId && tab.disabled)) {
      setNotice("Coordidate is currently disabled.");
      return;
    }

    if (!nextTabs.some((tab) => tab.id === nextTabId)) {
      setNotice(nextTabId === "meetings" ? "Join a Meeting Area to open Limeets." : "That room area is unavailable.");
      return;
    }

    setActiveTab(nextTabId);
    if (nextTabId !== "space") setWorldHasUnsavedChanges(false);
    setContextOpen(true);
  }

  function joinWorldMeetingFromCalendar(session) {
    const area = findSessionWorldMeetingArea(session, room);
    const target = getAreaTeleportTarget(area, room);
    if (!target) {
      setNotice("That meeting is not linked to a World area.");
      return;
    }

    setSpaceTeleportTarget({
      ...target,
      requestedAt: Date.now(),
    });
    selectRoomTab("space");
  }

  const handleExitRoom = useCallback(() => {
    if (
      room?.isOwner &&
      worldHasUnsavedChanges &&
      !window.confirm("You have unsaved World changes. Leave without saving?")
    ) {
      return;
    }

    setWorldHasUnsavedChanges(false);
    onBack();
  }, [onBack, room?.isOwner, worldHasUnsavedChanges]);

  useEffect(() => {
    if (!limeetsMeeting.isActive && activeTab === "meetings") {
      setActiveTab("space");
    }

    if (!limeetsMeeting.isActive) {
      setActiveMeetingArea(null);
    }
  }, [activeTab, limeetsMeeting.isActive]);

  const handleMeetingAreaChange = useCallback(
    (meetingArea) => {
      if (meetingArea?.areaId) {
        setActiveMeetingArea({
          id: meetingArea.areaId,
          name: meetingArea.name || meetingArea.label || "Meeting Area",
        });
        setContextOpen(true);
        void limeetsMeeting.joinMeeting(meetingArea.areaId);
        return;
      }

      setActiveMeetingArea(null);
      limeetsMeeting.leaveMeeting();
    },
    [limeetsMeeting.joinMeeting, limeetsMeeting.leaveMeeting],
  );

  const handleLeaveMeetingArea = useCallback(() => {
    setActiveMeetingArea(null);
    setSpaceReturnToSpawnSignal((current) => current + 1);
    setActiveTab("space");
    setContextOpen(true);
    limeetsMeeting.leaveMeeting();
  }, [limeetsMeeting.leaveMeeting]);

  /** Opens a local draft chat; persistence starts only after the first message. */
  async function startBuddyThread() {
    if (!room?.id) return;
    if (
      room?.isOwner &&
      activeTab === "space" &&
      worldHasUnsavedChanges &&
      !window.confirm("You have unsaved World changes. Leave without saving?")
    ) {
      return;
    }

    const availability = buddyAvailability.available
      ? buddyAvailability
      : await refreshBuddyAvailability(room.id);

    if (!availability.available) {
      setActiveTab("buddy");
      setWorldHasUnsavedChanges(false);
      setContextOpen(true);
      setNotice("Intelligrate needs an LLM provider before chats can start.");
      return;
    }

    setDraftBuddyThread(createDraftBuddyThread());
    setActiveBuddyThreadId("");
    setActiveTab("buddy");
    setWorldHasUnsavedChanges(false);
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
  const safeAnnotations = asArray(annotations);
  const safeResources = asArray(resources);
  const safeSessions = asArray(sessions);
  const safeStarredMessageIds = asArray(starredMessageIds);
  const visibleResourceCount = safeResources.filter((resource) => !resource?.deletedAt).length;
  const activeChannelMeta = getActiveChannelMeta();
  const isDocumentChannel = activeChannelMeta?.type === "document";
  const activeDocumentResource = safeResources.find(
    (resource) => resource.id === activeChannelMeta?.resourceId,
  );
  const isImageDocumentResource = activeDocumentResource?.resourceType === "image";
  const roomModalOpen = Boolean(
    settingsOpen || alertMessage || chatDialog || buddyDeleteTarget || buddyRenameTarget,
  );
  const spaceContext = {
    activeBuddyThreadTitle: activeBuddyThread?.title || "",
    activeChatChannel,
    calendarAvailable: true,
    intelligrateAvailable: Boolean(buddyAvailability.available),
    intelligrateProviderLabel: buddyAvailability.providerLabel || "",
    resourceCount: visibleResourceCount,
    sessionCount: safeSessions.length,
  };

  return (
    <div
      className={`room-workspace ${contextOpen ? "context-open" : "context-collapsed"} ${
        activeTab === "space" ? "world-active" : ""
      } ${limeetsMeeting.isActive ? "meeting-active" : ""} ${
        limeetsMeeting.isActive && activeTab !== "space" && activeTab !== "meetings"
          ? "dock-preview-active"
          : ""
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
            onClick={() => (contextOpen ? selectRoomTab("space") : setContextOpen(true))}
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
          {availableTabs.map((tab) => {
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
          {room.isOwner ? (
            <>
              <span className="room-rail-divider" aria-hidden="true" />
              <button
                aria-label="World settings"
                onClick={() => setSettingsOpen(true)}
                title="World settings"
                type="button"
              >
                <Settings size={22} />
              </button>
            </>
          ) : null}
        </div>
      </nav>

      <aside className="room-context-panel" aria-label={`${activeTab} details`}>
        <div className="room-context-content">
          <RoomContextPanel
            activeTab={activeTab}
            activeChannel={activeChatChannel}
            buddyAvailability={buddyAvailability}
            activeBuddyThreadId={activeBuddyThread?.id}
            buddyThreads={buddyThreads}
            channels={safeChannels}
            channelObjects={asArray(room.channels)}
            channelLayout={safeChannelLayout}
            chatDrafts={safeChatDrafts}
            copyInviteLink={copyInviteLink}
            currentProfileStatus={profileStatus}
            inviteCopied={inviteCopied}
            meetingCall={limeetsMeeting}
            onCloseSidebar={() => setContextOpen(false)}
            onCreateCategory={openCreateCategoryDialog}
            onCreateChannel={openCreateChannelDialog}
            onDeleteCategory={deleteChatCategory}
            onDeleteChannel={deleteChatChannel}
            onMoveCategory={moveChatCategory}
            onMoveChannel={moveChatChannel}
            onRequestDeleteBuddyThread={setBuddyDeleteTarget}
            onRequestRenameBuddyThread={setBuddyRenameTarget}
            onStartGroupBuddyThread={startGroupBuddyThread}
            onNewBuddyThread={startBuddyThread}
            onRenameCategory={renameChatCategory}
            onRenameChannel={renameChatChannel}
            onSelectChannel={setActiveChatChannel}
            onSelectBuddyThread={(threadId) => {
              setDraftBuddyThread(null);
              setActiveBuddyThreadId(threadId);
            }}
            onJoinWorldMeeting={joinWorldMeetingFromCalendar}
            room={room}
            resourceDrive={resourceDrive}
            roomActivityMembers={roomActivityMembers}
            sessions={safeSessions}
            channelActionLoading={channelActionLoading}
            user={user}
          />
        </div>
      </aside>

      {room.isMember && !roomModalOpen ? (
        <div className="room-sidebar-dock">
          <RoomVoiceDock
            activityLabel={getRoomActivityLabel(activeTab)}
            meeting={limeetsMeeting}
            onExitRoom={handleExitRoom}
            onLeaveMeetingArea={handleLeaveMeetingArea}
            onOpenMeeting={() => selectRoomTab("meetings")}
            onProfileStatusChange={setProfileStatus}
            onUserUpdated={onUserUpdated}
            meetingAreaName={activeMeetingArea?.name || "Meeting Area"}
            profileStatus={profileStatus}
            showMeetingPreview={limeetsMeeting.isActive && activeTab !== "space" && activeTab !== "meetings"}
            user={user}
          />
        </div>
      ) : null}

      <main className="room-main-stage">
        <div className="room-floating-notices" aria-live="polite">
          {notice ? <p className="form-notice">{notice}</p> : null}
        </div>

        {room.isMember && activeTab === "space" ? (
          <MeetingMediaStrip
            meeting={limeetsMeeting}
            onOpen={() => selectRoomTab("meetings")}
            user={user}
          />
        ) : null}

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

        {room.isMember && activeTab === "chat" ? (
          <section className="room-content-panel chat-content-panel">
            {isDocumentChannel && isImageDocumentResource ? (
              <ImageAnnotatorPanel
                activeChannel={activeChatChannel}
                annotations={safeAnnotations.filter(
                  (annotation) => annotation.channel === activeChatChannel,
                )}
                isOwner={room.isOwner}
                documentPresence={documentPresence}
                onAddReply={addAnnotationReply}
                onCreateAnnotation={createAnnotation}
                onDeleteAnnotation={deleteAnnotation}
                onError={showError}
                onPageChange={handleDocumentPageChange}
                onUpdateAnnotation={updateAnnotation}
                resourceId={activeChannelMeta.resourceId}
                resourceTitle={activeDocumentResource?.title || activeDocumentResource?.originalName || "Image"}
                resourceUrl={
                  activeDocumentResource?.fileUrl ||
                  (activeChannelMeta.resourceId
                    ? `/api/resources/${encodeURIComponent(activeChannelMeta.resourceId)}/file`
                    : "")
                }
                user={user}
              />
            ) : isDocumentChannel ? (
              <DocumentChannelPanel
                activeChannel={activeChatChannel}
                annotations={safeAnnotations.filter(
                  (annotation) => annotation.channel === activeChatChannel,
                )}
                isOwner={room.isOwner}
                documentPresence={documentPresence}
                onAddReply={addAnnotationReply}
                onCreateAnnotation={createAnnotation}
                onDeleteAnnotation={deleteAnnotation}
                onError={showError}
                onPageChange={handleDocumentPageChange}
                onUpdateAnnotation={updateAnnotation}
                resourceId={activeChannelMeta.resourceId}
                resourceConversionStatus={activeDocumentResource?.conversionStatus || "not-needed"}
                resourceFileUrl={
                  activeDocumentResource?.fileUrl ||
                  (activeChannelMeta.resourceId
                    ? `/api/resources/${encodeURIComponent(activeChannelMeta.resourceId)}/file`
                    : "")
                }
                resourceMimeType={activeDocumentResource?.mimeType || ""}
                resourcePdfUrl={activeDocumentResource?.pdfUrl || ""}
                resourceTitle={activeDocumentResource?.title || activeDocumentResource?.originalName || "Document"}
                resourceType={activeDocumentResource?.resourceType || ""}
                resourceUrl={
                  activeChannelMeta.resourceId
                    ? `/api/resources/${encodeURIComponent(activeChannelMeta.resourceId)}/file`
                    : ""
                }
                user={user}
              />
            ) : (
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
            )}
          </section>
        ) : null}

        {room.isMember && activeTab === "buddy" ? (
          <section className="room-content-panel buddy-content-panel">
            {!buddyAvailability.available ? (
              <IntelligrateUnavailable
                availability={buddyAvailability}
                isOwner={room.isOwner}
                onRefresh={() => refreshBuddyAvailability(room.id)}
              />
            ) : activeBuddyThread ? (
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

        {room.isMember && activeTab === "space" ? (
          <section className="room-content-panel study-space-content-panel">
            <VirtualStudySpace
              onMeetingAreaChange={handleMeetingAreaChange}
              onNavigate={selectRoomTab}
              onWorldChanged={(updatedRoom) => {
                setRoom(updatedRoom);
                setWorldHasUnsavedChanges(false);
                setNotice("World updated.");
              }}
              onWorldDirtyChange={setWorldHasUnsavedChanges}
              profileStatus={profileStatus}
              returnToSpawnSignal={spaceReturnToSpawnSignal}
              room={room}
              roomActivityMembers={roomActivityMembers}
              socket={roomSocket}
              spaceContext={spaceContext}
              teleportTarget={spaceTeleportTarget}
              user={user}
            />
          </section>
        ) : null}

        {room.isMember && activeTab === "meetings" ? (
          <section className="room-content-panel meeting-content-panel">
            <MeetingDisplayStage
              meeting={limeetsMeeting}
              meetingAreaName={activeMeetingArea?.name || "Meeting Area"}
              user={user}
            />
          </section>
        ) : null}

        {room.isMember && activeTab === "calendar" ? (
          <section className="room-content-panel coordinate-content-panel">
            <CoordinatePanel
              coordinate={coordinate}
              onChanged={() => loadRoomBundle(room.id)}
              onCoordinateChanged={setCoordinate}
              onError={showError}
              room={room}
              sessions={safeSessions}
              user={user}
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
            onCalendarChanged={() => loadRoomBundle(room.id)}
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
            onRequestUpload={requestDocumentChannelUpload}
            resources={safeResources}
          />
        ) : null}

        {room.isOwner ? (
          <input
            accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg,image/webp"
            className="document-channel-upload-input"
            multiple
            onChange={(event) => handleDocumentChannelUpload(event.target.files)}
            ref={documentChannelUploadInputRef}
            type="file"
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

function IntelligrateUnavailable({ availability, isOwner, onRefresh }) {
  const checking = availability?.code === "checking";
  const providerLabel = availability?.providerLabel || "No LLM provider configured";
  const message =
    availability?.message ||
    "Intelligrate needs a local GPU model or a configured Gemini API key before it can be used.";

  return (
    <div className="intelligrate-gate" role="status" aria-live="polite">
      <div className="intelligrate-gate-card">
        <span className="intelligrate-gate-icon">
          <Lock size={24} />
        </span>
        <div>
          <p className="eyebrow">Intelligrate unavailable</p>
          <h2>{checking ? "Checking provider" : "LLM provider required"}</h2>
          <p>{message}</p>
        </div>
        <div className="intelligrate-gate-status">
          <span>Current provider</span>
          <strong>{providerLabel}</strong>
        </div>
        {isOwner ? (
          <div className="intelligrate-gate-owner">
            <h3>Owner setup</h3>
            <p>
              Start the app with the GPU compose override to use the built-in local model,
              or configure a real Gemini API key in the server environment. Per-room API
              keys are not stored in the app yet.
            </p>
          </div>
        ) : (
          <p className="intelligrate-gate-member">
            Ask the room owner to enable the built-in model or configure an API key.
          </p>
        )}
        <button className="secondary-button compact" onClick={onRefresh} type="button">
          <Wand2 size={16} />
          Check again
        </button>
      </div>
    </div>
  );
}

function MiniSessionCard({ joinable = false, now = Date.now(), onJoinWorldMeeting, session, stateLabel = "" }) {
  const content = (
    <>
      <strong>{session.title}</strong>
      <span>{formatDateTime(session.startsAt)}</span>
      {session.location ? <small>{session.location}</small> : null}
      {stateLabel ? <small className="mini-session-state">{stateLabel}</small> : null}
    </>
  );
  const className = [
    "mini-session-card",
    session.kind === "deadline" ? "deadline" : "",
    isSessionOngoing(session, now) ? "ongoing" : "",
    isDeadlineDueSoon(session, now) ? "soon" : "",
    joinable ? "joinable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (joinable) {
    return (
      <button
        aria-label={`Open ${session.title} In World`}
        className={className}
        onClick={() => onJoinWorldMeeting?.(session)}
        type="button"
      >
        {content}
      </button>
    );
  }

  return <article className={className}>{content}</article>;
}

/** Sidebar content that changes based on the active room tool. */
function RoomContextPanel({
  activeTab,
  activeChannel,
  activeBuddyThreadId,
  buddyAvailability,
  buddyThreads,
  channelActionLoading,
  channels,
  channelObjects,
  channelLayout,
  chatDrafts,
  copyInviteLink,
  currentProfileStatus,
  inviteCopied,
  meetingCall,
  onCloseSidebar,
  onCreateCategory,
  onCreateChannel,
  onDeleteCategory,
  onDeleteChannel,
  onMoveCategory,
  onMoveChannel,
  onNewBuddyThread,
  onJoinWorldMeeting,
  onRenameCategory,
  onRenameChannel,
  onRequestRenameBuddyThread,
  onRequestDeleteBuddyThread,
  onSelectChannel,
  onSelectBuddyThread,
  onStartGroupBuddyThread,
  room,
  roomActivityMembers,
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
  const [categoryRenameTarget, setCategoryRenameTarget] = useState(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState(null);
  const [calendarSectionsOpen, setCalendarSectionsOpen] = useState({
    deadlines: true,
    meetings: true,
  });
  const [calendarNow, setCalendarNow] = useState(() => Date.now());
  const safeBuddyThreads = asArray(buddyThreads);
  const safeChannelLayout = asArray(channelLayout);
  const safeChatDrafts = asObjectRecord(chatDrafts);
  const safeSessions = asArray(sessions);
  const canManageRoom = Boolean(room?.isOwner);
  const buddyLocked = activeTab === "buddy" && !buddyAvailability?.available;
  const filteredBuddyThreads = safeBuddyThreads.filter((thread) =>
    String(thread?.title || "New Chat")
      .toLowerCase()
      .includes(buddySearch.trim().toLowerCase()),
  );
  const buddyMenuTarget = safeBuddyThreads.find((thread) => thread.id === buddyMenuTargetId);
  const safeChannelObjects = asArray(channelObjects);

  function toggleCalendarSection(sectionId) {
    setCalendarSectionsOpen((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  useEffect(() => {
    if (activeTab !== "calendar") return undefined;
    setCalendarNow(Date.now());
    const intervalId = window.setInterval(() => setCalendarNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [activeTab]);

  function toggleCalendarSection(sectionId) {
    setCalendarSectionsOpen((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  useEffect(() => {
    if (activeTab !== "calendar") return undefined;
    setCalendarNow(Date.now());
    const intervalId = window.setInterval(() => setCalendarNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [activeTab]);

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
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Convolution" />
        <PanelDivider />
        <ChatSidebar
          activeChannel={activeChannel}
          channelObjects={safeChannelObjects}
          channelLayout={safeChannelLayout}
          drafts={safeChatDrafts}
          isOwner={canManageRoom}
          onCreateCategory={onCreateCategory}
          onCreateChannel={onCreateChannel}
          onDeleteCategory={(categoryId, categoryName) =>
            setCategoryDeleteTarget({ id: categoryId, name: categoryName })
          }
          onMoveCategory={onMoveCategory}
          onMoveChannel={onMoveChannel}
          onRequestDeleteChannel={setChannelDeleteTarget}
          onRequestRenameCategory={setCategoryRenameTarget}
          onRequestRenameChannel={setChannelRenameTarget}
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
        {categoryRenameTarget ? (
          <TextInputDialog
            confirmLabel="Rename"
            initialValue={categoryRenameTarget.name}
            label="Category name"
            onCancel={() => setCategoryRenameTarget(null)}
            onSubmit={async (name) => {
              await onRenameCategory(categoryRenameTarget.id, name);
              setCategoryRenameTarget(null);
            }}
            placeholder="Lecture Notes"
            title="Rename Category"
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
          <button
            className="buddy-nav-action"
            disabled={buddyLocked}
            onClick={onNewBuddyThread}
            title={buddyLocked ? "Intelligrate needs an LLM provider first" : "New Chat"}
            type="button"
          >
            <Edit3 size={17} />
            New Chat
          </button>
          {buddyLocked ? (
            <p className="buddy-sidebar-status">
              {buddyAvailability?.providerLabel || "Provider setup required"}
            </p>
          ) : null}
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
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Infilenite" />
        <PanelDivider />
        <ResourceDriveSidebar drive={resourceDrive} />
      </>
    );
  }

  if (activeTab === "space" || activeTab === "meetings") {
    return (
      <>
        <PanelHeader
          onCloseSidebar={onCloseSidebar}
          title={activeTab === "meetings" ? "Limeets" : "World"}
        />
        <PanelDivider />
        <MeetingSidebarPanel
          copyInviteLink={copyInviteLink}
          inviteCopied={inviteCopied}
          meeting={meetingCall}
          room={room}
          roomActivityMembers={roomActivityMembers}
          currentProfileStatus={currentProfileStatus}
          user={user}
        />
      </>
    );
  }

  if (activeTab === "calendar") {
    const upcomingSessions = safeSessions
      .filter((session) => {
        const start = parseSessionTime(session?.startsAt);
        if (start == null) return false;
        const end = getSessionEndTime(session);
        if (session?.kind === "deadline") return start >= calendarNow;
        return end != null && end >= calendarNow;
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const upcomingDeadlines = upcomingSessions.filter((session) => session.kind === "deadline");
    const upcomingMeetings = upcomingSessions.filter((session) => session.kind !== "deadline");

    return (
      <>
        <PanelHeader onCloseSidebar={onCloseSidebar} title="Coordidate" />
        <PanelDivider />
        <section className="context-section roomy calendar-sidebar-section">
          <button
            aria-expanded={calendarSectionsOpen.meetings}
            className="calendar-sidebar-heading"
            onClick={() => toggleCalendarSection("meetings")}
            type="button"
          >
            <h3>Scheduled Meetings</h3>
            <ChevronDown size={16} />
          </button>
          {calendarSectionsOpen.meetings ? (
            <div className="mini-session-list">
              {upcomingMeetings.length ? (
                upcomingMeetings.slice(0, 6).map((session) => {
                  const ongoing = isSessionOngoing(session, calendarNow);
                  const joinable = ongoing && Boolean(findSessionWorldMeetingArea(session, room));
                  return (
                    <MiniSessionCard
                      joinable={joinable}
                      key={session.id}
                      now={calendarNow}
                      onJoinWorldMeeting={onJoinWorldMeeting}
                      session={session}
                      stateLabel={joinable ? "Ongoing | Join In World" : ongoing ? "Ongoing" : ""}
                    />
                  );
                })
              ) : (
                <p>No Meetings Yet.</p>
              )}
            </div>
          ) : null}
        </section>
        <section className="context-section roomy calendar-sidebar-section">
          <button
            aria-expanded={calendarSectionsOpen.deadlines}
            className="calendar-sidebar-heading"
            onClick={() => toggleCalendarSection("deadlines")}
            type="button"
          >
            <h3>Upcoming Deadlines</h3>
            <ChevronDown size={16} />
          </button>
          {calendarSectionsOpen.deadlines ? (
            <div className="mini-session-list">
              {upcomingDeadlines.length ? (
                upcomingDeadlines.slice(0, 6).map((session) => (
                  <MiniSessionCard
                    key={session.id}
                    now={calendarNow}
                    session={session}
                    stateLabel={isDeadlineDueSoon(session, calendarNow) ? "Due Soon" : ""}
                  />
                ))
              ) : (
                <p>No Imported Deadlines Yet.</p>
              )}
            </div>
          ) : null}
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
              <span className={member.avatarUrl ? "member-avatar image" : "member-avatar"}>
                {member.avatarUrl ? <img alt="" src={member.avatarUrl} /> : member.initial}
              </span>
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

/** Persistent Discord-like room voice/video dock shown across room tabs. */
function RoomVoiceDock({
  activityLabel = "World",
  meeting,
  meetingAreaName = "Meeting Area",
  onExitRoom,
  onLeaveMeetingArea,
  onOpenMeeting,
  onProfileStatusChange,
  onUserUpdated,
  profileStatus,
  showMeetingPreview = false,
  user,
}) {
  const active = Boolean(meeting?.isActive);
  const cameraOff = meeting?.cameraOff ?? true;
  const deafened = Boolean(meeting?.deafened);
  const displayName = meeting?.displayName || user?.name || user?.email || "You";
  const muted = meeting?.muted ?? true;
  const screenSharing = Boolean(meeting?.screenSharing);
  const statusText = active ? `In ${meetingAreaName}` : `In ${activityLabel}`;

  return (
    <section className="room-voice-dock" aria-label="Room voice and video controls">
      {showMeetingPreview ? (
        <MeetingDockPreview
          meeting={meeting}
          meetingAreaName={meetingAreaName}
          onOpen={onOpenMeeting}
          user={user}
        />
      ) : active ? (
        <div className="room-voice-connected" aria-label="Meeting Area connection">
          <div className="room-voice-connected-header">
            <span className="room-voice-signal" aria-hidden="true">
              <MonitorUp size={18} />
            </span>
            <div>
              <strong>Voice Connected</strong>
              <span>{meetingAreaName}</span>
            </div>
          </div>
          <div className="room-voice-connected-actions">
            <button
              aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
              aria-pressed={!cameraOff}
              className={cameraOff ? "is-off" : "is-on"}
              onClick={meeting?.toggleCamera}
              title={cameraOff ? "Turn camera on" : "Turn camera off"}
              type="button"
            >
              {cameraOff ? <VideoOff size={17} /> : <Video size={17} />}
            </button>
            <button
              aria-label={screenSharing ? "Stop sharing screen" : "Share screen"}
              aria-pressed={screenSharing}
              className={screenSharing ? "is-on" : ""}
              onClick={meeting?.toggleScreenShare}
              title={screenSharing ? "Stop sharing screen" : "Share screen"}
              type="button"
            >
              {screenSharing ? <ScreenShareOff size={17} /> : <ScreenShare size={17} />}
            </button>
            <button
              aria-label="Leave Meeting Area"
              className="danger"
              onClick={onLeaveMeetingArea || meeting?.leaveMeeting}
              title="Leave Meeting Area"
              type="button"
            >
              <PhoneOff size={17} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="room-user-controls">
        <UserProfileControls
          active={active}
          onProfileStatusChange={onProfileStatusChange}
          onProfileUpdated={onUserUpdated}
          profileStatus={profileStatus}
          statusText={statusText}
          user={{ ...user, name: displayName }}
        />
        <div className="room-call-actions" aria-label="User controls">
          <button
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={muted}
            className={muted ? "danger active" : ""}
            onClick={meeting?.toggleMuted}
            title={muted ? "Unmute microphone" : "Mute microphone"}
            type="button"
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            aria-label={deafened ? "Undeafen" : "Deafen"}
            aria-pressed={deafened}
            className={deafened ? "active" : ""}
            onClick={meeting?.toggleDeafened}
            title={deafened ? "Undeafen" : "Deafen"}
            type="button"
          >
            {deafened ? <VolumeX size={18} /> : <Headphones size={18} />}
          </button>
          <button aria-label="Exit room" onClick={onExitRoom} title="Exit room" type="button">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}

/** Shared sidebar header with a collapse control aligned to the title. */
function PanelHeader({ eyebrow = "", onCloseSidebar, title, subtitle = "" }) {
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
        <AppSelectMenu
          ariaLabel="Filter by resource type"
          className="resource-type-select"
          onChange={setTypeFilter}
          options={RESOURCE_TYPES.map((type) => ({
            label: type,
            value: type,
          }))}
          value={typeFilter}
        />
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

function CanvasIntegrationSettings({ onCalendarChanged, onError, onRoomChanged, room }) {
  const canvasConnection = room.integrations?.canvas || null;
  const tokenStorageKey = `diffriendtiate:room:${room.id}:canvasAccessToken`;
  const [host, setHost] = useState(canvasConnection?.host || "canvas.nus.edu.sg");
  const [accessToken, setAccessToken] = useState(() => {
    try {
      return window.localStorage.getItem(tokenStorageKey) || "";
    } catch {
      return "";
    }
  });
  const [courses, setCourses] = useState(() =>
    canvasConnection?.courseId
      ? [
          {
            id: canvasConnection.courseId,
            name: canvasConnection.courseName || "Connected module",
            courseCode: canvasConnection.courseCode || "",
          },
        ]
      : [],
  );
  const [selectedCourseId, setSelectedCourseId] = useState(canvasConnection?.courseId || "");
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const selectedCourse = courses.find((course) => course.id === selectedCourseId);

  useEffect(() => {
    setHost(canvasConnection?.host || "canvas.nus.edu.sg");
    setSelectedCourseId(canvasConnection?.courseId || "");
    setCourses(
      canvasConnection?.courseId
        ? [
            {
              id: canvasConnection.courseId,
              name: canvasConnection.courseName || "Connected module",
              courseCode: canvasConnection.courseCode || "",
            },
          ]
        : [],
    );
  }, [canvasConnection?.courseId, canvasConnection?.courseName, canvasConnection?.courseCode, canvasConnection?.host]);

  function rememberCanvasToken() {
    try {
      if (accessToken.trim()) {
        window.localStorage.setItem(tokenStorageKey, accessToken.trim());
      }
    } catch {
      // Browser storage is a convenience only; the server never relies on it.
    }
  }

  async function connectCanvas(event) {
    event.preventDefault();
    setConnecting(true);
    setStatus("");

    try {
      const payload = await api.getCanvasCourses(room.id, { host, accessToken });
      const loadedCourses = asArray(payload.courses);
      const moduleCode = String(room.moduleCode || "").toLowerCase();
      const bestMatch =
        loadedCourses.find((course) =>
          `${course.courseCode || ""} ${course.name || ""}`.toLowerCase().includes(moduleCode),
        ) || loadedCourses[0];

      setCourses(loadedCourses);
      setSelectedCourseId(bestMatch?.id || "");
      rememberCanvasToken();
      setStatus(loadedCourses.length ? "Canvas connected. Choose one module for this World." : "Canvas connected, but no active courses were returned.");
    } catch (err) {
      onError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  async function importDeadlines() {
    if (!selectedCourse) {
      onError("Select a Canvas module before importing deadlines.");
      return;
    }

    setImporting(true);
    setStatus("");

    try {
      const payload = await api.importCanvasDeadlines(room.id, {
        host,
        accessToken,
        courseId: selectedCourse.id,
        courseName: selectedCourse.name,
        courseCode: selectedCourse.courseCode,
      });
      rememberCanvasToken();
      if (payload.room) onRoomChanged?.(payload.room);
      setStatus(`Synced ${selectedCourse.name}. Imported ${payload.imported || 0} new deadline${payload.imported === 1 ? "" : "s"}.`);
      onCalendarChanged?.();
    } catch (err) {
      onError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="room-settings-integrations">
      <header className="room-settings-header">
        <h1>Integrations</h1>
        <p>Connect one module source for this World so room tools can share the same academic context.</p>
      </header>

      <section className="room-settings-section integration-card">
        <div className="settings-section-heading">
          <h2>Canvas Integration</h2>
          <p>Use an access token to choose the single Canvas module tied to this World.</p>
        </div>

        {canvasConnection?.connected ? (
          <div className="integration-connected-summary">
            <CheckCircle2 size={18} />
            <div>
              <strong>{canvasConnection.courseName || "Canvas module connected"}</strong>
              <span>
                {[canvasConnection.courseCode, canvasConnection.lastSyncedAt ? `Last synced ${formatDateTime(canvasConnection.lastSyncedAt)}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </div>
        ) : null}

        <form className="integration-connect-form" onSubmit={connectCanvas}>
          <label className="field">
            <span>Host</span>
            <input
              autoComplete="off"
              onChange={(event) => setHost(event.target.value)}
              placeholder="canvas.nus.edu.sg"
              value={host}
            />
          </label>
          <label className="field">
            <span>Access Token</span>
            <input
              autoComplete="off"
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder={canvasConnection?.connected ? "Token saved in this browser" : "Canvas token"}
              type="password"
              value={accessToken}
            />
          </label>
          <button className="primary-button compact" disabled={connecting || !accessToken.trim()} type="submit">
            <LinkIcon size={16} />
            {connecting ? "Connecting" : "Connect"}
          </button>
        </form>

        {courses.length ? (
          <div className="integration-course-picker">
            <label className="field">
              <span>Module / Class</span>
              <AppSelectMenu
                ariaLabel="Module / Class"
                className="integration-course-select"
                onChange={setSelectedCourseId}
                options={courses.map((course) => ({
                  label: [course.courseCode, course.name].filter(Boolean).join(" - "),
                  value: String(course.id),
                }))}
                value={String(selectedCourseId)}
              />
            </label>
            <button
              className="secondary-button compact"
              disabled={importing || !selectedCourseId || !accessToken.trim()}
              onClick={importDeadlines}
              type="button"
            >
              <CalendarPlus size={16} />
              {importing ? "Syncing" : canvasConnection?.connected ? "Sync Module" : "Save & Sync"}
            </button>
          </div>
        ) : null}

        {status ? <p className="integration-status">{status}</p> : null}
      </section>
    </section>
  );
}

/** Full-screen owner settings surface modelled after the create-room flow. */
function RoomSettingsScreen({ onBack, onChanged, onClose, onError, onCalendarChanged, room }) {
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
            className={activePage === "integrations" ? "active" : ""}
            onClick={() => setActivePage("integrations")}
            type="button"
          >
            <LinkIcon size={16} />
            Integrations
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

        {activePage === "integrations" ? (
          <CanvasIntegrationSettings
            onCalendarChanged={onCalendarChanged}
            onError={onError}
            onRoomChanged={onChanged}
            room={room}
          />
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
