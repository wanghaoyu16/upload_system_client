import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { initMMDAI } from './mmd_ai.js';

let renderer, scene, camera, controls, composer, outlinePass, bloomPass, saturationPass;
let currentModel = null;
let currentMats = [];
let animId = null;
let containerEl = null;
let resizeObserver = null;
let fileInput = null;
let fileURLs = new Map(), createdURLs = new Set(), unmatchedTextures = new Set();
let initialized = false;
let outlineEnabled = false;
let bloomEnabled = false;
let saturationValue = 1.0;
let emissiveIntensity = 0;
let miniGlowColor = 'rgba(255,200,100,0.5)';
let miniGlowSize = 12;

let lightIntensity = 1.0;
let hemiLight, keyLight, rimLight;

let miniRenderer, miniScene, miniCamera, miniModel, miniComposer, miniRT, miniAnimId, miniContainer, miniAmbient, miniDirLight, miniSatPass;
let miniMixer = null, miniAnimClip = null;
let _miniStopped = false;

let currentView = 'list';
let activeModelData = null;
let activeAppliedModelData = null;
let savedModels = [];
let configPanelEl = null;
let listPanelEl = null;
let textureFileMap = null;
let initialConfigSnapshot = null;

let configRenderer = null, configScene = null, configCamera = null, configModel = null, configControls = null, configComposer = null, configAnimId = null, configMixer = null, configAnimClip = null, configCurrentAnimName = null;
let configPreviewRenderer = null, configPreviewScene = null, configPreviewCamera = null, configPreviewModel = null, configPreviewComposer = null, configPreviewAnimId = null;
let mainCanvasWrap = null;
let configDefaultPose = null;
let configIdleTimer = null, configResetTimer = null;
let configLastAnimTime = 0;
let configIsVPD = false;
let configAnimFinishedCallback = null;
let _animPreviewLoadingId = null;

const FALLBACK_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b0b0b0';
  ctx.fillRect(0, 0, 4, 4);
  return c.toDataURL();
})();

let _origImageSrcDescriptor = null;
function _installImageInterceptor() {
  if (_origImageSrcDescriptor) return;
  console.log('[MMD DEBUG] ImageInterceptor INSTALLED');
  _origImageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get: _origImageSrcDescriptor.get,
    set: function(url) {
      const s = String(url);
      if (s.startsWith('data:')) { _origImageSrcDescriptor.set.call(this, s); return; }
      if (s.startsWith('blob:')) {
        if (s.startsWith('blob:file:///')) {
          const hit = lookupURL(s);
          if (hit) { _origImageSrcDescriptor.set.call(this, hit); return; }
          if (unmatchedTextures) unmatchedTextures.add(s);
          _origImageSrcDescriptor.set.call(this, FALLBACK_TEX);
          return;
        }
        _origImageSrcDescriptor.set.call(this, s); return;
      }
      const hit = lookupURL(s);
      if (hit) { _origImageSrcDescriptor.set.call(this, hit); return; }
      if (unmatchedTextures) unmatchedTextures.add(s);
      _origImageSrcDescriptor.set.call(this, FALLBACK_TEX);
    }
  });
}
function _uninstallImageInterceptor() {
  if (!_origImageSrcDescriptor) return;
  console.log('[MMD DEBUG] ImageInterceptor UNINSTALLED');
  Object.defineProperty(HTMLImageElement.prototype, 'src', _origImageSrcDescriptor);
  _origImageSrcDescriptor = null;
}

const MODEL_EXT = /\.(pmx|pmd|glb|gltf|obj|vrm)$/i;

const loaderManager = new THREE.LoadingManager();

function mmdToast(msg, type, title) {
  type = type || 'error';
  title = title || 'MMD 模型';
  if (typeof window.showToast === 'function') {
    window.showToast(title, msg, type, 8000, true);
  } else {
    alert(title + ': ' + msg);
  }
}

function hexDump(bytes, maxLen) {
  maxLen = maxLen || 64;
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const len = Math.min(arr.length, maxLen);
  const hex = Array.from(arr.slice(0, len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(arr.slice(0, len)).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
  return hex + ' | ' + ascii + (arr.length > maxLen ? ' ...' : '');
}

async function readMagic(blob) {
  try {
    const buf = await blob.slice(0, 64).arrayBuffer();
    return { size: blob.size, hex: hexDump(buf) };
  } catch (e) { return { size: blob.size, hex: 'READ ERROR: ' + e.message }; }
}

// ===== MMD 模型存储：通过 electronAPI 读写 JSON 文件 =====
async function getAllModels() {
  if (window.electronAPI && window.electronAPI.mmdGetModels) {
    savedModels = await window.electronAPI.mmdGetModels();
    return savedModels;
  }
  return [];
}

async function saveModelToDisk(name, modelFile, textureFiles, modelType, pmxTextureNames) {
  if (!window.electronAPI || !window.electronAPI.mmdSaveModel) throw new Error('electronAPI 不可用');
  const modelBuffer = await modelFile.arrayBuffer();
  const headArr = new Uint8Array(modelBuffer.slice(0, 4));
  console.log('[MMD DEBUG] saveModelToDisk modelBuffer size:', modelBuffer.byteLength, 'first 4 bytes:', Array.from(headArr).map(b => b.toString(16).padStart(2,'0')).join(' '), 'magic:', String.fromCharCode(...headArr));
  const textureData = await Promise.all(
    textureFiles.map(async f => ({ name: f.name, buffer: await f.arrayBuffer() }))
  );
  const id = await window.electronAPI.mmdSaveModel({
    name, modelType, pmxTextureNames: pmxTextureNames || [],
    modelFileName: modelFile.name, modelBuffer, textureData
  });
  return id;
}

async function deleteModelFromDisk(id) {
  if (window.electronAPI && window.electronAPI.mmdDeleteModel) {
    await window.electronAPI.mmdDeleteModel(id);
  }
}

async function renameModelOnDisk(id, newName) {
  if (window.electronAPI && window.electronAPI.mmdRenameModel) {
    await window.electronAPI.mmdRenameModel({ id, name: newName });
  }
}

async function updateTexturesOnDisk(id, textureFiles) {
  if (window.electronAPI && window.electronAPI.mmdUpdateTextures) {
    const textureData = await Promise.all(
      textureFiles.map(async f => ({ name: f.name, buffer: await f.arrayBuffer() }))
    );
    await window.electronAPI.mmdUpdateTextures({ id, textureData });
  }
}

async function saveModelConfigToDisk(id, config) {
  if (window.electronAPI && window.electronAPI.mmdUpdateConfig) {
    await window.electronAPI.mmdUpdateConfig({ id, config });
  }
}

async function savePreviewToDisk(id, dataURL) {
  if (window.electronAPI && window.electronAPI.mmdUpdatePreview) {
    await window.electronAPI.mmdUpdatePreview({ id, dataURL });
  }
}

// ===== 辅助：从文件路径构建 file:// URL 并注册到 fileURLs =====
function registerTexturePaths(model) {
  const texFiles = model.textureFiles || [];
  for (const tf of texFiles) {
    const url = 'file:///' + tf.path.replace(/\\/g, '/');
    createdURLs.add(url);
    const key = tf.name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/,'');
    fileURLs.set(key, url);
    fileURLs.set(key.toLowerCase(), url);
    const base = key.slice(key.lastIndexOf('/') + 1);
    fileURLs.set(base, url);
    fileURLs.set(base.toLowerCase(), url);
    for (const en of tryEncodings(base)) {
      fileURLs.set(en, url);
      fileURLs.set(en.toLowerCase(), url);
    }
  }
}

function getModelFileURL(modelData) {
  if (!modelData || !modelData.modelPath) return null;
  return 'file:///' + modelData.modelPath.replace(/\\/g, '/').replace(/^([A-Z]):\//i, '$1:/');
}

async function getModelBlobURL(modelData) {
  const fileURL = getModelFileURL(modelData);
  if (!fileURL) return null;
  try {
    const resp = await fetch(fileURL);
    const buf = await resp.arrayBuffer();
    const ext = modelData.modelType || 'pmx';
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const blobURL = URL.createObjectURL(blob) + '#.' + ext;
    console.log('[MMD DEBUG] getModelBlobURL created:', blobURL, 'buf size:', buf.byteLength);
    return blobURL;
  } catch (e) {
    console.error('[MMD DEBUG] getModelBlobURL failed:', e);
    return null;
  }
}


/* ---------- URL 管理 ---------- */
function clearURLs() {
  if (createdURLs) { createdURLs.forEach(u => URL.revokeObjectURL(u)); createdURLs.clear(); }
  if (fileURLs) fileURLs.clear();
  if (unmatchedTextures) unmatchedTextures.clear();
}

function urlCandidates(rawUrl) {
  let clean;
  try { clean = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]); }
  catch { clean = rawUrl.split('?')[0].split('#')[0]; }
  clean = clean.replace(/\\/g, '/');
  const noDot = clean.replace(/^\.\//, '').replace(/^\/+/, '');
  const base = noDot.slice(noDot.lastIndexOf('/') + 1);
  return { full: noDot, base, raw: rawUrl };
}

function tryEncodings(str) {
  const results = [str];
  if (!str || !str.length) return results;
  const bytes = new Uint8Array(str.length);
  let allLatin1 = true;
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp > 255) { allLatin1 = false; break; }
    bytes[i] = cp;
  }
  if (allLatin1) {
    for (const enc of ['shift-jis', 'gbk', 'gb2312', 'euc-jp', 'utf-8']) {
      try { const d = new TextDecoder(enc).decode(bytes); if (d !== str) results.push(d); } catch (e) {}
    }
  } else {
    const utf8Bytes = new TextEncoder().encode(str);
    for (const enc of ['gbk', 'gb2312', 'shift-jis', 'euc-jp']) {
      try { const d = new TextDecoder(enc).decode(utf8Bytes); if (d !== str) results.push(d); } catch (e) {}
    }
  }
  return [...new Set(results)];
}

function lookupURL(rawUrl) {
  if (!fileURLs) return null;
  let url = rawUrl;
  if (url.startsWith('blob:file:///')) {
    url = decodeURIComponent(url.slice('blob:file:///'.length)).replace(/\\/g, '/');
  }
  const { full, base } = urlCandidates(url);
  const searchKeys = [full, base, full.toLowerCase(), base.toLowerCase()];
  if (base) {
    const baseNoExt = base.replace(/\.[^.]+$/, '');
    if (baseNoExt !== base) searchKeys.push(baseNoExt, baseNoExt.toLowerCase());
    const encodings = tryEncodings(base);
    for (const en of encodings) {
      searchKeys.push(en, en.toLowerCase());
      const enNoExt = en.replace(/\.[^.]+$/, '');
      if (enNoExt !== en) searchKeys.push(enNoExt, enNoExt.toLowerCase());
    }
  }
  for (const c of searchKeys) {
    if (fileURLs.has(c)) return fileURLs.get(c);
  }
  const lb = base.toLowerCase();
  for (const [k, v] of fileURLs) {
    const kl = k.toLowerCase();
    if (kl.endsWith('/' + lb) || kl === lb) return v;
    if (base) {
      const baseNoExt = base.replace(/\.[^.]+$/, '').toLowerCase();
      if (kl.endsWith('/' + baseNoExt) || kl === baseNoExt) return v;
      const fkEnc = tryEncodings(k);
      for (const ek of fkEnc) {
        if (ek === base || ek.toLowerCase() === lb) return v;
      }
    }
  }
  return null;
}

loaderManager.setURLModifier((url) => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  const hit = lookupURL(url);
  if (hit) return hit;
  if (unmatchedTextures) unmatchedTextures.add(url);
  return FALLBACK_TEX;
});

/* ---------- 模型管理 ---------- */
function disposeCurrent() {
  if (currentModel && scene) {
    scene.remove(currentModel);
    currentModel.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(m => {
          for (const k in m) { if (m[k] && m[k].isTexture) m[k].dispose(); }
          m.dispose();
        });
      }
    });
    currentModel = null;
    currentMats = [];
  }
  stopConfigAnimation();
  disposeConfigViewer();
  disposeConfigPreview();
}

/* ---------- 文件夹拖拽递归 ---------- */







/* ---------- 文件夹拖拽递归 ---------- */
async function traverseEntry(entry, files, path) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(f => {
        try { Object.defineProperty(f, 'webkitRelativePath', { value: path + entry.name, configurable: true }); } catch (e) {}
        files.push(f); resolve();
      }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => {
        reader.readEntries(entries => {
          if (!entries.length) { resolve(); return; }
          Promise.all(entries.map(e => traverseEntry(e, files, path + entry.name + '/'))).then(readBatch);
        }, () => resolve());
      };
      readBatch();
    } else { resolve(); }
  });
}

/* ---------- 场景初始化 ---------- */
function setupScene(container, w, h) {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = null;
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 20000);
  camera.position.set(0, 14, 42);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  saturationPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, saturation: { value: 1.0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float saturation; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float gray = dot(c.rgb, vec3(0.299, 0.587, 0.114)); c.rgb = mix(vec3(gray), c.rgb, saturation); gl_FragColor = c; }'
  });
  saturationPass.renderToScreen = false;
  composer.addPass(saturationPass);

  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.05, 0.7);

  outlinePass = new OutlinePass(new THREE.Vector2(w, h), scene, camera);
  outlinePass.edgeStrength = 8.0;
  outlinePass.edgeGlow = 0;
  outlinePass.edgeThickness = 2.0;
  outlinePass.pulsePeriod = 0;
  outlinePass.visibleEdgeColor.set('#3a2010');
  outlinePass.hiddenEdgeColor.set('#000000');
  composer.addPass(bloomPass);
  composer.addPass(outlinePass);
  composer.setSize(w, h);
  updateComposerState();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 10, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.9;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 0.5;
  controls.maxDistance = 8000;
  controls.autoRotateSpeed = 1.6;
  controls.autoRotate = false;
  controls.update();

  hemiLight = new THREE.HemisphereLight(0xffffff, 0x2a3140, 1.8);
  scene.add(hemiLight);
  keyLight = new THREE.DirectionalLight(0xffffff, 1.7);
  keyLight.position.set(0.6, 1, 0.9);
  scene.add(keyLight);
  rimLight = new THREE.DirectionalLight(0x8fb4ff, 0.9);
  rimLight.position.set(-1, 0.5, -0.7);
  scene.add(rimLight);

  function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    if (!scene || !camera || !renderer) return;
    const useComposer = composer && (outlineEnabled || bloomEnabled || Math.abs(saturationValue - 1) > 0.001);
    try {
      if (useComposer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    } catch (e) {
      console.error('[MMD] composer render failed, fallback to direct:', e.message);
      renderer.render(scene, camera);
    }
  }
  animate();
}

/* ---------- UI ---------- */
function buildUI(container) {
  listPanelEl = document.createElement('div');
  listPanelEl.className = 'mmd-list-panel';
  listPanelEl.id = 'mmd-list-panel';
  listPanelEl.innerHTML = '<div class="mmd-list-left" id="mmd-list-left"></div><div class="mmd-list-divider" id="mmd-list-divider"></div><div class="mmd-list-right-panel" id="mmd-anim-panel"><div class="mmd-anim-placeholder"><i class="fa-solid fa-hand-point-left"></i> 请先在模型列表中应用模型</div></div>';
  container.appendChild(listPanelEl);

  configPanelEl = document.createElement('div');
  configPanelEl.className = 'mmd-config-panel';
  configPanelEl.id = 'mmd-config-panel';
  configPanelEl.style.display = 'none';
  container.appendChild(configPanelEl);

  setupDragDrop(container);
  renderModelList();
  loadAndRenderSavedModels();
  if (activeAppliedModelData) {
    console.log('[MMD DEBUG] buildUI: activeAppliedModelData already set, refreshing anim panel');
    renderAnimPanel(activeAppliedModelData);
  }
  initListDividerDrag();
}

function setupDragDrop(container) {
  let dragDepth = 0;
  container.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; });
  container.addEventListener('dragover', e => e.preventDefault());
  container.addEventListener('dragleave', e => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); });
  container.addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0;
    const dt = e.dataTransfer, files = [];
    if (dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind !== 'file') continue;
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) await traverseEntry(entry, files, '');
        else { const f = item.getAsFile(); if (f) files.push(f); }
      }
    } else { files.push(...(dt.files || [])); }
    if (files.length) handleFilesAndSave(files);
  });
}

async function loadAndRenderSavedModels() {
  savedModels = await getAllModels();
  renderModelList();
  if (activeModelData) { console.log('[MMD DEBUG] model already loaded, skip auto-load'); return; }
  var lastType = localStorage.getItem('mmd_last_applied_type');
  if (lastType === 'ai_images') { console.log('[MMD DEBUG] last was AI project, skip MMD auto-load'); return; }
  var lastId = localStorage.getItem('mmd_last_applied_id');
  if (lastId) {
    var m = savedModels.find(function(x) { return String(x.id) === String(lastId); });
    if (m) {
      activeModelData = m;
      console.log('[MMD DEBUG] auto-loading last model:', m.name);
      applyModelDirectly(m);
    }
  }
}

