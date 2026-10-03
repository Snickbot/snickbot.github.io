// Provider interface + capability data. Phase 2 uses MOCK providers only.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = (code, msg) => Object.assign(new Error(msg), { code });

class VideoProvider {
  constructor(id, name, caps) { this.id = id; this.name = name; this.caps = caps; }
  async checkAvailability() { return { ok: true }; }
  async generateVideo(job) { throw fail('NOT_IMPLEMENTED', 'generateVideo is not implemented'); }
}

// mode 'ok' = succeeds after 3s, 'busy' = always refuses jobs, 'down' = reports unavailable
class MockProvider extends VideoProvider {
  constructor(id, name, caps, mode) { super(id, name, caps); this.mode = mode; }
  async checkAvailability() { return { ok: this.mode !== 'down' }; }
  async generateVideo(job) {
    await sleep(3000);
    if (this.mode === 'busy') throw fail('UNAVAILABLE', 'provider is busy');
    return { output: 'mock-video.mp4 (mock result, no real video)' };
  }
}

// Providers without an authorized automation method: user does the work by hand.
class ManualProvider extends VideoProvider {
  async generateVideo() { throw fail('MANUAL', 'manual'); }
}

const PROVIDERS = [
  new MockProvider('mock-busy', 'Mock: busy provider', { refs: true }, 'busy'),
  new MockProvider('mock-noref', 'Mock: no reference images', { refs: false }, 'ok'),
  new MockProvider('mock-ok', 'Mock: working provider', { refs: true }, 'ok'),
  new ManualProvider('manual', 'Manual / Unsupported Automation', { refs: true, manual: true })
];
const DEFAULT_PRIORITY = ['mock-busy', 'mock-noref', 'mock-ok'];
const pv = id => PROVIDERS.find(x => x.id === id);
