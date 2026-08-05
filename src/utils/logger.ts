import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = path.join(os.homedir(), '.agent-cli-mobile', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'agent.log');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

export const logger = {
  log: (message: string, ...args: any[]) => {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [INFO] ${message} ${args.map(a => JSON.stringify(a)).join(' ')}\n`;
    logStream.write(formattedMessage);
  },
  error: (message: string, ...args: any[]) => {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [ERROR] ${message} ${args.map(a => JSON.stringify(a)).join(' ')}\n`;
    logStream.write(formattedMessage);
  },
  debug: (message: string, ...args: any[]) => {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [DEBUG] ${message} ${args.map(a => JSON.stringify(a)).join(' ')}\n`;
    logStream.write(formattedMessage);
  }
};

export const getLogPath = () => LOG_FILE;
