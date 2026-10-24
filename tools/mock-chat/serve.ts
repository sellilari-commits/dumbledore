/**
 * Runs the mock chat page: `npx tsx tools/mock-chat/serve.ts [port]` (default 5199, localhost).
 * Open it with: open -na "Google Chrome" --args --new-window http://127.0.0.1:5199
 * Assert on it with: curl -s http://127.0.0.1:5199/state
 */
import { MOCK_CHAT_PORT, startMockChat } from './server'

const port = Number(process.argv[2] ?? process.env.MOCK_CHAT_PORT ?? MOCK_CHAT_PORT)

startMockChat({ port }).then(
  (server) => {
    console.log(`mock chat on ${server.url} (GET /state for assertions; Ctrl+C to stop)`)
    const stop = () => {
      void server.close().then(() => process.exit(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  },
  (error: unknown) => {
    console.error(`mock chat could not start on port ${port}: ${String(error)}`)
    process.exit(1)
  },
)
