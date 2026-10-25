/**
 * Browser mock of the chat's working steps: with `?work=<ms>` in the URL, `ask.submit` first
 * plays a short tool loop as 'chat.progress' (one step every `ms`, the labels main sends for a
 * roadmap read, a web search and a note update), then streams its reply. Without it, replies
 * stream at once as before.
 */
export const MOCK_STEPS = ['Reading your roadmap…', 'Searching the web…', 'Updating your notes…']

export async function mockWork(params: URLSearchParams, emit: (label: string) => void) {
  const ms = Number(params.get('work')) || 0
  if (ms <= 0) return
  const sleep = () => new Promise((r) => window.setTimeout(r, ms))
  for (const label of MOCK_STEPS) {
    await sleep()
    emit(label)
  }
  await sleep()
}
