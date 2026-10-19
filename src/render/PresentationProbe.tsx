import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { installPresentationDebug, readPresentation } from '../diagnostics/presentationDebug';

/** DEV-only. Gives the browser tests a read-only view of the renderer and presentation. Renders nothing. */
export function PresentationProbe() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => installPresentationDebug(window, () => readPresentation(gl, scene)), [gl, scene]);
  return null;
}
