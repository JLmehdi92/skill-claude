import * as THREE from 'three';

// DOM labels over the 3D scene. Objects in the scene register anchors; DOM elements register
// under the same key; a projector moves each element to its anchor's screen position every frame.
export const anchors = new Map();   // key -> THREE.Object3D
export const labelEls = new Map();  // key -> HTMLElement

export const anchorRef = (key) => (obj) => { if (obj) anchors.set(key, obj); else anchors.delete(key); };
export const labelRef = (key) => (el) => { if (el) labelEls.set(key, el); else labelEls.delete(key); };

const v = new THREE.Vector3();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function projectLabels(camera, size) {
  for (const [key, el] of labelEls) {
    const obj = anchors.get(key);
    if (!obj) { el.style.visibility = 'hidden'; continue; }
    obj.getWorldPosition(v);
    const dist = v.distanceTo(camera.position);
    v.project(camera);
    if (v.z > 1 || v.z < -1) { el.style.visibility = 'hidden'; continue; }
    const x = (v.x * 0.5 + 0.5) * size.width;
    const y = (-v.y * 0.5 + 0.5) * size.height;
    const s = clamp(24 / dist, 0.5, 1.15);
    el.style.visibility = 'visible';
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})`;
    el.style.zIndex = String(10000 - Math.round(dist * 10));
  }
}
