import type { DB } from './db';

export function tableNames(db: DB): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
  ).map((r) => r.name);
}

export function countTasks(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number }).n;
}
