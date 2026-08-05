这是一份为您量身定制的 **Agent CLI Mobile** 项目完整开发文档。它涵盖了从架构设计到具体实现的全部核心环节。

---

# 🌉 Agent CLI Mobile 开发文档

**Agent CLI Mobile** 是一个将本地交互式命令行工具（如 Antigravity CLI）转换为移动端 Web 聊天界面的中转代理系统。

## 1. 项目简介
Agent CLI Mobile 允许用户在内网机器上运行 CLI 工具，通过云端中转，在任何地方通过浏览器以“对话框”的形式进行实时交互。它通过 PTY（伪终端）技术保证了命令的持续运行与实时输出截获。

## 2. 核心架构
项目采用 **单代码库 (Monorepo-style)** 设计，通过启动参数切换身份：
-   **Agent (客户端)**: 运行在内网，负责启动并管理本地 PTY 进程。
-   **Relay (服务端)**: 运行在公网，负责数据转发及托管 Web 交互页面。
-   **Web UI**: 运行在用户手机浏览器，将终端流解析为聊天气泡。

---

## 3. 技术栈
-   **语言**: Node.js + TypeScript
-   **终端模拟**: `node-pty` (核心：负责截获和注入命令流)
-   **双向通信**: `Socket.io`
-   **命令行工具**: `commander`
-   **配置解析**: `yaml`
-   **前端显示**: `ansi-to-html` (将终端颜色代码转为 Web 样式)

---

## 4. 配置文件结构 (`agy-mobile.yaml`)
项目默认读取根目录下的配置文件：

```yaml
# 公用安全配置
common:
  token: "secret_agy_mobile_token_123" # 鉴权令牌

# 服务端配置 (Relay)
relay:
  port: 3000
  host: "0.0.0.0"

# 客户端配置 (Agent)
agent:
  server_url: "http://your-vps-ip:3000"
  command: "antigravity" # 本地执行的命令
  args: ["chat"]    # 命令参数
  env:
    API_KEY: "your_antigravity_api_key"
```

---

## 5. 启动方式
编译完成后，通过 `--mode` 参数区分角色。

### 5.1 服务端 (Relay) 启动
```bash
agent-cli-mobile relay start
```

### 5.2 客户端 (Agent) 启动
```bash
agent-cli-mobile agent start
```

---

## 6. 核心逻辑实现说明

### 6.1 PTY 状态管理 (Agent 端)
Agent 启动后，会维持一个长连接。
-   **输出截获**: 使用 `pty.onData` 监听输出，将原始 Buffer 转换为字符串并通过 Socket 发送。
-   **输入注入**: 监听 `socket.on('input')`，将用户在手机端输入的文字（加 `\n`）写入 PTY 写入流。

### 6.2 聊天界面转换逻辑 (Web 端)
传统的终端是黑框，为了实现“聊天感”，Web 端需要进行逻辑封装：
1.  **用户气泡**: 当用户点击发送按钮时，立即在 UI 上生成一个“用户消息”气泡。
2.  **AI 气泡**: 
    *   接收来自 Agent 的流式输出。
    *   如果当前最后一个气泡不是“AI消息”，则新建一个。
    *   持续将接收到的字符追加到最后一个 AI 气泡中。
    *   **ANSI 转换**: 使用 `ansi-to-html` 处理类似 `\x1b[32m` 这种终端颜色，让 Web 端能显示高亮。

---

## 7. 关键代码参考 (TypeScript)

### 入口逻辑 (`src/index.ts`)
```typescript
import { Command } from 'commander';
import { runRelay } from './relay';
import { runAgent } from './agent';
import { loadConfig } from './utils/config';

const program = new Command();
program
  .option('-m, --mode <mode>', 'relay or agent')
  .option('-c, --config <path>', 'config file path', 'agy-mobile.yaml')
  .action(async (options) => {
    const config = loadConfig(options.config);
    if (options.mode === 'relay') runRelay(config);
    else runAgent(config);
  });
program.parse();
```

### Agent 核心 (`src/agent/index.ts`)
```typescript
import * as pty from 'node-pty';
import { io } from 'socket.io-client';

export const runAgent = (config: any) => {
  const socket = io(config.agent.server_url, { auth: { token: config.common.token } });

  const ptyProcess = pty.spawn(config.agent.command, config.agent.args, {
    name: 'xterm-color',
    env: { ...process.env, ...config.agent.env }
  });

  // 截获输出并转发给服务器
  ptyProcess.onData((data) => socket.emit('output_stream', data));

  // 接收服务器转发的手机输入
  socket.on('input_cmd', (cmd) => ptyProcess.write(cmd));
};
```

---

## 8. 开发计划 (Roadmap)

### 第一阶段：MVP (最小可行性产品)
- [ ] 基础 `node-pty` 环境搭建。
- [ ] Socket.io 实现 Agent 与 Relay 的基本握手。
- [ ] 实现简单的 HTML 页面显示原始终端输出。

### 第二阶段：UI 优化
- [ ] 集成 `ansi-to-html`，将终端颜色映射至 Web。
- [ ] 实现“聊天气泡”逻辑，自动区分用户发送和系统返回。
- [ ] 适配手机端高度，增加自动滚动到底部功能。

### 第三阶段：增强功能
- [ ] **多会话支持**: 允许一个 Relay 连接多个 Agent。
- [ ] **自动重连**: 处理移动端网络切换导致的 Socket 断开。
- [ ] **历史记录**: Relay 缓存最近 100 条消息，防止刷新页面后聊天记录丢失。

---

## 9. 安全注意事项
1.  **鉴权**: `token` 必须在 Agent 建立连接 and Web 访问时校验，防止内网机器被他人通过公网控制。
2.  **特殊命令处理**: 禁止在 PTY 中通过 Web 注入 `Ctrl+C` 等破坏性控制序列（除非有特殊需求）。

---

这份文档定义了项目的技术边界和开发路径。您可以基于此结构开始编写 `package.json` 并初始化项目。如果您需要具体的 **前端气泡 CSS 样式** 或 **Socket 鉴权代码**，请随时告诉我。
