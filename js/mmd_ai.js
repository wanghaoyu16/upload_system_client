// ===== MMD 模型 AI 对话模块 =====
// 每个 MMD 模型拥有独立的 AI 对话能力
// 存储路径: mmd/blobs/[model_id]/ai_chat.json
//                          /ai_chat_old_N.json
//                          /ai_config.json

const _eb = document.createElement('div');
function _esc(s) { _eb.textContent = s || ''; return _eb.innerHTML; }

function _renderMD(text) {
  if (!text) return '';
  var t = _esc(text);
  t = t.replace(/```([\s\S]*?)```/g, '<div class="mmd-ai-code-wrap"><pre><code>$1</code></pre><span class="mmd-ai-code-copy" title="复制"><i class="fa-solid fa-copy"></i></span></div>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  t = t.replace(/\*(.+?)\*/g, '<i>$1</i>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  var lines = t.split(/\n/);
  var out = '';
  var inUl = false, inOl = false, inTable = false;
  var tableHtml = '';
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln) {
      if (inTable) { out += tableHtml + '</tbody></table>'; inTable = false; tableHtml = ''; }
      if (inUl) { out += '</ul>'; inUl = false; }
      if (inOl) { out += '</ol>'; inOl = false; }
      out += '<br>'; continue;
    }
    var tableRow = ln.match(/^\|(.+)\|$/);
    var sepRow = ln.match(/^\|[\s\-:\|]+\|$/);
    if (sepRow && (out.endsWith('<br>') || out === '' || inTable)) {
      if (!inTable) {
        var prevCells = (tableHtml.match(/<th>/g) || []).length;
        if (prevCells > 0) { inTable = true; }
      }
      continue;
    }
    if (tableRow && (inTable || (i + 1 < lines.length && /^\|[\s\-:\|]+\|$/.test(lines[i+1].trim())))) {
      if (!inTable) {
        if (inUl) { out += '</ul>'; inUl = false; }
        if (inOl) { out += '</ol>'; inOl = false; }
        tableHtml = '<table class="mmd-ai-table"><tbody>';
      }
      var cells = ln.slice(1, -1).split('|').map(function(c) { return c.trim(); });
      var isHeader = !inTable;
      var tag = isHeader ? 'th' : 'td';
      tableHtml += '<tr>' + cells.map(function(c) { return '<' + tag + '>' + c + '</' + tag + '>'; }).join('') + '</tr>';
      inTable = true;
      continue;
    }
    if (inTable) { out += tableHtml + '</tbody></table><br>'; inTable = false; tableHtml = ''; }
    var ulMatch = ln.match(/^-\s(.+)$/);
    var olMatch = ln.match(/^(\d+)\.\s(.+)$/);
    if (ulMatch) {
      if (inOl) { out += '</ol>'; inOl = false; }
      if (!inUl) { out += '<ul style="margin:4px 0;padding-left:18px;">'; inUl = true; }
      out += '<li>' + ulMatch[1] + '</li>';
    } else if (olMatch) {
      if (inUl) { out += '</ul>'; inUl = false; }
      if (!inOl) { out += '<ol style="margin:4px 0;padding-left:18px;">'; inOl = true; }
      out += '<li>' + olMatch[2] + '</li>';
    } else {
      if (inUl) { out += '</ul>'; inUl = false; }
      if (inOl) { out += '</ol>'; inOl = false; }
      out += ln + '<br>';
    }
  }
  if (inTable) out += tableHtml + '</tbody></table>';
  if (inUl) out += '</ul>';
  if (inOl) out += '</ol>';
  return out;
}

const DEFAULT_AI_CONFIG = {
  enabled: false,
  sessionName: '新对话',
  personality: '',
  base_url: '',
  api_key: '',
  maxCallbackRounds: 5,
  modelName: 'deepseek-chat',
  opacity: 1.0
};

const AI_TOOLS = [
  { name: 'get_page_data', desc: '获取当前页面内所有按钮、标题、文本元素的信息（不包括CSS和JSON），自动识别可交互元素', params: {} },
  { name: 'click_page_button', desc: '点击页面上指定选择器的按钮元素', params: { selector: { type: 'string', desc: 'CSS选择器定位目标按钮' } } },
  { name: 'set_input_text', desc: '更改页面上指定文本框的内容', params: { selector: { type: 'string', desc: 'CSS选择器' }, text: { type: 'string', desc: '新文本' } } },
  { name: 'set_slider_value', desc: '更改页面上指定滑动条的值', params: { selector: { type: 'string', desc: 'CSS选择器' }, value: { type: 'number', desc: '数值' } } },
  { name: 'switch_tab', desc: '切换当前页面到指定的选项卡', params: { tab_name: { type: 'string', desc: '选项卡名称' } } },
  { name: 'close_window', desc: '关闭当前活动窗口', params: {} },
  { name: 'search_element', desc: '搜索页面上包含指定文本的元素，返回所有匹配元素信息', params: { keyword: { type: 'string', desc: '要搜索的关键词文本' } } },
  { name: 'get_browser_page_data', desc: '获取当前浏览器/学习通页面内所有元素（包括div/span/li等任意HTML元素），返回tag、文本、CSS选择器，仅在浏览器或学习通页面可用。支持keyword参数按文本关键词过滤', params: { keyword: { type: 'string', desc: '可选，只返回文本包含此关键词的元素（如"第1题"、"单选题"），留空返回所有' } } },
  { name: 'click_browser_element', desc: '使用任意CSS选择器点击浏览器/学习通页面内部元素（支持div、span等，不限于按钮），仅在浏览器或学习通页面可用', params: { selector: { type: 'string', desc: '任意CSS选择器（如 div.clearfix, span.option, input[name=q1][value=D]）' } } }
];

let _aiChatWindows = {};
let _hoverInputEl = null;
let _currentHoverModelId = null;
let _aiEnabledModels = {};
let _bubbleTimers = {};
let _aiStoreMap = {};

function _aiRead(id, file, isAi) {
  if (isAi) return window.electronAPI.mmdAiReadFile({ id, file });
  return window.electronAPI.mmdReadAI({ id, file });
}
function _aiWrite(id, file, content, isAi) {
  if (isAi) return window.electronAPI.mmdAiWriteFile({ id, file, content });
  return window.electronAPI.mmdWriteAI({ id, file, content });
}
function _aiIsProject(id) { return _aiStoreMap[id] === 'ai_images'; }

// ===== 存储 =====
async function loadAIConfig(modelId) {
  try {
    const isAi = _aiIsProject(modelId);
    const raw = await _aiRead(modelId, 'ai_config.json', isAi);
    if (raw) { const cfg = JSON.parse(raw); return { ...DEFAULT_AI_CONFIG, ...cfg }; }
  } catch (e) { /* silent */ }
  return { ...DEFAULT_AI_CONFIG };
}
async function saveAIConfig(modelId, config) {
  try {
    const isAi = _aiIsProject(modelId);
    await _aiWrite(modelId, 'ai_config.json', JSON.stringify(config, null, 2), isAi);
    _aiEnabledModels[modelId] = config.enabled;
    return true;
  } catch (e) { return false; }
}
async function loadChatHistory(modelId) {
  try {
    const isAi = _aiIsProject(modelId);
    const raw = await _aiRead(modelId, 'ai_chat.json', isAi);
    const msgs = raw ? JSON.parse(raw) : [];
    console.log('[AI DIAG] loadChatHistory modelId=' + modelId + ' count=' + msgs.length + ' rawLen=' + (raw ? raw.length : 0));
    return msgs;
  } catch (e) { console.warn('[AI DIAG] loadChatHistory ERROR:', e.message); return []; }
}
async function saveChatHistory(modelId, messages) {
  try {
    const isAi = _aiIsProject(modelId);
    const content = JSON.stringify(messages, null, 2);
    await _aiWrite(modelId, 'ai_chat.json', content, isAi);
    console.log('[AI DIAG] saveChatHistory modelId=' + modelId + ' count=' + messages.length + ' size=' + content.length);
    return true;
  } catch (e) { console.warn('[AI DIAG] saveChatHistory ERROR:', e.message); return false; }
}
async function resetChatHistory(modelId) {
  try {
    const isAi = _aiIsProject(modelId);
    const oldMessages = await loadChatHistory(modelId);
    if (!oldMessages.length) return true;
    let idx = 1;
    for (; idx < 100; idx++) {
      try { const d = await _aiRead(modelId, 'ai_chat_old_' + idx + '.json', isAi); if (!d) break; } catch (e) { break; }
    }
    await _aiWrite(modelId, 'ai_chat_old_' + idx + '.json', JSON.stringify(oldMessages, null, 2), isAi);
    await _aiWrite(modelId, 'ai_chat.json', '[]', isAi);
    return true;
  } catch (e) { return false; }
}

