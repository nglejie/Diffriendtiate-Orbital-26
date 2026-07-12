import { Check, ChevronRight, FileText, Folder, FolderInput, Hash, MessageSquareText, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppSelectMenu } from "../../../shared/ui/AppSelectMenu.tsx";
import SmallSettingsDialog from "../../../shared/ui/SmallSettingsDialog.tsx";
import { normalizeChannelName } from "./chatLayout.ts";

type Resource = {
  id: string;
  title?: string;
  originalName?: string;
  mimeType?: string;
  folder?: string;
  deletedAt?: string;
};

type ChannelDialogProps = {
  categoryName?: string;
  mode: "category" | "channel";
  onCancel: () => void;
  onCreateCategory: (name: string) => void;
  onCreateChannel: (payload: { name: string; type: string; resourceId: string }) => void;
  latestUploadedResourceId?: string;
  onRequestUpload?: () => void;
  resources?: Resource[];
};

const DOCUMENT_RESOURCE_EXTENSIONS = /\.(pdf|docx|pptx|png|jpe?g|webp)$/i;

const CHANNEL_TYPES = [
  {
    id: "text",
    label: "Text Channel",
    description: "Send messages, files, and study updates.",
    enabled: true,
  },
  {
    id: "document",
    label: "Document Channel",
    description: "Read, annotate, and discuss on documents.",
    enabled: true,
  },
];

function normalizePath(value = "") {
  return String(value)
    .replace(/\\/g, "/")
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
  return parts.at(-1) || "All Files";
}

function isDirectChild(candidatePath: string, currentPath: string) {
  const candidate = normalizePath(candidatePath);
  const current = normalizePath(currentPath);
  return Boolean(candidate) && parentPath(candidate) === current;
}

function resourceFolder(resource: Resource) {
  return normalizePath(resource?.folder || "");
}

function buildFolderPaths(resources: Resource[]) {
  const paths = new Set<string>();

  resources
    .map(resourceFolder)
    .filter(Boolean)
    .forEach((folderPath) => {
      const parts = folderPath.split("/");
      parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join("/")));
    });

  return Array.from(paths).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function isDocumentResource(resource: Resource) {
  const mimeType = String(resource?.mimeType || "").toLowerCase();
  const title = String(resource?.title || resource?.originalName || "").toLowerCase();

  return (
    !resource?.deletedAt &&
    (mimeType.includes("pdf") ||
      mimeType.includes("docx") ||
      mimeType.includes("pptx") ||
      mimeType.includes("wordprocessingml") ||
      mimeType.includes("presentationml") ||
      mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/webp" ||
      DOCUMENT_RESOURCE_EXTENSIONS.test(title))
  );
}

function getResourceTitle(resource: Resource) {
  return String(resource?.title || resource?.originalName || "Untitled document").trim();
}

function getResourceKindLabel(resource: Resource) {
  const mimeType = String(resource?.mimeType || "").toLowerCase();
  const title = getResourceTitle(resource).toLowerCase();

  if (mimeType.includes("pdf") || title.endsWith(".pdf")) return "PDF";
  if (mimeType.includes("wordprocessingml") || mimeType.includes("docx") || title.endsWith(".docx")) {
    return "Word Document";
  }
  if (mimeType.includes("presentationml") || mimeType.includes("pptx") || title.endsWith(".pptx")) {
    return "PowerPoint";
  }
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(title)) return "Image";
  return "Document";
}

/**
 * Discord-inspired channel/section creation dialog.
 *
 * Forum channels are still visible for product direction; document channels can
 * link a room resource so the next Convolution surface has a stable source.
 */
