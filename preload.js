const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

let clientConfig = {};
try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        clientConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
} catch (e) {
    console.error('[Preload] 读取客户端配置文件失败:', e.message);
}

let mmdDir, mmdBlobsDir, mmdModelsPath, mmdAiDir, mmdAiProjectsPath;
try {
    const userDataPath = ipcRenderer.sendSync('get-user-data-path');
    mmdDir = path.join(userDataPath, 'mmd');
    mmdBlobsDir = path.join(mmdDir, 'blobs');
    mmdModelsPath = path.join(mmdDir, 'models.json');
    mmdAiDir = path.join(mmdDir, 'ai_images');
    mmdAiProjectsPath = path.join(mmdAiDir, 'projects.json');
    if (!fs.existsSync(mmdDir)) fs.mkdirSync(mmdDir, { recursive: true });
    if (!fs.existsSync(mmdBlobsDir)) fs.mkdirSync(mmdBlobsDir, { recursive: true });
    if (!fs.existsSync(mmdAiDir)) fs.mkdirSync(mmdAiDir, { recursive: true });
} catch (e) {
    console.error('[MMD preload] init failed:', e.message);
}

function loadModelsJson() {
    if (!mmdModelsPath) return [];
    try { if (fs.existsSync(mmdModelsPath)) return JSON.parse(fs.readFileSync(mmdModelsPath, 'utf-8')); }
    catch (e) { console.error('[MMD preload] loadModelsJson:', e.message); }
    return [];
}
function saveModelsJson(models) {
    if (!mmdModelsPath) return;
    try { fs.writeFileSync(mmdModelsPath, JSON.stringify(models, null, 2), 'utf-8'); }
    catch (e) { console.error('[MMD preload] saveModelsJson:', e.message); }
}
function loadAiProjectsJson() {
    if (!mmdAiProjectsPath) return [];
    try { if (fs.existsSync(mmdAiProjectsPath)) return JSON.parse(fs.readFileSync(mmdAiProjectsPath, 'utf-8')); }
    catch (e) { console.error('[MMDAI preload] loadAiProjectsJson:', e.message); }
    return [];
}
function saveAiProjectsJson(projects) {
    if (!mmdAiProjectsPath) return;
    try { fs.writeFileSync(mmdAiProjectsPath, JSON.stringify(projects, null, 2), 'utf-8'); }
    catch (e) { console.error('[MMDAI preload] saveAiProjectsJson:', e.message); }
}

