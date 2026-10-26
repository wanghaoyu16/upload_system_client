import os
import re
import json
import time
import shutil
import hashlib
import urllib.request
from collections import deque
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': '文件过大，上传限制为 2GB'}), 413

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

BASE_DIR = _server_cfg.get('data_dir', os.path.join(os.path.dirname(__file__), 'data'))
WORK_BASE = os.path.join(BASE_DIR, 'file', 'work')
RESOURCE_BASE = os.path.join(BASE_DIR, 'file', 'resource')
RECYCLE_BASE = os.path.join(BASE_DIR, 'file', 'recycle')
RECYCLE_META_FILE = os.path.join(RECYCLE_BASE, 'recycle_meta.json')
USER_DATA_DIR = os.path.join(BASE_DIR, 'userdata')
PERMISSIONS_FILE = os.path.join(BASE_DIR, 'file', 'permissions.json')
AVATAR_DIR = os.path.join(USER_DATA_DIR, 'avatars')
UPLOAD_RECORDS_FILE = os.path.join(BASE_DIR, 'file', 'upload_records.json')
NOTIFICATION_FILE = os.path.join(USER_DATA_DIR, 'admin_notifications.json')
command_queue = {}

os.makedirs(RECYCLE_BASE, exist_ok=True)
os.makedirs(USER_DATA_DIR, exist_ok=True)
os.makedirs(WORK_BASE, exist_ok=True)
os.makedirs(RESOURCE_BASE, exist_ok=True)
os.makedirs(AVATAR_DIR, exist_ok=True)



# ---------- 通知队列（程序启动清空）----------
def init_admin_notifications():
    with open(NOTIFICATION_FILE, 'w', encoding='utf-8') as f:
        json.dump({'queue': [], 'counter': 0}, f)
    print("[管理通知] 已清空通知队列文件")
init_admin_notifications()

