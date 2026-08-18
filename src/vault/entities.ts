import { getDb, generateId } from './schema.ts';

/** Escape SQL LIKE wildcard characters in user input */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

export type EntityType = 'person' | 'project' | 'tool' | 'place' | 'concept' | 'event';

export type Entity = {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  source: string | null;
  /** Project this entity belongs to, or null for User/global memory (spec §18-19). */
  project_id: string | null;
};

type EntityRow = {
  id: string;
  type: EntityType;
  name: string;
  properties: string | null;
  created_at: number;
  updated_at: number;
  source: string | null;
  project_id: string | null;
};

/**
 * Parse entity row from database, deserializing JSON fields
 */
function parseEntity(row: EntityRow): Entity {
  return {
    ...row,
    properties: row.properties ? JSON.parse(row.properties) : null,
  };
}

/**
 * Create a new entity in the knowledge graph
 */
export function createEntity(
  type: EntityType,
  name: string,
  properties?: Record<string, unknown>,
  source?: string,
  project_id?: string | null
): Entity {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  const stmt = db.prepare(
    'INSERT INTO entities (id, type, name, properties, created_at, updated_at, source, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  stmt.run(
    id,
    type,
    name,
    properties ? JSON.stringify(properties) : null,
    now,
    now,
    source ?? null,
    project_id ?? null
  );

  return {
    id,
    type,
    name,
    properties: properties ?? null,
    created_at: now,
    updated_at: now,
    source: source ?? null,
    project_id: project_id ?? null,
  };
}

/**
 * Get an entity by ID
 */
export function getEntity(id: string): Entity | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM entities WHERE id = ?');
  const row = stmt.get(id) as EntityRow | null;

  if (!row) return null;

  return parseEntity(row);
}

/**
 * Find entities matching query criteria
 */
export function findEntities(query: {
  type?: EntityType;
  name?: string;
  nameContains?: string;
  source?: string;
  /** Exact project_id match (use `projectScope` for "this project or global"). */
  project_id?: string;
  /** Match this project's entities plus global (project_id IS NULL) ones. */
  projectScope?: string;
  /** Cap the number of rows returned, applied in SQL rather than after loading every row into memory. */
  limit?: number;
}): Entity[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.type) {
    conditions.push('type = ?');
    params.push(query.type);
  }

  if (query.source) {
    conditions.push('source = ?');
    params.push(query.source);
  }

  if (query.name) {
    conditions.push('name = ?');
    params.push(query.name);
  }

  if (query.nameContains) {
    conditions.push("name LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(query.nameContains)}%`);
  }

  if (query.project_id) {
    conditions.push('project_id = ?');
    params.push(query.project_id);
  } else if (query.projectScope) {
    conditions.push('(project_id = ? OR project_id IS NULL)');
    params.push(query.projectScope);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = query.limit !== undefined ? ' LIMIT ?' : '';
  if (query.limit !== undefined) params.push(query.limit);
  const stmt = db.prepare(`SELECT * FROM entities ${where} ORDER BY updated_at DESC${limitClause}`);
  const rows = stmt.all(...params as any[]) as EntityRow[];

  return rows.map(parseEntity);
}

/**
 * Update an entity's properties
 */
export function updateEntity(
  id: string,
  updates: Partial<Pick<Entity, 'name' | 'properties' | 'type'>>
): Entity | null {
  const db = getDb();
  const entity = getEntity(id);
  if (!entity) return null;

  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    params.push(updates.name);
  }

  if (updates.type !== undefined) {
    fields.push('type = ?');
    params.push(updates.type);
  }

  if (updates.properties !== undefined) {
    fields.push('properties = ?');
    params.push(JSON.stringify(updates.properties));
  }

  if (fields.length === 0) return entity;

  fields.push('updated_at = ?');
  params.push(Date.now());

  params.push(id);

  const stmt = db.prepare(`UPDATE entities SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...params as any[]);

  return getEntity(id);
}

/**
 * Delete an entity and all related facts/relationships (via cascade)
 */
export function deleteEntity(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM entities WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Search entities by name using LIKE query
 */
export function searchEntitiesByName(query: string, projectScope?: string): Entity[] {
  const db = getDb();
  const scopeClause = projectScope ? 'AND (project_id = ? OR project_id IS NULL)' : '';
  const stmt = db.prepare(
    `SELECT * FROM entities WHERE name LIKE ? ESCAPE '\\' ${scopeClause} ORDER BY name`
  );
  const params = projectScope ? [`%${escapeLike(query)}%`, projectScope] : [`%${escapeLike(query)}%`];
  const rows = stmt.all(...params) as EntityRow[];
  return rows.map(parseEntity);
}
