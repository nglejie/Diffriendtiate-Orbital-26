import { X } from "lucide-react";

function SmallSettingsDialog({
  ariaLabel,
  bodyClassName = "",
  children,
  className = "",
  description = "",
  footer = null,
  onClose,
  onSubmit = null,
  overlay = null,
  backdropClassName = "",
  role = "dialog",
  title,
}) {
  const Shell = onSubmit ? "form" : "section";

  return (
    <div
      className={`modal-backdrop room-profile-modal-backdrop ${backdropClassName}`.trim()}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <Shell
        aria-label={ariaLabel || title}
        aria-modal="true"
        className={`room-profile-editor small-settings-dialog ${className}`.trim()}
        onSubmit={onSubmit || undefined}
        role={role}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button aria-label={`Close ${title}`} onClick={onClose} type="button">
            <X size={20} />
          </button>
        </header>

        <div className={`room-profile-editor-body ${bodyClassName}`.trim()}>{children}</div>

        {footer ? <footer>{footer}</footer> : null}
        {overlay}
      </Shell>
    </div>
  );
}

export default SmallSettingsDialog;
