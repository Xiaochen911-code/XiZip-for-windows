/* ============================================================
   XiZip 前端
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = {
  stage: $('#stage'),
  mini: $('#miniWindow'),
  miniBody: $('#miniBody'),
  miniEmpty: $('#miniEmpty'),
  miniContent: $('#miniContent'),
  miniName: $('#miniName'),
  miniSub: $('#miniSub'),
  miniSummary: $('#miniSummary'),
  miniCount: $('#miniCount'),
  miniList: $('#miniList'),
  miniPath: $('#miniPath'),
  miniUp: $('#miniUp'),
  miniBrowse: $('#miniBrowse'),
  miniPreview: $('#miniPreview'),
  miniPreviewBack: $('#miniPreviewBack'),
  miniPreviewName: $('#miniPreviewName'),
  miniPreviewType: $('#miniPreviewType'),
  miniPreviewBody: $('#miniPreviewBody'),
  miniPreviewMeta: $('#miniPreviewMeta'),
  ratioArc: $('#ratioArc'),
  ratioText: $('#ratioText'),

  max: $('#maxWindow'),
  maxBody: $('#maxBody'),
  maxFooter: $('#maxFooter'),
  maxFileName: $('#maxFileName'),

  homeView: $('#homeView'),
  gpuChip: $('#gpuChip'),
  gpuName: $('#gpuName'),
  homeMax: $('#homeMax'),
  homeMini: $('#homeMini'),
  homeNew: $('#homeNew'),

  createLayer: $('#createLayer'),
  createSetup: $('#createSetup'),
  createProgress: $('#createProgress'),
  createFileList: $('#createFileList'),
  createFilesMeta: $('#createFilesMeta'),
  createName: $('#createName'),
  createFolder: $('#createFolder'),
  createPct: $('#createPct'),
  createBar: $('#createBar'),
  createState: $('#createState'),
  createCurrent: $('#createCurrent'),
  createStart: $('#createStart'),
  createAbort: $('#createAbort'),
  createCancel: $('#createCancel'),
  createPickFiles: $('#createPickFiles'),
  createPickFolder: $('#createPickFolder'),

  tree: $('#tree'),
  treeCount: $('#treeCount'),
  crumbs: $('#crumbs'),
  searchInput: $('#searchInput'),
  fileList: $('#fileList'),
  listEmpty: $('#listEmpty'),
  listStat: $('#listStat'),
  filterRow: $('#filterRow'),

  previewPanel: $('#previewPanel'),
  previewBody: $('#previewBody'),
  previewMeta: $('#previewMeta'),
  previewType: $('#previewType'),

  dropOverlay: $('#dropOverlay'),
  dropTitle: $('#dropTitle'),
  dropSub: $('#dropSub'),
  toasts: $('#toasts'),
  live: $('#live'),

  extractLayer: $('#extractLayer'),
  extractArc: $('#extractArc'),
  extractPct: $('#extractPct'),
  extractTitle: $('#extractTitle'),
  extractFile: $('#extractFile'),
  extractBar: $('#extractBar'),
  extractMeta: $('#extractMeta'),

  archiveInput: $('#archiveInput'),
  fileInput: $('#fileInput'),
  openBtn: $('#openBtn'),

  settingsLayer: $('#settingsLayer'),
  setGlow: $('#setGlow'),
  setGlass: $('#setGlass'),
  setMotion: $('#setMotion'),
  setDensity: $('#setDensity'),
  setRadius: $('#setRadius'),
  setGlowLevel: $('#setGlowLevel'),
  setGrain: $('#setGrain'),
  gpuStateText: $('#gpuStateText'),
  gpuStateTag: $('#gpuStateTag'),
  aboutVersion: $('#aboutVersion'),
  aboutKernel: $('#aboutKernel'),
  aboutKernelVersion: $('#aboutKernelVersion'),
  aboutWebview: $('#aboutWebview'),
  aboutGpu: $('#aboutGpu'),
  aboutPython: $('#aboutPython'),
};

const state = {
  archive: null,
  entries: [],
  view: 'home',
  openTarget: 'max',
  gpu: null,
  currentFolder: '',
  expanded: new Set(['']),
  selection: null,
  previewSeq: 0,
  previewUrl: null,
  addFolder: '',
  dragDepth: 0,
  dragMode: 'open',
  dragPanel: null,
  search: '',
  miniFolder: '',
  miniSelection: null,
  miniPreviewSeq: 0,
  miniPreviewUrl: null,
  selected: new Set(),
  anchorPath: null,
  sort: 'name-asc',
  filter: 'all',
  windowMode: 'max',
  extracting: false,
  createFiles: [],
  createFolder: '',
  createJobId: null,
  createPacking: false,
};

/* ------------------------------------------------------------
   工具
   ------------------------------------------------------------ */

const KIND_MAP = [
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg']],
  ['text', ['txt', 'md', 'markdown', 'log']],
  ['data', ['csv', 'tsv']],
  ['code', ['json', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'env', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bat', 'ps1', 'sql']],
  ['archive', ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'jar', 'apk']],
  ['audio', ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']],
  ['video', ['mp4', 'webm', 'mov', 'mkv', 'avi']],
  ['pdf', ['pdf']],
];

const ARCHIVE_EXT = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'cab', 'iso', 'apk', 'jar', '001']);

const FILTERS = {
  all: () => true,
  folder: (entry) => entry.is_dir,
  image: (entry) => kindOf(entry) === 'image',
  doc: (entry) => ['text', 'code', 'data', 'pdf'].includes(kindOf(entry)),
  archive: (entry) => kindOf(entry) === 'archive',
  media: (entry) => ['audio', 'video'].includes(kindOf(entry)),
};

const ICONS = {
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 7.2h5.8l1.9 2.2H20.6v8.4a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8V7.2Z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.6" y="4.8" width="16.8" height="14.4" rx="2"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="m4.6 17.2 4.8-5 3.2 3.4 2.2-2.3 4 4.2"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.6h8l4.2 4.2V20a.8.8 0 0 1-.8.8H6.8A.8.8 0 0 1 6 20V4.4Z"/><path d="M14 3.8v4.4h4.2M8.6 12h6.4M8.6 15.2h6.4M8.6 18.2h4"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 8.2 4.8 12l3.8 3.8M15.4 8.2 19.2 12l-3.8 3.8"/><path d="M13.4 5.6 10.6 18.4"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.4h16M4 14.6h16M9.4 4v16M14.6 4v16"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="8" width="17" height="11" rx="2.2"/><path d="M2.8 5.2h18.4v2.8H2.8z"/><path d="M12 8v3.2M12 13.2v1.4"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17V6.2l9-2v10.6"/><circle cx="6.6" cy="17.4" r="2.4"/><circle cx="15.6" cy="15" r="2.4"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.4"/><path d="m9.8 8.6 5 3.4-5 3.4V8.6Z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.6h8l4.2 4.2V20a.8.8 0 0 1-.8.8H6.8A.8.8 0 0 1 6 20V4.4Z"/><path d="M14 3.8v4.4h4.2"/><path d="M8.4 17.4c2.4-.4 4.4-2.6 5.4-5M9.2 10.2c1.1 2.9 2.4 5.4 4.4 7.2"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.6h8l4.2 4.2V20a.8.8 0 0 1-.8.8H6.8A.8.8 0 0 1 6 20V4.4Z"/><path d="M14 3.8v4.4h4.2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 5.5 6 6.5-6 6.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 3.6 3.6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
};

function kindOf(entry) {
  if (entry.is_dir) return 'folder';
  const ext = (entry.ext || '').toLowerCase();
  for (const [kind, exts] of KIND_MAP) {
    if (exts.includes(ext)) return kind;
  }
  return 'file';
}

function iconEl(entry, cls = 'type-ico') {
  const kind = kindOf(entry);
  const wrap = document.createElement('span');
  wrap.className = cls;
  wrap.dataset.kind = kind;
  wrap.innerHTML = ICONS[kind] || ICONS.file;
  return wrap;
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatDate(value) {
  if (!value) return '—';
  return value.length >= 16 ? value.slice(0, 16) : value;
}

function fileExt(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}

function archiveFile(file) {
  return ARCHIVE_EXT.has(fileExt(file.name || ''));
}

function toast(message, type = 'info', duration = 3200) {
  const node = document.createElement('div');
  node.className = `toast ${type === 'error' ? 'error' : ''}`;
  const dot = document.createElement('span');
  dot.className = 'toast-dot';
  const text = document.createElement('span');
  text.textContent = message;
  node.append(dot, text);
  el.toasts.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 320);
  }, duration);
}

