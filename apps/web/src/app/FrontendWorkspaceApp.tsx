import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { WorkspaceSpatialView } from './WorkspaceSpatialView';
import { frontendWorkspaceSnapshot } from '../map/frontendWorkspaceDemo';
import { TOWN_CAST } from '../map/frontendTownDemo';
import { useHealthUploadRecording } from '../map/healthUploadRecording';
import { useTownPaymentRecording } from '../map/townPaymentRecording';
import type { TopologyOperatorContext } from './TopologyInspectorDetails';
const IDLE={executions:[],flows:[],activities:[],bridgeMessages:[],bridgeJourneys:[],truncated:false};
const READONLY_CONTEXT:TopologyOperatorContext={detectRuntimeModels:async()=>({models:[]}),updateAgent:async()=>({}),runAgentAction:async()=>{}};
export function FrontendWorkspaceApp() {
 const location=useLocation(), navigate=useNavigate();
 const selectedId=new URLSearchParams(location.search).get('workspace')??'';
 const site=selectedId.replace('demo-','');
 const cast=TOWN_CAST.find(c=>c.site===site);
 const snapshot=useMemo(()=>cast?frontendWorkspaceSnapshot(cast.site):null,[cast]);
 const filmMode=import.meta.env.DEV?new URLSearchParams(location.search).get('film'):null;
 const healthFilm=useHealthUploadRecording(snapshot,filmMode==='health-upload');
 const paymentFilm=useTownPaymentRecording(snapshot,filmMode==='town-payment');
 const filmEnabled=filmMode==='health-upload'||filmMode==='town-payment';
 const film=filmMode==='town-payment'?paymentFilm:healthFilm;
 if(!snapshot||!cast) return <div className="auth-page"><button onClick={()=>navigate('/operator')}>Back to Marlow Green</button></div>;
 const open=(id:string)=>navigate(id?`/operator?workspace=${encodeURIComponent(id)}`:'/operator');
 return <div className="operator-console"><WorkspaceSpatialView key={selectedId}
 snapshot={film.snapshot!} liveWork={filmEnabled?film.liveWork:IDLE} channelMemberIndex={{}} workspaceViewOnly frontendReadOnly operatorContext={READONLY_CONTEXT}
 topbarTitle={<span className="operator-topbar-title"><button className="operator-topbar-back" type="button" onClick={()=>open('')}><ArrowLeft size={16}/>Back to Marlow Green</button><ShieldCheck size={18}/><span>Frontend Demo</span><label><span className="sr-only">Current Workspace</span><select aria-label="Current Workspace" value={selectedId} onChange={e=>open(e.target.value)}><option value="">Marlow Green overview</option>{TOWN_CAST.map(c=><option key={c.site} value={`demo-${c.site}`}>{c.name}</option>)}</select></label></span>}
 topbarProps={{currentUser:snapshot.currentUser,unreadCount:0,pendingApprovalCount:0,activeUtility:null,onOpenSearch:()=>{},onOpenInbox:()=>{},onOpenSaved:()=>{},onOpenApprovals:()=>{},onOpenProfile:()=>{},onLogoutRequest:()=>open(''),mode:'operator',contextLabel:cast.name,hideAccountControls:true}}
 contextBar={<div className="frontend-workspace-context"><span>Read-only frontend scene · {cast.name} TYR and {snapshot.agents.length-1} subagents</span><div>{snapshot.workspaceBridges?.map(b=><button key={b.id} onClick={()=>open(b.peerWorkspace!.id)}>Visit {b.peerWorkspace!.name} →</button>)}</div></div>}
 onOpenTopology={()=>{}} onRefresh={async()=>{}} onCreateAgent={()=>{}} onConnectComputer={()=>{}} onOpenAgentDm={async()=>{}} onOpenWorkspaceBridge={bridge=>open(bridge.peerWorkspace!.id)} onOpenDmChannel={()=>{}} onOpenLiveExecution={()=>{}} />
 </div>;
}
