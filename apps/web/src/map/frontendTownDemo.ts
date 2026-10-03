import type { MarlowGreenMapSite, PlatformOperatorCityOverviewPayload } from '@tyr-ai/contracts';
export const TOWN_CAST: {site: MarlowGreenMapSite; name:string; agents:number; subagents:string[]}[] = [
 {site:'bank',name:'Bank',agents:4,subagents:['bank.service','bank.ledger','bank.checks']},
 {site:'dorian',name:'Dorian',agents:3,subagents:['dorian.personal','dorian.trading']},
 {site:'marketplace',name:'Marketplace',agents:3,subagents:['market.listings','market.conversations']},
 {site:'mira',name:'Mira',agents:8,subagents:['mira.personal','mira.phone','diagnostic-upload-executor']},
 {site:'sable',name:'Sable',agents:3,subagents:['sable.booking','sable.ops']},
 {site:'tomas',name:'Tomas',agents:3,subagents:['tomas.personal','tomas.stall']},
];
// Display topology observed through the deployed UI; no production IDs, sessions, or messages.
const CONNECTIONS = [['sable','bank'],['bank','tomas'],['bank','dorian'],['mira','bank'],['dorian','sable'],['marketplace','dorian'],['mira','dorian'],['marketplace','tomas'],['mira','marketplace'],['mira','tomas'],['mira','sable'],['tomas','sable']];
export const FRONTEND_TOWN: PlatformOperatorCityOverviewPayload = {
 observedAt:'2026-10-03T16:09:00Z',
 workspaces:TOWN_CAST.map(cast=>({serverId:`demo-${cast.site}`,serverName:cast.name,createdAt:'2026-10-03T00:00:00Z',mapSite:cast.site,devicesOnline:1,devicesTotal:1,agentsOnline:cast.agents,agentsTotal:cast.agents,activeExecutions:0,waitingApprovals:0,lastActivityAt:null})),
 bridges:CONNECTIONS.map(([a,b])=>({id:`demo-bridge-${a}-${b}`,workspaceAId:`demo-${a}`,workspaceBId:`demo-${b}`,direction:'bidirectional'})),
};