function loadPreviewModel(url, ext) {
  return new Promise((resolve) => {
    if (ext === 'pmx' || ext === 'pmd') {
      const loader = new MMDLoader(loaderManager);
      loader.load(url, resolve, undefined, () => resolve(null));
    } else if (ext === 'glb' || ext === 'gltf') {
      const gltfLoader = new GLTFLoader(loaderManager);
      gltfLoader.load(url, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
    } else if (ext === 'obj') {
      const objLoader = new OBJLoader(loaderManager);
      objLoader.load(url, resolve, undefined, () => resolve(null));
    } else {
      resolve(null);
    }
  });
}

async function renderModelPreviewImage(model) {
  const savedFileURLs = fileURLs, savedCreated = createdURLs;
  const sc = new THREE.Scene(); sc.background = null;
  // 与小窗口完全一致：FOV=45, near=0.1, far=1000
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const li = typeof lightIntensity === 'number' ? lightIntensity : 1.0;
  sc.add(new THREE.AmbientLight(0xffffff, 1.5 * li));
  const dl = new THREE.DirectionalLight(0xffffff, 2.2 * li); dl.position.set(1, 1, 1); sc.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.7 * li); dl2.position.set(-0.5, 0.2, -0.5); sc.add(dl2);
  const dl3 = new THREE.DirectionalLight(0xffffff, 0.4 * li); dl3.position.set(0, -0.5, 0); sc.add(dl3);

  fileURLs = new Map(); createdURLs = new Set();
  registerTexturePaths(model);
  _installImageInterceptor();

  const W = 2400, H = 3200;
  const timeoutSec = parseFloat(localStorage.getItem('mmdPreviewTimeout') || '5') || 5;
  try {
    const ext = (model.modelType || '').toLowerCase();
    let url = await getModelBlobURL(model);
    if (!url) return null;
    const loadPromise = loadPreviewModel(url, ext);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutSec * 1000));
    const m = await Promise.race([loadPromise, timeoutPromise]);
    URL.revokeObjectURL(url);
    if (!m) return null;
    m.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false;
      if (o.material) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map(mt => _fixMaterialLighting(mt));
        } else {
          o.material = _fixMaterialLighting(o.material);
        }
      }
    });
    sc.add(m);

    let meshCount = 0, texCount = 0, matCount = 0;
    m.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        meshCount++;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          matCount += mats.length;
          mats.forEach(mm => { if (mm.map && mm.map.image) texCount++; });
        }
      }
    });
    console.log('[MMD DEBUG] preview model loaded: meshes=' + meshCount + ' materials=' + matCount + ' texturesReady=' + texCount + ' name=' + model.name);

    const box = new THREE.Box3().setFromObject(m); const ct = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
    console.log('[MMD DEBUG] preview bbox size:', sz.x.toFixed(2), sz.y.toFixed(2), sz.z.toFixed(2), 'center:', ct.x.toFixed(2), ct.y.toFixed(2), ct.z.toFixed(2));
    const md = Math.max(sz.x, sz.y, sz.z, 0.01);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    const camZoom = (model.config && model.config.cameraZoom) ? model.config.cameraZoom : 1.15;
    const d = md / (2 * Math.tan(45 * Math.PI / 360)) * camZoom;
    cam.position.set(ct.x, ct.y, ct.z + d); cam.lookAt(ct);

    // 等待纹理异步加载完成
    const collectTexImages = (obj) => {
      const imgs = [];
      obj.traverse(o => {
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(mm => {
          // 检查所有可能的纹理属性
          ['map','gradientMap','envMap','sphereMap','aoMap','emissiveMap','alphaMap','bumpMap','normalMap','displacementMap','metalnessMap','roughnessMap'].forEach(key => {
            if (mm[key] && mm[key].image && mm[key].image instanceof HTMLImageElement) {
              imgs.push(mm[key].image);
            }
          });
        });
      });
      return imgs;
    };
    let texturesLoaded = 0;
    const maxWait = 10000, pollInterval = 200;
    for (let waited = 0; waited < maxWait; waited += pollInterval) {
      await new Promise(r => setTimeout(r, pollInterval));
      const imgs = collectTexImages(m);
      const loaded = imgs.filter(img => img.complete && img.naturalWidth > 0).length;
      if (loaded > texturesLoaded) { texturesLoaded = loaded; }
      if (imgs.length > 0 && loaded >= imgs.length) break;
    }
    console.log('[MMD DEBUG] preview textures loaded: ' + texturesLoaded);

    // 复刻小窗口：alpha:true + setClearColor(0,0,0,0) 透明背景
    const glCanvas = document.createElement('canvas'); glCanvas.width = W; glCanvas.height = H;
    const r = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(W, H);
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;

    const rt = new THREE.WebGLRenderTarget(W, H, { format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: true });
    const composer = new EffectComposer(r, rt);
    composer.addPass(new RenderPass(sc, cam));

    const outlinePass = new OutlinePass(new THREE.Vector2(W, H), sc, cam);
    outlinePass.edgeStrength = 8.0;
    outlinePass.edgeGlow = 0;
    outlinePass.edgeThickness = 2.0;
    outlinePass.pulsePeriod = 0;
    outlinePass.visibleEdgeColor.set('#3a2010');
    outlinePass.hiddenEdgeColor.set('#000000');
    composer.addPass(outlinePass);

    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.uniforms.resolution.value.set(1 / W, 1 / H);
    composer.addPass(fxaaPass);

    // alphaFix：反预乘 → smoothstep alpha → 重预乘（与小窗口一致）
    const alphaFix = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float a2 = c.a > 0.001 ? max(c.a, 0.0) : 0.0; vec3 rgb = a2 > 0.001 ? c.rgb / a2 : vec3(0.0); float aOut = smoothstep(0.0, 0.35, a2); gl_FragColor = vec4(rgb * aOut, aOut); }'
    });
    composer.addPass(alphaFix);

    // Saturation（与小窗口一致，默认值 1.0）
    const satPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, saturation: { value: typeof saturationValue === 'number' ? saturationValue : 1.0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform float saturation; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float gray = dot(c.rgb, vec3(0.299, 0.587, 0.114)); c.rgb = mix(vec3(gray), c.rgb, saturation); gl_FragColor = c; }'
    });
    composer.addPass(satPass);

    composer.render();
    await new Promise(rr => requestAnimationFrame(rr));
    composer.render();

    const rawPixels = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, rawPixels);
    r.dispose();
    rt.dispose();

    // 反预乘：render target 存储预乘 alpha，转 straight alpha 才能用 PNG
    for (let i = 0; i < rawPixels.length; i += 4) {
      const a = rawPixels[i + 3];
      if (a > 0) {
        rawPixels[i]     = Math.min(255, Math.round(rawPixels[i]     * 255 / a));
        rawPixels[i + 1] = Math.min(255, Math.round(rawPixels[i + 1] * 255 / a));
        rawPixels[i + 2] = Math.min(255, Math.round(rawPixels[i + 2] * 255 / a));
      }
    }

    const canvas2d = document.createElement('canvas');
    canvas2d.width = W; canvas2d.height = H;
    const ctx2d = canvas2d.getContext('2d');
    // 直接复制像素（已经反预乘，alpha 通道即透明度，无需黑转透明）
    const imgData = ctx2d.createImageData(W, H);
    const out = imgData.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = ((H - 1 - y) * W + x) * 4;
        const dstIdx = (y * W + x) * 4;
        out[dstIdx]     = rawPixels[srcIdx];
        out[dstIdx + 1] = rawPixels[srcIdx + 1];
        out[dstIdx + 2] = rawPixels[srcIdx + 2];
        out[dstIdx + 3] = rawPixels[srcIdx + 3];
      }
    }
    ctx2d.putImageData(imgData, 0, 0);
    const dataURL = canvas2d.toDataURL('image/png');

    sc.remove(m);
    m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(x => { try { x.dispose(); } catch(e) {} }); } });
    savePreviewToDisk(model.id, dataURL).catch(e => console.warn('[MMD] savePreviewToDisk failed:', e));
    model.previewImage = dataURL;
    return dataURL;
  } catch (e) { console.warn('[MMD] renderModelPreviewImage failed:', model.name, e.message || e); return null; }
  finally {
    if (createdURLs) { createdURLs.forEach(u => URL.revokeObjectURL(u)); createdURLs.clear(); }
    fileURLs = savedFileURLs; createdURLs = savedCreated;
  }
}


function drawCachedPreview(cardCanvas, dataURL) {
  if (!dataURL) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = cardCanvas.clientWidth || 180, ch = cardCanvas.clientHeight || 240;
  cardCanvas.width = Math.round(cw * dpr); cardCanvas.height = Math.round(ch * dpr);
  const img = new Image();
  img.onload = () => { const ctx = cardCanvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.clearRect(0, 0, cardCanvas.width, cardCanvas.height); ctx.drawImage(img, 0, 0, cardCanvas.width, cardCanvas.height); };
  img.src = dataURL;
}

async function generateCardPreviews() {
  const cards = listPanelEl.querySelectorAll('[data-model-card]');
  if (!cards.length) return;
  const toRender = [];
  for (const card of cards) {
    const id = Number(card.dataset.id);
    const model = savedModels.find(m => m.id === id);
    if (!model) continue;
    const mc = card.querySelector('.mmd-card-preview');
    if (!mc) continue;
    if (model.previewImage) {
      drawCachedPreview(mc, model.previewImage);
    } else {
      const dpr = window.devicePixelRatio || 1;
      const cw = mc.clientWidth || 180, ch = mc.clientHeight || 240;
      mc.width = Math.round(cw * dpr); mc.height = Math.round(ch * dpr);
      const ctx = mc.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, mc.width, mc.height);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = Math.round(12 * dpr) + 'px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('等待渲染...', mc.width/2, mc.height/2);
      toRender.push({ card, model, canvas: mc });
    }
  }
  for (const item of toRender) {
    const dataURL = await renderModelPreviewImage(item.model);
    if (dataURL) {
      item.model.previewImage = dataURL;
      drawCachedPreview(item.canvas, dataURL);
    }
  }
}

function renderModelList() {
  if (!listPanelEl) return;
  var leftEl = document.getElementById('mmd-list-left');
  if (!leftEl) { leftEl = listPanelEl; }
  const hasModels = savedModels.length > 0;
  leftEl.innerHTML = `
    <div class="mmd-list-header">
      <div class="mmd-list-title"><i class="fa-solid fa-cubes"></i> 模型列表</div>
      <div class="mmd-list-count">${hasModels ? savedModels.length + ' 个模型' : '暂无模型'}</div>
    </div>
    <div class="mmd-list-grid">
      <div class="mmd-model-card mmd-import-card" id="mmd-import-folder-card">
        <div class="mmd-card-icon"><i class="fa-solid fa-folder-plus"></i></div>
        <div class="mmd-card-label">导入文件夹</div>
        <div class="mmd-card-hint">加载整个模型文件夹</div>
      </div>
      <div class="mmd-model-card mmd-import-card" id="mmd-import-file-card">
        <div class="mmd-card-icon"><i class="fa-solid fa-file-import"></i></div>
        <div class="mmd-card-label">导入文件</div>
        <div class="mmd-card-hint">PMX / PMD / GLB / GLTF / OBJ / VRM</div>
      </div>
      <div class="mmd-model-card mmd-import-card" id="mmd-ai-only-card">
        <div class="mmd-card-icon"><i class="fa-solid fa-robot"></i></div>
        <div class="mmd-card-label">只使用AI功能</div>
        <div class="mmd-card-hint">图片 / GIF 项目 + AI</div>
      </div>
      ${savedModels.map(m => `
        <div class="mmd-model-card" data-id="${m.id}" data-model-card>
          <div class="mmd-card-header">
            <div class="mmd-card-name">${escapeHTML(m.name)}</div>
            <div class="mmd-card-type">${m.modelType ? m.modelType.toUpperCase() : '3D'}</div>
          </div>
          <div class="mmd-card-actions">
            <button class="mmd-card-btn mmd-card-refresh" data-action="refresh" data-id="${m.id}" title="刷新预览"><i class="fa-solid fa-arrows-rotate"></i></button>
            <button class="mmd-card-btn mmd-card-rename" data-action="rename" data-id="${m.id}" title="重命名模型"><i class="fa-solid fa-pen"></i></button>
            <button class="mmd-card-btn mmd-card-delete" data-action="delete" data-id="${m.id}" title="删除模型"><i class="fa-solid fa-trash"></i></button>
          </div>
          <canvas class="mmd-card-preview"></canvas>
          <div class="mmd-card-bottom">
            <button class="btn btn-outline mmd-card-config-btn" data-action="config" data-id="${m.id}" style="font-size:11px;padding:4px 10px;"><i class="fa-solid fa-gear"></i> 配置</button>
            <button class="btn btn-primary mmd-card-apply-btn" data-action="apply" data-id="${m.id}" style="font-size:11px;padding:4px 10px;"><i class="fa-solid fa-play"></i> 应用</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const folderCard = leftEl.querySelector('#mmd-import-folder-card');
  if (folderCard) {
    folderCard.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.addEventListener('change', (e) => {
        handleFilesAndSave(e.target.files);
        e.target.value = '';
      });
      input.click();
    });
  }
  const fileCard = leftEl.querySelector('#mmd-import-file-card');
  if (fileCard) {
    fileCard.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pmx,.pmd,.glb,.gltf,.obj,.vrm,.png,.jpg,.jpeg,.bmp,.tga,.gif,.webp';
      input.multiple = true;
      input.addEventListener('change', (e) => {
        handleFilesAndSave(e.target.files);
        e.target.value = '';
      });
      input.click();
    });
  }
  const aiOnlyCard = leftEl.querySelector('#mmd-ai-only-card');
  if (aiOnlyCard) {
    aiOnlyCard.addEventListener('click', () => {
      showAIOnlyView();
    });
  }

  leftEl.querySelectorAll('[data-model-card]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      const id = Number(card.dataset.id);
      const model = savedModels.find(m => m.id === id);
      if (model) openModelConfig(model);
    });
  });

  leftEl.querySelectorAll('[data-action="rename"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const model = savedModels.find(m => m.id === id);
      if (!model) return;
      const newName = await showPromptDialog('重命名模型', '请输入新名称：', model.name);
      if (newName && newName.trim()) {
        await renameModelOnDisk(id, newName.trim());
        await loadAndRenderSavedModels();
      }
    });
  });

  leftEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const model = savedModels.find(m => m.id === id);
      if (!model) return;
      const confirmed = await showConfirmDialog('删除模型', `确定要删除模型「${model.name}」吗？此操作不可撤销。`, '确定删除', '取消');
      if (confirmed) {
        await deleteModelFromDisk(id);
        await loadAndRenderSavedModels();
      }
    });
  });

  leftEl.querySelectorAll('[data-action="config"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const model = savedModels.find(m => m.id === id);
      if (model) openModelConfig(model);
    });
  });

  leftEl.querySelectorAll('[data-action="apply"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const model = savedModels.find(m => m.id === id);
      if (!model) return;
      applyModelDirectly(model);
    });
  });

  leftEl.querySelectorAll('[data-action="refresh"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const model = savedModels.find(m => m.id === id);
      if (!model) return;
      const card = btn.closest('[data-model-card]');
      const mc = card ? card.querySelector('.mmd-card-preview') : null;
      if (mc) {
        const dpr = window.devicePixelRatio || 1;
        const cw = mc.clientWidth || 180, ch = mc.clientHeight || 240;
        mc.width = Math.round(cw * dpr); mc.height = Math.round(ch * dpr);
        const ctx = mc.getContext('2d');
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, mc.width, mc.height);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = Math.round(12 * dpr) + 'px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('渲染中...', mc.width/2, mc.height/2);
      }
      const dataURL = await renderModelPreviewImage(model);
      if (dataURL && mc) drawCachedPreview(mc, dataURL);
    });
  });

  setTimeout(() => generateCardPreviews(), 150);
}

