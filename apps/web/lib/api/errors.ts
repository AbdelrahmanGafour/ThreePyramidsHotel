// Minimal error typing for the WFI-T02 transport bridge.
//
// Two distinct concepts, kept as distinct types even though their JSON shape
// is identical, so neither can be produced or consumed as if it were the
// other by accident:
//
//   A. BackendDomainErrorBody — the shape Express itself returns for a real
//      domain failure, e.g. { error: { code: "NO_AVAILABILITY", message } }.
//      This module never constructs one of these.
//
//   B. ProxyErrorResponseBody — the shape this bridge sends for its own
//      transport/configuration failures (Express unreachable, its response
//      was not usable, or this bridge's own configuration was invalid). Its
//      `code` is always one of the proxy-owned codes below, never one of the
//      backend's own domain codes (ROOM_NOT_FOUND, INVALID_AVAILABILITY_QUERY,
//      INVALID_RESERVATION, ROOM_TYPE_NOT_FOUND, NO_AVAILABILITY,
//      INVALID_JSON) — those may only ever reach the browser when they came
//      from a genuine Express response.

export type BackendDomainErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

/** Proxy-owned codes only — never one of the backend's own domain codes. */
export type ProxyErrorCode =
  | "PROXY_CONFIGURATION_ERROR"
  | "UPSTREAM_UNREACHABLE"
  | "UPSTREAM_INVALID_RESPONSE";

/**
 * The JSON body this bridge sends for its own transport/configuration
 * failures. Shaped like a BackendDomainErrorBody for the browser's
 * convenience, but a distinct type: it is never one.
 */
export type ProxyErrorResponseBody = {
  error: {
    code: ProxyErrorCode;
    message: string;
  };
};

/**
 * A failure produced by this transport layer, never a stand-in for a real
 * backend domain error. Its message never includes the configured
 * API_BASE_URL, a stack trace, or any other internal error object.
 */
export class ProxyError extends Error {
  readonly code: ProxyErrorCode;
  /** HTTP status this bridge should respond with to the browser. */
  readonly status: number;

  constructor(code: ProxyErrorCode, status: number, message: string) {
    super(message);
    this.name = "ProxyError";
    this.code = code;
    this.status = status;
  }

  toResponseBody(): ProxyErrorResponseBody {
    return { error: { code: this.code, message: this.message } };
  }
}
