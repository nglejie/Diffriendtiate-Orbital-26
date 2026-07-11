import { useState } from "react";
import { createPortal } from "react-dom";
import SmallSettingsDialog from "./SmallSettingsDialog.tsx";

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

  const dialog = (
    <SmallSettingsDialog
      ariaLabel={title}
      footer={
        <button
          className="primary-button compact"
          disabled={submitting || !value.trim()}
          type="submit"
        >
          {submitting ? "Saving" : confirmLabel}
        </button>
      }
      onClose={onCancel}
      onSubmit={handleSubmit}
      title={title}
    >
      <label className="field">
        <span>{label}</span>
        <input
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          value={value}
        />
      </label>
    </SmallSettingsDialog>
  );

  return createPortal(dialog, document.body);
}

export default TextInputDialog;
