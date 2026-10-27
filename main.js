const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, session, protocol, safeStorage, shell, screen } = require('electron');
const _origShellOpenExternal = shell.openExternal;
shell.openExternal = function(url, options) {
    console.log('[Main] shell.openExternal CALL:', url, '| blocked:', !!isBlockedProtocol(url));
    console.log(new Error('DEBUG stack').stack);
    return _origShellOpenExternal.call(shell, url, options);
};
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

let mainWindow = null;
let progressWindow = null;
let xxtLoginWindow = null;
let callWindow = null;   // 来电窗口
let xxtSession = null;  // 学习通专用 session
const xxtWebContentsIds = new Set();  // 追踪学习通 webview 的 webContents ID
let currentDownloadReq = null;
let currentDownloadAbort = null;
let scanInterval = null;
let tray = null;
let isQuitting = false;          // 退出标志
let escHideEnabled = true;      // ESC隐藏窗口到托盘
let isDeveloper = false;        // 开发者模式
let globalShortcutEnabled = true; // 全局快捷键
let updateInstallerPath = null;  // 待安装的更新包路径
let currentBg = null; // 存储当前背景信息
let commandPollInterval = null;
let backgroundData = { url: null, type: null, filePath: null };
let splashData = { url: null, filePath: null };
const iconv = require('iconv-lite');
let shouldShowWindow = true;

// 透明背景(实验性)配置
const acrylicConfigPath = path.join(app.getPath('userData'), 'acrylic-config.json');
function loadAcrylicConfig() {
    try {
        if (fs.existsSync(acrylicConfigPath)) {
            return JSON.parse(fs.readFileSync(acrylicConfigPath, 'utf-8')).enabled === true;
        }
    } catch (e) {}
    return false;
}
function saveAcrylicConfig(enabled) {
    fs.writeFileSync(acrylicConfigPath, JSON.stringify({ enabled: !!enabled }));
}
let acrylicEnabled = loadAcrylicConfig();

// 窗口全透明配置
const transparentConfigPath = path.join(app.getPath('userData'), 'transparent-config.json');
function loadTransparentConfig() {
    try {
        if (fs.existsSync(transparentConfigPath)) {
            return JSON.parse(fs.readFileSync(transparentConfigPath, 'utf-8')).enabled === true;
        }
    } catch (e) {}
    return false;
}
function saveTransparentConfig(enabled) {
    fs.writeFileSync(transparentConfigPath, JSON.stringify({ enabled: !!enabled }));
}
let windowTransparent = loadTransparentConfig();

// 窗口透明度配置（默认10%）
const opacityConfigPath = path.join(app.getPath('userData'), 'opacity-config.json');
function loadOpacityConfig() {
    try {
        if (fs.existsSync(opacityConfigPath)) {
            const val = JSON.parse(fs.readFileSync(opacityConfigPath, 'utf-8')).value;
            if (typeof val === 'number') return val;
        }
    } catch (e) {}
    return 1.0;
}
function saveOpacityConfig(value) {
    fs.writeFileSync(opacityConfigPath, JSON.stringify({ value }));
}
let windowOpacity = loadOpacityConfig();
let darkMode = false;

// 穿透点击配置
const clickThroughConfigPath = path.join(app.getPath('userData'), 'clickthrough-config.json');
function loadClickThroughConfig() {
    try {
        if (fs.existsSync(clickThroughConfigPath)) {
            return JSON.parse(fs.readFileSync(clickThroughConfigPath, 'utf-8')).enabled === true;
        }
    } catch (e) {}
    return false;
}
function saveClickThroughConfig(enabled) {
    fs.writeFileSync(clickThroughConfigPath, JSON.stringify({ enabled: !!enabled }));
}
let clickThroughEnabled = loadClickThroughConfig();

const blockedProtocols = ['bytedance:', 'lark:', 'feishu:', 'snssdk:', 'douyin:', 'bitbrowser:'];
function isBlockedProtocol(url) {
    const lower = url.toLowerCase();
    for (const proto of blockedProtocols) {
        if (lower.indexOf(proto) === 0) return proto.replace(':', '');
    }
    return null;
}
function notifyBlockedProtocol(mw, url) {
    const name = isBlockedProtocol(url);
    if (name && mw && !mw.isDestroyed()) {
        mw.webContents.send('blocked-protocol', url, name);
        return true;
    }
    return false;
}


const bgDir = path.join(app.getPath('userData'), 'backgrounds');
if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
const splashDir = path.join(app.getPath('userData'), 'splash');
if (!fs.existsSync(splashDir)) fs.mkdirSync(splashDir, { recursive: true });
const fontDir = path.join(app.getPath('userData'), 'fonts');
if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });

let fontData = { filePath: null, family: null };

function saveFontFileFromData(filePath, filename) {
    const ext = path.extname(filename);
    const safeName = `custom_font_${Date.now()}${ext}`;
    const destPath = path.join(fontDir, safeName);
    if (fontData.filePath && fs.existsSync(fontData.filePath)) {
        try { fs.unlinkSync(fontData.filePath); } catch (e) {}
    }
    try {
        const files = fs.readdirSync(fontDir);
        files.forEach(f => {
            if (f === 'meta.json') return;
            const fp = path.join(fontDir, f);
            if (fp !== destPath) {
                try { fs.unlinkSync(fp); } catch (e) {}
            }
        });
    } catch (e) {}
    fs.copyFileSync(filePath, destPath);
    const family = path.basename(filename, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, ' ');
    const url = 'file:///' + destPath.replace(/\\/g, '/');
    fontData = { filePath: destPath, family, url };
    const metaPath = path.join(fontDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(fontData));
    return { filePath: destPath, family, url };
}

function loadFontMetadata() {
    const metaPath = path.join(fontDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.filePath && fs.existsSync(meta.filePath)) {
            fontData = meta;
            return meta;
        }
    } catch (e) {}
    return null;
}

function saveBackgroundFileFromData(filePath, filename) {
    const ext = path.extname(filename);
    const safeName = `background_${Date.now()}${ext}`;
    const destPath = path.join(bgDir, safeName);
    // 删除旧背景文件
    if (backgroundData.filePath && fs.existsSync(backgroundData.filePath)) {
        try { fs.unlinkSync(backgroundData.filePath); } catch (e) {}
    }
    // 清理所有孤立文件（非 meta.json 且非当前文件）
    try {
        const files = fs.readdirSync(bgDir);
        files.forEach(f => {
            if (f === 'meta.json') return;
            const fp = path.join(bgDir, f);
            if (fp !== destPath && fp !== backgroundData.filePath) {
                try { fs.unlinkSync(fp); } catch (e) {}
            }
        });
    } catch (e) {}
    fs.copyFileSync(filePath, destPath);
    const type = /\.(jpg|jpeg|png|gif|webp)$/i.test(ext) ? 'image' : 'video';
    backgroundData = { url: `file://${destPath}`, type, filePath: destPath };
    const metaPath = path.join(bgDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ url: backgroundData.url, type: backgroundData.type, filePath: backgroundData.filePath }));
    return { url: backgroundData.url, type };
}

function loadBackgroundMetadata() {
    const metaPath = path.join(bgDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.url && meta.filePath && fs.existsSync(meta.filePath)) {
            // 清理孤立文件
            try {
                const files = fs.readdirSync(bgDir);
                files.forEach(f => {
                    if (f === 'meta.json') return;
                    const fp = path.join(bgDir, f);
                    if (fp !== meta.filePath) {
                        try { fs.unlinkSync(fp); } catch (e) {}
                    }
                });
            } catch (e) {}
            return { url: meta.url, type: meta.type };
        }
        // meta.json 指向的文件不存在，清理
        try { fs.unlinkSync(metaPath); } catch (e) {}
    } catch(e) {}
    return null;
}

ipcMain.handle('save-font-file', async (event, fileData, filename) => {
    return saveFontFileFromData(fileData, filename);
});
ipcMain.handle('get-font-info', () => {
    const meta = loadFontMetadata();
    return meta || { filePath: null, family: null };
});
ipcMain.handle('remove-font', () => {
    const fp = fontData.filePath;
    const mp = path.join(fontDir, 'meta.json');
    if (fp && fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
    if (fs.existsSync(mp)) { try { fs.unlinkSync(mp); } catch (e) {} }
    fontData = { filePath: null, family: null };
    return true;
});
ipcMain.handle('save-background-file', async (event, fileData, filename) => {
    return saveBackgroundFileFromData(fileData, filename);
});
ipcMain.handle('get-background-info', () => {
    const meta = loadBackgroundMetadata();
    return meta ? meta : { url: null, type: null };
});

// 启动动画文件独立存储
function saveSplashFileFromData(filePath, filename) {
    const ext = path.extname(filename);
    const safeName = `splash_${Date.now()}${ext}`;
    const destPath = path.join(splashDir, safeName);
    if (splashData.filePath && fs.existsSync(splashData.filePath)) {
        try { fs.unlinkSync(splashData.filePath); } catch (e) {}
    }
    try {
        const files = fs.readdirSync(splashDir);
        files.forEach(f => {
            if (f === 'meta.json') return;
            const fp = path.join(splashDir, f);
            if (fp !== destPath && fp !== splashData.filePath) {
                try { fs.unlinkSync(fp); } catch (e) {}
            }
        });
    } catch (e) {}
    fs.copyFileSync(filePath, destPath);
    splashData = { url: `file://${destPath}`, filePath: destPath };
    const metaPath = path.join(splashDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ url: splashData.url, filePath: splashData.filePath }));
    return { url: splashData.url };
}
ipcMain.handle('save-splash-file', async (event, fileData, filename) => {
    return saveSplashFileFromData(fileData, filename);
});
ipcMain.handle('remove-splash', () => {
    if (splashData.filePath && fs.existsSync(splashData.filePath)) {
        try { fs.unlinkSync(splashData.filePath); } catch (e) {}
    }
    splashData = { url: null, filePath: null };
    const metaPath = path.join(splashDir, 'meta.json');
    try { fs.unlinkSync(metaPath); } catch (e) {}
    return { success: true };
});

ipcMain.handle('remove-background', () => {
    const filePath = backgroundData.filePath;
    const metaPath = path.join(bgDir, 'meta.json');

    let fileDeleted = false;
    // 尝试删除文件（若文件不存在也算成功）
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            fileDeleted = true;
        } catch (err) {
            if (err.code === 'EBUSY') {
                console.warn('文件被占用，稍后重试...');
                // 延迟重试一次（异步，但不阻塞返回）
                setTimeout(() => {
                    try {
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    } catch (e) {
                        console.warn('文件删除失败，已忽略');
                    }
                }, 1000);
            } else {
                throw err;
            }
        }
    }

    // 删除元数据（无论文件是否删除）
    if (fs.existsSync(metaPath)) {
        try { fs.unlinkSync(metaPath); } catch(e) {}
    }

    // 清空内存数据
    backgroundData = { url: null, type: null, filePath: null };

    // 如果文件未删除，在下次启动时清理（通过标记）
    return true;
});
ipcMain.on('get-user-data-path', (event) => {
    event.returnValue = app.getPath('userData');
});

