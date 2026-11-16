declare module 'three/addons/loaders/GLTFLoader.js' {
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  export { GLTFLoader };
}

declare module 'three/addons/utils/SkeletonUtils.js' {
  import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
  export { SkeletonUtils };
  export const clone: typeof SkeletonUtils.clone;
}