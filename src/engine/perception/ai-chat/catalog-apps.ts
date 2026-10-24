/**
 * Known desktop AI chat apps without a web app of their own: launchers with an AI chat, local
 * model runners (Ollama front-ends, LM Studio, Jan, Msty …) and multi-provider chat clients.
 *
 * Bundle ids, checked 2026-10-24, come from Homebrew cask uninstall/zap stanzas
 * (formulae.brew.sh/api/cask/<token>.json, token in the comment) or the App Store lookup API
 * (itunes.apple.com/search, "MAS"). Open WebUI and LibreChat run in the browser on localhost and
 * are caught by the composer rules (`composer.ts`), not by an entry here.
 */
import type { AssistantConfig } from './assistants'

export const APP_ASSISTANTS: readonly AssistantConfig[] = [
  // Raycast is a launcher first: only its AI Chat window counts.
  { ...app('raycast-ai', 'Raycast AI', ['com.raycast.macos']), bundleTitle: /\bAI Chat\b/i },
  app('lm-studio', 'LM Studio', ['ai.elementlabs.lmstudio']), // lm-studio
  app('locally-ai', 'Locally AI', ['app.locallyai.Locally']), // MAS
  app('jan', 'Jan', ['jan.ai.app']), // jan
  app('msty', 'Msty', ['app.msty.app', 'com.MstyStudio.app']), // msty, mstystudio
  app('boltai', 'BoltAI', ['co.podzim.boltai-mobile', 'co.podzim.BoltGPT']), // boltai, boltai@1
  app('ollama', 'Ollama', ['com.electron.ollama', 'com.ollama.ollama']), // ollama-app
  app('ollamac', 'Ollamac', ['com.kevinhermawan.Ollamac']), // ollamac
  app('enchanted', 'Enchanted', ['subj.Enchanted']), // MAS
  app('reins', 'Reins', ['dev.ibrahimcetin.reins']), // MAS (Ollama & LM Studio client)
  app('gpt4all', 'GPT4All', ['com.nomic-ai.gpt4all']), // gpt4all
  app('chatbox', 'Chatbox', ['xyz.chatboxapp.app']), // chatbox
  app('cherry-studio', 'Cherry Studio', ['com.kangfenmao.CherryStudio']), // cherry-studio
  app('mindmac', 'MindMac', ['app.mindmac.macos']), // mindmac
  app('chatwise', 'ChatWise', ['app.chatwise']), // chatwise
  app('lobehub', 'LobeHub', ['com.lobehub.lobehub-desktop']), // lobehub
  app('macai', 'macai', ['notfullin.com.macai']), // macai
  app('opencat', 'OpenCat', ['tech.baye.OpenCat']), // opencat
  app('5ire', '5ire', ['com.5ire.5ire']), // 5ire
  app('alma', 'Alma', ['com.yetone.alma']), // alma
  app('sanctum', 'Sanctum', ['ai.sanctum.chat']), // sanctum
  app('chatall', 'ChatALL', ['ai.chatall']), // chatall
  app('sidekick', 'SideKick', ['inc.synth.onit.sidekick']), // onit-sidekick
  app('fello-ai', 'Fello AI', ['com.michallangmajer.HelloAI']), // MAS
  app('private-llm', 'Private LLM', ['ie.numen.personalgpt']), // MAS
]

function app(key: string, name: string, bundleIds: readonly string[]): AssistantConfig {
  return {
    key,
    name,
    bundleIds,
    sites: [],
    textMarkers: [],
    titleMarker: /(?!)/,
    placeholders: [],
    userAlign: null,
  }
}
