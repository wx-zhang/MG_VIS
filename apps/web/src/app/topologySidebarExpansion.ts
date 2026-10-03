export type TopologyExpandedComputers = Record<string, boolean>;

export function pruneTopologyExpandedComputers(current: TopologyExpandedComputers, machineIds: string[]): TopologyExpandedComputers {
  const validMachineIds = new Set(machineIds);
  return Object.fromEntries(Object.entries(current).filter(([machineId]) => validMachineIds.has(machineId)));
}

export function seedTopologyExpandedComputers(
  current: TopologyExpandedComputers,
  machineIds: string[],
  seedMachineId?: string
): TopologyExpandedComputers {
  const pruned = pruneTopologyExpandedComputers(current, machineIds);
  if (Object.keys(pruned).length > 0) return pruned;

  const validMachineIds = new Set(machineIds);
  const initialMachineId = seedMachineId && validMachineIds.has(seedMachineId) ? seedMachineId : machineIds[0];
  return initialMachineId ? { [initialMachineId]: true } : pruned;
}

export function openTopologyComputer(
  current: TopologyExpandedComputers,
  machineIds: string[],
  machineId?: string
): TopologyExpandedComputers {
  const next = seedTopologyExpandedComputers(current, machineIds);
  if (!machineId || !machineIds.includes(machineId)) return next;
  // 路由选中新的 Computer/Agent 时只补充展开目标，不收起用户已经打开的其它 Computer。
  return { ...next, [machineId]: true };
}

export function toggleTopologyComputerExpanded(
  current: TopologyExpandedComputers,
  machineId: string,
  currentlyExpanded: boolean
): TopologyExpandedComputers {
  return { ...current, [machineId]: !currentlyExpanded };
}

export function topologyExpandedComputersEqual(left: TopologyExpandedComputers, right: TopologyExpandedComputers): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}
