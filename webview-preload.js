// webview-preload.js — 在 webview 进程中运行，拦截 window.open / goTest / downloadFile
(function() {
    'use strict';
    if (window.__wvPreloaded) return;
    window.__wvPreloaded = 1;

    var BT = String.fromCharCode(96);
    function cleanUrl(u) {
        if (!u) return u;
        return u.replace(/%60/gi, '').split(BT).join('');
    }

    // 1. 永久 patch window.open（在任何页面脚本执行前生效）
    var _origOpen = window.open;
    window.open = function(url, target, features) {
        if (url && typeof url === 'string') {
            if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
                console.log('[WebViewNewTab]' + url);
                return null;
            }
            if (url.indexOf('blob:') === 0) {
                console.log('[WebViewDownload]' + url);
                return null;
            }
        }
        return _origOpen.apply(window, arguments);
    };

    // 2. 拦截 target="_blank" 链接点击
    document.addEventListener('click', function(e) {
        var a = e.target.closest('a');
        if (!a || !a.href) return;
        var u = a.href;
        if (u.indexOf('blob:') === 0) {
            e.preventDefault(); e.stopPropagation();
            console.log('[WebViewDownload]' + u);
            return;
        }
        if (a.target === '_blank') {
            u = cleanUrl(u.indexOf('http') === 0 ? u : a.getAttribute('href'));
            if (u && u.indexOf('http') === 0) {
                e.preventDefault(); e.stopPropagation();
                console.log('[WebViewNewTab]' + u);
            }
        }
    }, true);

    // 3. DOM 就绪后轮询 patch goTest 和 downloadFile
    function startPolling() {
        var count = 0;
        var id = setInterval(function() {
            count++;
            try {
                // patch downloadFile
                if (typeof downloadFile === 'function' && !downloadFile.__patched) {
                    downloadFile.__patched = true;
                    var _origDf = downloadFile;
                    downloadFile = function(a1, a2) {
                        try {
                            var fi = null, ae = '';
                            if (a1 && a1.getAttribute) {
                                var rid = a1.getAttribute('resid');
                                if (rid && typeof fileInfoMap !== 'undefined' && fileInfoMap.get) fi = fileInfoMap.get(rid);
                                ae = a1.getAttribute('auditRecordIdEnc') || '';
                            }
                            if (!fi && typeof a1 === 'string' && typeof fileInfoMap !== 'undefined') {
                                if (fileInfoMap.get) fi = fileInfoMap.get(a1);
                                if (!fi && fileInfoMap.forEach) {
                                    var di = a1.lastIndexOf('.');
                                    var nn = di > 0 ? a1.substring(0, di) : a1;
                                    fileInfoMap.forEach(function(v) {
                                        if (!fi && (v.name === a1 || v.encryptedId === a1 || v.name === nn || v.encryptedId === nn || (v.encryptedId && a1.indexOf(v.encryptedId) === 0))) fi = v;
                                    });
                                }
                            }
                            if (fi && fi.type !== 2) {
                                var p = location.port == 80 || location.port == '' ? '' : ':' + location.port;
                                var px = typeof visitPrefix !== 'undefined' ? visitPrefix : '';
                                var sh = typeof isSharePan !== 'undefined' ? isSharePan : false;
                                var u = location.protocol + '//' + location.hostname + p + '/' + px + (sh ? 'newpcsharepan/downloadFileV2' : 'download/downloadFileV2');
                                var ps = 'fleid=' + encodeURIComponent(fi.id) + '&puid=' + encodeURIComponent(fi.puid || '') + '&currentFolderId=' + encodeURIComponent(typeof currentFolderId !== 'undefined' ? currentFolderId : '') + '&p_auth_token=' + encodeURIComponent(typeof p_auth_token !== 'undefined' ? p_auth_token : '') + '&encryptedId=' + encodeURIComponent(fi.encryptedId || '') + '&auditRecordIdEnc=' + encodeURIComponent(ae);
                                console.log('[WebViewDownload]' + u + '?' + ps);
                                return;
                            }
                            return _origDf.apply(this, arguments);
                        } catch(e) { return _origDf.apply(this, arguments); }
                    };
                }

                // patch goTest（拦截超星考试链接）
                if (typeof goTest === 'function' && !goTest.__patched) {
                    goTest.__patched = true;
                    var _origGt = goTest;
                    goTest = function() {
                        var _s = window.open;
                        window.open = function(url) {
                            if (url && typeof url === 'string' && (url.indexOf('http://') === 0 || url.indexOf('https://') === 0))
                                console.log('[WebViewNewTab]' + url);
                            return null;
                        };
                        try { _origGt.apply(this, arguments); } catch(e) {}
                        window.open = _s;
                    };
                }

                // patch toExamNotesAction（goTest 内部调用的函数）
                if (typeof toExamNotesAction === 'function' && !toExamNotesAction.__patched) {
                    toExamNotesAction.__patched = true;
                    var _origTea = toExamNotesAction;
                    toExamNotesAction = function() {
                        var _s = window.open;
                        window.open = function(url) {
                            if (url && typeof url === 'string' && (url.indexOf('http://') === 0 || url.indexOf('https://') === 0))
                                console.log('[WebViewNewTab]' + url);
                            return null;
                        };
                        try { _origTea.apply(this, arguments); } catch(e) {}
                        window.open = _s;
                    };
                }
            } catch(e) {}

            if (count >= 60) clearInterval(id);
        }, 200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startPolling);
    } else {
        startPolling();
    }
})();