// ===== 工具执行 =====
function _isOnBrowserPage() {
  var c = document.getElementById('xxt-webview-container');
  if (c && c.style.display !== 'none') return true;
  var ap = document.querySelector('.page-visible, [data-page].active');
  if (ap) { var p = ap.dataset.page || ap.id || ''; if (p === 'xxt' || p === 'browser') return true; }
  return false;
}
function _getBrowserWebview() {
  var activeTab = document.querySelector('.xxt-tab.active, .browser-tab.active');
  if (activeTab) {
    var tabId = activeTab.dataset.id;
    if (tabId) {
      var wv = document.getElementById('xxt-webview-' + tabId);
      if (wv && wv.offsetParent !== null) return wv;
    }
  }
  var wvs = document.querySelectorAll('webview');
  for (var i = 0; i < wvs.length; i++) { if (wvs[i].offsetParent !== null) return wvs[i]; }
  return wvs.length > 0 ? wvs[0] : null;
}

async function executeTool(name, args) {
  const r = { success: false, message: '', data: null };
  try {
    switch (name) {
      case 'get_page_data': {
        const els = [];
        const seen = new Set();
        document.querySelectorAll('button, [role="button"], .btn, [onclick], input[type="button"], input[type="submit"], h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], label, input[type="text"]:not([type="hidden"]), input[type="number"], input[type="range"], textarea, select, [contenteditable="true"], .sidebar-btn, .settings-tab, .tab-btn').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0) return;
          const tag = el.tagName.toLowerCase();
          const type = el.type || '';
          const txt = (el.textContent || el.value || el.placeholder || el.title || '').trim().substring(0, 120);
          const id = el.id || '';
          const cls = (typeof el.className === 'string' ? el.className : '').substring(0, 80);
          let sel = '';
          if (id) sel = '#' + CSS.escape(id);
          else if (cls) sel = tag + '.' + cls.split(/\s+/)[0].replace(/:/g, '\\:');
          else sel = tag;
          const key = sel + '|' + txt.substring(0, 40);
          if (seen.has(key)) return;
          seen.add(key);
          els.push({ tag, type, text: txt, id, selector: sel, disabled: el.disabled || false });
        });
        r.success = true;
        r.message = '获取到 ' + els.length + ' 个页面元素';
        r.data = els.slice(0, 80);
        break;
      }
      case 'click_page_button': {
        const sel = (args.selector || '').trim();
        if (!sel) { r.message = '未提供选择器'; break; }
        const el = document.querySelector(sel);
        if (!el) { r.message = '未找到元素: ' + sel; break; }
        el.focus();
        el.click();
        ['mousedown', 'mouseup', 'click'].forEach(t => {
          el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        });
        r.success = true;
        r.message = '已点击: ' + sel;
        break;
      }
      case 'set_input_text': {
        const sel = (args.selector || '').trim();
        const txt = args.text != null ? String(args.text) : '';
        if (!sel) { r.message = '未提供选择器'; break; }
        const el = document.querySelector(sel);
        if (!el) { r.message = '未找到元素: ' + sel; break; }
        const desc = Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
        );
        if (desc && desc.set) { desc.set.call(el, txt); } else { el.value = txt; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        r.success = true;
        r.message = '已设置文本: ' + sel;
        break;
      }
      case 'set_slider_value': {
        const sel = (args.selector || '').trim();
        const val = args.value;
        if (!sel) { r.message = '未提供选择器'; break; }
        const el = document.querySelector(sel);
        if (!el) { r.message = '未找到元素: ' + sel; break; }
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) { desc.set.call(el, String(val)); } else { el.value = val; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        r.success = true;
        r.message = '已设置滑动条: ' + sel + ' = ' + val;
        break;
      }
      case 'switch_tab': {
        const tn = (args.tab_name || '').trim();
        if (!tn) { r.message = '未提供选项卡名称'; break; }
        let found = false;
        document.querySelectorAll('[data-page], .sidebar-btn, .settings-tab, .tab-btn, button').forEach(b => {
          if (found) return;
          const dp = b.dataset.page || b.dataset.tab || '';
          const title = (b.title || b.getAttribute('aria-label') || '').toLowerCase();
          const text = (b.textContent || '').trim().toLowerCase();
          const t = tn.toLowerCase();
          if (dp.toLowerCase().includes(t) || title.includes(t) || text.includes(t)) {
            b.click(); found = true;
          }
        });
        r.success = found;
        r.message = found ? '已切换到: ' + tn : '未找到选项卡: ' + tn;
        break;
      }
      case 'close_window':
        if (window.electronAPI && window.electronAPI.close) window.electronAPI.close();
        else window.close();
        r.success = true;
        r.message = '窗口已关闭';
        break;
      case 'search_element': {
        const kw = (args.keyword || '').trim();
        if (!kw) { r.message = '未提供搜索关键词'; break; }
        const matches = [];
        const seen2 = new Set();
        document.querySelectorAll('*').forEach(function(el) {
          if (seen2.has(el)) return;
          var txt = (el.textContent || '').trim();
          if (txt.length > 500) txt = txt.substring(0, 500);
          if (!txt.toLowerCase().includes(kw.toLowerCase())) return;
          var rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          seen2.add(el);
          var tag = el.tagName.toLowerCase();
          var sel = el.id ? '#' + el.id : tag + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '');
          var snippet = txt.length > 100 ? txt.substring(0, 100) + '...' : txt;
          matches.push({ tag: tag, selector: sel.substring(0, 120), text: snippet,
            textarea: el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable,
            visible: rect.bottom > 0 && rect.right > 0
          });
        });
        r.success = true;
        r.message = '找到 ' + matches.length + ' 个包含"' + kw + '"的元素';
        r.data = matches.slice(0, 50);
        break;
      }
      case 'get_browser_page_data': {
        if (!_isOnBrowserPage()) { r.message = '当前不在浏览器或学习通页面'; break; }
        var wv = _getBrowserWebview();
        if (!wv) { r.message = '浏览器视图未加载'; break; }
        var kw = (args.keyword || '').trim();
        try {
          var bdata = await wv.executeJavaScript('(' + function(kw) {
            var els = [];
            var seen = {};
            var skipCls = ['edui', 'subback', 'foldbtn', 'foldbox', 'asflag', 'aschip', 'aslegend', 'assheet', 'colorShallow', 'colorDeep', 'topicNumber', 'sub-button', 'mask'];
            var kwLower = kw ? kw.toLowerCase() : '';
            document.querySelectorAll('button, a, input, textarea, select, [role="button"], [onclick], [class*="btn"], h1, h2, h3, h4, h5, h6, [class*="title"], label, div, span, li, dt, dd, td, th, p, [class*="option"], [class*="item"], [class*="choice"], [class*="answer"]').forEach(function(el) {
              var rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var elTagCheck = el.tagName.toLowerCase();
            if ((elTagCheck === 'button' || elTagCheck === 'input' || elTagCheck === 'a' || elTagCheck === 'select' || elTagCheck === 'textarea') && rect.width > 800) return;
            if (rect.height > 200) return;
              var id = el.id || '';
              var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
              if (id.indexOf('edui') === 0 || id.indexOf('mask') === 0) return;
              for (var si = 0; si < skipCls.length; si++) {
                if (cls.indexOf(skipCls[si]) >= 0) { id = 'SKIP'; break; }
              }
              if (id === 'SKIP') return;
              var tag = el.tagName.toLowerCase();
              var txt = (el.textContent || el.value || el.placeholder || el.title || '').trim();
              if (tag === 'div' || tag === 'span' || tag === 'li' || tag === 'p' || tag === 'td') {
                if (txt.length < 2 || txt.length > 300) return;
                if (el.children.length > 3) return;
              }
              txt = txt.substring(0, 120);
              if (kwLower && txt.toLowerCase().indexOf(kwLower) < 0 && id.toLowerCase().indexOf(kwLower) < 0) return;
              var sel;
              if (id) {
                sel = '#' + CSS.escape(id);
              } else {
                var path = [];
                var cur = el;
                var depth = 0;
                while (cur && cur !== document.body && depth < 6) {
                  var ptag = cur.tagName.toLowerCase();
                  var parent = cur.parentElement;
                  if (!parent) break;
                  var siblings = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === cur.tagName; });
                  var idx = siblings.indexOf(cur) + 1;
                  path.unshift(ptag + ':nth-of-type(' + idx + ')');
                  cur = parent;
                  depth++;
                  var testSel = path.join(' > ');
                  try { if (document.querySelectorAll(testSel).length === 1) break; } catch(ignored) {}
                }
                sel = path.join(' > ') || tag;
              }
              var key = sel + '|' + txt.substring(0, 40);
              if (seen[key]) return;
              seen[key] = true;
              els.push({ tag: tag, type: el.type || '', text: txt, id: id, selector: sel, disabled: el.disabled || false, href: el.href || '' });
            });
            return els.slice(0, 200);
          }.toString() + ')(' + JSON.stringify(kw) + ')');
          r.success = true;
          r.message = '获取到 ' + (bdata ? bdata.length : 0) + ' 个浏览器页面元素';
          r.data = bdata;
        } catch(e) { r.message = '读取浏览器页面失败: ' + e.message; }
        break;
      }
      case 'click_browser_element': {
        if (!_isOnBrowserPage()) { r.message = '当前不在浏览器或学习通页面'; break; }
        var wv2 = _getBrowserWebview();
        if (!wv2) { r.message = '浏览器视图未加载'; break; }
        var sel2 = (args.selector || '').trim();
        if (!sel2) { r.message = '未提供选择器'; break; }
        try {
          var cresult = await wv2.executeJavaScript('(' + function(sel) {
            var el = document.querySelector(sel);
            if (!el) return { found: false };
            el.focus(); el.click();
            return { found: true, tag: el.tagName, text: (el.textContent || '').trim().substring(0, 80) };
          }.toString() + ')(\'' + sel2.replace(/'/g, "\\'") + '\')');
          if (cresult && cresult.found) { r.success = true; r.message = '已点击浏览器元素: ' + sel2; }
          else { r.message = '浏览器页面未找到元素: ' + sel2; }
        } catch(e) { r.message = '点击浏览器元素失败: ' + e.message; }
        break;
      }
      default:
        r.message = '未知工具: ' + name;
    }
  } catch (e) { r.message = '执行错误: ' + e.message; }
  return r;
}

