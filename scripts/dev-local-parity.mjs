import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";
const npmCmd = isWin ? "cmd.exe" : "npm";
const dockerCmd = isWin ? "docker.exe" : "docker";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const reportingAppRoot = path.join(repoRoot, "packages", "reporting-app");
const localEnvFile = path.join(repoRoot, ".env.local");

let shuttingDown = false;
const processes = [];

function npmSpawnArgs(args) {
  return isWin ? ["/d", "/s", "/c", "npm", ...args] : args;
}

function spawnProcess(name, command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  processes.push({ name, child });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start:`, error);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const suffix = signal ? `signal=${signal}` : `code=${code ?? 0}`;
    console.error(`[${name}] stopped unexpectedly (${suffix}).`);
    shutdown(code ?? 1);
  });

  return child;
}

function runStep(name, command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`[${name}] exited with code ${code ?? 1}`));
    });
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const { child } of processes) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 2000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  console.log("Starting LOCAL parity mode (Docker-like ports)...");
  console.log("1) OHIF + Dicoogle in Docker");
  console.log("2) Reporting backend locally on http://localhost:8081");
  console.log("3) Reporting frontend locally on http://localhost:5173");

  await runStep(
    "dicoogle",
    dockerCmd,
    ["compose", "--env-file", ".env.local", "up", "-d", "dicoogle"],
    repoRoot,
  );

  await runStep(
    "ohif",
    dockerCmd,
    ["compose", "--env-file", ".env.local", "up", "-d", "--no-deps", "ohif"],
    repoRoot,
  );

  spawnProcess(
    "backend",
    npmCmd,
    npmSpawnArgs(["run", "dev", "-w", "backend"]),
    reportingAppRoot,
    {
      APP_ENV_MODE: "local",
      APP_ENV_FILE: localEnvFile,
      PORT: "8081",
      BACKEND_URL: "http://localhost:8081",
    },
  );

  spawnProcess(
    "frontend",
    npmCmd,
    npmSpawnArgs(["run", "dev", "-w", "frontend", "--", "--host", "0.0.0.0", "--port", "5173"]),
    reportingAppRoot,
    {
      VITE_BACKEND_PROXY_TARGET: "http://localhost:8081",
      VITE_API_BASE_URL: "http://localhost:8081",
    },
  );
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
