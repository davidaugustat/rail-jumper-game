export const DISTRICT_LENGTH = 800;
export const WORLD_LENGTH = DISTRICT_LENGTH * 4;

export type DistrictId = 'outskirts' | 'rail-yard' | 'river' | 'city';

export interface DistrictDefinition {
  id: DistrictId;
  name: string;
  start: number;
  end: number;
  ground: number;
  encounterWeights: Record<string, number>;
}

const allFamilies = (favored: string[]): Record<string, number> =>
  Object.fromEntries(
    [
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
    ].map((family) => [family, favored.includes(family) ? 5 : 1]),
  );

export const DISTRICTS: readonly DistrictDefinition[] = [
  {
    id: 'outskirts',
    name: 'Green outskirts',
    start: 0,
    end: 800,
    ground: 0x91ad7d,
    encounterWeights: allFamilies([
      'open-barriers',
      'low-high-fork',
      'two-stage-lane-change',
      'reward-section',
    ]),
  },
  {
    id: 'rail-yard',
    name: 'Rail yard',
    start: 800,
    end: 1600,
    ground: 0x8f9b91,
    encounterWeights: allFamilies([
      'mixed-train-row',
      'staggered-train-weave',
      'ramp-ascent',
      'roof-exit',
    ]),
  },
  {
    id: 'river',
    name: 'River crossing',
    start: 1600,
    end: 2400,
    ground: 0x7ba6a0,
    encounterWeights: allFamilies([
      'passing-train-transfer',
      'multi-roof-chain',
      'roof-obstacles',
      'reward-section',
    ]),
  },
  {
    id: 'city',
    name: 'City and tunnel corridor',
    start: 2400,
    end: WORLD_LENGTH,
    ground: 0x7c8985,
    encounterWeights: allFamilies([
      'jump-slide-chain',
      'low-high-fork',
      'tunnel-mix',
      'two-stage-lane-change',
    ]),
  },
] as const;

export function wrapWorldDistance(distance: number) {
  return ((distance % WORLD_LENGTH) + WORLD_LENGTH) % WORLD_LENGTH;
}

export function districtAt(distance: number) {
  const wrapped = wrapWorldDistance(distance);
  return DISTRICTS.find((district) => wrapped >= district.start && wrapped < district.end)!;
}