function announce(message) {
  el.live.textContent = message;
}

function setBusy(win, on) {
  win.classList.toggle('uploading', on);
  win.setAttribute('aria-busy', on ? 'true' : 'false');
}

function setArchive(payload) {
  state.archive = payload;
  state.entries = payload.entries || [];
  state.currentFolder = '';
  state.expanded = new Set(['']);
  state.selection = null;
  state.previewSeq += 1;
  clearPreviewUrl();
  state.selected = new Set();
  state.anchorPath = null;
  state.miniFolder = '';
  state.miniSelection = null;
  state.miniPreviewSeq += 1;
  clearMiniPreviewUrl();
  el.miniPreview.hidden = true;
  el.miniBrowse.hidden = false;
  el.searchInput.value = '';
  state.search = '';
  state.filter = 'all';
  syncFilterChips();

  renderMini();
  renderMax();
  applyView();
}

function applyArchiveUpdate(payload, { selectPath = null } = {}) {
  state.archive = payload;
  state.entries = payload.entries || [];
  state.selected = new Set(
    [...state.selected].filter((path) => state.entries.some((entry) => entry.path === path)),
  );
  if (!state.entries.find((e) => e.path === state.currentFolder)) {
    state.currentFolder = '';
  }
  if (!state.entries.find((e) => e.path === state.miniFolder)) {
    state.miniFolder = '';
  }
  if (state.miniSelection
      && !state.entries.some((e) => e.path === state.miniSelection.path)) {
    state.miniSelection = null;
    closeMiniPreview();
  }
  if (selectPath) {
    const found = state.entries.find((e) => e.path === selectPath);
    state.selection = found || null;
  } else if (state.selection) {
    const found = state.entries.find((e) => e.path === state.selection.path);
    state.selection = found || null;
  }
  renderMini();
  renderMax();
}

function clearPreviewUrl() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
}

/* ------------------------------------------------------------
   网络
   ------------------------------------------------------------ */

