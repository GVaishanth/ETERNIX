import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type InstancedMesh,
} from 'three';
import { LAMP_COLOUR, type CityScenery as CityData } from '../world/city/cityScenery';
import { buildCityInstances, type CityInstance } from './cityInstances';
import { createLampPoolTexture, lampHeadEmissive, lampPoolOpacity, registerNightLight, LAMP_HEAD_EMISSIVE } from './nightLights';

/*
 * Renders the city scenery as four instanced meshes (box, cylinder, cone, sphere) with one shared material each. Colour
 * comes from per-instance colour, so there is no material per prop. Instance data is computed once per scenery and never
 * per frame. Geometries and materials are disposed on unmount.
 */

export interface CitySceneryProps {
  scenery: CityData;
}

interface Layer {
  name: string;
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}

function applyInstances(mesh: InstancedMesh | null, instances: CityInstance[]): void {
  if (!mesh) return;
  const matrix = new Matrix4();
  const colour = new Color();
  instances.forEach((item, index) => {
    matrix.fromArray(item.matrix);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, colour.setHex(item.colour));
  });
  mesh.count = instances.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function CityScenery({ scenery }: CitySceneryProps) {
  const instances = useMemo(() => buildCityInstances(scenery), [scenery]);

  // Unit geometry with the base on y = 0, so instance matrices place each object directly.
  const layers = useMemo(() => {
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const cylinder = new CylinderGeometry(1, 1, 1, 10);
    cylinder.translate(0, 0.5, 0);
    const cone = new ConeGeometry(1, 1, 4);
    cone.translate(0, 0.5, 0);
    const sphere = new IcosahedronGeometry(1, 1);
    const make = (name: string, geometry: BufferGeometry): Layer => ({
      name,
      geometry,
      material: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }),
    });
    return {
      boxes: make('CityBoxes', box),
      cylinders: make('CityCylinders', cylinder),
      cones: make('CityCones', cone),
      crowns: make('CityTreeCrowns', sphere),
    };
  }, []);

  // Lamp heads and light pools: their own materials, which the night level changes (nightLights.ts).
  const lampLayers = useMemo(() => {
    const headGeometry = new BoxGeometry(1, 1, 1);
    headGeometry.translate(0, 0.5, 0);
    const headMaterial = new MeshStandardMaterial({ color: '#ffffff', emissive: LAMP_COLOUR, emissiveIntensity: LAMP_HEAD_EMISSIVE.day, roughness: 0.4 });
    const poolGeometry = new PlaneGeometry(1, 1);
    poolGeometry.rotateX(-Math.PI / 2);
    const poolTexture = createLampPoolTexture();
    const poolMaterial = new MeshBasicMaterial({
      color: '#ffffff',
      map: poolTexture ?? undefined,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    return { headGeometry, headMaterial, poolGeometry, poolMaterial, poolTexture };
  }, []);

  const boxesRef = useRef<InstancedMesh>(null);
  const cylindersRef = useRef<InstancedMesh>(null);
  const conesRef = useRef<InstancedMesh>(null);
  const crownsRef = useRef<InstancedMesh>(null);
  const lampHeadsRef = useRef<InstancedMesh>(null);
  const lampPoolsRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    applyInstances(boxesRef.current, instances.boxes);
    applyInstances(cylindersRef.current, instances.cylinders);
    applyInstances(conesRef.current, instances.cones);
    applyInstances(crownsRef.current, instances.crowns);
    applyInstances(lampHeadsRef.current, instances.lampHeads);
    applyInstances(lampPoolsRef.current, instances.lampPools);
  }, [instances]);

  // The lamps follow the night level. The pools are hidden by day, so they cost nothing then.
  useEffect(() => {
    return registerNightLight((level) => {
      lampLayers.headMaterial.emissiveIntensity = lampHeadEmissive(level);
      lampLayers.poolMaterial.opacity = lampPoolOpacity(level);
      lampLayers.poolMaterial.visible = level > 0;
    });
  }, [lampLayers]);

  useEffect(() => {
    return () => {
      for (const layer of Object.values(layers)) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
      lampLayers.headGeometry.dispose();
      lampLayers.headMaterial.dispose();
      lampLayers.poolGeometry.dispose();
      lampLayers.poolMaterial.dispose();
      lampLayers.poolTexture?.dispose();
    };
  }, [layers, lampLayers]);

  // Instanced meshes need a count of at least 1 to exist; empty sets are simply not rendered.
  const countOf = (items: CityInstance[]) => Math.max(1, items.length);

  return (
    <group name="CityScenery">
      <instancedMesh ref={boxesRef} name={layers.boxes.name} args={[layers.boxes.geometry, layers.boxes.material, countOf(instances.boxes)]} visible={instances.boxes.length > 0} />
      <instancedMesh ref={cylindersRef} name={layers.cylinders.name} args={[layers.cylinders.geometry, layers.cylinders.material, countOf(instances.cylinders)]} visible={instances.cylinders.length > 0} />
      <instancedMesh ref={conesRef} name={layers.cones.name} args={[layers.cones.geometry, layers.cones.material, countOf(instances.cones)]} visible={instances.cones.length > 0} />
      <instancedMesh ref={crownsRef} name={layers.crowns.name} args={[layers.crowns.geometry, layers.crowns.material, countOf(instances.crowns)]} visible={instances.crowns.length > 0} />
      <instancedMesh ref={lampHeadsRef} name="CityLampHeads" args={[lampLayers.headGeometry, lampLayers.headMaterial, countOf(instances.lampHeads)]} visible={instances.lampHeads.length > 0} />
      <instancedMesh ref={lampPoolsRef} name="CityLampPools" args={[lampLayers.poolGeometry, lampLayers.poolMaterial, countOf(instances.lampPools)]} visible={instances.lampPools.length > 0} renderOrder={1} />
    </group>
  );
}
