import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Game, ROOF_HEIGHT, RAMP_LENGTH, type Entity } from './game';
export const SCENERY_LENGTH = 800;
export const FOG_START = 220;
export const FOG_END = 560;
const colors = {
  ground: 0x91ad7d,
  ballast: 0x9baca4,
  sleeper: 0x6c776e,
  rail: 0xcad8cd,
  coral: 0xf07150,
  teal: 0x207f7d,
  gold: 0xffca55,
};
export class World {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(53, 1, 0.1, 850);
  renderer: T.WebGLRenderer;
  runner = new T.Group();
  body = new T.Group();
  limbs: T.Mesh[] = [];
  entityMeshes = new Map<number, T.Group>();
  pool = new Map<string, T.Group[]>();
  scenery = new T.Group();
  landmarks: { group: T.Group; base: number; type: string; length: number }[] = [];
  cameraHeight = 0;
  batches: { mesh: T.InstancedMesh; matrices: T.Matrix4[] }[] = [];
  mats = new Map<number, T.MeshStandardMaterial>();
  cube = new T.BoxGeometry(1, 1, 1);
  coinGeo = new T.CylinderGeometry(0.36, 0.36, 0.1, 12);
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.setClearColor(0xbddeda);
    this.scene.fog = new T.Fog(0xbddeda, FOG_START, FOG_END);
    this.scene.add(new T.HemisphereLight(0xfff6db, 0x709793, 2.5));
    const sun = new T.DirectionalLight(0xfff2ce, 3);
    sun.position.set(-15, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 24, bottom: -48, far: 90 });
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
    // The railway sits above the water; bridge sections expose the river below.
    this.box(this.scene, [450, 0.4, 900], [0, -7, -420], 0x63adb4);
    this.box(this.scene, [10.5, 0.5, 850], [0, -0.6, -400], colors.ballast);
    this.box(this.scene, [10.5, 0.2, 850], [0, -0.25, -400], colors.ballast);
    for (const lane of [-3, 0, 3])
      for (const dx of [-0.75, 0.75])
        this.box(this.scene, [0.1, 0.14, 850], [lane + dx, -0.08, -400], colors.rail);
    this.scene.add(this.scenery);
    for (let i = 0; i < SCENERY_LENGTH / 2; i++) {
      const group = new T.Group();
      group.position.z = -i * 2;
      group.userData.base = -i * 2;
      for (const lane of [-3, 0, 3])
        this.box(group, [2.2, 0.13, 0.32], [lane, -0.14, 0], colors.sleeper);
      const bridge = i >= 180 && i <= 220;
      const tunnel = (i * 2 >= 145 && i * 2 <= 235) || (i * 2 >= 630 && i * 2 <= 730);
      if (!bridge && i % 5 === 0) {
        this.box(group, [200, 0.35, 10], [0, -0.6, 0], colors.ground);
        for (const side of [-1, 1]) {
          this.tree(group, side * (8 + (i % 3)), 0);
          this.box(group, [0.14, 0.8, 1.8], [side * 5.5, 0.4, 0], 0xe1ddbe);
          this.box(group, [0.2, 1.25, 0.2], [side * 5.5, 0.55, 0.85], 0xffefce);
        }
      }
      if (!bridge && !tunnel && i % 15 === 0) {
        for (const side of [-1, 1])
          this.box(group, [0.2, 11.5, 0.2], [side * 5.8, 5.65, 0], colors.teal);
        this.box(group, [11.8, 0.22, 0.22], [0, 11.4, 0], colors.teal);
      }
      this.scenery.add(group);
    }
    for (let i = 0; i < 126; i++) {
      if (i * 6 >= 345 && i * 6 <= 455) continue;
      const side = i % 2 ? 1 : -1,
        h = 4 + ((i * 7) % 11),
        z = -i * 6;
      const g = new T.Group();
      g.position.z = z;
      g.userData.base = z;
      const x = side * (16 + (i % 4) * 3);
      this.box(g, [5, h, 5], [x, h / 2 - 0.4, 0], [0xe9c79f, 0xf0d9b6, 0xc4cfb2, 0xe4ad8d][i % 4]);
      this.box(g, [5.3, 0.3, 5.3], [x, h - 0.3, 0], 0xf8e8c8);
      for (let y = 1.5; y < h - 0.5; y += 2)
        for (const dx of [-1.2, 1.2]) this.box(g, [0.7, 1, 0.08], [x + dx, y, 2.55], 0x6c9896);
      this.scenery.add(g);
    }
    this.makeTunnel(190, 60);
    this.makeBridge(400, 88);
    this.makeTunnel(680, 70);
    // Render repeated scenery in material batches instead of hundreds of draw calls.
    this.scene.updateMatrixWorld(true);
    const batches = new Map<
      string,
      { geometry: T.BufferGeometry; material: T.Material; matrices: T.Matrix4[] }
    >();
    this.scenery.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const key = object.geometry.type + ':' + object.material.uuid;
      if (!batches.has(key))
        batches.set(key, { geometry: object.geometry, material: object.material, matrices: [] });
      batches.get(key)!.matrices.push(object.matrixWorld.clone());
    });
    this.scene.remove(this.scenery);
    for (const batch of batches.values()) {
      const mesh = new T.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.batches.push({ mesh, matrices: batch.matrices });
      this.scene.add(mesh);
    }
    this.runner.add(this.body);
    this.scene.add(this.runner);
    this.box(this.body, [0.72, 0.75, 0.43], [0, 1.12, 0], colors.coral);
    this.box(this.body, [0.48, 0.6, 0.21], [0, 1.15, 0.33], 0x214e59);
    this.box(this.body, [0.47, 0.43, 0.44], [0, 1.72, 0], 0xf1bf8f);
    this.box(this.body, [0.53, 0.16, 0.49], [0, 1.96, 0.01], 0x194854);
    this.box(this.body, [0.5, 0.07, 0.3], [0, 1.9, -0.27], 0x194854);
    for (const side of [-1, 1]) {
      const leg = this.box(this.body, [0.25, 0.6, 0.28], [side * 0.21, 0.43, 0], 0x244957);
      this.limbs.push(leg);
      this.box(leg, [0.95, 0.28, 1.4], [0, -0.44, -0.1], 0xfff2d9);
      const arm = this.box(this.body, [0.2, 0.6, 0.22], [side * 0.49, 1.03, 0], 0xf1bf8f);
      this.limbs.push(arm);
    }
    this.camera.position.set(0, 5.7, 11.5);
    this.camera.lookAt(0, 1, -15);
    this.resize();
  }
  makeTunnel(base: number, length: number) {
    const group = new T.Group();
    group.position.z = -base;
    for (const side of [-1, 1]) {
      this.box(group, [1.2, 8.8, length], [side * 6.1, 4.2, 0], 0x657d78);
      this.box(group, [0.1, 0.25, length], [side * 5.46, 1.2, 0], 0xe4b967);
      for (let z = -length / 2; z <= length / 2; z += 10) {
        this.box(group, [0.15, 7.3, 0.5], [side * 5.45, 3.65, z], 0x405c5b);
        this.box(group, [0.18, 0.25, 1.8], [side * 5.4, 5.6, z], 0xffe4a0);
      }
    }
    const ceiling = new T.Group();
    ceiling.name = 'ceiling';
    group.add(ceiling);
    this.box(ceiling, [13.4, 0.6, length], [0, 8.6, 0], 0x526e69);
    for (const z of [-length / 2, length / 2]) {
      this.box(group, [13.8, 1.4, 1.2], [0, 8.2, z], 0x8ba293);
      for (const side of [-1, 1]) this.box(group, [1.5, 8.5, 1.5], [side * 6.15, 4.1, z], 0x8ba293);
      this.box(group, [3.6, 0.65, 1.25], [0, 8.15, z], 0x214e50);
      for (const x of [-0.8, 0, 0.8]) this.box(group, [0.25, 0.25, 1.3], [x, 8.15, z], 0xffcb67);
    }
    this.scene.add(group);
    this.landmarks.push({ group, base, type: 'tunnel', length });
  }
  makeBridge(base: number, length: number) {
    const group = new T.Group();
    group.position.z = -base;
    this.box(group, [12, 0.7, length], [0, -0.8, 0], 0x436665);
    for (const side of [-1, 1]) {
      this.box(group, [0.3, 0.3, length], [side * 5.7, 1.2, 0], 0xda7952);
      this.box(group, [0.4, 0.4, length], [side * 5.9, 7.7, 0], 0x326b6b);
      for (let z = -length / 2; z <= length / 2; z += 11) {
        this.box(group, [0.45, 15, 0.6], [side * 5.9, 0.2, z], 0x326b6b);
        const beam = this.box(group, [0.26, 10.8, 0.3], [side * 5.9, 3.9, z + 5.5], 0x438280);
        beam.rotation.x = 0.94;
        this.box(group, [12, 0.3, 0.35], [0, 7.7, z], 0x326b6b);
      }
    }
    this.scene.add(group);
    this.landmarks.push({ group, base, type: 'bridge', length });
  }
  material(color: number) {
    if (!this.mats.has(color))
      this.mats.set(color, new T.MeshStandardMaterial({ color, roughness: 0.8 }));
    return this.mats.get(color)!;
  }
  box(parent: T.Object3D, size: number[], pos: number[], color: number) {
    const m = new T.Mesh(this.cube, this.material(color));
    m.scale.set(size[0], size[1], size[2]);
    m.position.set(pos[0], pos[1], pos[2]);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  tree(parent: T.Object3D, x: number, z: number) {
    this.box(parent, [0.32, 1.5, 0.32], [x, 0.5, z], 0x8c8464);
    const crown = new T.Mesh(new T.IcosahedronGeometry(1.5, 0), this.material(0x5a9272));
    crown.position.set(x, 2.3, z);
    crown.scale.y = 1.3;
    crown.castShadow = true;
    parent.add(crown);
  }
  makeEntity(e: Entity) {
    const key = e.kind + (e.ramp ? '-ramp' : '');
    const g = this.pool.get(key)?.pop() ?? this.createEntity(e.kind, e.ramp);
    g.userData.kind = key;
    this.scene.add(g);
    return g;
  }
  createEntity(kind: string, ramp = false) {
    const g = new T.Group();
    if (kind === 'coin') {
      const c = new T.Mesh(this.coinGeo, this.material(colors.gold));
      c.rotation.x = Math.PI / 2;
      g.add(c);
      this.box(g, [0.09, 0.35, 0.13], [0, 0, 0], 0xffeeaa);
    } else if (kind === 'train') {
      const chassis = new T.Group();
      chassis.name = 'chassis';
      g.add(chassis);
      this.box(chassis, [2.35, 2.9, 7], [0, 1.65, 0], colors.teal);
      this.box(chassis, [2.45, 0.35, 7.05], [0, 3.1, 0], 0xe8e5c9);
      this.box(chassis, [2.37, 0.25, 7.04], [0, 0.75, 0], colors.coral);
      this.box(chassis, [1.8, 0.8, 0.04], [0, 2.3, 3.52], 0x173e4a);
      this.box(chassis, [0.08, 0.85, 0.06], [0, 2.3, 3.55], 0xe1dcbf);
      for (const x of [-0.8, 0.8]) this.box(chassis, [0.3, 0.22, 0.07], [x, 1.1, 3.55], 0xffe6a0);
      for (const side of [-1, 1])
        for (let z = -2.6; z < 3; z += 1.4)
          this.box(chassis, [0.03, 0.85, 0.9], [side * 1.19, 2.25, z], 0x183f4a);
      for (const side of [-1, 1])
        for (const z of [-2.3, 2.3])
          this.box(chassis, [0.2, 0.55, 0.7], [side * 1.05, 0.3, z], 0x284443);
      if (ramp) {
        const slope = new T.Group();
        slope.name = 'ramp';
        const geometry = new T.BufferGeometry();
        const w = 1.16,
          h = ROOF_HEIGHT,
          r = RAMP_LENGTH;
        geometry.setAttribute(
          'position',
          new T.Float32BufferAttribute(
            [
              -w,
              0,
              r,
              w,
              0,
              r,
              w,
              h,
              0,
              -w,
              0,
              r,
              w,
              h,
              0,
              -w,
              h,
              0,
              -w,
              0,
              r,
              -w,
              h,
              0,
              -w,
              0,
              0,
              w,
              0,
              r,
              w,
              0,
              0,
              w,
              h,
              0,
              -w,
              0,
              0,
              -w,
              h,
              0,
              w,
              h,
              0,
              -w,
              0,
              0,
              w,
              h,
              0,
              w,
              0,
              0,
            ],
            3,
          ),
        );
        geometry.computeVertexNormals();
        const mesh = new T.Mesh(geometry, this.material(0xdfaa47));
        mesh.castShadow = mesh.receiveShadow = true;
        slope.add(mesh);
        // High contrast chevrons show the ramp direction and rise.
        for (let d = 1; d < r; d += 2) {
          const stripe = this.box(
            slope,
            [1.9, 0.045, 0.32],
            [0, h * (1 - d / r) + 0.025, d],
            0xffeeb5,
          );
          stripe.rotation.x = Math.atan(h / r);
        }
        g.add(slope);
      }
    } else {
      const high = kind === 'high';
      for (const side of [-1, 1])
        this.box(g, [0.16, high ? 2.6 : 1.05, 0.3], [side * 1.02, high ? 1.3 : 0.525, 0], 0x355c59);
      const y = high ? 1.8 : 0.52,
        h = high ? 1.45 : 0.9;
      this.box(g, [2.25, h, 0.55], [0, y, 0], colors.coral);
      for (let x = -0.8; x < 1; x += 0.55) {
        const stripe = this.box(g, [0.2, h * 0.87, 0.025], [x, y, 0.288], 0xffe7b2);
        stripe.rotation.z = -0.32;
      }
      if (high) this.box(g, [2.35, 0.12, 0.6], [0, 2.55, 0], 0xffefd0);
    }
    if (kind === 'train') {
      this.mergeModel(g.getObjectByName('chassis')!);
      const slope = g.getObjectByName('ramp');
      if (slope) this.mergeModel(slope);
    } else this.mergeModel(g);
    return g;
  }
  mergeModel(root: T.Object3D) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const groups = new Map<string, { material: T.Material; geometries: T.BufferGeometry[] }>();
    root.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      const material = child.material as T.Material;
      if (!groups.has(material.uuid)) groups.set(material.uuid, { material, geometries: [] });
      groups
        .get(material.uuid)!
        .geometries.push(
          child.geometry
            .clone()
            .applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, child.matrixWorld)),
        );
    });
    root.clear();
    for (const { material, geometries } of groups.values()) {
      const merged = mergeGeometries(geometries)!;
      geometries.forEach((geometry) => geometry.dispose());
      const mesh = new T.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
  }
  resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  render(game: Game, time: number) {
    const moving = game.phase === 'playing';
    for (const batch of this.batches) {
      batch.matrices.forEach((matrix, index) => {
        const originalZ = matrix.elements[14];
        matrix.elements[14] =
          ((((originalZ + game.distance + 760) % SCENERY_LENGTH) + SCENERY_LENGTH) %
            SCENERY_LENGTH) -
          760;
        batch.mesh.setMatrixAt(index, matrix);
        matrix.elements[14] = originalZ;
      });
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const landmark of this.landmarks) {
      landmark.group.position.z =
        ((((-landmark.base + game.distance + 690) % SCENERY_LENGTH) + SCENERY_LENGTH) %
          SCENERY_LENGTH) -
        690;
    }
    const ids = new Set(game.entities.map((e) => e.id));
    for (const [id, mesh] of this.entityMeshes)
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        const kind = mesh.userData.kind;
        if (!this.pool.has(kind)) this.pool.set(kind, []);
        this.pool.get(kind)!.push(mesh);
        this.entityMeshes.delete(id);
      }
    for (const e of game.entities) {
      let mesh = this.entityMeshes.get(e.id);
      if (mesh && mesh.userData.kind !== e.kind + (e.ramp ? '-ramp' : '')) {
        this.scene.remove(mesh);
        const key = mesh.userData.kind;
        if (!this.pool.has(key)) this.pool.set(key, []);
        this.pool.get(key)!.push(mesh);
        this.entityMeshes.delete(e.id);
        mesh = undefined;
      }
      if (!mesh) {
        mesh = this.makeEntity(e);
        this.entityMeshes.set(e.id, mesh);
      }
      mesh.position.set(e.lane * 3, e.y, -e.z);
      if (e.kind === 'coin') mesh.rotation.y = time * 2.7;
      if (e.kind === 'train') {
        mesh.getObjectByName('chassis')!.scale.z = e.length / 7;
        const ramp = mesh.getObjectByName('ramp');
        if (ramp) ramp.position.z = e.length / 2;
      }
    }
    this.runner.position.set(game.x, game.y, 0);
    this.body.scale.y = game.slide > 0 ? 0.35 : 1;
    this.body.position.y =
      moving && game.grounded && game.slide === 0 ? Math.sin(game.distance * 1.4) * 0.045 : 0;
    this.body.rotation.z =
      (game.x - game.lane * 3) * 0.08 +
      (game.bonkFlash > 0 ? Math.sin(game.bonkFlash * 75) * 0.16 : 0);
    for (let i = 0; i < this.limbs.length; i++)
      this.limbs[i].rotation.x = moving
        ? Math.sin(game.distance * 1.3 + (i < 2 ? 0 : Math.PI) + (i % 2 ? Math.PI : 0)) * 0.6
        : 0;
    this.cameraHeight += (Math.min(game.y, ROOF_HEIGHT) - this.cameraHeight) * 0.07;
    const nearTunnel = this.landmarks.some(
      (l) => l.type === 'tunnel' && Math.abs(l.group.position.z) < l.length / 2 + 22,
    );
    // Keep the camera below tunnel portals even when the runner is on a roof.
    this.camera.position.y = Math.min(5.7 + this.cameraHeight, nearTunnel ? 7.1 : 10);
    this.camera.lookAt(game.x * 0.15, 1 + this.cameraHeight, -15);
    this.camera.position.x += (game.x * 0.24 - this.camera.position.x) * 0.06;
    this.renderer.render(this.scene, this.camera);
  }
}