// ===== 提示词构建 =====
function _buildSystemPrompt(config) {
  let p = '[工具与接口\n可使用以下工具操作页面：\n\n';
  AI_TOOLS.forEach(t => {
    p += t.name + ' - ' + t.desc + '\n';
    if (t.params && Object.keys(t.params).length) {
      Object.entries(t.params).forEach(([k, v]) => { p += '  参数 ' + k + ': ' + v.desc + '\n'; });
    }
    p += '\n';
  });
  p += ']\n\n[回复格式要求\n';
  p += '每次必须返回严格JSON格式（不要包含markdown代码块标记）：\n';
  p += '{"reply": "文字回复内容", "tool_calls": [{"name": "工具名", "arguments": {...}}]}\n';
  p += '如无需调用工具，tool_calls可省略或设为空数组[]。\n';
  p += '工具执行结果会以system消息回传给你。\n';
  p += '每次最多调用2个工具。\n';
  p += ']\n\n';
  if (config.personality) {
    p += config.personality + '\n';
  }
  return p;
}

// ===== API 调用 =====
async function _callAI(config, messages, stream, onChunk, signal) {
  if (!config.base_url || !config.api_key) throw new Error('API 配置不完整，请先配置');
  const baseUrl = config.base_url.replace(/\/+$/, '');
  const apiUrl = baseUrl + '/v1/chat/completions';

  const allMessages = [{ role: 'system', content: _buildSystemPrompt(config) }, ...messages];
  const body = {
    model: config.modelName || 'deepseek-chat',
    messages: allMessages,
    stream: !!stream,
    temperature: 0.7,
    max_tokens: 4096
  };

  console.log('[AI DIAG] _callAI REQ url=' + apiUrl + ' model=' + body.model + ' msgCount=' + allMessages.length + ' stream=' + !!stream);
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.api_key },
    body: JSON.stringify(body),
    signal
  });
  console.log('[AI DIAG] _callAI RESP status=' + resp.status + ' ok=' + resp.ok);

  if (!resp.ok) {
    const et = await resp.text().catch(() => '');
    console.warn('[AI DIAG] _callAI ERROR body:', et.substring(0, 300));
    throw new Error('API错误 ' + resp.status + ': ' + et.substring(0, 200));
  }

  if (!stream) {
    const data = await resp.json();
    console.log('[AI DIAG] _callAI non-stream response: choices=' + (data.choices ? data.choices.length : 0) + ' contentLen=' + (data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content.length : 0));
    return { content: data.choices[0].message.content };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith('data: ')) continue;
      const d = t.slice(6);
      if (d === '[DONE]') continue;
      try {
        const parsed = JSON.parse(d);
        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
        if (delta && delta.content) { full += delta.content; if (onChunk) onChunk(delta.content, full); }
      } catch (e) {}
    }
  }
  return { content: full };
}

function _parseAIResponse(content) {
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) {}
  return { reply: content, tool_calls: [] };
}

