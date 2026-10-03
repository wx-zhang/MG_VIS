import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { PanelRightClose, X } from "lucide-react";
import type { AppSnapshot } from "@tyr-ai/contracts";
import type { ChannelMemberIndex, TopologyGraphNode } from "../topology";
import { TopologyInspectorDetails, type TopologyInspectorIntent, type TopologyOperatorContext } from "./TopologyInspectorDetails";

type TopologyInspectorProps = {
  node?: TopologyGraphNode;
  open: boolean;
  snapshot: AppSnapshot;
  channelMemberIndex: ChannelMemberIndex;
  intent?: TopologyInspectorIntent | null;
  onRefresh: () => Promise<void>;
  onCreateAgent: (machineId?: string) => void;
  onConnectComputer: () => void;
  onOpenAgentDm: (agentId: string) => Promise<void>;
  onOpenDmChannel: (channelId: string) => void;
  onOpenLiveExecution: (executionId: string) => void;
  onOpenWorkspaceBridge?: (bridgeId: string) => void;
  onCollapse: () => void;
  operatorContext?: TopologyOperatorContext;
};

// Topology 与 Workspace View 共用同一详情容器，配置字段、权限判断和后续维护只保留一份。
export function TopologyInspector({
  node,
  open,
  snapshot,
  channelMemberIndex,
  intent,
  onRefresh,
  onCreateAgent,
  onConnectComputer,
  onOpenAgentDm,
  onOpenDmChannel,
  onOpenLiveExecution,
  onOpenWorkspaceBridge,
  onCollapse,
  operatorContext
}: TopologyInspectorProps) {
  const [width, setWidth] = useState(() => storedInspectorWidth());
  const inspectorStyle = { "--topology-inspector-width": `${width}px` } as CSSProperties;

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    function move(moveEvent: PointerEvent) {
      const next = clampInspectorWidth(startWidth - (moveEvent.clientX - startX));
      setWidth(next);
      window.localStorage.setItem("tyr-topology-inspector-width", String(next));
    }
    function stop() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  return (
    <aside className={`topology-inspector${open ? "" : " collapsed"}`} style={inspectorStyle} aria-hidden={!open}>
      {open && <>
        <button className="topology-inspector-collapse" type="button" title="Collapse details" aria-label="Collapse topology details" onClick={onCollapse}>
          <PanelRightClose size={16} />
        </button>
        <button className="topology-inspector-close" type="button" aria-label="Close topology details" onClick={onCollapse}>
          <X size={16} />
        </button>
        <div className="topology-inspector-resizer" onPointerDown={beginResize} aria-hidden="true" />
        <TopologyInspectorDetails
          node={node}
          snapshot={snapshot}
          channelMemberIndex={channelMemberIndex}
          intent={intent}
          onRefresh={onRefresh}
          onCreateAgent={onCreateAgent}
          onConnectComputer={onConnectComputer}
          onOpenAgentDm={onOpenAgentDm}
          onOpenDmChannel={onOpenDmChannel}
          onOpenLiveExecution={onOpenLiveExecution}
          onOpenWorkspaceBridge={onOpenWorkspaceBridge}
          operatorContext={operatorContext}
        />
      </>}
    </aside>
  );
}

function storedInspectorWidth(): number {
  if (typeof window === "undefined") return 420;
  const parsed = Number(window.localStorage.getItem("tyr-topology-inspector-width"));
  return clampInspectorWidth(Number.isFinite(parsed) ? parsed : 420);
}

function clampInspectorWidth(value: number): number {
  return Math.max(360, Math.min(640, Math.round(value)));
}
