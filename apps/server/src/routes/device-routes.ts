import type express from "express";
import { type AuditEventRecord, type DeviceCapability, type DeviceCommandRecord, type DeviceGrantRecord, type DeviceGrantScope } from "@tyr-ai/contracts";
import { dispatchDeviceCommand } from "../device-command-lifecycle";
import type { ServerRouteContext } from "../server-context";

const DEVICE_GRANT_SCOPES: DeviceGrantScope[] = ["once", "time_boxed", "task"];

function isDeviceCapabilityId(value: unknown): value is DeviceCapability {
  return typeof value === "string" && value.trim().length > 0;
}

function isDeviceGrantScope(value: unknown): value is DeviceGrantScope {
  return typeof value === "string" && DEVICE_GRANT_SCOPES.includes(value as DeviceGrantScope);
}

function requestedCapabilities(value: unknown): DeviceCapability[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((capability): capability is DeviceCapability => {
    if (!isDeviceCapabilityId(capability) || seen.has(capability)) return false;
    seen.add(capability);
    return true;
  });
}

function deviceDeclaresCapability(device: { capabilities: DeviceCapability[] }, capability: DeviceCapability): boolean {
  return device.capabilities.includes(capability);
}

function publicDevice(device: ReturnType<ServerRouteContext["store"]["getDevice"]>) {
  if (!device) return null;
  return { ...device, deviceToken: undefined };
}

function agentAllowedForUser(ctx: ServerRouteContext, userId: string, serverId: string, agentId: string) {
  const agent = ctx.store.getAgent(agentId);
  const machine = agent?.machineId ? ctx.store.getMachine(agent.machineId) : null;
  if (!agent || !machine || (machine.serverId ?? "local") !== serverId) return null;
  return ctx.store.canUserAccessResource(userId, "agent", agent.id, "message") ? agent : null;
}

