import { useState } from "react";
import { useLocation } from "react-router-dom";
import type { CityCameraPose } from "../map/operatorCityMapModel";
import { FRONTEND_TOWN } from "../map/frontendTownDemo";
import { OperatorCityOverview } from "./OperatorCityOverview";
import { FrontendWorkspaceApp } from "./FrontendWorkspaceApp";

// Standalone presentation: no session checks, workspace API calls or runtime actions.
export function FrontendTownApp() {
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [connections, setConnections] = useState(true);
  const [cameraPose, setCameraPose] = useState<CityCameraPose | null>(null);
  const workspace = new URLSearchParams(location.search).get("workspace");
  if (workspace?.startsWith("demo-")) return <FrontendWorkspaceApp />;
  return <OperatorCityOverview
    demoOnly
    operatorUser={{ id: "demo-visitor", name: "Visitor", displayName: "Visitor", createdAt: "" }}
    overview={FRONTEND_TOWN} workspaces={FRONTEND_TOWN.workspaces}
    returnFromWorkspaceId={null} search={search} onSearchChange={setSearch}
    connections={connections} onConnectionsChange={setConnections}
    cameraPose={cameraPose} onCameraPoseChange={setCameraPose}
    backLabel={null} loading={false} error=""
    onOpenWorkspace={async () => false} onBack={() => {}}
    onRefresh={() => {}} onLogout={() => {}}
  />;
}
