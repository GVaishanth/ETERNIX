import { useEffect, useRef } from 'react';
import { useConfirmUiStore } from '../state/confirmUiStore';

/**
 * The popup for questions asked before an action (leaving, buying). It opens with Cancel focused, so a stray Enter does
 * not confirm a purchase. Escape cancels. The Escape key is taken here, so it does not also pause the game.
 */
export function ConfirmDialog() {
  const request = useConfirmUiStore((state) => state.request);
  const answer = useConfirmUiStore((state) => state.answer);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = request !== null;

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      answer(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, answer]);

  if (request === null) return null;
  return (
    <div className="confirm-layer">
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <h2 id="confirm-title" className="confirm-title">
          {request.title}
        </h2>
        <p id="confirm-message" className="confirm-message">
          {request.message}
        </p>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="hud-button" onClick={() => answer(false)}>
            {request.cancelLabel}
          </button>
          <button type="button" className="hud-button garage-primary" onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
