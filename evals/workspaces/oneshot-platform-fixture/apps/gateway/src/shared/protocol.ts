import type { EventFrame, Frame, RequestFrame, ResponseFrame } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseFrame(raw: string): Frame {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error("invalid frame payload");
  }
  const type = parsed.type;
  if (type === "req") {
    if (typeof parsed.id !== "string" || typeof parsed.method !== "string") {
      throw new Error("invalid req frame");
    }
    return parsed as RequestFrame;
  }
  if (type === "res") {
    if (typeof parsed.id !== "string" || typeof parsed.ok !== "boolean") {
      throw new Error("invalid res frame");
    }
    return parsed as ResponseFrame;
  }
  if (type === "event") {
    if (typeof parsed.event !== "string") {
      throw new Error("invalid event frame");
    }
    return parsed as EventFrame;
  }
  throw new Error("invalid frame type");
}

export function responseOk(id: string, payload?: unknown): ResponseFrame {
  return { type: "res", id, ok: true, ...(typeof payload !== "undefined" ? { payload } : {}) };
}

export function responseError(id: string, code: string, message: string): ResponseFrame {
  return {
    type: "res",
    id,
    ok: false,
    error: { code, message },
  };
}
