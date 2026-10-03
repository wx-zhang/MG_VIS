import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  FileUp,
  FileText,
  Folder,
  MessageSquare,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  DEFAULT_RUNTIME_PERMISSION_MODE,
  RUNTIMES,
  isCommunicationAgent,
  runtimePermissionModeAvailable,
  runtimePermissionModeSupported,
  runtimeDisplayName,
  type AgentRecord,
  type AppSnapshot,
  type MachineRecord,
  type ResourceGrantSummary,
  type RuntimeReport,
  type SkillInfo,
  type TyrHeartbeatIntervalUnit,
  type TyrHeartbeatListPayload,
  type TyrHeartbeatRecord,
  type TyrHeartbeatRunRecord,
  type TyrHeartbeatRunStatus,
  type UserRecord,
  type WorkspaceFileNode,
  type WorkspaceRoutingInstructionsRecord,
  type WorkspaceSharedFileListPayload,
  type WorkspaceSharedFilePermission,
  type WorkspaceSharedFileRecord
} from "@tyr-ai/contracts";
import {
  agentLastErrorSummary,
  agentLifecycleWarning,
  agentMachineSummary,
  agentOwnerLabel,
  agentProfileApplyState,
  agentProfileDraft,
  agentProfileDraftChanged,
  agentRuntimeSummary,
  canManageAgentRuntimeView,
  normalizeAgentProfileDraft,
  permissionModeTitle,
  type AgentProfileDraft
} from "../agentProfile";
import { connectCommandPresentation, currentConnectPlatform } from "../connectCommand";
import { fallbackHumanProfile, humanCreatedAgentGroupsForDisplay, humanCreatedAgentsForDisplay, humanProfileApiAllowed, humanProfileFacts, humanRoleActionState, humanServerRole, memberRoleLabel } from "../humanProfile";
import { api, apiErrorMessage, apiForm, authenticatedApiUrl } from "../lib/api";
import { isOperatorAuditCancelled } from "../operatorAudit";
import { agentCanOpenDm, channelDisplayLabel, machineCredentialControlsVisible, machineOwnerControlsVisible, sharedResourceLabel } from "../resourceAccess";
import { runtimeHealthClassName, runtimeHealthLabel } from "../runtimeHealth";
import { AgentRuntimeResourceGrantsEditor, hasPublicRuntimeResourceGrants } from "../AgentRuntimeResourceGrantsEditor";
import { AgentModelSelect, type DetectRuntimeModels } from "../shared/AgentModelSelect";
import { PaginatedAgentActivityTimeline, ReminderList, type AgentActivityTimelineItem } from "../shared/activity";
import { AgentPermissionsPanel } from "../shared/AgentPermissionsPanel";
import { AssistantContactMethodsPanel } from "../shared/AssistantContactMethodsPanel";
import { TyrRoutingInstructionsEditor } from "../shared/TyrRoutingInstructionsEditor";
import { confirmDialog } from "../shared/confirmDialog";
import { Modal, SectionLabel, SelectControl } from "../shared/ui";
import type { ConnectCommandState, HumanMemberProfile, MachineConnectCommand } from "./workspaceTypes";
import { agentStatusLabel, avatarSeed, copyMessageText, liveStatusLabel, memberProfileDate, relativeTime, statusDot } from "./workspaceUtils";
import { topologyInspectorModelForNode } from "./topologyInspectorDetailsModel";
import { agentVisibleInTopology, type ChannelMemberIndex, type TopologyAgentLiveWork, type TopologyGraphNode } from "../topology";
import { topologyLiveExecutionLabel, topologyLiveExecutionTone } from "../topologyLiveWork";
import { primaryTopologyLiveActivity, topologyLiveActivityLabel, topologyLiveActivityTone } from "../livingTopologyActivity";
import { DeviceDetailPanel } from "./DeviceDetailPanel";
import { ConnectCommandPanel } from "./ConnectCommandPanel";

type Props = {
  node?: TopologyGraphNode;
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
  onOpenAgentHistoryItem?: (item: AgentActivityTimelineItem) => void;
  operatorContext?: TopologyOperatorContext;
};

type TyrHeartbeatPanelContext = {
  records: TyrHeartbeatRecord[];
  runs: TyrHeartbeatRunRecord[];
  create: (input: { title: string; instruction: string; intervalUnit: TyrHeartbeatIntervalUnit; intervalValue: number }) => Promise<void>;
  update: (heartbeatId: string, input: Partial<Pick<TyrHeartbeatRecord, "title" | "instruction" | "intervalUnit" | "intervalValue" | "enabled">>) => Promise<void>;
  refresh: () => Promise<void>;
};

type SharedFileAssignmentInput = { agentId: string; permission: WorkspaceSharedFilePermission };

export type WorkspaceSharedFilesPanelContext = {
  records: WorkspaceSharedFileRecord[];
  create: (file: File, assignments: SharedFileAssignmentInput[]) => Promise<void>;
  update: (fileId: string, input: { name: string; assignments: SharedFileAssignmentInput[] }) => Promise<void>;
  replace: (fileId: string, expectedVersion: number, file: File) => Promise<void>;
  replaceOriginal: (fileId: string, expectedVersion: number, file: File) => Promise<void>;
  reset: (fileId: string, expectedVersion: number) => Promise<void>;
  remove: (fileId: string) => Promise<void>;
  contentUrl: (fileId: string, inline: boolean, variant?: "original" | "working") => string;
  refresh: () => Promise<void>;
};

export type TopologyOperatorContext = {
  detectRuntimeModels: DetectRuntimeModels;
  updateAgent: (agentId: string, input: Pick<AgentProfileDraft, "displayName" | "description" | "model" | "permissionMode">) => Promise<{
    errorCode?: string; restartRequired?: boolean; startSent?: boolean; profileApplyDeferred?: boolean;
  }>;
  runAgentAction: (agentId: string, action: "start" | "stop" | "restart") => Promise<void>;
  routingInstructions?: {
    load: () => Promise<WorkspaceRoutingInstructionsRecord>;
    save: (input: { instructions: string; expectedRevision: number }) => Promise<WorkspaceRoutingInstructionsRecord>;
  };
  heartbeats?: TyrHeartbeatPanelContext;
  sharedFiles?: WorkspaceSharedFilesPanelContext;
};

export type TopologyInspectorIntent =
  | { key: number; kind: "agent"; id: string; action: "activity" | "workspace" }
  | { key: number; kind: "agent"; id: string; action: "execution"; executionId: string }
  | { key: number; kind: "human"; id: string; action: "resource-access" }
  | { key: number; kind: "device"; id: string; action: "grants" | "details" };

export function TopologyInspectorDetails(props: Props) {
  const model = useMemo(() => topologyInspectorModelForNode({
    node: props.node,
    snapshot: props.snapshot,
    channelMemberIndex: props.channelMemberIndex
  }), [props.node, props.snapshot, props.channelMemberIndex]);
  const row = props.node?.row;

  return (
    <div className="topology-inspector-content">
      <header className={`inspector-detail-head ${model.tone}`}>
        <span className="inspector-pill">{model.badge}</span>
        <InspectorEditableTitle
          model={model}
          target={inspectorTitleTarget(props.node, row, props.snapshot, Boolean(props.operatorContext))}
          onRefresh={props.onRefresh}
        />
        {model.subtitle && <p>{model.subtitle}</p>}
      </header>
      {!props.node && <InspectorEmpty onConnectComputer={props.onConnectComputer} />}
      {props.node?.kind === "server" && <ServerInspector snapshot={props.snapshot} modelSections={model.sections.map((section) => section.id)} operatorContext={props.operatorContext} />}
      {props.node?.kind === "shared-zone" && <SharedZoneInspector snapshot={props.snapshot} modelSections={model.sections.map((section) => section.id)} />}
      {props.node?.kind === "workspace-bridge" && <WorkspaceBridgeInspector node={props.node} modelSections={model.sections.map((section) => section.id)} onOpenWorkspaceBridge={props.onOpenWorkspaceBridge} />}
      {row?.kind === "machine" && (props.operatorContext
        ? <OperatorMachineInspector machine={row.machine} snapshot={props.snapshot} modelSections={model.sections.map((section) => section.id)} />
        : <MachineInspector machine={row.machine} snapshot={props.snapshot} modelSections={model.sections.map((section) => section.id)} onCreateAgent={props.onCreateAgent} onConnectComputer={props.onConnectComputer} onRefresh={props.onRefresh} />)}
      {row?.kind === "agent" && <AgentInspector agent={row.agent} liveWork={props.node?.liveWork} snapshot={props.snapshot} modelSections={model.sections.map((section) => section.id)} intent={props.intent} onOpenAgentDm={props.onOpenAgentDm} onOpenDmChannel={props.onOpenDmChannel} onOpenLiveExecution={props.onOpenLiveExecution} onOpenAgentHistoryItem={props.onOpenAgentHistoryItem} onRefresh={props.onRefresh} operatorContext={props.operatorContext} />}
      {row?.kind === "human" && <HumanInspector human={row.human} snapshot={props.snapshot} rowShared={row.shared} grantSummary={row.grantSummary ?? null} modelSections={model.sections.map((section) => section.id)} intent={props.intent} onRefresh={props.onRefresh} />}
      {row?.kind === "device" && (props.operatorContext
        ? <OperatorDeviceInspector device={row.device} modelSections={model.sections.map((section) => section.id)} />
        : <DeviceInspector device={row.device} snapshot={props.snapshot} modelSections={model.sections.map((section) => section.id)} intent={props.intent} />)}
    </div>
  );
}

type InspectorTitleTarget = {
  kind: "server" | "machine";
  id: string;
  currentName: string;
  canEdit: boolean;
} | null;

function inspectorTitleTarget(node: TopologyGraphNode | undefined, row: TopologyGraphNode["row"] | undefined, snapshot: AppSnapshot, operatorMode: boolean): InspectorTitleTarget {
  if (node?.kind === "server" && snapshot.currentServer) {
    return {
      kind: "server",
      id: snapshot.currentServer.id,
      currentName: snapshot.currentServer.name,
      canEdit: !operatorMode && snapshot.currentServer.role === "owner"
    };
  }
  if (row?.kind === "machine") {
    return {
      kind: "machine",
      id: row.machine.id,
      currentName: row.machine.name,
      canEdit: !operatorMode && machineOwnerControlsVisible(row.machine, snapshot.currentUser.id)
    };
  }
  return null;
}

function InspectorEditableTitle({ model, target, onRefresh }: { model: ReturnType<typeof topologyInspectorModelForNode>; target: InspectorTitleTarget; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(target?.currentName ?? model.title);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setEditing(false);
    setDraft(target?.currentName ?? model.title);
    setMessage("");
  }, [model.title, target?.id, target?.currentName]);

  async function saveName() {
    const nextName = draft.trim();
    if (!target?.canEdit || !nextName || nextName === target.currentName) return;
    setSaving(true);
    setMessage("");
    try {
      const path = target.kind === "server" ? `/api/servers/${target.id}` : `/api/machines/${target.id}`;
      await api(path, { method: "PATCH", body: JSON.stringify({ name: nextName }) });
      setEditing(false);
      setMessage("Name saved.");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? `Rename failed: ${error.message}` : "Rename failed.");
    } finally {
      setSaving(false);
    }
  }

  if (editing && target?.canEdit) {
    return (
      <div className="inspector-title-edit">
        <input
          className="inspector-control"
          maxLength={80}
          value={draft}
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveName();
            if (event.key === "Escape") {
              setDraft(target.currentName);
              setEditing(false);
              setMessage("");
            }
          }}
        />
        <button className="inspector-action-button primary" disabled={saving || !draft.trim() || draft.trim() === target.currentName} onClick={() => void saveName()}><Check size={14} /> Save</button>
        <button className="inspector-action-button" disabled={saving} onClick={() => {
          setDraft(target.currentName);
          setEditing(false);
          setMessage("");
        }}>Cancel</button>
        {message && <span className={message.startsWith("Rename failed") ? "profile-save-message error" : "profile-save-message"}>{message}</span>}
      </div>
    );
  }

  return (
    <>
      <div className="inspector-title-row">
        <h2>{model.title}</h2>
        {target?.canEdit && <button className="inspector-title-icon" aria-label="Edit name" onClick={() => setEditing(true)}><Edit3 size={15} /></button>}
      </div>
      {message && <span className={message.startsWith("Rename failed") ? "profile-save-message error" : "profile-save-message"}>{message}</span>}
    </>
  );
}

