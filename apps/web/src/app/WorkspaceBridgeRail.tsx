import { ArrowUpRight, Network } from "lucide-react";
import type { WorkspaceSpatialScene } from "../workspaceSpatial";

export function WorkspaceBridgeRail({
  scene,
  selectedId,
  onInspect,
  onConnections,
}: {
  scene: WorkspaceSpatialScene;
  selectedId: string | null;
  onInspect: (id: string) => void;
  onConnections: () => void;
}) {
  return (
    <section
      className="spatial-connection-rail"
      aria-label="Direct Workspace Bridge relationships"
    >
      <div className="spatial-connection-origin">
        <Network size={14} />
        <div>
          <strong>
            Bridges <b>{scene.bridges.length}</b>
          </strong>
        </div>
      </div>
      <div className="spatial-connection-peers">
        {scene.bridges.length === 0 && <p>No active Workspace Bridges</p>}
        {scene.bridges.map((bridge) => {
          const direction =
            bridge.direction === "bidirectional"
              ? "↔"
              : bridge.record.workspaceAId === scene.current.id
                ? "→"
                : "←";
          return (
            <button
              type="button"
              key={bridge.id}
              className={selectedId === bridge.id ? "selected" : ""}
              onClick={() => onInspect(bridge.id)}
              aria-label={`Inspect Bridge with ${bridge.peerWorkspaceName}`}
              aria-pressed={selectedId === bridge.id}
              title={`${bridge.peerWorkspaceName} · ${bridge.flowing ? "Communicating" : "Connected"} · ${bridge.direction === "bidirectional" ? "Two-way" : direction === "→" ? "Outbound" : "Inbound"}`}
            >
              <span className="spatial-connection-connector" aria-hidden="true">
                {direction}
              </span>
              <strong>{bridge.peerWorkspaceName}</strong>
              <i
                className={`spatial-connection-status${bridge.flowing ? " live" : ""}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      {scene.bridges.length > 0 && (
        <button
          className="spatial-connection-expand"
          type="button"
          onClick={onConnections}
        >
          Connections
          <ArrowUpRight size={14} />
        </button>
      )}
    </section>
  );
}
