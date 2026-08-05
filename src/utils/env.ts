import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.agent-cli-mobile');
const ENV_PATH = path.join(CONFIG_DIR, '.env');

export const getEnvPath = () => ENV_PATH;

export const updateEnv = (updates: Record<string, string>) => {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const envPath = ENV_PATH;
  let envVars: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) return;

      const firstEqual = trimmedLine.indexOf('=');
      if (firstEqual !== -1) {
        const key = trimmedLine.slice(0, firstEqual).trim();
        const value = trimmedLine.slice(firstEqual + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key) {
          envVars[key] = value;
        }
      }
    });
  }

  // Apply updates
  Object.assign(envVars, updates);

  // Generate new content
  const newContent = Object.entries(envVars)
    .filter(([key]) => key) // Ensure key is not empty
    .map(([key, val]) => `${key}='${val}'`)
    .join('\n');

  fs.writeFileSync(envPath, newContent + '\n');
};
