// Step input/output file paths are stored as "workspace/<projectId>/..."
// (matching the physical workspace/<projectId>/ folder on disk); this
// strips that prefix down to the path relative to the project's own
// workspace root, e.g. "docs/requirements.md".
export function stripProjectPrefix(filePath: string, projectId: string): string {
  const prefix = `workspace/${projectId}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath.replace(/^workspace\//, "");
}