async function sendMessage(modelId, userMessage, stream, onStreamChunk) {
  console.log('[AI DIAG] sendMessage START modelId=' + modelId + ' msgLen=' + userMessage.length + ' stream=' + !!stream);
  const config = await loadAIConfig(modelId);
  console.log('[AI DIAG] sendMessage config: enabled=' + config.enabled + ' baseUrl=' + (config.base_url ? config.base_url.substring(0, 40) + '...' : 'EMPTY') + ' apiKey=' + (config.api_key ? '***' + config.api_key.slice(-4) : 'EMPTY') + ' model=' + config.modelName);
  if (!config.enabled) return { error: '该模型未启用AI对话' };
  if (!config.base_url || !config.api_key) return { error: '请先配置API地址和密钥' };

  let messages = await loadChatHistory(modelId);
  console.log('[AI DIAG] sendMessage history loaded: ' + messages.length + ' messages');
  messages.push({ role: 'user', content: userMessage });

  let roundCount = 0;
  const maxRounds = config.maxCallbackRounds || 5;
  let finalReply = '';

  const abortCtrl = new AbortController();

  while (roundCount <= maxRounds) {
    const isStreamRound = !!(stream && roundCount === 0);
    console.log('[AI DIAG] sendMessage round=' + roundCount + ' isStream=' + isStreamRound + ' msgCount=' + messages.length);
    const result = await _callAI(config, messages, isStreamRound, (chunk, full) => {
      if (onStreamChunk) onStreamChunk(full);
    }, abortCtrl.signal);
    console.log('[AI DIAG] sendMessage _callAI returned: contentLen=' + (result.content ? result.content.length : 0) + ' first80=' + (result.content ? result.content.substring(0, 80) : 'NULL'));

    finalReply = result.content;
    messages.push({ role: 'assistant', content: result.content });

    const parsed = _parseAIResponse(result.content);
    const toolCalls = parsed.tool_calls || [];
    if (!toolCalls.length) break;

    roundCount++;
    if (roundCount > maxRounds) {
      finalReply += '\n\n*已到回调次数上限，请检查当前MMD模型的默认AI模型 对话限制*';
      messages.push({ role: 'system', content: '已达回调次数上限' });
      break;
    }

    for (const tc of toolCalls) {
      const tr = await executeTool(tc.name, tc.arguments || {});
      messages.push({ role: 'system', content: '工具[' + tc.name + ']结果: ' + JSON.stringify(tr) });
    }
  }

  const saved = await saveChatHistory(modelId, messages);
  console.log('[AI DIAG] sendMessage DONE saved=' + saved + ' replyLen=' + finalReply.length + ' totalMsgs=' + messages.length);
  return { reply: finalReply, messages, abortCtrl };
}

// ===== 对话气泡 =====
function showChatBubble(modelId, modelName, text) {
  console.log('[AI DIAG] showChatBubble ENTER modelId=' + modelId + ' textLen=' + (text ? text.length : 0));
  const bid = 'mmd-ai-bubble-' + modelId;
  let bubble = document.getElementById(bid);
  const page = document.getElementById('page-mmd');
  console.log('[AI DIAG] showChatBubble page=' + !!page + ' bubbleFound=' + !!bubble);
  if (!page) { console.warn('[AI DIAG] showChatBubble ABORT: page-mmd not found'); return; }

  try {
    if (!bubble) {
      console.log('[AI DIAG] showChatBubble creating div...');
      bubble = document.createElement('div');
      console.log('[AI DIAG] showChatBubble div created, setting id...');
      bubble.id = bid;
      console.log('[AI DIAG] showChatBubble id set, setting className...');
      bubble.className = 'mmd-ai-bubble';
      console.log('[AI DIAG] showChatBubble className set, setting innerHTML...');
      bubble.innerHTML = '<div class="mmd-ai-bubble-inner"></div>';
      console.log('[AI DIAG] showChatBubble innerHTML set, appending to page...');
      document.body.appendChild(bubble);
      bubble._posTarget = function() {
        var viewer = document.getElementById('mmd-mini-viewer') || document.getElementById('mmdai-mini-viewer');
        if (!viewer) return;
        var vr = viewer.getBoundingClientRect();
        var ih = _hoverInputEl ? _hoverInputEl.getBoundingClientRect().height : 40;
        bubble.style.left = Math.max(4, vr.left + vr.width / 2 - 150) + 'px';
        bubble.style.bottom = Math.max(4, window.innerHeight - vr.top + ih + 16) + 'px';
        bubble.style.top = 'auto';
        bubble.style.maxHeight = Math.max(60, vr.top - ih - 24) + 'px';
      };
      bubble._posTarget();
      console.log('[AI DIAG] showChatBubble appended to page, classList=' + bubble.className);
    }

    const inner = bubble.querySelector('.mmd-ai-bubble-inner');
    console.log('[AI DIAG] showChatBubble inner found=' + !!inner);
    if (!inner) { console.warn('[AI DIAG] showChatBubble ABORT: inner null'); return; }
    inner.innerHTML = _renderMD(text);
    bubble.classList.add('show');
    bubble.classList.remove('hide');
    console.log('[AI DIAG] showChatBubble DONE classList=' + bubble.className + ' display=' + bubble.style.display + ' opacity=' + getComputedStyle(bubble).opacity);

    if (_bubbleTimers[modelId]) clearTimeout(_bubbleTimers[modelId]);
    _bubbleTimers[modelId] = setTimeout(function() {
      bubble.classList.add('hide');
      bubble.classList.remove('show');
    }, 15000);
  } catch(e) {
    console.error('[AI DIAG] showChatBubble CRASH:', e.message, e.stack);
  }
}

// ===== 悬停输入框 =====
function _createHoverInput(modelData) {
  _removeHoverInput();

  _hoverInputEl = document.createElement('div');
  _hoverInputEl.className = 'mmd-ai-hover-input';
  _hoverInputEl.innerHTML =
    '<button class="mmd-ai-hover-open" title="在窗口打开"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>' +
    '<input type="text" class="mmd-ai-hover-text" placeholder="输入消息...">' +
    '<button class="mmd-ai-hover-send"><i class="fa-solid fa-paper-plane"></i></button>';
  document.body.appendChild(_hoverInputEl);
  _currentHoverModelId = modelData.id;

  var _posUpdate = function() {
    if (!_hoverInputEl) return;
    var m = document.getElementById('mmd-mini-viewer') || document.getElementById('mmdai-mini-viewer');
    if (!m || !m.isConnected) return;
    var mr = m.getBoundingClientRect();
    var ir = _hoverInputEl.getBoundingClientRect();
    _hoverInputEl.style.left = Math.max(4, Math.min(mr.left + mr.width / 2 - ir.width / 2, window.innerWidth - ir.width - 4)) + 'px';
    _hoverInputEl.style.top = Math.max(4, mr.top - ir.height - 8) + 'px';
    var bubble = document.getElementById('mmd-ai-bubble-' + modelData.id);
    if (bubble && bubble.classList.contains('show')) {
      bubble.style.left = Math.max(4, mr.left + mr.width / 2 - 150) + 'px';
      bubble.style.bottom = Math.max(4, window.innerHeight - mr.top + ir.height + 16) + 'px';
      bubble.style.top = 'auto';
      bubble.style.maxHeight = Math.max(60, mr.top - ir.height - 24) + 'px';
    }
  };
  _hoverInputEl._posUpdate = _posUpdate;
  var _posLoop = function() {
    _posUpdate();
    if (!_hoverInputEl) return;
    var m = document.getElementById('mmd-mini-viewer') || document.getElementById('mmdai-mini-viewer');
    if (!m || !m.isConnected) { _removeHoverInput(); return; }
    _hoverInputEl._posTimer = requestAnimationFrame(_posLoop);
  };
  _hoverInputEl._posTimer = requestAnimationFrame(_posLoop);

  const openBtn = _hoverInputEl.querySelector('.mmd-ai-hover-open');
  const sendBtn = _hoverInputEl.querySelector('.mmd-ai-hover-send');
  const input = _hoverInputEl.querySelector('.mmd-ai-hover-text');

  openBtn.onclick = function(e) { e.stopPropagation(); _removeHoverInput(); openChatWindow(modelData); };

  var _sending = false;
  var doSend = async function() {
    var msg = input.value.trim();
    if (!msg || _sending) return;
    _sending = true;
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    if (typeof showToast === 'function') showToast('AI思考中...', '', 'info', 3000);
    try {
      var r = await sendMessage(modelData.id, msg, false);
      console.log('[AI DIAG] hover doSend result: error=' + (r.error || 'NONE') + ' replyLen=' + (r.reply ? r.reply.length : 0) + ' reply=' + (r.reply ? r.reply.substring(0, 50) : 'NULL'));
      if (r.error) {
        if (typeof showToast === 'function') showToast('AI错误', r.error, 'error', 5000);
      } else {
        var displayText = r.reply;
        try { var p = JSON.parse(r.reply); displayText = p.reply || r.reply; } catch(e) {}
        console.log('[AI DIAG] hover calling showChatBubble modelId=' + modelData.id + ' displayLen=' + displayText.length);
        showChatBubble(modelData.id, modelData.name, displayText);
      }
    } catch (e) {
      console.error('[AI DIAG] hover doSend exception:', e.message, e.stack);
      if (typeof showToast === 'function') showToast('AI错误', e.message, 'error', 5000);
    }
    _sending = false;
    input.disabled = false;
    sendBtn.disabled = false;
  };

  sendBtn.onclick = function(e) { e.stopPropagation(); doSend(); };
  input.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } };

  requestAnimationFrame(function() {
    _hoverInputEl.classList.add('show');
    if (_hoverInputEl._posUpdate) _hoverInputEl._posUpdate();
  });
}

