import type { EntityId, GrantKey, PlanAction } from "./types.ts";

export function executableActionIds(actions: readonly PlanAction[], grants: readonly GrantKey[]): Set<EntityId> {
  const executable = new Set<EntityId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const action of actions) {
      if (executable.has(action.id)) continue;
      if (!grants.includes(action.requiredGrant)) continue;
      if (!action.dependsOn.every(dependency => executable.has(dependency))) continue;
      executable.add(action.id);
      changed = true;
    }
  }
  return executable;
}
