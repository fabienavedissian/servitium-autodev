import * as fs from 'fs';
import { z } from 'zod';

// A local task source (file-based) so the engine can run end-to-end without GitHub. The GitHub
// issue queue plugs in here later (same shape) once the servitium-api PAT is available.
const LocalTaskSchema = z.object({
  repo: z.string(),
  title: z.string(),
  body: z.string().default(''),
  allowedPaths: z.array(z.string()).default([]),
  hard: z.boolean().default(false),
});

export type LocalTask = z.infer<typeof LocalTaskSchema>;

export function loadLocalTask(file: string): LocalTask {
  const parsed = LocalTaskSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`Invalid local task ${file}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  return parsed.data;
}