function _removeHoverInput() {
  if (!_hoverInputEl) return;
  if (_hoverInputEl._posTimer) cancelAnimationFrame(_hoverInputEl._posTimer);
  _hoverInputEl.classList.remove('show');
  var el = _hoverInputEl;
  var mid = _currentHoverModelId;
  clearTimeout(_bubbleTimers[mid]);
  _hoverInputEl = null;
  _currentHoverModelId = null;
  setTimeout(function() {
    if (el.parentNode) el.parentNode.removeChild(el);
    var bubble = document.getElementById('mmd-ai-bubble-' + mid);
    if (bubble) { bubble.classList.add('hide'); bubble.classList.remove('show'); }
  }, 200);
}

// ===== 对话窗口 =====
function openChatWindow(modelData) {
  if (modelData && modelData._aiStore) _aiStoreMap[modelData.id] = modelData._aiStore;
  var winId = 'mmd-ai-chat-win-' + modelData.id;
  var win = document.getElementById(winId);

  if (!win) {
    win = document.createElement('div');
    win.id = winId;
    win.className = 'mmd-ai-chat-window';
    win.style.minWidth = '360px';
    win.style.minHeight = '400px';
    win.style.left = '100px';
    win.style.top = '100px';
    win.style.width = '420px';
    win.style.height = '500px';
    win.innerHTML =
      '<div class="mmd-ai-chat-header">' +
        '<span class="mmd-ai-chat-title" id="mmd-ai-title-' + modelData.id + '">' + _esc(modelData.name) + ' - AI 对话</span>' +
        '<div class="mmd-ai-chat-toolbar">' +
          '<div class="mmd-ai-tb-wrap"><button class="mmd-ai-tb-btn" data-act="config"><i class="fa-solid fa-gear"></i></button><span class="mmd-ai-tb-label">当前MMD模型AI配置</span></div>' +
          '<div class="mmd-ai-tb-wrap"><button class="mmd-ai-tb-btn" data-act="history"><i class="fa-solid fa-clock-rotate-left"></i></button><span class="mmd-ai-tb-label">打开历史对话</span></div>' +
          '<div class="mmd-ai-tb-wrap"><button class="mmd-ai-tb-btn" data-act="reset"><i class="fa-solid fa-arrows-rotate"></i></button><span class="mmd-ai-tb-label">重置对话</span></div>' +
          '<div class="mmd-ai-tb-wrap"><button class="mmd-ai-tb-btn" data-act="other"><i class="fa-solid fa-cubes"></i></button><span class="mmd-ai-tb-label">打开其他模型对话</span></div>' +
          '<div class="mmd-ai-tb-wrap"><button class="mmd-ai-tb-btn" data-act="rename"><i class="fa-solid fa-pen-to-square"></i></button><span class="mmd-ai-tb-label">重命名当前对话</span></div>' +
          '<button class="mmd-ai-tb-btn mmd-ai-close-btn" data-act="close"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="mmd-ai-chat-msgs"></div>' +
      '<div class="mmd-ai-chat-inp-area">' +
        '<input type="text" class="mmd-ai-chat-inp" placeholder="输入消息...">' +
        '<button class="mmd-ai-chat-send"><i class="fa-solid fa-paper-plane"></i></button>' +
      '</div>';
    document.body.appendChild(win);
    _setupChatWindow(win, modelData);
    _makeWinDraggable(win);
    _loadMsgsToWin(win, modelData.id);
    loadAIConfig(modelData.id).then(function(cfg) {
      var t = win.querySelector('.mmd-ai-chat-title');
      if (t) t.textContent = _esc(modelData.name) + ' - ' + (cfg.sessionName || '新对话');
    });
  }

  win.style.display = 'flex';
  loadAIConfig(modelData.id).then(function(cfg) {
    win.style.opacity = cfg.opacity !== undefined ? cfg.opacity : 1.0;
  });
  _loadMsgsToWin(win, modelData.id);
  if (_hoverInputEl && _currentHoverModelId === modelData.id) _removeHoverInput();
}

async function _loadMsgsToWin(win, modelId) {
  var c = win.querySelector('.mmd-ai-chat-msgs');
  if (!c) return;
  var msgs = await loadChatHistory(modelId);
  var h = '';
  msgs.forEach(function(m) {
    if (m.role === 'user') h += '<div class="mmd-ai-msg mmd-ai-msg-user">' + _esc(m.content) + '</div>';
    else if (m.role === 'assistant') {
      var txt = m.content;
      try { var p = JSON.parse(txt); txt = p.reply || txt; } catch (e) {}
      h += '<div class="mmd-ai-msg mmd-ai-msg-assistant">' + _renderMD(txt) + '</div>';
    } else {
      h += '<div class="mmd-ai-msg mmd-ai-msg-system">' + _esc(m.content) + '</div>';
    }
  });
  c.innerHTML = h;
  c.scrollTop = c.scrollHeight;
}

function _setupChatWindow(win, modelData) {
  var tb = win.querySelector('.mmd-ai-chat-toolbar');
  var sendBtn = win.querySelector('.mmd-ai-chat-send');
  var input = win.querySelector('.mmd-ai-chat-inp');
  var msgsC = win.querySelector('.mmd-ai-chat-msgs');
  var _currentAbort = null;

  tb.onclick = function(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'config': showAIConfigDialog(modelData); break;
      case 'reset': _resetChat(modelData, win); break;
      case 'close': win.style.display = 'none'; break;
      case 'rename': _renameChat(modelData, win); break;
      case 'history': _showHistoryDialog(modelData, win); break;
      case 'other': _showOtherModelsDialog(modelData, win); break;
    }
  };

  var _sendLock = false;
  var _doSend = async function() {
    var msg = input.value.trim();
    if (!msg || _sendLock) return;
    _sendLock = true;
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    sendBtn.title = '停止生成';

    msgsC.insertAdjacentHTML('beforeend', '<div class="mmd-ai-msg mmd-ai-msg-user">' + _esc(msg) + '</div>');
    var ad = document.createElement('div');
    ad.className = 'mmd-ai-msg mmd-ai-msg-assistant streaming';
    msgsC.appendChild(ad);
    msgsC.scrollTop = msgsC.scrollHeight;

    try {
      var r = await sendMessage(modelData.id, msg, true, function(full) {
        var displayText = full;
        try { var p = JSON.parse(full); displayText = p.reply || full; } catch (e) {
          var m = full.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (m) { displayText = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'); }
        }
        ad.textContent = displayText;
        msgsC.scrollTop = msgsC.scrollHeight;
      });
      _currentAbort = r.abortCtrl;
      ad.remove();
      await _loadMsgsToWin(win, modelData.id);
      _currentAbort = null;
    } catch (e) {
      if (e.name === 'AbortError') { ad.remove(); await _loadMsgsToWin(win, modelData.id); }
      else {
        ad.textContent = '错误: ' + e.message;
        ad.classList.add('error');
      }
    }
    _sendLock = false;
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
    sendBtn.title = '';
    input.focus();
  };

  sendBtn.onclick = function() {
    if (_sendLock) {
      if (_currentAbort) { _currentAbort.abort(); _currentAbort = null; }
      return;
    }
    _doSend();
  };
  input.onkeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _doSend(); }
  };
}

