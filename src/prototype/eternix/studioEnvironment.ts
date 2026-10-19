import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { ETERNIX_PROTOTYPE_CONFIG as C } from '../../config/eternixPrototypeConfig';

/*
 * Reflections for the paint, the glass, and the wet road. A small room is made of light panels in the prototype's own
 * colours (warm lamps, a red tail glow, a cool sky) and turned into an environment map once. The caller disposes it.
 */

export interface StudioEnvironmentResult {
  readonly texture: Texture;
  readonly dispose: () => void;
}

export function buildStudioEnvironment(gl: WebGLRenderer): StudioEnvironmentResult {
  const generator = new PMREMGenerator(gl);
  const room = new Scene();
  room.add(new Mesh(new SphereGeometry(50, 32, 16), new MeshBasicMaterial({ color: C.environment.wallColour, side: BackSide })));
  for (const panel of C.environment.panels) {
    const mesh = new Mesh(
      new BoxGeometry(panel.size[0], panel.size[1], 0.2),
      new MeshBasicMaterial({ color: new Color(panel.colour).multiplyScalar(panel.brightness) }),
    );
    mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  }
  const target = generator.fromScene(room, 0.02);
  return {
    texture: target.texture,
    dispose: () => {
      target.dispose();
      generator.dispose();
      room.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
    },
  };
}
