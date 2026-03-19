/**
 * Cursor 飞书集成主模块
 *
 * 使用方式：
 * ```typescript
 * import { createFeishuService } from 'cursor-feishu'
 *
 * const service = await createFeishuService({
 *   config: { appId: '...', appSecret: '...' },
 *   onMessage: async (msg) => {
 *     // 处理消息
 *   }
 * })
 *
 * // 等待服务运行
 * await service.run()
 * ```
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import * as Lark from "@larksuiteoapi/node-sdk"
import { z } from "zod"
import type { ResolvedConfig, LogFn, FeishuMessageContext, GatewayHandlers } from "./types.js"
import { FeishuConfigSchema } from "./types.js"
import { startFeishuGateway, type FeishuGatewayResult } from "./feishu/gateway.js"
import { createSender, type FeishuSender } from "./feishu/sender.js"

const SERVICE_NAME = "cursor-feishu"
const LOG_PREFIX = "[feishu]"
const isDebug = !!process.env.FEISHU_DEBUG

export interface FeishuServiceOptions {
  /** 飞书配置，可从 ~/.config/cursor/plugins/feishu.json 自动加载 */
  config?: Partial<ResolvedConfig>
  /** 消息处理回调 */
  onMessage?: (msgCtx: FeishuMessageContext) => Promise<void>
  /** Bot 入群回调 */
  onBotAdded?: (chatId: string) => Promise<void>
  /** 卡片交互回调 */
  onCardAction?: (action: any) => Promise<void>
  /** 自定义日志函数 */
  log?: LogFn
}

export interface FeishuService {
  /** 启动并运行服务 */
  run: () => Promise<void>
  /** 关闭服务 */
  shutdown: () => Promise<void>
  /** 获取 Feishu 消息发送器 */
  getSender: () => FeishuSender
  /** 获取 Lark SDK 客户端 */
  getClient: () => InstanceType<typeof Lark.Client>
}

/**
 * 创建 Cursor 飞书集成服务
 */
export async function createFeishuService(options: FeishuServiceOptions): Promise<FeishuService> {
  const { config: partialConfig, onMessage, onBotAdded, onCardAction, log: customLog } = options

  // 日志函数
  const log: LogFn = customLog || ((level, message, extra) => {
    const prefixed = `${LOG_PREFIX} ${message}`
    if (isDebug) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        service: SERVICE_NAME,
        level,
        message: prefixed,
        ...extra,
      }))
    } else if (level === "error" || level === "warn") {
      console.error(prefixed, extra || "")
    } else {
      console.log(prefixed, extra || "")
    }
  })

  // 加载配置
  const config = await loadConfig(partialConfig, log)

  // 创建 Lark 客户端
  const larkClient = new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: Lark.Domain.Feishu,
    appType: Lark.AppType.SelfBuild,
  })

  // 获取 bot open_id
  const botOpenId = await fetchBotOpenId(larkClient, log)

  // 创建消息发送器
  const sender = createSender(larkClient, log)

  // 网关
  let gateway: FeishuGatewayResult | null = null

  // 创建处理器
  const handlers: GatewayHandlers = {
    onMessage,
    onBotAdded,
    onCardAction,
  }

  log("info", "飞书服务已初始化", {
    appId: config.appId.slice(0, 8) + "...",
    botOpenId,
  })

  return {
    async run() {
      try {
        gateway = await startFeishuGateway({
          config,
          larkClient,
          botOpenId,
          handlers,
          log,
        })
        log("info", "飞书服务已启动")
        // 保持运行
        await new Promise(() => {})
      } catch (err) {
        log("error", "启动飞书服务失败", {
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },

    async shutdown() {
      if (gateway) {
        await gateway.shutdown()
      }
      log("info", "飞书服务已关闭")
    },

    getSender() {
      return sender
    },

    getClient() {
      return larkClient
    },
  }
}

/**
 * 加载配置
 */
async function loadConfig(
  partialConfig: Partial<ResolvedConfig> | undefined,
  log: LogFn,
): Promise<ResolvedConfig> {
  if (partialConfig && partialConfig.appId && partialConfig.appSecret) {
    // 使用传入的配置
    return FeishuConfigSchema.parse({
      appId: partialConfig.appId,
      appSecret: partialConfig.appSecret,
      ...partialConfig,
    })
  }

  // 从配置文件加载
  const configPath = join(homedir(), ".config", "cursor", "plugins", "feishu.json")
  if (!existsSync(configPath)) {
    throw new Error(
      `缺少飞书配置文件：请创建 ${configPath}，内容为 {"appId":"cli_xxx","appSecret":"xxx"}`,
    )
  }

  try {
    const raw = resolveEnvPlaceholders(JSON.parse(readFileSync(configPath, "utf-8")))
    const config = FeishuConfigSchema.parse(raw)
    return {
      ...config,
      directory: expandDirectoryPath(config.directory || ""),
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      const details = err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")
      throw new Error(`${LOG_PREFIX} 配置验证失败:\n${details}`)
    }
    if (err instanceof SyntaxError) {
      throw new Error(`飞书配置文件格式错误：${configPath} 必须是合法的 JSON (${err.message})`)
    }
    throw err
  }
}

/**
 * 展开目录路径中的环境变量和 ~ 前缀
 */
function expandDirectoryPath(dir: string): string {
  if (!dir) return dir
  if (dir.startsWith("~")) {
    dir = join(homedir(), dir.slice(1))
  }
  dir = dir.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
    const val = process.env[name]
    if (val === undefined) {
      throw new Error(`环境变量 ${name} 未设置（directory 引用了 \${${name}}）`)
    }
    return val
  })
  return dir
}

/**
 * 递归替换对象中字符串值里的 ${ENV_VAR} 占位符
 */
function resolveEnvPlaceholders(obj: unknown): unknown {
  if (typeof obj === "string") {
    if (!obj.includes("${")) return obj
    return obj.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
      const val = process.env[name]
      if (val === undefined) {
        throw new Error(`环境变量 ${name} 未设置（配置值引用了 \${${name}}）`)
      }
      return val
    })
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvPlaceholders)
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvPlaceholders(value)
    }
    return result
  }
  return obj
}

/**
 * 获取 bot 自身的 open_id
 */
async function fetchBotOpenId(
  larkClient: InstanceType<typeof Lark.Client>,
  log: LogFn,
): Promise<string> {
  const res = await larkClient.request<{ bot?: { open_id?: string } }>({
    url: "https://open.feishu.cn/open-apis/bot/v3/info",
    method: "GET",
  })
  const openId = res?.bot?.open_id
  if (!openId) {
    throw new Error("Bot open_id 为空，无法启动飞书服务")
  }
  log("info", "Bot open_id 获取成功", { openId })
  return openId
}

export type { ResolvedConfig, LogFn, FeishuMessageContext } from "./types.js"
export { startFeishuGateway } from "./feishu/gateway.js"
export { createSender } from "./feishu/sender.js"
