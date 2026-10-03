export const TYR_EMAIL_DOMAIN = "agent.tyr.ai";

export type TyrEmailCandidate = {
  localPart: string;
  address: string;
  available: boolean;
  reason?: "invalid_email_alias" | "reserved_email_alias" | "email_alias_taken";
};

export type TyrEmailSettings = {
  address: string;
  domain: string;
  canCustomize: boolean;
  previousAddresses: string[];
  suggestions: string[];
  candidate?: TyrEmailCandidate;
};

const RESERVED_EMAIL_NAMES = new Set([
  "admin", "administrator", "help", "helpdesk", "support", "abuse", "postmaster",
  "security", "noreply", "no-reply", "mailer-daemon", "root", "tyr", "billing", "www"
]);

export function normalizeTyrEmailLocalPart(value: string): string {
  return value.trim().toLowerCase();
}

export function tyrEmailLocalPartError(value: string): TyrEmailCandidate["reason"] | undefined {
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(value)) return "invalid_email_alias";
  if (RESERVED_EMAIL_NAMES.has(value)) return "reserved_email_alias";
  return undefined;
}

export function tyrEmailNameSuggestion(name: string): string {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
  return slug.length >= 3 && !tyrEmailLocalPartError(slug) ? slug : "tyr-workspace";
}
