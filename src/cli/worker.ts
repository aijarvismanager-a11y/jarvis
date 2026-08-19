/**
 * `jarvis worker` - local CLI harness for the external AI Worker layer
 * (spec section 10/17), independent of the running daemon/HTTP API. Lets
 * a developer list Workers and run a single task straight from the
 * terminal without enrolling a device or starting the dashboard.
 *
 * Worker enablement here is per-invocation only (no persisted Settings
 * yet - that's dashboard work, spec section 23/25). Running a task is
 * itself the user's explicit confirmation to invoke that Worker's CLI.
 */

import { loadConfig } from '../config/loader.ts';
import { ensureWorkspace } from '../orchestrator/workspace.ts';
import { createDefaultWorkerRegistry } from '../workers/index.ts';
import { TaskWorkerRunner } from '../orchestrator/task-runner.ts';
import { loadAIProfiles } from '../orchestrator/ai-profiles.ts';
import type { TaskTemplate } from '../agents/conv/task-envelope.ts';
import { c } from './helpers.ts';

const VALID_TEMPLATES: TaskTemplate[] = ['research', 'code', 'plan', 'write', 'general'];

function printWorkerHelp(): void {
  console.log(`
${c.bold('Usage:')}
  jarvis worker list
  jarvis worker run --template <${VALID_TEMPLATES.join('|')}> --prompt "<text>" [--worker <name>] [--id <task_id>]

Runs entirely locally against the Shared Workspace - does not require the
daemon to be running. Prints the Worker's result and where its handoff
file was written.
`);
}

const KNOWN_FLAGS = new Set(['template', 'prompt', 'worker', 'id']);

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      // A value that happens to start with "--" (e.g. --prompt "--fix the
      // auth bug") must still be consumed as this flag's value, not
      // mistaken for the start of the next flag - only break on a token
      // that's actually one of our known flag names.
      if (value === undefined || (value.startsWith('--') && KNOWN_FLAGS.has(value.slice(2)))) {
        flags[key] = 'true';
      } else {
        flags[key] = value;
        i++;
      }
    }
  }
  return flags;
}

export async function runWorkerCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
    printWorkerHelp();
    return;
  }

  const jarvisConfig = await loadConfig();
  const workspace = ensureWorkspace(jarvisConfig.daemon.data_dir);
  const registry = createDefaultWorkerRegistry(workspace.root);

  if (sub === 'list') {
    console.log(c.bold(`\nWorkers (workspace: ${workspace.root})\n`));
    for (const worker of registry.list()) {
      const def = worker.definition;
      const badge = def.enabled ? c.green('enabled') : c.dim('disabled (default)');
      console.log(`  ${c.cyan(def.name)}  [${badge}]  capabilities: ${def.capabilities.join(', ')}`);
    }
    console.log(
      c.dim(
        '\nAll Workers start disabled. `jarvis worker run --worker <name> ...` enables the chosen Worker for that run only.\n'
      )
    );
    return;
  }

  if (sub === 'run') {
    const flags = parseFlags(args.slice(1));

    if (!flags.template || !VALID_TEMPLATES.includes(flags.template as TaskTemplate)) {
      console.error(c.red(`--template is required and must be one of: ${VALID_TEMPLATES.join(', ')}`));
      process.exitCode = 1;
      return;
    }
    if (!flags.prompt) {
      console.error(c.red('--prompt is required'));
      process.exitCode = 1;
      return;
    }

    if (flags.worker) {
      const worker = registry.get(flags.worker);
      if (!worker) {
        console.error(c.red(`Unknown worker "${flags.worker}". Run "jarvis worker list" to see available Workers.`));
        process.exitCode = 1;
        return;
      }
      worker.definition.enabled = true;
    } else {
      // No explicit Worker named: enable every Worker matching the
      // template's capability so the Router has something to pick from.
      for (const worker of registry.list()) {
        if (worker.definition.capabilities.some((cap) => cap === capabilityFor(flags.template as TaskTemplate))) {
          worker.definition.enabled = true;
        }
      }
    }

    const runner = new TaskWorkerRunner(registry, workspace, undefined, loadAIProfiles(jarvisConfig.daemon.data_dir));
    const taskId = flags.id ?? `task_${Date.now()}`;

    console.log(c.dim(`Routing "${flags.template}" task ${taskId}...`));
    try {
      const outcome = await runner.run({
        task_id: taskId,
        template: flags.template as TaskTemplate,
        prompt: flags.prompt,
        ...(flags.worker ? { explicitWorker: flags.worker } : {}),
      });

      if (outcome.mode === 'manual_handoff') {
        console.log(`\n${c.bold('No Worker available - Manual Handoff:')}`);
        console.log(`${c.bold('Recommended AI:')} ${outcome.primary ?? '(none)'}${outcome.fallback ? ` (fallback: ${outcome.fallback})` : ''}`);
        console.log(`${c.bold('Reason:')} ${outcome.reason}`);
        console.log(`\n${outcome.prompt}\n`);
        return;
      }

      console.log(`\n${c.bold('Worker:')} ${outcome.worker}`);
      console.log(`${c.bold('Status:')} ${outcome.result.status === 'completed' ? c.green(outcome.result.status) : c.red(outcome.result.status)}`);
      console.log(`${c.bold('Summary:')} ${outcome.result.summary}`);
      if (outcome.result.error) console.log(`${c.bold('Error:')} ${c.red(outcome.result.error)}`);
      console.log(`${c.bold('Handoff file:')} ${outcome.handoffFilePath}`);
      if (outcome.result.status !== 'completed') process.exitCode = 1;
    } catch (err) {
      console.error(c.red(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
    return;
  }

  console.error(c.red(`Unknown "jarvis worker" subcommand: ${sub}`));
  printWorkerHelp();
  process.exitCode = 1;
}

function capabilityFor(template: TaskTemplate) {
  const map: Record<TaskTemplate, string> = {
    code: 'code',
    research: 'research',
    write: 'write',
    plan: 'plan',
    general: 'general',
  };
  return map[template];
}
