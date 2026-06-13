// The veille taxonomy. Empty lanes are ALLOWED (no diversity quota): on a given day the business
// lane may have nothing genuine, and forcing it would manufacture weak ideas. {{slots}} are filled
// from the KB context pack at PLAN time. cadence spreads cost: weekly angles pick a weekday.

export interface SenseAngle {
  key: string;
  label: string;
  weight: number; // priority when the budget truncates the day's angle list
  cadence: 'daily' | 'weekly';
  weekday?: number; // 0=Sun..6=Sat for weekly angles
  queryTemplates: string[];
  freshnessDays: number;
}

export const SENSE_ANGLES: SenseAngle[] = [
  {
    key: 'tech',
    label: 'Tech & engine updates',
    weight: 9,
    cadence: 'daily',
    queryTemplates: [
      '{{games}} dedicated server update changelog',
      'RCON protocol new commands {{games}}',
      'Angular {{year}} new features signals control flow best practices',
      'NestJS {{year}} release migration best practices',
    ],
    freshnessDays: 30,
  },
  {
    key: 'product',
    label: 'Discord & product features',
    weight: 8,
    cadence: 'daily',
    queryTemplates: ['Discord API new feature bot {{year}}', 'Discord bot monetization premium features'],
    freshnessDays: 30,
  },
  {
    key: 'competitor',
    label: 'Competitors',
    weight: 8,
    cadence: 'daily',
    queryTemplates: ['{{competitors}} new feature', 'game server management panel pricing comparison'],
    freshnessDays: 45,
  },
  {
    key: 'game',
    label: 'Candidate games',
    weight: 9,
    cadence: 'daily',
    queryTemplates: [
      'most requested dedicated server admin tools reddit {{year}}',
      'new survival game dedicated server RCON support',
      '{{candidateGames}} server admin pain points',
    ],
    freshnessDays: 45,
  },
  {
    key: 'market',
    label: 'Market & pricing',
    weight: 6,
    cadence: 'weekly',
    weekday: 2,
    queryTemplates: ['game server hosting market trends {{year}}', 'indie game server tooling demand'],
    freshnessDays: 60,
  },
  {
    key: 'business',
    label: 'New business lines',
    weight: 5,
    cadence: 'weekly',
    weekday: 4,
    queryTemplates: ['OVH dedicated server new offer {{year}}', 'managed game hosting opportunity margin'],
    freshnessDays: 60,
  },
  {
    key: 'platform',
    label: 'Platform & regulatory',
    weight: 4,
    cadence: 'weekly',
    weekday: 6,
    queryTemplates: ['Steam dedicated server policy change {{year}}', 'game server EULA anti-cheat requirements'],
    freshnessDays: 90,
  },
];

// Which angles run on a given weekday (daily always; weekly only on their weekday).
export function anglesForDay(weekday: number, all: SenseAngle[] = SENSE_ANGLES): SenseAngle[] {
  return all.filter((a) => a.cadence === 'daily' || a.weekday === weekday);
}
