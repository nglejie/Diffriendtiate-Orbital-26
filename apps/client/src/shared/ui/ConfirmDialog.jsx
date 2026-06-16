import { X } from "lucide-react";
import { useState } from "react";

/**
 * Reusable destructive-action confirmation modal.
 * The async submit path keeps delete buttons disabled while the request is in flight.
 */
function ConfirmDialog({ confirmLabel, message, onCancel, onConfirm, title }) {
  const [submitting, setSubmitting] = useState(false);

  /** Runs the caller's destructive action while locking the dialog controls. */
  async function handleConfirm() {
    setSubmitting(true);
    await onConfirm();
    setSubmitting(false);
  }

  return (
    <div
      className="modal-backdrop room-form-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <section className="room-form-modal compact-dialog" role="alertdialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          <button onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>
        <p className="dialog-copy">{message}</p>
        <div className="modal-actions">
          <button className="secondary-button compact" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="danger-button compact"
            disabled={submitting}
            onClick={handleConfirm}
            type="button"
          >
            {submitting ? "Deleting" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConfirmDialog;
