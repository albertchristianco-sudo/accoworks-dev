import races from '../data/races.json';
import { nextRace as pickNextRace, raceDay } from '../scripts/next-race.mjs';

export type Race = { name: string; date: string; venue: string };

// The next race on or after build time, or undefined when none is scheduled.
export const nextRace = (): Race | undefined => pickNextRace(races);

export { raceDay };
