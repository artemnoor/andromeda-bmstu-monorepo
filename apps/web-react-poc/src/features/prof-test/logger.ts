type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel | null {
  const configured = import.meta.env.VITE_PROF_TEST_LOG_LEVEL?.toLowerCase();
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return configured;
  }
  return null;
}

function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const minimum = configuredLevel();
  if (!minimum || levels[level] < levels[minimum]) return;
  const write = level === "debug" ? console.debug : level === "info" ? console.info : level === "warn" ? console.warn : console.error;
  write(`[prof-test] ${event}`, fields);
}

export const profTestLog = {
  debug: (event: string, fields?: Record<string, unknown>) => log("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
};