async function openModelConfig(modelData, autoApply) {
  activeModelData = modelData;
  currentView = 'config';
  listPanelEl.style.display = 'none';
  configPanelEl.style.display = '';

  const url = await getModelBlobURL(modelData);
  if (!url) { mmdToast('模型文件不存在', 'error'); return; }
  const ext = modelData.modelType || '';

  textureFileMap = new Map();
  const oldFileURLs = fileURLs;
  const oldCreated = createdURLs;
  const oldUnmatched = unmatchedTextures;
  fileURLs = new Map();
  createdURLs = new Set();
  unmatchedTextures = new Set();
  const texFiles = modelData.textureFiles || [];
  texFiles.forEach(tf => {
    const u = 'file:///' + tf.path.replace(/\\/g, '/');
    createdURLs.add(u);
    textureFileMap.set(tf.name.toLowerCase(), u);
    const key = tf.name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/,'');
    fileURLs.set(key, u);
    fileURLs.set(key.toLowerCase(), u);
    const base = key.slice(key.lastIndexOf('/') + 1);
    fileURLs.set(base, u);
    fileURLs.set(base.toLowerCase(), u);
    const encodings = tryEncodings(base);
    encodings.forEach(en => {
      if (en !== base) { fileURLs.set(en, u); fileURLs.set(en.toLowerCase(), u); }
    });
  });
  function restoreURLs() { fileURLs = oldFileURLs; createdURLs = oldCreated; unmatchedTextures = oldUnmatched; }

  const savedCfg = modelData.config || {};
  bloomEnabled = savedCfg.bloomEnabled !== undefined ? savedCfg.bloomEnabled : false;
  outlineEnabled = savedCfg.outlineEnabled !== undefined ? savedCfg.outlineEnabled : false;
  saturationValue = savedCfg.saturationValue !== undefined ? savedCfg.saturationValue : 1.0;
  if (savedCfg.lightIntensity !== undefined) lightIntensity = savedCfg.lightIntensity;
  const cfgCamZoom = savedCfg.cameraZoom !== undefined ? savedCfg.cameraZoom : 1.15;
  const cfgBloomStr = savedCfg.bloomStrength !== undefined ? savedCfg.bloomStrength : 0.2;
  const cfgMiniW = savedCfg.miniW || 180;
  const cfgMiniH = savedCfg.miniH || 220;

  const pmxTexNames = modelData.pmxTextureNames || [];
  const hasPmxTextures = pmxTexNames.length > 0;

  configPanelEl.innerHTML = `
    <div class="mmd-config-topbar">
      <button class="btn btn-outline mmd-back-btn"><i class="fa-solid fa-arrow-left"></i> 返回模型列表</button>
      <div class="mmd-config-model-name">${escapeHTML(modelData.name)}</div>
    </div>
    <div class="mmd-config-body">
      <div class="mmd-config-sidebar">
      <div class="mmd-config-section">
        <div class="mmd-config-section-title"><i class="fa-solid fa-palette"></i> 视觉效果</div>
        <label class="mmd-row"><input type="checkbox" id="mmd-bloom" ${bloomEnabled ? 'checked' : ''}> 光晕效果</label>
        <label class="mmd-row"><input type="checkbox" id="mmd-outline" ${outlineEnabled ? 'checked' : ''}> 描边效果</label>
        <label class="mmd-row">饱和度 <input type="range" id="mmd-sat" min="0" max="2" step="0.01" value="${saturationValue}" style="width:100px"> <span id="mmd-sat-val">${saturationValue.toFixed(2)}</span></label>
        <label class="mmd-row">光晕强度 <input type="range" id="mmd-bloom-str" min="0" max="1" step="0.01" value="${cfgBloomStr}" style="width:100px"> <span id="mmd-bloom-str-val">${cfgBloomStr.toFixed(2)}</span></label>
        <label class="mmd-row">光线亮度 <input type="range" id="mmd-light-intensity" min="0.3" max="3" step="0.1" value="${lightIntensity}" style="width:100px"> <span id="mmd-light-val">${lightIntensity.toFixed(1)}</span></label>
      </div>
      <div class="mmd-config-section">
        <div class="mmd-config-section-title"><i class="fa-solid fa-window-maximize"></i> 小窗口</div>
        <button class="btn btn-primary mmd-create-mini" style="width:100%;margin-bottom:8px;">添加该模型</button>
        <label class="mmd-row">小窗宽度 <input type="range" id="mmd-mini-w" min="120" max="400" step="10" value="${cfgMiniW}" style="width:80px"> <span id="mmd-mini-w-val">${cfgMiniW}</span>px</label>
        <label class="mmd-row">小窗高度 <input type="range" id="mmd-mini-h" min="160" max="500" step="10" value="${cfgMiniH}" style="width:80px"> <span id="mmd-mini-h-val">${cfgMiniH}</span>px</label>
        <label class="mmd-row">摄像机缩放 <input type="range" id="mmd-cam-zoom" min="0.5" max="5" step="0.05" value="${cfgCamZoom}" style="width:100px"> <span id="mmd-cam-zoom-val">${cfgCamZoom.toFixed(2)}</span></label>
      </div>
      <div class="mmd-config-section">
        <div class="mmd-config-section-title"><i class="fa-solid fa-images"></i> 贴图管理</div>
        ${hasPmxTextures ? renderTextureList(pmxTexNames) : '<div class="mmd-texture-msg">该模型暂时无法加载贴图，请尝试手动导入贴图到该模型</div>'}
        <button class="btn btn-outline mmd-import-texture-btn" style="width:100%;margin-top:8px;"><i class="fa-solid fa-image"></i> 导入贴图</button>
        <input type="file" id="mmd-texture-input" multiple accept="image/*" hidden>
      </div>
      <button class="btn btn-primary mmd-save-config-btn" style="width:100%;margin-top:8px;"><i class="fa-solid fa-floppy-disk"></i> 保存配置</button>
      <div id="mmd-status" class="mmd-status">模型已加载</div>
      </div>
      <div class="mmd-canvas-wrap" id="mmd-config-canvas"></div>
    </div>
  `;

  configPanelEl.querySelector('.mmd-back-btn').addEventListener('click', async () => {
    const current = { bloomEnabled, outlineEnabled, saturationValue, lightIntensity, bloomStr: bloomPass ? bloomPass.strength : 0.2, miniW: parseInt(configPanelEl.querySelector('#mmd-mini-w').value) || 180, miniH: parseInt(configPanelEl.querySelector('#mmd-mini-h').value) || 220, cameraZoom: parseFloat(configPanelEl.querySelector('#mmd-cam-zoom').value) || 1.15 };
    const changed = initialConfigSnapshot ? JSON.stringify(current) !== JSON.stringify(initialConfigSnapshot) : true;
    if (changed) {
      const choice = await showConfirmDialog('返回模型列表', '是否保存新配置？', '保存', '不保存', '取消');
      if (choice === null) return;
      if (choice) {
        const cfg = { bloomEnabled, outlineEnabled, saturationValue, bloomStrength: bloomPass ? bloomPass.strength : 0.2, lightIntensity, miniW: parseInt(configPanelEl.querySelector('#mmd-mini-w').value) || 180, miniH: parseInt(configPanelEl.querySelector('#mmd-mini-h').value) || 220, cameraZoom: parseFloat(configPanelEl.querySelector('#mmd-cam-zoom').value) || 1.15 };
        await saveModelConfigToDisk(activeModelData.id, cfg);
        activeModelData.config = cfg;
      }
    }
    disposeCurrent();
    activeModelData = null;
    textureFileMap = null;
    restoreURLs();
    if (renderer && renderer.domElement && mainCanvasWrap) {
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      mainCanvasWrap.appendChild(renderer.domElement);
      const r = containerEl.getBoundingClientRect();
      renderer.setSize(r.width, r.height);
      if (composer) composer.setSize(r.width, r.height);
      if (camera) { camera.aspect = r.width / Math.max(r.height, 1); camera.updateProjectionMatrix(); }
    }
    listPanelEl.style.display = '';
    configPanelEl.style.display = 'none';
    renderModelList();
    renderAnimPanel(activeAppliedModelData);
  });

  const canvasWrap = configPanelEl.querySelector('#mmd-config-canvas');
  if (canvasWrap && renderer && renderer.domElement) {
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    canvasWrap.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    const cr = canvasWrap.getBoundingClientRect();
    let w = cr.width, h = cr.height;
    if (w <= 0 || h <= 0) {
      const pr = configPanelEl.getBoundingClientRect();
      w = pr.width - 270; h = pr.height - 50;
    }
    if (w <= 0) w = 400;
    if (h <= 0) h = 300;
    renderer.setSize(w, h);
    if (composer) composer.setSize(w, h);
    if (camera) { camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); }
  }

  bindConfigControls();

  initialConfigSnapshot = { bloomEnabled, outlineEnabled, saturationValue, lightIntensity, bloomStr: bloomPass ? bloomPass.strength : 0.2, miniW: parseInt(configPanelEl.querySelector('#mmd-mini-w').value) || 180, miniH: parseInt(configPanelEl.querySelector('#mmd-mini-h').value) || 220, cameraZoom: parseFloat(configPanelEl.querySelector('#mmd-cam-zoom').value) || 1.15 };

  configPanelEl.querySelector('.mmd-save-config-btn').addEventListener('click', async () => {
    const cfg = { bloomEnabled, outlineEnabled, saturationValue, bloomStrength: bloomPass ? bloomPass.strength : 0.2, lightIntensity, miniW: parseInt(configPanelEl.querySelector('#mmd-mini-w').value) || 180, miniH: parseInt(configPanelEl.querySelector('#mmd-mini-h').value) || 220, cameraZoom: parseFloat(configPanelEl.querySelector('#mmd-cam-zoom').value) || 1.15 };
    await saveModelConfigToDisk(activeModelData.id, cfg);
    activeModelData.config = cfg;
    const st = configPanelEl.querySelector('#mmd-status');
    if (st) { st.textContent = '配置已保存'; st.classList.remove('err'); }
  });

  configPanelEl.querySelector('.mmd-create-mini').addEventListener('click', () => {
    if (!activeModelData) return;
    const w = parseInt(configPanelEl.querySelector('#mmd-mini-w').value) || 180;
    const h = parseInt(configPanelEl.querySelector('#mmd-mini-h').value) || 220;
    if (!activeModelData.config) activeModelData.config = {};
    activeModelData.config.miniW = w;
    activeModelData.config.miniH = h;
    activeModelData.config.saturationValue = saturationValue;
    activeModelData.config.lightIntensity = lightIntensity;
    activeModelData.config.bloomEnabled = bloomEnabled;
    activeModelData.config.outlineEnabled = outlineEnabled;
    if (bloomPass) activeModelData.config.bloomStrength = bloomPass.strength;
    applyModelDirectly(activeModelData);
  });

  configPanelEl.querySelector('.mmd-import-texture-btn').addEventListener('click', () => {
    configPanelEl.querySelector('#mmd-texture-input').click();
  });

  configPanelEl.querySelector('#mmd-texture-input').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const pmxNames = (activeModelData && activeModelData.pmxTextureNames) ? activeModelData.pmxTextureNames : [];
    const pmxNameSet = new Set(pmxNames.map(n => n.toLowerCase()));
    const matched = [];
    const unmatched = [];
    for (const f of files) {
      const name = f.name.toLowerCase();
      if (pmxNameSet.has(name)) {
        matched.push({ name: f.name, blob: f });
      } else {
        unmatched.push(f.name);
      }
    }
    if (unmatched.length) {
      alert('以下贴图文件名与 PMX 模型不匹配，已跳过：\n' + unmatched.join('\n'));
    }
    if (matched.length) {
      const existing = activeModelData.textureBlobs || [];
      const merged = [...existing];
      for (const m of matched) {
        const idx = merged.findIndex(t => t.name.toLowerCase() === m.name.toLowerCase());
        if (idx >= 0) merged[idx] = m;
        else merged.push(m);
      }
      await updateTexturesOnDisk(activeModelData.id, matched);
      activeModelData.textureFiles = texFiles;
      for (const m of matched) {
        if (textureFileMap) textureFileMap.set(m.name.toLowerCase(), URL.createObjectURL(m.blob));
      }
      savedModels = await getAllModels();
      openModelConfig(activeModelData);
    }
    e.target.value = '';
  });

  const statusEl = configPanelEl.querySelector('#mmd-status');

  createdURLs = createdURLs || new Set();
  createdURLs.add(url);

  loadModelFromURL(url, ext, statusEl, null);
}

function renderTextureList(pmxTexNames) {
  if (!pmxTexNames.length) return '';
  const loadedNames = new Set();
  if (textureFileMap) {
    textureFileMap.forEach((_, k) => loadedNames.add(k));
  }
  let html = '<div class="mmd-texture-list">';
  pmxTexNames.forEach(name => {
    const key = name.toLowerCase();
    const loaded = loadedNames.has(key);
    html += `<div class="mmd-texture-item ${loaded ? 'loaded' : 'missing'}">
      <i class="fa-solid fa-${loaded ? 'check-circle' : 'circle-xmark'}"></i>
      <span>${escapeHTML(name)}</span>
      <span class="mmd-texture-status">${loaded ? '已加载' : '缺失'}</span>
    </div>`;
  });
  html += '</div>';
  return html;
}

function bindConfigControls() {
  const p = configPanelEl;
  if (!p) return;
  const bloomCb = p.querySelector('#mmd-bloom');
  const outlineCb = p.querySelector('#mmd-outline');
  const satSlider = p.querySelector('#mmd-sat');
  const bloomStrSlider = p.querySelector('#mmd-bloom-str');

  if (bloomCb) bloomCb.addEventListener('change', e => {
    bloomEnabled = e.target.checked;
    if (bloomPass) bloomPass.enabled = bloomEnabled;
    updateComposerState();
  });
  if (outlineCb) outlineCb.addEventListener('change', e => {
    outlineEnabled = e.target.checked;
    refreshOutline();
    updateComposerState();
  });
  if (satSlider) satSlider.addEventListener('input', e => {
    saturationValue = parseFloat(e.target.value);
    const valEl = p.querySelector('#mmd-sat-val');
    if (valEl) valEl.textContent = saturationValue.toFixed(2);
    if (saturationPass) saturationPass.uniforms.saturation.value = saturationValue;
    updateMiniGlow();
  });
  if (bloomStrSlider) bloomStrSlider.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    const valEl = p.querySelector('#mmd-bloom-str-val');
    if (valEl) valEl.textContent = v.toFixed(2);
    if (bloomPass) bloomPass.strength = v;
    updateMiniGlow();
  });

  const lightSlider = p.querySelector('#mmd-light-intensity');
  if (lightSlider) lightSlider.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    const valEl = p.querySelector('#mmd-light-val');
    if (valEl) valEl.textContent = v.toFixed(1);
    setLightIntensity(v);
  });

  const miniW = p.querySelector('#mmd-mini-w');
  const miniH = p.querySelector('#mmd-mini-h');
  if (miniW) miniW.addEventListener('input', e => {
    p.querySelector('#mmd-mini-w-val').textContent = e.target.value;
  });
  if (miniH) miniH.addEventListener('input', e => {
    p.querySelector('#mmd-mini-h-val').textContent = e.target.value;
  });
  var camZoom = p.querySelector('#mmd-cam-zoom');
  if (camZoom) camZoom.addEventListener('input', function(e) {
    p.querySelector('#mmd-cam-zoom-val').textContent = parseFloat(e.target.value).toFixed(2);
  });
}

function setLightIntensity(val) {
  lightIntensity = val;
  if (hemiLight) hemiLight.intensity = 1.8 * val;
  if (keyLight) keyLight.intensity = 1.7 * val;
  if (rimLight) rimLight.intensity = 0.9 * val;
}

function updateMiniGlow() {
  if (!miniRenderer || !miniRenderer.domElement) return;
  const strength = bloomPass ? bloomPass.strength : 0.3;
  const sat = saturationValue;
  const glowSize = Math.round(strength * 40);
  const alpha = Math.min(strength * 0.8 + 0.15, 0.65);
  const r = Math.round(255 * (0.7 + sat * 0.15));
  const g = Math.round(200 * (0.6 + sat * 0.2));
  const b = Math.round(100 * (0.6 + sat * 0.2));
  miniRenderer.domElement.style.filter = 'none';
  miniGlowColor = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
  miniGlowSize = glowSize;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function showConfirmDialog(title, message, confirmLabel, cancelLabel, dismissLabel) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('generic-dialog');
    const titleEl = document.getElementById('generic-dialog-title');
    const msgEl = document.getElementById('generic-dialog-msg');
    const inputEl = document.getElementById('generic-dialog-input');
    const cancelEl = document.getElementById('generic-dialog-cancel');
    const confirmEl = document.getElementById('generic-dialog-confirm');
    if (!overlay) { resolve(confirm(message)); return; }
    titleEl.textContent = title;
    msgEl.textContent = message;
    inputEl.style.display = 'none';
    cancelEl.style.display = '';
    confirmEl.style.display = '';
    overlay.classList.add('show');
    let dismissEl = overlay.querySelector('.generic-dialog-dismiss');
    if (dismissLabel) {
      if (!dismissEl) {
        dismissEl = document.createElement('button');
        dismissEl.className = 'btn btn-outline generic-dialog-dismiss';
        confirmEl.parentNode.insertBefore(dismissEl, cancelEl);
      }
      dismissEl.textContent = dismissLabel;
      dismissEl.style.display = '';
    } else if (dismissEl) {
      dismissEl.style.display = 'none';
    }
    function cleanup(ok) {
      overlay.classList.remove('show');
      resolve(ok);
    }
    confirmEl.onclick = () => cleanup(true);
    cancelEl.onclick = () => cleanup(false);
    if (dismissEl) dismissEl.onclick = () => cleanup(null);
    if (confirmLabel) confirmEl.textContent = confirmLabel;
    if (cancelLabel) cancelEl.textContent = cancelLabel;
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
  });
}

async function showPromptDialog(title, message, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('generic-dialog');
    const titleEl = document.getElementById('generic-dialog-title');
    const msgEl = document.getElementById('generic-dialog-msg');
    const inputEl = document.getElementById('generic-dialog-input');
    const cancelEl = document.getElementById('generic-dialog-cancel');
    const confirmEl = document.getElementById('generic-dialog-confirm');
    if (!overlay) { resolve(prompt(message, defaultValue)); return; }
    titleEl.textContent = title;
    msgEl.textContent = message;
    inputEl.style.display = '';
    inputEl.value = defaultValue || '';
    cancelEl.style.display = '';
    overlay.classList.add('show');
    inputEl.focus();
    inputEl.select();
    function cleanup(val) {
      overlay.classList.remove('show');
      resolve(val);
    }
    confirmEl.onclick = () => cleanup(inputEl.value);
    cancelEl.onclick = () => cleanup(null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
  });
}

async function showModelSelectDialog(modelFiles) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('generic-dialog');
    const titleEl = document.getElementById('generic-dialog-title');
    const msgEl = document.getElementById('generic-dialog-msg');
    const inputEl = document.getElementById('generic-dialog-input');
    const cancelEl = document.getElementById('generic-dialog-cancel');
    const confirmEl = document.getElementById('generic-dialog-confirm');
    if (!overlay) { resolve(modelFiles[0]); return; }
    titleEl.textContent = '选择模型';
    msgEl.innerHTML = '<div class="mmd-model-select-list">' + modelFiles.map((f, i) =>
      '<label class="mmd-model-select-item"><input type="radio" name="mmd-model-sel" value="' + i + '" ' + (i === 0 ? 'checked' : '') + '> ' + escapeHTML(f.name) + ' <span class="mmd-model-select-size">(' + (f.size / 1024 / 1024).toFixed(1) + ' MB)</span></label>'
    ).join('') + '</div>';
    inputEl.style.display = 'none';
    cancelEl.style.display = '';
    confirmEl.style.display = '';
    confirmEl.textContent = '加载选中模型';
    cancelEl.textContent = '取消';
    overlay.classList.add('show');
    const dismissEl = overlay.querySelector('.generic-dialog-dismiss');
    if (dismissEl) dismissEl.style.display = 'none';
    confirmEl.onclick = () => {
      const sel = overlay.querySelector('input[name="mmd-model-sel"]:checked');
      const idx = sel ? parseInt(sel.value) : 0;
      overlay.classList.remove('show');
      resolve(modelFiles[idx] || modelFiles[0]);
    };
    cancelEl.onclick = () => { overlay.classList.remove('show'); resolve(null); };
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.classList.remove('show'); resolve(null); } };
  });
}

async function handleFilesAndSave(files) {
  if (!files || !files.length) return;
  const arr = Array.from(files);
  const allModelFiles = arr.filter(f => MODEL_EXT.test(f.name));
  if (!allModelFiles.length) {
    mmdToast('未找到支持的模型文件（PMX/PMD/GLB/GLTF/OBJ/VRM）', 'warning', '导入模型');
    return;
  }
  let modelFile;
  if (allModelFiles.length === 1) {
    modelFile = allModelFiles[0];
  } else {
    modelFile = await showModelSelectDialog(allModelFiles);
    if (!modelFile) return;
  }
  const ext = modelFile.name.slice(modelFile.name.lastIndexOf('.') + 1).toLowerCase();
  const magicInfo = await readMagic(modelFile);
  console.log('[MMD DEBUG] handleFilesAndSave modelFile:', modelFile.name, 'size:', magicInfo.size, 'magic:', magicInfo.hex);
  if (ext === 'pmx' || ext === 'pmd') {
    const head = new Uint8Array(await modelFile.slice(0, 4).arrayBuffer());
    const magic = String.fromCharCode(...head);
    if (ext === 'pmx' && magic !== 'PMX ') {
      mmdToast('文件 ' + modelFile.name + ' 不是有效的 PMX 模型（文件头: ' + JSON.stringify(magic) + '）', 'error', 'PMX 格式错误');
      return;
    }
    if (ext === 'pmd' && magic !== 'PMD ') {
      mmdToast('文件 ' + modelFile.name + ' 不是有效的 PMD 模型（文件头: ' + JSON.stringify(magic) + '）', 'error', 'PMD 格式错误');
      return;
    }
  }
  const texFiles = arr.filter(f => /\.(png|jpg|jpeg|bmp|tga|gif|webp|dds)$/i.test(f.name));

  const pmxTexNames = [];
  if (ext === 'pmx' || ext === 'pmd') {
    try {
      const buf = await modelFile.arrayBuffer();
      const texRefs = extractPMXTextureNames(buf, ext);
      pmxTexNames.push(...texRefs);
    } catch (e) {}
  }

  const id = await saveModelToDisk(
    modelFile.name.replace(MODEL_EXT, ''),
    modelFile,
    texFiles,
    ext,
    pmxTexNames
  );
  console.log('[MMD DEBUG] saveModelToDisk returned id:', id);

  savedModels = await getAllModels();
  console.log('[MMD DEBUG] getAllModels returned', savedModels.length, 'models');
  renderModelList();

  const saved = savedModels.find(m => m.id === id);
  if (saved) openModelConfig(saved);
}

function extractPMXTextureNames(buffer, ext) {
  const names = [];
  try {
    const view = new DataView(buffer);
    let offset = 0;

    if (ext === 'pmx') {
      const sig = new Uint8Array(buffer, 0, 4);
      const sigStr = String.fromCharCode(...sig);
      if (sigStr !== 'PMX ' && sigStr !== 'PMXP') return names;
      const version = view.getFloat32(4, true);
      if (!(Math.abs(version - 2.0) < 0.01 || Math.abs(version - 2.1) < 0.01)) return names;
      const encodingFlag = view.getUint8(8);
      const decoder = encodingFlag === 0 ? new TextDecoder('utf-16le') : new TextDecoder('utf-8');
      const textLenSize = encodingFlag === 0 ? 4 : 1;
      const boneIdxSize = view.getUint8(13);
      offset = 16;

      function skipText() {
        const len = textLenSize === 4 ? view.getUint32(offset, true) : view.getUint8(offset);
        offset += textLenSize + len;
      }
      skipText(); skipText(); skipText(); skipText();

      const vertexCount = view.getUint32(offset, true); offset += 4;
      for (let v = 0; v < Math.min(vertexCount, 500000); v++) {
        if (offset + 36 > buffer.byteLength) break;
        offset += 12 + 12 + 8;
        const addUV = view.getUint8(9);
        if (addUV > 0 && addUV <= 4) offset += addUV * 16;
        const weightType = view.getUint8(offset); offset += 1;
        offset += boneIdxSize * (weightType === 0 ? 1 : weightType === 1 ? 2 : 4);
        offset += 4 * (weightType === 0 ? 1 : weightType === 1 ? 2 : 4);
        if (weightType === 3) offset += 36;
        offset += 4;
      }

      const indexCount = view.getUint32(offset, true); offset += 4;
      const idxSize = view.getUint8(10);
      offset += indexCount * idxSize;

      const texCount = view.getUint32(offset, true); offset += 4;
      for (let i = 0; i < Math.min(texCount, 200); i++) {
        if (offset >= buffer.byteLength) break;
        const nameLen = textLenSize === 4 ? view.getUint32(offset, true) : view.getUint8(offset);
        offset += textLenSize;
        if (nameLen > 0 && nameLen < 1024 && offset + nameLen <= buffer.byteLength) {
          const nameBytes = new Uint8Array(buffer, offset, nameLen);
          let texName = decoder.decode(nameBytes);
          texName = texName.replace(/\*\d+$/, '');
          if (!/\.(png|jpg|jpeg|bmp|tga|gif|dds|webp)$/i.test(texName)) texName += '.png';
          names.push(texName);
          offset += nameLen;
        }
      }
    } else if (ext === 'pmd') {
      const sig = new Uint8Array(buffer, 0, 4);
      const sigStr = String.fromCharCode(...sig);
      if (sigStr !== 'PMD ') return names;
      const decoder = new TextDecoder('shift-jis');
      offset = 4;
      offset += 20;
      const modelNameLen = 20; offset += modelNameLen;
      const commentLen = 256; offset += commentLen;
      const vertexCount = view.getUint32(offset, true); offset += 4;
      offset += vertexCount * 38;
      const indexCount = view.getUint32(offset, true); offset += 4;
      offset += indexCount * 2;
      const materialCount = view.getUint32(offset, true); offset += 4;
      for (let m = 0; m < Math.min(materialCount, 1000); m++) {
        if (offset + 70 > buffer.byteLength) break;
        offset += 64;
        const toonIdx = view.getUint8(offset); offset += 4;
        const faceCount = view.getUint32(offset, true); offset += 4;
        const texNameBytes = new Uint8Array(buffer, offset, 20);
        offset += 20;
        let texName = decoder.decode(texNameBytes).replace(/\0+$/, '');
        if (texName && texName !== '\0') {
          if (!/\.(png|jpg|jpeg|bmp|tga|gif|dds|webp)$/i.test(texName)) {
            if (texName.length > 0) texName += '.png';
          }
          names.push(texName);
        }
      }
    }
  } catch (e) { console.warn('[MMD] extractPMXTextureNames error:', e); }
  return names;
}

