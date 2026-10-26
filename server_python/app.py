import os
import re
import json
import uuid
import hashlib
import time
import shutil
import zipfile
import tempfile
import threading
import urllib.request
from collections import deque
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from werkzeug.utils import secure_filename
import openpyxl


app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024

# ---------- CORS 支持 ----------
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response


_CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')
_CONFIG_EXAMPLE_FILE = os.path.join(os.path.dirname(__file__), 'config.example.json')

def load_server_config():
    for cfg_path in (_CONFIG_FILE, _CONFIG_EXAMPLE_FILE):
        if os.path.exists(cfg_path):
            with open(cfg_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    return {}

_server_cfg = load_server_config()
AVAILABLE_BACKENDS = _server_cfg.get('backends', ['http://127.0.0.1'])

BASE_DIR = _server_cfg.get('data_dir', os.path.join(os.path.dirname(__file__), 'data'))
WORK_BASE = os.path.join(BASE_DIR, 'file', 'work')
RESOURCE_BASE = os.path.join(BASE_DIR, 'file', 'resource')
USER_DATA_DIR = os.path.join(BASE_DIR, 'userdata')
AVATAR_DIR = os.path.join(USER_DATA_DIR, 'avatars')
PERMISSIONS_FILE = os.path.join(BASE_DIR, 'file', 'permissions.json')
TOKEN_FILE = os.path.join(USER_DATA_DIR, 'tokens.json')
UPLOAD_RECORDS_FILE = os.path.join(BASE_DIR, 'file', 'upload_records.json')
NOTIFICATION_FILE = os.path.join(USER_DATA_DIR, 'notifications.json')

os.makedirs(USER_DATA_DIR, exist_ok=True)
os.makedirs(AVATAR_DIR, exist_ok=True)
os.makedirs(WORK_BASE, exist_ok=True)
os.makedirs(RESOURCE_BASE, exist_ok=True)

_json_cache = {}
_json_cache_lock = threading.Lock()

def cached_read_json(filepath, default=None):
    with _json_cache_lock:
        entry = _json_cache.get(filepath)
        if entry:
            try:
                cur_mtime = os.path.getmtime(filepath)
                if cur_mtime == entry['mtime']:
                    return entry['data']
            except OSError:
                pass
    if not os.path.exists(filepath):
        return default() if callable(default) else default
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        mtime = os.path.getmtime(filepath)
        with _json_cache_lock:
            _json_cache[filepath] = {'mtime': mtime, 'data': data}
        return data
    except (json.JSONDecodeError, ValueError):
        return default() if callable(default) else default

def invalidate_cache(filepath):
    with _json_cache_lock:
        _json_cache.pop(filepath, None)

# ---------- 通知队列（程序启动时清空文件）----------
LEARNING_DATA = {}
def load_learning_data():
    xxt_filename = _server_cfg.get('xxt_excel_filename', '')
    excel_path = os.path.join(os.path.dirname(__file__), 'file', 'xxt', xxt_filename)
    if not os.path.exists(excel_path):
        print(f"学习通数据文件不存在: {excel_path}")
        return
    try:
        wb = openpyxl.load_workbook(excel_path, data_only=True)
        ws = wb.active
        for row in ws.iter_rows(min_row=2, max_row=44, values_only=True):
            account = row[4] if row[4] else ''
            name = row[5] if row[5] else ''
            pwd = row[6] if row[6] else _server_cfg.get('xxt_default_password', '')
            if name:
                LEARNING_DATA[str(name)] = {'account': str(account), 'password': str(pwd)}
        print(f"加载学习通数据 {len(LEARNING_DATA)} 条")
    except Exception as e:
        print(f"加载学习通数据失败: {e}")

load_learning_data()
@app.route('/api/get_learning_info', methods=['POST'])
def get_learning_info():
    data = request.get_json()
    real_name = data.get('real_name')
    if not real_name:
        return jsonify({'error': '未提供真实姓名'}), 400
    info = LEARNING_DATA.get(real_name)
    if not info:
        return jsonify({'error': '未找到对应学习通信息'}), 404
    return jsonify({'account': info['account'], 'password': info['password']})

def init_notifications():
    with open(NOTIFICATION_FILE, 'w', encoding='utf-8') as f:
        json.dump({'queue': [], 'counter': 0}, f)
    invalidate_cache(NOTIFICATION_FILE)
    print("[通知] 已清空通知队列文件")
init_notifications()

def load_notifications():
    data = cached_read_json(NOTIFICATION_FILE, default=lambda: {'queue': [], 'counter': 0})
    return deque(data.get('queue', []), maxlen=200), data.get('counter', 0)

def save_notifications(queue, counter):
    with open(NOTIFICATION_FILE, 'w', encoding='utf-8') as f:
        json.dump({'queue': list(queue), 'counter': counter}, f)
    invalidate_cache(NOTIFICATION_FILE)
    print(f"[通知] 保存队列，当前计数: {counter}")

notification_queue, notification_counter = load_notifications()

def push_notification(msg, ntype='', file_path=None):
    global notification_counter
    notification_counter += 1
    entry = {'id': notification_counter, 'msg': msg, 'type': ntype, 'timestamp': time.time()}
    if file_path:
        entry['file_path'] = file_path
    notification_queue.append(entry)
    save_notifications(notification_queue, notification_counter)
    print(f"[通知] 新通知: {msg} (ID: {notification_counter})")

# ---------- 上传记录管理 ----------
def load_upload_records():
    return cached_read_json(UPLOAD_RECORDS_FILE, default=dict)

def save_upload_records(records):
    with open(UPLOAD_RECORDS_FILE, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    invalidate_cache(UPLOAD_RECORDS_FILE)

def add_upload_record(rel_path, real_name):
    records = load_upload_records()
    records[rel_path] = {'uploader': real_name, 'timestamp': time.time()}
    save_upload_records(records)

def remove_upload_record(rel_path):
    records = load_upload_records()
    if rel_path in records:
        del records[rel_path]
        save_upload_records(records)

def rename_upload_record(old_rel_path, new_rel_path):
    records = load_upload_records()
    if old_rel_path in records:
        records[new_rel_path] = records.pop(old_rel_path)
        save_upload_records(records)

# ---------- 辅助函数 ----------
def safe_filename(filename):
    filename = filename.replace('\\', '').replace('/', '')
    safe = re.sub(r'[^\u4e00-\u9fff\w\.\-]', '', filename)
    if not safe or safe == '.' or safe == '..':
        safe = 'file'
    return safe

def is_safe_path(base_path, target_path):
    target_path = os.path.abspath(target_path)
    base_path = os.path.abspath(base_path)
    return target_path.startswith(base_path)

def hash_password(password, salt=None):
    if salt is None:
        salt = os.urandom(16).hex()
    pwd_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return salt, pwd_hash

def verify_password(password, salt, pwd_hash):
    return hashlib.sha256((password + salt).encode()).hexdigest() == pwd_hash

def load_users():
    users_file = os.path.join(USER_DATA_DIR, 'users.json')
    return cached_read_json(users_file, default=list)

def save_users(users):
    users_file = os.path.join(USER_DATA_DIR, 'users.json')
    with open(users_file, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    invalidate_cache(users_file)

def get_or_create_token(user_id):
    tokens = cached_read_json(TOKEN_FILE, default=dict)
    if user_id not in tokens:
        token = uuid.uuid4().hex
        tokens[user_id] = token
        with open(TOKEN_FILE, 'w', encoding='utf-8') as f:
            json.dump(tokens, f)
        invalidate_cache(TOKEN_FILE)
    return tokens.get(user_id)

def validate_token(token):
    tokens = cached_read_json(TOKEN_FILE, default=dict)
    for uid, tk in tokens.items():
        if tk == token:
            return uid
    return None

def get_user_avatar_url(user_id):
    for ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
        avatar_path = os.path.join(AVATAR_DIR, f'{user_id}.{ext}')
        if os.path.exists(avatar_path):
            return f'/api/avatars/{user_id}.{ext}'
    return None

def notify_admin(msg):
    """向管理系统发送通知"""
    try:
        data = json.dumps({'msg': msg}).encode('utf-8')
        req = urllib.request.Request('http://127.0.0.1:50/api/add_notification', data=data,
                                     headers={'Content-Type': 'application/json'}, method='POST')
        urllib.request.urlopen(req, timeout=1)
        print(f"[通知] 已发送至管理系统: {msg}")
    except Exception as e:
        print(f"[通知] 发送至管理系统失败: {e}")

# ---------- 头像 API ----------
@app.route('/api/avatars/<path:filename>')
def avatar_file(filename):
    return send_from_directory(AVATAR_DIR, filename)

@app.route('/api/upload_avatar', methods=['POST'])
def upload_avatar():
    token = request.form.get('token')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    if 'avatar' not in request.files:
        return jsonify({'error': '未选择文件'}), 400
    file = request.files['avatar']
    if file.filename == '':
        return jsonify({'error': '文件名为空'}), 400
    if not file.content_type.startswith('image/'):
        return jsonify({'error': '仅支持图片文件'}), 400

    for ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
        old_path = os.path.join(AVATAR_DIR, f'{uid}.{ext}')
        if os.path.exists(old_path):
            os.remove(old_path)

    temp_path = os.path.join(AVATAR_DIR, f'{uid}_temp.png')
    file.save(temp_path)
    final_path = os.path.join(AVATAR_DIR, f'{uid}.png')
    os.rename(temp_path, final_path)
    avatar_url = f'/api/avatars/{uid}.png'
    return jsonify({'success': True, 'avatar_url': avatar_url})

@app.route('/api/delete_avatar', methods=['POST'])
def delete_avatar():
    data = request.get_json()
    token = data.get('token')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    for ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
        path = os.path.join(AVATAR_DIR, f'{uid}.{ext}')
        if os.path.exists(path):
            os.remove(path)
    return jsonify({'success': True})

@app.route('/api/user/avatar', methods=['POST'])
def api_user_avatar():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    if 'avatar' not in request.files:
        return jsonify({'error': '未上传文件'}), 400
    file = request.files['avatar']
    for ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
        old = os.path.join(AVATAR_DIR, f'{uid}.{ext}')
        if os.path.exists(old): os.remove(old)
    filename = f'{uid}.jpg'
    filepath = os.path.join(AVATAR_DIR, filename)
    file.save(filepath)
    avatar_url = f'/api/avatars/{uid}.jpg'
    return jsonify({'avatar': avatar_url, 'url': avatar_url})

# ---------- 用户 API ----------
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    real_name = data.get('real_name', data.get('username', '')).strip()
    nickname = data.get('nickname', '').strip()
    password = data.get('password', '')
    confirm_password = data.get('confirm_password', password)
    if not real_name or not password:
        return jsonify({'error': '真实姓名和密码不能为空'}), 400
    if password != confirm_password:
        return jsonify({'error': '两次输入的密码不一致'}), 400
    users = load_users()
    if any(u['real_name'] == real_name for u in users):
        return jsonify({'error': '该账户已经存在!请登录'}), 400
    if not nickname:
        nickname = real_name
    uid = str(uuid.uuid4())
    salt, pwd_hash = hash_password(password)
    new_user = {
        'id': uid,
        'real_name': real_name,
        'nickname': nickname,
        'salt': salt,
        'password': pwd_hash
    }
    users.append(new_user)
    save_users(users)
    return jsonify({'success': True})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    users = load_users()
    user = None
    for u in users:
        if u['real_name'] == username:
            user = u
            break
    if not user or not verify_password(password, user['salt'], user['password']):
        return jsonify({'error': '用户名或密码错误'}), 401
    token = get_or_create_token(user['id'])
    avatar_url = get_user_avatar_url(user['id'])
    return jsonify({
        'success': True,
        'token': token,
        'user': {
            'id': user['id'],
            'real_name': user['real_name'],
            'nickname': user['nickname'],
            'avatar_url': avatar_url
        }
    })

@app.route('/api/check_token', methods=['POST'])
def check_token():
    data = request.get_json()
    token = data.get('token')
    uid = validate_token(token)
    if not uid:
        return jsonify({'valid': False}), 401
    users = load_users()
    user = next((u for u in users if u['id'] == uid), None)
    if not user:
        return jsonify({'valid': False}), 401
    avatar_url = get_user_avatar_url(uid)
    return jsonify({
        'valid': True,
        'user': {
            'id': user['id'],
            'real_name': user['real_name'],
            'nickname': user['nickname'],
            'avatar_url': avatar_url
        }
    })

@app.route('/api/update_user', methods=['POST'])
def update_user():
    data = request.get_json()
    token = data.get('token')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    real_name = data.get('real_name')
    nickname = data.get('nickname')
    old_password = data.get('old_password')
    new_password = data.get('new_password')
    confirm_password = data.get('confirm_password')
    users = load_users()
    user = next((u for u in users if u['id'] == uid), None)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    if real_name:
        if any(u['real_name'] == real_name and u['id'] != uid for u in users):
            return jsonify({'error': '真实姓名已存在'}), 400
        user['real_name'] = real_name
        if not nickname:
            nickname = real_name
    if nickname:
        user['nickname'] = nickname
    if new_password:
        if confirm_password and new_password != confirm_password:
            return jsonify({'error': '两次输入的新密码不一致'}), 400
        if old_password and not verify_password(old_password, user['salt'], user['password']):
            return jsonify({'error': '旧密码错误'}), 400
        salt, pwd_hash = hash_password(new_password)
        user['salt'] = salt
        user['password'] = pwd_hash
    save_users(users)
    return jsonify({'success': True})

@app.route('/api/logout', methods=['POST'])
def logout():
    data = request.get_json()
    token = data.get('token')
    tokens = cached_read_json(TOKEN_FILE, default=dict)
    for uid, tk in list(tokens.items()):
        if tk == token:
            del tokens[uid]
            break
    with open(TOKEN_FILE, 'w', encoding='utf-8') as f:
        json.dump(tokens, f)
    invalidate_cache(TOKEN_FILE)
    return jsonify({'success': True})

# ---------- 通知 API ----------
@app.route('/api/notifications')
def get_notifications():
    q, _ = load_notifications()
    return jsonify(list(q))

@app.route('/api/add_notification', methods=['POST'])
def add_notification_api():
    data = request.get_json()
    msg = data.get('msg', '')
    if msg:
        push_notification(msg, 'resource')
    invalidate_tree_cache(RESOURCE_BASE)
    return '', 200

# ---------- Ping 接口 ----------
@app.route('/api/ping')
def ping():
    return '', 204

# ---------- 客户端 IP ----------
@app.route('/api/client_ip')
def client_ip():
    return request.remote_addr

# ---------- 文件夹权限 ----------
def load_permissions():
    return cached_read_json(PERMISSIONS_FILE, default=dict)

def get_folder_permission(rel_path):
    perms = load_permissions()
    path_parts = rel_path.replace('\\', '/').split('/')
    for i in range(len(path_parts), 0, -1):
        parent = '/'.join(path_parts[:i])
        if parent in perms and perms[parent] == 'ro':
            return 'ro'
    return 'rw'

# ---------- 目录列表 ----------
@app.route('/api/list_dir')
def api_list_dir():
    token = request.headers.get('Authorization', '')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    rel_path = request.args.get('path', '')
    if '..' in rel_path or rel_path.startswith('/') or rel_path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    target_dir = os.path.join(WORK_BASE, rel_path)
    if not os.path.exists(target_dir):
        return jsonify({'error': '目录不存在'}), 404
    if not is_safe_path(WORK_BASE, target_dir):
        return jsonify({'error': '无权访问'}), 403
    dirs, files = [], []
    perms = load_permissions()
    records = load_upload_records()
    try:
        with os.scandir(target_dir) as entries:
            for entry in entries:
                if entry.is_dir():
                    sub_path = os.path.join(rel_path, entry.name).replace('\\', '/')
                    permission = 'rw'
                    if sub_path in perms and perms[sub_path] == 'ro':
                        permission = 'ro'
                    dirs.append({
                        'name': entry.name,
                        'type': 'dir',
                        'path': sub_path,
                        'permission': permission
                    })
                else:
                    file_rel_path = os.path.join(rel_path, entry.name).replace('\\', '/')
                    file_info = {'name': entry.name, 'type': 'file', 'size': entry.stat().st_size}
                    if file_rel_path in records:
                        file_info['uploader'] = records[file_rel_path].get('uploader', '')
                    files.append(file_info)
    except OSError:
        pass
    dirs.sort(key=lambda x: x['name'])
    files.sort(key=lambda x: x['name'])
    return jsonify({'dirs': dirs, 'files': files, 'current_path': rel_path})

@app.route('/api/resource_list_dir')
def api_resource_list_dir():
    rel_path = request.args.get('path', '')
    if '..' in rel_path or rel_path.startswith('/') or rel_path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    target_dir = os.path.join(RESOURCE_BASE, rel_path)
    if not os.path.exists(target_dir):
        return jsonify({'error': '目录不存在'}), 404
    if not is_safe_path(RESOURCE_BASE, target_dir):
        return jsonify({'error': '无权访问'}), 403
    dirs, files = [], []
    try:
        with os.scandir(target_dir) as entries:
            for entry in entries:
                if entry.is_dir():
                    dirs.append({'name': entry.name, 'type': 'dir', 'path': os.path.join(rel_path, entry.name).replace('\\', '/')})
                else:
                    files.append({'name': entry.name, 'type': 'file', 'size': entry.stat().st_size})
    except OSError:
        pass
    dirs.sort(key=lambda x: x['name'])
    files.sort(key=lambda x: x['name'])
    return jsonify({'dirs': dirs, 'files': files, 'current_path': rel_path})

# ---------- 上传作业 ----------
@app.route('/upload', methods=['POST'])
def upload_file():
    token = request.form.get('token')
    uid = validate_token(token)
    if not uid:
        return "未登录", 401
    target_rel_path = request.form.get('path', '')
    file_type = request.form.get('type', 'work')
    if file_type == 'resource':
        if '..' in target_rel_path or target_rel_path.startswith('/') or target_rel_path.startswith('\\'):
            return "非法路径", 400
        target_dir = os.path.join(RESOURCE_BASE, target_rel_path)
        if not os.path.exists(target_dir):
            return "目标文件夹不存在", 404
        if not is_safe_path(RESOURCE_BASE, target_dir):
            return "无权访问", 403
        if 'file' not in request.files:
            return "未选中文件", 400
        file = request.files['file']
        if file.filename == '':
            return "文件名为空", 400
        filename = safe_filename(file.filename)
        if '.' not in filename or filename.endswith('.'):
            return "文件必须包含扩展名", 400
        file_path = os.path.join(target_dir, filename)
        if os.path.exists(file_path):
            return f"文件 '{filename}' 已存在，请重命名后再上传", 400
        file.save(file_path)
        invalidate_tree_cache(RESOURCE_BASE)
        users = load_users()
        user = next((u for u in users if u['id'] == uid), None)
        real_name = user['real_name'] if user else None
        if real_name:
            msg = f"有素材正在上传 '{filename}'"
            push_notification(msg, 'resource')
            notify_admin(msg)
        return jsonify({'warning': False}), 200
    if '..' in target_rel_path or target_rel_path.startswith('/') or target_rel_path.startswith('\\'):
        return "非法路径", 400
    if get_folder_permission(target_rel_path) == 'ro':
        return "该文件夹为只读权限，无法上传", 403
    if target_rel_path.count('/') <= 1:
        return "上传失败\n该目录为作业根目录\n请展开子文件夹以继续上传", 400
    target_dir = os.path.join(WORK_BASE, target_rel_path)
    if not os.path.exists(target_dir):
        return "目标文件夹不存在", 404
    if not is_safe_path(WORK_BASE, target_dir):
        return "无权访问", 403
    if 'file' not in request.files:
        return "未选中文件", 400
    file = request.files['file']
    if file.filename == '':
        return "文件名为空", 400
    filename = safe_filename(file.filename)
    if '.' not in filename or filename.endswith('.'):
        return "文件必须包含扩展名", 400
    file_path = os.path.join(target_dir, filename)
    if os.path.exists(file_path):
        return f"文件 '{filename}' 已存在，请重命名后再上传", 400
    file.save(file_path)
    invalidate_tree_cache(WORK_BASE)

    users = load_users()
    user = next((u for u in users if u['id'] == uid), None)
    real_name = user['real_name'] if user else None
    file_rel_path = os.path.join(target_rel_path, filename).replace('\\', '/')

    if not real_name:
        print(f"[上传] 警告: 文件已保存但无法获取 uid={uid} 的真实姓名")
        return jsonify({'warning': True, 'message': '文件上传成功，但无法获取真实姓名，请手动检查是否已经重命名!'}), 200

    try:
        add_upload_record(file_rel_path, real_name)
        folder_display = target_rel_path if target_rel_path else '根目录'
        msg = f"{real_name} 上传了 '{filename}' 到 '{folder_display}'"
        push_notification(msg, 'work-upload', file_path=file_rel_path)
        notify_admin(msg)
        notify_admin(msg)
        print(f"[上传] {msg}")
    except Exception as e:
        print(f"[上传] 记录失败: {e}")
    return jsonify({'warning': False}), 200

# ---------- 素材下载 ----------
@app.route('/download', methods=['GET'])
def download_file():
    file_type = request.args.get('type')
    if file_type == 'work':
        return "无权下载作业文件", 403
    elif file_type == 'resource':
        rel_path = request.args.get('rel_path', '')
        filename = request.args.get('filename')
        if not filename:
            return "文件名缺失", 400
        if '..' in rel_path or rel_path.startswith('/') or rel_path.startswith('\\'):
            return "非法路径", 400
        target_dir = os.path.join(RESOURCE_BASE, rel_path)
        if not is_safe_path(RESOURCE_BASE, target_dir):
            return "非法路径", 403
        if not os.path.isfile(os.path.join(target_dir, filename)):
            return "文件不存在", 404
        return send_from_directory(target_dir, filename, as_attachment=True)
    else:
        return "无效的文件类型", 400

# ---------- 重命名作业文件 ----------
@app.route('/api/work/rename', methods=['POST'])
def api_work_rename():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    data = request.get_json()
    path = data.get('path', '')
    new_name = data.get('newName', '')
    if not path or not new_name:
        return jsonify({'error': '路径或新名称缺失'}), 400
    if '..' in path or path.startswith('/') or path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    if '..' in new_name or '/' in new_name or '\\' in new_name:
        return jsonify({'error': '新名称包含非法字符'}), 400
    target = os.path.join(WORK_BASE, path)
    if not is_safe_path(WORK_BASE, target):
        return jsonify({'error': '非法路径'}), 403
    old_ext = os.path.splitext(path)[1]
    new_ext = os.path.splitext(new_name)[1]
    if old_ext.lower() != new_ext.lower():
        return jsonify({'error': '不能修改文件扩展名'}), 400
    new_path = os.path.join(os.path.dirname(target), new_name)
    if os.path.exists(new_path):
        return jsonify({'error': '目标文件已存在'}), 409
    if not os.path.isfile(target):
        if os.path.isfile(new_path):
            return jsonify({'success': True, 'message': '重命名成功'})
        return jsonify({'error': '文件不存在'}), 404
    os.rename(target, new_path)
    if not os.path.isfile(new_path):
        return jsonify({'error': '重命名失败，请重试'}), 500
    new_rel_path = os.path.join(os.path.dirname(path), new_name).replace('\\', '/')
    rename_upload_record(path, new_rel_path)
    invalidate_tree_cache(WORK_BASE)
    old_name = os.path.basename(path)
    msg = f"'{old_name}' 已重命名为 '{new_name}'"
    push_notification(msg, 'work-rename', file_path=new_rel_path)
    notify_admin(msg)
    return jsonify({'success': True, 'message': '重命名成功'})
 

@app.route('/api/work/download')
def api_work_download():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    rel_path = request.args.get('path', '')
    if not rel_path:
        return jsonify({'error': '路径缺失'}), 400
    if '..' in rel_path or rel_path.startswith('/') or rel_path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    target = os.path.join(WORK_BASE, rel_path)
    if not is_safe_path(WORK_BASE, target):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isfile(target):
        return jsonify({'error': '文件不存在'}), 404
    directory = os.path.dirname(target)
    filename = os.path.basename(target)
    return send_from_directory(directory, filename, as_attachment=True)

@app.route('/api/resource/download')
def api_resource_download():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    rel_path = request.args.get('path', '')
    if not rel_path:
        return jsonify({'error': '路径缺失'}), 400
    if '..' in rel_path or rel_path.startswith('/') or rel_path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    target = os.path.join(RESOURCE_BASE, rel_path)
    if not is_safe_path(RESOURCE_BASE, target):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isfile(target):
        return jsonify({'error': '文件不存在'}), 404
    directory = os.path.dirname(target)
    filename = os.path.basename(target)
    return send_from_directory(directory, filename, as_attachment=True)

@app.route('/api/rename', methods=['POST'])
def rename_item():
    token = request.headers.get('Authorization', '')
    uid = validate_token(token)
    if not uid:
        return jsonify({'success': False, 'error': '未登录'}), 401
    data = request.get_json()
    if data.get('type') != 'file':
        return jsonify({'success': False, 'error': '只能重命名文件'}), 400
    path = data.get('path', '')
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    if not old_name or not new_name:
        return jsonify({'success': False, 'error': '名称缺失'}), 400
    if get_folder_permission(path) == 'ro':
        return jsonify({'success': False, 'error': '文件夹为只读权限，无法重命名'}), 403
    old_ext = os.path.splitext(old_name)[1]
    new_ext = os.path.splitext(new_name)[1]
    if old_ext != new_ext:
        return jsonify({'success': False, 'error': '不能修改文件扩展名'}), 400
    if '..' in new_name or '/' in new_name or '\\' in new_name:
        return jsonify({'success': False, 'error': '新名称包含非法字符'}), 400
    target_dir = os.path.join(WORK_BASE, path)
    old_path = os.path.join(target_dir, old_name)
    new_path = os.path.join(target_dir, new_name)
    if not is_safe_path(WORK_BASE, old_path) or not is_safe_path(WORK_BASE, new_path):
        return jsonify({'success': False, 'error': '非法路径'}), 403
    if not os.path.exists(old_path):
        return jsonify({'success': False, 'error': '原文件不存在'}), 404
    if os.path.exists(new_path):
        return jsonify({'success': False, 'error': '新名称已存在'}), 409
    os.rename(old_path, new_path)
    invalidate_tree_cache(WORK_BASE)
    old_rel = os.path.join(path, old_name).replace('\\', '/')
    new_rel = os.path.join(path, new_name).replace('\\', '/')
    rename_upload_record(old_rel, new_rel)
    return jsonify({'success': True})

# ---------- 首页 ----------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(BASE_DIR, 'favicon.ico')

@app.route('/media/<path:filename>')
def media_file(filename):
    media_dir = os.path.join(BASE_DIR, 'media')
    return send_from_directory(media_dir, filename)

@app.route('/api/available_backends')
def available_backends():
    return jsonify(AVAILABLE_BACKENDS)

# 添加在文件末尾，其他路由之后
APP_UPDATE_DIR = os.path.join(BASE_DIR, 'file', 'app')
os.makedirs(APP_UPDATE_DIR, exist_ok=True)
APP_BETA_UPDATE_DIR = os.path.join(BASE_DIR, 'file', 'app_beta')
os.makedirs(APP_BETA_UPDATE_DIR, exist_ok=True)

@app.route('/file/app/<path:filename>')
def serve_app_file(filename):
    return send_from_directory(APP_UPDATE_DIR, filename)

@app.route('/file/app_beta/<path:filename>')
def serve_app_beta_file(filename):
    return send_from_directory(APP_BETA_UPDATE_DIR, filename)

# 在 app.py 末尾（其他路由之后）添加

@app.route('/api/user/info')
def api_user_info():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    users = load_users()
    user = next((u for u in users if u['id'] == uid), None)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    avatar_url = get_user_avatar_url(uid)
    return jsonify({
        'username': user['real_name'],
        'nickname': user['nickname'],
        'avatar': avatar_url,
        'role': '学生',
        'is_developer': user.get('is_developer', False)
    })

_tree_cache = {}
_tree_cache_lock = threading.Lock()

def build_dir_tree(base_path, rel_path=''):
    target = os.path.join(base_path, rel_path) if rel_path else base_path
    if not os.path.exists(target) or not os.path.isdir(target):
        return None
    node = {'name': os.path.basename(target) or rel_path.split('/')[-1] or 'root', 'path': rel_path, 'type': 'directory', 'children': []}
    perm = get_folder_permission(rel_path)
    if perm == 'ro':
        node['readonly'] = True
    try:
        entries = sorted(os.scandir(target), key=lambda e: e.name)
    except OSError:
        return node
    records = load_upload_records()
    for entry in entries:
        sub_rel = os.path.join(rel_path, entry.name).replace('\\', '/')
        if entry.is_dir():
            child = build_dir_tree(base_path, sub_rel)
            if child:
                perm = get_folder_permission(sub_rel)
                depth = sub_rel.count('/') if sub_rel else 0
                child['readonly'] = (perm == 'ro') and (depth >= 2)
                node['children'].append(child)
        else:
            file_info = {'name': entry.name, 'path': sub_rel, 'type': 'file', 'size': entry.stat().st_size}
            if sub_rel in records:
                file_info['uploader'] = records[sub_rel].get('uploader', '')
            node['children'].append(file_info)
    return node

def get_cached_dir_tree(base_path):
    cache_key = base_path
    now = time.time()
    with _tree_cache_lock:
        entry = _tree_cache.get(cache_key)
        if entry and (now - entry['time']) < 5:
            return entry['data']
    tree = build_dir_tree(base_path, '')
    with _tree_cache_lock:
        _tree_cache[cache_key] = {'time': time.time(), 'data': tree}
    return tree

def invalidate_tree_cache(base_path=None):
    with _tree_cache_lock:
        if base_path:
            _tree_cache.pop(base_path, None)
        else:
            _tree_cache.clear()

@app.route('/api/work/tree')
def api_work_tree():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    tree = get_cached_dir_tree(WORK_BASE)
    return jsonify(tree)

@app.route('/api/resource/notify', methods=['POST'])
def notify_resource_update():
    data = request.get_json()
    msg = data.get('msg', '新素材已收到') if data else '新素材已收到'
    push_notification(msg, 'resource')
    return '', 200

@app.route('/api/resource/tree')
def api_resource_tree():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    tree = get_cached_dir_tree(RESOURCE_BASE)
    return jsonify(tree)

_weather_cache = None

@app.route('/api/weather')
def api_weather():
    global _weather_cache
    try:
        url = 'https://wttr.in/Anji?format=j1&lang=zh'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read().decode('utf-8'))
        cur = data.get('current_condition', [{}])[0]
        result = {
            'temp': cur.get('temp_C', ''),
            'weather': cur.get('lang_zh', [{}])[0].get('value', '') if cur.get('lang_zh') else '',
            'text': cur.get('weatherDesc', [{}])[0].get('value', '') if cur.get('weatherDesc') else '',
            'humidity': cur.get('humidity', ''),
            'windSpeed': cur.get('windspeedKmph', '')
        }
        _weather_cache = result
        return jsonify(result)
    except Exception as e:
        print(f'天气获取失败: {e}')
        if _weather_cache:
            return jsonify(_weather_cache)
        return jsonify({'error': '获取失败'}), 500

@app.route('/api/check_update')
def api_check_update():
    try:
        # 优先读取本地 version.json
        local_path = os.path.join(BASE_DIR, 'file', 'app', 'version.json')
        if os.path.exists(local_path):
            with open(local_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify(data)
        # 回退到 HTTP 远程拉取
        update_url = _server_cfg.get('update_version_url', '')
        req = urllib.request.Request(update_url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=2)
        data = json.loads(resp.read().decode('utf-8'))
        return jsonify(data)
    except Exception as e:
        return jsonify({'available': False, 'error': str(e)})

@app.route('/api/search')
def api_search():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    keyword = request.args.get('keyword', '').strip()
    if not keyword:
        return jsonify([])
    results = []
    for root, dirs, files in os.walk(WORK_BASE):
        for f in files:
            if keyword.lower() in f.lower():
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, WORK_BASE).replace('\\', '/')
                results.append({
                    'name': f,
                    'filename': f,
                    'path': rel_path,
                    'size': os.path.getsize(full_path),
                    'mtime': os.path.getmtime(full_path),
                    'uploader': ''
                })
    results.sort(key=lambda x: x['mtime'], reverse=True)
    return jsonify(results)

@app.route('/api/announcements')
def api_announcements():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    ann_path = os.path.join(WORK_BASE, '..', 'announcements.json')
    if not os.path.exists(ann_path):
        return jsonify([])
    try:
        with open(ann_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, list):
            return jsonify(data)
        return jsonify(data.get('announcements', []))
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---------- 开发者文件/文件夹管理 ----------

def _get_base_dir(file_type):
    if file_type == 'resource':
        return RESOURCE_BASE
    return WORK_BASE

def _is_local_request(req):
    addr = req.remote_addr or ''
    if addr.startswith('127.') or addr.startswith('10.') or addr.startswith('192.168.'):
        return True
    if addr.startswith('172.') and 16 <= int(addr.split('.')[1]) <= 31:
        return True
    return False

@app.route('/api/file/delete', methods=['POST'])
def api_file_delete():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    data = request.get_json()
    path = data.get('path', '')
    file_type = data.get('type', 'work')
    if not path:
        return jsonify({'error': '路径缺失'}), 400
    if '..' in path or path.startswith('/') or path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    base_dir = _get_base_dir(file_type)
    target = os.path.join(base_dir, path)
    if not is_safe_path(base_dir, target):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isfile(target):
        return jsonify({'error': '文件不存在'}), 404
    os.remove(target)
    invalidate_tree_cache(base_dir)
    return jsonify({'message': '删除成功'})

@app.route('/api/work/delete_own', methods=['POST'])
def api_work_delete_own():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    users = load_users()
    user = next((u for u in users if u['id'] == uid), None)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    data = request.get_json()
    path = data.get('path', '')
    file_type = data.get('type', 'work')
    if not path:
        return jsonify({'error': '路径缺失'}), 400
    if '..' in path or path.startswith('/') or path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    base_dir = _get_base_dir(file_type)
    target = os.path.join(base_dir, path)
    if not is_safe_path(base_dir, target):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isfile(target):
        return jsonify({'error': '文件不存在'}), 404
    records = load_upload_records()
    record = records.get(path)
    if not record or record.get('uploader') != user['real_name']:
        return jsonify({'error': '无权删除，只能删除自己上传的作业'}), 403
    os.remove(target)
    remove_upload_record(path)
    invalidate_tree_cache(base_dir)
    return jsonify({'message': '删除成功'})

@app.route('/api/file/move', methods=['POST'])
def api_file_move():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    data = request.get_json()
    path = data.get('path', '')
    target_path = data.get('target_path', '')
    file_type = data.get('type', 'work')
    if not path or not target_path:
        return jsonify({'error': '路径缺失'}), 400
    if '..' in path or '..' in target_path:
        return jsonify({'error': '非法路径'}), 400
    base_dir = _get_base_dir(file_type)
    src = os.path.join(base_dir, path)
    dest_dir = os.path.join(base_dir, target_path)
    if not is_safe_path(base_dir, src) or not is_safe_path(base_dir, dest_dir):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isfile(src):
        return jsonify({'error': '源文件不存在'}), 404
    if not os.path.isdir(dest_dir):
        return jsonify({'error': '目标目录不存在'}), 404
    filename = os.path.basename(src)
    dest_file = os.path.join(dest_dir, filename)
    if os.path.exists(dest_file):
        return jsonify({'error': '目标目录已有同名文件'}), 409
    shutil.move(src, dest_file)
    invalidate_tree_cache(base_dir)
    return jsonify({'message': '移动成功'})

@app.route('/api/folder/new', methods=['POST'])
def api_folder_new():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    data = request.get_json()
    parent_path = data.get('parent_path', '')
    folder_name = data.get('folder_name', '')
    file_type = data.get('type', 'work')
    if not parent_path or not folder_name:
        return jsonify({'error': '路径或名称缺失'}), 400
    if '..' in parent_path or '/' in folder_name or '\\' in folder_name:
        return jsonify({'error': '非法路径或名称'}), 400
    base_dir = _get_base_dir(file_type)
    target = os.path.join(base_dir, parent_path, folder_name)
    if not is_safe_path(base_dir, target):
        return jsonify({'error': '非法路径'}), 403
    if os.path.exists(target):
        return jsonify({'error': '文件夹已存在'}), 409
    os.makedirs(target)
    invalidate_tree_cache(base_dir)
    return jsonify({'message': '文件夹创建成功'})

@app.route('/api/folder/set_permission', methods=['POST'])
def api_folder_set_permission():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    data = request.get_json()
    path = data.get('path', '')
    perm = data.get('permission', '')
    file_type = data.get('type', 'work')
    if not path or perm not in ('ro', 'rw'):
        return jsonify({'error': '参数无效'}), 400
    if '..' in path:
        return jsonify({'error': '非法路径'}), 400
    base_dir = _get_base_dir(file_type)
    target = os.path.join(base_dir, path)
    if not is_safe_path(base_dir, target):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isdir(target):
        return jsonify({'error': '目录不存在'}), 404
    perms = load_permissions()
    if perm == 'rw':
        perms.pop(path, None)
    else:
        perms[path] = 'ro'
    with open(PERMISSIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(perms, f, ensure_ascii=False, indent=2)
    invalidate_cache(PERMISSIONS_FILE)
    invalidate_tree_cache(base_dir)
    perm_text = '只读' if perm == 'ro' else '可读写'
    msg = f"文件夹 '{path}' 权限已设为 {perm_text}"
    push_notification(msg, 'perm')
    return jsonify({'message': '权限已更新'})

@app.route('/api/folder/download_zip')
def api_folder_download_zip():
    token = request.headers.get('Authorization', '').replace('Bearer ', '') or request.args.get('token', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    path = request.args.get('path', '')
    file_type = request.args.get('type', 'work')
    if not path:
        return jsonify({'error': '路径缺失'}), 400
    if '..' in path:
        return jsonify({'error': '非法路径'}), 400
    base_dir = _get_base_dir(file_type)
    target = os.path.join(base_dir, path)
    if not is_safe_path(base_dir, target):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isdir(target):
        return jsonify({'error': '目录不存在'}), 404
    total_size = 0
    for root, dirs, files in os.walk(target):
        for f in files:
            fp = os.path.join(root, f)
            try:
                total_size += os.path.getsize(fp)
            except OSError:
                pass
    is_local = _is_local_request(request)
    max_size = 16 * 1024 * 1024
    if not is_local and total_size > max_size:
        return jsonify({'error': '请在局域网内下载', 'size': total_size, 'max': max_size}), 400
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp.name
    tmp.close()
    try:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(target):
                for f in files:
                    fp = os.path.join(root, f)
                    arcname = os.path.relpath(fp, target)
                    zf.write(fp, arcname)
        dir_name = os.path.basename(target) or 'download'
        return send_file(tmp_path, as_attachment=True, download_name=dir_name + '.zip', mimetype='application/zip')
    except Exception as e:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return jsonify({'error': '打包失败: ' + str(e)}), 500

@app.route('/api/folder/rename', methods=['POST'])
def api_folder_rename():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not validate_token(token):
        return jsonify({'error': '未登录'}), 401
    data = request.get_json()
    path = data.get('path', '')
    new_name = data.get('newName', '')
    file_type = data.get('type', 'work')
    if not path or not new_name:
        return jsonify({'error': '路径或新名称缺失'}), 400
    if '..' in path or path.startswith('/') or path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    if '/' in new_name or '\\' in new_name:
        return jsonify({'error': '新名称包含非法字符'}), 400
    base_dir = _get_base_dir(file_type)
    target = os.path.join(base_dir, path)
    if not is_safe_path(base_dir, target):
        return jsonify({'error': '非法路径'}), 403
    parent_dir = os.path.dirname(target)
    new_path = os.path.join(parent_dir, new_name)
    if os.path.exists(new_path):
        return jsonify({'error': '目标文件夹已存在'}), 409
    if not os.path.isdir(target):
        if os.path.isdir(new_path):
            return jsonify({'success': True, 'message': '重命名成功'})
        return jsonify({'error': '目录不存在'}), 404
    os.rename(target, new_path)
    if not os.path.isdir(new_path):
        return jsonify({'error': '重命名失败，请重试'}), 500
    old_rel = path.replace('\\', '/')
    new_rel = os.path.join(os.path.dirname(path), new_name).replace('\\', '/')
    records = load_upload_records()
    updated = {}
    for p, v in records.items():
        if p.startswith(old_rel + '/') or p == old_rel:
            updated[new_rel + p[len(old_rel):]] = v
        else:
            updated[p] = v
    if updated != records:
        save_upload_records(updated)
    invalidate_tree_cache(base_dir)
    old_name = os.path.basename(path)
    msg = f"'{old_name}' 已重命名为 '{new_name}'"
    ntype = 'work-rename' if file_type == 'work' else 'resource-rename'
    push_notification(msg, ntype, file_path=new_rel)
    notify_admin(msg)
    return jsonify({'success': True, 'message': '重命名成功'})

# ---------- 帮我交作业 ----------
@app.route('/api/homework/copy', methods=['POST'])
def api_homework_copy():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    uid = validate_token(token)
    if not uid:
        return jsonify({'error': '未登录'}), 401
    users = load_users()
    user = next((u for u in users if u['id'] == uid), None)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    real_name = user['real_name']
    data = request.get_json()
    folder_path = data.get('folder_path', '')
    files = data.get('files', [])
    new_name = (data.get('new_name', '') or '').strip()
    new_paths = []  # 记录新文件路径，供前端高亮使用
    if not folder_path or not files:
        return jsonify({'error': '参数缺失'}), 400
    if '..' in folder_path or folder_path.startswith('/') or folder_path.startswith('\\'):
        return jsonify({'error': '非法路径'}), 400
    target_dir = os.path.join(WORK_BASE, folder_path)
    if not is_safe_path(WORK_BASE, target_dir):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.isdir(target_dir):
        return jsonify({'error': '目标目录不存在'}), 404
    copied_count = 0
    errors = []
    for filename in files:
        safe_name = filename.replace('/', '').replace('\\', '')
        if safe_name != filename:
            errors.append(f"'{filename}' 文件名包含非法字符")
            continue
        src_file = os.path.join(target_dir, safe_name)
        if not os.path.isfile(src_file):
            errors.append(f"'{safe_name}' 源文件不存在")
            continue
        name_parts = safe_name.rsplit('.', 1)
        if new_name:
            base = new_name
        else:
            base = f"{name_parts[0]}_{real_name}"
        ext = name_parts[1] if len(name_parts) == 2 else ''
        new_filename = f"{base}.{ext}" if ext else base
        dest_file = os.path.join(target_dir, new_filename)
        counter = 1
        while os.path.exists(dest_file) and os.path.isfile(dest_file):
            new_filename = f"{base}_{counter}.{ext}" if ext else f"{base}_{counter}"
            dest_file = os.path.join(target_dir, new_filename)
            counter += 1
        shutil.copy2(src_file, dest_file)
        file_rel_path = os.path.join(folder_path, new_filename).replace('\\', '/')
        add_upload_record(file_rel_path, real_name)
        new_paths.append(file_rel_path)
        if real_name:
            msg = f"{real_name} 上传了 '{new_filename}' 到 '{folder_path}'"
            push_notification(msg, 'work-upload', file_path=file_rel_path)
            notify_admin(msg)
        copied_count += 1
    invalidate_tree_cache(WORK_BASE)
    if errors:
        return jsonify({
            'message': f'已复制 {copied_count} 个文件，{len(errors)} 个失败: {"; ".join(errors)}',
            'copied_count': copied_count,
            'errors': errors,
            'new_paths': new_paths
        })
    return jsonify({
        'message': f'已复制 {copied_count} 个文件',
        'copied_count': copied_count,
        'new_paths': new_paths
    })

if __name__ == '__main__':
    print("启动上传系统，端口 80")
    app.run(host='0.0.0.0', port=80, debug=False, threaded=True)