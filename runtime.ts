import process from "node:process";

const MAX_COMMAND_OUTPUT_CHARS = 2_000;

export type CommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  output: string;
};

function getShellCommand(command: string): string[] {
  if (process.platform === "win32") {
    return ["cmd.exe", "/d", "/s", "/c", command];
  }

  return ["bash", "-lc", command];
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_COMMAND_OUTPUT_CHARS) {
    return output;
  }

  return `${output.slice(0, MAX_COMMAND_OUTPUT_CHARS)}\n...command output truncated`;
}

export async function executeCommand(command: string): Promise<CommandResult> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn(getShellCommand(command), {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = truncateOutput(`$ ${command}\n\nstdout: <empty>\nstderr:\n${message}\nexitCode: 1`);

    return {
      command,
      stdout: "",
      stderr: message,
      exitCode: 1,
      output,
    };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const combinedOutput = [
    `$ ${command}`,
    "",
    stdout.trim() ? `stdout:\n${stdout.trim()}` : "stdout: <empty>",
    stderr.trim() ? `stderr:\n${stderr.trim()}` : "stderr: <empty>",
    `exitCode: ${exitCode}`,
  ].join("\n");

  return {
    command,
    stdout,
    stderr,
    exitCode,
    output: truncateOutput(combinedOutput),
  };
}