function loadModelFromURL(url, ext, statusEl, sourceBlob) {
  disposeCurrent();
  _installImageInterceptor();
  const lower = ext.toLowerCase();
  console.log('[MMD DEBUG] loadModelFromURL url:', url, 'ext:', lower, 'hasSourceBlob:', !!sourceBlob);
  if (url.startsWith('blob:') && !/\.(pmx|pmd|glb|gltf|obj)$/i.test(url)) {
    url = url + '#.' + lower;
  }
  if (statusEl) {
    statusEl.textContent = '正在加载模型...';
    statusEl.classList.remove('err');
  }

  if (lower === 'pmx' || lower === 'pmd') {
    fetch(url).then(r => r.arrayBuffer()).then(buf => {
      const b = new Uint8Array(buf).slice(0, 4);
      console.log('[MMD DEBUG] fetch verify: first 4 bytes =', Array.from(b).map(x => x.toString(16).padStart(2,'0')).join(' '));
    }).catch(() => {});
    const loader = new MMDLoader(loaderManager);
    loader.load(url, (model) => {
      console.log('[MMD DEBUG] PMX model loaded, type:', model ? model.type || model.constructor.name : 'null', 'hasMeshes:', model ? (()=>{let n=0;model.traverse(o=>{if(o.isMesh||o.isSkinnedMesh)n++});return n})() : 0);
      onModelLoaded(model, statusEl);
    }, (xhr) => {
      if (statusEl && xhr.total) {
        statusEl.textContent = '加载中 ' + Math.round(xhr.loaded / xhr.total * 100) + '%';
      }
    }, (err) => {
      const msg = '加载失败: ' + (err.message || err);
      if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('err'); }
      console.warn('[MMD DEBUG] PMX load error (interceptor stays):', msg);
      mmdToast(msg, 'error', '模型加载错误');
    });
  } else if (lower === 'glb' || lower === 'gltf') {
    const loader = new GLTFLoader(loaderManager);
    loader.load(url, (gltf) => {
      onModelLoaded(gltf.scene || gltf, statusEl);
    }, undefined, (err) => {
      const msg = '加载失败: ' + (err.message || err);
      if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('err'); }
      console.warn('[MMD DEBUG] GLTF load error (interceptor stays):', msg);
      mmdToast(msg, 'error', '模型加载错误');
    });
  } else if (lower === 'obj') {
    const loader = new OBJLoader(loaderManager);
    loader.load(url, (model) => {
      onModelLoaded(model, statusEl);
    }, undefined, (err) => {
      const msg = '加载失败: ' + (err.message || err);
      if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('err'); }
      console.warn('[MMD DEBUG] OBJ load error (interceptor stays):', msg);
      mmdToast(msg, 'error', '模型加载错误');
    });
  }
}

async function applyModelDirectly(modelData) {
  const ext = modelData.modelType || '';

  const tempURLs = new Map();
  const tempCreated = new Set();
  const texFiles = modelData.textureFiles || [];
  texFiles.forEach(tf => {
    const u = 'file:///' + tf.path.replace(/\\/g, '/');
    tempCreated.add(u);
    const key = tf.name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/,'');
    tempURLs.set(key, u);
    tempURLs.set(key.toLowerCase(), u);
    const base = key.slice(key.lastIndexOf('/') + 1);
    tempURLs.set(base, u);
    tempURLs.set(base.toLowerCase(), u);
    const encodings = tryEncodings(base);
    encodings.forEach(en => {
      if (en !== base) { tempURLs.set(en, u); tempURLs.set(en.toLowerCase(), u); }
    });
  });

  const oldFileURLs = fileURLs;
  const oldCreated = createdURLs;
  const oldUnmatched = unmatchedTextures;
  fileURLs = tempURLs;
  createdURLs = tempCreated;
  unmatchedTextures = new Set();

  const cfg = modelData.config || {};
  if (cfg.bloomStrength !== undefined && bloomPass) bloomPass.strength = cfg.bloomStrength;
  if (cfg.saturationValue !== undefined) saturationValue = cfg.saturationValue;
  if (cfg.lightIntensity !== undefined) lightIntensity = cfg.lightIntensity;
  const miniW = cfg.miniW || 180;
  const miniH = cfg.miniH || 220;
  const miniCamZoom = cfg.cameraZoom || 1.15;

  const sourceUrl = await getModelBlobURL(modelData);
  if (!sourceUrl) { mmdToast('模型文件不存在', 'error'); return; }
  tempCreated.add(sourceUrl);

  _installImageInterceptor();
  const lower = ext.toLowerCase();
  const onLoaded = (model) => {
    activeAppliedModelData = modelData;
    activeModelData = modelData;
    createMiniViewer(model, miniW, miniH, miniCamZoom);
    updateMiniGlow();
    fileURLs = oldFileURLs;
    createdURLs = oldCreated;
    unmatchedTextures = oldUnmatched;
    localStorage.setItem('mmd_last_applied_id', String(modelData.id));
    localStorage.setItem('mmd_last_applied_type', 'mmd');
    renderAnimPanel(modelData);
  };
  const onError = (err) => {
    fileURLs = oldFileURLs;
    createdURLs = oldCreated;
    unmatchedTextures = oldUnmatched;
    console.error('applyModelDirectly error:', err);
  };
  if (lower === 'pmx' || lower === 'pmd') {
    new MMDLoader(loaderManager).load(sourceUrl, (model) => {
      console.log('[MMD DEBUG] applyModelDirectly PMX model loaded, id:', modelData.id);
      onLoaded(model);
    }, undefined, (err) => { mmdToast('加载失败: ' + (err.message || err), 'error', '模型加载错误'); onError(err); });
  } else if (lower === 'glb' || lower === 'gltf') {
    new GLTFLoader(loaderManager).load(sourceUrl, gltf => onLoaded(gltf.scene || gltf), undefined, (err) => { mmdToast('加载失败: ' + (err.message || err), 'error', '模型加载错误'); onError(err); });
  } else if (lower === 'obj') {
    new OBJLoader(loaderManager).load(sourceUrl, onLoaded, undefined, (err) => { mmdToast('加载失败: ' + (err.message || err), 'error', '模型加载错误'); onError(err); });
  }
}

function disposeMiniViewer() {
  _miniStopped = true;
  if (miniAnimId) { cancelAnimationFrame(miniAnimId); miniAnimId = null; }
  if (miniModel && miniScene) {
    miniScene.remove(miniModel);
    miniModel.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const l = Array.isArray(o.material) ? o.material : [o.material]; l.forEach(m => m.dispose()); }
    });
    miniModel = null;
  }
  if (miniComposer) {
    miniComposer.renderer.dispose();
    miniComposer.passes.forEach(p => { if (p.renderTarget && p.renderTarget !== miniRT) p.renderTarget.dispose(); });
    miniComposer = null;
  }
  if (miniRT) { miniRT.dispose(); miniRT = null; }
  if (miniRenderer) { miniRenderer.dispose(); miniRenderer = null; }
  if (miniMixer) { miniMixer.stopAllAction(); miniMixer = null; }
  miniAnimClip = null;
  if (miniContainer) {
    if (miniContainer._resizeHandler) window.removeEventListener('resize', miniContainer._resizeHandler);
    miniContainer.remove();
    miniContainer = null;
  }
  miniScene = null; miniCamera = null;
  miniAmbient = null; miniDirLight = null; miniSatPass = null;
}

function createMiniViewer(sourceModel, customW, customH, customCamZoom) {
  disposeMiniViewer();
  if (typeof disposeImageMiniViewer === 'function') disposeImageMiniViewer();
  miniContainer = document.createElement('div');
  miniContainer.id = 'mmd-mini-viewer';
  if (activeAppliedModelData) {
    miniContainer.dataset.mmdModelId = activeAppliedModelData.id;
    miniContainer.dataset.mmdModelName = activeAppliedModelData.name;
  }
  miniContainer.innerHTML = '<button class="mmd-mini-close">&times;</button>';
  document.body.appendChild(miniContainer);

  const w = customW || 180;
  const h = customH || 220;
  miniContainer.style.position = 'fixed';
  miniContainer.style.zIndex = '999999';
  miniContainer.style.right = '16px';
  miniContainer.style.bottom = '16px';
  miniContainer.style.width = w + 'px';
  miniContainer.style.height = h + 'px';

  let drg = false, sx, sy, sl, st;
  miniContainer.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('mmd-mini-close')) return;
    drg = true; sx = e.clientX; sy = e.clientY;
    const r = miniContainer.getBoundingClientRect();
    sl = r.left; st = r.top;
    miniContainer.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!drg || !miniContainer) return;
    const nx = sl + e.clientX - sx, ny = st + e.clientY - sy;
    const mx = window.innerWidth - w, my = window.innerHeight - h;
    miniContainer.style.right = 'auto'; miniContainer.style.bottom = 'auto';
    miniContainer.style.left = Math.max(0, Math.min(nx, mx)) + 'px';
    miniContainer.style.top = Math.max(0, Math.min(ny, my)) + 'px';
  });
  document.addEventListener('mouseup', (e) => {
    var wasDrag = drg;
    if (drg && miniContainer) miniContainer.style.cursor = 'grab';
    drg = false;
    // Distinguish click vs drag: small movement = click on model
    if (wasDrag) {
      var dx2 = e.clientX - sx, dy2 = e.clientY - sy;
      if (Math.abs(dx2) < 5 && Math.abs(dy2) < 5) {
        var clickCfg = (activeAppliedModelData && activeAppliedModelData.config && activeAppliedModelData.config.animations && activeAppliedModelData.config.animations.click);
        if (clickCfg && clickCfg.path) {
          console.log('[MMD DEBUG] mini viewer click detected, playing click anim, path:', clickCfg.path);
          loadVMDForSlot(clickCfg.path, '点击动画', 'click');
        }
      }
    }
  });

  const scale = 4;
  const rw = w * scale, rh = h * scale;
  miniRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  miniRenderer.setPixelRatio(scale);
  miniRenderer.setSize(w, h);
  miniRenderer.setClearColor(0x000000, 0);
  miniRenderer.outputColorSpace = THREE.SRGBColorSpace;
  miniContainer.appendChild(miniRenderer.domElement);
  miniRenderer.domElement.style.position = 'absolute';
  miniRenderer.domElement.style.top = '0';
  miniRenderer.domElement.style.left = '0';

  miniScene = new THREE.Scene();
  miniScene.background = null;
  miniCamera = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 1000);
  miniModel = sourceModel.clone(true);
  // Fix: clone(true) doesn't update skeleton.bones to point to cloned bones
  if (miniModel.skeleton) {
    var _boneByName = {};
    miniModel.traverse(function(o) { if (o.isBone) _boneByName[o.name] = o; });
    for (var _i = 0; _i < miniModel.skeleton.bones.length; _i++) {
      var _cb = _boneByName[miniModel.skeleton.bones[_i].name];
      if (_cb) miniModel.skeleton.bones[_i] = _cb;
    }
  }
  miniModel.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false;
    if (o.material) {
      if (Array.isArray(o.material)) {
        o.material = o.material.map(m => _fixMaterialLighting(m));
      } else {
        o.material = _fixMaterialLighting(o.material);
      }
    }
  });
  miniScene.add(miniModel);

  const box = new THREE.Box3().setFromObject(miniModel);
  const sz = box.getSize(new THREE.Vector3());
  const ct = box.getCenter(new THREE.Vector3());
  const camZoom = customCamZoom || 1.15;
  const d = Math.max(sz.x, sz.y, sz.z) / (2 * Math.tan((45 * Math.PI) / 360)) * camZoom || 5;
  miniCamera.position.set(ct.x, ct.y, ct.z + d);
  miniCamera.lookAt(ct);

  miniAmbient = new THREE.AmbientLight(0xffffff, 1.5 * lightIntensity);
  miniScene.add(miniAmbient);
  miniDirLight = new THREE.DirectionalLight(0xffffff, 2.2 * lightIntensity);
  miniDirLight.position.set(1, 1, 1);
  miniScene.add(miniDirLight);
  const miniBackLight = new THREE.DirectionalLight(0xffffff, 0.7 * lightIntensity);
  miniBackLight.position.set(-0.5, 0.2, -0.5);
  miniScene.add(miniBackLight);
  const miniBottomLight = new THREE.DirectionalLight(0xffffff, 0.4 * lightIntensity);
  miniBottomLight.position.set(0, -0.5, 0);
  miniScene.add(miniBottomLight);

  miniRT = new THREE.WebGLRenderTarget(rw, rh, { format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: true });
  miniComposer = new EffectComposer(miniRenderer, miniRT);
  miniComposer.addPass(new RenderPass(miniScene, miniCamera));

  const miniOutline = new OutlinePass(new THREE.Vector2(rw, rh), miniScene, miniCamera);
  miniOutline.edgeStrength = 8.0;
  miniOutline.edgeGlow = 0;
  miniOutline.edgeThickness = 2.0;
  miniOutline.pulsePeriod = 0;
  miniOutline.visibleEdgeColor.set('#3a2010');
  miniOutline.hiddenEdgeColor.set('#000000');
  miniComposer.addPass(miniOutline);

  const fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.uniforms.resolution.value.set(1 / rw, 1 / rh);
  miniComposer.addPass(fxaaPass);

  const alphaFix = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float a2 = c.a > 0.001 ? max(c.a, 0.0) : 0.0; vec3 rgb = a2 > 0.001 ? c.rgb / a2 : vec3(0.0); float aOut = smoothstep(0.0, 0.35, a2); gl_FragColor = vec4(rgb * aOut, aOut); }'
  });
  miniComposer.addPass(alphaFix);

  miniSatPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, saturation: { value: saturationValue } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float saturation; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float gray = dot(c.rgb, vec3(0.299, 0.587, 0.114)); c.rgb = mix(vec3(gray), c.rgb, saturation); gl_FragColor = c; }'
  });
  miniSatPass.renderToScreen = true;
  miniComposer.addPass(miniSatPass);

  updateMiniGlow();

  miniContainer.querySelector('.mmd-mini-close').addEventListener('click', disposeMiniViewer);

  function clampMiniToViewport() {
    if (!miniContainer) return;
    var rect = miniContainer.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var style = miniContainer.style;
    var left = parseFloat(style.left) || rect.left;
    var top = parseFloat(style.top) || rect.top;
    if (left + rect.width < 0) left = -rect.width + 40;
    if (left > vw - 40) left = vw - 40;
    if (top + rect.height < 0) top = -rect.height + 40;
    if (top > vh - 40) top = vh - 40;
    style.left = left + 'px';
    style.top = top + 'px';
  }
  window.addEventListener('resize', clampMiniToViewport);
  miniContainer._resizeHandler = clampMiniToViewport;

  var _miniFrameCount = 0;
  var _miniDebugFrames = 0;
  function anim() {
    if (_miniStopped) return;
    miniAnimId = requestAnimationFrame(anim);
    var dt = Math.min(0.1, 1 / 60);
    if (miniMixer) {
      miniMixer.update(dt);
      if (_miniDebugFrames < 10) {
        _miniDebugFrames++;
        var t = miniMixer.time;
        var total = miniAnimClip ? miniAnimClip.getClip().duration : 0;
        console.log('[MMD DEBUG] mini frame #' + _miniDebugFrames + ', mixer.time:', t.toFixed(3), 'clipDur:', total.toFixed(3), 'miniMixer:', !!miniMixer, 'miniAnimClip:', !!miniAnimClip, 'miniModel:', !!miniModel, 'miniComposer:', !!miniComposer);
      }
    }
    if (miniComposer) miniComposer.render();
    _miniFrameCount++;
  }
  _miniStopped = false;
  anim();
}

/* ---------- 效果 ---------- */
function setOutline(objects) {
  if (outlinePass) {
    outlinePass.selectedObjects = outlineEnabled ? objects : [];
  }
}

function refreshOutline() {
  if (outlineEnabled && currentModel) {
    const objs = [];
    currentModel.traverse(o => { if (o.isMesh || o.isSkinnedMesh) objs.push(o); });
    setOutline(objs);
  } else {
    setOutline([]);
  }
}

function updateComposerState() {
  if (!composer) return;
  bloomPass.enabled = bloomEnabled;
  outlinePass.enabled = outlineEnabled;
  bloomPass.renderToScreen = bloomEnabled && !outlineEnabled;
  outlinePass.renderToScreen = outlineEnabled;
}

function initConfigViewer(container, w, h) {
  disposeConfigViewer();
  configRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  configRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  configRenderer.setSize(w, h);
  configRenderer.setClearColor(0x000000, 0);
  configRenderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(configRenderer.domElement);
  configRenderer.domElement.style.width = '100%';
  configRenderer.domElement.style.height = '100%';

  configScene = new THREE.Scene();
  configScene.background = null;
  configCamera = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 1000);

  configControls = new OrbitControls(configCamera, configRenderer.domElement);
  configControls.enableDamping = true;
  configControls.dampingFactor = 0.08;
  configControls.rotateSpeed = 0.8;
  configControls.zoomSpeed = 0.8;
  configControls.autoRotate = true;
  configControls.autoRotateSpeed = 0.3;
  configControls.update();

  configRenderer.domElement.addEventListener('mousedown', _onConfigCanvasMouseDown);
  configRenderer.domElement.addEventListener('mouseup', _onConfigCanvasMouseUp);
  configRenderer.domElement.addEventListener('mouseleave', _onConfigCanvasMouseUp);

  var amb = new THREE.AmbientLight(0xffffff, 1.5 * lightIntensity);
  configScene.add(amb);
  var dl1 = new THREE.DirectionalLight(0xffffff, 2.2 * lightIntensity);
  dl1.position.set(1, 1, 1);
  configScene.add(dl1);
  var dl2 = new THREE.DirectionalLight(0xffffff, 0.7 * lightIntensity);
  dl2.position.set(-0.5, 0.2, -0.5);
  configScene.add(dl2);
  var dl3 = new THREE.DirectionalLight(0xffffff, 0.4 * lightIntensity);
  dl3.position.set(0, -0.5, 0);
  configScene.add(dl3);

  var lastTS = performance.now();
  function anim() {
    configAnimId = requestAnimationFrame(anim);
    var now = performance.now();
    var dt = Math.min((now - lastTS) / 1000, 0.1);
    lastTS = now;
    if (configControls) configControls.update();
    if (configMixer) configMixer.update(dt);
    else if (configModel && configModel.skeleton) configModel.skeleton.update();
    if (configRenderer && configScene && configCamera) configRenderer.render(configScene, configCamera);
  }
  anim();
}