def load_admin_notifications():
    with open(NOTIFICATION_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
        return deque(data.get('queue', []), maxlen=200), data.get('counter', 0)

def save_admin_notifications(queue, counter):
    with open(NOTIFICATION_FILE, 'w', encoding='utf-8') as f:
        json.dump({'queue': list(queue), 'counter': counter}, f)
    print(f"[管理通知] 保存队列，当前计数: {counter}")

admin_queue, admin_counter = load_admin_notifications()

def push_admin_notification(msg):
    global admin_counter
    admin_counter += 1
    admin_queue.append({'id': admin_counter, 'msg': msg, 'timestamp': time.time()})
    save_admin_notifications(admin_queue, admin_counter)
    print(f"[管理通知] 新通知: {msg} (ID: {admin_counter})")

def notify_upload_system(msg):
    try:
        data = json.dumps({'msg': msg}).encode('utf-8')
        req = urllib.request.Request('http://127.0.0.1:80/api/add_notification', data=data,
                                     headers={'Content-Type': 'application/json'}, method='POST')
        urllib.request.urlopen(req, timeout=1)
        print(f"[管理通知] 已发送至上传系统: {msg}")
    except Exception as e:
        print(f"[管理通知] 发送至上传系统失败: {e}")

# ---------- 用户管理 ----------
def load_users():
    users_file = os.path.join(USER_DATA_DIR, 'users.json')
    if not os.path.exists(users_file):
        return []
    with open(users_file, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_users(users):
    with open(os.path.join(USER_DATA_DIR, 'users.json'), 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

def hash_password(password, salt=None):
    if salt is None:
        salt = os.urandom(16).hex()
    pwd_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return salt, pwd_hash

# ---------- 权限管理 ----------
def load_permissions():
    if not os.path.exists(PERMISSIONS_FILE):
        return {}
    with open(PERMISSIONS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_permissions(perms):
    with open(PERMISSIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(perms, f, ensure_ascii=False, indent=2)

def set_folder_permission(rel_path, mode):
    perms = load_permissions()
    if mode == 'rw':
        keys_to_remove = [k for k in perms if k == rel_path or k.startswith(rel_path + '/')]
        for k in keys_to_remove:
            del perms[k]
    else:
        perms[rel_path] = 'ro'
        keys_to_remove = [k for k in perms if k.startswith(rel_path + '/')]
        for k in keys_to_remove:
            del perms[k]
    save_permissions(perms)

# ---------- 通用工具 ----------
def is_safe_path(base_path, target_path):
    target_path = os.path.abspath(target_path)
    base_path = os.path.abspath(base_path)
    return target_path.startswith(base_path)

def get_full_path(base, rel_path):
    if '..' in rel_path or rel_path.startswith('/') or rel_path.startswith('\\'):
        return None
    target = os.path.join(base, rel_path)
    if not is_safe_path(base, target):
        return None
    return target

def safe_filename(filename):
    filename = filename.replace('\\', '').replace('/', '')
    safe = re.sub(r'[^\u4e00-\u9fff\w\.\-]', '', filename)
    if not safe or safe == '.' or safe == '..':
        safe = 'file'
    return safe

def init_recycle():
    if not os.path.exists(RECYCLE_META_FILE):
        with open(RECYCLE_META_FILE, 'w', encoding='utf-8') as f:
            json.dump([], f)

def load_recycle_meta():
    with open(RECYCLE_META_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_recycle_meta(meta):
    with open(RECYCLE_META_FILE, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

@app.route('/')
def index():
    return render_template('admin_index.html')

@app.route('/api/notifications')
def get_notifications():
    q, _ = load_admin_notifications()
    return jsonify(list(q))

@app.route('/api/add_notification', methods=['POST'])
def add_notification_api():
    data = request.get_json()
    msg = data.get('msg', '')
    if msg:
        push_admin_notification(msg)
    return '', 200

@app.route('/api/admin/users')
def admin_users():
    users = load_users()
    safe_users = []
    for u in users:
        uid = u['id']
        avatar_url = None
        for ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
            if os.path.exists(os.path.join(AVATAR_DIR, f'{uid}.{ext}')):
                avatar_url = f'/api/avatars/{uid}.{ext}'
                break
        safe_users.append({
            'id': uid,
            'real_name': u['real_name'],
            'nickname': u['nickname'],
            'avatar_url': avatar_url,
            'is_developer': u.get('is_developer', False)
        })
    return jsonify(safe_users)

@app.route('/api/avatars/<path:filename>')
def avatar_file(filename):
    return send_from_directory(AVATAR_DIR, filename)

@app.route('/api/admin/update_user', methods=['POST'])
def admin_update_user():
    data = request.get_json()
    user_id = data.get('user_id')
    real_name = data.get('real_name')
    password = data.get('password')
    users = load_users()
    user = next((u for u in users if u['id'] == user_id), None)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    if real_name:
        if any(u['real_name'] == real_name and u['id'] != user_id for u in users):
            return jsonify({'error': '真实姓名已存在'}), 400
        user['real_name'] = real_name
        if not user.get('nickname'):
            user['nickname'] = real_name
    if password:
        salt, pwd_hash = hash_password(password)
        user['salt'] = salt
        user['password'] = pwd_hash
    save_users(users)
    return jsonify({'success': True})

@app.route('/api/admin/users/<user_id>/developer', methods=['POST'])
def toggle_developer(user_id):
    data = request.get_json()
    is_dev = data.get('is_developer', False)
    users = load_users()
    user = next((u for u in users if u['id'] == user_id), None)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    user['is_developer'] = is_dev
    save_users(users)
    return jsonify({'success': True, 'is_developer': is_dev})

@app.route('/api/permissions/list')
def permissions_list():
    return jsonify(load_permissions())

@app.route('/api/permissions/set', methods=['POST'])
def permissions_set():
    data = request.get_json()
    rel_path = data.get('path')
    mode = data.get('mode')
    if not rel_path or mode not in ('rw', 'ro'):
        return jsonify({'error': '参数错误'}), 400
    set_folder_permission(rel_path, mode)
    msg = f"文件夹 '{rel_path}' 权限已设为 {'可读写' if mode=='rw' else '只读'}"
    push_admin_notification(msg)
    notify_upload_system(msg)
    return jsonify({'success': True})

def load_upload_records():
    if os.path.exists(UPLOAD_RECORDS_FILE):
        with open(UPLOAD_RECORDS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

@app.route('/api/list_dir')
def api_list_dir():
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
                    dirs.append({'name': entry.name, 'type': 'dir', 'path': sub_path, 'permission': permission})
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
    is_root_readonly = perms.get(rel_path, 'rw') == 'ro' if rel_path else perms.get('', 'rw') == 'ro'
    return jsonify({'dirs': dirs, 'files': files, 'current_path': rel_path, 'readonly': is_root_readonly})

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

@app.route('/api/mkdir', methods=['POST'])
def api_mkdir():
    data = request.get_json()
    type_ = data.get('type')
    rel_path = data.get('path', '')
    folder_name = data.get('name')
    if not folder_name or '/' in folder_name or '\\' in folder_name:
        return jsonify({'error': '无效文件夹名称'}), 400
    base = WORK_BASE if type_ == 'work' else RESOURCE_BASE
    parent = get_full_path(base, rel_path)
    if not parent:
        return jsonify({'error': '路径无效'}), 400
    new_dir = os.path.join(parent, folder_name)
    if os.path.exists(new_dir):
        return jsonify({'error': '文件夹已存在'}), 409
    os.makedirs(new_dir)
    return jsonify({'success': True})

@app.route('/api/upload', methods=['POST'])
def api_upload():
    type_ = request.form.get('type')
    rel_path = request.form.get('path', '')
    if type_ != 'resource':
        return "仅支持素材上传", 400
    target_dir = get_full_path(RESOURCE_BASE, rel_path)
    if not target_dir or not os.path.exists(target_dir):
        return "目标文件夹不存在", 404
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
        return f"文件 '{filename}' 已存在", 400
    file.save(file_path)
    msg = f"素材文件已上传 '{filename}'"
    push_admin_notification(msg)
    notify_upload_system(msg)
    return "OK", 200

@app.route('/api/download_work', methods=['GET'])
def download_work():
    rel_path = request.args.get('rel_path', '')
    filename = request.args.get('filename')
    if not filename:
        return "文件名缺失", 400
    if '..' in rel_path or rel_path.startswith('/') or rel_path.startswith('\\'):
        return "非法路径", 400
    target_dir = get_full_path(WORK_BASE, rel_path)
    if not target_dir:
        return "路径无效", 404
    file_path = os.path.join(target_dir, filename)
    if not os.path.isfile(file_path):
        return "文件不存在", 404
    return send_from_directory(target_dir, filename, as_attachment=True)

@app.route('/api/rename_work', methods=['POST'])
def rename_work():
    data = request.get_json()
    rel_path = data.get('rel_path', '')
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    if not old_name or not new_name:
        return jsonify({'error': '名称缺失'}), 400
    old_ext = os.path.splitext(old_name)[1]
    new_ext = os.path.splitext(new_name)[1]
    if old_ext != new_ext:
        return jsonify({'error': '不能修改文件扩展名'}), 400
    if '..' in new_name or '/' in new_name or '\\' in new_name:
        return jsonify({'error': '新名称包含非法字符'}), 400
    target_dir = get_full_path(WORK_BASE, rel_path)
    if not target_dir:
        return jsonify({'error': '路径无效'}), 400
    old_path = os.path.join(target_dir, old_name)
    new_path = os.path.join(target_dir, new_name)
    if not os.path.exists(old_path):
        return jsonify({'error': '原文件不存在'}), 404
    if os.path.exists(new_path):
        return jsonify({'error': '新名称已存在'}), 409
    os.rename(old_path, new_path)
    # 更新上传记录
    records = load_upload_records()
    old_rel = os.path.join(rel_path, old_name).replace('\\', '/')
    new_rel = os.path.join(rel_path, new_name).replace('\\', '/')
    if old_rel in records:
        records[new_rel] = records.pop(old_rel)
        with open(UPLOAD_RECORDS_FILE, 'w', encoding='utf-8') as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
    return jsonify({'success': True})

@app.route('/api/delete_work', methods=['POST'])
def delete_work():
    data = request.get_json()
    rel_path = data.get('rel_path', '')
    name = data.get('name')
    if not name:
        return jsonify({'error': '名称缺失'}), 400
    target_dir = get_full_path(WORK_BASE, rel_path)
    if not target_dir:
        return jsonify({'error': '路径无效'}), 400
    src_path = os.path.join(target_dir, name)
    if not os.path.exists(src_path):
        return jsonify({'error': '文件/文件夹不存在'}), 404
    # 删除上传记录
    records = load_upload_records()
    file_rel = os.path.join(rel_path, name).replace('\\', '/')
    if file_rel in records:
        del records[file_rel]
        with open(UPLOAD_RECORDS_FILE, 'w', encoding='utf-8') as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
    timestamp = int(time.time())
    recycle_name = f"{name}_{timestamp}"
    dest_path = os.path.join(RECYCLE_BASE, recycle_name)
    shutil.move(src_path, dest_path)
    meta = load_recycle_meta()
    meta.append({
        'original_type': 'work',
        'original_path': file_rel,
        'recycle_name': recycle_name,
        'item_type': 'file' if os.path.isfile(src_path) else 'dir',
        'deleted_at': timestamp
    })
    save_recycle_meta(meta)
    return jsonify({'success': True})

@app.route('/api/recycle_list')
def api_recycle_list():
    meta = load_recycle_meta()
    items = []
    for item in meta:
        recycle_path = os.path.join(RECYCLE_BASE, item['recycle_name'])
        if os.path.exists(recycle_path):
            size = None
            if os.path.isfile(recycle_path):
                size = os.path.getsize(recycle_path)
            items.append({
                'original_path': item['original_path'],
                'original_type': item['original_type'],
                'recycle_name': item['recycle_name'],
                'item_type': item['item_type'],
                'deleted_at': item['deleted_at'],
                'size': size
            })
    items.sort(key=lambda x: x['deleted_at'], reverse=True)
    return jsonify(items)

@app.route('/api/restore', methods=['POST'])
def api_restore():
    data = request.get_json()
    recycle_name = data.get('recycle_name')
    if not recycle_name:
        return jsonify({'error': '缺少回收项标识'}), 400
    src_path = os.path.join(RECYCLE_BASE, recycle_name)
    if not os.path.exists(src_path):
        return jsonify({'error': '回收站文件已丢失'}), 404
    meta = load_recycle_meta()
    target_item = None
    for item in meta:
        if item['recycle_name'] == recycle_name:
            target_item = item
            break
    if not target_item:
        return jsonify({'error': '元数据不存在'}), 404
    base = WORK_BASE if target_item['original_type'] == 'work' else RESOURCE_BASE
    dest_path = os.path.join(base, target_item['original_path'])
    if os.path.exists(dest_path):
        return jsonify({'error': '原位置已存在同名文件/文件夹'}), 409
    shutil.move(src_path, dest_path)
    meta = [item for item in meta if item['recycle_name'] != recycle_name]
    save_recycle_meta(meta)
    return jsonify({'success': True})

@app.route('/api/permanent_delete', methods=['POST'])
def api_permanent_delete():
    data = request.get_json()
    recycle_name = data.get('recycle_name')
    if not recycle_name:
        return jsonify({'error': '缺少回收项标识'}), 400
    src_path = os.path.join(RECYCLE_BASE, recycle_name)
    if os.path.exists(src_path):
        if os.path.isfile(src_path):
            os.remove(src_path)
        else:
            shutil.rmtree(src_path)
    meta = load_recycle_meta()
    meta = [item for item in meta if item['recycle_name'] != recycle_name]
    save_recycle_meta(meta)
    return jsonify({'success': True})

@app.route('/api/admin/delete_user', methods=['POST'])
def admin_delete_user():
    data = request.get_json()
    user_id = data.get('user_id')
    if not user_id:
        return jsonify({'error': '缺少用户ID'}), 400
    users = load_users()
    new_users = [u for u in users if u['id'] != user_id]
    if len(new_users) == len(users):
        return jsonify({'error': '用户不存在'}), 404
    save_users(new_users)
    # 可选：同时删除该用户的头像文件
    import glob
    for f in glob.glob(os.path.join(AVATAR_DIR, f'{user_id}.*')):
        os.remove(f)
    return jsonify({'success': True})

@app.route('/media/<path:filename>')
def media_file(filename):
    media_dir = os.path.join(BASE_DIR, 'media')
    return send_from_directory(media_dir, filename)

@app.route('/api/move_work_file', methods=['POST'])
def move_work_file():
    data = request.get_json()
    src_rel_path = data.get('src_rel_path')      # 文件当前相对路径（包含文件名）
    dest_dir_rel_path = data.get('dest_dir_rel_path')  # 目标文件夹相对路径（不包含文件名）
    filename = data.get('filename')
    if not src_rel_path or dest_dir_rel_path is None or not filename:
        return jsonify({'error': '参数缺失'}), 400
    # 安全检查
    src_full = os.path.join(WORK_BASE, src_rel_path)
    dest_dir_full = os.path.join(WORK_BASE, dest_dir_rel_path)
    if not is_safe_path(WORK_BASE, src_full) or not is_safe_path(WORK_BASE, dest_dir_full):
        return jsonify({'error': '路径无效'}), 403
    if not os.path.exists(src_full):
        return jsonify({'error': '源文件不存在'}), 404
    if not os.path.exists(dest_dir_full):
        return jsonify({'error': '目标文件夹不存在'}), 404
    # 检查目标位置是否已有同名文件
    dest_full = os.path.join(dest_dir_full, filename)
    if os.path.exists(dest_full):
        return jsonify({'error': '目标文件夹已存在同名文件'}), 409
    try:
        # 移动文件
        shutil.move(src_full, dest_full)
        # 更新上传记录：修改路径
        upload_records_file = os.path.join(BASE_DIR, 'file', 'upload_records.json')
        if os.path.exists(upload_records_file):
            with open(upload_records_file, 'r', encoding='utf-8') as f:
                records = json.load(f)
            old_key = src_rel_path.replace('\\', '/')
            new_key = os.path.join(dest_dir_rel_path, filename).replace('\\', '/')
            if old_key in records:
                records[new_key] = records.pop(old_key)
                with open(upload_records_file, 'w', encoding='utf-8') as f:
                    json.dump(records, f, ensure_ascii=False, indent=2)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
# 命令队列 (使用字典存储, key 为用户名, value 为命令列表)
command_queue = {}

@app.route('/api/send_command', methods=['POST'])
def send_command():
    data = request.get_json()
    username = data.get('username')
    command = data.get('command')
    if not username or not command:
        return jsonify({'error': '参数缺失'}), 400
    if username not in command_queue:
        command_queue[username] = []
    command_queue[username].append(command)
    return jsonify({'success': True})

@app.route('/api/get_command', methods=['POST'])
def get_command():
    data = request.get_json()
    username = data.get('username')
    if not username:
        return jsonify({'error': '用户名缺失'}), 400
    if username not in command_queue:
        return jsonify({'commands': []})
    commands = command_queue.pop(username, [])
    return jsonify({'commands': commands})

if __name__ == '__main__':
    init_recycle()
    print("启动管理系统，端口 50")
    app.run(host='0.0.0.0', port=50, debug=False)