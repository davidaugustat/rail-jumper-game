import { districtAt, type DistrictId } from './map';

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
export type RouteSurface = 'ground' | 'ramp' | 'roof';
export type RouteAction = 'jump' | 'duck';
export interface Route {
  time: number;
  safe: number;
  rooftop: boolean;
  lane: number;
  surface: RouteSurface;
  action?: RouteAction;
  family: EncounterFamily;
  encounter: number;
}

export const ENCOUNTER_FAMILIES = [
  'open-barriers',
  'mixed-train-row',
  'low-high-fork',
  'jump-slide-chain',
  'staggered-train-weave',
  'two-stage-lane-change',
  'ramp-ascent',
  'roof-obstacles',
  'passing-train-transfer',
  'multi-roof-chain',
  'roof-exit',
  'tunnel-mix',
  'reward-section',
] as const;
export type EncounterFamily = (typeof ENCOUNTER_FAMILIES)[number];

export interface GeneratedEncounter {
  id: number;
  family: EncounterFamily;
  district: DistrictId;
  start: number;
  end: number;
  entryLane: number;
  exitLane: number;
  mirrored: boolean;
  fallback: boolean;
}

interface EntitySpec {
  kind: Kind;
  lane: number;
  time: number;
  options?: Partial<Entity>;
}

interface EncounterDraft extends GeneratedEncounter {
  entities: EntitySpec[];
  steps: Omit<Route, 'family' | 'encounter'>[];
}

