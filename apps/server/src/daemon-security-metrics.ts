import type { DaemonCredentialTransport } from "./daemon-auth";

export type DaemonAuthResult = "accepted" | "rejected";
export type ConnectorRotationMetricState = "pending" | "acked" | "promoted" | "expired" | "cancelled";

export class DaemonSecurityMetrics {
  private readonly authTransport = new Map<DaemonCredentialTransport, number>();
  private readonly authResult = new Map<DaemonAuthResult, number>();
  private readonly connectorRotation = new Map<ConnectorRotationMetricState, number>();

  recordAuth(transport: DaemonCredentialTransport, result: DaemonAuthResult): { transportTotal: number; resultTotal: number } {
    const transportTotal = (this.authTransport.get(transport) ?? 0) + 1;
    const resultTotal = (this.authResult.get(result) ?? 0) + 1;
    this.authTransport.set(transport, transportTotal);
    this.authResult.set(result, resultTotal);
    return { transportTotal, resultTotal };
  }

  recordRotation(state: ConnectorRotationMetricState): number {
    const total = (this.connectorRotation.get(state) ?? 0) + 1;
    this.connectorRotation.set(state, total);
    return total;
  }
}