function InspectorEmpty({ onConnectComputer }: { onConnectComputer: () => void }) {
  return (
    <section className="inspector-section-card">
      <div className="empty-action-state">
        <Monitor size={28} />
        <b>No node selected</b>
        <p>Select a topology node to inspect configuration, or connect the first Device.</p>
        <button className="inspector-action-button primary" onClick={onConnectComputer}><Plus size={14} /> Connect Device</button>
      </div>
    </section>
  );
}

function WorkspaceBridgeInspector({ node, modelSections, onOpenWorkspaceBridge }: { node: TopologyGraphNode; modelSections: string[]; onOpenWorkspaceBridge?: (bridgeId: string) => void }) {
  const bridge = node.bridge;
  if (!bridge) return null;
  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      <InspectorSection id="workspace-bridge-overview" title="Bridge Overview">
        <FieldGrid fields={[
          ["Status", bridge.status],
          ["Direction", bridge.direction === "bidirectional" ? "Two-way" : "One-way"],
          ["Peer workspace", bridge.peerWorkspaceName],
          ["Scope", bridge.scope]
        ]} />
      </InspectorSection>
      <InspectorSection id="workspace-bridge-permissions" title="Permissions">
        <FieldGrid fields={[
          ["Allowed", bridge.permissions.length ? bridge.permissions.join(", ") : "None"]
        ]} />
      </InspectorSection>
      {onOpenWorkspaceBridge && (
        <button className="inspector-action-button primary" type="button" onClick={() => onOpenWorkspaceBridge(bridge.bridgeId)}>
          <ExternalLink size={13} /> Open Bridge live queue
        </button>
      )}
    </div>
  );
}

function ServerInspector({ snapshot, modelSections, operatorContext }: { snapshot: AppSnapshot; modelSections: string[]; operatorContext?: TopologyOperatorContext }) {
  const currentServer = snapshot.currentServer;

  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      <InspectorSection id="server-overview" title="Workspace Overview">
        <FieldGrid fields={[
          ["Name", currentServer?.name ?? "Current workspace"],
          ["Role", memberRoleLabel(currentServer?.role ?? "member")],
          ["Created", currentServer?.createdAt ? new Date(currentServer.createdAt).toLocaleString() : "Unknown"]
        ]} />
      </InspectorSection>
      <InspectorSection id="server-counts" title="Topology Counts">
        <div className="inspector-stat-grid compact">
          <StatCell label="Devices" value={snapshot.machines.length} />
          <StatCell label="Agents" value={snapshot.agents.filter((agent) => agentVisibleInTopology(agent, snapshot.currentUser.id)).length} />
        </div>
      </InspectorSection>
      {operatorContext?.sharedFiles
        ? <WorkspaceSharedFilesPanel context={operatorContext.sharedFiles} agents={snapshot.agents} />
        : currentServer?.role === "owner" && <OwnerWorkspaceSharedFilesPanel serverId={currentServer.id} agents={snapshot.agents} />}
    </div>
  );
}

function OwnerWorkspaceSharedFilesPanel({ serverId, agents, initialAgentId, uploadOnly = false, onCreated }: { serverId: string; agents: AgentRecord[]; initialAgentId?: string; uploadOnly?: boolean; onCreated?: () => void }) {
  const [records, setRecords] = useState<WorkspaceSharedFileRecord[]>([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const payload = await api<WorkspaceSharedFileListPayload>(`/api/servers/${encodeURIComponent(serverId)}/shared-files`);
      setRecords(payload.files);
      setError("");
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "Shared files could not be loaded."));
    }
  }

  useEffect(() => { void load(); }, [serverId]);

  const context = useMemo<WorkspaceSharedFilesPanelContext>(() => ({
    records,
    create: async (file, assignments) => {
      const form = new FormData();
      form.append("file", file);
      form.append("assignments", JSON.stringify(assignments));
      await apiForm(`/api/servers/${encodeURIComponent(serverId)}/shared-files`, form);
      await load();
      onCreated?.();
    },
    update: async (fileId, input) => {
      await api(`/api/servers/${encodeURIComponent(serverId)}/shared-files/${encodeURIComponent(fileId)}`, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
      await load();
    },
    replace: async (fileId, expectedVersion, file) => {
      const form = new FormData();
      form.append("file", file);
      form.append("expectedVersion", String(expectedVersion));
      await apiForm(`/api/servers/${encodeURIComponent(serverId)}/shared-files/${encodeURIComponent(fileId)}/content`, form, { method: "PUT" });
      await load();
    },
    replaceOriginal: async (fileId, expectedVersion, file) => {
      const form = new FormData();
      form.append("file", file);
      form.append("expectedVersion", String(expectedVersion));
      await apiForm(`/api/servers/${encodeURIComponent(serverId)}/shared-files/${encodeURIComponent(fileId)}/original-content`, form, { method: "PUT" });
      await load();
    },
    reset: async (fileId, expectedVersion) => {
      await api(`/api/servers/${encodeURIComponent(serverId)}/shared-files/${encodeURIComponent(fileId)}/reset`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion })
      });
      await load();
    },
    remove: async (fileId) => {
      await api(`/api/servers/${encodeURIComponent(serverId)}/shared-files/${encodeURIComponent(fileId)}`, { method: "DELETE", body: "{}" });
      await load();
    },
    contentUrl: (fileId, inline, variant = "working") => authenticatedApiUrl(`/api/servers/${encodeURIComponent(serverId)}/shared-files/${encodeURIComponent(fileId)}/content?variant=${variant}${inline ? "&disposition=inline" : ""}`),
    refresh: load
  }), [records, serverId, onCreated]);

  return <>
    {error && <p className="profile-save-message error">{error}</p>}
    {uploadOnly
      ? <div className="agent-workspace-shared-upload">
          <b>Upload a Workspace shared file</b>
          <p className="inspector-note">Choose which Agents can access it. The file will appear in each assigned Agent's <code>shared/</code> folder.</p>
          <WorkspaceSharedFileUpload key={initialAgentId} context={context} agents={agents.filter((agent) => !isCommunicationAgent(agent) && !agent.deletedAt)} initialAgentId={initialAgentId} />
        </div>
      : <WorkspaceSharedFilesPanel context={context} agents={agents} />}
  </>;
}

