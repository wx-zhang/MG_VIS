import type express from "express";
import type { MachineOnboardingConsumePayload, MachineOnboardingPublicPayload } from "@tyr-ai/contracts";
import { machineOnboardingCommandSet } from "../connect-commands";
import { createMachineOnboardingLink } from "../machine-onboarding-service";
import type { ServerRouteContext } from "../server-context";

export function registerMachineOnboardingRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, publicServerUrl, authUser, primaryServerIdForUser, isServerMember, emitRealtimeMachineUpdated } = ctx;

  app.post("/api/machines/onboarding-intents", (req, res) => {
    const user = authUser(req);
    const requestedServerId = typeof req.body?.serverId === "string" ? req.body.serverId.trim() : "";
    const serverId = requestedServerId || primaryServerIdForUser(user.id);
    if (!serverId || !isServerMember(user.id, serverId)) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    const serverRecord = store.listServersForUser(user.id).find((item) => item.id === serverId);
    if (serverRecord?.role === "guest") {
      res.status(403).json({ error: "workspace_member_required" });
      return;
    }
    const requestedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const link = createMachineOnboardingLink({
      store,
      publicServerUrl,
      serverId,
      requestedByUserId: user.id,
      name: requestedName,
      emitRealtimeMachineUpdated
    });
    res.json(link);
  });
}

export function registerMachineOnboardingPublicRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, publicServerUrl } = ctx;

  app.get("/api/onboarding/machines/:code", (req, res) => {
    const code = req.params.code;
    const intent = store.getMachineOnboardingIntentByCode(code);
    if (!intent) {
      res.status(404).json({ status: "invalid" } satisfies MachineOnboardingPublicPayload);
      return;
    }
    const machine = store.getMachine(intent.machineId);
    const server = store.listServersForUser(intent.requestedByUserId).find((item) => item.id === intent.serverId);
    if (!machine || !server || intent.status !== "pending") {
      res.status(intent.status === "expired" ? 410 : 409).json({ status: intent.status } satisfies MachineOnboardingPublicPayload);
      return;
    }
    const commands = machineOnboardingCommandSet({ serverUrl: publicServerUrl, code, machineId: machine.id, machineName: machine.name });
    res.json({
      status: "pending",
      serverName: server.name,
      machineName: machine.name,
      expiresAt: intent.expiresAt,
      installCommand: commands.installCommand,
      windowsInstallCommand: commands.windowsInstallCommand
    } satisfies MachineOnboardingPublicPayload);
  });

  app.post("/api/onboarding/machines/:code/consume", (req, res) => {
    const consumed = store.consumeMachineOnboardingIntent(req.params.code);
    if (!consumed) {
      res.status(409).json({ error: "machine_onboarding_unavailable" });
      return;
    }
    const payload: MachineOnboardingConsumePayload = {
      machineId: consumed.machine.id,
      machineName: consumed.machine.name,
      serverUrl: publicServerUrl.replace(/\/$/, ""),
      credentialKind: "apiKey",
      credentialFlag: "--api-key",
      credentialValue: consumed.credential.value
    };
    res.json(payload);
  });
}