export function ChannelDialog({
  categoryName = "Text Channels",
  mode,
  onCancel,
  onCreateCategory,
  onCreateChannel,
  latestUploadedResourceId = "",
  onRequestUpload,
  resources = [],
}: ChannelDialogProps) {
  const [channelType, setChannelType] = useState("text");
  const [documentQuery, setDocumentQuery] = useState("");
  const [pickerPath, setPickerPath] = useState("");
  const [linkedResourceId, setLinkedResourceId] = useState("");
  const [name, setName] = useState("");
  const documentResources = useMemo(
    () => resources.filter(isDocumentResource),
    [resources],
  );
  const folderPaths = useMemo(() => buildFolderPaths(documentResources), [documentResources]);
  const folderEntries = useMemo(
    () =>
      folderPaths
        .filter((path) => isDirectChild(path, pickerPath))
        .map((path) => ({
          id: `folder:${path}`,
          name: childName(path),
          path,
          subtitle: parentPath(path) || "All Files",
        })),
    [folderPaths, pickerPath],
  );
  const visibleDocumentResources = useMemo(() => {
    const query = documentQuery.trim().toLowerCase();
    const scopedResources = query
      ? documentResources
      : documentResources.filter((resource) => resourceFolder(resource) === normalizePath(pickerPath));

    if (!query) return scopedResources;

    return scopedResources.filter((resource) =>
      `${getResourceTitle(resource)} ${getResourceKindLabel(resource)}`.toLowerCase().includes(query),
    );
  }, [documentQuery, documentResources, pickerPath]);
  const pickerParts = pickerPath ? pickerPath.split("/") : [];
  const normalizedName = mode === "channel" ? normalizeChannelName(name) : name.trim();
  const needsLinkedResource = mode === "channel" && channelType === "document";
  const canSubmit =
    normalizedName.length > 0 &&
    (mode === "category" || channelType === "text" || (channelType === "document" && Boolean(linkedResourceId)));

  const title = mode === "category" ? "Create Section" : "Create Channel";
  const selectedChannelTypeLabel =
    CHANNEL_TYPES.find((type) => type.id === channelType)?.label || categoryName || "Text Channels";
  const subtitleContext =
    channelType === "document" ? "Documents" : categoryName || selectedChannelTypeLabel;
  const subtitle =
    mode === "category" ? null : `in ${subtitleContext}`;

  const namePlaceholder = useMemo(
    () => (mode === "category" ? "New Section" : "new-channel"),
    [mode],
  );

  useEffect(() => {
    if (!linkedResourceId) return;
    if (!documentResources.some((resource) => resource.id === linkedResourceId)) {
      setLinkedResourceId("");
    }
  }, [documentResources, linkedResourceId]);

  useEffect(() => {
    if (!latestUploadedResourceId) return;
    const uploadedResource = documentResources.find((resource) => resource.id === latestUploadedResourceId);
    if (uploadedResource) {
      setChannelType("document");
      setLinkedResourceId(latestUploadedResourceId);
      setPickerPath(resourceFolder(uploadedResource));
    }
  }, [documentResources, latestUploadedResourceId]);

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    if (mode === "category") {
      onCreateCategory(normalizedName);
      return;
    }

    onCreateChannel({
      name: normalizedName,
      type: channelType,
      resourceId: channelType === "document" ? linkedResourceId : "",
    });
  }

  return (
    <SmallSettingsDialog
      className="chat-channel-dialog medium-dialog"
      description={subtitle || ""}
      footer={
        <button className="primary-button compact" disabled={!canSubmit} type="submit">
          {mode === "category" ? "Create Section" : "Create Channel"}
        </button>
      }
      onClose={onCancel}
      onSubmit={handleSubmit}
      title={title}
    >
      {mode === "channel" ? (
        <div className="chat-channel-type-select-wrap">
          <AppSelectMenu
            ariaLabel="Channel Type"
            className="chat-channel-type-select"
            label="Channel Type"
            onChange={(value) => {
              setChannelType(value);
              if (value !== "document") {
                setLinkedResourceId("");
                setDocumentQuery("");
              }
            }}
            options={CHANNEL_TYPES.map((type) => ({
              description: type.description,
              label: type.label,
              value: type.id,
            }))}
            value={channelType}
          />
        </div>
      ) : null}

        <label className="chat-dialog-field">
          <span>{mode === "category" ? "Section Name" : "Channel Name"}</span>
          <span className="chat-dialog-input">
            {mode === "channel" ? <Hash size={20} /> : <MessageSquareText size={19} />}
            <input
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder={namePlaceholder}
              value={name}
            />
          </span>
        </label>

        {needsLinkedResource ? (
          <fieldset className="chat-document-picker">
            <div className="chat-document-picker-heading">
              <legend>Link Document</legend>
              {onRequestUpload ? (
                <button
                  className="secondary-button compact chat-document-upload-button"
                  onClick={onRequestUpload}
                  type="button"
                >
                  <Upload size={16} />
                  Upload
                </button>
              ) : null}
            </div>
            <label className="chat-document-search" aria-label="Search documents">
              <Search size={16} />
              <input
                onChange={(event) => setDocumentQuery(event.target.value)}
                placeholder="Search documents"
                value={documentQuery}
              />
            </label>
            <nav className="resource-picker-path resource-dialog-path chat-document-path" aria-label="Document folder path">
              <FolderInput size={15} aria-hidden="true" />
              <button
                className={!pickerPath ? "active" : ""}
                onClick={() => {
                  setPickerPath("");
                  setDocumentQuery("");
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
                        setDocumentQuery("");
                      }}
                      type="button"
                    >
                      {part}
                    </button>
                  </span>
                );
              })}
            </nav>
            <div className="chat-document-resource-list" role="radiogroup" aria-label="Documents">
              {documentResources.length ? (
                folderEntries.length || visibleDocumentResources.length ? (
                  <>
                    {!documentQuery
                      ? folderEntries.map((folder) => (
                          <button
                            className="chat-document-folder-row"
                            key={folder.id}
                            onClick={() => {
                              setPickerPath(folder.path);
                              setDocumentQuery("");
                            }}
                            type="button"
                          >
                            <span aria-hidden="true" className="chat-document-check placeholder" />
                            <Folder size={20} />
                            <span className="chat-document-resource-copy">
                              <strong>{folder.name}</strong>
                              <small>{folder.subtitle}</small>
                            </span>
                            <ChevronRight size={17} />
                          </button>
                        ))
                      : null}
                    {visibleDocumentResources.map((resource) => {
                    const selected = linkedResourceId === resource.id;
                    return (
                      <label className={`chat-document-resource-card ${selected ? "selected" : ""}`} key={resource.id}>
                    <input
                      checked={selected}
                      name="linked-document"
                      onChange={() => setLinkedResourceId(resource.id)}
                      type="radio"
                      value={resource.id}
                    />
                    <span aria-hidden="true" className="chat-document-check">
                      {selected ? <Check size={14} /> : null}
                    </span>
                    <FileText aria-hidden="true" size={20} />
                    <span className="chat-document-resource-copy">
                      <strong>{getResourceTitle(resource)}</strong>
                      <small>{getResourceKindLabel(resource)}</small>
                    </span>
                  </label>
                    );
                  })}
                  </>
                ) : (
                  <p className="chat-document-empty">
                    {documentQuery ? "No matching documents found." : "No compatible documents in this folder."}
                  </p>
                )
              ) : (
                <p className="chat-document-empty">
                  No PDF, DOCX, PPTX, PNG, JPG, or WEBP resources are available in this room yet.
                </p>
              )}
            </div>
          </fieldset>
        ) : null}

    </SmallSettingsDialog>
  );
}
