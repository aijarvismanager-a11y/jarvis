import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';
import { loadAiServices } from './aiServiceStore';
import { generatePrompt } from './promptGenerator';
import { PreviewWatcher } from './previewWatcher';
import {
  InvalidStatusError,
  StepNotFoundError,
  getStep,
  loadWorkflow,
  updateStepStatus,
} from './workflowStore';

const PUBLIC_DIR = path.join(__dirname, 'public');
const STEP_ID_RE = /^\/api\/workflow\/steps\/([^/]+)(\/(prompt|select))?$/;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const previewWatcher = new PreviewWatcher();
const sseClients = new Set<http.ServerResponse>();

previewWatcher.on('preview', (event) => {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
});

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/status') {
      const workflow = loadWorkflow();
      const aiServices = loadAiServices();
      sendJson(res, 200, {
        workflow: { ok: workflow.ok, error: workflow.error },
        aiServices: { ok: aiServices.ok, error: aiServices.error },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/workflow') {
      sendJson(res, 200, loadWorkflow().data);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/ai-services') {
      sendJson(res, 200, loadAiServices().data);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/preview/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    const stepMatch = pathname.match(STEP_ID_RE);
    if (stepMatch) {
      const stepId = decodeURIComponent(stepMatch[1]);
      const action = stepMatch[3];

      if (req.method === 'PATCH' && !action) {
        const body = (await readJsonBody(req)) as { status?: string };
        if (typeof body.status !== 'string') {
          sendJson(res, 400, { error: 'Missing "status" field' });
          return;
        }
        try {
          sendJson(res, 200, updateStepStatus(stepId, body.status));
        } catch (err) {
          if (err instanceof StepNotFoundError) sendJson(res, 404, { error: err.message });
          else if (err instanceof InvalidStatusError) sendJson(res, 400, { error: err.message });
          else throw err;
        }
        return;
      }

      if (req.method === 'GET' && action === 'prompt') {
        const step = getStep(loadWorkflow().data, stepId);
        if (!step) {
          sendJson(res, 404, { error: `Step not found: ${stepId}` });
          return;
        }
        sendJson(res, 200, generatePrompt(step));
        return;
      }

      if (req.method === 'POST' && action === 'select') {
        const step = getStep(loadWorkflow().data, stepId);
        if (!step) {
          sendJson(res, 404, { error: `Step not found: ${stepId}` });
          return;
        }
        previewWatcher.watchStep(step);
        sendJson(res, 200, { watching: step.output_files });
        return;
      }
    }

    if (req.method === 'GET' && serveStatic(req, res, pathname)) {
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message });
  }
});

export function startServer(port: number): http.Server {
  return server.listen(port, () => {
    console.log(`ai-manager server listening on http://localhost:${port}`);
  });
}
