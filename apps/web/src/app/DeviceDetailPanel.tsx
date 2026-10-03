import { Activity, Smartphone, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppSnapshot, AuditEventRecord, DeviceCommandRecord, DeviceRecord, MobileAppBindingRecord } from "@tyr-ai/contracts";
import { deviceCapabilityLabel, deviceCommandErrorText, deviceCommandStatusLabel, deviceCommandTerminalFailed } from "../deviceCapabilities";
import { api } from "../lib/api";
import { Modal, SelectControl } from "../shared/ui";
import { relativeTime, statusDot } from "./workspaceUtils";

const COMMAND_PAGE_SIZE = 5;
const AUDIT_PAGE_SIZE = 10;

type PageState = {
  limit: number;
  offset: number;
  hasMore: boolean;
};

type DeviceDetailPanelProps = {
  device: DeviceRecord;
  snapshot: AppSnapshot;
  compact?: boolean;
};

type DeviceDetailResponse = {
  mobileBinding?: MobileAppBindingRecord | null;
};

export function DeviceDetailPanel({ device, snapshot, compact = false }: DeviceDetailPanelProps) {
  const deviceWorkspaceAgents = useMemo(() => snapshot.agents.filter((agent) => {
    const machine = agent.machineId ? snapshot.machines.find((item) => item.id === agent.machineId) : undefined;
    return (agent.serverId ?? machine?.serverId ?? "local") === device.serverId;
  }), [device.serverId, snapshot.agents, snapshot.machines]);
  const [mobileBinding, setMobileBinding] = useState<MobileAppBindingRecord | null>(null);
  const [selectedPinnedAgentId, setSelectedPinnedAgentId] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [unbindBusy, setUnbindBusy] = useState(false);
  const [unbindError, setUnbindError] = useState("");
  const [commands, setCommands] = useState<DeviceCommandRecord[]>([]);
  const [commandsBusy, setCommandsBusy] = useState(false);
  const [commandsError, setCommandsError] = useState("");
  const [commandsPagination, setCommandsPagination] = useState<PageState>({ limit: COMMAND_PAGE_SIZE, offset: 0, hasMore: false });
  const [commandDetail, setCommandDetail] = useState<{ command: DeviceCommandRecord; auditEvents: AuditEventRecord[] } | null>(null);
  const [commandDetailBusy, setCommandDetailBusy] = useState(false);
  const [commandDetailError, setCommandDetailError] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditPagination, setAuditPagination] = useState<PageState>({ limit: AUDIT_PAGE_SIZE, offset: 0, hasMore: false });

  useEffect(() => {
    setCommandsPagination({ limit: COMMAND_PAGE_SIZE, offset: 0, hasMore: false });
  }, [device.id]);

  useEffect(() => {
    let cancelled = false;
    setMobileBinding(null);
    setSelectedPinnedAgentId("");
    setAssistantError("");
    setUnbindError("");
    api<DeviceDetailResponse>(`/api/devices/${encodeURIComponent(device.id)}`)
      .then((response) => {
        if (cancelled) return;
        const binding = response.mobileBinding ?? null;
        setMobileBinding(binding);
        setSelectedPinnedAgentId(binding?.pinnedAgentId ?? deviceWorkspaceAgents[0]?.id ?? "");
      })
      .catch((error) => {
        if (!cancelled) setAssistantError(error instanceof Error ? error.message : "Mobile assistant unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [device.id, deviceWorkspaceAgents]);

  useEffect(() => {
    let cancelled = false;
    setCommandsBusy(true);
    setCommandsError("");
    api<{ commands: DeviceCommandRecord[]; pagination: PageState }>(`/api/devices/${encodeURIComponent(device.id)}/commands?limit=${COMMAND_PAGE_SIZE}&offset=${commandsPagination.offset}`)
      .then((response) => {
        if (cancelled) return;
        setCommands(response.commands);
        setCommandsPagination(response.pagination);
      })
      .catch((error) => {
        if (cancelled) return;
        setCommands([]);
        setCommandsError(error instanceof Error ? error.message : "Commands unavailable.");
      })
      .finally(() => {
        if (!cancelled) setCommandsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [commandsPagination.offset, device.id]);

  useEffect(() => {
    if (!auditOpen) return;
    let cancelled = false;
    setAuditBusy(true);
    setAuditError("");
    api<{ auditEvents: AuditEventRecord[]; pagination: PageState }>(`/api/devices/${encodeURIComponent(device.id)}/audit?limit=${AUDIT_PAGE_SIZE}&offset=${auditPagination.offset}`)
      .then((response) => {
        if (cancelled) return;
        setAuditEvents(response.auditEvents);
        setAuditPagination(response.pagination);
      })
      .catch((error) => {
        if (cancelled) return;
        setAuditEvents([]);
        setAuditError(error instanceof Error ? error.message : "Audit unavailable.");
      })
      .finally(() => {
        if (!cancelled) setAuditBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auditOpen, auditPagination.offset, device.id]);

  async function openCommandDetails(command: DeviceCommandRecord) {
    setCommandDetail({ command, auditEvents: [] });
    setCommandDetailError("");
    setCommandDetailBusy(true);
    try {
      const detail = await api<{ command: DeviceCommandRecord; auditEvents: AuditEventRecord[] }>(`/api/devices/${encodeURIComponent(device.id)}/commands/${encodeURIComponent(command.id)}`);
      setCommandDetail(detail);
    } catch (error) {
      setCommandDetailError(error instanceof Error ? error.message : "Command details unavailable.");
    } finally {
      setCommandDetailBusy(false);
    }
  }

  async function openDeviceAudit() {
    setAuditOpen(true);
    setAuditEvents([]);
    setAuditError("");
    setAuditPagination({ limit: AUDIT_PAGE_SIZE, offset: 0, hasMore: false });
  }

  async function saveMobileAssistant() {
    if (!mobileBinding) return;
    if (!selectedPinnedAgentId) {
      setAssistantError("Choose an Assistant for this mobile device.");
      return;
    }
    setAssistantBusy(true);
    setAssistantError("");
    try {
      const response = await api<{ binding: MobileAppBindingRecord }>(`/api/devices/${encodeURIComponent(device.id)}/mobile-binding`, {
        method: "PATCH",
        body: JSON.stringify({ pinnedAgentId: selectedPinnedAgentId })
      });
      setMobileBinding(response.binding);
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : "Assistant update failed.");
    } finally {
      setAssistantBusy(false);
    }
  }

  async function unbindMobileAppFromWeb() {
    if (!mobileBinding) return;
    setUnbindBusy(true);
    setUnbindError("");
    try {
      await api<{ binding: MobileAppBindingRecord }>(`/api/devices/${encodeURIComponent(device.id)}/mobile-binding`, {
        method: "DELETE"
      });
      setMobileBinding(null);
      setSelectedPinnedAgentId(deviceWorkspaceAgents[0]?.id ?? "");
    } catch (error) {
      setUnbindError(error instanceof Error ? error.message : "Mobile device disconnect failed.");
    } finally {
      setUnbindBusy(false);
    }
  }

  const platformLabel = `${device.platform} / ${device.deviceKind}`;

  return (
    <article className={compact ? "device-detail-panel compact" : "device-detail-panel"}>
      <header className="device-detail-header">
        <span className="device-card-icon"><Smartphone size={20} /></span>
        <span>
          <small>Mobile Device</small>
          <h2>{device.displayName}</h2>
        </span>
        <em className={`device-state-pill ${device.status}`}>
          <i className={statusDot(device.status)} />
          {device.status}
        </em>
      </header>

      <div className="device-summary-grid">
        <span><b>Status</b><small>{device.status}</small></span>
        <span><b>Platform</b><small>{platformLabel}</small></span>
        <span><b>Last seen</b><small>{new Date(device.lastSeenAt).toLocaleString()}</small></span>
      </div>

      <section className="device-detail-section mobile-assistant-section">
        <b>Mobile assistant</b>
        {mobileBinding ? (
          <div className="mobile-assistant-stack">
            <div className="mobile-assistant-control">
              <SelectControl className="input" value={selectedPinnedAgentId} onChange={(event) => {
                setSelectedPinnedAgentId(event.target.value);
                setAssistantError("");
              }}>
                {deviceWorkspaceAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
              </SelectControl>
              <button className="btn small" type="button" disabled={assistantBusy || !selectedPinnedAgentId || selectedPinnedAgentId === mobileBinding.pinnedAgentId} onClick={() => void saveMobileAssistant()}>
                {assistantBusy ? "Saving..." : "Save"}
              </button>
            </div>
            <div className="mobile-unbind-row">
              <small>Disconnecting ends this mobile device chat session and keeps its history.</small>
              <button className="btn danger small" type="button" disabled={unbindBusy} onClick={() => void unbindMobileAppFromWeb()}>
                {unbindBusy ? "Disconnecting..." : "Disconnect mobile device"}
              </button>
            </div>
          </div>
        ) : (
          <small>No active connection for this mobile device.</small>
        )}
        {assistantError && <small className="device-command-error">{assistantError}</small>}
        {unbindError && <small className="device-command-error">{unbindError}</small>}
      </section>

      <section className="device-detail-section">
        <b>Methods</b>
        <div className="device-capability-list">
          {device.capabilities.map((capability) => <span key={capability}>{deviceCapabilityLabel(device, capability)}</span>)}
        </div>
      </section>

      <section className="device-detail-section">
        <b>Recent commands</b>
        {commandsBusy && <small>Loading commands...</small>}
        {commandsError && <small className="device-command-error">{commandsError}</small>}
        {!commandsBusy && !commandsError && commands.length === 0 && <small>No commands yet.</small>}
        {commands.map((command) => {
          const commandAgent = snapshot.agents.find((agent) => agent.id === command.agentId);
          const errorText = deviceCommandErrorText(command);
          return (
            <button key={command.id} className={deviceCommandTerminalFailed(command) ? "device-command-row failed" : `device-command-row ${command.status}`} type="button" title="Open command details" aria-label="Open command details" onClick={() => void openCommandDetails(command)}>
              <span>
                <b>{deviceCapabilityLabel(device, command.capability)}</b>
                <small>{commandAgent?.displayName ?? command.agentId} · {relativeTime(command.createdAt)}</small>
                {command.errorMessage && <small className="device-command-error">{command.errorMessage}</small>}
              </span>
              <em>{deviceCommandStatusLabel(command.status)}</em>
              {errorText && !command.errorMessage && <small className="device-command-error">{errorText}</small>}
            </button>
          );
        })}
        <div className="device-page-controls">
          <button className="btn small" type="button" disabled={commandsBusy || commandsPagination.offset === 0} onClick={() => setCommandsPagination((page) => ({ ...page, offset: Math.max(0, page.offset - COMMAND_PAGE_SIZE) }))}>Previous</button>
          <small>{Math.floor(commandsPagination.offset / COMMAND_PAGE_SIZE) + 1}</small>
          <button className="btn small" type="button" disabled={commandsBusy || !commandsPagination.hasMore} onClick={() => setCommandsPagination((page) => ({ ...page, offset: page.offset + COMMAND_PAGE_SIZE }))}>Next</button>
        </div>
      </section>

      <div className="device-secondary-actions">
        <button className="btn small" type="button" onClick={() => void openDeviceAudit()}><Activity size={13} /> View audit</button>
      </div>

      {commandDetail && (
        <Modal title="COMMAND DETAILS" onClose={() => setCommandDetail(null)} className="template-form-modal template-form-modal-md" backdropClassName="template-form-modal-backdrop" titleIcon={<Terminal size={18} />}>
          <div className="template-dialog-content">
            <div className="template-dialog-body">
              {commandDetailBusy && <small className="devices-message">Loading command details...</small>}
              {commandDetailError && <small className="devices-message error">{commandDetailError}</small>}
              <div className="device-command-overview">
                <span><b>Method</b><small>{deviceCapabilityLabel(device, commandDetail.command.capability)}</small></span>
                <span><b>Status</b><small>{deviceCommandStatusLabel(commandDetail.command.status)}</small></span>
                <span><b>Agent</b><small>{snapshot.agents.find((agent) => agent.id === commandDetail.command.agentId)?.displayName ?? commandDetail.command.agentId}</small></span>
                <span><b>Created</b><small>{new Date(commandDetail.command.createdAt).toLocaleString()}</small></span>
              </div>
              <div className="device-command-detail-block">
                <b>Source message</b>
                <code>{commandDetail.command.requestedByMessageId ?? "Background access rule"}</code>
              </div>
              <div className="device-command-detail-block">
                <b>Result / error</b>
                <p>{commandDetail.command.errorMessage || commandDetail.command.errorCode || (commandDetail.command.data ? JSON.stringify(commandDetail.command.data) : "No result data.")}</p>
              </div>
              <div className="device-command-detail-block">
                <b>Audit timeline</b>
                <div className="device-audit-list">
                  {commandDetail.auditEvents.length === 0 && <small>No audit events</small>}
                  {commandDetail.auditEvents.map((event) => (
                    <span key={event.id}>
                      <b>{event.kind}</b>
                      <small>{new Date(event.createdAt).toLocaleString()}</small>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-actions template-dialog-actions">
              <button className="btn" type="button" onClick={() => setCommandDetail(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}

      {auditOpen && (
        <Modal title="MOBILE DEVICE AUDIT" onClose={() => setAuditOpen(false)} className="template-form-modal template-form-modal-md" backdropClassName="template-form-modal-backdrop" titleIcon={<Activity size={18} />}>
          <div className="template-dialog-content">
            <div className="template-dialog-body">
              <h3>{device.displayName}</h3>
              {auditBusy && <small className="devices-message">Loading audit...</small>}
              {auditError && <small className="devices-message error">{auditError}</small>}
              <div className="device-audit-list">
                {auditEvents.length === 0 && !auditBusy && <small>No audit events</small>}
                {auditEvents.map((event) => (
                  <span key={event.id}>
                    <b>{event.kind}</b>
                    <small>{new Date(event.createdAt).toLocaleString()}</small>
                  </span>
                ))}
              </div>
              <div className="device-page-controls">
                <button className="btn small" type="button" disabled={auditBusy || auditPagination.offset === 0} onClick={() => setAuditPagination((page) => ({ ...page, offset: Math.max(0, page.offset - AUDIT_PAGE_SIZE) }))}>Previous</button>
                <small>{Math.floor(auditPagination.offset / AUDIT_PAGE_SIZE) + 1}</small>
                <button className="btn small" type="button" disabled={auditBusy || !auditPagination.hasMore} onClick={() => setAuditPagination((page) => ({ ...page, offset: page.offset + AUDIT_PAGE_SIZE }))}>Next</button>
              </div>
            </div>
            <div className="modal-actions template-dialog-actions">
              <button className="btn" type="button" onClick={() => setAuditOpen(false)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </article>
  );
}
