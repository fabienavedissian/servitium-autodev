import * as crypto from 'crypto';
import * as fs from 'fs';

export function hashContent(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function hashFile(p: string): string {
  return hashContent(fs.readFileSync(p));
}