async function _resetChat(modelData, win) {
  var dlg = _showCustomDialog({
    title: '重置对话',
    body: '<p style="margin:0;color:var(--text);">确定重置 <b>' + _esc(modelData.name) + '</b> 的当前对话？</p><p style="color:var(--text-secondary);font-size:12px;margin:8px 0 0;">旧对话将保存为历史记录</p>',
    buttons: [{ text: '确定重置', cls: 'danger', action: async function() {
      dlg.remove();
      await resetChatHistory(modelData.id);
      var c = win.querySelector('.mmd-ai-chat-msgs');
      if (c) c.innerHTML = '';
      if (typeof showToast === 'function') showToast('对话已重置', '旧对话已保存', 'success', 3000);
    }}, { text: '取消', cls: 'secondary', action: function() { dlg.remove(); } }]
  });
}

async function _renameChat(modelData, win) {
  var cfg = await loadAIConfig(modelData.id);
  var curName = cfg.sessionName || '新对话';
  var dlg = _showCustomDialog({
    title: '重命名对话',
    body: '<label style="display:block;color:var(--text-secondary);font-size:12px;margin-bottom:6px;">对话名称</label><input class="mmd-ai-rename-inp" type="text" value="' + _esc(curName) + '" maxlength="50" style="width:100%;box-sizing:border-box;">',
    buttons: [{ text: '确定', cls: 'primary', action: async function() {
      var inp = dlg.querySelector('.mmd-ai-rename-inp');
      var name = (inp.value || '').trim();
      dlg.remove();
      if (!name) return;
      cfg.sessionName = name;
      await saveAIConfig(modelData.id, cfg);
      var t = win.querySelector('.mmd-ai-chat-title');
      if (t) t.textContent = _esc(modelData.name) + ' - ' + name;
      if (typeof showToast === 'function') showToast('已重命名', name, 'success', 3000);
    }}, { text: '取消', cls: 'secondary', action: function() { dlg.remove(); } }]
  });
  setTimeout(function() { var inp = dlg.querySelector('.mmd-ai-rename-inp'); if (inp) { inp.focus(); inp.select(); } }, 100);
}

function _makeWinDraggable(win) {
  var hdr = win.querySelector('.mmd-ai-chat-header');
  if (!hdr) return;
  var sx, sy, sl, st, dragging = false;
  hdr.onmousedown = function(e) {
    if (e.target.closest('button')) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    sl = parseInt(win.style.left) || 0;
    st = parseInt(win.style.top) || 0;
    win.style.transition = 'none';
    document.body.style.userSelect = 'none';
  };
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var nx = sl + e.clientX - sx;
    var ny = st + e.clientY - sy;
    var wr = win.getBoundingClientRect();
    nx = Math.max(0, Math.min(nx, window.innerWidth - wr.width));
    ny = Math.max(30, Math.min(ny, window.innerHeight - wr.height));
    win.style.left = nx + 'px';
    win.style.top = ny + 'px';
  });
  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    win.style.transition = 'left 0.25s ease, top 0.25s ease';
    var curTop = parseInt(win.style.top) || 0;
    if (curTop < 30) win.style.top = '30px';
    document.body.style.userSelect = '';
    setTimeout(function() { win.style.transition = ''; }, 260);
  });
}

// ===== AI 配置对话框 =====
function showAIConfigDialog(modelData) {
  if (modelData && modelData._aiStore) _aiStoreMap[modelData.id] = modelData._aiStore;
  var did = 'mmd-ai-cfg-dlg';
  var dlg = document.getElementById(did);
  if (dlg) dlg.remove();

  dlg = document.createElement('div');
  dlg.id = did;
  dlg.className = 'mmd-ai-cfg-overlay';
  dlg.innerHTML =
    '<div class="mmd-ai-cfg-dialog">' +
      '<div class="mmd-ai-cfg-hdr"><h3>配置当前MMD模型的AI</h3><button class="mmd-ai-cfg-close">&times;</button></div>' +
      '<div class="mmd-ai-cfg-body">' +
        '<div class="mmd-ai-cfg-field"><label>重命名当前会话</label><input type="text" id="mmd-ai-sess-name" placeholder="新对话"></div>' +
        '<div class="mmd-ai-cfg-field"><label>自定义AI性格</label><textarea id="mmd-ai-personality" rows="4" placeholder="描述AI的性格、语气、行为特征..."></textarea></div>' +
        '<div class="mmd-ai-cfg-field"><label>窗口不透明度 <span id="mmd-ai-opacity-val">100%</span></label><input type="range" id="mmd-ai-opacity" min="10" max="100" step="5" value="100"></div>' +
        '<div class="mmd-ai-cfg-field"><label>base_url</label><input type="url" id="mmd-ai-base-url" placeholder="https://api.deepseek.com"></div>' +
        '<div class="mmd-ai-cfg-field"><label>api_key</label><div class="mmd-ai-key-wrap"><input type="password" id="mmd-ai-api-key" placeholder="sk-..."><button id="mmd-ai-key-tog"><i class="fa-solid fa-eye"></i></button></div></div>' +
        '<div class="mmd-ai-cfg-field"><label>AI模型 回调次数限制</label><input type="number" id="mmd-ai-max-rounds" min="1" max="20" value="5" style="width:80px;"></div>' +
      '</div>' +
      '<div class="mmd-ai-cfg-footer"><button class="btn btn-primary mmd-ai-cfg-save">保存配置</button><button class="btn btn-outline mmd-ai-cfg-cancel">取消</button></div>' +
    '</div>';
  document.body.appendChild(dlg);

  loadAIConfig(modelData.id).then(function(cfg) {
    document.getElementById('mmd-ai-sess-name').value = cfg.sessionName || '';
    document.getElementById('mmd-ai-personality').value = cfg.personality || '';
    var op = Math.round((cfg.opacity !== undefined ? cfg.opacity : 1.0) * 100);
    document.getElementById('mmd-ai-opacity').value = op;
    document.getElementById('mmd-ai-opacity-val').textContent = op + '%';
    document.getElementById('mmd-ai-base-url').value = cfg.base_url || '';
    document.getElementById('mmd-ai-api-key').value = cfg.api_key || '';
    document.getElementById('mmd-ai-max-rounds').value = cfg.maxCallbackRounds || 5;
  });

  dlg.querySelector('.mmd-ai-cfg-close').onclick = function() { dlg.remove(); };
  dlg.querySelector('.mmd-ai-cfg-cancel').onclick = function() { dlg.remove(); };
  dlg.onclick = function(e) { if (e.target === dlg) dlg.remove(); };

  document.getElementById('mmd-ai-opacity').addEventListener('input', function() {
    document.getElementById('mmd-ai-opacity-val').textContent = this.value + '%';
  });;

  var keyTog = document.getElementById('mmd-ai-key-tog');
  var keyInp = document.getElementById('mmd-ai-api-key');
  keyTog.onclick = function() {
    var isPass = keyInp.type === 'password';
    keyInp.type = isPass ? 'text' : 'password';
    keyTog.innerHTML = isPass ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  };

  dlg.querySelector('.mmd-ai-cfg-save').onclick = async function() {
    var cfg = await loadAIConfig(modelData.id);
    cfg.sessionName = document.getElementById('mmd-ai-sess-name').value || '新对话';
    cfg.personality = document.getElementById('mmd-ai-personality').value;
    cfg.base_url = document.getElementById('mmd-ai-base-url').value;
    cfg.api_key = document.getElementById('mmd-ai-api-key').value;
    cfg.maxCallbackRounds = parseInt(document.getElementById('mmd-ai-max-rounds').value) || 5;
    cfg.opacity = parseInt(document.getElementById('mmd-ai-opacity').value) / 100;
    cfg.enabled = true;
    await saveAIConfig(modelData.id, cfg);
    dlg.remove();
    if (typeof showToast === 'function') showToast('AI配置已保存', modelData.name + '配置已更新', 'success', 3000);
    var w = document.getElementById('mmd-ai-chat-win-' + modelData.id);
    if (w) { var t = w.querySelector('.mmd-ai-chat-title'); if (t) t.textContent = _esc(modelData.name) + ' - ' + cfg.sessionName; w.style.opacity = cfg.opacity; }
  };
}

