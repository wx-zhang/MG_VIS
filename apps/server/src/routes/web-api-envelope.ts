import type express from "express";
import {
  API_SUCCESS_CODE,
  WEB_API_ENVELOPE_MEDIA_TYPE,
  isApiResponse,
  type ApiFailure,
  type ApiSuccess,
  type ApiWarning
} from "@tyr-ai/contracts";

const STABLE_ERROR_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function registerWebApiEnvelopeMiddleware(app: express.Express): void {
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/mobile-app/") || !acceptsWebApiEnvelope(req.header("Accept"))) {
      next();
      return;
    }

    const sendJson = res.json.bind(res);
    res.json = ((body: unknown) => sendJson(webApiEnvelope(body, res.statusCode))) as express.Response["json"];
    next();
  });
}

export function acceptsWebApiEnvelope(accept: string | undefined): boolean {
  return typeof accept === "string" && accept
    .split(",")
    .some((part) => part.trim().split(";", 1)[0].toLowerCase() === WEB_API_ENVELOPE_MEDIA_TYPE);
}

export function webApiEnvelope(body: unknown, status: number): ApiSuccess<unknown> | ApiFailure {
  if (status < 400) {
    if (isApiResponse(body) && body.code === API_SUCCESS_CODE) return body as ApiSuccess<unknown>;
    const warnings = legacyWarnings(body);
    return {
      code: API_SUCCESS_CODE,
      data: body,
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  if (isApiResponse(body) && body.code !== API_SUCCESS_CODE) return body as ApiFailure;
  const record = objectRecord(body);
  const rawError = stringValue(record?.code) ?? stringValue(record?.errorCode) ?? stringValue(record?.error);
  const code = rawError && STABLE_ERROR_CODE.test(rawError) && rawError !== API_SUCCESS_CODE
    ? rawError
    : fallbackErrorCode(status);
  const message = stringValue(record?.message)
    ?? (rawError && rawError !== code ? rawError : undefined);
  const details = legacyErrorDetails(record);
  return {
    code,
    ...(message ? { message } : {}),
    ...(details ? { details } : {})
  };
}

function legacyWarnings(body: unknown): ApiWarning[] {
  const record = objectRecord(body);
  if (!record || record.partial !== true) return [];
  const code = stringValue(record.errorCode);
  if (!code || code === API_SUCCESS_CODE) return [];
  return [{ code }];
}

function legacyErrorDetails(record: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const details = Object.fromEntries(Object.entries(record).filter(([key]) => !["code", "error", "errorCode", "message"].includes(key)));
  return Object.keys(details).length > 0 ? details : undefined;
}

function fallbackErrorCode(status: number): string {
  if (status === 400) return "validation_failed";
  if (status === 401) return "unauthorized";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 415) return "unsupported_media_type";
  if (status === 429) return "rate_limited";
  if (status === 503) return "service_unavailable";
  if (status >= 500) return "internal_error";
  return "request_failed";
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
