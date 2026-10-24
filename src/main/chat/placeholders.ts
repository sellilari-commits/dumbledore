/**
 * Placeholder texts of the AI chat inputs we write into, for the helper's chat-input finder
 * (`ax.findChatInput`; the OCR fallback looks for these on screen). Lower-case substrings.
 */
export const CHAT_INPUT_PLACEHOLDERS: string[] = [
  // ChatGPT (web + app)
  'ask anything',
  'message chatgpt',
  // Claude
  'reply to claude',
  'how can i help you today',
  'write your prompt to claude',
  // Gemini
  'ask gemini',
  'enter a prompt here',
  // Perplexity
  'ask a follow-up',
  'ask anything…',
  // Copilot, Le Chat, DeepSeek, Grok
  'message copilot',
  'ask le chat',
  'message deepseek',
  'what do you want to know',
]