// ===== 悬停检测 =====
function _setupModelHover() {
  var _leaveTimer = null;

  document.addEventListener('mouseover', function(e) {
    var mini = document.getElementById('mmd-mini-viewer');
    var isImageMini = false;
    if (!mini) { mini = document.getElementById('mmdai-mini-viewer'); isImageMini = true; }
    if (!mini) return;
    if (!mini.contains(e.target)) return;

    var modelId, modelName;
    if (isImageMini) {
      modelId = Number(mini.dataset.mmdaiProjectId);
      modelName = mini.dataset.mmdaiProjectName || 'AI图片项目';
      if (!modelId) return;
      if (!_aiStoreMap[modelId]) _aiStoreMap[modelId] = 'ai_images';
    } else {
      modelId = mini.dataset.mmdModelId;
      if (!modelId && window._mmdGetActiveModel) {
        var active = window._mmdGetActiveModel();
        if (active) {
          modelId = active.id;
          mini.dataset.mmdModelId = active.id;
          mini.dataset.mmdModelName = active.name || '';
        }
      }
      modelName = mini.dataset.mmdModelName || 'MMD模型';
      if (!modelId) return;
    }

    if (_leaveTimer) { clearTimeout(_leaveTimer); _leaveTimer = null; }

    if (!_hoverInputEl || _currentHoverModelId !== modelId) {
      var w = document.getElementById('mmd-ai-chat-win-' + modelId);
      if (!w || w.style.display === 'none') {
        _createHoverInput({ id: modelId, name: modelName });
      }
    }
    if (_hoverInputEl && _hoverInputEl._posUpdate) _hoverInputEl._posUpdate();
  });

  document.addEventListener('mouseout', function(e) {
    var mini = document.getElementById('mmd-mini-viewer') || document.getElementById('mmdai-mini-viewer');
    if (!mini) return;
    if (mini.contains(e.relatedTarget)) return;

    if (_hoverInputEl) {
      var hoverInput = _hoverInputEl.querySelector('.mmd-ai-hover-text');
      if (hoverInput && document.activeElement === hoverInput && hoverInput.value.trim()) {
        return;
      }
      _leaveTimer = setTimeout(function() {
        if (_hoverInputEl && !document.querySelector('.mmd-ai-hover-input:hover')) {
          var inp = _hoverInputEl.querySelector('.mmd-ai-hover-text');
          if (inp && document.activeElement === inp && inp.value.trim()) return;
          _removeHoverInput();
        }
      }, 300);
    }
  });
}

async function _loadAllAIConfigs() {
  if (typeof window._mmdGetAllModels !== 'function') return;
  var models = window._mmdGetAllModels();
  for (var i = 0; i < models.length; i++) {
    var cfg = await loadAIConfig(models[i].id);
    _aiEnabledModels[models[i].id] = cfg.enabled;
  }
}

function isAIEnabled(modelId) { return !!_aiEnabledModels[modelId]; }
function getAIConfig(modelId) { return loadAIConfig(modelId); }

var _initialized = false;
function initMMDAI() {
  if (_initialized) return;
  _initialized = true;
  try {
    _setupModelHover();
    _loadAllAIConfigs();
    document.body.addEventListener('click', function(e) {
      var btn = e.target.closest('.mmd-ai-code-copy');
      if (!btn) return;
      var code = btn.parentElement.querySelector('pre code');
      if (!code) return;
      var txt = code.innerText || '';
      var lines = txt.split('\n');
      if (lines.length > 1 && /^\S+$/.test(lines[0].trim())) {
        txt = lines.slice(1).join('\n');
      }
      navigator.clipboard.writeText(txt).then(function() {
        var icon = btn.querySelector('i');
        if (icon) { icon.className = 'fa-solid fa-check'; setTimeout(function() { icon.className = 'fa-solid fa-copy'; }, 1500); }
      }).catch(function() {});
    });
  } catch (e) {
    _initialized = false;
  }
}

// ===== 通用自定义对话框 =====
function _showCustomDialog(opts) {
  var overlay = document.createElement('div');
  overlay.className = 'mmd-ai-cfg-overlay';
  var btnsHtml = '';
  if (opts.buttons && opts.buttons.length) {
    opts.buttons.forEach(function(b) {
      btnsHtml += '<button class="btn btn-' + (b.cls || 'primary') + '" style="margin-left:6px;">' + _esc(b.text) + '</button>';
    });
  }
  overlay.innerHTML = '<div class="mmd-ai-cfg-dialog" style="width:' + (opts.width || 380) + 'px;max-height:70vh;">' +
    '<div class="mmd-ai-cfg-hdr"><h3>' + _esc(opts.title) + '</h3><button class="mmd-ai-cfg-close">&times;</button></div>' +
    '<div class="mmd-ai-cfg-body" style="padding:16px;overflow-y:auto;">' + (opts.body || '') + '</div>' +
    (btnsHtml ? '<div class="mmd-ai-cfg-footer" style="padding:12px 16px;display:flex;justify-content:flex-end;gap:4px;">' + btnsHtml + '</div>' : '') +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('.mmd-ai-cfg-close').onclick = function() { overlay.remove(); };
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  var btnEls = overlay.querySelectorAll('.mmd-ai-cfg-footer .btn');
  if (opts.buttons) opts.buttons.forEach(function(b, i) { if (btnEls[i]) btnEls[i].onclick = b.action; });
  return overlay;
}