ipcMain.on('set-background-playback-rate', (event, rate) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('set-bg-playback-rate', rate);
    }
});
ipcMain.handle('open-file', async (event, filePath) => {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
});
// 单实例锁（确保只有一个实例运行）
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    // 第二个实例启动时激活主窗口
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // 检查是否通过私有协议 anghaoyu16:// 启动
        const protoUrl = commandLine.find(arg => arg.startsWith('anghaoyu16://'));
        if (protoUrl) {
            console.log('[Main] second-instance protocol URL:', protoUrl);
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                if (!mainWindow.isVisible()) mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('protocol-url', protoUrl);
            }
            return;
        }
        // 检查命令行中是否有 http/https URL（来自设为默认浏览器后的外部调用）
        const externalUrl = commandLine.find(arg => /^https?:\/\//.test(arg));
        if (externalUrl) {
            console.log('[Main] second-instance external URL:', externalUrl);
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                if (!mainWindow.isVisible()) mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('open-new-tab', externalUrl);
            }
            return;
        }
        // 如果第二个实例带有 --hidden 参数，不显示窗口
        if (commandLine.includes('--hidden')) {
            return;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.setAlwaysOnTop(false);
            mainWindow.focus();
            mainWindow.setAlwaysOnTop(true);
        }
    });

    // 当前版本号（硬编码）
    const CURRENT_VERSION = '1.2.9';

    function getLocalVersion() {
        return CURRENT_VERSION;
    }
    function saveLocalVersion(version) {}

    function compareVersion(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const n1 = parts1[i] || 0;
            const n2 = parts2[i] || 0;
            if (n1 !== n2) return n1 - n2;
        }
        return 0;
    }

    async function fetchRemoteVersion(apiBaseUrl) {
        const url = `${apiBaseUrl}/file/app/version.json`;
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error('timeout'));
            });
        });
    }

    async function downloadFile(url, destPath, onProgress) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            const protocol = url.startsWith('https') ? https : http;
            currentDownloadReq = protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`下载失败: ${response.statusCode}`));
                    return;
                }
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize && onProgress) {
                        const percent = (downloadedSize / totalSize) * 100;
                        onProgress(Math.round(percent));
                    }
                });
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(destPath);
                });
            });
            currentDownloadReq.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
            file.on('error', reject);
            currentDownloadReq.setTimeout(30000, () => {
                currentDownloadReq.destroy();
                reject(new Error('下载超时'));
            });
        });
    }

    function runInstaller(installerPath, silent, forceRun) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.removeAllListeners('close');
            mainWindow.destroy();
            mainWindow = null;
        }
        try {
            const { spawn } = require('child_process');
            const args = [];
            if (silent) args.push('/S');
            if (forceRun) args.push('--force-run');
            const child = spawn(installerPath, args, {
                detached: true,
                stdio: 'ignore'
            });
            child.on('error', (err) => {
                console.error('[runInstaller] spawn error:', err.message);
            });
            child.unref();
        } catch (err) {
            console.error('[runInstaller] spawn failed:', err.message);
        }
        setTimeout(() => {
            app.exit(0);
        }, 1000);
    }

    function showProgressWindow() {
        if (progressWindow && !progressWindow.isDestroyed()) {
            progressWindow.close();
        }
        progressWindow = new BrowserWindow({
            width: 400,
            height: 220,
            frame: false,
            transparent: false,
            alwaysOnTop: false,
            roundedCorners: true,
            minimizable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        progressWindow.setBackgroundColor('#ffffff');
        const htmlContent = `<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><style>
            *{margin:0;padding:0;box-sizing:border-box}
            body{background:white;font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden;border-radius:12px}
            .container{text-align:center;width:85%;background:white;border-radius:12px;padding:20px}
            h3{color:#333;margin-bottom:10px}
            .progress-bar{width:100%;background-color:#e0e0e0;border-radius:20px;overflow:hidden;margin:20px 0}
            .progress-fill{width:0%;height:20px;background-color:#2a5298;border-radius:20px;transition:width 0.2s}
            #percent{font-size:14px;color:#333;margin-top:8px}
            .button-group{display:flex;justify-content:center;gap:15px;margin-top:20px}
            button{padding:6px 16px;border:none;border-radius:20px;cursor:pointer;font-size:13px}
            #cancel{background:#dc2626;color:white}
            #background{background:#4b5563;color:white}
        </style></head>
        <body>
            <div class="container"><h3>正在下载更新</h3><div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div><div id="percent">0%</div><div class="button-group"><button id="cancel">取消下载</button><button id="background">后台下载</button></div></div>
            <script>
                const { ipcRenderer } = require('electron');
                document.getElementById('cancel').onclick = () => ipcRenderer.send('cancel-download');
                document.getElementById('background').onclick = () => ipcRenderer.send('background-download');
                ipcRenderer.on('update-progress', (e, percent) => {
                    document.getElementById('progress-fill').style.width = percent + '%';
                    document.getElementById('percent').innerText = percent + '%';
                });
            <\/script>
        </body>
        </html>`;
        progressWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
        progressWindow.show();
        return progressWindow;
    }

    // 获取所有有可见窗口的进程（正在运行的应用程序）
    function getRunningApps() {
        return new Promise((resolve) => {
            exec('powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -ExpandProperty Name"', { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    console.error('扫描进程失败:', error);
                    resolve([]);
                    return;
                }
                const lines = stdout.trim().split('\n');
                const blacklist = [
                    'explorer', 'ApplicationFrameHost', 'SearchApp', 'SystemSettings',
                    'ShellExperienceHost', 'StartMenuExperienceHost', 'TextInputHost',
                    'sihost', 'taskhostw', 'RuntimeBroker', 'svchost', 'dwm', 'csrss',
                    'wininit', 'services', 'lsass', 'winlogon', 'spoolsv', 'WmiPrvSE',
                    'conhost', 'cmd', 'powershell'
                ];
                const apps = [];
                for (let name of lines) {
                    name = name.trim();
                    if (name && !blacklist.includes(name.toLowerCase())) {
                        if (!apps.includes(name)) apps.push(name);
                    }
                }
                resolve(apps);
            });
        });
    }

    function startProcessScanning() {
        if (scanInterval) clearInterval(scanInterval);
        scanInterval = setInterval(async () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                const apps = await getRunningApps();
                if (apps.length > 0) {
                    mainWindow.webContents.send('game-detected', apps);
                }
            }
        }, 10000);
    }

    // 检查更新（silent 参数控制是否弹出“已是最新版”）
    async function checkForUpdates(apiBaseUrl, silent = false) {
        if (!apiBaseUrl) {
            console.log('未提供 API 地址，无法检查更新');
            if (!silent) dialog.showErrorBox('检查更新失败', '未配置后端地址');
            return;
        }
        try {
            const remoteInfo = await fetchRemoteVersion(apiBaseUrl);
            const localVer = getLocalVersion();
            if (compareVersion(remoteInfo.version, localVer) > 0) {
                const result = await dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    buttons: ['立即更新', '稍后'],
                    title: '发现新版本',
                    message: `检测到新版本，是否下载并安装？\n\n当前版本: v${localVer}\n最新版本: v${remoteInfo.version}\n\n${remoteInfo.release_notes || ''}`,
                    defaultId: 0,
                    cancelId: 1
                });
                if (result.response === 0) {
                    const downloadUrl = remoteInfo.download_url;
                    const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${apiBaseUrl}${downloadUrl}`;
                    const tempDir = app.getPath('temp');
                    const installerPath = path.join(tempDir, `update-${remoteInfo.version}.exe`);

                    let cancelled = false;
                    let backgroundMode = false;
                    const progressWin = showProgressWindow();

                    const cancelHandler = () => {
                        cancelled = true;
                        if (currentDownloadReq) currentDownloadReq.destroy();
                        if (progressWin && !progressWin.isDestroyed()) progressWin.close();
                    };
                    const backgroundHandler = () => {
                        backgroundMode = true;
                        if (progressWin && !progressWin.isDestroyed()) progressWin.minimize();
                    };
                    ipcMain.once('cancel-download', cancelHandler);
                    ipcMain.once('background-download', backgroundHandler);

                    try {
                        await downloadFile(fullUrl, installerPath, (percent) => {
                            if (progressWin && !progressWin.isDestroyed()) {
                                progressWin.webContents.send('update-progress', percent);
                            }
                        });
                        if (cancelled) return;
                        if (backgroundMode && progressWin && !progressWin.isDestroyed()) {
                            progressWin.show();
                            const installResult = await dialog.showMessageBox(progressWin, {
                                type: 'info',
                                message: '下载完成，是否立即安装？',
                                buttons: ['安装', '稍后']
                            });
                            if (installResult.response === 0) {
                                saveLocalVersion(remoteInfo.version);
                                runInstaller(installerPath, false);
                            } else {
                                progressWin.close();
                            }
                        } else {
                            if (progressWin && !progressWin.isDestroyed()) progressWin.close();
                            saveLocalVersion(remoteInfo.version);
                            runInstaller(installerPath, true);
                        }
                    } catch (err) {
                        if (progressWin && !progressWin.isDestroyed()) progressWin.close();
                        dialog.showErrorBox('下载失败', err.message);
                    } finally {
                        ipcMain.removeListener('cancel-download', cancelHandler);
                        ipcMain.removeListener('background-download', backgroundHandler);
                    }
                }
            } else {
                if (!silent) {
                    dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        message: `当前已是最新版本 v${localVer}`,
                        buttons: ['确定']
                    });
                } else {
                    console.log('当前已是最新版本（静默）');
                }
            }
        } catch (err) {
            console.error('检查更新失败', err);
            if (!silent) {
                dialog.showErrorBox('检查更新失败', err.message);
            }
        }
    }

    // 普通文件下载（素材库）
    ipcMain.handle('download-file', async (event, { url, fileName, token }) => {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: '保存文件',
            defaultPath: path.join(app.getPath('desktop'), fileName || 'download'),
            buttonLabel: '保存'
        });
        if (canceled || !filePath) return { canceled: true };

        let finalPath = filePath;
        let counter = 1;
        while (fs.existsSync(finalPath)) {
            const ext = path.extname(filePath);
            const base = filePath.slice(0, -ext.length);
            finalPath = `${base} (${counter})${ext}`;
            counter++;
        }

        try {
            const abortController = new AbortController();
            currentDownloadAbort = abortController;
            const headers = {};
            if (token) headers['Authorization'] = 'Bearer ' + token;
            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
            const response = await fetch(url, { headers, signal: abortController.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const total = parseInt(response.headers.get('content-length'), 10);
            let received = 0;
            const fileStream = fs.createWriteStream(finalPath);
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.length;
                fileStream.write(value);
                if (total) {
                    const percent = Math.round((received / total) * 100);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('file-download-progress', percent, fileName);
                    }
                }
            }
            fileStream.end();
            await new Promise((resolve) => fileStream.on('finish', resolve));
            mainWindow.webContents.send('download-complete', finalPath);
            return { success: true, filePath: finalPath };
        } catch (err) {
            currentDownloadAbort = null;
            if (err.name === 'AbortError') {
                mainWindow.webContents.send('download-canceled', fileName);
                return { canceled: true };
            }
            mainWindow.webContents.send('download-error', err.message);
            return { error: err.message };
        }
    });

    ipcMain.on('cancel-download', () => {
        if (currentDownloadReq) {
            currentDownloadReq.destroy();
            currentDownloadReq = null;
        }
        if (currentDownloadAbort) {
            currentDownloadAbort.abort();
            currentDownloadAbort = null;
        }
    });

    function createTray() {
        if (tray) return;
        let trayIcon = null;
        const iconPath = path.join(__dirname, 'icon.ico');
        if (fs.existsSync(iconPath)) {
            trayIcon = iconPath;
        } else {
            const size = 32;
            const canvas = Buffer.alloc(size * size * 4);
            const cx = size / 2, cy = size / 2, r = size / 2 - 2;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const dx = x - cx, dy = y - cy;
                    if (dx * dx + dy * dy <= r * r) {
                        canvas[i] = 152; canvas[i + 1] = 82; canvas[i + 2] = 42; canvas[i + 3] = 255;
                    } else {
                        canvas[i + 3] = 0;
                    }
                }
            }
            trayIcon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
        }
        tray = new Tray(trayIcon);
        tray.setToolTip('作业上传系统');
        updateTrayMenu();
        tray.on('click', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isVisible()) mainWindow.hide();
                else mainWindow.show();
            }
        });
    }

    function updateTrayMenu() {
        if (!tray) return;
        const items = [
            { label: '显示主窗口', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); } }
        ];
        if (isDeveloper) {
            if (clickThroughEnabled) {
                items.push({ label: '关闭穿透点击窗口', click: () => { clickThroughEnabled = false; saveClickThroughConfig(false); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setIgnoreMouseEvents(false); if (devPanelWindow && !devPanelWindow.isDestroyed()) devPanelWindow.webContents.send('clickthrough-state-changed', false); updateTrayMenu(); } });
            } else {
                items.push({ label: '启用穿透点击窗口', click: () => { clickThroughEnabled = true; saveClickThroughConfig(true); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setIgnoreMouseEvents(true, { forward: true }); if (devPanelWindow && !devPanelWindow.isDestroyed()) devPanelWindow.webContents.send('clickthrough-state-changed', true); updateTrayMenu(); } });
            }
            const devOpen = !!(devPanelWindow && !devPanelWindow.isDestroyed());
            if (devOpen) {
                items.push({ label: '关闭开发者控制面板', click: () => { toggleDevPanel(); } });
            } else {
                items.push({ label: '打开开发者控制面板', click: () => { createDevPanel(); updateTrayMenu(); } });
            }
        }
        items.push({ type: 'separator' });
        items.push({ label: '退出', click: () => { isQuitting = true; app.quit(); } });
        tray.setContextMenu(Menu.buildFromTemplate(items));
    }

    let devPanelWindow = null;
    let devPanelPollInterval = null;

    function startDevPanelPolling() {
        if (devPanelPollInterval) return;
        devPanelPollInterval = setInterval(() => {
            if (!devPanelWindow || devPanelWindow.isDestroyed()) {
                clearInterval(devPanelPollInterval);
                devPanelPollInterval = null;
                return;
            }
            const point = screen.getCursorScreenPoint();
            const bounds = devPanelWindow.getBounds();
            const relX = point.x - bounds.x;
            const relY = point.y - bounds.y;
            const inWindow = relX >= 0 && relX < bounds.width && relY >= 0 && relY < bounds.height;
            if (!inWindow) {
                devPanelWindow.setIgnoreMouseEvents(true, { forward: true });
                return;
            }
            const inInteractive = relY < 32 || (relY >= 40 && relY <= 220);
            devPanelWindow.setIgnoreMouseEvents(!inInteractive, inInteractive ? undefined : { forward: true });
        }, 50);
    }

    function createDevPanel() {
        if (devPanelWindow && !devPanelWindow.isDestroyed()) {
            devPanelWindow.show();
            devPanelWindow.focus();
            return;
        }
        devPanelWindow = new BrowserWindow({
            width: 280, height: 340,
            frame: false,
            resizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            transparent: true,
            roundedCorners: false,
            backgroundMaterial: 'none',
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false
            },
            icon: path.join(__dirname, 'icon.ico')
        });
        devPanelWindow.loadFile('dev-panel.html');
        devPanelWindow.setIgnoreMouseEvents(true, { forward: true });
        startDevPanelPolling();
        devPanelWindow.on('closed', () => {
            if (devPanelPollInterval) { clearInterval(devPanelPollInterval); devPanelPollInterval = null; }
            devPanelWindow = null;
            updateTrayMenu();
        });
    }

    function toggleDevPanel() {
        if (devPanelWindow && !devPanelWindow.isDestroyed()) {
            devPanelWindow.close();
            devPanelWindow = null;
        } else {
            createDevPanel();
        }
        updateTrayMenu();
    }

    function createWindow() {
        const shouldShow = !process.argv.includes('--hidden');
        if (mainWindow && !mainWindow.isDestroyed()) return;
        mainWindow = new BrowserWindow({
            frame: false, 
            width: 1200,
            height: 700,
            minWidth: 900,
            minHeight: 620,
            show: shouldShow,
            transparent: windowTransparent,
            roundedCorners: !windowTransparent,
            backgroundMaterial: windowTransparent ? 'none' : (acrylicEnabled ? 'acrylic' : 'none'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: false,
                webviewTag: true
            },
            icon: path.join(__dirname, 'icon.ico')
        });
        mainWindow.loadFile('index.html');
        mainWindow.setOpacity(windowOpacity);
        if (clickThroughEnabled) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        }
        mainWindow.webContents.setWindowOpenHandler(({ url, disposition }) => {
            console.log('[Main] setWindowOpenHandler caught:', url, 'disposition:', disposition);
            if (url && url !== 'about:blank' && url !== 'about:blank#blocked') {
                if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
                    mainWindow.webContents.send('open-new-tab', url);
                } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
                    if (!notifyBlockedProtocol(mainWindow, url)) {
                        console.log('[Main] external protocol, shell.openExternal:', url);
                        shell.openExternal(url);
                    }
                }
            }
            return { action: 'deny' };
        });
        // mainWindow.webContents.openDevTools();
        mainWindow.on('maximize', () => {
            mainWindow.webContents.send('window-state-changed', true);
        });
        mainWindow.on('unmaximize', () => {
            mainWindow.webContents.send('window-state-changed', false);
        });
        mainWindow.webContents.on('before-input-event', (e, input) => {
            if (input.key === 'Escape' && !input.control && !input.alt && !input.meta && escHideEnabled) {
                mainWindow.hide();
            }
            if (input.control && input.shift && input.key === 'I') {
                if (!isDeveloper) {
                    e.preventDefault();
                    return;
                }
                mainWindow.webContents.toggleDevTools();
            }
            if (input.control && input.shift && input.key === 'J') {
                if (!isDeveloper) {
                    e.preventDefault();
                    return;
                }
                mainWindow.webContents.toggleDevTools();
            }
            if (input.key === 'F12') {
                if (!isDeveloper) {
                    e.preventDefault();
                    return;
                }
                mainWindow.webContents.toggleDevTools();
            }
        });
        mainWindow.on('close', (event) => {
            if (!isQuitting) {
                console.log('[close] updateInstallerPath:', updateInstallerPath, 'exists:', updateInstallerPath && fs.existsSync(updateInstallerPath));
                if (updateInstallerPath && fs.existsSync(updateInstallerPath)) {
                    runInstaller(updateInstallerPath, true);
                    return;
                }
                event.preventDefault();
                mainWindow.hide();
            }
        });
        mainWindow.on('minimize', () => {
            mainWindow.webContents.send('window-hiding');
        });
        mainWindow.on('hide', () => {
            mainWindow.webContents.send('window-hiding');
        });
        mainWindow.on('closed', () => {
            mainWindow = null;
        });
        mainWindow.webContents.on('context-menu', (e, props) => {
            const menuTemplate = [];
            if (props.canGoBack) {
                menuTemplate.push({ label: '后退', click: () => { mainWindow.webContents.goBack(); } });
            }
            if (props.canGoForward) {
                menuTemplate.push({ label: '前进', click: () => { mainWindow.webContents.goForward(); } });
            }
            menuTemplate.push({ label: '重新加载', click: () => { mainWindow.webContents.reload(); } });
            menuTemplate.push({
                label: mainWindow.isFullScreen() ? '退出全屏' : '全屏',
                click: () => {
                    mainWindow.setFullScreen(!mainWindow.isFullScreen());
                }
            });
            if (menuTemplate.length) {
                const menu = Menu.buildFromTemplate(menuTemplate);
                menu.popup({ window: mainWindow });
            }
        });
        mainWindow.webContents.on('did-finish-load', () => {
            const bgInfo = loadBackgroundMetadata();
            if (bgInfo && bgInfo.url) {
                mainWindow.webContents.send('load-saved-background', bgInfo);
            }
        });
    }

ipcMain.handle('window-is-maximized', () => {
    return mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized();
});

ipcMain.handle('open-external', (event, url) => {
    console.log('[Main] open-external:', url);
    if (!notifyBlockedProtocol(mainWindow, url)) {
        return shell.openExternal(url);
    }
    return false;
});

ipcMain.handle('get-acrylic-enabled', () => {
    return acrylicEnabled;
});

// ======== 默认浏览器 & 私有协议 ========
ipcMain.handle('set-as-default-browser', async () => {
    const exePath = process.execPath;
    const exeName = path.basename(exePath, '.exe');
    const appName = '作业上传系统';
    const progId = 'UploadSystemHTML';
    const capPath = 'Software\\Clients\\StartMenuInternet\\' + appName + '\\Capabilities';
    const errors = [];

    const runReg = (cmd) => new Promise((resolve) => {
        console.log('[Main] REG:', cmd);
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.error('[Main] REG FAIL:', cmd, err.message);
                errors.push(cmd + ' -> ' + err.message);
            } else {
                console.log('[Main] REG OK:', cmd);
            }
            resolve();
        });
    });

    try {
        // 1. Electron 内置协议注册 (写入 HKCU\Software\Classes\http 等)
        app.setAsDefaultProtocolClient('http');
        app.setAsDefaultProtocolClient('https');
        console.log('[Main] Electron setAsDefaultProtocolClient done');

        // 2. Windows 标准浏览器注册结构
        const regCmds = [
            // RegisteredApplications
            `reg add "HKCU\\Software\\RegisteredApplications" /v "${appName}" /d "${capPath}" /f`,
            // Capabilities
            `reg add "HKCU\\${capPath}" /v "ApplicationName" /d "${appName}" /f`,
            `reg add "HKCU\\${capPath}" /v "ApplicationIcon" /d "${exePath}" /f`,
            // URLAssociations
            `reg add "HKCU\\${capPath}\\URLAssociations" /v "http" /d "${progId}" /f`,
            `reg add "HKCU\\${capPath}\\URLAssociations" /v "https" /d "${progId}" /f`,
            // ProgID shell command
            `reg add "HKCU\\Software\\Classes\\${progId}\\shell\\open\\command" /ve /d "\"${exePath}\" \"%1\"" /f`,
            // 旧结构也保留一份兼容
            `reg add "HKCU\\Software\\Classes\\Applications\\${exeName}.exe\\shell\\open\\command" /ve /d "\"${exePath}\" \"%1\"" /f`,
            `reg add "HKCU\\Software\\Classes\\Applications\\${exeName}.exe" /v "ApplicationName" /d "${appName}" /f`
        ];

        for (const cmd of regCmds) {
            await runReg(cmd);
        }

        console.log('[Main] Registry registration complete, errors:', errors.length);
        return { success: errors.length === 0, errors };
    } catch (e) {
        console.error('[Main] Failed:', e);
        errors.push(e.message);
        return { success: false, errors };
    }
});

ipcMain.handle('is-default-browser', () => {
    const isHttp = app.isDefaultProtocolClient('http');
    const isHttps = app.isDefaultProtocolClient('https');
    const isCustom = app.isDefaultProtocolClient('anghaoyu16');
    return { http: isHttp, https: isHttps, anghaoyu16: isCustom };
});

ipcMain.handle('get-pending-external-url', () => {
    const url = process.argv.find(arg => /^https?:\/\//.test(arg));
    return url || null;
});

ipcMain.handle('register-custom-protocol', async () => {
    try {
        app.setAsDefaultProtocolClient('anghaoyu16');
        console.log('[Main] Registered custom protocol: anghaoyu16://');
        return { success: true };
    } catch (e) {
        console.error('[Main] Failed to register protocol:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('set-acrylic-enabled', async (event, enabled) => {
    acrylicEnabled = !!enabled;
    saveAcrylicConfig(acrylicEnabled);
    // 重建窗口以应用新设置
    if (mainWindow && !mainWindow.isDestroyed()) {
        const bounds = mainWindow.getBounds();
        const wasMaximized = mainWindow.isMaximized();
        mainWindow.removeAllListeners('close');
        mainWindow.removeAllListeners('closed');
        mainWindow.close();
        mainWindow = null;
        createWindow();
        if (mainWindow) {
            if (wasMaximized) mainWindow.maximize();
            else mainWindow.setBounds(bounds);
        }
    }
    return acrylicEnabled;
});

ipcMain.handle('get-window-transparent', () => {
    return windowTransparent;
});

ipcMain.handle('set-window-transparent', async (event, enabled) => {
    windowTransparent = !!enabled;
    saveTransparentConfig(windowTransparent);
    if (mainWindow && !mainWindow.isDestroyed()) {
        const bounds = mainWindow.getBounds();
        const wasMaximized = mainWindow.isMaximized();
        mainWindow.removeAllListeners('close');
        mainWindow.removeAllListeners('closed');
        mainWindow.close();
        mainWindow = null;
        createWindow();
        if (mainWindow) {
            if (wasMaximized) mainWindow.maximize();
            else mainWindow.setBounds(bounds);
        }
    }
    return windowTransparent;
});

ipcMain.handle('get-window-opacity', () => {
    return windowOpacity;
});

ipcMain.handle('set-window-opacity', async (event, value) => {
    windowOpacity = value;
    saveOpacityConfig(windowOpacity);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(value);
        mainWindow.webContents.send('window-opacity-changed', value);
    }
    if (devPanelWindow && !devPanelWindow.isDestroyed()) {
        devPanelWindow.webContents.send('window-opacity-changed', value);
    }
    return windowOpacity;
});

ipcMain.handle('get-window-clickthrough', () => {
    return clickThroughEnabled;
});

ipcMain.on('set-dark-mode', (event, value) => {
    darkMode = value;
    const senderWC = event.sender;
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents !== senderWC) {
        mainWindow.webContents.send('dark-mode-changed', value);
    }
    if (devPanelWindow && !devPanelWindow.isDestroyed() && devPanelWindow.webContents !== senderWC) {
        devPanelWindow.webContents.send('dark-mode-changed', value);
    }
});
ipcMain.handle('get-dark-mode', () => darkMode);

ipcMain.handle('set-window-clickthrough', async (event, enabled) => {
    clickThroughEnabled = !!enabled;
    saveClickThroughConfig(clickThroughEnabled);
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (clickThroughEnabled) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
            mainWindow.setIgnoreMouseEvents(false);
        }
    }
    if (devPanelWindow && !devPanelWindow.isDestroyed()) {
        devPanelWindow.webContents.send('clickthrough-state-changed', clickThroughEnabled);
    }
    updateTrayMenu();
    return clickThroughEnabled;
});

ipcMain.handle('set-min-size', async (event, minW, minH) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setMinimumSize(minW, minH);
    }
});

ipcMain.handle('set-ignore-mouse-events', (event, ignore) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
    }
});

if (process.argv.includes('--hidden')) {
    shouldShowWindow = false;
}
    function getUpdateHost() {
        if (process.env.UPDATE_HOST) return process.env.UPDATE_HOST;
        try {
            const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
            if (cfg.updateHost) return cfg.updateHost;
        } catch(e) {}
        return '请在此处输入更新服务器IP';
    }
    function checkForLocalUpdate() {
        return new Promise((resolve) => {
            const currentVer = app.getVersion();
            const updateHost = getUpdateHost();
            const req = http.get(`http://${updateHost}:80/version.json`, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const info = JSON.parse(body);
                        const dlUrl = info.download_url || '';
                        const fullDlUrl = dlUrl.startsWith('http') ? dlUrl : `http://${updateHost}` + (dlUrl.startsWith('/') ? '' : '/') + dlUrl;
                        resolve({
                            checked: true,
                            available: info.version && info.version !== currentVer,
                            version: info.version,
                            current: currentVer,
                            download_url: fullDlUrl
                        });
                    } catch (e) { resolve({ checked: false, available: false, current: currentVer }); }
                });
            });
            req.on('error', () => resolve({ checked: false, available: false, current: currentVer }));
            req.setTimeout(2000, () => { req.destroy(); resolve({ checked: false, available: false, current: currentVer }); });
        });
    }

    app.on('web-contents-created', (event, contents) => {
        if (contents.getType() === 'webview') {
            contents.on('will-navigate', (e, url) => {
                if (!/^https?:\/\//.test(url) && url !== 'about:blank' && url !== 'about:blank#blocked') {
                    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
                        console.log('[Main] webview external protocol, opening with shell:', url);
                        e.preventDefault();
                        if (!notifyBlockedProtocol(mainWindow, url)) {
                            shell.openExternal(url);
                        }
                    } else {
                        console.log('[Main] blocked non-http navigation:', url);
                        e.preventDefault();
                    }
                }
            });
            contents.on('destroyed', () => { xxtWebContentsIds.delete(contents.id); });
            contents.setWindowOpenHandler(({ url }) => {
                console.log('[Main] webview windowOpenHandler:', url, 'wcId:', contents.id, 'isXxt:', xxtWebContentsIds.has(contents.id));
                if (url && url !== 'about:blank' && url !== 'about:blank#blocked') {
                    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
                        if (xxtWebContentsIds.has(contents.id)) {
                            console.log('[Main] xxt webview window.open, sending xxt-open-new-tab');
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('xxt-open-new-tab', url);
                            }
                            return { action: 'deny' };
                        }
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('open-new-tab', url);
                        }
                    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
                        console.log('[Main] webview external protocol window.open, shell.openExternal:', url);
                        if (!notifyBlockedProtocol(mainWindow, url)) {
                            shell.openExternal(url);
                        }
                    }
                }
                return { action: 'deny' };
            });
        } else {
            console.log('[Main] web-contents-created non-webview:', contents.getType());
            if (contents.getType() === 'window') {
                contents.on('will-navigate', (e, url) => {
                    console.log('[Main] popup will-navigate:', url);
                    if (!url || url === 'about:blank' || url === 'about:blank#blocked') return;
                    if (/^https?:\/\//.test(url)) return;
                    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
                        e.preventDefault();
                        if (!notifyBlockedProtocol(mainWindow, url)) {
                            shell.openExternal(url);
                        }
                    } else {
                        e.preventDefault();
                    }
                    const win = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.fromWebContents(contents);
                    if (win && !win.isDestroyed()) win.close();
                });
                contents.setWindowOpenHandler(({ url }) => {
                    console.log('[Main] popup setWindowOpenHandler:', url);
                    if (url && !/^https?:\/\//.test(url) && /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
                        notifyBlockedProtocol(mainWindow, url);
                    }
                    return { action: 'deny' };
                });
            }
        }
    });

    protocol.registerSchemesAsPrivileged([
        { scheme: 'jsbridge', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
        { scheme: 'cxstudy', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
        { scheme: 'bitbrowser', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
        { scheme: 'bytedance', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
    ]);

    app.whenReady().then(() => {
        const emptyResponse = () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
        protocol.handle('jsbridge', emptyResponse);
        protocol.handle('cxstudy', emptyResponse);
        protocol.handle('bitbrowser', emptyResponse);
        protocol.handle('bytedance', emptyResponse);
        xxtSession = session.fromPartition('persist:xxt');
        xxtSession.protocol.handle('jsbridge', emptyResponse);
        xxtSession.protocol.handle('cxstudy', emptyResponse);
        xxtSession.protocol.handle('bitbrowser', emptyResponse);
        xxtSession.protocol.handle('bytedance', emptyResponse);
        const browserSession = session.fromPartition('persist:browser');
        browserSession.protocol.handle('jsbridge', emptyResponse);
        browserSession.protocol.handle('cxstudy', emptyResponse);
        browserSession.protocol.handle('bitbrowser', emptyResponse);
        browserSession.protocol.handle('bytedance', emptyResponse);
        createWindow();
        createTray();
        Menu.setApplicationMenu(null);

        // 注册私有协议 anghaoyu16:// (HKCU, 无需管理员)
        if (!isDeveloper || process.argv.includes('--register-protocol')) {
            app.setAsDefaultProtocolClient('anghaoyu16');
            console.log('[Main] Registered protocol: anghaoyu16://');
        }

        // 处理 Windows 首次启动时自带的协议 URL
        if (process.argv.length > 1) {
            const protoUrl = process.argv.find(arg => arg.startsWith('anghaoyu16://'));
            if (protoUrl && mainWindow) {
                mainWindow.webContents.once('did-finish-load', () => {
                    mainWindow.webContents.send('protocol-url', protoUrl);
                });
            }
            const externalUrl = process.argv.find(arg => /^https?:\/\//.test(arg));
            if (externalUrl && mainWindow) {
                mainWindow.webContents.once('did-finish-load', () => {
                    mainWindow.webContents.send('open-new-tab', externalUrl);
                });
            }
        }

        const { globalShortcut } = require('electron');
        let globalShortcutKey = 'CommandOrControl+Alt+Shift+Z';
        let globalShortcutEnabled = true;
        let devPanelShortcutKey = 'CommandOrControl+Alt+Shift+I';
        let devPanelShortcutEnabled = true;
        let opacityShortcutEnabled = true;
        let darkModeShortcutEnabled = true;
        let extShortcutKey = 'CommandOrControl+Alt+Shift+X';
        let extShortcutEnabled = true;
        let alwaysOnTopShortcutKey = 'CommandOrControl+Alt+Shift+T';
        let alwaysOnTopShortcutEnabled = true;
        let browserHideShortcutKey = 'F10';
        let browserHideShortcutEnabled = true;
        let fullscreenShortcutEnabled = true;

        function toAccelerator(display) {
            return display.replace(/Ctrl/g, 'CommandOrControl').replace(/Meta/g, 'CommandOrControl');
        }
        function registerAllShortcuts() {
            globalShortcut.unregisterAll();
            if (globalShortcutEnabled) {
                globalShortcut.register(globalShortcutKey, () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        if (mainWindow.isVisible()) {
                            mainWindow.hide();
                        } else {
                            mainWindow.show();
                            mainWindow.focus();
                        }
                    }
                });
            }
            if (devPanelShortcutEnabled) {
                globalShortcut.register(devPanelShortcutKey, () => {
                    toggleDevPanel();
                });
            }
            if (opacityShortcutEnabled && isDeveloper) {
                globalShortcut.register('CommandOrControl+Alt+Shift+=', () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        const v = Math.min(1, windowOpacity + 0.01);
                        mainWindow.setOpacity(v);
                        windowOpacity = v;
                        saveOpacityConfig(v);
                        mainWindow.webContents.send('window-opacity-changed', v);
                        if (devPanelWindow && !devPanelWindow.isDestroyed()) {
                            devPanelWindow.webContents.send('window-opacity-changed', v);
                        }
                    }
                });
                globalShortcut.register('CommandOrControl+Alt+Shift+-', () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        const v = Math.max(0.01, windowOpacity - 0.01);
                        mainWindow.setOpacity(v);
                        windowOpacity = v;
                        saveOpacityConfig(v);
                        mainWindow.webContents.send('window-opacity-changed', v);
                        if (devPanelWindow && !devPanelWindow.isDestroyed()) {
                            devPanelWindow.webContents.send('window-opacity-changed', v);
                        }
                    }
                });
            }
            if (darkModeShortcutEnabled) {
                globalShortcut.register('CommandOrControl+Shift+Alt+M', () => {
                    darkMode = !darkMode;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('dark-mode-changed', darkMode);
                    }
                    if (devPanelWindow && !devPanelWindow.isDestroyed()) {
                        devPanelWindow.webContents.send('dark-mode-changed', darkMode);
                    }
                });
            }
            if (extShortcutEnabled) {
                globalShortcut.register(extShortcutKey, () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('ext-shortcut-triggered');
                    }
                });
            }
            if (alwaysOnTopShortcutEnabled) {
                globalShortcut.register(alwaysOnTopShortcutKey, () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        isPinned = !isPinned;
                        mainWindow.setAlwaysOnTop(isPinned);
                        mainWindow.webContents.send('pin-state-changed', isPinned);
                    }
                });
            }
            if (browserHideShortcutEnabled) {
                globalShortcut.register(browserHideShortcutKey, () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('browser-hide-shortcut-triggered');
                    }
                });
            }
            if (fullscreenShortcutEnabled) {
                globalShortcut.register('F11', () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    }
                });
            }
        }
        function unregisterAllShortcuts() {
            globalShortcut.unregisterAll();
        }
        registerAllShortcuts();

        ipcMain.on('set-esc-hide-enabled', (event, enable) => {
            escHideEnabled = enable;
        });
        ipcMain.on('set-global-shortcut-enabled', (event, enable) => {
            globalShortcutEnabled = enable;
            registerAllShortcuts();
        });
        ipcMain.on('set-global-shortcut-key', (event, shortcut) => {
            globalShortcutKey = toAccelerator(shortcut);
            registerAllShortcuts();
        });
        ipcMain.on('set-dev-panel-shortcut-enabled', (event, enable) => {
            devPanelShortcutEnabled = enable;
            registerAllShortcuts();
        });
        ipcMain.on('set-dev-panel-shortcut-key', (event, shortcut) => {
            devPanelShortcutKey = toAccelerator(shortcut);
            registerAllShortcuts();
        });
        ipcMain.on('set-ext-shortcut-enabled', (event, enable) => {
            extShortcutEnabled = enable;
            registerAllShortcuts();
        });
        ipcMain.on('set-ext-shortcut-key', (event, shortcut) => {
            extShortcutKey = toAccelerator(shortcut);
            registerAllShortcuts();
        });
        ipcMain.on('set-always-on-top-shortcut-enabled', (event, enable) => {
            alwaysOnTopShortcutEnabled = enable;
            registerAllShortcuts();
        });
        ipcMain.on('set-always-on-top-shortcut-key', (event, shortcut) => {
            alwaysOnTopShortcutKey = toAccelerator(shortcut);
            registerAllShortcuts();
        });
        ipcMain.on('set-browser-hide-shortcut-enabled', (event, enable) => {
            browserHideShortcutEnabled = enable;
            registerAllShortcuts();
        });
        ipcMain.on('set-browser-hide-shortcut-key', (event, shortcut) => {
            browserHideShortcutKey = shortcut;
            registerAllShortcuts();
        });
        ipcMain.on('set-custom-ua', (event, ua) => {
            const uaStr = ua || '';
            session.defaultSession.setUserAgent(uaStr);
            session.fromPartition('persist:browser').setUserAgent(uaStr);
        });
        ipcMain.on('set-opacity-shortcut-enabled', (event, enable) => {
            opacityShortcutEnabled = enable;
            registerAllShortcuts();
        });
        ipcMain.handle('get-opacity-shortcut-enabled', () => {
            return opacityShortcutEnabled;
        });
        ipcMain.on('open-main-devtools', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        });

        ipcMain.on('set-zoom-factor', (event, factor) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.setZoomFactor(factor);
            }
        });
        ipcMain.on('set-developer', (event, dev) => {
            isDeveloper = dev;
            updateTrayMenu();
            registerAllShortcuts();
        });
        ipcMain.handle('get-zoom-factor', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                return mainWindow.webContents.getZoomFactor();
            }
            return 1.0;
        });

        let isPinned = false;
        ipcMain.on('set-always-on-top', (event, flag) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                isPinned = flag;
                mainWindow.setAlwaysOnTop(flag);
            }
        });
        ipcMain.handle('is-dev-panel-always-on-top', () => {
            return devPanelWindow && !devPanelWindow.isDestroyed() ? devPanelWindow.isAlwaysOnTop() : false;
        });
        ipcMain.on('dev-panel-always-on-top', (event, flag) => {
            if (devPanelWindow && !devPanelWindow.isDestroyed()) {
                if (typeof flag !== 'boolean') flag = !devPanelWindow.isAlwaysOnTop();
                devPanelWindow.setAlwaysOnTop(flag);
            }
        });
        ipcMain.on('main-window-click-through', (event, flag) => {
            clickThroughEnabled = !!flag;
            saveClickThroughConfig(clickThroughEnabled);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setIgnoreMouseEvents(flag, flag ? { forward: true } : undefined);
            }
            if (devPanelWindow && !devPanelWindow.isDestroyed()) {
                devPanelWindow.webContents.send('clickthrough-state-changed', flag);
            }
            updateTrayMenu();
        });
        ipcMain.on('toggle-main-window', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                }
            }
        });
        ipcMain.on('refocus-main-window', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
                isPinned = true;
                mainWindow.setAlwaysOnTop(true);
                mainWindow.webContents.send('pin-state-changed', true);
            }
        });
        mainWindow.on('focus', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(isPinned);
            }
        });

        // 开机自启：读取配置文件，首次启动无配置则清除注册表
        const autoStartConfigPath = path.join(app.getPath('userData'), 'auto-start.json');
        let autoStartEnabled = false;
        if (fs.existsSync(autoStartConfigPath)) {
            try {
                autoStartEnabled = JSON.parse(fs.readFileSync(autoStartConfigPath, 'utf-8')).enabled === true;
            } catch (e) { autoStartEnabled = false; }
        }
        app.setLoginItemSettings({
            openAtLogin: autoStartEnabled,
            openAsHidden: true,
            args: ['--hidden']
        });
        if (!fs.existsSync(autoStartConfigPath)) {
            fs.writeFileSync(autoStartConfigPath, JSON.stringify({ enabled: false }));
        }

        ipcMain.on('save-api-url', (event, url) => event.returnValue = true);
        ipcMain.on('check-update', (event, apiBaseUrl, silent) => {
            checkForUpdates(apiBaseUrl, silent === true);
        });

        ipcMain.on('auto-update', async (event, downloadUrl, version) => {
            if (!downloadUrl) return;
            const tempDir = app.getPath('temp');
            const installerPath = path.join(tempDir, `update-${version || 'latest'}.exe`);
            updateInstallerPath = installerPath;
            try {
                await downloadFile(downloadUrl, installerPath, (percent) => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('update-progress', percent);
                    }
                });
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-downloaded', installerPath);
                }
            } catch (err) {
                updateInstallerPath = null;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-download-error', err.message);
                }
            }
        });

        ipcMain.on('install-update', (event, installerPath) => {
            console.log('[install-update] received, path:', installerPath, 'exists:', installerPath && fs.existsSync(installerPath));
            if (installerPath && fs.existsSync(installerPath)) {
                runInstaller(installerPath, true, true);
            }
        });

        ipcMain.handle('run-command', async (event, command) => {
            return new Promise((resolve, reject) => {
                exec(command, { encoding: 'buffer', shell: true }, (error, stdout, stderr) => {
            // 将 Windows 默认的 GBK 编码转为 UTF-8
                    const stdoutStr = stdout ? iconv.decode(stdout, 'gbk') : '';
                    const stderrStr = stderr ? iconv.decode(stderr, 'gbk') : '';
                    if (error) {
                        reject(new Error(stderrStr || error.message));
                    } else {
                        resolve(stdoutStr);
                    }
                });
            });
        });
        ipcMain.on('window-minimize', (event) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win && !win.isDestroyed()) win.minimize();
        });
        ipcMain.on('window-maximize', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                } else {
                    mainWindow.maximize();
                }
                const isMaximized = mainWindow.isMaximized();
                mainWindow.webContents.send('window-state-changed', isMaximized);
            }
        });
        ipcMain.on('window-close', () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        });

        ipcMain.on('dev-panel-close', () => {
            if (devPanelWindow && !devPanelWindow.isDestroyed()) devPanelWindow.close();
        });
        ipcMain.on('dev-panel-minimize', () => {
            if (devPanelWindow && !devPanelWindow.isDestroyed()) devPanelWindow.minimize();
        });

        ipcMain.handle('toggle-dev-panel', () => {
            toggleDevPanel();
            return !!(devPanelWindow && !devPanelWindow.isDestroyed());
        });
        ipcMain.handle('is-dev-panel-open', () => {
            return !!(devPanelWindow && !devPanelWindow.isDestroyed());
        });

        ipcMain.on('app-quit', () => {
            isQuitting = true;
            app.quit();
        });

        ipcMain.on('relaunch-app', () => {
            app.relaunch();
            app.exit();
        });

        ipcMain.on('set-auto-start', (event, enable) => {
            const configPath = path.join(app.getPath('userData'), 'auto-start.json');
            fs.writeFileSync(configPath, JSON.stringify({ enabled: !!enable }));
            app.setLoginItemSettings({
                openAtLogin: !!enable,
                openAsHidden: true,
                args: ['--hidden']
            });
        });

        ipcMain.handle('get-auto-start', () => {
            const settings = app.getLoginItemSettings();
            return settings.openAtLogin;
        });

        ipcMain.handle('get-app-version', () => {
            return app.getVersion();
        });

    ipcMain.on('set-title', (event, title) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setTitle(title);
            }
        });

        ipcMain.handle('check-update-local', async () => {
            return checkForLocalUpdate();
        });

        ipcMain.handle('fetch-update-info', async (event, url) => {
            return new Promise((resolve, reject) => {
                const req = http.get(url, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, body }));
                });
                req.on('error', (err) => reject(err));
                req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
            });
        });

        ipcMain.handle('open-xxt-window', async () => {
            if (xxtLoginWindow && !xxtLoginWindow.isDestroyed()) {
                xxtLoginWindow.focus();
                return;
            }
            mainWindow.webContents.send('xxt-login-state', true);
            xxtSession = session.fromPartition('persist:xxt');
            // 重置为默认浏览器 UA，避免使用之前缓存的 APP UA 破坏登录页
            xxtSession.setUserAgent('');

            const loginUrl = 'https://passport2.chaoxing.com/login?loginType=1&fid=&newversion=true&refer=https%3A%2F%2Fk.chaoxing.com%2Fres%2Fstudy%2FloginComplete.html%3Ft%3D' + Date.now() + '&pcxxtpage=2';
            const xxtUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) cxstudy/1.4.2 Chrome/126.0.6478.234 Electron/31.6.0 Safari/537.36 osVersion_10.0.26200 osArch_0 (schild:87d6ef89e0106fcbbceb33718d1eb91c) (device:x64) Language/zh_CN com.chaoxing.cxstudy/ChaoXingStudy_1000371_1.4.2_windows_pc';
            xxtLoginWindow = new BrowserWindow({
                width: 420,
                height: 610,
                minWidth: 380,
                minHeight: 500,
                parent: mainWindow,
                modal: false,
                title: '学习通登录',
                icon: path.join(__dirname, 'icon.ico'),
                webPreferences: {
                    session: xxtSession,
                    preload: path.join(__dirname, 'xxt-preload.js'),
                    nodeIntegration: false,
                    contextIsolation: false,
                    webSecurity: false
                }
            });
            xxtLoginWindow.webContents.setUserAgent(xxtUA);
            xxtLoginWindow.loadURL(loginUrl);
            xxtSession.webRequest.onBeforeRequest((details, callback) => {
                if (details.resourceType === 'xhr' || details.resourceType === 'fetch' || details.method === 'POST') {
                    console.log('[XXT-REQ]', details.method, details.resourceType, details.url.substring(0, 150));
                }
                callback({});
            });
            xxtLoginWindow.webContents.setWindowOpenHandler(({ url }) => {
                console.log('[XXT-LOGIN] windowOpenHandler:', url);
                if (/^(jsbridge|cxstudy):\/\//.test(url)) {
                    console.log('[XXT-LOGIN] blocked jsbridge/cxstudy window.open');
                    return { action: 'deny' };
                }
                if (url && /^https?:\/\//.test(url)) {
                    xxtLoginWindow.loadURL(url);
                }
                return { action: 'deny' };
            });
            xxtLoginWindow.webContents.on('will-navigate', (e, url) => {
                console.log('[XXT-LOGIN] will-navigate:', url);
                if (/^(jsbridge|cxstudy):\/\//.test(url)) { e.preventDefault(); console.log('[XXT-LOGIN] blocked jsbridge/cxstudy navigation'); return; }
            });
            xxtLoginWindow.webContents.on('did-finish-load', () => {
                const currentUrl = xxtLoginWindow.webContents.getURL();
                console.log('[XXT-LOGIN] did-finish-load:', currentUrl);
                if (currentUrl.includes('/loginComplete')) {
                    console.log('[XXT-LOGIN] loginComplete loaded, extracting credentials...');
                    xxtLoginWindow.webContents.executeJavaScript('window.MainWindowHelper && window.MainWindowHelper.extractCredentials && window.MainWindowHelper.extractCredentials()').catch(function() {});
                    var localPending = pendingSsoCreds;
                    pendingSsoCreds = null;
                    setTimeout(function() {
                        (async function() {
                            var creds = getEasemobCredentials();
                            if (!creds && localPending) {
                                console.log('[Main] 无已存储凭据，延迟调用 SSO（cookies已就绪）...');
                                try {
                                    var result = await performDelayedSso(localPending);
                                    if (result && result.huanxinId) {
                                        saveEasemobCredentials(result.huanxinId, result.hxToken);
                                        creds = { huanxinId: result.huanxinId, hxToken: result.hxToken };
                                        console.log('[Main] 延迟 SSO 成功！');
                                    } else if (result && result.imAccount) {
                                        console.log('[Main] 延迟 SSO 返回 imAccount:', result.imAccount.username);
                                        creds = { imAccount: result.imAccount };
                                    } else {
                                        console.log('[Main] 延迟 SSO 失败:', JSON.stringify(result).substring(0, 200));
                                    }
                                } catch(e) { console.log('[Main] 延迟 SSO 异常:', e); }
                            }
                            xxtLoginWindow.close();
                            mainWindow.webContents.send('xxt-login-success', [
                                'https://mooc2-ans.chaoxing.com/visit/interaction',
                                'https://homepage.chaoxing.com',
                                'https://i.chaoxing.com/'
                            ]);
                            if (creds) { console.log('[Main] 转发凭据到主窗口'); mainWindow.webContents.send('easemob-credentials', creds); }
                            else {
                                console.log('[Main] 无已存储凭据，3秒后重试...');
                                setTimeout(function() {
                                    var retryCreds = getEasemobCredentials();
                                    if (retryCreds && mainWindow && mainWindow.webContents) {
                                        console.log('[Main] 重试成功，转发凭据');
                                        mainWindow.webContents.send('easemob-credentials', retryCreds);
                                    } else {
                                        console.log('[Main] 重试失败，SSO 仍未返回凭据');
                                    }
                                }, 3000);
                            }
                        })();
                    }, 2000);
                }
            });
            xxtLoginWindow.webContents.on('did-navigate', (e, url) => {
                console.log('[XXT-LOGIN] did-navigate:', url);
            });
            xxtLoginWindow.webContents.on('will-redirect', (e, url) => {
                console.log('[XXT-LOGIN] will-redirect:', url);
            });
            xxtLoginWindow.on('closed', () => {
                xxtLoginWindow = null;
                mainWindow.webContents.send('xxt-login-state', false);
            });
        });

        ipcMain.on('register-xxt-webview', (event, webContentsId) => {
            xxtWebContentsIds.add(webContentsId);
            console.log('[Main] register-xxt-webview:', webContentsId, 'total:', xxtWebContentsIds.size);
        });

        ipcMain.handle('xxt-check-cookies', async () => {
            const xxtSession = session.fromPartition('persist:xxt');
            try {
                const cookies = await xxtSession.cookies.get({});
                const cxCookies = cookies.filter(c => c.domain && c.domain.includes('chaoxing.com'));
                console.log('[XXT] check-cookies: total=' + cookies.length + ', chaoxing=' + cxCookies.length + ':', cxCookies.map(c => c.name + '@' + c.domain).join(', '));
                return cxCookies.length > 0;
            } catch (e) { console.error('[XXT] check-cookies error:', e); return false; }
        });

        ipcMain.handle('xxt-logout', async () => {
            const xxtSession = session.fromPartition('persist:xxt');
            try {
                const cookies = await xxtSession.cookies.get({});
                for (const cookie of cookies) {
                    const url = (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '');
                    await xxtSession.cookies.remove(url, cookie.name);
                }
            } catch (e) {
                console.error('[XXT-LOGOUT] Failed to clear cookies:', e);
            }
            try {
                await xxtSession.clearStorageData({ storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
            } catch (e) {}
        });

        // 环信凭据存储
        const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'easemob-credentials.json');
        function saveEasemobCredentials(huanxinId, hxToken) {
            try {
                const encrypted = safeStorage.encryptString(hxToken);
                fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({ huanxinId, hxToken: encrypted.toString('base64') }));
                console.log('[Main] 环信凭据已保存:', huanxinId);
            } catch (e) { console.error('[Main] 保存环信凭据失败:', e); }
        }
        function getEasemobCredentials() {
            try {
                if (!safeStorage.isEncryptionAvailable()) { console.log('[Main] safeStorage 不可用'); return null; }
                const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
                const buffer = Buffer.from(data.hxToken, 'base64');
                const hxToken = safeStorage.decryptString(buffer);
                return { huanxinId: data.huanxinId, hxToken };
            } catch (e) { return null; }
        }
        function clearEasemobCredentials() {
            try { fs.unlinkSync(CREDENTIALS_PATH); console.log('[Main] 环信凭据已清除'); } catch (e) {}
        }

        ipcMain.on('xxt-debug-log', (event, msg) => { console.log('[xxt-preload]', msg); });

        // 暂存登录窗口发来的明文凭据，用于 loginComplete 后延迟 SSO
        var pendingSsoCreds = null;

        // SSO 登录：主进程发起 HTTP 请求（携带 xxtSession cookies）
        ipcMain.on('xxt-sso-login', async (event, creds) => {
            console.log('[Main] SSO: 收到明文凭据, username=' + creds.username);
            pendingSsoCreds = creds;  // 暂存，供 loginComplete 后延迟重试

            // 获取 xxtSession 的 cookies 并构建 Cookie header
            var cookieHeader = '';
            if (xxtSession) {
                try {
                    var cookies = await xxtSession.cookies.get({});
                    cookieHeader = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
                    console.log('[Main] SSO: 携带 ' + cookies.length + ' 个 cookies');
                } catch(e) {
                    console.log('[Main] SSO: 获取 cookies 失败: ' + e.message);
                }
            } else {
                console.log('[Main] SSO: xxtSession 未初始化');
            }

            var fullXxtUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) cxstudy/1.4.2 Chrome/126.0.6478.234 Electron/31.6.0 Safari/537.36 osVersion_10.0.26200 osArch_0 (schild:87d6ef89e0106fcbbceb33718d1eb91c) (device:x64) Language/zh_CN com.chaoxing.cxstudy/ChaoXingStudy_1000371_1.4.2_windows_pc';
            var body = 'username=' + encodeURIComponent(creds.username) + '&password=' + encodeURIComponent(creds.password);
            var reqHeaders = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': fullXxtUA
            };
            if (cookieHeader) {
                reqHeaders['Cookie'] = cookieHeader;
            }

            var req = https.request('https://sso.chaoxing.com/apis/login/userLogin4Uname.do', {
                method: 'POST',
                headers: reqHeaders
            }, function(res) {
                console.log('[Main] SSO: HTTP状态码=' + res.statusCode);
                var data = '';
                res.on('data', function(chunk) { data += chunk; });
                res.on('end', function() {
                    console.log('[Main] SSO: 原始响应=' + data.substring(0, 500));
                    try {
                        var json = JSON.parse(data);
                        console.log('[Main] SSO: result=' + json.result + ', msg keys=' + (json.msg ? Object.keys(json.msg).join(',') : 'null'));
                        if (json.result === 1 && json.msg && json.msg.huanxinId && json.msg.hxToken) {
                            console.log('[Main] SSO: 凭据获取成功! huanxinId=' + json.msg.huanxinId.substring(0, 60) + '...');
                            saveEasemobCredentials(json.msg.huanxinId, json.msg.hxToken);
                            if (mainWindow && mainWindow.webContents) {
                                mainWindow.webContents.send('easemob-credentials', {
                                    huanxinId: json.msg.huanxinId,
                                    hxToken: json.msg.hxToken
                                });
                            }
                        } else {
                            console.log('[Main] SSO: 未获取到凭据, msg keys=' + (json.msg ? Object.keys(json.msg).slice(0, 10).join(',') : 'null'));
                        }
                    } catch(e) {
                        console.log('[Main] SSO: JSON解析失败: ' + e.message + ', raw=' + data.substring(0, 200));
                    }
                });
            });
            req.on('error', function(err) {
                console.log('[Main] SSO: 请求失败 ' + err.message);
            });
            req.write(body);
            req.end();
        });

        ipcMain.on('xxt-login-credentials', (event, creds) => {
            console.log('[Main] 收到环信凭据:', creds.huanxinId);
            saveEasemobCredentials(creds.huanxinId, creds.hxToken);
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('easemob-credentials', creds);
            }
        });

        // loginComplete 后延迟调用 SSO（此时 cookies 已就绪）
        async function performDelayedSso(creds) {
            var fullXxtUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) cxstudy/1.4.2 Chrome/126.0.6478.234 Electron/31.6.0 Safari/537.36 osVersion_10.0.26200 osArch_0 (schild:87d6ef89e0106fcbbceb33718d1eb91c) (device:x64) Language/zh_CN com.chaoxing.cxstudy/ChaoXingStudy_1000371_1.4.2_windows_pc';
            var cookieHeader = '';
            if (xxtSession) {
                try {
                    var cookies = await xxtSession.cookies.get({});
                    cookieHeader = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
                    console.log('[Main] delayedSso: 携带 ' + cookies.length + ' 个 cookies');
                } catch(e) { console.log('[Main] delayedSso: 获取 cookies 失败: ' + e.message); }
            }
            var body = 'username=' + encodeURIComponent(creds.username) + '&password=' + encodeURIComponent(creds.password);
            return new Promise(function(resolve) {
                var req = https.request('https://sso.chaoxing.com/apis/login/userLogin4Uname.do', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(body),
                        'User-Agent': fullXxtUA,
                        'X-Requested-With': 'com.chaoxing.cxstudy',
                        'platform': 'pc',
                        'Accept': 'application/json, text/plain, */*',
                        'Referer': 'https://passport2.chaoxing.com/',
                        'Origin': 'https://passport2.chaoxing.com'
                    }
                }, function(res) {
                    var data = '';
                    res.on('data', function(chunk) { data += chunk; });
                    res.on('end', function() {
                        console.log('[Main] delayedSso: HTTP ' + res.statusCode + ', body=' + data.substring(0, 800));
                        try {
                            var json = JSON.parse(data);
                            var imAccount = (json.msg && json.msg.imAccount) || (json.msg && json.msg.accountInfo && json.msg.accountInfo.imAccount) || null;
                            if (json.result === 1 && json.msg && json.msg.huanxinId && json.msg.hxToken) {
                                resolve({ huanxinId: json.msg.huanxinId, hxToken: json.msg.hxToken });
                            } else if (imAccount && imAccount.username && imAccount.password) {
                                resolve({ imAccount: imAccount });
                            } else {
                                resolve({ error: '无环信凭据', result: json.result });
                            }
                        } catch(e) { resolve({ error: 'JSON解析失败: ' + e.message }); }
                    });
                });
                req.on('error', function(err) { resolve({ error: '请求失败: ' + err.message }); });
                req.write(body);
                req.end();
            });
        }

        ipcMain.on('xxt-gettoken-response', (event, resp) => {
            console.log('[Main] getToken webview resp:', JSON.stringify(resp).substring(0, 500));
        });

        ipcMain.handle('get-xxt-preload-path', () => path.join(__dirname, 'xxt-preload.js'));

        // 查找学习通 PC 客户端安装路径
        function findCXStudyByRegistry() {
            return new Promise(function(resolve) {
                exec('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /f "学习通" /d', { encoding: 'utf-8' }, function(err, stdout) {
                    if (err) { console.log('[Main] 注册表搜索未找到学习通:', err.message); resolve(null); return; }
                    var lines = stdout.split('\n');
                    var found = false;
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i];
                        if (line.indexOf('DisplayName') >= 0 && line.indexOf('学习通') >= 0) {
                            found = true;
                        } else if (found && line.indexOf('DisplayIcon') >= 0) {
                            var match = line.match(/DisplayIcon\s+REG_SZ\s+(.*)/);
                            if (match) {
                                var exePath = match[1].trim();
                                var dir = exePath.replace(/\\[^\\]*\.exe$/, '');
                                console.log('[Main] 找到学习通安装目录:', dir);
                                resolve(dir);
                                return;
                            }
                        }
                    }
                    resolve(null);
                });
            });
        }

        ipcMain.handle('get-cxstudy-path', async () => {
            return await findCXStudyByRegistry();
        });

        ipcMain.handle('read-cxstudy-config', async () => {
            var installPath = process.env.CXSTUDY_PATH || path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'cxstudy', 'latest');
            if (!fs.existsSync(installPath)) return { error: '未找到学习通安装目录: ' + installPath };
            var result = { installPath: installPath, files: {} };
            // 读取官方客户端的 package.json
            var pkgPaths = [
                path.join(installPath, 'resources', 'app.asar', 'package.json'),
                path.join(installPath, 'resources', 'app', 'package.json'),
                path.join(installPath, 'package.json')
            ];
            for (var i = 0; i < pkgPaths.length; i++) {
                try {
                    var pkg = JSON.parse(fs.readFileSync(pkgPaths[i], 'utf-8'));
                    result.files['package.json'] = { path: pkgPaths[i], deps: pkg.dependencies || {}, devDeps: pkg.devDependencies || {} };
                    break;
                } catch(e) {}
            }
            // 搜索官方客户端的源码目录（优先 asar 内的 dist）
            var srcDirs = [
                path.join(installPath, 'resources', 'app.asar', 'dist'),
                path.join(installPath, 'resources', 'app.asar'),
                path.join(installPath, 'resources', 'app'),
                installPath
            ];
            for (var d = 0; d < srcDirs.length; d++) {
                var dir = srcDirs[d];
                if (!fs.existsSync(dir)) continue;
                try {
                    var files = fs.readdirSync(dir);
                    for (var f = 0; f < files.length; f++) {
                        var file = files[f];
                        if (file.endsWith('.js') || file.endsWith('.html')) {
                            var filePath = path.join(dir, file);
                            try {
                                var content = fs.readFileSync(filePath, 'utf-8');
                                var lines = content.split('\n');
                                var relevantLines = [];
                                for (var l = 0; l < lines.length; l++) {
                                    var line = lines[l];
                                    if (/easemob|Easemob|WebIM|appKey|isMultiLogin|deviceId|osType|resource|customOS|deviceName|环信|connection|open\(|sendMsg/i.test(line)) {
                                        relevantLines.push({ line: l + 1, content: line.trim().substring(0, 200) });
                                        if (relevantLines.length > 80) break;
                                    }
                                }
                                if (relevantLines.length > 0) {
                                    result.files[file] = relevantLines;
                                }
                            } catch(e2) {}
                        }
                    }
                } catch(e3) {}
            }
            return result;
        });

        ipcMain.handle('get-easemob-credentials', () => getEasemobCredentials());
        ipcMain.handle('clear-easemob-credentials', () => { clearEasemobCredentials(); });

        // SSO 登录（同步版，返回结果给调用方）
        ipcMain.handle('xxt-sso-login-sync', async (event, creds) => {
            console.log('[Main] SSO-sync: 收到请求, username=' + creds.username);
            var fullXxtUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) cxstudy/1.4.2 Chrome/126.0.6478.234 Electron/31.6.0 Safari/537.36 osVersion_10.0.26200 osArch_0 (schild:87d6ef89e0106fcbbceb33718d1eb91c) (device:x64) Language/zh_CN com.chaoxing.cxstudy/ChaoXingStudy_1000371_1.4.2_windows_pc';
            var cookieHeader = '';
            if (xxtSession) {
                try {
                    var cookies = await xxtSession.cookies.get({});
                    cookieHeader = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
                    console.log('[Main] SSO-sync: 携带 ' + cookies.length + ' 个 cookies');
                } catch(e) { console.log('[Main] SSO-sync: 获取 cookies 失败: ' + e.message); }
            }
            var body = 'username=' + encodeURIComponent(creds.username) + '&password=' + encodeURIComponent(creds.password);
            var reqHeaders = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': fullXxtUA,
                'X-Requested-With': 'com.chaoxing.cxstudy',
                'platform': 'pc',
                'appVersion': '1.4.2',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://passport2.chaoxing.com/',
                'Origin': 'https://passport2.chaoxing.com'
            };
            if (cookieHeader) { reqHeaders['Cookie'] = cookieHeader; }
            return new Promise(function(resolve) {
                var req = https.request('https://sso.chaoxing.com/apis/login/userLogin4Uname.do', {
                    method: 'POST', headers: reqHeaders
                }, function(res) {
                    var data = '';
                    res.on('data', function(chunk) { data += chunk; });
                    res.on('end', function() {
                        console.log('[Main] SSO-sync: HTTP ' + res.statusCode + ', body=' + data.substring(0, 2000));
                        try {
                            var json = JSON.parse(data);
                            if (json.msg) {
                                console.log('[Main] SSO-sync: msg keys=' + Object.keys(json.msg).join(','));
                                console.log('[Main] SSO-sync: hasHxId=' + !!json.msg.huanxinId + ', hasHxToken=' + !!json.msg.hxToken);
                                var hasImAccount = !!(json.msg.imAccount || (json.msg.accountInfo && json.msg.accountInfo.imAccount));
                                console.log('[Main] SSO-sync: hasImAccount=' + hasImAccount);
                                if (json.msg.imAccount) {
                                    console.log('[Main] SSO-sync: imAccount(msg.imAccount)=' + JSON.stringify(json.msg.imAccount));
                                } else if (json.msg.accountInfo && json.msg.accountInfo.imAccount) {
                                    console.log('[Main] SSO-sync: imAccount(msg.accountInfo.imAccount)=' + JSON.stringify(json.msg.accountInfo.imAccount));
                                }
                                console.log('[Main] SSO-sync: uid=' + json.msg.uid + ', fid=' + json.msg.fid + ', uname=' + json.msg.uname);
                            }
                            var imAccount = (json.msg && json.msg.imAccount) || (json.msg && json.msg.accountInfo && json.msg.accountInfo.imAccount) || null;
                            if (json.result === 1 && json.msg && json.msg.huanxinId && json.msg.hxToken) {
                                console.log('[Main] SSO-sync: 凭据获取成功!');
                                saveEasemobCredentials(json.msg.huanxinId, json.msg.hxToken);
                                resolve({ huanxinId: json.msg.huanxinId, hxToken: json.msg.hxToken, imAccount: imAccount || null });
                            } else if (imAccount && imAccount.username && imAccount.password) {
                                console.log('[Main] SSO-sync: 找到 imAccount, username=' + imAccount.username + ', pwd=' + imAccount.password);
                                resolve({ result: json.result, msg: json.msg, uid: json.msg && json.msg.uid, fid: json.msg && json.msg.fid, imAccount: imAccount });
                            } else {
                                resolve({ error: '无环信凭据', result: json.result, msg: json.msg, uid: json.msg && json.msg.uid, fid: json.msg && json.msg.fid });
                            }
                        } catch(e) {
                            resolve({ error: 'JSON解析失败: ' + e.message });
                        }
                    });
                });
                req.on('error', function(err) { resolve({ error: '请求失败: ' + err.message }); });
                req.write(body);
                req.end();
            });
        });

        // 尝试从 im.chaoxing.com 获取环信凭据（使用 xxtSession cookies，跟随重定向）
        ipcMain.handle('xxt-fetch-chat-token', async (event, params) => {
            var uid = (params && params.uid) || '';
            var fid = (params && params.fid) || '';
            console.log('[Main] ChatToken: 尝试获取凭据, uid=' + uid + ', fid=' + fid);
            var cookieHeader = '';
            if (xxtSession) {
                try {
                    var cookies = await xxtSession.cookies.get({});
                    cookieHeader = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
                    console.log('[Main] ChatToken: 携带 ' + cookies.length + ' 个 cookies');
                } catch(e) {}
            }
            if (!cookieHeader) {
                console.log('[Main] ChatToken: 无 cookies');
                return { error: '无登录cookies' };
            }
            var fullXxtUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) cxstudy/1.4.2 Chrome/126.0.6478.234 Electron/31.6.0 Safari/537.36 osVersion_10.0.26200 osArch_0 (schild:87d6ef89e0106fcbbceb33718d1eb91c) (device:x64) Language/zh_CN com.chaoxing.cxstudy/ChaoXingStudy_1000371_1.4.2_windows_pc';
            var defaultUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

            function extractCredentials(text) {
                var hxId = text.match(/(?:huanxinId|hxId|huanxin_id|userId)["']?\s*[:=]\s*["']([^"'\s,;]+)["']/);
                var hxTok = text.match(/(?:hxToken|hx_token|accessToken|imToken|chatToken)["']?\s*[:=]\s*["']([^"'\s,;]+)["']/);
                if (hxId && hxTok) return { huanxinId: hxId[1], hxToken: hxTok[1] };
                try {
                    var jsonMatch = text.match(/\{[^}]*"huanxinId"[^}]*\}/);
                    if (jsonMatch) {
                        var parsed = JSON.parse(jsonMatch[0]);
                        if (parsed.huanxinId && parsed.hxToken) return { huanxinId: parsed.huanxinId, hxToken: parsed.hxToken };
                    }
                } catch(e) {}
                return null;
            }

            var urls = ['https://im.chaoxing.com/webim/im.html'];
            if (uid) {
                urls.push('https://i.chaoxing.com/base/getToken?uid=' + uid + '&fid=' + fid);
                urls.push('https://i.chaoxing.com/base/getToken?id=' + uid);
            }
            urls.push('https://im.chaoxing.com/', 'https://i.chaoxing.com/base/getToken');

            return new Promise(function(resolve) {
                var urlIdx = 0;
                var maxRedirects = 5;
                function doRequest(url, depth) {
                    if (depth > maxRedirects) { tryNextUrl('重定向次数过多'); return; }
                    console.log('[Main] ChatToken: [' + urlIdx + '][' + depth + '] 请求 ' + url);
                    var parsed = new URL(url);
                    var isHttps = parsed.protocol === 'https:';
                    var mod = isHttps ? https : http;
                    var useUA = /passport2\.chaoxing\.com\/login/.test(url) ? defaultUA : fullXxtUA;
                    var req = mod.request(url, {
                        method: 'GET',
                        headers: { 'User-Agent': useUA, 'Cookie': cookieHeader }
                    }, function(res) {
                        console.log('[Main] ChatToken: [' + urlIdx + '][' + depth + '] HTTP ' + res.statusCode + ', location=' + (res.headers.location || 'none'));
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            var loc = res.headers.location;
                            if (!loc.startsWith('http')) loc = parsed.origin + (loc.startsWith('/') ? '' : '/') + loc;
                            res.resume();
                            doRequest(loc, depth + 1);
                            return;
                        }
                        if (res.statusCode === 404 || res.statusCode === 400) {
                            res.resume();
                            tryNextUrl('HTTP ' + res.statusCode);
                            return;
                        }
                        var data = '';
                        res.on('data', function(chunk) { data += chunk; });
                        res.on('end', function() {
                            var creds = extractCredentials(data);
                            if (creds) {
                                console.log('[Main] ChatToken: 从页面提取到凭据!');
                                saveEasemobCredentials(creds.huanxinId, creds.hxToken);
                                resolve(creds);
                            } else {
                                console.log('[Main] ChatToken: 页面中未找到凭据, body前300=' + data.substring(0, 300));
                                tryNextUrl('未找到凭据');
                            }
                        });
                    });
                    req.on('error', function(err) { tryNextUrl('请求失败: ' + err.message); });
                    req.end();
                }
                function tryNextUrl(reason) {
                    console.log('[Main] ChatToken: [' + urlIdx + '] ' + reason + ', 尝试下一个URL');
                    urlIdx++;
                    if (urlIdx >= urls.length) { resolve({ error: '所有URL均未获取到凭据' }); return; }
                    doRequest(urls[urlIdx], 0);
                }
                doRequest(urls[0], 0);
            });
        });

        ipcMain.handle('select-file', async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile', 'multiSelections']
            });
            if (result.canceled || !result.filePaths.length) return [];
            return result.filePaths.map(p => ({
                name: path.basename(p),
                path: p,
                data: fs.readFileSync(p)
            }));
        });

        // ========== Python ==========
        ipcMain.handle('run-python', async (event, code) => {
            if (pythonRunProc) { pythonRunProc.kill(); pythonRunProc = null; }
            const { execFile } = require('child_process');
            const os = require('os');
            const tmpFile = path.join(os.tmpdir(), 'hw_python_' + Date.now() + '.py');
            fs.writeFileSync(tmpFile, code, 'utf-8');
            return new Promise((resolve) => {
                const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
                pythonRunProc = execFile(pythonCmd, [tmpFile], { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
                    pythonRunProc = null;
                    try { fs.unlinkSync(tmpFile); } catch (e) {}
                    if (err && !stdout && !stderr && err.code === 'ENOENT') {
                        resolve({ error: '未安装 Python，请先安装 Python 并添加到系统 PATH' });
                        return;
                    }
                    resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err ? err.code : 0 });
                });
            });
        });

        ipcMain.handle('is-python-running', async () => {
            return pythonRunProc !== null || pythonReplProc !== null;
        });

        ipcMain.handle('save-python-file', async (event, { content, defaultPath }) => {
            const result = await dialog.showSaveDialog(mainWindow, {
                defaultPath: defaultPath || 'untitled.py',
                filters: [{ name: 'Python 文件', extensions: ['py'] }, { name: '所有文件', extensions: ['*'] }]
            });
            if (result.canceled || !result.filePath) return null;
            fs.writeFileSync(result.filePath, content, 'utf-8');
            return { name: path.basename(result.filePath), path: result.filePath };
        });

        ipcMain.handle('save-python-file-direct', async (event, { content, filePath }) => {
            try {
                fs.writeFileSync(filePath, content, 'utf-8');
                return { name: path.basename(filePath), path: filePath };
            } catch (e) {
                return { error: '保存失败: ' + e.message };
            }
        });

        ipcMain.handle('open-python-file', async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters: [{ name: 'Python 文件', extensions: ['py'] }, { name: '所有文件', extensions: ['*'] }]
            });
            if (result.canceled || !result.filePaths.length) return null;
            const fp = result.filePaths[0];
            try {
                const content = fs.readFileSync(fp, 'utf-8');
                return { name: path.basename(fp), path: fp, content };
            } catch (e) {
                return { error: '无法读取文件: ' + e.message };
            }
        });

        // Python REPL（交互式命令行）
        const { spawn } = require('child_process');
        let pythonReplProc = null;
        let pythonRunProc = null;
        let pythonReplOutput = '';
        let pythonReplPending = null;
        let pythonReplDebounce = null;

        const resolveReplPending = (output) => {
            clearTimeout(pythonReplDebounce);
            pythonReplDebounce = null;
            const cb = pythonReplPending; pythonReplPending = null;
            cb({ output: output });
        };

        const handleReplOutput = (text) => {
            pythonReplOutput += text;
            if (!pythonReplPending) return;
            // 标准提示符：命令完成
            if (text.includes('>>> ') || text.includes('... ')) {
                const idx = Math.max(text.lastIndexOf('>>> '), text.lastIndexOf('... '));
                const result = pythonReplOutput.substring(0, pythonReplOutput.length - text.length + idx);
                pythonReplOutput = text.substring(idx);
                resolveReplPending(result.trimEnd());
                return;
            }
            // help() 交互模式：仅当 help> 前面有实际内容时才 resolve
            // 如果 help> 在 chunk 开头（回显），不 resolve，等后续 >>>  或防抖处理
            if (text.includes('help> ')) {
                const idx = text.lastIndexOf('help> ');
                const result = pythonReplOutput.substring(0, pythonReplOutput.length - text.length + idx);
                if (result.trim().length > 0) {
                    pythonReplOutput = text.substring(idx);
                    resolveReplPending(result.trimEnd() + '\n[提示] 已进入帮助模式，输入 quit 退出');
                    return;
                }
            }
            // 无标准提示符的输出：设置3秒防抖，超时后返回已有输出
            clearTimeout(pythonReplDebounce);
            pythonReplDebounce = setTimeout(() => {
                if (pythonReplPending) {
                    const result = pythonReplOutput;
                    pythonReplOutput = '';
                    resolveReplPending(result.trimEnd() + '\n[提示] 命令可能仍在等待输入');
                }
            }, 3000);
        };

        ipcMain.handle('python-repl-start', async () => {
            if (pythonReplProc) { pythonReplProc.kill(); pythonReplProc = null; }
            pythonReplOutput = '';
            pythonReplPending = null;
            return new Promise((resolve) => {
                const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
                pythonReplProc = spawn(pythonCmd, ['-i', '-c', 'pass'], { stdio: ['pipe', 'pipe', 'pipe'] });
                let startupBuf = '';
                let resolved = false;
                let startupTimeout;
                const checkStartup = (text) => {
                    if (resolved) return;
                    startupBuf += text;
                    if (startupBuf.includes('>>> ') || startupBuf.includes('Type "help"')) {
                        clearTimeout(startupTimeout);
                        resolved = true; pythonReplOutput = ''; resolve({ success: true });
                    }
                };
                pythonReplProc.stdout.on('data', (data) => {
                    const text = data.toString();
                    if (!resolved) {
                        checkStartup(text);
                    } else {
                        handleReplOutput(text);
                    }
                });
                pythonReplProc.stderr.on('data', (data) => {
                    const text = data.toString();
                    if (!resolved) {
                        checkStartup(text);
                    } else {
                        handleReplOutput(text);
                    }
                });
                pythonReplProc.on('error', (err) => {
                    if (!resolved) { resolved = true; resolve({ error: 'Python未安装: ' + err.message }); }
                });
                pythonReplProc.on('exit', () => { pythonReplProc = null; });
                startupTimeout = setTimeout(() => {
                    if (resolved) return;
                    if (startupBuf.length > 0) {
                        resolved = true; pythonReplOutput = ''; resolve({ success: true });
                    } else {
                        resolved = true; resolve({ error: 'Python启动超时，请检查Python是否已安装' });
                    }
                }, 10000);
            });
        });

        ipcMain.handle('python-repl-stop', async () => {
            if (pythonReplProc) { pythonReplProc.kill(); pythonReplProc = null; }
            if (pythonRunProc) { pythonRunProc.kill(); pythonRunProc = null; }
            pythonReplOutput = '';
            pythonReplPending = null;
            clearTimeout(pythonReplDebounce);
            pythonReplDebounce = null;
            return true;
        });

        ipcMain.handle('python-repl-input', async (event, input) => {
            if (!pythonReplProc) return { error: 'REPL未启动，请先打开Python页面' };
            if (pythonReplPending) return { error: '上一个命令正在执行中，请稍候' };
            return new Promise((resolve) => {
                pythonReplOutput = '';
                pythonReplProc.stdin.write(input + '\n');
                var replInputTimer = setTimeout(() => {
                    if (pythonReplPending) {
                        clearTimeout(pythonReplDebounce);
                        pythonReplDebounce = null;
                        pythonReplPending = null;
                        resolve({ error: '命令执行超时（10秒）' });
                    }
                }, 10000);
                pythonReplPending = (result) => {
                    clearTimeout(replInputTimer);
                    pythonReplPending = null;
                    resolve(result);
                };
            });
        });

        ipcMain.handle('python-repl-interrupt', async () => {
            if (pythonReplProc) {
                pythonReplProc.kill();
                pythonReplProc = null;
            }
            clearTimeout(pythonReplDebounce);
            pythonReplDebounce = null;
            if (pythonReplPending) {
                const cb = pythonReplPending;
                pythonReplPending = null;
                cb({ output: 'KeyboardInterrupt' });
            }
            pythonReplOutput = '';
            return true;
        });

        // ========== 来电窗口 ==========
        var callRingProc = null;

        ipcMain.handle('show-call-window', async (event, callInfo) => {
            if (callWindow && !callWindow.isDestroyed()) { callWindow.close(); callWindow = null; }
            var win = new BrowserWindow({
                width: 352,
                height: 640,
                modal: false,
                frame: false,
                resizable: false,
                transparent: true,
                backgroundColor: '#00000000',
                title: '语音通话',
                icon: path.join(__dirname, 'icon.ico'),
                webPreferences: {
                    preload: path.join(__dirname, 'call-preload.js'),
                    nodeIntegration: true,
                    contextIsolation: false,
                    autoplayPolicy: 'no-user-gesture-required'
                }
            });
            callWindow = win;
            win.setMenuBarVisibility(false);
            win.loadFile(path.join(__dirname, 'call-window.html'));
            var ringPath = path.join(__dirname, 'call_ring.mp3');
            var ringUrl = fs.existsSync(ringPath) ? require('url').pathToFileURL(ringPath).href : null;
            console.log('[Call] 铃声路径:', ringPath, '存在:', fs.existsSync(ringPath));
            var AGORA_APP_ID = 'b2b0c8ac40c54858a043d7687ce75b54';
            win.webContents.on('did-finish-load', () => {
                if (win && !win.isDestroyed()) {
                    var token = (callInfo && callInfo.agoraToken) || '';
                    var appId = (callInfo && callInfo.agoraAppId) || AGORA_APP_ID;
                    win.webContents.send('call-info', { callInfo: callInfo || {}, ringPath: ringUrl, agoraAppId: appId, agoraToken: token });
                }
            });
            win.on('closed', () => {
                stopCallRing();
                if (callWindow === win) callWindow = null;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('call-window-closed');
                }
            });
            return true;
        });

        ipcMain.handle('call-window-minimize', async () => {
            if (callWindow && !callWindow.isDestroyed()) callWindow.minimize();
            return true;
        });

        ipcMain.handle('close-call-window', async () => {
            stopCallRing();
            if (callWindow && !callWindow.isDestroyed()) { callWindow.close(); callWindow = null; }
            return true;
        });

        ipcMain.on('call-window-action', (event, action) => {
            console.log('[Call] 动作:', action);
            if (action === 'answer') {
                stopCallRing();
            }
            if (action === 'reject' || action === 'hangup' || action === 'cancelCall') {
                stopCallRing();
                if (callWindow && !callWindow.isDestroyed()) {
                    callWindow.close();
                    callWindow = null;
                }
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('call-window-action', action);
            }
        });
        ipcMain.on('call-window-log', (event, msg) => {
            console.log('[CallWindow]', msg);
        });

        function stopCallRing() {
        }

        ipcMain.handle('start-call-ring', async () => {
            return true;
        });

        ipcMain.handle('stop-call-ring', async () => {
            return true;
        });

        ipcMain.handle('get-ring-path', async () => {
            var ringPath = path.join(__dirname, '..', 'files', 'call_ring.mp3');
            if (fs.existsSync(ringPath)) {
                var fileUrl = require('url').pathToFileURL(ringPath).href;
                return fileUrl;
            }
            return null;
        });

        // ========== 窗口抖动 ==========
        ipcMain.handle('shake-window', async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return false;
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            var bounds = mainWindow.getBounds();
            var origX = bounds.x;
            var origY = bounds.y;
            var steps = 16;
            var stepMs = 65;
            var amp = 10; // 振幅10px
            var directions = [
                [amp, 0], [0, amp], [-amp, 0], [0, -amp],
                [amp, 0], [0, amp], [-amp, 0], [0, -amp],
                [amp, 0], [0, amp], [-amp, 0], [0, -amp],
                [amp, 0], [0, amp], [-amp, 0], [0, -amp]
            ];
            for (var i = 0; i < steps; i++) {
                setTimeout(function(idx) {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.setBounds({
                            x: origX + directions[idx][0],
                            y: origY + directions[idx][1],
                            width: bounds.width,
                            height: bounds.height
                        });
                    }
                }, i * stepMs, i);
            }
            // 最后归位
            setTimeout(function() {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.setBounds(bounds);
                }
            }, steps * stepMs);
            return true;
        });

        // ========== 窗口舞蹈 (anghaoyu16://dance/) ==========
        var danceInterval = null;
        var danceBaseBounds = null;

        ipcMain.handle('start-window-dance', async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return false;
            if (danceInterval) return true;

            // 如果是最大化，先还原
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
                await new Promise(function(r) { setTimeout(r, 150); });
            }

            // 以当前窗口位置为基准，底边保持不变
            var bounds = mainWindow.getContentBounds();
            danceBaseBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
            var fixedBottom = bounds.y + bounds.height;

            // 临时解除最小尺寸限制，允许窗口自由缩放
            mainWindow.setMinimumSize(100, 100);

            var bpm = 130;
            var omega = 2 * Math.PI * bpm / 60;
            var startTime = Date.now();

            danceInterval = setInterval(function() {
                if (!mainWindow || mainWindow.isDestroyed()) {
                    clearInterval(danceInterval);
                    danceInterval = null;
                    return;
                }
                var elapsed = (Date.now() - startTime) / 1000;
                var rawSin = Math.sin(omega * elapsed);
                var sinVal = rawSin >= 0 ? Math.pow(rawSin, 0.1) : -Math.pow(-rawSin, 0.1);
                var deltaH = Math.round(sinVal * 128);
                var deltaW = -Math.round(sinVal * 128);
                var newH = danceBaseBounds.height + deltaH;
                var newW = danceBaseBounds.width + deltaW;
                mainWindow.setContentBounds({
                    x: Math.round(danceBaseBounds.x + danceBaseBounds.width / 2 - newW / 2),
                    y: fixedBottom - newH,
                    width: newW,
                    height: newH
                });
                // 自我修正：读回实际 bounds，若底边漂移立即纠正
                var actual = mainWindow.getContentBounds();
                var drift = (actual.y + actual.height) - fixedBottom;
                if (Math.abs(drift) > 1) {
                    mainWindow.setContentBounds({
                        x: actual.x,
                        y: actual.y - drift,
                        width: actual.width,
                        height: actual.height
                    });
                }
            }, 16);

            return true;
        });

        ipcMain.handle('stop-window-dance', async () => {
            if (danceInterval) {
                clearInterval(danceInterval);
                danceInterval = null;
            }
            if (danceBaseBounds && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setMinimumSize(900, 600);
                mainWindow.setBounds(danceBaseBounds);
            }
            danceBaseBounds = null;
            return true;
        });

        // ========== 窗口弹跳 (anghaoyu16://windows/) ==========
        var bounceInterval = null;
        var bounceBaseBounds = null;
        var bounceMoveHandler = null;
        var bounceInputHandler = null;

        ipcMain.handle('start-window-bounce', async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return false;
            if (bounceInterval) return true;

            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
                await new Promise(function(r) { setTimeout(r, 150); });
            }

            var bounds = mainWindow.getBounds();
            bounceBaseBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };

            var { screen } = require('electron');
            var display = screen.getDisplayMatching(bounds);
            var wa = display.workArea;

            var speed = 4;
            var angle = 45 * Math.PI / 180;
            var dx = Math.cos(angle) * speed;
            var dy = -Math.sin(angle) * speed;

            var bx = bounceBaseBounds.x;
            var by = bounceBaseBounds.y;
            var bw = bounceBaseBounds.width;
            var bh = bounceBaseBounds.height;

            var isBounceProgrammatic = false;
            function onBounceWillMove(event, newBounds) {
                if (isBounceProgrammatic) return;
                bx = newBounds.x;
                by = newBounds.y;
            }
            mainWindow.on('will-move', onBounceWillMove);
            bounceMoveHandler = onBounceWillMove;

            function onBeforeInput(e, input) {
                if (input.key === 'Escape' && !input.control && !input.alt && !input.meta) {
                    e.preventDefault();
                }
            }
            mainWindow.webContents.on('before-input-event', onBeforeInput);
            bounceInputHandler = onBeforeInput;

            bounceInterval = setInterval(function() {
                if (!mainWindow || mainWindow.isDestroyed()) {
                    clearInterval(bounceInterval);
                    bounceInterval = null;
                    try { if (mainWindow) mainWindow.removeListener('will-move', onBounceWillMove); } catch(e) {}
                    return;
                }
                bx += dx;
                by += dy;

                if (bx < wa.x) { bx = wa.x; dx = Math.abs(dx); }
                if (bx + bw > wa.x + wa.width) { bx = wa.x + wa.width - bw; dx = -Math.abs(dx); }
                if (by < wa.y) { by = wa.y; dy = Math.abs(dy); }
                if (by + bh > wa.y + wa.height) { by = wa.y + wa.height - bh; dy = -Math.abs(dy); }

                isBounceProgrammatic = true;
                mainWindow.setBounds({ x: Math.round(bx), y: Math.round(by), width: bw, height: bh });
                isBounceProgrammatic = false;
            }, 16);

            function onBeforeInput(event, input) {
                if (!bounceInterval) {
                    mainWindow.webContents.removeListener('before-input-event', onBeforeInput);
                    return;
                }
                if (input.key === 'q' || input.key === 'Q') {
                    clearInterval(bounceInterval);
                    bounceInterval = null;
                    try { if (mainWindow) mainWindow.removeListener('will-move', onBounceWillMove); } catch(e) {}
                    if (bounceInputHandler && mainWindow && !mainWindow.isDestroyed()) {
                try { mainWindow.webContents.removeListener('before-input-event', bounceInputHandler); } catch(e) {}
            }
            bounceInputHandler = null;
            bounceMoveHandler = null;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.setBounds(bounceBaseBounds);
                    }
                    bounceBaseBounds = null;
                    mainWindow.webContents.removeListener('before-input-event', onBeforeInput);
                    mainWindow.webContents.send('bounce-stopped-by-key');
                }
            }
            mainWindow.webContents.on('before-input-event', onBeforeInput);

            return true;
        });

        ipcMain.handle('stop-window-bounce', async () => {
            if (bounceInterval) {
                clearInterval(bounceInterval);
                bounceInterval = null;
            }
            if (bounceMoveHandler && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.removeListener('will-move', bounceMoveHandler);
            }
            bounceMoveHandler = null;
            if (bounceBaseBounds && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setBounds(bounceBaseBounds);
            }
            bounceBaseBounds = null;
            return true;
        });


    });

    app.on('window-all-closed', (event) => {
        // 托盘模式，不退出应用
        event.preventDefault();
    });
    app.on('will-quit', () => {
        if (commandPollInterval) clearInterval(commandPollInterval);
    });
    app.on('before-quit', () => {
        isQuitting = true;
        if (updateInstallerPath && fs.existsSync(updateInstallerPath)) {
            runInstaller(updateInstallerPath, true);
        }
    });
}