contextBridge.exposeInMainWorld('electronAPI', {
    getClientConfig: () => clientConfig,
    getFilePath: (file) => {
        try { return webUtils.getPathForFile(file) || file.path || null; } catch (e) { return file.path || null; }
    },
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    quitApp: () => ipcRenderer.send('app-quit'),

    setAutoStart: (enable) => ipcRenderer.send('set-auto-start', enable),
    getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    setTitle: (title) => ipcRenderer.send('set-title', title),

    setEscHideEnabled: (enable) => ipcRenderer.send('set-esc-hide-enabled', enable),
    setGlobalShortcutEnabled: (enable) => ipcRenderer.send('set-global-shortcut-enabled', enable),
    setGlobalShortcutKey: (shortcut) => ipcRenderer.send('set-global-shortcut-key', shortcut),

    setZoomFactor: (factor) => ipcRenderer.send('set-zoom-factor', factor),
    getZoomFactor: () => ipcRenderer.invoke('get-zoom-factor'),

    setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),
    setDeveloper: (dev) => ipcRenderer.send('set-developer', dev),

    checkForUpdate: () => ipcRenderer.invoke('check-update-local'),
    fetchUpdateInfo: (url) => ipcRenderer.invoke('fetch-update-info', url),
    autoUpdate: (downloadUrl, version) => ipcRenderer.send('auto-update', downloadUrl, version),
    installUpdate: (installerPath) => ipcRenderer.send('install-update', installerPath),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, percent) => callback(percent)),
    onFileDownloadProgress: (callback) => ipcRenderer.on('file-download-progress', (event, percent, fileName) => callback(percent, fileName)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, installerPath) => callback(installerPath)),
    onUpdateDownloadError: (callback) => ipcRenderer.on('update-download-error', (event, errMsg) => callback(errMsg)),
    onUpdateReady: (callback) => ipcRenderer.on('update-ready', (event, info) => callback(info)),

    onNetworkStatus: (callback) => {
        ipcRenderer.on('network-status', (event, online) => callback(online));
    },

    downloadFile: (url, fileName, token) => ipcRenderer.invoke('download-file', { url, fileName, token }),
    cancelDownload: () => ipcRenderer.send('cancel-download'),
    selectFile: () => ipcRenderer.invoke('select-file'),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

    saveBackgroundFile: (filePath, filename) => {
        return ipcRenderer.invoke('save-background-file', filePath, filename);
    },
    saveSplashFile: (filePath, filename) => {
        return ipcRenderer.invoke('save-splash-file', filePath, filename);
    },
    removeSplash: () => ipcRenderer.invoke('remove-splash'),
    saveFontFile: (filePath, filename) => ipcRenderer.invoke('save-font-file', filePath, filename),
    getFontInfo: () => ipcRenderer.invoke('get-font-info'),
    removeFont: () => ipcRenderer.invoke('remove-font'),
    getBackgroundInfo: () => ipcRenderer.invoke('get-background-info'),
    removeBackground: () => ipcRenderer.invoke('remove-background'),
    setBackgroundPlaybackRate: (rate) => ipcRenderer.send('set-background-playback-rate', rate),
    onLoadSavedBackground: (callback) => ipcRenderer.on('load-saved-background', (event, bgInfo) => callback(bgInfo)),
    onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (event, filePath) => callback(filePath)),
    onDownloadError: (callback) => ipcRenderer.on('download-error', (event, errMsg) => callback(errMsg)),
    onDownloadCanceled: (callback) => ipcRenderer.on('download-canceled', (event, fileName) => callback(fileName)),

    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    onWindowStateChange: (callback) => {
        ipcRenderer.on('window-state-changed', (event, isMax) => callback(isMax));
    },
    onWindowHiding: (callback) => ipcRenderer.on('window-hiding', () => callback()),

    onWebviewNavigate: (callback) => ipcRenderer.on('webview-navigate', (event, url) => callback(url)),
    onOpenNewTab: (callback) => ipcRenderer.on('open-new-tab', (event, url) => callback(url)),

    openXxtWindow: () => ipcRenderer.invoke('open-xxt-window'),
    xxtCheckCookies: () => ipcRenderer.invoke('xxt-check-cookies'),
    xxtLogout: () => ipcRenderer.invoke('xxt-logout'),
    onXxtLoginState: (callback) => ipcRenderer.on('xxt-login-state', (event, state) => callback(state)),
    onXxtLoginSuccess: (callback) => ipcRenderer.on('xxt-login-success', (event, urls) => callback(urls)),
    onXxtOpenNewTab: (callback) => ipcRenderer.on('xxt-open-new-tab', (event, url) => callback(url)),

    getAcrylicEnabled: () => ipcRenderer.invoke('get-acrylic-enabled'),
    setAcrylicEnabled: (enabled) => ipcRenderer.invoke('set-acrylic-enabled', enabled),
    setWindowTransparent: (enabled) => ipcRenderer.invoke('set-window-transparent', enabled),
    getWindowTransparent: () => ipcRenderer.invoke('get-window-transparent'),
    setWindowOpacity: (value) => ipcRenderer.invoke('set-window-opacity', value),
    getWindowOpacity: () => ipcRenderer.invoke('get-window-opacity'),
    setWindowClickThrough: (enabled) => ipcRenderer.invoke('set-window-clickthrough', enabled),
    setMinSize: (minW, minH) => ipcRenderer.invoke('set-min-size', minW, minH),
    getWindowClickThrough: () => ipcRenderer.invoke('get-window-clickthrough'),
    setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
    toggleDevPanel: () => ipcRenderer.invoke('toggle-dev-panel'),
    isDevPanelOpen: () => ipcRenderer.invoke('is-dev-panel-open'),
    closeDevPanel: () => ipcRenderer.send('dev-panel-close'),
    minimizeDevPanel: () => ipcRenderer.send('dev-panel-minimize'),
    setDevPanelAlwaysOnTop: (flag) => ipcRenderer.send('dev-panel-always-on-top', flag),
    isDevPanelAlwaysOnTop: () => ipcRenderer.invoke('is-dev-panel-always-on-top'),
    setMainWindowClickThrough: (flag) => ipcRenderer.send('main-window-click-through', flag),
    setDevPanelShortcutEnabled: (enable) => ipcRenderer.send('set-dev-panel-shortcut-enabled', enable),
    setDevPanelShortcutKey: (shortcut) => ipcRenderer.send('set-dev-panel-shortcut-key', shortcut),
    setExtShortcutEnabled: (enable) => ipcRenderer.send('set-ext-shortcut-enabled', enable),
    setExtShortcutKey: (shortcut) => ipcRenderer.send('set-ext-shortcut-key', shortcut),
    onExtShortcutTriggered: (callback) => ipcRenderer.on('ext-shortcut-triggered', () => callback()),
    setAlwaysOnTopShortcutEnabled: (enable) => ipcRenderer.send('set-always-on-top-shortcut-enabled', enable),
    setAlwaysOnTopShortcutKey: (shortcut) => ipcRenderer.send('set-always-on-top-shortcut-key', shortcut),
    setBrowserHideShortcutEnabled: (enable) => ipcRenderer.send('set-browser-hide-shortcut-enabled', enable),
    setBrowserHideShortcutKey: (shortcut) => ipcRenderer.send('set-browser-hide-shortcut-key', shortcut),
    setCustomUA: (ua) => ipcRenderer.send('set-custom-ua', ua),
    relaunchApp: () => ipcRenderer.send('relaunch-app'),
    onBrowserHideShortcutTriggered: (callback) => ipcRenderer.on('browser-hide-shortcut-triggered', () => callback()),
    setOpacityShortcutEnabled: (enable) => ipcRenderer.send('set-opacity-shortcut-enabled', enable),
    getOpacityShortcutEnabled: () => ipcRenderer.invoke('get-opacity-shortcut-enabled'),
    onWindowOpacityChanged: (callback) => ipcRenderer.on('window-opacity-changed', (event, val) => callback(val)),
    setDarkMode: (value) => ipcRenderer.send('set-dark-mode', value),
    getDarkMode: () => ipcRenderer.invoke('get-dark-mode'),
    onDarkModeChanged: (callback) => ipcRenderer.on('dark-mode-changed', (event, value) => callback(value)),
    setDarkModeShortcutEnabled: (enable) => ipcRenderer.send('set-dark-mode-shortcut-enabled', enable),
    getDarkModeShortcutEnabled: () => ipcRenderer.invoke('get-dark-mode-shortcut-enabled'),
    openDevTools: () => ipcRenderer.send('open-main-devtools'),
    toggleMainWindow: () => ipcRenderer.send('toggle-main-window'),
    refocusMainWindow: () => ipcRenderer.send('refocus-main-window'),
    onPinStateChanged: (callback) => ipcRenderer.on('pin-state-changed', (event, pinned) => callback(pinned)),
    onClickThroughStateChanged: (callback) => ipcRenderer.on('clickthrough-state-changed', (event, enabled) => callback(enabled)),
    onBlockedProtocol: (callback) => ipcRenderer.on('blocked-protocol', (event, url, protocol) => callback(url, protocol)),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser'),
    isDefaultBrowser: () => ipcRenderer.invoke('is-default-browser'),
    registerCustomProtocol: () => ipcRenderer.invoke('register-custom-protocol'),
    getPendingExternalUrl: () => ipcRenderer.invoke('get-pending-external-url'),
    onProtocolUrl: (callback) => {
        ipcRenderer.on('protocol-url', (event, url) => callback(url));
    },

    registerXxtWebview: (webContentsId) => ipcRenderer.send('register-xxt-webview', webContentsId),
    onEasemobCredentials: (callback) => ipcRenderer.on('xxt-login-credentials-renderer', (event, creds) => callback(creds)),

    getEasemobCredentials: () => ipcRenderer.invoke('get-easemob-credentials'),
    clearEasemobCredentials: () => ipcRenderer.invoke('clear-easemob-credentials'),
    xxtSsoLoginSync: (creds) => ipcRenderer.invoke('xxt-sso-login-sync', creds),
    xxtFetchChatToken: (params) => ipcRenderer.invoke('xxt-fetch-chat-token', params),
    getXxtPreloadPath: () => ipcRenderer.invoke('get-xxt-preload-path'),
    getCxstudyPath: () => ipcRenderer.invoke('get-cxstudy-path'),
    readCxstudyConfig: () => ipcRenderer.invoke('read-cxstudy-config'),

    // 来电窗口
    showCallWindow: (callInfo) => ipcRenderer.invoke('show-call-window', callInfo),
    closeCallWindow: () => ipcRenderer.invoke('close-call-window'),
    callWindowMinimize: () => ipcRenderer.invoke('call-window-minimize'),
    startCallRing: () => ipcRenderer.invoke('start-call-ring'),
    stopCallRing: () => ipcRenderer.invoke('stop-call-ring'),
    getRingPath: () => ipcRenderer.invoke('get-ring-path'),
    sendCallAction: (action) => ipcRenderer.send('call-window-action', action),
    onCallInfo: (callback) => ipcRenderer.on('call-info', (event, info) => callback(info)),
    onCallWindowAction: (callback) => ipcRenderer.on('call-window-action', (event, action) => callback(action)),
    onCallWindowClosed: (callback) => ipcRenderer.on('call-window-closed', () => callback()),

    // 窗口抖动
    shakeWindow: () => ipcRenderer.invoke('shake-window'),
    startWindowDance: () => ipcRenderer.invoke('start-window-dance'),
    stopWindowDance: () => ipcRenderer.invoke('stop-window-dance'),
    startWindowBounce: () => ipcRenderer.invoke('start-window-bounce'),
    stopWindowBounce: () => ipcRenderer.invoke('stop-window-bounce'),
    onBounceStoppedByKey: (callback) => ipcRenderer.on('bounce-stopped-by-key', () => callback()),

    // Python
    runPython: (code) => ipcRenderer.invoke('run-python', code),
    isPythonRunning: () => ipcRenderer.invoke('is-python-running'),
    savePythonFile: (content, defaultPath) => ipcRenderer.invoke('save-python-file', { content, defaultPath }),
    savePythonFileDirect: (content, filePath) => ipcRenderer.invoke('save-python-file-direct', { content, filePath }),
    openPythonFile: () => ipcRenderer.invoke('open-python-file'),
    pythonReplStart: () => ipcRenderer.invoke('python-repl-start'),
    pythonReplStop: () => ipcRenderer.invoke('python-repl-stop'),
    pythonReplInput: (input) => ipcRenderer.invoke('python-repl-input', input),
    pythonReplInterrupt: () => ipcRenderer.invoke('python-repl-interrupt'),

    // MMD 模型直接文件存储（preload 直写，绕过 IPC 序列化损坏问题）
    mmdGetModels: () => {
        const models = loadModelsJson();
        for (const m of models) {
            if (m.texturesDir && fs.existsSync(m.texturesDir)) {
                try {
                    m.textureFiles = fs.readdirSync(m.texturesDir).map(f => ({ name: f, path: path.join(m.texturesDir, f) }));
                } catch (e) { m.textureFiles = []; }
            } else { m.textureFiles = []; }
        }
        return models;
    },
    mmdSaveModel: (data) => {
        console.log('[MMD preload] mmdSaveModel called, mmdBlobsDir:', mmdBlobsDir);
        if (!mmdBlobsDir) { console.error('[MMD preload] mmdBlobsDir is falsy!'); return 0; }
        const { name, modelType, pmxTextureNames, modelFileName, modelBuffer, textureData } = data;
        console.log('[MMD preload] modelFileName:', modelFileName, 'modelBuffer byteLength:', modelBuffer && modelBuffer.byteLength);
        console.log('[MMD preload] first 4 bytes of modelBuffer:', Buffer.from(modelBuffer).slice(0, 4).toString('hex'));
        const models = loadModelsJson();
        console.log('[MMD preload] loaded models count:', models.length);
        const id = Date.now();
        const modelDir = path.join(mmdBlobsDir, String(id));
        fs.mkdirSync(modelDir, { recursive: true });
        const ext = path.extname(modelFileName || '') || '.' + (modelType || 'pmx');
        const modelDest = path.join(modelDir, 'model' + ext);
        fs.writeFileSync(modelDest, Buffer.from(modelBuffer));
        const verifyBuf = fs.readFileSync(modelDest);
        console.log('[MMD preload] wrote model to:', modelDest, 'size:', Buffer.from(modelBuffer).length, 'verify first 4 bytes:', verifyBuf.slice(0, 4).toString('hex'));
        let texturesDir = null;
        if (textureData && textureData.length > 0) {
            texturesDir = path.join(modelDir, 'textures');
            fs.mkdirSync(texturesDir, { recursive: true });
            for (const td of textureData) {
                try { fs.writeFileSync(path.join(texturesDir, td.name), Buffer.from(td.buffer)); } catch (e) {}
            }
        }
        const entry = { id, name, modelType: modelType || '', pmxTextureNames: pmxTextureNames || [], modelPath: modelDest, texturesDir, config: null, previewImage: null, createdAt: Date.now() };
        models.push(entry);
        saveModelsJson(models);
        console.log('[MMD preload] saved models.json, returning id:', id);
        return id;
    },
    mmdDeleteModel: (id) => {
        const models = loadModelsJson();
        const idx = models.findIndex(m => m.id === id);
        if (idx !== -1) models.splice(idx, 1);
        saveModelsJson(models);
        const modelDir = path.join(mmdBlobsDir, String(id));
        if (fs.existsSync(modelDir)) { try { fs.rmSync(modelDir, { recursive: true, force: true }); } catch (e) {} }
    },
    mmdUpdateConfig: ({ id, config }) => {
        const models = loadModelsJson();
        const m = models.find(x => x.id === id);
        if (!m) return;
        m.config = config;
        saveModelsJson(models);
    },
    mmdRenameModel: ({ id, name }) => {
        const models = loadModelsJson();
        const m = models.find(x => x.id === id);
        if (!m) return;
        m.name = name;
        saveModelsJson(models);
    },
    mmdUpdateTextures: ({ id, textureData }) => {
        const models = loadModelsJson();
        const m = models.find(x => x.id === id);
        if (!m) return;
        const modelDir = path.join(mmdBlobsDir, String(id));
        const texturesDir = path.join(modelDir, 'textures');
        if (fs.existsSync(texturesDir)) {
            try { fs.readdirSync(texturesDir).forEach(f => { try { fs.unlinkSync(path.join(texturesDir, f)); } catch (e) {} }); } catch (e) {}
        } else { fs.mkdirSync(texturesDir, { recursive: true }); }
        if (textureData && textureData.length > 0) {
            for (const td of textureData) {
                try { fs.writeFileSync(path.join(texturesDir, td.name), Buffer.from(td.buffer)); } catch (e) {}
            }
        }
        m.texturesDir = texturesDir;
        saveModelsJson(models);
    },
    mmdUpdatePreview: ({ id, dataURL }) => {
        const models = loadModelsJson();
        const m = models.find(x => x.id === id);
        if (!m) return;
        m.previewImage = dataURL;
        saveModelsJson(models);
    },
    mmdSaveVMD: ({ id, name, buffer }) => {
        if (!mmdBlobsDir) return;
        var modelDir = path.join(mmdBlobsDir, String(id));
        if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true });
        var vmdPath = path.join(modelDir, name);
        fs.writeFileSync(vmdPath, Buffer.from(buffer));
    },
    mmdReadVMD: ({ id, name }) => {
        if (!mmdBlobsDir) return null;
        var modelDir = path.join(mmdBlobsDir, String(id));
        var vmdPath = path.join(modelDir, name);
        if (!fs.existsSync(vmdPath)) return null;
        var buf = fs.readFileSync(vmdPath);
        return Array.from(new Uint8Array(buf));
    },
    mmdReadAI: ({ id, file }) => {
        if (!mmdBlobsDir) return null;
        var p = path.join(mmdBlobsDir, String(id), file);
        if (!fs.existsSync(p)) return null;
        return fs.readFileSync(p, 'utf-8');
    },
    mmdWriteAI: ({ id, file, content }) => {
        if (!mmdBlobsDir) return;
        var dir = path.join(mmdBlobsDir, String(id));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, file), content, 'utf-8');
    },
    mmdAiRenameProject: ({ id, name }) => {
        const projects = loadAiProjectsJson();
        const p = projects.find(x => x.id === id);
        if (!p) return;
        p.name = name;
        saveAiProjectsJson(projects);
    },
    mmdAiEnsureDefault: () => {
        const projects = loadAiProjectsJson();
        if (projects.length > 0) return;
        const id = Date.now();
        const projDir = path.join(mmdAiDir, String(id));
        const imgDir = path.join(projDir, 'images');
        fs.mkdirSync(imgDir, { recursive: true });
        var appIcon = path.join(__dirname, 'icon.ico');
        if (!fs.existsSync(appIcon)) appIcon = path.join(__dirname, '..', 'icon.ico');
        fs.copyFileSync(appIcon, path.join(imgDir, 'icon.ico'));
        const entry = { id, name: '默认项目', imageCount: 1, createdAt: Date.now() };
        projects.push(entry);
        saveAiProjectsJson(projects);
    },
    mmdAiGetProjects: () => {
        const projects = loadAiProjectsJson();
        for (const p of projects) {
            const imgDir = path.join(mmdAiDir, String(p.id), 'images');
            if (fs.existsSync(imgDir)) {
                try { p.imageFiles = fs.readdirSync(imgDir).filter(f => /\.(png|jpg|jpeg|gif|webp|bmp|ico)$/i.test(f)); }
                catch (e) { p.imageFiles = []; }
            } else { p.imageFiles = []; }
        }
        return projects;
    },
    mmdAiSaveProject: (data) => {
        if (!mmdAiDir) return 0;
        const { name, imageBuffers } = data;
        const projects = loadAiProjectsJson();
        const id = Date.now();
        const projDir = path.join(mmdAiDir, String(id));
        fs.mkdirSync(projDir, { recursive: true });
        let imageFiles = [];
        if (imageBuffers && imageBuffers.length > 0) {
            const imgDir = path.join(projDir, 'images');
            fs.mkdirSync(imgDir, { recursive: true });
            for (const ib of imageBuffers) {
                try {
                    fs.writeFileSync(path.join(imgDir, ib.name), Buffer.from(ib.buffer));
                    imageFiles.push(ib.name);
                } catch (e) {}
            }
        }
        const entry = { id, name, imageCount: imageFiles.length, createdAt: Date.now() };
        projects.push(entry);
        saveAiProjectsJson(projects);
        return id;
    },
    mmdAiDeleteProject: (id) => {
        const projects = loadAiProjectsJson();
        const idx = projects.findIndex(p => p.id === id);
        if (idx !== -1) projects.splice(idx, 1);
        saveAiProjectsJson(projects);
        const projDir = path.join(mmdAiDir, String(id));
        if (fs.existsSync(projDir)) { try { fs.rmSync(projDir, { recursive: true, force: true }); } catch (e) {} }
    },
    mmdAiUpdateProjectConfig: ({ id, miniW, miniH }) => {
        const projects = loadAiProjectsJson();
        const p = projects.find(x => x.id === id);
        if (!p) return false;
        if (miniW !== undefined) p.miniW = miniW;
        if (miniH !== undefined) p.miniH = miniH;
        saveAiProjectsJson(projects);
        return true;
    },
    mmdAiReadFile: ({ id, file }) => {
        if (!mmdAiDir) return null;
        var p = path.join(mmdAiDir, String(id), file);
        if (!fs.existsSync(p)) return null;
        return fs.readFileSync(p, 'utf-8');
    },
    mmdAiWriteFile: ({ id, file, content }) => {
        if (!mmdAiDir) return;
        var dir = path.join(mmdAiDir, String(id));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, file), content, 'utf-8');
    },
    mmdAiGetImageBase64: ({ id, name }) => {
        if (!mmdAiDir) return null;
        var p = path.join(mmdAiDir, String(id), 'images', name);
        if (!fs.existsSync(p)) return null;
        var buf = fs.readFileSync(p);
        var ext = path.extname(name).toLowerCase().replace('.', '');
        var mime = ext === 'gif' ? 'image/gif' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'bmp' ? 'image/bmp' : ext === 'ico' ? 'image/x-icon' : 'image/jpeg';
        return 'data:' + mime + ';base64,' + buf.toString('base64');
    },
    mmdAiAddImages: ({ id, imageBuffers }) => {
        if (!mmdAiDir) return [];
        var projDir = path.join(mmdAiDir, String(id));
        var imgDir = path.join(projDir, 'images');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        var added = [];
        for (const ib of imageBuffers) {
            try {
                fs.writeFileSync(path.join(imgDir, ib.name), Buffer.from(ib.buffer));
                added.push(ib.name);
            } catch (e) {}
        }
        var projects = loadAiProjectsJson();
        var p = projects.find(x => x.id === id);
        if (p) { p.imageCount = (p.imageCount || 0) + added.length; saveAiProjectsJson(projects); }
        return added;
    },
    mmdGetUserDataPath: () => {
        try { return ipcRenderer.sendSync('get-user-data-path'); } catch (e) { return null; }
    },
});