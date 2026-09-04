import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { Config, AgentInfo } from '../types';
import { getConfig } from '../utils/config';
import * as path from 'path';
import Convert from 'ansi-to-html';
import { updateEnv } from '../utils/env';
import * as crypto from 'crypto';
import { hashPassword, verifyPassword } from '../utils/auth';

export const runRelay = (config: Config) => {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 1e8, // 100 MB to prevent socket crash on large output streams
    pingTimeout: 60000,     // 60 seconds to tolerate mobile tab sleep and heavy output
    pingInterval: 25000,
    cors: {
      origin: '*'
    }
  });
  const convert = new Convert();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  // Auth Status API
  app.get('/api/status', (req, res) => {
    // Re-check config to see if .env was deleted
    const currentConfig = getConfig();
    res.json({
      needsSetup: !currentConfig.relay.webUser || !currentConfig.relay.webPass
    });
  });

  // Setup API
  app.post('/api/setup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const token = config.token || crypto.randomBytes(32).toString('hex');
    const hashedPass = hashPassword(password);
    const updates = {
      WEB_USER: username,
      WEB_PASS: hashedPass,
      BRIDGE_TOKEN: token
    };

    updateEnv(updates);
    
    // Update live config object
    config.relay.webUser = username;
    config.relay.webPass = hashedPass;
    config.token = token;

    res.json({ success: true, token });
  });

  // Login API
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === config.relay.webUser && config.relay.webPass && verifyPassword(password, config.relay.webPass)) {
      return res.json({ token: config.token });
    }
    res.status(401).json({ error: 'Invalid credentials' });
  });

  // Shortcuts API
  app.get('/api/shortcuts', (req, res) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token !== config.token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const currentConfig = getConfig();
    res.json(currentConfig.relay.shortcuts);
  });

  app.post('/api/shortcuts', (req, res) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token !== config.token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { shortcuts } = req.body;
    if (!Array.isArray(shortcuts)) {
      return res.status(400).json({ error: 'Invalid shortcuts format' });
    }

    updateEnv({ SHORTCUTS: JSON.stringify(shortcuts) });
    config.relay.shortcuts = shortcuts;
    res.json({ success: true });
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (token === config.token) {
      return next();
    }
    return next(new Error('Authentication error'));
  });

  const agents = new Map<string, { socket: Socket; info: AgentInfo; converter: Convert }>();
  const histories = new Map<string, string[]>();
  const skillRequests = new Map<string, { socket: Socket; agentId: string }>();
  const terminalHistoryRequests = new Map<string, { socket: Socket; agentId: string; timeout: NodeJS.Timeout }>();

  const broadcastAgents = () => {
    const agentList = Array.from(agents.values()).map(a => a.info);
    io.emit('agents_update', agentList);
  };

  io.on('connection', (socket) => {
    const isAgent = socket.handshake.query['role'] === 'agent';

    if (isAgent) {
      const rawAgentId = socket.handshake.query['agentId'];
      const agentId = Array.isArray(rawAgentId) ? String(rawAgentId[0]) : String(rawAgentId);
      const command = String(socket.handshake.query['command'] || '');
      const cwd = String(socket.handshake.query['cwd'] || 'unknown');
      const ip = String(socket.handshake.query['ip'] || 'unknown');
      const hostname = String(socket.handshake.query['hostname'] || '');
      
      if (!agentId || agentId === 'undefined') {
        console.error('Agent connected with invalid ID:', agentId);
        socket.disconnect();
        return;
      }

      console.log(`Agent connected: ${agentId} from ${hostname || ip} at ${cwd}`);
      
      const agentInfo: AgentInfo = {
        id: agentId,
        status: 'alive',
        lastSeen: Date.now(),
        command: command,
        cwd: cwd,
        ip: ip,
        hostname: hostname
      };

      // Each agent gets its own converter to maintain ANSI state
      const agentConverter = new Convert();
      agents.set(agentId, { socket, info: agentInfo, converter: agentConverter });
      
      if (!histories.has(agentId)) {
        console.log(`Initializing new history buffer for agent ${agentId}`);
        histories.set(agentId, []);
      } else {
        console.log(`Agent ${agentId} reconnected, resuming existing history`);
      }
      broadcastAgents();

      socket.on('output_stream', (payload: { agentId: string, data: string }) => {
        const targetId = String(payload.agentId);
        const agent = agents.get(targetId);
        if (agent) {
          const history = histories.get(targetId);
          if (history) {
            history.push(payload.data);
            if (history.length > 5000) history.shift();
          }
          // Broadcast raw data to all web clients
          socket.broadcast.emit('output_stream', { agentId: targetId, data: payload.data });
        } else {
          console.warn(`[History] Warning: Received output for unknown agent ${targetId}`);
        }
      });

      socket.on('upload_res', (payload: { agentId: string, filepath: string, success: boolean, error?: string }) => {
        io.emit('upload_res', payload);
      });

      socket.on('terminal_history_response', (payload: { agentId: string; requestId: string; history: string; error?: string }) => {
        const requestId = String(payload?.requestId || '');
        const request = terminalHistoryRequests.get(requestId);
        if (request && request.agentId === agentId) {
          clearTimeout(request.timeout);
          terminalHistoryRequests.delete(requestId);
          request.socket.emit('terminal_history_response', payload);
        }
      });

      socket.on('skills_list_response', (payload) => {
        const request = skillRequests.get(String(payload?.requestId || ''));
        if (request && request.agentId === agentId) {
          skillRequests.delete(String(payload.requestId));
          request.socket.emit('skills_list_response', payload);
        }
      });

      socket.on('disconnect', () => {
        console.log(`Agent disconnected: ${agentId}`);
        agents.delete(agentId);
        for (const [requestId, request] of skillRequests) {
          if (request.agentId === agentId) skillRequests.delete(requestId);
        }
        for (const [requestId, request] of terminalHistoryRequests) {
          if (request.agentId === agentId) {
            clearTimeout(request.timeout);
            request.socket.emit('terminal_history_response', {
              agentId,
              requestId,
              history: '',
              error: 'Agent disconnected while loading terminal history'
            });
            terminalHistoryRequests.delete(requestId);
          }
        }
        broadcastAgents();
      });
    } else {
      console.log('Web client connected');
      
      const activeAgents = Array.from(agents.values()).map(a => a.info);
      const historyPayload: Record<string, string> = {};
      
      console.log('Building history payload for active agents:', activeAgents.map(a => a.id));

      activeAgents.forEach(info => {
        const agentId = String(info.id);
        const history = histories.get(agentId);
        historyPayload[agentId] = history ? history.join('') : '';
      });

      socket.emit('init_state', {
        agents: activeAgents,
        history: historyPayload,
        shortcuts: config.relay.shortcuts
      });

      socket.on('input_cmd', (payload: { agentId: string, cmd: string }) => {
        const targetId = String(payload.agentId);
        const agent = agents.get(targetId);
        console.log(`[Relay] Input command for ${targetId}: ${JSON.stringify(payload.cmd)}`);
        if (agent && agent.info.status === 'alive') {
          agent.socket.emit('input_cmd', payload.cmd);
        } else {
          console.warn(`[Relay] Agent ${targetId} not found or not alive`);
          socket.emit('error', 'Agent not connected or not alive');
        }
      });

      socket.on('resize_pty', (payload: { agentId: string, cols: number, rows: number }) => {
        const targetId = String(payload.agentId);
        const agent = agents.get(targetId);
        if (agent && agent.info.status === 'alive') {
          agent.socket.emit('resize_pty', { cols: payload.cols, rows: payload.rows });
        }
      });

      socket.on('terminal_history_request', (payload: { agentId: string; requestId: string; lines?: number }) => {
        const targetId = String(payload?.agentId || '');
        const requestId = String(payload?.requestId || '');
        const agent = agents.get(targetId);

        if (!targetId || !requestId || !agent || agent.info.status !== 'alive') {
          socket.emit('terminal_history_response', {
            agentId: targetId,
            requestId,
            history: '',
            error: 'Agent not connected or not alive'
          });
          return;
        }

        const previous = terminalHistoryRequests.get(requestId);
        if (previous) clearTimeout(previous.timeout);

        const timeout = setTimeout(() => {
          const request = terminalHistoryRequests.get(requestId);
          if (!request) return;
          terminalHistoryRequests.delete(requestId);
          request.socket.emit('terminal_history_response', {
            agentId: targetId,
            requestId,
            history: '',
            error: 'Timed out while loading terminal history'
          });
        }, 15000);

        terminalHistoryRequests.set(requestId, { socket, agentId: targetId, timeout });
        agent.socket.emit('terminal_history_request', {
          requestId,
          lines: payload?.lines
        });
      });

      socket.on('file_upload', (payload: { agentId: string, filename: string, data: ArrayBuffer | Buffer, target?: string }) => {
        const targetId = String(payload.agentId);
        const agent = agents.get(targetId);
        if (agent && agent.info.status === 'alive') {
          agent.socket.emit('file_upload', payload);
        } else {
          socket.emit('error', 'Agent not connected or not alive');
        }
      });

      socket.on('skills_list_request', (payload: { agentId: string, requestId: string, root: 'codex' | 'agents' }) => {
        if (!payload?.agentId || !payload.requestId || !['codex', 'agents'].includes(payload.root)) {
          socket.emit('skills_list_response', {
            requestId: payload?.requestId,
            agentId: payload?.agentId,
            skills: [],
            error: 'Invalid skills request'
          });
          return;
        }
        const targetId = String(payload.agentId);
        const agent = agents.get(targetId);
        if (agent && agent.info.status === 'alive') {
          skillRequests.set(payload.requestId, { socket, agentId: targetId });
          agent.socket.emit('skills_list_request', {
            requestId: payload.requestId,
            root: payload.root
          });
        } else {
          socket.emit('skills_list_response', {
            requestId: payload.requestId,
            agentId: targetId,
            skills: [],
            error: 'Agent not connected or not alive'
          });
        }
      });

      socket.on('disconnect', () => {
        for (const [requestId, request] of skillRequests) {
          if (request.socket === socket) skillRequests.delete(requestId);
        }
        for (const [requestId, request] of terminalHistoryRequests) {
          if (request.socket === socket) {
            clearTimeout(request.timeout);
            terminalHistoryRequests.delete(requestId);
          }
        }
      });
    }
  });

  const { port, host } = config.relay;
  httpServer.listen(port, host, () => {
    console.log('-------------------------------------------');
    console.log(`Relay server [v1.0.1] running at http://${host}:${port}`);
    console.log('-------------------------------------------');
  });
};
