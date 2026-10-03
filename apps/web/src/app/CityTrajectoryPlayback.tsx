import { useEffect, useId, useState } from "react";
import type { Map as CityMap } from "maplibre-gl";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { cityCoordinate } from "../map/operatorCityMapModel";
import { DEMO_ROLES, DEMO_STEPS, DEMO_DURATION, STEP_SECONDS, communicationAt } from "../map/cityCommunicationDemo";
import "../styles/city-trajectory.css";

export function CityTrajectoryPlayback({ map, onClose }: { map: CityMap; onClose: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [, setRevision] = useState(0);
  const id = useId().replaceAll(":", "");
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    map.on("move", update);
    map.on("resize", update);
    return () => { map.off("move", update); map.off("resize", update); };
  }, [map]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = document.hidden ? 0 : (now - previous) / 1000;
      previous = now;
      setSeconds(value => Math.min(DEMO_DURATION, value + delta * speed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);
  useEffect(() => { if (seconds >= DEMO_DURATION) setPlaying(false); }, [seconds]);
  useEffect(() => {
    map.fitBounds([cityCoordinate(-610, 480), cityCoordinate(460, -440)], {
      padding: { top: 100, bottom: 120, left: 100, right: map.getContainer().clientWidth > 850 ? 450 : 90 }, maxZoom: 17, duration: 700,
    });
  }, [map]);
  const state = communicationAt(seconds);
  const roles = DEMO_ROLES.map(role => ({ ...role, point: map.project(cityCoordinate(...role.offset)) }));
  const from = roles.find(role => role.id === state.step.from)!;
  const to = roles.find(role => role.id === state.step.to)!;
  const color = state.step.kind === "bridge" ? "#c1783d" : "#1689a3";
  // Communication travels between fixed participants; it does not represent a physical walk.
  const message = { x: from.point.x + (to.point.x - from.point.x) * state.progress, y: from.point.y + (to.point.y - from.point.y) * state.progress };
  const links = [["user", "tyr-a"], ["tyr-a", "subagent-a"], ["tyr-a", "tyr-b"], ["tyr-b", "subagent-b"]];
  function restart() { setSeconds(0); setPlaying(true); }
  function focusRoute() {
    map.fitBounds([cityCoordinate(-610, 480), cityCoordinate(460, -440)], { padding: { top: 100, bottom: 120, left: 100, right: map.getContainer().clientWidth > 850 ? 450 : 90 }, maxZoom: 17, duration: 600 });
  }
  return <>
    <svg className="city-trajectory-overlay" aria-label="Scripted TYR and subagent communication flow">
      <defs>
        <filter id={id}><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2" /></filter>
        <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill={color} /></marker>
      </defs>
      {links.map(([source, target]) => {
        const a = roles.find(role => role.id === source)!;
        const b = roles.find(role => role.id === target)!;
        return <line key={`${source}-${target}`} x1={a.point.x} y1={a.point.y} x2={b.point.x} y2={b.point.y} stroke="white" strokeWidth="5" opacity="0.7" />;
      })}
      {links.map(([source, target]) => {
        const a = roles.find(role => role.id === source)!;
        const b = roles.find(role => role.id === target)!;
        return <line key={`${source}-${target}`} x1={a.point.x} y1={a.point.y} x2={b.point.x} y2={b.point.y} stroke={source === "tyr-a" && target === "tyr-b" ? "#c1783d" : "#6b99a4"} strokeWidth="2" strokeDasharray="4 6" opacity="0.6" />;
      })}
      <line x1={from.point.x} y1={from.point.y} x2={to.point.x} y2={to.point.y} stroke={color} strokeWidth="3.5" markerEnd={`url(#${id}-arrow)`} />
      {roles.map(role => {
        const active = role.id === (state.progress < 1 ? state.step.from : state.step.to);
        return <g key={role.id} transform={`translate(${role.point.x},${role.point.y})`} filter={`url(#${id})`}>
          {active && <circle r="29" fill={role.color} opacity="0.16" />}
          <circle r="20" fill="white" stroke={role.color} strokeWidth={active ? 4 : 2} />
          {role.id === "user" ? <><circle cy="-5" r="5" fill={role.color} /><path d="M-9 9 Q0 -5 9 9" fill={role.color} /></> : <><rect x="-10" y="-7" width="20" height="15" rx="4" fill={role.color} /><circle cx="-4" cy="0" r="2" fill="white" /><circle cx="4" cy="0" r="2" fill="white" /><path d="M0 -7 V-12" stroke={role.color} strokeWidth="2" /></>}
          <rect x="-65" y="30" width="130" height="43" rx="9" fill="white" stroke={role.color} strokeOpacity="0.35" />
          <text y="48" textAnchor="middle" fill={role.color} fontSize="12" fontWeight="700">{role.label}</text>
          <text y="63" textAnchor="middle" fill="#6a8290" fontSize="10">{role.subtitle}</text>
        </g>;
      })}
      {state.progress < 1 && <g transform={`translate(${message.x},${message.y})`} filter={`url(#${id})`}>
        <circle r="13" fill={color} stroke="white" strokeWidth="2" />
        <rect x="-7" y="-5" width="14" height="10" rx="2" fill="none" stroke="white" strokeWidth="1.5" /><path d="M-7 -4 L0 1 L7 -4" fill="none" stroke="white" strokeWidth="1.5" />
      </g>}
    </svg>
    <section className="city-trajectory-player city-communication-player" aria-label="Communication demo playback controls">
      <div className="city-trajectory-heading"><strong>TYR communication</strong><span>Scripted demo</span><button type="button" aria-label="Close communication demo" onClick={onClose}><X size={16} /></button></div>
      <p className="city-demo-note">Dorian → Subagent → Mira → Subagent → Dorian</p>
      <div className="city-trajectory-phase"><b>{state.complete ? "Complete · Answer delivered" : `Step ${state.index + 1} of ${DEMO_STEPS.length}`}</b><span>{(seconds / speed).toFixed(1)} / {DEMO_DURATION / speed} s</span></div>
      <input aria-label="Playback progress" type="range" min="0" max={DEMO_DURATION} step="0.01" value={seconds} onChange={event => { setPlaying(false); setSeconds(Number(event.target.value)); }} />
      <div className="city-trajectory-actions">
        <button type="button" onClick={() => { if (seconds >= DEMO_DURATION) restart(); else setPlaying(value => !value); }}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? "Pause" : "Play"}</button>
        <button type="button" onClick={restart}><RotateCcw size={15} />Replay</button>
        <button type="button" onClick={focusRoute}>Focus flow</button>
        <select aria-label="Playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[0.5, 1, 2, 4].map(value => <option key={value} value={value}>{value}×</option>)}</select>
      </div>
      <div className={`city-message-card ${state.step.kind}`} aria-label="Current demo message">
        <div><b>{from.label} → {to.label}</b><span>{state.step.kind === "bridge" ? "Workspace Bridge" : "Local message"}</span></div>
        <blockquote>{state.step.message}</blockquote>
        <p>{state.step.detail}</p>
      </div>
      <nav className="city-demo-steps" aria-label="Communication sequence">
        {DEMO_STEPS.map((step, index) => <button key={index} type="button" aria-current={state.index === index ? "step" : undefined} className={state.index === index ? "active" : index < state.index ? "done" : ""} onClick={() => { setSeconds(index * STEP_SECONDS); setPlaying(false); }}><span>{index < state.index ? "✓" : index + 1}</span><b>{step.title}</b><small>{step.kind === "bridge" ? "Bridge" : "Local"}</small></button>)}
      </nav>
      <p>Preset messages and participants · {(DEMO_DURATION / speed).toFixed(0)}-second playback at {speed}×</p>
    </section>
  </>;
}

