import { useEffect, useRef } from 'react';

/**
 * Calls onReady once a canvas is drawn inside the nearest ancestor that matches `scope`. It checks one frame at a time,
 * so a slow start still counts once the canvas exists. Renders nothing visible.
 */
export function CanvasProbe({ scope, onReady }: { readonly scope: string; readonly onReady: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      if (anchor.current?.closest(scope)?.querySelector('canvas')) {
        onReady();
        return;
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [scope, onReady]);
  return <span ref={anchor} hidden />;
}