function disposeConfigViewer() {
  if (configAnimId) { cancelAnimationFrame(configAnimId); configAnimId = null; }
  stopConfigAnimation();
  if (configRenderer && configRenderer.domElement) {
    configRenderer.domElement.removeEventListener('mousedown', _onConfigCanvasMouseDown);
    configRenderer.domElement.removeEventListener('mouseup', _onConfigCanvasMouseUp);
    configRenderer.domElement.removeEventListener('mouseleave', _onConfigCanvasMouseUp);
  }
  _dragAnimActive = false;
  _dragAnimPath = null;
  if (configControls) { configControls.dispose(); configControls = null; }
  if (configModel) {
    configScene && configScene.remove(configModel);
    configModel.traverse(function(o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(function(m) {
          for (var k in m) { if (m[k] && m[k].isTexture) m[k].dispose(); }
          m.dispose();
        });
      }
    });
    configModel = null;
  }
  if (configRenderer) { configRenderer.dispose(); configRenderer = null; }
  configScene = null; configCamera = null;
  configDefaultPose = null;
  clearIdleTimer();
}

function disposeConfigPreview() {
  console.log('[MMD DEBUG] disposeConfigPreview called\nSTACK:\n' + (new Error().stack || ''));
  if (configPreviewAnimId) { cancelAnimationFrame(configPreviewAnimId); configPreviewAnimId = null; }
  if (configPreviewModel) {
    configPreviewScene && configPreviewScene.remove(configPreviewModel);
    configPreviewModel.traverse(function(o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(function(m) { m.dispose(); });
      }
    });
    configPreviewModel = null;
  }
  if (configPreviewRenderer) { configPreviewRenderer.dispose(); configPreviewRenderer = null; }
  configPreviewScene = null; configPreviewCamera = null;
  configModel = null; configScene = null;
  _vmdLoadingPath = null; _vmdLoadingStamp = 0;
  _animPreviewModelId = null;
  _vpdCallCount = 0;
  console.log('[MMD DEBUG] disposeConfigPreview: configModel/configScene/_vmdLock/_animPreviewModelId/_vpdCallCount nulled');
}

function stopConfigAnimation() {
  clearIdleTimer();
  if (configMixer) {
    if (configMixer._listener) { configMixer.removeEventListener('finished', configMixer._listener); configMixer._listener = null; }
    configMixer.stopAllAction();
    configMixer = null;
  }
  configAnimClip = null;
  configCurrentAnimName = null;
  configIsVPD = false;
}

function loadModelToConfigViewer(modelData) {
  if (!configScene || !activeModelData) return;
  if (configModel) { configScene.remove(configModel); configModel = null; }
  getModelBlobURL(modelData).then(function(u) {
    if (!u || !configScene) return;
    var loader = new MMDLoader();
    loader.load(u, function(mesh) {
      if (!configScene) return;
      mesh.traverse(function(o) {
        if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; }
        if (o.material) {
          var mats = Array.isArray(o.material) ? o.material : [o.material];
          var beforeSkinning = mats[0].skinning;
          if (Array.isArray(o.material)) o.material = o.material.map(function(m) { return _fixMaterialLighting(m); });
          else o.material = _fixMaterialLighting(o.material);
          if (beforeSkinning) console.log('[MMD DEBUG] preview mat skinning was:', beforeSkinning, 'now:', (Array.isArray(o.material)?o.material[0]:o.material).skinning);
        }
      });
      console.log('[MMD DEBUG] preview skeleton:', mesh.skeleton ? mesh.skeleton.bones.length : 'NONE');
      configModel = mesh;
      configScene.add(mesh);
      saveDefaultPose();
      var standCfg = (modelData.config && modelData.config.animations && modelData.config.animations.stand);
      if (standCfg && standCfg.path) {
        console.log('[MMD DEBUG] >>> CALLER: loadModelToConfigViewer, stand path:', standCfg.path);
        var standLoop = !standCfg.path.toLowerCase().endsWith('.vpd');
        loadVMDForSlot(standCfg.path, '站立姿态', 'stand', standLoop);
      }
      scheduleIdleAnimation();
      var box = new THREE.Box3().setFromObject(mesh);
      var sz = box.getSize(new THREE.Vector3());
      var ct = box.getCenter(new THREE.Vector3());
      var camZoom = (modelData.config && modelData.config.cameraZoom) ? modelData.config.cameraZoom : 1.15;
      var d = Math.max(sz.x, sz.y, sz.z) / (2 * Math.tan(45 * Math.PI / 360)) * camZoom || 5;
      configCamera.position.set(ct.x, ct.y, ct.z + d);
      configCamera.lookAt(ct);
      if (configControls) { configControls.target.copy(ct); configControls.update(); }
    }, function() {}, function(err) { console.error('[MMD] config viewer load error:', err); });
  });
}

var _vmdLoadingPath = null;
var _vmdLoadingStamp = 0;
var _vpdCallCount = 0;
async function loadVMDForSlot(vmdPath, label, slotType, loop) {
  slotType = slotType || 'custom';
  loop = !!loop;
  var stack = new Error().stack || '';
  console.log('[MMD DEBUG] loadVMDForSlot called, path:', vmdPath, 'label:', label, 'slotType:', slotType, 'loop:', loop);
  console.log('[MMD DEBUG] STACK:\n' + stack);
  console.log('[MMD DEBUG] configModel:', !!configModel, 'configScene:', !!configScene, 'activeModelData:', !!activeModelData);
  if (!configModel || !configScene) { console.warn('[MMD DEBUG] no configModel or configScene, aborting'); return; }
  if (_vmdLoadingPath === vmdPath && _vmdLoadingStamp && (Date.now() - _vmdLoadingStamp < 5000)) { console.warn('[MMD DEBUG] loadVMDForSlot SKIP: already loading same VMD, path:', vmdPath); return; }
  if (vmdPath.toLowerCase().endsWith('.vpd')) {
    _vpdCallCount++;
  }
  _vmdLoadingPath = vmdPath;
  _vmdLoadingStamp = Date.now();
  if (slotType !== 'drag') {
    clearIdleTimer();
  }
  var oldAction = configAnimClip;
  if (configMixer && configMixer._listener) { configMixer.removeEventListener('finished', configMixer._listener); configMixer._listener = null; }
  
  var bytes = null;
  if (window.electronAPI && window.electronAPI.mmdReadVMD) {
    bytes = await window.electronAPI.mmdReadVMD({ id: activeModelData.id, name: vmdPath });
  }
  console.log('[MMD DEBUG] read file bytes:', !!bytes, bytes ? bytes.length : 0);
  if (!bytes || !bytes.length) { mmdToast('文件读取失败', 'error'); return; }
  var blobUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  var isVPD = vmdPath.toLowerCase().endsWith('.vpd');
  console.log('[MMD DEBUG] isVPD:', isVPD, 'blobUrl:', blobUrl);

  if (isVPD) {
    if (configMixer) { configMixer.stopAllAction(); configMixer = null; }
    configAnimClip = null;
    if (oldAction && oldAction.isRunning()) { resetBonesToDefault(0.2); }
    var vpdLoader = new MMDLoader();
    vpdLoader.loadVPD(blobUrl, false, function(vpdData) {
      console.log('[MMD DEBUG] loadVPD data received, bones:', vpdData && vpdData.bones ? Object.keys(vpdData.bones).length : 0);
      if (!configModel) return;
      applyVPDToModel(configModel, vpdData);
      configIsVPD = true;
      if (configModel.skeleton) {
        configModel.skeleton.update();
        if (configModel.skeleton.bones) { var b = configModel.skeleton.bones.slice(0,3); b.forEach(function(bn){ console.log('[MMD DEBUG] bone:',bn.name,bn.position.toArray(),bn.quaternion.toArray()); }); }
        console.log('[MMD DEBUG] skeleton bones count:', configModel.skeleton.bones ? configModel.skeleton.bones.length : 0);
      } else { console.warn('[MMD DEBUG] configModel has NO skeleton!'); }
      configCurrentAnimName = label;
      configLastAnimTime = performance.now() / 1000;
      _vmdLoadingPath = null; _vmdLoadingStamp = 0;
      if (miniModel) {
        applyVPDToModel(miniModel, vpdData);
        if (miniMixer) { miniMixer.stopAllAction(); miniMixer = null; }
        miniAnimClip = null;
        if (miniModel && miniModel.skeleton) {
          miniModel.skeleton.update();
          console.log('[MMD DEBUG] mini skeleton bones count:', miniModel.skeleton.bones ? miniModel.skeleton.bones.length : 0);
        } else { console.warn('[MMD DEBUG] miniModel has NO skeleton!'); }
      }
      if (slotType === 'click' || slotType === 'idle') {
        var vpdDelay = slotType === 'click' ? 3000 : (5 + Math.random() * 5) * 1000;
        configResetTimer = setTimeout(function() {
          if (!configModel || !configScene) return;
          var standCfg = (activeModelData && activeModelData.config && activeModelData.config.animations && activeModelData.config.animations.stand);
          if (standCfg && standCfg.path) {
            console.log('[MMD DEBUG] VPD timeout: switching to standing pose, path:', standCfg.path);
            loadVMDForSlot(standCfg.path, '站立姿态', 'stand', true);
          } else {
            resetBonesToDefault(0.2);
            scheduleIdleAnimation();
          }
        }, vpdDelay);
      }
    }, function() {}, function(err) { console.error('[MMD DEBUG] loadVPD error:', err); _vmdLoadingPath = null; _vmdLoadingStamp = 0; });
    return;
  }

  var loader = new MMDLoader();
  console.log('[MMD DEBUG] calling loadAnimation on configModel...');
  loader.loadAnimation(blobUrl, configModel, function(clip) {
    console.log('[MMD DEBUG] loadAnimation configModel callback, clip:', !!clip, 'tracks:', clip && clip.tracks ? clip.tracks.length : 0);
    if (!configModel) return;
    if (!clip || !clip.tracks || !clip.tracks.length) { console.warn('[MMD DEBUG] no animation clip found', clip); return; }
    console.log('[MMD DEBUG] clip duration:', clip.duration, 'tracks:', clip.tracks.length);
    if (!configMixer) configMixer = new THREE.AnimationMixer(configModel);
    configMixer.stopAllAction();
    configAnimClip = configMixer.clipAction(clip);
    if (loop) {
      configAnimClip.setLoop(THREE.LoopRepeat);
      configAnimClip.clampWhenFinished = false;
    } else {
      configAnimClip.setLoop(THREE.LoopOnce);
      configAnimClip.clampWhenFinished = true;
      var onFinished = function() {
        configMixer.removeEventListener('finished', onFinished);
        configMixer._listener = null;
        var standCfg = (activeModelData && activeModelData.config && activeModelData.config.animations && activeModelData.config.animations.stand);
        if (standCfg && standCfg.path) {
          console.log('[MMD DEBUG] onFinished: switching to standing pose, path:', standCfg.path);
          loadVMDForSlot(standCfg.path, '站立姿态', 'stand', true);
        } else {
          resetBonesToDefault(0.2);
          scheduleIdleAnimation();
        }
      };
      configMixer.addEventListener('finished', onFinished);
      configMixer._listener = onFinished;
    }
    if (oldAction && oldAction.isRunning()) {
      configAnimClip.crossFadeFrom(oldAction, 0.2, false);
    }
    configAnimClip.play();
    configAnimClip.enabled = true;
    configIsVPD = false;
    configCurrentAnimName = label;
    configLastAnimTime = performance.now() / 1000;
    _vmdLoadingPath = null; _vmdLoadingStamp = 0;
    console.log('[MMD DEBUG] configModel animation playing, name:', label, 'loop:', loop);

    if (miniModel) {
      console.log('[MMD DEBUG] syncing VMD to miniModel, clip tracks:', clip.tracks.length);
      var miniBoneCount = 0;
      miniModel.traverse(function(o) { if (o.isBone) miniBoneCount++; });
      console.log('[MMD DEBUG] miniModel bone count:', miniBoneCount);
      if (!miniMixer) miniMixer = new THREE.AnimationMixer(miniModel);
      miniMixer.stopAllAction();
      miniAnimClip = miniMixer.clipAction(clip);
      if (!miniAnimClip) { console.error('[MMD DEBUG] miniMixer.clipAction returned null! clip:', clip.name); return; }
      if (loop) {
        miniAnimClip.setLoop(THREE.LoopRepeat);
        miniAnimClip.clampWhenFinished = false;
      } else {
        miniAnimClip.setLoop(THREE.LoopOnce);
        miniAnimClip.clampWhenFinished = true;
      }
      miniAnimClip.play();
      miniAnimClip.enabled = true;
      console.log('[MMD DEBUG] miniModel animation playing, miniAnimClip:', !!miniAnimClip, 'miniAnimClip.weight:', miniAnimClip.weight, 'timeScale:', miniAnimClip.timeScale, 'enabled:', miniAnimClip.enabled);
    }
  }, function(prog) {
    console.log('[MMD DEBUG] loadVMD progress, configModel');
  }, function(err) { console.error('[MMD DEBUG] loadVMD error:', err); });
}

function applyVPDToModel(model, vpdData) {
  if (!model || !vpdData || !vpdData.bones) return;
  var boneMap = {};
  var vpdKeys = [];
  for (var i = 0; i < vpdData.bones.length; i++) {
    var b = vpdData.bones[i];
    boneMap[b.name] = b;
    if (i < 5) vpdKeys.push(b.name);
  }
  var keyCount = Object.keys(boneMap).length;
  console.log('[MMD DEBUG] applyVPD vpdBones:', vpdData.bones.length, 'boneMap keys:', keyCount, 'sample:', vpdKeys.join(', '));
  var traversed = 0, matched = 0, rootNames = { '操作中心':1, '全ての親':1, 'センター':1, 'センター2':1, 'グルーブ':1, '腰':1, '下半身':1, '上半身':1, '上半身2':1 };
  var keyBones = ['上半身','上半身2','首','頭','右肩','右腕','右ひじ','右手首','左肩','左腕','左ひじ','左手首','右足','右ひざ','右足首','左足','左ひざ','左足首'];
  var keyDebug = [];
  var allNonIdentity = [];
  model.traverse(function(o) {
    if (!o.isBone) return;
    traversed++;
    if (boneMap[o.name]) {
      matched++;
      var d = boneMap[o.name];
      var tx = d.translation ? d.translation[0] : 0;
      var ty = d.translation ? d.translation[1] : 0;
      var tz = d.translation ? d.translation[2] : 0;
      var qx = d.quaternion ? d.quaternion[0] : 0;
      var qy = d.quaternion ? d.quaternion[1] : 0;
      var qz = d.quaternion ? d.quaternion[2] : 0;
      var qw = d.quaternion ? d.quaternion[3] : 1;
      var hasMove = Math.abs(tx) > 0.001 || Math.abs(ty) > 0.001 || Math.abs(tz) > 0.001;
      var hasRot = Math.abs(qx) > 0.001 || Math.abs(qy) > 0.001 || Math.abs(qz) > 0.001 || Math.abs(qw - 1) > 0.001;
      if (d.translation) {
        var zeroPos = (Math.abs(tx) < 0.0001 && Math.abs(ty) < 0.0001 && Math.abs(tz) < 0.0001);
        if (!zeroPos) o.position.set(tx, ty, tz);
      }
      if (d.quaternion) o.quaternion.set(qx, qy, qz, qw);
      if (keyBones.indexOf(o.name) >= 0) {
        keyDebug.push(o.name + ' T[' + tx.toFixed(3) + ',' + ty.toFixed(3) + ',' + tz.toFixed(3) + '] Q[' + qx.toFixed(3) + ',' + qy.toFixed(3) + ',' + qz.toFixed(3) + ',' + qw.toFixed(3) + ']');
      }
      var dev = Math.abs(tx) + Math.abs(ty) + Math.abs(tz) + Math.abs(qx) + Math.abs(qy) + Math.abs(qz) + Math.abs(qw - 1);
      if (dev > 0.01 && !rootNames[o.name]) {
        allNonIdentity.push({ name: o.name, dev: dev, vals: 'T[' + tx.toFixed(2) + ',' + ty.toFixed(2) + ',' + tz.toFixed(2) + '] Q[' + qx.toFixed(3) + ',' + qy.toFixed(3) + ',' + qz.toFixed(3) + ',' + qw.toFixed(3) + ']' });
      }
    }
  });
  allNonIdentity.sort(function(a,b){ return b.dev - a.dev; });
  var top10 = allNonIdentity.slice(0, 10).map(function(x){ return x.name + ':' + x.vals; });
  console.log('[MMD DEBUG] applyVPD keyBones:', keyDebug.join(' | '));
  console.log('[MMD DEBUG] applyVPD top10NonIdentity:', top10.join(' \n  '));
}

function saveDefaultPose() {
  if (!configModel) { configDefaultPose = null; return; }
  configDefaultPose = {};
  configModel.traverse(function(o) {
    if (o.isBone) {
      configDefaultPose[o.name] = {
        position: o.position.clone(),
        quaternion: o.quaternion.clone(),
        scale: o.scale.clone()
      };
    }
  });
}

function resetBonesToDefault(duration) {
  if (!configModel || !configDefaultPose) return;
  var tracks = [];
  configModel.traverse(function(o) {
    if (o.isBone && configDefaultPose[o.name]) {
      var dp = configDefaultPose[o.name];
      tracks.push(new THREE.VectorKeyframeTrack(o.name + '.position', [0, duration], [
        o.position.x, o.position.y, o.position.z,
        dp.position.x, dp.position.y, dp.position.z
      ]));
      tracks.push(new THREE.QuaternionKeyframeTrack(o.name + '.quaternion', [0, duration], [
        o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w,
        dp.quaternion.x, dp.quaternion.y, dp.quaternion.z, dp.quaternion.w
      ]));
    }
  });
  if (!tracks.length) return;
  if (configMixer) configMixer.stopAllAction();
  configMixer = new THREE.AnimationMixer(configModel);
  var clip = new THREE.AnimationClip('resetPose', duration, tracks);
  var action = configMixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce);
  action.clampWhenFinished = true;
  action.play();
  configAnimClip = null;
  configIsVPD = false;
  configCurrentAnimName = null;
  var onResetDone = function() {
    configMixer.removeEventListener('finished', onResetDone);
    configMixer._listener = null;
    configMixer.stopAllAction();
    configMixer = null;
  };
  configMixer.addEventListener('finished', onResetDone);
  configMixer._listener = onResetDone;
}

