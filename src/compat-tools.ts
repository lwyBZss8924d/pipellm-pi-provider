import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { Type } from '@earendil-works/pi-ai';
import { defineTool, withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { absolute, toPosixPaths, GATEWAY_TOOLS } from './compat';
const MAX_OUTPUT = 60_000;
function truncate(text: string): string {
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n[truncated ${text.length - MAX_OUTPUT} chars]`
    : text;
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolvePromise) => {
    const shell = process.env.SHELL || '/bin/bash';
    const child = spawn(shell, ['-lc', command], { cwd, env: process.env, signal });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise(`${out}${err.message}\nexit code: 127`);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      resolvePromise(`${out}${sig ? `\nkilled by ${sig}` : ''}\nexit code: ${code ?? 'none'}`);
    });
  });
}

const text = (t: string) => ({
  content: [{ type: 'text' as const, text: truncate(t) }],
  details: undefined,
});

export function registerCompatTools(pi: ExtensionAPI) {
  const bash = defineTool({
    name: 'Bash',
    label: 'Bash',
    description: 'Execute a shell command on this machine and return combined stdout/stderr.',
    parameters: Type.Object({
      command: Type.String({ description: 'Shell command' }),
      description: Type.Optional(Type.String()),
      timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds' })),
      run_in_background: Type.Optional(Type.Boolean()),
      dangerouslyDisableSandbox: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const command = toPosixPaths(params.command);
      return text(
        await runShell(command, ctx.cwd, Math.min(params.timeout ?? 120_000, 600_000), signal),
      );
    },
  });

  const read = defineTool({
    name: 'Read',
    label: 'Read',
    description:
      'Read a text file. file_path may be absolute or relative to the working directory.',
    parameters: Type.Object({
      file_path: Type.String(),
      offset: Type.Optional(Type.Number({ description: '1-indexed start line' })),
      limit: Type.Optional(Type.Number()),
      pages: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const path = absolute(ctx.cwd, params.file_path);
      const lines = (await readFile(path, 'utf8')).split('\n');
      const start = Math.max((params.offset ?? 1) - 1, 0);
      const slice = lines.slice(start, params.limit ? start + params.limit : undefined);
      return text(slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n'));
    },
  });

  const edit = defineTool({
    name: 'Edit',
    label: 'Edit',
    description: 'Replace an exact string in a file.',
    parameters: Type.Object({
      file_path: Type.String(),
      old_string: Type.String(),
      new_string: Type.String(),
      replace_all: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const path = absolute(ctx.cwd, params.file_path);
      return withFileMutationQueue(path, async () => {
        const before = await readFile(path, 'utf8');
        const count = before.split(params.old_string).length - 1;
        if (count === 0) throw new Error(`old_string not found in ${path}`);
        if (count > 1 && !params.replace_all)
          throw new Error(
            `old_string matches ${count} times in ${path}; set replace_all or add context`,
          );
        const after = params.replace_all
          ? before.split(params.old_string).join(params.new_string)
          : before.replace(params.old_string, () => params.new_string);
        await writeFile(path, after, 'utf8');
        return text(
          `Edited ${path} (${params.replace_all ? count : 1} replacement${count > 1 && params.replace_all ? 's' : ''})`,
        );
      });
    },
  });

  const write = defineTool({
    name: 'Write',
    label: 'Write',
    description: 'Write a file, creating parent directories.',
    parameters: Type.Object({ file_path: Type.String(), content: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const path = absolute(ctx.cwd, params.file_path);
      return withFileMutationQueue(path, async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, params.content, 'utf8');
        return text(`Wrote ${params.content.length} chars to ${path}`);
      });
    },
  });

  const skill = defineTool({
    name: 'Skill',
    label: 'Skill',
    description: "Load a skill's SKILL.md by name from the skills listed in the system reminder.",
    parameters: Type.Object({ skill: Type.String(), args: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      const roots = [
        `${homedir()}/.agents/skills`,
        `${homedir()}/.pi/agent/skills`,
        `${homedir()}/.prime/agent/skills`,
      ];
      const out = await runShell(
        `for r in ${roots.map((r) => `'${r}'`).join(' ')}; do [ -d "$r" ] && find -L "$r" -name SKILL.md -path "*/${params.skill.replace(/[^A-Za-z0-9._-]/g, '')}/SKILL.md" 2>/dev/null; done | head -1`,
        homedir(),
        10_000,
      );
      const path = out.split('\n')[0]?.trim();
      if (!path || !path.endsWith('SKILL.md')) throw new Error(`skill not found: ${params.skill}`);
      const body = await readFile(path, 'utf8');
      return text(`${path}\n\n${body}${params.args ? `\n\nArguments: ${params.args}` : ''}`);
    },
  });

  const toolSearch = defineTool({
    name: 'ToolSearch',
    label: 'ToolSearch',
    description: 'List the tools that execute locally in this session.',
    parameters: Type.Object({ query: Type.String(), max_results: Type.Optional(Type.Number()) }),
    async execute() {
      return text(
        `Available local tools: ${GATEWAY_TOOLS.join(', ')}. Call them directly; no loading is needed.`,
      );
    },
  });

  for (const tool of [bash, read, edit, write, skill, toolSearch]) pi.registerTool(tool);
}
