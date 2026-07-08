import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  File,
  Folder,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../api.ts";
import { AppSelectMenu } from "../../../shared/ui/AppSelectMenu.tsx";
import { UPLOADS_FOLDER } from "../roomConstants.ts";
import { enrichResources, getResourceDisplayName } from "../resourceWorkspace.ts";

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
const DELETED_SORT_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "originalLocation", label: "Original Location" },
  { key: "dateDeleted", label: "Date Deleted" },
  { key: "deletedBy", label: "Deleted By" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
];
const RESOURCE_CATEGORY_OPTIONS = [
  "Lecture Notes",
  "Tutorial",
  "Past Year Paper",
  "Cheatsheet",
  "Assignment",
  "Lab",
  "Quiz",
  "Reference",
];
const RESOURCE_CATEGORY_SELECT_OPTIONS = RESOURCE_CATEGORY_OPTIONS.map((option) => ({
  label: option,
  value: option,
}));

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

function joinPath(...parts) {
  return normalizePath(parts.filter(Boolean).join("/"));
}

function resourcePathParts(path = "") {
  return ["All Files", ...normalizePath(path).split("/").filter(Boolean)];
}

function pathForBreadcrumbIndex(parts, index) {
  if (index <= 0) return "";
  return parts.slice(1, index + 1).join("/");
}

function canDropItemIntoPath(item, targetPath = "") {
  if (!item) return false;
  const target = normalizePath(targetPath);
  if (isCanvasFolderPath(target)) return false;
  if (item.kind === "resource") return !isCanvasSyncedResource(item.resource);
  if (item.kind !== "folder") return true;
  const source = normalizePath(item.path);
  if (isCanvasFolderPath(source)) return false;
  return Boolean(source) && target !== source && !target.startsWith(`${source}/`);
}

function fileSelectionId(resourceId = "") {
  return `file:${resourceId}`;
}

function folderSelectionId(folderPath = "") {
  return `folder:${normalizePath(folderPath)}`;
}

function selectionFileId(selectionId = "") {
  return selectionId.startsWith("file:") ? selectionId.slice("file:".length) : "";
}

function selectionFolderPath(selectionId = "") {
  return selectionId.startsWith("folder:") ? normalizePath(selectionId.slice("folder:".length)) : "";
}

function isResourceInFolder(resource, folderPath) {
  const folder = normalizePath(folderPath);
  const resourceFolder = normalizePath(resource?.folder || UPLOADS_FOLDER);
  return Boolean(folder) && (resourceFolder === folder || resourceFolder.startsWith(`${folder}/`));
}

function uniqueResources(resources) {
  const seen = new Set();
  return resources.filter((resource) => {
    if (!resource?.id || seen.has(resource.id)) return false;
    seen.add(resource.id);
    return true;
  });
}

function isExternalFileDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes("Files") && !types.includes("application/x-diffriendtiate-resource");
}