function clearIdleTimer() {
  if (configIdleTimer) { clearTimeout(configIdleTimer); configIdleTimer = null; }
  if (configResetTimer) { clearTimeout(configResetTimer); configResetTimer = null; }
}

function scheduleIdleAnimation() {
  clearIdleTimer();
  console.log('[MMD DEBUG] scheduleIdleAnimation called, configModel:',!!configModel,'configScene:',!!configScene,'activeModelData:',!!activeModelData,'\nSTACK:\n' + (new Error().stack || ''));
  if (!configModel || !configScene || !activeModelData) { console.log('[MMD DEBUG] scheduleIdleAnimation skip: no model/scene/data'); return; }
  var cfg = activeModelData.config || {};
  var animCfg = cfg.animations || {};
  var pool = [];
  if (animCfg.idle && animCfg.idle.path) pool.push(animCfg.idle);
  if (animCfg.custom && animCfg.custom.length) {
    for (var i = 0; i < animCfg.custom.length; i++) {
      if (animCfg.custom[i] && animCfg.custom[i].path) pool.push(animCfg.custom[i]);
    }
  }
  if (!pool.length) { console.log('[MMD DEBUG] scheduleIdleAnimation skip: pool empty'); return; }
  var pick = pool[Math.floor(Math.random() * pool.length)];
  var delay = 15 + Math.random() * 15;
  console.log('[MMD DEBUG] scheduleIdleAnimation: delay:',delay.toFixed(1),'s, pick:',pick.name||pick.path);
  configIdleTimer = setTimeout(function() {
    if (!configModel || !configScene) { console.log('[MMD DEBUG] idle timer abort: configModel gone'); return; }
    console.log('[MMD DEBUG] >>> CALLER: scheduleIdleAnimation timeout, pick:', pick.path);
    loadVMDForSlot(pick.path, '待机(' + (pick.name || '') + ')', 'idle');
  }, delay * 1000);
}

function initListDividerDrag() {
  var divider = document.getElementById('mmd-list-divider');
  var leftPanel = document.getElementById('mmd-list-left');
  var rightPanel = document.getElementById('mmd-anim-panel');
  if (!divider || !leftPanel || !rightPanel) return;
  var isDrag = false;
  divider.addEventListener('mousedown', function(e) { isDrag = true; e.preventDefault(); });
  document.addEventListener('mousemove', function(e) {
    if (!isDrag) return;
    var rect = listPanelEl.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var total = rect.width;
    var pct = Math.min(Math.max(x / total, 0.30), 0.80);
    leftPanel.style.flex = '0 0 ' + (pct * 100).toFixed(1) + '%';
    rightPanel.style.flex = '1';
    var c = document.getElementById('mmd-anim-preview-container');
    if (c && configPreviewRenderer) {
      var pw = c.clientWidth, ph = c.clientHeight;
      if (pw > 0 && ph > 0) configPreviewRenderer.setSize(pw, ph);
    }
  });
  document.addEventListener('mouseup', function() { isDrag = false; });
}

function readAnimSlotsFromPanel(panel) {
  var anims = {};
  ['stand','click','drag','idle'].forEach(function(s) {
    var btn = panel.querySelector('.mmd-anim-change[data-slot="' + s + '"]');
    if (btn && btn._vmdPath) anims[s] = { name: btn._vmdName || '', path: btn._vmdPath };
  });
  var customs = [];
  panel.querySelectorAll('.mmd-anim-change[data-custom]').forEach(function(b) {
    if (b._vmdPath) customs.push({ name: b._vmdName || '', path: b._vmdPath });
  });
  if (customs.length) anims.custom = customs;
  return anims;
}

async function saveAnimConfigForModel(modelData, panel) {
  var anims = readAnimSlotsFromPanel(panel);
  var cfg = modelData.config || {};
  cfg.animations = anims;
  modelData.config = cfg;
  await saveModelConfigToDisk(modelData.id, cfg);
}

var _renderAnimPanelCount = 0;
function renderAnimPanel(modelData) {
  var panel = document.getElementById('mmd-anim-panel');
  if (!panel) return;
  _renderAnimPanelCount++;
  console.log('[MMD DEBUG] renderAnimPanel called #' + _renderAnimPanelCount + ', modelData.id:', modelData && modelData.id, 'activeModelData:', activeModelData && activeModelData.id, '\nSTACK:\n' + (new Error().stack || ''));
  if (!modelData) {
    panel.innerHTML = '<div class="mmd-anim-placeholder"><i class="fa-solid fa-hand-point-left"></i> 请先在模型列表中应用模型</div>';
    disposeConfigPreview();
    return;
  }
  var savedCfg = modelData.config || {};
  var animCfg = savedCfg.animations || {};
  var animSlotHtml = function(label, key) {
    var fn = (animCfg[key] && animCfg[key].name) ? escapeHTML(animCfg[key].name) : '<span style="color:#666">未设置</span>';
    var btns = '<button class="btn btn-xs btn-outline mmd-anim-reset" data-slot="' + key + '" title="重置"><i class="fa-solid fa-rotate-left"></i></button> <button class="btn btn-xs btn-outline mmd-anim-change" data-slot="' + key + '">更改</button>';
    if (animCfg[key]) btns += ' <button class="btn btn-xs btn-primary mmd-anim-play" data-slot="' + key + '">播放</button>';
    return '<div class="mmd-anim-slot"><span class="mmd-anim-slot-label">' + label + '</span><span class="mmd-anim-slot-filename">' + fn + '</span><span class="mmd-anim-slot-actions">' + btns + '</span></div>';
  };
  var customHtml = '';
  var customAnims = animCfg.custom || [];
  for (var ci = 0; ci < customAnims.length; ci++) {
    var a = customAnims[ci];
    customHtml += '<div class="mmd-anim-slot"><span class="mmd-anim-slot-label">自定义' + (ci + 1) + '</span><span class="mmd-anim-slot-filename">' + escapeHTML(a.name || '') + '</span><span class="mmd-anim-slot-actions"><button class="btn btn-xs btn-outline mmd-anim-delete" data-cidx="' + ci + '">删除</button> <button class="btn btn-xs btn-outline mmd-anim-change" data-custom="' + ci + '">更改</button> <button class="btn btn-xs btn-primary mmd-anim-play" data-custom="' + ci + '">播放</button></span></div>';
  }
  panel.innerHTML = '<div class="mmd-anim-preview" id="mmd-anim-preview-container"></div><div class="mmd-anim-model-name">' + escapeHTML(modelData.name) + '</div><div class="mmd-anim-section">' + animSlotHtml('站立姿态', 'stand') + animSlotHtml('点击动画', 'click') + animSlotHtml('拖动动画', 'drag') + animSlotHtml('待机动画', 'idle') + customHtml + '<button class="btn btn-xs btn-outline mmd-anim-add-custom" style="margin-top:4px;width:100%;"><i class="fa-solid fa-plus"></i> 添加自定义动画</button></div><div class="mmd-anim-section mmd-ai-config-section"><div class="mmd-config-section-title"><i class="fa-solid fa-robot"></i> AI 对话</div><label class="mmd-row"><input type="checkbox" id="mmd-ai-toggle"> 启用AI对话</label><button class="btn btn-outline mmd-ai-config-open-btn" style="width:100%;margin-top:6px;"><i class="fa-solid fa-gear"></i> 配置当前MMD模型AI</button><div class="mmd-config-section-desc">每个mmd模型的AI都是独立的，为了方便配置，需要单独配置每个模型的AI</div></div>';
  ['stand','click','drag','idle'].forEach(function(k) {
    if (animCfg[k]) {
      var b = panel.querySelector('.mmd-anim-change[data-slot="' + k + '"]');
      if (b) { b._vmdName = animCfg[k].name; b._vmdPath = animCfg[k].path; }
    }
  });
  var savedCustom = animCfg.custom || [];
  panel.querySelectorAll('.mmd-anim-change[data-custom]').forEach(function(b, i) {
    if (savedCustom[i]) { b._vmdName = savedCustom[i].name; b._vmdPath = savedCustom[i].path; }
  });
  bindAnimPanelEvents(panel, modelData);
  setTimeout(function() { loadModelToAnimPreview(modelData); }, 100);
}

var _onAnimPlayLastPath = null;
var _onAnimPlayLastTime = 0;
function bindAnimPanelEvents(panel, modelData) {
  function onAnimPlay(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
    var t = e.target;
    var now = Date.now();
    var changeBtn = t.closest('.mmd-anim-slot').querySelector('.mmd-anim-change');
    var path = changeBtn ? changeBtn._vmdPath : null;
    console.log('[MMD DEBUG] >>> CALLER: onAnimPlay click, path:', path, 'target:', t.tagName, t.className, 'isTrusted:', e.isTrusted);
    if (!path) return;
    if (_onAnimPlayLastPath === path && (now - _onAnimPlayLastTime < 2000)) {
      console.warn('[MMD DEBUG] onAnimPlay dedup: same path within 2s, skip');
      return;
    }
    _onAnimPlayLastPath = path;
    _onAnimPlayLastTime = now;
    var slotLabel = t.closest('.mmd-anim-slot').querySelector('.mmd-anim-slot-label').textContent;
    var st = 'custom';
    if (slotLabel === '站立姿态') st = 'stand';
    else if (slotLabel === '点击动画') st = 'click';
    else if (slotLabel === '拖动动画') st = 'drag';
    else if (slotLabel === '待机动画') st = 'idle';
    loadVMDForSlot(path, slotLabel, st);
  }
  panel.querySelectorAll('.mmd-anim-reset').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var slot = btn.closest('.mmd-anim-slot');
      var changeBtn = slot.querySelector('.mmd-anim-change');
      if (changeBtn) { changeBtn._vmdName = ''; changeBtn._vmdPath = ''; }
      var playBtn = slot.querySelector('.mmd-anim-play');
      if (playBtn) playBtn.remove();
      var fn = slot.querySelector('.mmd-anim-slot-filename');
      if (fn) fn.innerHTML = '<span style="color:#666">未设置</span>';
      saveAnimConfigForModel(modelData, panel);
    });
  });
  panel.querySelectorAll('.mmd-anim-change').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var isStand = (btn.dataset.slot === 'stand');
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.vmd,.vpd';
      var thatBtn = btn;
      inp.onchange = async function() {
        if (!inp.files.length) return;
        var f = inp.files[0];
        var buf = await f.arrayBuffer();
        var vmdPath = 'vmd_' + Date.now() + '_' + f.name;
        if (window.electronAPI && window.electronAPI.mmdSaveVMD) {
          await window.electronAPI.mmdSaveVMD({ id: modelData.id, name: vmdPath, buffer: Array.from(new Uint8Array(buf)) });
        }
        thatBtn._vmdName = f.name;
        thatBtn._vmdPath = vmdPath;
        var slot = thatBtn.closest('.mmd-anim-slot');
        if (slot) {
          var fn = slot.querySelector('.mmd-anim-slot-filename');
          if (fn) fn.textContent = f.name;
          var playBtn = slot.querySelector('.mmd-anim-play');
          if (!playBtn) {
            playBtn = document.createElement('button');
            playBtn.className = 'btn btn-xs btn-primary mmd-anim-play';
            if (thatBtn.dataset.slot) playBtn.dataset.slot = thatBtn.dataset.slot;
            if (thatBtn.dataset.custom) playBtn.dataset.custom = thatBtn.dataset.custom;
            playBtn.textContent = isStand ? '应用' : '播放';
            playBtn.addEventListener('click', onAnimPlay);
            slot.querySelector('.mmd-anim-slot-actions').appendChild(playBtn);
          }
        }
        saveAnimConfigForModel(modelData, panel);
      };
      inp.click();
    });
  });
  panel.querySelectorAll('.mmd-anim-play').forEach(function(b) { b.addEventListener('click', onAnimPlay); });
  panel.querySelectorAll('.mmd-anim-delete').forEach(function(b) {
    b.addEventListener('click', function() { b.closest('.mmd-anim-slot').remove(); saveAnimConfigForModel(modelData, panel); });
  });
  var addCustomBtn = panel.querySelector('.mmd-anim-add-custom');
  if (addCustomBtn) addCustomBtn.addEventListener('click', function() {
    var idx = panel.querySelectorAll('.mmd-anim-change[data-custom]').length;
    var newSlot = document.createElement('div');
    newSlot.className = 'mmd-anim-slot';
    newSlot.innerHTML = '<span class="mmd-anim-slot-label">自定义' + (idx + 1) + '</span><span class="mmd-anim-slot-filename"><span style="color:#666">未设置</span></span><span class="mmd-anim-slot-actions"><button class="btn btn-xs btn-outline mmd-anim-delete">删除</button> <button class="btn btn-xs btn-outline mmd-anim-change" data-custom="' + idx + '">更改</button></span>';
    addCustomBtn.parentNode.insertBefore(newSlot, addCustomBtn);
    newSlot.querySelector('.mmd-anim-delete').addEventListener('click', function() { newSlot.remove(); saveAnimConfigForModel(modelData, panel); });
    newSlot.querySelector('.mmd-anim-change').addEventListener('click', function() {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.vmd,.vpd';
      var thatBtn = newSlot.querySelector('.mmd-anim-change');
      inp.onchange = async function() {
        if (!inp.files.length) return;
        var f = inp.files[0];
        var buf = await f.arrayBuffer();
        var vmdPath = 'vmd_' + Date.now() + '_' + f.name;
        if (window.electronAPI && window.electronAPI.mmdSaveVMD) {
          await window.electronAPI.mmdSaveVMD({ id: modelData.id, name: vmdPath, buffer: Array.from(new Uint8Array(buf)) });
        }
        thatBtn._vmdName = f.name;
        thatBtn._vmdPath = vmdPath;
        var fn = newSlot.querySelector('.mmd-anim-slot-filename');
        if (fn) fn.textContent = f.name;
        var playBtn = newSlot.querySelector('.mmd-anim-play');
        if (!playBtn) {
          playBtn = document.createElement('button');
          playBtn.className = 'btn btn-xs btn-primary mmd-anim-play';
          playBtn.dataset.custom = String(idx);
          playBtn.textContent = '播放';
          playBtn.addEventListener('click', onAnimPlay);
          newSlot.querySelector('.mmd-anim-slot-actions').appendChild(playBtn);
        }
        saveAnimConfigForModel(modelData, panel);
      };
      inp.click();
    });
  });

  var aiToggle = panel.querySelector('#mmd-ai-toggle');
  var aiCfgBtn = panel.querySelector('.mmd-ai-config-open-btn');
  if (aiToggle && aiCfgBtn) {
    var _mmdAI = window._mmdAI;
    if (_mmdAI) {
      _mmdAI.getAIConfig(modelData.id).then(function(cfg) { aiToggle.checked = cfg.enabled; });
    }
    aiToggle.addEventListener('change', async function() {
      if (!_mmdAI) return;
      var cfg = await _mmdAI.getAIConfig(modelData.id);
      cfg.enabled = aiToggle.checked;
      await _mmdAI.saveAIConfig(modelData.id, cfg);
    });
    aiCfgBtn.addEventListener('click', function() {
      modelData._aiStore = 'ai_images';
      if (_mmdAI && _mmdAI.showAIConfigDialog) _mmdAI.showAIConfigDialog(modelData);
    });
  }
}

var _animPreviewModelId = null;
function loadModelToAnimPreview(modelData) {
  var container = document.getElementById('mmd-anim-preview-container');
  if (!container) return;
  var mid = modelData && modelData.id;
  console.log('[MMD DEBUG] loadModelToAnimPreview called, mid:', mid, '_animPreviewLoadingId:', _animPreviewLoadingId, '_animPreviewModelId:', _animPreviewModelId, 'activeModelData.id:', activeModelData && activeModelData.id, '\nSTACK:\n' + (new Error().stack || ''));
  if (_animPreviewLoadingId === mid) { console.log('[MMD DEBUG] loadModelToAnimPreview skip: already loading same model'); return; }
  if (_animPreviewModelId && _animPreviewModelId !== mid && activeModelData && activeModelData.id !== mid) {
    console.warn('[MMD DEBUG] loadModelToAnimPreview SKIP: another model (' + _animPreviewModelId + ') preview is active, rejecting mid:', mid);
    return;
  }
  _animPreviewLoadingId = mid;
  disposeConfigPreview();
  var w = container.clientWidth || 200, h = container.clientHeight || 200;
  configPreviewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  configPreviewRenderer.setSize(w, h);
  configPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(configPreviewRenderer.domElement);
  configPreviewRenderer.domElement.style.width = '100%';
  configPreviewRenderer.domElement.style.height = '100%';
  configPreviewScene = new THREE.Scene();
  configPreviewScene.background = null;
  configPreviewCamera = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 1000);
  var li = typeof lightIntensity === 'number' ? lightIntensity : 1.0;
  var amb = new THREE.AmbientLight(0xffffff, 1.5 * li);
  configPreviewScene.add(amb);
  var dl = new THREE.DirectionalLight(0xffffff, 2.2 * li);
  dl.position.set(1, 1, 1);
  configPreviewScene.add(dl);
  var dl2 = new THREE.DirectionalLight(0xffffff, 0.7 * li);
  dl2.position.set(-0.5, 0.2, -0.5);
  configPreviewScene.add(dl2);
  var dl3 = new THREE.DirectionalLight(0xffffff, 0.4 * li);
  dl3.position.set(0, -0.5, 0);
  configPreviewScene.add(dl3);
  var previewControls = new OrbitControls(configPreviewCamera, configPreviewRenderer.domElement);
  previewControls.enableDamping = true;
  previewControls.dampingFactor = 0.08;
  previewControls.rotateSpeed = 0.8;
  previewControls.autoRotate = true;
  previewControls.autoRotateSpeed = 0.5;
  previewControls.update();
  function previewAnim() {
    configPreviewAnimId = requestAnimationFrame(previewAnim);
    var now = performance.now();
    var dt = Math.min((now - (previewAnim._last || now)) / 1000, 0.1);
    previewAnim._last = now;
    if (configMixer) configMixer.update(dt);
    else if (configModel && configModel.skeleton) configModel.skeleton.update();
    previewControls.update();
    if (configPreviewRenderer && configPreviewScene && configPreviewCamera) {
      configPreviewRenderer.render(configPreviewScene, configPreviewCamera);
    }
  }
  previewAnim._last = performance.now();
  previewAnim();
  registerTexturePaths(modelData);
  _installImageInterceptor();
  getModelBlobURL(modelData).then(function(u) {
    if (!u || !configPreviewScene) return;
    var loader = new MMDLoader();
    loader.load(u, function(mesh) {
      if (!configPreviewScene) return;
      mesh.traverse(function(o) {
        if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; }
        if (o.material) {
          if (Array.isArray(o.material)) o.material = o.material.map(function(m) { return _fixMaterialLighting(m); });
          else o.material = _fixMaterialLighting(o.material);
        }
      });
      configPreviewModel = mesh;
      configPreviewScene.add(mesh);
      configModel = mesh;
      configScene = configPreviewScene;
      activeModelData = modelData;
      _animPreviewLoadingId = null;
      _animPreviewModelId = mid;
      console.log('[MMD DEBUG] anim preview loaded, configModel:',!!configModel,'activeModelData:',!!activeModelData, '_animPreviewModelId:', _animPreviewModelId);
      var box = new THREE.Box3().setFromObject(mesh);
      var sz = box.getSize(new THREE.Vector3());
      var ct = box.getCenter(new THREE.Vector3());
      var camZoom = (modelData.config && modelData.config.cameraZoom) ? modelData.config.cameraZoom : 1.15;
      var d = Math.max(sz.x, sz.y, sz.z) / (2 * Math.tan(45 * Math.PI / 360)) * camZoom || 5;
      configPreviewCamera.position.set(ct.x, ct.y, ct.z + d);
      configPreviewCamera.lookAt(ct);
      previewControls.target.copy(ct);
      previewControls.update();
      saveDefaultPose();
      var standCfg = (modelData.config && modelData.config.animations && modelData.config.animations.stand);
      if (standCfg && standCfg.path) {
        console.log('[MMD DEBUG] >>> CALLER: loadModelToAnimPreview callback, stand path:', standCfg.path);
        var standLoop = !standCfg.path.toLowerCase().endsWith('.vpd');
        loadVMDForSlot(standCfg.path, '站立姿态', 'stand', standLoop);
      }
      scheduleIdleAnimation();
    });
  });
}