function compareAuditEvents(a: AuditEventRecord, b: AuditEventRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function compareAuditEventsDesc(a: AuditEventRecord, b: AuditEventRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

function compareDeviceCommandsDesc(a: DeviceCommandRecord, b: DeviceCommandRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

function pageParams(query: express.Request["query"], defaults: { limit: number; max: number }) {
  const rawLimit = Number(query.limit ?? defaults.limit);
  const rawOffset = Number(query.offset ?? 0);
  return {
    limit: Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : defaults.limit, defaults.max)),
    offset: Math.max(0, Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0)
  };
}

function paginate<T>(items: T[], limit: number, offset: number) {
  return {
    page: items.slice(offset, offset + limit),
    pagination: {
      limit,
      offset,
      hasMore: offset + limit < items.length
    }
  };
}

function deviceAuditEvents(ctx: ServerRouteContext, deviceId: string, serverId: string): AuditEventRecord[] {
  const limit = 1000;
  const deviceEvents = ctx.store.listAuditEvents({ serverId, resourceType: "device", resourceId: deviceId, limit, order: "asc" });
  const commandIds = ctx.store.listDeviceCommands(deviceId).map((command) => command.id);
  const grantIds = ctx.store.listDeviceGrants({ serverId, deviceId }).map((grant: DeviceGrantRecord) => grant.id);
  const commandEvents = commandIds.length
    ? ctx.store.listAuditEvents({ serverId, resourceType: "device_command", resourceIds: commandIds, limit, order: "asc" })
    : [];
  const grantEvents = grantIds.length
    ? ctx.store.listAuditEvents({ serverId, resourceType: "device_grant", resourceIds: grantIds, limit, order: "asc" })
    : [];
  return [...deviceEvents, ...commandEvents, ...grantEvents].sort(compareAuditEvents);
}

export function registerDeviceRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, publicServerUrl, requireAuthUser, primaryServerIdForUser } = ctx;

  function resolveDeviceRequest(req: express.Request, res: express.Response) {
    const user = requireAuthUser(req, res);
    if (!user) return null;
    const device = store.getDevice(String(req.params.deviceId));
    if (!device) {
      res.status(404).json({ error: "device_not_found" });
      return null;
    }
    const nativeServerId = primaryServerIdForUser(user.id);
    const bridgeCapability = device.serverId === nativeServerId
      ? null
      : ctx.resolveWorkspaceBridgeCapability?.(user.id, device.serverId) ?? null;
    if (device.serverId !== nativeServerId && !bridgeCapability) {
      res.status(404).json({ error: "device_not_found" });
      return null;
    }
    return {
      user,
      device,
      bridgeCapability,
      capabilityUserId: bridgeCapability?.capabilityUserId ?? user.id
    };
  }

  app.post("/api/devices/pairing", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = primaryServerIdForUser(user.id);
    if (!serverId) {
      res.status(400).json({ error: "server_required" });
      return;
    }
    const pairing = store.createDevicePairingToken({
      serverId,
      createdByUserId: user.id,
      displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined
    });
    res.json(pairing);
  });

  app.post("/api/devices/mobile-pairing", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = primaryServerIdForUser(user.id);
    if (!serverId) {
      res.status(400).json({ error: "server_required" });
      return;
    }
    const pinnedAgentId = typeof req.body?.pinnedAgentId === "string" ? req.body.pinnedAgentId : "";
    const agent = pinnedAgentId ? agentAllowedForUser(ctx, user.id, serverId, pinnedAgentId) : null;
    if (!agent) {
      res.status(400).json({ error: "pinned_agent_required" });
      return;
    }
    const pairing = store.createDevicePairingToken({
      serverId,
      createdByUserId: user.id,
      displayName: typeof req.body?.displayName === "string" && req.body.displayName.trim() ? req.body.displayName.trim() : "TYR Mobile Device",
      pinnedAgentId: agent.id
    });
    res.json(pairing);
  });

  app.get("/api/devices", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const rawLimit = Number(req.query.limit);
    res.json(store.listVisibleDevices(user.id, {
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined
    }));
  });

  app.get("/api/devices/:deviceId", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { device } = access;
    res.json({
      device: publicDevice(device),
      mobileBinding: store.getMobileAppBindingByDevice(device.id),
      grants: store.listDeviceGrants({ serverId: device.serverId, deviceId: device.id }),
      accessRules: store.listDeviceGrants({ serverId: device.serverId, deviceId: device.id }),
      commands: store.listDeviceCommands(device.id)
    });
  });

  app.patch("/api/devices/:deviceId/mobile-binding", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { user, device, bridgeCapability, capabilityUserId } = access;
    if (!bridgeCapability && device.ownerUserId !== user.id) {
      res.status(404).json({ error: "device_not_found" });
      return;
    }
    const binding = store.getMobileAppBindingByDevice(device.id);
    if (!binding) {
      res.status(409).json({ error: "mobile_app_binding_required" });
      return;
    }
    const pinnedAgentId = typeof req.body?.pinnedAgentId === "string" ? req.body.pinnedAgentId : "";
    const agent = pinnedAgentId ? agentAllowedForUser(ctx, capabilityUserId, device.serverId, pinnedAgentId) : null;
    if (!agent) {
      res.status(403).json({ error: "mobile_agent_not_allowed" });
      return;
    }
    const channel = store.getOrCreateAgentDm(agent.id, capabilityUserId);
    const updated = channel ? store.setMobileAppPinnedAgent(binding.id, agent.id, channel.id) : null;
    if (!channel || !updated) {
      res.status(403).json({ error: "mobile_agent_not_allowed" });
      return;
    }
    store.recordAuditEvent({
      kind: "mobile_app_pinned_agent_changed",
      actorType: "user",
      actorId: user.id,
      resourceType: "mobile_app_binding",
      resourceId: updated.id,
      serverId: updated.serverId,
      metadata: {
        agentId: agent.id,
        channelId: channel.id,
        capabilityUserId,
        bridgePath: bridgeCapability?.bridgePath ?? [],
        sourceWorkspaceId: bridgeCapability?.sourceWorkspaceId ?? null
      }
    });
    ctx.publishWorkspaceSync();
    res.json({
      binding: updated,
      device: publicDevice(device),
      agent: ctx.formatAgentListItem(agent, { serverId: device.serverId, creator: null }),
      channel: ctx.formatChannel(channel)
    });
  });

  app.delete("/api/devices/:deviceId/mobile-binding", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { user, device, bridgeCapability, capabilityUserId } = access;
    if (!bridgeCapability && device.ownerUserId !== user.id) {
      res.status(404).json({ error: "device_not_found" });
      return;
    }
    const binding = store.getMobileAppBindingByDevice(device.id);
    if (!binding) {
      res.status(409).json({ error: "mobile_app_binding_required" });
      return;
    }
    const revoked = store.revokeMobileAppBinding(binding.id);
    if (!revoked) {
      res.status(409).json({ error: "mobile_app_binding_required" });
      return;
    }
    store.recordAuditEvent({
      kind: "mobile_app_unbound",
      actorType: "user",
      actorId: user.id,
      resourceType: "mobile_app_binding",
      resourceId: revoked.id,
      serverId: revoked.serverId,
      metadata: {
        deviceId: device.id,
        source: "web",
        capabilityUserId,
        bridgePath: bridgeCapability?.bridgePath ?? [],
        sourceWorkspaceId: bridgeCapability?.sourceWorkspaceId ?? null
      }
    });
    ctx.publishWorkspaceSync();
    res.json({ binding: revoked, device: publicDevice(device) });
  });

  app.delete("/api/devices/:deviceId", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { user, device, bridgeCapability, capabilityUserId } = access;
    if (!bridgeCapability && device.ownerUserId !== user.id) {
      res.status(404).json({ error: "device_not_found" });
      return;
    }
    const deleted = store.deleteDevice(device.id, bridgeCapability ? undefined : user.id);
    if (!deleted) {
      res.status(404).json({ error: "device_not_found" });
      return;
    }
    if (bridgeCapability) {
      store.recordAuditEvent({
        kind: "workspace_bridge_device_deleted",
        actorType: "user",
        actorId: user.id,
        resourceType: "device",
        resourceId: device.id,
        serverId: device.serverId,
        metadata: {
          capabilityUserId,
          bridgePath: bridgeCapability.bridgePath,
          sourceWorkspaceId: bridgeCapability.sourceWorkspaceId,
          targetWorkspaceId: bridgeCapability.targetWorkspaceId
        }
      });
    }
    ctx.publishWorkspaceSync();
    res.json({ device: publicDevice(deleted) });
  });

  app.get("/api/devices/:deviceId/connect-command", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { user, device, bridgeCapability } = access;
    if (bridgeCapability) {
      res.status(403).json({ error: "device_credential_owner_required" });
      return;
    }
    if (device.ownerUserId !== user.id) {
      res.status(403).json({ error: "device_owner_required" });
      return;
    }
    if (!device.deviceToken) {
      res.status(409).json({ error: "device_token_required" });
      return;
    }
    const serverUrl = publicServerUrl.replace(/\/$/, "");
    // 已配对 Android App 重连只需要长期 device token；不再返回 mock CLI 命令，避免客户界面出现调试路径。
    res.json({
      serverUrl,
      deviceToken: device.deviceToken
    });
  });

  app.get("/api/devices/:deviceId/audit", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { device } = access;
    const { limit, offset } = pageParams(req.query, { limit: 10, max: 100 });
    const allEvents = deviceAuditEvents(ctx, device.id, device.serverId).sort(compareAuditEventsDesc);
    const { page, pagination } = paginate(allEvents, limit, offset);
    res.json({ auditEvents: page, pagination });
  });

  app.get("/api/devices/:deviceId/commands", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { device } = access;
    const { limit, offset } = pageParams(req.query, { limit: 5, max: 50 });
    const allCommands = store.listDeviceCommands(device.id).sort(compareDeviceCommandsDesc);
    const { page, pagination } = paginate(allCommands, limit, offset);
    res.json({ commands: page, pagination });
  });

  app.get("/api/devices/:deviceId/commands/:commandId", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { device } = access;
    const command = store.getDeviceCommand(String(req.params.commandId));
    if (!command || command.deviceId !== device.id || command.serverId !== device.serverId) {
      res.status(404).json({ error: "device_command_not_found" });
      return;
    }
    res.json({
      command,
      auditEvents: store.listAuditEvents({ serverId: device.serverId, resourceType: "device_command", resourceId: command.id, limit: 100, order: "asc" })
    });
  });

  function createAccessRule(req: express.Request, res: express.Response) {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { user, device } = access;
    const agentId = typeof req.body?.agentId === "string" ? req.body.agentId : "";
    const agent = agentId ? store.getAgent(agentId) : null;
    const capabilities = requestedCapabilities(req.body?.capabilities);
    const scope = isDeviceGrantScope(req.body?.scope) ? req.body.scope : "time_boxed";
    if (!agent || !capabilities.length) {
      res.status(400).json({ error: "invalid_device_grant" });
      return;
    }
    if (capabilities.some((capability) => !deviceDeclaresCapability(device, capability))) {
      res.status(400).json({ error: "device_capability_unavailable" });
      return;
    }
    const grant = store.createDeviceGrant({
      serverId: device.serverId,
      agentId: agent.id,
      deviceId: device.id,
      capabilities,
      scope,
      expiresAt: typeof req.body?.expiresAt === "string" ? req.body.expiresAt : new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdByUserId: user.id
    });
    ctx.publishWorkspaceSync();
    res.json({ grant, accessRule: grant });
  }

  app.post("/api/devices/:deviceId/access-rules", createAccessRule);
  app.post("/api/devices/:deviceId/grants", createAccessRule);

  app.post("/api/devices/:deviceId/commands", (req, res) => {
    const access = resolveDeviceRequest(req, res);
    if (!access) return;
    const { device } = access;
    const capability = req.body?.capability;
    if (!isDeviceCapabilityId(capability)) {
      res.status(400).json({ error: "invalid_device_capability" });
      return;
    }
    if (!deviceDeclaresCapability(device, capability)) {
      res.status(400).json({ error: "device_capability_unavailable" });
      return;
    }
    const agentId = typeof req.body?.agentId === "string" ? req.body.agentId : "";
    const agent = agentId ? store.getAgent(agentId) : null;
    if (!agent) {
      res.status(400).json({ error: "agent_required" });
      return;
    }
    const grant = store.findActiveDeviceGrant(agent.id, device.id, capability, device.serverId);
    if (!grant) {
      res.status(403).json({ error: "device_access_required" });
      return;
    }
    const requestedByMessageId = typeof req.body?.requestedByMessageId === "string" ? req.body.requestedByMessageId : undefined;
    const message = requestedByMessageId ? store.getMessage(requestedByMessageId) : null;
    const command = store.createDeviceCommand({
      serverId: device.serverId,
      agentId: agent.id,
      deviceId: device.id,
      grantId: grant.id,
      capability,
      params: typeof req.body?.params === "object" && req.body.params ? req.body.params : {},
      requestedByMessageId,
      channelId: message?.channelId,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      expiresAt: typeof req.body?.expiresAt === "string" ? req.body.expiresAt : new Date(Date.now() + 2 * 60 * 1000).toISOString()
    });
    res.json(dispatchDeviceCommand(ctx, command));
  });
}
