const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const three = require('three');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js');
const rubikGlbBase64 = fs.readFileSync('assets/rubik/rubik.glb').toString('base64');

async function harness() {
  const events = () => ({
    handlers: {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    fire(name, event = {}) { this.handlers[name]?.({ preventDefault() {}, ...event }); },
  });
  const canvas = { ...events(), style: {}, setPointerCapture() {}, remove() {} };
  const window = { ...events(), innerWidth: 360, innerHeight: 720 };
  const document = { ...events(), hidden: false, body: { appendChild() {} } };
  const frames = new Map();
  let nextId = 0, time = 0, rendererDisposed = false;
  const context = vm.createContext({
    THREE: { ...three, WebGLRenderer: class {
      domElement = canvas;
      setPixelRatio() {}
      setSize() {}
      render(scene, camera) { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); }
      dispose() { rendererDisposed = true; }
      forceContextLoss() {}
    } },
    window, document, GLTFLoader, rubikGlbBase64, console,
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    AbortController, Headers, Request, Response, fetch, ArrayBuffer, Uint8Array,
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const source = fs.readFileSync('assets/rubik/rubik-src.js', 'utf8').replace(/^\uFEFF/, '').replace(/^import .*$/gm, '');
  vm.runInContext(source, context);
  const read = expression => vm.runInContext(expression, context);
  for (let i = 0; i < 400 && !read('modelReady'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(read('modelReady'), 'original GLB must contain 27 cubies');
  const h = {
    canvas, window, document, frames, read,
    get rendererDisposed() { return rendererDisposed; },
    frame() {
      time += 16.7;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(time));
    },
    settle() {
      for (let i = 0; i < 200 && frames.size; i++) h.frame();
      assert.equal(frames.size, 0, 'renderer must become idle');
    },
    snapshot() { return read('JSON.stringify(cubies.map(c => [c.name, c.position.toArray(), c.quaternion.toArray().map(v => Math.round(v * 1e6))]))'); },
  };
  h.settle();
  return h;
}

test('original GLB: 27 independent cubies, 54 stickers; no synthetic replacement', async () => {
  const h = await harness();
  assert.equal(h.read('cubies.length'), 27);
  assert.equal(h.read('pickMeshes.length'), 81);
  assert.equal(h.read('pickMeshes.filter(m => /^sticker_/.test(m.name)).length'), 54);
  assert.equal(h.read('cubies.every(c => c.parent === rubik)'), true);
  assert.equal(h.window.setCubeState, undefined);
});

test('every layer: 9 physical cubies move; inverse and four turns restore geometry', async () => {
  const h = await harness();
  const initial = h.snapshot();
  for (const axis of ['x', 'y', 'z']) for (const layer of [-1, 0, 1]) {
    assert.equal(h.read(`startTurn('${axis}', ${layer}, 1)`), true);
    assert.equal(h.read('turn.members.length'), 9);
    assert.equal(h.read(`startTurn('${axis}', ${layer}, 1)`), false, 'no overlapping turns');
    h.settle();
    assert.notEqual(h.snapshot(), initial);
    h.read(`startTurn('${axis}', ${layer}, -1)`);
    h.settle();
    assert.equal(h.snapshot(), initial);
    for (let i = 0; i < 4; i++) { h.read(`startTurn('${axis}', ${layer}, 1)`); h.settle(); }
    // q and -q represent the same rotation; compare rotation matrices.
    assert.equal(h.read('cubies.every(c => new THREE.Matrix4().makeRotationFromQuaternion(c.quaternion).equals(new THREE.Matrix4()))'), true);
    assert.equal(h.read('new Set(cubies.map(c => c.position.toArray().join())).size'), 27);
  }
});

test('mixed moves and reverse sequence preserve stickers, positions and orientations', async () => {
  const h = await harness();
  const moves = Array.from({ length: 90 }, (_, i) => [['x','y','z'][i % 3], (Math.floor(i / 3) % 3) - 1, i % 2 ? 1 : -1]);
  const initialPositions = h.read('JSON.stringify(cubies.map(c => c.position.toArray()))');
  const materials = h.read('pickMeshes.map(m => m.material.uuid).join()');
  for (const [axis, layer, sign] of moves) { h.read(`startTurn('${axis}', ${layer}, ${sign})`); h.settle(); }
  for (const [axis, layer, sign] of moves.reverse()) { h.read(`startTurn('${axis}', ${layer}, ${-sign})`); h.settle(); }
  assert.equal(h.read('JSON.stringify(cubies.map(c => c.position.toArray()))'), initialPositions);
  assert.equal(h.read('pickMeshes.map(m => m.material.uuid).join()'), materials);
  assert.equal(h.read('cubies.every(c => Math.abs(c.quaternion.w) === 1)'), true);
});

const pointer = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
test('surface swipe turns a real layer; background drag has damping; pinch zooms', async () => {
  const h = await harness();
  assert.equal(h.read('!!pick(180, 360)'), true);
  const before = h.snapshot();
  h.canvas.fire('pointerdown', pointer(1, 180, 360));
  h.canvas.fire('pointermove', pointer(1, 230, 360));
  assert.equal(h.read('!!turn'), true);
  h.canvas.fire('pointerup', pointer(1, 230, 360));
  h.settle();
  assert.notEqual(h.snapshot(), before);
  const oldRotation = h.read('rotationY');
  h.canvas.fire('pointerdown', pointer(1, 0, 0));
  h.canvas.fire('pointermove', pointer(1, 40, 0));
  h.frame();
  assert.ok(h.read('rotationY') > oldRotation);
  assert.ok(h.read('rotationY < targetRotationY'));
  h.canvas.fire('pointerup', pointer(1, 40, 0));
  h.settle();
  h.canvas.fire('pointerdown', pointer(1, 50, 20));
  h.canvas.fire('pointerdown', pointer(2, 150, 20));
  const oldZoom = h.read('zoom');
  h.canvas.fire('pointermove', pointer(2, 170, 20));
  h.settle();
  assert.ok(h.read('zoom') < oldZoom);
  h.canvas.fire('pointerup', pointer(2, 170, 20));
  h.canvas.fire('pointermove', pointer(1, 200, 20));
  assert.equal(h.read('turn'), null);
});

test('viewport fit, lifecycle pause/resume and idempotent resource disposal', async () => {
  const h = await harness();
  for (const [w, height] of [[360,640], [390,844], [720,360]]) {
    h.window.innerWidth = w; h.window.innerHeight = height;
    h.window.fire('resize'); h.settle();
    // Bounding sphere fits at the closest allowed zoom, at every viewing angle.
    assert.ok(h.read('radius / (baseZoom * 0.9) <= Math.sin(Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect))) + 1e-9'));
  }
  h.read("startTurn('x', 1, 1)");
  h.frame();
  h.window.setRubikActive(false);
  assert.equal(h.frames.size, 0);
  h.window.setRubikActive(true);
  h.settle();
  let released = 0;
  h.read('pickMeshes[0].geometry').addEventListener('dispose', () => released++);
  h.window.disposeRubik(); h.window.disposeRubik();
  assert.equal(released, 1);
  assert.equal(h.rendererDisposed, true);
  assert.equal(h.frames.size, 0);
  h.window.setRubikActive(true);
  assert.equal(h.frames.size, 0);
});
