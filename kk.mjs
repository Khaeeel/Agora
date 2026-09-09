const API = "http://127.0.0.1:8787";
const st = await (await fetch(`${API}/api/state`)).json();
const room = st.rooms.find((r) => r.name === "Trunks");
const goals = (await (await fetch(`${API}/api/rooms/${room.id}/goals`)).json()).goals;
const g = goals.find((x) => x.steps.some((s) => s.status !== "done"));
console.log(`resuming [${g.status}] ${g.steps.filter(s=>s.status==="done").length}/${g.steps.length} — ${g.title.slice(0,70)}`);

const ws = new WebSocket("ws://127.0.0.1:8787/ws");
const log = [];
let sent = false;
ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", roomId: room.id }));
ws.onmessage = (raw) => {
  const ev = JSON.parse(raw.data);
  if (ev.type === "hello" && !sent) {
    sent = true;
    ws.send(JSON.stringify({ type: "resume", roomId: room.id, goalId: g.id }));
    return;
  }
  if (ev.type === "error") log.push(`!! ${ev.detail}`);
  if (ev.type === "message") {
    const m = ev.message;
    if (m.kind === "agent") log.push(`[${m.authorId}] ${m.text.slice(0, 260)}`);
    else if (m.kind === "event") log.push(`[·] ${m.text.slice(0, 95)}`);
    else if (m.kind === "notice") log.push(`[!] ${m.text.slice(0, 130)}`);
  }
  if (ev.type === "goal") log.push(`[board] ${ev.goal.status} ${ev.goal.steps.map(s=>s.status[0]).join("")}`);
  if (ev.type === "run" && !ev.state.active) log.push(`[RUN ENDED] ${ev.state.stopReason}`);
};
// Long window: the point is to watch it carry itself, including auto-resume.
setTimeout(() => { console.log(log.join("\n")); ws.close(); process.exit(0); }, 560000);
