import * as T from 'three';
import { Game, type Entity } from './game';
const colors = { ground: 0x91ad7d, ballast: 0x9baca4, sleeper: 0x6c776e, rail: 0xcad8cd, coral: 0xf07150, teal: 0x207f7d, gold: 0xffca55 };
export class World {
  scene = new T.Scene(); camera = new T.PerspectiveCamera(53, 1, .1, 220);
  renderer: T.WebGLRenderer; runner = new T.Group(); body = new T.Group(); limbs: T.Mesh[] = [];
  entityMeshes = new Map<number, T.Group>(); pool = new Map<string, T.Group[]>(); scenery = new T.Group();
  batches: { mesh: T.InstancedMesh; matrices: T.Matrix4[] }[] = [];
  mats = new Map<number, T.MeshStandardMaterial>(); cube = new T.BoxGeometry(1, 1, 1); coinGeo = new T.CylinderGeometry(.36, .36, .10, 12);
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.setClearColor(0xbddeda); this.scene.fog = new T.Fog(0xbddeda, 42, 125);
    this.scene.add(new T.HemisphereLight(0xfff6db, 0x709793, 2.5));
    const sun = new T.DirectionalLight(0xfff2ce, 3); sun.position.set(-15, 26, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 24, bottom: -48, far: 90 }); sun.shadow.bias = -.001; this.scene.add(sun);
    this.box(this.scene, [200, .4, 230], [0, -.6, -90], colors.ground);
    this.box(this.scene, [10.5, .2, 210], [0, -.25, -85], colors.ballast);
    for (const lane of [-3, 0, 3]) for (const dx of [-.75, .75]) this.box(this.scene, [.1, .14, 210], [lane + dx, -.08, -85], colors.rail);
    this.scene.add(this.scenery);
    for (let i = 0; i < 90; i++) {
      const group = new T.Group(); group.position.z = -i * 2; group.userData.base = -i * 2;
      for (const lane of [-3, 0, 3]) this.box(group, [2.2, .13, .32], [lane, -.14, 0], colors.sleeper);
      if (i % 5 === 0) {
        for (const side of [-1, 1]) {
          this.tree(group, side * (8 + (i % 3)), 0);
          this.box(group, [.14, .8, 1.8], [side * 5.5, .4, 0], 0xe1ddbe);
          this.box(group, [.2, 1.25, .2], [side * 5.5, .55, .85], 0xffefce);
        }
      }
      if (i % 15 === 0) {
        for (const side of [-1, 1]) this.box(group, [.2, 7, .2], [side * 5.8, 3.4, 0], colors.teal);
        this.box(group, [11.8, .22, .22], [0, 6.8, 0], colors.teal);
      }
      this.scenery.add(group);
    }
    for (let i = 0; i < 32; i++) {
      const side = i % 2 ? 1 : -1, h = 4 + (i * 7 % 11), z = -i * 6;
      const g = new T.Group(); g.position.z = z; g.userData.base = z;
      const x = side * (16 + i % 4 * 3);
      this.box(g, [5, h, 5], [x, h / 2 - .4, 0], [0xe9c79f, 0xf0d9b6, 0xc4cfb2, 0xe4ad8d][i % 4]);
      this.box(g, [5.3, .3, 5.3], [x, h - .3, 0], 0xf8e8c8);
      for (let y = 1.5; y < h - .5; y += 2) for (const dx of [-1.2, 1.2]) this.box(g, [.7, 1, .08], [x + dx, y, 2.55], 0x6c9896);
      this.scenery.add(g);
    }
    // Render repeated scenery in material batches instead of hundreds of draw calls.
    this.scene.updateMatrixWorld(true);
    const batches = new Map<string, { geometry: T.BufferGeometry; material: T.Material; matrices: T.Matrix4[] }>();
    this.scenery.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      const key = object.geometry.type + ':' + object.material.uuid;
      if (!batches.has(key)) batches.set(key, { geometry: object.geometry, material: object.material, matrices: [] });
      batches.get(key)!.matrices.push(object.matrixWorld.clone());
    });
    this.scene.remove(this.scenery);
    for (const batch of batches.values()) {
      const mesh = new T.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.batches.push({ mesh, matrices: batch.matrices }); this.scene.add(mesh);
    }
    this.runner.add(this.body); this.scene.add(this.runner);
    this.box(this.body, [.72, .75, .43], [0, 1.12, 0], colors.coral);
    this.box(this.body, [.48, .6, .21], [0, 1.15, .33], 0x214e59);
    this.box(this.body, [.47, .43, .44], [0, 1.72, 0], 0xf1bf8f);
    this.box(this.body, [.53, .16, .49], [0, 1.96, .01], 0x194854);
    this.box(this.body, [.5, .07, .3], [0, 1.9, -.27], 0x194854);
    for (const side of [-1, 1]) {
      const leg = this.box(this.body, [.25, .6, .28], [side * .21, .43, 0], 0x244957); this.limbs.push(leg);
      this.box(leg, [.95, .28, 1.4], [0, -.44, -.1], 0xfff2d9);
      const arm = this.box(this.body, [.2, .6, .22], [side * .49, 1.03, 0], 0xf1bf8f); this.limbs.push(arm);
    }
    this.camera.position.set(0, 5.7, 11.5); this.camera.lookAt(0, 1, -15);
    this.resize();
  }
  material(color: number) { if (!this.mats.has(color)) this.mats.set(color, new T.MeshStandardMaterial({ color, roughness: .8 })); return this.mats.get(color)!; }
  box(parent: T.Object3D, size: number[], pos: number[], color: number) { const m = new T.Mesh(this.cube, this.material(color)); m.scale.set(size[0], size[1], size[2]); m.position.set(pos[0], pos[1], pos[2]); m.castShadow = m.receiveShadow = true; parent.add(m); return m; }
  tree(parent: T.Object3D, x: number, z: number) {
    this.box(parent, [.32, 1.5, .32], [x, .5, z], 0x8c8464);
    const crown = new T.Mesh(new T.IcosahedronGeometry(1.5, 0), this.material(0x5a9272)); crown.position.set(x, 2.3, z); crown.scale.y = 1.3; crown.castShadow = true; parent.add(crown);
  }
  makeEntity(e: Entity) {
    const g = this.pool.get(e.kind)?.pop() ?? this.createEntity(e.kind); g.userData.kind = e.kind; this.scene.add(g); return g;
  }
  createEntity(kind: string) {
    const g = new T.Group();
    if (kind === 'coin') {
      const c = new T.Mesh(this.coinGeo, this.material(colors.gold)); c.rotation.x = Math.PI / 2; g.add(c);
      this.box(g, [.09, .35, .13], [0, 0, 0], 0xffeeaa);
    } else if (kind === 'train') {
      this.box(g, [2.35, 2.9, 7], [0, 1.65, 0], colors.teal);
      this.box(g, [2.45, .35, 7.05], [0, 3.1, 0], 0xe8e5c9);
      this.box(g, [2.37, .25, 7.04], [0, .75, 0], colors.coral);
      this.box(g, [1.8, .8, .04], [0, 2.3, 3.52], 0x173e4a);
      this.box(g, [.08, .85, .06], [0, 2.3, 3.55], 0xe1dcbf);
      for (const x of [-.8, .8]) this.box(g, [.3, .22, .07], [x, 1.1, 3.55], 0xffe6a0);
      for (const side of [-1, 1]) for (let z = -2.6; z < 3; z += 1.4) this.box(g, [.03, .85, .9], [side * 1.19, 2.25, z], 0x183f4a);
      for (const side of [-1, 1]) for (const z of [-2.3, 2.3]) this.box(g, [.2, .55, .7], [side * 1.05, .3, z], 0x284443);
    } else {
      const high = kind === 'high';
      for (const side of [-1, 1]) this.box(g, [.16, high ? 2.6 : 1.05, .3], [side * 1.02, high ? 1.3 : .525, 0], 0x355c59);
      const y = high ? 1.8 : .52, h = high ? 1.45 : .9;
      this.box(g, [2.25, h, .55], [0, y, 0], colors.coral);
      for (let x = -.8; x < 1; x += .55) { const stripe = this.box(g, [.2, h * .87, .025], [x, y, .288], 0xffe7b2); stripe.rotation.z = -.32; }
      if (high) this.box(g, [2.35, .12, .6], [0, 2.55, 0], 0xffefd0);
    }
    return g;
  }
  resize() { const { clientWidth: w, clientHeight: h } = this.renderer.domElement; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render(game: Game, time: number) {
    const moving = game.phase === 'playing';
    for (const batch of this.batches) {
      batch.matrices.forEach((matrix, index) => {
        const originalZ = matrix.elements[14];
        matrix.elements[14] = ((originalZ + game.distance + 165) % 180 + 180) % 180 - 165;
        batch.mesh.setMatrixAt(index, matrix); matrix.elements[14] = originalZ;
      });
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
    const ids = new Set(game.entities.map(e => e.id));
    for (const [id, mesh] of this.entityMeshes) if (!ids.has(id)) { this.scene.remove(mesh); const kind = mesh.userData.kind; if (!this.pool.has(kind)) this.pool.set(kind, []); this.pool.get(kind)!.push(mesh); this.entityMeshes.delete(id); }
    for (const e of game.entities) {
      let mesh = this.entityMeshes.get(e.id);
      if (mesh && mesh.userData.kind !== e.kind) { this.scene.remove(mesh); this.pool.get(mesh.userData.kind)?.push(mesh); this.entityMeshes.delete(e.id); mesh = undefined; }
      if (!mesh) { mesh = this.makeEntity(e); this.entityMeshes.set(e.id, mesh); }
      mesh.position.set(e.lane * 3, e.y, -e.z);
      if (e.kind === 'coin') mesh.rotation.y = time * 2.7;
    }
    this.runner.position.set(game.x, game.y, 0);
    this.body.scale.y = game.slide > 0 ? .35 : 1;
    this.body.position.y = moving && game.y === 0 && game.slide === 0 ? Math.sin(game.distance * 1.4) * .045 : 0;
    this.body.rotation.z = (game.x - game.lane * 3) * .08;
    for (let i = 0; i < this.limbs.length; i++) this.limbs[i].rotation.x = moving ? Math.sin(game.distance * 1.3 + (i < 2 ? 0 : Math.PI) + (i % 2 ? Math.PI : 0)) * .6 : 0;
    this.camera.position.x += (game.x * .24 - this.camera.position.x) * .06;
    this.renderer.render(this.scene, this.camera);
  }
}
