import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  File,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../api.js";
import { UPLOADS_FOLDER } from "../roomConstants.js";
import { enrichResources, getResourceDisplayName } from "../resourceWorkspace.js";

const ALL_VIEW = "all";
const DELETED_VIEW = "deleted";
const ALL_FILES_FILTER = "";
const RECENT_FILTER = "recents";
const STARRED_FILTER = "starred";
const DEFAULT_QUICK_SECTIONS = [{ id: "starred", name: "Starred", itemIds: [] }];
const DEFAULT_SORT = { key: "dateModified", direction: "desc" };
const SORT_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "dateModified", label: "Date Modified" },
  { key: "modifiedBy", label: "Modified By" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
];

function storageKey(roomId, key) {
  return `diffriendtiate:${roomId || "room"}:${key}`;
}

function readLocalValue(roomId, key, fallback) {
  try {
    const raw = localStorage.getItem(storageKey(roomId, key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalValue(roomId, key, value) {
  localStorage.setItem(storageKey(roomId, key), JSON.stringify(value));
}

function normalizePath(value = "") {
  return String(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function parentPath(path = "") {
  const parts = normalizePath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function childName(path = "") {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts.at(-1) || path || "All files";
}

function isDirectChild(candidatePath, currentPath) {
  const candidate = normalizePath(candidatePath);
  const current = normalizePath(currentPath);
  if (!candidate || parentPath(candidate) !== current) return false;
  return childName(candidate);
}

function formatBytes(size = 0) {
  const bytes = Number(size) || 0;
  if (!bytes) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getFileExtension(resource) {
  const name = getResourceDisplayName(resource);
  return name.includes(".") ? name.split(".").pop().toUpperCase() : "FILE";
}

function getMimeFileType(resource) {
  const mimeType = resource?.mimeType || resource?.metadata?.mimeType || "";
  if (!mimeType.includes("/")) return "";
  const subtype = mimeType.split("/").pop().split(";")[0];
  if (!subtype) return "";
  if (subtype === "plain") return "TXT";
  if (subtype === "jpeg") return "JPG";
  return subtype.replace(/^vnd\./, "").split(".").pop().toUpperCase();
}

function getResourceFileType(resource) {
  if (resource?.type === "url") return "URL";
  const extension = getFileExtension(resource);
  if (extension !== "FILE") return extension;
  return getMimeFileType(resource) || "FILE";
}

function getResourceModifiedBy(resource) {
  return resource?.uploader?.name || resource?.metadata?.contributor || "Unknown";
}

function getResourceCategory(resource) {
  return resource?.metadata?.resourceType || getFileExtension(resource);
}

function formatResourceDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours24 = date.getHours();
  const hours = String(hours24 % 12 || 12).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours24 >= 12 ? "pm" : "am";
  return `${day}/${month}/${year} ${hours}:${minutes} ${period}`;
}

function buildFolderPaths(resources, resourceFolders) {
  const paths = new Set();
  [...resourceFolders, ...resources.map((resource) => resource.folder)]
    .map(normalizePath)
    .filter((folderPath) => folderPath && folderPath !== "All files")
    .forEach((folderPath) => {
      const parts = folderPath.split("/");
      parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join("/")));
    });
  return Array.from(paths).sort((a, b) => a.localeCompare(b));
}

function buildFolderRows(folderPaths, currentPath) {
  return folderPaths
    .filter((folderPath) => isDirectChild(folderPath, currentPath))
    .map((folderPath) => ({
      id: `folder:${folderPath}`,
      kind: "folder",
      name: childName(folderPath),
      path: folderPath,
    }));
}

function sortDirectionForColumn(key) {
  return key === "dateModified" || key === "size" ? "desc" : "asc";
}

function compareSortValues(left, right) {
  if (typeof left === "number" || typeof right === "number") {
    return (Number(left) || 0) - (Number(right) || 0);
  }

  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getFileSortValue(resource, key) {
  if (key === "dateModified") return new Date(resource.updatedAt || resource.createdAt || 0).getTime();
  if (key === "modifiedBy") return getResourceModifiedBy(resource);
  if (key === "type") return getResourceFileType(resource);
  if (key === "size") return Number(resource.size) || 0;
  return resource.displayName || getResourceDisplayName(resource);
}

function getFolderSortValue(folder, key) {
  if (key === "type") return "Folder";
  if (key === "dateModified" || key === "modifiedBy" || key === "size") return "";
  return folder.name;
}

function sortRows(rows, sortConfig, getValue) {
  const directionMultiplier = sortConfig.direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const primary = compareSortValues(getValue(left, sortConfig.key), getValue(right, sortConfig.key));
    if (primary !== 0) return primary * directionMultiplier;

    return compareSortValues(getValue(left, "name"), getValue(right, "name"));
  });
}

function SectionDialog({
  initialName = "",
  onClose,
  onSubmit,
  submitLabel = "Create",
  title = "Create a new section",
}) {
  const [name, setName] = useState(initialName);
  const trimmedName = name.trim();

  return createPortal(
    <div
      className="resource-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <form
        aria-modal="true"
        className="resource-modal-card resource-create-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedName) onSubmit(trimmedName);
        }}
        role="dialog"
      >
        <button className="resource-modal-close" onClick={onClose} type="button">
          <X size={22} />
        </button>
        <header>
          <h2>{title}</h2>
        </header>
        <label className="resource-field">
          <span>Name</span>
          <input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Section name"
            value={name}
          />
        </label>
        <div className="resource-modal-actions">
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={!trimmedName} type="submit">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function FolderDialog({ currentPath, onClose, onCreate }) {
  const [name, setName] = useState("");

  return createPortal(
    <div
      className="resource-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <form
        aria-modal="true"
        className="resource-modal-card resource-create-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const folderName = name.trim();
          if (folderName) onCreate(normalizePath([currentPath, folderName].filter(Boolean).join("/")));
        }}
        role="dialog"
      >
        <button className="resource-modal-close" onClick={onClose} type="button">
          <X size={22} />
        </button>
        <header>
          <h2>Create a folder</h2>
        </header>
        <p className="resource-muted">
          New folder path: {currentPath ? `${currentPath} / ${name || "Folder"}` : name || "Folder"}
        </p>
        <label className="resource-field">
          <span>Folder name</span>
          <input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Folder name"
            value={name}
          />
        </label>
        <div className="resource-modal-actions">
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={!name.trim()} type="submit">
            Create
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function AddItemsDialog({ folders, onAdd, onClose, resources }) {
  const [query, setQuery] = useState("");
  const [pickerPath, setPickerPath] = useState("");
  const [selected, setSelected] = useState([]);
  const normalizedQuery = query.trim().toLowerCase();
  const folderPaths = folders.map(normalizePath).filter(Boolean);
  const folderEntries = (
    normalizedQuery
      ? folderPaths.filter((path) => path.toLowerCase().includes(normalizedQuery))
      : buildFolderRows(folderPaths, pickerPath).map((folder) => folder.path)
  ).map((path) => ({
    id: `folder:${path}`,
    kind: "folder",
    name: childName(path),
    path,
    subtitle: parentPath(path) || "All files",
  }));
  const fileEntries = resources
    .filter((resource) => {
      const name = resource.displayName || getResourceDisplayName(resource);
      if (normalizedQuery) {
        return [name, resource.folder, getResourceModifiedBy(resource), getResourceCategory(resource), getResourceFileType(resource)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      }
      return normalizePath(resource.folder || UPLOADS_FOLDER) === pickerPath;
    })
    .map((resource) => ({
      id: resource.id,
      kind: "file",
      name: resource.displayName || getResourceDisplayName(resource),
      resource,
      subtitle: getResourceCategory(resource),
    }));
  const entries = [...folderEntries, ...fileEntries];
  const pickerParts = pickerPath ? pickerPath.split("/") : [];

  function toggle(id) {
    setSelected((current) =>
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id],
    );
  }

  return createPortal(
    <div
      className="resource-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="resource-modal-card resource-create-dialog wide" role="dialog" aria-modal="true">
        <button className="resource-modal-close" onClick={onClose} type="button">
          <X size={22} />
        </button>
        <header>
          <h2>Choose items to add</h2>
        </header>
        <div className="resource-search compact">
          <Search size={18} />
          <input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            value={query}
          />
        </div>
        <nav className="resource-picker-path" aria-label="Choose items folder path">
          <button
            className={!pickerPath ? "active" : ""}
            onClick={() => {
              setPickerPath("");
              setQuery("");
            }}
            type="button"
          >
            All files
          </button>
          {pickerParts.map((part, index) => {
            const path = pickerParts.slice(0, index + 1).join("/");
            return (
              <span key={path}>
                /
                <button
                  className={path === pickerPath ? "active" : ""}
                  onClick={() => {
                    setPickerPath(path);
                    setQuery("");
                  }}
                  type="button"
                >
                  {part}
                </button>
              </span>
            );
          })}
        </nav>
        <div className="resource-add-list">
          {entries.map((entry) => (
            <div className="resource-add-row" key={entry.id}>
              <input
                aria-label={`Select ${entry.name}`}
                checked={selected.includes(entry.id)}
                onChange={() => toggle(entry.id)}
                type="checkbox"
              />
              {entry.kind === "folder" ? <Folder size={28} /> : <File size={24} />}
              <button
                className="resource-add-name"
                onClick={() => {
                  if (entry.kind === "folder") {
                    setPickerPath(entry.path);
                    setQuery("");
                    return;
                  }
                  toggle(entry.id);
                }}
                type="button"
              >
                <span>{entry.name}</span>
                <small>{entry.subtitle}</small>
              </button>
              {entry.kind === "folder" ? (
                <button
                  aria-label={`Open ${entry.name}`}
                  className="resource-add-drill"
                  onClick={() => {
                    setPickerPath(entry.path);
                    setQuery("");
                  }}
                  type="button"
                >
                  <ChevronRight size={18} />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {!entries.length ? <p className="resource-empty-small">No matching items.</p> : null}
        </div>
        <div className="resource-modal-actions">
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button compact"
            disabled={!selected.length}
            onClick={() => onAdd(selected)}
            type="button"
          >
            Choose
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FolderActions({ canManage, onDelete }) {
  return (
    <div className="resource-row-actions">
      {canManage ? (
        <button aria-label="Delete folder" className="danger" onClick={onDelete} type="button">
          <Trash2 size={17} />
        </button>
      ) : null}
    </div>
  );
}

function ResourceActions({
  canManage,
  deleted,
  onDelete,
  onOpen,
  onPermanentDelete,
  onRestore,
  onToggleStar,
  starred,
}) {
  if (deleted) {
    return (
      <div className="resource-row-actions">
        {canManage ? (
          <>
            <button aria-label="Restore" onClick={onRestore} type="button">
              <RotateCcw size={17} />
            </button>
            <button
              aria-label="Delete permanently"
              className="danger"
              onClick={onPermanentDelete}
              type="button"
            >
              <Trash2 size={17} />
            </button>
          </>
        ) : null}
      </div>
    );
  }

  // Row actions are intentionally icon-only so the file table stays compact.
  // aria-label keeps them accessible without triggering inconsistent native tooltips.
  return (
    <div className={`resource-row-actions ${starred ? "has-active" : ""}`}>
      <button aria-label="Open in new tab" onClick={onOpen} type="button">
        <ExternalLink size={17} />
      </button>
      <button
        aria-label={starred ? "Unstar" : "Star"}
        className={starred ? "active" : ""}
        onClick={onToggleStar}
        type="button"
      >
        <Star fill={starred ? "currentColor" : "none"} size={17} />
      </button>
      {canManage ? (
        <button
          aria-label="Move to deleted files"
          className="danger"
          onClick={onDelete}
          type="button"
        >
          <Trash2 size={17} />
        </button>
      ) : null}
    </div>
  );
}

function QuickSectionMenu({ anchor, onAddItems, onClose, onRemoveSection, onRenameSection }) {
  const menuRef = useRef(null);

  /**
   * Sidebar panels intentionally clip their own content. Rendering this menu
   * into document.body keeps quick-access actions visible when the menu extends
   * beyond the sidebar edge, matching the rest of our popover behavior.
   */
  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) onClose();
    }

    function handleEscape(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="resource-quick-menu portal"
      ref={menuRef}
      role="menu"
      style={{ left: anchor.left, top: anchor.top }}
    >
      <button onClick={onAddItems} role="menuitem" type="button">
        <File size={15} />
        Add Items
      </button>
      <button onClick={onRenameSection} role="menuitem" type="button">
        <Pencil size={15} />
        Rename Section
      </button>
      <button className="danger" onClick={onRemoveSection} role="menuitem" type="button">
        <Trash2 size={15} />
        Remove Section
      </button>
    </div>,
    document.body,
  );
}

function QuickSectionItemMenu({ anchor, onClose, onRemove }) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) onClose();
    }

    function handleEscape(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="resource-quick-menu resource-quick-item-menu portal"
      ref={menuRef}
      role="menu"
      style={{ left: anchor.left, top: anchor.top }}
    >
      <button className="danger" onClick={onRemove} role="menuitem" type="button">
        <Trash2 size={15} />
        Remove from Section
      </button>
    </div>,
    document.body,
  );
}

function ResourceTooltip({ anchor, children }) {
  if (!anchor) return null;

  return createPortal(
    <div
      className="resource-floating-tooltip"
      role="tooltip"
      style={{ left: anchor.left, top: anchor.top }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function useResourceDriveController({
  onChanged,
  onCreateFolder,
  onDeleteFolder,
  onError,
  onUploadFiles,
  resourceFolders = [],
  resources = [],
  room,
}) {
  const uploadInputRef = useRef(null);
  const [activeView, setActiveView] = useState(ALL_VIEW);
  const [currentPath, setCurrentPath] = useState("");
  const [query, setQuery] = useState("");
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [addItemsSectionId, setAddItemsSectionId] = useState("");
  const [renameSectionId, setRenameSectionId] = useState("");
  const [openSectionMenuId, setOpenSectionMenuId] = useState("");
  const [quickMenuAnchor, setQuickMenuAnchor] = useState({ left: 0, top: 0 });
  const [openSectionItemMenu, setOpenSectionItemMenu] = useState(null);
  const [quickItemMenuAnchor, setQuickItemMenuAnchor] = useState({ left: 0, top: 0 });
  const [fileFilter, setFileFilter] = useState(ALL_FILES_FILTER);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState([]);
  const [quickSections, setQuickSections] = useState(() =>
    readLocalValue(room?.id, "resourceQuickSections", DEFAULT_QUICK_SECTIONS),
  );
  const [starredIds, setStarredIds] = useState(() =>
    readLocalValue(room?.id, "resourceStarredIds", []),
  );
  const [recentIds, setRecentIds] = useState(() =>
    readLocalValue(room?.id, "resourceRecentIds", []),
  );
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const canManageRoom = Boolean(room?.isOwner);

  /**
   * Room data usually arrives after the first render. Reload the lightweight
   * drive preferences when the active room changes so each room keeps its own
   * quick access sections and starred files.
   */
  useEffect(() => {
    setActiveView(ALL_VIEW);
    setCurrentPath("");
    setQuery("");
    setFileFilter(ALL_FILES_FILTER);
    setOpenSectionMenuId("");
    setOpenSectionItemMenu(null);
    setRenameSectionId("");
    setCollapsedSectionIds([]);
    setSortConfig(DEFAULT_SORT);
    setQuickSections(readLocalValue(room?.id, "resourceQuickSections", DEFAULT_QUICK_SECTIONS));
    setStarredIds(readLocalValue(room?.id, "resourceStarredIds", []));
    setRecentIds(readLocalValue(room?.id, "resourceRecentIds", []));
  }, [room?.id]);

  useEffect(() => {
    writeLocalValue(room?.id, "resourceQuickSections", quickSections);
  }, [quickSections, room?.id]);

  useEffect(() => {
    writeLocalValue(room?.id, "resourceStarredIds", starredIds);
  }, [room?.id, starredIds]);

  useEffect(() => {
    writeLocalValue(room?.id, "resourceRecentIds", recentIds);
  }, [recentIds, room?.id]);

  const enrichedResources = useMemo(() => enrichResources(resources, room), [resources, room]);
  const activeResources = enrichedResources.filter((resource) => !resource.deletedAt);
  const deletedResources = enrichedResources.filter((resource) => resource.deletedAt);
  const folderPaths = useMemo(
    () => buildFolderPaths(activeResources, resourceFolders),
    [activeResources, resourceFolders],
  );
  const currentFolderRows = useMemo(
    () => buildFolderRows(folderPaths, currentPath),
    [currentPath, folderPaths],
  );
  const visibleResources = activeView === DELETED_VIEW ? deletedResources : activeResources;
  const normalizedQuery = query.trim().toLowerCase();
  const isStarredMode = activeView !== DELETED_VIEW && fileFilter === STARRED_FILTER;
  const isRecentMode = activeView !== DELETED_VIEW && fileFilter === RECENT_FILTER;
  const isFilteredMode = isStarredMode || isRecentMode;
  const currentFiles = sortRows(
    visibleResources
    .filter((resource) => {
      const queryMatches = !normalizedQuery || resource.searchText?.includes(normalizedQuery);
      if (!queryMatches) return false;
      if (activeView === DELETED_VIEW) return true;
      if (isStarredMode) return starredIds.includes(resource.id);
      if (isRecentMode) return recentIds.includes(resource.id);
      return normalizePath(resource.folder || UPLOADS_FOLDER) === currentPath;
    }),
    sortConfig,
    getFileSortValue,
  );
  const visibleFolders =
    normalizedQuery || activeView === DELETED_VIEW || isFilteredMode
      ? []
      : sortRows(currentFolderRows, sortConfig, getFolderSortValue);

  /**
   * Quick access stores stable ids rather than cloned objects. Resolving them
   * during render keeps starred files, renamed folders, and restored files in
   * sync with the canonical resource list.
   */
  function getQuickSectionEntries(section) {
    if (section.id === "starred") {
      return activeResources
        .filter((resource) => starredIds.includes(resource.id))
        .map((resource) => ({ id: resource.id, kind: "file", name: resource.displayName, resource }));
    }

    return section.itemIds
      .map((itemId) => {
        if (itemId.startsWith("folder:")) {
          const folderPath = itemId.slice("folder:".length);
          return folderPaths.includes(folderPath)
            ? { id: itemId, kind: "folder", name: childName(folderPath), path: folderPath }
            : null;
        }
        const resource = activeResources.find((candidate) => candidate.id === itemId);
        return resource ? { id: itemId, kind: "file", name: resource.displayName, resource } : null;
      })
      .filter(Boolean);
  }

  function openResource(resource) {
    setRecentIds((current) => [resource.id, ...current.filter((id) => id !== resource.id)].slice(0, 24));
    if (resource.url) {
      window.open(resource.url, "_blank", "noopener,noreferrer");
    }
  }

  function openQuickSectionMenu(sectionId, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 184;
    const menuHeight = 132;
    setOpenSectionItemMenu(null);
    setQuickMenuAnchor({
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 8)),
    });
    setOpenSectionMenuId((current) => (current === sectionId ? "" : sectionId));
  }

  function openQuickItemMenu(sectionId, itemId, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 204;
    const menuHeight = 52;
    setOpenSectionMenuId("");
    setQuickItemMenuAnchor({
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 8)),
    });
    setOpenSectionItemMenu((current) =>
      current?.sectionId === sectionId && current?.itemId === itemId ? null : { sectionId, itemId },
    );
  }

  async function uploadFiles(fileList) {
    if (!canManageRoom) return;
    try {
      await onUploadFiles(fileList, currentPath || UPLOADS_FOLDER);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function deleteResource(resourceId) {
    if (!canManageRoom) return;
    try {
      await api.deleteResource(resourceId);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function deleteFolder(folderPath) {
    if (!canManageRoom) return;
    const normalizedFolderPath = normalizePath(folderPath);
    if (!normalizedFolderPath) return;

    const folderResources = activeResources.filter((resource) => {
      const resourceFolder = normalizePath(resource.folder || UPLOADS_FOLDER);
      return resourceFolder === normalizedFolderPath || resourceFolder.startsWith(`${normalizedFolderPath}/`);
    });

    try {
      await Promise.all(folderResources.map((resource) => api.deleteResource(resource.id)));
      onDeleteFolder?.(normalizedFolderPath);
      setCurrentPath((current) =>
        current === normalizedFolderPath || current.startsWith(`${normalizedFolderPath}/`)
          ? parentPath(normalizedFolderPath)
          : current,
      );
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function restoreResource(resourceId) {
    if (!canManageRoom) return;
    try {
      await api.restoreResource(resourceId);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function permanentlyDeleteResource(resourceId) {
    if (!canManageRoom) return;
    try {
      await api.deleteResourcePermanently(resourceId);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  function createQuickSection(name) {
    const randomId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Date.now();
    const section = {
      id: `section-${randomId}`,
      name,
      itemIds: [],
    };
    setQuickSections((current) => [...current, section]);
    setSectionDialogOpen(false);
  }

  function addItemsToSection(itemIds) {
    setQuickSections((current) =>
      current.map((section) =>
        section.id === addItemsSectionId
          ? { ...section, itemIds: Array.from(new Set([...section.itemIds, ...itemIds])) }
          : section,
      ),
    );
    setAddItemsSectionId("");
  }

  function renameQuickSection(sectionId, name) {
    setQuickSections((current) =>
      current.map((section) => (section.id === sectionId ? { ...section, name } : section)),
    );
    setRenameSectionId("");
  }

  function removeQuickSection(sectionId) {
    setQuickSections((current) => current.filter((section) => section.id !== sectionId));
    setAddItemsSectionId((current) => (current === sectionId ? "" : current));
    setRenameSectionId((current) => (current === sectionId ? "" : current));
    setOpenSectionMenuId("");
    setOpenSectionItemMenu(null);
  }

  function removeItemFromSection(sectionId, itemId) {
    if (sectionId === "starred") {
      setStarredIds((current) => current.filter((id) => id !== itemId));
    } else {
      setQuickSections((current) =>
        current.map((section) =>
          section.id === sectionId
            ? { ...section, itemIds: section.itemIds.filter((candidate) => candidate !== itemId) }
            : section,
        ),
      );
    }
    setOpenSectionItemMenu(null);
  }

  function toggleStar(resourceId) {
    setStarredIds((current) =>
      current.includes(resourceId)
        ? current.filter((id) => id !== resourceId)
        : [...current, resourceId],
    );
  }

  function toggleQuickSection(sectionId) {
    setCollapsedSectionIds((current) =>
      current.includes(sectionId)
        ? current.filter((id) => id !== sectionId)
        : [...current, sectionId],
    );
  }

  function toggleSortColumn(key) {
    setSortConfig((current) =>
      current.key === key
        ? { ...current, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: sortDirectionForColumn(key) },
    );
  }

  const breadcrumbParts = currentPath ? currentPath.split("/") : [];
  const currentTitle =
    activeView === DELETED_VIEW ? "Deleted files" : breadcrumbParts.at(-1) || "All files";
  const renameSection = quickSections.find((section) => section.id === renameSectionId) || null;

  return {
    activeResources,
    activeView,
    addItemsSectionId,
    breadcrumbParts,
    canManageRoom,
    collapsedSectionIds,
    currentFiles,
    currentPath,
    currentTitle,
    deleteResource,
    deleteFolder,
    fileFilter,
    folderDialogOpen,
    folderPaths,
    getQuickSectionEntries,
    openResource,
    openQuickItemMenu,
    openQuickSectionMenu,
    openSectionItemMenu,
    openSectionMenuId,
    permanentlyDeleteResource,
    query,
    quickItemMenuAnchor,
    quickMenuAnchor,
    quickSections,
    recentIds,
    renameQuickSection,
    renameSection,
    removeQuickSection,
    removeItemFromSection,
    restoreResource,
    sectionDialogOpen,
    setActiveView,
    setAddItemsSectionId,
    setCurrentPath,
    setFileFilter,
    setFolderDialogOpen,
    setOpenSectionItemMenu,
    setOpenSectionMenuId,
    setQuery,
    setRenameSectionId,
    setSectionDialogOpen,
    starredIds,
    sortColumns: SORT_COLUMNS,
    sortConfig,
    toggleQuickSection,
    toggleSortColumn,
    toggleStar,
    uploadFiles,
    uploadInputRef,
    visibleFolders,
    createQuickSection,
    addItemsToSection,
    onCreateFolder,
  };
}

export function ResourceDriveSidebar({ drive }) {
  const [quickTooltipAnchor, setQuickTooltipAnchor] = useState(null);

  function showQuickTooltip(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setQuickTooltipAnchor({
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    });
  }

  return (
    <div className="resource-drive-sidebar embedded">
        <button
          className={`resource-sidebar-button ${drive.activeView === ALL_VIEW ? "active" : ""}`}
          onClick={() => {
            drive.setActiveView(ALL_VIEW);
            drive.setCurrentPath("");
            drive.setFileFilter(ALL_FILES_FILTER);
            drive.setQuery("");
          }}
          type="button"
        >
          <Folder size={18} />
          All files
        </button>
        <button
          className={`resource-sidebar-button ${drive.activeView === DELETED_VIEW ? "active" : ""}`}
          onClick={() => {
            drive.setActiveView(DELETED_VIEW);
            drive.setFileFilter(ALL_FILES_FILTER);
            drive.setQuery("");
          }}
          type="button"
        >
          <Trash2 size={18} />
          Deleted files
        </button>

        <div className="resource-quick-header">
          <span>Quick access</span>
          <button
            className="resource-quick-create-button"
            aria-label="Create Category"
            onBlur={() => setQuickTooltipAnchor(null)}
            onClick={() => drive.setSectionDialogOpen(true)}
            onFocus={showQuickTooltip}
            onMouseEnter={showQuickTooltip}
            onMouseLeave={() => setQuickTooltipAnchor(null)}
            type="button"
          >
            <Plus size={17} />
          </button>
          <ResourceTooltip anchor={quickTooltipAnchor}>Create Category</ResourceTooltip>
        </div>

        <div className="resource-quick-list">
          {drive.quickSections.map((section) => {
            const items = drive.getQuickSectionEntries(section);
            const collapsed = drive.collapsedSectionIds.includes(section.id);
            const menuOpen = drive.openSectionMenuId === section.id;

            return (
              <div className={`resource-quick-section ${menuOpen ? "menu-open" : ""}`} key={section.id}>
                <div className="resource-quick-section-row">
                  <button
                    className="resource-quick-section-title"
                    aria-expanded={!collapsed}
                    onClick={() => drive.toggleQuickSection(section.id)}
                    type="button"
                  >
                    <ChevronRight className={!collapsed ? "expanded" : ""} size={14} />
                    <span>{section.name}</span>
                  </button>
                  <button
                    className="resource-quick-menu-button"
                    aria-label={`${section.name} actions`}
                    onClick={(event) => drive.openQuickSectionMenu(section.id, event)}
                    type="button"
                  >
                    <MoreVertical size={16} />
                  </button>
                </div>
                {menuOpen ? (
                  <QuickSectionMenu
                    anchor={drive.quickMenuAnchor}
                    onAddItems={() => {
                      drive.setAddItemsSectionId(section.id);
                      drive.setOpenSectionMenuId("");
                    }}
                    onClose={() => drive.setOpenSectionMenuId("")}
                    onRemoveSection={() => drive.removeQuickSection(section.id)}
                    onRenameSection={() => {
                      drive.setRenameSectionId(section.id);
                      drive.setOpenSectionMenuId("");
                    }}
                  />
                ) : null}
                {!collapsed ? (
                  <div className="resource-quick-items">
                    {items.slice(0, 5).map((item) => {
                      const itemMenuOpen =
                        drive.openSectionItemMenu?.sectionId === section.id &&
                        drive.openSectionItemMenu?.itemId === item.id;

                      return (
                        <div
                          className={`resource-quick-item-row ${itemMenuOpen ? "menu-open" : ""}`}
                          key={item.id}
                        >
                          <button
                            className="resource-quick-item-primary"
                            onClick={() => {
                              drive.setActiveView(ALL_VIEW);
                              drive.setFileFilter(ALL_FILES_FILTER);
                              drive.setQuery("");
                              if (item.kind === "folder") {
                                drive.setCurrentPath(item.path);
                                return;
                              }
                              drive.openResource(item.resource);
                            }}
                            type="button"
                          >
                            {item.kind === "folder" ? <Folder size={15} /> : <File size={15} />}
                            <span className="resource-quick-item-name">{item.name}</span>
                          </button>
                          <button
                            className="resource-quick-item-menu-button"
                            aria-label={`Remove ${item.name} from ${section.name}`}
                            onClick={(event) => drive.openQuickItemMenu(section.id, item.id, event)}
                            type="button"
                          >
                            <MoreVertical size={15} />
                          </button>
                          {itemMenuOpen ? (
                            <QuickSectionItemMenu
                              anchor={drive.quickItemMenuAnchor}
                              onClose={() => drive.setOpenSectionItemMenu(null)}
                              onRemove={() => drive.removeItemFromSection(section.id, item.id)}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
  );
}

function ResourceSortHeader({ active, direction, label, onClick }) {
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <button
      aria-label={`Sort by ${label}`}
      aria-pressed={active}
      className={`resource-sort-header ${active ? "active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <Icon size={13} strokeWidth={2.2} />
    </button>
  );
}

export function ResourceFileManager({ drive }) {
  return (
    <section className="resource-drive-shell main-only">
      <main className="resource-drive-main">
        <div className="resource-drive-search">
          <Search size={18} />
          <input
            onChange={(event) => drive.setQuery(event.target.value)}
            placeholder="Search"
            value={drive.query}
          />
          {drive.query ? (
            <button onClick={() => drive.setQuery("")} type="button">
              <X size={16} />
            </button>
          ) : null}
        </div>

        {drive.activeView === ALL_VIEW && drive.currentPath ? (
          <nav className="resource-breadcrumb" aria-label="Resource path">
            <button
              onClick={() => {
                drive.setCurrentPath("");
                drive.setFileFilter(ALL_FILES_FILTER);
              }}
              type="button"
            >
              All files
            </button>
            {drive.breadcrumbParts.slice(0, -1).map((part, index) => {
              const path = drive.breadcrumbParts.slice(0, index + 1).join("/");
              return (
                <span key={path}>
                  /
                  <button onClick={() => drive.setCurrentPath(path)} type="button">
                    {part}
                  </button>
                </span>
              );
            })}
          </nav>
        ) : null}

        <div className="resource-drive-title-row">
          <h2>{drive.currentTitle}</h2>
          {drive.activeView === ALL_VIEW && drive.canManageRoom ? (
            <div className="resource-drive-actions">
              <button
                className="resource-button subtle"
                onClick={() => drive.uploadInputRef.current?.click()}
                type="button"
              >
                <Upload size={17} />
                Upload
              </button>
              <button
                className="resource-button subtle"
                onClick={() => drive.setFolderDialogOpen(true)}
                type="button"
              >
                <FolderPlus size={17} />
                New folder
              </button>
              <input
                multiple
                onChange={(event) => drive.uploadFiles(event.target.files)}
                ref={drive.uploadInputRef}
                type="file"
              />
            </div>
          ) : null}
        </div>

        {drive.activeView === ALL_VIEW ? (
          <div className="resource-filter-pills" aria-label="Optional resource views">
            <button
              className={drive.fileFilter === RECENT_FILTER ? "active" : ""}
              aria-pressed={drive.fileFilter === RECENT_FILTER}
              onClick={() =>
                drive.setFileFilter(drive.fileFilter === RECENT_FILTER ? ALL_FILES_FILTER : RECENT_FILTER)
              }
              type="button"
            >
              <Clock3 size={16} />
              Recents
            </button>
            <button
              className={drive.fileFilter === STARRED_FILTER ? "active" : ""}
              aria-pressed={drive.fileFilter === STARRED_FILTER}
              onClick={() =>
                drive.setFileFilter(drive.fileFilter === STARRED_FILTER ? ALL_FILES_FILTER : STARRED_FILTER)
              }
              type="button"
            >
              <Star size={16} />
              Starred
            </button>
          </div>
        ) : null}

        <div className="resource-drive-table">
          <div className="resource-table-head">
            <ResourceSortHeader
              active={drive.sortConfig.key === "name"}
              direction={drive.sortConfig.direction}
              label="Name"
              onClick={() => drive.toggleSortColumn("name")}
            />
            <span className="resource-table-actions-head" />
            {drive.sortColumns.slice(1).map((column) => (
              <ResourceSortHeader
                active={drive.sortConfig.key === column.key}
                direction={drive.sortConfig.direction}
                key={column.key}
                label={column.label}
                onClick={() => drive.toggleSortColumn(column.key)}
              />
            ))}
          </div>

          {drive.visibleFolders.map((folder) => (
            <div
              className="resource-table-row folder"
              key={folder.id}
            >
              <button className="resource-name-cell" onClick={() => drive.setCurrentPath(folder.path)} type="button">
                <Folder className="resource-row-icon" size={24} />
                <span className="resource-name-copy">
                  <strong>{folder.name}</strong>
                </span>
              </button>
              <FolderActions canManage={drive.canManageRoom} onDelete={() => drive.deleteFolder(folder.path)} />
              <span className="resource-date-cell">--</span>
              <span className="resource-modified-by-cell">--</span>
              <span className="resource-type-cell">Folder</span>
              <span className="resource-size-cell">--</span>
            </div>
          ))}

          {drive.currentFiles.map((resource) => (
            <div className="resource-table-row" key={resource.id}>
              <button className="resource-name-cell" onClick={() => drive.openResource(resource)} type="button">
                <File className="resource-row-icon" size={24} />
                <span className="resource-name-copy">
                  <strong>{resource.displayName}</strong>
                  <small>{getResourceCategory(resource)}</small>
                </span>
              </button>
              <ResourceActions
                canManage={drive.canManageRoom}
                deleted={drive.activeView === DELETED_VIEW}
                onDelete={() => drive.deleteResource(resource.id)}
                onOpen={() => drive.openResource(resource)}
                onPermanentDelete={() => drive.permanentlyDeleteResource(resource.id)}
                onRestore={() => drive.restoreResource(resource.id)}
                onToggleStar={() => drive.toggleStar(resource.id)}
                starred={drive.starredIds.includes(resource.id)}
              />
              <span className="resource-date-cell">{formatResourceDate(resource.updatedAt || resource.createdAt)}</span>
              <span className="resource-modified-by-cell">{getResourceModifiedBy(resource)}</span>
              <span className="resource-type-cell">{getResourceFileType(resource)}</span>
              <span className="resource-size-cell">{formatBytes(resource.size)}</span>
            </div>
          ))}

          {!drive.visibleFolders.length && !drive.currentFiles.length ? (
            <div className="resource-empty-state">
              {drive.activeView === DELETED_VIEW
                ? "Deleted files will appear here."
                : "No files in this folder yet."}
            </div>
          ) : null}
        </div>
      </main>

      {drive.sectionDialogOpen ? (
        <SectionDialog onClose={() => drive.setSectionDialogOpen(false)} onSubmit={drive.createQuickSection} />
      ) : null}
      {drive.renameSection ? (
        <SectionDialog
          initialName={drive.renameSection.name}
          onClose={() => drive.setRenameSectionId("")}
          onSubmit={(name) => drive.renameQuickSection(drive.renameSection.id, name)}
          submitLabel="Rename"
          title="Rename section"
        />
      ) : null}
      {drive.canManageRoom && drive.folderDialogOpen ? (
        <FolderDialog
          currentPath={drive.currentPath}
          onClose={() => drive.setFolderDialogOpen(false)}
          onCreate={(folderPath) => {
            drive.onCreateFolder(folderPath);
            drive.setCurrentPath(parentPath(folderPath));
            drive.setFolderDialogOpen(false);
          }}
        />
      ) : null}
      {drive.addItemsSectionId ? (
        <AddItemsDialog
          folders={drive.folderPaths}
          onAdd={drive.addItemsToSection}
          onClose={() => drive.setAddItemsSectionId("")}
          resources={drive.activeResources}
        />
      ) : null}
    </section>
  );
}
