import type { AgentRecord, AppSnapshot, MachineRecord, WorkspaceBridgeRecord } from '@tyr-ai/contracts';
import { TOWN_CAST, FRONTEND_TOWN } from './frontendTownDemo';
import { emptyWorkspaceCache } from '../app/workspaceUtils';
const AT='2026-10-03T00:00:00Z';
function resources(site:string) {
 const cast=TOWN_CAST.find(c=>c.site===site)!;
 const id=`demo-${site}`, ownerId=`${id}-owner`, machineId=`${id}-computer`;
 const names=[...cast.subagents];
 while(names.length<cast.agents-1) names.push(`Demo helper ${names.length+1}`);
 const agents:AgentRecord[]=[{id:`${id}-tyr`,serverId:id,ownerUserId:ownerId,machineId:null,kind:'communication',name:'tyr',displayName:'TYR',runtime:null,status:'online',authToken:'',createdAt:AT,updatedAt:AT},...names.map((name,index):AgentRecord=>({id:`${id}-agent-${index}`,serverId:id,ownerUserId:ownerId,machineId,kind:'on_device',name,displayName:name,runtime:'codex',status:'online',authToken:'',createdAt:AT,updatedAt:AT}))];
 const machines:MachineRecord[]=[{id:machineId,serverId:id,ownerUserId:ownerId,name:`${cast.name} Computer`,hostname:`${site}.demo.local`,os:'Windows',daemonVersion:'frontend-demo',status:'online',apiKey:'',createdAt:AT,lastSeenAt:AT}];
 return {cast,id,ownerId,agents,machines};
}
export function frontendWorkspaceSnapshot(site:string):AppSnapshot {
 const current=resources(site);
 const bridges:WorkspaceBridgeRecord[]=FRONTEND_TOWN.bridges.filter(b=>b.workspaceAId===current.id||b.workspaceBId===current.id).map(b=>{
  const peerId=b.workspaceAId===current.id?b.workspaceBId:b.workspaceAId;
  const peer=resources(peerId.replace('demo-',''));
  return {...b,status:'active',scope:'workspace_topology',permissions:['chat'],invitedByUserId:current.ownerId,invitedByDisplayName:`${current.cast.name} Owner`,approvedByAUserId:null,approvedByBUserId:null,createdAt:AT,acceptedAt:AT,revokedAt:null,lastActivityAt:null,peerWorkspace:{id:peer.id,name:peer.cast.name,ownerUserId:peer.ownerId,ownerDisplayName:`${peer.cast.name} Owner`,onboardingAgentId:null}};
 });
 const owner={id:current.ownerId,name:`${current.cast.name} Owner`,displayName:`${current.cast.name} Owner`,createdAt:AT};
 return {...emptyWorkspaceCache,currentUser:owner,humans:[owner],currentServer:{id:current.id,name:current.cast.name,slug:site,ownerId:current.ownerId,onboardingAgentId:null,plan:'enterprise',planDowngradedAt:null,role:'owner',createdAt:AT},agents:current.agents,machines:current.machines.map(m=>({...m,latestDaemonVersion:'frontend-demo',runtimes:[],agents:current.agents.filter(a=>a.machineId===m.id)})),workspaceBridges:bridges,peerWorkspaceTopologies:bridges.map(bridge=>{
 const peer=resources(bridge.peerWorkspace!.id.replace('demo-',''));
 return {bridgeId:bridge.id,bridge,parentWorkspaceId:current.id,distance:1,bridgePath:[bridge.id],workspace:bridge.peerWorkspace!,assistant:peer.agents[0],agents:peer.agents,machines:peer.machines};
 }),workspaceBridgeTopologyEdges:bridges.map(bridge=>({bridgeId:bridge.id,bridge,workspaceAId:bridge.workspaceAId,workspaceBId:bridge.workspaceBId}))};
}
