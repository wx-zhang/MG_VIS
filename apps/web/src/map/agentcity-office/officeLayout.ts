// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
export interface OfficePoint {x:number;y:number;z:number}
export interface OfficeStation {x:number;z:number;row:-1|1;front:number;deskZ:number;chairZ:number;facing?:number;roomDepth?:number}
export const OFFICE_BENCH_WIDTH=3.25;
export const OFFICE_BENCH_CHAIR_X=OFFICE_BENCH_WIDTH/2+.27;
// Private worktops are executive desks, not a second conference table. Keep
// the live screen, seated worker and hand targets at their existing scale.
export const OFFICE_PRIVATE_DESK = {width:2.4, legX:1.06, pedestalX:.87, pedestalWidth:.50, plantX:-.90, lampX:.84} as const;
// Right-hand hinges leave the left-hand interior circulation route clear.
// The leaf is mirrored locally and swings into the room, not into the corridor.
export const OFFICE_DOOR={hingeX:.61,width:1.18,openAngle:1.45} as const;

// All six private seats face the rear windows (-Z), as in the approved
// architectural reference. Front-row staff enter past the screen side and
// walk around the desk before taking their seat.
export const officeStations:OfficeStation[]=[
  ...[-7.4,0,7.4].map(x=>({x,z:-4.2,row:-1 as const,front:-2.08,deskZ:-3.98,chairZ:-3.41,facing:Math.PI})),
  ...[-7.4,0,7.4].map(x=>{
    // The center pod steps back from the shared bench, as in the approved
    // cutaway. Its outer edge remains aligned with the entrance facade.
    const z=x===0?4.75:4.2, roomDepth=x===0?3.14:4.24;
    return {x,z,row:1 as const,front:z-roomDepth/2,deskZ:z+.22,chairZ:z+.79,facing:Math.PI,roomDepth};
  }),
  ...[-1,1].map(side=>({x:side*OFFICE_BENCH_CHAIR_X,z:-.62,row:-1 as const,front:1.65,deskZ:-.62,chairZ:-.62,facing:-side*Math.PI/2})),
];
export function officeRoute(index:number):OfficePoint[]{
  const station=officeStations[index];
  if(!station)throw new RangeError('Unknown office station');
  const point=(x:number,z:number):OfficePoint=>({x,y:.055,z});
  const start=point(-4.35,1.65);
  if(index>=6){
    const approach=Math.sign(station.x)*(OFFICE_BENCH_CHAIR_X+.93);
    return [start,point(approach,1.65),point(approach,station.chairZ),point(station.x,station.chairZ)];
  }
  const lane=station.row*1.65;
  const route=[start,point(-4.35,lane),point(station.x,lane),point(station.x,station.front)];
  if(station.row===1){
    // The centerline used to cut straight through the desk after reorientation.
    // The side cabinet is against the left wall; this lane clears both it and
    // the private worktop. These are authored routes, not a physics simulation.
    route.push(point(station.x,station.z-1.25),point(station.x-2.05,station.z-1.25),point(station.x-2.05,station.chairZ));
  }
  route.push(point(station.x,station.chairZ));
  return route;
}
