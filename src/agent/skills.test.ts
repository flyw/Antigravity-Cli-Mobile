import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listSkills } from './skills';

describe('listSkills', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-mobile-skills-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns skill metadata from nested SKILL.md files', () => {
    const skillDir = path.join(rootDir, 'code-review');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: code-review\ndescription: Review code carefully\n---\n\n# Instructions\n`);

    expect(listSkills(rootDir)).toEqual([
      expect.objectContaining({
        id: 'code-review',
        name: 'code-review',
        description: 'Review code carefully',
        relativePath: 'code-review/SKILL.md'
      })
    ]);
  });

  it('uses the directory name when frontmatter is absent', () => {
    const skillDir = path.join(rootDir, 'plain-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Plain skill\n');

    expect(listSkills(rootDir)[0]).toEqual(expect.objectContaining({
      id: 'plain-skill',
      name: 'plain-skill',
      description: ''
    }));
  });

  it('returns an empty list when the root does not exist', () => {
    expect(listSkills(path.join(rootDir, 'missing'))).toEqual([]);
  });

  it('skips oversized skill files', () => {
    const skillDir = path.join(rootDir, 'large-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'x'.repeat(256 * 1024 + 1));

    expect(listSkills(rootDir)).toEqual([]);
  });

  it('follows symlinked skill directories', () => {
    const targetDir = path.join(rootDir, 'z-target', 'flyw', 'skills', 'blueprint');
    const linkDir = path.join(rootDir, 'a-flyw-blueprint');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), '---\nname: blueprint\n---\n');
    fs.symlinkSync(targetDir, linkDir, 'dir');

    expect(listSkills(rootDir)).toEqual([
      expect.objectContaining({
        id: 'flyw:blueprint',
        relativePath: 'a-flyw-blueprint/SKILL.md'
      })
    ]);
  });
});
