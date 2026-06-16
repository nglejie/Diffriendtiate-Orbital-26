import { X } from "lucide-react";
import { useState } from "react";

/**
 * Small modal for naming entities such as channels, folders, and Intelligrate chats.
 * It trims input before submission so downstream feature code receives valid names.
 */
function TextInputDialog({
  confirmLabel,
  initialValue = "",
  label,
  onCancel,
  onSubmit,
  placeholder,
  title,
}) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  /** Validates and returns the trimmed value to the feature that opened the modal. */
  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedValue = value.trim();
    if (!trimmedValue) return;

    setSubmitting(true);
    await onSubmit(trimmedValue);
    setSubmitting(false);
  }

  return (
    <div
      className="modal-backdrop room-form-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <form className="room-form-modal compact-dialog" onSubmit={handleSubmit}>
        <header>
          <h2>{title}</h2>
          <button onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>
        <label className="field">
          <span>{label}</span>
          <input
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            value={value}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button compact" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="primary-button compact"
            disabled={submitting || !value.trim()}
            type="submit"
          >
            {submitting ? "Saving" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export default TextInputDialog;
