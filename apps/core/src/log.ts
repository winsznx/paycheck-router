type Fields = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

function emit(level: "debug" | "info" | "warn" | "error", message: string, fields: Fields): void {
  const line = JSON.stringify({ level, message, ...fields }, (_key, value) => serialize(value));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Structured JSON logs carrying `requestId`, `routerId`, `paycheckId`, `legId`, `signature`. */
export const log = {
  debug: (message: string, fields: Fields = {}) => emit("debug", message, fields),
  info: (message: string, fields: Fields = {}) => emit("info", message, fields),
  warn: (message: string, fields: Fields = {}) => emit("warn", message, fields),
  error: (message: string, fields: Fields = {}) => emit("error", message, fields),
};
