/**
 * AICouncil - the multi-provider "ask everyone, compare, decide" primitive
 * named in spec section 16. No existing equivalent (see
 * docs/AI_MANAGER_ARCHITECTURE_AUDIT.md section 4): today a request always
 * resolves to one tier's one provider. The Council instead fans a question
 * out to several seats in parallel, then has a chair pass weigh the
 * opinions (evidence/confidence/expertise/contradiction) into one verdict.
 *
 * Built entirely on AIRouter.chat() - one call per seat, one call for the
 * chair synthesis - so it inherits tier fall-up, retries, and usage
 * tracking for free and never touches TierMap/resolveTier internals
 * directly (see audit section 6, "Tier system overload" risk).
 */

import { AIRouter, type CostMode, type TaskTier } from './router.ts';
import type { TaskTemplate } from '../agents/conv/task-envelope.ts';
import { createDecision, type Decision } from '../vault/decisions.ts';

/** One council member: a cost mode (tier) asked to answer independently. */
export type CouncilSeat = {
  mode: CostMode;
  /** Human-readable label for this seat, defaults to the mode name. */
  label?: string;
};

export type CouncilOpinion = {
  seat: string;
  mode: CostMode;
  tier: TaskTier;
  content: string;
  /** Self-reported confidence (0-1), or null if the seat didn't report one. */
  confidence: number | null;
  error?: string;
};

export type CouncilVerdict = {
  question: string;
  opinions: CouncilOpinion[];
  synthesis: string;
  contradictions: string[];
  /** The recorded Decision row, or null when opts.record was false. */
  decision: Decision | null;
};

const DEFAULT_SEATS: CouncilSeat[] = [
  { mode: 'cheap' },
  { mode: 'balanced' },
  { mode: 'quality' },
];

const MEMBER_SYSTEM_PROMPT = `You are one member of an AI Council being asked to answer a question independently, without seeing other members' answers. Give your best answer with your reasoning. End your response with a final line in exactly this form:
CONFIDENCE: <a number between 0 and 1>`;

const CHAIR_SYSTEM_PROMPT = `You are the chair of an AI Council. Several members were asked the same question independently and answered without seeing each other's responses. Weigh their opinions - considering the reasoning given, each member's self-reported confidence, and any contradictions between them - and produce a single verdict.

Respond with ONLY a JSON object (no prose, no code fences) of the form:
{
  "synthesis": "the final answer, written as a complete standalone response to the original question",
  "contradictions": ["short description of any point where members disagreed", ...],
  "decision": "one-sentence statement of what was decided, suitable for a permanent decision log"
}
If members were unanimous, "contradictions" should be an empty array.`;

function parseConfidence(content: string): number | null {
  const match = content.match(/CONFIDENCE:\s*([01](?:\.\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function stripConfidenceLine(content: string): string {
  return content.replace(/\n?CONFIDENCE:\s*[01](?:\.\d+)?\s*$/i, '').trim();
}

type ChairResult = {
  synthesis: string;
  contradictions: string[];
  decision: string;
};

/**
 * Parse the chair's JSON verdict, tolerating a fenced code block wrapper.
 * Falls back to treating the raw response as the synthesis (with no
 * detected contradictions) if it isn't valid JSON - a malformed chair
 * response should never lose the underlying opinions.
 */
export function parseChairResponse(raw: string): ChairResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const data = JSON.parse(cleaned) as Record<string, unknown>;
    const synthesis = typeof data.synthesis === 'string' ? data.synthesis : cleaned;
    const contradictions = Array.isArray(data.contradictions)
      ? data.contradictions.filter((c): c is string => typeof c === 'string')
      : [];
    const decision = typeof data.decision === 'string' ? data.decision : synthesis.slice(0, 200);
    return { synthesis, contradictions, decision };
  } catch {
    return { synthesis: cleaned, contradictions: [], decision: cleaned.slice(0, 200) };
  }
}

export class AICouncil {
  constructor(private readonly router: AIRouter) {}

  async convene(
    question: string,
    opts?: {
      seats?: CouncilSeat[];
      template?: TaskTemplate;
      project_id?: string;
      record?: boolean;
    },
  ): Promise<CouncilVerdict> {
    const seats = opts?.seats?.length ? opts.seats : DEFAULT_SEATS;
    const template = opts?.template ?? 'plan';

    const opinions = await Promise.all(
      seats.map((seat) => this.askSeat(question, seat, template)),
    );

    const usable = opinions.filter((o) => !o.error);
    if (usable.length === 0) {
      throw new Error(`AI Council: all ${opinions.length} seat(s) failed to answer.`);
    }

    const chairResult =
      usable.length === 1
        ? { synthesis: usable[0]!.content, contradictions: [], decision: usable[0]!.content.slice(0, 200) }
        : await this.chair(question, usable);

    const shouldRecord = opts?.record !== false;
    const decision = shouldRecord
      ? createDecision(chairResult.decision, {
          project_id: opts?.project_id,
          reason: `AI Council verdict on: ${question}`,
          made_by: 'ai_council',
        })
      : null;

    return {
      question,
      opinions,
      synthesis: chairResult.synthesis,
      contradictions: chairResult.contradictions,
      decision,
    };
  }

  private async askSeat(question: string, seat: CouncilSeat, template: TaskTemplate): Promise<CouncilOpinion> {
    const label = seat.label ?? seat.mode;
    try {
      const response = await this.router.chat(
        { template, mode: seat.mode, subsystem: 'ai_council' },
        [
          { role: 'system', content: MEMBER_SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        { temperature: 0.4 },
      );
      const raw = response.content ?? '';
      return {
        seat: label,
        mode: seat.mode,
        tier: response.routing.tier,
        content: stripConfidenceLine(raw),
        confidence: parseConfidence(raw),
      };
    } catch (err) {
      return {
        seat: label,
        mode: seat.mode,
        tier: this.router.route({ template, mode: seat.mode }).tier,
        content: '',
        confidence: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async chair(question: string, opinions: CouncilOpinion[]): Promise<ChairResult> {
    const digest = opinions
      .map((o, i) => {
        const confidence = o.confidence !== null ? o.confidence.toFixed(2) : 'unreported';
        return `Member ${i + 1} (${o.seat}, confidence ${confidence}):\n${o.content}`;
      })
      .join('\n\n---\n\n');

    const response = await this.router.chat(
      { template: 'plan', mode: 'quality', subsystem: 'ai_council_chair' },
      [
        { role: 'system', content: CHAIR_SYSTEM_PROMPT },
        { role: 'user', content: `Question: ${question}\n\n${digest}` },
      ],
      { temperature: 0.2 },
    );
    return parseChairResponse(response.content ?? '');
  }
}
