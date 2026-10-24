/**
 * Starts the mock chat page: `npx tsx tools/mock-chat/main.ts [port]` (default 5199).
 * Open it with: open -na "Google Chrome" --args --new-window http://127.0.0.1:5199
 */
import { startMockChat } from './serve'

const port = Number(process.argv[2] ?? 5199)
void startMockChat({ port }).then((server) => {
  console.log(`mock chat on ${server.url} (GET /state for assertions; Ctrl+C to stop)`)
  process.on('SIGINT', () => {
    void server.close().then(() => process.exit(0))
  })
})
