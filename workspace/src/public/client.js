const bannerEl = document.getElementById('banner');
const stepsEl = document.getElementById('steps');
const promptEl = document.getElementById('prompt');
const previewLogEl = document.getElementById('preview-log');

const STATUS_LABEL = { not_started: '未着手', in_progress: '進行中', done: '完了' };
let selectedStepId = null;

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

function renderBanner(status) {
  const problems = [status.workflow, status.aiServices].filter((s) => !s.ok).map((s) => s.error);
  if (problems.length === 0) {
    bannerEl.style.display = 'none';
    return;
  }
  bannerEl.textContent = problems.join(' / ');
  bannerEl.style.display = 'block';
}

function renderSteps(workflow) {
  stepsEl.innerHTML = '';
  const steps = [...workflow.steps].sort((a, b) => a.index - b.index);
  for (const step of steps) {
    const div = document.createElement('div');
    div.className = 'step' + (step.id === selectedStepId ? ' selected' : '');
    div.innerHTML = `
      <strong>#${step.index} ${step.role}</strong>
      (<span>${step.ai_name}</span>)
      <span class="status ${step.status}">${STATUS_LABEL[step.status]}</span>
      <div>
        <button data-action="not_started">未着手</button>
        <button data-action="in_progress">進行中</button>
        <button data-action="done">完了</button>
      </div>
    `;
    div.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action) {
        e.stopPropagation();
        updateStatus(step.id, action);
      } else {
        selectStep(step.id);
      }
    });
    stepsEl.appendChild(div);
  }
}

async function loadAll() {
  const [status, workflow] = await Promise.all([
    fetchJson('/api/status'),
    fetchJson('/api/workflow'),
  ]);
  renderBanner(status);
  renderSteps(workflow);
}

async function updateStatus(stepId, status) {
  await fetchJson(`/api/workflow/steps/${encodeURIComponent(stepId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  await loadAll();
}

async function selectStep(stepId) {
  selectedStepId = stepId;
  await fetchJson(`/api/workflow/steps/${encodeURIComponent(stepId)}/select`, { method: 'POST' });
  const { prompt, missingFiles } = await fetchJson(
    `/api/workflow/steps/${encodeURIComponent(stepId)}/prompt`
  );
  promptEl.textContent = missingFiles.length
    ? `${prompt}\n\n[警告: 見つからないファイル: ${missingFiles.join(', ')}]`
    : prompt;
  const workflow = await fetchJson('/api/workflow');
  renderSteps(workflow);
}

function connectPreviewStream() {
  const source = new EventSource('/api/preview/stream');
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString();
    li.textContent = `[${time}] ${data.file} — ${data.type}`;
    previewLogEl.prepend(li);
  };
}

loadAll();
connectPreviewStream();
