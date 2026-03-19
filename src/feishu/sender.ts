/**
 * 飞书消息发送 — 向飞书用户/群组发送消息
 */

import * as Lark from "@larksuiteoapi/node-sdk"
import type { LogFn } from "../types.js"

export interface SenderOptions {
  larkClient: InstanceType<typeof Lark.Client>
  log: LogFn
}

export class FeishuSender {
  constructor(private larkClient: InstanceType<typeof Lark.Client>, private log: LogFn) {}

  /**
   * 发送文本消息
   */
  async sendText(chatId: string, text: string): Promise<boolean> {
    try {
      const res = await this.larkClient.im.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      })

      const messageId = (res as any)?.data?.message_id
      if (messageId) {
        this.log("info", "消息已发送", { chatId, messageId })
        return true
      } else {
        this.log("error", "发送消息失败", { chatId, response: res })
        return false
      }
    } catch (err) {
      this.log("error", "发送消息异常", {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  /**
   * 发送富文本卡片
   */
  async sendCard(chatId: string, card: any): Promise<boolean> {
    try {
      const res = await (this.larkClient.im.message.create as any)({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chatId,
          msg_type: "interactive",
          card,
        },
      })

      const messageId = (res as any)?.data?.message_id
      if (messageId) {
        this.log("info", "卡片已发送", { chatId, messageId })
        return true
      } else {
        this.log("error", "发送卡片失败", { chatId, response: res })
        return false
      }
    } catch (err) {
      this.log("error", "发送卡片异常", {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  /**
   * 更新消息（用于流式响应）
   */
  async updateMessage(messageId: string, text: string): Promise<boolean> {
    try {
      await this.larkClient.im.message.patch({
        path: {
          message_id: messageId,
        },
        data: {
          content: JSON.stringify({ text }),
        },
      })

      this.log("info", "消息已更新", { messageId })
      return true
    } catch (err) {
      this.log("error", "更新消息异常", {
        messageId,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }
}

export function createSender(
  larkClient: InstanceType<typeof Lark.Client>,
  log: LogFn,
): FeishuSender {
  return new FeishuSender(larkClient, log)
}
