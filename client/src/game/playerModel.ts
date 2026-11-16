import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = 'https://cdn.3dassets.dev/assets/32705/v1/model.glb';

let cachedScene: THREE.Group | null = null;
let cachedAnimations: THREE.AnimationClip[] = [];
let loadingPromise: Promise<void> | null = null;

export async function loadPlayerModel(): Promise<void> {
  if (cachedScene) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);
    cachedScene = gltf.scene;
    cachedAnimations = gltf.animations;
  })();

  return loadingPromise;
}

export function createPlayerInstance(): { root: THREE.Group; mixer: THREE.AnimationMixer } {
  if (!cachedScene) throw new Error('Player model not loaded yet');

  const root = cloneSkeleton(cachedScene) as THREE.Group;
  root.traverse((obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  if (cachedAnimations.length > 0) {
    const idleClip =
      cachedAnimations.find((a) => a.name.toLowerCase().includes('idle')) ??
      cachedAnimations[0];
    mixer.clipAction(idleClip).play();
  }

  return { root, mixer };
}