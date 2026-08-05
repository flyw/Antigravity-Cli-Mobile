import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface RemoteSkill {
  id: string;
  name: string;
  description: string;
  relativePath: string;
  updatedAt: number;
  hash: string;
}

const MAX_DEPTH = 4;
const MAX_SKILL_SIZE = 256 * 1024;

const readFrontmatter = (content: string) => {
  if (!content.startsWith('---')) return {};

  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};

  const values: Record<string, string> = {};
  content.slice(3, end).split(/\r?\n/).forEach(line => {
    const separator = line.indexOf(':');
    if (separator === -1) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) values[key] = value;
  });
  return values;
};

export const listSkills = (rootDir: string): RemoteSkill[] => {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];

  const skills: RemoteSkill[] = [];
  const walk = (currentDir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    const skillFile = entries.find(entry => entry.isFile() && entry.name === 'SKILL.md');
    if (skillFile) {
      const skillPath = path.join(currentDir, skillFile.name);
      const stats = fs.statSync(skillPath);
      if (stats.size > MAX_SKILL_SIZE) return;
      const content = fs.readFileSync(skillPath, 'utf8');
      const metadata = readFrontmatter(content);
      const directoryName = path.basename(currentDir);
      const relativePath = path.relative(rootDir, skillPath).split(path.sep).join('/');
      skills.push({
        id: directoryName,
        name: metadata.name || directoryName,
        description: metadata.description || '',
        relativePath,
        updatedAt: stats.mtimeMs,
        hash: crypto.createHash('sha256').update(content).digest('hex')
      });
      return;
    }

    entries
      .filter(entry => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(entry => walk(path.join(currentDir, entry.name), depth + 1));
  };

  walk(rootDir, 0);
  return skills.sort((a, b) => a.id.localeCompare(b.id));
};