var _dragAnimActive = false;
var _dragAnimPath = null;
var _mouseDownPos = null;
var _mouseDownTime = 0;
function _onConfigCanvasMouseDown(e) {
  if (e.button !== 0) return;
  if (!activeModelData || !activeModelData.config) return;
  _mouseDownPos = { x: e.clientX, y: e.clientY };
  _mouseDownTime = Date.now();
  var dragCfg = activeModelData.config.animations && activeModelData.config.animations.drag;
  if (!dragCfg || !dragCfg.path) return;
  _dragAnimPath = dragCfg.path;
  _dragAnimActive = true;
  console.log('[MMD DEBUG] drag anim start, path:', _dragAnimPath);
  loadVMDForSlot(_dragAnimPath, '拖动动画', 'drag');
}
function _onConfigCanvasMouseUp(e) {
  if (!_dragAnimActive) {
    // Check for click: mousedown + mouseup with small movement and short time
    if (_mouseDownPos && _mouseDownTime) {
      var dx = e.clientX - _mouseDownPos.x;
      var dy = e.clientY - _mouseDownPos.y;
      var dt = Date.now() - _mouseDownTime;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5 && dt < 300) {
        var clickCfg = activeModelData && activeModelData.config && activeModelData.config.animations && activeModelData.config.animations.click;
        if (clickCfg && clickCfg.path) {
          console.log('[MMD DEBUG] click detected, playing click anim, path:', clickCfg.path);
          clearIdleTimer();
          loadVMDForSlot(clickCfg.path, '点击动画', 'click');
        }
      }
    }
    _mouseDownPos = null;
    _mouseDownTime = 0;
    return;
  }
  _dragAnimActive = false;
  _dragAnimPath = null;
  _mouseDownPos = null;
  _mouseDownTime = 0;
  console.log('[MMD DEBUG] drag anim stop, switching to standing pose');
  if (configMixer) { configMixer.stopAllAction(); }
  configAnimClip = null;
  var standCfg = (activeModelData && activeModelData.config && activeModelData.config.animations && activeModelData.config.animations.stand);
  if (standCfg && standCfg.path) {
    var standLoop = !standCfg.path.toLowerCase().endsWith('.vpd');
    loadVMDForSlot(standCfg.path, '站立姿态', 'stand', standLoop);
  } else {
    resetBonesToDefault(0.2);
    scheduleIdleAnimation();
  }
}

/* ---------- 公开 API ---------- */
function init(container) {
  if (!container || initialized) return;
  containerEl = container;
  container.style.overflow = 'hidden';
  buildUI(container);
  const r = container.getBoundingClientRect();
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'mmd-canvas-wrap';
  container.appendChild(canvasWrap);
  mainCanvasWrap = canvasWrap;
  setupScene(canvasWrap, r.width || 800, r.height || 600);
  initialized = true;

  resizeObserver = new ResizeObserver(() => {
    const r = container.getBoundingClientRect();
    if (renderer && r.width > 0 && r.height > 0) {
      renderer.setSize(r.width, r.height);
      if (composer) composer.setSize(r.width, r.height);
      if (camera) { camera.aspect = r.width / Math.max(r.height, 1); camera.updateProjectionMatrix(); }
    }
  });
  resizeObserver.observe(container);

  initMMDAI();
  if (localStorage.getItem('mmd_last_applied_type') === 'ai_images') {
    var lastAiId = localStorage.getItem('mmd_last_ai_project_id');
    if (lastAiId) setTimeout(function() { restoreLastAIProject(Number(lastAiId)); }, 150);
  }
}

function disposeRenderer() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  if (composer) {
    composer.passes.forEach(p => { if (p.renderTarget) p.renderTarget.dispose(); });
    composer = null;
  }
  scene = null; camera = null; controls = null;
  outlinePass = null; bloomPass = null; saturationPass = null;
}

function dispose() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  disposeCurrent();
  disposeRenderer();
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  clearURLs();
  if (containerEl) {
    while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);
    containerEl = null;
  }
  disposeMiniViewer();
  disposeImageMiniViewer();
  clearIdleTimer();
  configDefaultPose = null;
  configIsVPD = false;
  configAnimFinishedCallback = null;
  configLastAnimTime = 0;
  _animPreviewLoadingId = null;
  listPanelEl = null; configPanelEl = null; mainCanvasWrap = null;
  activeModelData = null; savedModels = [];
  initialized = false;
}

function _fixMaterialLighting(mat) {
  if (!mat) return;
  mat.side = THREE.DoubleSide;
  if (mat.isMeshBasicMaterial && !mat.isMeshToonMaterial && !mat.isMeshPhongMaterial && !mat.isMeshStandardMaterial && !mat.isMeshLambertMaterial) {
    const phong = new THREE.MeshPhongMaterial();
    phong.color.copy(mat.color);
    if (mat.map) phong.map = mat.map;
    if (mat.alphaMap) phong.alphaMap = mat.alphaMap;
    phong.transparent = mat.transparent;
    phong.opacity = mat.opacity;
    phong.alphaTest = mat.alphaTest;
    phong.side = THREE.DoubleSide;
    phong.depthWrite = mat.depthWrite;
    phong.depthTest = mat.depthTest;
    phong.skinning = mat.skinning;
    phong.morphTargets = mat.morphTargets;
    phong.morphNormals = mat.morphNormals;
    mat.dispose();
    return phong;
  }
  if (mat.isShaderMaterial || mat.type === 'MMDToonMaterial') {
    if (mat.uniforms && mat.uniforms.emissive && mat.uniforms.emissive.value && mat.uniforms.emissive.value.isColor) {
      const e = mat.uniforms.emissive.value;
      const maxC = Math.max(e.r, e.g, e.b);
      if (maxC > 0.05) e.multiplyScalar(0.25);
    }
    if (mat.uniforms && mat.uniforms.diffuse && mat.uniforms.diffuse.value && mat.uniforms.diffuse.value.isColor) {
      const d = mat.uniforms.diffuse.value;
      const minC = Math.min(d.r, d.g, d.b);
      if (minC < 0.08) { d.r = Math.max(d.r, 0.2); d.g = Math.max(d.g, 0.2); d.b = Math.max(d.b, 0.2); }
    }
    if (mat.uniforms && mat.uniforms.ambient && mat.uniforms.ambient.value && mat.uniforms.ambient.value.isColor) {
      const a = mat.uniforms.ambient.value;
      if (a.r < 0.05 && a.g < 0.05 && a.b < 0.05) a.set(0.2, 0.2, 0.2);
    }
    mat.needsUpdate = true;
    return mat;
  }
  if (mat.emissive && mat.emissive.isColor) {
    const maxC = Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b);
    if (maxC > 0.05) mat.emissive.copy(mat.emissive).multiplyScalar(0.25);
  }
  if (mat.emissiveIntensity !== undefined && mat.emissiveIntensity > 0.1) {
    mat.emissiveIntensity = 0.15;
  }
  if (mat.color && mat.color.isColor) {
    const c = mat.color;
    if (c.r < 0.08 && c.g < 0.08 && c.b < 0.08) c.set(Math.max(c.r, 0.2), Math.max(c.g, 0.2), Math.max(c.b, 0.2));
  }
  mat.needsUpdate = true;
  return mat;
}

function onModelLoaded(model, statusEl) {
  currentModel = model;
  currentMats = [];
  model.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.frustumCulled = false;
      if (o.material) {
        if (Array.isArray(o.material)) {
          const fixed = o.material.map(m => _fixMaterialLighting(m));
          o.material = fixed;
          currentMats.push(...fixed);
        } else {
          const fixed = _fixMaterialLighting(o.material);
          o.material = fixed;
          currentMats.push(fixed);
        }
      }
    }
  });
  if (scene) scene.add(model);

  if (controls && camera) {
    const box = new THREE.Box3().setFromObject(model);
    const ct = box.getCenter(new THREE.Vector3());
    controls.target.copy(ct);
    const sz = box.getSize(new THREE.Vector3());
    const d = Math.max(sz.x, sz.y, sz.z) * 1.5;
    camera.position.set(ct.x, ct.y + d * 0.15, ct.z + d);
    controls.update();
  }
  console.log('[MMD DEBUG] onModelLoaded: meshes=', currentMats.length, 'sceneKids=', scene ? scene.children.length : 0);

  refreshOutline();
  updateComposerState();

  console.log('[MMD DEBUG] onModelLoaded DONE, interceptor STAYS');
  if (statusEl) {
    statusEl.textContent = '模型已加载';
    statusEl.classList.remove('err');
  }
}

function handleFiles(files, statusEl) {
  if (!files || !files.length) return;
  const arr = Array.from(files);
  fileURLs = fileURLs || new Map();
  createdURLs = createdURLs || new Set();
  unmatchedTextures = unmatchedTextures || new Set();

  arr.forEach(f => {
    const u = URL.createObjectURL(f);
    createdURLs.add(u);
    const key = f.name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    fileURLs.set(key, u);
    fileURLs.set(key.toLowerCase(), u);
  });

  const modelFile = arr.find(f => MODEL_EXT.test(f.name));
  if (!modelFile) {
    if (statusEl) { statusEl.textContent = '未找到支持的模型文件'; statusEl.classList.add('err'); }
    return;
  }
  const ext = modelFile.name.slice(modelFile.name.lastIndexOf('.') + 1).toLowerCase();
  const url = fileURLs.get(modelFile.name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''));
  loadModelFromURL(url, ext, statusEl);
}

async function restoreLastAIProject(projectId) {
  showAIOnlyView();
  await new Promise(function(r) { setTimeout(r, 350); });
  var p = aiProjects.find(function(x) { return x.id === projectId; });
  if (p) selectAIProject(p);
}

async function preloadModels() {
  try {
    activeModelData = '__loading__';
    savedModels = await getAllModels();
    console.log('[MMD] preloadModels: loaded', savedModels.length, 'models from disk');
    var lastType = localStorage.getItem('mmd_last_applied_type');
    if (lastType !== 'ai_images') {
    var lastId = localStorage.getItem('mmd_last_applied_id');
    if (lastId) {
      var m = savedModels.find(function(x) { return String(x.id) === String(lastId); });
      if (m) { console.log('[MMD] preloadModels: auto-loading last model:', m.name); applyModelDirectly(m); }
    }
    }
  } catch(e) { console.error('[MMD] preloadModels error:', e); }
}

window.MMDViewer = { init, dispose, openFilePicker, preloadModels };
window._mmdGetActiveModel = function() { return activeAppliedModelData || activeModelData; };
window._mmdGetAllModels = function() { return savedModels || []; };

let aiProjListEl = null;
let aiProjRightEl = null;
let aiProjects = [];
let aiActiveProject = null;
let aiCurrentImgIdx = {};

function showAIOnlyView() {
  if (!listPanelEl) return;
  listPanelEl.innerHTML = '';
  listPanelEl.style.display = 'flex';
  listPanelEl.style.flexDirection = 'column';
  var panel = document.createElement('div');
  panel.className = 'mmdai-list-panel';
  panel.id = 'mmdai-list-panel';
  panel.innerHTML = '<div class="mmdai-topbar"><button class="btn btn-outline mmd-back-btn" id="mmdai-back-btn"><i class="fa-solid fa-arrow-left"></i> 返回模型列表</button><div class="mmdai-topbar-title"><i class="fa-solid fa-images"></i> AI 图片项目</div></div><div style="display:flex;flex:1;overflow:hidden;"><div class="mmdai-list-left" id="mmdai-list-left"></div><div class="mmdai-list-right" id="mmdai-list-right"><div class="mmdai-right-placeholder"><i class="fa-solid fa-hand-point-left"></i> 请选择一个项目</div></div></div>';
  listPanelEl.appendChild(panel);
  aiProjRightEl = document.getElementById('mmdai-list-right');

  document.getElementById('mmdai-back-btn').addEventListener('click', function() {
    var aiPanel = document.getElementById('mmdai-list-panel');
    if (aiPanel) aiPanel.remove();
    listPanelEl.innerHTML = '<div class="mmd-list-left" id="mmd-list-left"></div><div class="mmd-list-divider" id="mmd-list-divider"></div><div class="mmd-list-right-panel" id="mmd-anim-panel"><div class="mmd-anim-placeholder"><i class="fa-solid fa-hand-point-left"></i> 请先在模型列表中应用模型</div></div>';
    listPanelEl.style.display = '';
    listPanelEl.style.flexDirection = '';
    aiActiveProject = null;
    aiProjRightEl = null;
    renderModelList();
    loadAndRenderSavedModels();
    if (activeAppliedModelData) renderAnimPanel(activeAppliedModelData);
    initListDividerDrag();
    if (typeof _setupAIProjectCardListeners === 'function') _setupAIProjectCardListeners = undefined;
  });

  loadAIProjects();
}

async function loadAIProjects() {
  try {
    aiProjects = await window.electronAPI.mmdAiGetProjects();
    if (!aiProjects || !aiProjects.length) { await createDefaultAIProject(); aiProjects = await window.electronAPI.mmdAiGetProjects(); }
  } catch (e) { aiProjects = []; }
  renderAIProjectList();
}

async function createDefaultAIProject() {
  try {
    await window.electronAPI.mmdAiEnsureDefault();
  } catch(e) { console.error('[MMDAI] createDefaultAIProject error:', e); }
}

function renderAIProjectList() {
  var leftEl = document.getElementById('mmdai-list-left');
  if (!leftEl) return;
  var hasProjects = aiProjects.length > 0;
  leftEl.innerHTML = '<div class="mmdai-list-header"><div class="mmdai-list-title"><i class="fa-solid fa-images"></i> AI 图片项目</div><div class="mmdai-list-count">' + (hasProjects ? aiProjects.length + ' 个项目' : '暂无项目') + '</div></div><div class="mmdai-list-grid"><div class="mmdai-project-card mmdai-import-card" id="mmdai-new-project-card"><div class="mmdai-card-icon"><i class="fa-solid fa-plus"></i></div><div class="mmdai-card-label">新建项目</div><div class="mmdai-card-hint">导入图片或 GIF</div></div>' + aiProjects.map(function(p) { return '<div class="mmdai-project-card" data-proj-id="' + p.id + '"><div class="mmdai-card-actions"><button class="mmdai-card-btn mmdai-card-rename" data-action="rename-ai" data-id="' + p.id + '" title="重命名"><i class="fa-solid fa-pen"></i></button><button class="mmdai-card-btn mmdai-card-delete" data-action="delete-ai" data-id="' + p.id + '" title="删除"><i class="fa-solid fa-trash"></i></button></div><div class="mmdai-card-header"><div class="mmdai-card-name">' + escapeHTML(p.name) + '</div><div class="mmdai-card-count">' + (p.imageCount || 0) + ' 张</div></div><img class="mmdai-card-preview" src="" data-proj-preview="' + p.id + '" style="flex:1;"><div class="mmdai-card-bottom"><button class="btn btn-outline mmdai-card-config-btn" data-action="config-ai" data-id="' + p.id + '" style="font-size:11px;padding:4px 10px;"><i class="fa-solid fa-gear"></i> 配置</button><button class="btn btn-primary mmdai-card-apply-btn" data-action="select-ai" data-id="' + p.id + '" style="font-size:11px;padding:4px 10px;"><i class="fa-solid fa-play"></i> 应用</button></div></div>'; }).join('') + '</div>';

  var newCard = leftEl.querySelector('#mmdai-new-project-card');
  if (newCard) { newCard.addEventListener('click', function() { showAINewProjectDialog(); }); }

  leftEl.querySelectorAll('[data-proj-id]').forEach(function(card) {
    card.addEventListener('click', function(e) {
      if (e.target.closest('[data-action]')) return;
      var id = Number(card.dataset.projId);
      var p = aiProjects.find(function(x) { return x.id === id; });
      if (p) selectAIProject(p);
    });
  });

  leftEl.querySelectorAll('[data-action="select-ai"]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = Number(btn.dataset.id);
      var p = aiProjects.find(function(x) { return x.id === id; });
      if (p) selectAIProject(p);
    });
  });

  leftEl.querySelectorAll('[data-action="config-ai"]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = Number(btn.dataset.id);
      var p = aiProjects.find(function(x) { return x.id === id; });
      if (p) { selectAIProject(p); if (_mmdAI && _mmdAI.showAIConfigDialog) _mmdAI.showAIConfigDialog(p); }
    });
  });

  leftEl.querySelectorAll('[data-action="delete-ai"]').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var id = Number(btn.dataset.id);
      var p = aiProjects.find(function(x) { return x.id === id; });
      if (!p) return;
      var confirmed = await showConfirmDialog('删除项目', '确定要删除项目「' + p.name + '」吗？', '确定删除', '取消');
      if (confirmed) { await window.electronAPI.mmdAiDeleteProject(id); await loadAIProjects(); if (aiActiveProject && aiActiveProject.id === id) { aiActiveProject = null; aiProjRightEl.innerHTML = '<div class="mmdai-right-placeholder"><i class="fa-solid fa-hand-point-left"></i> 请选择一个项目</div>'; } }
    });
  });

  leftEl.querySelectorAll('[data-action="rename-ai"]').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var id = Number(btn.dataset.id);
      var p = aiProjects.find(function(x) { return x.id === id; });
      if (!p) return;
      var newName = await showPromptDialog('重命名项目', '请输入新名称：', p.name);
      if (newName && newName.trim()) {
        try {
          var projects = await window.electronAPI.mmdAiGetProjects();
          var entry = projects.find(function(x) { return x.id === id; });
          if (entry) { entry.name = newName.trim(); await window.electronAPI.mmdAiWriteFile({ id: id, file: 'projects.json', content: JSON.stringify(projects) }); }
          await loadAIProjects();
          if (aiActiveProject && aiActiveProject.id === id) { aiActiveProject.name = newName.trim(); selectAIProject(aiActiveProject); }
        } catch(e) {}
      }
    });
  });

  setTimeout(function() {
    aiProjects.forEach(function(p) { loadProjectPreviewImage(p); });
  }, 100);
}

async function loadProjectPreviewImage(project) {
  try {
    var projs = await window.electronAPI.mmdAiGetProjects();
    var p = projs.find(function(x) { return x.id === project.id; });
    if (!p || !p.imageFiles || !p.imageFiles.length) return;
    var firstImg = p.imageFiles[0];
    var b64 = await window.electronAPI.mmdAiGetImageBase64({ id: project.id, name: firstImg });
    if (!b64) return;
    var imgs = document.querySelectorAll('[data-proj-preview="' + project.id + '"]');
    imgs.forEach(function(img) { img.src = b64; });
  } catch(e) {}
}

