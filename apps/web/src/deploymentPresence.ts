/** No URL, keystrokes or customer content leave the page: only tab visibility. */
export function startDeploymentPresence(socket: Pick<WebSocket, "readyState" | "send">): () => void {
  const send = () => {
    if (socket.readyState === 1) socket.send(`42${JSON.stringify(["deployment:presence", { visible: document.visibilityState !== "hidden" }])}`);
  };
  send();
  document.addEventListener("visibilitychange", send);
  const timer = window.setInterval(send, 15_000);
  return () => { document.removeEventListener("visibilitychange", send); window.clearInterval(timer); };
}
