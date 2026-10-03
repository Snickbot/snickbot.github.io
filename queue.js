// Job queue: one job at a time, limited retries, fallback to next eligible provider.
let running = false;

function addJob(p, s) {
  const j = { id: uid(), sceneId: s.id, provider: '', status: 'WAITING', created: Date.now(), started: null, done: null,
    error: '', retries: 0, output: '', msg: 'Waiting in the queue.' };
  p.jobs = (p.jobs || []).filter(x => x.sceneId !== s.id);
  p.jobs.push(j); s.status = 'WAITING';
}

async function runQueue(projectId) {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const p = db.projects.find(x => x.id === projectId);
      const j = p && (p.jobs || []).find(x => x.status === 'WAITING');
      if (!j) break;
      await runJob(p, j);
    }
  } finally { running = false; ui(); }
}

async function runJob(p, j) {
  const s = p.scenes.find(x => x.id === j.sceneId);
  if (!s) { j.status = 'FAILED'; return; }
  const set = (st, msg) => { j.status = st; j.msg = msg; s.status = st; save(); ui(); };
  const list = s.provider ? [s.provider] : (p.priority || DEFAULT_PRIORITY);
  const max = p.maxRetries || 2, notes = [];
  j.started = Date.now();
  for (const id of list) {
    const pr = pv(id); if (!pr) continue;
    if (s.ref && !pr.caps.refs) { notes.push(pr.name + ' skipped: it does not support reference images.'); continue; }
    if (!(await pr.checkAvailability()).ok) { notes.push(pr.name + ' is unavailable right now.'); continue; }
    j.provider = id;
    for (let a = 1; a <= max; a++) {
      set('PROCESSING', `Generating with ${pr.name}, attempt ${a} of ${max}...`);
      try {
        const r = await pr.generateVideo({ prompt: s.prompt, ref: s.ref, dur: s.dur, ratio: p.ratio });
        j.output = r.output; j.done = Date.now(); j.error = '';
        return set('COMPLETED', 'Completed with ' + pr.name + '.');
      } catch (e) {
        if (e.code === 'MANUAL') return set('MANUAL_REQUIRED', 'Manual action required: ' + pr.name + ' cannot be automated. Copy the prompt, make the clip yourself, then tap Mark completed.');
        j.retries++;
        if (a < max) { set('RETRYING', `${pr.name} failed (${e.message}). Trying again in 1 second.`); await sleep(1000); }
        else notes.push(`${pr.name} failed ${max} times. Moving to the next eligible provider.`);
      }
    }
  }
  j.done = Date.now();
  j.error = notes.join(' ') + ' No eligible provider could take this scene.';
  set('FAILED', j.error + ' Pick another provider for this scene or try again later.');
}

function renderQueue() {
  const el = document.getElementById('queue'), p = proj();
  if (!el || !p) return;
  document.querySelectorAll('details[data-i] .tag').forEach((t, i) => { if (p.scenes[i]) t.textContent = label(p.scenes[i].status); });
  el.innerHTML = `<b>Generation queue</b><div class="mute">Mock providers only. No real video is created yet.</div>
  <label>Max attempts per provider<input type="number" min="1" max="5" data-p="maxRetries" value="${p.maxRetries || 2}"></label>
  <div class="row"><button data-act="genall">Generate all</button><button class="alt" data-act="retryfailed">Retry failed</button></div>` +
  p.scenes.map((s, i) => {
    const j = (p.jobs || []).find(x => x.sceneId === s.id), st = j ? j.status : 'IDLE';
    let btn = '';
    if (st === 'MANUAL_REQUIRED') btn = `<button class="alt" data-act="copy">Copy prompt</button>${s.ref ? '<button class="alt" data-act="dlref">Download reference</button>' : ''}<button data-act="markdone">Mark completed</button>`;
    else if (!['WAITING', 'PROCESSING', 'RETRYING'].includes(st)) btn = `<button class="alt" data-act="gen">${st === 'IDLE' ? 'Generate' : 'Generate again'}</button>`;
    return `<div class="qrow" data-i="${i}"><b>${i + 1}. ${esc(s.title)}</b><span class="tag">${j ? label(st) : 'Not queued'}</span>
    <div class="mute">${esc(j ? j.msg : 'Needs a video prompt, then tap Generate.')}</div>${btn ? `<div class="row">${btn}</div>` : ''}</div>`;
  }).join('');
}

function ui() { renderQueue(); if (document.getElementById('dash')) dash(); }

function queueAct(a, i) {
  const p = proj(), s = p.scenes[i], jobs = p.jobs || [];
  if (a === 'gen' || a === 'genall' || a === 'retryfailed') {
    const t = a === 'gen' ? [s] : p.scenes.filter(x => { const j = jobs.find(y => y.sceneId === x.id); return a === 'retryfailed' ? j && j.status === 'FAILED' : !j || j.status === 'FAILED'; });
    let skip = 0;
    t.forEach(x => x.prompt.trim() ? addJob(p, x) : skip++);
    if (skip) alert(skip + ' scene(s) skipped: add a video prompt first.');
    save(); ui(); runQueue(p.id);
  } else if (a === 'copy') navigator.clipboard.writeText(s.prompt).then(() => alert('Prompt copied.'), () => alert('Copy failed. Copy the prompt from the scene card instead.'));
  else if (a === 'dlref') { const l = document.createElement('a'); l.href = s.ref; l.download = 'reference-' + (i + 1) + '.jpg'; l.click(); }
  else if (a === 'markdone') {
    const j = jobs.find(y => y.sceneId === s.id);
    j.status = 'COMPLETED'; j.msg = 'Marked completed manually.'; j.output = 'manual'; s.status = 'COMPLETED'; save(); ui();
  }
}
