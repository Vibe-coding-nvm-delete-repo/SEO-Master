import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare } from 'lucide-react';
import FeedbackModal from './FeedbackModal';

export interface FeedbackModalHostProps {
  authorEmail: string | null;
}

/**
 * Owns modal open state so toggling does not re-render the large `App` tree.
 * Renders the dialog via a portal to `document.body` for layout isolation.
 */
const FeedbackModalHost = React.memo(function FeedbackModalHost({ authorEmail }: FeedbackModalHostProps) {
  const [open, setOpen] = useState(false);
  const onClose = useCallback(() => setOpen(false), []);

  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50 transition-all"
      >
        <MessageSquare className="w-3 h-3" />
        Send feedback
      </button>
      {open &&
        portalRoot != null &&
        createPortal(
          <FeedbackModal isOpen onClose={onClose} authorEmail={authorEmail} />,
          portalRoot,
        )}
    </>
  );
});

export default FeedbackModalHost;
