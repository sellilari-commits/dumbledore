/**
 * `npm run dev`: starts the Swift helper from this terminal, then the app with
 * DUMBLEDORE_HELPER=external so it only connects.
 *
 * macOS gives a process the Screen Recording and Accessibility grants of the app it was started
 * from. A helper spawned by the dev Electron app gets Electron's (none); started here it gets the
 * terminal's (the Claude app's, or Terminal's), so OCR works in dev without a new grant. The
 * helper exits with this script (--parent-pid) and is restarted if it crashes.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dataDir =
  process.env.DUMBLEDORE_DATA_DIR?.trim() ||
  join(homedir(), 'Library', 'Application Support', 'Dumbledore')
const runDir = join(dataDir, 'run')
mkdirSync(runDir, { recursive: true, mode: 0o700 })
const socket = join(runDir, 'helper.sock')
const binary = join(process.cwd(), 'native/helper/build/dumbledore-helper')
if (!existsSync(binary)) {
  console.error('[dev] the helper is not built: run `bash native/helper/build.sh` first')
  process.exit(1)
}

let stopping = false
let helper = null

function startHelper() {
  helper = spawn(binary, ['--socket', socket, '--parent-pid', String(process.pid)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  helper.on('exit', (code, signal) => {
    if (stopping) return
    console.warn(`[dev] helper exited (${signal ?? code}); restarting in 1 s`)
    setTimeout(() => {
      if (!stopping) startHelper()
    }, 1000)
  })
}

startHelper()
const app = spawn('npx', ['electron-vite', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, DUMBLEDORE_HELPER: 'external' },
})

function stop() {
  stopping = true
  helper?.kill('SIGTERM')
  app.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
app.on('exit', (code) => {
  stopping = true
  helper?.kill('SIGTERM')
  process.exit(code ?? 0)
})
