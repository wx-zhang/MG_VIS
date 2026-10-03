export const API_SUCCESS_CODE = "ok" as const;
export const WEB_API_ENVELOPE_MEDIA_TYPE = "application/vnd.tyr-ai.web-envelope+json";

export type ApiWarning = {
  code: string;
  message?: string;
  details?: unknown;
};

export type ApiSuccess<T> = {
  code: typeof API_SUCCESS_CODE;
  data: T;
  warnings?: ApiWarning[];
  requestId?: string;
};

export type ApiFailure = {
  code: Exclude<string, typeof API_SUCCESS_CODE>;
  message?: string;
  details?: unknown;
  requestId?: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function isApiSuccess<T>(value: ApiResponse<T>): value is ApiSuccess<T> {
  return value.code === API_SUCCESS_CODE;
}

export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!value || typeof value !== "object") return false;
  const code = (value as { code?: unknown }).code;
  if (typeof code !== "string" || code.length === 0) return false;
  if (code !== API_SUCCESS_CODE) return true;
  return Object.prototype.hasOwnProperty.call(value, "data");
}
