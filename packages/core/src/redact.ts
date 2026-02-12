const TELEGRAM_TOKEN_PATTERN = /bot\d+:[A-Za-z0-9_-]+/g;

export function redactSensitiveText(value: string): string {
  return value.replace(TELEGRAM_TOKEN_PATTERN, "bot***:***");
}

export function redactUnknown(input: unknown): unknown {
  if (typeof input === "string") {
    return redactSensitiveText(input);
  }
  if (input instanceof Error) {
    return {
      name: input.name,
      message: redactSensitiveText(input.message),
      stack: input.stack ? redactSensitiveText(input.stack) : undefined,
    };
  }
  return input;
}
