/**
 * Planner - decomposes a user request into a Project plus a dependency
 * graph of subtasks (spec section 9, section 39).
 *
 * Deliberately does NOT create TaskRegistry rows itself: TaskDispatcher.
 * dispatch() always mints its own task id when a subtask actually runs, so
 * pre-creating placeholder rows here would leave two disconnected ids per
 * subtask. Instead this returns the plan (title/template/priority/
 * dependency-graph) and ManagerAgent materializes each subtask into a real
 * task row via dispatch() only when its dependencies are satisfied - see
 * manager-agent.ts.
 */

import type { TaskTemplate } from '../agents/conv/task-envelope.ts';
import { AIRouter } from './router.ts';
import { createProject, type Project, type ProjectTemplate, type ExecutionMode } from '../vault/projects.ts';

const VALID_TEMPLATES: readonly TaskTemplate[] = ['research', 'code', 'plan', 'write', 'general'];
const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type PlannedPriority = (typeof VALID_PRIORITIES)[number];

export type PlannedSubtask = {
  title: string;
  template: TaskTemplate;
  priority: PlannedPriority;
  /** Indices (0-based, into the same plan array) of subtasks this one depends on. */
  depends_on: number[];
};

const PLANNER_SYSTEM_PROMPT = `You are the Planner for an AI project manager. Given a user's request, break it into a small ordered list of concrete subtasks.

Respond with ONLY a JSON array (no prose, no code fences). Each element:
{
  "title": "short imperative title",
  "template": "research" | "code" | "plan" | "write" | "general",
  "priority": "low" | "normal" | "high" | "critical",
  "depends_on": [array of 0-based indices of subtasks in THIS array that must complete first]
}

Keep the list focused (typically 2-8 subtasks). Only add a dependency edge when the subtask genuinely needs the other's output - independent subtasks (e.g. research and initial design) should have no dependency between them so they can run in parallel. depends_on indices must only reference EARLIER elements in the array (lower index).`;

export type PlanResult = {
  project: Project;
  subtasks: PlannedSubtask[];
};

export class Planner {
  constructor(private readonly router: AIRouter) {}

  async planProject(
    name: string,
    userRequest: string,
    opts?: { template?: ProjectTemplate; execution_mode?: ExecutionMode },
  ): Promise<PlanResult> {
    const project = createProject(name, {
      description: userRequest,
      template: opts?.template,
      execution_mode: opts?.execution_mode,
    });

    const subtasks = await this.decompose(userRequest);
    return { project, subtasks };
  }

  /**
   * Ask the LLM to decompose the request. Falls back to a single
   * `general` subtask covering the whole request if the response isn't
   * valid JSON matching the expected shape - planning must never leave
   * the user with nothing to run.
   */
  private async decompose(userRequest: string): Promise<PlannedSubtask[]> {
    try {
      const response = await this.router.chat(
        { template: 'plan', mode: 'quality', subsystem: 'ai_manager_planner' },
        [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userRequest },
        ],
        { temperature: 0.2 },
      );
      const parsed = parsePlanResponse(response.content ?? '');
      if (parsed.length > 0) return parsed;
    } catch (err) {
      console.warn('[Planner] decomposition failed, falling back to single task:', err);
    }
    return [{ title: userRequest.slice(0, 200), template: 'general', priority: 'normal', depends_on: [] }];
  }
}

/**
 * Parse the planner LLM's JSON array response, tolerating a fenced code
 * block wrapper (models frequently add ```json ... ``` despite instructions
 * not to) and dropping any element that doesn't match the expected shape
 * rather than failing the whole plan. Also drops forward/self dependency
 * references (index >= own index) rather than trusting the model to have
 * followed the ordering instruction.
 */
export function parsePlanResponse(raw: string): PlannedSubtask[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const result: PlannedSubtask[] = [];
  data.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    if (!title) return;
    const template = VALID_TEMPLATES.includes(obj.template as TaskTemplate)
      ? (obj.template as TaskTemplate)
      : 'general';
    const priority = (VALID_PRIORITIES as readonly string[]).includes(obj.priority as string)
      ? (obj.priority as PlannedPriority)
      : 'normal';
    const rawDeps = Array.isArray(obj.depends_on)
      ? obj.depends_on.filter((n): n is number => typeof n === 'number')
      : [];
    const depends_on = rawDeps.filter((i) => i >= 0 && i < index);
    result.push({ title, template, priority, depends_on });
  });
  return result;
}