function xhrPost(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    xhr.onload = () => {
      let data = xhr.response;
      if (!data) {
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
      else reject(new Error((data && data.error) || `请求失败（${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error('网络连接中断'));
    xhr.send(formData);
  });
}

async function jsonPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && data.error) || `请求失败（${response.status}）`);
  return data;
}

async function jsonGet(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && data.error) || `请求失败（${response.status}）`);
  return data;
}

/* ------------------------------------------------------------
   打开 / 新建
   ------------------------------------------------------------ */

async function openArchive(file, target = state.openTarget) {
  if (!file) return;
  const win = el.max;
  setBusy(win, true);
  const form = new FormData();
  form.append('file', file);
  try {
    const payload = await xhrPost('/api/open', form);
    state.view = target === 'mini' ? 'mini' : 'max';
    setArchive(payload);
    toast(`已打开「${payload.name}」，${payload.fileCount} 个文件`);
    announce(`已打开压缩包 ${payload.name}`);
  } catch (error) {
    toast(error.message, 'error', 4200);
  } finally {
    setBusy(win, false);
  }
}

async function createArchive() {
  openCreateLayer();
}

/* ------------------------------------------------------------
   新建压缩包
   ------------------------------------------------------------ */

function renderCreateFiles() {
  const files = state.createFiles;
  el.createFileList.innerHTML = '';
  el.createFileList.hidden = files.length === 0;
  if (!files.length) {
    el.createFilesMeta.textContent = '还没有选择文件';
    return;
  }
  const bytes = files.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  el.createFilesMeta.textContent = `已选 ${files.length} 个文件 · ${formatSize(bytes)}`;
  files.slice(0, 30).forEach((item) => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.name;
    name.title = item.path;
    const size = document.createElement('em');
    size.textContent = formatSize(item.size);
    row.append(name, size);
    el.createFileList.appendChild(row);
  });
  if (files.length > 30) {
    const more = document.createElement('li');
    more.className = 'create-files-more';
    more.textContent = `… 还有 ${files.length - 30} 个文件`;
    el.createFileList.appendChild(more);
  }
}

function resetCreateLayer() {
  state.createFiles = [];
  state.createFolder = '';
  state.createJobId = null;
  state.createPacking = false;
  el.createName.value = '';
  el.createName.disabled = false;
  el.createFolder.textContent = '尚未选择文件夹';
  el.createFolder.classList.remove('is-set');
  el.createFolder.title = '';
  el.createSetup.hidden = false;
  el.createProgress.hidden = true;
  el.createStart.hidden = false;
  el.createAbort.hidden = true;
  el.createCancel.hidden = false;
  el.createCancel.disabled = false;
  el.createPickFiles.disabled = false;
  el.createPickFolder.disabled = false;
  el.createBar.classList.remove('is-idle');
  const fill = el.createBar.firstElementChild;
  if (fill) fill.style.width = '0%';
  el.createPct.textContent = '0%';
  renderCreateFiles();
}

function openCreateLayer() {
  resetCreateLayer();
  el.createLayer.hidden = false;
  el.createName.focus();
}

function closeCreateLayer() {
  if (state.createPacking) {
    abortCreate();
    return;
  }
  el.createLayer.hidden = true;
}

async function pickCreateFiles() {
  try {
    const data = await jsonPost('/api/pick/files', {});
    if (!data || data.cancelled) return;
    state.createFiles = data.files || [];
    renderCreateFiles();
  } catch (error) {
    toast(error.message, 'error', 3600);
  }
}

async function pickCreateFolder() {
  try {
    const data = await jsonPost('/api/pick/folder', {});
    if (!data || data.cancelled) return;
    state.createFolder = data.folder || '';
    el.createFolder.textContent = state.createFolder || '尚未选择文件夹';
    el.createFolder.classList.toggle('is-set', Boolean(state.createFolder));
    el.createFolder.title = state.createFolder;
  } catch (error) {
    toast(error.message, 'error', 3600);
  }
}

function paintCreateProgress(snapshot) {
  const percent = Math.max(0, Math.min(100, Number(snapshot.percent) || 0));
  el.createPct.textContent = `${percent}%`;
  const fill = el.createBar.firstElementChild;
  if (fill) fill.style.width = `${percent}%`;
  el.createBar.classList.toggle('is-idle', percent <= 0 && snapshot.state === 'running');
  if (snapshot.state === 'done') el.createState.textContent = '打包完成';
  else if (snapshot.state === 'cancelled') el.createState.textContent = '已取消';
  else if (snapshot.state === 'error') el.createState.textContent = '打包失败';
  else el.createState.textContent = '正在打包…';

  const current = (snapshot.current || '').trim();
  if (current) {
    el.createCurrent.textContent = current;
  } else if (snapshot.state === 'running') {
    el.createCurrent.textContent = `共 ${snapshot.total || 0} 个文件`;
  } else {
    el.createCurrent.textContent = snapshot.error || '';
  }
}

async function followCreate(jobId) {
  for (;;) {
    let snapshot;
    try {
      snapshot = await jsonGet(`/api/jobs/${jobId}`);
    } catch (error) {
      if (state.createJobId !== jobId) return;
      state.createJobId = null;
      state.createPacking = false;
      el.createLayer.hidden = true;
      toast(error.message, 'error', 4200);
      return;
    }
    if (state.createJobId !== jobId) return;
    paintCreateProgress(snapshot);

    if (snapshot.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 260));
      continue;
    }

    state.createJobId = null;
    state.createPacking = false;

    if (snapshot.state === 'done' && snapshot.sid) {
      try {
        const payload = await jsonGet(`/api/archives/${snapshot.sid}/info`);
        el.createLayer.hidden = true;
        state.view = 'max';
        setArchive(payload);
        toast(`已新建「${payload.name}」，包含 ${payload.fileCount} 个文件`);
        announce(`已新建压缩包 ${payload.name}`);
      } catch (error) {
        el.createLayer.hidden = true;
        toast(error.message, 'error', 4200);
      }
      return;
    }

    el.createLayer.hidden = true;
    toast(
      snapshot.state === 'cancelled' ? '已取消新建' : (snapshot.error || '新建压缩包失败'),
      snapshot.state === 'cancelled' ? 'info' : 'error',
      3600,
    );
    return;
  }
}

async function startCreate() {
  if (state.createPacking) return;
  if (!state.createFiles.length) {
    toast('先选择要压缩的文件', 'error', 1800);
    return;
  }
  if (!state.createFolder) {
    toast('先选择保存位置', 'error', 1800);
    return;
  }

  state.createPacking = true;
  el.createSetup.hidden = true;
  el.createProgress.hidden = false;
  el.createStart.hidden = true;
  el.createAbort.hidden = false;
  el.createCancel.hidden = true;
  el.createCancel.disabled = true;
  el.createPickFiles.disabled = true;
  el.createPickFolder.disabled = true;
  el.createName.disabled = true;
  paintCreateProgress({ percent: 0, state: 'running', total: state.createFiles.length });

  try {
    const data = await jsonPost('/api/create', {
      files: state.createFiles.map((item) => item.path),
      folder: state.createFolder,
      name: el.createName.value.trim(),
    });
    state.createJobId = data.jobId;
    await followCreate(data.jobId);
  } catch (error) {
    state.createPacking = false;
    el.createProgress.hidden = true;
    el.createSetup.hidden = false;
    el.createStart.hidden = false;
    el.createAbort.hidden = true;
    el.createCancel.hidden = false;
    el.createCancel.disabled = false;
    el.createPickFiles.disabled = false;
    el.createPickFolder.disabled = false;
    el.createName.disabled = false;
    toast(error.message, 'error', 4200);
  }
}

async function abortCreate() {
  const jobId = state.createJobId;
  state.createJobId = null;
  state.createPacking = false;
  if (jobId) {
    try {
      await jsonPost(`/api/jobs/${jobId}/cancel`, {});
    } catch {
      /* 取消失败也直接关闭界面 */
    }
  }
  el.createLayer.hidden = true;
  toast('已取消新建');
}

async function loadGpu() {
  try {
    const response = await fetch('/api/gpu');
    if (!response.ok) throw new Error('GPU 信息不可用');
    const data = await response.json();
    if (!data || !data.name) throw new Error('未检测到渲染设备');
    state.gpu = data;
    el.gpuName.textContent = `GPU · ${data.name}`;
    el.gpuChip.title = data.accelerated
      ? 'WebView2 硬件加速已启用'
      : '未检测到可用的硬件渲染设备';
    el.gpuChip.hidden = false;
    applyGpuState(data);
    applyView();
  } catch {
    applyGpuState(null);
  }
}

function applyGpuState(gpu) {
  if (!el.gpuStateText || !el.gpuStateTag) return;
  if (!gpu || !gpu.name) {
    el.gpuStateText.textContent = '未检测到独立渲染设备，界面将使用软件合成。';
    el.gpuStateTag.textContent = '未启用';
    el.gpuStateTag.classList.add('off');
    return;
  }
  el.gpuStateTag.classList.remove('off');
  el.gpuStateText.textContent = gpu.accelerated
    ? `${gpu.name} 正由 WebView2 进行 GPU 合成与光栅化。`
    : `${gpu.name} 处于基础渲染模式，硬件加速可能受限。`;
  el.gpuStateTag.textContent = gpu.accelerated ? '已启用' : '受限';
}

/* ------------------------------------------------------------
   MINI 渲染
   ------------------------------------------------------------ */

function childrenOf(path, { dirsOnly = false } = {}) {
  const prefix = path ? `${path}/` : '';
  return state.entries
    .filter((entry) => {
      if (!entry.path.startsWith(prefix)) return false;
      const rest = entry.path.slice(prefix.length);
      if (!rest || rest.includes('/')) return false;
      return dirsOnly ? entry.is_dir : true;
    })
    .sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
}

function renderMini() {
  const archive = state.archive;
  if (!archive) {
    el.miniEmpty.hidden = false;
    el.miniContent.hidden = true;
    return;
  }
  el.miniEmpty.hidden = true;
  el.miniContent.hidden = false;

  el.miniName.textContent = archive.name;
  el.miniSub.textContent = `${archive.fileCount} 个文件 · ${formatSize(archive.size)}`;

  const saved = archive.totalSize > 0
    ? Math.max(0, Math.min(1, 1 - archive.packedSize / archive.totalSize))
    : 0;
  const circumference = 106.8;
  el.ratioArc.style.strokeDashoffset = String(circumference * (1 - saved));
  el.ratioText.textContent = `${Math.round(saved * 100)}%`;

  el.miniSummary.innerHTML = '';
  const chips = [
    ['文件', `${archive.fileCount}`],
    ['文件夹', `${archive.dirCount}`],
    ['原始大小', formatSize(archive.totalSize)],
  ];
  for (const [label, value] of chips) {
    const chip = document.createElement('span');
    chip.className = 'summary-chip';
    const text = document.createElement('span');
    text.innerHTML = `${label} <b>${value}</b>`;
    chip.appendChild(text);
    el.miniSummary.appendChild(chip);
  }

  if (state.miniFolder && !state.entries.find((e) => e.path === state.miniFolder)) {
    state.miniFolder = '';
  }
  const kids = childrenOf(state.miniFolder);
  el.miniPath.textContent = state.miniFolder || '根目录';
  el.miniPath.title = state.miniFolder || '根目录';
  el.miniUp.hidden = !state.miniFolder;
  el.miniCount.textContent = `${kids.length} 项`;
  el.miniList.innerHTML = '';
  kids.forEach((entry, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    const active = state.miniSelection && state.miniSelection.path === entry.path;
    row.className = `mini-row${active ? ' selected' : ''}`;
    row.dataset.path = entry.path;
    row.style.animationDelay = `${Math.min(index, 10) * 26}ms`;
    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = entry.name;
    name.title = entry.path;
    const size = document.createElement('span');
    size.className = 'row-size';
    size.textContent = entry.is_dir ? `${childrenOf(entry.path).length} 项` : formatSize(entry.size);
    row.append(iconEl(entry), name, size);
    row.addEventListener('click', () => {
      if (entry.is_dir) {
        state.miniFolder = entry.path;
        state.miniSelection = null;
        renderMini();
        return;
      }
      const isSame = state.miniSelection && state.miniSelection.path === entry.path;
      state.miniSelection = isSame ? null : entry;
      $$('.mini-row', el.miniList).forEach((node) => {
        node.classList.toggle(
          'selected',
          Boolean(state.miniSelection) && node.dataset.path === state.miniSelection.path,
        );
      });
    });
    row.addEventListener('dblclick', () => {
      if (!entry.is_dir) showMiniPreview(entry);
    });
    el.miniList.appendChild(row);
  });
}

/* ------------------------------------------------------------
   MINI 内嵌预览
   ------------------------------------------------------------ */

function clearMiniPreviewUrl() {
  if (state.miniPreviewUrl) {
    URL.revokeObjectURL(state.miniPreviewUrl);
    state.miniPreviewUrl = null;
  }
}

function closeMiniPreview() {
  state.miniPreviewSeq += 1;
  clearMiniPreviewUrl();
  el.miniPreview.hidden = true;
  el.miniBrowse.hidden = false;
  renderMini();
}

function miniPreviewFallback(entry, message) {
  el.miniPreviewBody.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'preview-file';
  box.appendChild(iconEl(entry));
  const name = document.createElement('p');
  name.className = 'pf-name';
  name.textContent = entry.name;
  const hint = document.createElement('p');
  hint.className = 'pf-note';
  hint.textContent = message || '该格式暂不支持内嵌预览，可先解压到本地查看。';
  box.append(name, hint);
  el.miniPreviewBody.appendChild(box);
}

function showMiniPreview(entry) {
  if (!state.archive) return;
  state.miniSelection = entry;
  el.miniBrowse.hidden = true;
  el.miniPreview.hidden = false;
  el.miniPreviewName.textContent = entry.name;
  el.miniPreviewName.title = entry.path;
  el.miniPreviewType.textContent = (entry.ext || 'file').toUpperCase();
  el.miniPreviewMeta.innerHTML = '';
  el.miniPreviewMeta.append(
    metaItem('大小', formatSize(entry.size)),
    metaItem('压缩后', formatSize(entry.packed)),
    metaItem('修改时间', formatDate(entry.mtime)),
  );

  const seq = ++state.miniPreviewSeq;
  clearMiniPreviewUrl();
  el.miniPreviewBody.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'preview-loading';
  loading.innerHTML = '<span class="spinner"></span><span>正在读取…</span>';
  el.miniPreviewBody.appendChild(loading);

  const url = `/api/archives/${state.archive.id}/preview?path=${encodeURIComponent(entry.path)}`;
  fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '无法预览该文件');
      }
      return response.blob();
    })
    .then((blob) => renderMiniPreviewBlob(entry, blob, seq))
    .catch((error) => {
      if (seq !== state.miniPreviewSeq) return;
      miniPreviewFallback(entry, error.message);
    });

  renderMini();
}

function renderMiniPreviewBlob(entry, blob, seq) {
  if (seq !== state.miniPreviewSeq) return;
  const kind = kindOf(entry);
  const type = blob.type || '';
  el.miniPreviewBody.innerHTML = '';
  clearMiniPreviewUrl();

  if (kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video'
      || type === 'application/pdf') {
    const url = URL.createObjectURL(blob);
    state.miniPreviewUrl = url;
    const wrap = document.createElement('div');
    wrap.className = 'preview-media';
    let node;
    if (kind === 'image') {
      node = document.createElement('img');
      node.src = url;
      node.alt = entry.name;
    } else if (kind === 'pdf' || type === 'application/pdf') {
      node = document.createElement('embed');
      node.src = url;
      node.type = 'application/pdf';
    } else if (kind === 'audio') {
      node = document.createElement('audio');
      node.src = url;
      node.controls = true;
    } else {
      node = document.createElement('video');
      node.src = url;
      node.controls = true;
    }
    wrap.appendChild(node);
    el.miniPreviewBody.appendChild(wrap);
    return;
  }

  if (kind === 'text' || kind === 'code' || kind === 'data') {
    if (entry.size > 2 * 1024 * 1024) {
      miniPreviewFallback(entry, '文件较大，已跳过内嵌预览，可解压后查看。');
      return;
    }
    blob.text().then((text) => {
      if (seq !== state.miniPreviewSeq) return;
      el.miniPreviewBody.innerHTML = '';
      const box = document.createElement('pre');
      box.className = 'preview-code';
      box.textContent = text.slice(0, 400000);
      el.miniPreviewBody.appendChild(box);
    });
    return;
  }

  miniPreviewFallback(entry, '该格式暂不支持内嵌预览，可先解压到本地查看。');
}

/* ------------------------------------------------------------
   MAX 渲染
   ------------------------------------------------------------ */

function applyView() {
  const hasArchive = Boolean(state.archive);
  const showHome = !hasArchive;

  el.stage.classList.toggle('view-home', state.view === 'home');
  el.stage.classList.toggle('view-max', state.view === 'max');
  el.stage.classList.toggle('view-mini', state.view === 'mini');

  el.mini.hidden = state.view !== 'mini';
  // 同一时刻只显示一个界面：MINI / MAX / 主页都在这一个窗口内切换
  el.max.hidden = state.view === 'mini';
  el.homeView.hidden = !showHome;
  el.maxBody.hidden = showHome;
  el.maxFooter.hidden = showHome;
  el.maxFileName.textContent = hasArchive ? state.archive.name : '新工作台';

  // MINI 用小窗口、MAX/主页用大窗口：切换时同步调整桌面窗口尺寸
  const mode = state.view === 'mini' ? 'mini' : 'max';
  if (mode !== state.windowMode) {
    state.windowMode = mode;
    syncWindowSize(mode);
  }
}

function syncWindowSize(mode) {
  jsonPost('/api/window/size', { mode }).catch(() => {});
}

function goHome() {
  state.view = 'home';
  state.archive = null;
  state.entries = [];
  state.selection = null;
  state.currentFolder = '';
  state.expanded = new Set(['']);
  state.search = '';
  state.previewSeq += 1;
  clearPreviewUrl();
  state.selected = new Set();
  state.anchorPath = null;
  state.miniFolder = '';
  state.miniSelection = null;
  state.miniPreviewSeq += 1;
  clearMiniPreviewUrl();
  el.miniPreview.hidden = true;
  el.miniBrowse.hidden = false;
  el.searchInput.value = '';
  el.previewBody.innerHTML = '';
  renderPreviewEmpty('打开压缩包后，在这里查看文件内容');
  renderMini();
  applyView();
}

function showMax() {
  if (!state.archive) { toast('先打开一个压缩包', 'error'); return; }
  state.view = 'max';
  state.expanded.add(state.currentFolder);
  applyView();
  renderMax();
}

/* MINI 视图「用 MAX 打开」：同一个窗口内切换视图 */
function handOffToMax(message = '已在 XiZip MAX 中打开') {
  if (!state.archive) { toast('先打开一个压缩包', 'error'); return; }
  showMax();
  toast(message);
  announce(message);
}

function hideMax() {
  goHome();
}

function activeWindow() {
  return state.view === 'mini' ? el.mini : el.max;
}

function renderMax() {
  if (!state.archive) return;
  el.maxFileName.textContent = state.archive.name;
  el.treeCount.textContent = `${state.archive.dirCount} 目录`;
  renderTree();
  renderList();
  renderPreview();
}

function renderTree() {
  el.tree.innerHTML = '';
  const rootName = state.archive ? state.archive.name : '根目录';

  const makeRow = (node, depth, isRoot) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `tree-row${isRoot ? ' root' : ''}${state.currentFolder === node.path ? ' selected' : ''}`;
    row.style.paddingLeft = `${6 + depth * 13}px`;
    row.title = node.path || rootName;

    const caret = document.createElement('span');
    const kids = node.is_dir ? childrenOf(node.path, { dirsOnly: true }) : [];
    const open = state.expanded.has(node.path);
    caret.className = `tree-caret${kids.length ? (open ? ' open' : '') : ' blank'}`;
    caret.innerHTML = ICONS.chevron;
    caret.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!kids.length) return;
      if (open) state.expanded.delete(node.path);
      else state.expanded.add(node.path);
      renderTree();
    });

    const ico = document.createElement('span');
    ico.className = 'tree-icon';
    ico.innerHTML = ICONS.folder;

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    const count = document.createElement('span');
    count.className = 'tree-count';
    count.textContent = kids.length ? `${kids.length}` : '';

    row.append(caret, ico, name, count);
    row.addEventListener('click', () => {
      state.currentFolder = node.path;
      state.expanded.add(node.path);
      state.selection = null;
      state.previewSeq += 1;
      renderTree();
      renderList();
      renderPreview();
    });

    el.tree.appendChild(row);
    if (node.is_dir && open && kids.length) {
      for (const child of kids) makeRow(child, depth + 1, false);
    }
  };

  makeRow({ path: '', name: rootName, is_dir: true }, 0, true);
}

function renderCrumbs() {
  el.crumbs.innerHTML = '';
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'crumb';
  root.textContent = state.archive ? state.archive.name : '根目录';
  root.title = '根目录';
  root.addEventListener('click', () => openFolder(''));
  el.crumbs.appendChild(root);

  if (!state.currentFolder) {
    root.classList.add('last');
    return;
  }

  let acc = '';
  const parts = state.currentFolder.split('/');
  parts.forEach((part, index) => {
    acc = acc ? `${acc}/${part}` : part;
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '/';
    el.crumbs.appendChild(sep);

    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = 'crumb';
    crumb.textContent = part;
    crumb.title = acc;
    const path = acc;
    crumb.addEventListener('click', () => openFolder(path));
    if (index === parts.length - 1) crumb.classList.add('last');
    el.crumbs.appendChild(crumb);
  });
}

function openFolder(path) {
  if (!path && state.currentFolder === '') return;
  state.currentFolder = path;
  let acc = '';
  if (path) {
    state.expanded.add(path);
    path.split('/').forEach((part) => {
      acc = acc ? `${acc}/${part}` : part;
      state.expanded.add(acc);
    });
  }
  state.selection = null;
  state.selected = new Set();
  state.anchorPath = null;
  state.previewSeq += 1;
  state.search = '';
  el.searchInput.value = '';
  renderTree();
  renderList();
  renderPreview();
}

function sortEntries(list) {
  const arr = [...list];
  const [key, dir] = state.sort.split('-');
  arr.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let cmp;
    if (key === 'size') cmp = (Number(a.size) || 0) - (Number(b.size) || 0);
    else if (key === 'mtime') cmp = String(a.mtime || '').localeCompare(String(b.mtime || ''));
    else cmp = a.name.localeCompare(b.name, 'zh-CN');
    return dir === 'desc' ? -cmp : cmp;
  });
  return arr;
}

function renderList() {
  renderCrumbs();
  const folder = state.currentFolder;
  let kids = childrenOf(folder);
  const filter = FILTERS[state.filter] || FILTERS.all;
  kids = kids.filter(filter);
  const query = state.search.trim().toLowerCase();
  if (query) {
    kids = kids.filter((entry) => entry.name.toLowerCase().includes(query));
  }
  kids = sortEntries(kids);

  el.fileList.innerHTML = '';
  el.listEmpty.hidden = kids.length > 0;
  el.listEmpty.classList.toggle('searching', Boolean(query));
  el.listEmpty.querySelector('span').textContent = query
    ? '没有匹配的文件'
    : state.filter !== 'all'
      ? '没有此类型的文件'
      : '这个文件夹是空的';

  kids.forEach((entry, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `file-row${state.selected.has(entry.path) ? ' selected' : ''}`;
    row.dataset.path = entry.path;
    row.style.animationDelay = `${Math.min(index, 16) * 18}ms`;

    const nameCell = document.createElement('div');
    nameCell.className = 'file-cell-name' + (entry.is_dir ? ' is-dir' : '');
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;
    name.title = entry.path;
    nameCell.append(iconEl(entry), name);

    const size = document.createElement('span');
    size.className = 'file-cell-meta';
    size.textContent = entry.is_dir ? `${childrenOf(entry.path).length} 项` : formatSize(entry.size);

    const date = document.createElement('span');
    date.className = 'file-cell-meta';
    date.textContent = entry.is_dir ? '—' : formatDate(entry.mtime);

    row.append(nameCell, size, date);

    row.addEventListener('click', (event) => selectEntry(entry, {
      additive: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
      visible: kids,
    }));
    row.addEventListener('dblclick', () => {
      if (entry.is_dir) openFolder(entry.path);
      else {
        selectEntry(entry);
        ensurePreviewVisible();
      }
    });

    el.fileList.appendChild(row);
  });
  updateListStat();
}

function updateListStat() {
  if (!el.listStat) return;
  const rows = $$('.file-row', el.fileList);
  const chosen = rows.filter((row) => state.selected.has(row.dataset.path));
  let bytes = 0;
  for (const row of chosen) {
    const entry = state.entries.find((item) => item.path === row.dataset.path);
    if (entry) bytes += entry.size || 0;
  }
  el.listStat.textContent = rows.length ? `已选 ${chosen.length} / ${rows.length}` : '—';
  el.listStat.title = chosen.length
    ? `已选 ${chosen.length} 项 · 合计 ${formatSize(bytes)}`
    : `当前显示 ${rows.length} 项`;
}

function syncFilterChips() {
  if (!el.filterRow) return;
  $$('.filter-chip', el.filterRow).forEach((chip) => {
    chip.classList.toggle('is-on', chip.dataset.filter === state.filter);
  });
}

function selectEntry(entry, options = {}) {
  const visible = options.visible || childrenOf(state.currentFolder);
  if (options.range && state.anchorPath) {
    const from = visible.findIndex((e) => e.path === state.anchorPath);
    const to = visible.findIndex((e) => e.path === entry.path);
    if (from >= 0 && to >= 0) {
      state.selected = new Set(
        visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((e) => e.path),
      );
    } else {
      state.selected.add(entry.path);
      state.anchorPath = entry.path;
    }
  } else if (options.additive) {
    if (state.selected.has(entry.path)) state.selected.delete(entry.path);
    else state.selected.add(entry.path);
    state.anchorPath = entry.path;
  } else {
    state.selected = new Set([entry.path]);
    state.anchorPath = entry.path;
  }
  state.selection = entry;
  paintSelection();
  renderPreview();
}

function paintSelection() {
  $$('.file-row', el.fileList).forEach((row) => {
    row.classList.toggle('selected', state.selected.has(row.dataset.path));
  });
  updateListStat();
}

function revealInMax(entry) {
  showMax();
  const target = entry.is_dir ? entry.path : entry.path.split('/').slice(0, -1).join('/');
  if (target !== state.currentFolder) {
    openFolder(target);
  }
  if (!entry.is_dir) {
    state.selection = entry;
    state.selected = new Set([entry.path]);
    state.anchorPath = entry.path;
    renderList();
    renderPreview();
  }
}

function ensurePreviewVisible() {
  if (el.previewPanel.hidden || el.previewPanel.style.display === 'none') {
    el.previewPanel.style.display = '';
    el.maxBody.classList.remove('no-preview');
  }
}

/* ------------------------------------------------------------
   预览
   ------------------------------------------------------------ */

function metaItem(label, value, title = '') {
  const box = document.createElement('div');
  box.className = 'meta-item';
  const lab = document.createElement('div');
  lab.className = 'meta-label';
  lab.textContent = label;
  const val = document.createElement('div');
  val.className = 'meta-value';
  val.textContent = value;
  if (title) val.title = title;
  box.append(lab, val);
  return box;
}

function renderPreviewEmpty(message = '选择一个文件以预览') {
  el.previewType.textContent = '—';
  el.previewMeta.innerHTML = '';
  el.previewBody.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'preview-placeholder';
  box.innerHTML = ICONS.eye;
  const title = document.createElement('div');
  title.className = 'ph-title';
  title.textContent = '即时预览';
  const sub = document.createElement('div');
  sub.textContent = message;
  box.append(title, sub);
  el.previewBody.appendChild(box);
}

function renderPreviewFolder(entry) {
  el.previewType.textContent = '文件夹';
  const kids = childrenOf(entry.path);
  const files = kids.filter((k) => !k.is_dir);
  el.previewMeta.innerHTML = '';
  const packed = files.reduce((sum, item) => sum + (item.packed || 0), 0);
  el.previewMeta.append(
    metaItem('位置', entry.path || '根目录', entry.path),
    metaItem('项目', `${kids.length} 项`),
    metaItem('大小', formatSize(entry.size)),
    metaItem('压缩后', formatSize(packed)),
  );
  el.previewBody.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'preview-folder';
  const glyph = document.createElement('span');
  glyph.className = 'big-folder';
  glyph.innerHTML = ICONS.folder;
  const name = document.createElement('div');
  name.className = 'pf-name';
  name.textContent = entry.name;
  const note = document.createElement('div');
  note.className = 'pf-note';
  note.textContent = `${kids.length} 个项目 · ${files.length} 个文件 · ${formatSize(entry.size)}`;
  box.append(glyph, name, note);
  el.previewBody.appendChild(box);
}

function renderPreview() {
  const entry = state.selection;
  if (!entry) {
    renderPreviewEmpty();
    return;
  }
  if (entry.is_dir) {
    renderPreviewFolder(entry);
    return;
  }

  el.previewType.textContent = (entry.ext || 'file').toUpperCase();
  el.previewMeta.innerHTML = '';
  el.previewMeta.append(
    metaItem('大小', formatSize(entry.size)),
    metaItem('压缩后', formatSize(entry.packed)),
    metaItem('修改时间', formatDate(entry.mtime)),
    metaItem('压缩率', entry.size > 0 ? `${Math.round((1 - entry.packed / entry.size) * 100)}%` : '—'),
  );

  const seq = ++state.previewSeq;
  el.previewBody.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'preview-loading';
  loading.innerHTML = '<span class="spinner"></span><span>正在读取…</span>';
  el.previewBody.appendChild(loading);

  const url = `/api/archives/${state.archive.id}/preview?path=${encodeURIComponent(entry.path)}`;
  fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '无法预览该文件');
      }
      const blob = await response.blob();
      return blob;
    })
    .then((blob) => {
      if (seq !== state.previewSeq) return;
      renderPreviewBlob(entry, blob);
    })
    .catch((error) => {
      if (seq !== state.previewSeq) return;
      renderPreviewFallback(entry, error.message);
    });
}

function renderPreviewBlob(entry, blob) {
  const kind = kindOf(entry);
  const type = blob.type || '';
  el.previewBody.innerHTML = '';
  clearPreviewUrl();

  if (kind === 'image') {
    state.previewUrl = URL.createObjectURL(blob);
    const media = document.createElement('div');
    media.className = 'preview-media';
    const img = document.createElement('img');
    img.src = state.previewUrl;
    img.alt = entry.name;
    media.appendChild(img);
    el.previewBody.appendChild(media);
    return;
  }

  if (kind === 'pdf' || type === 'application/pdf') {
    state.previewUrl = URL.createObjectURL(blob);
    const media = document.createElement('div');
    media.className = 'preview-media';
    const embed = document.createElement('embed');
    embed.src = state.previewUrl;
    embed.type = 'application/pdf';
    embed.style.width = '100%';
    embed.style.height = '100%';
    media.appendChild(embed);
    el.previewBody.appendChild(media);
    return;
  }

  if (kind === 'audio') {
    state.previewUrl = URL.createObjectURL(blob);
    const media = document.createElement('div');
    media.className = 'preview-media audio';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = state.previewUrl;
    media.appendChild(audio);
    el.previewBody.appendChild(media);
    return;
  }

  if (kind === 'video') {
    state.previewUrl = URL.createObjectURL(blob);
    const media = document.createElement('div');
    media.className = 'preview-media video';
    const video = document.createElement('video');
    video.controls = true;
    video.src = state.previewUrl;
    media.appendChild(video);
    el.previewBody.appendChild(media);
    return;
  }

  if (kind === 'text' || kind === 'code' || kind === 'data' || type.startsWith('text/')) {
    if (blob.size > 2 * 1024 * 1024) {
      renderPreviewFallback(entry, '文本超过 2 MB，建议解压后查看');
      return;
    }
    blob.text().then((text) => {
      const pre = document.createElement('pre');
      pre.className = 'preview-code';
      pre.textContent = text;
      el.previewBody.innerHTML = '';
      el.previewBody.appendChild(pre);
    });
    return;
  }

  renderPreviewFallback(entry, '该格式暂不支持在线预览');
}

function renderPreviewFallback(entry, message) {
  el.previewBody.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'preview-file';
  box.appendChild(iconEl(entry));
  const name = document.createElement('div');
  name.className = 'pf-name';
  name.textContent = entry.name;
  const note = document.createElement('div');
  note.className = 'pf-note';
  note.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost-btn';
  button.textContent = '解压此文件';
  button.addEventListener('click', () => extractAll([entry.path], 'single'));
  box.append(name, note, button);
  el.previewBody.appendChild(box);
}

/* ------------------------------------------------------------
   解压进度
   ------------------------------------------------------------ */

const EXTRACT_CIRC = 2 * Math.PI * 52;

function paintExtract({ percent = 0, current = '', total = 0, state = 'running' }) {
  const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
  el.extractArc.style.strokeDashoffset = String(EXTRACT_CIRC * (1 - value / 100));
  el.extractPct.innerHTML = `${value}<i>%</i>`;
  el.extractBar.style.width = `${value}%`;
  el.extractFile.textContent = current || (state === 'running' ? '正在写入文件…' : '—');
  const done = total > 0 ? Math.min(total, Math.round((value / 100) * total)) : 0;
  el.extractMeta.textContent = total > 0
    ? `${done} / ${total} 个文件`
    : '等待 7-Zip 内核响应';
}

function openExtractLayer() {
  el.extractLayer.dataset.state = 'running';
  el.extractTitle.textContent = '正在解压';
  paintExtract({ percent: 0, current: '', total: 0 });
  el.extractLayer.hidden = false;
  announce('开始解压');
}

function closeExtractLayer() {
  el.extractLayer.hidden = true;
  state.extracting = false;
}

function flashExtractLayer(state, title, meta, duration = 700) {
  el.extractLayer.dataset.state = state;
  el.extractTitle.textContent = title;
  el.extractMeta.textContent = meta;
  setTimeout(closeExtractLayer, duration);
}

async function followExtract(job) {
  state.extracting = true;
  openExtractLayer();
  return new Promise((resolve) => {
    const finish = (state, snapshot, message) => {
      if (state === 'done') {
        el.extractLayer.dataset.state = 'done';
        el.extractTitle.textContent = '解压完成';
        paintExtract({
          percent: 100,
          current: '',
          total: snapshot ? snapshot.total : 0,
          state: 'done',
        });
        el.extractMeta.textContent = `已保存到 ${snapshot.target}`;
        el.extractFile.textContent = `已写入 ${snapshot.total || snapshot.files || 0} 个文件`;
        toast(`已解压 ${snapshot.total || snapshot.files || 0} 个文件 → ${snapshot.target}`, 'info', 5200);
        announce('解压完成');
        flashExtractLayer('done', '解压完成', el.extractMeta.textContent, 900);
      } else {
        el.extractLayer.dataset.state = 'error';
        el.extractTitle.textContent = '解压失败';
        el.extractMeta.textContent = message;
        toast(message, 'error', 4600);
        flashExtractLayer('error', '解压失败', message, 1600);
      }
      resolve();
    };

    const tick = async () => {
      let snapshot;
      try {
        snapshot = await jsonGet(`/api/jobs/${job.jobId}`);
      } catch (error) {
        finish('error', job, error.message);
        return;
      }
      if (snapshot.state === 'running') {
        paintExtract(snapshot);
        setTimeout(tick, 220);
        return;
      }
      if (snapshot.state === 'done') finish('done', snapshot, '');
      else finish('error', snapshot, snapshot.error || '解压失败');
    };

    setTimeout(tick, 120);
  });
}

async function extractAll(paths = [], scope = 'all') {
  if (!state.archive) { toast('先打开一个压缩包', 'error'); return; }
  if (state.extracting) { toast('已有解压任务正在进行', 'error'); return; }
  const targetWindow = activeWindow();
  const message = scope === 'selected'
    ? `准备解压所选的 ${paths.length} 项…`
    : '请选择保存位置，将在其中新建同名文件夹…';
  toast(message, 'info', 2400);
  setBusy(targetWindow, true);
  try {
    const result = await jsonPost(`/api/archives/${state.archive.id}/extract`, { paths });
    if (!result.ok) {
      if (result.reason === 'cancelled') {
        toast('已取消解压');
      } else {
        toast(result.error || '解压失败', 'error', 4200);
      }
      return;
    }
    await followExtract(result);
  } catch (error) {
    toast(error.message, 'error', 4200);
  } finally {
    setBusy(targetWindow, false);
  }
}

async function deleteSelected() {
  if (!state.archive) { toast('先打开一个压缩包', 'error'); return; }
  if (!state.selected.size) { toast('先选择要删除的项目', 'error'); return; }
  const paths = [...state.selected];
  const label = paths.length === 1 ? `「${paths[0]}」` : `${paths.length} 个项目`;
  if (!window.confirm(`确定从压缩包中删除 ${label}？`)) return;

  setBusy(el.max, true);
  try {
    const payload = await jsonPost(`/api/archives/${state.archive.id}/delete`, { paths });
    state.selected = new Set();
    state.anchorPath = null;
    applyArchiveUpdate(payload);
    toast(`已删除 ${payload.deleted || paths.length} 项`, 'info', 4200);
    announce('已删除所选项目');
  } catch (error) {
    toast(error.message, 'error', 4600);
  } finally {
    setBusy(el.max, false);
  }
}

async function addFiles(files, folder, win = activeWindow()) {
  if (!state.archive) { toast('先打开一个压缩包', 'error'); return; }
  const list = Array.from(files || []);
  if (!list.length) return;

  setBusy(win, true);
  const form = new FormData();
  for (const file of list) form.append('files', file, file.name);
  form.append('folder', folder || '');

  try {
    const payload = await xhrPost(`/api/archives/${state.archive.id}/add`, form);
    const addedPaths = payload.addedPaths || [];
    const firstAdded = addedPaths[0] || null;
    applyArchiveUpdate(payload, { selectPath: firstAdded });
    toast(`已添加 ${payload.added || list.length} 个文件到${folder ? `「${folder}」` : '根目录'}`, 'info', 4200);
    announce('文件已添加到压缩包');
  } catch (error) {
    toast(error.message, 'error', 4600);
  } finally {
    setBusy(win, false);
  }
}

function triggerAdd(win) {
  if (!state.archive) { toast('先打开一个压缩包', 'error'); return; }
  state.addFolder = win === 'max' ? state.currentFolder : '';
  el.fileInput.value = '';
  el.fileInput.click();
}

/* ------------------------------------------------------------
   事件：按钮
   ------------------------------------------------------------ */

const actions = {
  'mini-view': () => {
    const first = state.miniSelection && !state.miniSelection.is_dir
      ? state.miniSelection
      : childrenOf(state.miniFolder).find((entry) => !entry.is_dir);
    if (!first) {
      toast('这个文件夹里没有可预览的文件', 'error');
      return;
    }
    showMiniPreview(first);
  },
  'mini-add': () => triggerAdd('mini'),
  'mini-max': () => {
    if (state.miniSelection) {
      revealInMax(state.miniSelection);
      ensurePreviewVisible();
      return;
    }
    showMax();
  },
  'mini-extract': () => extractAll(),
  'mini-extract-selected': () => {
    if (!state.miniSelection) {
      toast('先在列表中选择要解压的文件', 'error');
      return;
    }
    extractAll([state.miniSelection.path], 'single');
  },
  'max-preview': () => {
    const hidden = el.previewPanel.style.display === 'none';
    if (hidden) {
      el.previewPanel.style.display = '';
      el.maxBody.classList.remove('no-preview');
    } else {
      el.previewPanel.style.display = 'none';
      el.maxBody.classList.add('no-preview');
    }
  },
  'max-add': () => triggerAdd('max'),
  'max-refresh': async () => {
    if (!state.archive) return;
    setBusy(el.max, true);
    try {
      const response = await fetch(`/api/archives/${state.archive.id}/info`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '刷新失败');
      applyArchiveUpdate(payload);
      renderTree();
      renderList();
      renderPreview();
      toast('列表已刷新');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(el.max, false);
    }
  },
  'max-extract': () => extractAll(),
  'max-extract-selected': () => {
    if (!state.selected.size) {
      toast('先在列表中选择要解压的文件', 'error');
      return;
    }
    extractAll([...state.selected], 'selected');
  },
  'max-sort': () => {
    const modes = [
      ['name-asc', '按名称 A→Z'],
      ['name-desc', '按名称 Z→A'],
      ['size-asc', '按大小 小→大'],
      ['size-desc', '按大小 大→小'],
      ['mtime-desc', '按修改时间 新→旧'],
    ];
    const index = modes.findIndex(([mode]) => mode === state.sort);
    const next = modes[(index + 1) % modes.length];
    state.sort = next[0];
    renderList();
    toast(next[1], 'info', 1800);
  },
  'max-select-all': () => {
    if (!state.archive) return;
    const paths = $$('.file-row', el.fileList).map((row) => row.dataset.path);
    state.selected = new Set(paths);
    state.anchorPath = paths[0] || null;
    if (paths[0]) state.selection = state.entries.find((entry) => entry.path === paths[0]) || null;
    paintSelection();
    renderPreview();
    toast(paths.length ? `已选择 ${paths.length} 项` : '当前目录没有可选择的项目', paths.length ? 'info' : 'error', 1800);
  },
  'max-invert': () => {
    if (!state.archive) return;
    const paths = $$('.file-row', el.fileList).map((row) => row.dataset.path);
    if (!paths.length) {
      toast('当前目录没有可反选的项目', 'error', 1800);
      return;
    }
    state.selected = new Set(paths.filter((path) => !state.selected.has(path)));
    state.anchorPath = paths.find((path) => state.selected.has(path)) || null;
    state.selection = state.selected.size === 1
      ? state.entries.find((entry) => entry.path === state.anchorPath) || null
      : null;
    paintSelection();
    renderPreview();
    toast(state.selected.size ? `已反选，选中 ${state.selected.size} 项` : '已取消全部选择', 'info', 1800);
  },
  'max-copy': async () => {
    if (!state.selected.size) {
      toast('先选择要复制的项目', 'error', 1800);
      return;
    }
    const text = [...state.selected].join('\n');
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      copied = document.execCommand('copy');
      area.remove();
    }
    toast(
      copied ? `已复制 ${state.selected.size} 条路径` : '复制失败，请手动复制',
      copied ? 'info' : 'error',
      2200,
    );
  },
  'max-delete': deleteSelected,
};

$$('[data-act]').forEach((button) => {
  button.addEventListener('click', () => {
    const handler = actions[button.dataset.act];
    if (handler) handler();
  });
});

if (el.filterRow) {
  $$('.filter-chip', el.filterRow).forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter || 'all';
      syncFilterChips();
      renderList();
    });
  });
}

function pickArchive(target) {
  state.openTarget = target;
  el.archiveInput.value = '';
  el.archiveInput.click();
}

el.openBtn.addEventListener('click', () => pickArchive('mini'));

el.homeMax.addEventListener('click', () => pickArchive('max'));
el.homeMini.addEventListener('click', () => pickArchive('mini'));
el.homeNew.addEventListener('click', createArchive);

el.createPickFiles.addEventListener('click', pickCreateFiles);
el.createPickFolder.addEventListener('click', pickCreateFolder);
el.createStart.addEventListener('click', startCreate);
el.createAbort.addEventListener('click', abortCreate);
el.createCancel.addEventListener('click', closeCreateLayer);
$$('[data-create-close]').forEach((node) => {
  node.addEventListener('click', closeCreateLayer);
});
el.createName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    startCreate();
  }
});
el.createLayer.addEventListener('click', (event) => {
  if (event.target === el.createLayer) closeCreateLayer();
});

el.archiveInput.addEventListener('change', () => {
  const file = el.archiveInput.files && el.archiveInput.files[0];
  if (file) openArchive(file, state.openTarget);
});

el.fileInput.addEventListener('change', () => {
  const files = el.fileInput.files;
  if (files && files.length) {
    addFiles(files, state.addFolder, activeWindow());
  }
});

el.searchInput.addEventListener('input', () => {
  state.search = el.searchInput.value;
  renderList();
});

el.miniUp.addEventListener('click', () => {
  if (!state.miniFolder) return;
  state.miniFolder = state.miniFolder.includes('/')
    ? state.miniFolder.split('/').slice(0, -1).join('/')
    : '';
  state.miniSelection = null;
  renderMini();
});

el.miniPreviewBack.addEventListener('click', closeMiniPreview);

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    pickArchive(state.view === 'mini' ? 'mini' : 'max');
  }
  if (event.ctrlKey && event.key === ',') {
    event.preventDefault();
    openSettings();
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (!typing && state.archive && state.view === 'max') {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      actions['max-copy']();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      actions['max-invert']();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      actions['max-select-all']();
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && state.selection) {
      event.preventDefault();
      if (state.selection.is_dir) openFolder(state.selection.path);
      else {
        ensurePreviewVisible();
        renderPreview();
      }
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      deleteSelected();
    }
  }
  if (event.key === 'Escape') {
    if (!el.settingsLayer.hidden) {
      closeSettings();
      return;
    }
    if (state.view === 'mini' && !el.miniPreview.hidden) {
      closeMiniPreview();
      return;
    }
    if (state.view !== 'home') hideMax();
  }
});

/* ------------------------------------------------------------
   窗口控制
   ------------------------------------------------------------ */

$('#miniMin').addEventListener('click', () => el.mini.classList.toggle('collapsed'));
$('#miniMax').addEventListener('click', showMax);
$('#miniClose').addEventListener('click', () => {
  hideMax();
  toast('已关闭压缩包');
});

$('#maxMin').addEventListener('click', () => el.max.classList.toggle('collapsed'));
$('#maxClose').addEventListener('click', () => hideMax());

/* ------------------------------------------------------------
   设置：个性化 / 性能 / 关于
   ------------------------------------------------------------ */

const SETTINGS_KEY = 'xizip.settings.v1';
const ACCENTS = new Set(['amber', 'ember', 'rose', 'pine', 'sand']);
const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: 'amber',
  glow: true,
  glass: true,
  motion: true,
  density: 'comfortable',
  radius: 'standard',
  glowLevel: 'normal',
  grain: true,
};
const settings = { ...DEFAULT_SETTINGS };
let aboutLoaded = false;

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key in saved) settings[key] = saved[key];
      }
      if (!ACCENTS.has(settings.accent)) settings.accent = 'amber';
    }
  } catch {
    /* 设置损坏时回退到默认值 */
  }
  applySettings();
  syncSettingControls();
}

function applySettings() {
  const root = document.documentElement;
  root.dataset.accent = settings.accent;
  root.dataset.density = settings.density;
  root.dataset.theme = settings.theme;
  root.dataset.radius = settings.radius;
  root.dataset.glow = settings.glowLevel;
  root.classList.toggle('no-glow', !settings.glow);
  root.classList.toggle('no-motion', !settings.motion);
  root.classList.toggle('perf-mode', !settings.glass);
  root.classList.toggle('no-grain', !settings.grain);
  $$('[data-theme-toggle]').forEach((button) => {
    const next = settings.theme === 'light' ? '深色' : '浅色';
    button.setAttribute('aria-label', `切换到${next}模式`);
    button.setAttribute('data-tip', `切换到${next}模式`);
  });
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 存储不可用时设置仅在本次会话生效 */
  }
}

function syncSettingControls() {
  el.setGlow.checked = settings.glow;
  el.setGlass.checked = settings.glass;
  el.setMotion.checked = settings.motion;
  el.setGrain.checked = settings.grain;
  $$('.accent-swatch', el.settingsLayer).forEach((swatch) => {
    swatch.classList.toggle('is-active', swatch.dataset.accent === settings.accent);
  });
  $$('#setDensity button', el.settingsLayer).forEach((button) => {
    button.classList.toggle('active', button.dataset.density === settings.density);
  });
  $$('#setRadius button', el.settingsLayer).forEach((button) => {
    button.classList.toggle('active', button.dataset.radius === settings.radius);
  });
  $$('#setGlowLevel button', el.settingsLayer).forEach((button) => {
    button.classList.toggle('active', button.dataset.glow === settings.glowLevel);
  });
}

function setSetting(key, value, message) {
  settings[key] = value;
  applySettings();
  syncSettingControls();
  persistSettings();
  if (message) {
    announce(message);
    toast(message, 'info', 2000);
  }
}

function openSettings() {
  el.settingsLayer.hidden = false;
  syncSettingControls();
  loadAbout();
  const active = $('.settings-tab.active', el.settingsLayer);
  if (active) active.focus({ preventScroll: true });
}

function closeSettings() {
  el.settingsLayer.hidden = true;
}

function selectSettingTab(name) {
  $$('.settings-tab', el.settingsLayer).forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.settings-section', el.settingsLayer).forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  if (name === 'about') loadAbout();
}

async function loadAbout(force = false) {
  if (aboutLoaded && !force) return;
  try {
    const response = await fetch('/api/about');
    if (!response.ok) throw new Error('读取失败');
    const data = await response.json();
    aboutLoaded = true;
    el.aboutVersion.textContent = `v${data.app || '1.1.0'}`;
    el.aboutKernel.textContent = data.kernel || '—';
    el.aboutKernel.title = data.kernel || '';
    el.aboutKernelVersion.textContent = data.kernelVersion || '—';
    el.aboutWebview.textContent = data.webview || '—';
    el.aboutGpu.textContent = (data.gpu && data.gpu.name) || '未检测到';
    el.aboutGpu.title = (data.gpu && data.gpu.name) || '';
    el.aboutPython.textContent = data.python || '—';
  } catch {
    el.aboutKernelVersion.textContent = '读取失败';
    el.aboutWebview.textContent = '读取失败';
  }
}

$$('[data-settings-open]').forEach((button) => {
  button.addEventListener('click', openSettings);
});
$$('[data-settings-close]').forEach((button) => {
  button.addEventListener('click', closeSettings);
});
$$('.settings-tab', el.settingsLayer).forEach((tab) => {
  tab.addEventListener('click', () => selectSettingTab(tab.dataset.tab));
});

$$('[data-theme-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = settings.theme === 'light' ? 'dark' : 'light';
    setSetting('theme', next, next === 'light' ? '已切换到浅色模式' : '已切换到深色模式');
  });
});

$$('.accent-swatch', el.settingsLayer).forEach((swatch) => {
  swatch.addEventListener('click', () => {
    setSetting('accent', swatch.dataset.accent, `强调色已切换为${swatch.getAttribute('aria-label')}`);
  });
});

el.setGlow.addEventListener('change', () => {
  setSetting('glow', el.setGlow.checked, el.setGlow.checked ? '已开启背景光斑' : '已关闭背景光斑');
});

el.setGlass.addEventListener('change', () => {
  setSetting('glass', el.setGlass.checked, el.setGlass.checked ? '已开启毛玻璃' : '已关闭毛玻璃，降低 GPU 占用');
});

el.setMotion.addEventListener('change', () => {
  setSetting('motion', el.setMotion.checked, el.setMotion.checked ? '已开启动态效果' : '已关闭动态效果');
});

$$('#setDensity button', el.settingsLayer).forEach((button) => {
  button.addEventListener('click', () => {
    const compact = button.dataset.density === 'compact';
    setSetting('density', button.dataset.density, compact ? '界面密度：紧凑' : '界面密度：舒适');
  });
});

$$('#setRadius button', el.settingsLayer).forEach((button) => {
  button.addEventListener('click', () => {
    const label = button.textContent.trim();
    setSetting('radius', button.dataset.radius, `窗口圆角：${label}`);
  });
});

$$('#setGlowLevel button', el.settingsLayer).forEach((button) => {
  button.addEventListener('click', () => {
    const label = button.textContent.trim();
    setSetting('glowLevel', button.dataset.glow, `背景强度：${label}`);
  });
});

el.setGrain.addEventListener('change', () => {
  setSetting('grain', el.setGrain.checked, el.setGrain.checked ? '已开启噪点纹理' : '已关闭噪点纹理');
});

/* ------------------------------------------------------------
   拖拽
   ------------------------------------------------------------ */

function isFileDrag(event) {
  const types = event.dataTransfer && event.dataTransfer.types;
  return Boolean(types) && Array.from(types).includes('Files');
}

function dragPanelOf(target) {
  if (!(target instanceof Element)) return null;
  if (target.closest('#listPanel')) return 'list';
  if (target.closest('#miniBody')) return 'mini';
  return null;
}

function describeDrop(files, panel) {
  const withArchive = Boolean(state.archive);
  if (!withArchive) {
    return {
      mode: 'noarchive',
      title: '松开以打开压缩包',
      sub: '将在 XiZipMINI 中打开',
      ok: archiveFile(files[0]),
    };
  }
  if (panel === 'list') {
    return {
      mode: 'add',
      title: '松开以添加到当前文件夹',
      sub: state.currentFolder ? `目标：${state.currentFolder}` : '目标：根目录',
      ok: true,
    };
  }
  if (files.every((file) => !archiveFile(file))) {
    return {
      mode: 'add',
      title: '松开以添加到压缩包',
      sub: '目标：根目录',
      ok: true,
    };
  }
  if (files.length === 1 && archiveFile(files[0])) {
    return {
      mode: 'open',
      title: '松开以打开压缩包',
      sub: '将在 XiZipMAX 中打开',
      ok: true,
    };
  }
  return {
    mode: 'add',
    title: '松开以添加文件',
    sub: '压缩包文件会被当作普通文件加入',
    ok: true,
  };
}

document.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  state.dragDepth += 1;
  const panel = dragPanelOf(event.target);
  const files = Array.from(event.dataTransfer.files || []);
  const first = files[0];
  const fakeFiles = files.length ? files : [{ name: 'x.zip' }];
  const plan = describeDrop(fakeFiles, panel);
  state.dragMode = plan.mode;
  state.dragPanel = panel;

  el.dropTitle.textContent = plan.title;
  el.dropSub.textContent = plan.sub;
  if (plan.mode === 'noarchive' && !plan.ok) {
    el.dropTitle.textContent = '请先打开一个压缩包';
    el.dropSub.textContent = '拖入 .zip / .7z 等压缩包即可开始';
  }

  const usePanelHint = panel === 'list' || panel === 'mini';
  document.body.classList.toggle('dragging', !usePanelHint);
  $$('.drop-hint').forEach((hint) => hint.classList.remove('visible'));
  if (usePanelHint) {
    const hint = panel === 'list' ? $('#listDropHint') : $('#miniDropHint');
    if (hint) hint.classList.add('visible');
  }
  if (first) announce(plan.title);
});

document.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', (event) => {
  if (!isFileDrag(event)) return;
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) resetDragUI();
});

document.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer.files || []);
  const panel = dragPanelOf(event.target);
  const mode = state.dragMode;
  resetDragUI();
  if (!files.length) return;

  if (mode === 'noarchive' || !state.archive) {
    if (archiveFile(files[0])) openArchive(files[0], 'max');
    else toast('请先打开一个压缩包', 'error');
    return;
  }

  if (mode === 'open' && files.length === 1 && archiveFile(files[0]) && panel !== 'list') {
    openArchive(files[0], state.view === 'mini' ? 'mini' : 'max');
    return;
  }

  addFiles(files, panel === 'list' ? state.currentFolder : '', panel === 'list' ? el.max : activeWindow());
});

function resetDragUI() {
  state.dragDepth = 0;
  document.body.classList.remove('dragging');
  $$('.drop-hint').forEach((hint) => hint.classList.remove('visible'));
}

/* 防止浏览器直接打开拖入的文件 */
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

/* ------------------------------------------------------------
   初始化
   ------------------------------------------------------------ */

loadSettings();
renderPreviewEmpty('打开压缩包后，在这里查看文件内容');
applyView();
loadGpu();
