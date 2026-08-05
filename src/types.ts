export interface Shortcut {
  label: string;
  key: string;
}

export interface ShortcutGroup {
  name: string;
  items: Shortcut[];
}

export interface Config {
  token: string;
  relay: {
    port: number;
    host: string;
    webUser?: string;
    webPass?: string;
    shortcuts?: ShortcutGroup[];
  };
  agent: {
    serverUrl: string;
  };
}

export interface AgentInfo {
  id: string;
  status: 'alive' | 'disconnected';
  lastSeen: number;
  command?: string;
  cwd?: string;
  ip?: string;
  hostname?: string;
}

export type SkillRoot = 'codex' | 'agents';