const LANES = [-1, 0, 1] as const;
const RECENT_FAMILY_WINDOW = 3;
const INTRO_DISTANCE = 220;
const MAX_CANDIDATE_ATTEMPTS = 4;
const INTRO_FAMILIES: readonly EncounterFamily[] = [
  'open-barriers',
  'mixed-train-row',
  'low-high-fork',
  'two-stage-lane-change',
  'reward-section',
];
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
  encounters: GeneratedEncounter[] = [];
  recentFamilies: EncounterFamily[] = [];
  encounterIndex = 0;
  rejectedCandidates = 0;
  fallbackCount = 0;
  candidateFilter?: (encounter: GeneratedEncounter) => boolean;
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
    this.encounters = [];
    this.recentFamilies = [];
    this.encounterIndex = 0;
    this.rejectedCandidates = 0;
    this.fallbackCount = 0;
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
    const spacing = 2.4 + this.random() * 1.8;
    const inset = 1.5 + this.random() * 2;
    for (let offset = -train.length / 2 + inset; offset < train.length / 2; offset += spacing) {
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
      for (let d = 1.5 + this.random(); d < RAMP_LENGTH; d += 1.7 + this.random() * 0.8)
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
  private choose<T>(values: readonly T[]): T {
    return values[Math.min(values.length - 1, Math.floor(this.random() * values.length))];
  }
  private routeStep(
    time: number,
    lane: number,
    surface: RouteSurface = 'ground',
    action?: RouteAction,
  ): Omit<Route, 'family' | 'encounter'> {
    return { time, safe: lane, lane, surface, rooftop: surface !== 'ground', action };
  }
  private addCoinPattern(
    draft: EncounterDraft,
    lane: number,
    time: number,
    pattern: number,
    baseY = 1,
    extra = 0,
  ) {
    const count = [1, 3, 5, 4, 6][pattern % 5];
    const requestedSpacing = [0, 0.11, 0.16, 0.21, 0.27][pattern % 5];
    const spacing = baseY >= ROOF_HEIGHT ? Math.min(requestedSpacing, 0.11) : requestedSpacing;
    for (let i = 0; i < count; i++) {
      const centered = i - (count - 1) / 2;
      const diagonal =
        pattern % 5 === 2 && baseY < ROOF_HEIGHT
          ? Math.max(-1, Math.min(1, lane + Math.sign(centered)))
          : lane;
      const arc = pattern % 5 === 3 ? Math.sin((Math.PI * (i + 1)) / (count + 1)) * 1.7 : 0;
      draft.entities.push({
        kind: 'coin',
        lane: diagonal,
        time: time + centered * spacing,
        options: { y: baseY + arc, extra, length: 0.4 },
      });
    }
  }
  private makeDraft(family: EncounterFamily, start: number, attempt: number): EncounterDraft {
    const id = this.encounterIndex;
    const mirrored = this.random() < 0.5;
    const direction = mirrored ? -1 : 1;
    const entry = this.safeLane;
    const adjacent = Math.max(
      -1,
      Math.min(1, entry + (entry === direction ? -direction : direction)),
    );
    const far = LANES.find((lane) => lane !== entry && lane !== adjacent)!;
    const base = start + 0.75;
    const draft: EncounterDraft = {
      id,
      family,
      district: districtAt(distanceAt(base)).id,
      start,
      end: base + 0.25,
      entryLane: entry,
      exitLane: entry,
      mirrored,
      fallback: false,
      entities: [],
      steps: [this.routeStep(start, entry)],
    };
    const train = (lane: number, time: number, options: Partial<Entity> = {}) =>
      draft.entities.push({
        kind: 'train',
        lane,
        time,
        options: {
          length: 13 + this.random() * 7,
          extra: this.random() < 0.55 ? 4 + this.random() * 5 : 0,
          ...options,
        },
      });
    const barrier = (kind: 'low' | 'high', lane: number, time: number, y = 0) =>
      draft.entities.push({ kind, lane, time, options: { y } });

    switch (family) {
      case 'open-barriers': {
        barrier(this.random() < 0.5 ? 'low' : 'high', entry, base);
        draft.steps.push(this.routeStep(base - 0.45, adjacent));
        draft.exitLane = adjacent;
        this.addCoinPattern(draft, adjacent, base, id + attempt);
        break;
      }
      case 'mixed-train-row': {
        train(entry, base, { length: 14, extra: 0 });
        barrier(this.random() < 0.5 ? 'low' : 'high', adjacent, base);
        draft.steps.push(this.routeStep(base - 0.58, far));
        draft.exitLane = far;
        this.addCoinPattern(draft, far, base, id + 1);
        break;
      }
      case 'low-high-fork': {
        const action: RouteAction = this.random() < 0.5 ? 'jump' : 'duck';
        barrier(action === 'jump' ? 'low' : 'high', entry, base);
        train(adjacent, base, { length: 14, extra: 0 });
        barrier(action === 'jump' ? 'high' : 'low', far, base);
        draft.steps.push(
          this.routeStep(base - (action === 'jump' ? 0.34 : 0.22), entry, 'ground', action),
        );
        this.addCoinPattern(
          draft,
          entry,
          base,
          action === 'jump' ? 3 : 1,
          action === 'jump' ? 1.35 : 0.55,
        );
        break;
      }
      case 'jump-slide-chain': {
        barrier('low', entry, base);
        barrier('high', entry, base + 0.88);
        train(adjacent, base + 0.35, { length: 24, extra: 0 });
        barrier('low', far, base + 0.35);
        draft.steps.push(this.routeStep(base - 0.34, entry, 'ground', 'jump'));
        draft.steps.push(this.routeStep(base + 0.46, entry, 'ground', 'duck'));
        draft.end = base + 1.18;
        this.addCoinPattern(draft, entry, base, 3, 1.3);
        break;
      }
      case 'staggered-train-weave': {
        const exit = far;
        train(entry, base, { length: 12, extra: 0 });
        train(adjacent, base + 1.08, { length: 12, extra: 0 });
        draft.steps.push(this.routeStep(base - 0.58, adjacent));
        draft.steps.push(this.routeStep(base + 0.5, exit));
        draft.exitLane = exit;
        draft.end = base + 1.3;
        this.addCoinPattern(draft, adjacent, base, 2);
        this.addCoinPattern(draft, exit, base + 1.08, 1);
        break;
      }
      case 'two-stage-lane-change': {
        train(entry, base, { length: 13, extra: 0 });
        barrier('low', far, base);
        train(adjacent, base + 1.12, { length: 13, extra: 0 });
        barrier('high', entry, base + 1.12);
        draft.steps.push(this.routeStep(base - 0.58, adjacent));
        draft.steps.push(this.routeStep(base + 0.55, far));
        draft.exitLane = far;
        draft.end = base + 1.34;
        this.addCoinPattern(draft, adjacent, base, 1);
        this.addCoinPattern(draft, far, base + 1.12, 2);
        break;
      }
      case 'ramp-ascent': {
        train(adjacent, base + 0.55, { ramp: true, length: 27, extra: 0 });
        train(far, base + 0.55, { length: 22, extra: 0 });
        barrier('high', entry, base + 1.3);
        draft.steps.push(this.routeStep(base - 0.7, adjacent, 'ramp'));
        draft.steps.push(this.routeStep(base + 0.15, adjacent, 'roof'));
        draft.steps.push(this.routeStep(base + 1.45, adjacent));
        draft.exitLane = adjacent;
        draft.end = base + 1.65;
        this.addCoinPattern(draft, adjacent, base + 0.5, 4, ROOF_HEIGHT + 0.9);
        break;
      }
      case 'roof-obstacles': {
        train(adjacent, base + 0.55, { ramp: true, length: 36, extra: 0 });
        train(far, base + 0.55, { length: 31, extra: 0 });
        barrier('low', adjacent, base + 0.7, ROOF_HEIGHT);
        barrier('low', adjacent, base + 1.25);
        barrier('high', far, base + 1.25);
        // The clear lane is the guaranteed route; the ramp and hurdle form a
        // higher-risk roof line with a separate arc of rewards.
        draft.end = base + 1.5;
        this.addCoinPattern(draft, adjacent, base + 0.7, 3, ROOF_HEIGHT + 1.15);
        break;
      }
      case 'passing-train-transfer': {
        const passingSpeed = 7 + this.random() * 2;
        train(adjacent, base + 0.55, { ramp: true, length: 30, extra: 0 });
        train(far, base + 1.18, { length: 38, extra: passingSpeed });
        barrier('low', adjacent, base + 1.65);
        barrier('high', far, base + 1.65);
        // The timed moving-roof line is an optional transfer; the third lane
        // remains the validated route when its approach timing is unfavorable.
        draft.end = base + 2;
        this.addCoinPattern(draft, far, base + 1.12, 4, ROOF_HEIGHT + 0.9, passingSpeed);
        break;
      }
      case 'multi-roof-chain': {
        train(entry, base + 0.55, { ramp: true, length: 32, extra: 0 });
        train(adjacent, base + 1.15, { length: 38, extra: 7 });
        train(far, base + 2.05, { length: 40, extra: 6 });
        barrier('low', entry, base + 1.65);
        barrier('high', adjacent, base + 1.65);
        barrier('high', entry, base + 3.1);
        barrier('low', adjacent, base + 3.1);
        draft.steps.push(this.routeStep(base - 0.7, entry, 'ramp'));
        draft.steps.push(this.routeStep(base + 0.18, adjacent, 'roof', 'jump'));
        draft.steps.push(this.routeStep(base + 1.16, far, 'roof', 'jump'));
        draft.steps.push(this.routeStep(base + 2.85, far));
        draft.exitLane = far;
        draft.end = base + 3.45;
        this.addCoinPattern(draft, adjacent, base + 0.9, 2, ROOF_HEIGHT + 0.9, 7);
        this.addCoinPattern(draft, far, base + 1.9, 4, ROOF_HEIGHT + 0.9, 6);
        break;
      }
      case 'roof-exit': {
        train(adjacent, base + 0.55, { ramp: true, length: 32, extra: 0 });
        train(far, base + 0.55, { length: 26, extra: 0 });
        barrier('low', adjacent, base + 1.2);
        barrier('high', far, base + 1.2);
        // A player can take the ramp and transfer back to this open exit lane,
        // while the contract retains the always-safe ground continuation.
        draft.end = base + 1.5;
        this.addCoinPattern(draft, adjacent, base + 0.35, 4, ROOF_HEIGHT + 0.9);
        this.addCoinPattern(draft, entry, base + 1.55, 0);
        break;
      }
      case 'tunnel-mix': {
        const action: RouteAction = mirrored ? 'jump' : 'duck';
        train(adjacent, base, { length: 22, extra: 0 });
        barrier(action === 'jump' ? 'low' : 'high', entry, base);
        barrier(action === 'jump' ? 'high' : 'low', far, base);
        draft.steps.push(
          this.routeStep(base - (action === 'jump' ? 0.34 : 0.22), entry, 'ground', action),
        );
        draft.end = base + 0.55;
        this.addCoinPattern(
          draft,
          entry,
          base,
          action === 'jump' ? 3 : 1,
          action === 'jump' ? 1.3 : 0.55,
        );
        break;
      }
      case 'reward-section': {
        const rewardLane = adjacent;
        train(entry, base, { length: 13, extra: 0 });
        barrier(attempt % 2 === 0 ? 'low' : 'high', far, base);
        draft.steps.push(this.routeStep(base - 0.58, rewardLane));
        draft.exitLane = rewardLane;
        draft.end = base + 0.95;
        this.addCoinPattern(draft, rewardLane, base - 0.15, id, 1);
        this.addCoinPattern(draft, rewardLane, base + 0.75, id + 3, 1);
        break;
      }
    }
    return draft;
  }
  private pickFamily(time: number): EncounterFamily {
    const distance = distanceAt(time);
    const district = districtAt(distance);
    const allowed = distance < INTRO_DISTANCE ? INTRO_FAMILIES : ENCOUNTER_FAMILIES;
    const choices = allowed.filter((family) => !this.recentFamilies.includes(family));
    const pool = choices.length ? choices : allowed;
    const total = pool.reduce((sum, family) => sum + district.encounterWeights[family], 0);
    let roll = this.random() * total;
    for (const family of pool) {
      roll -= district.encounterWeights[family];
      if (roll <= 0) return family;
    }
    return pool[pool.length - 1];
  }
  private addDraftEntities(draft: EncounterDraft, target: Game = this) {
    for (const spec of draft.entities) target.add(spec.kind, spec.lane, spec.time, spec.options);
  }
  private validateEncounter(draft: EncounterDraft) {
    const simulate = (timingOffset: number) => {
      const start = Math.max(this.elapsed, draft.start - 0.9);
      const verifier = new Game(() => 0.5);
      verifier.phase = 'playing';
      verifier.elapsed = start;
      verifier.distance = distanceAt(start);
      verifier.nextEncounter = Number.POSITIVE_INFINITY;
      verifier.lane = draft.entryLane;
      verifier.x = draft.entryLane * LANE_WIDTH;
      verifier.safeLane = draft.entryLane;
      for (const entity of this.entities) {
        const z =
          entity.z -
          (verifier.distance - this.distance) -
          entity.extra * (verifier.elapsed - this.elapsed);
        if (z > -80 && z < 140) verifier.entities.push({ ...entity, z, id: verifier.nextId++ });
      }
      this.addDraftEntities(draft, verifier);
      const steps = draft.steps
        .filter((step) => step.time + timingOffset >= start - STEP)
        .sort((a, b) => a.time - b.time);
      let cursor = 0;
      const finish = draft.end + timingOffset + 0.35;
      while (verifier.elapsed < finish && verifier.phase === 'playing') {
        while (
          cursor < steps.length &&
          steps[cursor].time + timingOffset <= verifier.elapsed + STEP / 2
        ) {
          const step = steps[cursor++];
          while (verifier.lane !== step.lane) verifier.move(Math.sign(step.lane - verifier.lane));
          if (step.action === 'jump') verifier.jump();
          if (step.action === 'duck') verifier.duck();
        }
        verifier.update(STEP);
      }
      return (
        verifier.phase === 'playing' &&
        verifier.lane === draft.exitLane &&
        verifier.bonkWindow === 0
      );
    };
    return [-0.05, 0, 0.05].every(simulate) && (this.candidateFilter?.(draft) ?? true);
  }
  private fallbackDraft(start: number): EncounterDraft {
    const available = INTRO_FAMILIES.filter((family) => !this.recentFamilies.includes(family));
    const draft = this.makeDraft(available[0] ?? 'reward-section', start, 0);
    draft.fallback = true;
    const blocked = LANES.filter((lane) => lane !== this.safeLane);
    // Both rows leave the contracted lane open, so the fallback stays safe
    // without creating a visually empty section.
    draft.entities = [
      {
        kind: 'train',
        lane: blocked[0],
        time: start + 0.55,
        options: { length: 12, extra: 0 },
      },
      { kind: 'low', lane: blocked[1], time: start + 0.55 },
      { kind: 'high', lane: blocked[0], time: start + 1.2 },
      {
        kind: 'train',
        lane: blocked[1],
        time: start + 1.2,
        options: { length: 12, extra: 0 },
      },
      { kind: 'coin', lane: this.safeLane, time: start + 0.55, options: { y: 1 } },
      { kind: 'coin', lane: this.safeLane, time: start + 1.2, options: { y: 1 } },
    ];
    draft.steps = [this.routeStep(start, this.safeLane)];
    draft.entryLane = draft.exitLane = this.safeLane;
    draft.end = start + 1.6;
    return draft;
  }
  private commitEncounter(draft: EncounterDraft) {
    this.addDraftEntities(draft);
    for (const step of draft.steps)
      this.routes.push({ ...step, family: draft.family, encounter: draft.id });
    this.routes.sort((a, b) => a.time - b.time);
    const encounter: GeneratedEncounter = {
      id: draft.id,
      family: draft.family,
      district: draft.district,
      start: draft.start,
      end: draft.end,
      entryLane: draft.entryLane,
      exitLane: draft.exitLane,
      mirrored: draft.mirrored,
      fallback: draft.fallback,
    };
    this.encounters.push(encounter);
    this.safeLane = draft.exitLane;
    this.recentFamilies.push(draft.family);
    if (this.recentFamilies.length > RECENT_FAMILY_WINDOW) this.recentFamilies.shift();
    this.encounterIndex++;
    this.row++;
    this.nextEncounter = draft.end;
  }
  generateAhead() {
    while (distanceAt(this.nextEncounter) - this.distance < GENERATION_DISTANCE) {
      let accepted: EncounterDraft | undefined;
      for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS; attempt++) {
        const family = this.pickFamily(this.nextEncounter);
        const candidate = this.makeDraft(family, this.nextEncounter, attempt);
        if (this.validateEncounter(candidate)) {
          accepted = candidate;
          break;
        }
        this.rejectedCandidates++;
      }
      if (!accepted) {
        accepted = this.fallbackDraft(this.nextEncounter);
        this.fallbackCount++;
      }
      this.commitEncounter(accepted);
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
