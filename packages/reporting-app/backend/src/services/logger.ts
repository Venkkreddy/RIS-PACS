import { createLogger, format, transports } from "winston";

const hipaaFormat = format.combine(
  format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
  format.errors({ stack: true }),
  format((info) => {
    info.service = "tdai-backend";
    info.hostname = process.env.HOSTNAME ?? "unknown";
    return info;
  })(),
  format.json(),
);

export const logger = createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: hipaaFormat,
  defaultMeta: { component: "reporting-backend" },
  transports: [
    new transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});
