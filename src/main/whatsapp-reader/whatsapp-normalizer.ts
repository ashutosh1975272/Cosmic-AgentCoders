import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface RawWhatsAppMessage {
  id: string
  chatId: string
  senderId?: string
  senderName?: string
  text: string
  timestamp: string | number
  fromMe?: boolean
  isGroup?: boolean
}

/**
 * Normalizes raw WhatsApp message data into Orbit's standardized DashboardStoredMessage.
 */
export function normalizeWhatsAppMessage(
  raw: RawWhatsAppMessage,
  _chatId?: string
): DashboardStoredMessage {
  void _chatId
  const ts =
    typeof raw.timestamp === 'number'
      ? (raw.timestamp / 1000).toFixed(6)
      : !isNaN(Number(raw.timestamp))
        ? raw.timestamp
        : (new Date(raw.timestamp).getTime() / 1000).toFixed(6)

  const cleanText = (raw.text || '')
    .replace(/<[^>]+>/g, '')
    .trim()

  return {
    ts,
    user: raw.senderName || (raw.fromMe ? 'You' : 'WhatsApp Contact'),
    text: cleanText,
    source: raw.fromMe ? 'ours' : 'client'
  }
}