function ResourcePathTrail({
  canDropPath,
  dropTargetPath = null,
  onDragPath,
  onDropPath,
  onNavigate,
  parts,
}) {
  const lastIndex = parts.length - 1;

  return (
    <span className="resource-path-trail">
      {parts.map((part, index) => {
        const active = index === lastIndex;
        const canNavigate = Boolean(onNavigate) && !active;
        const segmentPath = pathForBreadcrumbIndex(parts, index);
        const canDrop = Boolean(onDropPath) && (!canDropPath || canDropPath(segmentPath));
        const dropTarget =
          canDrop && dropTargetPath !== null && normalizePath(dropTargetPath) === normalizePath(segmentPath);
        const segmentClassName = `resource-path-segment ${active ? "active" : ""}`;

        return (
          <span
            className={`resource-path-node ${dropTarget ? "drop-target" : ""}`}
            key={`${part}-${index}`}
            onDragLeave={(event) => {
              if (!canDrop || event.currentTarget.contains(event.relatedTarget)) return;
              onDragPath?.(null);
            }}
            onDragOver={(event) => {
              if (!canDrop) return;
              event.preventDefault();
              onDragPath?.(segmentPath);
            }}
            onDrop={(event) => {
              if (!canDrop) return;
              event.preventDefault();
              event.stopPropagation();
              onDropPath?.(segmentPath);
            }}
          >
            {index > 0 ? <span className="resource-path-separator"> / </span> : null}
            {canNavigate ? (
              <button
                className={segmentClassName}
                onClick={() => onNavigate(segmentPath)}
                type="button"
              >
                {part}
              </button>
            ) : (
              <span className={segmentClassName}>{part}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function SelectionCheckbox({
  checked,
  disabled = false,
  indeterminate = false,
  label,
  onChange,
}) {
  const checkboxRef = useRef(null);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = Boolean(indeterminate && !checked);
  }, [checked, indeterminate]);

  return (
    <input
      aria-label={label}
      checked={checked}
      className="resource-select-checkbox"
      disabled={disabled}
      onChange={onChange}
      ref={checkboxRef}
      type="checkbox"
    />
  );
}

function parentPath(path = "") {
  const parts = normalizePath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function childName(path = "") {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts.at(-1) || path || "All Files";
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

function getOriginalLocation(resource) {
  return normalizePath(resource?.originalFolder || resource?.folder || UPLOADS_FOLDER);
}

function getDeletedBy(resource) {
  return resource?.deletedBy?.name || "Unknown";
}

function isCanvasSyncedResource(resource) {
  return resource?.metadata?.source === "canvas-file" || isCanvasFolderPath(resource?.folder);
}

function isCanvasFolderPath(folderPath = "") {
  const folder = normalizePath(folderPath);
  return folder === "Canvas" || folder.startsWith("Canvas/");
}

function resourcePreviewKind(resource) {
  const type = String(resource?.resourceType || "").toLowerCase();
  const mimeType = String(resource?.mimeType || resource?.metadata?.mimeType || "").toLowerCase();
  const extension = getFileExtension(resource).toLowerCase();

  if (type === "image" || mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) {
    return "image";
  }
  if (type === "pdf" || extension === "pdf" || resource?.pdfUrl) return "pdf";
  if (mimeType.startsWith("text/") || ["txt", "md", "csv", "json", "log"].includes(extension)) return "text";
  if (resource?.type === "url") return "web";
  return "none";
}

function resourcePreviewUrl(resource) {
  if (!resource) return "";
  if (resource.pdfUrl) return resource.pdfUrl;
  return resource.fileUrl || resource.url || "";
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
  const paths = new Set<string>();
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
  if (key === "originalLocation") return getOriginalLocation(resource);
  if (key === "dateDeleted") return new Date(resource.deletedAt || 0).getTime();
  if (key === "deletedBy") return getDeletedBy(resource);
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
  title = "Create Section",
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
            placeholder="Section Name"
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
  const locationParts = resourcePathParts(currentPath);

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
          <h2>Create Folder</h2>
        </header>
        <div className="resource-folder-location">
          <span className="resource-folder-location-label">Location</span>
          <ResourcePathTrail parts={locationParts} />
        </div>
        <label className="resource-field">
          <span>Folder Name</span>
          <input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Folder Name"
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
    subtitle: parentPath(path) || "All Files",
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
          <h2>Choose Items to Add</h2>
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
            All Files
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

function ResourcePreviewDialog({ onClose, resource }) {
  const kind = resourcePreviewKind(resource);
  const previewUrl = resourcePreviewUrl(resource);
  const title = resource?.displayName || getResourceDisplayName(resource);

  return createPortal(
    <div
      className="resource-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="resource-modal-card resource-preview-dialog" role="dialog" aria-modal="true">
        <button className="resource-modal-close" onClick={onClose} type="button">
          <X size={22} />
        </button>
        <header className="resource-preview-header">
          <div>
            <h2>{title}</h2>
            <p>{getResourceFileType(resource)} · {getResourceCategory(resource)}</p>
          </div>
          {previewUrl ? (
            <a className="resource-button subtle" href={previewUrl} rel="noreferrer" target="_blank">
              <ExternalLink size={16} />
              Open
            </a>
          ) : null}
        </header>
        <div className={`resource-preview-body ${kind}`}>
          {kind === "image" && previewUrl ? (
            <img alt={title} src={previewUrl} />
          ) : kind === "pdf" || kind === "text" || kind === "web" ? (
            previewUrl ? (
              <iframe title={`Preview ${title}`} src={previewUrl} />
            ) : null
          ) : (
            <div className="resource-preview-empty">
              <File size={34} />
              <strong>No Preview Available</strong>
              <span>This file type cannot be displayed inside Infilenite yet.</span>
            </div>
          )}
        </div>
        {kind === "web" ? (
          <p className="resource-preview-note">
            Some sites block embedded previews. Use Open if the preview stays blank.
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function ResourcePreviewPanel({ onClose, resource }) {
  const kind = resourcePreviewKind(resource);
  const previewUrl = resourcePreviewUrl(resource);
  const title = resource?.displayName || getResourceDisplayName(resource);

  return (
    <aside className="resource-preview-panel" aria-label={`Preview ${title}`}>
      <header className="resource-preview-header">
        <button aria-label="Close Preview" className="resource-preview-close" onClick={onClose} type="button">
          <X size={20} />
        </button>
        <div className="resource-preview-heading">
          <h2>{title}</h2>
          <p>{getResourceFileType(resource)} &middot; {formatBytes(resource?.size)}</p>
        </div>
      </header>
      <div className={`resource-preview-body ${kind}`}>
        {kind === "image" && previewUrl ? (
          <img alt={title} src={previewUrl} />
        ) : kind === "pdf" || kind === "text" || kind === "web" ? (
          previewUrl ? (
            <iframe title={`Preview ${title}`} src={previewUrl} />
          ) : null
        ) : (
          <div className="resource-preview-empty">
            <File size={34} />
            <strong>No Preview Available</strong>
            <span>This file type cannot be displayed inside Infilenite yet.</span>
          </div>
        )}
      </div>
      {kind === "web" ? (
        <p className="resource-preview-note">
          Some sites block embedded previews. Use Open if the preview stays blank.
        </p>
      ) : null}
    </aside>
  );
}

function ResourceEditDialog({ onClose, onSubmit, resource }) {
  const [name, setName] = useState(resource?.title || resource?.displayName || getResourceDisplayName(resource));
  const [category, setCategory] = useState(getResourceCategory(resource));
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
          if (!trimmedName) return;
          onSubmit({
            metadata: { resourceType: category, type: category },
            title: trimmedName,
          });
        }}
        role="dialog"
      >
        <button className="resource-modal-close" onClick={onClose} type="button">
          <X size={22} />
        </button>
        <header>
          <h2>Edit Resource</h2>
        </header>
        {isCanvasSyncedResource(resource) ? (
          <p className="resource-muted">
            This lives inside the synced Canvas folder. The next Canvas sync can overwrite these details.
          </p>
        ) : null}
        <label className="resource-field">
          <span>Name</span>
          <input autoFocus onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <AppSelectMenu
          ariaLabel="Category"
          className="resource-edit-category-select"
          label="Category"
          onChange={setCategory}
          options={RESOURCE_CATEGORY_SELECT_OPTIONS}
          value={category}
        />
        <div className="resource-modal-actions">
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={!trimmedName} type="submit">
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function MoveDialog({ folders, itemName, onClose, onSubmit, title = "Move Item" }) {
  const [query, setQuery] = useState("");
  const [pickerPath, setPickerPath] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const folderPaths = folders.map(normalizePath).filter(Boolean);
  const folderEntries = (
    normalizedQuery
      ? folderPaths.filter((path) => path.toLowerCase().includes(normalizedQuery))
      : buildFolderRows(folderPaths, pickerPath).map((folder) => folder.path)
  ).map((path) => ({
    id: `folder:${path}`,
    name: childName(path),
    path,
    subtitle: parentPath(path) || "All Files",
  }));
  const pickerParts = pickerPath ? pickerPath.split("/") : [];

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
          onSubmit(pickerPath);
        }}
        role="dialog"
      >
        <button className="resource-modal-close" onClick={onClose} type="button">
          <X size={22} />
        </button>
        <header>
          <h2>{title}</h2>
        </header>
        <p className="resource-muted">{itemName}</p>
        <div className="resource-search compact">
          <Search size={18} />
          <input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Folders"
            value={query}
          />
        </div>
        <nav className="resource-picker-path" aria-label="Move destination path">
          <button
            className={!pickerPath ? "active" : ""}
            onClick={() => {
              setPickerPath("");
              setQuery("");
            }}
            type="button"
          >
            All Files
          </button>
          {pickerParts.map((part, index) => {
            const path = pickerParts.slice(0, index + 1).join("/");
            return (
              <span className="resource-picker-node" key={path}>
                <span className="resource-picker-separator">/</span>
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
        <div className="resource-add-list resource-move-list">
          {folderEntries.map((entry) => (
            <div className="resource-add-row resource-move-row" key={entry.id}>
              <Folder size={28} />
              <button
                className="resource-add-name"
                onClick={() => {
                  setPickerPath(entry.path);
                  setQuery("");
                }}
                type="button"
              >
                <span>{entry.name}</span>
                <small>{entry.subtitle}</small>
              </button>
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
            </div>
          ))}
          {!folderEntries.length ? <p className="resource-empty-small">No child folders here.</p> : null}
        </div>
        <div className="resource-modal-actions">
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button compact" type="submit">
            Move Here
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function RowMenu({ anchor, children, onClose }) {
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
      className="resource-quick-menu resource-row-menu portal"
      ref={menuRef}
      role="menu"
      style={{ left: anchor.left, top: anchor.top }}
    >
      {children}
    </div>,
    document.body,
  );
}

function FolderActions({ canManage, folder, onDelete, onMove, onOpenMenu, onRename, open, menuAnchor }) {
  return (
    <div className="resource-row-actions">
      {canManage ? (
        <button aria-label={`${folder.name} options`} onClick={onOpenMenu} type="button">
          <MoreHorizontal size={17} />
        </button>
      ) : null}
      {open ? (
        <RowMenu anchor={menuAnchor} onClose={onOpenMenu}>
          <button onClick={onRename} role="menuitem" type="button">
            <Pencil size={15} />
            Rename Folder
          </button>
          <button onClick={onMove} role="menuitem" type="button">
            <FolderInput size={15} />
            Move Folder
          </button>
          <button className="danger" onClick={onDelete} role="menuitem" type="button">
            <Trash2 size={15} />
            Delete Folder
          </button>
        </RowMenu>
      ) : null}
    </div>
  );
}

function ResourceActions({
  canStar = true,
  canManage,
  deleted,
  onDelete,
  onEdit,
  onOpen,
  onPermanentDelete,
  onMove,
  onOpenMenu,
  onRestore,
  onToggleStar,
  open,
  menuAnchor,
  resource,
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
    <div className={`resource-row-actions ${canStar && starred ? "has-active" : ""}`}>
      {canStar ? (
        <button
          aria-label={starred ? "Unstar" : "Star"}
          className={starred ? "active" : ""}
          onClick={onToggleStar}
          type="button"
        >
          <Star fill={starred ? "currentColor" : "none"} size={17} />
        </button>
      ) : null}
      <button aria-label={`${resource.displayName} options`} onClick={onOpenMenu} type="button">
        <MoreHorizontal size={17} />
      </button>
      {open ? (
        <RowMenu anchor={menuAnchor} onClose={onOpenMenu}>
          <button onClick={onOpen} role="menuitem" type="button">
            <ExternalLink size={15} />
            Open
          </button>
          {canManage ? (
            <>
              <button onClick={onMove} role="menuitem" type="button">
                <FolderInput size={15} />
                Move
              </button>
              <button onClick={onEdit} role="menuitem" type="button">
                <Pencil size={15} />
                Edit
              </button>
            </>
          ) : null}
          {resourcePreviewUrl(resource) ? (
            <a href={resourcePreviewUrl(resource)} download role="menuitem">
              <Download size={15} />
              Download
            </a>
          ) : null}
          {canManage ? (
            <button className="danger" onClick={onDelete} role="menuitem" type="button">
              <Trash2 size={15} />
              Delete
            </button>
          ) : null}
        </RowMenu>
      ) : null}
    </div>
  );
}

function QuickSectionMenu({ anchor, onClose, onRemoveSection, onRenameSection }) {
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

function readEntriesFromDirectory(entry, prefix = "") {
  return new Promise((resolve) => {
    if (!entry) {
      resolve([]);
      return;
    }

    if (entry.isFile) {
      entry.file((file) => {
        resolve([{ file, relativePath: joinPath(prefix, file.name) }]);
      }, () => resolve([]));
      return;
    }

    if (!entry.isDirectory) {
      resolve([]);
      return;
    }

    const reader = entry.createReader();
    const directoryPrefix = joinPath(prefix, entry.name);
    const entries = [];

    function readBatch() {
      reader.readEntries(async (batch) => {
        if (!batch.length) {
          const files = await Promise.all(entries.map((child) => readEntriesFromDirectory(child, directoryPrefix)));
          resolve(files.flat());
          return;
        }
        entries.push(...batch);
        readBatch();
      }, () => resolve([]));
    }

    readBatch();
  });
}

async function getDroppedFiles(dataTransfer, targetFolder) {
  const items = Array.from(dataTransfer?.items || []);
  const files = [];

  for (const item of items) {
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) {
      files.push(...await readEntriesFromDirectory(entry));
    }
  }

  if (!files.length) {
    files.push(...Array.from(dataTransfer?.files || []));
  }

  return files.map((file) => {
    const rawFile = file.file || file;
    const relativePath = normalizePath(file.relativePath || rawFile.webkitRelativePath || rawFile.name);
    const relativeFolder = parentPath(relativePath);
    rawFile.resourceFolder = joinPath(targetFolder || UPLOADS_FOLDER, relativeFolder) || UPLOADS_FOLDER;
    return rawFile;
  });
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
  user,
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
  const [dragActive, setDragActive] = useState(false);
  const [dragItem, setDragItem] = useState(null);
  const [dropTargetPath, setDropTargetPath] = useState(null);
  const [editResource, setEditResource] = useState(null);
  const [moveResource, setMoveResource] = useState(null);
  const [moveFolderPath, setMoveFolderPath] = useState("");
  const [previewResource, setPreviewResource] = useState(null);
  const [renameFolderPath, setRenameFolderPath] = useState("");
  const [rowMenu, setRowMenu] = useState(null);
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
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
  const canUpload = Boolean(room?.isMember);

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
    setDragActive(false);
    setDragItem(null);
    setDropTargetPath(null);
    setEditResource(null);
    setMoveResource(null);
    setMoveFolderPath("");
    setPreviewResource(null);
    setRenameFolderPath("");
    setRowMenu(null);
    setSelectedItemIds([]);
    setBulkMoveOpen(false);
    setQuickSections(readLocalValue(room?.id, "resourceQuickSections", DEFAULT_QUICK_SECTIONS));
    setStarredIds(readLocalValue(room?.id, "resourceStarredIds", []));
    setRecentIds(readLocalValue(room?.id, "resourceRecentIds", []));
  }, [room?.id]);

  useEffect(() => {
    setSelectedItemIds([]);
    setBulkMoveOpen(false);
  }, [activeView, currentPath, fileFilter, query]);

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
  const currentPathIsCanvas = isCanvasFolderPath(currentPath);
  const movableFolderPaths = useMemo(
    () => folderPaths.filter((folderPath) => !isCanvasFolderPath(folderPath)),
    [folderPaths],
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

  const visibleSelectionEntries = useMemo(() => {
    if (activeView === DELETED_VIEW) return [];
    return [
      ...visibleFolders.map((folder) => ({
        id: folderSelectionId(folder.path),
        kind: "folder",
        folder,
        name: folder.name,
        canManage: canManageRoom && !isCanvasFolderPath(folder.path),
      })),
      ...currentFiles.map((resource) => ({
        id: fileSelectionId(resource.id),
        kind: "resource",
        resource,
        name: resource.displayName || getResourceDisplayName(resource),
        canManage: (canManageRoom || resource.uploaderId === user?.id) && !isCanvasSyncedResource(resource),
      })),
    ];
  }, [activeView, canManageRoom, currentFiles, user?.id, visibleFolders]);

  const selectedEntries = useMemo(() => {
    if (activeView === DELETED_VIEW) return [];
    return selectedItemIds
      .map((selectionId) => {
        const folderPath = selectionFolderPath(selectionId);
        if (folderPath) {
          if (!folderPaths.includes(folderPath)) return null;
          return {
            id: selectionId,
            kind: "folder",
            folder: { id: selectionId, kind: "folder", name: childName(folderPath), path: folderPath },
            name: childName(folderPath),
            canManage: canManageRoom && !isCanvasFolderPath(folderPath),
          };
        }

        const resourceId = selectionFileId(selectionId);
        const resource = activeResources.find((candidate) => candidate.id === resourceId);
        if (!resource) return null;
        return {
          id: selectionId,
          kind: "resource",
          resource,
          name: resource.displayName || getResourceDisplayName(resource),
          canManage: (canManageRoom || resource.uploaderId === user?.id) && !isCanvasSyncedResource(resource),
        };
      })
      .filter(Boolean);
  }, [activeResources, activeView, canManageRoom, folderPaths, selectedItemIds, user?.id]);

  const selectedFolderPaths = selectedEntries
    .filter((entry) => entry.kind === "folder")
    .map((entry) => normalizePath(entry.folder.path));
  const topLevelSelectedFolderPaths = selectedFolderPaths.filter(
    (folderPath) =>
      !selectedFolderPaths.some(
        (candidate) => candidate !== folderPath && folderPath.startsWith(`${candidate}/`),
      ),
  );
  const selectedDirectResources = selectedEntries
    .filter((entry) => entry.kind === "resource")
    .map((entry) => entry.resource);
  const selectedFolderResources = activeResources.filter((resource) =>
    topLevelSelectedFolderPaths.some((folderPath) => isResourceInFolder(resource, folderPath)),
  );
  const selectedDownloadResources = uniqueResources([
    ...selectedDirectResources,
    ...selectedFolderResources,
  ]).filter((resource) => resourcePreviewUrl(resource));
  const selectedManageableResourceIds = new Set(
    selectedDirectResources
      .filter((resource) => !topLevelSelectedFolderPaths.some((folderPath) => isResourceInFolder(resource, folderPath)))
      .map((resource) => resource.id),
  );
  const selectedCount = selectedEntries.length;
  const selectedAllVisible =
    Boolean(visibleSelectionEntries.length) &&
    visibleSelectionEntries.every((entry) => selectedItemIds.includes(entry.id));
  const selectedSomeVisible =
    !selectedAllVisible && visibleSelectionEntries.some((entry) => selectedItemIds.includes(entry.id));
  const canMoveSelection =
    Boolean(selectedCount) && selectedEntries.every((entry) => entry.canManage);
  const canDeleteSelection = canMoveSelection;

  useEffect(() => {
    const validSelectionIds = new Set([
      ...folderPaths.map((folderPath) => folderSelectionId(folderPath)),
      ...activeResources.map((resource) => fileSelectionId(resource.id)),
    ]);
    setSelectedItemIds((current) => {
      const next = current.filter((selectionId) => validSelectionIds.has(selectionId));
      return next.length === current.length ? current : next;
    });
  }, [activeResources, folderPaths]);

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

  function previewResourceInPanel(resource) {
    if (!resource) return;
    setRecentIds((current) => [resource.id, ...current.filter((id) => id !== resource.id)].slice(0, 24));
    setPreviewResource(resource);
    setRowMenu(null);
  }

  function openRowMenu(kind, id, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 216;
    const menuHeight = 260;
    setRowMenu((current) => {
      if (current?.kind === kind && current?.id === id) return null;
      return {
        id,
        kind,
        left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 8)),
      };
    });
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

  async function uploadFiles(fileList, targetFolder = currentPath || UPLOADS_FOLDER) {
    if (!canUpload) return;
    if (isCanvasFolderPath(targetFolder)) {
      onError?.("Canvas folders are managed by sync and cannot be changed here.");
      return;
    }
    try {
      await onUploadFiles(fileList, targetFolder || UPLOADS_FOLDER);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function handleExternalDrop(event, targetFolder = currentPath || UPLOADS_FOLDER) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (!canUpload) return;

    const droppedFiles = await getDroppedFiles(event.dataTransfer, targetFolder || UPLOADS_FOLDER);
    if (!droppedFiles.length) return;
    await uploadFiles(droppedFiles, targetFolder || UPLOADS_FOLDER);
  }

  async function deleteResource(resourceId) {
    try {
      const resource = activeResources.find((candidate) => candidate.id === resourceId);
      if (isCanvasSyncedResource(resource)) {
        onError?.("Canvas resources are managed by sync and cannot be deleted.");
        return;
      }
      await api.deleteResource(resourceId);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function updateResource(resourceId, patch) {
    try {
      const resource = activeResources.find((candidate) => candidate.id === resourceId);
      if (isCanvasSyncedResource(resource)) {
        onError?.("Canvas resources are managed by sync and cannot be edited.");
        setEditResource(null);
        setMoveResource(null);
        setRowMenu(null);
        return;
      }
      await api.updateResource(resourceId, patch);
      setEditResource(null);
      setMoveResource(null);
      setRowMenu(null);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function moveResourceToFolder(resource, folder) {
    if (!resource) return;
    if (isCanvasSyncedResource(resource) || isCanvasFolderPath(folder)) {
      onError?.("Canvas resources are managed by sync and cannot be moved.");
      return;
    }
    await updateResource(resource.id, { folder: folder || UPLOADS_FOLDER });
  }

  async function moveFolder(folderPath, destinationPath) {
    if (!canManageRoom) return;
    const normalizedFolderPath = normalizePath(folderPath);
    const normalizedDestinationPath = normalizePath(destinationPath);
    if (isCanvasFolderPath(normalizedFolderPath) || isCanvasFolderPath(normalizedDestinationPath)) {
      onError?.("Canvas folders are managed by sync and cannot be moved.");
      setMoveFolderPath("");
      return;
    }
    const folderName = childName(normalizedFolderPath);
    const nextPath = joinPath(normalizedDestinationPath, folderName);
    if (!normalizedFolderPath || !nextPath || normalizedFolderPath === nextPath) {
      setMoveFolderPath("");
      return;
    }
    if (
      normalizedDestinationPath === normalizedFolderPath ||
      normalizedDestinationPath.startsWith(`${normalizedFolderPath}/`)
    ) {
      setMoveFolderPath("");
      return;
    }

    try {
      await api.moveResourceFolder(room.id, { from: normalizedFolderPath, to: nextPath });
      onDeleteFolder?.(normalizedFolderPath);
      onCreateFolder?.(nextPath);
      setCurrentPath((current) =>
        current === normalizedFolderPath || current.startsWith(`${normalizedFolderPath}/`)
          ? current.replace(normalizedFolderPath, nextPath)
          : current,
      );
      setMoveFolderPath("");
      setRowMenu(null);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function renameFolder(folderPath, nextName) {
    if (!canManageRoom) return;
    const normalizedFolderPath = normalizePath(folderPath);
    if (isCanvasFolderPath(normalizedFolderPath)) {
      onError?.("Canvas folders are managed by sync and cannot be renamed.");
      setRenameFolderPath("");
      return;
    }
    const trimmedName = String(nextName || "").trim();
    if (!normalizedFolderPath || !trimmedName) return;
    const nextPath = joinPath(parentPath(normalizedFolderPath), trimmedName);

    try {
      await api.moveResourceFolder(room.id, { from: normalizedFolderPath, to: nextPath });
      onDeleteFolder?.(normalizedFolderPath);
      onCreateFolder?.(nextPath);
      setCurrentPath((current) =>
        current === normalizedFolderPath || current.startsWith(`${normalizedFolderPath}/`)
          ? current.replace(normalizedFolderPath, nextPath)
          : current,
      );
      setRenameFolderPath("");
      setRowMenu(null);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function handleInternalDrop(targetFolder) {
    const item = dragItem;
    const normalizedTarget = normalizePath(targetFolder);
    setDragActive(false);
    setDropTargetPath(null);
    if (!item || !canDropItemIntoPath(item, normalizedTarget)) {
      setDragItem(null);
      return;
    }

    try {
      if (item.kind === "resource") {
        await moveResourceToFolder(item.resource, normalizedTarget || UPLOADS_FOLDER);
      } else if (item.kind === "folder") {
        await moveFolder(item.path, normalizedTarget);
      }
    } finally {
      setDragActive(false);
      setDropTargetPath(null);
      setDragItem(null);
    }
  }

  async function deleteFolder(folderPath) {
    if (!canManageRoom) return;
    const normalizedFolderPath = normalizePath(folderPath);
    if (isCanvasFolderPath(normalizedFolderPath)) {
      onError?.("Canvas folders are managed by sync and cannot be deleted.");
      return;
    }
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
    try {
      await api.restoreResource(resourceId);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function permanentlyDeleteResource(resourceId) {
    try {
      await api.deleteResourcePermanently(resourceId);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  function clearSelection() {
    setSelectedItemIds([]);
    setBulkMoveOpen(false);
  }

  function toggleItemSelection(selectionId) {
    setSelectedItemIds((current) =>
      current.includes(selectionId)
        ? current.filter((itemId) => itemId !== selectionId)
        : [...current, selectionId],
    );
  }

  function toggleVisibleSelection() {
    const visibleIds = visibleSelectionEntries.map((entry) => entry.id);
    if (!visibleIds.length) return;
    setSelectedItemIds((current) => {
      if (visibleIds.every((selectionId) => current.includes(selectionId))) {
        return current.filter((selectionId) => !visibleIds.includes(selectionId));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function downloadSelectedItems() {
    if (!selectedDownloadResources.length) {
      onError?.("Choose at least one downloadable file.");
      return;
    }

    selectedDownloadResources.forEach((resource, index) => {
      window.setTimeout(() => {
        const url = resourcePreviewUrl(resource);
        if (!url) return;
        const link = document.createElement("a");
        link.href = url;
        link.download = resource.displayName || getResourceDisplayName(resource);
        link.rel = "noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 80);
    });
  }

  async function moveSelectedItems(folder) {
    if (!canMoveSelection) return;
    const normalizedDestinationPath = normalizePath(folder);

    try {
      for (const resourceId of selectedManageableResourceIds) {
        await api.updateResource(resourceId, { folder: normalizedDestinationPath || UPLOADS_FOLDER });
      }

      for (const folderPath of topLevelSelectedFolderPaths) {
        if (!canDropItemIntoPath({ kind: "folder", path: folderPath }, normalizedDestinationPath)) continue;
        const nextPath = joinPath(normalizedDestinationPath, childName(folderPath));
        if (!nextPath || nextPath === folderPath) continue;
        await api.moveResourceFolder(room.id, { from: folderPath, to: nextPath });
        onDeleteFolder?.(folderPath);
        onCreateFolder?.(nextPath);
        setCurrentPath((current) =>
          current === folderPath || current.startsWith(`${folderPath}/`)
            ? current.replace(folderPath, nextPath)
            : current,
        );
      }

      clearSelection();
      setRowMenu(null);
      await onChanged?.();
    } catch (error) {
      onError?.(error.message);
    }
  }

  async function deleteSelectedItems() {
    if (!canDeleteSelection) return;

    try {
      const resourceIds = new Set(selectedManageableResourceIds);
      selectedFolderResources.forEach((resource) => resourceIds.add(resource.id));
      await Promise.all(Array.from(resourceIds).map((resourceId) => api.deleteResource(resourceId)));
      topLevelSelectedFolderPaths.forEach((folderPath) => onDeleteFolder?.(folderPath));
      setCurrentPath((current) => {
        const deletedAncestor = topLevelSelectedFolderPaths.find(
          (folderPath) => current === folderPath || current.startsWith(`${folderPath}/`),
        );
        return deletedAncestor ? parentPath(deletedAncestor) : current;
      });
      clearSelection();
      setRowMenu(null);
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

  const breadcrumbParts = currentPath ? normalizePath(currentPath).split("/") : [];
  const resourceBreadcrumbParts = resourcePathParts(currentPath);
  const currentTitle =
    activeView === DELETED_VIEW ? "Deleted Files" : breadcrumbParts.at(-1) || "All Files";
  const renameSection = quickSections.find((section) => section.id === renameSectionId) || null;

  return {
    activeResources,
    activeView,
    addItemsSectionId,
    breadcrumbParts,
    bulkMoveOpen,
    canUpload,
    canManageRoom,
    canDeleteSelection,
    canMoveSelection,
    collapsedSectionIds,
    clearSelection,
    currentFiles,
    currentPath,
    currentPathIsCanvas,
    currentTitle,
    deleteSelectedItems,
    deleteResource,
    deleteFolder,
    downloadSelectedItems,
    dragActive,
    dragItem,
    dropTargetPath,
    editResource,
    fileFilter,
    handleExternalDrop,
    handleInternalDrop,
    moveFolderPath,
    moveFolder,
    moveResource,
    moveResourceToFolder,
    moveSelectedItems,
    movableFolderPaths,
    folderDialogOpen,
    folderPaths,
    getQuickSectionEntries,
    openResource,
    openRowMenu,
    previewResource,
    previewResourceInPanel,
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
    renameFolder,
    renameFolderPath,
    resourceBreadcrumbParts,
    renameQuickSection,
    renameSection,
    removeQuickSection,
    removeItemFromSection,
    restoreResource,
    sectionDialogOpen,
    setActiveView,
    setAddItemsSectionId,
    setCurrentPath,
    setDragActive,
    setDragItem,
    setDropTargetPath,
    setEditResource,
    setFileFilter,
    setFolderDialogOpen,
    setMoveFolderPath,
    setMoveResource,
    setOpenSectionItemMenu,
    setOpenSectionMenuId,
    setPreviewResource,
    setQuery,
    setRenameFolderPath,
    setRowMenu,
    setRenameSectionId,
    setSectionDialogOpen,
    setSortConfig,
    starredIds,
    rowMenu,
    selectedAllVisible,
    selectedCount,
    selectedDownloadCount: selectedDownloadResources.length,
    selectedEntries,
    selectedItemIds,
    selectedSomeVisible,
    visibleSelectionCount: visibleSelectionEntries.length,
    sortColumns: activeView === DELETED_VIEW ? DELETED_SORT_COLUMNS : SORT_COLUMNS,
    sortConfig,
    setBulkMoveOpen,
    toggleQuickSection,
    toggleSortColumn,
    toggleStar,
    toggleItemSelection,
    toggleVisibleSelection,
    uploadFiles,
    updateResource,
    uploadInputRef,
    user,
    visibleFolders,
    createQuickSection,
    addItemsToSection,
    onCreateFolder,
  };
}

export function ResourceDriveSidebar({ drive }) {
  const [quickTooltip, setQuickTooltip] = useState(null);
  const [quickAccessOpen, setQuickAccessOpen] = useState(true);

  function showQuickTooltip(event, label) {
    const rect = event.currentTarget.getBoundingClientRect();
    setQuickTooltip({
      label,
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
            drive.setSortConfig(DEFAULT_SORT);
          }}
          type="button"
        >
          <Folder size={18} />
          All Files
        </button>
        <button
          className={`resource-sidebar-button ${drive.activeView === DELETED_VIEW ? "active" : ""}`}
          onClick={() => {
            drive.setActiveView(DELETED_VIEW);
            drive.setFileFilter(ALL_FILES_FILTER);
            drive.setQuery("");
            drive.setSortConfig({ key: "dateDeleted", direction: "desc" });
          }}
          type="button"
        >
          <Trash2 size={18} />
          Deleted Files
        </button>

        <div className="resource-quick-header">
          <button
            aria-expanded={quickAccessOpen}
            className="resource-quick-heading"
            onClick={() => setQuickAccessOpen((current) => !current)}
            type="button"
          >
            <ChevronDown size={14} />
            <span>Quick Access</span>
          </button>
          <button
            className="resource-quick-create-button"
            aria-label="Add Section"
            onBlur={() => setQuickTooltip(null)}
            onClick={() => drive.setSectionDialogOpen(true)}
            onFocus={(event) => showQuickTooltip(event, "Add Section")}
            onMouseEnter={(event) => showQuickTooltip(event, "Add Section")}
            onMouseLeave={() => setQuickTooltip(null)}
            type="button"
          >
            <Plus size={17} />
          </button>
          <ResourceTooltip anchor={quickTooltip}>{quickTooltip?.label}</ResourceTooltip>
        </div>

        {quickAccessOpen ? <div className="resource-quick-list">
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
                    <ChevronDown size={14} />
                    <span>{section.name}</span>
                  </button>
                  <button
                    className="resource-quick-action-button"
                    aria-label={`Add Items to ${section.name}`}
                    onBlur={() => setQuickTooltip(null)}
                    onClick={() => {
                      drive.setOpenSectionMenuId("");
                      drive.setAddItemsSectionId(section.id);
                    }}
                    onFocus={(event) => showQuickTooltip(event, "Add Items")}
                    onMouseEnter={(event) => showQuickTooltip(event, "Add Items")}
                    onMouseLeave={() => setQuickTooltip(null)}
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    className="resource-quick-menu-button"
                    aria-label={`${section.name} options`}
                    onBlur={() => setQuickTooltip(null)}
                    onClick={(event) => drive.openQuickSectionMenu(section.id, event)}
                    onFocus={(event) => showQuickTooltip(event, "More Options")}
                    onMouseEnter={(event) => showQuickTooltip(event, "More Options")}
                    onMouseLeave={() => setQuickTooltip(null)}
                    type="button"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
                {menuOpen ? (
                  <QuickSectionMenu
                    anchor={drive.quickMenuAnchor}
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
                            <MoreHorizontal size={15} />
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
        </div> : null}
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
    <section
      className={`resource-drive-shell main-only ${drive.dragActive ? "drag-active" : ""} ${
        drive.previewResource ? "preview-open" : ""
      }`}
    >
      <main
        className="resource-drive-main"
        onDragEnter={(event) => {
          if (drive.activeView !== ALL_VIEW) return;
          if (!isExternalFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          drive.setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) drive.setDragActive(false);
        }}
        onDragOver={(event) => {
          if (drive.activeView !== ALL_VIEW) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (drive.dragItem) {
            event.preventDefault();
            drive.handleInternalDrop(drive.currentPath);
            return;
          }
          drive.handleExternalDrop(event, drive.currentPath || UPLOADS_FOLDER);
        }}
      >
        {drive.dragActive ? (
          <div className="resource-drop-overlay">
            <Upload size={26} />
            <strong>Drop to Upload</strong>
            <span>Files and folders will be added here.</span>
          </div>
        ) : null}
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

        {drive.activeView === ALL_VIEW ? (
          <nav className="resource-breadcrumb" aria-label="Resource path">
            <Folder size={15} />
            <ResourcePathTrail
              canDropPath={(path) => canDropItemIntoPath(drive.dragItem, path)}
              dropTargetPath={drive.dropTargetPath}
              onDragPath={(path) => drive.setDropTargetPath(path)}
              onDropPath={(path) => drive.handleInternalDrop(path)}
              onNavigate={(path) => {
                drive.setCurrentPath(path);
                drive.setFileFilter(ALL_FILES_FILTER);
              }}
              parts={drive.resourceBreadcrumbParts}
            />
          </nav>
        ) : null}

        <div className="resource-drive-title-row">
          <h2>{drive.currentTitle}</h2>
          {drive.activeView === ALL_VIEW && drive.canUpload && !drive.currentPathIsCanvas ? (
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
                New Folder
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

        {drive.selectedCount ? (
          <div className="resource-bulk-toolbar" aria-label="Selected resource actions" role="toolbar">
            <button
              className="resource-button subtle"
              disabled={!drive.selectedDownloadCount}
              onClick={drive.downloadSelectedItems}
              type="button"
            >
              <Download size={16} />
              Download
            </button>
            <button
              className="resource-button subtle"
              disabled={!drive.canMoveSelection}
              onClick={() => drive.setBulkMoveOpen(true)}
              type="button"
            >
              <FolderInput size={16} />
              Move
            </button>
            <button
              className="resource-button subtle danger"
              disabled={!drive.canDeleteSelection}
              onClick={drive.deleteSelectedItems}
              type="button"
            >
              <Trash2 size={16} />
              Delete
            </button>
            <strong>{drive.selectedCount} Selected</strong>
          </div>
        ) : null}

        <div
          className={`resource-drive-table ${drive.activeView === DELETED_VIEW ? "deleted-view" : ""} ${
            drive.selectedCount ? "selection-active" : ""
          }`}
        >
          <div className="resource-table-head">
            <span className="resource-selection-cell">
              <SelectionCheckbox
                checked={drive.selectedAllVisible}
                disabled={!drive.visibleSelectionCount}
                indeterminate={drive.selectedSomeVisible}
                label="Select visible items"
                onChange={drive.toggleVisibleSelection}
              />
            </span>
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

          {drive.visibleFolders.map((folder) => {
            const isCanvasFolder = isCanvasFolderPath(folder.path);
            return (
            <div
              className={`resource-table-row folder ${isCanvasFolder ? "canvas-synced" : ""} ${
                drive.dropTargetPath !== null && normalizePath(drive.dropTargetPath) === normalizePath(folder.path)
                  ? "drop-target"
                  : ""
              } ${drive.selectedItemIds.includes(folderSelectionId(folder.path)) ? "selected" : ""}`}
              draggable={drive.canManageRoom && !isCanvasFolder}
              key={folder.id}
              onDragEnd={() => {
                drive.setDragItem(null);
                drive.setDropTargetPath(null);
                drive.setDragActive(false);
              }}
              onDragLeave={(event) => {
                if (!drive.dragItem || event.currentTarget.contains(event.relatedTarget)) return;
                drive.setDropTargetPath(null);
              }}
              onDragOver={(event) => {
                if (!canDropItemIntoPath(drive.dragItem, folder.path)) return;
                event.preventDefault();
                drive.setDropTargetPath(folder.path);
              }}
              onDragStart={(event) => {
                event.dataTransfer?.setData("application/x-diffriendtiate-resource", folder.path);
                drive.setDragActive(false);
                drive.setDragItem({ kind: "folder", path: folder.path });
              }}
              onDrop={(event) => {
                if (!canDropItemIntoPath(drive.dragItem, folder.path)) return;
                event.preventDefault();
                event.stopPropagation();
                drive.handleInternalDrop(folder.path);
              }}
            >
              <span className="resource-selection-cell">
                <SelectionCheckbox
                  checked={drive.selectedItemIds.includes(folderSelectionId(folder.path))}
                  label={`Select ${folder.name}`}
                  onChange={() => drive.toggleItemSelection(folderSelectionId(folder.path))}
                />
              </span>
              <button className="resource-name-cell" onClick={() => drive.setCurrentPath(folder.path)} type="button">
                <span className="resource-icon-stack">
                  <Folder className="resource-row-icon" size={24} />
                  {isCanvasFolder ? (
                    <span aria-hidden="true" className="resource-sync-badge">
                      <RefreshCw size={9} />
                    </span>
                  ) : null}
                </span>
                <span className="resource-name-copy">
                  <strong>{folder.name}</strong>
                </span>
              </button>
              <FolderActions
                canManage={drive.canManageRoom && !isCanvasFolder}
                folder={folder}
                menuAnchor={drive.rowMenu || { left: 0, top: 0 }}
                onDelete={() => drive.deleteFolder(folder.path)}
                onMove={() => {
                  drive.setMoveFolderPath(folder.path);
                  drive.setRowMenu(null);
                }}
                onOpenMenu={(event) => {
                  if (event?.currentTarget) drive.openRowMenu("folder", folder.path, event);
                  else drive.setRowMenu(null);
                }}
                onRename={() => {
                  drive.setRenameFolderPath(folder.path);
                  drive.setRowMenu(null);
                }}
                open={drive.rowMenu?.kind === "folder" && drive.rowMenu?.id === folder.path}
              />
              {drive.activeView === DELETED_VIEW ? null : (
                <>
                  <span className="resource-date-cell">--</span>
                  <span className="resource-modified-by-cell">--</span>
                  <span className="resource-type-cell">Folder</span>
                  <span className="resource-size-cell">--</span>
                </>
              )}
            </div>
            );
          })}

          {drive.currentFiles.map((resource) => {
            const isCanvasResource = isCanvasSyncedResource(resource);
            const canManageResource = (drive.canManageRoom || resource.uploaderId === drive.user?.id) && !isCanvasResource;
            const rowMenuOpen = drive.rowMenu?.kind === "resource" && drive.rowMenu?.id === resource.id;
            const selectionId = fileSelectionId(resource.id);

            return (
            <div
              className={`resource-table-row ${isCanvasSyncedResource(resource) ? "canvas-synced" : ""} ${
                drive.selectedItemIds.includes(selectionId) ? "selected" : ""
              }`}
              draggable={!resource.deletedAt && canManageResource}
              key={resource.id}
              onDragEnd={() => {
                drive.setDragItem(null);
                drive.setDropTargetPath(null);
                drive.setDragActive(false);
              }}
              onDragStart={(event) => {
                event.dataTransfer?.setData("application/x-diffriendtiate-resource", resource.id);
                drive.setDragActive(false);
                drive.setDragItem({ kind: "resource", resource });
              }}
            >
              <span className="resource-selection-cell">
                {drive.activeView === DELETED_VIEW ? null : (
                  <SelectionCheckbox
                    checked={drive.selectedItemIds.includes(selectionId)}
                    label={`Select ${resource.displayName}`}
                    onChange={() => drive.toggleItemSelection(selectionId)}
                  />
                )}
              </span>
              <button className="resource-name-cell" onClick={() => drive.previewResourceInPanel(resource)} type="button">
                <span className="resource-icon-stack">
                  <File className="resource-row-icon" size={24} />
                  {isCanvasResource ? (
                    <span aria-hidden="true" className="resource-sync-badge">
                      <RefreshCw size={9} />
                    </span>
                  ) : null}
                </span>
                <span className="resource-name-copy">
                  <strong>{resource.displayName}</strong>
                  <small>{getResourceCategory(resource)}</small>
                </span>
              </button>
              <ResourceActions
                canStar={!isCanvasResource}
                canManage={canManageResource}
                deleted={drive.activeView === DELETED_VIEW}
                onDelete={() => drive.deleteResource(resource.id)}
                onEdit={() => {
                  drive.setEditResource(resource);
                  drive.setRowMenu(null);
                }}
                onMove={() => {
                  if (!canManageResource) return;
                  drive.setMoveResource(resource);
                  drive.setRowMenu(null);
                }}
                onOpen={() => drive.openResource(resource)}
                onPermanentDelete={() => drive.permanentlyDeleteResource(resource.id)}
                onOpenMenu={(event) => {
                  if (event?.currentTarget) drive.openRowMenu("resource", resource.id, event);
                  else drive.setRowMenu(null);
                }}
                onRestore={() => drive.restoreResource(resource.id)}
                onToggleStar={() => drive.toggleStar(resource.id)}
                open={rowMenuOpen}
                menuAnchor={drive.rowMenu || { left: 0, top: 0 }}
                resource={resource}
                starred={drive.starredIds.includes(resource.id)}
              />
              {drive.activeView === DELETED_VIEW ? (
                <>
                  <span className="resource-location-cell">{getOriginalLocation(resource)}</span>
                  <span className="resource-date-cell">{formatResourceDate(resource.deletedAt)}</span>
                  <span className="resource-modified-by-cell">{getDeletedBy(resource)}</span>
                  <span className="resource-type-cell">{getResourceFileType(resource)}</span>
                  <span className="resource-size-cell">{formatBytes(resource.size)}</span>
                </>
              ) : (
                <>
                  <span className="resource-date-cell">{formatResourceDate(resource.updatedAt || resource.createdAt)}</span>
                  <span className="resource-modified-by-cell">{getResourceModifiedBy(resource)}</span>
                  <span className="resource-type-cell">{getResourceFileType(resource)}</span>
                  <span className="resource-size-cell">{formatBytes(resource.size)}</span>
                </>
              )}
            </div>
            );
          })}

          {!drive.visibleFolders.length && !drive.currentFiles.length ? (
            <div className="resource-empty-state">
              {drive.activeView === DELETED_VIEW
                ? "Deleted files will appear here."
                : "No files in this folder yet."}
            </div>
          ) : null}
        </div>
      </main>

      {drive.previewResource ? (
        <ResourcePreviewPanel
          onClose={() => drive.setPreviewResource(null)}
          resource={drive.previewResource}
        />
      ) : null}

      {drive.sectionDialogOpen ? (
        <SectionDialog onClose={() => drive.setSectionDialogOpen(false)} onSubmit={drive.createQuickSection} />
      ) : null}
      {drive.renameSection ? (
        <SectionDialog
          initialName={drive.renameSection.name}
          onClose={() => drive.setRenameSectionId("")}
          onSubmit={(name) => drive.renameQuickSection(drive.renameSection.id, name)}
          submitLabel="Rename"
          title="Rename Section"
        />
      ) : null}
      {drive.renameFolderPath ? (
        <SectionDialog
          initialName={childName(drive.renameFolderPath)}
          onClose={() => drive.setRenameFolderPath("")}
          onSubmit={(name) => drive.renameFolder(drive.renameFolderPath, name)}
          submitLabel="Rename"
          title="Rename Folder"
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
      {drive.editResource ? (
        <ResourceEditDialog
          onClose={() => drive.setEditResource(null)}
          onSubmit={(patch) => drive.updateResource(drive.editResource.id, patch)}
          resource={drive.editResource}
        />
      ) : null}
      {drive.moveResource ? (
        <MoveDialog
          folders={drive.movableFolderPaths}
          itemName={drive.moveResource.displayName}
          onClose={() => drive.setMoveResource(null)}
          onSubmit={(folder) => drive.moveResourceToFolder(drive.moveResource, folder)}
          title="Move Resource"
        />
      ) : null}
      {drive.bulkMoveOpen ? (
        <MoveDialog
          folders={drive.movableFolderPaths.filter((folder) =>
            drive.selectedEntries.every(
              (entry) =>
                entry.kind !== "folder" ||
                (folder !== entry.folder.path && !folder.startsWith(`${entry.folder.path}/`)),
            ),
          )}
          itemName={
            drive.selectedCount === 1
              ? drive.selectedEntries[0]?.name
              : `${drive.selectedCount} items selected`
          }
          onClose={() => drive.setBulkMoveOpen(false)}
          onSubmit={drive.moveSelectedItems}
          title="Move Selected Items"
        />
      ) : null}
      {drive.moveFolderPath ? (
        <MoveDialog
          folders={drive.movableFolderPaths.filter(
            (folder) => folder !== drive.moveFolderPath && !folder.startsWith(`${drive.moveFolderPath}/`),
          )}
          itemName={childName(drive.moveFolderPath)}
          onClose={() => drive.setMoveFolderPath("")}
          onSubmit={(folder) => drive.moveFolder(drive.moveFolderPath, folder)}
          title="Move Folder"
        />
      ) : null}
    </section>
  );
}
