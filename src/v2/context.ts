import type { AiService, Approval, Artifact, Handoff, Mission, Overview, Project } from "./types";

export type Ctx = {
  project: Project | null;
  overview: Overview;
  services: AiService[];
  handoffs: Handoff[];
  approvals: Approval[];
  mission: Mission | null;
  refresh: () => void;
  setError: (message: string) => void;
  /** Creates the project on demand (the Mission screen can start from nothing). */
  ensureProject: (nameHint: string) => Promise<Project>;
  openArtifact: (a: Artifact) => void;
};

export const aiNameOf = (services: AiService[], id: string | null) => (id ? (services.find((s) => s.id === id)?.name ?? id) : "Claude Code");
