import pino, { type Logger } from "pino";

import { redactSensitiveText } from "./redact.js";

export function buildLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
        "config.ADMIN_TOKEN",
        "config.TELEGRAM_BOT_TOKEN",
      ],
      censor: "[REDACTED]",
    },
    formatters: {
      level: (label) => ({ level: label }),
      log(object) {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(object)) {
          sanitized[key] = typeof value === "string" ? redactSensitiveText(value) : value;
        }
        return sanitized;
      },
    },
  });
}
