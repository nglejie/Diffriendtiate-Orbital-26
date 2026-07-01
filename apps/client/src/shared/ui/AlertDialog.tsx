/**
 * Shows a small acknowledgement modal for validation and recoverable user errors.
 * Keeping this shared prevents each feature from inventing its own error surface.
 */
function AlertDialog({ message, onClose }) {
  return (
    <div
      className="modal-backdrop alert-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="alert-modal" role="alertdialog" aria-modal="true">
        <p>{message}</p>
        <div className="modal-actions">
          <button className="primary-button compact" onClick={onClose} type="button">
            OK
          </button>
        </div>
      </section>
    </div>
  );
}

export default AlertDialog;
