/**
 * The shell core (src/main/shell.ts, no Electron) on top of the real composition, for tests that
 * drive the shell's own flows (SessionFlow → ChatWriter → helper input.write) end to end. The
 * platform and window surfaces are minimal stand-ins.
 */
import type { DisplayInfo } from '../overlay/geometry'
import type { OpenOptions, ShellPlatform, SurfaceControl, WindowSurface } from '../platform'
import { createShellCore, type ShellCore } from '../shell'
import type { Rig } from './test-kit'

export const OWN_PID = 999

export const DISPLAY: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 33, width: 1512, height: 949 },
  primary: true,
}

/** Dumbledore is never the active app here, so ChatWriter writes straight into the chat. */
class TestPlatform implements ShellPlatform {
  readonly ownPid = OWN_PID
  clipboard: string | null = null

  isAppActive(): boolean {
    return false
  }

  hideApp(): void {}

  restoreOverlays(): void {}

  writeClipboard(text: string): void {
    this.clipboard = text
  }

  async sleep(): Promise<void> {}
}

class TestSurfaces implements SurfaceControl {
  readonly opened = new Set<WindowSurface>()

  isOpen(surface: WindowSurface): boolean {
    return this.opened.has(surface)
  }

  async open(surface: WindowSurface, _opts?: OpenOptions): Promise<void> {
    this.opened.add(surface)
  }

  async close(surface: WindowSurface): Promise<void> {
    this.opened.delete(surface)
  }

  pressEnter(): void {}
}

export interface ShellRig {
  core: ShellCore
  platform: TestPlatform
  surfaces: TestSurfaces
}

/** Builds and starts the shell core on the rig's services (call before services.start()). */
export function startShell(rig: Rig): ShellRig {
  const platform = new TestPlatform()
  const surfaces = new TestSurfaces()
  const core = createShellCore(rig.services, {
    platform,
    surfaces,
    version: '0.0.0-test',
    onOverlayChange: () => {},
    onChatDelta: () => {},
    onBusy: () => {},
    onAppStateChange: () => {},
  })
  core.overlay.setDisplays([DISPLAY])
  core.start()
  return { core, platform, surfaces }
}
