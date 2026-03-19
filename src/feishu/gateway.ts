/**
 * Feishu 事件网关 — 使用 HTTP Webhook 接收飞书事件
 *
 * 注意: cursor-feishu 1.0.x 已弃用 WebSocket 方式，改用 HTTP Webhook。
 * WebSocket 长连接需要 Lark SDK 更高版本支持。
 */

import * as Lark from "@larksuiteoapi/node-sdk"
import type { ResolvedConfig, FeishuMessageContext, LogFn, CardAction, GatewayHandlers } from "../types.js"

export interface FeishuGatewayResult {
  shutdown: () => Promise<void>
}

export interface GatewayOptions {
  config: ResolvedConfig
  larkClient: InstanceType<typeof Lark.Client>
  botOpenId: string
  handlers: GatewayHandlers
  log: LogFn
}

/**
 * 启动飞书事件网关（Webhook 模式）
 *
 * 使用 HTTP Webhook 方式接收飞书事件，而不是 WebSocket。
 * 这是 Lark SDK 原生支持的方式。
 */
export async function startFeishuGateway(options: GatewayOptions): Promise<FeishuGatewayResult> {
  const { config, larkClient, botOpenId, handlers, log } = options

  log("info", "启动飞书事件网关（Webhook 模式）")

  // 创建事件分发器用于处理飞书 Webhook 回调
  const eventDispatcher = new Lark.EventDispatcher({
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
    encryptKey: process.env.FEISHU_ENCRYPT_KEY,
  })

  // 注册事件处理器
  eventDispatcher.register({
    // 处理消息事件
    "im.message.message_create_v1": async (data: any) => {
      try {
        const event = data.header?.event_id ? data : { detail: { event: data } }
        const message = event.detail?.event?.message || event.message
        if (!message) return

        const msgCtx: FeishuMessageContext = {
          chatId: event.detail?.event?.chat_id || event.chat_id,
          messageId: message.message_id,
          messageType: message.message_type,
          content: extractTextContent(message),
          rawContent: message.content || "{}",
          chatType: (event.detail?.event?.chat_type || event.chat_type || "p2p") as "p2p" | "group",
          senderId: event.detail?.event?.sender?.sender_id?.user_id || event.sender?.sender_id?.user_id || "",
          rootId: message.root_id,
          createTime: message.create_time,
          shouldReply: shouldReply(event.detail?.event || event, botOpenId),
        }

        if (handlers.onMessage) {
          await handlers.onMessage(msgCtx)
        }
      } catch (err) {
        log("error", "处理消息事件失败", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },

    // 处理 bot 入群事件
    "im.chat.member_bot_added_v1": async (data: any) => {
      try {
        const event = data.detail?.event || data
        const chatId = event.chat_id
        if (chatId && handlers.onBotAdded) {
          await handlers.onBotAdded(chatId)
        }
      } catch (err) {
        log("error", "处理 bot 入群事件失败", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
  })

  log("info", "飞书事件网关已启动（Webhook 模式）")
  log("warn", "注意: Webhook 模式需要配置飞书应用的回调 URL")
  log("info", "请在飞书开放平台配置: POST http://your-domain/webhook/feishu")

  return {
    shutdown: async () => {
      log("info", "关闭飞书事件网关")
      // HTTP Webhook 无需主动关闭
    },
  }
}

/**
 * 从飞书消息中提取文本内容
 */
function extractTextContent(message: any): string {
  try {
    if (message.message_type === "text") {
      const content = JSON.parse(message.content || "{}")
      return content.text || ""
    }
  } catch {
    // ignore
  }
  return ""
}

/**
 * 判断是否应该回复
 */
function shouldReply(event: any, botOpenId: string): boolean {
  // 单聊总是回复
  if (event.chat_type === "p2p") {
    return true
  }

  // 群聊只有被 @提及 才回复
  const message = event.message
  if (message?.message_type === "text") {
    try {
      const content = JSON.parse(message.content || "{}")
      const text = content.text || ""
      // 检查是否包含 @bot
      return text.includes(`<at user_id="${botOpenId}">`) || text.includes(`<at open_id="${botOpenId}">`)
    } catch {
      // ignore
    }
  }

  return false
}
