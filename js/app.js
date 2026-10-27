(function () {
  'use strict';

  const API = window.electronAPI;
  const cfg = (API && API.getClientConfig) ? API.getClientConfig() : {};
  const DEFAULT_PROBE_URLS = (cfg.backends && cfg.backends.length > 0)
    ? cfg.backends
    : [];
  let BACKENDS = [...DEFAULT_PROBE_URLS];
  let activeBackend = localStorage.getItem('activeBackend') || '';
  let token = localStorage.getItem('token') || '';
  let userInfo = null;
  let nickname = localStorage.getItem('nickname') || '';
  let avatar = localStorage.getItem('avatar') || '';
  let themeColor = localStorage.getItem('themeColor') || '#2a5298';
  let darkMode = localStorage.getItem('darkMode') === 'true';
  let bgType = localStorage.getItem('bgType') || 'none';
  let bgPath = localStorage.getItem('bgPath') || '';
  let splashType = localStorage.getItem('splashType') || 'default';
  let splashPath = localStorage.getItem('splashPath') || '';
  let splashVolume = parseInt(localStorage.getItem('splashVolume')) || 50;
  let bgVideoVolume = parseInt(localStorage.getItem('bgVideoVolume')) || 0;
  let customFontFamily = localStorage.getItem('customFontFamily') || '';
  let customFontPath = localStorage.getItem('customFontPath') || '';
  let fontWeightSetting = parseInt(localStorage.getItem('fontWeight')) || 400;
  let fontSizeSetting = parseInt(localStorage.getItem('fontSize')) || 80;
  let fontColorSetting = localStorage.getItem('fontColor') || '';
  let cardOpacity = parseInt(localStorage.getItem('cardOpacity') || '0');
  let bgGlass = localStorage.getItem('bgGlass') === 'true';
  let browserGlassEnabled = localStorage.getItem('browserGlassEnabled') === 'true';
  let acrylicEnabled = localStorage.getItem('acrylicEnabled') === 'true';
  var justLoggedIn = false;
  var xxtLoggedIn = false;
  var pendingEasemobCreds = null;
  function tryConnectEasemobAfterLogin() {
    if (!xxtLoggedIn || !pendingEasemobCreds) return;
    var creds = pendingEasemobCreds;
    pendingEasemobCreds = null;
    console.log('[Easemob] 学习通已登录，开始连接环信');
    easemobLoginWithCredentials(creds.huanxinId, creds.hxToken);
  }

  // 学习通对外分享处理
  let lanFirst = localStorage.getItem('lanFirst') !== 'false';
  let connectAbortController = null;
  let workTreeData = null;
  let resourceTreeData = null;
  let searchResultSizes = {};
  let runningTasks = [];
  let runningTaskTimer = null;
  let fetchAbortController = new AbortController();
  let autoStart = localStorage.getItem('autoStart') === 'true';
  let appTitle = localStorage.getItem('appTitle') || '作业上传系统';
  let appVersion = 'v1.4.0';
  let appbetaVersion = '1.4.0_beta_2';
  let betaUpdateEnabled = localStorage.getItem('betaUpdateEnabled') === 'true';
  let downloadHistory = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
  let activeDownloadCount = 0;
  let activeDownloadNames = [];
  let navHistory = ['home'];
  let navIndex = 0;
  var _networkDeferred = false;
  var _networkDeferred = false;

  // 启动时立即加载缩放，未配置则默认100%
  (function initZoomEarly() {
    const savedZoom = localStorage.getItem('zoomFactor');
    const zoom = savedZoom ? parseInt(savedZoom) : 100;
    if (API && API.setZoomFactor) {
      API.setZoomFactor(zoom / 100);
    }
  })();

  (function initMinSizeEarly() {
    var lim = localStorage.getItem('limitMinSize');
    if (lim === 'false') {
      var w = parseInt(localStorage.getItem('customMinWidth') || '900');
      var h = parseInt(localStorage.getItem('customMinHeight') || '620');
      if (API && API.setMinSize) API.setMinSize(w, h);
    }
  })();
  let currentPage = 'home';
  let cropperInst = null;
  let networkOnline = true;
  let updateReady = false;
  let updateDownloading = false;
  let updateInstallerPath = '';
  let _transitionBarTimer = null;
  let _transitionBarBrightness = 1;
  let downloadProgress = {};
  let uploadProgress = {};
  let activeUploadNames = [];
  let activeUploadCount = 0;

  const PRESET_COLORS = [
    '#3b82f6', '#1e40af', '#2a5298', '#06b6d4',
    '#10b981', '#059669', '#84cc16', '#eab308',
    '#f97316', '#e17055', '#e74c3c', '#dc2626',
    '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
    '#2c3e50', '#636e72', '#00b894', '#6c5ce7'
  ];

  function $(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }

  function getBackend() {
    if (activeBackend) return activeBackend;
    const saved = localStorage.getItem('activeBackend');
    if (saved) { activeBackend = saved; return saved; }
    return BACKENDS[0] || DEFAULT_PROBE_URLS[0];
  }

  function setBackend(url) {
    activeBackend = url;
    localStorage.setItem('activeBackend', url);
  }

  async function probeBackend(url) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(url + '/api/ping', { signal: controller.signal });
      clearTimeout(tid);
      return resp.ok;
    } catch (e) { return false; }
  }

  function isLanIP(url) {
    try {
      const host = new URL(url).hostname;
      const ip = host.split(':')[0];
      return /^192\.168\./.test(ip) || /^10\.20\./.test(ip) || ip === '127.0.0.1' || ip === 'localhost';
    } catch (e) { return false; }
  }

  function retryLanConnection() {
    lanFirst = true;
    localStorage.setItem('lanFirst', 'true');
    retryLanOnly();
  }

  async function retryLanOnly() {
    showToast('正在尝试连接，请稍后...', '', 'info', 10000);
    abortConnections();
    var lanUrls = BACKENDS.filter(isLanIP);
    if (!lanUrls.length) {
      showToast('未检测到局域网地址', '请先连接到教学楼局域网', 'error', 5000);
      return;
    }
    for (var i = 0; i < lanUrls.length; i++) {
      var url = lanUrls[i];
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(function() { ctrl.abort(); }, 3000);
        const resp = await fetch(url + '/api/ping', { signal: ctrl.signal });
        clearTimeout(tid);
        if (resp.ok) {
          setBackend(url);
          if (token) { loadUserInfo().then(function() { loadHomeData(); }); }
          showToast('建立连接', '已连接到 ' + url, 'success', 3000);
          refreshBackendList();
          return;
        }
      } catch(e) {}
    }
    showToast('未检测到局域网地址', '请先连接到教学楼局域网', 'error', 5000);
  }

  async function quickProbe(url) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url + '/api/ping', { signal: controller.signal });
      clearTimeout(tid);
      return resp.ok;
    } catch (e) { return false; }
  }

  function updateNetworkSelector() {
    const sel = $('error-ip-selector');
    if (!sel) return;
    const all = BACKENDS.length ? [...new Set(BACKENDS)] : DEFAULT_PROBE_URLS;
    sel.innerHTML = all.map(url =>
      '<option value="' + url + '"' + (url === activeBackend ? ' selected' : '') + '>' + url + '</option>'
    ).join('');
  }

  function hideNetworkOverlay() {
    const overlay = $('network-overlay');
    if (overlay) {
      overlay._shouldShow = false;
      overlay.classList.add('hidden');
      overlay.classList.remove('show');
    }
  }

  async function initBackend() {
    const saved = localStorage.getItem('activeBackend');
    const stored = saved && saved.trim() ? saved.trim() : null;

    let remoteList = [];
    const probeUrls = stored ? [stored, ...DEFAULT_PROBE_URLS.filter(u => u !== stored)] : DEFAULT_PROBE_URLS;
    const availableTasks = probeUrls.map(async (testUrl) => {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(testUrl + '/api/available_backends', { signal: controller.signal });
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length) return data;
        }
      } catch (e) {}
      return null;
    });
    try {
      var firstResult = await Promise.any(availableTasks);
      if (firstResult && Array.isArray(firstResult)) remoteList = firstResult;
    } catch (e) {}

    let candidates = [];
    if (stored) candidates.push(stored);
    for (const url of remoteList) { if (!candidates.includes(url)) candidates.push(url); }
    for (const url of DEFAULT_PROBE_URLS) { if (!candidates.includes(url)) candidates.push(url); }

    const lanIPs = candidates.filter(isLanIP);
    const otherIPs = candidates.filter(u => !isLanIP(u));
    const sorted = [...lanIPs, ...otherIPs];
    if (sorted.length === 0) {
      const savedBackends = JSON.parse(localStorage.getItem('backendList') || '[]');
      const savedLan = savedBackends.filter(isLanIP);
      const savedOther = savedBackends.filter(u => !isLanIP(u));
      BACKENDS = [...new Set([...savedLan, ...savedOther])];
      if (!BACKENDS.length) BACKENDS = [...DEFAULT_PROBE_URLS];
    } else {
      BACKENDS = [...sorted];
      localStorage.setItem('backendList', JSON.stringify(BACKENDS));
    }

    for (const url of lanIPs) {
      const ok = await quickProbe(url);
      if (ok) { setBackend(url); hideNetworkOverlay(); return; }
    }

    if (stored && !isLanIP(stored)) {
      const ok = await quickProbe(stored);
      if (ok) { setBackend(stored); hideNetworkOverlay(); return; }
    }

    for (const url of otherIPs) {
      if (url === stored) continue;
      const ok = await quickProbe(url);
      if (ok) { setBackend(url); hideNetworkOverlay(); return; }
    }

    setBackend(sorted[0] || DEFAULT_PROBE_URLS[0]);
    hideNetworkOverlay();
  }

  function abortConnections() {
    if (connectAbortController) {
      connectAbortController.abort();
      connectAbortController = null;
    }
    if (fetchAbortController) {
      fetchAbortController.abort();
    }
    fetchAbortController = new AbortController();
  }

  function tryFetch(fn, url, timeoutMs) {
    if (timeoutMs) {
      return Promise.race([
        fn(url),
        new Promise(function(_, reject) {
          setTimeout(function() { reject(new Error('timeout')); }, timeoutMs);
        })
      ]);
    }
    return fn(url);
  }

  async function tryBackends(fn, signal, silent) {
    if (lanFirst) {
      var tried = new Set();
      if (activeBackend) {
        if (signal && signal.aborted) throw new Error('连接已中断');
        tried.add(activeBackend);
        try {
          var res0 = await tryFetch(fn, activeBackend, isLanIP(activeBackend) ? 200 : 1000);
          if (res0 && res0.ok !== false) return res0;
        } catch (e) { if (e.noRetry) throw e; }
      }
      var lanIPs = BACKENDS.filter(isLanIP).filter(function(u) { return u !== activeBackend; });
      for (var i = 0; i < lanIPs.length; i++) {
        if (signal && signal.aborted) throw new Error('连接已中断');
        var url = lanIPs[i];
        tried.add(url);
        try {
          var res = await tryFetch(fn, url, 200);
          if (res && res.ok !== false) {
            if (url !== activeBackend && !(signal && signal.aborted)) { setBackend(url); updateNetworkSelector(); if (!silent) showToast('建立连接', '已连接到 ' + url, 'success'); }
            return res;
          }
        } catch (e) { if (e.noRetry) throw e; }
      }
      var fallbacks = BACKENDS.filter(function(b) { return !tried.has(b); });
      var lanFb = fallbacks.filter(isLanIP);
      var otherFb = fallbacks.filter(function(u) { return !isLanIP(u); });
      var ordered = lanFb.concat(otherFb);
      for (var j = 0; j < ordered.length; j++) {
        if (signal && signal.aborted) throw new Error('连接已中断');
        try {
          var res3 = await tryFetch(fn, ordered[j], isLanIP(ordered[j]) ? 200 : 1000);
          if (res3 && res3.ok !== false) {
            if (!(signal && signal.aborted)) { setBackend(ordered[j]); updateNetworkSelector(); if (!silent) showToast('建立连接', '已连接到 ' + ordered[j], 'success'); }
            return res3;
          }
        } catch (e) { if (e.noRetry) throw e; }
      }
    } else {
      if (activeBackend) {
        try {
          var res4 = await tryFetch(fn, activeBackend, isLanIP(activeBackend) ? 200 : 1000);
          if (res4 && res4.ok !== false) return res4;
        } catch (e) { if (e.noRetry) throw e; }
        if (!silent) showToast('连接超时', '无法连接到 ' + activeBackend, 'error', 3000);
      }
      var fallbacks2 = BACKENDS.filter(function(b) { return b !== activeBackend; });
      var lanFb2 = fallbacks2.filter(isLanIP);
      var otherFb2 = fallbacks2.filter(function(u) { return !isLanIP(u); });
      var ordered2 = lanFb2.concat(otherFb2);
      var promises = ordered2.map(async function(url) {
        try {
          var r = await fn(url);
          if (r && r.ok !== false) {
            setBackend(url);
            updateNetworkSelector();
            if (!silent) showToast('建立连接', '已连接到 ' + url, 'success');
            return r;
          }
        } catch (e) { if (e.noRetry) throw e; }
        return null;
      });
      var results = await Promise.allSettled(promises);
      for (var k = 0; k < results.length; k++) {
        if (results[k].status === 'fulfilled' && results[k].value) return results[k].value;
      }
      for (var m = 0; m < results.length; m++) {
        if (results[m].status === 'rejected' && results[m].reason && results[m].reason.noRetry) throw results[m].reason;
      }
    }
    throw new Error('所有后端不可用');
  }

  let networkRetryCount = 0;

  function showNetworkOverlay() {
    const overlay = $('network-overlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('show');
    overlay._shouldShow = true;
    updateNetworkOverlayVisibility();
    const sel = $('error-ip-selector');
    if (sel) {
      sel.innerHTML = BACKENDS.map(url =>
        '<option value="' + url + '"' + (url === activeBackend ? ' selected' : '') + '>' + url + '</option>'
      ).join('');
    }
  }

  var autoRetryActive = false;
  async function autoRetryConnect() {
    if (autoRetryActive) return;
    autoRetryActive = true;
    abortConnections();
    connectAbortController = new AbortController();
    var signal = connectAbortController.signal;
    networkRetryCount = 0;
    const maxRetries = 3;
    const statusEl = $('network-message');
    while (networkRetryCount < maxRetries) {
      if (signal.aborted) { connectAbortController = null; autoRetryActive = false; return; }
      networkRetryCount++;
      if (statusEl) statusEl.textContent = '正在重试连接 (' + networkRetryCount + '/' + maxRetries + ')...';
      await new Promise(r => setTimeout(r, 2000));
      if (signal.aborted) { connectAbortController = null; autoRetryActive = false; return; }
      var urls = lanFirst
        ? BACKENDS.filter(isLanIP).concat(BACKENDS.filter(function(u) { return !isLanIP(u); }))
        : BACKENDS;
      for (var i = 0; i < urls.length; i++) {
        if (signal.aborted) { connectAbortController = null; autoRetryActive = false; return; }
        var url = urls[i];
        try {
          const controller = new AbortController();
          const tid = setTimeout(function() { controller.abort(); }, 3000);
          const resp = await fetch(url + '/api/ping', { signal: controller.signal });
          clearTimeout(tid);
          if (resp.ok) {
            setBackend(url);
            $('network-overlay')._shouldShow = false;
            $('network-overlay').classList.add('hidden');
            $('network-overlay').classList.remove('show');
            updateNetworkSelector();
            if (token) {
              loadUserInfo().then(function() { loadHomeData(); });
            }
            showToast('建立连接', '已连接到 ' + url, 'success');
            refreshBackendList();
            connectAbortController = null;
            autoRetryActive = false;
            return;
          }
        } catch (e) { console.log('[更新] 测试版检测失败:', e.message); }
      }
    }
    connectAbortController = null;
    autoRetryActive = false;
    if (statusEl) statusEl.textContent = '无法连接到服务器，请检查网络后手动重试';
  }

  var apiFetchSilent = false;
  var apiFetchNoRetry = false;

  async function apiFetch(path, options = {}) {
    const headers = { ...options.headers };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const isFormData = options.body instanceof FormData;
    var silent = options.silent || apiFetchSilent;
    var noRetry = options.noRetry || apiFetchNoRetry;
    const doFetch = async (baseUrl) => {
      const opts = { ...options, headers };
      if (isFormData && options.body) {
        opts.body = new FormData();
        for (const [k, v] of options.body.entries()) opts.body.append(k, v);
      }
      const res = await fetch(baseUrl + path, opts);
      if (res.status === 401) {
        token = '';
        localStorage.removeItem('token');
        var errMsg = '未登录';
        try {
          var bodyText = await res.text();
          var bodyJson = JSON.parse(bodyText);
          if (bodyJson.error) errMsg = bodyJson.error;
        } catch (e) {}
        var err401 = new Error(errMsg);
        err401.noRetry = true;
        err401.code = 401;
        showLoginModal();
        throw err401;
      }
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (e) {
        if (res.ok) return text;
        const err = new Error(text || '服务器响应异常 (' + res.status + ')');
        err.code = res.status;
        err.noRetry = true;
        throw err;
      }
      if (!res.ok) { const err = new Error(data.error || data.message || '请求失败'); err.code = res.status; err.noRetry = true; throw err; }
      return data;
    };
    if (isFormData || noRetry) {
      if (!activeBackend) throw new Error('未连接到后端');
      if (isFormData) {
        return await Promise.race([
          doFetch(activeBackend),
          new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error('上传超时，请检查后端连接')); }, 30000);
          })
        ]);
      }
      return await doFetch(activeBackend);
    }
    return await tryBackends(doFetch, fetchAbortController.signal, silent);
  }

  let isRegisterMode = false;

  function showLoginModal() {
    if (token) return;
    $('login-modal').classList.add('show');
    $('login-username').focus();
    isRegisterMode = false;
    $('login-modal-title').textContent = '登录';
    $('login-submit').textContent = '登录';
    $('switch-to-register').textContent = '还没有账号？点我注册';
  }

  function hideLoginModal() {
    $('login-modal').classList.remove('show');
  }

  function showToast(title, message, type = 'info', duration = 5000, copyable = false, action = null) {
    const container = $('toast-container');
    const existing = container.querySelector('.toast');
    if (existing) {
      const allToasts = container.querySelectorAll('.toast');
      for (const t of allToasts) {
        const exTitle = t.querySelector('.toast-title');
        const exMsg = t.querySelector('.toast-msg');
        if (exTitle && exMsg && exTitle.textContent === title && exMsg.textContent === message) {
          const countEl = t.querySelector('.toast-count');
          if (countEl) {
            const n = parseInt(countEl.textContent.replace('×', '')) || 1;
            countEl.textContent = '×' + (n + 1);
          } else {
            const span = document.createElement('span');
            span.className = 'toast-count';
            span.textContent = '×2';
            t.querySelector('.toast-content').appendChild(span);
          }
          if (duration > 0) {
            clearTimeout(t._timeout);
            if (t._countdown) clearInterval(t._countdown);
            if (t._raf) cancelAnimationFrame(t._raf);
            var barMs = duration - 300;
            var startTime2 = Date.now();
            var timerBar2 = t.querySelector('.toast-timer');
            if (timerBar2) { timerBar2.style.transition = 'none'; timerBar2.style.width = '100%'; setTimeout(function() { timerBar2.style.transition = ''; }, 100); }
            t._raf = requestAnimationFrame(function tick() {
              var elapsed2 = Date.now() - startTime2;
              var remaining2 = barMs - elapsed2;
              if (remaining2 <= 0) { if (timerBar2) timerBar2.style.width = '0%'; return; }
              var pct2 = (remaining2 / barMs) * 100;
              if (timerBar2) timerBar2.style.width = pct2 + '%';
              t._raf = requestAnimationFrame(tick);
            });
            t._timeout = setTimeout(function() { removeToast(t); }, duration);
          }
          return t;
        }
      }
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    const icons = { error: 'fa-circle-exclamation', info: 'fa-circle-info', success: 'fa-circle-check', warning: 'fa-triangle-exclamation' };
    toast.innerHTML = '<div class="toast-timer"></div>' +
      '<div class="toast-icon"><i class="fa-solid ' + (icons[type] || icons.info) + '"></i></div>' +
      '<div class="toast-content"><div class="toast-title">' + escapeHtml(title) + '</div>' +
      '<div class="toast-msg">' + escapeHtml(message) + '</div>' +
      (action ? '<button class="toast-action-btn">' + escapeHtml(action.text) + '</button>' : '') +
      '</div>' +
      '<div class="toast-actions">' +
      (copyable ? '<button class="toast-copy" title="复制"><i class="fa-solid fa-copy"></i></button>' : '') +
      '<button class="toast-close"><i class="fa-solid fa-xmark"></i></button></div>';
    container.appendChild(toast);

    if (copyable) {
      toast.querySelector('.toast-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(message).then(() => showToast('已复制', '内容已复制到剪贴板', 'success', 2000));
      });
    }
    if (action) {
      toast.querySelector('.toast-action-btn').addEventListener('click', () => {
        removeToast(toast);
        action.callback();
      });
    }
    toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
    if (duration > 0) {
      var barMs = duration - 300;
      var startTime = Date.now();
      var timerBar = toast.querySelector('.toast-timer');
      if (timerBar) timerBar.style.width = '100%';
      toast._countdown = setInterval(function() {
        var elapsed = Date.now() - startTime;
        var remaining = barMs - elapsed;
        if (remaining <= 0) {
          clearInterval(toast._countdown);
          if (timerBar) timerBar.style.width = '0%';
          return;
        }
        var pct = (remaining / barMs) * 100;
        if (timerBar) timerBar.style.width = pct + '%';
      }, 50);
      toast._timeout = setTimeout(function() { removeToast(toast); }, duration);
    }
    return toast;
  }
  window.showToast = showToast;
  window.switchPage = switchPage;

  function removeToast(toast) {
    if (toast._countdown) clearInterval(toast._countdown);
    if (toast._raf) cancelAnimationFrame(toast._raf);
    toast.classList.add('removing');
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
  }

  function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  let progressAnimId = null;
  function setGlobalProgress(active) {
    const bar = $('global-progress');
    if (active) {
      if (progressAnimId) cancelAnimationFrame(progressAnimId);
      bar.classList.remove('done');
      bar.style.transform = 'scaleX(0)';
      bar.style.opacity = '1';
      bar.style.transition = 'none';
      const startTime = performance.now();
      function animate(now) {
        const elapsed = now - startTime;
        const pct = Math.min(elapsed / 1000, 1);
        bar.style.transform = 'scaleX(' + (pct * 0.75) + ')';
        if (pct < 1) {
          progressAnimId = requestAnimationFrame(animate);
        }
      }
      progressAnimId = requestAnimationFrame(animate);
    } else {
      if (progressAnimId) { cancelAnimationFrame(progressAnimId); progressAnimId = null; }
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(0.75)';
      bar.style.opacity = '1';
      void bar.offsetWidth;
      bar.style.transition = 'transform 0.3s ease, opacity 0.3s 0.3s ease';
      bar.style.transform = 'scaleX(1)';
      bar.style.opacity = '0';
    }
  }

  function applyThemeColors() {
    document.documentElement.style.setProperty('--theme', themeColor);
    document.documentElement.style.setProperty('--theme-light', lightenColor(themeColor, 0.6));
    document.documentElement.style.setProperty('--theme-bg', hexToRgba(themeColor, 0.12));
    document.documentElement.style.setProperty('--theme-bg-medium', hexToRgba(themeColor, 0.45));
    document.documentElement.style.setProperty('--hover-shadow', '0 4px 16px ' + hexToRgba(themeColor, darkMode ? 0.18 : 0.12));
    $('titlebar-text').textContent = appTitle;
    document.title = appTitle;
  }

  function applyTheme() {
    applyThemeColors();
    if (darkMode) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
    const op = (100 - cardOpacity) / 100;
    document.documentElement.style.setProperty('--card-bg-opacity', op);
    document.documentElement.style.setProperty('--card-bg', darkMode ? hexToRgba('#1a1a2e', op) : hexToRgba('#ffffff', op));
    document.documentElement.style.setProperty('--card-bg-secondary', darkMode ? hexToRgba('#16213e', op) : hexToRgba('#f5f7fa', op));
    document.documentElement.style.setProperty('--glass-bg', darkMode ? hexToRgba('#1a1a2e', op) : hexToRgba('#ffffff', op));
    const hasBg = (bgType !== 'none' && bgPath);
    const glassEnabled = !document.body.classList.contains('no-glass');
    const cardBlur = parseInt(localStorage.getItem('cardBlurAmount') || '0');
    const bgBlur = parseInt(localStorage.getItem('bgBlurAmount') || '0');
    document.documentElement.style.setProperty('--glass-blur', (hasBg && glassEnabled && cardBlur > 0) ? 'blur(' + cardBlur + 'px)' : 'none');
    const effectiveBgBlur = (bgGlass && hasBg) ? bgBlur : 0;
    document.documentElement.style.setProperty('--bg-blur', effectiveBgBlur > 0 ? effectiveBgBlur + 'px' : '0px');
    const scale = 100 + effectiveBgBlur * 0.4;
    document.documentElement.style.setProperty('--bg-scale', scale + '%');
    document.documentElement.style.setProperty('--bg-offset', ((scale - 100) / -2) + '%');
    document.body.style.background = '';
    const appEl = $('app');
    const pageEl = $('page-container');
    if (appEl) appEl.style.background = '';
    if (pageEl) pageEl.style.background = '';
    if (acrylicEnabled) {
      document.body.style.background = 'transparent';
      if (appEl) appEl.style.background = 'transparent';
      if (pageEl) pageEl.style.background = 'transparent';
    }
    var bgTransparentEnabled = localStorage.getItem('bgTransparentEnabled') === 'true';
    if (hasBg || acrylicEnabled || bgTransparentEnabled) document.body.classList.add('with-bg');
    else document.body.classList.remove('with-bg');
    if (bgType === 'high-contrast') document.body.classList.add('high-contrast');
    else document.body.classList.remove('high-contrast');
    if (bgGlass && hasBg) {
      $('bg-image').classList.add('blur-bg');
      $('bg-video').classList.add('blur-bg');
    } else {
      $('bg-image').classList.remove('blur-bg');
      $('bg-video').classList.remove('blur-bg');
    }
    if (typeof injectBrowserGlassCSS === 'function') {
      injectBrowserGlassCSS();
    }
  }

  function lightenColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const lr = Math.min(255, Math.round(r + (255 - r) * factor));
    const lg = Math.min(255, Math.round(g + (255 - g) * factor));
    const lb = Math.min(255, Math.round(b + (255 - b) * factor));
    return '#' + [lr, lg, lb].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function navigateTo(page) {
    if (page === currentPage) return;
    navHistory = navHistory.slice(0, navIndex + 1);
    navHistory.push(page);
    navIndex = navHistory.length - 1;
    triggerPageTransition(page);
    switchPage(page);
    updateNavButtons();
  }

  function triggerPageTransition(targetPage) {
    var container = $('page-transition-bars');
    if (!container) return;
    var prevBtn = document.querySelector('.sidebar-btn.active');
    var nextBtn = document.querySelector('.sidebar-btn[data-page="' + targetPage + '"]');
    if (!prevBtn || !nextBtn) return;
    var containerRect = container.getBoundingClientRect();
    var prevRect = prevBtn.getBoundingClientRect();
    var nextRect = nextBtn.getBoundingClientRect();
    var prevMidY = prevRect.top + prevRect.height / 2 - containerRect.top;
    var nextMidY = nextRect.top + nextRect.height / 2 - containerRect.top;
    var isMovingDown = nextMidY > prevMidY;
    var prevY, nextY;
    if (isMovingDown) {
      prevY = prevMidY - 18;
      nextY = nextMidY + 18;
    } else {
      prevY = prevMidY + 18;
      nextY = nextMidY - 18;
    }
    var barHeight = Math.abs(nextY - prevY);
    if (barHeight < 4) return;
    _transitionBarBrightness = 1;
    var isAdjacent = barHeight < 40;
    var brightness = _transitionBarBrightness;
    _transitionBarBrightness = Math.min(_transitionBarBrightness + 0.15, 3);
    var bar = document.createElement('div');
    bar.className = 'page-transition-bar';
    bar.style.width = '40px';
    bar.style.height = '40px';
    bar.style.filter = 'brightness(' + brightness + ')';
    if (isMovingDown) {
      bar.style.top = prevY + 'px';
    } else {
      bar.style.bottom = (containerRect.height - prevY) + 'px';
    }
    container.appendChild(bar);
    void bar.offsetWidth;
    bar.style.transition = 'height 0.12s ease-out, opacity 0.07s ease-out';
    bar.style.height = barHeight + 'px';
    bar.style.opacity = '1';
    setTimeout(function() {
      if (isMovingDown) {
        bar.style.transition = 'top 0.12s ease-in-out, height 0.12s ease-in-out';
        bar.style.top = (nextMidY - 20) + 'px';
      } else {
        var currentTop = prevY - barHeight;
        bar.style.bottom = 'auto';
        bar.style.top = currentTop + 'px';
        void bar.offsetWidth;
        bar.style.transition = 'top 0.12s ease-in-out, height 0.12s ease-in-out';
        bar.style.top = (nextMidY - 20) + 'px';
      }
      bar.style.height = '40px';
    }, 130);
    setTimeout(function() {
      bar.style.transition = isAdjacent ? 'opacity 0.01s' : 'opacity 0.2s';
      bar.style.opacity = '0';
    }, 215);
    setTimeout(function() { bar.remove(); }, 400);
    clearTimeout(_transitionBarTimer);
    _transitionBarTimer = setTimeout(function() { _transitionBarBrightness = 1; }, 300);
  }

  function updateNetworkOverlayVisibility() {
    const overlay = $('network-overlay');
    if (!overlay) return;
    const visiblePages = ['home', 'search', 'announcements'];
    if (overlay._shouldShow && visiblePages.includes(currentPage)) {
      overlay.classList.remove('hidden');
      overlay.classList.add('show');
    } else {
      overlay.classList.add('hidden');
      overlay.classList.remove('show');
    }
  }

  function switchPage(page) {
    var prevPage = currentPage;
    // 离开 mmd 页面时不再销毁模型，保留渲染状态
    currentPage = page;
    qsa('.page').forEach(p => p.classList.remove('active'));
    const pageEl = $('page-' + page);
    if (pageEl) {
      pageEl.classList.add('active');
      var cards = pageEl.querySelectorAll('.card, .announcement-card, .learning-info-card, .xxt-placeholder, .browser-container, .python-editor-panel, .python-terminal-panel');
      cards.forEach(function(card) {
        card.style.animation = 'none';
      });
      requestAnimationFrame(function() {
        cards.forEach(function(card, i) {
          card.style.animation = 'pageIn 0.35s ease-out ' + (i * 0.05) + 's both';
        });
      });
    }
    qsa('.sidebar-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === page);
    });
    updateNetworkOverlayVisibility();
    if (_networkDeferred && ['home', 'search', 'announcements'].includes(page)) {
      _networkDeferred = false;
      $('network-overlay')._shouldShow = true;
      $('network-overlay').classList.remove('hidden');
      $('network-overlay').classList.add('show');
      updateNetworkSelector();
      startNetworkMonitor();
      startResourcePolling();
    }
    if (page === 'home') { 
      setGlobalProgress(true);
      apiFetchNoRetry = true;
      setTimeout(function() {
        loadHomeData().finally(function() { apiFetchNoRetry = false; setGlobalProgress(false); });
      }, 50);
    }
    if (page === 'appearance') renderAppearancePage();
    if (page === 'browser') initBrowser();
    if (page === 'announcements') loadAnnouncements();
    if (page === 'xxt') {
      console.log('[XXT] switchPage -> xxt, pageEl:', $('page-xxt'), 'xxtTabs.length:', xxtTabs.length);
      initXxt();
    }
    if (page === 'python') { initPythonPage(); }
    if (page === 'mmd') { if (window.MMDViewer) window.MMDViewer.init($('page-mmd')); }
  }

  function updateNavButtons() {
    $('btn-back').disabled = navIndex <= 0;
    $('btn-forward').disabled = navIndex >= navHistory.length - 1;
  }

  function goBack() {
    if (navIndex > 0) { navIndex--; switchPage(navHistory[navIndex]); updateNavButtons(); }
  }

  function goForward() {
    if (navIndex < navHistory.length - 1) { navIndex++; switchPage(navHistory[navIndex]); updateNavButtons(); }
  }

  function renderAppearancePage() {
    const container = $('theme-colors');
    container.innerHTML = PRESET_COLORS.map(c =>
      '<div class="theme-color' + (c === themeColor ? ' selected' : '') + '" style="background:' + c + '" data-color="' + c + '"></div>'
    ).join('');
    container.querySelectorAll('.theme-color').forEach(el => {
      el.addEventListener('click', () => {
        themeColor = el.dataset.color;
        localStorage.setItem('themeColor', themeColor);
        $('custom-color').value = themeColor;
        $('custom-color-text').value = themeColor;
        applyTheme();
        renderAppearancePage();
      });
    });
    $('custom-color').value = themeColor;
    $('custom-color-text').value = themeColor;
    $('dark-mode-toggle').checked = darkMode;
    $('opacity-slider').value = cardOpacity;
    $('opacity-value').textContent = cardOpacity + '%';
    const bgGlassToggle = $('bg-glass-toggle');
    if (bgGlassToggle) bgGlassToggle.checked = bgGlass;
    updateBgOptions();
    updateBgPreview();
    updateSplashOptions();
    var bgVolSlider = $('bg-video-volume-slider');
    var bgVolVal = $('bg-video-volume-value');
    if (bgVolSlider) bgVolSlider.value = bgVideoVolume;
    if (bgVolVal) bgVolVal.textContent = bgVideoVolume + '%';
    var fwSlider2 = $('font-weight-slider');
    var fwVal2 = $('font-weight-value');
    if (fwSlider2) fwSlider2.value = fontWeightSetting;
    if (fwVal2) fwVal2.textContent = fontWeightSetting;
    var fsSlider2 = $('font-size-slider');
    var fsVal2 = $('font-size-value');
    if (fsSlider2) fsSlider2.value = fontSizeSetting;
    if (fsVal2) fsVal2.textContent = fontSizeSetting + '%';
    var fcPicker2 = $('font-color-picker');
    if (fcPicker2) fcPicker2.value = fontColorSetting || '#2c3e50';
    var fontNameEl = $('font-name');
    if (fontNameEl) {
      if (customFontFamily) {
        fontNameEl.style.display = '';
        fontNameEl.innerHTML = '<i class="fa-solid fa-check-circle" style="color:#22c55e;"></i> ' + customFontFamily;
      } else {
        fontNameEl.style.display = 'none';
      }
    }
    // 所有卡片统一高度（跨行对齐）
    equalizeAppearanceCards();
  }

  function equalizeAppearanceCards() {
    var cards = document.querySelectorAll('.appearance-grid .card');
    if (!cards.length) return;
    var maxH = 0;
    // 先恢复 auto 以测量真实高度
    cards.forEach(function(c) { c.style.height = 'auto'; });
    cards.forEach(function(c) { var h = c.offsetHeight; if (h > maxH) maxH = h; });
    cards.forEach(function(c) { c.style.height = maxH + 'px'; });
  }

  function updateSplashOptions() {
    qsa('.splash-type-option').forEach(function(opt) {
      opt.classList.toggle('selected', opt.dataset.type === splashType);
    });
    var selBtn = $('select-splash-file');
    var infoEl = $('splash-info');
    if (splashType === 'video' || splashType === 'image') {
      if (selBtn) selBtn.style.display = '';
      if (infoEl) {
        infoEl.style.display = '';
        if (splashPath) {
          var fileName = splashPath.split(/[\\/]/).pop();
          infoEl.innerHTML = '<i class="fa-solid fa-check-circle" style="color:#22c55e;"></i> 已选择: ' + escapeHtml(fileName);
        } else {
          infoEl.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#eab308;"></i> 未选择文件';
        }
      }
    } else if (splashType === 'bg') {
      if (selBtn) selBtn.style.display = 'none';
      if (infoEl) {
        infoEl.style.display = '';
        infoEl.innerHTML = (bgPath ? '<i class="fa-solid fa-check-circle" style="color:#22c55e;"></i> 跟随当前背景' : '<i class="fa-solid fa-circle-exclamation" style="color:#eab308;"></i> 请先设置背景');
      }
    } else {
      if (selBtn) selBtn.style.display = 'none';
      if (infoEl) infoEl.style.display = 'none';
    }
    var volRow = $('splash-volume-row');
    if (volRow) volRow.style.display = (splashType === 'video' || (splashType === 'bg' && bgType === 'video')) ? '' : 'none';
    var volSlider = $('splash-volume-slider');
    var volVal = $('splash-volume-value');
    if (volSlider) volSlider.value = splashVolume;
    if (volVal) volVal.textContent = splashVolume + '%';
  }

  function updateBgOptions() {
    qsa('.bg-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.bg === bgType);
    });
    var volRow = $('bg-video-volume-row');
    if (volRow) volRow.style.display = (bgType === 'video') ? '' : 'none';
  }

  function updateBgPreview() {
    const preview = $('bg-preview');
    if (bgType === 'none') {
      preview.innerHTML = '<span style="color:var(--text-secondary);font-size:13px;">无背景</span>';
    } else if (bgType === 'image') {
      preview.innerHTML = bgPath ? '<img src="' + bgPath + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="color:var(--text-secondary);font-size:13px;">未选择图片</span>';
    } else if (bgType === 'video') {
      preview.innerHTML = bgPath ? '<video src="' + bgPath + '" style="width:100%;height:100%;object-fit:cover;" loop muted playsinline></video>' : '<span style="color:var(--text-secondary);font-size:13px;">未选择视频</span>';
      const v = preview.querySelector('video');
      if (v) v.play().catch(() => {});
    } else if (bgType === 'high-contrast') {
      preview.innerHTML = '<span style="color:var(--text-secondary);font-size:13px;"><i class="fa-solid fa-circle-half-stroke"></i> 高对比度</span>';
    }
  }

  function applyBackground() {
    $('bg-image').style.display = 'none';
    $('bg-image').src = '';
    $('bg-video').style.display = 'none';
    $('bg-video').pause();
    $('bg-video').src = '';
    if (bgType === 'image' && bgPath) {
      $('bg-image').src = bgPath;
      $('bg-image').style.display = 'block';
    } else if (bgType === 'video' && bgPath) {
      $('bg-video').src = bgPath;
      $('bg-video').load();
      $('bg-video').style.display = 'block';
      $('bg-video').play().catch(() => {});
      $('bg-video').volume = bgVideoVolume / 100;
    }
    applyTheme();
  }

  function applyFont() {
    // 清除旧的 body 内联样式
    document.body.style.fontFamily = '';
    document.body.style.fontWeight = '';
    document.body.style.fontSize = '';
    document.body.style.color = '';

    // @font-face 声明
    var faceId = 'custom-font-face';
    var faceExisting = document.getElementById(faceId);
    if (faceExisting) faceExisting.remove();
    if (customFontFamily && customFontPath) {
      var fontUrl = customFontPath;
      // 将 Windows 原始路径转换为 file:// URL（兼容旧数据）
      if (/^[a-zA-Z]:[\\\/]/.test(fontUrl)) {
        fontUrl = 'file:///' + fontUrl.replace(/\\/g, '/');
      }
      var faceStyle = document.createElement('style');
      faceStyle.id = faceId;
      faceStyle.textContent = '@font-face{font-family:"CustomFont";src:url("' + fontUrl + '") format("truetype");font-display:block;}';
      document.head.appendChild(faceStyle);
    }

    // 全局字体样式
    var styleId = 'custom-font-global';
    var existing = document.getElementById(styleId);
    if (existing) existing.remove();

    var fontFamily = customFontFamily ? '"CustomFont", "Microsoft YaHei", "微软雅黑", "Segoe UI", sans-serif' : '"Microsoft YaHei", "微软雅黑", "Segoe UI", sans-serif';
    var defaultFamily = '"Microsoft YaHei", "微软雅黑", "Segoe UI", sans-serif';
    var baseHomework = 20; // 80%时作业=16px
    var hwSize = Math.round(baseHomework * (fontSizeSetting / 100));
    var scaledSize = Math.round(hwSize / 1.15);

    var css = '';
    // 1. body 仅设置字体族、粗细、颜色，不强制字号（避免覆盖浏览器/学习通/设置页）
    css += 'body{font-family:' + fontFamily + '!important;font-weight:' + fontWeightSetting + '!important;';
    if (fontColorSetting) css += 'color:' + fontColorSetting + '!important;';
    css += '}';
    // 2. 标题栏/侧边栏/浏览器容器重置字体族（保留各区域原始字号）
    css += '#titlebar{font-family:' + defaultFamily + '!important;}';
    css += '#sidebar{font-family:' + defaultFamily + '!important;}';
    css += '.browser-container{font-family:' + defaultFamily + '!important;}';
    // 3. 仅作业/文件列表/树节点使用自定义字号
    css += '.page .card-body,.page .file-item,.page .file-list,.page .tree-node-item{font-size:' + hwSize + 'px!important;}';

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function login() {
    const username = $('login-username').value.trim();
    const password = $('login-password').value.trim();
    if (!username || !password) { showToast('提示', '请输入用户名和密码', 'error'); return; }
    setGlobalProgress(true);
    try {
      const data = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      token = data.token;
      localStorage.setItem('token', token);
      hideLoginModal();
      showToast('登录成功', '欢迎回来，' + username, 'success');
      await loadUserInfo();
      loadHomeData();
    } catch (e) {
      showToast('登录失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function register() {
    const username = $('login-username').value.trim();
    const password = $('login-password').value.trim();
    const passwordConfirm = $('login-password-confirm').value.trim();
    if (!username || !password) { showToast('提示', '请输入用户名和密码', 'error'); return; }
    if (password.length < 6) { showToast('提示', '密码至少6位', 'error'); return; }
    if (password !== passwordConfirm) { showToast('提示', '两次输入的密码不一致', 'error'); return; }
    setGlobalProgress(true);
    try {
      const data = await apiFetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      token = data.token;
      localStorage.setItem('token', token);
      hideLoginModal();
      showToast('注册成功', '欢迎加入，' + username, 'success');
      await loadUserInfo();
      loadHomeData();
    } catch (e) {
      showToast('注册失败', e.message, 'error', 5000, true);
      if (e.message.includes('已经存在') || e.message.includes('已被注册')) {
        isRegisterMode = false;
        $('login-modal-title').textContent = '登录';
        $('login-submit').textContent = '登录';
        $('switch-to-register').textContent = '还没有账号？点我注册';
        $('login-password-confirm-wrapper').style.display = 'none';
      }
    } finally {
      setGlobalProgress(false);
    }
  }

  async function loadUserInfo() {
    if (!token) return;
    try {
      const data = await apiFetch('/api/user/info');
      userInfo = data;
      nickname = data.nickname || data.username || '';
      if (API && API.setDeveloper) {
        API.setDeveloper(!!data.is_developer);
      }
      if (data.is_developer) {
        var logBtn = document.querySelector('.sidebar-btn[data-page="log"]');
        if (logBtn) logBtn.style.display = '';
        var devTab = document.getElementById('developer-tab');
        if (devTab) devTab.style.display = '';
        initLogCapture();
      }
      if (data.avatar && !data.avatar.startsWith('http')) {
        avatar = getBackend() + data.avatar;
      } else {
        avatar = data.avatar || '';
      }
      if (avatar) {
        try {
          var imgResp = await fetch(avatar);
          var blob = await imgResp.blob();
          var base64 = await new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onloadend = function() { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          data._cachedAvatar = base64;
        } catch (e) {}
      }
      localStorage.setItem('nickname', nickname);
      localStorage.setItem('avatar', avatar);
      localStorage.setItem('cachedUserInfo', JSON.stringify(data));
      updateAvatarUI();
      loadLearningInfo();
    } catch (e) {
      var cached = localStorage.getItem('cachedUserInfo');
      if (cached) {
        try {
          var cachedData = JSON.parse(cached);
          userInfo = cachedData;
          nickname = cachedData.nickname || cachedData.username || localStorage.getItem('nickname') || '';
          avatar = cachedData._cachedAvatar || cachedData.avatar || localStorage.getItem('avatar') || '';
          if (API && API.setDeveloper) {
            API.setDeveloper(!!cachedData.is_developer);
          }
          if (cachedData.is_developer) {
            var logBtn2 = document.querySelector('.sidebar-btn[data-page="log"]');
            if (logBtn2) logBtn2.style.display = '';
            var devTab2 = document.getElementById('developer-tab');
            if (devTab2) devTab2.style.display = '';
            initLogCapture();
          }
          updateAvatarUI();
          console.log('[App] 从本地缓存恢复用户信息（离线模式）');
        } catch (e2) {
          console.error('[App] 本地缓存解析失败', e2);
        }
      }
      if (!cached && e.code !== 401) showToast('获取用户信息失败', e.message, 'error', 3000, true);
    }
  }

  function updateAvatarUI() {
    const btn = $('avatar-btn');
    const popupNick = $('popup-nickname');
    if (nickname) {
      popupNick.textContent = nickname;
      btn.title = nickname;
    } else {
      popupNick.textContent = '未登录';
      btn.title = '用户菜单';
    }
    if (avatar) {
      btn.style.backgroundImage = 'url(' + avatar + ')';
      btn.innerHTML = '';
    } else {
      btn.style.backgroundImage = '';
      btn.innerHTML = '<i class="fa-solid fa-user"></i>';
    }
  }

  function toggleLearningSensitive(hidden) {
    const fields = [
      { id: 'learning-name', key: 'name' },
      { id: 'learning-unit', key: 'unit' },
      { id: 'learning-account', key: 'account' },
      { id: 'learning-password', key: 'password' }
    ];
    fields.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      const real = el.dataset.realValue || '';
      if (hidden) {
        el.dataset.realValue = real || el.textContent;
        el.textContent = '*'.repeat(real.length || el.textContent.length);
      } else {
        el.textContent = el.dataset.realValue || el.textContent;
      }
    });
  }

  async function loadLearningInfo() {
    const infoEl = $('learning-info');
    if (!userInfo || !token) {
      if (infoEl) infoEl.style.display = 'none';
      return;
    }
    try {
      const realName = userInfo.username || '';
      const data = await apiFetch('/api/get_learning_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ real_name: realName })
      });
      if (data && infoEl) {
        var localCreds = null;
        try { localCreds = JSON.parse(localStorage.getItem('xxtLocalCredentials') || 'null'); } catch(e) {}
        if (localCreds && localCreds.account) {
          data.account = localCreds.account;
          if (localCreds.password) data.password = localCreds.password;
          if (localCreds.unit) data.unit = localCreds.unit;
        }
        if (!data.account) {
          $('learning-info-data-row').style.display = 'none';
          $('learning-info-no-data-row').style.display = '';
          infoEl.style.display = 'block';
          showXxtLearningInfoNoData();
          return;
        }
        $('learning-info-data-row').style.display = '';
        $('learning-info-no-data-row').style.display = 'none';
        var unitText = data.unit || '浙江东方职业技术学院';
        $('learning-name').textContent = realName;
        $('learning-name').dataset.realValue = realName;
        $('learning-unit').textContent = unitText;
        $('learning-unit').dataset.realValue = unitText;
        $('learning-account').textContent = data.account || '-';
        $('learning-account').dataset.realValue = data.account || '-';
        $('learning-password').textContent = data.password || '-';
        $('learning-password').dataset.realValue = data.password || '-';
        infoEl.style.display = 'block';
        syncXxtLearningInfo(realName, unitText, data);
        toggleLearningSensitive(true);
        infoEl.querySelectorAll('.copy-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const type = btn.dataset.copy;
            let text = '';
            if (type === 'unit') text = $('learning-unit').dataset.realValue || '';
            else if (type === 'account') text = $('learning-account').dataset.realValue || '';
            else if (type === 'password') text = $('learning-password').dataset.realValue || '';
            navigator.clipboard.writeText(text).then(() => showToast('已复制', '内容已复制到剪贴板', 'success', 2000));
          });
        });
      } else if (infoEl) {
        $('learning-info-data-row').style.display = 'none';
        $('learning-info-no-data-row').style.display = '';
        infoEl.style.display = 'block';
        showXxtLearningInfoNoData();
      }
    } catch (e) {
      console.error('加载学习通信息失败:', e);
      var localCreds = null;
      try { localCreds = JSON.parse(localStorage.getItem('xxtLocalCredentials') || 'null'); } catch(e2) {}
      if (localCreds && localCreds.account && infoEl) {
        var unitText = localCreds.unit || '浙江东方职业技术学院';
        var realName = userInfo.username || '';
        $('learning-name').textContent = realName;
        $('learning-name').dataset.realValue = realName;
        $('learning-unit').textContent = unitText;
        $('learning-unit').dataset.realValue = unitText;
        $('learning-account').textContent = localCreds.account;
        $('learning-account').dataset.realValue = localCreds.account;
        $('learning-password').textContent = localCreds.password || '-';
        $('learning-password').dataset.realValue = localCreds.password || '-';
        $('learning-info-data-row').style.display = '';
        $('learning-info-no-data-row').style.display = 'none';
        infoEl.style.display = 'block';
        syncXxtLearningInfo(realName, unitText, { account: localCreds.account, password: localCreds.password || '-', unit: unitText });
        toggleLearningSensitive(true);
      } else {
        if (infoEl) {
          $('learning-info-data-row').style.display = 'none';
          $('learning-info-no-data-row').style.display = '';
          infoEl.style.display = 'block';
        }
        showXxtLearningInfoNoData();
      }
    }
  }

  async function loadHomeData() {
    await loadUserInfo();
    await loadWorkTree();
    await loadResourceTree();
    if (token) loadWeather();
  }

  function backupExpandedIds(container) {
    var ids = [];
    if (!container) return ids;
    container.querySelectorAll('.tree-node[id^="children-"]').forEach(function(el) {
      if (el.style.display === 'block') ids.push(el.id);
    });
    return ids;
  }
  function restoreExpandedIds(container, ids) {
    if (!container || !ids || !ids.length) return;
    ids.forEach(function(id) {
      var el = container.querySelector('#' + CSS.escape(id));
      if (el) {
        el.style.display = 'block';
        var nodeId = id.replace('children-', '');
        var parentLi = el.closest('li');
        if (parentLi) {
          var icon = parentLi.querySelector('.toggle-icon[data-nodeid] i');
          if (icon) icon.className = 'fa-solid fa-caret-down';
        }
      }
    });
  }

  async function loadWorkTree() {
    const container = $('work-tree-container');
    if (!token) { container.innerHTML = '<div class="empty-state">请先登录</div>'; return; }
    try {
      var expanded = backupExpandedIds(container);
      const data = await apiFetch('/api/work/tree');
      workTreeData = data;
      container.innerHTML = renderTree(data, 'work');
      bindTreeEvents(container, 'work');
      bindDragDrop(container, 'work');
      restoreExpandedIds(container, expanded);
    } catch (e) {
      container.innerHTML = '<div class="empty-state">加载失败: ' + escapeHtml(e.message) + '</div>';
    }
  }

  async function loadResourceTree() {
    const container = $('resource-tree-container');
    if (!token) { container.innerHTML = '<div class="empty-state">请先登录</div>'; return; }
    try {
      var expanded = backupExpandedIds(container);
      const data = await apiFetch('/api/resource/tree', { noRetry: true });
      resourceTreeData = data;
      lastResourceFingerprint = getTreeFingerprint(data);
      container.innerHTML = renderTree(data, 'resource');
      bindTreeEvents(container, 'resource');
      bindDragDrop(container, 'resource');
      restoreExpandedIds(container, expanded);
    } catch (e) {
      container.innerHTML = '<div class="empty-state">加载失败: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function highlightFileNode(container, paths, treeType) {
    if (!container || !paths || !paths.length) return;
    paths.forEach(function(filePath) {
      var lastSlash = filePath.lastIndexOf('/');
      if (lastSlash !== -1) {
        var parentPath = filePath.substring(0, lastSlash);
        var nodeId = (treeType + '-' + parentPath).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
        var childrenEl = container.querySelector('#children-' + CSS.escape(nodeId));
        if (childrenEl && childrenEl.style.display !== 'block') {
          childrenEl.style.display = 'block';
          var parentLi = childrenEl.closest('li');
          if (parentLi) {
            var icon = parentLi.querySelector('.toggle-icon[data-nodeid] i');
            if (icon) icon.className = 'fa-solid fa-caret-down';
          }
        }
      }
      var node = container.querySelector('.tree-node-item[data-path="' + CSS.escape(filePath) + '"]');
      if (!node) return;
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.classList.add('upload-highlight');
      setTimeout(function() { node.classList.remove('upload-highlight'); }, 1500);
    });
  }

  let lastNotificationId = 0;
  let lastResourceFingerprint = '';
  let resourcePollInterval = null;

  function getTreeFingerprint(tree) {
    const paths = [];
    function walk(node, parentPath) {
      const name = node.name || '';
      const currentPath = parentPath ? parentPath + '/' + name : name;
      paths.push(currentPath + (node.type === 'directory' || node.children ? '/' : ''));
      if (node.children) {
        node.children.forEach(child => walk(child, currentPath));
      }
    }
    if (tree && tree.children) {
      tree.children.forEach(child => walk(child, ''));
    }
    return paths.sort().join('|');
  }

  async function checkResourceNotifications() {
    if (!token) return;
    try {
      const resp = await fetch(getBackend() + '/api/notifications');
      if (!resp.ok) return;
      const notifications = await resp.json();
      if (!Array.isArray(notifications) || !notifications.length) return;
      const maxId = Math.max(...notifications.map(n => n.id));
      if (maxId <= lastNotificationId) return;
      const newNotifs = notifications.filter(n => n.id > lastNotificationId);
      lastNotificationId = maxId;
      const materialNotifs = newNotifs.filter(n => n.msg && (n.type === 'resource' || n.msg.includes('素材') || n.msg.includes('资源')));
      if (materialNotifs.length > 0) {
        await loadResourceTree();
        materialNotifs.forEach(n => showToast('新素材', n.msg, 'info', 4000));
      }
      const workNotifs = newNotifs.filter(n => n.type === 'work-upload' || (n.msg && n.msg.includes('上传了')));
      if (workNotifs.length > 0) {
        var isDev2 = userInfo && userInfo.is_developer;
        if (isDev2) {
          await loadWorkTree();
          var workPaths = workNotifs.map(function(n) { return n.file_path; }).filter(Boolean);
          if (workPaths.length > 0) {
            highlightFileNode($('work-tree-container'), workPaths, 'work');
          }
          workNotifs.forEach(n => showToast('新作业', n.msg, 'info', 4000));
        }
      }
      const renameNotifs = newNotifs.filter(n => n.type === 'rename' || n.type === 'work-rename' || n.type === 'resource-rename' || (n.msg && n.msg.includes('重命名')));
      if (renameNotifs.length > 0) {
        var isDev3 = userInfo && userInfo.is_developer;
        if (isDev3) {
          await loadWorkTree();
          await loadResourceTree();
          renameNotifs.forEach(n => showToast('文件重命名', n.msg, 'info', 4000));
        }
      }
      const permNotifs = newNotifs.filter(n => n.type === 'perm');
      if (permNotifs.length > 0) {
        await loadWorkTree();
        permNotifs.forEach(n => showToast('权限变更', n.msg, 'info', 4000));
      }
    } catch (e) {}
  }

  function startResourcePolling() {
    if (resourcePollInterval) return;
    fetch(getBackend() + '/api/notifications')
      .then(r => r.json())
      .then(arr => { if (Array.isArray(arr) && arr.length) lastNotificationId = Math.max(...arr.map(n => n.id)); })
      .catch(() => {});
    resourcePollInterval = setInterval(checkResourceNotifications, 5000);
  }

  function sortNodes(children) {
    if (!children || !children.length) return;
    var collator = new Intl.Collator('zh-CN', { numeric: true });
    children.sort(function(a, b) {
      var aDir = a.type === 'directory' || !!a.children;
      var bDir = b.type === 'directory' || !!b.children;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return collator.compare(a.name || '', b.name || '');
    });
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function renderTree(node, type) {
    if (!node || !node.children) return '';
    sortNodes(node.children);
    let html = '<ul class="tree-root">';
    for (const child of node.children) {
      html += renderTreeNode(child, type, 0);
    }
    html += '</ul>';
    return html;
  }

  function isShallowPath(path) {
    const segs = (path || '').split('/').filter(Boolean);
    return segs.length <= 2;
  }

  function getFolderSize(treeData, targetPath) {
    function walk(node) {
      if (!node) return 0;
      if (node.path === targetPath) return sumTree(node);
      if (node.children) {
        for (const child of node.children) {
          const s = walk(child);
          if (s > 0) return s;
        }
      }
      return 0;
    }
    function sumTree(node) {
      if (!node) return 0;
      let total = node.size || 0;
      if (node.children) {
        for (const child of node.children) {
          total += sumTree(child);
        }
      }
      return total;
    }
    return walk(treeData);
  }

  function getFolderInfo(treeData, targetPath) {
    var result = { totalSize: 0, fileCount: 0 };
    function findAndSum(node) {
      if (!node) return false;
      if (node.path === targetPath) { sumTree(node); return true; }
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          if (findAndSum(node.children[i])) return true;
        }
      }
      return false;
    }
    function sumTree(node) {
      if (!node) return;
      if ((!node.children || node.children.length === 0) && node.type !== 'directory') {
        result.totalSize += node.size || 0;
        result.fileCount++;
      }
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          sumTree(node.children[i]);
        }
      }
    }
    findAndSum(treeData);
    return result;
  }

  function getFileSize(treeData, targetPath) {
    function walk(node) {
      if (!node) return 0;
      if (node.path === targetPath) return node.size || 0;
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          var s = walk(node.children[i]);
          if (s) return s;
        }
      }
      return 0;
    }
    return walk(treeData);
  }

  function findNodeByPath(treeData, targetPath) {
    function walk(node) {
      if (!node) return null;
      if (node.path === targetPath) return node;
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          var found = walk(node.children[i]);
          if (found) return found;
        }
      }
      return null;
    }
    return walk(treeData);
  }

  function renderTreeNode(node, type, depth) {
    const isDir = node.type === 'directory' || !!node.children;
    const nodeId = (type + '-' + (node.path || node.name || '')).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    let html = '<li class="tree-node"><div class="tree-node-item" data-path="' + escapeHtml(node.path || node.name || '') + '" data-type="' + type + '" data-isdir="' + isDir + '" data-readonly="' + (node.readonly ? '1' : '0') + '">';
    if (isDir) {
      html += '<span class="toggle-icon" data-nodeid="' + nodeId + '"><i class="fa-solid fa-caret-right"></i></span>';
    } else {
      html += '<span class="toggle-icon" style="visibility:hidden;"><i class="fa-solid fa-caret-right"></i></span>';
    }
    html += '<span class="node-name">' + (isDir ? '<i class="fa-solid fa-folder" style="font-size:0.85rem;"></i> ' : '<i class="fa-solid fa-file" style="font-size:0.85rem;"></i> ') + escapeHtml(node.name || node.path || '') + '</span>';
    const isDev = userInfo && userInfo.is_developer;
    if (isDir && type === 'work' && isShallowPath(node.path)) {
      if (isDev) {
        html += '<span class="root-badge">根目录文件夹</span>';
        if (node.readonly) html += '<span class="readonly-badge">只读</span>';
      }
    } else if (node.readonly) {
      html += '<span class="readonly-badge">只读</span>';
    }
    if (!isDir) {
      if (node.size) html += '<span class="file-size-badge">' + formatFileSize(node.size) + '</span>';
      if (isDev && node.uploader) html += '<span class="uploader-badge">' + escapeHtml(node.uploader) + ' 上传</span>';
    }
    html += '<span class="actions">';
    if (isDir && type === 'work') {
      const isShallow = isShallowPath(node.path);
      if (isDev) {
        html += '<button class="upload-btn" data-action="new-folder" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--theme);"><i class="fa-solid fa-folder-plus"></i> 新建</button>';
        html += '<button class="upload-btn" data-action="rename" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--text-secondary);"><i class="fa-solid fa-pen"></i> 重命名</button>';
        if (!isShallow) {
          html += '<button class="upload-btn" data-action="set-permission" data-path="' + escapeHtml(node.path || node.name || '') + '" data-current-perm="' + (node.readonly ? 'ro' : 'rw') + '" style="background:#e67e22;"><i class="fa-solid fa-lock"></i> ' + (node.readonly ? '改可读写' : '改为只读') + '</button>';
        }
        html += '<button class="upload-btn" data-action="download-zip" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#9b59b6;"><i class="fa-solid fa-file-zipper"></i> 下载压缩包</button>';
        if (depth >= 2 && !node.readonly && localStorage.getItem('showCopyHomework') === 'true') {
          html += '<button class="upload-btn" data-action="copy-homework" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#27ae60;"><i class="fa-solid fa-hand-sparkles"></i> 帮我交作业</button>';
        }
        if (!isShallow && !node.readonly) {
          html += '<button class="upload-btn" data-action="upload" data-path="' + escapeHtml(node.path || node.name || '') + '"><i class="fa-solid fa-upload"></i> 上传</button>';
        } else {
          html += '<button class="upload-btn disabled" data-path="' + escapeHtml(node.path || node.name || '') + '"><i class="fa-solid fa-upload"></i> 上传</button>';
        }
      } else {
        if (depth >= 2 && !node.readonly) {
          html += '<button class="upload-btn" data-action="copy-homework" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#27ae60;"><i class="fa-solid fa-hand-sparkles"></i> 帮我交作业</button>';
        }
        if (node.readonly || isShallow) {
          html += '<button class="upload-btn disabled" data-path="' + escapeHtml(node.path || node.name || '') + '"><i class="fa-solid fa-upload"></i> 上传</button>';
        } else {
          html += '<button class="upload-btn" data-action="upload" data-path="' + escapeHtml(node.path || node.name || '') + '"><i class="fa-solid fa-upload"></i> 上传</button>';
        }
      }
    }
    if (isDir && type === 'resource') {
      if (isDev) {
        html += '<button class="upload-btn" data-action="new-folder" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--theme);"><i class="fa-solid fa-folder-plus"></i> 新建</button>';
        html += '<button class="upload-btn" data-action="rename" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--text-secondary);"><i class="fa-solid fa-pen"></i> 重命名</button>';
        html += '<button class="upload-btn" data-action="upload" data-path="' + escapeHtml(node.path || node.name || '') + '"><i class="fa-solid fa-upload"></i> 上传</button>';
      }
    }
    if (!isDir && type === 'work') {
      if (isDev) {
        html += '<button class="upload-btn" data-action="download" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--theme);"><i class="fa-solid fa-download"></i> 下载</button>';
        html += '<button class="upload-btn" data-action="delete" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#e74c3c;"><i class="fa-solid fa-trash"></i> 删除</button>';
        html += '<button class="upload-btn" data-action="rename" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--text-secondary);"><i class="fa-solid fa-pen"></i> 重命名</button>';
        html += '<button class="upload-btn" data-action="move" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#3498db;"><i class="fa-solid fa-arrows"></i> 移动</button>';
        html += '<button class="upload-btn" data-action="upload" data-path="' + escapeHtml(node.path || node.name || '') + '"><i class="fa-solid fa-upload"></i> 上传</button>';
      } else {
        if (node.uploader && userInfo && node.uploader === userInfo.username) {
          html += '<button class="upload-btn" data-action="delete-own" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#e74c3c;"><i class="fa-solid fa-trash"></i> 删除</button>';
        }
        if (!node.readonly) {
          html += '<button class="upload-btn" data-action="rename" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--text-secondary);"><i class="fa-solid fa-pen"></i> 重命名</button>';
        }
      }
    }
    if (!isDir && type === 'resource') {
      if (isDev) {
        html += '<button class="upload-btn" data-action="download" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--theme);"><i class="fa-solid fa-download"></i> 下载</button>';
        html += '<button class="upload-btn" data-action="delete" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#e74c3c;"><i class="fa-solid fa-trash"></i> 删除</button>';
        html += '<button class="upload-btn" data-action="rename" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--text-secondary);"><i class="fa-solid fa-pen"></i> 重命名</button>';
        html += '<button class="upload-btn" data-action="move" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:#3498db;"><i class="fa-solid fa-arrows"></i> 移动</button>';
      } else {
        if (!node.readonly) {
          html += '<button class="upload-btn" data-action="download" data-path="' + escapeHtml(node.path || node.name || '') + '" style="background:var(--theme);"><i class="fa-solid fa-download"></i> 下载</button>';
        }
      }
    }
    html += '</span></div>';
    if (isDir && node.children) {
      sortNodes(node.children);
      html += '<ul class="tree-node" id="children-' + nodeId + '" style="display:none;">';
      for (const c of node.children) {
        html += renderTreeNode(c, type, depth + 1);
      }
      html += '</ul>';
    }
    html += '</li>';
    return html;
  }

  function bindTreeEvents(container, type) {
    container.querySelectorAll('.toggle-icon').forEach(icon => {
      if (icon.dataset.nodeid) {
        const toggleFn = (e) => {
          e.stopPropagation();
          const children = $('children-' + icon.dataset.nodeid);
          if (children) {
            const isOpen = children.style.display !== 'none';
            children.style.display = isOpen ? 'none' : 'block';
            icon.querySelector('i').className = isOpen ? 'fa-solid fa-caret-right' : 'fa-solid fa-caret-down';
          }
        };
        icon.addEventListener('click', toggleFn);
        const nodeItem = icon.parentElement;
        if (nodeItem && nodeItem.dataset.isdir === 'true') {
          nodeItem.addEventListener('dblclick', toggleFn);
        }
      }
    });

    container.querySelectorAll('.upload-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.classList.contains('disabled')) {
          const path = btn.dataset.path || '';
          const isShallow = isShallowPath(path);
          showToast('提示', isShallow ? '该目录为作业根目录\n请展开子文件夹以继续上传' : '该目录为只读权限\n请检查你要上传的作业是否是这个目录', 'warning');
          return;
        }
        const action = btn.dataset.action;
        const path = btn.dataset.path;
        const nodeItem = btn.closest('.tree-node-item');
        const isDir = nodeItem ? nodeItem.dataset.isdir === 'true' : false;
        if (action === 'upload') {
          if (isDir) handleUpload(path, type);
          else handleUpload(path.substring(0, path.lastIndexOf('/')) || '', type);
        } else if (action === 'rename') handleRename(path, type, isDir);
        else if (action === 'download') handleDownload(path, type);
        else if (action === 'delete') handleDelete(path, type, isDir);
        else if (action === 'move') handleMove(path, type);
        else if (action === 'new-folder') handleNewFolder(path, type);
        else if (action === 'set-permission') handleSetPermission(path, type, btn.dataset.currentPerm || 'rw');
        else if (action === 'download-zip') handleDownloadZip(path, type);
        else if (action === 'copy-homework') handleCopyHomework(path, type);
        else if (action === 'delete-own') handleDeleteOwn(path, type);
      });
    });
  }

  function bindDragDrop(container, type) {
    if (type !== 'work') return;
    if (container._dragAbort) container._dragAbort.abort();
    container._dragAbort = new AbortController();
    const signal = { signal: container._dragAbort.signal };
    let dragTargetDir = '';

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = e.target.closest('.tree-node-item');
      if (item && item.dataset.isdir === 'true' && !isShallowPath(item.dataset.path || '') && item.dataset.readonly !== '1') {
        dragTargetDir = item.dataset.path || '';
        item.style.background = 'var(--theme-bg)';
        item.style.outline = '2px dashed var(--theme)';
      } else {
        dragTargetDir = '';
      }
    }, signal);

    container.addEventListener('dragleave', (e) => {
      const item = e.target.closest('.tree-node-item');
      if (item) {
        item.style.background = '';
        item.style.outline = '';
      }
    }, signal);

    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = e.target.closest('.tree-node-item');
      if (item) {
        item.style.background = '';
        item.style.outline = '';
      }
      const files = e.dataTransfer.files;
      if (!files.length || !dragTargetDir) return;
      const targetPath = dragTargetDir;
      setGlobalProgress(true);
      var successCount = 0;
      var failCount = 0;
      var errors = new Map();
      var uploadedPaths = [];
      var fileArr = Array.from(files);
      for (var fi = 0; fi < fileArr.length; fi++) {
        var file = fileArr[fi];
        try {
          var useXhr = file.size > 1048576;
          if (useXhr) beginUpload(file.name);
          if (useXhr) {
            await uploadSingleFile(file, file.name, targetPath);
          } else {
            var formData = new FormData();
            formData.append('file', file);
            formData.append('path', targetPath);
            formData.append('token', token);
            var result = await apiFetch('/upload', { method: 'POST', body: formData });
            if (result && result.warning) {
              showToast('警告', result.message, 'warning', 5000, true);
            }
          }
          endUpload(file.name);
          successCount++;
          uploadedPaths.push(targetPath + '/' + file.name);
        } catch (err) {
          if (useXhr) endUpload(file.name);
          failCount++;
          errors.set(err.message, (errors.get(err.message) || 0) + 1);
        }
      }
      if (failCount === 0) {
        showToast('上传成功', '已上传 ' + successCount + ' 个文件', 'success');
      } else if (successCount > 0) {
        showToast('部分上传成功', '成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'warning', 4000);
      } else {
        for (const [msg, count] of errors) {
          showToast('上传失败', count > 1 ? count + ' 个文件: ' + msg : msg, 'error', 5000, true);
        }
      }
      if (successCount > 0) {
        if (type === 'resource') {
          await loadResourceTree();
          highlightFileNode($('resource-tree-container'), uploadedPaths, 'resource');
        } else {
          await loadWorkTree();
          highlightFileNode($('work-tree-container'), uploadedPaths, 'work');
        }
      }
      setGlobalProgress(false);
      dragTargetDir = '';
    }, signal);
  }

  function renderUploadList() {
    var card = $('upload-active-card');
    var container = $('upload-active-container');
    if (!card || !container) return;
    if (activeUploadCount > 0) {
      card.style.display = '';
      container.innerHTML = activeUploadNames.map(function(name) {
        var pct = uploadProgress[name] || 0;
        return '<div class="download-item">' +
        '<div style="flex:1;min-width:0;">' +
        '<span><i class="fa-solid fa-upload" style="color:var(--theme);margin-right:6px;"></i>' + escapeHtml(name) + '</span>' +
        (pct > 0 ? '<div class="download-progress-bar"><div class="download-progress-fill" style="width:' + pct + '%"></div></div>' : '<span style="font-size:11px;color:var(--text-secondary);">上传中...</span>') +
        '</div>' +
        '<span style="font-size:11px;color:var(--text-secondary);flex-shrink:0;margin-left:8px;">' + (pct > 0 ? pct + '%' : '') + '</span>' +
        '</div>';
      }).join('');
    } else {
      card.style.display = 'none';
      container.innerHTML = '';
    }
  }
  function uploadSingleFile(fileBlob, fileName, targetPath, fileType) {
    fileType = fileType || 'work';
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      var fd = new FormData();
      fd.append('file', fileBlob, fileName);
      fd.append('path', targetPath);
      fd.append('type', fileType);
      fd.append('token', token);
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          uploadProgress[fileName] = Math.round((e.loaded / e.total) * 100);
          renderUploadList();
        }
      };
      xhr.onload = function() {
        if (xhr.status === 401) {
          var errMsg = '未登录';
          try { var b = JSON.parse(xhr.responseText); if (b.error) errMsg = b.error; } catch (e) {}
          token = '';
          localStorage.removeItem('token');
          showLoginModal();
          reject(new Error(errMsg));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var respJson = JSON.parse(xhr.responseText);
            if (respJson.warning) {
              showToast('警告', respJson.message || respJson.warning, 'warning', 5000, true);
            }
          } catch (_) {}
          resolve();
        } else {
          try {
            var r = JSON.parse(xhr.responseText);
            reject(new Error(r.error || r.message || ('上传失败 (' + xhr.status + ')')));
          } catch (e) {
            reject(new Error('上传失败 (' + xhr.status + ')'));
          }
        }
      };
      xhr.onerror = function() { reject(new Error('网络错误')); };
      xhr.open('POST', getBackend() + '/upload');
      xhr.send(fd);
    });
  }
  function beginUpload(fileName) {
    activeUploadCount++;
    activeUploadNames.push(fileName);
    if (currentPage !== 'downloads') switchPage('downloads');
    renderUploadList();
  }
  function endUpload(fileName) {
    activeUploadCount--;
    activeUploadNames = activeUploadNames.filter(function(n) { return n !== fileName; });
    delete uploadProgress[fileName];
    renderUploadList();
  }
  async function handleUpload(dirPath, fileType) {
    fileType = fileType || 'work';
    if (!API || !API.selectFile) {
      var input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async function(e) {
        var files = Array.from(e.target.files);
        if (!files.length) return;
        if (!isLanIP(getBackend())) {
          var oversized = files.filter(function(f) { return f.size > 16777216; });
          if (oversized.length > 0) {
            showToast('请到教学楼局域网内重试！', '原因:文件超过16MB，请到教学楼局域网内上传，或者提交作业截图\n\ntip:如果你已经连接到了教学楼局域网，请点击下方按钮尝试切换后端地址', 'error', 8000, true, { text: '尝试连接局域网服务器', callback: retryLanConnection });
            files = files.filter(function(f) { return f.size <= 16777216; });
            if (!files.length) return;
          }
        }

        setGlobalProgress(true);
        var successCount = 0, failCount = 0;
        var errors = new Map();
        var uploadedPaths2 = [];
        for (var i = 0; i < files.length; i++) {
          var file = files[i];
          var useXhr = file.size > 1048576;
          if (useXhr) beginUpload(file.name);
          try {
            if (useXhr) {
              await uploadSingleFile(file, file.name, dirPath, fileType);
            } else {
              var fd = new FormData();
              fd.append('file', file);
              fd.append('path', dirPath);
              fd.append('type', fileType);
              fd.append('token', token);
              var result = await apiFetch('/upload', { method: 'POST', body: fd });
              if (result && result.warning) {
                showToast('警告', result.message, 'warning', 5000, true);
              }
            }
            successCount++;
            uploadedPaths2.push(dirPath + '/' + file.name);
          } catch (err) {
            failCount++;
            errors.set(err.message, (errors.get(err.message) || 0) + 1);
          } finally {
            if (useXhr) endUpload(file.name);
          }
        }
        if (failCount === 0) {
          showToast('上传成功', '已上传 ' + successCount + ' 个文件', 'success');
        } else if (successCount > 0) {
          showToast('部分上传成功', '成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'warning', 4000);
        } else {
          errors.forEach(function(count, msg) {
            showToast('上传失败', count > 1 ? count + ' 个文件: ' + msg : msg, 'error', 5000, true);
          });
        }
        if (successCount > 0) {
          if (fileType === 'resource') {
            await loadResourceTree();
            highlightFileNode($('resource-tree-container'), uploadedPaths2, 'resource');
          } else {
            await loadWorkTree();
            highlightFileNode($('work-tree-container'), uploadedPaths2, 'work');
          }
        }
        setGlobalProgress(false);
      };
      input.click();
      return;
    }
    var files = await API.selectFile();
    if (!files || !files.length) return;
    if (!isLanIP(getBackend())) {
      var oversized = files.filter(function(f) {
        var sz = f.size !== undefined ? f.size : (f.data ? (f.data.byteLength || f.data.length) : 0);
        return sz > 16777216;
      });
      if (oversized.length > 0) {
        showToast('请到教学楼局域网内重试！', '原因:文件超过16MB，请到教学楼局域网内上传，或者提交作业截图\n\ntip:如果你已经连接到了教学楼局域网，请点击下方按钮尝试切换后端地址', 'error', 8000, true, { text: '尝试连接局域网服务器', callback: retryLanConnection });
        files = files.filter(function(f) {
          var sz = f.size !== undefined ? f.size : (f.data ? (f.data.byteLength || f.data.length) : 0);
          return sz <= 16777216;
        });
        if (!files.length) return;
      }
    }
    setGlobalProgress(true);
    var successCount = 0, failCount = 0;
    var errors = new Map();
    var uploadedPaths3 = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var fileBlob = new Blob([file.data]);
      var useXhr = (file.data.byteLength || file.data.length || fileBlob.size) > 1048576;
      if (useXhr) beginUpload(file.name);
      try {
        if (useXhr) {
          await uploadSingleFile(fileBlob, file.name, dirPath, fileType);
        } else {
          var fd = new FormData();
          fd.append('file', fileBlob, file.name);
          fd.append('path', dirPath);
          fd.append('type', fileType);
          fd.append('token', token);
          await apiFetch('/upload', { method: 'POST', body: fd });
        }
        successCount++;
        uploadedPaths3.push(dirPath + '/' + file.name);
        failCount++;
        errors.set(err.message, (errors.get(err.message) || 0) + 1);
      } finally {
        if (useXhr) endUpload(file.name);
      }
    }
    if (failCount === 0) {
      showToast('上传成功', '已上传 ' + successCount + ' 个文件', 'success');
    } else if (successCount > 0) {
      showToast('部分上传成功', '成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'warning', 4000);
    } else {
      errors.forEach(function(count, msg) {
        showToast('上传失败', count > 1 ? count + ' 个文件: ' + msg : msg, 'error', 5000, true);
      });
    }
    if (successCount > 0) {
      await loadWorkTree();
      highlightFileNode($('work-tree-container'), uploadedPaths3, 'work');
    }
    setGlobalProgress(false);
  }

  function handleRename(path, type, isDir) {
    $('rename-dialog').classList.add('show');
    $('rename-title').textContent = '重命名';
    const fullName = path.split('/').pop() || '';
    const lastDot = fullName.lastIndexOf('.');
    const nameOnly = lastDot > 0 ? fullName.substring(0, lastDot) : fullName;
    const ext = lastDot > 0 ? fullName.substring(lastDot) : '';
    $('rename-input').value = nameOnly;
    $('rename-input').dataset.path = path;
    $('rename-input').dataset.type = type;
    $('rename-input').dataset.isdir = isDir ? 'true' : 'false';
    $('rename-input').dataset.ext = ext;
    $('rename-input').focus();
    $('rename-input').select();
  }

  async function confirmRename() {
    const path = $('rename-input').dataset.path;
    const type = $('rename-input').dataset.type;
    const nameOnly = $('rename-input').value.trim();
    if (!nameOnly) { showToast('提示', '请输入新名称', 'error'); return; }
    const isDir = $('rename-input').dataset.isdir === 'true';
    if (isDir) {
      if (!userInfo || !userInfo.is_developer) {
        showToast('提示', '文件夹不支持重命名', 'error');
        $('rename-dialog').classList.remove('show');
        return;
      }
    }
    const ext = isDir ? '' : ($('rename-input').dataset.ext || '');
    const newName = nameOnly + ext;
    setGlobalProgress(true);
    try {
      const apiPath = isDir ? '/api/folder/rename' : '/api/work/rename';
      await apiFetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, newName, type: type })
      });
      $('rename-dialog').classList.remove('show');
      showToast('重命名成功', '已重命名为 ' + newName, 'success');
      var lastSlash = path.lastIndexOf('/');
      var newPath = lastSlash >= 0 ? path.substring(0, lastSlash + 1) + newName : newName;
      if (type === 'work') {
        await loadWorkTree();
        highlightFileNode($('work-tree-container'), [newPath], 'work');
      } else {
        await loadResourceTree();
        highlightFileNode($('resource-tree-container'), [newPath], 'resource');
      }
    } catch (e) {
      $('rename-dialog').classList.remove('show');
      showToast('重命名失败', e.message + '，请尝试刷新目录', 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function handleDownload(path, type) {
    const fileName = path.split('/').pop() || 'download';
    if (type === 'search' && !isLanIP(getBackend())) {
      var fileSize = searchResultSizes[path] || 0;
      if (fileSize > 16777216) {
        showToast('请到教学楼局域网内重试！', '原因:文件超过16MB，请到教学楼局域网内上传，或者提交作业截图\n\ntip:如果你已经连接到了教学楼局域网，请点击下方按钮尝试切换后端地址', 'error', 8000, true, { text: '尝试连接局域网服务器', callback: retryLanConnection });
        return;
      }
    }
    if (type === 'resource' && !isLanIP(getBackend())) {
      var resSize = getFileSize(resourceTreeData, path);
      if (resSize > 33554432) {
        showToast('请到教学楼局域网内重试！', '原因:文件超过32MB，请在局域网内下载\n\ntip:如果你已经连接到了教学楼局域网，请点击下方按钮尝试切换后端地址', 'error', 8000, true, { text: '尝试连接局域网服务器', callback: retryLanConnection });
        return;
      }
    }
    if (activeDownloadNames.includes(fileName)) {
      const pct = downloadProgress[fileName] || 0;
      showToast('正在下载，请稍后...', pct > 0 ? pct + '%' : '准备中...', 'info', 3000);
      return;
    }
    setGlobalProgress(true);
    activeDownloadCount++;
    activeDownloadNames.push(fileName);
    updateDownloadBadge();
    renderDownloadList();
    try {
      const apiPath = type === 'resource' ? '/api/resource/download' : '/api/work/download';
      const downloadUrl = getBackend() + apiPath + '?path=' + encodeURIComponent(path) + '&token=' + token;
      const category = type === 'resource' ? 'material' : 'homework';
      addDownloadRecord(fileName, downloadUrl, path, category);
      if (API && API.downloadFile) {
        setGlobalProgress(false);
        const result = await API.downloadFile(downloadUrl, fileName, token);
        if (result && result.canceled) {
          showToast('下载取消', fileName, 'info');
          return;
        }
        if (result && result.error) {
          throw new Error(result.error);
        }
        if (result && result.filePath) {
          const record = downloadHistory.find(r => r.name === fileName && r.path === path && r.category === category);
          if (record) {
            record.localPath = result.filePath;
            localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
          }
        }
      } else {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      showToast('下载成功', fileName, 'success');
    } catch (e) {
      showToast('下载失败', e.message, 'error', 5000, true);
    } finally {
      activeDownloadCount--;
      activeDownloadNames = activeDownloadNames.filter(n => n !== fileName);
      updateDownloadBadge();
      renderDownloadList();
    }
  }

  function showConfirm(title, message) {
    return new Promise(function(resolve) {
      $('generic-dialog-title').textContent = title;
      $('generic-dialog-msg').textContent = message;
      $('generic-dialog-input').style.display = 'none';
      $('generic-dialog-cancel').style.display = '';
      $('generic-dialog').classList.add('show');
      var keyHandler;
      function cleanup(ok) {
        document.removeEventListener('keydown', keyHandler);
        $('generic-dialog').classList.remove('show');
        resolve(ok);
      }
      $('generic-dialog-confirm').onclick = function() { cleanup(true); };
      $('generic-dialog-cancel').onclick = function() { cleanup(false); };
      $('generic-dialog').onclick = function(e) { if (e.target === $('generic-dialog')) cleanup(false); };
      keyHandler = function(e) {
        if (e.key === 'Enter') cleanup(true);
        if (e.key === 'Escape') cleanup(false);
      };
      document.addEventListener('keydown', keyHandler);
    });
  }

  function showFolderPicker(type, excludePath) {
    return new Promise(function(resolve) {
      var selectedPath = '';
      var treeData = null;
      var expandedPaths = {};

      function shouldExclude(childPath) {
        if (!excludePath || !childPath) return false;
        return childPath === excludePath || childPath.indexOf(excludePath + '/') === 0 || excludePath.indexOf(childPath + '/') === 0;
      }

      function renderFolderTreeNode(node, depth) {
        if (!node || !node.children) return '';
        var html = '';
        for (var i = 0; i < node.children.length; i++) {
          var child = node.children[i];
          var hasKids = child.children && child.children.length;
          var isDir = child.type === 'directory' || !!child.children;
          if (!isDir) continue;
          if (shouldExclude(child.path || '')) continue;
          var nodeId = 'fp-' + (child.path || '').replace(/[^a-zA-Z0-9]/g, '_');
          var expanded = !!expandedPaths[child.path || ''];
          var isSelected = child.path === selectedPath;
          html += '<div class="fp-node-row" data-path="' + escapeHtml(child.path || '') + '">';
          html += '<div class="fp-node-main" style="padding:4px 8px;cursor:pointer;padding-left:' + (12 + (depth || 0) * 20) + 'px;display:flex;align-items:center;' + (isSelected ? 'background:var(--theme);color:#fff;border-radius:4px;' : '') + '">';
          if (hasKids) {
            html += '<span class="fp-toggle" data-node-id="' + nodeId + '" style="width:16px;text-align:center;margin-right:4px;flex-shrink:0;"><i class="fa-solid fa-caret-' + (expanded ? 'down' : 'right') + '"></i></span>';
          } else {
            html += '<span style="width:16px;margin-right:4px;flex-shrink:0;"></span>';
          }
          html += '<i class="fa-solid fa-folder" style="margin-right:6px;font-size:0.85rem;flex-shrink:0;"></i>';
          html += '<span class="fp-name">' + escapeHtml(child.name || '') + '</span>';
          html += '</div></div>';
          if (hasKids) {
            html += '<div class="fp-children" id="' + nodeId + '" style="' + (expanded ? '' : 'display:none;') + '">';
            html += renderFolderTreeNode(child, (depth || 0) + 1);
            html += '</div>';
          }
        }
        return html;
      }

      function refreshPicker() {
        var container = $('folder-picker-tree');
        if (!treeData) {
          container.innerHTML = '加载中...';
          return;
        }
        container.innerHTML = renderFolderTreeNode(treeData, 0) || '<div style="padding:12px;color:var(--text-secondary);">无可用文件夹</div>';
        $('folder-picker-confirm').disabled = !selectedPath;

        container.querySelectorAll('.fp-node-row').forEach(function(row) {
          var path = row.getAttribute('data-path');
          row.ondblclick = function(e) {
            e.stopPropagation();
            var toggle = row.querySelector('.fp-toggle');
            if (toggle) toggle.click();
          };
        });

        container.querySelectorAll('.fp-node-main').forEach(function(main) {
          main.onclick = function(e) {
            var path = main.parentElement.getAttribute('data-path');
            selectedPath = path;
            refreshPicker();
          };
        });

        container.querySelectorAll('.fp-toggle').forEach(function(toggle) {
          toggle.onclick = function(e) {
            e.stopPropagation();
            var nodeId = toggle.getAttribute('data-node-id');
            var children = document.getElementById(nodeId);
            if (children) {
              var path = toggle.parentElement.parentElement.getAttribute('data-path');
              if (children.style.display === 'none') {
                children.style.display = '';
                expandedPaths[path] = true;
                toggle.innerHTML = '<i class="fa-solid fa-caret-down"></i>';
              } else {
                children.style.display = 'none';
                expandedPaths[path] = false;
                toggle.innerHTML = '<i class="fa-solid fa-caret-right"></i>';
              }
            }
          };
        });
      }

      var apiPath = type === 'resource' ? '/api/resource/tree' : '/api/work/tree';
      apiFetch(apiPath).then(function(data) {
        treeData = data;
        refreshPicker();
      }).catch(function() {
        $('folder-picker-tree').innerHTML = '<div style="padding:12px;color:var(--danger);">加载失败</div>';
      });

      $('folder-picker-title').textContent = '选择目标文件夹 - ' + (type === 'resource' ? '素材库' : '作业');
      $('folder-picker-dialog').classList.add('show');

      function cleanup(value) {
        $('folder-picker-dialog').classList.remove('show');
        resolve(value);
      }

      $('folder-picker-confirm').onclick = function() { if (selectedPath) cleanup(selectedPath); };
      $('folder-picker-cancel').onclick = function() { cleanup(null); };
      $('folder-picker-dialog').onclick = function(e) { if (e.target === $('folder-picker-dialog')) cleanup(null); };
    });
  }

  function showPrompt(title, message, defaultValue) {
    return new Promise(function(resolve) {
      $('generic-dialog-title').textContent = title;
      $('generic-dialog-msg').textContent = message;
      $('generic-dialog-input').style.display = '';
      $('generic-dialog-input').value = defaultValue || '';
      $('generic-dialog-cancel').style.display = '';
      $('generic-dialog').classList.add('show');
      $('generic-dialog-input').focus();
      $('generic-dialog-input').select();
      var keyHandler;
      function cleanup(value) {
        document.removeEventListener('keydown', keyHandler);
        $('generic-dialog').classList.remove('show');
        resolve(value);
      }
      $('generic-dialog-confirm').onclick = function() { cleanup($('generic-dialog-input').value); };
      $('generic-dialog-cancel').onclick = function() { cleanup(null); };
      $('generic-dialog').onclick = function(e) { if (e.target === $('generic-dialog')) cleanup(null); };
      keyHandler = function(e) {
        if (e.key === 'Enter') cleanup($('generic-dialog-input').value);
        if (e.key === 'Escape') cleanup(null);
      };
      document.addEventListener('keydown', keyHandler);
    });
  }

  async function handleDelete(path, type, isDir) {
    const fileName = path.split('/').pop() || '';
    if (isDir) { showToast('提示', '文件夹目前不支持删除', 'error'); return; }
    const ok = await showConfirm('确认删除', '确定要删除 ' + fileName + ' 吗？\n此操作不可恢复！');
    if (!ok) return;
    setGlobalProgress(true);
    try {
      await apiFetch('/api/file/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, type: type })
      });
      showToast('删除成功', '已删除 ' + fileName, 'success');
      if (type === 'work') loadWorkTree();
      else loadResourceTree();
    } catch (e) {
      showToast('删除失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function handleDeleteOwn(path, type) {
    const fileName = path.split('/').pop() || '';
    const ok = await showConfirm('确认删除', '确定要删除 ' + fileName + ' 吗？\n此操作不可恢复！');
    if (!ok) return;
    setGlobalProgress(true);
    try {
      await apiFetch('/api/work/delete_own', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, type: type })
      });
      showToast('删除成功', '已删除 ' + fileName, 'success');
      loadWorkTree();
    } catch (e) {
      showToast('删除失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function handleMove(path, type) {
    const fileName = path.split('/').pop() || '';
    const targetPath = await showFolderPicker(type, path);
    if (!targetPath) return;
    setGlobalProgress(true);
    try {
      await apiFetch('/api/file/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, target_path: targetPath, type: type })
      });
      showToast('移动成功', '已移动到 ' + targetPath, 'success');
      if (type === 'work') loadWorkTree();
      else loadResourceTree();
    } catch (e) {
      showToast('移动失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function handleNewFolder(parentPath, type) {
    const folderName = await showPrompt('新建文件夹', '请输入新文件夹名称：');
    if (!folderName || !folderName.trim()) return;
    setGlobalProgress(true);
    try {
      await apiFetch('/api/folder/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_path: parentPath, folder_name: folderName.trim(), type: type })
      });
      showToast('新建成功', '已创建文件夹 ' + folderName.trim(), 'success');
      if (type === 'work') loadWorkTree();
      else loadResourceTree();
    } catch (e) {
      showToast('新建失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function handleSetPermission(path, type, currentPerm) {
    const newPerm = currentPerm === 'ro' ? 'rw' : 'ro';
    const label = newPerm === 'ro' ? '只读' : '可读写';
    const ok = await showConfirm('更改权限', '确定要将此文件夹权限改为 "' + label + '" 吗？');
    if (!ok) return;
    setGlobalProgress(true);
    try {
      await apiFetch('/api/folder/set_permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, permission: newPerm, type: type })
      });
      showToast('权限已更新', '已设置为 ' + label, 'success');
      if (type === 'work') loadWorkTree();
      else loadResourceTree();
    } catch (e) {
      showToast('权限修改失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function handleDownloadZip(path, type) {
    const dirName = path.split('/').pop() || 'download';
    const zipName = dirName + '.zip';
    const ok = await showConfirm('下载压缩包', '下载压缩包 "' + dirName + '"？\n(局域网环境可直接下载，公网限制只能下载小于16MB的)');
    if (!ok) return;
    if (!isLanIP(getBackend())) {
      const treeData = type === 'resource' ? resourceTreeData : workTreeData;
      const folderSize = getFolderSize(treeData, path);
      if (folderSize > 16777216) {
        showToast('请到服务器局域网下重试！', '原因:压缩包超过16MB\n\ntip:如果你已经连接到了教学楼局域网，请点击下方按钮尝试切换后端地址', 'error', 8000, true, { text: '尝试连接局域网服务器', callback: retryLanConnection });
        return;
      }
    }
    if (activeDownloadNames.includes(zipName)) {
      const pct = downloadProgress[zipName] || 0;
      showToast('正在下载，请稍后...', pct > 0 ? pct + '%' : '准备中...', 'info', 3000);
      return;
    }
    var treeData = type === 'resource' ? resourceTreeData : workTreeData;
    var folderInfo = getFolderInfo(treeData, path);
    var runningTask = addRunningTask(zipName, folderInfo.fileCount, folderInfo.totalSize);
    showToast('正在压缩文件，请稍后...', '', 'info', 5000);
    setGlobalProgress(true);
    activeDownloadCount++;
    activeDownloadNames.push(zipName);
    updateDownloadBadge();
    renderDownloadList();
    try {
      const downloadUrl = getBackend() + '/api/folder/download_zip?path=' + encodeURIComponent(path) + '&type=' + type + '&token=' + token;
      const category = type === 'resource' ? 'material' : 'homework';
      addDownloadRecord(zipName, downloadUrl, path, category);
      if (API && API.downloadFile) {
        setGlobalProgress(false);
        const result = await API.downloadFile(downloadUrl, zipName, token);
        if (result && result.canceled) {
          removeRunningTask(runningTask);
          showToast('下载取消', zipName, 'info');
          return;
        }
        if (result && result.error) {
          throw new Error(result.error);
        }
        if (result && result.filePath) {
          const record = downloadHistory.find(r => r.name === zipName && r.path === path && r.category === category);
          if (record) {
            record.localPath = result.filePath;
            localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
          }
        }
      } else {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      removeRunningTask(runningTask);
      showToast('下载成功', zipName, 'success');
    } catch (e) {
      removeRunningTask(runningTask);
      showToast('下载失败', e.message, 'error', 5000, true);
    } finally {
      activeDownloadCount--;
      activeDownloadNames = activeDownloadNames.filter(n => n !== zipName);
      updateDownloadBadge();
      renderDownloadList();
    }
  }

  async function handleCopyHomework(path, type) {
    if (!token || !userInfo) { showToast('提示', '请先登录', 'error'); return; }
    var folderNode = findNodeByPath(workTreeData, path);
    if (!folderNode || !folderNode.children) { showToast('提示', '该文件夹中没有文件', 'info'); return; }
    var files = folderNode.children.filter(function(c) {
      return c.type !== 'directory' && !(c.children && c.children.length);
    });
    if (!files.length) { showToast('提示', '该文件夹中没有文件', 'info'); return; }
    var result2 = await showCopyHomeworkDialog(folderNode.name || path.split('/').pop(), files);
    if (!result2 || !result2.file) return;
    setGlobalProgress(true);
    try {
      var result = await Promise.race([
        apiFetch('/api/homework/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_path: path, files: [result2.file], new_name: result2.newName })
        }),
        new Promise(function(_, reject) {
          setTimeout(function() { reject(new Error('操作超时，请稍后重试')); }, 15000);
        })
      ]);
      showToast('复制作业成功', result.message || '已复制 1 个文件', 'success');
      await loadWorkTree();
      if (result.new_paths && result.new_paths.length) {
        highlightFileNode($('work-tree-container'), result.new_paths, 'work');
      }
    } catch (e) {
      showToast('复制作业失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  function showCopyHomeworkDialog(folderName, files) {
    return new Promise(function(resolve) {
      $('copy-homework-title').textContent = '想要复制谁的作业？';
      var listEl = $('copy-homework-file-list');
      var countEl = $('copy-hw-count');
      var confirmBtn = $('copy-hw-confirm');
      var selectedFile = null;

      files.sort(function(a, b) {
        var nameA = (a.name || '').toLowerCase();
        var nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      var html = '';
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var uploader = f.uploader || '未知';
        html += '<div class="copy-hw-row" data-file="' + escapeHtml(f.name) + '" style="cursor:pointer;padding:6px 8px;display:flex;align-items:center;border-radius:4px;">';
        html += '<i class="fa-solid fa-file" style="color:var(--text-secondary);font-size:0.85rem;margin:0 6px;"></i>';
        html += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(f.name) + '</span>';
        html += '<span class="file-size" style="flex-shrink:0;">' + (f.size ? formatFileSize(f.size) : '') + '</span>';
        html += '<span class="uploader-badge" style="flex-shrink:0;opacity:0.75;">' + escapeHtml(uploader) + ' 上传</span>';
        html += '</div>';
      }
      listEl.innerHTML = html;
      countEl.textContent = '共 ' + files.length + ' 个文件';
      confirmBtn.disabled = false;

      function updateSelection() {
        listEl.querySelectorAll('.copy-hw-row').forEach(function(row) {
          var file = row.dataset.file;
          if (file === selectedFile) {
            row.style.background = 'rgba(59, 130, 246, 0.15)';
            row.style.color = '';
          } else {
            row.style.background = '';
            row.style.color = '';
          }
        });
      }

      listEl.querySelectorAll('.copy-hw-row').forEach(function(row) {
        row.onclick = function() {
          var file = row.dataset.file;
          if (selectedFile === file) {
            selectedFile = null;
          } else {
            selectedFile = file;
          }
          updateSelection();
        };
      });

      $('copy-homework-dialog').classList.add('show');

      function cleanup(value) {
        document.removeEventListener('keydown', keyHandler);
        $('copy-homework-dialog').classList.remove('show');
        resolve(value);
      }

      var keyHandler;
      $('copy-hw-confirm').onclick = function() {
        if (!selectedFile) {
          showToast('提示', '请先选择文件', 'warning');
          return;
        }
        var newName = $('copy-hw-new-name').value.trim();
        cleanup({ file: selectedFile, newName: newName });
      };
      $('copy-hw-cancel').onclick = function() { cleanup(null); };
      keyHandler = function(e) {
        if (e.key === 'Escape') cleanup(null);
      };
      document.addEventListener('keydown', keyHandler);
    });
  }

  function updateDownloadBadge() {
    const btn = qs('.sidebar-btn[data-page="downloads"]');
    if (!btn) return;
    if (activeDownloadCount > 0) {
      btn.classList.add('downloading');
    } else {
      btn.classList.remove('downloading');
    }
  }

  function addRunningTask(name, totalFiles, totalSize) {
    var compressionRate = 35 * 1024 * 1024;
    var estimatedSec = Math.max(totalSize / compressionRate + totalFiles * 0.05, 2);
    var task = { name: name, totalFiles: totalFiles, totalSize: totalSize, estimatedSec: estimatedSec, startTime: Date.now(), progress: 0, done: false };
    runningTasks.push(task);
    startRunningTaskTimer();
    renderDownloadList();
    if (currentPage !== 'downloads') switchPage('downloads');
    return task;
  }

  function removeRunningTask(task) {
    task.done = true;
    runningTasks = runningTasks.filter(function(t) { return t !== task; });
    if (!runningTasks.length) stopRunningTaskTimer();
    renderDownloadList();
  }

  function startRunningTaskTimer() {
    if (runningTaskTimer) return;
    runningTaskTimer = setInterval(function() {
      var hasActive = false;
      for (var i = 0; i < runningTasks.length; i++) {
        var t = runningTasks[i];
        if (t.done) continue;
        hasActive = true;
        var elapsed = (Date.now() - t.startTime) / 1000;
        t.progress = Math.min(Math.round((elapsed / t.estimatedSec) * 95), 95);
      }
      if (hasActive) {
        renderDownloadList();
      } else {
        stopRunningTaskTimer();
        renderDownloadList();
      }
    }, 300);
  }

  function stopRunningTaskTimer() {
    if (runningTaskTimer) {
      clearInterval(runningTaskTimer);
      runningTaskTimer = null;
    }
  }

  function addDownloadRecord(name, url, path, category) {
    const record = { name, url, path, category, time: Date.now() };
    downloadHistory.unshift(record);
    if (downloadHistory.length > 200) downloadHistory = downloadHistory.slice(0, 200);
    localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
    if (currentPage === 'downloads') renderDownloadList();
  }

  let renderDownloadListScheduled = false;
  function renderDownloadList() {
    if (renderDownloadListScheduled) return;
    renderDownloadListScheduled = true;
    requestAnimationFrame(() => {
      renderDownloadListScheduled = false;
      _renderDownloadList();
    });
  }

  function _renderDownloadList() {
    var runningCard = $('running-tasks-card');
    var runningContainer = $('running-tasks-container');
    if (runningCard && runningContainer) {
      if (runningTasks.length > 0) {
        runningCard.style.display = '';
        runningContainer.innerHTML = runningTasks.map(function(task) {
          var pct = task.progress || 0;
          return '<div class="download-item">' +
          '<div style="flex:1;min-width:0;">' +
          '<span><i class="fa-solid fa-file-zipper" style="color:#9b59b6;margin-right:6px;"></i>' + escapeHtml(task.name) + '</span>' +
          '<span style="font-size:11px;color:var(--text-secondary);">正在压缩... (' + task.totalFiles + ' 个文件, ' + formatFileSize(task.totalSize) + ')</span>' +
          '<div class="download-progress-bar"><div class="download-progress-fill compress-progress-fill" style="width:' + pct + '%"></div></div>' +
          '</div>' +
          '<span style="font-size:11px;color:var(--text-secondary);flex-shrink:0;margin-left:8px;">' + pct + '%</span>' +
          '</div>';
        }).join('');
      } else {
        runningCard.style.display = 'none';
        runningContainer.innerHTML = '';
      }
    }

    const activeContainer = $('download-active-container');
    if (activeContainer) {
      if (activeDownloadCount > 0 && activeDownloadNames.length > 0) {
        activeContainer.innerHTML = activeDownloadNames.map(name => {
          const pct = downloadProgress[name] || 0;
          return '<div class="download-item">' +
          '<div style="flex:1;min-width:0;">' +
          '<span><i class="fa-solid fa-spinner fa-spin" style="color:var(--theme);margin-right:6px;"></i>' + escapeHtml(name) + '</span>' +
          (pct > 0 ? '<span style="font-size:11px;color:var(--text-secondary);">下载中...</span><div class="download-progress-bar"><div class="download-progress-fill" style="width:' + pct + '%"></div></div>' : '<span style="font-size:11px;color:var(--text-secondary);">加载中...</span>') +
          '</div>' +
          '<span style="font-size:11px;color:var(--text-secondary);flex-shrink:0;margin-left:8px;">' + (pct > 0 ? pct + '%' : '') + '</span>' +
          '<button class="download-cancel-btn" data-name="' + escapeHtml(name) + '" title="取消下载"><i class="fa-solid fa-xmark"></i></button>' +
          '</div>';
        }).join('');
      } else {
        activeContainer.innerHTML = '<div class="empty-state">暂无正在下载的任务</div>';
      }
    }

    const completedContainer = $('download-completed-container');
    if (!completedContainer) return;
    const items = downloadHistory.filter(item => item.category !== 'update');
    if (!items.length) {
      completedContainer.innerHTML = '<div class="empty-state">暂无下载记录</div>';
      return;
    }
    completedContainer.innerHTML = items.map((item, i) =>
      '<div class="download-item">' +
      '<span class="download-item-filename"><i class="fa-solid fa-file" style="color:var(--text-secondary);margin-right:6px;"></i>' + escapeHtml(item.name) + '</span>' +
      '<span class="download-item-date">' + new Date(item.time).toLocaleString() + '</span>' +
      '<div class="file-actions">' +
      (item.localPath ? '<button data-action="open" data-index="' + i + '" title="打开文件夹"><i class="fa-solid fa-folder-open"></i></button>' : '') +
      '<button data-action="remove" data-index="' + i + '" title="删除记录"><i class="fa-solid fa-xmark"></i></button>' +
      '</div></div>'
    ).join('');
    completedContainer.querySelectorAll('[data-action="open"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const filtered = downloadHistory.filter(item => item.category !== 'update');
        const item = filtered[idx];
        if (item && item.localPath && API && API.openFile) {
          API.openFile(item.localPath);
        }
      });
    });
    completedContainer.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const filtered = downloadHistory.filter(item => item.category !== 'update');
        const target = filtered[idx];
        if (target) {
          downloadHistory = downloadHistory.filter(item => item !== target);
          localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
          renderDownloadList();
        }
      });
    });

  }

  let downloadCancelDelegated = false;
  function ensureDownloadCancelHandler() {
    if (downloadCancelDelegated) return;
    const container = $('download-active-container');
    if (!container) return;
    downloadCancelDelegated = true;
    container.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('.download-cancel-btn');
      if (!btn) return;
      const name = btn.dataset.name;
      if (!activeDownloadNames.includes(name)) return;
      if (API && API.cancelDownload) API.cancelDownload();
      activeDownloadNames = activeDownloadNames.filter(n => n !== name);
      activeDownloadCount--;
      delete downloadProgress[name];
      updateDownloadBadge();
      renderDownloadList();
      showToast('已取消', name, 'info');
    });
  }

  async function searchHomework() {
    const keyword = $('search-input').value.trim();
    if (!keyword) { showToast('提示', '请输入关键词', 'error'); return; }
    if (!token) { showLoginModal(); return; }
    setGlobalProgress(true);
    try {
      const data = await apiFetch('/api/search?keyword=' + encodeURIComponent(keyword));
      const container = $('search-results');
      if (!data || !data.length) {
        container.innerHTML = '<div class="empty-state">未找到相关作业</div>';
        return;
      }
      data.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      var sizeMap = {};
      data.forEach(function(item) { sizeMap[item.path] = item.size || 0; });
      searchResultSizes = sizeMap;
      container.innerHTML = data.map(item =>
        '<div class="search-result-item">' +
        '<span><i class="fa-solid fa-file" style="font-size:0.85rem;"></i> ' + escapeHtml(item.name || item.filename || '') + (item.size ? ' <span class="file-size-badge">' + formatFileSize(item.size) + '</span>' : '') + '</span>' +
        '<span class="search-path" style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(item.path || '') + '</span>' +
        '<button class="download-btn" data-path="' + escapeHtml(item.path || '') + '" data-type="search"><i class="fa-solid fa-download"></i> 下载</button>' +
        '</div>'
      ).join('');
      container.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', () => handleDownload(btn.dataset.path, 'search'));
      });
    } catch (e) {
      showToast('搜索失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  let weatherCache = null;
  let weatherLoading = false;

  async function loadWeather() {
    const tempEl = $('weather-temp');
    if (weatherCache) {
      if (tempEl) tempEl.textContent = weatherCache.temp + '°C';
      const weatherBtn = $('weather-btn');
      if (weatherBtn) {
        const iconEl = weatherBtn.querySelector('i');
        if (iconEl) iconEl.className = 'fa-solid ' + weatherCache.icon;
      }
      return;
    }
    if (weatherLoading) return;
    weatherLoading = true;
    if (tempEl) tempEl.textContent = '获取中';
    const backend = getBackend();
    if (!backend) {
      if (tempEl) tempEl.textContent = '--°C';
      weatherLoading = false;
      return;
    }
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(backend + '/api/weather', { signal: controller.signal });
      clearTimeout(tid);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (data) {
        const iconMap = { '晴': 'fa-sun', '多云': 'fa-cloud-sun', '阴': 'fa-cloud', '雨': 'fa-cloud-rain', '雪': 'fa-snowflake', '雾': 'fa-smog' };
        let icon = 'fa-cloud-sun';
        for (const [k, v] of Object.entries(iconMap)) {
          if ((data.weather || data.text || '').includes(k)) { icon = v; break; }
        }
        weatherCache = { temp: data.temp || data.temperature || '--', icon };
        if (tempEl) tempEl.textContent = weatherCache.temp + '°C';
        const weatherBtn = $('weather-btn');
        if (weatherBtn) {
          const iconEl = weatherBtn.querySelector('i');
          if (iconEl) iconEl.className = 'fa-solid ' + icon;
        }
      }
    } catch (e) {
      if (tempEl && !weatherCache) tempEl.textContent = '--°C';
    } finally {
      weatherLoading = false;
    }
  }

  function showProfileModal() {
    if (!token) { showLoginModal(); return; }
    $('profile-modal').classList.add('show');
    $('profile-nickname').value = nickname || '';
    $('profile-password').value = '';
    $('profile-password-confirm').value = '';
    $('profile-avatar-preview').src = avatar || '';
    $('crop-container').style.display = 'none';
    $('crop-actions').style.display = 'none';
    if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
    closeAvatarPopup();
  }

  async function saveProfile() {
    const newNickname = $('profile-nickname').value.trim();
    const newPassword = $('profile-password').value.trim();
    const newPasswordConfirm = $('profile-password-confirm').value.trim();
    if (newPassword && newPassword !== newPasswordConfirm) {
      showToast('错误', '两次输入的密码不一致', 'error');
      setGlobalProgress(false);
      return;
    }
    setGlobalProgress(true);
    try {
      const body = {};
      if (newNickname) body.nickname = newNickname;
      if (newPassword) body.password = newPassword;
      if (Object.keys(body).length) {
        body.token = token;
        await apiFetch('/api/update_user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }
      if (newNickname) { nickname = newNickname; localStorage.setItem('nickname', nickname); }
      showToast('保存成功', '个人信息已更新', 'success');
      $('profile-modal').classList.remove('show');
      updateAvatarUI();
      loadLearningInfo();
    } catch (e) {
      showToast('保存失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  async function uploadAvatar() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        $('crop-container').style.display = 'block';
        $('crop-actions').style.display = 'block';
        $('crop-image').src = ev.target.result;
        if (cropperInst) cropperInst.destroy();
        cropperInst = new Cropper($('crop-image'), {
          aspectRatio: 1,
          viewMode: 1,
          autoCropArea: 1,
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function confirmCrop() {
    if (!cropperInst) return;
    const canvas = cropperInst.getCroppedCanvas({ width: 256, height: 256 });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.jpg');
    setGlobalProgress(true);
    try {
      const data = await apiFetch('/api/user/avatar', { method: 'POST', body: formData });
      const raw = data.avatar || data.url || '';
      avatar = raw && !raw.startsWith('http') ? getBackend() + raw : raw;
      avatar += '?t=' + Date.now();
      localStorage.setItem('avatar', avatar);
      $('profile-avatar-preview').src = avatar;
      $('crop-container').style.display = 'none';
      $('crop-actions').style.display = 'none';
      if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
      updateAvatarUI();
      showToast('头像更新成功', '', 'success');
    } catch (e) {
      showToast('头像上传失败', e.message, 'error', 5000, true);
    } finally {
      setGlobalProgress(false);
    }
  }

  function cancelCrop() {
    $('crop-container').style.display = 'none';
    $('crop-actions').style.display = 'none';
    if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
  }

  function resetAvatar() {
    avatar = '';
    localStorage.setItem('avatar', '');
    $('profile-avatar-preview').src = '';
    $('crop-container').style.display = 'none';
    $('crop-actions').style.display = 'none';
    if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
    updateAvatarUI();
    showToast('头像已重置', '', 'info');
  }

  function logout() {
    token = '';
    userInfo = null;
    nickname = '';
    avatar = '';
    localStorage.removeItem('token');
    localStorage.removeItem('nickname');
    localStorage.removeItem('avatar');
    if (API && API.setDeveloper) {
      API.setDeveloper(false);
    }
    var logBtn = document.querySelector('.sidebar-btn[data-page="log"]');
    if (logBtn) logBtn.style.display = 'none';
    updateAvatarUI();
    closeAvatarPopup();
    $('work-tree-container').innerHTML = '<div class="empty-state">请先登录</div>';
    $('resource-tree-container').innerHTML = '<div class="empty-state">请先登录</div>';
    $('learning-info').style.display = 'none';
    $('search-results').innerHTML = '<div class="empty-state">请输入关键词搜索</div>';
    showLoginModal();
    showToast('已退出登录', '', 'info');
  }

  function toggleAvatarPopup() {
    if (!token) { showLoginModal(); return; }
    const popup = $('avatar-popup');
    popup.classList.toggle('show');
  }

  function closeAvatarPopup() {
    $('avatar-popup').classList.remove('show');
  }

  let checkingUpdate = false;
  let updateCheckManual = false;

  function startUpdateDownload(downloadUrl, version) {
    if (updateDownloading) {
      showToast('正在下载更新', '请稍后...', 'info', 3000);
      return;
    }
    const verName = '更新 ' + (version || '');
    activeDownloadCount++;
    activeDownloadNames.push(verName);
    updateDownloading = true;
    addDownloadRecord(verName, downloadUrl, '', 'update');
    updateDownloadBadge();
    renderDownloadList();
    if (API && API.autoUpdate) API.autoUpdate(downloadUrl, version);
  }

  function parseVersion(ver) {
    const betaMatch = ver.match(/^(.+?)_beta_(\d+)$/);
    if (betaMatch) {
      return { base: betaMatch[1], beta: parseInt(betaMatch[2]), isBeta: true };
    }
    return { base: ver, beta: 0, isBeta: false };
  }

  function updateVersionDisplay() {
    var pv = parseVersion(appbetaVersion);
    if (pv.isBeta) {
      $('current-version').textContent = 'v' + appbetaVersion;
    } else {
      $('current-version').textContent = appVersion;
    }
  }

  function compareVersion(v1, v2) {
    const a = parseVersion(v1);
    const b = parseVersion(v2);
    const p1 = a.base.split('.').map(Number);
    const p2 = b.base.split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 !== n2) return n1 - n2;
    }
    if (a.isBeta !== b.isBeta) return a.isBeta ? 1 : -1;
    return a.beta - b.beta;
  }

  async function checkForUpdate(silent) {
    if (updateInstallerPath) {
      if (!silent) showToast('已下载更新包', '点击按钮立即更新', 'info', 0, false, { text: '重新加载以更新', callback: () => { if (updateInstallerPath && API && API.installUpdate) API.installUpdate(updateInstallerPath); } });
      return;
    }
    if (updateDownloading) {
      if (!silent) showToast('正在下载更新', '请稍后...', 'info', 3000);
      return;
    }
    if (checkingUpdate) {
      if (!silent) showToast('检查更新', '正在检测中，请稍候...', 'info');
      return;
    }
    checkingUpdate = true;
    if (!silent) showToast('检查更新', '正在检测更新...', 'info');
    try {
      const baseUrl = activeBackend || BACKENDS[0];
      var curParsed = parseVersion(appbetaVersion);
      var curVer = curParsed.isBeta ? appbetaVersion : appVersion.replace(/^v/, '');

      const fetchUrl = baseUrl + '/file/app/version.json';
      const { status, body } = await API.fetchUpdateInfo(fetchUrl);
      if (status !== 200) throw new Error('服务器响应异常 (' + status + ')');
      const data = JSON.parse(body);
      const stableVer = data && data.version;
      const stableDlUrl = data && data.download_url;

      var betaVer = null;
      var betaDlUrl = null;
      if (betaUpdateEnabled) {
        try {
          const betaUrl = baseUrl + '/file/app_beta/version.json';
          const betaResp = await API.fetchUpdateInfo(betaUrl);
          if (betaResp.status === 200) {
            var betaData = JSON.parse(betaResp.body);
            betaVer = betaData && betaData.version;
            betaDlUrl = betaData && betaData.download_url;
          }
        } catch (e) {}
      }

      var selectedVer = null;
      var selectedDlUrl = null;

      if (betaUpdateEnabled && betaVer) {
        var bpBase = parseVersion(betaVer).base;
        var spBase = stableVer ? parseVersion(stableVer).base : '0.0.0';
        if (compareVersion(bpBase, spBase) >= 0) {
          if (compareVersion(betaVer, curVer) > 0) {
            selectedVer = betaVer;
            selectedDlUrl = betaDlUrl;
          }
        }
        if (!selectedVer && stableVer && compareVersion(stableVer, curVer) > 0) {
          selectedVer = stableVer;
          selectedDlUrl = stableDlUrl;
        }
      } else {
        if (stableVer && compareVersion(stableVer, curVer) > 0) {
          selectedVer = stableVer;
          selectedDlUrl = stableDlUrl;
        }
      }

      if (selectedVer) {
        var dlUrl = selectedDlUrl.startsWith('http') ? selectedDlUrl : baseUrl.replace(/\/+$/, '') + '/' + selectedDlUrl.replace(/^\/+/, '');
        var isBeta = parseVersion(selectedVer).isBeta;
        if (isLanIP(baseUrl)) {
          updateCheckManual = !silent;
          startUpdateDownload(dlUrl, selectedVer);
        } else {
          var toastTitle = isBeta ? '有最新测试版更新' : '发现新版本';
          var toastMsg = isBeta ? '版本号:' + selectedVer + ' 是否下载测试版更新?' : selectedVer;
          if (!silent) showToast(toastTitle, toastMsg, 'info', 0, false, { text: '确定', callback: function() { startUpdateDownload(dlUrl, selectedVer); } });
        }
      } else {
        if (!silent) showToast('已是最新版本', '', 'success');
      }
    } catch (e) {
      if (!silent) {
        var msg = e.message === 'Timeout' ? '检测超时，请检查网络连接' : (e.message || '未知错误');
        showToast('检查更新失败', msg, 'error', 5000, true);
      }
    } finally {
      checkingUpdate = false;
    }
  }

  async function checkForBetaUpdate() {
    if (updateInstallerPath) {
      showToast('已下载更新包', '点击按钮立即更新', 'info', 0, false, { text: '重新加载以更新', callback: () => { if (updateInstallerPath && API && API.installUpdate) API.installUpdate(updateInstallerPath); } });
      return;
    }
    if (updateDownloading) { showToast('正在下载更新', '请稍后...', 'info', 3000); return; }
    if (checkingUpdate) { showToast('检查更新', '正在检测中，请稍候...', 'info'); return; }
    checkingUpdate = true;
    showToast('检查更新', '正在检测最新测试版...', 'info');
    try {
      var baseUrl = activeBackend || BACKENDS[0];
      var curParsed = parseVersion(appbetaVersion);
      var curVer = curParsed.isBeta ? appbetaVersion : appVersion.replace(/^v/, '');
      var betaUrl = baseUrl + '/file/app_beta/version.json';
      var betaResp = await API.fetchUpdateInfo(betaUrl);
      if (betaResp.status !== 200) throw new Error('服务器响应异常 (' + betaResp.status + ')');
      var betaData = JSON.parse(betaResp.body);
      var betaVer = betaData && betaData.version;
      var betaDlUrl = betaData && betaData.download_url;
      if (betaVer && compareVersion(betaVer, curVer) > 0 && betaDlUrl) {
        var dlUrl = betaDlUrl.startsWith('http') ? betaDlUrl : baseUrl.replace(/\/+$/, '') + '/' + betaDlUrl.replace(/^\/+/, '');
        if (isLanIP(baseUrl)) {
          startUpdateDownload(dlUrl, betaVer);
        } else {
          showToast('有最新测试版更新', '版本号:' + betaVer + ' 是否下载测试版更新?', 'info', 0, false, { text: '确定', callback: function() { startUpdateDownload(dlUrl, betaVer); } });
        }
      } else {
        showToast('已是最新测试版', '', 'success');
      }
    } catch (e) {
      var msg = e.message === 'Timeout' ? '检测超时，请检查网络连接' : (e.message || '未知错误');
      showToast('检查更新失败', msg, 'error', 5000, true);
    } finally {
      checkingUpdate = false;
    }
  }

  function toggleAutoStart() {
    autoStart = $('auto-start-toggle').checked;
    localStorage.setItem('autoStart', autoStart);
    if (API && API.setAutoStart) {
      API.setAutoStart(autoStart);
    }
    showToast(autoStart ? '已开启开机自启' : '已关闭开机自启', '', 'info');
  }

  // ========== Python 页面 ==========
  var pythonTabs = [];
  var pythonActiveTab = -1;
  var pythonReplReady = false;
  var pythonIsRunning = false;

  function pythonEnsureTab() {
    if (pythonTabs.length === 0) {
      pythonTabs.push({ name: '未命名.py', path: '', content: 'import tkinter as tk, random, time, math\nimport ctypes\nfrom ctypes import wintypes\n\n# 配置常量\nTEXTS = ["好好爱自己", "好好吃饭", "保持好心情", "别熬夜", "我想你了", "多喝水哦~", "顺顺利利", "爱自己", "好好哒",\n         "照顾好自己", "天天开心"]\nCOLORS = ["pink", "lightblue", "lightgreen", "lemonchiffon"]\nWIN_W, WIN_H = 150, 40\nHEART_PTS, SCALE = 100, 20\nSTAY = 0.5\nFULL_RATIO = 1.6\n\n# ========== 速度与效果控制 ==========\nHEART_BATCH = 2  # 每批弹出数量\nHEART_DELAY = 0.03  # 每批间隔休眠时间，数值越大爱心生成越慢\nFADE_STEPS = 8\nFADE_INTERVAL = 0.02\nFULL_BATCH = 18\n\n\n# ====================================\n\ndef heart_coords(sw, sh):\n    cx, cy = sw // 2, sh // 2 - 80\n    res = []\n    for i in range(HEART_PTS):\n        t = i / HEART_PTS * 2 * math.pi\n        x, y = 16 * math.sin(t) ** 3, 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)\n        px = max(0, min(int(cx + x * SCALE - WIN_W // 2), sw - WIN_W))\n        py = max(0, int(cy - y * SCALE - WIN_H // 2))\n        res.append((px, py))\n    return res\n\n\ndef create_win(root, x, y, text=None):\n    win = tk.Toplevel(root)\n    win.withdraw()\n    win.title("提示")\n    win.geometry(f"{WIN_W}x{WIN_H}+{x}+{y}")\n    tk.Label(win, text=text or random.choice(TEXTS), bg=random.choice(COLORS), font=("微软雅黑", 10), width=20,\n             height=2).pack(fill="both", expand=True)\n    win.update()\n    # 弹窗置顶但不抢夺焦点\n    try:\n        hwnd = ctypes.windll.user32.GetParent(win.winfo_id())\n        ex_style = ctypes.windll.user32.GetWindowLongW(hwnd, -20)\n        ctypes.windll.user32.SetWindowLongW(hwnd, -20, ex_style | 0x08000000 | 0x00000008)\n    except:\n        pass\n    win.deiconify()\n    return win\n\n\ndef fade_out(windows, root, steps, interval):\n    """整体同步渐隐消失"""\n    for step in range(steps, 0, -1):\n        alpha = step / steps\n        for w in windows:\n            try:\n                w.attributes("-alpha", alpha)\n            except:\n                pass\n        root.update()\n        time.sleep(interval)\n    for w in windows:\n        try:\n            w.destroy()\n        except:\n            pass\n\n\ndef main():\n    # 设置一秒延迟启动\n    time.sleep(1)\n    root = tk.Tk()\n    root.withdraw()\n    sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()\n    hearts, full_win = [], []\n\n    def quit_all(_=None):\n        for w in hearts + full_win:\n            try:\n                w.destroy()\n            except:\n                pass\n        root.quit();\n        root.destroy()\n\n    root.bind_all("<space>", quit_all)\n    root.bind_all("<Escape>", quit_all)\n\n    # 1. 生成心形弹窗（已加入休眠减速，节奏舒缓）\n    coords = heart_coords(sw, sh)\n    for i, (x, y) in enumerate(coords, 1):\n        hearts.append(create_win(root, x, y))\n        if i % HEART_BATCH == 0:\n            root.update()\n            time.sleep(HEART_DELAY)\n    root.update()\n    time.sleep(STAY)\n\n    # 2. 爱心快速渐隐消失\n    fade_out(hearts, root, FADE_STEPS, FADE_INTERVAL)\n    hearts.clear()\n    root.update()\n\n    # 3. 全屏随机铺满\n    total = int((sw // WIN_W) * (sh // WIN_H) * FULL_RATIO)\n    for i in range(total):\n        x, y = random.randint(0, sw - WIN_W), random.randint(0, sh - WIN_H)\n        full_win.append(create_win(root, x, y))\n        if i % FULL_BATCH == 0:\n            root.update()\n    root.update()\n\n    root.mainloop()\n\n\nif __name__ == "__main__":\n    main()', modified: false });
      pythonActiveTab = 0;
      pythonRenderTabs();
      var editor = $('python-editor');
      if (editor) editor.value = pythonTabs[0].content;
    }
  }

  function pythonUpdateActiveContent() {
    if (pythonActiveTab < 0 || pythonActiveTab >= pythonTabs.length) return;
    var editor = $('python-editor');
    if (editor) pythonTabs[pythonActiveTab].content = editor.value;
  }

  var _pythonSwitching = false;
  function pythonSwitchTab(index) {
    if (index < 0 || index >= pythonTabs.length) return;
    pythonUpdateActiveContent();
    pythonActiveTab = index;
    var tab = pythonTabs[index];
    var editor = $('python-editor');
    if (editor) { _pythonSwitching = true; editor.value = tab.content; _pythonSwitching = false; }
    pythonRenderTabs();
    pythonUpdateLineNumbers();
  }

  function pythonCloseTab(index) {
    if (pythonTabs.length <= 1) return;
    var tab = pythonTabs[index];
    if (tab.modified) {
      if (!confirm('文件 "' + tab.name + '" 有未保存的修改，确定关闭吗？')) return;
    }
    pythonUpdateActiveContent();
    pythonTabs.splice(index, 1);
    if (pythonActiveTab >= pythonTabs.length) pythonActiveTab = pythonTabs.length - 1;
    if (pythonActiveTab < 0) pythonActiveTab = 0;
    var editor = $('python-editor');
    if (editor) editor.value = pythonTabs[pythonActiveTab].content;
    pythonRenderTabs();
  }

  function pythonRenderTabs() {
    var tabbar = $('python-tabbar');
    if (!tabbar) return;
    var html = '';
    for (var i = 0; i < pythonTabs.length; i++) {
      var tab = pythonTabs[i];
      var cls = i === pythonActiveTab ? ' active' : '';
      var dot = tab.modified ? ' <span style="color:#f39c12;">●</span>' : '';
      html += '<div class="python-tab' + cls + '" data-idx="' + i + '" onclick="event.stopPropagation();">';
      html += '<span class="python-tab-name">' + escapeHtml(tab.name) + dot + '</span>';
      html += '<button class="python-tab-close" data-idx="' + i + '">&times;</button>';
      html += '</div>';
    }
    html += '<button class="python-tab-add" id="python-tab-add" title="新建文件">+</button>';
    tabbar.innerHTML = html;

    tabbar.querySelectorAll('.python-tab').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.classList.contains('python-tab-close')) return;
        pythonSwitchTab(parseInt(this.dataset.idx));
      });
    });
    tabbar.querySelectorAll('.python-tab-close').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        pythonCloseTab(parseInt(this.dataset.idx));
      });
    });
    var addBtn = $('python-tab-add');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        pythonUpdateActiveContent();
        pythonTabs.push({ name: '未命名.py', path: '', content: '', modified: false });
        pythonSwitchTab(pythonTabs.length - 1);
        var editor = $('python-editor');
        if (editor) editor.focus();
        pythonRenderTabs();
      });
    }
  }

  function initPythonPage() {
    pythonEnsureTab();
    var panel = $('python-editor-panel');
    var container = document.querySelector('.python-container');
    if (panel && container && !panel.style.height) {
      panel.style.height = Math.floor(container.offsetHeight * 0.55) + 'px';
    }
    if (!pythonReplReady) pythonStartRepl();
  }

  async function pythonOpenFile() {
    if (!API || !API.openPythonFile) {
      showToast('功能不可用', '请更新客户端', 'error');
      return;
    }
    try {
      var result = await API.openPythonFile();
      if (!result) return;
      if (result.error) { showToast('打开失败', result.error, 'error'); return; }
      pythonUpdateActiveContent();
      pythonTabs.push({ name: result.name, path: result.path, content: result.content, modified: false });
      pythonSwitchTab(pythonTabs.length - 1);
      showToast('已打开', result.name, 'success');
    } catch (e) { showToast('打开失败', String(e), 'error'); }
  }

  async function pythonSaveFile() {
    if (pythonActiveTab < 0) return;
    pythonUpdateActiveContent();
    var tab = pythonTabs[pythonActiveTab];
    if (tab.path) {
      if (!API || !API.savePythonFileDirect) {
        showToast('功能不可用', '请更新客户端', 'error');
        return;
      }
      try {
        var result = await API.savePythonFileDirect(tab.content, tab.path);
        if (result && !result.error) {
          tab.modified = false;
          pythonRenderTabs();
          showToast('已保存', tab.name, 'success');
        } else if (result && result.error) {
          showToast('保存失败', result.error, 'error');
        }
      } catch (e) { showToast('保存失败', String(e), 'error'); }
    } else {
      await pythonSaveFileAs();
    }
  }

  async function pythonSaveFileAs() {
    if (pythonActiveTab < 0) return;
    pythonUpdateActiveContent();
    var tab = pythonTabs[pythonActiveTab];
    if (!API || !API.savePythonFile) {
      showToast('功能不可用', '请更新客户端', 'error');
      return;
    }
    try {
      var result = await API.savePythonFile(tab.content, tab.path);
      if (!result) return;
      if (result.error) { showToast('保存失败', result.error, 'error'); return; }
      tab.path = result.path;
      tab.name = result.name;
      tab.modified = false;
      pythonRenderTabs();
      showToast('已保存', tab.name, 'success');
    } catch (e) { showToast('保存失败', String(e), 'error'); }
  }

  function setPythonRunningState(running) {
    pythonIsRunning = running;
    var runBtn = $('python-run-btn');
    var rerunBtn = $('python-rerun-btn');
    if (runBtn) {
      if (running) {
        runBtn.className = 'btn btn-danger btn-sm';
        runBtn.innerHTML = '<i class="fa-solid fa-stop"></i> 停止';
        runBtn.title = '停止运行';
      } else {
        runBtn.className = 'btn btn-primary btn-sm';
        runBtn.innerHTML = '<i class="fa-solid fa-play"></i> 运行';
        runBtn.title = '运行代码';
      }
    }
    if (rerunBtn) rerunBtn.style.display = running ? '' : 'none';
  }

  async function stopPythonCode() {
    try {
      if (API && API.pythonReplStop) await API.pythonReplStop();
    } catch (e) {
      // 忽略停止时的错误
    }
    setPythonRunningState(false);
    pythonTermWrite('\n[已停止]\n>>> ');
  }

  async function rerunPythonCode() {
    pythonTermWrite('[重新运行...]\n');
    await stopPythonCode();
    setPythonRunningState(true);
    pythonTermWrite('');
    await _runPythonCodeInternal();
  }

  async function runPythonCode() {
    if (pythonIsRunning) {
      await stopPythonCode();
      return;
    }
    setPythonRunningState(true);
    await _runPythonCodeInternal();
  }

  async function _runPythonCodeInternal() {
    if (pythonActiveTab < 0) { setPythonRunningState(false); return; }
    pythonUpdateActiveContent();
    var tab = pythonTabs[pythonActiveTab];
    var code = tab.content.trim();
    if (!code) { setPythonRunningState(false); showToast('提示', '请先输入 Python 代码', 'info'); return; }
    pythonTermWrite('[运行: ' + tab.name + ']\n');
    try {
      var result = await API.runPython(code);
      if (result.error) {
        pythonTermWrite(result.error + '\n');
      } else {
        if (result.stdout) pythonTermWrite(result.stdout + '\n');
        if (result.stderr) pythonTermWrite(result.stderr + '\n');
        if (result.exitCode !== 0) pythonTermWrite('进程退出码: ' + result.exitCode + '\n');
      }
    } catch (e) {
      pythonTermWrite('[错误] ' + String(e) + '\n');
    }
    setPythonRunningState(false);
    pythonTermWrite('>>> ');
  }

  var pythonTermHistory = [];
  var pythonTermHistoryIdx = -1;
  var pythonTermSavedInput = '';
  var pythonTermPromptPos = 0;

  function pythonTermWrite(text) {
    var ta = $('python-terminal-textarea');
    if (!ta) return;
    var selStart = ta.selectionStart;
    var selEnd = ta.selectionEnd;
    var before = ta.value.substring(0, pythonTermPromptPos);
    var after = ta.value.substring(pythonTermPromptPos);
    ta.value = before + text + after;
    pythonTermPromptPos += text.length;
    if (selStart !== selEnd && selEnd <= pythonTermPromptPos) {
      try { ta.setSelectionRange(selStart, selEnd); } catch(e) {}
    }
    ta.scrollTop = ta.scrollHeight;
  }

  function pythonTermWriteLine(text) {
    pythonTermWrite(text + '\n');
  }

  function pythonTermNewPrompt() {
    pythonTermWrite('>>> ');
  }

  var pythonTermBusy = false;

  function pythonTermSubmit() {
    var ta = $('python-terminal-textarea');
    if (!ta || !API || !API.pythonReplInput) return;
    if (pythonTermBusy) return;
    if (!pythonReplReady) {
      pythonTermWrite('\n[REPL 未就绪，正在重启...]\n');
      pythonStartRepl();
      pythonTermWrite('>>> ');
      return;
    }
    var content = ta.value;
    var after = content.substring(pythonTermPromptPos);
    var input = after.trim();
    if (!input) {
      pythonTermWrite('\n');
      pythonTermWrite('>>> ');
      return;
    }
    pythonTermHistory.push(input);
    if (pythonTermHistory.length > 100) pythonTermHistory.shift();
    pythonTermHistoryIdx = pythonTermHistory.length;
    pythonTermSavedInput = '';

    ta.value = ta.value.substring(0, pythonTermPromptPos) + input + '\n';
    pythonTermPromptPos = ta.value.length;
    pythonTermBusy = true;
    API.pythonReplInput(input).then(function(result) {
      pythonTermBusy = false;
      if (result && result.output) pythonTermWrite(result.output + '\n');
      if (result && result.error) pythonTermWrite(result.error + '\n');
      pythonTermWrite('>>> ');
    }).catch(function(e) {
      pythonTermBusy = false;
      pythonTermWrite(String(e) + '\n');
      pythonTermWrite('>>> ');
    });
  }

  function pythonTermGetCurrentInput() {
    var ta = $('python-terminal-textarea');
    if (!ta) return '';
    return ta.value.substring(pythonTermPromptPos);
  }

  async function pythonTermInterrupt() {
    pythonTermBusy = false;
    pythonTermWrite('^C\n');
    if (API && API.pythonReplInterrupt) {
      await API.pythonReplInterrupt();
    }
    pythonReplReady = false;
    pythonTermWrite('KeyboardInterrupt\n');
    pythonStartRepl();
  }

  function pythonTermSetCurrentInput(text) {
    var ta = $('python-terminal-textarea');
    if (!ta) return;
    ta.value = ta.value.substring(0, pythonTermPromptPos) + text;
    ta.scrollTop = ta.scrollHeight;
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  async function pythonStartRepl() {
    if (!API || !API.pythonReplStart) return;
    var ta = $('python-terminal-textarea');
    try {
      var result = await API.pythonReplStart();
      if (result && result.error) {
        pythonReplReady = false;
        if (ta) { ta.value = result.error + '\n'; pythonTermPromptPos = ta.value.length; }
      } else {
        pythonReplReady = true;
        if (ta) {
          ta.value = '';
          pythonTermPromptPos = 0;
          pythonTermWrite('Python 3.x 交互式命令行\n');
          pythonTermWrite('>>> ');
        }
      }
    } catch (e) {
      pythonReplReady = false;
      if (ta) { ta.value = '启动失败: ' + String(e) + '\n'; pythonTermPromptPos = ta.value.length; }
    }
  }

  async function init() {
    if (localStorage.getItem('skipAnim') === 'true') {
      document.body.classList.add('no-anim');
    }
    // 抢先注册 IPC 监听器，防止 did-finish-load 在 await 期间触发而丢失
    if (API && API.onLoadSavedBackground) {
      API.onLoadSavedBackground((bgInfo) => {
        if (bgInfo && bgInfo.url && bgInfo.type) {
          bgType = bgInfo.type;
          bgPath = bgInfo.url;
          localStorage.setItem('bgType', bgType);
          localStorage.setItem('bgPath', bgPath);
          applyBackground();
        }
      });
    }
    if (API && API.onOpenNewTab) {
    }
    if (API && API.onProtocolUrl) {
      API.onProtocolUrl(function(url) {
        console.log('[App] Protocol URL received:', url);
        if (/^anghaoyu16:\/\/dance\/?/i.test(url)) {
          if (API && API.startWindowDance) {
            API.startWindowDance().then(function() {
              showToast('彩蛋触发', '按下"Q"停止播放', 'info', 5000);
              function stopDance(e) {
                if (e.key === 'q' || e.key === 'Q') {
                  if (API && API.stopWindowDance) API.stopWindowDance();
                  document.removeEventListener('keydown', stopDance);
                  showToast('已停止播放', '', 'info', 5000);
                }
              }
              document.addEventListener('keydown', stopDance);
            });
          }
          return;
        }
        if (/^anghaoyu16:\/\/windows\/?/i.test(url)) {
          if (API && API.startWindowBounce) {
            API.startWindowBounce().then(function() {
              showToast('彩蛋触发', '按下"Q"停止', 'info', 5000);
              function stopBounce(e) {
                if (e.key === 'q' || e.key === 'Q') {
                  if (API && API.stopWindowBounce) API.stopWindowBounce();
                  document.removeEventListener('keydown', stopBounce);
                  showToast('动画已停止', '', 'info', 5000);
                }
              }
              document.addEventListener('keydown', stopBounce);
            });
          }
          return;
        }
        showToast('协议唤醒', '收到协议链接: ' + url, 'info', 5000);
      });
    }
    if (API && API.onBounceStoppedByKey) {
      API.onBounceStoppedByKey(function() {
        showToast('动画已停止', '', 'info', 5000);
      });
    }
    // 外部链接启动：跳过主页和启动动画，直接进入浏览器
    var _pendingExternalUrl = null;
    if (window.electronAPI && window.electronAPI.getPendingExternalUrl) {
      _pendingExternalUrl = await window.electronAPI.getPendingExternalUrl();
    }
    if (_pendingExternalUrl) {
      console.log('[Init] 外部链接启动, 跳过主页, URL:', _pendingExternalUrl);
      // 隐藏启动画面
      var splashEl2 = document.getElementById('splash-screen');
      if (splashEl2) { splashEl2.style.display = 'none'; splashEl2.classList.add('fade-out'); }
      document.body.classList.remove('splash-active');
      if (API && API.setEscHideEnabled) API.setEscHideEnabled(true);
      // 直接创建标签页 → newTab 内部调用 switchPage('browser')，同时更新页面和侧边栏
      newTab(_pendingExternalUrl);
    }
    _networkDeferred = !!_pendingExternalUrl;
    // 启动动画
    var splashEl = $('splash-screen');
    var splashRingFg = $('splash-ring-fg');
    var splashProgress = 0;
    var splashDone = false;
    var splashStartTime = performance.now();
    var splashMinDuration = 300;
    var splashVideoMode = false;
    if (splashEl && document.body.classList.contains('dark')) splashEl.style.setProperty('--splash-bg', '#1a1a2e');
    console.log('[Splash] init, el:', !!splashEl, 'ring:', !!splashRingFg, 'dark:', document.body.classList.contains('dark'), 'splashType:', splashType);
    if (API && API.setEscHideEnabled) API.setEscHideEnabled(false);
    var customSrc = null;
    var customType = null;
    if (splashType === 'bg') {
      if ((bgType === 'video' || bgType === 'image') && bgPath) {
        customSrc = bgPath;
        customType = bgType;
        splashMinDuration = 1000;
      }
    } else if (splashType !== 'default' && splashPath) {
      customSrc = splashPath;
      customType = splashType;
      if (splashType === 'video') splashVideoMode = true;
    }
    if (customSrc && customType) {
      var isBgMode = (splashType === 'bg');
      if (customType === 'video') {
        var splashVideo = $('splash-video');
        if (!isBgMode) {
          if (splashRingFg) splashRingFg.style.display = 'none';
          var splashLogoEl = splashEl.querySelector('.splash-logo');
          if (splashLogoEl) splashLogoEl.style.display = 'none';
        }
        if (splashVideo) {
          splashVideo.volume = splashVolume / 100;
          splashVideo.src = customSrc;
          splashVideo.style.display = 'block';
          splashVideo.onloadeddata = function() {
            var dur = splashVideo.duration;
            if (dur > 15) { splashVideo.currentTime = 0; console.log('[Splash] 视频超15秒, 从头播放'); }
            splashVideo.play().catch(function() {});
          };
          splashVideo.onended = function() {
            if (!splashDone) { finishSplash(); }
          };
          $('splash-skip-btn').style.display = '';
        }
      } else if (customType === 'image') {
        var splashImg = $('splash-image');
        if (!isBgMode) {
          if (splashRingFg) splashRingFg.style.display = 'none';
          var splashLogoEl2 = splashEl.querySelector('.splash-logo');
          if (splashLogoEl2) splashLogoEl2.style.display = 'none';
        }
        if (splashImg) {
          splashImg.src = customSrc;
          splashImg.style.display = 'block';
        }
      }
    }
    function hideSplash() {
      var splashVideo = $('splash-video');
      var splashImg = $('splash-image');
      if (splashVideo) { splashVideo.pause(); splashVideo.removeAttribute('src'); splashVideo.load(); splashVideo.style.display = 'none'; }
      if (splashImg) { splashImg.removeAttribute('src'); splashImg.style.display = 'none'; }
      splashDone = true;
      var splashEl = $('splash-screen');
      if (splashEl) splashEl.classList.add('fade-out');
      document.body.classList.remove('splash-active');
      if (API && API.setEscHideEnabled) API.setEscHideEnabled(true);
      setTimeout(function() {
        if (splashEl) splashEl.style.display = 'none';
      }, 150);
    }
    function updateRing(pct) {
      if (!splashRingFg) return;
      var total = Math.round(2 * Math.PI * 88);
      splashRingFg.setAttribute('stroke-dasharray', total);
      splashRingFg.setAttribute('stroke-dashoffset', Math.round(total * (1 - Math.min(pct, 100) / 100)));
    }
    var firstPhaseDone = false;
    updateRing(0);
    console.log('[Splash] 动画开始, updateRing(0) 已调用');
    var animTick = 0;
    var animRunning = true;
    var splashFinishing = false;
    var splashTargetProgress = 0;
    var splashOnDone = null;
    var lastPhaseTwoTick = 0;
    var phaseTwoStartTime = 0;
    // 5秒超时兜底：被"无法连接服务器"阻塞时自动渐隐（视频模式16秒）
    var splashTimeoutDuration = splashVideoMode ? 16000 : 1250;
    var splashTimeout = setTimeout(function() {
      if (splashDone) return;
      console.log('[Splash] 超时，自动渐隐');
      splashTargetProgress = 100;
      splashFinishing = true;
      splashOnDone = function() { hideSplash(); };
    }, splashTimeoutDuration);
    function animFrame() {
      if (!animRunning) return;
      if (splashDone) { animRunning = false; return; }
      animTick++;
      if (splashFinishing) {
        var diff = splashTargetProgress - splashProgress;
        if (diff < 0.3) {
          splashProgress = splashTargetProgress;
          updateRing(splashProgress);
          if (splashTargetProgress >= 100) {
            splashDone = true;
            animRunning = false;
            console.log('[Splash] 进度100%, 渐隐');
            if (splashOnDone) splashOnDone();
          } else {
            splashFinishing = false;
          }
          return;
        }
        splashProgress += diff * 0.2;
        if (animTick === 1 || animTick % 15 === 0) console.log('[Splash] finish anim tick', animTick, 'progress:', Math.round(splashProgress));
        updateRing(splashProgress);
        requestAnimationFrame(animFrame);
        return;
      }
      var elapsed = performance.now() - splashStartTime;
      if (elapsed <= 125) {
        splashProgress = (elapsed / 125) * 50;
      } else if (!firstPhaseDone) {
        firstPhaseDone = true;
        splashProgress = 50;
        phaseTwoStartTime = performance.now();
      } else {
        // 50%后每0.125秒平滑增加5%
        var phaseTwoElapsed = performance.now() - phaseTwoStartTime;
        var fullSteps = Math.floor(phaseTwoElapsed / 125);
        var stepFraction = (phaseTwoElapsed % 125) / 125;
        splashProgress = Math.min(50 + fullSteps * 5 + stepFraction * 5, 95);
      }
      if (animTick === 1 || animTick % 60 === 0) console.log('[Splash] tick', animTick, 'progress:', Math.round(splashProgress));
      updateRing(splashProgress);
      requestAnimationFrame(animFrame);
    }
    requestAnimationFrame(animFrame);
    function finishSplash() {
      clearTimeout(splashTimeout);
      console.log('[Splash] finishSplash 调用, elapsed:', Math.round(performance.now() - splashStartTime), 'ms, current=', Math.round(splashProgress));
      var elapsed = performance.now() - splashStartTime;
      var minRemaining = Math.max(0, splashMinDuration - elapsed);
      splashTargetProgress = 100;
      splashFinishing = true;
      splashOnDone = function() {
        hideSplash();
      };
      if (minRemaining > 50) {
        console.log('[Splash] 还需等待', minRemaining, 'ms才满最小展示时长');
        var origOnDone = splashOnDone;
        splashOnDone = function() { setTimeout(origOnDone, minRemaining); };
      }
    }

    // 标题栏按钮提前注册，确保启动时即可点击
    if (API) {
      function skipSplashNow() {
        if (splashDone) return;
        splashDone = true;
        animRunning = false;
        clearTimeout(splashTimeout);
        updateRing(100);
        hideSplash();
      }
      $('btn-minimize').addEventListener('click', () => { skipSplashNow(); API.minimize(); });
      $('btn-maximize').addEventListener('click', () => API.maximize());
      $('btn-close').addEventListener('click', () => { skipSplashNow(); API.close(); });
      API.onWindowHiding(() => skipSplashNow());
      $('splash-skip-btn').addEventListener('click', () => skipSplashNow());
      document.addEventListener('keydown', function splashEscHandler(e) {
        if (e.key === 'Escape' && !splashDone) { skipSplashNow(); }
      });

      let isPinned = false;
      const pinBtn = $('btn-pin');
      pinBtn.addEventListener('click', () => {
        isPinned = !isPinned;
        if (isPinned) {
          pinBtn.style.background = 'var(--hover-bg)';
          pinBtn.style.color = 'var(--theme)';
          pinBtn.title = '取消固定';
          showToast('窗口置顶已开启', '', 'info', 3000);
        } else {
          pinBtn.style.background = '';
          pinBtn.style.color = '';
          pinBtn.title = '固定到最顶端';
          showToast('窗口置顶已关闭', '', 'info', 3000);
        }
        API.setAlwaysOnTop(isPinned);
      });

      if (API.onPinStateChanged) {
        API.onPinStateChanged((pinned) => {
          isPinned = !!pinned;
          if (isPinned) {
            pinBtn.style.background = 'var(--hover-bg)';
            pinBtn.style.color = 'var(--theme)';
            pinBtn.title = '取消固定';
            showToast('窗口置顶已开启', '', 'info', 3000);
          } else {
            pinBtn.style.background = '';
            pinBtn.style.color = '';
            pinBtn.title = '固定到最顶端';
            showToast('窗口置顶已关闭', '', 'info', 3000);
          }
        });
      }

      if (API.onBlockedProtocol) {
        API.onBlockedProtocol((url, protocol) => {
          showToast('链接已拦截', protocol + ':// 协议无法打开', 'warning', 4000);
        });
      }
    }

    // 侧边栏按钮提前注册，确保启动时即可点击
    qsa('.sidebar-btn').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    // 主动拉取背景信息作为兜底，防止 did-finish-load 事件竞态丢失
    if (API && API.getBackgroundInfo) {
      API.getBackgroundInfo().then(bgInfo => {
        if (bgInfo && bgInfo.url && bgInfo.type && !bgPath) {
          bgType = bgInfo.type;
          bgPath = bgInfo.url;
          localStorage.setItem('bgType', bgType);
          localStorage.setItem('bgPath', bgPath);
          applyBackground();
        }
      }).catch(() => {});
    }

    if (API && API.getFontInfo) {
      API.getFontInfo().then(fontInfo => {
        if (fontInfo && fontInfo.filePath && !customFontPath) {
          customFontPath = fontInfo.url || fontInfo.filePath;
          customFontFamily = fontInfo.family || '';
          localStorage.setItem('customFontPath', customFontPath);
          localStorage.setItem('customFontFamily', customFontFamily);
          applyFont();
        }
      }).catch(() => {});
    }
    applyFont();

    if (API && API.onDownloadComplete) {
      API.onDownloadComplete((filePath) => {
        showToast('下载完成', '文件已保存到: ' + filePath, 'success', 5000);
      });
    }
    if (API && API.onDownloadError) {
      API.onDownloadError((errMsg) => {
        showToast('下载失败', errMsg, 'error', 5000, true);
      });
    }
    if (API && API.onDownloadCanceled) {
      API.onDownloadCanceled((fileName) => {
        activeDownloadCount--;
        activeDownloadNames = activeDownloadNames.filter(n => n !== fileName);
        delete downloadProgress[fileName];
        updateDownloadBadge();
        renderDownloadList();
      });
    }
    if (API && API.onUpdateProgress) {
      API.onUpdateProgress((percent) => {
        const name = activeDownloadNames.find(n => n.startsWith('更新 '));
        if (name) { downloadProgress[name] = percent; renderDownloadList(); }
      });
    }
    if (API && API.onFileDownloadProgress) {
      API.onFileDownloadProgress((percent, fileName) => {
        downloadProgress[fileName] = percent;
        if (currentPage !== 'downloads' && percent <= 1) switchPage('downloads');
        renderDownloadList();
      });
    }
    if (API && API.onUpdateDownloaded) {
      API.onUpdateDownloaded((installerPath) => {
        updateInstallerPath = installerPath;
        updateDownloading = false;
        activeDownloadCount--;
        activeDownloadNames = activeDownloadNames.filter(n => !n.startsWith('更新 '));
        updateDownloadBadge();
        renderDownloadList();
        $('update-reload-btn').style.display = 'flex';
        if (updateCheckManual) {
          updateCheckManual = false;
          showToast('新版本已就绪', '重新加载完成更新', 'success', 0, false, { text: '立即更新', callback: () => { if (updateInstallerPath && API && API.installUpdate) API.installUpdate(updateInstallerPath); } });
        }
      });
    }
    if (API && API.onUpdateDownloadError) {
      API.onUpdateDownloadError((errMsg) => {
        updateDownloading = false;
        activeDownloadCount--;
        activeDownloadNames = activeDownloadNames.filter(n => !n.startsWith('更新 '));
        updateDownloadBadge();
        renderDownloadList();
        showToast('更新下载失败', errMsg, 'error', 5000, true);
      });
    }

    ensureDownloadCancelHandler();

    if (!_networkDeferred) {
      $('network-overlay').classList.remove('hidden');
      $('network-overlay').classList.add('show');
      updateNetworkSelector();
      startNetworkMonitor();
      startResourcePolling();
    }

    $('dark-mode-toggle').addEventListener('change', () => {
      darkMode = $('dark-mode-toggle').checked;
      localStorage.setItem('darkMode', darkMode);
      applyTheme();
      renderAppearancePage();
      if (API && API.setDarkMode) API.setDarkMode(darkMode);
    });

    if (API && API.onDarkModeChanged) {
      API.onDarkModeChanged(function(v) {
        if (darkMode !== v) {
          darkMode = v;
          localStorage.setItem('darkMode', v);
          applyTheme();
          renderAppearancePage();
          var dt = $('dark-mode-toggle');
          if (dt) dt.checked = v;
        }
      });
      if (API.setDarkMode) API.setDarkMode(darkMode);
    }

    applyTheme();
    applyFont();
    applyBackground();
    applySidebarVisibility();
    var logCopyBtn = $('log-copy-btn');
    var logClearBtn = $('log-clear-btn');
    if (logCopyBtn) {
      logCopyBtn.addEventListener('click', function() {
        var logEl = $('log-output');
        if (logEl) {
          var text = logEl.innerText;
          navigator.clipboard.writeText(text).then(function() {
            showToast('已复制', '日志已复制到剪贴板', 'success', 2000);
          }).catch(function() {
            showToast('复制失败', '', 'error', 2000);
          });
        }
      });
    }
    if (logClearBtn) {
      logClearBtn.addEventListener('click', function() {
        var logEl = $('log-output');
        if (logEl) logEl.innerHTML = '<div class="log-line" style="color:var(--text-secondary);">日志已清空</div>';
      });
    }
    var cmdInput = $('log-cmd-input');
    var cmdBtn = $('log-cmd-btn');
    if (cmdInput && cmdBtn) {
      function execCmd() {
        var code = cmdInput.value.trim();
        if (!code) return;
        var logEl = $('log-output');
        var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        var cmdLine = '<div class="log-line"><span class="log-time">' + time + '</span> <span class="log-level" style="color:#3b82f6;">[CMD]</span> &gt; ' + escapeHtml(code) + '</div>';
        if (logEl) logEl.innerHTML += cmdLine;
        try {
          var result = eval(code);
          var resultStr = '';
          if (result === undefined) {
            resultStr = 'undefined';
          } else if (typeof result === 'object') {
            try { resultStr = JSON.stringify(result, null, 2); } catch(e) { resultStr = String(result); }
          } else {
            resultStr = String(result);
          }
          var resultLine = '<div class="log-line"><span class="log-time">' + time + '</span> <span class="log-level" style="color:#10b981;">[RES]</span> ' + escapeHtml(resultStr) + '</div>';
          if (logEl) { logEl.innerHTML += resultLine; logEl.scrollTop = logEl.scrollHeight; }
        } catch (e) {
          var errLine = '<div class="log-line"><span class="log-time">' + time + '</span> <span class="log-level" style="color:#e74c3c;">[ERR]</span> ' + escapeHtml(String(e)) + '</div>';
          if (logEl) { logEl.innerHTML += errLine; logEl.scrollTop = logEl.scrollHeight; }
        }
        cmdInput.value = '';
      }
      cmdBtn.addEventListener('click', execCmd);
      cmdInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); execCmd(); }
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          var s = this.selectionStart, v = this.value;
          this.value = v.substring(0, s) + '\n' + v.substring(this.selectionEnd);
          this.selectionStart = this.selectionEnd = s + 1;
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        }
      });
      cmdInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
      });
    }

    var cachedUser = localStorage.getItem('cachedUserInfo');
    if (cachedUser && token) {
      try {
        var cu = JSON.parse(cachedUser);
        userInfo = cu;
        nickname = cu.nickname || cu.username || localStorage.getItem('nickname') || '';
        avatar = cu._cachedAvatar || cu.avatar || localStorage.getItem('avatar') || '';
        if (API && API.setDeveloper) API.setDeveloper(!!cu.is_developer);
        if (cu.is_developer) {
          var logBtnEarly = document.querySelector('.sidebar-btn[data-page="log"]');
          if (logBtnEarly) logBtnEarly.style.display = '';
          var devTabEarly = document.getElementById('developer-tab');
          if (devTabEarly) devTabEarly.style.display = '';
        }
        updateAvatarUI();
        console.log('[App] 初始化时从本地缓存恢复用户信息');
      } catch (e) {}
    }

    $('avatar-btn').addEventListener('click', toggleAvatarPopup);
    $('popup-profile').addEventListener('click', showProfileModal);
    $('popup-logout').addEventListener('click', logout);
    document.addEventListener('click', (e) => {
      if (!$('avatar-popup').contains(e.target) && e.target !== $('avatar-btn')) {
        closeAvatarPopup();
      }
    });

    initBackend().then(function() {
      if (!_networkDeferred && !activeBackend) {
        $('network-overlay')._shouldShow = true;
        $('network-overlay').classList.remove('hidden');
        $('network-overlay').classList.add('show');
      }
      refreshBackendList();
    });
    if (!splashVideoMode) finishSplash();

    // Python 页面按钮
    var pythonOpenBtn = $('python-open-btn');
    var pythonSaveBtn = $('python-save-btn');
    var pythonSaveAsBtn = $('python-saveas-btn');
    var pythonRunBtn = $('python-run-btn');
    var pythonClearBtn = $('python-clear-btn');
    if (pythonOpenBtn) pythonOpenBtn.addEventListener('click', pythonOpenFile);
    if (pythonSaveBtn) pythonSaveBtn.addEventListener('click', pythonSaveFile);
    if (pythonSaveAsBtn) pythonSaveAsBtn.addEventListener('click', pythonSaveFileAs);
    if (pythonRunBtn) pythonRunBtn.addEventListener('click', runPythonCode);
    var pythonRerunBtn = $('python-rerun-btn');
    if (pythonRerunBtn) pythonRerunBtn.addEventListener('click', rerunPythonCode);
    if (pythonClearBtn) pythonClearBtn.addEventListener('click', function() {
      var ta = $('python-terminal-textarea');
      if (ta) { ta.value = ''; pythonTermPromptPos = 0; pythonTermWrite('>>> '); }
    });
    var pythonStopBtn = $('python-stop-btn');
    if (pythonStopBtn) pythonStopBtn.addEventListener('click', async function() {
      if (API && API.pythonReplStop) await API.pythonReplStop();
      pythonReplReady = false;
      pythonTermWriteLine('[已停止 — 正在重启...]');
      setPythonRunningState(false);
      setTimeout(function() { pythonStartRepl(); }, 300);
    });

    // 编辑器内容变更时标记为已修改
    var pythonEditor = $('python-editor');
    var pythonLineNums = $('python-line-numbers');
    if (pythonEditor) {
      pythonEditor.addEventListener('input', function() {
        if (_pythonSwitching) return;
        if (pythonActiveTab >= 0 && pythonActiveTab < pythonTabs.length) {
          pythonTabs[pythonActiveTab].modified = true;
          pythonRenderTabs();
        }
        pythonUpdateLineNumbers();
      });
      pythonEditor.addEventListener('scroll', function() {
        if (pythonLineNums) pythonLineNums.scrollTop = pythonEditor.scrollTop;
      });
      // 键盘快捷键
      pythonEditor.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 's') {
          e.preventDefault();
          pythonSaveFile();
        } else if (e.ctrlKey && e.key === 'z') {
          e.preventDefault();
          document.execCommand('undo');
        } else if (e.ctrlKey && e.key === 'y') {
          e.preventDefault();
          document.execCommand('redo');
        }
      });
      pythonUpdateLineNumbers();
    }

    function pythonUpdateLineNumbers() {
      if (!pythonEditor || !pythonLineNums) return;
      var lines = pythonEditor.value.split('\n');
      var html = '';
      for (var i = 1; i <= lines.length; i++) {
        html += i + '\n';
      }
      pythonLineNums.textContent = html;
    }

    // 终端 textarea 交互
    var pythonTermTa = $('python-terminal-textarea');
    if (pythonTermTa) {
      pythonTermTa.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'c') {
          e.preventDefault();
          pythonTermInterrupt();
          return;
        }
        if (e.ctrlKey && e.key === 'd') {
          e.preventDefault();
          var curInput = pythonTermGetCurrentInput();
          if (curInput === '') {
            pythonTermInterrupt();
          } else {
            pythonTermSetCurrentInput('');
          }
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          pythonTermSubmit();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (pythonTermHistory.length > 0) {
            if (pythonTermHistoryIdx === pythonTermHistory.length) {
              pythonTermSavedInput = pythonTermGetCurrentInput();
            }
            if (pythonTermHistoryIdx > 0) {
              pythonTermHistoryIdx--;
              pythonTermSetCurrentInput(pythonTermHistory[pythonTermHistoryIdx]);
            }
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (pythonTermHistoryIdx >= 0 && pythonTermHistoryIdx < pythonTermHistory.length - 1) {
            pythonTermHistoryIdx++;
            pythonTermSetCurrentInput(pythonTermHistory[pythonTermHistoryIdx]);
          } else if (pythonTermHistoryIdx === pythonTermHistory.length - 1 && pythonTermHistory.length > 0) {
            pythonTermHistoryIdx = pythonTermHistory.length;
            pythonTermSetCurrentInput(pythonTermSavedInput || '');
            pythonTermSavedInput = '';
          }
        } else if (e.key === 'ArrowLeft') {
          if (this.selectionStart === pythonTermPromptPos && this.selectionEnd === pythonTermPromptPos) {
            e.preventDefault();
          }
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          if (this.selectionStart <= pythonTermPromptPos && this.selectionEnd <= pythonTermPromptPos) {
            e.preventDefault();
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          this.selectionStart = this.selectionEnd = pythonTermPromptPos;
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (this.selectionStart < pythonTermPromptPos) {
            this.selectionStart = this.selectionEnd = this.value.length;
          }
        }
      });
      pythonTermTa.addEventListener('click', function() {
        if (this.selectionStart === this.selectionEnd && this.selectionStart < pythonTermPromptPos) {
          this.selectionStart = this.selectionEnd = this.value.length;
        }
      });
    }

    // Python 分割条拖拽
    var resizeHandle = $('python-resize-handle');
    if (resizeHandle) {
      var startY, startHeight, editorPanel;
      resizeHandle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        startY = e.clientY;
        editorPanel = $('python-editor-panel');
        if (!editorPanel) return;
        startHeight = editorPanel.offsetHeight;
        resizeHandle.classList.add('active');
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeUp);
      });
      function onResizeMove(e) {
        var diff = e.clientY - startY;
        var newHeight = startHeight + diff;
        var container = document.querySelector('.python-container');
        if (!container || !editorPanel) return;
        var maxH = container.offsetHeight - 100;
        if (newHeight < 80) newHeight = 80;
        if (newHeight > maxH) newHeight = maxH;
        editorPanel.style.height = newHeight + 'px';
      }
      function onResizeUp() {
        resizeHandle.classList.remove('active');
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeUp);
      }
    }

    $('titlebar-text').textContent = appTitle;
    document.title = appTitle;

    // 启动时自动检测更新（仅局域网或127.0.0.1，静默模式）
    if (activeBackend && isLanIP(activeBackend)) {
      setTimeout(() => checkForUpdate(true), 2000);
    }

    if (API && API.getAppVersion) {
      API.getAppVersion().then(v => {
        if (v) { appVersion = v; updateVersionDisplay(); }
      }).catch(() => {});
    } else {
      updateVersionDisplay();
    }

    $('auto-start-toggle').checked = autoStart;

    $('btn-back').addEventListener('click', () => {
      if (currentPage === 'xxt') {
        const wv = getXxtWebview();
        if (wv && wv.canGoBack()) wv.goBack();
      } else {
        goBack();
      }
    });
    $('btn-forward').addEventListener('click', () => {
      if (currentPage === 'xxt') {
        const wv = getXxtWebview();
        if (wv && wv.canGoForward()) wv.goForward();
      } else {
        goForward();
      }
    });

    $('weather-btn').addEventListener('click', () => {
      weatherCache = null;
      loadWeather();
      showToast('天气', '正在刷新天气数据...', 'info', 2000);
    });

    $('refresh-btn').addEventListener('click', async () => {
      if (currentPage === 'xxt') {
        const wv = getXxtWebview();
        if (wv) wv.reload();
        return;
      }
      if (currentPage === 'announcements') {
        setGlobalProgress(true);
        try {
          await loadAnnouncements();
          showToast('刷新', '公告已刷新', 'success', 2000);
        } catch (e) {
          showToast('刷新失败', e.message, 'error', 5000, true);
        } finally {
          setGlobalProgress(false);
        }
        return;
      }
      if (token) {
        setGlobalProgress(true);
        apiFetchNoRetry = true;
        try {
          await loadHomeData();
          await loadLearningInfo();
          showToast('刷新', '数据已刷新', 'success', 2000);
        } catch (e) {
          showToast('刷新失败', e.message, 'error', 5000, true);
        } finally {
          apiFetchNoRetry = false;
          setGlobalProgress(false);
        }
      } else {
        showToast('刷新', '数据已刷新', 'success', 2000);
      }
    });

    async function refreshBackendList() {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(getBackend() + '/api/available_backends', { signal: controller.signal });
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length) {
            const lan = data.filter(isLanIP);
            const other = data.filter(u => !isLanIP(u));
            BACKENDS = [...lan, ...other];
            localStorage.setItem('backendList', JSON.stringify(BACKENDS));
            updateNetworkSelector();
            var settingsSel = $('settings-ip-selector');
            if (settingsSel) {
              settingsSel.innerHTML = BACKENDS.map(function(u) {
                return '<option value="' + u + '"' + (u === activeBackend ? ' selected' : '') + '>' + u + '</option>';
              }).join('');
            }
          }
        }
      } catch (e) {}
    }

    function startNetworkMonitor() {
      var pingFailCount = 0;
      const ping = async () => {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 3000);
          const resp = await fetch(getBackend() + '/api/ping', { signal: controller.signal });
          clearTimeout(tid);
          if (resp.ok) {
            pingFailCount = 0;
            if ($('network-overlay')._shouldShow) {
              $('network-overlay')._shouldShow = false;
              if ($('network-overlay').classList.contains('show')) {
                $('network-overlay').classList.add('hidden');
                $('network-overlay').classList.remove('show');
              }
              refreshBackendList();
              if (token) {
                loadUserInfo().then(function() { loadHomeData(); });
              }
            }
          } else {
            throw new Error('not ok');
          }
        } catch (e) {
          pingFailCount++;
          if (pingFailCount >= 3 && !$('network-overlay').classList.contains('show')) {
            $('network-overlay')._shouldShow = true;
            $('network-overlay').classList.remove('hidden');
            $('network-overlay').classList.add('show');
            updateNetworkSelector();
            updateNetworkOverlayVisibility();
          }
        }
      };
      ping();
      setInterval(ping, 5000);

      var _lastBackendListStr = JSON.stringify(BACKENDS);
      setInterval(async function() {
        try {
          var ctrl = new AbortController();
          var tid = setTimeout(function() { ctrl.abort(); }, 5000);
          var resp = await fetch(getBackend() + '/api/available_backends', { signal: ctrl.signal });
          clearTimeout(tid);
          if (!resp.ok) return;
          var data = await resp.json();
          if (!Array.isArray(data) || !data.length) return;
          var lan = data.filter(isLanIP);
          var other = data.filter(function(u) { return !isLanIP(u); });
          var newList = lan.concat(other);
          var newStr = JSON.stringify(newList);
          if (newStr === _lastBackendListStr) return;
          _lastBackendListStr = newStr;
          BACKENDS = newList;
          localStorage.setItem('backendList', JSON.stringify(BACKENDS));
          updateNetworkSelector();
          var settingsSel = $('settings-ip-selector');
          if (settingsSel) {
            settingsSel.innerHTML = BACKENDS.map(function(u) {
              return '<option value="' + u + '"' + (u === activeBackend ? ' selected' : '') + '>' + u + '</option>';
            }).join('');
          }
          for (var i = 0; i < lan.length; i++) {
            var ok = await probeBackend(lan[i]);
            if (ok) { setBackend(lan[i]); return; }
          }
          for (var j = 0; j < other.length; j++) {
            var ok2 = await probeBackend(other[j]);
            if (ok2) { setBackend(other[j]); return; }
          }
        } catch (e) {}
      }, 60000);
    }

    var retryConnecting = false;
    $('retry-connection-btn').addEventListener('click', async () => {
      if (retryConnecting) return;
      const sel = $('error-ip-selector');
      if (!sel || !sel.value) return;
      var newIp = sel.value;
      showToast('正在重试连接...', '目标: ' + newIp, 'info', 5000);
      if (newIp === activeBackend) {
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(function() { ctrl.abort(); }, 3000);
          const resp = await fetch(newIp + '/api/ping', { signal: ctrl.signal });
          clearTimeout(tid);
          if (resp.ok) {
            $('network-overlay')._shouldShow = false;
            $('network-overlay').classList.add('hidden');
            $('network-overlay').classList.remove('show');
            showToast('建立连接', '已连接到 ' + newIp, 'success');
          } else {
            showToast('连接失败', '无法连接到 ' + newIp, 'error', 5000, true);
          }
        } catch (e) {
          showToast('连接失败', '无法连接到 ' + newIp, 'error', 5000, true);
        }
        return;
      }
      retryConnecting = true;
      $('retry-connection-btn').disabled = true;
      $('network-message').textContent = '正在测试 ' + newIp + ' ...';
      var pingOk = false;
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(function() { ctrl.abort(); }, 3000);
        const resp = await fetch(newIp + '/api/ping', { signal: ctrl.signal });
        clearTimeout(tid);
        pingOk = resp.ok;
      } catch (e) {}
      if (pingOk) {
        abortConnections();
        setBackend(newIp);
        updateNetworkSelector();
        $('network-overlay')._shouldShow = false;
        $('network-overlay').classList.add('hidden');
        $('network-overlay').classList.remove('show');
        if (token) {
          loadUserInfo().then(function() { loadHomeData(); });
        }
        showToast('建立连接', '已连接到 ' + newIp, 'success');
        refreshBackendList();
      } else {
        showToast('连接失败', '无法连接到 ' + newIp, 'error', 5000, true);
        $('network-message').textContent = '无法连接到服务器，请检查网络后手动重试';
      }
      retryConnecting = false;
      $('retry-connection-btn').disabled = false;
    });
    function bindEditTitle() {
      $('btn-edit-title').addEventListener('click', onEditTitleClick);
    }
    function onEditTitleClick(e) {
      e.stopPropagation();
      const center = $('titlebar-title');
      const current = appTitle;
      center.innerHTML = '<div class="edit-title-row"><input type="text" id="edit-title-input" maxlength="16" value="' + escapeHtml(current) + '" style="-webkit-app-region:no-drag">' +
        '<button id="edit-title-confirm" style="-webkit-app-region:no-drag"><i class="fa-solid fa-check"></i></button></div>';
      const input = $('edit-title-input');
      input.focus();
      input.select();
      const confirm = () => {
        const newTitle = input.value.trim();
        if (newTitle) {
          appTitle = newTitle;
          localStorage.setItem('appTitle', appTitle);
          center.innerHTML = '<span id="titlebar-text">' + escapeHtml(appTitle) + '</span> <button class="titlebar-btn" id="btn-edit-title" title="修改标题" style="width:22px;height:22px;font-size:10px;"><i class="fa-solid fa-pen"></i></button>';
          document.title = appTitle;
          if (API && API.setTitle) API.setTitle(appTitle);
          bindEditTitle();
          showToast('标题已更新', appTitle, 'success');
        } else {
          center.innerHTML = '<span id="titlebar-text">' + escapeHtml(current) + '</span> <button class="titlebar-btn" id="btn-edit-title" title="修改标题" style="width:22px;height:22px;font-size:10px;"><i class="fa-solid fa-pen"></i></button>';
          bindEditTitle();
        }
      };
      $('edit-title-confirm').addEventListener('click', confirm);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { center.innerHTML = '<span id="titlebar-text">' + escapeHtml(current) + '</span> <button class="titlebar-btn" id="btn-edit-title" title="修改标题" style="width:22px;height:22px;font-size:10px;"><i class="fa-solid fa-pen"></i></button>'; bindEditTitle(); } });
    }
    bindEditTitle();

    if (API) {
      API.onWindowStateChange((isMax) => {
        const icon = $('btn-maximize').querySelector('i');
        if (icon) {
          icon.className = isMax ? 'fa-regular fa-clone' : 'fa-regular fa-square';
          $('btn-maximize').title = isMax ? '向下还原' : '最大化';
        }
      });
      API.onNetworkStatus((online) => {
        networkOnline = online;
      });
      API.onUpdateReady((info) => {
        updateReady = true;
        $('update-bar').classList.add('show');
        if (info && info.version) {
          $('update-bar').querySelector('span').textContent = '新版本已就绪: ' + info.version + '，点击安装';
        }
      });
      API.onOpenNewTab((url) => {
        console.log('[Browser] IPC open-new-tab:', url);
        if (url && url.indexOf('http') === 0) { if (_pendingExternalUrl && url === _pendingExternalUrl) return; newTab(url); }
      });
    }

    $('update-bar').addEventListener('click', () => {
      if (updateReady && API && API.installUpdate) {
        API.installUpdate(updateInstallerPath);
      }
    });

    $('update-reload-btn').addEventListener('click', () => {
      console.log('[update-reload-btn] clicked, updateInstallerPath:', updateInstallerPath, 'API:', !!API, 'installUpdate:', !!(API && API.installUpdate));
      if (updateInstallerPath && API && API.installUpdate) {
        API.installUpdate(updateInstallerPath);
      }
    });

    $('login-submit').addEventListener('click', () => {
      if ($('login-modal-title').textContent.includes('注册')) register();
      else login();
    });
    $('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if ($('login-modal-title').textContent.includes('注册')) register();
        else login();
      }
    });
    $('login-password-confirm').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') register();
    });
    $('switch-to-register').addEventListener('click', () => {
      isRegisterMode = !isRegisterMode;
      if (isRegisterMode) {
        $('login-modal-title').textContent = '注册';
        $('login-submit').textContent = '注册';
        $('switch-to-register').textContent = '已有账号？点我登录';
        $('login-password-confirm-wrapper').style.display = '';
      } else {
        $('login-modal-title').textContent = '登录';
        $('login-submit').textContent = '登录';
        $('switch-to-register').textContent = '还没有账号？点我注册';
        $('login-password-confirm-wrapper').style.display = 'none';
      }
    });
    $('close-login-modal').addEventListener('click', hideLoginModal);

    document.addEventListener('mousedown', (e) => {
      const toggle = e.target.closest('.password-toggle');
      if (toggle) {
        e.preventDefault();
        const input = toggle.parentElement.querySelector('input');
        if (input) input.type = 'text';
      }
    });
    document.addEventListener('mouseup', (e) => {
      const toggle = e.target.closest('.password-toggle');
      if (toggle) {
        const input = toggle.parentElement.querySelector('input');
        if (input) input.type = 'password';
      }
    });
    document.addEventListener('mouseleave', (e) => {
      if (!e.target || !e.target.closest) return;
      const toggle = e.target.closest('.password-toggle');
      if (toggle) {
        const input = toggle.parentElement.querySelector('input');
        if (input) input.type = 'password';
      }
    });

    $('profile-cancel').addEventListener('click', () => $('profile-modal').classList.remove('show'));
    $('profile-save').addEventListener('click', saveProfile);
    $('profile-password-confirm').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveProfile();
    });
    $('select-avatar').addEventListener('click', uploadAvatar);
    $('reset-avatar').addEventListener('click', resetAvatar);
    $('crop-confirm').addEventListener('click', confirmCrop);
    $('crop-cancel').addEventListener('click', cancelCrop);

    $('rename-cancel').addEventListener('click', () => $('rename-dialog').classList.remove('show'));
    $('rename-confirm').addEventListener('click', confirmRename);
    $('rename-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmRename();
      if (e.key === 'Escape') $('rename-dialog').classList.remove('show');
    });

    $('custom-color').addEventListener('input', () => {
      themeColor = $('custom-color').value;
      $('custom-color-text').value = themeColor;
      localStorage.setItem('themeColor', themeColor);
      applyThemeColors();
    });
    $('custom-color-text').addEventListener('change', () => {
      let val = $('custom-color-text').value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        themeColor = val;
        $('custom-color').value = themeColor;
        localStorage.setItem('themeColor', themeColor);
        applyTheme();
        renderAppearancePage();
      } else {
        $('custom-color-text').value = themeColor;
      }
    });

    qsa('.bg-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        var newType = opt.dataset.bg;
        var typeChanged = (newType !== bgType);
        bgType = newType;
        localStorage.setItem('bgType', bgType);
        updateBgOptions();
        if (bgType === 'none') {
          bgPath = '';
          localStorage.removeItem('bgPath');
          if (API && API.removeBackground) {
            try { await API.removeBackground(); } catch (e) {}
          }
          showToast('背景已清除', '', 'info');
        } else if (bgType === 'high-contrast') {
          bgPath = '';
          localStorage.removeItem('bgPath');
          if (API && API.removeBackground) {
            try { await API.removeBackground(); } catch (e) {}
          }
          showToast('高对比度', '已启用', 'info');
        } else if (typeChanged) {
          bgPath = '';
          localStorage.removeItem('bgPath');
        }
        applyBackground();
        renderAppearancePage();
      });
    });

    $('select-bg-file').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      if (bgType === 'video') input.accept = 'video/*';
      else if (bgType === 'image') input.accept = 'image/*';
      else if (bgType === 'high-contrast') { showToast('提示', '高对比度无需选择文件', 'info'); return; }
      else { showToast('提示', '请先选择背景类型', 'error'); return; }
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const sizeMB = file.size / 1024 / 1024;
        var maxBgSize = 1024;
        if (sizeMB > maxBgSize) {
          showToast('加载失败', '背景文件不能超过 ' + maxBgSize + 'MB', 'error', 3000);
          return;
        }
        if (sizeMB > 30) {
          showToast('加载中', '文件较大，加载可能需要几秒钟，请稍候...', 'info', 5000);
        }
        const result = await API.saveBackgroundFile(file.path, file.name);
        bgPath = result.url;
        bgType = result.type;
        localStorage.setItem('bgPath', bgPath);
        localStorage.setItem('bgType', bgType);
        cardOpacity = 50;
        localStorage.setItem('cardOpacity', cardOpacity);
        $('opacity-slider').value = cardOpacity;
        $('opacity-value').textContent = cardOpacity + '%';
        applyTheme();
        applyBackground();
        renderAppearancePage();
      };
      input.click();
    });

    $('reset-bg').addEventListener('click', async () => {
      bgType = 'none';
      bgPath = '';
      localStorage.removeItem('bgType');
      localStorage.removeItem('bgPath');
      if (API && API.removeBackground) {
        try { await API.removeBackground(); } catch (e) {}
      }
      applyBackground();
      renderAppearancePage();
      showToast('背景已重置', '缓存已清理', 'info');
    });

    qsa('.splash-type-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        var newType = opt.dataset.type;
        if (newType !== splashType) {
          splashType = newType;
          splashPath = '';
          localStorage.setItem('splashType', splashType);
          localStorage.removeItem('splashPath');
        }
        renderAppearancePage();
      });
    });

    var selectSplashFileBtn = $('select-splash-file');
    if (selectSplashFileBtn) {
      selectSplashFileBtn.addEventListener('click', function() {
        var input = document.createElement('input');
        input.type = 'file';
        if (splashType === 'video') input.accept = 'video/*';
        else if (splashType === 'image') input.accept = 'image/*';
        else return;
        input.onchange = function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var sizeMB = file.size / 1024 / 1024;
          if (sizeMB > 512) { showToast('文件过大', '不能超过512MB', 'error', 3000); return; }
          if (splashType === 'video') {
            var video = document.createElement('video');
            video.preload = 'metadata';
            video.src = URL.createObjectURL(file);
            video.onloadedmetadata = function() {
              URL.revokeObjectURL(video.src);
              if (video.duration < 1) { showToast('视频太短', '启动视频至少1秒', 'error', 3000); return; }
              if (video.duration > 15) { showToast('视频太长', '启动视频最长15秒, 将从头播放', 'warning', 3000); }
              doSaveSplashFile(file);
            };
          } else {
            doSaveSplashFile(file);
          }
        };
        input.click();
      });
    }

    function doSaveSplashFile(file) {
      if (!API || !API.saveSplashFile) {
        var reader = new FileReader();
        reader.onload = function() {
          splashPath = reader.result;
          localStorage.setItem('splashPath', splashPath);
          localStorage.setItem('splashType', splashType);
          renderAppearancePage();
        };
        reader.readAsDataURL(file);
        return;
      }
      API.saveSplashFile(file.path, file.name).then(function(result) {
        splashPath = result.url;
        localStorage.setItem('splashPath', splashPath);
        localStorage.setItem('splashType', splashType);
        renderAppearancePage();
      }).catch(function() {
        showToast('保存失败', '无法保存启动动画文件', 'error', 3000);
      });
    }

    var resetSplashBtn = $('reset-splash');
    if (resetSplashBtn) {
      resetSplashBtn.addEventListener('click', function() {
        splashType = 'default';
        splashPath = '';
        localStorage.removeItem('splashType');
        localStorage.removeItem('splashPath');
        if (API && API.removeSplash) API.removeSplash();
        renderAppearancePage();
        showToast('已重置', '启动动画已恢复默认', 'info');
      });
    }

    var splashVolSlider = $('splash-volume-slider');
    if (splashVolSlider) {
      splashVolSlider.addEventListener('input', function() {
        splashVolume = parseInt(this.value);
        localStorage.setItem('splashVolume', splashVolume);
        var volVal = $('splash-volume-value');
        if (volVal) volVal.textContent = splashVolume + '%';
      });
      splashVolSlider.addEventListener('change', function() {
        var sv = $('splash-video');
        if (sv) sv.volume = splashVolume / 100;
      });
    }

    var bgVolSlider = $('bg-video-volume-slider');
    if (bgVolSlider) {
      bgVolSlider.addEventListener('input', function() {
        bgVideoVolume = parseInt(this.value);
        localStorage.setItem('bgVideoVolume', bgVideoVolume);
        var volVal = $('bg-video-volume-value');
        if (volVal) volVal.textContent = bgVideoVolume + '%';
      });
      bgVolSlider.addEventListener('change', function() {
        var bv = $('bg-video');
        if (bv) bv.volume = bgVideoVolume / 100;
      });
    }

    // Font
    var selectFontBtn = $('select-font-file');
    if (selectFontBtn) {
      selectFontBtn.addEventListener('click', function() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ttf,.otf';
        input.onchange = function(e) {
          var file = e.target.files[0];
          if (!file) return;
          if (!API || !API.saveFontFile) {
            var reader = new FileReader();
            reader.onload = function() {
              customFontPath = reader.result;
              customFontFamily = file.name.replace(/\.[^.]+$/, '');
              localStorage.setItem('customFontPath', customFontPath);
              localStorage.setItem('customFontFamily', customFontFamily);
              applyFont();
              renderAppearancePage();
            };
            reader.readAsDataURL(file);
            return;
          }
          API.saveFontFile(file.path, file.name).then(function(result) {
            customFontPath = result.url || result.filePath;
            customFontFamily = result.family;
            localStorage.setItem('customFontPath', customFontPath);
            localStorage.setItem('customFontFamily', customFontFamily);
            applyFont();
            renderAppearancePage();
          }).catch(function() {
            showToast('导入失败', '无法导入字体文件', 'error', 3000);
          });
        };
        input.click();
      });
    }

    var resetFontBtn = $('reset-font');
    if (resetFontBtn) {
      resetFontBtn.addEventListener('click', function() {
        customFontFamily = '';
        customFontPath = '';
        localStorage.removeItem('customFontPath');
        localStorage.removeItem('customFontFamily');
        if (API && API.removeFont) API.removeFont();
        applyFont();
        renderAppearancePage();
        showToast('已重置', '自定义字体已移除', 'info');
      });
    }

    var fwSlider = $('font-weight-slider');
    if (fwSlider) {
      fwSlider.addEventListener('input', function() {
        fontWeightSetting = parseInt(this.value);
        localStorage.setItem('fontWeight', fontWeightSetting);
        applyFont();
        var fwVal = $('font-weight-value');
        if (fwVal) fwVal.textContent = fontWeightSetting;
      });
    }

    var fsSlider = $('font-size-slider');
    if (fsSlider) {
      fsSlider.addEventListener('input', function() {
        fontSizeSetting = parseInt(this.value);
        localStorage.setItem('fontSize', fontSizeSetting);
        applyFont();
        var fsVal = $('font-size-value');
        if (fsVal) fsVal.textContent = fontSizeSetting + '%';
      });
    }

    var fcPicker = $('font-color-picker');
    if (fcPicker) {
      fcPicker.addEventListener('input', function() {
        fontColorSetting = this.value;
        localStorage.setItem('fontColor', fontColorSetting);
        applyFont();
      });
    }

    var resetFontSettings = $('reset-font-settings');
    if (resetFontSettings) {
      resetFontSettings.addEventListener('click', function() {
        fontWeightSetting = 400;
        fontSizeSetting = 80;
        fontColorSetting = '';
        localStorage.removeItem('fontWeight');
        localStorage.removeItem('fontSize');
        localStorage.removeItem('fontColor');
        applyFont();
        renderAppearancePage();
        showToast('已恢复', '字体设置已恢复默认', 'info');
      });
    }

    $('opacity-slider').addEventListener('input', () => {
      cardOpacity = parseInt($('opacity-slider').value);
      $('opacity-value').textContent = cardOpacity + '%';
      localStorage.setItem('cardOpacity', cardOpacity);
      applyTheme();
    });

    const zoomSlider = $('zoom-slider');
    const zoomValue = $('zoom-value');
    const savedZoom = localStorage.getItem('zoomFactor') || '100';
    zoomSlider.value = savedZoom;
    zoomValue.textContent = savedZoom + '%';
    if (API && API.setZoomFactor) API.setZoomFactor(parseInt(savedZoom) / 100);
    zoomSlider.addEventListener('input', () => {
      const val = parseInt(zoomSlider.value);
      zoomValue.textContent = val + '%';
      localStorage.setItem('zoomFactor', val);
      if (API && API.setZoomFactor) API.setZoomFactor(val / 100);
      var wzs = $('window-zoom-slider');
      var wzv = $('window-zoom-value');
      if (wzs) wzs.value = val;
      if (wzv) wzv.textContent = val + '%';
    });

    var winZoomSlider = $('window-zoom-slider');
    var winZoomValue = $('window-zoom-value');
    if (winZoomSlider) {
      winZoomSlider.value = savedZoom;
      winZoomValue.textContent = savedZoom + '%';
      winZoomSlider.addEventListener('input', function() {
        var val = parseInt(winZoomSlider.value);
        winZoomValue.textContent = val + '%';
        zoomSlider.value = val;
        zoomValue.textContent = val + '%';
        localStorage.setItem('zoomFactor', val);
        if (API && API.setZoomFactor) API.setZoomFactor(val / 100);
      });
    }

    // ========== 点击反馈（显示点击位置） ==========
    (function injectTapFeedbackStyle() {
      var tapStyle = document.createElement('style');
      tapStyle.id = 'tap-feedback-style';
      tapStyle.textContent = [
        '@keyframes tapRipplePulse{',
        '  0% {transform:translate(-50%,-50%) scale(1);}',
        '  50% {transform:translate(-50%,-50%) scale(1.15);}',
        '  100% {transform:translate(-50%,-50%) scale(1);}}',
        '@keyframes tapRippleFade{',
        '  to {transform:translate(-50%,-50%) scale(0);opacity:0;}}',
        '.tap-ripple{',
        '  position:fixed;border-radius:50%;',
        '  background:rgba(128,128,128,0.4);',
        '  pointer-events:none;z-index:2147483647;',
        '  transform:translate(-50%,-50%) scale(1);opacity:1;}',
        '.tap-ripple.pulse{',
        '  animation:tapRipplePulse 0.15s ease-out forwards;}',
        '.tap-ripple.fade{',
        '  animation:tapRippleFade 0.3s ease-out forwards;}'
      ].join('\n');
      document.head.appendChild(tapStyle);
    })();
    var tapFeedbackEnabled = localStorage.getItem('tapFeedbackEnabled') === 'true';
    var tapFeedbackToggle = $('show-tap-feedback');
    if (tapFeedbackToggle) {
      tapFeedbackToggle.checked = tapFeedbackEnabled;
      tapFeedbackToggle.addEventListener('change', function() {
        tapFeedbackEnabled = this.checked;
        localStorage.setItem('tapFeedbackEnabled', tapFeedbackEnabled);
      });
    }
    var skipAnimToggle = $('skip-anim-toggle');
    if (skipAnimToggle) {
      var skipAnim = localStorage.getItem('skipAnim') === 'true';
      skipAnimToggle.checked = skipAnim;
      if (skipAnim) document.body.classList.add('no-anim');
      skipAnimToggle.addEventListener('change', function() {
        skipAnim = this.checked;
        localStorage.setItem('skipAnim', skipAnim);
        if (skipAnim) document.body.classList.add('no-anim');
        else document.body.classList.remove('no-anim');
      });
    }
    var _tapRipple = null, _tapDown = false;
    function _ensureRipple(x, y) {
      if (!_tapRipple) {
        _tapRipple = document.createElement('div');
        _tapRipple.className = 'tap-ripple pulse';
        _tapRipple.style.width = '48px';
        _tapRipple.style.height = '48px';
        document.body.appendChild(_tapRipple);
      }
      _tapRipple.style.left = x + 'px';
      _tapRipple.style.top = y + 'px';
    }
    function _releaseTap() {
      _tapDown = false;
      if (_tapRipple) {
        _tapRipple.classList.remove('pulse');
        _tapRipple.style.animation = 'none';
        _tapRipple.style.transform = 'translate(-50%,-50%) scale(1)';
        void _tapRipple.offsetWidth;
        _tapRipple.style.animation = '';
        _tapRipple.classList.add('fade');
        var r = _tapRipple;
        r.addEventListener('animationend', function() { r.remove(); });
        setTimeout(function() { if (r.parentNode) r.remove(); }, 600);
        _tapRipple = null;
      }
    }
    document.addEventListener('mousedown', function(e) {
      if (!tapFeedbackEnabled || e.button !== 0) return;
      _tapDown = true;
      _ensureRipple(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function(e) {
      if (!tapFeedbackEnabled || !_tapDown || !_tapRipple) return;
      _tapRipple.style.left = e.clientX + 'px';
      _tapRipple.style.top = e.clientY + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (_tapDown) _releaseTap();
    });

    const acrylicToggle = $('acrylic-toggle');
    if (acrylicToggle && API && API.getAcrylicEnabled) {
      API.getAcrylicEnabled().then(enabled => {
        acrylicToggle.checked = enabled;
      }).catch(() => {});
      acrylicToggle.addEventListener('change', async () => {
        const enabled = acrylicToggle.checked;
        if (enabled) {
          // 只在开启时弹出确认对话框
          $('xxt-confirm-title').textContent = '注意';
          $('xxt-confirm-msg').textContent = '该功能有较多bug，可能会导致上传系统圆角缺失，标题栏与侧边栏变黑等问题';
          $('xxt-confirm-cancel').textContent = '取消';
          $('xxt-confirm-ok').textContent = '仍然开启';
          $('xxt-confirm-modal').classList.add('show');
          const onCancel = () => {
            acrylicToggle.checked = false;
            $('xxt-confirm-modal').classList.remove('show');
            cleanup();
          };
          const onOk = async () => {
            $('xxt-confirm-modal').classList.remove('show');
            cleanup();
            localStorage.setItem('acrylicEnabled', 'true');
            if (API && API.setAcrylicEnabled) {
              await API.setAcrylicEnabled(true);
            }
          };
          const cleanup = () => {
            $('xxt-confirm-cancel').removeEventListener('click', onCancel);
            $('xxt-confirm-ok').removeEventListener('click', onOk);
          };
          $('xxt-confirm-cancel').addEventListener('click', onCancel);
          $('xxt-confirm-ok').addEventListener('click', onOk);
        } else {
          // 关闭时直接生效
          localStorage.setItem('acrylicEnabled', 'false');
          if (API && API.setAcrylicEnabled) {
            await API.setAcrylicEnabled(false);
          }
        }
      });
    }

    const browserGlassToggle = $('browser-glass-toggle');
    if (browserGlassToggle) {
      browserGlassToggle.checked = browserGlassEnabled;
      browserGlassToggle.addEventListener('change', () => {
        browserGlassEnabled = browserGlassToggle.checked;
        localStorage.setItem('browserGlassEnabled', browserGlassEnabled);
        injectBrowserGlassCSS();
        showToast('浏览器透明', browserGlassEnabled ? '已启用' : '已禁用', 'info', 2000);
      });
    }

    const bgGlassToggle = $('bg-glass-toggle');
    const bgBlurRow = $('bg-blur-row');
    const bgBlurSlider = $('bg-blur-slider');
    const bgBlurValue = $('bg-blur-value');
    if (bgGlassToggle) {
      if (bgGlass) {
        bgBlurRow.style.display = '';
        const saved = parseInt(localStorage.getItem('bgBlurAmount') || '10');
        bgBlurSlider.value = saved;
        bgBlurValue.textContent = saved + 'px';
        localStorage.setItem('bgBlurAmount', saved);
      }
      bgGlassToggle.addEventListener('change', () => {
        bgGlass = bgGlassToggle.checked;
        localStorage.setItem('bgGlass', bgGlass);
        if (bgGlass) {
          bgBlurRow.style.display = '';
          const saved = parseInt(localStorage.getItem('bgBlurAmount') || '10');
          bgBlurSlider.value = saved;
          bgBlurValue.textContent = saved + 'px';
          localStorage.setItem('bgBlurAmount', saved);
        } else {
          bgBlurRow.style.display = 'none';
          bgBlurSlider.value = 0;
          bgBlurValue.textContent = '0px';
          localStorage.removeItem('bgBlurAmount');
        }
        applyTheme();
        showToast('背景毛玻璃', bgGlass ? '已启用' : '已禁用', 'info', 2000);
      });
    }
    if (bgBlurSlider) {
      bgBlurSlider.addEventListener('input', () => {
        const val = parseInt(bgBlurSlider.value);
        bgBlurValue.textContent = val + 'px';
        localStorage.setItem('bgBlurAmount', val);
        applyTheme();
      });
    }

    const settingsIpSel = $('settings-ip-selector');
    if (settingsIpSel) {
      settingsIpSel.innerHTML = BACKENDS.map(url =>
        '<option value="' + url + '"' + (url === activeBackend ? ' selected' : '') + '>' + url + '</option>'
      ).join('');
      settingsIpSel.addEventListener('change', async () => {
        var newIp = settingsIpSel.value;
        if (newIp === activeBackend) return;
        showToast('正在切换', '正在测试 ' + newIp + ' ...', 'info', 2000);
        var pingOk = false;
        try {
          var ctrl = new AbortController();
          var tid = setTimeout(function() { ctrl.abort(); }, 3000);
          var resp = await fetch(newIp + '/api/ping', { signal: ctrl.signal });
          clearTimeout(tid);
          pingOk = resp.ok;
        } catch (e) {}
        if (pingOk) {
          abortConnections();
          setBackend(newIp);
          updateNetworkSelector();
          var errSel = $('error-ip-selector');
          if (errSel) errSel.value = newIp;
          showToast('建立连接', '已连接到 ' + newIp, 'success');
          refreshBackendList();
        } else {
          settingsIpSel.value = activeBackend;
          showToast('连接失败', '无法连接到 ' + newIp, 'error', 5000, true);
        }
      });
    }

    const lanFirstToggle = $('lan-first-toggle');
    if (lanFirstToggle) {
      lanFirstToggle.checked = lanFirst;
      lanFirstToggle.addEventListener('change', function() {
        if (!lanFirstToggle.checked) {
          $('xxt-confirm-title').textContent = '注意';
          $('xxt-confirm-msg').textContent = '关闭这个可能会导致直接使用你自己的流量建立连接，默认是局域网，不消耗任何流量。';
          $('xxt-confirm-cancel').textContent = '取消';
          $('xxt-confirm-ok').textContent = '确定关闭';
          $('xxt-confirm-modal').classList.add('show');
          var onCancel = function() {
            lanFirstToggle.checked = true;
            $('xxt-confirm-modal').classList.remove('show');
            cleanup();
          };
          var onOk = function() {
            $('xxt-confirm-modal').classList.remove('show');
            cleanup();
            lanFirst = false;
            localStorage.setItem('lanFirst', 'false');
            showToast('优先局域网', '已关闭，将直接使用选定地址', 'info', 2000);
          };
          var cleanup = function() {
            $('xxt-confirm-cancel').removeEventListener('click', onCancel);
            $('xxt-confirm-ok').removeEventListener('click', onOk);
          };
          $('xxt-confirm-cancel').addEventListener('click', onCancel);
          $('xxt-confirm-ok').addEventListener('click', onOk);
          return;
        }
        lanFirst = true;
        localStorage.setItem('lanFirst', 'true');
        showToast('优先局域网', '已启用，将优先使用局域网地址', 'info', 2000);
      });
    }

    const glassToggle = $('glass-toggle');
    const cardBlurRow = $('card-blur-row');
    const cardBlurSlider = $('card-blur-slider');
    const cardBlurValue = $('card-blur-value');
    if (glassToggle) {
      const glassEnabled = localStorage.getItem('glassEnabled') === 'true';
      glassToggle.checked = glassEnabled;
      if (!glassEnabled) document.body.classList.add('no-glass');
      if (glassEnabled) {
        cardBlurRow.style.display = '';
        const saved = parseInt(localStorage.getItem('cardBlurAmount') || '10');
        cardBlurSlider.value = saved;
        cardBlurValue.textContent = saved + 'px';
        localStorage.setItem('cardBlurAmount', saved);
      }
      glassToggle.addEventListener('change', () => {
        const enabled = glassToggle.checked;
        localStorage.setItem('glassEnabled', enabled);
        document.body.classList.toggle('no-glass', !enabled);
        if (enabled) {
          cardBlurRow.style.display = '';
          const saved = parseInt(localStorage.getItem('cardBlurAmount') || '10');
          cardBlurSlider.value = saved;
          cardBlurValue.textContent = saved + 'px';
          localStorage.setItem('cardBlurAmount', saved);
        } else {
          cardBlurRow.style.display = 'none';
          cardBlurSlider.value = 0;
          cardBlurValue.textContent = '0px';
          localStorage.removeItem('cardBlurAmount');
        }
        applyTheme();
        showToast('毛玻璃效果', enabled ? '已启用' : '已禁用', 'info', 2000);
      });
    }
    if (cardBlurSlider) {
      cardBlurSlider.addEventListener('input', () => {
        const val = parseInt(cardBlurSlider.value);
        cardBlurValue.textContent = val + 'px';
        localStorage.setItem('cardBlurAmount', val);
        applyTheme();
      });
    }

    $('auto-start-toggle').addEventListener('change', toggleAutoStart);

    initLocalXxtCredsEditor();

    var settingsTabs = document.querySelectorAll('.settings-tab');
    for (var si = 0; si < settingsTabs.length; si++) {
      settingsTabs[si].addEventListener('click', function() {
        var tabName = this.getAttribute('data-tab');
        for (var sj = 0; sj < settingsTabs.length; sj++) {
          settingsTabs[sj].classList.remove('active');
        }
        this.classList.add('active');
        var panels = document.querySelectorAll('.settings-panel');
        for (var sk = 0; sk < panels.length; sk++) {
          panels[sk].classList.remove('active');
        }
        var panel = document.getElementById('panel-' + tabName);
        if (panel) panel.classList.add('active');
      });
    }

    $('esc-hide-toggle').addEventListener('change', () => {
      const enabled = $('esc-hide-toggle').checked;
      localStorage.setItem('escHideEnabled', enabled);
      if (API && API.setEscHideEnabled) API.setEscHideEnabled(enabled);
    });

    var transparentToggle = $('window-transparent-toggle');
    if (transparentToggle) {
      var bgTransEnabled = localStorage.getItem('bgTransparentEnabled') === 'true';
      transparentToggle.checked = bgTransEnabled;
      if (bgTransEnabled) document.body.classList.add('with-bg');
      transparentToggle.addEventListener('change', async function() {
        var enabled = transparentToggle.checked;
        localStorage.setItem('bgTransparentEnabled', enabled);
        if (enabled) {
          document.body.classList.add('with-bg');
          if (API && API.setWindowTransparent) await API.setWindowTransparent(true);
        } else {
          var _hasBg = (bgType !== 'none' && bgPath);
          if (!(_hasBg || acrylicEnabled)) document.body.classList.remove('with-bg');
          if (API && API.setWindowTransparent) await API.setWindowTransparent(false);
        }
        applyBackground();
      });
    }

    var opacitySlider = $('window-opacity-slider');
    var opacityValueEl = $('window-opacity-value');
    if (opacitySlider && API && API.getWindowOpacity) {
      API.getWindowOpacity().then(function(val) {
        var pct = Math.round(val * 100);
        opacitySlider.value = pct;
        if (opacityValueEl) opacityValueEl.textContent = pct + '%';
      }).catch(function() {});
      opacitySlider.addEventListener('input', function() {
        var pct = parseInt(this.value);
        if (opacityValueEl) opacityValueEl.textContent = pct + '%';
        if (API && API.setWindowOpacity) {
          API.setWindowOpacity(pct / 100);
        }
      });
    }

    var appOpacitySlider = $('appearance-window-opacity-slider');
    var appOpacityValueEl = $('appearance-window-opacity-value');
    if (appOpacitySlider && API && API.getWindowOpacity) {
      API.getWindowOpacity().then(function(val) {
        var pct = Math.round(val * 100);
        appOpacitySlider.value = pct;
        if (appOpacityValueEl) appOpacityValueEl.textContent = pct + '%';
      }).catch(function() {});
      appOpacitySlider.addEventListener('input', function() {
        var pct = parseInt(this.value);
        if (appOpacityValueEl) appOpacityValueEl.textContent = pct + '%';
        if (API && API.setWindowOpacity) {
          API.setWindowOpacity(pct / 100);
        }
        var devSlider = $('window-opacity-slider');
        var devValue = $('window-opacity-value');
        if (devSlider) devSlider.value = pct;
        if (devValue) devValue.textContent = pct + '%';
      });
    }

    var titlebar = document.getElementById('titlebar');
    if (titlebar && API && API.isMaximized) {
      titlebar.addEventListener('dblclick', async function(e) {
        if (e.target.closest('button')) return;
        if (API && API.maximize) API.maximize();
      });
    }

    var clickThroughToggle = $('window-clickthrough-toggle');
    if (clickThroughToggle && API && API.getWindowClickThrough) {
      API.getWindowClickThrough().then(function(enabled) {
        clickThroughToggle.checked = enabled;
      }).catch(function() {});
      clickThroughToggle.addEventListener('change', async function() {
        var enabled = clickThroughToggle.checked;
        if (API && API.setWindowClickThrough) {
          await API.setWindowClickThrough(enabled);
        }
      });
    }

    var copyHwToggle = $('show-copy-homework-toggle');
    if (copyHwToggle) {
      copyHwToggle.checked = localStorage.getItem('showCopyHomework') === 'true';
      copyHwToggle.addEventListener('change', function() {
        localStorage.setItem('showCopyHomework', copyHwToggle.checked ? 'true' : 'false');
      });
    }

    var openDevPanelBtn = $('open-dev-panel-btn');
    if (openDevPanelBtn && API && API.toggleDevPanel) {
      openDevPanelBtn.addEventListener('click', function() {
        API.toggleDevPanel();
      });
    }

    var alwaysOnTopShortcutToggle = $('always-on-top-shortcut-toggle');
    if (alwaysOnTopShortcutToggle && API && API.setAlwaysOnTopShortcutEnabled) {
      alwaysOnTopShortcutToggle.checked = localStorage.getItem('alwaysOnTopShortcutEnabled') !== 'false';
      alwaysOnTopShortcutToggle.addEventListener('change', function() {
        var enabled = this.checked;
        localStorage.setItem('alwaysOnTopShortcutEnabled', enabled);
        API.setAlwaysOnTopShortcutEnabled(enabled);
      });
    }
    var alwaysOnTopShortcutInput = $('always-on-top-shortcut-input');
    var defaultAlwaysOnTopShortcut = 'Ctrl+Shift+Alt+T';
    if (alwaysOnTopShortcutInput && API && API.setAlwaysOnTopShortcutKey) {
      alwaysOnTopShortcutInput.value = localStorage.getItem('alwaysOnTopShortcutKey') || defaultAlwaysOnTopShortcut;
      alwaysOnTopShortcutInput.addEventListener('keydown', function(e) {
        e.preventDefault();
        var parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');
        var key = e.key;
        if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return;
        if (key.length === 1 || key.startsWith('F')) {
          parts.push(key.length === 1 ? key.toUpperCase() : key);
          this.value = parts.join('+');
        }
      });
      alwaysOnTopShortcutInput.addEventListener('blur', function() {
        var val = this.value.trim();
        if (!val) { this.value = defaultAlwaysOnTopShortcut; return; }
        localStorage.setItem('alwaysOnTopShortcutKey', val);
        API.setAlwaysOnTopShortcutKey(val);
      });
      alwaysOnTopShortcutInput.addEventListener('focus', function() {
        this.value = '';
      });
    }

    var browserHideShortcutToggle = $('browser-hide-shortcut-toggle');
    if (browserHideShortcutToggle && API && API.setBrowserHideShortcutEnabled) {
      browserHideShortcutToggle.checked = localStorage.getItem('browserHideShortcutEnabled') !== 'false';
      browserHideShortcutToggle.addEventListener('change', function() {
        var enabled = this.checked;
        localStorage.setItem('browserHideShortcutEnabled', enabled);
        API.setBrowserHideShortcutEnabled(enabled);
      });
    }
    var browserHideShortcutInput = $('browser-hide-shortcut-input');
    var defaultBrowserHideShortcut = 'F10';
    if (browserHideShortcutInput && API && API.setBrowserHideShortcutKey) {
      browserHideShortcutInput.value = localStorage.getItem('browserHideShortcutKey') || defaultBrowserHideShortcut;
      browserHideShortcutInput.addEventListener('keydown', function(e) {
        e.preventDefault();
        var key = e.key;
        if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return;
        if (key.startsWith('F') || key.length === 1) {
          this.value = key.length === 1 ? key.toUpperCase() : key;
        }
      });
      browserHideShortcutInput.addEventListener('blur', function() {
        var val = this.value.trim();
        if (!val) { this.value = defaultBrowserHideShortcut; return; }
        localStorage.setItem('browserHideShortcutKey', val);
        API.setBrowserHideShortcutKey(val);
      });
      browserHideShortcutInput.addEventListener('focus', function() {
        this.value = '';
      });
    }

    var customUAToggle = $('custom-ua-toggle');
    var customUAInput = $('custom-ua-input');
    var customUAInputItem = $('custom-ua-input-item');
    var customUAResetBtn = $('custom-ua-reset-btn');
    var defaultCustomUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) anghaoyu16/1.4.0 Chrome/152.0.7977.130 Safari/537.36';
    if (customUAToggle && API && API.setCustomUA) {
      var savedUA = localStorage.getItem('customUA');
      var savedEnabled = localStorage.getItem('customUAEnabled') === 'true';
      customUAToggle.checked = savedEnabled;
      if (customUAInput) {
        customUAInput.value = savedUA || defaultCustomUA;
      }
      if (customUAInputItem) {
        customUAInputItem.style.display = savedEnabled ? '' : 'none';
      }
      if (savedEnabled && savedUA) {
        API.setCustomUA(savedUA);
      }
      customUAToggle.addEventListener('change', function() {
        var enabled = this.checked;
        localStorage.setItem('customUAEnabled', enabled);
        if (customUAInputItem) customUAInputItem.style.display = enabled ? '' : 'none';
        if (enabled && customUAInput) {
          var ua = customUAInput.value.trim();
          if (!ua) { customUAInput.value = defaultCustomUA; ua = defaultCustomUA; }
          localStorage.setItem('customUA', ua);
          API.setCustomUA(ua);
          showUARestart();
        } else {
          API.setCustomUA('');
          showUARestart();
        }
      });
    }
    if (customUAInput) {
      customUAInput.addEventListener('change', function() {
        var ua = this.value.trim();
        if (!ua) { this.value = defaultCustomUA; ua = defaultCustomUA; }
        localStorage.setItem('customUA', ua);
        if (customUAToggle && customUAToggle.checked && API && API.setCustomUA) {
          API.setCustomUA(ua);
          showUARestart();
        }
      });
    }
    if (customUAResetBtn) {
      customUAResetBtn.addEventListener('click', function() {
        if (customUAInput) customUAInput.value = defaultCustomUA;
        localStorage.setItem('customUA', defaultCustomUA);
        if (customUAToggle && customUAToggle.checked && API && API.setCustomUA) {
          API.setCustomUA(defaultCustomUA);
          showUARestart();
        }
      });
    }

    var customUARestartItem = $('custom-ua-restart-item');
    var customUARestartBtn = $('custom-ua-restart-btn');
    if (customUARestartBtn && API && API.relaunchApp) {
      customUARestartBtn.addEventListener('click', function() {
        API.relaunchApp();
      });
    }
    function showUARestart() {
      if (customUARestartItem) customUARestartItem.style.display = '';
    }

    var mmdAutoLoadToggle = $('mmd-auto-load-toggle');
    if (mmdAutoLoadToggle) {
      mmdAutoLoadToggle.checked = localStorage.getItem('mmdAutoLoadEnabled') !== 'false';
      mmdAutoLoadToggle.addEventListener('change', function() {
        localStorage.setItem('mmdAutoLoadEnabled', this.checked);
      });
    }

    var mmdPreviewTimeoutInput = $('mmd-preview-timeout-input');
    if (mmdPreviewTimeoutInput) {
      mmdPreviewTimeoutInput.value = localStorage.getItem('mmdPreviewTimeout') || '5';
      mmdPreviewTimeoutInput.addEventListener('change', function() {
        var val = Math.max(1, Math.min(60, parseInt(this.value) || 5));
        this.value = val;
        localStorage.setItem('mmdPreviewTimeout', String(val));
      });
    }

    var mmdCameraZoomInput = $('mmd-camera-zoom-input');
    if (mmdCameraZoomInput) {
      mmdCameraZoomInput.value = localStorage.getItem('mmdCameraZoom') || '1.15';
      mmdCameraZoomInput.addEventListener('change', function() {
        var val = Math.max(0.5, Math.min(5.0, parseFloat(this.value) || 1.15));
        this.value = val.toFixed(2);
        localStorage.setItem('mmdCameraZoom', String(val));
      });
    }

    var devToolsBtn = $('open-devtools-btn');
    if (devToolsBtn && API && API.openDevTools) {
      devToolsBtn.addEventListener('click', function() {
        API.openDevTools();
      });
    }

    var devPanelShortcutToggle = $('dev-panel-shortcut-toggle');
    if (devPanelShortcutToggle && API && API.setDevPanelShortcutEnabled) {
      devPanelShortcutToggle.checked = localStorage.getItem('devPanelShortcutEnabled') !== 'false';
      devPanelShortcutToggle.addEventListener('change', function() {
        var enabled = this.checked;
        localStorage.setItem('devPanelShortcutEnabled', enabled);
        API.setDevPanelShortcutEnabled(enabled);
      });
    }

    var devPanelShortcutInput = $('dev-panel-shortcut-input');
    var defaultDevPanelShortcut = 'Ctrl+Alt+Shift+I';
    if (devPanelShortcutInput && API && API.setDevPanelShortcutKey) {
      devPanelShortcutInput.value = localStorage.getItem('devPanelShortcutKey') || defaultDevPanelShortcut;
      devPanelShortcutInput.addEventListener('keydown', function(e) {
        e.preventDefault();
        var parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');
        var key = e.key;
        if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return;
        if (key.length === 1 || key.startsWith('F')) {
          parts.push(key.length === 1 ? key.toUpperCase() : key);
          this.value = parts.join('+');
        }
      });
      devPanelShortcutInput.addEventListener('blur', function() {
        var val = this.value.trim();
        if (!val) { this.value = defaultDevPanelShortcut; return; }
        localStorage.setItem('devPanelShortcutKey', val);
        API.setDevPanelShortcutKey(val);
      });
      devPanelShortcutInput.addEventListener('focus', function() {
        this.value = '';
      });
    }

    var extShortcutToggle = $('ext-shortcut-toggle');
    if (extShortcutToggle) {
      extShortcutToggle.checked = localStorage.getItem('extShortcutEnabled') !== 'false';
      extShortcutToggle.addEventListener('change', function() {
        var enabled = this.checked;
        localStorage.setItem('extShortcutEnabled', enabled);
        if (API && API.setExtShortcutEnabled) API.setExtShortcutEnabled(enabled);
      });
    }

    var extShortcutInput = $('ext-shortcut-input');
    var defaultExtShortcut = 'Ctrl+Alt+Shift+X';
    if (extShortcutInput) {
      extShortcutInput.value = localStorage.getItem('extShortcutKey') || defaultExtShortcut;
      extShortcutInput.addEventListener('keydown', function(e) {
        e.preventDefault();
        var parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');
        var key = e.key;
        if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return;
        if (key.length === 1 || key.startsWith('F')) {
          parts.push(key.length === 1 ? key.toUpperCase() : key);
          this.value = parts.join('+');
        }
      });
      extShortcutInput.addEventListener('blur', function() {
        var val = this.value.trim();
        if (!val) { this.value = defaultExtShortcut; return; }
        localStorage.setItem('extShortcutKey', val);
        if (API && API.setExtShortcutKey) API.setExtShortcutKey(val);
      });
      extShortcutInput.addEventListener('focus', function() {
        this.value = '';
      });
    }

    if (API && API.onExtShortcutTriggered) {
      API.onExtShortcutTriggered(function() {
        var tog = $('window-clickthrough-toggle');
        if (!tog) return;
        var enabled = !tog.checked;
        tog.checked = enabled;
        if (API && API.setWindowClickThrough) API.setWindowClickThrough(enabled);
        showToast('穿透点击', enabled ? '已启用' : '已禁用', 'info', 2000);
      });
    }

    if (API && API.onBrowserHideShortcutTriggered) {
      API.onBrowserHideShortcutTriggered(function() {
        var tabbar = document.querySelector('#page-browser .browser-tabbar');
        var addrbar = document.querySelector('#page-browser .browser-addressbar');
        if (!tabbar && !addrbar) return;
        var isHidden = tabbar && tabbar.style.display === 'none';
        if (tabbar) tabbar.style.display = isHidden ? '' : 'none';
        if (addrbar) addrbar.style.display = isHidden ? '' : 'none';
        showToast('浏览器', isHidden ? '标签页栏和搜索栏已显示' : '标签页栏和搜索栏已隐藏', 'info', 2000);
      });
    }

    var opacityShortcutToggle = $('opacity-shortcut-toggle');
    if (opacityShortcutToggle && API && API.setOpacityShortcutEnabled) {
      opacityShortcutToggle.checked = localStorage.getItem('opacityShortcutEnabled') !== 'false';
      opacityShortcutToggle.addEventListener('change', function() {
        var enabled = this.checked;
        localStorage.setItem('opacityShortcutEnabled', enabled);
        API.setOpacityShortcutEnabled(enabled);
      });
    }

    var darkModeShortcutToggle = $('dark-mode-shortcut-toggle');
    if (darkModeShortcutToggle && API && API.setDarkModeShortcutEnabled) {
      darkModeShortcutToggle.checked = localStorage.getItem('darkModeShortcutEnabled') !== 'false';
      darkModeShortcutToggle.addEventListener('change', function() {
        var enabled = this.checked;
        localStorage.setItem('darkModeShortcutEnabled', enabled);
        API.setDarkModeShortcutEnabled(enabled);
      });
    }

    if (API && API.onWindowOpacityChanged) {
      API.onWindowOpacityChanged(function(val) {
        var pct = Math.round(val * 100);
        var dSlider = $('window-opacity-slider');
        var dVal = $('window-opacity-value');
        var aSlider = $('appearance-window-opacity-slider');
        var aVal = $('appearance-window-opacity-value');
        if (dSlider) dSlider.value = pct;
        if (dVal) dVal.textContent = pct + '%';
        if (aSlider) aSlider.value = pct;
        if (aVal) aVal.textContent = pct + '%';
      });
    }

    // 设置成默认浏览器
    var setDefaultBrowserBtn = $('set-default-browser-btn');
    if (setDefaultBrowserBtn) {
      setDefaultBrowserBtn.addEventListener('click', async () => {
        if (!window.electronAPI) return showToast('错误', 'API 不可用', 'error');
        var result = await window.electronAPI.setAsDefaultBrowser();
        if (result && result.success) {
          window.electronAPI.openExternal('ms-settings:defaultapps');
          showToast('请选择默认浏览器', '在打开的设置页面中找到"作业上传系统"并设为默认浏览器', 'info', 8000);
        } else {
          var errMsg = (result && result.errors && result.errors.length) ? result.errors.join('; ') : '未知错误';
          showToast('注册失败', errMsg, 'error', 8000);
          console.error('[App] setDefaultBrowser errors:', result && result.errors);
        }
      });
    }

    $('global-shortcut-toggle').addEventListener('change', () => {
      const enabled = $('global-shortcut-toggle').checked;
      localStorage.setItem('globalShortcutEnabled', enabled);
      if (API && API.setGlobalShortcutEnabled) API.setGlobalShortcutEnabled(enabled);
    });

    $('disable-shake-toggle').checked = disableShake;
    $('disable-shake-toggle').addEventListener('change', () => {
      disableShake = $('disable-shake-toggle').checked;
      localStorage.setItem('disableShake', disableShake);
    });
    $('disable-call-toggle').checked = disableCall;
    $('disable-call-toggle').addEventListener('change', () => {
      disableCall = $('disable-call-toggle').checked;
      localStorage.setItem('disableCall', disableCall);
    });

    $('show-search-tab-toggle').checked = enableSearchTab;
    $('show-search-tab-toggle').addEventListener('change', () => {
      enableSearchTab = $('show-search-tab-toggle').checked;
      localStorage.setItem('showSearchTab', enableSearchTab);
      applySidebarVisibility();
    });

    $('show-appearance-tab-toggle').checked = showAppearanceTab;
    $('show-appearance-tab-toggle').addEventListener('change', () => {
      showAppearanceTab = $('show-appearance-tab-toggle').checked;
      localStorage.setItem('showAppearanceTab', showAppearanceTab);
      applySidebarVisibility();
    });

    $('show-browser-tab-toggle').checked = showBrowserTab;
    $('show-browser-tab-toggle').addEventListener('change', () => {
      showBrowserTab = $('show-browser-tab-toggle').checked;
      localStorage.setItem('showBrowserTab', showBrowserTab);
      applySidebarVisibility();
    });

    $('show-announcements-tab-toggle').checked = showAnnouncementsTab;
    $('show-announcements-tab-toggle').addEventListener('change', () => {
      showAnnouncementsTab = $('show-announcements-tab-toggle').checked;
      localStorage.setItem('showAnnouncementsTab', showAnnouncementsTab);
      applySidebarVisibility();
    });

    $('show-xxt-tab-toggle').checked = showXxtTab;
    $('show-xxt-tab-toggle').addEventListener('change', () => {
      showXxtTab = $('show-xxt-tab-toggle').checked;
      localStorage.setItem('showXxtTab', showXxtTab);
      applySidebarVisibility();
    });

    $('show-python-tab-toggle').checked = showPythonTab;
    $('show-python-tab-toggle').addEventListener('change', () => {
      showPythonTab = $('show-python-tab-toggle').checked;
      localStorage.setItem('showPythonTab', showPythonTab);
      applySidebarVisibility();
    });

    $('show-mmd-tab-toggle').checked = showMmdTab;
    $('show-mmd-tab-toggle').addEventListener('change', () => {
      showMmdTab = $('show-mmd-tab-toggle').checked;
      localStorage.setItem('showMmdTab', showMmdTab);
      applySidebarVisibility();
    });

    $('limit-min-size-toggle').checked = limitMinSize;
    if (!limitMinSize) {
      $('min-height-item').style.display = '';
      $('min-width-item').style.display = '';
      $('min-height-slider').value = _minHeight;
      $('min-width-slider').value = _minWidth;
      $('min-height-value').textContent = _minHeight;
      $('min-width-value').textContent = _minWidth;
    }
    $('limit-min-size-toggle').addEventListener('change', async function() {
      var checked = this.checked;
      if (!checked) {
        var ok = await showConfirm('注意', '窗口分辨率过小可能会导致显示错误等问题');
        if (!ok) {
          this.checked = true;
          return;
        }
      }
      limitMinSize = checked;
      localStorage.setItem('limitMinSize', checked);
      $('min-height-item').style.display = checked ? 'none' : '';
      $('min-width-item').style.display = checked ? 'none' : '';
      if (checked) {
        if (API && API.setMinSize) API.setMinSize(900, 620);
      } else {
        if (API && API.setMinSize) API.setMinSize(_minWidth, _minHeight);
      }
    });

    $('min-height-slider').addEventListener('input', function() {
      _minHeight = parseInt(this.value);
      $('min-height-value').textContent = _minHeight;
      localStorage.setItem('customMinHeight', _minHeight);
      if (!limitMinSize && API && API.setMinSize) API.setMinSize(_minWidth, _minHeight);
    });
    $('min-width-slider').addEventListener('input', function() {
      _minWidth = parseInt(this.value);
      $('min-width-value').textContent = _minWidth;
      localStorage.setItem('customMinWidth', _minWidth);
      if (!limitMinSize && API && API.setMinSize) API.setMinSize(_minWidth, _minHeight);
    });

    const shortcutInput = $('shortcut-input');
    const defaultShortcut = 'Ctrl+Alt+Shift+Z';
    shortcutInput.value = localStorage.getItem('globalShortcutKey') || defaultShortcut;

    shortcutInput.addEventListener('keydown', (e) => {
      e.preventDefault();
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      const key = e.key;
      if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return;
      if (key.length === 1 || key.startsWith('F')) {
        parts.push(key.length === 1 ? key.toUpperCase() : key);
        shortcutInput.value = parts.join('+');
      }
    });
    shortcutInput.addEventListener('blur', () => {
      const val = shortcutInput.value.trim();
      if (!val) { shortcutInput.value = defaultShortcut; return; }
      localStorage.setItem('globalShortcutKey', val);
      if (API && API.setGlobalShortcutKey) API.setGlobalShortcutKey(val);
    });
    shortcutInput.addEventListener('focus', () => {
      shortcutInput.value = '';
    });

    $('learning-toggle').addEventListener('click', () => {
      const card = $('learning-info');
      const hidden = card.classList.toggle('info-hidden');
      const btn = $('learning-toggle');
      btn.title = hidden ? '显示敏感信息' : '隐藏敏感信息';
      btn.querySelector('i').className = hidden ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      const textSpan = btn.querySelector('#learning-toggle-text');
      if (textSpan) textSpan.textContent = hidden ? '显示' : '隐藏';
      toggleLearningSensitive(hidden);
    });

    $('check-update-btn').addEventListener('click', () => checkForUpdate(false));
    $('check-beta-update-btn').addEventListener('click', () => checkForBetaUpdate());
    
    var betaToggle = $('beta-update-toggle');
    if (betaToggle) {
      betaToggle.checked = betaUpdateEnabled;
      betaToggle.addEventListener('change', function() {
        betaUpdateEnabled = this.checked;
        localStorage.setItem('betaUpdateEnabled', betaUpdateEnabled);
      });
    }

    $('search-btn').addEventListener('click', searchHomework);
    $('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchHomework();
    });

    $('clear-downloads').addEventListener('click', () => {
      downloadHistory = downloadHistory.filter(item => item.category === 'update');
      localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
      renderDownloadList();
      showToast('已清空', '下载记录已清除', 'info');
    });

    apiFetchSilent = true;
    loadHomeData();
    loadWeather();

    if (token) {
      loadUserInfo();
    } else {
      showLoginModal();
    }
    setTimeout(function() { apiFetchSilent = false; }, 5000);

    renderDownloadList();
    renderAppearancePage();
  }

  // ==================== 浏览器 ====================
  let browserTabs = JSON.parse(localStorage.getItem('browserTabs') || '[]');
  // Clean up stale about:blank URLs and backticks from previous sessions
  browserTabs = browserTabs.map(t => ({ ...t, url: (t.url && t.url !== 'about:blank') ? t.url.replaceAll('\x60', '') : '' }));
  let activeTabId = null;
  let browserHistory = JSON.parse(localStorage.getItem('browserHistory') || '[]');

  let xxtTabs = [];
  let xxtActiveTabId = null;

  const XxtUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) cxstudy/1.4.2 Chrome/126.0.6478.234 Electron/31.6.0 Safari/537.36 osVersion_10.0.26200 osArch_0 (schild:87d6ef89e0106fcbbceb33718d1eb91c) (device:x64) Language/zh_CN com.chaoxing.cxstudy/ChaoXingStudy_1000371_1.4.2_windows_pc';
  let xxtPreloadPath = '';
  API.getXxtPreloadPath().then(function(p) { xxtPreloadPath = p; console.log('[XXT] preload path:', p); });

  // 环信 IM SDK
  var WebIM = null;
  var easemobConn = null;
  var easemobReady = false;
  var easemobUserId = '';
  var easemobToken = '';
  var easemobConversations = [];
  var easemobContacts = [];
  var easemobActiveConvId = null;
  var easemobNicknameMap = {};
  try { easemobNicknameMap = JSON.parse(localStorage.getItem('easemobNicknameMap') || '{}'); } catch(e) {}
  var easemobChatStarted = false;
  var easemobMessages = (function() {
    try {
      var saved = localStorage.getItem('easemobMessages');
      if (saved) { var parsed = JSON.parse(saved); console.log('[Easemob] 从 localStorage 加载了历史消息, 会话数:', Object.keys(parsed).length); return parsed; }
    } catch(e) { console.error('[Easemob] 加载历史消息失败:', e); }
    return {};
  })();

  function saveEasemobMessages() {
    try {
      localStorage.setItem('easemobMessages', JSON.stringify(easemobMessages));
    } catch(e) { console.error('[Easemob] 保存历史消息失败:', e); }
  }
  var EASEMOB_APP_KEY = 'cx-dev#cxstudy';

  function initEasemobSDK() {
    try {
      var sdk = window.websdk;
      if (!sdk) { console.error('[Easemob] SDK 未加载，window.websdk 为 undefined'); return false; }
      console.log('[Easemob] SDK keys:', Object.keys(sdk));
      if (sdk.default) { console.log('[Easemob] SDK.default keys:', Object.keys(sdk.default)); sdk = sdk.default; }
      WebIM = sdk;
      if (!WebIM || !WebIM.connection) throw new Error('SDK 缺少 connection，keys=' + Object.keys(WebIM || {}).join(','));
      console.log('[Easemob] SDK 加载成功');
    } catch (e) { console.error('[Easemob] SDK 加载失败:', e); return false; }
    return true;
  }

  function easemobConnect(userId, tokenOrPwd, isPassword) {
    return new Promise(function(resolve, reject) {
      if (!WebIM && !initEasemobSDK()) { reject(new Error('SDK 加载失败')); return; }
      console.log('[Easemob] 尝试连接，appKey:', EASEMOB_APP_KEY, 'user:', userId, isPassword ? '(密码方式)' : '(token方式)');
      if (easemobConn && easemobConn.isOpened && easemobConn.isOpened()) {
        easemobConn.close();
        easemobConn = null;
      }
      easemobConn = new WebIM.connection({
        appKey: EASEMOB_APP_KEY,
        isMultiLoginSessions: true,
        https: true
      });
      easemobConn.addEventHandler('EASEMOB_EVENTS', {
        onConnected: function() {
          console.log('[Easemob] 连接成功');
          easemobReady = true;
          if (isPassword && easemobConn && easemobConn.context && easemobConn.context.accessToken) {
            easemobToken = easemobConn.context.accessToken;
          }
          console.log('[Easemob] 已存储 userId=' + easemobUserId + ', token长度=' + (easemobToken ? easemobToken.length : 0));
          resolve(easemobConn);
        },
        onDisconnected: function() { console.log('[Easemob] 断开连接'); easemobReady = false; },
        onError: function(err) { console.error('[Easemob] 错误:', err); },
        onTokenExpired: function() { console.log('[Easemob] Token 过期'); easemobReady = false; },
        onContactInvited: function(msg) {
          console.log('[Easemob] 收到好友请求:', JSON.stringify(msg));
          var fromName = easemobNicknameMap[msg.from] || msg.from;
          showToast('好友请求', fromName + ' 关注了你', 'info', 4000);
          // 自动同意
          easemobConn.acceptContactInvite(msg.from).then(function() {
            console.log('[Easemob] 已自动同意好友请求:', msg.from);
          }).catch(function(err) {
            console.error('[Easemob] 同意好友请求失败:', err);
          });
        },
        onContactAdded: function(msg) {
          console.log('[Easemob] 好友添加成功:', JSON.stringify(msg));
          var fromName = easemobNicknameMap[msg.from] || msg.from;
          showToast('好友已添加', fromName + ' 已成为好友', 'success', 3000);
        },
        onContactAgreed: function(msg) {
          console.log('[Easemob] 好友请求被同意:', JSON.stringify(msg));
          var fromName = easemobNicknameMap[msg.from] || msg.from;
          showToast('好友已同意', fromName + ' 同意了你的好友请求', 'success', 3000);
        },
        onContactRefuse: function(msg) {
          console.log('[Easemob] 好友请求被拒绝:', JSON.stringify(msg));
          var fromName = easemobNicknameMap[msg.from] || msg.from;
          showToast('好友请求', fromName + ' 拒绝了你的好友请求', 'info', 3000);
        },
        onTextMessage: function(msg) {
          console.log('[Easemob] 收到文本消息, keys:', Object.keys(msg).join(','), 'chatType:', msg.chatType);
          // 群聊用 msg.to（群ID），单聊用 msg.from（对方ID）
          var convId = (msg.chatType === 'groupChat') ? msg.to : msg.from;
          if (convId && convId.indexOf('@easemob.com') < 0) {
            convId = 'cx-dev#cxstudy_' + convId + '@easemob.com';
          }
          console.log('[Easemob] 消息体:', JSON.stringify(msg).substring(0, 500), ', convId=' + convId);
          // RTC 来电检测
          if (msg.ext && msg.ext.msgType === 'rtcCallWithAgora' && msg.ext.action === 'invite') {
            console.log('[Easemob] 收到RTC来电(完整):', JSON.stringify(msg));
            console.log('[Easemob] 收到RTC来电 ext:', JSON.stringify(msg.ext).substring(0, 500));
            if (disableCall) { console.log('[Easemob] 已禁用通话来电，忽略'); return; }
            var callerName = (msg.ext.em_apns_ext && msg.ext.em_apns_ext.em_push_title) || easemobNicknameMap[msg.from] || msg.from;
            currentCallInfo = { callerId: msg.from, callId: msg.ext.callId, callerDevId: msg.ext.callerDevId, channelName: msg.ext.channelName };
            // 从 channelName 中提取对方 PUID
            if (msg.ext.channelName) {
              var chParts = msg.ext.channelName.split('_');
              if (chParts.length === 2 && chParts[1] === xxtMyPuid) {
                easemobPuidMap[msg.from] = chParts[0];
                try { localStorage.setItem('easemobPuidMap', JSON.stringify(easemobPuidMap)); } catch(e) {}
                console.log('[Easemob] 从channelName提取PUID: ' + msg.from + ' -> ' + chParts[0]);
              }
            }
            if (!easemobMessages[convId]) easemobMessages[convId] = [];
            easemobMessages[convId].push({
              id: 'sys_call_' + (msg.ext.callId || msg.id),
              from: 'system',
              msg: '来自' + callerName + '的语音聊天邀请',
              time: msg.time || Date.now(),
              sent: null,
              system: true
            });
            saveEasemobMessages();
            if (convId === easemobActiveConvId) renderEasemobMessages(convId);
            loadEasemobConversations();
            if (typeof API !== 'undefined' && API.showCallWindow) {
              var incChannelName = msg.ext.channelName || '';
              currentRtcToken = '006b2b0c8ac40c54858a043d7687ce75b54IAB/0UZ01OTzBSi8FI/5mbdwLe6Z/tHM5DeqOYv4dFKPvGSs8TjveDeAIgBaBYdQL6eUagQAAQAAAAAAAgAAAAAAAwAAAAAABAAAAAAA';
              API.showCallWindow({ callerName: callerName, callerId: msg.from, callId: msg.ext.callId, channelName: incChannelName, localUid: xxtMyPuid, agoraToken: currentRtcToken, agoraAppId: currentRtcAppId });
            }
            return;
          }
          // 更新会话昵称 & 持久化昵称映射 / PUID映射
          if (msg.ext && msg.ext.em_apns_ext && msg.ext.em_apns_ext.em_push_title) {
            var pushTitle = msg.ext.em_apns_ext.em_push_title;
            var rawUid = msg.from.replace(/@easemob\.com$/, '');
            easemobNicknameMap[rawUid] = pushTitle;
            try { localStorage.setItem('easemobNicknameMap', JSON.stringify(easemobNicknameMap)); } catch(e) {}
            for (var ni = 0; ni < easemobConversations.length; ni++) {
              if (easemobConversations[ni].conversationId === convId) {
                easemobConversations[ni].nickname = pushTitle;
                break;
              }
            }
          }
          if (msg.ext && msg.ext.fromPuid) {
            var rawUid2 = msg.from.replace(/@easemob\.com$/, '');
            easemobPuidMap[rawUid2] = msg.ext.fromPuid;
            try { localStorage.setItem('easemobPuidMap', JSON.stringify(easemobPuidMap)); } catch(e) {}
          }
          // 窗口抖动
          if (msg.ext && msg.ext.windowShake) {
            console.log('[Easemob] 收到窗口抖动, from:', msg.from);
            if (disableShake) { console.log('[Easemob] 已禁用抖动窗口，忽略'); return; }
            var shakeSenderName = (msg.ext && msg.ext.em_apns_ext && msg.ext.em_apns_ext.em_push_title) || easemobNicknameMap[msg.from] || msg.from;
            if (!easemobMessages[convId]) easemobMessages[convId] = [];
            easemobMessages[convId].push({
              id: 'sys_shake_' + (msg.id || Date.now()),
              from: 'system',
              msg: shakeSenderName + '抖了抖你',
              time: msg.time || Date.now(),
              sent: null,
              system: true
            });
            saveEasemobMessages();
            if (convId === easemobActiveConvId) renderEasemobMessages(convId);
            loadEasemobConversations();
            if (typeof API !== 'undefined' && API.shakeWindow) {
              API.shakeWindow();
            }
            switchPage('xxt');
            $('xxt-webview-container').style.display = 'none';
            $('xxt-chat-panel').style.display = '';
            easemobActiveConvId = convId;
            renderEasemobConversations();
            renderEasemobMessages(convId);
            $('xxt-chat-placeholder').style.display = 'none';
            $('xxt-chat-messages').style.display = '';
            $('xxt-chat-input-area').style.display = '';
            return;
          }
          if (!easemobMessages[convId]) easemobMessages[convId] = [];
          easemobMessages[convId].push({
            id: msg.id,
            from: msg.from,
            fromName: (msg.ext && msg.ext.em_apns_ext && msg.ext.em_apns_ext.em_push_title) || '',
            msg: msg.msg || msg.data || msg.payload || msg.body || JSON.stringify(msg),
            time: msg.time || msg.timestamp || Date.now(),
            sent: false
          });
          saveEasemobMessages();
          if (convId === easemobActiveConvId) renderEasemobMessages(convId);
          loadEasemobConversations();
        },
        onImageMessage: function(msg) {
          console.log('[Easemob] 收到图片消息:', msg, 'chatType:', msg.chatType);
          var convId = (msg.chatType === 'groupChat') ? msg.to : msg.from;
          if (convId && convId.indexOf('@easemob.com') < 0) {
            convId = 'cx-dev#cxstudy_' + convId + '@easemob.com';
          }
          if (!easemobMessages[convId]) easemobMessages[convId] = [];
          easemobMessages[convId].push({ id: msg.id, from: msg.from, msg: '[图片]', time: msg.time || msg.timestamp || Date.now(), sent: false, url: msg.url || msg.uri });
          saveEasemobMessages();
          if (convId === easemobActiveConvId) renderEasemobMessages(convId);
          loadEasemobConversations();
        },
        onCmdMessage: function(msg) {
          console.log('[Easemob] 收到CMD消息:', JSON.stringify(msg).substring(0, 300));
          // 我方发起的通话：对方已收到（alert），加入Agora开始通话
          if (msg.ext && msg.ext.msgType === 'rtcCallWithAgora' && msg.ext.action === 'alert' && pendingOutgoingCall) {
            var alertCallId = msg.ext.callId;
            if (alertCallId === pendingOutgoingCall.callId) {
              var toName = pendingOutgoingCall.toName || pendingOutgoingCall.toUserId || '对方';
              console.log('[Easemob] 对方已收到通话邀请, 开始通话');
              showToast(toName, '对方已接听，开始通话', 'success', 2000);
              if (typeof API !== 'undefined' && API.showCallWindow) {
                API.showCallWindow({
                  callerName: toName,
                  callerId: pendingOutgoingCall.toUserId,
                  callId: alertCallId,
                  channelName: pendingOutgoingCall.channelName || '',
                  localUid: xxtMyPuid,
                  isOutgoing: true,
                  agoraToken: currentRtcToken,
                  agoraAppId: currentRtcAppId
                });
              }
              pendingOutgoingCall = null;
            }
            return;
          }
          // 对方取消通话
          if (msg.ext && msg.ext.msgType === 'rtcCallWithAgora' && msg.ext.action === 'cancelCall') {
            // 我方发起的通话被对方拒绝
            if (pendingOutgoingCall && msg.ext.callId === pendingOutgoingCall.callId) {
              var toName2 = pendingOutgoingCall.toName || pendingOutgoingCall.toUserId || '对方';
              showToast('通话结束', toName2 + '已拒绝通话', 'info', 3000);
              if (pendingOutgoingCall.cancelTimer) { clearTimeout(pendingOutgoingCall.cancelTimer); }
              pendingOutgoingCall = null;
              return;
            }
            console.log('[Easemob] 对方取消通话, 关闭通话窗口');
            if (typeof API !== 'undefined' && API.closeCallWindow) {
              API.closeCallWindow();
            }
            return;
          }
          // 收到通话邀请（CMD类型，兼容原版学习通）
          if (msg.action === 'rtcCall' && msg.ext && msg.ext.action === 'invite') {
            console.log('[Easemob] 收到CMD通话邀请:', JSON.stringify(msg.ext).substring(0, 300));
            if (disableCall) { console.log('[Easemob] 已禁用通话来电，忽略'); return; }
            var cmdCallerName = (msg.ext.em_apns_ext && msg.ext.em_apns_ext.em_push_title) || easemobNicknameMap[msg.from] || msg.from;
            currentCallInfo = { callerId: msg.from, callId: msg.ext.callId, callerDevId: msg.ext.callerDevId, channelName: msg.ext.channelName };
            if (typeof API !== 'undefined' && API.showCallWindow) {
              API.showCallWindow({ callerName: cmdCallerName, callerId: msg.from, callId: msg.ext.callId, channelName: msg.ext.channelName, localUid: xxtMyPuid });
            }
            return;
          }
          // 窗口抖动
          if (msg.ext && msg.ext.action === 'shake') {
            console.log('[Easemob] 收到窗口抖动, from:', msg.from);
            var cmdShakeSenderName = (msg.ext && msg.ext.em_apns_ext && msg.ext.em_apns_ext.em_push_title) || easemobNicknameMap[msg.from] || msg.from;
            var cmdShakeConvId = (msg.from && msg.from.indexOf('@easemob.com') >= 0) ? msg.from : ('cx-dev#cxstudy_' + msg.from + '@easemob.com');
            if (!easemobMessages[cmdShakeConvId]) easemobMessages[cmdShakeConvId] = [];
            easemobMessages[cmdShakeConvId].push({
              id: 'sys_shake_' + (msg.id || Date.now()),
              from: 'system',
              msg: cmdShakeSenderName + '抖了抖你',
              time: Date.now(),
              sent: null,
              system: true
            });
            saveEasemobMessages();
            if (typeof API !== 'undefined' && API.shakeWindow) {
              API.shakeWindow();
            }
            switchPage('xxt');
            $('xxt-webview-container').style.display = 'none';
            $('xxt-chat-panel').style.display = '';
            easemobActiveConvId = cmdShakeConvId;
            renderEasemobConversations();
            renderEasemobMessages(cmdShakeConvId);
            $('xxt-chat-placeholder').style.display = 'none';
            $('xxt-chat-messages').style.display = '';
            $('xxt-chat-input-area').style.display = '';
            return;
          }
        }
      });
      var openParams = { user: userId };
      if (isPassword) {
        openParams.pwd = tokenOrPwd;
      } else {
        openParams.accessToken = tokenOrPwd;
      }
      easemobUserId = userId;
      if (!isPassword) { easemobToken = tokenOrPwd; }
      openParams.success = function() { console.log('[Easemob] open success'); };
      openParams.error = function(err) { console.error('[Easemob] open error:', err); reject(err); };
      easemobConn.open(openParams);
    });
  }

  function loadEasemobConversations() {
    if (!easemobConn || !easemobReady) return;
    easemobConn.getConversationlist().then(function(res) {
      var resStr = JSON.stringify(res);
      console.log('[Easemob] getConversationlist 原始响应(前2000):', resStr.substring(0, 2000));
      if (resStr.length > 2000) console.log('[Easemob] 原始响应(后500):', resStr.substring(resStr.length - 500));
      var raw = null;
      if (res && res.data && Array.isArray(res.data.channel_infos)) raw = res.data.channel_infos;
      else if (res && res.data && Array.isArray(res.data)) raw = res.data;
      else if (res && Array.isArray(res.channel_infos)) raw = res.channel_infos;
      else if (res && typeof res === 'object') {
        var keys = Object.keys(res);
        console.log('[Easemob] 顶层keys:', keys.join(','));
        for (var i = 0; i < keys.length; i++) {
          var v = res[keys[i]];
          if (Array.isArray(v)) { raw = v; break; }
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (var j = 0; j < Object.keys(v).length; j++) {
              var sk = Object.keys(v)[j];
              if (Array.isArray(v[sk])) { raw = v[sk]; break; }
            }
            if (raw) break;
          }
        }
      }
      if (!raw) raw = [];
      var seenConvIds = {};
      easemobConversations = [];
      raw.forEach(function(c) {
        var lastMsg = c.lastMessage || {};
        var lastMsgExt = lastMsg.ext || {};
        var convExt = c.ext || {};
        var myId = (easemobConn && easemobConn.context && easemobConn.context.userId) || '';
        var lastMsgFromMe = (lastMsg.from === myId);
        var nickname = '';
        if (lastMsg.chatType !== 'groupChat') {
          // 单聊：只从对方发的消息中提取昵称
          if (!lastMsgFromMe) {
            nickname = (lastMsgExt.em_apns_ext && lastMsgExt.em_apns_ext.em_push_title) || '';
          }
          if (!nickname) nickname = (convExt.em_apns_ext && convExt.em_apns_ext.em_push_title) || '';
          if (!nickname) { var chId = c.channel_id || ''; var m2 = chId.match(/cx-dev#cxstudy_([^@]+)/); if (m2) { var rawUid = m2[1]; nickname = easemobNicknameMap[rawUid] || rawUid; } }
        } else {
          nickname = (convExt.em_apns_ext && convExt.em_apns_ext.em_push_title) || (lastMsgExt.em_apns_ext && lastMsgExt.em_apns_ext.em_push_title) || '';
        }
        var courseName = (lastMsgExt.classInfo && lastMsgExt.classInfo.coursename) || (convExt.classInfo && convExt.classInfo.coursename) || '';
        var isGroup = (lastMsg.chatType === 'groupChat');
        var rawId = c.channel_id || c.conversationId || c.to || '';
        var normalizedId = rawId.replace(/^(cx-dev#cxstudy_)+/, 'cx-dev#cxstudy_');
        var existing = seenConvIds[normalizedId];
        if (existing) {
          if ((c.unread_num || 0) > existing.unreadCount) {
            existing.unreadCount = c.unread_num || 0;
            existing.lastMessage = lastMsg.msg || lastMsg.data || '';
            if (!lastMsgFromMe && nickname) existing.nickname = nickname;
            existing.ext = lastMsgExt;
          }
          return;
        }
        if (!lastMsgFromMe && lastMsgExt.fromPuid && lastMsgExt.fromPuid !== xxtMyPuid) {
          var rawUidPuid = (c.channel_id || '').replace(/^(cx-dev#cxstudy_)+/, '').replace(/@easemob\.com$/, '');
          if (rawUidPuid && !easemobPuidMap[rawUidPuid]) {
            easemobPuidMap[rawUidPuid] = lastMsgExt.fromPuid;
            try { localStorage.setItem('easemobPuidMap', JSON.stringify(easemobPuidMap)); } catch(e) {}
            console.log('[Easemob] 从会话提取PUID: ' + rawUidPuid + ' -> ' + lastMsgExt.fromPuid);
          }
        }
        var conv = {
          conversationId: normalizedId,
          lastMessage: lastMsg.msg || lastMsg.data || '',
          unreadCount: c.unread_num || c.unreadCount || 0,
          nickname: nickname,
          courseName: courseName,
          isGroup: isGroup,
          ext: lastMsgExt
        };
        seenConvIds[normalizedId] = conv;
        easemobConversations.push(conv);
      });
      if (easemobActiveConvId) {
        for (var i = 0; i < easemobConversations.length; i++) {
          if (easemobConversations[i].conversationId === easemobActiveConvId) {
            easemobConversations[i].unreadCount = 0;
            break;
          }
        }
      }
      console.log('[Easemob] 会话列表:', easemobConversations.length, '个');
      if (easemobConversations.length > 0) {
        console.log('[Easemob] 首条会话:', JSON.stringify(easemobConversations[0]).substring(0, 300));
      }
      renderEasemobConversations();
    }).catch(function(err) { console.error('[Easemob] 获取会话列表失败:', err); });
  }

  function loadEasemobContacts() {
    console.log('[Easemob] loadEasemobContacts: userId=' + easemobUserId + ', token=' + (easemobToken ? '有(' + easemobToken.length + ')' : '无'));
    if (!easemobUserId || !easemobToken) {
      showToast('提示', '请先连接消息服务', 'warning', 2000);
      return;
    }
    var apiUrl = 'https://a1-vip6.easemob.com/cx-dev/cxstudy/users/' + easemobUserId + '/contacts/users';
    console.log('[Easemob] 请求好友列表:', apiUrl);
    fetch(apiUrl, {
      headers: {
        'Authorization': 'Bearer ' + easemobToken,
        'Accept': 'application/json'
      }
    }).then(function(res) {
      return res.json();
    }).then(function(data) {
      console.log('[Easemob] 好友列表响应:', JSON.stringify(data).substring(0, 1000));
      var users = [];
      if (data && data.data && Array.isArray(data.data)) {
        users = data.data;
      } else if (Array.isArray(data)) {
        users = data;
      } else if (data && data.entities && Array.isArray(data.entities)) {
        users = data.entities;
      }
      easemobContacts = users.map(function(u) {
        var userId = (typeof u === 'string') ? u : (u.username || u.userId || u.uid || '');
        return { userId: userId, remark: '' };
      });
      console.log('[Easemob] 好友数量:', easemobContacts.length);
      if (easemobContacts.length > 0) {
        renderEasemobContacts();
      } else {
        showToast('好友列表', '没有好友(可能是无法拉取学习通服务器好友列表)\n可以让对方在官方学习通给你发一条消息创建', 'info', 2000);
      }
    }).catch(function(err) {
      console.error('[Easemob] 获取好友列表失败:', err);
      showToast('获取失败', '无法获取好友列表: ' + (err.message || '网络错误'), 'error', 3000);
    });
  }

  function renderEasemobContacts() {
    var list = $('xxt-chat-conv-list');
    if (!list) return;
    if (easemobContacts.length === 0) {
      showToast('好友列表', '没有好友(可能是无法拉取学习通服务器好友列表)\n可以让对方在官方学习通给你发一条消息创建', 'info', 2000);
      return;
    }
    list.innerHTML = '<div style="padding:8px 16px;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--border);">好友 (' + easemobContacts.length + ')</div>'
      + easemobContacts.map(function(c) {
          var name = c.remark || c.userId || '';
          return '<div class="chat-conv-item" data-conv-id="' + (c.userId || '') + '" data-is-contact="1">'
            + '<div class="chat-conv-avatar">' + (name.charAt(0) || '?') + '</div>'
            + '<div class="chat-conv-info"><div class="chat-conv-name">' + name + '</div><div class="chat-conv-lastmsg">ID: ' + (c.userId || '') + '</div></div>'
            + '</div>';
        }).join('');
    list.querySelectorAll('.chat-conv-item').forEach(function(item) {
      item.onclick = function() {
        var convId = item.dataset.convId;
        if (convId && convId.indexOf('@easemob.com') < 0) {
          convId = 'cx-dev#cxstudy_' + convId + '@easemob.com';
        }
        easemobActiveConvId = convId;
        for (var i = 0; i < easemobConversations.length; i++) {
          if (easemobConversations[i].conversationId === convId) {
            easemobConversations[i].unreadCount = 0;
            break;
          }
        }
        renderEasemobConversations();
        $('xxt-chat-placeholder').style.display = 'none';
        $('xxt-chat-messages').style.display = '';
        $('xxt-chat-input-area').style.display = '';
        renderEasemobMessages(convId);
        loadEasemobHistory(convId);
      };
    });
  }

  function addEasemobContact() {
    if (!easemobConn || !easemobReady) {
      showToast('提示', '请先连接消息服务', 'warning', 2000);
      return;
    }
    var input = $('xxt-chat-search');
    var userId = input ? input.value.trim() : '';
    if (!userId) {
      showToast('提示', '请输入学习通号', 'warning', 2000);
      return;
    }
    easemobConn.addContact(userId, '我是' + (xxtMyName || '用户')).then(function() {
      console.log('[Easemob] 好友请求发送成功:', userId);
      showToast('已发送', '已向 ' + userId + ' 发送好友请求', 'success', 2000);
      input.value = '';
    }).catch(function(err) {
      console.error('[Easemob] 好友请求发送失败:', err);
      showToast('发送失败', '好友请求发送失败: ' + (err.message || '未知错误'), 'error', 3000);
    });
  }

  function loadEasemobHistory(convId) {
    if (!easemobConn || !easemobReady) return;
    // 从会话列表中查找，判断是群聊还是单聊
    var conv = null;
    for (var i = 0; i < easemobConversations.length; i++) {
      if (easemobConversations[i].conversationId === convId) { conv = easemobConversations[i]; break; }
    }
    var isGroupConv = conv && conv.isGroup;
    var chatType = isGroupConv ? 'groupChat' : 'singleChat';
    console.log('[Easemob] 请求历史消息, convId=' + convId + ', chatType=' + chatType);
    easemobConn.getHistoryMessages({
      targetId: convId,
      chatType: chatType,
      pageSize: 50,
      cursor: ''
    }).then(function(res) {
      var resStr = JSON.stringify(res);
      console.log('[Easemob] 历史消息原始响应(前1000):', resStr.substring(0, 1000));
      if (resStr.length > 1000) console.log('[Easemob] 历史消息原始响应(后500):', resStr.substring(resStr.length - 500));
      var msgs = null;
      if (res && res.data && Array.isArray(res.data.messages)) msgs = res.data.messages;
      else if (res && res.data && Array.isArray(res.data.msgs)) msgs = res.data.msgs;
      else if (res && Array.isArray(res.data)) msgs = res.data;
      else if (res && Array.isArray(res.messages)) msgs = res.messages;
      else if (res && Array.isArray(res.msgs)) msgs = res.msgs;
      else if (res && typeof res === 'object') {
        var keys = Object.keys(res);
        console.log('[Easemob] 响应顶层keys:', keys.join(','));
        for (var i = 0; i < keys.length; i++) {
          var v = res[keys[i]];
          if (Array.isArray(v)) { msgs = v; console.log('[Easemob] 从顶层key "' + keys[i] + '" 找到数组, 长度=' + v.length); break; }
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            var subKeys = Object.keys(v);
            console.log('[Easemob] 子对象 "' + keys[i] + '" keys:', subKeys.join(','));
            for (var j = 0; j < subKeys.length; j++) {
              if (Array.isArray(v[subKeys[j]])) { msgs = v[subKeys[j]]; console.log('[Easemob] 从 "' + keys[i] + '.' + subKeys[j] + '" 找到数组, 长度=' + msgs.length); break; }
            }
            if (msgs) break;
          }
        }
      }
      if (!msgs) msgs = [];
      console.log('[Easemob] 解析到消息:', msgs.length, '条');
      if (msgs.length > 0) {
        console.log('[Easemob] 首条消息示例:', JSON.stringify(msgs[0]).substring(0, 300));
      }
      var myId = (easemobConn && easemobConn.context && easemobConn.context.userId) || '';
      var histMsgs = msgs.map(function(m) {
        var msgFrom = m.from || m.sender || '';
        return {
          id: m.id || m.mid || m.msgId || '',
          from: msgFrom,
          msg: m.msg || m.data || m.payload || m.body || m.text || '',
          time: m.time || m.timestamp || m.sendTime || Date.now(),
          sent: msgFrom === myId
        };
      }).reverse();
      var existing = easemobMessages[convId] || [];
      var existingIds = {};
      existing.forEach(function(m) { if (m.id) existingIds[m.id] = true; });
      histMsgs.forEach(function(m) { if (m.id && !existingIds[m.id]) existing.push(m); });
      easemobMessages[convId] = existing;
      saveEasemobMessages();
      renderEasemobMessages(convId);
    }).catch(function(err) {
      console.error('[Easemob] 获取历史消息失败:', err);
      console.error('[Easemob] 错误详情:', err.type, err.message, err.data);
    });
  }

  function md5(str) {
    var r = function(n,c){return (n<<c)|(n>>>(32-c));};
    var x = str, bl = (x.length+8)>>6, l = bl+1, w = new Array(l*16);
    for (var i=0;i<l;i++) w[i]=new Array(16);
    for (i=0;i<x.length;i++) w[i>>2]|=x.charCodeAt(i)<<((i%4)*8);
    w[i>>2]|=0x80<<((i%4)*8);
    w[l*16-2]=x.length*8;
    var a=0x67452301,b=0xefcdab89,c=0x98badcfe,d=0x10325476;
    for (var j=0;j<l;j++){
      var aa=a,bb=b,cc=c,dd=d;
      for (var k=0;k<64;k++){
        var f,g;
        if(k<16){f=b&c|~b&d;g=k;}
        else if(k<32){f=b&d|c&~d;g=(5*k+1)%16;}
        else if(k<48){f=b^c^d;g=(3*k+5)%16;}
        else{f=c^(b|~d);g=(7*k)%16;}
        var t=d;d=c;c=b;b=b+r(a+f+w[j][g]+(k<16?0xd76aa478:k<32?0xe8c7b756:k<48?0x242070db:0xc1bdceee),1);a=t;
      }
      a+=aa;b+=bb;c+=cc;d+=dd;
    }
    var h=function(n){return('00'+(n&0xff).toString(16)).slice(-2);};
    return h(a)+h(a>>8)+h(a>>16)+h(a>>24)+h(b)+h(b>>8)+h(b>>16)+h(b>>24)+h(c)+h(c>>8)+h(c>>16)+h(c>>24)+h(d)+h(d>>8)+h(d>>16)+h(d>>24);
  }

  var currentRtcToken = '006b2b0c8ac40c54858a043d7687ce75b54IAB/0UZ01OTzBSi8FI/5mbdwLe6Z/tHM5DeqOYv4dFKPvGSs8TjveDeAIgBaBYdQL6eUagQAAQAAAAAAAgAAAAAAAwAAAAAABAAAAAAA';
  var currentRtcAppId = 'b2b0c8ac40c54858a043d7687ce75b54';

  function fetchRtcToken(channelName, callback) {
    if (!xxtMyPuid) { callback('未登录学习通'); return; }
    var _time = Date.now();
    var params = '_time=' + _time + '&channel=' + encodeURIComponent(channelName) + '&puid=' + xxtMyPuid + '&token=cxxxt1993';
    var infEnc = md5(xxtMyPuid + 'cxxxt1993' + _time + 'fa89c21a');
    var url = 'https://im.chaoxing.com/apis/meet/getTokens?' + params + '&inf_enc=' + infEnc;
    var headers = {};
    if (easemobToken) headers['Authorization'] = 'Bearer ' + easemobToken;
    console.log('[Easemob] 获取RTC Token:', url.substring(0, 200));
    fetch(url, { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        console.log('[Easemob] RTC Token响应:', JSON.stringify(data).substring(0, 500));
        if (data && data.result === 1 && data.msg) {
          callback(null, data.msg);
        } else {
          callback('Token响应无效: ' + JSON.stringify(data).substring(0, 200));
        }
      })
      .catch(function(err) {
        console.error('[Easemob] 获取RTC Token失败:', err);
        callback(err);
      });
  }

  function sendEasemobCallAction(action, callInfo) {
    if (!easemobConn || !easemobReady || !callInfo) return;
    var callerId = callInfo.callerId;
    var to = callerId.replace(/@easemob\.com$/, '');
    var id = easemobConn.getUniqueId();
    var msgData = {
      type: 'cmd',
      to: to,
      chatType: 'singleChat',
      action: 'rtcCall',
      id: id,
      ext: {
        action: action,
        callId: callInfo.callId,
        callerDevId: callInfo.callerDevId || '',
        msgType: 'rtcCallWithAgora'
      }
    };
    var msg = WebIM.message.create(msgData);
    easemobConn.send(msg).then(function(res) {
      console.log('[Easemob] 通话动作发送成功:', action, JSON.stringify(res).substring(0, 200));
    }).catch(function(err) {
      console.error('[Easemob] 通话动作发送失败:', action, err);
    });
  }

  function sendEasemobCallInvite() {
    if (!easemobConn || !easemobReady || !easemobActiveConvId) {
      showToast('提示', '请先选择一个会话', 'warning', 2000);
      return;
    }
    if (pendingOutgoingCall) {
      showToast('提示', '已有一个通话邀请等待中，请稍候', 'warning', 2000);
      return;
    }
    var rawTo = easemobActiveConvId;
    var to = rawTo.replace(/^(cx-dev#cxstudy_)+/, '').replace(/@easemob\.com$/, '');
    var activeConv = null;
    for (var i = 0; i < easemobConversations.length; i++) {
      if (easemobConversations[i].conversationId === rawTo) { activeConv = easemobConversations[i]; break; }
    }
    var toPuid = easemobPuidMap[to] || '';
    if (!toPuid && activeConv && activeConv.ext && activeConv.ext.fromPuid && activeConv.ext.fromPuid !== xxtMyPuid) {
      toPuid = activeConv.ext.fromPuid;
    }
    var callId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    var devId = Array.from({length: 64}, function() {
      return '0123456789abcdef'[Math.floor(Math.random() * 16)];
    }).join('');
    var channelName = (xxtMyPuid && toPuid) ? (xxtMyPuid + '_' + toPuid) : (xxtMyPuid + '_' + to);
    var id = easemobConn.getUniqueId();
    var toName = activeConv ? activeConv.nickname : to;
    showToast('正在呼叫', '正在向' + toName + '发起语音通话...', 'info', 3000);
      currentRtcToken = '006b2b0c8ac40c54858a043d7687ce75b54IAB/0UZ01OTzBSi8FI/5mbdwLe6Z/tHM5DeqOYv4dFKPvGSs8TjveDeAIgBaBYdQL6eUagQAAQAAAAAAAgAAAAAAAwAAAAAABAAAAAAA';
      console.log('[Easemob] 使用硬编码Token, appId=' + currentRtcAppId + ', token前20=' + currentRtcToken.substring(0, 20));
      var extData = {
        action: 'invite',
        callId: callId,
        callerDevId: devId,
        callerInfo: {
          devId: devId,
          device: 'windows',
          apiVersion: 230,
          clientVersion: '1.4.2'
        },
        channelName: channelName,
        msgType: 'rtcCallWithAgora'
      };
      extData.sdktype = 1;
      extData.ts = Date.now();
      extData.type = 0;
      var msgData = {
        type: 'txt',
        msg: '来自' + (xxtMyName || '用户') + '的语音聊天邀请',
        to: to,
        chatType: 'singleChat',
        id: id,
        ext: extData
      };
      console.log('[Easemob] 发送通话邀请 ext:', JSON.stringify(extData));
      pendingOutgoingCall = { callId: callId, toUserId: to, toName: toName, channelName: channelName };
      var msg = WebIM.message.create(msgData);
      easemobConn.send(msg).then(function(res) {
        console.log('[Easemob] 通话邀请发送成功:', JSON.stringify(res).substring(0, 200));
      }).catch(function(err) {
        console.error('[Easemob] 通话邀请发送失败:', err);
        showToast('发送失败', '通话邀请发送失败', 'error', 2000);
        pendingOutgoingCall = null;
      });
      setTimeout(function() {
        if (pendingOutgoingCall && pendingOutgoingCall.callId === callId) {
          console.log('[Easemob] 通话邀请超时未响应, 自动取消');
          if (pendingOutgoingCall.cancelTimer) { clearTimeout(pendingOutgoingCall.cancelTimer); }
          pendingOutgoingCall = null;
          currentRtcToken = '006b2b0c8ac40c54858a043d7687ce75b54IAB/0UZ01OTzBSi8FI/5mbdwLe6Z/tHM5DeqOYv4dFKPvGSs8TjveDeAIgBaBYdQL6eUagQAAQAAAAAAAgAAAAAAAwAAAAAABAAAAAAA';
          currentRtcAppId = 'b2b0c8ac40c54858a043d7687ce75b54';
        }
      }, 30000);
  }

  function sendEasemobShake() {
    if (!easemobConn || !easemobReady || !easemobActiveConvId) {
      showToast('提示', '请先选择一个会话', 'warning', 2000);
      return;
    }
    var rawTo = easemobActiveConvId;
    var to = rawTo.replace(/^(cx-dev#cxstudy_)+/, '').replace(/@easemob\.com$/, '');
    var activeConv = null;
    for (var i = 0; i < easemobConversations.length; i++) {
      if (easemobConversations[i].conversationId === rawTo) { activeConv = easemobConversations[i]; break; }
    }
    var isGroupConv = activeConv && activeConv.isGroup;
    var toPeer = isGroupConv ? ('cx-dev#cxstudy_' + to) : to;
    var id = easemobConn.getUniqueId();
    var shakeExt = { windowShake: true, time: String(Date.now()), groupMemberList: [] };
    if (xxtMyPuid) shakeExt.fromPuid = xxtMyPuid;
    if (xxtMyName) shakeExt.em_apns_ext = { em_push_title: xxtMyName, em_huawei_push_badge_class: 'com.chaoxing.mobile.activity.SplashActivity' };
    if (activeConv && activeConv.ext) {
      if (activeConv.ext.classInfo) shakeExt.classInfo = activeConv.ext.classInfo;
      if (activeConv.ext.groupMemberList) shakeExt.groupMemberList = activeConv.ext.groupMemberList;
    }
    var msgData = {
      type: 'txt',
      msg: '[窗口抖动]',
      to: toPeer,
      chatType: isGroupConv ? 'groupChat' : 'singleChat',
      id: id,
      ext: shakeExt
    };
    var msg = WebIM.message.create(msgData);
    easemobConn.send(msg).then(function(res) {
      console.log('[Easemob] 抖一抖发送成功:', JSON.stringify(res).substring(0, 200));
      showToast('已发送', '已向对方发送窗口抖动', 'success', 1500);
      if (!easemobMessages[rawTo]) easemobMessages[rawTo] = [];
      easemobMessages[rawTo].push({
        id: 'sys_shake_sent_' + Date.now(),
        from: 'system',
        msg: '你抖了抖' + (activeConv ? activeConv.nickname || to : to),
        time: Date.now(),
        sent: null,
        system: true
      });
      saveEasemobMessages();
      renderEasemobMessages(rawTo);
    }).catch(function(err) {
      console.error('[Easemob] 抖一抖发送失败:', err);
      showToast('发送失败', '窗口抖动发送失败', 'error', 2000);
    });
  }

  function sendEasemobMessage(text) {
    if (!easemobConn || !easemobReady || !easemobActiveConvId || !text.trim()) return;
    var rawTo = easemobActiveConvId;
    var to = rawTo.replace(/^(cx-dev#cxstudy_)+/, '').replace(/@easemob\.com$/, '');
    var activeConv = null;
    for (var i = 0; i < easemobConversations.length; i++) {
      if (easemobConversations[i].conversationId === rawTo) { activeConv = easemobConversations[i]; break; }
    }
    var ext = {};
    // 只有群聊（课程群）才需要附带 classInfo 和 groupMemberList
    if (activeConv && activeConv.isGroup && activeConv.ext) {
      if (activeConv.ext.classInfo) ext.classInfo = activeConv.ext.classInfo;
      if (activeConv.ext.groupMemberList) ext.groupMemberList = activeConv.ext.groupMemberList;
    }
    if (xxtMyPuid) ext.fromPuid = xxtMyPuid;
    if (xxtMyName) ext.em_apns_ext = { em_push_title: xxtMyName };
    var isGroupConv = activeConv && activeConv.isGroup;
    var hasCourse = activeConv && activeConv.ext && activeConv.ext.classInfo;
    if (hasCourse && isGroupConv && activeConv.ext) {
      if (activeConv.ext.classInfo && !ext.classInfo) ext.classInfo = activeConv.ext.classInfo;
      if (activeConv.ext.groupMemberList && !ext.groupMemberList) ext.groupMemberList = activeConv.ext.groupMemberList;
    }
    // 单聊用 用户ID@easemob.com（不带 appKey 前缀，让服务器自己加一层）
    // 群聊加前缀（群 ID 本身不带 @easemob.com）
    var toPeer = isGroupConv ? ('cx-dev#cxstudy_' + to) : to;
    console.log('[Easemob] 发送消息 to=' + toPeer + ' isGroup=' + isGroupConv + ' hasCourse=' + hasCourse + ' ext keys=' + Object.keys(ext).join(','));
    var id = easemobConn.getUniqueId();
    var msgData = {
      type: 'txt',
      msg: text.trim(),
      to: toPeer,
      chatType: isGroupConv ? 'groupChat' : 'singleChat',
      id: id
    };
    if (Object.keys(ext).length > 0) msgData.ext = ext;
    var msg = WebIM.message.create(msgData);
    easemobConn.send(msg).then(function(res) {
      console.log('[Easemob] 发送成功, res:', JSON.stringify(res).substring(0, 300));
      if (!easemobMessages[rawTo]) easemobMessages[rawTo] = [];
      easemobMessages[rawTo].push({
        id: res && res.serverMsgId || id,
        from: 'me',
        msg: text.trim(),
        time: Date.now(),
        sent: true
      });
      saveEasemobMessages();
      renderEasemobMessages(rawTo);
      $('xxt-chat-input').value = '';
      $('xxt-chat-input').focus();
      // 刷新会话列表，查看新消息的 channel_id
      setTimeout(function() {
        easemobConn.getConversationlist().then(function(convRes) {
          var convStr = JSON.stringify(convRes);
          console.log('[Easemob] 发送后会话列表(前1000):', convStr.substring(0, 1000));
          if (convRes && convRes.data && convRes.data.channel_infos) {
            for (var ci = 0; ci < convRes.data.channel_infos.length; ci++) {
              var info = convRes.data.channel_infos[ci];
              console.log('[Easemob] 发送后 channel[' + ci + ']:', info.channel_id, 'lastMsg.to:', info.lastMessage && info.lastMessage.to);
            }
          }
        }).catch(function(e) { console.error('[Easemob] 发送后刷新会话失败:', e); });
      }, 1500);
    }).catch(function(err) {
      console.error('[Easemob] 发送失败:', JSON.stringify(err));
      if (err && err.type === 603) {
        showToast('发送失败', '该课程已禁言，无法发送消息', 'error', 3000);
      } else {
        showToast('发送失败', '消息发送失败，请重试', 'error', 3000);
      }
    });
  }

  function renderEasemobConversations() {
    var list = $('xxt-chat-conv-list');
    if (!list) return;
    list.innerHTML = easemobConversations.length === 0
      ? '<div style="padding:24px;text-align:center;color:var(--text-secondary);font-size:13px;">暂无会话</div>'
      : easemobConversations.map(function(c) {
          var rawName = c.conversationId || c.to || '未知';
          var uid = rawName.replace(/^(cx-dev#cxstudy_)+/, '').replace(/@easemob\.com$/, '');
          var name = c.isGroup ? (c.courseName || c.nickname || uid) : (c.nickname || uid);
          var subtitle = c.isGroup ? (c.nickname || uid) : (c.courseName || '');
          var lastMsg = c.lastMessage ? (c.lastMessage.data || c.lastMessage.msg || '') : '';
          var unread = c.unreadCount || 0;
          return '<div class="chat-conv-item' + (c.conversationId === easemobActiveConvId ? ' active' : '') + '" data-conv-id="' + (c.conversationId || '') + '">'
            + '<div class="chat-conv-avatar">' + (name.charAt(0) || '?') + '</div>'
            + '<div class="chat-conv-info"><div class="chat-conv-name">' + name + '</div><div class="chat-conv-lastmsg">' + (lastMsg || '') + '</div></div>'
            + (unread > 0 ? '<div class="chat-conv-badge">' + (unread > 99 ? '99+' : unread) + '</div>' : '')
            + '</div>';
        }).join('');
    list.querySelectorAll('.chat-conv-item').forEach(function(item) {
      item.onclick = function() {
        var convId = item.dataset.convId;
        easemobActiveConvId = convId;
        for (var i = 0; i < easemobConversations.length; i++) {
          if (easemobConversations[i].conversationId === convId) {
            easemobConversations[i].unreadCount = 0;
            break;
          }
        }
        renderEasemobConversations();
        $('xxt-chat-placeholder').style.display = 'none';
        $('xxt-chat-messages').style.display = '';
        $('xxt-chat-input-area').style.display = '';
        renderEasemobMessages(convId);
        loadEasemobHistory(convId);
      };
    });
  }

  function renderEasemobMessages(convId) {
    var container = $('xxt-chat-messages');
    if (!container) return;
    var msgs = easemobMessages[convId] || [];
    var conv = null;
    for (var i = 0; i < easemobConversations.length; i++) {
      if (easemobConversations[i].conversationId === convId) { conv = easemobConversations[i]; break; }
    }
    var isGroupConv = conv && conv.isGroup;
    container.innerHTML = msgs.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:24px;">暂无消息</div>'
      : (function() {
          var html = '';
          var lastTime = 0;
          for (var mi = 0; mi < msgs.length; mi++) {
            var m = msgs[mi];
            if (m.system) {
              var timeStr = m.time ? new Date(m.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
              html += '<div class="chat-msg-system"><div class="chat-msg-time">' + timeStr + '</div><div class="chat-msg-system-text">' + (m.msg || '') + '</div></div>';
              continue;
            }
            var msgTime = m.time || 0;
            if (msgTime - lastTime >= 180000 || lastTime === 0) {
              var timeStr2 = m.time ? new Date(m.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
              html += '<div class="chat-msg-time">' + timeStr2 + '</div>';
              lastTime = msgTime;
            }
            var cls = m.sent ? 'chat-msg sent' : 'chat-msg received';
            var senderName = (isGroupConv && !m.sent && m.fromName) ? '<div class="chat-msg-sender">' + m.fromName + '</div>' : '';
            html += '<div class="' + cls + '">' + senderName + (m.msg || '') + '</div>';
          }
          return html;
        })();
    container.scrollTop = container.scrollHeight;
  }

  function waitForDataReady(timeoutMs) {
    return new Promise(function(resolve) {
      var start = Date.now();
      var maxWait = timeoutMs || 30000;
      function check() {
        if (userInfo && userInfo.username) {
          console.log('[Easemob] 数据就绪, username=' + userInfo.username + ', 耗时=' + (Date.now() - start) + 'ms');
          resolve(true);
          return;
        }
        if (Date.now() - start >= maxWait) {
          console.log('[Easemob] 等待数据超时(' + maxWait + 'ms)');
          resolve(false);
          return;
        }
        setTimeout(check, 500);
      }
      check();
    });
  }

  function initEasemobChat() {
    if (!initEasemobSDK()) return;
    API.getEasemobCredentials().then(function(creds) {
      if (creds && creds.huanxinId && creds.hxToken) {
        console.log('[Easemob] 找到已存储凭据:', creds.huanxinId, 'token长度:', creds.hxToken ? creds.hxToken.length : 0);
        easemobConnect(creds.huanxinId, creds.hxToken).then(function() {
          loadEasemobConversations();
        }).catch(function(err) {
          console.error('[Easemob] 自动连接失败:', err.message || err, err);
          autoLoginWithLearningInfo();
        });
      } else {
        console.log('[Easemob] 无已存储凭据，等待数据就绪...');
        waitForDataReady(30000).then(function() {
          autoLoginWithLearningInfo();
        });
      }
    }).catch(function(err) {
      console.error('[Easemob] 获取凭据失败:', err);
      waitForDataReady(30000).then(function() {
        autoLoginWithLearningInfo();
      });
    });
  }

  async function autoLoginWithLearningInfo() {
    var realName = (userInfo && userInfo.username) ? userInfo.username : '';
    if (!realName) {
      console.log('[Easemob] 未登录后端，无法获取学习通账号');
      updateChatPlaceholderMsg('请先登录作业上传系统');
      return;
    }
    try {
      console.log('[Easemob] 请求 /api/get_learning_info, real_name=' + realName);
      var info = await apiFetch('/api/get_learning_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ real_name: realName }),
        noRetry: true
      });
      if (!info || !info.account || !info.password) {
        console.log('[Easemob] 后端未返回学习通账号密码:', info);
        updateChatPlaceholderMsg('未找到 ' + realName + ' 的学习通账号');
        return;
      }
      var localCreds = null;
      try { localCreds = JSON.parse(localStorage.getItem('xxtLocalCredentials') || 'null'); } catch(e) {}
      if (localCreds && localCreds.account) {
        info.account = localCreds.account;
        if (localCreds.password) info.password = localCreds.password;
      }
      console.log('[Easemob] 获取到学习通账号:', info.account, '密码长度:', info.password.length);

      // 更新卡片说明
      updateChatPlaceholderMsg('该聊天界面为 ' + realName + ' 对应的学习通聊天账号');

      // 调用 SSO API 获取 uid 和 imAccount
      console.log('[Easemob] 调用 SSO API...');
      var ssoResult = await API.xxtSsoLoginSync({ username: info.account, password: info.password });
      var uid = (ssoResult && ssoResult.uid) || (ssoResult && ssoResult.msg && ssoResult.msg.uid);
      var imAccount = ssoResult && ssoResult.imAccount;
      if (!imAccount && ssoResult && ssoResult.msg) {
        imAccount = ssoResult.msg.imAccount || (ssoResult.msg.accountInfo && ssoResult.msg.accountInfo.imAccount);
      }
      if (uid) {
        xxtChatUid = String(uid);
        var puid = (ssoResult && ssoResult.msg && ssoResult.msg.puid) ? String(ssoResult.msg.puid) : '';
        var myName = (ssoResult && ssoResult.msg && ssoResult.msg.name) || '';
        if (puid) { xxtMyPuid = puid; console.log('[Easemob] 我的 puid=' + puid); }
        if (myName) { xxtMyName = myName; console.log('[Easemob] 我的昵称=' + myName); }
        var chatTab = xxtTabs.find(function(t) { return t.isChat; });
        if (chatTab) tryLoadCxstudyChat(chatTab);
        // 优先用 imAccount 登录环信
        if (imAccount && imAccount.username && imAccount.password) {
          console.log('[Easemob] 用 imAccount 登录: user=' + imAccount.username + ', pwd=' + imAccount.password);
          easemobConnect(imAccount.username, imAccount.password, true).then(function() {
            loadEasemobConversations();
            if (!xxtChatCxstudyPath) showToast('消息已连接', '环信消息服务已就绪', 'success', 2000);
          }).catch(function(err) {
            console.error('[Easemob] 环信登录失败(imAccount):', err);
            showPasswordChangePopup();
          });
        } else {
          console.log('[Easemob] 无 imAccount, 用学习通密码兜底...');
          var uname = (ssoResult && ssoResult.uname) || (ssoResult && ssoResult.msg && ssoResult.msg.uname);
          var easemobUser = uname || String(uid);
          easemobConnect(easemobUser, info.password, true).then(function() {
            loadEasemobConversations();
            if (!xxtChatCxstudyPath) showToast('消息已连接', '环信消息服务已就绪', 'success', 2000);
          }).catch(function(err) {
            console.error('[Easemob] 环信登录失败(兜底):', err);
            showPasswordChangePopup();
          });
        }
      } else {
        console.error('[Easemob] SSO 未返回 uid:', ssoResult);
        updateChatPlaceholderMsg('学习通登录失败: 未获取，请尝试重新登录');
      }
    } catch (err) {
      console.error('[Easemob] 自动登录失败:', err);
      updateChatPlaceholderMsg('获取学习通信息失败');
    }
  }

  function updateChatPlaceholderMsg(msg) {
    var el = $('xxt-chat-placeholder');
    if (el) {
      var div = el.querySelector('div');
      if (div) div.textContent = msg;
    }
  }

  function initLocalXxtCredsEditor() {
    var changeBtn = $('change-xxt-creds-btn');
    if (!changeBtn || changeBtn._xxtCredsInited) return;
    changeBtn._xxtCredsInited = true;
    changeBtn.addEventListener('click', function() {
      var localCreds = null;
      try { localCreds = JSON.parse(localStorage.getItem('xxtLocalCredentials') || 'null'); } catch(e) {}
      var accountEl = $('xxt-local-account');
      var unitEl = $('xxt-local-unit');
      var passwordEl = $('xxt-local-password');
      if (accountEl) accountEl.value = (localCreds && localCreds.account) || '';
      if (unitEl) unitEl.value = (localCreds && localCreds.unit) || '';
      if (passwordEl) passwordEl.value = (localCreds && localCreds.password) || '';
      $('xxt-local-creds-modal').style.display = 'flex';
    });
    $('xxt-local-creds-cancel').addEventListener('click', function() {
      $('xxt-local-creds-modal').style.display = 'none';
    });
    $('xxt-local-creds-save').addEventListener('click', function() {
      var account = ($('xxt-local-account').value || '').trim();
      var unit = ($('xxt-local-unit').value || '').trim();
      var password = $('xxt-local-password').value;
      if (!account) { showToast('提示', '请输入账号', 'warning', 2000); return; }
      var creds = { account: account };
      if (unit) creds.unit = unit;
      if (password) creds.password = password;
      localStorage.setItem('xxtLocalCredentials', JSON.stringify(creds));
      $('xxt-local-creds-modal').style.display = 'none';
      showToast('已保存', '本地学习通账户已更新，刷新主页生效', 'success', 3000);
    });
    $('xxt-local-creds-reset').addEventListener('click', function() {
      localStorage.removeItem('xxtLocalCredentials');
      $('xxt-local-creds-modal').style.display = 'none';
      showToast('已恢复', '已恢复使用服务器默认学习通账户，刷新主页生效', 'success', 3000);
    });
  }

  function showPasswordChangePopup() {
    updateChatPlaceholderMsg('你的默认密码已更改，无法连接学习通聊天频道');
    var modal = $('xxt-password-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    var input = $('xxt-password-input');
    if (input) input.value = '';
    var submitBtn = $('xxt-password-submit');
    var cancelBtn = $('xxt-password-cancel');
    var errorEl = $('xxt-password-error');
    if (errorEl) errorEl.style.display = 'none';
    var cleanup = function() {
      modal.style.display = 'none';
      if (submitBtn) submitBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
    };
    if (cancelBtn) {
      cancelBtn.onclick = function() {
        cleanup();
        updateChatPlaceholderMsg('已取消重新连接，可点击消息选项卡重试');
      };
    }
    if (submitBtn) {
      submitBtn.onclick = async function() {
        var newPwd = input ? input.value.trim() : '';
        if (!newPwd) {
          if (errorEl) { errorEl.textContent = '请输入密码'; errorEl.style.display = ''; }
          return;
        }
        cleanup();
        updateChatPlaceholderMsg('正在尝试重新连接...');
        try {
          var realName = (userInfo && userInfo.username) ? userInfo.username : '';
          var info = await apiFetch('/api/get_learning_info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ real_name: realName }),
            noRetry: true
          });
          if (!info || !info.account) {
            updateChatPlaceholderMsg('获取账号信息失败');
            return;
          }
          var ssoResult = await API.xxtSsoLoginSync({ username: info.account, password: newPwd });
          var uid = (ssoResult && ssoResult.uid) || (ssoResult && ssoResult.msg && ssoResult.msg.uid);
          var imAccount = ssoResult && (ssoResult.imAccount || (ssoResult.msg && (ssoResult.msg.imAccount || (ssoResult.msg.accountInfo && ssoResult.msg.accountInfo.imAccount))));
          if (uid) {
            xxtChatUid = String(uid);
            var puid2 = (ssoResult && ssoResult.msg && ssoResult.msg.puid) ? String(ssoResult.msg.puid) : '';
            var myName2 = (ssoResult && ssoResult.msg && ssoResult.msg.name) || '';
            if (puid2) xxtMyPuid = puid2;
            if (myName2) xxtMyName = myName2;
            if (imAccount && imAccount.username && imAccount.password) {
              easemobConnect(imAccount.username, imAccount.password, true).then(function() {
                loadEasemobConversations();
                showToast('消息已连接', '环信消息服务已就绪', 'success', 2000);
              }).catch(function(err) {
                console.error('[Easemob] 重连失败:', err);
                showPasswordChangePopup();
              });
            } else {
              updateChatPlaceholderMsg('无法获取聊天凭据，请检查密码是否正确');
            }
          } else {
            updateChatPlaceholderMsg('密码验证失败，请检查密码是否正确');
            showPasswordChangePopup();
          }
        } catch (err) {
          console.error('[Easemob] 重连异常:', err);
          updateChatPlaceholderMsg('连接失败，请重试');
        }
      };
    }
  }

  function easemobLoginWithCredentials(huanxinId, hxToken) {
    easemobConnect(huanxinId, hxToken).then(function() {
      loadEasemobConversations();
      showToast('消息已连接', '环信消息服务已就绪', 'success', 2000);
    }).catch(function(err) {
      console.error('[Easemob] 登录失败:', err);
      showToast('消息连接失败', err.message || '无法连接消息服务', 'error', 4000);
    });
  }

  function showXxtChatPanel() {
    $('xxt-webview-container').style.display = 'none';
    $('xxt-chat-panel').style.display = '';
    $('xxt-chat-placeholder').style.display = '';
    $('xxt-chat-messages').style.display = 'none';
    $('xxt-chat-input-area').style.display = 'none';
  }

  function hideXxtChatPanel() {
    $('xxt-chat-panel').style.display = 'none';
    $('xxt-webview-container').style.display = '';
  }

  $('xxt-chat-send-btn').onclick = function() {
    sendEasemobMessage($('xxt-chat-input').value);
  };
  $('xxt-chat-shake-btn').onclick = function() {
    sendEasemobShake();
  };
  $('xxt-chat-call-btn').onclick = function() {
    sendEasemobCallInvite();
  };
  $('xxt-chat-contacts-btn').onclick = function() {
    loadEasemobContacts();
  };
  $('xxt-chat-add-contact-btn').onclick = function() {
    addEasemobContact();
  };
  $('xxt-chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      sendEasemobMessage($('xxt-chat-input').value);
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      var s = this.selectionStart, v = this.value;
      this.value = v.substring(0, s) + '\n' + v.substring(this.selectionEnd);
      this.selectionStart = this.selectionEnd = s + 1;
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    }
  });
  $('xxt-chat-input').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
  });



  // 找人/搜索用户
  function findOrStartConversation(userId) {
    if (!userId || !userId.trim()) return;
    var rawId = userId.trim();
    // 尝试匹配已有会话
    var found = null;
    for (var i = 0; i < easemobConversations.length; i++) {
      var c = easemobConversations[i];
      var cid = (c.conversationId || '').replace(/^(cx-dev#cxstudy_)+/, '').replace(/@easemob\.com$/, '');
      if (cid === rawId || c.nickname === rawId || c.courseName === rawId) {
        found = c;
        break;
      }
    }
    if (found) {
      // 已有会话，直接打开
      easemobActiveConvId = found.conversationId;
      renderEasemobConversations();
      $('xxt-chat-placeholder').style.display = 'none';
      $('xxt-chat-messages').style.display = '';
      $('xxt-chat-input-area').style.display = '';
      renderEasemobMessages(found.conversationId);
      loadEasemobHistory(found.conversationId);
      return;
    }
    // 新建会话
    var newConvId = rawId;
    if (newConvId.indexOf('@easemob.com') < 0) {
      newConvId = 'cx-dev#cxstudy_' + newConvId + '@easemob.com';
    }
    var newConv = {
      conversationId: newConvId,
      lastMessage: '',
      unreadCount: 0,
      nickname: rawId,
      courseName: '',
      isGroup: false,
      ext: {}
    };
    easemobConversations.unshift(newConv);
    easemobActiveConvId = newConvId;
    renderEasemobConversations();
    $('xxt-chat-placeholder').style.display = 'none';
    $('xxt-chat-messages').style.display = '';
    $('xxt-chat-input-area').style.display = '';
    renderEasemobMessages(newConvId);
    loadEasemobHistory(newConvId);
  }

  var chatSearchInput = $('xxt-chat-search');

  function saveTabs() {
    const serializable = browserTabs.map(t => ({ id: t.id, url: (t.url && t.url !== 'about:blank') ? t.url : '', title: t.title, favicon: t.favicon || '' }));
    localStorage.setItem('browserTabs', JSON.stringify(serializable));
  }

  function getActiveWebview() {
    const tab = browserTabs.find(t => t.id === activeTabId);
    return tab ? tab.webview : null;
  }

  async function handleBrowserDownload(downloadUrl, fileName) {
    setGlobalProgress(true);
    activeDownloadCount++;
    activeDownloadNames.push(fileName);
    updateDownloadBadge();
    addDownloadRecord(fileName, downloadUrl, '', 'browser');
    renderDownloadList();
    try {
      if (API && API.downloadFile) {
        setGlobalProgress(false);
        const result = await API.downloadFile(downloadUrl, fileName, token);
        if (result && result.canceled) { showToast('下载取消', fileName, 'info'); return; }
        if (result && result.error) throw new Error(result.error);
        if (result && result.filePath) {
          const record = downloadHistory.find(r => r.name === fileName && r.url === downloadUrl && r.category === 'browser');
          if (record) { record.localPath = result.filePath; localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory)); }
        }
      }
      showToast('下载成功', fileName, 'success');
    } catch (err) {
      showToast('下载失败', err.message, 'error', 5000, true);
    } finally {
      activeDownloadCount--;
      activeDownloadNames = activeDownloadNames.filter(n => n !== fileName);
      updateDownloadBadge();
      renderDownloadList();
    }
  }

  function setupWebviewEvents(webview, tabId) {
    const urlInput = $('browser-url');
    webview._tabId = tabId;

    webview.addEventListener('new-window', (e) => {
      console.log('[Browser] new-window event:', e.url, 'disposition:', e.disposition);
      e.preventDefault();
      var url = e.url;
      if (!url || url === 'about:blank' || url === 'about:blank#blocked' || /^(jsbridge|cxstudy):\/\//.test(url)) {
        console.log('[Browser] new-window empty/blocked url, skipped');
        return;
      }
      if (/^(bytedance|lark|feishu|snssdk|douyin|bitbrowser):\/\//i.test(url)) {
        showToast('链接已拦截', url.split('://')[0] + ':// 协议无法打开', 'warning', 4000);
        return;
      }
      newTab(url);
    });

    webview.addEventListener('will-navigate', (e) => {
      const navUrl = e.url;
      if (navUrl.includes('/download?') || navUrl.includes('/api/work/download') || navUrl.includes('/api/resource/download')) {
        e.preventDefault();
        webview._downloadHandled = true;
        setTimeout(function(){ webview._downloadHandled = false; }, 1000);
        try {
          const urlObj = new URL(navUrl);
          const fileName = decodeURIComponent(urlObj.searchParams.get('filename') || urlObj.searchParams.get('path')?.split('/').pop() || 'download');
          handleBrowserDownload(navUrl, fileName);
        } catch (err) {
          handleBrowserDownload(navUrl, 'download');
        }
        return;
      }
      if (tabId === activeTabId && e.url !== 'about:blank') urlInput.value = e.url;
      if (/^(jsbridge|cxstudy):\/\//.test(e.url)) { e.preventDefault(); return; }
      if (/^(bytedance|lark|feishu|snssdk|douyin):\/\//i.test(e.url)) {
        e.preventDefault();
        showToast('链接已拦截', e.url.split('://')[0] + ':// 协议无法打开', 'warning', 4000);
        return;
      }
    });

    webview.addEventListener('did-start-loading', () => {
      console.log('[Browser] loading start');
      if (tabId === activeTabId) setGlobalProgress(true);
    });

    webview.addEventListener('did-stop-loading', () => {
      console.log('[Browser] loading stop');
      webview._loading = false;
      if (tabId === activeTabId) setGlobalProgress(false);
    });

    webview.addEventListener('did-finish-load', () => {
      console.log('[Browser] did-finish-load, reinject glass CSS');
      injectBrowserGlassCSS(webview);
    });

    webview.addEventListener('did-navigate', (e) => {
      console.log('[Browser] did-navigate:', e.url);
      if (tabId === activeTabId && e.url !== 'about:blank') urlInput.value = e.url;
      updateTabUrl(tabId, e.url);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame && tabId === activeTabId) {
        console.log('[Browser] did-navigate-in-page:', e.url);
        urlInput.value = e.url;
      }
    });

    webview.addEventListener('did-fail-load', (e) => {
      console.error('[Browser] did-fail-load:', e.errorCode, e.errorDescription, e.validatedURL);
      if (e.errorCode !== -3) showToast('页面加载失败', e.errorDescription, 'error', 4000);
    });

    webview.addEventListener('media-started-playing', () => {
      const tab = browserTabs.find(t => t.id === tabId);
      if (tab) {
        tab.audible = true;
        if (tab._audibleTimer) { clearTimeout(tab._audibleTimer); tab._audibleTimer = null; }
        updateTabAudible(tabId, true);
      }
    });
    webview.addEventListener('media-paused', () => {
      const tab = browserTabs.find(t => t.id === tabId);
      if (tab) {
        if (tab._audibleTimer) clearTimeout(tab._audibleTimer);
        tab._audibleTimer = setTimeout(function() {
          tab.audible = false;
          tab._audibleTimer = null;
          updateTabAudible(tabId, false);
        }, 3000);
      }
    });

    webview.addEventListener('page-title-updated', (e) => {
      console.log('[Browser] page-title-updated:', e.title);
      updateTabTitle(tabId, e.title);
      addHistory(e.title, e.url || urlInput.value);
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      const favicons = e.favicons;
      if (favicons && favicons.length > 0) {
        updateTabFavicon(tabId, favicons[0]);
      }
    });

    webview.addEventListener('console-message', (e) => {
      console.log('[Browser] ALL console-msg[' + e.level + ']:', e.message.substring(0, 120));
      if (e.message.startsWith('[WebViewNewTab]')) {
        const url = e.message.substring('[WebViewNewTab]'.length);
        console.log('[Browser] console-message new tab:', url);
        newTab(url);
      }
      if (e.message.startsWith('[WebViewDownload]')) {
        if (webview._downloadHandled) {
          console.log('[Browser] console-message download skipped (handled by will-navigate)');
          return;
        }
        webview._downloadHandled = true;
        setTimeout(function(){ webview._downloadHandled = false; }, 1000);
        const url = e.message.substring('[WebViewDownload]'.length);
        const fileName = url.split('/').pop().split('?')[0] || 'download';
        console.log('[Browser] console-message download:', url);
        handleBrowserDownload(url, fileName);
      }
    });

    webview.addEventListener('dom-ready', () => {
      console.log('[Browser] dom-ready');
      if (!webview.parentNode) { console.log('[Browser] dom-ready skipped: webview detached'); return; }
      webview.insertCSS(`
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #888; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }
      `).catch(function(err){console.error('[Browser] insertCSS error:',err);});
      injectBrowserGlassCSS(webview);
      injectBlockedProtocolFilter(webview);
      // 脚本注入已由 webview-preload.js 预加载脚本处理，无需 executeJavaScript
    });

    webview.addEventListener('will-download', async (e) => {
      console.log('[Browser] will-download:', e.url, e.filename);
      if (webview._downloadHandled) {
        console.log('[Browser] will-download skipped (handled by will-navigate)');
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const downloadUrl = e.url;
      const fileName = e.filename || downloadUrl.split('/').pop() || 'download';
      handleBrowserDownload(downloadUrl, fileName);
    });
  }

  function injectBrowserGlassCSS(webview) {
    if (!browserGlassEnabled) {
      const removeJs = `(function(){var s=document.getElementById('glass-effect-style');if(s)s.remove();})()`;
      if (webview) {
        webview.executeJavaScript(removeJs).catch(function(){});
      } else {
        browserTabs.forEach(function(t) {
        if (t.webview && t.webview.parentNode) {
          try { t.webview.getWebContentsId(); t.webview.executeJavaScript(removeJs).catch(function(){}); } catch(e) {}
        }
      });
      }
      return;
    }
    const op = (100 - cardOpacity) / 100;
    const glassBg = darkMode ? hexToRgba('#1a1a2e', op) : hexToRgba('#ffffff', op);
    const glassEnabled = !document.body.classList.contains('no-glass');
    const cardBlur = parseInt(localStorage.getItem('cardBlurAmount') || '0');
    const glassBlur = glassEnabled && cardBlur > 0 ? 'blur(' + cardBlur + 'px)' : 'none';
    const css = `body,html{background:transparent !important;}div,section,article,header,footer,nav,main,aside,ul,ol,li,dl,dt,dd,table,thead,tbody,tfoot,tr,th,td,form,fieldset,p,span,h1,h2,h3,h4,h5,h6,blockquote,details,summary,dialog{background:transparent !important;backdrop-filter:${glassBlur} !important;-webkit-backdrop-filter:${glassBlur} !important;}`;
    const js = `(function(){var s=document.getElementById('glass-effect-style');if(!s){s=document.createElement('style');s.id='glass-effect-style';document.head.appendChild(s);}s.textContent=${JSON.stringify(css)};})()`;
    if (webview) {
      webview.executeJavaScript(js).catch(function(err){console.error('[Browser] injectGlassCSS error:',err);});
    } else {
      browserTabs.forEach(function(t) {
        if (t.webview && t.webview.parentNode) {
          try { t.webview.getWebContentsId(); t.webview.executeJavaScript(js).catch(function(err){console.error('[Browser] injectGlassCSS error:',err);}); } catch(e) {}
        }
      });
    }
  }

  function injectBlockedProtocolFilter(webview) {
    var js = '(function(){var BLOCKED=/^(bytedance|lark|feishu|snssdk|douyin):\\/\\//i;function disable(a){if(BLOCKED.test(a.href||"")){a.href="javascript:void(0)";a.style.opacity="0.4";a.style.cursor="not-allowed";a.title="此链接已屏蔽("+a.getAttribute("x-orig-href")||a.href.split(":")[0]+"://)";a.setAttribute("x-orig-href",a.getAttribute("x-orig-href")||a.href);a.removeAttribute("target");a.onclick=function(e){e.preventDefault();e.stopPropagation();return false}}}function scan(){document.querySelectorAll("a[href]").forEach(disable)}scan();new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType===1){if(n.tagName==="A")disable(n);n.querySelectorAll&&n.querySelectorAll("a[href]").forEach(disable)}})})}).observe(document.documentElement,{childList:true,subtree:true})})()';
    if (webview) {
      webview.executeJavaScript(js).catch(function(){});
    } else {
      browserTabs.forEach(function(t) {
        if (t.webview && t.webview.parentNode) {
          try { t.webview.getWebContentsId(); t.webview.executeJavaScript(js).catch(function(){}); } catch(e) {}
        }
      });
    }
  }

  var _browserInitDone = false;
  function initBrowser() {
    if (_browserInitDone) return;
    _browserInitDone = true;
    const urlInput = $('browser-url');

    $('browser-nav-go').onclick = () => browserNavigate(urlInput.value);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') browserNavigate(urlInput.value);
    });
    $('browser-nav-back').onclick = () => {
      const wv = getActiveWebview();
      if (wv && wv.canGoBack()) wv.goBack();
    };
    $('browser-nav-forward').onclick = () => {
      const wv = getActiveWebview();
      if (wv && wv.canGoForward()) wv.goForward();
    };
    $('browser-nav-refresh').onclick = () => {
      const wv = getActiveWebview();
      if (wv) wv.reload();
    };

    const tabsEl = $('browser-tabs');
    var dropIndicator = null;
    function getDropIndicator() {
      if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'browser-tab-drop-indicator';
        dropIndicator.style.cssText = 'width:3px;background:var(--theme,#4a9eff);border-radius:2px;flex-shrink:0;display:none;align-self:stretch;margin:4px 0;box-shadow:0 0 6px var(--theme,#4a9eff);transition:all 0.1s;';
      }
      return dropIndicator;
    }
    function showDropIndicatorAt(tabEl, after) {
      var indicator = getDropIndicator();
      if (after) {
        tabEl.parentNode.insertBefore(indicator, tabEl.nextSibling);
      } else {
        tabEl.parentNode.insertBefore(indicator, tabEl);
      }
      indicator.style.display = '';
    }
    function hideDropIndicator() {
      var indicator = getDropIndicator();
      if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
      indicator.style.display = 'none';
    }
    var dragTabId = null;
    tabsEl.addEventListener('dragstart', function(e) {
      var tab = e.target.closest('.browser-tab');
      if (!tab) return;
      dragTabId = parseInt(tab.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-browser-tab-id', dragTabId);
      tab.style.opacity = '0.5';
    });
    tabsEl.addEventListener('dragend', function(e) {
      var tab = e.target.closest('.browser-tab');
      if (tab) tab.style.opacity = '';
      dragTabId = null;
      hideDropIndicator();
    });
    tabsEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      var isTabDrag = e.dataTransfer.types.indexOf('text/x-browser-tab-id') !== -1;
      e.dataTransfer.dropEffect = isTabDrag ? 'move' : 'link';
      var tabEls = tabsEl.querySelectorAll('.browser-tab');
      if (tabEls.length === 0) { hideDropIndicator(); return; }
      var x = e.clientX;
      var found = false;
      for (var i = 0; i < tabEls.length; i++) {
        var tr = tabEls[i].getBoundingClientRect();
        var mid = tr.left + tr.width / 2;
        if (x < mid) {
          showDropIndicatorAt(tabEls[i], false);
          found = true;
          break;
        }
      }
      if (!found) {
        showDropIndicatorAt(tabEls[tabEls.length - 1], true);
      }
    });
    tabsEl.addEventListener('dragleave', function(e) {
      if (!tabsEl.contains(e.relatedTarget)) {
        hideDropIndicator();
      }
    });
    tabsEl.addEventListener('drop', function(e) {
      e.preventDefault();
      hideDropIndicator();
      var tabId = e.dataTransfer.getData('text/x-browser-tab-id');
      if (tabId) {
        tabId = parseInt(tabId);
        var fromIdx = browserTabs.findIndex(function(t) { return t.id === tabId; });
        if (fromIdx === -1) return;
        var tabEls = tabsEl.querySelectorAll('.browser-tab');
        var toIdx = browserTabs.length - 1;
        var x = e.clientX;
        for (var i = 0; i < tabEls.length; i++) {
          var tr = tabEls[i].getBoundingClientRect();
          var mid = tr.left + tr.width / 2;
          if (x < mid) { toIdx = i; break; }
        }
        if (toIdx > fromIdx) toIdx--;
        if (toIdx !== fromIdx) {
          var moved = browserTabs.splice(fromIdx, 1)[0];
          browserTabs.splice(toIdx, 0, moved);
          saveTabs();
          renderTabs();
        }
        return;
      }
      var url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (url) {
        url = url.trim().split(/[\r\n]+/)[0];
        if (url.indexOf('http') === 0) {
          console.log('[Browser] tab drop URL:', url);
          newTab(url);
        }
      }
    });

    if (browserTabs.length === 0) {
      showHistory();
      return;
    }
    browserTabs.forEach(tab => {
      if (!tab.webview || !tab.webview.parentNode) {
        createWebviewForTab(tab, false);
      }
    });
    renderTabs();
    if (!activeTabId || !browserTabs.find(t => t.id === activeTabId)) {
      activeTabId = browserTabs[browserTabs.length - 1].id;
    }
    activateTab(activeTabId);
  }

  function createWebviewForTab(tab, activate) {
    const container = $('browser-webview-container');
    const webview = document.createElement('webview');
    webview.id = 'browser-webview-' + tab.id;
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('partition', 'persist:browser');
    if (activate) webview.setAttribute('src', (tab.url && tab.url !== 'about:blank') ? tab.url : 'about:blank');
    webview.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
    webview.style.display = activate ? '' : 'none';
    webview._downloadHandled = false;
    tab.webview = webview;
    container.appendChild(webview);
    setupWebviewEvents(webview, tab.id);
  }

  function newTab(url) {
    const id = Date.now();
    const cleanUrl = url ? url.replace(/`/g, '') : '';
    const tab = { id, url: cleanUrl, title: '新标签页' };
    browserTabs.push(tab);
    createWebviewForTab(tab, true);
    activeTabId = id;
    saveTabs();
    renderTabs();
    if (url) {
      $('browser-webview-container').style.display = '';
      $('browser-url').value = url;
      $('browser-history').style.display = 'none';
      switchPage('browser');
    } else {
      showHistory();
    }
  }

  function closeTab(id, e) {
    e.stopPropagation();
    const idx = browserTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = browserTabs[idx];
    if (tab.webview && tab.webview.parentNode) {
      tab.webview.parentNode.removeChild(tab.webview);
    }
    browserTabs.splice(idx, 1);
    saveTabs();
    if (browserTabs.length === 0) {
      activeTabId = null;
      showHistory();
      return;
    }
    if (activeTabId === id) {
      const next = browserTabs[Math.min(idx, browserTabs.length - 1)];
      activeTabId = next.id;
      activateTab(activeTabId);
    }
    renderTabs();
  }

  function activateTab(id) {
    browserTabs.forEach(t => {
      if (t.webview) t.webview.style.display = 'none';
    });
    activeTabId = id;
    const tab = browserTabs.find(t => t.id === id);
    if (tab && tab.webview && tab.url) {
      tab.webview.style.display = '';
      $('browser-webview-container').style.display = '';
      if (!tab.webview.src || tab.webview.src === 'about:blank') tab.webview.src = tab.url;
      if (tab.url) {
        $('browser-url').value = tab.url;
      }
      $('browser-history').style.display = 'none';
    } else {
      showHistory();
    }
    renderTabs();
  }

  function loadTab(url) {
    const wv = getActiveWebview();
    const historyEl = $('browser-history');
    if (wv) {
      wv.style.display = '';
      $('browser-webview-container').style.display = '';
      historyEl.style.display = 'none';
      if (url) {
        let fullUrl = url.replace(/`/g, '');
        if (!fullUrl.startsWith('http')) fullUrl = 'https://' + fullUrl;
        $('browser-url').value = fullUrl;
        console.log('[Browser] loadTab:', fullUrl);
        if (wv._loading) {
          console.log('[Browser] loadTab: stopping previous load');
          wv.stop();
        }
        wv._loading = true;
        if (!wv.src || wv.src === 'about:blank') {
          wv.setAttribute('src', fullUrl);
        } else {
          wv.loadURL(fullUrl);
        }
      }
    }
  }

  function showHistory() {
    browserTabs.forEach(t => {
      if (t.webview) t.webview.style.display = 'none';
    });
    $('browser-webview-container').style.display = 'none';
    $('browser-history').style.display = '';
    $('browser-url').value = '';
    renderHistory();
  }

  function browserNavigate(input) {
    if (!input.trim()) return;
    let url = input.trim().replace(/`/g, '');
    // 外部私有协议 (steam://, tg://, magnet:? 等)
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url)) {
      window.electronAPI.openExternal(url);
      return;
    }
    if (!url.startsWith('http')) {
      if (url.includes('.') && !url.includes(' ')) {
        const isIP = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(url);
        const isLocal = url.startsWith('localhost') || url.startsWith('127.');
        url = (isIP || isLocal ? 'http://' : 'https://') + url;
      } else {
        url = 'https://www.baidu.com/s?wd=' + encodeURIComponent(url);
      }
    }
    console.log('[Browser] navigate:', url);
    if (browserTabs.length === 0) newTab(url);
    else {
      const tab = browserTabs.find(t => t.id === activeTabId);
      if (tab) { tab.url = url; saveTabs(); renderTabs(); }
      loadTab(url);
    }
  }

  function saveXxtTabs() {}

  function getXxtWebview() {
    const tab = xxtTabs.find(t => t.id === xxtActiveTabId);
    return tab ? tab.webview : null;
  }

  var xxtChatUid = null;
  var xxtChatCxstudyPath = null;
  var xxtMyPuid = '';
  var xxtMyName = '';
  var easemobPuidMap = {};
  try { var savedPuidMap = localStorage.getItem('easemobPuidMap'); if (savedPuidMap) easemobPuidMap = JSON.parse(savedPuidMap); } catch(e) {}
  var disableShake = localStorage.getItem('disableShake') === 'true';
  var disableCall = localStorage.getItem('disableCall') === 'true';
  var enableSearchTab = localStorage.getItem('showSearchTab') === 'true';
  var showAppearanceTab = localStorage.getItem('showAppearanceTab') !== 'false';
  var showBrowserTab = localStorage.getItem('showBrowserTab') !== 'false';
  var showAnnouncementsTab = localStorage.getItem('showAnnouncementsTab') !== 'false';
  var showXxtTab = localStorage.getItem('showXxtTab') !== 'false';
  var showPythonTab = localStorage.getItem('showPythonTab') !== 'false';
  var showMmdTab = localStorage.getItem('showMmdTab') !== 'false';
  var limitMinSize = localStorage.getItem('limitMinSize') !== 'false';
  var _minWidth = parseInt(localStorage.getItem('customMinWidth') || '900');
  var _minHeight = parseInt(localStorage.getItem('customMinHeight') || '620');
  var pendingOutgoingCall = null;

  function initLogCapture() {
    var logContainer = $('log-output');
    if (!logContainer) return;
    var origLog = console.log;
    var origWarn = console.warn;
    var origError = console.error;
    function addLog(level, args) {
      var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      var msg = Array.from(args).map(function(a) {
        try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); } catch(e) { return String(a); }
      }).join(' ');
      var color = level === 'error' ? '#e74c3c' : (level === 'warn' ? '#f39c12' : '#a0aec0');
      var line = '<div class="log-line"><span class="log-time">' + time + '</span> <span class="log-level" style="color:' + color + '">[' + level.toUpperCase() + ']</span> ' + escapeHtml(msg) + '</div>';
      logContainer.innerHTML += line;
      logContainer.scrollTop = logContainer.scrollHeight;
      if (logContainer.children.length > 500) {
        logContainer.removeChild(logContainer.firstChild);
      }
    }
    console.log = function() { addLog('log', arguments); origLog.apply(console, arguments); };
    console.warn = function() { addLog('warn', arguments); origWarn.apply(console, arguments); };
    console.error = function() { addLog('error', arguments); origError.apply(console, arguments); };
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function applySidebarVisibility() {
    var searchBtn = document.querySelector('.sidebar-btn[data-page="search"]');
    var appearanceBtn = document.querySelector('.sidebar-btn[data-page="appearance"]');
    var browserBtn = document.querySelector('.sidebar-btn[data-page="browser"]');
    var announcementsBtn = document.querySelector('.sidebar-btn[data-page="announcements"]');
    var xxtBtn = document.querySelector('.sidebar-btn[data-page="xxt"]');
    if (searchBtn) searchBtn.style.display = enableSearchTab ? '' : 'none';
    if (appearanceBtn) appearanceBtn.style.display = showAppearanceTab ? '' : 'none';
    if (browserBtn) browserBtn.style.display = showBrowserTab ? '' : 'none';
    if (announcementsBtn) announcementsBtn.style.display = showAnnouncementsTab ? '' : 'none';
    if (xxtBtn) xxtBtn.style.display = showXxtTab ? '' : 'none';
    var pythonBtn = document.querySelector('.sidebar-btn[data-page="python"]');
    var mmdBtn = document.querySelector('.sidebar-btn[data-page="mmd"]');
    if (pythonBtn) pythonBtn.style.display = showPythonTab ? '' : 'none';
    if (mmdBtn) mmdBtn.style.display = showMmdTab ? '' : 'none';
  }

  function createXxtChatWebview(tab) {
    var container = $('xxt-webview-container');
    if (!container) return;
    var webview = document.createElement('webview');
    webview.id = 'xxt-webview-' + tab.id;
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('partition', 'persist:xxt');
    webview.setAttribute('webpreferences', 'webSecurity=no');
    webview.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;';
    tab.webview = webview;
    webview.addEventListener('dom-ready', function() {
      try { webview.setUserAgent(XxtUA); } catch(e) {}
      webview.insertCSS('::-webkit-scrollbar{width:6px;height:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#888;border-radius:3px;}::-webkit-scrollbar-thumb:hover{background:#555;}');
      updateXxtNavButtons();
    });
    container.appendChild(webview);
    setupXxtWebviewEvents(webview, tab.id);
    API.getCxstudyPath().then(function(p) {
      xxtChatCxstudyPath = p;
      console.log('[XXT-Chat] cxstudy path:', p);
      tryLoadCxstudyChat(tab);
    });
    // 读取官方学习通客户端的环信配置
    API.readCxstudyConfig().then(function(cfg) {
      console.log('[XXT-Cfg] 官方客户端配置:', JSON.stringify(cfg, null, 2));
      if (cfg && cfg.files) {
        var fileNames = Object.keys(cfg.files);
        for (var i = 0; i < fileNames.length; i++) {
          console.log('[XXT-Cfg] 文件: ' + fileNames[i], cfg.files[fileNames[i]]);
        }
      }
    }).catch(function(e) { console.error('[XXT-Cfg] 读取配置失败:', e); });
  }

  function tryLoadCxstudyChat(tab) {
    if (!xxtChatCxstudyPath || !xxtChatUid) return;
    var chatUrl = 'file:///' + xxtChatCxstudyPath.replace(/\\/g, '/') + '/resources/app.asar/dist/index.html#/message/conversation?id=' + xxtChatUid + '&chatType=singleChat';
    console.log('[XXT-Chat] loading:', chatUrl);
    if (tab && tab.webview) {
      tab.webview.src = chatUrl;
      tab.url = chatUrl;
    }
  }

  function createXxtWebview(tab, activate) {
    if (tab.isChat) { createXxtChatWebview(tab); return; }
    const container = $('xxt-webview-container');
    if (!container) return;
    const webview = document.createElement('webview');
    webview.id = 'xxt-webview-' + tab.id;
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('partition', 'persist:xxt');
    if (xxtPreloadPath) {
      webview.setAttribute('preload', 'file:///' + xxtPreloadPath.replace(/\\/g, '/'));
    }
    webview.setAttribute('webpreferences', 'contextIsolation=no');
    webview.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
    webview.style.display = activate ? '' : 'none';
    tab.webview = webview;
    webview.addEventListener('dom-ready', () => {
      try { API.registerXxtWebview(webview.getWebContentsId()); } catch (e) {}
    });
    container.appendChild(webview);
    webview.addEventListener('dom-ready', () => {
      try { webview.setUserAgent(XxtUA); } catch (e) {}
      webview.insertCSS(`
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #888; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }
      `).catch(function(err){console.error('[XXT] insertCSS error:',err);});
      updateXxtNavButtons();
    });
    setupXxtWebviewEvents(webview, tab.id);
    if (activate && tab.url && tab.url !== 'about:blank') {
      webview.src = tab.url;
    }
  }

  function setupXxtWebviewEvents(webview, tabId) {
    webview.addEventListener('did-start-loading', () => {
      if (tabId === xxtActiveTabId) setGlobalProgress(true);
    });
    webview.addEventListener('did-stop-loading', () => {
      if (tabId === xxtActiveTabId) setGlobalProgress(false);
      updateXxtNavButtons();
    });
    webview.addEventListener('did-navigate', (e) => {
      updateXxtTabUrl(tabId, e.url);
      updateXxtNavButtons();
      if (/passport2\.chaoxing\.com/.test(e.url)) {
        console.log('[XXT] Redirected to passport2, auto-logout');
        xxtAutoLogout();
        return;
      }
      if (e.url !== 'about:blank') {
        const tab = xxtTabs.find(t => t.id === tabId);
        if (tab) tab._wasLoaded = true;
      }
    });
    webview.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) updateXxtTabUrl(tabId, e.url); });
    webview.addEventListener('page-title-updated', (e) => {
      const tab = xxtTabs.find(t => t.id === tabId);
      if (tab) { tab.title = e.title; saveXxtTabs(); renderXxtTabs(); }
    });
    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        const tab = xxtTabs.find(t => t.id === tabId);
        if (tab) { tab.favicon = e.favicons[0]; saveXxtTabs(); renderXxtTabs(); }
      }
    });
    webview.addEventListener('will-navigate', (e) => {
      if (/^(jsbridge|cxstudy):\/\//.test(e.url)) { e.preventDefault(); return; }
      if (/^(bytedance|lark|feishu|snssdk|douyin):\/\//i.test(e.url)) {
        e.preventDefault();
        showToast('链接已拦截', e.url.split('://')[0] + ':// 协议无法打开', 'warning', 4000);
        return;
      }
    });
    webview.addEventListener('new-window', (e) => {
      console.log('[XXT] new-window event:', e.url, 'disposition:', e.disposition);
      e.preventDefault();
      var url = e.url;
      if (!url || url === 'about:blank' || url === 'about:blank#blocked') {
        console.log('[XXT] new-window empty url, skipped');
        return;
      }
      if (/^(jsbridge|cxstudy):\/\//.test(url)) return;
      xxtNewTab(url);
    });
    webview.addEventListener('media-started-playing', () => {
      const tab = xxtTabs.find(t => t.id === tabId);
      if (tab) { tab.audible = true; renderXxtTabs(); }
    });
    webview.addEventListener('media-paused', () => {
      const tab = xxtTabs.find(t => t.id === tabId);
      if (tab) { tab.audible = false; renderXxtTabs(); }
    });
  }

  function updateXxtTabUrl(tabId, url) {
    if (url === 'about:blank') return;
    const tab = xxtTabs.find(t => t.id === tabId);
    if (tab) { tab.url = url; saveXxtTabs(); renderXxtTabs(); }
  }

  function xxtNewTab(url) {
    const id = Date.now();
    const cleanUrl = url ? url.replace(/`/g, '') : '';
    const tab = { id, url: cleanUrl, title: '学习通' };
    xxtTabs.push(tab);
    xxtActiveTabId = id;
    createXxtWebview(tab, true);
    saveXxtTabs();
    renderXxtTabs();
    if (url) {
      var el = $('xxt-webview-container'); if (el) el.style.display = '';
      el = $('xxt-history'); if (el) el.style.display = 'none';
    }
  }

  async function xxtAutoLogout() {
    console.log('[XXT] Auto-logout: clearing session and tabs');
    xxtLoggedIn = false;
    pendingEasemobCreds = null;
    if (easemobConn) { try { easemobConn.close(); } catch (e) {} easemobConn = null; }
    easemobReady = false;
    easemobConversations = [];
    easemobActiveConvId = null;
    easemobMessages = {};
    try { localStorage.removeItem('easemobMessages'); } catch(e) {}
    API.clearEasemobCredentials();
    await API.xxtLogout();
    xxtTabs.forEach(t => { if (t.webview && t.webview.parentNode) t.webview.parentNode.removeChild(t.webview); });
    xxtTabs = [];
    xxtActiveTabId = null;
    hideXxtChatPanel();
    $('xxt-browser-container').style.display = 'none';
    $('xxt-placeholder').style.display = '';
    $('xxt-open-btn').disabled = false;
    $('xxt-open-btn').style.opacity = '1';
    const xxtInfo = $('xxt-learning-info');
    if (xxtInfo && xxtInfo.dataset.hasData) {
      xxtInfo.style.display = 'block';
    }
    renderXxtTabs();
  }

  function closeXxtTab(id, e) {
    e.stopPropagation();
    const idx = xxtTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = xxtTabs[idx];
    if (tab.isDefault) return; // 默认选项卡不允许关闭
    if (tab.isChat) {
      hideXxtChatPanel();
      if (tab.webview && tab.webview.parentNode) {
        tab.webview.parentNode.removeChild(tab.webview);
      }
      easemobActiveConvId = null;
    } else if (tab.webview && tab.webview.parentNode) {
      tab.webview.parentNode.removeChild(tab.webview);
    }
    xxtTabs.splice(idx, 1);
    saveXxtTabs();
    if (xxtTabs.length === 0) {
      xxtActiveTabId = null;
      $('xxt-browser-container').style.display = 'none';
      $('xxt-placeholder').style.display = '';
      if ($('xxt-learning-info').dataset.hasData) {
        $('xxt-learning-info').style.display = 'block';
      }
      $('xxt-open-btn').disabled = false;
      $('xxt-open-btn').style.opacity = '1';
      return;
    }
    if (xxtActiveTabId === id) {
      const next = xxtTabs[Math.min(idx, xxtTabs.length - 1)];
      xxtActiveTabId = next.id;
      activateXxtTab(xxtActiveTabId);
    }
    renderXxtTabs();
  }

  function activateXxtTab(id) {
    xxtTabs.forEach(t => { if (t.webview) t.webview.style.display = 'none'; });
    xxtActiveTabId = id;
    const tab = xxtTabs.find(t => t.id === id);
    if (tab && tab.isChat) {
      hideXxtChatPanel();
      if (tab.webview) {
        tab.webview.style.display = '';
        if (!tab.webview.src || tab.webview.src === 'about:blank') {
          tryLoadCxstudyChat(tab);
        }
      } else {
        showXxtChatPanel();
      }
    } else if (tab && tab.webview && tab.url) {
      hideXxtChatPanel();
      tab.webview.style.display = '';
      if (!tab.webview.src || tab.webview.src === 'about:blank') {
        tab.webview.src = tab.url;
      }
    }
    renderXxtTabs();
    updateXxtNavButtons();
  }

  function renderXxtTabs() {
    const tabsEl = $('xxt-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = xxtTabs.map(t => {
      var iconHtml = t.isChat ? '<i class="fa-solid fa-comments browser-tab-icon-default"></i>' : (t.favicon ? '<img class="browser-tab-icon" src="' + escapeHtml(t.favicon) + '">' : '<i class="fa-solid fa-graduation-cap browser-tab-icon-default"></i>');
      var closeHtml = t.isDefault ? '' : '<span class="tab-close">×</span>';
      return '<div class="xxt-tab' + (t.id === xxtActiveTabId ? ' active' : '') + '" data-id="' + t.id + '" draggable="true">'
        + iconHtml
        + '<span class="tab-title">' + escapeHtml(t.title || '学习通') + '</span>'
        + '<span class="xxt-tab-audio' + (t.audible ? ' audible' : '') + '"><i class="fa-solid fa-volume-high"></i></span>'
        + closeHtml
        + '</div>';
    }).join('');
    tabsEl.onclick = (e) => {
      const closeBtn = e.target.closest('.tab-close');
      if (closeBtn) {
        e.stopPropagation();
        closeXxtTab(parseInt(closeBtn.parentElement.dataset.id), e);
        return;
      }
      const tab = e.target.closest('.xxt-tab');
      if (tab) activateXxtTab(parseInt(tab.dataset.id));
    };
    tabsEl.onwheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        tabsEl.scrollLeft += e.deltaY;
      }
    };
  }

  function updateXxtNavButtons() {
    const wv = getXxtWebview();
    const backBtn = $('xxt-nav-back');
    const fwdBtn = $('xxt-nav-forward');
    var canBack = false, canFwd = false;
    try { if (wv) canBack = wv.canGoBack(); } catch (e) {}
    try { if (wv) canFwd = wv.canGoForward(); } catch (e) {}
    if (backBtn) backBtn.disabled = !canBack;
    if (fwdBtn) fwdBtn.disabled = !canFwd;
  }

  function xxtShowConfirm(msg, title) {
    return new Promise((resolve) => {
      const modal = $('xxt-confirm-modal');
      const titleEl = $('xxt-confirm-title');
      const msgEl = $('xxt-confirm-msg');
      const okBtn = $('xxt-confirm-ok');
      const cancelBtn = $('xxt-confirm-cancel');
      if (!modal) { resolve(false); return; }
      titleEl.textContent = title || '确认';
      msgEl.textContent = msg;
      modal.style.display = 'flex';
      const cleanup = (result) => {
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        resolve(result);
      };
      okBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
    });
  }

  function initXxt() {
    if (!easemobChatStarted) {
      easemobChatStarted = true;
      initEasemobChat();
    }
    if (xxtTabs.length > 0) {
      $('xxt-placeholder').style.display = 'none';
      $('xxt-learning-info').style.display = 'none';
      $('xxt-browser-container').style.display = '';
      renderXxtTabs();
      if (xxtActiveTabId) activateXxtTab(xxtActiveTabId);
    } else {
      API.xxtCheckCookies().then(hasCookies => {
        if (hasCookies) {
          console.log('[XXT] Has cookies, auto-creating tabs');
          $('xxt-placeholder').style.display = 'none';
          $('xxt-learning-info').style.display = 'none';
          $('xxt-browser-container').style.display = '';
          const urls = ['https://mooc2-ans.chaoxing.com/visit/interaction', 'https://homepage.chaoxing.com', 'https://i.chaoxing.com/'];
          const labels = ['互动', '首页', '空间'];
          urls.forEach((url, i) => {
            const id = Date.now() + i;
            const tab = { id, url, title: labels[i] || '学习通', isDefault: true };
            xxtTabs.push(tab);
            createXxtWebview(tab, i === 0);
            if (i === 0) xxtActiveTabId = id;
          });
          const chatId = Date.now() + 3;
          xxtTabs.push({ id: chatId, url: '', title: '消息(实验性)', isChat: true, isDefault: true });
          renderXxtTabs();
        } else {
          const xxtInfo = $('xxt-learning-info');
          if (xxtInfo && xxtInfo.dataset.hasData) {
            xxtInfo.style.display = 'block';
          }
        }
      });
    }
    const btn = $('xxt-open-btn');
    if (btn) btn.onclick = () => API.openXxtWindow();
    const logoutBtn = $('xxt-logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        const ok = await xxtShowConfirm('确定要退出学习通登录吗？', '退出登录');
        if (!ok) return;
        xxtLoggedIn = false;
        pendingEasemobCreds = null;
        if (easemobConn) { try { easemobConn.close(); } catch (e) {} easemobConn = null; }
        easemobReady = false;
        easemobConversations = [];
        easemobActiveConvId = null;
        easemobMessages = {};
        try { localStorage.removeItem('easemobMessages'); } catch(e) {}
        API.clearEasemobCredentials();
        await API.xxtLogout();
        xxtTabs.forEach(t => { if (t.webview && t.webview.parentNode) t.webview.parentNode.removeChild(t.webview); });
        xxtTabs = [];
        xxtActiveTabId = null;
        hideXxtChatPanel();
        $('xxt-browser-container').style.display = 'none';
        $('xxt-placeholder').style.display = '';
        $('xxt-open-btn').disabled = false;
        $('xxt-open-btn').style.opacity = '1';
        const xxtInfo = $('xxt-learning-info');
        if (xxtInfo && xxtInfo.dataset.hasData) {
          xxtInfo.style.display = 'block';
        }
        renderXxtTabs();
      };
    }
    $('xxt-nav-back').onclick = () => { const wv = getXxtWebview(); if (wv && wv.canGoBack()) wv.goBack(); };
    $('xxt-nav-forward').onclick = () => { const wv = getXxtWebview(); if (wv && wv.canGoForward()) wv.goForward(); };
    $('xxt-nav-refresh').onclick = () => { const wv = getXxtWebview(); if (wv) wv.reload(); };

    var xxtTabsEl = $('xxt-tabs');
    var xxtDragTabId = null;
    var xxtDropIndicator = null;
    function getXxtDropIndicator() {
      if (!xxtDropIndicator) {
        xxtDropIndicator = document.createElement('div');
        xxtDropIndicator.className = 'browser-tab-drop-indicator';
        xxtDropIndicator.style.cssText = 'width:3px;background:var(--theme,#4a9eff);border-radius:2px;flex-shrink:0;display:none;align-self:stretch;margin:4px 0;box-shadow:0 0 6px var(--theme,#4a9eff);transition:all 0.1s;';
      }
      return xxtDropIndicator;
    }
    function showXxtDropIndicatorAt(tabEl, after) {
      var indicator = getXxtDropIndicator();
      if (after) {
        tabEl.parentNode.insertBefore(indicator, tabEl.nextSibling);
      } else {
        tabEl.parentNode.insertBefore(indicator, tabEl);
      }
      indicator.style.display = '';
    }
    function hideXxtDropIndicator() {
      var indicator = getXxtDropIndicator();
      if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
      indicator.style.display = 'none';
    }
    xxtTabsEl.addEventListener('dragstart', function(e) {
      var tab = e.target.closest('.xxt-tab');
      if (!tab) return;
      xxtDragTabId = parseInt(tab.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-xxt-tab-id', xxtDragTabId);
      tab.style.opacity = '0.5';
    });
    xxtTabsEl.addEventListener('dragend', function(e) {
      var tab = e.target.closest('.xxt-tab');
      if (tab) tab.style.opacity = '';
      xxtDragTabId = null;
      hideXxtDropIndicator();
    });
    xxtTabsEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var tabEls = xxtTabsEl.querySelectorAll('.xxt-tab');
      if (tabEls.length === 0) { hideXxtDropIndicator(); return; }
      var x = e.clientX;
      var found = false;
      for (var i = 0; i < tabEls.length; i++) {
        var tr = tabEls[i].getBoundingClientRect();
        var mid = tr.left + tr.width / 2;
        if (x < mid) {
          showXxtDropIndicatorAt(tabEls[i], false);
          found = true;
          break;
        }
      }
      if (!found) {
        showXxtDropIndicatorAt(tabEls[tabEls.length - 1], true);
      }
    });
    xxtTabsEl.addEventListener('dragleave', function(e) {
      if (!xxtTabsEl.contains(e.relatedTarget)) {
        hideXxtDropIndicator();
      }
    });
    xxtTabsEl.addEventListener('drop', function(e) {
      e.preventDefault();
      hideXxtDropIndicator();
      var tabId = e.dataTransfer.getData('text/x-xxt-tab-id');
      if (tabId) {
        tabId = parseInt(tabId);
        var fromIdx = xxtTabs.findIndex(function(t) { return t.id === tabId; });
        if (fromIdx === -1) return;
        var tabEls = xxtTabsEl.querySelectorAll('.xxt-tab');
        var toIdx = xxtTabs.length - 1;
        var x = e.clientX;
        for (var i = 0; i < tabEls.length; i++) {
          var tr = tabEls[i].getBoundingClientRect();
          var mid = tr.left + tr.width / 2;
          if (x < mid) { toIdx = i; break; }
        }
        if (toIdx > fromIdx) toIdx--;
        if (toIdx !== fromIdx) {
          var moved = xxtTabs.splice(fromIdx, 1)[0];
          xxtTabs.splice(toIdx, 0, moved);
          saveXxtTabs();
          renderXxtTabs();
        }
        return;
      }
    });
  }

  API.onXxtOpenNewTab((url) => {
    console.log('[XXT] onXxtOpenNewTab:', url);
    if (xxtTabs.length === 0) {
      var el = $('xxt-placeholder'); if (el) el.style.display = 'none';
      el = $('xxt-learning-info'); if (el) el.style.display = 'none';
      el = $('xxt-browser-container'); if (el) el.style.display = '';
    }
    xxtNewTab(url);
  });

  API.onXxtLoginState((state) => {
    const btn = $('xxt-open-btn');
    const sidebarBtn = document.querySelector('.sidebar-btn[data-page="xxt"]');
    if (btn) { btn.disabled = state; btn.style.opacity = state ? '0.5' : '1'; }
    if (sidebarBtn) { sidebarBtn.disabled = state; sidebarBtn.style.opacity = state ? '0.5' : '1'; }
  });

  API.onXxtLoginSuccess((urls) => {
    console.log('[XXT] onXxtLoginSuccess received urls:', urls);
    justLoggedIn = true;
    setTimeout(() => { justLoggedIn = false; }, 3000);
    $('xxt-placeholder').style.display = 'none';
    $('xxt-learning-info').style.display = 'none';
    $('xxt-browser-container').style.display = '';
    xxtTabs.forEach(t => { if (t.webview && t.webview.parentNode) t.webview.parentNode.removeChild(t.webview); });
    xxtTabs = [];
    xxtActiveTabId = null;
    const labels = ['互动', '首页', '空间'];
    urls.forEach((url, i) => {
      const id = Date.now() + i;
      const tab = { id, url, title: labels[i] || '学习通', isDefault: true };
      xxtTabs.push(tab);
      createXxtWebview(tab, i === 0);
      if (i === 0) xxtActiveTabId = id;
    });
    const chatId = Date.now() + 3;
    xxtTabs.push({ id: chatId, url: '', title: '消息(实验性)', isChat: true, isDefault: true });
    renderXxtTabs();
    xxtLoggedIn = true;
    tryConnectEasemobAfterLogin();
    // 兜底：5秒后仍未收到凭据则主动获取学习信息并连接环信
    setTimeout(function() {
      if (easemobReady || pendingEasemobCreds) return;
      console.log('[Easemob] 登录后5秒仍未收到凭据，主动尝试连接...');
      var nameEl = $('xxt-learning-name');
      var accEl = $('xxt-learning-account');
      var pwdEl = $('xxt-learning-password');
      var realName = nameEl ? nameEl.textContent : '';
      var account = accEl ? accEl.dataset.realValue || accEl.textContent : '';
      var password = pwdEl ? pwdEl.dataset.realValue || pwdEl.textContent : '';
      if (account && password && account !== '-' && password !== '-') {
        console.log('[Easemob] 使用已缓存的学习信息调用 SSO...');
        API.xxtSsoLoginSync({ username: account, password: password }).then(function(r) {
          if (r && r.huanxinId && r.hxToken) {
            console.log('[Easemob] 兜底 SSO 成功，开始连接');
            easemobLoginWithCredentials(r.huanxinId, r.hxToken);
          } else if (r && r.imAccount && r.imAccount.username && r.imAccount.password) {
            console.log('[Easemob] 兜底 SSO 返回 imAccount，直接连接:', r.imAccount.username);
            easemobConnect(r.imAccount.username, r.imAccount.password, true).then(function() {
              loadEasemobConversations();
              showToast('消息已连接', '环信消息服务已就绪', 'success', 2000);
            }).catch(function(err) {
              console.error('[Easemob] imAccount 连接失败:', err);
            });
          } else {
            console.log('[Easemob] 兜底 SSO 失败:', JSON.stringify(r).substring(0, 200));
          }
        }).catch(function(e) { console.error('[Easemob] 兜底 SSO 异常:', e); });
      } else {
        console.log('[Easemob] 无缓存的学习信息，无法兜底连接');
      }
    }, 5000);
  });

  API.onEasemobCredentials(function(creds) {
    console.log('[Easemob] 收到主进程转发的凭据:', creds.huanxinId || (creds.imAccount && creds.imAccount.username));
    if (creds && creds.huanxinId && creds.hxToken) {
      pendingEasemobCreds = creds;
      console.log('[Easemob] 凭据已保存，等待学习通登录后再连接');
      tryConnectEasemobAfterLogin();
    } else if (creds && creds.imAccount && creds.imAccount.username && creds.imAccount.password) {
      console.log('[Easemob] 收到 imAccount 凭据，直接连接');
      easemobConnect(creds.imAccount.username, creds.imAccount.password, true).then(function() {
        loadEasemobConversations();
        showToast('消息已连接', '环信消息服务已就绪', 'success', 2000);
      }).catch(function(err) {
        console.error('[Easemob] imAccount 连接失败:', err);
      });
    }
  });

  function syncXxtLearningInfo(realName, unitText, data) {
    const el = $('xxt-learning-info');
    if (!el) return;
    const items = [
      { id: 'xxt-learning-name', val: realName },
      { id: 'xxt-learning-unit', val: unitText },
      { id: 'xxt-learning-account', val: data.account || '-' },
      { id: 'xxt-learning-password', val: data.password || '-' }
    ];
    items.forEach(item => {
      const span = $(item.id);
      if (span) { span.textContent = item.val; span.dataset.realValue = item.val; }
    });
    el.dataset.hasData = '1';
    $('xxt-learning-info-data-row').style.display = '';
    $('xxt-learning-info-no-data-row').style.display = 'none';
    if (xxtTabs.length === 0) el.style.display = 'block';
    toggleXxtLearningSensitive(true);
    el.querySelectorAll('.copy-btn').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.copy;
        let text = '';
        if (type === 'unit') text = $('xxt-learning-unit').dataset.realValue || '';
        else if (type === 'account') text = $('xxt-learning-account').dataset.realValue || '';
        else if (type === 'password') text = $('xxt-learning-password').dataset.realValue || '';
        navigator.clipboard.writeText(text).then(() => showToast('已复制', '内容已复制到剪贴板', 'success', 2000));
      };
    });
    const toggleBtn = $('xxt-learning-toggle');
    if (toggleBtn) {
      toggleBtn.querySelector('i').className = 'fa-solid fa-eye';
      const textSpan = $('xxt-learning-toggle-text');
      if (textSpan) textSpan.textContent = '显示';
      toggleBtn.onclick = () => {
        const hidden = toggleXxtLearningSensitive();
        toggleBtn.querySelector('i').className = hidden ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
        $('xxt-learning-toggle-text').textContent = hidden ? '显示' : '隐藏';
      };
    }
  }

  function showXxtLearningInfoNoData() {
    const el = $('xxt-learning-info');
    if (!el) return;
    $('xxt-learning-info-data-row').style.display = 'none';
    $('xxt-learning-info-no-data-row').style.display = '';
    if (xxtTabs.length === 0) el.style.display = 'block';
  }

  function toggleXxtLearningSensitive(hidden) {
    const el = $('xxt-learning-info');
    if (!el) return;
    if (hidden === undefined) {
      const current = el.classList.contains('info-hidden');
      hidden = !current;
    }
    el.classList.toggle('info-hidden', hidden);
    const fields = [
      { id: 'xxt-learning-name' },
      { id: 'xxt-learning-unit' },
      { id: 'xxt-learning-account' },
      { id: 'xxt-learning-password' }
    ];
    fields.forEach(f => {
      const span = document.getElementById(f.id);
      if (!span) return;
      if (hidden) {
        span.dataset.realValue = span.dataset.realValue || span.textContent;
        span.textContent = '*'.repeat(span.dataset.realValue.length || span.textContent.length);
      } else {
        span.textContent = span.dataset.realValue || span.textContent;
      }
    });
    return hidden;
  }

  function updateTabUrl(tabId, url) {
    if (url === 'about:blank') return;
    const tab = browserTabs.find(t => t.id === tabId);
    if (tab) { tab.url = url; saveTabs(); renderTabs(); }
  }

  function updateTabAudible(tabId, audible) {
    const tabEl = document.querySelector('.browser-tab[data-id="' + tabId + '"]');
    if (!tabEl) return;
    const audioEl = tabEl.querySelector('.browser-tab-audio');
    if (!audioEl) return;
    if (audible) {
      audioEl.classList.add('audible');
    } else {
      audioEl.classList.remove('audible');
    }
  }

  function updateTabTitle(tabId, title) {
    const tab = browserTabs.find(t => t.id === tabId);
    if (tab) { tab.title = title; saveTabs(); renderTabs(); }
  }

  function updateTabFavicon(tabId, favicon) {
    const tab = browserTabs.find(t => t.id === tabId);
    if (tab && favicon) { tab.favicon = favicon; saveTabs(); renderTabs(); }
  }

  function addHistory(title, url) {
    if (!url || url === 'about:blank') return;
    const tab = browserTabs.find(t => t.id === activeTabId);
    browserHistory = browserHistory.filter(h => h.url !== url);
    browserHistory.unshift({ title, url, favicon: tab ? tab.favicon || '' : '', time: Date.now() });
    if (browserHistory.length > 50) browserHistory = browserHistory.slice(0, 50);
    localStorage.setItem('browserHistory', JSON.stringify(browserHistory));
  }

  function renderTabs() {
    const tabsEl = $('browser-tabs');
    tabsEl.innerHTML = browserTabs.map(t =>
      `<div class="browser-tab${t.id === activeTabId ? ' active' : ''}" data-id="${t.id}" draggable="true">
        ${t.favicon ? `<img class="browser-tab-icon" src="${escapeHtml(t.favicon)}">` : `<i class="fa-solid fa-globe browser-tab-icon-default"></i>`}
        <span class="browser-tab-title">${escapeHtml(t.title || '新标签页')}</span>
        <span class="browser-tab-audio${t.audible ? ' audible' : ''}"><i class="fa-solid fa-volume-high"></i></span>
        <span class="browser-tab-close">×</span>
      </div>`
    ).join('') + `<button class="browser-new-tab" id="browser-new-tab" title="新建标签页"><i class="fa-solid fa-plus"></i></button>`;
    tabsEl.onclick = (e) => {
      const closeBtn = e.target.closest('.browser-tab-close');
      if (closeBtn) {
        e.stopPropagation();
        closeTab(parseInt(closeBtn.parentElement.dataset.id), e);
        return;
      }
      const tab = e.target.closest('.browser-tab');
      if (tab) activateTab(parseInt(tab.dataset.id));
    };
    const newTabBtn = tabsEl.querySelector('#browser-new-tab');
    if (newTabBtn) newTabBtn.onclick = () => newTab();

    tabsEl.onwheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        tabsEl.scrollLeft += e.deltaY;
      }
    };
  }

  function showTabContextMenu(x, y) {
    const wv = getActiveWebview();
    let old = $('tab-context-menu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.id = 'tab-context-menu';
    menu.className = 'context-menu';
    menu.style.cssText = `left:${x}px;top:${y}px;`;
    menu.innerHTML = `
      <div class="context-item" data-action="refresh"><i class="fa-solid fa-rotate"></i> 刷新</div>
      <div class="context-item" data-action="back"><i class="fa-solid fa-arrow-left"></i> 后退</div>
      <div class="context-item" data-action="forward"><i class="fa-solid fa-arrow-right"></i> 前进</div>
      <div class="context-sep"></div>
      <div class="context-item" data-action="close"><i class="fa-solid fa-xmark"></i> 关闭标签页</div>
    `;
    menu.querySelectorAll('.context-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        if (action === 'refresh' && wv) wv.reload();
        else if (action === 'back' && wv && wv.canGoBack()) wv.goBack();
        else if (action === 'forward' && wv && wv.canGoForward()) wv.goForward();
        else if (action === 'close') closeTab(activeTabId, { stopPropagation: () => {} });
        menu.remove();
      });
    });
    document.body.appendChild(menu);
    const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  function renderHistory() {
    const el = $('browser-history');
    if (browserHistory.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px;"><i class="fa-solid fa-globe" style="font-size:48px;opacity:0.3;display:block;margin-bottom:12px;"></i><span>新建标签页开始浏览</span></div>';
      return;
    }
    el.innerHTML = `<div class="history-header">
      <span class="history-title-text">历史记录</span>
      <button class="history-clear-all" id="history-clear-all"><i class="fa-solid fa-trash"></i> 清除全部</button>
    </div>` + browserHistory.map(h => {
      const time = new Date(h.time);
      const timeStr = time.toLocaleDateString() === new Date().toLocaleDateString()
        ? time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : time.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      return `<div class="browser-history-item" data-url="${escapeHtml(h.url)}">
        <div class="history-icon">${h.favicon ? `<img class="history-favicon" src="${escapeHtml(h.favicon)}">` : `<i class="fa-solid fa-globe"></i>`}</div>
        <div class="history-info">
          <div class="history-title">${escapeHtml(h.title || h.url)}</div>
          <div class="history-url">${escapeHtml(h.url)}</div>
        </div>
        <div class="history-time">${timeStr}</div>
        <button class="history-del" data-url="${escapeHtml(h.url)}" title="删除"><i class="fa-solid fa-xmark"></i></button>
      </div>`;
    }).join('');
    el.querySelectorAll('.browser-history-item').forEach(item => {
      item.addEventListener('click', () => browserNavigate(item.dataset.url));
    });
    el.querySelectorAll('.history-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        browserHistory = browserHistory.filter(h => h.url !== btn.dataset.url);
        localStorage.setItem('browserHistory', JSON.stringify(browserHistory));
        renderHistory();
      });
    });
    const clearBtn = $('history-clear-all');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        browserHistory = [];
        localStorage.setItem('browserHistory', JSON.stringify(browserHistory));
        renderHistory();
      });
    }
  }

  // ==================== 公告 ====================
  async function loadAnnouncements() {
    const container = $('announcements-container');
    container.innerHTML = '<div class="empty-state">正在加载...</div>';
    try {
      const data = await apiFetch('/api/announcements', { noRetry: true });
      if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无公告</div>';
        return;
      }
      container.innerHTML = data.map(a => {
        const imgHtml = a.image ? `<img class="ann-img" src="${escapeHtml(a.image)}" alt="${escapeHtml(a.title || '')}">` : '';
        const titleHtml = a.title ? `<div class="ann-title">${escapeHtml(a.title)}</div>` : '';
        const textHtml = a.content ? `<div class="ann-text">${escapeHtml(a.content)}</div>` : '';
        const dateHtml = a.date ? `<div class="ann-date">${escapeHtml(a.date)}</div>` : '';
        return `<div class="announcement-card">${imgHtml}<div class="ann-body">${titleHtml}${textHtml}${dateHtml}</div></div>`;
      }).join('');
    } catch (err) {
      container.innerHTML = '<div class="empty-state">加载失败: ' + escapeHtml(err.message) + '</div>';
    }
  }

  // ========== 来电窗口动作监听 ==========
  var currentCallInfo = null;
  API.onCallWindowAction(function(action) {
    console.log('[Call] 收到动作:', action);
    if (action === 'answer' && currentCallInfo) {
      sendEasemobCallAction('answer', currentCallInfo);
    }
    if (action === 'reject') {
      if (currentCallInfo) sendEasemobCallAction('cancelCall', currentCallInfo);
      API.stopCallRing(); API.closeCallWindow();
    }
    if (action === 'hangup') {
      if (currentCallInfo) sendEasemobCallAction('cancelCall', currentCallInfo);
      API.stopCallRing(); API.closeCallWindow();
    }
  });
  API.onCallWindowClosed(function() {
    API.stopCallRing();
  });

  document.addEventListener('DOMContentLoaded', init);
})();