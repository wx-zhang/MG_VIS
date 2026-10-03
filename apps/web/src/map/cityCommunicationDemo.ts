export type DemoRole = "user" | "tyr-a" | "subagent-a" | "tyr-b" | "subagent-b";
export const DEMO_ROLES: { id: DemoRole; label: string; subtitle: string; offset: [number, number]; color: string }[] = [
  { id: "user", label: "Dorian Owner", subtitle: "Request owner", offset: [-500, -340], color: "#61748a" },
  { id: "tyr-a", label: "Dorian TYR", subtitle: "Dorian", offset: [-275, -245], color: "#137f98" },
  { id: "subagent-a", label: "dorian.personal", subtitle: "Dorian · Subagent", offset: [-425, -30], color: "#6574bd" },
  { id: "tyr-b", label: "Mira TYR", subtitle: "Mira", offset: [5, -245], color: "#b66b3f" },
  { id: "subagent-b", label: "mira.personal", subtitle: "Mira · Subagent", offset: [155, -30], color: "#6574bd" },
];
export const DEMO_STEPS: { from: DemoRole; to: DemoRole; title: string; message: string; detail: string; kind: "local" | "bridge"; }[] = [
  { from: "user", to: "tyr-a", title: "Dorian receives a request", message: "Find 20 chairs for Friday. Check with Mira and send me a plan.", detail: "Dorian TYR receives the user's message and identifies the work to delegate.", kind: "local" },
  { from: "tyr-a", to: "subagent-a", title: "Dorian delegates to its subagent", message: "Research seating requirements and prepare a checklist for 20 chairs.", detail: "The research subagent receives a bounded task from Dorian TYR.", kind: "local" },
  { from: "subagent-a", to: "tyr-a", title: "The subagent returns findings", message: "Checklist ready: 20 matching chairs, Friday delivery, and one pickup contact.", detail: "Dorian TYR incorporates the subagent's result before contacting another workspace.", kind: "local" },
  { from: "tyr-a", to: "tyr-b", title: "Dorian contacts Mira via Bridge", message: "Can your workspace provide 20 matching chairs for Friday? Please confirm availability.", detail: "The request crosses the Workspace Bridge from Dorian TYR to Mira TYR.", kind: "bridge" },
  { from: "tyr-b", to: "subagent-b", title: "Mira delegates an inventory check", message: "Check stock for 20 matching chairs and report Friday availability.", detail: "Mira TYR coordinates with its own inventory subagent.", kind: "local" },
  { from: "subagent-b", to: "tyr-b", title: "Mira's subagent confirms stock", message: "20 matching chairs are available. Friday pickup at 10:00 works.", detail: "The inventory subagent reports its findings to Mira TYR.", kind: "local" },
  { from: "tyr-b", to: "tyr-a", title: "Mira sends its reply to Dorian", message: "Confirmed: 20 matching chairs, Friday pickup at 10:00. Contact: Mira.", detail: "Mira TYR returns the confirmed details through the same Workspace Bridge.", kind: "bridge" },
  { from: "tyr-a", to: "user", title: "Dorian delivers the final answer", message: "Your plan is ready: 20 chairs from Mira, Friday pickup at 10:00.", detail: "Dorian TYR combines both subagent results and responds to the original user.", kind: "local" },
];
export const STEP_SECONDS = 5;
export const DEMO_DURATION = DEMO_STEPS.length * STEP_SECONDS;
export function communicationAt(seconds: number) {
  const time = Math.max(0, Math.min(DEMO_DURATION, seconds));
  const index = Math.min(DEMO_STEPS.length - 1, Math.floor(time / STEP_SECONDS));
  const progress = Math.min(1, (time - index * STEP_SECONDS) / (STEP_SECONDS * 0.65));
  return { index, step: DEMO_STEPS[index], progress, complete: time >= DEMO_DURATION };
}


