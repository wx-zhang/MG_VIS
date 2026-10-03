export function loginBody(email: string, password: string): { email: string; password: string } {
  return {
    email: email.trim().toLowerCase(),
    password
  };
}

export function registerBody(name: string, email: string, password: string, serverName?: string): { name: string; email: string; password: string; serverName?: string } {
  const body: { name: string; email: string; password: string; serverName?: string } = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password
  };
  const trimmedServerName = serverName?.trim();
  if (trimmedServerName) body.serverName = trimmedServerName;
  return body;
}
