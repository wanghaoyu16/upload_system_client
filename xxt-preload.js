const { contextBridge, ipcRenderer } = require('electron');

// SSO 凭据获取：从 DOM 读取明文密码，在 webview 上下文中调用 SSO API
var ssoCalled = false;
function trySSOLogin() {
    var pwdInput = document.querySelector('input[type="password"]');
    if (!pwdInput || !pwdInput.value) return;

    // 查找学号/工号输入框：排除学校名称（含"大学"/"学院"等关键字）
    var unameInput = null;
    var candidates = document.querySelectorAll('input[type="text"], input[type="tel"], input:not([type])');
    for (var i = candidates.length - 1; i >= 0; i--) {
        var inp = candidates[i];
        if (inp === pwdInput) continue;
        var v = (inp.value || '').trim();
        if (!v || v.length < 3) continue;
        if (/大学|学院|学校|中学|小学|幼儿园|职业技术|校区/.test(v)) continue;
        if (/^[一-龥]+$/.test(v) && v.length > 4) continue;
        unameInput = inp;
        break;
    }
    if (!unameInput || !unameInput.value) return;
    ssoCalled = true;

    var username = unameInput.value;
    var password = pwdInput.value;
    ipcRenderer.send('xxt-debug-log', 'SSO: 从DOM读取明文, uid=' + username + ', pwd=' + (password ? '***' : 'empty'));

    // 在 webview 上下文中调用 SSO API（利用浏览器 cookies，keepalive 防止导航中断）
    var body = 'username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
    fetch('https://sso.chaoxing.com/apis/login/userLogin4Uname.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
        keepalive: true,
        credentials: 'include'
    }).then(function(resp) { return resp.json(); })
    .then(function(data) {
        ipcRenderer.send('xxt-debug-log', 'SSO: result=' + data.result + ', errorMsg=' + (data.errorMsg || 'none'));
        if (data.result === 1 && data.msg && data.msg.huanxinId && data.msg.hxToken) {
            ipcRenderer.send('xxt-login-credentials', {
                huanxinId: data.msg.huanxinId,
                hxToken: data.msg.hxToken
            });
            ipcRenderer.send('xxt-debug-log', 'SSO: 凭据获取成功!');
        } else {
            ipcRenderer.send('xxt-debug-log', 'SSO: 未获取到凭据, msg=' + JSON.stringify(data.msg || data).substring(0, 200));
        }
    }).catch(function(err) {
        ipcRenderer.send('xxt-debug-log', 'SSO fetch失败: ' + err.message);
    });

    // 同时发送到主进程作为备用
    ipcRenderer.send('xxt-sso-login', { username: username, password: password });
}