// ===== 历史对话对话框 =====
async function _showHistoryDialog(modelData, win) {
  var listHtml = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">加载中...</div>';
  var dlg = _showCustomDialog({
    title: '历史对话 - ' + _esc(modelData.name),
    width: 420,
    body: listHtml,
    buttons: [{ text: '关闭', cls: 'secondary', action: function() { dlg.remove(); } }]
  });
  var bodyEl = dlg.querySelector('.mmd-ai-cfg-body');
  try {
    var entries = [];
    entries.push({ label: '当前对话 (' + new Date().toLocaleDateString() + ')', file: 'ai_chat.json', isCurrent: true });
    for (var i = 1; i < 100; i++) {
      try {
        var raw = await _aiRead(modelData.id, 'ai_chat_old_' + i + '.json', _aiIsProject(modelData.id));
        if (!raw) break;
        var msgs = JSON.parse(raw);
        var firstMsg = '';
        for (var j = 0; j < msgs.length; j++) {
          if (msgs[j].role === 'user') { firstMsg = msgs[j].content.substring(0, 40); break; }
        }
        entries.push({ label: '存档 #' + i + (firstMsg ? ' - ' + firstMsg : ''), file: 'ai_chat_old_' + i + '.json', isCurrent: false, msgs: msgs, index: i });
      } catch(e) { break; }
    }
    var h = '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">共 ' + entries.length + ' 条记录 | 点击切换</div>';
    entries.forEach(function(e) {
      h += '<div class="mmd-ai-hist-item' + (e.isCurrent ? ' current' : '') + '" data-file="' + _esc(e.file) + '" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid var(--border);transition:background 0.15s;' + (e.isCurrent ? 'background:rgba(99,102,241,0.12);border-color:rgba(99,102,241,0.3);' : '') + '"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(e.label) + ((e.msgs ? ' (' + e.msgs.length + '条消息)' : '')) + '</span>' + (!e.isCurrent ? '<button class="mmd-ai-hist-del" data-file="' + _esc(e.file) + '" title="删除" style="flex-shrink:0;margin-left:8px;width:24px;height:24px;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;border-radius:4px;font-size:14px;line-height:24px;text-align:center;transition:color 0.15s,background 0.15s;"><i class="fa-solid fa-trash-can"></i></button>' : '') + '</div>';
    });
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('.mmd-ai-hist-item').forEach(function(item) {
      item.onmouseenter = function() { if (!item.classList.contains('current')) item.style.background = 'rgba(255,255,255,0.06)'; };
      item.onmouseleave = function() { if (!item.classList.contains('current')) item.style.background = ''; };
      item.querySelector('span').onclick = function() {
        var file = item.dataset.file;
        if (file === 'ai_chat.json') { dlg.remove(); return; }
        dlg.remove();
        var cfm = _showCustomDialog({
          title: '切换对话',
          body: '<p style="margin:0;color:var(--text);">切换到存档 <b>' + _esc(item.textContent.trim()) + '</b>？</p><p style="color:var(--text-secondary);font-size:12px;margin:8px 0 0;">当前对话将自动存档</p>',
          buttons: [{ text: '切换', cls: 'primary', action: async function() {
            cfm.remove();
        try {
          var isAi = _aiIsProject(modelData.id);
          var oldRaw = await _aiRead(modelData.id, 'ai_chat.json', isAi);
          if (oldRaw) {
            var oldMsgs = JSON.parse(oldRaw);
            var saveIdx = 1;
            for (; saveIdx < 100; saveIdx++) {
              try { var t = await _aiRead(modelData.id, 'ai_chat_old_' + saveIdx + '.json', isAi); if (!t) break; } catch(e) { break; }
            }
            await _aiWrite(modelData.id, 'ai_chat_old_' + saveIdx + '.json', JSON.stringify(oldMsgs, null, 2), isAi);
          }
          var targetMsgs = JSON.parse(await _aiRead(modelData.id, file, isAi));
          await _aiWrite(modelData.id, 'ai_chat.json', JSON.stringify(targetMsgs, null, 2), isAi);
          if (typeof showToast === 'function') showToast('已切换', '对话已切换', 'success', 2000);
          _loadMsgsToWin(win, modelData.id);
        } catch(e2) { if (typeof showToast === 'function') showToast('切换失败', e2.message, 'error', 3000); }
          }}, { text: '取消', cls: 'secondary', action: function() { cfm.remove(); } }]
        });
      };
      var delBtn = item.querySelector('.mmd-ai-hist-del');
      if (delBtn) {
        delBtn.onmouseenter = function(e) { e.stopPropagation(); delBtn.style.color = '#f87171'; delBtn.style.background = 'rgba(248,113,113,0.12)'; };
        delBtn.onmouseleave = function(e) { e.stopPropagation(); delBtn.style.color = ''; delBtn.style.background = ''; };
        delBtn.onclick = function(e) {
          e.stopPropagation();
          var file = delBtn.dataset.file;
          var cfmDel = _showCustomDialog({
            title: '删除存档',
            body: '<p style="margin:0;color:var(--text);">确定删除该历史存档？</p><p style="color:#f87171;font-size:12px;margin:8px 0 0;">此操作不可恢复</p>',
            buttons: [{ text: '确定删除', cls: 'danger', action: async function() {
              cfmDel.remove();
              try {
                await _aiWrite(modelData.id, file, '', _aiIsProject(modelData.id));
                if (typeof showToast === 'function') showToast('已删除', '历史存档已删除', 'success', 2000);
                dlg.remove();
                _showHistoryDialog(modelData, win);
              } catch(e2) { if (typeof showToast === 'function') showToast('删除失败', e2.message, 'error', 3000); }
            }}, { text: '取消', cls: 'secondary', action: function() { cfmDel.remove(); } }]
          });
        };
      }
    });
  } catch(e) { bodyEl.innerHTML = '<div style="color:#f87171;text-align:center;padding:20px;">加载失败: ' + _esc(e.message) + '</div>'; }
}

// ===== 打开其他模型对话 =====
function _showOtherModelsDialog(currentModelData, currentWin) {
  var dlg = _showCustomDialog({
    title: '选择模型对话',
    width: 380,
    body: '<div style="text-align:center;color:var(--text-secondary);padding:12px;">加载中...</div>',
    buttons: [{ text: '关闭', cls: 'secondary', action: function() { dlg.remove(); } }]
  });
  var bodyEl = dlg.querySelector('.mmd-ai-cfg-body');
  try {
    var allModels = typeof _mmdGetAllModels === 'function' ? _mmdGetAllModels() : [];
    if (!allModels.length) { bodyEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">没有找到模型</div>'; return; }
    var h = '';
    allModels.forEach(function(m) {
      var isCurrent = m.id === currentModelData.id;
      h += '<div class="mmd-ai-other-item" data-mid="' + m.id + '" data-mname="' + _esc(m.name) + '" style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid var(--border);transition:background 0.15s;' + (isCurrent ? 'background:rgba(99,102,241,0.12);border-color:rgba(99,102,241,0.3);' : '') + '">' + _esc(m.name) + (isCurrent ? ' <span style="font-size:11px;color:var(--text-secondary);">(当前)</span>' : '') + '</div>';
    });
    bodyEl.innerHTML = h;
    bodyEl.querySelectorAll('.mmd-ai-other-item').forEach(function(item) {
      item.onmouseenter = function() { if (item.dataset.mid !== String(currentModelData.id)) item.style.background = 'rgba(255,255,255,0.06)'; };
      item.onmouseleave = function() { if (item.dataset.mid !== String(currentModelData.id)) item.style.background = ''; };
      item.onclick = async function() {
        var mid = item.dataset.mid;
        var mname = item.dataset.mname;
        if (mid === String(currentModelData.id)) { dlg.remove(); return; }
        var cfg = await loadAIConfig(mid);
        if (!cfg.enabled) {
          if (typeof showToast === 'function') showToast('未启用AI', mname + ' 未启用AI对话', 'warning', 3000);
          return;
        }
        dlg.remove();
        openChatWindow({ id: mid, name: mname });
      };
    });
  } catch(e) { bodyEl.innerHTML = '<div style="color:#f87171;text-align:center;padding:20px;">加载失败: ' + _esc(e.message) + '</div>'; }
}

window.addEventListener('load', function() {
  setTimeout(function() {
    initMMDAI();
  }, 1000);
});

export { initMMDAI, showAIConfigDialog, isAIEnabled, getAIConfig, loadAIConfig, saveAIConfig, loadChatHistory, saveChatHistory, resetChatHistory, sendMessage, showChatBubble, openChatWindow };
window._mmdAI = { initMMDAI, showAIConfigDialog, isAIEnabled, getAIConfig, loadAIConfig, saveAIConfig, loadChatHistory, saveChatHistory, resetChatHistory, sendMessage, showChatBubble, openChatWindow };