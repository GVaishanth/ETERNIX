import { useState, type MouseEvent } from 'react';
import { buildCareerView } from '../career/careerModel';
import { useGarageStore } from '../garage/garageService';
import { useCareerUiStore } from '../state/careerUiStore';
import { careerPromptVisible } from './careerPrompt';

/**
 * "Press C to start career mode". Shown in the game while the career has not started. C opens the career hub, where
 * Start career is. The prompt does not take input and does not block the game; the close button hides it for the session.
 */
export function CareerPrompt() {
  const garage = useGarageStore((state) => state.garage);
  const career = useGarageStore((state) => state.career);
  const hubOpen = useCareerUiStore((state) => state.open);
  const [dismissed, setDismissed] = useState(false);
  const started = buildCareerView({ garage, career }).started;
  if (!careerPromptVisible({ started, hubOpen, dismissed })) return null;

  const close = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    setDismissed(true);
  };

  return (
    <div className="career-prompt" role="status">
      <span className="career-prompt-key" aria-hidden="true">
        C
      </span>
      <span className="career-prompt-text">Press C to start career mode</span>
      <button type="button" className="career-prompt-close" aria-label="Dismiss the career prompt" onClick={close}>
        ×
      </button>
    </div>
  );
}
