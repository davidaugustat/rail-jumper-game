export type Kind = 'low' | 'high' | 'train' | 'coin';
export interface Entity {
  id: number;
  kind: Kind;
  lane: number;
  z: number;
  y: number;
  extra: number;
  length: number;
  ramp?: boolean;
}
export type Phase = 'ready' | 'playing' | 'paused' | 'over';
export const LANE_WIDTH = 3;
export const SLIDE_TIME = 0.8;
export const JUMP_SPEED = 9;
export const ROOF_JUMP_SPEED = 11.5;
export const RAMP_JUMP_SPEED = 13;
export const GRAVITY = 24;
export const START_SPEED = 18;
export const MAX_SPEED = 30;
export const STEP = 1 / 120;
export const ROOF_HEIGHT = 3.28;
export const RAMP_LENGTH = 10;
export const GENERATION_DISTANCE = 650;
export const BONK_WINDOW = 10;
const ACCELERATION = 0.15;
const TRAIN_CONTACT_MARGIN = 0.28;
const PASSING_ROOF_LANDING_GRACE = 0.2;

// Integrate the speed curve so oncoming trains can be placed far away while
// still meeting a stationary rooftop route at its planned encounter time.
export function distanceAt(time: number) {
  const accelerating = Math.min(time, (MAX_SPEED - START_SPEED) / ACCELERATION);
  return (
    START_SPEED * accelerating +
    0.5 * ACCELERATION * accelerating ** 2 +
    MAX_SPEED * (time - accelerating)
  );
}
export interface Route {
  time: number;
  safe: number;
  rooftop: boolean;
}
export class Game {
  phase: Phase = 'ready';
  lane = 0;
  x = 0;
  y = 0;
  vy = 0;
  slide = 0;
  grounded = true;
  pendingSlide = false;
  moveOrigin = 0;
  bonkWindow = 0;
  bonkFlash = 0;
  rampAccessTrainId: number | undefined;
  distance = 0;
  coins = 0;
  elapsed = 0;
  entities: Entity[] = [];
  nextId = 0;
  nextEncounter = 3;
  row = 0;
  safeLane = 0;
  routes: Route[] = [];
  lastTrainLane: number | undefined;
  onEvent: (event: 'jump' | 'coin' | 'bonk' | 'crash') => void = () => {};
  constructor(public random: () => number = Math.random) {}
  get speed() {
    return Math.min(MAX_SPEED, START_SPEED + this.elapsed * ACCELERATION);
  }
  get score() {
    return Math.floor(this.distance) + this.coins * 10;
  }
  start() {
    this.phase = 'playing';
    this.lane =
      this.x =
      this.y =
      this.vy =
      this.slide =
      this.distance =
      this.coins =
      this.elapsed =
      this.nextId =
      this.row =
      this.safeLane =
        0;
    this.grounded = true;
    this.pendingSlide = false;
    this.moveOrigin = 0;
    this.bonkWindow = this.bonkFlash = 0;
    this.entities = [];
    this.routes = [];
    this.nextEncounter = 3;
    this.lastTrainLane = undefined;
    this.rampAccessTrainId = undefined;
    this.generateAhead();
  }
  move(direction: number) {
    if (this.phase !== 'playing') return;
    const next = Math.max(-1, Math.min(1, this.lane + direction));
    if (next !== this.lane) {
      this.moveOrigin = this.lane;
      this.lane = next;
    }
  }
  jump() {
    if (this.phase !== 'playing') return;
    this.slide = 0;
    this.pendingSlide = false;
    if (this.grounded) {
      const launchedFromRoof = this.y >= ROOF_HEIGHT - 0.08;
      const launchedFromRamp = this.entities.some((e) => {
        if (
          e.kind !== 'train' ||
          !e.ramp ||
          e.z <= e.length / 2 ||
          e.z > e.length / 2 + RAMP_LENGTH
        )
          return false;
        const surface = this.surface(e);
        return surface !== undefined && Math.abs(this.y - surface) < 0.1;
      });
      this.grounded = false;
      this.vy = launchedFromRamp
        ? RAMP_JUMP_SPEED
        : launchedFromRoof
          ? ROOF_JUMP_SPEED
          : JUMP_SPEED;
      this.onEvent('jump');
    }
  }
  duck() {
    if (this.phase !== 'playing') return;
    if (!this.grounded) {
      this.vy = Math.min(this.vy, -12);
      this.pendingSlide = true;
    } else if (this.slide === 0) this.slide = SLIDE_TIME;
  }
  pause() {
    if (this.phase === 'playing') this.phase = 'paused';
  }
  resume() {
    if (this.phase === 'paused') this.phase = 'playing';
  }
  add(kind: Kind, lane: number, time: number, options: Partial<Entity> = {}) {
    const extra = options.extra ?? 0;
    const e: Entity = {
      id: this.nextId++,
      kind,
      lane,
      z: distanceAt(time) - this.distance + extra * (time - this.elapsed),
      y: 0,
      extra,
      length: kind === 'train' ? 24 : 0.65,
      ...options,
    };
    this.entities.push(e);
    return e;
  }
  coinsAlong(train: Entity) {
    for (let offset = -train.length / 2 + 2; offset < train.length / 2; offset += 3) {
      this.entities.push({
        id: this.nextId++,
        kind: 'coin',
        lane: train.lane,
        z: train.z + offset,
        y: ROOF_HEIGHT + 0.9,
        extra: train.extra,
        length: 0.4,
      });
    }
    if (train.ramp)
      for (let d = 2; d < RAMP_LENGTH; d += 2)
        this.entities.push({
          id: this.nextId++,
          kind: 'coin',
          lane: train.lane,
          z: train.z - train.length / 2 - RAMP_LENGTH + d,
          y: (ROOF_HEIGHT * d) / RAMP_LENGTH + 0.9,
          extra: train.extra,
          length: 0.4,
        });
  }
  generateAhead() {
    while (distanceAt(this.nextEncounter) - this.distance < GENERATION_DISTANCE) {
      // Two mixed rows followed by a two-train rooftop route. Every row has at
      // least one train, making trains the dominant hazard while preserving a
      // verified ground lane through overlapping encounters.
      // Train encounters occupy their own reserved time window, preventing a
      // later row or faster train from blocking the one guaranteed ground route.
      if (this.row % 3 === 2) {
        const entry = Math.floor(this.random() * 3) - 1;
        const target = entry === 0 ? (this.random() < 0.5 ? -1 : 1) : 0;
        const safe = [-1, 0, 1].find((l) => l !== entry && l !== target)!;
        const time = this.nextEncounter + 1.3;
        const train = this.add('train', entry, time, { ramp: true, length: 28 });
        const passing = this.add('train', target, time + 0.25, {
          extra: 6 + this.random() * 4,
          length: 34,
        });
        this.coinsAlong(train);
        this.coinsAlong(passing);
        this.routes.push({ time: time - 1.35, safe, rooftop: true });
        this.safeLane = safe;
        this.lastTrainLane = undefined;
        this.nextEncounter = time + 2;
      } else {
        // A pair of mixed rows shares its safe lane. Long trains can therefore
        // overlap visually without forcing the player across a train's tail.
        if (this.row % 3 === 0) {
          const choices = [-1, 0, 1].filter((l) => l !== this.safeLane && l !== this.lastTrainLane);
          this.safeLane = choices[Math.floor(this.random() * choices.length)] ?? this.safeLane;
        }
        const time = this.nextEncounter;
        const blocked = [-1, 0, 1].filter((l) => l !== this.safeLane);
        const trainLane = blocked[Math.floor(this.random() * blocked.length)];
        const barrierLane = blocked.find((l) => l !== trainLane)!;
        this.add('train', trainLane, time, {
          extra: this.random() < 0.6 ? 5 + this.random() * 4 : 0,
          length: 14 + this.random() * 5,
        });
        this.lastTrainLane = trainLane;
        const kind = this.random() < 0.5 ? 'low' : 'high';
        this.add(kind, barrierLane, time);
        if (kind === 'low') this.add('coin', barrierLane, time, { y: 2.35, length: 0.4 });
        for (let i = -1; i <= 1; i++)
          this.add('coin', this.safeLane, time, {
            z: distanceAt(time) - this.distance + i * 2,
            y: 1,
            length: 0.4,
          });
        // Route time is the decision point at the front of the longest train,
        // leaving enough time to complete a lane change before its nose arrives.
        this.routes.push({ time: time - 0.45, safe: this.safeLane, rooftop: false });
        this.nextEncounter += Math.max(0.86, 1.1 - time * 0.0015);
      }
      this.row++;
    }
  }
  surface(e: Entity, x = this.x, z = e.z, roofMargin = 0): number | undefined {
    if (e.kind !== 'train' || Math.abs(x - e.lane * LANE_WIDTH) > 1.18) return;
    if (Math.abs(z) <= e.length / 2) return ROOF_HEIGHT;
    if (e.ramp && z > e.length / 2 && z <= e.length / 2 + RAMP_LENGTH)
      return (ROOF_HEIGHT * (e.length / 2 + RAMP_LENGTH - z)) / RAMP_LENGTH;
    if (!e.ramp && Math.abs(z) <= e.length / 2 + roofMargin) return ROOF_HEIGHT;
  }
  update(dt: number) {
    if (this.phase !== 'playing') return;
    const beforeDistance = this.distance;
    this.elapsed += dt;
    this.distance = distanceAt(this.elapsed);
    const travel = this.distance - beforeDistance;
    const oldX = this.x,
      oldY = this.y,
      wasGrounded = this.grounded;
    this.x += Math.max(-18 * dt, Math.min(18 * dt, this.lane * LANE_WIDTH - this.x));
    this.y += this.vy * dt - 0.5 * GRAVITY * dt * dt;
    this.vy -= GRAVITY * dt;
    this.slide = Math.max(0, this.slide - dt);
    this.bonkWindow = Math.max(0, this.bonkWindow - dt);
    this.bonkFlash = Math.max(0, this.bonkFlash - dt);
    let floor = 0;
    let support: Entity | undefined;
    for (const e of this.entities) {
      const prevZ = e.z;
      e.z -= travel + e.extra * dt;
      const surface = this.surface(e, this.x, e.z, TRAIN_CONTACT_MARGIN);
      if (surface === undefined) continue;
      const previousSurface = this.surface(e, oldX, prevZ, TRAIN_CONTACT_MARGIN);
      // During a diagonal landing oldX may still be outside the ramp. Sample
      // its previous height at the new x so a fast ramp cannot rise through
      // the runner between fixed simulation steps.
      const previousSurfaceAtNewX = this.surface(e, this.x, prevZ, TRAIN_CONTACT_MARGIN);
      const walking =
        wasGrounded && previousSurface !== undefined && Math.abs(oldY - previousSurface) < 0.08;
      const enteringRamp =
        wasGrounded &&
        e.ramp &&
        surface <= ((travel + e.extra * dt) * ROOF_HEIGHT) / RAMP_LENGTH + 0.08 &&
        oldY < 0.08;
      const passingRoofArrival =
        !e.ramp && surface === ROOF_HEIGHT && previousSurfaceAtNewX === undefined;
      // Favor a successful transfer when a passing train arrives just after
      // the runner reaches roof height. This small grace prevents a visually
      // valid landing from becoming a frontal crash at the train's nose.
      const landingSurface =
        previousSurface ?? previousSurfaceAtNewX ?? (passingRoofArrival ? surface : undefined);
      const landingGrace = passingRoofArrival ? PASSING_ROOF_LANDING_GRACE : 0.035;
      const landing =
        this.vy <= 0 &&
        landingSurface !== undefined &&
        oldY >= landingSurface - landingGrace &&
        this.y <= surface;
      if ((walking || enteringRamp || landing) && surface >= floor) {
        floor = surface;
        support = e;
      }
    }
    this.grounded = this.y <= floor && this.vy <= 0;
    if (this.grounded) {
      this.y = floor;
      this.vy = 0;
      if (support?.kind === 'train' && support.ramp) this.rampAccessTrainId = support.id;
      else if (floor === 0) this.rampAccessTrainId = undefined;
      if (this.pendingSlide) {
        this.slide = SLIDE_TIME;
        this.pendingSlide = false;
      }
    }
    for (const e of this.entities) {
      const prevZ = e.z + travel + e.extra * dt;
      const half = e.length / 2 + TRAIN_CONTACT_MARGIN;
      const nearZ = e.z <= half && prevZ >= -half;
      const nearX =
        Math.min(oldX, this.x) < e.lane * LANE_WIDTH + 1.35 &&
        Math.max(oldX, this.x) > e.lane * LANE_WIDTH - 1.35;
      const centerX = e.lane * LANE_WIDTH;
      const oldNearX = Math.abs(oldX - centerX) < 1.35;
      const nowNearX = Math.abs(this.x - centerX) < 1.35;
      const enteredFromSide = !oldNearX && nowNearX && Math.abs(this.x - oldX) > 0.001;
      if (e.kind === 'train' && e.ramp) {
        const rampHeight = this.surface(e);
        const besideRamp = prevZ > e.length / 2 && prevZ < e.length / 2 + RAMP_LENGTH;
        const enteredRampSide =
          Math.abs(oldX - centerX) >= 1.18 && Math.abs(this.x - centerX) < 1.18;
        if (
          e.id !== this.rampAccessTrainId &&
          rampHeight !== undefined &&
          this.y < rampHeight - 0.12
        ) {
          this.impact(enteredRampSide && besideRamp);
          break;
        }
      }
      if (!nearZ || !nearX) continue;
      if (e.kind === 'coin') {
        if (
          Math.abs(this.x - e.lane * LANE_WIDTH) < 0.75 &&
          Math.abs(this.y + (this.slide > 0 ? 0.45 : 0.9) - e.y) < 0.85
        ) {
          e.z = -1000;
          this.coins++;
          this.onEvent('coin');
        }
      } else {
        const head = this.y + (this.slide > 0 ? 0.65 : 1.7);
        const hitTrain =
          e.kind === 'train' &&
          e.id !== this.rampAccessTrainId &&
          this.y < ROOF_HEIGHT - 0.08 &&
          !(e.ramp && e.z > e.length / 2);
        const hitLow = e.kind === 'low' && this.y < e.y + 0.95 && head > e.y;
        const hitHigh = e.kind === 'high' && head > e.y + 1.05 && this.y < e.y + 2.6;
        if (hitTrain || hitLow || hitHigh) {
          const alreadyAlongside = prevZ < half && prevZ > -half;
          this.impact(enteredFromSide && alreadyAlongside);
          break;
        }
      }
    }
    this.entities = this.entities.filter((e) => e.z > -e.length / 2 - 20);
    if (
      this.rampAccessTrainId !== undefined &&
      !this.entities.some((e) => e.id === this.rampAccessTrainId)
    )
      this.rampAccessTrainId = undefined;
    this.routes = this.routes.filter((r) => r.time > this.elapsed - 5);
    if (this.phase === 'playing') this.generateAhead();
  }
  impact(lateral: boolean) {
    if (!lateral || this.bonkWindow > 0) {
      this.crash();
      return;
    }
    this.bonkWindow = BONK_WINDOW;
    this.bonkFlash = 0.45;
    this.lane = this.moveOrigin;
    this.x = this.moveOrigin * LANE_WIDTH;
    this.onEvent('bonk');
  }
  crash() {
    this.phase = 'over';
    this.onEvent('crash');
  }
}
