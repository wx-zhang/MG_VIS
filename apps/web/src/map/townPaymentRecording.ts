import { useEffect, useMemo, useState } from 'react';
import type { AppSnapshot, TopologyLiveWorkPayload } from '@tyr-ai/contracts';
import { workspaceSpatialDirectedLiveWork, workspaceSpatialDirectedSnapshot, type WorkspaceSpatialRehearsalPlan } from '../workspaceSpatialMotionDirector';

const EMPTY: TopologyLiveWorkPayload = { executions: [], flows: [], activities: [], bridgeMessages: [], bridgeJourneys: [], truncated: false };
type Cue = { phase: 'idle' | 'bridge' | 'receive' | 'approve' | 'settle'; peer: 'bank' | 'mira' | 'sable'; from?: 'bank' | 'mira' | 'sable'; at: number };

/** A frontend illustration of an authorized payment, with no financial or runtime actions. */
export function useTownPaymentRecording(source: AppSnapshot | null, enabled: boolean) {
 const [cue, setCue] = useState<Cue>({ phase: 'idle', peer: 'bank', at: 0 });
 useEffect(() => {
  if (!enabled) return;
  const receive = (event: Event) => {
   const detail = (event as CustomEvent).detail;
   if (['idle', 'bridge', 'receive', 'approve', 'settle'].includes(detail?.phase) && ['bank', 'mira', 'sable'].includes(detail?.peer)) setCue(previous => ({ ...detail, at: detail.phase === 'receive' ? previous.at : Date.now() }));
  };
  window.addEventListener('town-payment-film', receive);
  return () => window.removeEventListener('town-payment-film', receive);
 }, [enabled]);
 return useMemo(() => {
  if (!source || !enabled) return { snapshot: source, liveWork: EMPTY };
  const site = source.currentServer!.slug;
  const trio = site === 'bank' && new URLSearchParams(location.search).get('film-layout') === 'payment-trio';
  const peerId = `demo-${cue.peer}`;
  const keep = (name: string) => ['TYR', 'sable.booking', 'bank.service', 'bank.ledger', 'mira.personal'].includes(name);
  let snapshot: AppSnapshot = { ...source,
   currentUser: { ...source.currentUser, displayName: site === 'mira' ? 'Mira' : `${source.currentServer!.name} operator` },
   humans: source.humans.map(human => ({ ...human, displayName: site === 'mira' ? 'Mira' : `${source.currentServer!.name} operator` })),
   agents: source.agents.filter(agent => keep(agent.displayName)),
   machines: source.machines.map(machine => ({ ...machine, agents: machine.agents?.filter(agent => keep(agent.displayName)) })),
   workspaceBridges: source.workspaceBridges?.filter(bridge => trio ? ['demo-sable','demo-mira'].includes(bridge.peerWorkspace?.id??'') : bridge.peerWorkspace?.id === peerId),
   peerWorkspaceTopologies: source.peerWorkspaceTopologies?.filter(peer => trio ? ['demo-sable','demo-mira'].includes(peer.workspace.id) : peer.workspace.id === peerId).map(peer => ({ ...peer, agents: peer.agents.filter(agent => keep(agent.displayName)), workspace: {...peer.workspace,ownerDisplayName:peer.workspace.name==='Mira'?'Mira':peer.workspace.ownerDisplayName} })),
   workspaceBridgeTopologyEdges: source.workspaceBridgeTopologyEdges?.filter(edge => trio ? [edge.workspaceAId,edge.workspaceBId].some(id=>['demo-sable','demo-mira'].includes(id)) : [edge.workspaceAId, edge.workspaceBId].includes(peerId)),
   crossWorkspaceMessages: [], messages: [], channels: [], communicationAgentProgress: []
  };
  const tyr = snapshot.agents.find(agent => agent.kind === 'communication')!;
  const at = new Date(cue.at || Date.now()).toISOString();
  const id = `film:payment:${cue.at}`;
  let liveWork = EMPTY;
  const bridge = snapshot.workspaceBridges?.find(b=>b.peerWorkspace?.id===peerId), peer = snapshot.peerWorkspaceTopologies?.find(p=>p.workspace.id===peerId);
  if ((cue.phase === 'bridge' || cue.phase === 'receive') && bridge && peer) {
   const peerTyr = peer.agents.find(agent => agent.kind === 'communication')!;
   const inbound = trio && cue.from !== 'bank';
   const senderTyr = inbound ? peerTyr : tyr, receiverTyr = inbound ? tyr : peerTyr;
   const senderId = inbound ? peer.workspace.id : source.currentServer!.id, receiverId = inbound ? source.currentServer!.id : peer.workspace.id;
   const label = trio ? inbound ? 'Payment request · Sable → Bank' : cue.peer==='sable' ? 'Settlement result · Bank → Sable' : 'Payment authorization · Bank → Mira' : site === 'sable' ? 'Payment request · Sable → Bank' : site === 'bank' ? 'Payment authorization request · Bank → Mira' : 'Approved payment · Mira → Bank';
   const plan: WorkspaceSpatialRehearsalPlan = { id, cue: 'bridge_relay', label, phase: 'active', startedAtMs: cue.at, phaseStartedAtMs: cue.at, endsAtMs: cue.at + 30000, targets: [], bridgeTarget: { bridgeId: bridge.id, peerWorkspaceId: peer.workspace.id, peerWorkspaceName: peer.workspace.name, sourceControllerAgentId: tyr.id, targetControllerAgentId: peerTyr.id } };
   snapshot = workspaceSpatialDirectedSnapshot(snapshot, plan);
   snapshot = {...snapshot,crossWorkspaceMessages:snapshot.crossWorkspaceMessages?.map(message=>({...message,sourceWorkspaceId:senderId,targetWorkspaceId:receiverId,senderCommsAgentId:senderTyr.id,receiverCommsAgentId:receiverTyr.id,content:label,outcome:cue.phase==='receive'?'delivered':'pending'}))};
   liveWork = { ...EMPTY, bridgeMessages:snapshot.crossWorkspaceMessages?.map(message=>({...message,updatedAt:message.updatedAt??message.createdAt})), bridgeJourneys: [{ id, bridgeId: bridge.id, requestMessageId: `${id}:message`, dispatchGroupId: id, dispatchReadyAt: at, actorMode: 'direct', sourceWorkspaceId: senderId, targetWorkspaceId: receiverId, sourceAgentId: senderTyr.id, targetAgentId: receiverTyr.id, targetDisplayName: `${inbound?source.currentServer!.name:peer.workspace.name} TYR`, phase: cue.phase === 'receive' ? 'received' : 'dispatching', label, phaseAt: at, continuous: true, createdAt: at, updatedAt: at }] };
  }
  const miraWork=trio&&cue.phase==='approve';
  const mira=snapshot.peerWorkspaceTopologies?.find(p=>p.workspace.id==='demo-mira');
  const workers=miraWork?mira?.agents??[]:snapshot.agents;
  const workWorkspaceId=miraWork?mira!.workspace.id:source.currentServer!.id;
  const workTyr=miraWork?workers.find(agent=>agent.kind==='communication')!:tyr;
  const target = workers.find(agent => agent.displayName === (miraWork||site === 'mira' ? 'mira.personal' : 'bank.ledger'));
  if (target && (cue.phase === 'approve' || cue.phase === 'settle')) {
   const plan: WorkspaceSpatialRehearsalPlan = { id, cue: 'runtime_relay', label: cue.phase === 'approve' ? 'Mira authorizes the payment' : 'Authorized settlement · bank.ledger', phase: 'tool_running', startedAtMs: cue.at, phaseStartedAtMs: cue.at, endsAtMs: cue.at + 30000, targets: [{ workspaceId: workWorkspaceId, machineId: target.machineId!, machineName: `${miraWork?'Mira':source.currentServer!.name} Computer`, agentId: target.id, agentName: target.displayName }], sourceControllerAgentId: workTyr.id };
   snapshot = workspaceSpatialDirectedSnapshot(snapshot, plan);
   liveWork = workspaceSpatialDirectedLiveWork(EMPTY, plan);
  }
  return { snapshot, liveWork };
 }, [source, enabled, cue]);
}