// 拦截所有 XHR/fetch 响应，提取环信凭据
function interceptLoginResponse() {
    function checkAndSend(resp) {
        try {
            // resp.data.xxx 路径
            if (resp && resp.data && resp.data.huanxinId && resp.data.hxToken) {
                ipcRenderer.send('xxt-login-credentials', {
                    huanxinId: resp.data.huanxinId,
                    hxToken: resp.data.hxToken
                });
                return;
            }
            // resp.msg.xxx 路径（fanyapwdreset 等返回）
            if (resp && resp.msg && resp.msg.huanxinId && resp.msg.hxToken) {
                ipcRenderer.send('xxt-login-credentials', {
                    huanxinId: resp.msg.huanxinId,
                    hxToken: resp.msg.hxToken
                });
                return;
            }
        } catch (e) {}
    }

    // 拦截 XMLHttpRequest（请求体 + 响应）
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;
        var url = xhr._url || '';

        // 检测 unitlogin 请求，从 DOM 读取明文密码调用 SSO
        if (url.indexOf('unitlogin') >= 0) {
            trySSOLogin();
        }

        xhr.addEventListener('load', function() {
            try {
                var resp = JSON.parse(xhr.responseText);
                var url2 = xhr._url || '';
                if (url2 && url2.indexOf('png') < 0 && url2.indexOf('jpg') < 0 && url2.indexOf('favicon') < 0) {
                    var dk = resp && resp.data ? Object.keys(resp.data).slice(0, 6).join(',') : (resp ? Object.keys(resp).slice(0, 6).join(',') : 'no-json');
                    ipcRenderer.send('xxt-debug-log', 'XHR ' + url2.substring(0, 100) + ' | keys=' + dk);
                }
                // fanyapwdreset 的 msg 可能包含环信凭据，详细记录
                if (url2 && url2.indexOf('fanyapwdreset') >= 0) {
                    if (resp && resp.msg) {
                        ipcRenderer.send('xxt-debug-log', 'fanyapwdreset msg keys=' + Object.keys(resp.msg).join(',') + ' | hasHx=' + !!(resp.msg.huanxinId));
                        ipcRenderer.send('xxt-debug-log', 'fanyapwdreset msg=' + JSON.stringify(resp.msg).substring(0, 500));
                    } else {
                        ipcRenderer.send('xxt-debug-log', 'fanyapwdreset msg is null, fullResp=' + JSON.stringify(resp).substring(0, 300));
                    }
                }
                if (url2 && url2.indexOf('getToken') >= 0) {
                    ipcRenderer.send('xxt-debug-log', 'getToken resp: ' + JSON.stringify(resp).substring(0, 500));
                    ipcRenderer.send('xxt-gettoken-response', resp);
                }
                checkAndSend(resp);
            } catch (e) {}
        });
        return origSend.apply(this, arguments);
    };
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) { this._url = url; return origXhrOpen.apply(this, arguments); };

    // 拦截 fetch
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
        return origFetch.apply(this, arguments).then(function(response) {
            if (response.ok) {
                var url = typeof input === 'string' ? input : (input && input.url) || '';
                response.clone().json().then(function(resp) {
                    if (url.indexOf('unitlogin') >= 0 || (resp && resp.data && resp.data.huanxinId)) {
                        ipcRenderer.send('xxt-debug-log', 'fetch ' + url.substring(0, 120) + ' | hasData=' + !!(resp && resp.data));
                    }
                    checkAndSend(resp);
                }).catch(function() {});
            }
            return response;
        });
    };
}
interceptLoginResponse();

// 从 localStorage 读取环信凭据（兜底方案）
function extractFromStorage() {
    try {
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            var v = localStorage.getItem(k);
            try {
                var parsed = JSON.parse(v);
                if (parsed && parsed.huanxinId && parsed.hxToken) {
                    ipcRenderer.send('xxt-login-credentials', { huanxinId: parsed.huanxinId, hxToken: parsed.hxToken });
                    return;
                }
            } catch (e) {}
        }
    } catch (e) {}
}

function checkAndSend(data) {
    try {
        if (data && data.data && data.data.huanxinId && data.data.hxToken) {
            ipcRenderer.send('xxt-login-credentials', { huanxinId: data.data.huanxinId, hxToken: data.data.hxToken });
        } else if (data && data.huanxinId && data.hxToken) {
            ipcRenderer.send('xxt-login-credentials', { huanxinId: data.huanxinId, hxToken: data.hxToken });
        }
    } catch (e) {}
}

var api = {
    extractCredentials: function() { extractFromStorage(); },
    closeLoginWindow: function() {},
    loginComplete: function(data) { checkAndSend(data); },
    showLoginWindow: function() {},
    refresh: function() {},
    resizeLoginWindow: function(w, h) {},
    getLoginWindowSize: function() { return { width: 420, height: 610 }; },
    sendMessage: function(msg) {},
    setTitle: function(title) {}
};

var rendererHelper = {
    showMessage: function(msg) {},
    closeWindow: function() {},
    reload: function() {},
    setCookie: function(key, value) {},
    getCookie: function(key) { return ''; }
};

var jsbridgeApi = {
    call: function(method, params) { checkAndSend(params); },
    on: function(event, callback) {},
    postMessage: function(msg) { checkAndSend(msg); }
};

var cxstudyApi = {
    getVersion: function() { return '1.4.2'; },
    getDeviceInfo: function() { return { os: 'windows', arch: 'x64', osVersion: '10.0.26200' }; },
    loginSuccess: function(data) { checkAndSend(data); }
};

// contextIsolation:false 时直接用 window 暴露（兼容 contextIsolation:true 的 webview）
try {
    contextBridge.exposeInMainWorld('MainWindowHelper', api);
    contextBridge.exposeInMainWorld('RendererHelper', rendererHelper);
    contextBridge.exposeInMainWorld('jsbridge', jsbridgeApi);
    contextBridge.exposeInMainWorld('cxstudy', cxstudyApi);
} catch (e) {
    window.MainWindowHelper = api;
    window.RendererHelper = rendererHelper;
    window.jsbridge = jsbridgeApi;
    window.cxstudy = cxstudyApi;
}