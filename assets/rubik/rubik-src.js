import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import rubikGlbBase64 from './rubik.glb';

// Bundle the original GLB once; no WebView network fetch or model reload on moves.
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'default' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
const canvas = renderer.domElement;
canvas.style.touchAction = 'none';
document.body.appendChild(canvas);
scene.add(new THREE.AmbientLight(0xffffff, 1.9));
const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(3, 5, 6);
scene.add(light);
const rubik = new THREE.Group();
scene.add(rubik);
const cubies = [];
const pickMeshes = [];
const raycaster = new THREE.Raycaster();
const axes = ['x', 'y', 'z'];
let radius = 2.65;
function fittedDistance() {
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  return radius / Math.sin(Math.min(vertical, horizontal)) / 0.9;
}
let baseZoom = fittedDistance();
let zoom = baseZoom;
let targetZoom = zoom;
let rotationX = -0.35, rotationY = 0.55;
let targetRotationX = rotationX, targetRotationY = rotationY;
let frameId = null, lastFrameTime = 0;
let suspended = false, disposed = false, modelReady = false;
let turn = null;
const pointers = new Map();
let gesture = null, pinchDistance = null;
const events = new AbortController();
const on = (target, name, callback, options = {}) =>
  target.addEventListener(name, callback, { ...options, signal: events.signal });

