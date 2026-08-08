# AGENTS.md — feishu-agent-bridge

## 项目是什么

通用 **飞书 / Lark ↔ 任意 Agent** 的 Node.js 桥接库（npm：`feishu-agent-bridge`）。

只负责：连接、鉴权、消息解析、发送/更新消息、群聊 `@` / `shouldReply`、去重。

**不负责**：Cursor / Kiro / Claude 等具体引擎、会话 resume、cwd、业务命令。

## 与姊妹项目的边界

| 仓库 | 职责 |
|------|------|
| **本仓库** | 飞书 bridge（可被任意宿主依赖） |
| [`feishu-coding-agent`](https://github.com/yucheng1207/feishu-coding-agent) | 多引擎宿主（Cursor/Kiro…），依赖本包 |

迭代本仓库时：**不要**把 Cursor/Kiro CLI、session 映射、斜杠命令写进来。

## 关键入口

- `src/index.ts` — `createFeishuService`
- `src/feishu/gateway-ws.ts` — WebSocket 收事件（完整实现）
- `src/feishu/gateway.ts` — HTTP 模式占位（Webhook 由宿主实现）
- `src/feishu/sender.ts` — `sendText` / `sendCard` / `updateMessage`
- `src/feishu/dedup.ts` — message_id 去重
- `src/types.ts` — `FeishuMessageContext` 等

## 传输模式

- `ws`：长连接，推荐本机
- `http`：宿主提供 Webhook 后回调 `onMessage`
- `both`：勿对同一事件重复订阅

## 配置

优先 `~/.config/feishu-agent-bridge/feishu.json`，兼容 `~/.config/cursor/plugins/feishu.json`；也可用 `appId`/`appSecret` 或环境变量占位符。

## 迭代原则

1. 保持 API 稳定：`createFeishuService` / `FeishuMessageContext` / `FeishuSender`
2. 可增强通用能力：真实 HTTP Webhook、流式卡片与 `message_id`、话题 `reply_in_thread`、多媒体/引用、卡片回调接线、`dedupTtl` 与实现打通
3. README 与实现不一致时，以代码为准并同步文档
4. Node ≥ 20，ESM；改完跑 `npm run typecheck` / `npm run build`

## 发布

见 `RELEASING.md`。版本变更后通知依赖方（如 `feishu-coding-agent`）升级。
