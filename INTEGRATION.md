# cursor-feishu 与 cursor-agent 集成指南

## 概述

`cursor-feishu` 是一个独立的 npm 包，提供飞书 WebSocket 长连接支持。它可以与 `cursor-agent` 容器化解决方案集成，实现：

1. ✅ 接收飞书消息（支持单聊、群聊）
2. ✅ 调用 cursor-agent 容器执行任务
3. ✅ 将结果发送回飞书
4. ✅ 支持流式响应和消息更新

## 架构

```
飞书应用
    ↓
cursor-feishu WebSocket 长连接
    ↓
Node.js 应用（导入 cursor-feishu）
    ↓
调用 cursor-agent 容器（通过 podman/docker）
    ↓
结果发送回飞书
```

## 快速开始

### 1. 在 cursor-agent 中安装 cursor-feishu

编辑 `Dockerfile`，添加 Node.js 依赖：

```dockerfile
# 安装 Node.js（如果还未安装）
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# 创建工作目录
WORKDIR /opt/cursor-feishu
COPY package.json package-lock.json ./
RUN npm install

COPY . .
```

### 2. 创建应用入口文件

创建 `app.ts` 或 `app.js`：

```typescript
import { createFeishuService } from 'cursor-feishu'
import { execSync } from 'child_process'

const service = await createFeishuService({
  onMessage: async (msgCtx) => {
    console.log(`[${new Date().toISOString()}] 收到消息: ${msgCtx.content}`)

    // 立即发送确认
    await service.getSender().sendText(msgCtx.chatId, '✓ 已收到，正在执行...')

    try {
      // 调用 cursor-agent 容器
      const result = execSync(
        `podman run --rm -e CURSOR_API_KEY=${process.env.CURSOR_API_KEY} ` +
        `-v ${process.cwd()}:/workspace:ro cursor-headless:feishu ` +
        `--trust "${msgCtx.content}"`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      )

      // 将结果发送回飞书
      await service.getSender().sendText(msgCtx.chatId, `✓ 完成\n\n${result}`)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await service.getSender().sendText(msgCtx.chatId, `✗ 错误\n\n${error}`)
    }
  }
})

await service.run()
```

### 3. 配置飞书

创建 `~/.config/cursor/plugins/feishu.json`：

```json
{
  "appId": "${FEISHU_APP_ID}",
  "appSecret": "${FEISHU_APP_SECRET}",
  "timeout": 300000,
  "logLevel": "info"
}
```

### 4. 启动服务

```bash
# 本地测试
export CURSOR_API_KEY=sk-...
export FEISHU_APP_ID=cli_...
export FEISHU_APP_SECRET=...

npm run dev    # 如果配置了 dev 脚本
# 或
node --loader ts-node/esm app.ts
```

## 部署到容器

### 方式 1：多进程容器（不推荐）

直接在 cursor-agent 容器中运行 Node.js 应用处理飞书消息：

```dockerfile
# Dockerfile（修改后）
FROM ubuntu:22.04

# 安装基础工具
RUN apt-get update && apt-get install -y curl git ...

# 安装 Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# 安装 Cursor CLI
RUN curl -fsSL https://... | bash

# 安装 cursor-feishu
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install cursor-feishu

# 启动脚本
COPY app.ts .
CMD ["node", "--loader", "ts-node/esm", "app.ts"]
```

**注意**：这违反了容器设计的单进程原则。

### 方式 2：分离式架构（推荐）

使用现有的 `feishu-bot.py` 作为中间层：

```
飞书 → feishu-bot.py (Python 服务，长期运行)
        ↓
    cursor-agent 容器 (单进程，临时执行)
```

参考 `cursor-agent/docs/feishu/FEISHU-BOT-SETUP.md`。

### 方式 3：使用 cursor-feishu 替代 feishu-bot.py

创建一个独立的 Node.js 服务容器：

```yaml
# docker-compose.yml
version: '3.8'

services:
  cursor-feishu-bot:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - .:/app
      - /var/run/podman/podman.sock:/var/run/podman/podman.sock
    environment:
      - CURSOR_API_KEY=${CURSOR_API_KEY}
      - FEISHU_APP_ID=${FEISHU_APP_ID}
      - FEISHU_APP_SECRET=${FEISHU_APP_SECRET}
      - FEISHU_DEBUG=${FEISHU_DEBUG}
    command: >
      sh -c "
        npm install cursor-feishu &&
        node --loader ts-node/esm app.ts
      "
    restart: always
    networks:
      - default

  cursor-headless:
    image: cursor-headless:feishu
    # 仅在需要时通过 podman run 调用，不作为常驻服务
```

## 与 opencode-feishu 的区别

| 方面 | cursor-feishu | opencode-feishu |
|------|---|---|
| **目标** | Cursor CLI 容器化 | OpenCode 插件系统 |
| **架构** | 独立 npm 包 | OpenCode 插件 |
| **集成方式** | 直接 import 使用 | OpenCode 自动加载 |
| **配置位置** | `~/.config/cursor/plugins/feishu.json` | `~/.config/opencode/plugins/feishu.json` |
| **依赖** | Lark SDK, zod | @opencode-ai/plugin, @opencode-ai/sdk |

## 环境变量参考

```bash
# Cursor API 认证
CURSOR_API_KEY=sk-proj-xxxxx

# Feishu 应用凭证
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 调试模式
FEISHU_DEBUG=1

# 代理（可选）
HTTP_PROXY=http://proxy:8080
HTTPS_PROXY=http://proxy:8080
```

## 完整示例应用

参考 `cursor-agent/docs/feishu/examples/` 目录（如存在）。

## 故障排查

### 问题 1：WebSocket 连接失败

```bash
FEISHU_DEBUG=1 node app.ts 2>&1 | grep -i connection
```

检查：
- 飞书应用凭证是否正确
- 网络是否正常
- 是否启用了长连接方式

### 问题 2：消息无法接收

检查飞书事件订阅：
- `im.message.receive_v1` ✅
- `im.chat.member.bot.added_v1` ✅
- 使用「长连接」而非 Webhook ✅

### 问题 3：调用 cursor-agent 容器失败

```bash
# 验证容器能否执行
podman run --rm cursor-headless:feishu agent --version

# 查看容器日志
podman logs <container-id>
```

## 相关文档

- [cursor-feishu README](./README.md) — API 参考
- [opencode-feishu](https://github.com/NeverMore93/opencode-feishu) — 原型实现
- [cursor-agent 文档](../cursor-agent/README.md) — 容器集成指南
- [Feishu SDK](https://open.feishu.cn/document) — 官方文档
