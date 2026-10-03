export type OperatorAuditMetadata = { reason: string; reference: string };

export class OperatorAuditCancelledError extends Error {
  constructor() {
    super("Operator action cancelled");
  }
}

export function isOperatorAuditCancelled(error: unknown): boolean {
  return error instanceof OperatorAuditCancelledError;
}
