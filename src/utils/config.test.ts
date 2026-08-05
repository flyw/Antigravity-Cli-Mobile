import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const originalEnv = { ...process.env };
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-mobile-config-'));
jest.doMock('./env', () => ({
  getEnvPath: () => path.join(testHome, '.env')
}));
const { getConfig } = require('./config');

describe('getConfig', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, HOME: testHome };
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  it('should return default values when env vars are not set', () => {
    delete process.env['BRIDGE_TOKEN'];
    delete process.env['RELAY_PORT'];
    
    const config = getConfig();
    expect(config.token).toBe('');
    expect(config.relay.port).toBe(3000);
  });

  it('should return values from environment variables', () => {
    process.env['BRIDGE_TOKEN'] = 'custom-token';
    process.env['RELAY_PORT'] = '4000';
    
    const config = getConfig();
    expect(config.token).toBe('custom-token');
    expect(config.relay.port).toBe(4000);
  });
});