async function selectAIProject(project) {
  aiActiveProject = project;
  try {
    var projs = await window.electronAPI.mmdAiGetProjects();
    var fresh = projs.find(function(x) { return x.id === project.id; });
    if (fresh) aiActiveProject = fresh;
  } catch(e) {}
  renderAIProjectConfig(aiActiveProject);
  localStorage.setItem('mmd_last_applied_type', 'ai_images');
  localStorage.setItem('mmd_last_ai_project_id', String(project.id));
  if (aiActiveProject.imageFiles && aiActiveProject.imageFiles.length > 0) {
    createImageMiniViewer(aiActiveProject);
  }
}

async function renderAIProjectConfig(project) {
  var rightEl = aiProjRightEl;
  if (!rightEl) return;
  var imgFiles = project.imageFiles || [];
  var imgCount = imgFiles.length;

  rightEl.innerHTML = '<div class="mmdai-config-project-name">' + escapeHTML(project.name) + '</div><div class="mmdai-config-project-info">' + (imgCount > 0 ? imgCount + ' 张图片' : '暂无图片') + ' &middot; ' + new Date(project.createdAt).toLocaleDateString() + '</div>' + (imgCount > 0 ? '<div class="mmdai-image-display" id="mmdai-main-image"><img id="mmdai-main-img" src="" alt="点击更换图片"></div>' : '<div class="mmdai-image-upload-area" id="mmdai-upload-area"><i class="fa-solid fa-cloud-arrow-up"></i><span>点击或拖拽导入图片 / GIF</span></div>') + '<div class="mmdai-config-section"><div class="mmdai-config-section-title"><i class="fa-solid fa-window-maximize"></i> 小窗口</div><button class="btn btn-primary" id="mmdai-create-mini" style="width:100%;margin-bottom:8px;">添加到小窗口</button><label class="mmd-row">小窗宽度 <input type="range" id="mmdai-mini-w" min="120" max="600" step="10" value="' + (project.miniW || 300) + '" style="width:80px"> <span id="mmdai-mini-w-val">' + (project.miniW || 300) + '</span>px</label><label class="mmd-row">小窗高度 <input type="range" id="mmdai-mini-h" min="120" max="600" step="10" value="' + (project.miniH || 300) + '" style="width:80px"> <span id="mmdai-mini-h-val">' + (project.miniH || 300) + '</span>px</label><button class="btn btn-primary mmdai-save-config-btn" style="width:100%;margin-top:8px;"><i class="fa-solid fa-floppy-disk"></i> 保存配置</button></div><div class="mmdai-config-section"><div class="mmdai-config-section-title"><i class="fa-solid fa-robot"></i> AI 对话</div><button class="btn btn-primary" id="mmdai-open-ai-btn" style="width:100%;"><i class="fa-solid fa-comments"></i> 打开 AI 对话</button></div><div class="mmdai-config-section"><div class="mmdai-config-section-title"><i class="fa-solid fa-gear"></i> AI 配置</div><button class="btn btn-outline" id="mmdai-config-ai-btn" style="width:100%;"><i class="fa-solid fa-sliders"></i> 配置AI</button></div><div class="mmdai-config-section"><div class="mmdai-config-section-title"><i class="fa-solid fa-image"></i> 图片管理</div><div style="display:flex;gap:8px;flex-wrap:wrap;">' + imgFiles.map(function(f, i) { return '<div style="width:60px;height:60px;border-radius:6px;overflow:hidden;cursor:pointer;border:2px solid ' + (aiCurrentImgIdx[project.id] === i ? 'var(--theme)' : 'transparent') + ';" data-img-idx="' + i + '"><img src="" data-thumb="' + project.id + ':' + i + '" style="width:100%;height:100%;object-fit:cover;"></div>'; }).join('') + '</div><button class="btn btn-outline" id="mmdai-add-images-btn" style="width:100%;margin-top:8px;"><i class="fa-solid fa-plus"></i> 导入更多图片</button></div>';

  if (imgCount > 0) {
    await showRandomImage(project);
    var mainImg = rightEl.querySelector('#mmdai-main-image');
    if (mainImg) {
      mainImg.addEventListener('click', function() { showRandomImage(project); });
    }
  } else {
    var uploadArea = rightEl.querySelector('#mmdai-upload-area');
    if (uploadArea) {
      uploadArea.addEventListener('click', function() { openImageImportForProject(project); });
      uploadArea.addEventListener('dragover', function(e) { e.preventDefault(); });
      uploadArea.addEventListener('drop', function(e) { e.preventDefault(); handleProjectImageDrop(e, project); });
    }
  }

  var aiBtn = rightEl.querySelector('#mmdai-open-ai-btn');
  if (aiBtn) {
    aiBtn.addEventListener('click', function() {
      if (_mmdAI && _mmdAI.openChatWindow) _mmdAI.openChatWindow(project);
    });
  }

  var cfgBtn = rightEl.querySelector('#mmdai-config-ai-btn');
  if (cfgBtn) {
    cfgBtn.addEventListener('click', function() {
      if (_mmdAI && _mmdAI.showAIConfigDialog) _mmdAI.showAIConfigDialog(project);
    });
  }

  var miniW = rightEl.querySelector('#mmdai-mini-w');
  var miniH = rightEl.querySelector('#mmdai-mini-h');
  if (miniW) miniW.addEventListener('input', function() { var v = parseInt(this.value); project.miniW = v; var sv = rightEl.querySelector('#mmdai-mini-w-val'); if (sv) sv.textContent = v; });
  if (miniH) miniH.addEventListener('input', function() { var v = parseInt(this.value); project.miniH = v; var sv = rightEl.querySelector('#mmdai-mini-h-val'); if (sv) sv.textContent = v; });
  var createMiniBtn = rightEl.querySelector('#mmdai-create-mini');
  if (createMiniBtn) createMiniBtn.addEventListener('click', function() { createImageMiniViewer(project); });

  var saveBtn = rightEl.querySelector('.mmdai-save-config-btn');
  if (saveBtn) saveBtn.addEventListener('click', function() {
    var w = parseInt(rightEl.querySelector('#mmdai-mini-w').value) || 300;
    var h = parseInt(rightEl.querySelector('#mmdai-mini-h').value) || 300;
    project.miniW = w; project.miniH = h;
    window.electronAPI.mmdAiUpdateProjectConfig({ id: project.id, miniW: w, miniH: h });
    if (typeof showToast === 'function') showToast('配置已保存', project.name + ' 的小窗口配置已保存', 'success', 2500);
  });

  var addBtn = rightEl.querySelector('#mmdai-add-images-btn');
  if (addBtn) {
    addBtn.addEventListener('click', function() { openImageImportForProject(project); });
  }

  rightEl.querySelectorAll('[data-thumb]').forEach(function(el) {
    var parts = el.dataset.thumb.split(':');
    var pid = Number(parts[0]);
    var idx = Number(parts[1]);
    loadThumbImage(pid, idx, el);
  });

  rightEl.querySelectorAll('[data-img-idx]').forEach(function(el) {
    el.addEventListener('click', function() {
      var idx = Number(el.dataset.imgIdx);
      aiCurrentImgIdx[project.id] = idx;
      renderAIProjectConfig(project);
    });
  });
}

async function showRandomImage(project) {
  try {
    var projs = await window.electronAPI.mmdAiGetProjects();
    var p = projs.find(function(x) { return x.id === project.id; });
    if (!p || !p.imageFiles || !p.imageFiles.length) return;
    var idx = Math.floor(Math.random() * p.imageFiles.length);
    aiCurrentImgIdx[project.id] = idx;
    var mainImg = document.getElementById('mmdai-main-img');
    if (!mainImg) return;
    var name = p.imageFiles[idx];
    var b64 = await window.electronAPI.mmdAiGetImageBase64({ id: project.id, name: name });
    if (b64) mainImg.src = b64;
    var thumbs = document.querySelectorAll('[data-thumb="' + project.id + ':' + idx + '"]');
    thumbs.forEach(function(t) { t.src = b64; });
  } catch(e) {}
}

async function loadThumbImage(projId, idx, el) {
  try {
    var projs = await window.electronAPI.mmdAiGetProjects();
    var p = projs.find(function(x) { return x.id === projId; });
    if (!p || !p.imageFiles || idx >= p.imageFiles.length) return;
    var b64 = await window.electronAPI.mmdAiGetImageBase64({ id: projId, name: p.imageFiles[idx] });
    if (b64) el.src = b64;
  } catch(e) {}
}

let aiMiniViewer = null;

function disposeImageMiniViewer() {
  if (aiMiniViewer) { aiMiniViewer.remove(); aiMiniViewer = null; }
}

async function createImageMiniViewer(project) {
  disposeImageMiniViewer();
  if (typeof disposeMiniViewer === 'function') disposeMiniViewer();
  try {
    var projs = await window.electronAPI.mmdAiGetProjects();
    var p = projs.find(function(x) { return x.id === project.id; });
    if (!p || !p.imageFiles || !p.imageFiles.length) return;
    var idx = aiCurrentImgIdx[project.id] || 0;
    var name = p.imageFiles[idx];
    var b64 = await window.electronAPI.mmdAiGetImageBase64({ id: project.id, name: name });
    if (!b64) return;
    var w = project.miniW || 300;
    var h = project.miniH || 300;
    aiMiniViewer = document.createElement('div');
    aiMiniViewer.id = 'mmdai-mini-viewer';
    aiMiniViewer.dataset.mmdaiProjectId = project.id;
    aiMiniViewer.dataset.mmdaiProjectName = project.name;
    aiMiniViewer.innerHTML = '<button class="mmdai-mini-close">&times;</button><img src="' + b64 + '" style="width:100%;height:100%;object-fit:contain;" draggable="false">';
    aiMiniViewer.style.cssText = 'position:fixed;z-index:100000;right:16px;bottom:16px;width:' + w + 'px;height:' + h + 'px;';
    document.body.appendChild(aiMiniViewer);
    var img = aiMiniViewer.querySelector('img');
    if (img) img.addEventListener('dragstart', function(e) { e.preventDefault(); });
    aiMiniViewer.querySelector('.mmdai-mini-close').addEventListener('click', disposeImageMiniViewer);
    var startX, startY, ox, oy, dragging = false;
    aiMiniViewer.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; startX = e.clientX; startY = e.clientY;
      var r = aiMiniViewer.getBoundingClientRect();
      ox = r.left; oy = r.top;
    });
    window.addEventListener('mousemove', function(ev) {
      if (!dragging || !aiMiniViewer) return;
      aiMiniViewer.style.right = 'auto'; aiMiniViewer.style.bottom = 'auto';
      aiMiniViewer.style.left = Math.max(0, Math.min(ox + ev.clientX - startX, window.innerWidth - w)) + 'px';
      aiMiniViewer.style.top = Math.max(0, Math.min(oy + ev.clientY - startY, window.innerHeight - h)) + 'px';
    });
    window.addEventListener('mouseup', function() { dragging = false; });
  } catch(e) {}
}

function openImageImportForProject(project) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg,.gif,.webp,.bmp,.ico';
  input.multiple = true;
  input.addEventListener('change', async function(e) {
    var files = e.target.files;
    if (!files || !files.length) return;
    var bigFiles = [];
    for (var i = 0; i < files.length; i++) { if (files[i].size > 512 * 1024 * 1024) bigFiles.push(files[i].name); }
    if (bigFiles.length > 0) { mmdToast('以下文件超过512MB：' + bigFiles.join(', '), 'warning'); return; }
    var buffers = [];
    for (var i = 0; i < files.length; i++) {
      var buf = await files[i].arrayBuffer();
      buffers.push({ name: files[i].name, buffer: Array.from(new Uint8Array(buf)) });
    }
    await window.electronAPI.mmdAiAddImages({ id: project.id, imageBuffers: buffers });
    await loadAIProjects();
    selectAIProject(project);
    e.target.value = '';
  });
  input.click();
}

function handleProjectImageDrop(e, project) {
  var files = e.dataTransfer.files;
  if (!files || !files.length) return;
  processImageFiles(files, project);
}

async function processImageFiles(files, project) {
  var bigFiles = [];
  for (var i = 0; i < files.length; i++) { if (files[i].size > 512 * 1024 * 1024) bigFiles.push(files[i].name); }
  if (bigFiles.length > 0) { mmdToast('以下文件超过512MB：' + bigFiles.join(', '), 'warning'); return; }
  var buffers = [];
  for (var i = 0; i < files.length; i++) {
    var buf = await files[i].arrayBuffer();
    buffers.push({ name: files[i].name, buffer: Array.from(new Uint8Array(buf)) });
  }
  await window.electronAPI.mmdAiAddImages({ id: project.id, imageBuffers: buffers });
  await loadAIProjects();
  selectAIProject(project);
}

function showAINewProjectDialog() {
  var imgSlots = [null, null];
  var overlay = document.createElement('div');
  overlay.className = 'mmdai-new-overlay';
  overlay.id = 'mmdai-new-overlay';

  function renderDialog() {
    var hasAnyImg = imgSlots.some(function(s) { return s !== null; });
    overlay.innerHTML = '<div class="mmdai-new-dialog"><h3>新建项目</h3><div class="mmdai-new-name-row"><label>项目名称</label><input type="text" id="mmdai-new-name" value="新项目" placeholder="输入项目名称"></div><div class="mmdai-img-row"><span class="mmdai-img-row-label">默认图片</span><span class="mmdai-img-row-status' + (imgSlots[0] ? ' loaded"' : '"') + '>' + (imgSlots[0] ? imgSlots[0].name : '未选择') + '</span><button class="btn btn-outline btn-sm mmdai-img-import-btn" data-slot="0"><i class="fa-solid fa-folder-open"></i> 导入</button></div><div class="mmdai-img-row"><span class="mmdai-img-row-label">附加图片1</span><span class="mmdai-img-row-status' + (imgSlots[1] ? ' loaded"' : '"') + '>' + (imgSlots[1] ? imgSlots[1].name : '未选择') + '</span><button class="btn btn-outline btn-sm mmdai-img-import-btn" data-slot="1"><i class="fa-solid fa-folder-open"></i> 导入</button></div><button class="btn btn-outline btn-sm mmdai-img-import-btn" data-slot="add" style="width:100%;"><i class="fa-solid fa-plus"></i> 导入更多图片</button><div class="mmdai-new-footer"><div>' + (hasAnyImg ? '<button class="btn btn-primary" id="mmdai-new-confirm">确定</button>' : '<button class="btn btn-outline" id="mmdai-new-empty">先创建空项目</button>') + '</div><div class="mmdai-new-footer-right"><button class="btn btn-outline" id="mmdai-new-cancel">取消</button></div></div></div>';

    overlay.querySelector('#mmdai-new-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.querySelector('#mmdai-new-empty') && overlay.querySelector('#mmdai-new-empty').addEventListener('click', async function() {
      var nameInput = overlay.querySelector('#mmdai-new-name');
      var name = (nameInput && nameInput.value.trim()) || '新项目';
      await createAIProject(name, []);
      overlay.remove();
    });
    overlay.querySelector('#mmdai-new-confirm') && overlay.querySelector('#mmdai-new-confirm').addEventListener('click', async function() {
      var nameInput = overlay.querySelector('#mmdai-new-name');
      var name = (nameInput && nameInput.value.trim()) || '新项目';
      var buffers = imgSlots.filter(function(s) { return s !== null; }).map(function(s) { return { name: s.name, buffer: Array.from(new Uint8Array(s.buffer)) }; });
      await createAIProject(name, buffers);
      overlay.remove();
    });

    overlay.querySelectorAll('.mmdai-img-import-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var slot = btn.dataset.slot;
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.png,.jpg,.jpeg,.gif,.webp,.bmp,.ico';
        input.multiple = (slot === 'add');
        input.addEventListener('change', async function(e) {
          var files = e.target.files;
          if (!files || !files.length) return;
          for (var i = 0; i < files.length; i++) {
            if (files[i].size > 512 * 1024 * 1024) { mmdToast(files[i].name + ' 超过512MB限制', 'warning'); continue; }
            var buf = await files[i].arrayBuffer();
            if (slot === 'add') {
              imgSlots.push({ name: files[i].name, buffer: buf.slice(0) });
            } else {
              imgSlots[Number(slot)] = { name: files[i].name, buffer: buf.slice(0) };
            }
          }
          renderDialog();
          e.target.value = '';
        });
        input.click();
      });
    });
  }

  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  renderDialog();
  document.body.appendChild(overlay);
}

async function createAIProject(name, imageBuffers) {
  try {
    var id = await window.electronAPI.mmdAiSaveProject({ name: name, imageBuffers: imageBuffers });
    await loadAIProjects();
    var p = aiProjects.find(function(x) { return x.id === id; });
    if (p) selectAIProject(p);
  } catch(e) { mmdToast('创建项目失败: ' + (e.message || e), 'error'); }
}

(function startPreloadWhenReady() {
  if (localStorage.getItem('mmdAutoLoadEnabled') === 'false') return;
  var container = document.getElementById('page-mmd');
  if (!document.body.classList.contains('splash-active')) {
    preloadModels();
    init(container);
  } else {
    var obs = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          if (!document.body.classList.contains('splash-active')) {
            obs.disconnect();
            if (localStorage.getItem('mmdAutoLoadEnabled') !== 'false') {
              preloadModels();
              init(document.getElementById('page-mmd'));
            }
          }
        }
      });
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
})();

function openFilePicker() {
  if (currentView === 'list') {
    const folderCard = document.getElementById('mmd-import-folder-card');
    if (folderCard) folderCard.click();
  }
}

window.__mmdDebug = function() {
  console.log('=== MMD Debug ===');
  console.log('scene:', scene ? 'OK' : 'NULL', 'children:', scene ? scene.children.length : 0);
  console.log('camera:', camera ? 'OK' : 'NULL', 'pos:', camera ? camera.position.toArray().map(v=>v.toFixed(1)) : 'N/A');
  console.log('renderer:', renderer ? 'OK' : 'NULL');
  console.log('currentModel:', currentModel ? 'OK' : 'NULL');
  console.log('currentMats:', currentMats ? currentMats.length : 0);
  console.log('interceptor installed:', !!_origImageSrcDescriptor);
  console.log('lightIntensity:', lightIntensity);
  if (scene) {
    const lights = scene.children.filter(c => c.isLight);
    console.log('lights:', lights.length, lights.map(l => ({type: l.type || l.constructor.name, intensity: l.intensity})));
    const meshes = [];
    scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
    console.log('meshes in scene:', meshes.length);
    if (meshes.length > 0) {
      const m = meshes[0];
      console.log('first mesh:', m.type || m.constructor.name, 'visible:', m.visible, 'mat type:', m.material ? (Array.isArray(m.material) ? m.material.map(x=>x.type||x.constructor.name) : (m.material.type || m.material.constructor.name)) : 'none');
    }
  }
  if (currentModel) {
    const box = new THREE.Box3().setFromObject(currentModel);
    const sz = box.getSize(new THREE.Vector3());
    console.log('currentModel box size:', sz.x.toFixed(1), sz.y.toFixed(1), sz.z.toFixed(1));
  }
  console.log('mini viewer:', miniContainer ? 'active' : 'none');
  console.log('=== END ===');
};