function releaseModel(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(node => {
    if (!node.isMesh) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}
const binary = atob(rubikGlbBase64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
new GLTFLoader().parse(bytes.buffer, '', gltf => {
  if (disposed) { releaseModel(gltf.scene); return; }
  // Keep the GLB geometry and exported colors. Use shared Lambert materials to
  // keep shading inexpensive on mobile, as in the original renderer.
  const replacements = new Map();
  gltf.scene.traverse(node => {
    if (/^cubie_\d{3}$/.test(node.name)) cubies.push(node);
    if (!node.isMesh) return;
    const original = node.material;
    if (!replacements.has(original)) {
      replacements.set(original, new THREE.MeshLambertMaterial({ color: original.color }));
    }
    node.material = replacements.get(original);
    pickMeshes.push(node);
  });
  replacements.forEach((_, original) => original.dispose());
  // Measure before applying the viewing rotation so load timing never changes fit.
  radius = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere()).radius;
  rubik.add(gltf.scene);
  rubik.updateMatrixWorld(true);
  // Reparent complete cubies, including body and stickers, into one coordinate frame.
  for (const cubie of cubies) rubik.attach(cubie);
  rubik.remove(gltf.scene);
  modelReady = cubies.length === 27;
  resize();
}, error => {
  console.error('Failed to parse rubik.glb', error);
  if (!disposed) {
    const message = document.createElement('p');
    message.textContent = 'Không thể tải Rubik 3D. Hãy khởi động lại ứng dụng.';
    message.style.cssText = 'position:fixed;inset:40% 20px;color:white;text-align:center';
    document.body.appendChild(message);
  }
});

function requestRender() {
  if (frameId !== null || suspended || disposed || document.hidden) return;
  frameId = requestAnimationFrame(update);
}
function finishTurn() {
  if (!turn) return;
  turn.pivot.rotation[turn.axis] = turn.direction * Math.PI / 2;
  rubik.updateMatrixWorld(true);
  for (const cubie of turn.members) {
    rubik.attach(cubie);
    cubie.position.round();
    // Snap the rotation to a signed permutation matrix, avoiding accumulated drift.
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(cubie.quaternion);
    matrix.elements = matrix.elements.map(value => Math.round(value));
    cubie.quaternion.setFromRotationMatrix(matrix).normalize();
    cubie.updateMatrix();
  }
  rubik.remove(turn.pivot);
  turn = null;
}
function startTurn(axis, layer, direction) {
  if (!modelReady || turn || disposed || suspended) return false;
  const members = cubies.filter(cubie => Math.round(cubie.position[axis]) === layer);
  if (members.length !== 9) return false;
  const pivot = new THREE.Group();
  rubik.add(pivot);
  rubik.updateMatrixWorld(true);
  members.forEach(cubie => pivot.attach(cubie));
  turn = { axis, direction, members, pivot, elapsed: 0 };
  requestRender();
  return true;
}
function update(time) {
  frameId = null;
  const dt = lastFrameTime ? Math.min(time - lastFrameTime, 50) : 16.7;
  lastFrameTime = time;
  const blend = 1 - Math.exp(-dt / 45);
  rotationX += (targetRotationX - rotationX) * blend;
  rotationY += (targetRotationY - rotationY) * blend;
  zoom += (targetZoom - zoom) * blend;
  if (Math.abs(targetRotationX - rotationX) < 0.001) rotationX = targetRotationX;
  if (Math.abs(targetRotationY - rotationY) < 0.001) rotationY = targetRotationY;
  if (Math.abs(targetZoom - zoom) < 0.005) zoom = targetZoom;
  rubik.rotation.set(rotationX, rotationY, 0);
  camera.position.set(0, 0, zoom);
  if (turn) {
    turn.elapsed += dt;
    const t = Math.min(turn.elapsed / 180, 1);
    turn.pivot.rotation[turn.axis] = turn.direction * Math.PI / 2 * (t * t * (3 - 2 * t));
    if (t === 1) finishTurn();
  }
  renderer.render(scene, camera);
  if (turn || rotationX !== targetRotationX || rotationY !== targetRotationY || zoom !== targetZoom) requestRender();
  else lastFrameTime = 0;
}
function pick(x, y) {
  if (!modelReady || turn) return null;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2(x / window.innerWidth * 2 - 1, 1 - y / window.innerHeight * 2), camera);
  const hit = raycaster.intersectObjects(pickMeshes, false)[0];
  if (!hit) return null;
  let cubie = hit.object;
  while (cubie && !cubies.includes(cubie)) cubie = cubie.parent;
  if (!cubie) return null;
  const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
  normal.applyQuaternion(rubik.getWorldQuaternion(new THREE.Quaternion()).invert());
  const normalAxis = axes.reduce((best, axis) => Math.abs(normal[axis]) > Math.abs(normal[best]) ? axis : best, 'x');
  const faceNormal = new THREE.Vector3();
  faceNormal[normalAxis] = Math.sign(normal[normalAxis]);
  return { point: rubik.worldToLocal(hit.point.clone()), normal: faceNormal, cubie, normalAxis };
}
function project(point) {
  const ndc = rubik.localToWorld(point.clone()).project(camera);
  return new THREE.Vector2(ndc.x * window.innerWidth / 2, -ndc.y * window.innerHeight / 2);
}
function swipeLayer(hit, dx, dy) {
  const drag = new THREE.Vector2(dx, dy).normalize();
  const origin = project(hit.point);
  let best = null;
  for (const tangentAxis of axes.filter(axis => axis !== hit.normalAxis)) {
    const tangent = new THREE.Vector3();
    tangent[tangentAxis] = 1;
    const screen = project(hit.point.clone().add(tangent)).sub(origin).normalize();
    const alignment = Math.abs(screen.dot(drag));
    if (!best || alignment > best.alignment) {
      const vector = hit.normal.clone().cross(tangent);
      const axis = axes.find(axis => Math.abs(vector[axis]) > 0.5);
      best = { axis, alignment };
    }
  }
  const unit = new THREE.Vector3();
  unit[best.axis] = 1;
  const velocity = unit.cross(hit.point);
  const screenVelocity = project(hit.point.clone().addScaledVector(velocity, 0.1)).sub(origin);
  return startTurn(best.axis, Math.round(hit.cubie.position[best.axis]), Math.sign(screenVelocity.dot(drag)) || 1);
}
function distance() {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
}
function clampZoom(value) { return THREE.MathUtils.clamp(value, baseZoom * 0.9, baseZoom * 2); }
on(canvas, 'pointerdown', event => {
  if (suspended || disposed) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    gesture = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
      hit: pick(event.clientX, event.clientY), used: !!turn };
  } else { gesture = null; pinchDistance = distance(); }
});
on(canvas, 'pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const next = distance();
    if (pinchDistance > 0 && next > 0) targetZoom = clampZoom(targetZoom * pinchDistance / next);
    pinchDistance = next;
    requestRender();
    return;
  }
  if (!gesture || gesture.used) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (gesture.hit) {
    if (Math.hypot(dx, dy) >= 12) gesture.used = swipeLayer(gesture.hit, dx, dy);
  } else {
    targetRotationY += (event.clientX - gesture.lastX) * 0.008;
    targetRotationX += (event.clientY - gesture.lastY) * 0.008;
    requestRender();
  }
  gesture.lastX = event.clientX;
  gesture.lastY = event.clientY;
});
function endPointer(event) {
  pointers.delete(event.pointerId);
  // Do not accidentally turn a layer when the second finger lifts after zooming.
  gesture = null;
  pinchDistance = null;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
on(canvas, 'pointerup', endPointer);
on(canvas, 'pointercancel', endPointer);
on(canvas, 'lostpointercapture', endPointer);
on(canvas, 'wheel', event => {
  event.preventDefault();
  targetZoom = clampZoom(targetZoom + event.deltaY * 0.005);
  requestRender();
}, { passive: false });
function stopInteraction() { pointers.clear(); gesture = null; pinchDistance = null; }
function pauseRendering() {
  stopInteraction();
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  lastFrameTime = 0;
}
window.setRubikActive = active => {
  suspended = !active;
  if (suspended) pauseRendering(); else requestRender();
};
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const ratio = targetZoom / baseZoom;
  baseZoom = fittedDistance();
  zoom = targetZoom = clampZoom(baseZoom * ratio);
  camera.position.z = zoom;
  renderer.setSize(window.innerWidth, window.innerHeight);
  requestRender();
}
on(window, 'resize', resize);
on(window, 'blur', stopInteraction);
on(document, 'visibilitychange', () => document.hidden ? pauseRendering() : requestRender());
window.disposeRubik = () => {
  if (disposed) return;
  disposed = true;
  pauseRendering();
  events.abort();
  releaseModel(rubik);
  renderer.dispose();
  renderer.forceContextLoss();
  canvas.remove();
  cubies.length = 0;
  pickMeshes.length = 0;
  scene.clear();
};
on(window, 'pagehide', window.disposeRubik);
requestRender();