function OwnerAgentAssignedResourcesPanel({ serverId, agentId, refreshRevision = 0 }: { serverId: string; agentId: string; refreshRevision?: number }) {
  const [records, setRecords] = useState<WorkspaceSharedFileRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<WorkspaceSharedFileListPayload>(`/api/servers/${encodeURIComponent(serverId)}/shared-files`)
      .then((payload) => {
        if (cancelled) return;
        setRecords(payload.files);
        setError("");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(apiErrorMessage(loadError, "Assigned resources could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [serverId, agentId, refreshRevision]);

  return <AgentAssignedResourcesPanel agentId={agentId} records={records} loading={loading} error={error} />;
}

function AgentAssignedResourcesPanel({ agentId, records, loading = false, error = "" }: { agentId: string; records: WorkspaceSharedFileRecord[]; loading?: boolean; error?: string }) {
  const assigned = records.flatMap((file) => {
    const assignment = file.assignments.find((item) => item.agentId === agentId);
    return assignment ? [{ file, permission: assignment.permission }] : [];
  });
  return (
    <InspectorSection id="agent-assigned-resources" title={`Assigned Resources · ${assigned.length}`}>
      <p className="inspector-note">Read-only view of Workspace files assigned to this Agent. Runtime files use the fixed <code>shared/</code> directory.</p>
      {error && <p className="profile-save-message error">{error}</p>}
      {loading && <p className="inspector-note">Loading assigned resources…</p>}
      {!loading && assigned.length === 0 && !error && <p className="inspector-note">No Workspace shared files are assigned.</p>}
      <div className="shared-file-list">
        {assigned.map(({ file, permission }) => (
          <article className="shared-file-card" key={file.id}>
            <header><FileText size={15} /><span><b>{file.name}</b><small>v{file.version} · {formatFileSize(file.sizeBytes)} · {permission === "read-write" ? "Read & write" : "Read only"}</small></span></header>
            <FieldGrid fields={[
              ["Local path", `shared/${file.name}`],
              ["File ID", file.id],
              ["Content type", file.mimeType || "application/octet-stream"]
            ]} />
          </article>
        ))}
      </div>
    </InspectorSection>
  );
}

function assignmentDraft(agents: AgentRecord[], file?: WorkspaceSharedFileRecord): Record<string, WorkspaceSharedFilePermission | ""> {
  const assigned = new Map(file?.assignments.map((assignment) => [assignment.agentId, assignment.permission]));
  return Object.fromEntries(agents.map((agent) => [agent.id, assigned.get(agent.id) ?? ""]));
}

function assignmentList(draft: Record<string, WorkspaceSharedFilePermission | "">): SharedFileAssignmentInput[] {
  return Object.entries(draft).flatMap(([agentId, permission]) => permission ? [{ agentId, permission }] : []);
}

function assignmentSignature(assignments: SharedFileAssignmentInput[]): string {
  return assignments.map((assignment) => `${assignment.agentId}:${assignment.permission}`).sort().join("|");
}

function WorkspaceSharedFilesPanel({ context, agents }: { context: WorkspaceSharedFilesPanelContext; agents: AgentRecord[] }) {
  const childAgents = agents.filter((agent) => !isCommunicationAgent(agent) && !agent.deletedAt);
  return (
    <InspectorAccordion id="server-shared-files" title={`Shared Workspace Files · ${context.records.length}`} defaultOpen>
      <p className="inspector-note">Canonical files are synchronized into each assigned Agent's <code>shared/</code> directory. Read-write changes return after a Runtime turn.</p>
      {context.records.length > 0 && <div className="shared-file-list">
        {context.records.map((file) => <WorkspaceSharedFileCard key={file.id} file={file} agents={childAgents} context={context} />)}
      </div>}
      {context.records.length === 0
        ? <WorkspaceSharedFileUpload context={context} agents={childAgents} />
        : <details className="shared-file-upload-details">
            <summary><Plus size={13} /> Upload another file</summary>
            <WorkspaceSharedFileUpload context={context} agents={childAgents} />
          </details>}
    </InspectorAccordion>
  );
}

function WorkspaceSharedFileUpload({ context, agents, initialAgentId }: { context: WorkspaceSharedFilesPanelContext; agents: AgentRecord[]; initialAgentId?: string }) {
  const [upload, setUpload] = useState<File | null>(null);
  const initialAssignments = () => ({ ...assignmentDraft(agents), ...(initialAgentId ? { [initialAgentId]: "read-write" as const } : {}) });
  const [assignments, setAssignments] = useState<Record<string, WorkspaceSharedFilePermission | "">>(initialAssignments);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadKey, setUploadKey] = useState(0);
  const existingFile = upload && context.records.find((file) => file.name === upload.name);

  useEffect(() => setAssignments((current) => Object.fromEntries(agents.map((agent) => [agent.id, current[agent.id] ?? (agent.id === initialAgentId ? "read-write" : "")]))), [agents, initialAgentId]);

  async function createFile() {
    if (!upload) return;
    setBusy(true);
    setMessage("");
    try {
      await context.create(upload, assignmentList(assignments));
      setUpload(null);
      setAssignments(initialAssignments());
      setUploadKey((value) => value + 1);
      setMessage("Shared file uploaded.");
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setMessage(`Error: ${apiErrorMessage(error, "Shared file upload failed.")}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shared-file-upload">
      <label className="agent-profile-field wide shared-file-picker">
        <span>Upload file</span>
        <span className="shared-file-picker-control">
          <span className="inspector-action-button"><FileUp size={13} /> Choose file</span>
          <small>{upload?.name ?? "No file selected"}</small>
          <input key={uploadKey} type="file" onChange={(event) => setUpload(event.target.files?.[0] ?? null)} />
        </span>
      </label>
      <SharedFileAssignmentsEditor agents={agents} value={assignments} onChange={setAssignments} />
      {existingFile && <p className="inspector-note">{upload.name} is already shared. Open its file card to replace the original file or working copy.</p>}
      <button className="inspector-action-button primary" type="button" disabled={!upload || busy || Boolean(existingFile)} onClick={() => void createFile()}><Plus size={14} /> {busy ? "Uploading" : "Upload shared file"}</button>
      {message && <p className={`profile-save-message${message.startsWith("Error:") ? " error" : ""}`}>{message}</p>}
    </div>
  );
}

function SharedFileAssignmentsEditor({
  agents,
  value,
  onChange
}: {
  agents: AgentRecord[];
  value: Record<string, WorkspaceSharedFilePermission | "">;
  onChange: (value: Record<string, WorkspaceSharedFilePermission | "">) => void;
}) {
  return (
    <div className="shared-file-assignments">
      <span>Agent access</span>
      {agents.map((agent) => (
        <label key={agent.id}>
          <input type="checkbox" checked={Boolean(value[agent.id])} onChange={(event) => onChange({ ...value, [agent.id]: event.target.checked ? "read-write" : "" })} />
          <b>{agent.displayName}</b>
          <SelectControl className="inspector-control" value={value[agent.id] || "read-write"} disabled={!value[agent.id]} onChange={(event) => onChange({ ...value, [agent.id]: event.target.value as WorkspaceSharedFilePermission })}>
            <option value="read-write">Read & write</option>
            <option value="read-only">Read only</option>
          </SelectControl>
        </label>
      ))}
      {agents.length === 0 && <small>No child Agents are available.</small>}
    </div>
  );
}

function WorkspaceSharedFileCard({ file, agents, context }: { file: WorkspaceSharedFileRecord; agents: AgentRecord[]; context: WorkspaceSharedFilesPanelContext }) {
  const [name, setName] = useState(file.name);
  const [assignments, setAssignments] = useState<Record<string, WorkspaceSharedFilePermission | "">>(() => assignmentDraft(agents, file));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const settingsChanged = name.trim() !== file.name
    || assignmentSignature(assignmentList(assignments)) !== assignmentSignature(file.assignments);

  useEffect(() => {
    setName(file.name);
    setAssignments(assignmentDraft(agents, file));
  }, [file.id, file.updatedAt, agents]);

  async function updateFile() {
    setBusy(true);
    setMessage("");
    try {
      await context.update(file.id, { name: name.trim(), assignments: assignmentList(assignments) });
      setMessage("File settings saved.");
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setMessage(`Error: ${apiErrorMessage(error, "Shared file update failed.")}`);
    } finally {
      setBusy(false);
    }
  }

  async function replaceFile(next: File | undefined, variant: "original" | "working") {
    if (!next) return;
    if (variant === "original" && !await confirmDialog({
      title: "Replace original file?",
      description: `The current working copy of ${file.name} will stay unchanged. Future resets will restore this new original file.`,
      confirmText: "Replace original"
    })) return;
    setBusy(true);
    setMessage("");
    try {
      if (variant === "original") {
        await context.replaceOriginal(file.id, file.version, next);
        setMessage("Original file replaced. Working copy unchanged.");
      } else {
        await context.replace(file.id, file.version, next);
        setMessage("Working copy replaced.");
      }
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setMessage(`Error: ${apiErrorMessage(error, `${variant === "original" ? "Original file" : "Working copy"} replacement failed.`)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeFile() {
    if (!await confirmDialog({ title: "Delete shared file?", description: `${file.name} will be removed from every assigned Agent.`, confirmText: "Delete", tone: "danger" })) return;
    setBusy(true);
    try {
      await context.remove(file.id);
    } catch (error) {
      if (isOperatorAuditCancelled(error)) { setBusy(false); return; }
      setMessage(`Error: ${apiErrorMessage(error, "Shared file deletion failed.")}`);
      setBusy(false);
    }
  }

  async function resetFile() {
    if (!await confirmDialog({
      title: "Reset working copy?",
      description: `${file.name} will be replaced with the current original file. Any changes in the working copy will be lost.`,
      confirmText: "Reset",
      tone: "danger"
    })) return;
    setBusy(true);
    setMessage("");
    try {
      await context.reset(file.id, file.version);
      setMessage("Working copy reset to the current original file.");
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setMessage(`Error: ${apiErrorMessage(error, "Shared file reset failed.")}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="shared-file-card">
      <header><FileText size={15} /><span><b>{file.name}</b><small>v{file.version} · {formatFileSize(file.sizeBytes)} · {file.assignments.length} Agents · {file.hasChanges ? "Working differs from original" : "Matches original"}</small></span></header>
      <label className="agent-profile-field wide"><span>File name</span><input className="inspector-control" value={name} maxLength={255} onChange={(event) => setName(event.target.value)} /></label>
      <SharedFileAssignmentsEditor agents={agents} value={assignments} onChange={setAssignments} />
      <div className="shared-file-versions">
        <div className="shared-file-version-row">
          <div className="shared-file-version-description"><b>Original file</b><small>{file.originalName} · {formatFileSize(file.originalSizeBytes)}. Baseline used by Reset; replacing it keeps the working copy unchanged.</small></div>
          <div className="inline-actions shared-file-actions">
            <a className="inspector-action-button" href={context.contentUrl(file.id, true, "original")} target="_blank" rel="noreferrer"><ExternalLink size={13} /> View original</a>
            <a className="inspector-action-button" href={context.contentUrl(file.id, false, "original")}><FileText size={13} /> Download original</a>
            <label className={`inspector-action-button shared-file-replace shared-file-replace-original${busy ? " disabled" : ""}`}><FileUp size={13} /> Replace original<input type="file" aria-label="Replace original file" disabled={busy} onChange={(event) => { const next = event.target.files?.[0]; event.target.value = ""; void replaceFile(next, "original"); }} /></label>
          </div>
        </div>
        <div className="shared-file-version-row">
          <div className="shared-file-version-description"><b>Working copy</b><small>Current content shared with assigned Agents.</small></div>
          <div className="inline-actions shared-file-actions">
            <a className="inspector-action-button" href={context.contentUrl(file.id, true, "working")} target="_blank" rel="noreferrer"><ExternalLink size={13} /> View working</a>
            <a className="inspector-action-button" href={context.contentUrl(file.id, false, "working")}><FileText size={13} /> Download copy</a>
            <label className={`inspector-action-button shared-file-replace${busy ? " disabled" : ""}`}><FileUp size={13} /> Replace working<input type="file" aria-label="Replace working copy" disabled={busy} onChange={(event) => { const next = event.target.files?.[0]; event.target.value = ""; void replaceFile(next, "working"); }} /></label>
            {file.hasChanges && <button className="inspector-action-button danger" type="button" disabled={busy} onClick={() => void resetFile()}><RefreshCw size={13} /> Reset working</button>}
          </div>
        </div>
      </div>
      <div className="inline-actions shared-file-actions shared-file-management-actions">
        <button className="inspector-action-button primary" type="button" disabled={busy || !name.trim() || !settingsChanged} onClick={() => void updateFile()}><Check size={13} /> Save settings</button>
        <button className="inspector-action-button" type="button" disabled={busy} onClick={() => void removeFile()}><Trash2 size={13} /> Delete file</button>
      </div>
      {message && <p className={`profile-save-message${message.startsWith("Error:") ? " error" : ""}`}>{message}</p>}
    </article>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SharedZoneInspector({ snapshot, modelSections }: { snapshot: AppSnapshot; modelSections: string[] }) {
  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      <InspectorSection id="shared-zone-overview" title="Shared Overview">
        <FieldGrid fields={[
          ["Shared devices", snapshot.machines.filter((machine) => machine.access?.shared).length]
        ]} />
      </InspectorSection>
    </div>
  );
}

function DeviceInspector({ device, snapshot, modelSections, intent }: { device: Extract<TopologyGraphNode["row"], { kind: "device" }>["device"]; snapshot: AppSnapshot; modelSections: string[]; intent?: TopologyInspectorIntent | null }) {
  useEffect(() => {
    if (intent?.kind !== "device" || intent.id !== device.id) return;
    scrollInspectorSection("device-detail-panel");
  }, [device.id, intent]);

  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      <div id="device-detail-panel">
        <DeviceDetailPanel device={device} snapshot={snapshot} compact />
      </div>
    </div>
  );
}

function OperatorDeviceInspector({ device, modelSections }: { device: Extract<TopologyGraphNode["row"], { kind: "device" }>["device"]; modelSections: string[] }) {
  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      <InspectorSection id="operator-device-overview" title="Mobile Device">
        <FieldGrid fields={[
          ["Status", device.status],
          ["Platform", device.platform],
          ["App version", device.appVersion || "Unknown"],
          ["Last seen", device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Unknown"]
        ]} />
      </InspectorSection>
    </div>
  );
}

function OperatorMachineInspector({ machine, snapshot, modelSections }: { machine: MachineRecord; snapshot: AppSnapshot; modelSections: string[] }) {
  const runtimes = (machine as MachineRecord & { runtimes?: RuntimeReport[] }).runtimes ?? [];
  const agents = snapshot.agents.filter((agent) => agent.machineId === machine.id);
  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      <InspectorSection id="operator-machine-overview" title="Device Overview">
        <FieldGrid fields={[
          ["Status", machine.status],
          ["Hostname", machine.hostname || "Unknown"],
          ["OS", machine.os || "Unknown"],
          ["Daemon", machine.daemonVersion || "Unknown"],
          ["Agents", String(agents.length)]
        ]} />
      </InspectorSection>
      <InspectorSection id="operator-machine-runtimes" title="Runtime Availability">
        {runtimes.length === 0
          ? <p className="inspector-note">No Runtime report is available.</p>
          : <FieldGrid fields={runtimes.map((runtime) => [runtimeDisplayName(runtime.runtime), runtimeHealthLabel(runtime)])} />}
      </InspectorSection>
    </div>
  );
}

function MachineInspector({ machine, snapshot, modelSections, onCreateAgent, onConnectComputer, onRefresh }: { machine: MachineRecord; snapshot: AppSnapshot; modelSections: string[]; onCreateAgent: (machineId?: string) => void; onConnectComputer: () => void; onRefresh: () => Promise<void> }) {
  const typedMachine = machine as MachineRecord & { runtimes?: RuntimeReport[]; agents?: AgentRecord[] };
  const [connectCommand, setConnectCommand] = useState<ConnectCommandState>({ status: "idle" });
  const [connectCommandCopyStatus, setConnectCommandCopyStatus] = useState("");
  const connectCommandCopyTimerRef = useRef<number | null>(null);
  const [connectCommandHighlight, setConnectCommandHighlight] = useState(false);
  const [machineActionMessage, setMachineActionMessage] = useState("");
  const isOwner = machineOwnerControlsVisible(machine, snapshot.currentUser.id);
  const canViewCredential = machineCredentialControlsVisible(machine, snapshot.currentUser.id);
  const agents = typedMachine.agents ?? snapshot.agents.filter((agent) => agent.machineId === machine.id);
  const latestDaemonVersion = machine.latestDaemonVersion ?? machine.daemonVersion;
  const runtimeBundleStatus = machineRuntimeBundleStatus(machine);
  const runtimeBundleNeedsUpdate = runtimeBundleStatus === "Update required";
  const runtimeUpdateGuidance = runtimeBundleNeedsUpdate;
  const readyConnectCommand = connectCommand.status === "ready" ? connectCommand.command : null;
  const commandPresentation = connectCommandPresentation(readyConnectCommand, import.meta.env.DEV, currentConnectPlatform(), "INSTALL");
  const activeConnectCommand = commandPresentation.command;
  const commandHelp = runtimeUpdateGuidance
    ? "Copy and run this command on the connected device to reinstall tyr-daemon with the current runtime bundle."
    : "Run once on the target device. It installs tyr-daemon locally, then connects this Device.";
  const owner = snapshot.humans.find((human) => human.id === machine.ownerUserId) ?? (snapshot.currentUser.id === machine.ownerUserId ? snapshot.currentUser : undefined);
  const ownerLabel = owner?.displayName ?? "Unknown owner";
  const sharedLabel = sharedResourceLabel(machine);
  const connectCommandStatusText = connectCommand.status === "forbidden"
    ? "Only this Device's owner can view the connect command."
    : connectCommand.status === "unavailable"
      ? "No reusable connect command is available. Rotate the connector token or add a new Device."
      : connectCommand.status === "error"
        ? `Connect command failed: ${connectCommand.error}`
        : "Loading connect command...";

  useEffect(() => () => {
    clearConnectCommandCopyTimer();
  }, []);

  useEffect(() => {
    clearConnectCommandCopyTimer();
    setConnectCommand({ status: "idle" });
    setConnectCommandCopyStatus("");
    setConnectCommandHighlight(false);
    setMachineActionMessage("");
    if (!machine.id) return;
    if (!canViewCredential) {
      setConnectCommand({ status: "forbidden" });
      return;
    }
    let cancelled = false;
    setConnectCommand({ status: "loading" });
    api<MachineConnectCommand>(`/api/machines/${machine.id}/connect-command`)
      .then((data) => {
        if (!cancelled) setConnectCommand({ status: "ready", command: data });
      })
      .catch((error) => {
        if (cancelled) return;
        const code = error instanceof Error ? error.message : String(error);
        setConnectCommand(code === "connector_token_required" ? { status: "unavailable" } : { status: "error", error: code });
      });
    return () => {
      cancelled = true;
    };
  }, [machine.id, canViewCredential]);

  async function machineAction(path: string, init: RequestInit = { method: "POST" }) {
    if (!canViewCredential) return;
    await api(path, init);
    await onRefresh();
  }

  async function resetAllAgents() {
    if (!(await confirmDialog({
      title: `Reset all agents on ${machine.name}?`,
      description: "This restarts their runtime sessions.",
      confirmText: "Reset all agents",
      tone: "danger"
    }))) return;
    await machineAction(`/api/machines/${machine.id}/reset-all`, { method: "POST", body: JSON.stringify({ mode: "restart" }) });
  }

  async function regenerateConnectCommand() {
    if (!isOwner) return;
    let previousConnectCommand = readyConnectCommand;
    let previousCommand = activeConnectCommand;
    clearConnectCommandCopyTimer();
    setConnectCommand({ status: "loading" });
    try {
      if (!previousConnectCommand) {
        try {
          previousConnectCommand = await api<MachineConnectCommand>(`/api/machines/${machine.id}/connect-command`);
          previousCommand = connectCommandPresentation(previousConnectCommand, import.meta.env.DEV, currentConnectPlatform(), "INSTALL").command;
        } catch (error) {
          // A Device without any reusable credential has no old command to compare; other failures remain blocking.
          const code = error instanceof Error ? error.message : String(error);
          if (code !== "connector_token_required") throw error;
        }
      }
      await api(`/api/machines/${machine.id}/connector-token/rotate`, { method: "POST", body: "{}" });
      let command: MachineConnectCommand | null = null;
      let nextCommand: string | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        command = await api<MachineConnectCommand>(`/api/machines/${machine.id}/connect-command`);
        nextCommand = connectCommandPresentation(command, import.meta.env.DEV, currentConnectPlatform(), "INSTALL").command;
        if (nextCommand && (!previousCommand || nextCommand !== previousCommand)) break;
        // HTTP 202 仅表示 rotation 已投递；等待 daemon 原子落盘并 ACK 后再展示新命令。
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (!command || !nextCommand || (previousCommand && nextCommand === previousCommand)) {
        throw new Error("The device did not confirm the new connector token. The existing token remains active.");
      }
      setConnectCommand({ status: "ready", command });
      setConnectCommandHighlight(Boolean(previousCommand && nextCommand));
      setConnectCommandCopyStatus("Connector token regenerated. Copy the full command again.");
      await onRefresh().catch(() => undefined);
    } catch (error) {
      setConnectCommand(previousConnectCommand
        ? { status: "ready", command: previousConnectCommand }
        : { status: "error", error: apiErrorMessage(error) });
      setConnectCommandCopyStatus(`${apiErrorMessage(error)} The previous command remains available for recovery.`);
    }
  }

  async function copyActiveConnectCommand() {
    if (!activeConnectCommand) return;
    await copyMessageText(activeConnectCommand);
    clearConnectCommandCopyTimer();
    setConnectCommandCopyStatus("Connect command copied.");
    // Match message copy feedback: show success briefly, then restore the copy affordance.
    connectCommandCopyTimerRef.current = window.setTimeout(() => setConnectCommandCopyStatus(""), 2200);
  }

  function clearConnectCommandCopyTimer() {
    if (connectCommandCopyTimerRef.current !== null) window.clearTimeout(connectCommandCopyTimerRef.current);
    connectCommandCopyTimerRef.current = null;
  }

  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      {isOwner && (
        <div className="machine-action-bar inspector-icon-toolbar" aria-label="Device actions">
          <button className="inspector-icon-action machine-create-action" title="Create Agent" aria-label="Create Agent" onClick={() => onCreateAgent(machine.id)}><Plus size={15} /></button>
          <button className="inspector-icon-action machine-start-action" title="Start All" aria-label="Start All" onClick={() => void machineAction(`/api/machines/${machine.id}/start-all`)}><Play size={15} /></button>
          <button className="inspector-icon-action" title="Stop All" aria-label="Stop All" onClick={() => void machineAction(`/api/machines/${machine.id}/stop-all`)}><Square size={15} /></button>
          <button className="inspector-icon-action" title="Restart All" aria-label="Restart All" onClick={() => void machineAction(`/api/machines/${machine.id}/restart-all`)}><RefreshCw size={15} /></button>
          <button className="inspector-icon-action machine-danger-action" title="Reset All" aria-label="Reset All" onClick={() => void resetAllAgents()}><AlertTriangle size={15} /></button>
        </div>
      )}
      {runtimeBundleNeedsUpdate && <div className="agent-runtime-warning compact"><AlertTriangle size={13} /><span>Runtime bundle update required</span></div>}
      {machineActionMessage && <p className="inspector-action-feedback" role="status">{machineActionMessage}</p>}
      <InspectorSection id="machine-info" title="Daemon and Host">
        <FieldGrid fields={[
          ["Name", machine.name],
          ["Owner", ownerLabel],
          ["Shared", sharedLabel || "Not shared"],
          ["Status", liveStatusLabel(machine.status)],
          ["Hostname", machine.hostname],
          ["Operating system", machine.os],
          ["Daemon version", machine.daemonVersion || "Unknown"],
          ["Latest version", `${latestDaemonVersion || "Unknown"}${latestDaemonVersion !== machine.daemonVersion ? " · update available" : " · up to date"}`],
          ["Runtime bundle", shortRuntimeSha(machine.runtimeSha)],
          ["Expected bundle", shortRuntimeSha(machine.latestRuntimeSha)],
          ["Bundle status", runtimeBundleStatus],
          ["Created", new Date(machine.createdAt).toLocaleString()],
          ["Last seen", machine.lastSeenAt ? new Date(machine.lastSeenAt).toLocaleString() : "Never"]
        ]} />
      </InspectorSection>
      <InspectorSection id="machine-agents" title={`Agents On This Device (${agents.length})`}>
        {agents.length === 0 && <p className="inspector-note">No agents are attached to this Device.</p>}
        <div className="inspector-agent-grid">
          {agents.map((agent) => <CompactAgentRow key={agent.id} agent={agent} />)}
        </div>
      </InspectorSection>
      <InspectorSection id="machine-connect-command" title={runtimeUpdateGuidance ? "Update Command" : "Connect Command"}>
        {canViewCredential ? (
          <ConnectCommandPanel
            help={(
              <>
                <p className="inspector-note">{commandHelp}</p>
                {runtimeUpdateGuidance && <p className="inspector-note">Keep the connector token unchanged so this same Device reconnects after the reinstall.</p>}
              </>
            )}
            note={<p className="inspector-note">{runtimeUpdateGuidance ? "After the daemon reconnects, refresh this page. Runtime Bundle Status should change to Up to Date." : "Keep this process running to maintain the connection for this device."}</p>}
            command={activeConnectCommand}
            statusText={connectCommandStatusText}
            credentialKind={readyConnectCommand?.credentialKind}
            credentialUnavailable={connectCommand.status === "unavailable"}
            copyStatus={connectCommandCopyStatus}
            highlightCredential={connectCommandHighlight}
            onCopy={() => void copyActiveConnectCommand()}
            onRegenerate={() => void regenerateConnectCommand()}
          />
        ) : <p className="inspector-note">Bridge operations are enabled, but reusable connector credentials remain visible only to this Device's owner.</p>}
      </InspectorSection>
      <InspectorSection id="machine-runtimes" title="Detected Runtimes">
        <div className="runtime-tags inspector-runtime-tags">
          {RUNTIMES.map((definition) => {
            const runtime = (typedMachine.runtimes ?? []).find((item) => item.runtime === definition.id);
            const report = runtime ?? { runtime: definition.id, displayName: definition.displayName, binary: definition.binary, status: "unavailable" as const, installStatus: "missing" as const };
            return <span key={definition.id} className={runtimeHealthClassName(report)}>{runtimeHealthLabel(report)}</span>;
          })}
        </div>
      </InspectorSection>
      <InspectorAccordion id="machine-actions" title="Danger Zone" defaultOpen={false}>
        {isOwner ? (
          <div className="inspector-danger-callout">
            <p>{agents.length > 0 ? "Remove agents before deleting this Device." : "Permanently remove this Device. Existing chat history stays."}</p>
            <button className="inspector-action-button danger" onClick={async () => {
              if (agents.length > 0) {
                setMachineActionMessage("Remove agents before deleting this Device.");
                return;
              }
              setMachineActionMessage("");
              if (!(await confirmDialog({
                title: `Delete device ${machine.name}?`,
                description: "Existing chat history stays.",
                confirmText: "Delete device",
                tone: "danger"
              }))) return;
              await machineAction(`/api/machines/${machine.id}`, { method: "DELETE" });
            }}><Trash2 size={14} /> Delete Device</button>
          </div>
        ) : <p className="inspector-note">Runtime controls, connector tokens, workspace scans, and deletion are owner-only.</p>}
        {!isOwner && <button className="inspector-action-button" onClick={onConnectComputer}><Plus size={14} /> Add Devices</button>}
      </InspectorAccordion>
    </div>
  );
}

function shortRuntimeSha(value: string | null | undefined): string {
  return value ? value.slice(0, 12) : "Unknown";
}

function machineRuntimeBundleStatus(machine: Pick<MachineRecord, "runtimeSha" | "latestRuntimeSha" | "runtimeUpdateAvailable">): "Current" | "Update required" | "Unknown" {
  if (machine.runtimeUpdateAvailable === true) return "Update required";
  if (!machine.runtimeSha || !machine.latestRuntimeSha) return "Unknown";
  return machine.runtimeSha === machine.latestRuntimeSha ? "Current" : "Update required";
}

function HumanInspector({ human, snapshot, rowShared, grantSummary, modelSections, intent, onRefresh }: { human: UserRecord; snapshot: AppSnapshot; rowShared: boolean; grantSummary: ResourceGrantSummary | null; modelSections: string[]; intent?: TopologyInspectorIntent | null; onRefresh: () => Promise<void> }) {
  const [profile, setProfile] = useState<HumanMemberProfile | null>(null);
  const [error, setError] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  const isSelf = human.id === snapshot.currentUser.id;
  const serverId = snapshot.currentServer?.id ?? "local";
  const currentUserServerRole = snapshot.currentServer?.role ?? "member";
  const canManageServerMembers = currentUserServerRole === "owner";

  useEffect(() => {
    let active = true;
    async function load() {
      setProfile(null);
      setError("");
      if (!humanProfileApiAllowed(human, snapshot.currentUser, currentUserServerRole)) return;
      try {
        const data = await api<HumanMemberProfile>(`/api/servers/${serverId}/members/${human.id}/profile`);
        if (active) {
          setProfile(data);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [currentUserServerRole, human.id, human.membershipVisible, human.serverRole, serverId, snapshot.currentUser.id]);

  const activeProfile: HumanMemberProfile = profile ?? fallbackHumanProfile(human, snapshot.currentUser, currentUserServerRole);
  const profileFacts = humanProfileFacts(activeProfile);
  const roleActions = humanRoleActionState(activeProfile, snapshot.currentUser, snapshot.currentServer);
  const createdAgents = humanCreatedAgentsForDisplay(activeProfile.createdAgents, snapshot.agents, human.id);
  const createdAgentGroups = humanCreatedAgentGroupsForDisplay(createdAgents, snapshot.machines);
  const relatedGrants = snapshot.resourceGrantSummaries.filter((grant) => grant.granteeUserId === human.id);
  const additionalGrants = relatedGrants.filter((grant) => grant.id !== grantSummary?.id);

  useEffect(() => {
    if (intent?.kind !== "human" || intent.id !== human.id) return;
    if (intent.action === "resource-access") scrollInspectorSection("human-granted-resources");
  }, [human.id, intent]);

  async function editDescription() {
    if (!isSelf) return;
    const next = window.prompt("Update your description", activeProfile.description ?? "");
    if (next === null) return;
    const updated = await api<UserRecord>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ description: next.trim() || null })
    });
    setProfile({ ...activeProfile, description: updated.description ?? null });
    await onRefresh();
  }

  async function removeMember() {
    if (!roleActions.canRemove || removeBusy) return;
    if (!(await confirmDialog({
      title: `Remove ${activeProfile.displayName} from this workspace?`,
      description: "Their account will not be deleted.",
      confirmText: "Remove member",
      tone: "danger"
    }))) return;
    setRemoveBusy(true);
    try {
      await api(`/api/servers/${serverId}/members/${activeProfile.userId}`, { method: "DELETE" });
      await onRefresh();
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      {error && <div className="error-strip compact">{error}</div>}
      <InspectorSection id="human-profile" title="Profile">
        <div className="inspector-human-card">
          <span className="avatar human">{activeProfile.avatarUrl ? <img src={activeProfile.avatarUrl} alt="" /> : <UserRound size={18} />}</span>
          <span>
            <b>{activeProfile.displayName} {isSelf && <small>(you)</small>}</b>
            <small>{activeProfile.email ?? "No email"} · {rowShared ? "Shared human" : memberRoleLabel(activeProfile.role)}</small>
          </span>
        </div>
        <FieldGrid fields={[
          ["Handle", `@${activeProfile.name}`],
          ["Joined", memberProfileDate(activeProfile.joinedAt)],
          ...profileFacts
        ]} />
      </InspectorSection>
      <InspectorSection id="human-description" title="Description" actions={isSelf ? <button className="icon-link" onClick={() => void editDescription()}><Edit3 size={14} /> Edit</button> : null}>
        <p className={!activeProfile.description ? "inspector-note" : ""}>{activeProfile.description || "No description"}</p>
      </InspectorSection>
      <InspectorSection id="human-role-access" title="Workspace Membership">
        <FieldGrid fields={[
          ["Role", memberRoleLabel(activeProfile.role)],
          ["Membership", activeProfile.membershipStatus],
          ["Visibility", human.membershipVisible === false ? "Limited" : "Visible"]
        ]} />
        {canManageServerMembers && roleActions.canRemove && (
          <div className="inline-actions human-membership-actions">
            <button className="inspector-action-button danger" disabled={removeBusy} title="Remove this member" onClick={() => void removeMember()}><Trash2 size={14} /> {removeBusy ? "Removing" : "Remove member"}</button>
          </div>
        )}
      </InspectorSection>
      <InspectorSection id="human-created-agents" title={`Created Agents (${createdAgents.length})`}>
        {createdAgents.length === 0 && <p className="inspector-note">No agents created by this member.</p>}
        <div className="created-agent-group-list">
          {createdAgentGroups.map((group) => (
            <div key={group.id} className="created-agent-group">
              <div className="created-agent-group-head">
                <span>
                  <b>{group.label}</b>
                  <small>{group.hostname ? `${group.hostname} · ${group.status}` : group.status}</small>
                </span>
                <span className={statusDot(group.status)} />
              </div>
              <div className="created-agent-grid">
                {group.agents.map((createdAgent) => (
                  <div key={createdAgent.id} className="created-agent-compact">
                    <span className="avatar agent">{avatarSeed(createdAgent.name)}</span>
                    <span className="created-agent-copy">
                      <b>{createdAgent.displayName}</b>
                      <small>{createdAgent.runtime ? runtimeDisplayName(createdAgent.runtime) : "No runtime"} · {createdAgent.status}</small>
                    </span>
                    <span className={statusDot(createdAgent.status)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection id="human-granted-resources" title="Resource Access">
        {grantSummary && <ResourceAccessRow grant={grantSummary} snapshot={snapshot} />}
        {relatedGrants.length === 0 && !grantSummary && <p className="inspector-note">No resource grants for this human.</p>}
        {additionalGrants.map((grant) => (
          <ResourceAccessRow key={grant.id} grant={grant} snapshot={snapshot} />
        ))}
      </InspectorSection>
    </div>
  );
}

function AgentInspector({ agent, liveWork, snapshot, modelSections, intent, onOpenAgentDm, onOpenDmChannel, onOpenLiveExecution, onOpenAgentHistoryItem, onRefresh, operatorContext }: { agent: AgentRecord; liveWork?: TopologyAgentLiveWork; snapshot: AppSnapshot; modelSections: string[]; intent?: TopologyInspectorIntent | null; onOpenAgentDm: (agentId: string) => Promise<void>; onOpenDmChannel: (channelId: string) => void; onOpenLiveExecution: (executionId: string) => void; onOpenAgentHistoryItem?: (item: AgentActivityTimelineItem) => void; onRefresh: () => Promise<void>; operatorContext?: TopologyOperatorContext }) {
  const [stopModal, setStopModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState<AgentProfileDraft>(() => agentProfileDraft(agent));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [agentActionMessage, setAgentActionMessage] = useState("");
  const [grantBusyId, setGrantBusyId] = useState("");
  const [grantMessage, setGrantMessage] = useState("");
  const [sharedFilesRevision, setSharedFilesRevision] = useState(0);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const communicationAgent = isCommunicationAgent(agent);
  const routingServer = !operatorContext && communicationAgent && snapshot.currentServer?.id === agent.serverId ? snapshot.currentServer : null;
  const operatorRoutingInstructions = communicationAgent ? operatorContext?.routingInstructions : undefined;
  const routingInstructionsServerId = routingServer?.id ?? (operatorRoutingInstructions ? snapshot.currentServer?.id : null);
  const machine = agent.machineId ? snapshot.machines.find((item) => item.id === agent.machineId) : undefined;
  const runtimeReport = agent.runtime ? machine?.runtimes.find((item) => item.runtime === agent.runtime && item.status === "available") : undefined;
  const readOnlyRuntimeSupported = Boolean(agent.runtime && runtimePermissionModeSupported(agent.runtime, "read-only"));
  const readOnlyAvailable = Boolean(agent.runtime && runtimePermissionModeAvailable(agent.runtime, "read-only", runtimeReport));
  const readOnlyAvailabilityLabel = readOnlyAvailable
    ? ""
    : readOnlyRuntimeSupported
      ? " (update daemon to use Read Only)"
      : " (unsupported by this runtime)";
  // Operator 只接管已明确授权的子 Agent 配置；TYR、凭据、私有目录和权限 grant 仍沿用 Owner 边界。
  const canManageAgent = !communicationAgent && (Boolean(operatorContext) || canManageAgentRuntimeView(agent, machine, snapshot.currentUser.id));
  const profileApply = agentProfileApplyState(agent);
  const activeAgentGrants = snapshot.resourceGrantSummaries.filter((grant) => grant.resourceType === "agent" && grant.resourceId === agent.id);
  const profileChanged = agentProfileDraftChanged(agent, profileDraft);
  const profileValid = profileDraft.displayName.trim().length > 0;
  const machineSummary = agentMachineSummary(machine, agent);
  const ownerLabel = agentOwnerLabel(agent, snapshot.humans, snapshot.currentUser);
  const lifecycleWarning = agentLifecycleWarning(agent, machine);
  const lastErrorSummary = agentLastErrorSummary(agent);
  const canMessageAgent = !operatorContext && agentCanOpenDm(agent, snapshot.currentUser.id);
  const lifecycleLabel = agent.status === "offline" ? "Start Agent" : "Stop Agent";
  const liveExecutionIds = new Set(liveWork?.executions.map((execution) => execution.id) ?? []);
  const recentActivity = primaryTopologyLiveActivity(
    liveWork?.activities.filter((activity) => !liveExecutionIds.has(activity.executionId)) ?? []
  );
  const liveWorkSectionTitle = liveWork?.executions.length ? "Live work" : "Recent activity";

  useEffect(() => {
    setProfileDraft(agentProfileDraft(agent));
    setProfileMessage("");
    setAgentActionMessage("");
  }, [agent.id]);

  useEffect(() => {
    if (intent?.kind !== "agent" || intent.id !== agent.id) return;
    if (intent.action === "activity") scrollInspectorSection("agent-activity");
    if (intent.action === "workspace") scrollInspectorSection("agent-workspace");
    if (intent.action === "execution") scrollInspectorSection("agent-live-work");
  }, [agent.id, canManageAgent, intent]);

  useLayoutEffect(() => {
    const textarea = descriptionTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const styles = window.getComputedStyle(textarea);
    const minHeight = Number.parseFloat(styles.minHeight);
    const maxHeight = Number.parseFloat(styles.maxHeight);
    const floorHeight = Number.isFinite(minHeight) ? minHeight : 0;
    const ceilingHeight = Number.isFinite(maxHeight) ? maxHeight : textarea.scrollHeight;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, floorHeight), ceilingHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > ceilingHeight ? "auto" : "hidden";
  }, [agent.id, profileDraft.description]);

  async function agentAction(path: string, init: RequestInit | string = "POST") {
    const requestInit = typeof init === "string" ? { method: init } : init;
    await api(path, requestInit);
    await onRefresh();
  }

  async function saveAgentProfile() {
    const payload = normalizeAgentProfileDraft(profileDraft);
    if (!payload.displayName) {
      setProfileMessage("Display name is required.");
      return;
    }
    setProfileSaving(true);
    setProfileMessage("");
    try {
      if (operatorContext) {
        const response = await operatorContext.updateAgent(agent.id, {
          displayName: payload.displayName,
          description: payload.description,
          model: payload.model,
          permissionMode: payload.permissionMode
        });
        setProfileDraft(payload);
        setProfileMessage(response.errorCode === "agent_restart_not_delivered"
          ? "Profile saved, but the Agent needs a manual restart."
          : response.errorCode
            ? "Profile saved, but some changes could not be applied. Refresh to check the Agent status."
            : response.profileApplyDeferred
              ? "Profile saved. It will apply after current work completes."
              : response.restartRequired && response.startSent
                ? "Profile saved. Restart requested; waiting for Runtime confirmation."
                : "Profile saved and recorded in Operator audit.");
        await onRefresh();
        return;
      }
      const response = await api<{ restartRequired: boolean; profileApplyDeferred: boolean; restarted: boolean; partial: boolean; errorCode: string | null }>(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      setProfileDraft(payload);
      setProfileMessage(response.errorCode === "agent_restart_not_delivered"
        ? "Profile saved, but the Agent needs a manual restart."
        : response.errorCode === "workspace_sync_failed"
          ? response.restarted
            ? "Profile saved. Restart requests were sent, but workspace refresh may be delayed."
            : "Profile saved. Workspace refresh may be delayed."
          : response.profileApplyDeferred
            ? "Profile saved. It will apply after current work completes."
          : response.restarted
            ? "Profile saved. Restart requested; waiting for Runtime confirmation."
            : "Profile saved.");
      await onRefresh();
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setProfileMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Profile save failed.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function runAgentLifecycleAction(action: "start" | "stop" | "restart") {
    if (!machine) {
      setAgentActionMessage("No linked device found.");
      return;
    }
    setAgentActionMessage("");
    try {
      if (operatorContext) {
        await operatorContext.runAgentAction(agent.id, action);
        setAgentActionMessage(`${action === "stop" ? "Stop" : action === "start" ? "Start" : "Restart"} recorded in Operator audit.`);
        await onRefresh();
      } else {
        await agentAction(`/api/agents/${agent.id}/${action}`);
      }
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setAgentActionMessage(error instanceof Error ? error.message : "Agent action failed.");
    }
  }

  async function resetAgentSession() {
    if (!machine) {
      setAgentActionMessage("No linked device found.");
      return;
    }
    setAgentActionMessage("");
    if (!(await confirmDialog({
      title: `Reset ${agent.displayName}?`,
      description: "This clears the saved Codex session and starts a fresh thread.",
      confirmText: "Reset session",
      tone: "danger"
    }))) return;
    await agentAction(`/api/agents/${agent.id}/reset`, {
      method: "POST",
      body: JSON.stringify({ mode: "restart" })
    });
  }

  async function revokeAgentGrant(grant: ResourceGrantSummary) {
    if (!(await confirmDialog({
      title: `Revoke grant for ${grant.granteeDisplayName}?`,
      confirmText: "Revoke grant",
      tone: "danger"
    }))) return;
    setGrantBusyId(grant.id);
    setGrantMessage("");
    try {
      await api(`/api/resource-grants/${encodeURIComponent(grant.id)}`, { method: "DELETE" });
      await onRefresh();
    } catch (error) {
      setGrantMessage(error instanceof Error ? error.message : "Grant revoke failed.");
    } finally {
      setGrantBusyId("");
    }
  }

  return (
    <div className="inspector-detail-stack" data-model-sections={modelSections.join(" ")}>
      {(canMessageAgent || canManageAgent) && <div className="agent-top-action-bar inspector-icon-toolbar" aria-label="Agent actions">
        {canMessageAgent && <button className="inspector-icon-action primary" title="Message agent" aria-label="Message agent" onClick={() => void onOpenAgentDm(agent.id)}><MessageSquare size={15} /></button>}
        {canManageAgent && <>
          <button className="inspector-icon-action" title={lifecycleLabel} aria-label={lifecycleLabel} onClick={() => {
            if (agent.status === "offline") void runAgentLifecycleAction("start");
            else if (operatorContext) void runAgentLifecycleAction("stop");
            else setStopModal(true);
          }}>{agent.status === "offline" ? <Play size={15} /> : <Square size={15} />}</button>
          <button className="inspector-icon-action" title="Restart Agent" aria-label="Restart Agent" onClick={() => void runAgentLifecycleAction("restart")}><RefreshCw size={15} /></button>
          {!operatorContext && <button className="inspector-icon-action danger" title="Reset Agent" aria-label="Reset Agent" onClick={() => void resetAgentSession()}><AlertTriangle size={15} /></button>}
          {!operatorContext && <button className="inspector-icon-action danger" title="Delete Agent" aria-label="Delete Agent" onClick={async () => {
            if (!(await confirmDialog({
              title: `Delete ${agent.displayName}?`,
              description: "This keeps existing chat history but removes the agent record.",
              confirmText: "Delete agent",
              tone: "danger"
            }))) return;
            await agentAction(`/api/agents/${agent.id}`, "DELETE");
          }}><Trash2 size={15} /></button>}
        </>}
      </div>}
      {agentActionMessage && <p className="inspector-action-feedback" role="status">{agentActionMessage}</p>}
      {liveWork?.totalCount ? <InspectorSection id="agent-live-work" title={`${liveWorkSectionTitle} · ${liveWork.totalCount}`}>
        <div className="inspector-live-work-list">
          {liveWork.executions.map((execution) => {
            const selected = intent?.kind === "agent" && intent.action === "execution" && intent.executionId === execution.id;
            const activityKind = liveWork.activities.find((activity) => activity.executionId === execution.id)?.kind;
            const tone = topologyLiveExecutionTone(execution.status, activityKind);
            return (
              <article key={execution.id} className={`inspector-live-work-item tone-${tone}${selected ? " selected" : ""}`}>
                <div className="inspector-live-work-item-head">
                  <span className="inspector-live-work-state"><i aria-hidden="true" /> {topologyLiveExecutionLabel(execution.status, activityKind)}</span>
                  <small>{relativeTime(execution.updatedAt)}</small>
                </div>
                <b>{execution.title}</b>
                <p>{execution.sourceLabel}</p>
                {execution.sourceContent && execution.sourceContent !== execution.title && <p className="inspector-note">{execution.sourceContent}</p>}
                {execution.latestDetail && <pre className="inspector-live-work-detail">{execution.latestDetail}</pre>}
                {execution.bridgePath?.length ? (
                  <small>Bridge execution · {execution.bridgePath.length} hop{execution.bridgePath.length === 1 ? "" : "s"}</small>
                ) : (
                  <button className="inspector-action-button" type="button" onClick={() => onOpenLiveExecution(execution.id)}>
                    <ExternalLink size={13} /> Open execution
                  </button>
                )}
              </article>
            );
          })}
          {recentActivity && (
            <button
              type="button"
              className={`inspector-live-work-item inspector-live-work-activity-button tone-${topologyLiveActivityTone(recentActivity.kind)}`}
              onClick={() => onOpenLiveExecution(recentActivity.executionId)}
            >
              <div className="inspector-live-work-item-head">
                <span className="inspector-live-work-state"><i aria-hidden="true" /> {topologyLiveActivityLabel(recentActivity.kind)}</span>
                <small>{relativeTime(recentActivity.updatedAt)}</small>
              </div>
              <b>Recent execution</b>
              <p>Open execution details</p>
            </button>
          )}
        </div>
      </InspectorSection> : null}
      <InspectorSection id="agent-profile" title="Profile">
        {communicationAgent ? (
          <p className="inspector-note">This server-hosted Communication Agent can receive DMs, but it has no device runtime.</p>
        ) : !canManageAgent && <p className="inspector-note">This Agent belongs to {ownerLabel}. You can message it, but profile and runtime controls are owner-only.</p>}
        <div className="agent-profile-grid inspector-form-grid">
          <label className="agent-profile-field">
            <span>Display name</span>
            <input className="inspector-control" disabled={!canManageAgent} value={profileDraft.displayName} onChange={(event) => setProfileDraft((draft) => ({ ...draft, displayName: event.target.value }))} />
          </label>
          {!communicationAgent && <label className="agent-profile-field">
            <span>Runtime access</span>
            <p className="field-hint">Controls local files and commands. Tyr capabilities are managed separately.</p>
            <SelectControl className="inspector-control" disabled={!canManageAgent} value={profileDraft.permissionMode} onChange={(event) => setProfileDraft((draft) => ({ ...draft, permissionMode: event.target.value as AgentProfileDraft["permissionMode"] }))}>
              <option value="workspace-write">{permissionModeTitle("workspace-write")}</option>
              <option value="read-only" disabled={Boolean(agent.runtime && !readOnlyAvailable)}>{permissionModeTitle("read-only")}{agent.runtime ? readOnlyAvailabilityLabel : ""}</option>
              <option value="dev-full-access">{permissionModeTitle("dev-full-access")}</option>
            </SelectControl>
          </label>}
          {!communicationAgent && <AgentModelSelect key={agent.id} className="inspector-control" machine={machine} runtime={agent.runtime}
            report={runtimeReport} canManage={canManageAgent} value={profileDraft.model} detectModels={operatorContext?.detectRuntimeModels}
            onChange={(model) => setProfileDraft((draft) => ({ ...draft, model }))} />}
          <label className="agent-profile-field wide">
            {communicationAgent ? <span>TYR Core Policy</span> : <span>Agent Profile Prompt</span>}
            <p className="field-hint">{communicationAgent ? "Platform-maintained identity and safety policy. Workspace routing preferences are configured separately below." : "Server-authoritative role and persona instructions, applied to the Runtime under TYR platform policy."}</p>
            {!communicationAgent && <div className={`profile-apply-status ${profileApply.status}`} aria-live="polite">
              <span><i aria-hidden="true" />{profileApply.label}</span>
              <small>{profileApply.detail}</small>
            </div>}
            <textarea ref={descriptionTextareaRef} className="inspector-control textarea agent-description-textarea" disabled={!canManageAgent} rows={1} value={profileDraft.description} onChange={(event) => setProfileDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="Describe the agent's responsibilities, strengths, routing cues, and boundaries." />
          </label>
          {routingInstructionsServerId && <TyrRoutingInstructionsEditor
            serverId={routingInstructionsServerId}
            canEdit={routingServer ? routingServer.role === "owner" : true}
            controlClassName="inspector-control textarea"
            compact
            dataSource={operatorRoutingInstructions}
          />}
          {!operatorContext && !communicationAgent && (canManageAgent || hasPublicRuntimeResourceGrants(profileDraft.runtimeResourceGrants)) && <div className="agent-profile-field wide">
            <span>Allowed access</span>
            <AgentRuntimeResourceGrantsEditor controlClassName="inspector-control" disabled={!canManageAgent} permissionMode={profileDraft.permissionMode} grants={profileDraft.runtimeResourceGrants} onChange={(runtimeResourceGrants) => setProfileDraft((draft) => ({ ...draft, runtimeResourceGrants }))} />
          </div>}
        </div>
        {canManageAgent && <div className="inline-actions agent-profile-actions">
          <button className="inspector-action-button primary" disabled={!profileChanged || !profileValid || profileSaving} onClick={() => void saveAgentProfile()}><Check size={14} /> {profileSaving ? "Saving" : "Save Profile"}</button>
          <button className="inspector-action-button" disabled={!profileChanged || profileSaving} onClick={() => {
            setProfileDraft(agentProfileDraft(agent));
            setProfileMessage("");
          }}>Discard</button>
          {profileMessage && <span className={profileMessage.includes("required") || profileMessage.startsWith("Error:") ? "profile-save-message error" : "profile-save-message"}>{profileMessage}</span>}
        </div>}
      </InspectorSection>
      {!communicationAgent && canManageAgent && (operatorContext?.sharedFiles
        ? <AgentAssignedResourcesPanel agentId={agent.id} records={operatorContext.sharedFiles.records} />
        : snapshot.currentServer?.role === "owner" && <OwnerAgentAssignedResourcesPanel serverId={snapshot.currentServer.id} agentId={agent.id} refreshRevision={sharedFilesRevision} />)}
      {communicationAgent && !operatorContext && <AssistantContactMethodsPanel agent={agent} variant="inspector" />}
      {communicationAgent ? (
        <>
          <InspectorSection id="agent-communication" title="Communication">
            <FieldGrid fields={[
              ["Status", agentStatusLabel(agent.status)],
              ["Execution", "Server-hosted"],
              ["Device", "No device required"],
              ["Owner", ownerLabel],
              ["Created", new Date(agent.createdAt).toLocaleString()],
              ["Summary", agentRuntimeSummary(agent)]
            ]} />
          </InspectorSection>
          {operatorContext?.heartbeats
            ? <TyrHeartbeatsPanel context={operatorContext.heartbeats} agents={snapshot.agents} />
            : routingServer?.role === "owner" && <OwnerHeartbeatsPanel serverId={routingServer.id} agents={snapshot.agents} />}
          {operatorContext?.sharedFiles && <WorkspaceSharedFilesPanel context={operatorContext.sharedFiles} agents={snapshot.agents} />}
        </>
      ) : <>
      <InspectorSection id="agent-runtime" title="Runtime">
        {(lifecycleWarning || lastErrorSummary) && <div className={lastErrorSummary ? "agent-runtime-warning compact error" : "agent-runtime-warning compact"}><AlertTriangle size={13} /><span>{lastErrorSummary ?? lifecycleWarning}</span></div>}
        <FieldGrid fields={[
          ["Status", agentStatusLabel(agent.status)],
          ["Runtime", agent.runtime ? runtimeDisplayName(agent.runtime) : "No runtime"],
          ["Model", agent.model || "Default"],
          ["Reasoning", agent.reasoningEffort ?? "Default"],
          ["Runtime access", permissionModeTitle(agent.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE)],
          ["Device", `${machineSummary.title} · ${machineSummary.detail}`],
          ["Owner", ownerLabel],
          ["Workspace", agent.workspacePath || "No workspace attached"],
          ["Created", new Date(agent.createdAt).toLocaleString()],
          ["Summary", agentRuntimeSummary(agent)]
        ]} />
      </InspectorSection>
      {!operatorContext && <InspectorAccordion id="agent-permissions" title="Permissions" defaultOpen={false}>
        {canManageAgent ? <AgentPermissionsPanel agentId={agent.id} variant="compact" /> : <Placeholder title="Permissions are owner-only" text={`${ownerLabel} owns this Agent. You can view its profile and message it, but cannot change permissions.`} />}
      </InspectorAccordion>}
      {!operatorContext && canManageAgent && activeAgentGrants.length > 0 && <InspectorSection id="agent-sharing" title="Existing Access">
        <div className="section-label inline">Active grants {activeAgentGrants.length}</div>
        {grantMessage && <p className="profile-save-message error">{grantMessage}</p>}
        <div className="grant-list agent-sharing-grant-list">
          {activeAgentGrants.map((grant) => (
            <div key={grant.id} className="inspector-grant-row agent-sharing-grant-row">
              <span>
                <b>{grant.granteeDisplayName}</b>
                <small>{grant.granteeEmail ?? "No email"}</small>
              </span>
              <span className="inspector-grant-row-actions">
                <em>{grant.scopes.join(", ")}</em>
                <button className="icon-btn danger" aria-label={`Revoke grant for ${grant.granteeDisplayName}`} title="Revoke grant" disabled={grantBusyId === grant.id} onClick={() => void revokeAgentGrant(grant)}><X size={15} /></button>
              </span>
            </div>
          ))}
        </div>
      </InspectorSection>}
      <InspectorSection id="agent-lifecycle" title="Lifecycle" ownerOnly>
        <FieldGrid fields={[
          ["Status", agentStatusLabel(agent.status)],
          ["Device status", machine?.status ?? "missing"]
        ]} />
      </InspectorSection>
      {!operatorContext && <InspectorAccordion id="agent-reminders" title="Reminders" defaultOpen={false}>
        <ReminderList snapshot={snapshot} agentId={agent.id} className="reminders-view inspector-reminders-view" />
      </InspectorAccordion>}
      {!operatorContext && <InspectorAccordion id="agent-workspace" title="Workspace" defaultOpen={false}>
        {canManageAgent ? <>
          <AgentWorkspace agent={agent} />
          {snapshot.currentServer?.role === "owner" && snapshot.currentServer.id === agent.serverId && (
            <OwnerWorkspaceSharedFilesPanel serverId={snapshot.currentServer.id} agents={snapshot.agents} initialAgentId={agent.id} uploadOnly onCreated={() => setSharedFilesRevision((value) => value + 1)} />
          )}
        </> : <Placeholder title="Workspace is owner-only" text={`${ownerLabel} owns this Agent. Workspace file browsing is limited to the owner.`} />}
      </InspectorAccordion>}
      {!operatorContext && <InspectorAccordion id="agent-skills" title="Skills" defaultOpen={false}>
        {canManageAgent ? <SkillsBlock agentId={agent.id} /> : <p className="inspector-note">Skill inspection is owner-only.</p>}
      </InspectorAccordion>}
      </>}
      {!operatorContext && <InspectorAccordion id="agent-activity" title="Agent History" defaultOpen={false}>
        <PaginatedAgentActivityTimeline agentId={agent.id} variant="compact" onOpenItem={onOpenAgentHistoryItem} />
      </InspectorAccordion>}
      {!operatorContext && canManageAgent && stopModal && <StopAgentModal agent={agent} onClose={() => setStopModal(false)} onDone={async () => {
        setStopModal(false);
        await onRefresh();
      }} />}
    </div>
  );
}

function OwnerHeartbeatsPanel({ serverId, agents }: { serverId: string; agents: AgentRecord[] }) {
  const [payload, setPayload] = useState<TyrHeartbeatListPayload>({ heartbeats: [], runs: [] });
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const next = await api<TyrHeartbeatListPayload>(`/api/servers/${encodeURIComponent(serverId)}/heartbeats`);
      setPayload(next);
      setError("");
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "Heartbeats could not be loaded."));
    }
  }

  useEffect(() => {
    void refresh();
  }, [serverId]);

  const context = useMemo<TyrHeartbeatPanelContext>(() => ({
    records: payload.heartbeats,
    runs: payload.runs,
    create: async (input) => {
      await api(`/api/servers/${encodeURIComponent(serverId)}/heartbeats`, {
        method: "POST",
        body: JSON.stringify(input)
      });
      await refresh();
    },
    update: async (heartbeatId, input) => {
      await api(`/api/servers/${encodeURIComponent(serverId)}/heartbeats/${encodeURIComponent(heartbeatId)}`, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
      await refresh();
    },
    refresh
  }), [payload, serverId]);

  return <>{error && <p className="profile-save-message error">{error}</p>}<TyrHeartbeatsPanel context={context} agents={agents} /></>;
}

function TyrHeartbeatsPanel({
  context,
  agents
}: {
  context: TyrHeartbeatPanelContext;
  agents: AgentRecord[];
}) {
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [intervalUnit, setIntervalUnit] = useState<TyrHeartbeatIntervalUnit>("minute");
  const [intervalValue, setIntervalValue] = useState(5);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [runStatus, setRunStatus] = useState<TyrHeartbeatRunStatus | "all">("all");
  const [visibleRunCount, setVisibleRunCount] = useState(10);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const filteredRuns = runStatus === "all" ? context.runs : context.runs.filter((run) => run.status === runStatus);
  const visibleRuns = filteredRuns.slice(0, visibleRunCount);
  const createValid = Boolean(title.trim() && instruction.trim() && Number.isInteger(intervalValue) && intervalValue >= 1);

  useEffect(() => {
    setVisibleRunCount(10);
    setExpandedRunId(null);
  }, [runStatus]);

  async function createHeartbeat() {
    if (!title.trim() || !instruction.trim() || !Number.isInteger(intervalValue) || intervalValue < 1) {
      setMessage("Title, instructions, and a positive whole-number interval are required.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await context.create({ title: title.trim(), instruction: instruction.trim(), intervalUnit, intervalValue });
      setTitle("");
      setInstruction("");
      setMessage("Heartbeat created.");
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Heartbeat creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <InspectorAccordion id="agent-heartbeats" title={`Heartbeats · ${context.records.length}`} defaultOpen>
      <p className="inspector-note">TYR chooses an online child Agent for each run. If a prior run is active, the next run remains queued. Pausing keeps the active run and cancels queued runs.</p>
      <div className="operator-heartbeat-form">
        <label className="agent-profile-field wide">
          <span>Name</span>
          <input className="inspector-control" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Refresh demo database" />
        </label>
        <label className="agent-profile-field wide">
          <span>Instructions</span>
          <textarea className="inspector-control textarea" rows={3} value={instruction} maxLength={20_000} onChange={(event) => setInstruction(event.target.value)} placeholder="Describe the real work TYR should delegate." />
        </label>
        <label className="agent-profile-field">
          <span>Every</span>
          <input className="inspector-control" type="number" min={1} step={1} value={intervalValue} onChange={(event) => setIntervalValue(Number(event.target.value))} />
        </label>
        <label className="agent-profile-field">
          <span>Unit</span>
          <SelectControl className="inspector-control" value={intervalUnit} onChange={(event) => setIntervalUnit(event.target.value as TyrHeartbeatIntervalUnit)}>
            <option value="minute">Minutes</option>
            <option value="hour">Hours</option>
          </SelectControl>
        </label>
        <div className="inline-actions operator-heartbeat-create">
          <button className="inspector-action-button primary" type="button" disabled={busy || !createValid} onClick={() => void createHeartbeat()}><Plus size={14} /> {busy ? "Creating" : "Create Heartbeat"}</button>
          {message && <span className={message.startsWith("Error:") || message.includes("required") ? "profile-save-message error" : "profile-save-message"}>{message}</span>}
        </div>
      </div>
      <div className="operator-heartbeat-list">
        {context.records.map((heartbeat) => <OperatorHeartbeatCard key={heartbeat.id} heartbeat={heartbeat} context={context} />)}
        {context.records.length === 0 && <p className="inspector-note">No Heartbeats configured for this Workspace.</p>}
      </div>
      <div className="operator-heartbeat-run-tools">
        <div><span className="section-label inline">Recent runs</span><small>{filteredRuns.length} loaded</small></div>
        <label>
          <span>Status</span>
          <SelectControl className="inspector-control" value={runStatus} onChange={(event) => setRunStatus(event.target.value as TyrHeartbeatRunStatus | "all")}>
            <option value="all">All statuses</option>
            <option value="failed">Failed</option>
            <option value="succeeded">Succeeded</option>
            <option value="running">Running</option>
            <option value="queued">Queued</option>
            <option value="cancelled">Cancelled</option>
          </SelectControl>
        </label>
      </div>
      <div className="operator-heartbeat-runs">
        {visibleRuns.map((run) => {
          const heartbeat = context.records.find((item) => item.id === run.heartbeatId);
          const selectedAgent = run.selectedAgentId ? agents.find((agent) => agent.id === run.selectedAgentId) : null;
          const runDetail = run.status === "failed" || run.status === "cancelled"
            ? run.errorMessage ?? selectedAgent?.displayName ?? "Run did not complete"
            : selectedAgent?.displayName ?? "TYR is selecting an Agent";
          const expanded = expandedRunId === run.id;
          return (
            <article className={`operator-heartbeat-run${expanded ? " expanded" : ""}`} key={run.id}>
              <button type="button" aria-expanded={expanded} onClick={() => setExpandedRunId(expanded ? null : run.id)}>
                <span><b>{heartbeat?.title ?? "Heartbeat"}</b><small>{formatHeartbeatDateTime(run.scheduledFor)}</small></span>
                <span><em className={`operator-heartbeat-status ${run.status}`}>{run.status}</em><small>{runDetail}</small></span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {expanded && <dl className="operator-heartbeat-run-details">
                <div><dt>Agent</dt><dd>{selectedAgent?.displayName ?? "Not selected"}</dd></div>
                <div><dt>Duration</dt><dd>{heartbeatRunDuration(run)}</dd></div>
                <div><dt>Scheduled</dt><dd>{formatHeartbeatDateTime(run.scheduledFor)}</dd></div>
                {run.startedAt && <div><dt>Started</dt><dd>{formatHeartbeatDateTime(run.startedAt)}</dd></div>}
                {run.completedAt && <div><dt>Completed</dt><dd>{formatHeartbeatDateTime(run.completedAt)}</dd></div>}
                <div><dt>Executions</dt><dd>{run.executionIds.length ? run.executionIds.join(", ") : "None"}</dd></div>
                {(run.errorMessage || run.errorCode) && <div><dt>Failure</dt><dd>{run.errorMessage ?? run.errorCode}</dd></div>}
              </dl>}
            </article>
          );
        })}
        {filteredRuns.length === 0 && <p className="inspector-note">{runStatus === "all" ? "No scheduled runs yet." : "No runs match this status."}</p>}
        {visibleRunCount < filteredRuns.length && <button className="inspector-action-button operator-heartbeat-load-more" type="button" onClick={() => setVisibleRunCount((count) => count + 10)}>Load 10 more</button>}
      </div>
    </InspectorAccordion>
  );
}

function OperatorHeartbeatCard({
  heartbeat,
  context
}: {
  heartbeat: TyrHeartbeatRecord;
  context: TyrHeartbeatPanelContext;
}) {
  const [title, setTitle] = useState(heartbeat.title);
  const [instruction, setInstruction] = useState(heartbeat.instruction);
  const [intervalUnit, setIntervalUnit] = useState(heartbeat.intervalUnit);
  const [intervalValue, setIntervalValue] = useState(heartbeat.intervalValue);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const changed = title.trim() !== heartbeat.title || instruction.trim() !== heartbeat.instruction || intervalUnit !== heartbeat.intervalUnit || intervalValue !== heartbeat.intervalValue;

  useEffect(() => {
    setTitle(heartbeat.title);
    setInstruction(heartbeat.instruction);
    setIntervalUnit(heartbeat.intervalUnit);
    setIntervalValue(heartbeat.intervalValue);
  }, [heartbeat.id, heartbeat.updatedAt]);

  async function update(input: Partial<Pick<TyrHeartbeatRecord, "title" | "instruction" | "intervalUnit" | "intervalValue" | "enabled">>) {
    setBusy(true);
    setMessage("");
    try {
      await context.update(heartbeat.id, input);
      setMessage(input.enabled === false ? "Paused; queued runs were cancelled." : input.enabled === true ? "Saved and enabled." : "Settings saved.");
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Heartbeat update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    // 启停时一并保存当前草稿，避免用户以为已修改的频率和指令也随状态切换生效。
    await update({
      ...(changed ? { title: title.trim(), instruction: instruction.trim(), intervalUnit, intervalValue } : {}),
      enabled: !heartbeat.enabled
    });
  }

  const valid = Boolean(title.trim() && instruction.trim() && Number.isInteger(intervalValue) && intervalValue >= 1);
  const toggleLabel = changed ? heartbeat.enabled ? "Save & Pause" : "Save & Enable" : heartbeat.enabled ? "Pause" : "Enable";

  return (
    <article className={`operator-heartbeat-card${heartbeat.enabled ? "" : " paused"}`}>
      <div className="operator-heartbeat-card-head">
        <b>{heartbeat.enabled ? "Active" : "Paused"}</b>
        <small>{heartbeat.enabled ? `Next ${formatHeartbeatDateTime(heartbeat.nextRunAt)}` : "No next run while paused"}</small>
      </div>
      <label className="agent-profile-field wide"><span>Name</span><input className="inspector-control" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="agent-profile-field wide"><span>Instructions</span><textarea className="inspector-control textarea" rows={2} value={instruction} maxLength={20_000} onChange={(event) => setInstruction(event.target.value)} /></label>
      <div className="operator-heartbeat-schedule">
        <label className="agent-profile-field"><span>Every</span><input className="inspector-control" type="number" min={1} step={1} value={intervalValue} onChange={(event) => setIntervalValue(Number(event.target.value))} /></label>
        <label className="agent-profile-field"><span>Unit</span><SelectControl className="inspector-control" value={intervalUnit} onChange={(event) => setIntervalUnit(event.target.value as TyrHeartbeatIntervalUnit)}><option value="minute">Minutes</option><option value="hour">Hours</option></SelectControl></label>
      </div>
      <div className="inline-actions">
        <button className="inspector-action-button primary" type="button" disabled={!changed || busy || !valid} onClick={() => void update({ title: title.trim(), instruction: instruction.trim(), intervalUnit, intervalValue })}><Check size={14} /> Save settings</button>
        <button className="inspector-action-button" type="button" disabled={busy || !valid} onClick={() => void toggleEnabled()}>{toggleLabel}</button>
        {message && <span className={message.startsWith("Error:") ? "profile-save-message error" : "profile-save-message"}>{message}</span>}
      </div>
    </article>
  );
}

function formatHeartbeatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  });
}

function heartbeatRunDuration(run: TyrHeartbeatRunRecord): string {
  if (!run.startedAt) return "Not started";
  const start = Date.parse(run.startedAt);
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Unavailable";
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function AgentWorkspace({ agent }: { agent: AgentRecord }) {
  const [dir, setDir] = useState(".");
  const [files, setFiles] = useState<WorkspaceFileNode[]>([]);
  const [workspacePath, setWorkspacePath] = useState(agent.workspacePath || "");
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileNode | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [state, setState] = useState("idle");

  async function load(nextDir = dir) {
    setState("loading");
    try {
      const pathParam = nextDir === "." ? "" : `?dirPath=${encodeURIComponent(nextDir)}`;
      const data = await api<WorkspaceFileNode[] | { workspacePath?: string; dirPath?: string; files: WorkspaceFileNode[] }>(`/api/agents/${agent.id}/workspace-files${pathParam}`);
      const nextFiles = Array.isArray(data) ? data : data.files;
      setDir(Array.isArray(data) ? nextDir : data.dirPath || nextDir);
      setFiles(nextFiles);
      if (!Array.isArray(data)) setWorkspacePath(data.workspacePath || agent.workspacePath || "");
      setSelectedFile(null);
      setFileContent("");
      setState("idle");
    } catch (err) {
      setState(err instanceof Error ? err.message : String(err));
    }
  }

  async function openFile(file: WorkspaceFileNode) {
    if (file.isDirectory) {
      await load(file.path);
      return;
    }
    setSelectedFile(file);
    setFileContent("Loading...");
    try {
      const data = await api<{ content: string | null; binary: boolean; size: number }>(`/api/agents/${agent.id}/workspace-file?path=${encodeURIComponent(file.path)}`);
      setFileContent(data.binary ? `Binary file (${data.size} bytes)` : data.content ?? "");
    } catch (err) {
      setFileContent(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load(".");
  }, [agent.id]);

  return (
    <>
      <p className="inspector-note">Files in this Agent's root folder are private. Workspace shared files appear under <code>shared/</code> after assignment; matching names in the root folder do not sync.</p>
      <div className="workspace-view agent-workspace inspector-workspace-view">
        <div className="workspace-pathbar">
          <span>{workspacePath || agent.workspacePath || "~/.tyr-ai/agents"}/{dir !== "." ? dir : ""}</span>
          <button className="icon-btn" onClick={() => navigator.clipboard.writeText(workspacePath || agent.workspacePath || "")}><Copy size={15} /></button>
        </div>
        <aside className="workspace-tree inspector-workspace-tree">
          <div className="workspace-tree-head">
            <SectionLabel label={dir === "shared" || dir.startsWith("shared/") ? "SHARED WORKSPACE FILES" : "AGENT WORKSPACE"} />
            {dir !== "." && <button className="icon-link" onClick={() => void load(".")}>Root</button>}
            <button className="icon-link" onClick={() => void load(dir)}><RefreshCw size={15} /></button>
          </div>
          {state !== "idle" && state !== "loading" && <div className="empty-box">{state}</div>}
          {state === "loading" && <div className="empty-box">Scanning...</div>}
          {state === "idle" && files.length === 0 && <div className="empty-box">No files in this workspace.</div>}
          {files.map((file) => (
            <button key={file.path} className={selectedFile?.path === file.path ? "tree-file selected" : "tree-file"} onClick={() => void openFile(file)}>
              {file.isDirectory ? <Folder size={16} /> : <FileText size={16} />}
              <span>{file.name}</span>
            </button>
          ))}
        </aside>
        {selectedFile && (
          <div className="file-preview inspector-file-preview">
            <div className="file-preview-head">
              <b>{selectedFile.path}</b>
              <small>{selectedFile.size} bytes · {new Date(selectedFile.modifiedAt).toLocaleString()}</small>
            </div>
            <pre>{fileContent}</pre>
          </div>
        )}
      </div>
    </>
  );
}

function SkillsBlock({ agentId }: { agentId: string }) {
  const detectedSkills = useAgentSkills(agentId);
  const fallbackSkills = [
    ["imagegen", "Generate or edit raster images when the task benefits from AI-created bitmap visuals."],
    ["openai-docs", "Use when the user asks how to build with OpenAI products or APIs."],
    ["plugin-creator", "Create and scaffold plugin directories for Codex."]
  ];
  const skills = detectedSkills.global.length > 0
    ? detectedSkills.global.map((skill) => [skill.displayName ?? skill.name, skill.description ?? skill.path])
    : fallbackSkills;
  return (
    <div className="skill-list inspector-skill-list">
      {skills.map(([name, description]) => (
        <div key={name} className="skill-row">
          <b>"{name}"</b>
          <p>{description}</p>
        </div>
      ))}
      <h3 className="workspace-label"><Folder size={14} /> Workspace ({detectedSkills.workspace.length})</h3>
      {detectedSkills.workspace.length === 0 && <p className="inspector-note">No skills in this agent's workspace.</p>}
      {detectedSkills.workspace.map((skill) => (
        <div key={skill.path} className="workspace-row compact">
          <Folder size={14} />
          <b>{skill.name}</b>
          <small>{skill.path}</small>
        </div>
      ))}
    </div>
  );
}

function useAgentSkills(agentId: string) {
  const [skills, setSkills] = useState<{ global: SkillInfo[]; workspace: SkillInfo[] }>({ global: [], workspace: [] });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await api<{ global: SkillInfo[]; workspace: SkillInfo[] }>(`/api/agents/${agentId}/skills`);
        if (active) setSkills(data);
      } catch {
        if (active) setSkills({ global: [], workspace: [] });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [agentId]);
  return skills;
}

function StopAgentModal({ agent, onClose, onDone }: { agent: AgentRecord; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function stop() {
    setBusy(true);
    await api(`/api/agents/${agent.id}/stop`, { method: "POST", body: "{}" });
    setBusy(false);
    onDone();
  }
  return (
    <Modal title="STOP AGENT" onClose={onClose} className="template-form-modal template-form-modal-sm" backdropClassName="template-form-modal-backdrop" titleIcon={<Square size={18} />}>
      <div className="template-dialog-content">
        <div className="template-dialog-body">
          <div className="warning-box">
            <AlertTriangle size={26} />
            <p>Are you sure you want to stop "{agent.displayName}"? The agent will stop processing messages.</p>
          </div>
        </div>
        <div className="modal-actions template-dialog-actions">
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn orange" disabled={busy} onClick={() => void stop()}>Stop Agent</button>
        </div>
      </div>
    </Modal>
  );
}

function scrollInspectorSection(sectionId: string): void {
  document.getElementById(sectionId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function InspectorSection({ id, title, ownerOnly, actions, children }: { id: string; title: string; ownerOnly?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={ownerOnly ? "inspector-section-card owner-only" : "inspector-section-card"}>
      <div className="inspector-section-head">
        <h3>{title}</h3>
        {actions && <div className="inspector-section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function InspectorAccordion({ id, title, defaultOpen = true, children }: { id: string; title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details id={id} className="inspector-section-card inspector-accordion" open={defaultOpen}>
      <summary>
        <h3>{title}</h3>
        <ChevronDown className="inspector-accordion-chevron" size={14} aria-hidden="true" focusable="false" />
      </summary>
      <div className="inspector-accordion-body">{children}</div>
    </details>
  );
}

function FieldGrid({ fields }: { fields: Array<[string, string | number | null | undefined]> }) {
  return (
    <div className="inspector-lines">
      {fields.map(([label, value]) => (
        <div key={`${label}:${String(value)}`}><span>{label}</span><b>{value === null || typeof value === "undefined" || value === "" ? "None" : String(value)}</b></div>
      ))}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string | number }) {
  return <span><small>{label}</small><b>{value}</b></span>;
}

function ResourceAccessRow({ grant, snapshot }: { grant: ResourceGrantSummary; snapshot: AppSnapshot }) {
  const resource = grantResourceLabel(grant, snapshot);
  return (
    <div className="resource-access-row">
      <span>
        <b>{resource.title}</b>
        <small>{resource.subtitle}</small>
      </span>
      <span className="resource-scope-list">
        {grant.scopes.map((scope) => <em key={scope} className="resource-scope-chip">{scope}</em>)}
      </span>
    </div>
  );
}

function grantResourceLabel(grant: ResourceGrantSummary, snapshot: AppSnapshot): { title: string; subtitle: string } {
  if (grant.resourceType === "agent") {
    const agent = snapshot.agents.find((item) => item.id === grant.resourceId);
    return {
      title: agent?.displayName ?? "Unknown agent",
      subtitle: agent ? `Agent · @${agent.name}` : "Agent"
    };
  }
  if (grant.resourceType === "machine") {
    const machine = snapshot.machines.find((item) => item.id === grant.resourceId);
    return {
      title: machine?.name ?? "Unknown device",
      subtitle: machine ? `Device · ${machine.hostname}` : "Device"
    };
  }
  const channel = snapshot.channels.find((item) => item.id === grant.resourceId);
  return {
    title: channel ? channelDisplayLabel(channel) : "Unknown conversation",
    subtitle: channel ? `Conversation · ${channel.visibility}` : "Conversation"
  };
}

function CompactAgentRow({ agent }: { agent: AgentRecord }) {
  const statusLabel = agentStatusLabel(agent.status);
  return (
    <div className="inspector-agent-row">
      <span className="avatar agent">{avatarSeed(agent.name)}</span>
      <span className="inspector-agent-main">
        <b>{agent.displayName}</b>
        <small>{agent.runtime ? runtimeDisplayName(agent.runtime) : "Communication"}</small>
      </span>
      <span className={statusDot(agent.status)} title={statusLabel} aria-label={statusLabel} />
    </div>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return <div className="placeholder compact"><h2>{title}</h2><p>{text}</p></div>;
}

function machineConnectorTokenStatus(machine: MachineRecord): string {
  if (machine.connectorTokenRevokedAt) return "Revoked";
  if (machine.connectorTokenIssuedAt) return "Issued";
  if (machine.apiKeyUsedAt) return "Bootstrap consumed";
  return "Bootstrap pending";
}
