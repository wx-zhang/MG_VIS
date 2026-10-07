import { useEffect, useMemo, useState } from 'react';
import type { AppSnapshot, TopologyLiveWorkPayload } from '@tyr-ai/contracts';
import { workspaceSpatialDirectedLiveWork, workspaceSpatialDirectedSnapshot, type WorkspaceSpatialRehearsalPlan } from '../workspaceSpatialMotionDirector';

export type HealthUploadFilmPhase = 'idle' | 'research' | 'instruction' | 'bridge' | 'accepted' | 'prepare' | 'file_ready' | 'upload_instruction' | 'upload_bridge' | 'upload_accepted' | 'launch' | 'upload' | 'failed';
const PHASES: HealthUploadFilmPhase[] = ['idle','research','instruction','bridge','accepted','prepare','file_ready','upload_instruction','upload_bridge','upload_accepted','launch','upload','failed'];
const EMPTY: TopologyLiveWorkPayload = {executions:[],flows:[],activities:[],bridgeMessages:[],bridgeJourneys:[],truncated:false};

/** DEV recording projection only: no API calls, messages or runtime actions are sent. */
export function useHealthUploadRecording(source: AppSnapshot | null, enabled: boolean) {
 const [cue,setCue] = useState<{phase:HealthUploadFilmPhase;at:number;requestAt:number}>({phase:'idle',at:0,requestAt:0});
 useEffect(()=>{
  if(!enabled)return;
  const receive=(event:Event)=>{const phase=(event as CustomEvent).detail?.phase;if(PHASES.includes(phase)){const at=Date.now();setCue(previous=>({phase,at,requestAt:phase==='accepted'||phase==='upload_accepted'?previous.requestAt:at}));}};
  window.addEventListener('health-upload-film',receive);
  return ()=>window.removeEventListener('health-upload-film',receive);
 },[enabled]);
 return useMemo(()=>{
  if(!source||!enabled)return {snapshot:source,liveWork:EMPTY,phase:cue.phase};
  const site=source.currentServer?.slug;
  const continuous=new URLSearchParams(location.search).get('film-layout')==='continuous'&&site==='dorian';
  const peerId=site==='dorian'?'demo-mira':'demo-dorian';
  const fresh=['launch','upload','failed'].includes(cue.phase);
  const keep=(name:string)=>name==='TYR'||name==='dorian.personal'||name==='mira.personal'||(fresh&&name==='diagnostic-upload-executor');
  const local=source.agents.filter(a=>keep(a.displayName));
  let snapshot:AppSnapshot={...source,
   currentUser:{...source.currentUser,displayName:site==='dorian'?'Dorian':'Mira'},
   humans:source.humans.map(h=>({...h,displayName:site==='dorian'?'Dorian':'Mira'})),
   agents:local,
   machines:source.machines.map(m=>({...m,agents:m.agents?.filter(a=>keep(a.displayName))})),
   workspaceBridges:source.workspaceBridges?.filter(b=>b.peerWorkspace?.id===peerId),
   peerWorkspaceTopologies:source.peerWorkspaceTopologies?.filter(t=>t.workspace.id===peerId).map(t=>({...t,agents:t.agents.filter(a=>keep(a.displayName)),workspace:{...t.workspace,ownerDisplayName:site==='dorian'?'Mira':'Dorian'}})),
   workspaceBridgeTopologyEdges:source.workspaceBridgeTopologyEdges?.filter(e=>[e.workspaceAId,e.workspaceBId].includes(peerId)),
   crossWorkspaceMessages:[],channels:[],messages:[],communicationAgentProgress:[]
  };
  const at=new Date(cue.at||Date.now()).toISOString();
  const wid=source.currentServer!.id;
  const tyr=local.find(a=>a.kind==='communication')!;
  const personal=local.find(a=>a.displayName===(site==='dorian'?'dorian.personal':'mira.personal'));
  const executor=local.find(a=>a.displayName==='diagnostic-upload-executor');
  let liveWork=EMPTY;
  if(cue.phase==='instruction'||cue.phase==='upload_instruction'){
   const id=`film:${cue.phase}:${cue.at}`;
   snapshot={...snapshot,channels:[{id,serverId:wid,type:'dm',name:'recording-request',displayName:'Dorian → TYR',dmPeerAgentId:tyr.id,visibility:'private',createdAt:at}],messages:[{id,channelId:id,senderType:'human',senderId:snapshot.currentUser.id,senderName:'Dorian',content:cue.phase==='instruction'?'Ask Mira through the Bridge to prepare the diagnostic file.':'Ask Mira through the Bridge to launch a fresh upload Agent.',seq:1,createdAt:at}],communicationAgentProgress:[{operationId:id,sourceMessageId:id,channelId:id,assistantAgentId:tyr.id,source:'web',phase:'understanding',label:'Understanding Dorian’s request',startedAt:at,updatedAt:at}]};
  }
  const bridge=snapshot.workspaceBridges?.[0];
  const peer=snapshot.peerWorkspaceTopologies?.[0];
  if(bridge&&peer&&['bridge','accepted','upload_bridge','upload_accepted'].includes(cue.phase)){
   const accepted=cue.phase==='accepted'||cue.phase==='upload_accepted';
   const second=cue.phase==='upload_bridge'||cue.phase==='upload_accepted';
   const peerTyr=peer.agents.find(a=>a.kind==='communication')!;
   const requestId=`film:bridge:${cue.requestAt}`;
   const plan:WorkspaceSpatialRehearsalPlan={id:requestId,cue:'bridge_relay',label:'Dorian → Mira',phase:accepted?'bridge_accepted':'active',startedAtMs:cue.requestAt,phaseStartedAtMs:cue.at,endsAtMs:cue.at+30000,targets:[],bridgeTarget:{bridgeId:bridge.id,peerWorkspaceId:peer.workspace.id,peerWorkspaceName:peer.workspace.name,sourceControllerAgentId:tyr.id,targetControllerAgentId:peerTyr.id}};
   snapshot=workspaceSpatialDirectedSnapshot(snapshot,plan);
   snapshot={...snapshot,crossWorkspaceMessages:snapshot.crossWorkspaceMessages?.map(m=>({...m,content:second?'Launch a fresh upload Agent beside the verified file.':'Prepare the file under the retained local instructions.'}))};
   liveWork={...EMPTY,bridgeMessages:snapshot.crossWorkspaceMessages?.map(message=>({...message,updatedAt:message.updatedAt??message.createdAt})),bridgeJourneys:[{
    id:requestId,bridgeId:bridge.id,requestMessageId:`${requestId}:message`,dispatchGroupId:requestId,dispatchReadyAt:new Date(cue.requestAt).toISOString(),actorMode:'direct',sourceWorkspaceId:wid,targetWorkspaceId:peer.workspace.id,sourceAgentId:tyr.id,targetAgentId:peerTyr.id,targetDisplayName:'Mira TYR',phase:accepted?'received':'dispatching',label:second?'Request 2 · launch a fresh upload Agent':'Request 1 · retained local instructions',phaseAt:at,continuous:true,createdAt:new Date(cue.requestAt).toISOString(),updatedAt:at
   }]};
  }
  const peerWork=continuous&&cue.phase!=='research';
  const workers=peerWork?peer?.agents??[]:local;
  const target=['launch','upload','failed'].includes(cue.phase)
   ? workers.find(a=>a.displayName==='diagnostic-upload-executor')??executor
   : peerWork?workers.find(a=>a.displayName==='mira.personal'):personal;
  const workWorkspaceId=peerWork?peer!.workspace.id:wid;
  const workTyr=peerWork?workers.find(a=>a.kind==='communication')!:tyr;
  if(target&&['research','prepare','file_ready','launch','upload','failed'].includes(cue.phase)){
   const returning=cue.phase==='file_ready';
   const plan:WorkspaceSpatialRehearsalPlan={id:`film:${cue.phase}:${cue.at}`,cue:'runtime_relay',label:target.displayName,phase:returning?'returning':'tool_running',startedAtMs:cue.at,phaseStartedAtMs:cue.at,endsAtMs:cue.at+30000,targets:[{workspaceId:workWorkspaceId,machineId:target.machineId!,machineName:peerWork||site==='mira'?'Mira Computer':'Dorian Computer',agentId:target.id,agentName:target.displayName}],sourceControllerAgentId:workTyr.id};
   snapshot=workspaceSpatialDirectedSnapshot(snapshot,plan);
   liveWork=workspaceSpatialDirectedLiveWork(EMPTY,plan);
   if(cue.phase==='upload'||cue.phase==='failed')liveWork={...liveWork,activities:liveWork.activities.map(a=>({...a,summary:'Verified health-diagnostic.json → Collector'}))};
  }
  return {snapshot,liveWork,phase:cue.phase};
 },[source,enabled,cue]);
}
