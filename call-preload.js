const { ipcRenderer } = require('electron');

try {
    window.AgoraRTC = require('agora-rtc-sdk-ng');
    console.log('[CallPreload] AgoraRTC 加载成功, methods:', Object.keys(window.AgoraRTC || {}).slice(0, 10).join(', '));
} catch(e) {
    console.error('[CallPreload] AgoraRTC 加载失败:', e.message);
    window.AgoraRTC = null;
}

window.electronAPI = {
    minimize: () => ipcRenderer.send('window-minimize'),
    closeCallWindow: () => ipcRenderer.invoke('close-call-window'),
    callWindowMinimize: () => ipcRenderer.invoke('call-window-minimize'),
    sendCallAction: (action) => ipcRenderer.send('call-window-action', action),
    getRingPath: () => ipcRenderer.invoke('get-ring-path'),
    callWindowLog: (msg) => ipcRenderer.send('call-window-log', msg),
    onCallInfo: (callback) => {
        ipcRenderer.on('call-info', (event, info) => callback(info));
    },
    onCallWindowClosed: (callback) => {
        ipcRenderer.on('call-window-closed', () => callback());
    }
};