// n:\app\js\chaoxing.js
// 超星学习通皮肤 — SVG 图标（来源 chaoxing.html）+ DOM 注入

(function () {
  'use strict';

  var SVG_SPRITE =
    '<svg id="cx-svg-icons" xmlns="http://www.w3.org/2000/svg" xmlns:link="http://www.w3.org/1999/xlink" style="position:absolute;width:0;height:0;">' +

    '<symbol fill="currentColor" viewBox="0 0 13 14" id="cx-icon-search">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M1.896 6.458a4.063 4.063 0 1 1 8.125 0 4.063 4.063 0 0 1-8.125 0Zm4.062-5.146a5.146 5.146 0 1 0 3.383 9.024l2.133 2.133a.542.542 0 0 0 .766-.766l-2.162-2.161a5.146 5.146 0 0 0-4.12-8.23Z"/>' +
    '</symbol>' +

    '<symbol fill="currentColor" viewBox="0 0 16 16" id="cx-icon-note">' +
      '<path d="M13.34 3.07a1.71 1.71 0 0 0-.763-.869l.508-.65a.568.568 0 1 1 .895.7l-.64.819Z"/>' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M9.641 7.84a.59.59 0 0 1-.93-.726l3.847-4.923a1.696 1.696 0 0 0-.804-.201H3.371c-.941 0-1.704.763-1.704 1.704v9.268c0 .94.763 1.704 1.704 1.704h8.383c.941 0 1.705-.763 1.705-1.704V3.694c0-.212-.04-.414-.11-.601L9.642 7.84Zm-5.19 3.583a.426.426 0 0 0-.426.426v.032c0 .236.19.426.426.426h5.634c.235 0 .425-.19.425-.426v-.032a.426.426 0 0 0-.425-.426H4.45Zm-.426-1.637c0-.236.19-.426.426-.426h2.686c.235 0 .426.19.426.426v.032c0 .235-.191.426-.426.426H4.45a.426.426 0 0 1-.426-.426v-.032Z"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 16 16" id="cx-icon-home">' +
      '<path d="M15.337 7.998 8.007.666.665 7.998a.32.32 0 0 0 .452.453l1.257-1.255v7.048c0 .529.428.957.957.957h2.295a.957.957 0 0 0 .957-.957v-2.948c0-.175.142-.317.317-.317h2.345c.175 0 .317.142.317.317v2.948c0 .529.429.957.958.957h2.151a.957.957 0 0 0 .958-.957v-7.05l1.256 1.256a.32.32 0 1 0 .453-.452Z" fill="currentColor"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 16 16" id="cx-icon-message">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M2.667 1.667C1.747 1.667 1 2.413 1 3.333v6c0 .807.573 1.48 1.333 1.634v-6.3c0-.737.597-1.334 1.334-1.334H13c0-.92-.746-1.666-1.667-1.666H2.667Zm8.333 12L9.967 14.7a.424.424 0 0 1-.6 0l-1.034-1.033H4.667a1.333 1.333 0 0 1-1.334-1.334V5.667c0-.737.597-1.334 1.334-1.334H14c.736 0 1.333.597 1.333 1.334v6.666c0 .737-.597 1.334-1.333 1.334h-3Zm-3.667-4.5a.833.833 0 1 1-1.666 0 .833.833 0 0 1 1.666 0Zm3 0a.833.833 0 1 1-1.666 0 .833.833 0 0 1 1.666 0ZM12.5 10a.833.833 0 1 0 0-1.667.833.833 0 0 0 0 1.667Z" fill="currentColor"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 16 16" id="cx-icon-class">' +
      '<path d="M7.476 1.145c.311-.119.655-.12.968-.004l5.996 2.228c1.209.449 1.187 2.166-.032 2.585L8.353 8.033c-.285.098-.593.099-.879.004L1.48 6.044C.255 5.637.217 3.92 1.422 3.459l6.054-2.314Z" fill="currentColor"/>' +
      '<path d="M3 7.55v4.283c0 1.184.96 2.143 2.143 2.143h5.714c1.184 0 2.143-.96 2.143-2.143V7.437L8.353 9.033c-.285.098-.593.099-.879.004L3 7.55ZM15.333 7.667a.667.667 0 1 0-1.333 0v3a.667.667 0 0 0 1.333 0v-3Z" fill="currentColor"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 16 16" id="cx-icon-cloud_disk">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M13.09 13.55a2.545 2.545 0 1 0 .718-5.04 2.364 2.364 0 0 0-2.912-2.504 3.637 3.637 0 0 0-7.26.297 3.636 3.636 0 0 0 0 7.273h9.455v-.026Z" fill="currentColor"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 16 16" id="cx-icon-group">' +
      '<path d="M10.413 7.7a3.73 3.73 0 1 0-6.264-1.763 3.917 3.917 0 0 1 4.542 2.742 3.712 3.712 0 0 0 1.722-.979Z" fill="currentColor"/>' +
      '<path d="M6.078 6.807a3.73 3.73 0 1 0 1.417 5.983 3.917 3.917 0 0 1 .174-4.804c-.4-.513-.94-.927-1.59-1.18Z" fill="currentColor"/>' +
      '<path d="M11.89 14.051a3.73 3.73 0 0 1-4.21-4.69 3.92 3.92 0 0 0 4.261-2.657 3.731 3.731 0 0 1-.051 7.347Z" fill="currentColor"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 16 16" id="cx-icon-setting">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.143 9.31c.246.133.323.449.197.803-.009.029-.246.692-.525 1.162-.279.472-.748 1.002-.768 1.024-.252.284-.572.378-.811.235l-.051-.028c-.833-.47-1.897-.201-2.37.599-.157.264-.197.627-.197.63a.759.759 0 0 1-.7.662l-.021.003-1.943-.049-.019-.002a.82.82 0 0 1-.306-.102.856.856 0 0 1-.417-.535c-.068-.292-.35-1.11-.819-1.374-.466-.263-1.342-.095-1.613-.013a.895.895 0 0 1-.925-.3l-.01-.015-.974-1.568-.01-.018a.742.742 0 0 1 .241-.924c.002 0 .304-.216.46-.48.473-.8.18-1.834-.654-2.304l-.06-.033c-.239-.135-.313-.448-.188-.798l.004-.012c.035-.096.26-.707.52-1.15.28-.47.75-1.001.77-1.024.251-.284.571-.377.811-.234l.05.028c.835.47 1.898.202 2.371-.598.153-.258.195-.61.197-.63v-.001a.76.76 0 0 1 .701-.662l.02-.002 1.975.055.02.003a.82.82 0 0 1 .307.103c.21.118.366.314.42.525.072.278.36 1.061.816 1.318.451.255 1.281.114 1.563.039a.907.907 0 0 1 .918.305l.01.016.996 1.593.01.02a.739.739 0 0 1-.24.922c-.002.002-.304.217-.46.481-.474.8-.18 1.833.653 2.302l.051.029Zm-8.066-2.4c-.602 1.019-.23 2.335.832 2.933 1.062.598 2.417.255 3.019-.763.603-1.02.23-2.334-.832-2.932-1.062-.598-2.416-.256-3.02.763Z" fill="currentColor"/>' +
    '</symbol>' +

    '<symbol fill="currentColor" viewBox="0 0 16 16" id="cx-icon-appearance">' +
      '<path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.854 2.56 2.207 10.207a1 1 0 0 0-.27.5l-.736 3.793a.5.5 0 0 0 .586.586l3.793-.738a1 1 0 0 0 .5-.27L13.5 6.207z"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 10 10" id="cx-icon-arrow_l">' +
      '<path d="M1.951 5.655a.833.833 0 0 1 .013-1.265L6.026.98a.625.625 0 0 1 1.027.48v7.282a.625.625 0 0 1-1.037.47L1.951 5.655Z" fill="#D8D3E0"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 12 12" id="cx-icon-mini">' +
      '<path d="M1 6h10" stroke="currentColor" stroke-opacity=".7" stroke-width="1.3" stroke-linecap="round"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 12 12" id="cx-icon-mix">' +
      '<path d="M1.5 2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7Z" stroke="currentColor" stroke-opacity=".7" stroke-width="1.3"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 12 12" id="cx-icon-main_close">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M10.041 2.93a.65.65 0 0 0-.919-.919L5.974 5.159 2.96 2.144a.65.65 0 1 0-.92.92l3.015 3.014-3.044 3.044a.65.65 0 1 0 .92.92l3.043-3.045 3.177 3.177a.65.65 0 0 0 .92-.92L6.894 6.079 10.04 2.93Z" fill="currentColor" fill-opacity=".7"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 18 18" id="cx-icon-download">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M2.152 9a6.85 6.85 0 1 1 13.7 0 6.85 6.85 0 0 1-13.7 0ZM9.002.85a8.15 8.15 0 1 0 0 16.3 8.15 8.15 0 0 0 0-16.3Zm-.003 4.125a.65.65 0 0 1 .65.65v5.37l1.893-1.893a.65.65 0 0 1 .92.92l-3 3a.648.648 0 0 1-.454.19h-.01a.648.648 0 0 1-.495-.229l-2.961-2.961a.65.65 0 0 1 .92-.92l1.887 1.888V5.625a.65.65 0 0 1 .65-.65Z" fill="#fff" fill-opacity=".7"/>' +
    '</symbol>' +

    '<symbol fill="none" viewBox="0 0 14 14" id="cx-icon-add">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M7 13.417A6.417 6.417 0 1 0 7 .583a6.417 6.417 0 0 0 0 12.834Zm0-3.209a.583.583 0 0 1-.583-.583V7.583H4.375a.583.583 0 1 1 0-1.166h2.042V4.375a.583.583 0 1 1 1.167 0v2.042h2.041a.583.583 0 1 1 0 1.166H7.584v2.042a.583.583 0 0 1-.584.583Z" fill="#fff" fill-opacity=".7"/>' +
    '</symbol>' +

    '</svg>';

  function spriteIcon(id, w, h, color) {
    var size = w || 16;
    return '<svg class="svg-icon" aria-hidden="true" style="width:' + size + 'px;height:' + (h || size) + 'px;--color:' + (color || '#ACB4BF') + ';">' +
      '<use xlink:href="#cx-icon-' + id + '"></use></svg>';
  }

  window.initChaoxingSkinDOM = function () {
    var cx = window.__cx;
    if (!cx) return;

    var body = document.body;

    // 注入 SVG 精灵
    var div = document.createElement('div');
    div.innerHTML = SVG_SPRITE;
    body.appendChild(div.firstElementChild);

    // ===== 标题栏（静态 DOM，innerHTML 填充）=====
    var tb = document.getElementById('cx-titlebar');
    if (!tb) return;
    tb.innerHTML =
      '<div class="cx-tb-search">' +
        '<div class="cx-search-input-wrap">' +
          '<input type="text" placeholder="找资料" readonly class="cx-search-input">' +
          '<span class="cx-search-prefix">' + spriteIcon('search', 13, 13, '#fff') + '</span>' +
        '</div>' +
        '<div class="cx-search-btn">' +
          spriteIcon('add', 14, 14, '#ACB4BF') +
          '<span class="cx-search-btn-text">邀请码</span>' +
        '</div>' +
      '</div>' +
      '<div class="cx-tb-download">' +
        '<div class="cx-tb-dl-btn" title="下载中心">' + spriteIcon('download', 18, 18, '#FFFFFFB2') + '</div>' +
      '</div>' +
      '<div class="cx-tb-btns">' +
        '<div class="cx-tb-btn">' + spriteIcon('mini', 12, 12, '#c1c5cd') + '</div>' +
        '<div class="cx-tb-btn">' + spriteIcon('mix', 12, 12, '#c1c5cd') + '</div>' +
        '<div class="cx-tb-btn cx-close">' + spriteIcon('main_close', 12, 12, '#c1c5cd') + '</div>' +
      '</div>';
    (document.getElementById('app') || body).prepend(tb);

    var ctrlBtns = tb.querySelectorAll('.cx-tb-btns .cx-tb-btn');
    if (ctrlBtns[0]) ctrlBtns[0].onclick = function () { window.electronAPI && window.electronAPI.minimize(); };
    if (ctrlBtns[1]) ctrlBtns[1].onclick = function () { window.electronAPI && window.electronAPI.maximize(); };
    if (ctrlBtns[2]) ctrlBtns[2].onclick = function () { window.electronAPI && window.electronAPI.close(); };

    var searchInput = tb.querySelector('.cx-search-input');
    if (searchInput) searchInput.onclick = function () { cx.switchPage('search'); };

    var dlBtn = tb.querySelector('.cx-tb-dl-btn');
    if (dlBtn) dlBtn.onclick = function () { cx.switchPage('downloads'); };

    // ===== 侧边栏（静态 DOM，innerHTML 填充）=====
    var uname = (cx.userInfo && cx.userInfo.username) ? cx.userInfo.username : '';
    var nav = [
      { key: 'home',       label: '首页',   ico: 'home' },
      { key: 'message',    label: '消息',   ico: 'message' },
      { key: 'note',       label: '笔记',   ico: 'note' },
      { key: 'class',      label: '课程',   ico: 'class' },
      { key: 'cloud',      label: '云盘',   ico: 'cloud_disk' },
      { key: 'group',      label: '小组',   ico: 'group' },
      { key: 'appearance', label: '个性化', ico: 'appearance' },
      { key: 'setting',    label: '设置',   ico: 'setting' }
    ];

    var navHtml = nav.map(function (item, i) {
      var hiddenStyle = (item.key === 'appearance' && localStorage.getItem('chaoxingAppearanceTab') === 'false') ? ' style="display:none;"' : '';
      return '<div class="cx-nav-item' + (i === 0 ? ' active' : '') + (item.key === 'setting' ? ' cx-nav-item-setting' : '') + '" data-key="' + item.key + '"' + hiddenStyle + '>' +
        '<span class="cx-nav-icon">' + spriteIcon(item.ico) + '</span>' +
        '<span class="cx-nav-label">' + item.label + '</span></div>';
    }).join('');

    var sd = document.getElementById('sidebar');
    if (!sd) return;
    sd.innerHTML =
      '<div class="cx-avatar">' +
        '<div class="cx-avatar-img"><img src="' + (cx.avatar || '') + '" onerror="this.style.display=\'none\'"></div>' +
        '<div class="cx-avatar-name">' + (uname || '未登录') + '</div>' +
      '</div>' +
      '<div class="cx-nav">' + navHtml + '</div>' +
      '<div class="cx-collapse-zone"><div class="cx-collapse-btn">' + spriteIcon('arrow_l', 8) + '</div></div>';

    // ===== 导航 =====
    var xxtUrls = {
      message: 'https://message.chaoxing.com/',
      class: 'https://mooc2-ans.chaoxing.com/visit/interaction',
      note:  'https://groupyd2.chaoxing.com/pc/activity/activityList',
      cloud: 'https://pan-yz.chaoxing.com/pcuserpan/index'
    };
    var xxtKeys = ['message', 'class', 'note', 'cloud'];

    sd.querySelectorAll('.cx-nav-item').forEach(function (item) {
      item.onclick = function () {
        sd.querySelectorAll('.cx-nav-item').forEach(function (el) { el.classList.remove('active'); var s = el.querySelector('svg'); if (s) { s.style.color = ''; s.style.fill = ''; } });
        item.classList.add('active');
        var s = item.querySelector('svg'); if (s) { s.style.color = '#ffffff'; s.style.fill = '#ffffff'; }
        var key = item.dataset.key;
        if (key === 'home') cx.switchPage('home');
        else if (key === 'group') cx.switchPage('mmd');
        else if (key === 'appearance') cx.switchPage('appearance');
        else if (key === 'setting') cx.switchPage('settings');
        else if (xxtKeys.indexOf(key) >= 0) {
          cx.switchPage('xxt');
          setTimeout(function () {
            var url = xxtUrls[key];
            var tabs = cx.getXxtTabs();
            var tab = tabs.find(function (t) { return t.url === url; });
            if (tab) cx.activateXxtTab(tab.id);
          }, 400);
        }
      };
    });

    // ===== 折叠 =====
    var collapseBtn = document.querySelector('#sidebar .cx-collapse-btn');
    if (collapseBtn) {
      collapseBtn.onclick = function (e) {
        e.stopPropagation();
        sd.classList.toggle('cx-collapsed');
      };
    }

    // 显式触发学习通信息卡数据填充
    if (cx.loadLearningInfo) {
      setTimeout(function () { cx.loadLearningInfo(); }, 1000);
    }
  };

})();