/**
 * Errors surfaced by helper clients. JSON-RPC errors from the Swift helper keep their code
 * (see HelperErrorCode); transport problems use the extra codes below.
 */
import { HelperErrorCode } from '@shared/helper-protocol'

/** Client-side codes for failures that never reached (or never came back from) the helper. */
export const HelperClientErrorCode = {
  /** The helper is not connected (starting, restarting or stopped). */
  notConnected: -32010,
  /** The connection dropped while the call was in flight. */
  disconnected: -32011,
  /** The helper answered with a result that does not match the protocol. */
  invalidResult: -32012,
} as const

export class HelperRpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'HelperRpcError'
    this.code = code
    this.data = data
  }

  get isTimeout(): boolean {
    return this.code === HelperErrorCode.timeout
  }

  get isPermissionDenied(): boolean {
    return this.code === HelperErrorCode.permissionDenied
  }

  get isSecureInput(): boolean {
    return this.code === HelperErrorCode.secureInput
  }

  get isConnectionError(): boolean {
    return (
      this.code === HelperClientErrorCode.notConnected ||
      this.code === HelperClientErrorCode.disconnected
    )
  }
}

export function isHelperRpcError(error: unknown): error is HelperRpcError {
  return error instanceof HelperRpcError
}
