"""CARVIA local coursework server. Python 3.10+, standard library only.

Run: python server/app.py
Create administrator: python server/app.py --create-admin
All money operations are simulations. Do not expose this development server publicly.
"""
import argparse
import getpass
import hashlib
import hmac
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs, unquote

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('CARVIA_DATA_DIR', ROOT / 'server' / 'data')).resolve()
DB = DATA / 'carvia.sqlite3'
POLICY = json.loads((ROOT / 'server/policy.json').read_text(encoding='utf-8'))
CATALOG = json.loads((ROOT / 'server/catalog.json').read_text(encoding='utf-8'))
CATALOG_MAP = {c['id']: c for c in CATALOG}
VN = timezone(timedelta(hours=7))
BLOCKING = ('QUOTED', 'AWAITING_PAYMENT', 'CONFIRMED', 'RENTING')
LABELS = {'REQUESTED':'Chờ kiểm tra xe', 'QUOTED':'Chờ chấp nhận báo giá',
          'AWAITING_PAYMENT':'Chờ ghi nhận giữ chỗ', 'CONFIRMED':'Đã xác nhận',
          'RENTING':'Đang thuê', 'COMPLETED':'Đã trả xe', 'CANCELLED':'Đã hủy',
          'REJECTED':'Không thể đáp ứng', 'EXPIRED':'Báo giá hết hạn'}

class Problem(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def need(condition, message, status=400):
    if not condition:
        raise Problem(message, status)


def text(value, limit=500):
    need(isinstance(value, str), 'Dữ liệu văn bản không hợp lệ.')
    value = value.strip()
    need(len(value) <= limit, 'Nội dung quá dài.')
    return value


def integer(value, minimum=0, maximum=1000000000):
    need(isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum,
         'Giá trị số không hợp lệ.')
    return value


def email(value):
    value = text(value, 120).lower()
    need(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value), 'Email không hợp lệ.')
    return value


def phone(value):
    value = re.sub(r'[ ()-]', '', text(value, 30))
    if value.startswith('+84'):
        value = '0' + value[3:]
    need(re.fullmatch(r'0[35789]\d{8}', value), 'Nhập số di động Việt Nam gồm 10 số, bắt đầu bằng 03/05/07/08/09.')
    return value


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 310000).hex()


class Connection(sqlite3.Connection):
    """`with connection() as db:` commits/rolls back AND closes (sqlite3 alone does not close)."""
    def __exit__(self, *exc):
        try:
            return super().__exit__(*exc)
        finally:
            self.close()


def connection():
    db = sqlite3.connect(DB, timeout=15, factory=Connection)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db


@contextmanager
def transaction():
    db = connection()
    try:
        db.execute('BEGIN IMMEDIATE')
        expire(db)
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    with connection() as db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
          salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS vehicles (
          id TEXT PRIMARY KEY, model_id TEXT NOT NULL, label TEXT NOT NULL,
          gear TEXT NOT NULL, location_id TEXT NOT NULL, daily_price INTEGER,
          active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS blocks (
          id TEXT PRIMARY KEY, vehicle_id TEXT REFERENCES vehicles(id), start REAL NOT NULL,
          end REAL NOT NULL, reason TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
          vehicle_id TEXT REFERENCES vehicles(id), start REAL NOT NULL, end REAL NOT NULL,
          status TEXT NOT NULL, payload TEXT NOT NULL, quote TEXT, expires REAL,
          paid INTEGER NOT NULL DEFAULT 0, refund_due INTEGER NOT NULL DEFAULT 0,
          refunded INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
          created REAL NOT NULL, updated REAL NOT NULL, UNIQUE(owner, request_key));
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT REFERENCES orders(id),
          at REAL NOT NULL, actor TEXT NOT NULL, message TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reports (
          order_id TEXT REFERENCES orders(id), kind TEXT NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY(order_id,kind));
        CREATE TABLE IF NOT EXISTS drafts (
          owner TEXT PRIMARY KEY REFERENCES users(id), payload TEXT NOT NULL, version INTEGER NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_limits (
          key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset REAL NOT NULL);
        ''')
        # Explicitly fictional inventory: one demonstrator per catalog model, not real stock.
        gear_map = {'toyota-wigo':'CVT','toyota-vios':'CVT','toyota-corolla-altis':'CVT',
                    'toyota-avanza-avanza-premio':'CVT','toyota-veloz-cross':'CVT',
                    'toyota-fortuner-2-7':'AT','toyota-camry':'AT','hyundai-creta':'IVT',
                    'hyundai-stargazer':'IVT','hyundai-accent':'CVT','kia-seltos':'CVT',
                    'kia-carens':'IVT'}
        for n, c in enumerate(CATALOG, 1):
            gear = gear_map.get(c['id'], next((g for g in ['AT','CVT','IVT','DCT','MT'] if g in c['gears']), 'AT'))
            db.execute('INSERT OR IGNORE INTO vehicles VALUES(?,?,?,?,?,?,?)',
                       (f'DEMO-{n:03}', c['id'], f"{c['name']} · {gear} · xe mô phỏng {n:02}",
                        gear, 'demo-hcm', c['price'], 1))


def event(db, order_id, actor, message):
    db.execute('INSERT INTO events(order_id,at,actor,message) VALUES(?,?,?,?)',
               (order_id, time.time(), actor, message))


def expire(db):
    for r in db.execute("SELECT id FROM orders WHERE status IN ('QUOTED','AWAITING_PAYMENT') AND expires<=?", (time.time(),)).fetchall():
        db.execute("UPDATE orders SET status='EXPIRED', version=version+1, updated=? WHERE id=?", (time.time(), r['id']))
        event(db, r['id'], 'Hệ thống', 'Báo giá và thời gian giữ xe đã hết hạn.')
    db.execute('DELETE FROM sessions WHERE expires<=?', (time.time(),))


def parse_time(value):
    value = text(value, 35)
    try:
        d = datetime.fromisoformat(value.replace('Z', '+00:00'))
        need(d.tzinfo is not None, 'Thời gian phải có múi giờ.')
        return d.timestamp()
    except (ValueError, OverflowError):
        raise Problem('Ngày giờ không hợp lệ.')


def schedule(start, end):
    a, b = parse_time(start), parse_time(end)
    need(a >= time.time() + POLICY['lead_hours'] * 3600,
         f"Nhận xe phải cách hiện tại ít nhất {POLICY['lead_hours']} giờ.")
    need(POLICY['minimum_hours'] * 3600 <= b-a <= POLICY['maximum_days'] * 86400,
         'Thời gian thuê phải từ 24 giờ đến 90 ngày.')
    return a, b


def available(db, vehicle_id, start, end, exclude=''):
    v = db.execute('SELECT * FROM vehicles WHERE id=?', (vehicle_id,)).fetchone()
    if not v or not v['active'] or v['daily_price'] is None:
        return False
    buffer = POLICY['buffer_hours'] * 3600
    # A single writer transaction protects the check + reservation from races.
    conflict = db.execute('''SELECT 1 FROM orders WHERE vehicle_id=? AND id<>?
        AND status IN ('QUOTED','AWAITING_PAYMENT','CONFIRMED','RENTING')
        AND start < ? AND (end > ? OR (status='RENTING' AND end < ?)) LIMIT 1''',
        (vehicle_id, exclude, end + buffer, start - buffer, time.time())).fetchone()
    blocked = db.execute('SELECT 1 FROM blocks WHERE vehicle_id=? AND start<? AND end>? LIMIT 1',
                         (vehicle_id, end + buffer, start - buffer)).fetchone()
    # After a return, preserve the preparation window using actual hand-back time.
    turnaround = False
    for row in db.execute("SELECT reports.data FROM reports JOIN orders ON orders.id=reports.order_id WHERE orders.vehicle_id=? AND reports.kind='return'", (vehicle_id,)):
        returned = json.loads(row['data'])['at']
        if start < returned + buffer and end + buffer > returned:
            turnaround = True
            break
    return not conflict and not blocked and not turnaround


def estimate(db, data, user_id, exclude=''):
    vehicle_id = text(data.get('vehicle_id', ''), 50)
    v = db.execute('SELECT * FROM vehicles WHERE id=?', (vehicle_id,)).fetchone()
    need(v is not None, 'Chưa chọn xe cụ thể.')
    a, b = schedule(data.get('start', ''), data.get('end', ''))
    need(available(db, vehicle_id, a, b, exclude), 'Xe không còn trống cho lịch này hoặc chưa có giá.', 409)
    delivery = data.get('delivery', 'station')
    need(delivery in ('station','address'), 'Hình thức giao nhận không hợp lệ.')
    address = text(data.get('address', ''), 250)
    need(delivery != 'address' or len(address) >= 10, 'Nhập địa chỉ giao nhận từ 10 ký tự.')
    code = text(data.get('promo', ''), 30).upper()
    need(not code or code == POLICY['promo_code'], 'Mã ưu đãi không hợp lệ.')
    if code:
        for r in db.execute("SELECT quote FROM orders WHERE owner=? AND id<>? AND status IN ('QUOTED','AWAITING_PAYMENT','CONFIRMED','RENTING','COMPLETED') AND quote IS NOT NULL", (user_id, exclude)):
            need(json.loads(r['quote']).get('promo') != code, 'Mã ưu đãi đã được giữ hoặc sử dụng ở một đơn khác.')
    days = math.ceil((b-a)/86400)
    base = v['daily_price'] * days
    discount = min(round(base * POLICY['promo_percent']/100), POLICY['promo_cap']) if code else 0
    delivery_fee = POLICY['delivery_fee_each_way'] * 2 if delivery == 'address' else 0
    total = base + delivery_fee - discount
    simple = data.get('booking_mode') == 'simple'
    effective_policy = {**POLICY, 'deposit_percent':0} if simple else POLICY
    deposit = 0 if simple else math.ceil(total * POLICY['deposit_percent']/100)
    return {'vehicle_id':v['id'], 'model_id':v['model_id'], 'vehicle_label':v['label'],
            'gear':v['gear'], 'location_id':v['location_id'], 'daily_price':v['daily_price'],
            'days':days, 'base':base, 'discount':discount, 'promo':code,
            'delivery_fee':delivery_fee, 'total':total, 'deposit':deposit,
            'remaining':total-deposit, 'security_deposit':POLICY['security_deposit'],
            'start':a, 'end':b, 'policy':effective_policy, 'demo':True,
            'booking_mode':'simple' if simple else 'legacy'}


def get_order(db, order_id, user):
    r = db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
    need(r is not None and (r['owner'] == user['id'] or user['role'] == 'admin'), 'Không tìm thấy đơn hoặc không có quyền truy cập.', 404)
    return r


def order_json(db, r):
    d = dict(r)
    d.pop('request_key', None)
    d['payload'] = json.loads(d['payload'])
    d['quote'] = json.loads(d['quote']) if d['quote'] else None
    d['status_label'] = LABELS[d['status']]
    d['history'] = [dict(x) for x in db.execute('SELECT at,actor,message FROM events WHERE order_id=? ORDER BY id', (d['id'],))]
    d['reports'] = {x['kind']:json.loads(x['data']) for x in db.execute('SELECT kind,data FROM reports WHERE order_id=?', (d['id'],))}
    return d


def apply_action(db, r, user, data):
    action = data.get('action')
    role = user['role']
    admin = role == 'admin'
    who = 'Quản trị' if admin else 'Khách hàng'
    # Payment/refund retries do not create another money movement.
    if action == 'record_demo_payment' and admin and r['paid'] > 0:
        return order_json(db, r)
    if action == 'refund' and admin and r['refunded'] > 0 and r['refund_due'] == 0:
        return order_json(db, r)
    need(data.get('version') == r['version'], 'Đơn vừa thay đổi. Tải lại trước khi thao tác.', 409)
    status = r['status']
    now = time.time()
    q = json.loads(r['quote']) if r['quote'] else None
    payload = json.loads(r['payload'])
    new_status = status
    message = ''
    if action == 'quote':
        need(admin, 'Chỉ quản trị được lập báo giá.', 403)
        need(status in ('REQUESTED','EXPIRED'), 'Không thể lập báo giá ở trạng thái này.', 409)
        need(data.get('contact_checked') is True, 'Cần xác nhận đã kiểm tra thông tin liên hệ trong kịch bản demo.')
        insurance = text(data.get('insurance', ''), 1000)
        need(len(insurance) >= 15, 'Ghi rõ điều kiện bảo hiểm hoặc xác nhận chưa cung cấp bảo hiểm trong demo.')
        q = estimate(db, payload, r['owner'], r['id'])
        q['insurance'] = insurance
        q['contact_checked_demo'] = True
        q['issued_at'] = now
        db.execute('UPDATE orders SET quote=?, expires=? WHERE id=?',
                   (json.dumps(q, ensure_ascii=False), now+POLICY['quote_minutes']*60, r['id']))
        new_status, message = 'QUOTED', 'Đã lập báo giá và giữ xe 30 phút theo cấu hình demo.'
    elif action == 'accept':
        need(r['owner'] == user['id'], 'Chỉ người đặt được chấp nhận báo giá.', 403)
        need(status == 'QUOTED' and q, 'Báo giá không còn hiệu lực.', 409)
        need(data.get('agree') is True, 'Cần đồng ý báo giá và điều kiện.')
        need(r['start'] > now, 'Đã quá giờ nhận xe.', 409)
        need(available(db, r['vehicle_id'], r['start'], r['end'], r['id']), 'Xe không còn khả dụng.', 409)
        new_status, message = 'AWAITING_PAYMENT', 'Khách đã đồng ý báo giá và điều khoản '+q['policy']['version']+'.'
    elif action == 'record_demo_payment':
        need(admin, 'Chỉ quản trị được đối soát.', 403)
        need(status == 'AWAITING_PAYMENT' and q, 'Đơn chưa sẵn sàng ghi nhận giữ chỗ.', 409)
        need(data.get('demo_confirm') is True, 'Cần xác nhận thao tác là mô phỏng.')
        need(integer(data.get('amount')) == q['deposit'], 'Số tiền phải khớp khoản giữ chỗ trong báo giá.')
        need(r['start'] > now and available(db, r['vehicle_id'], r['start'], r['end'], r['id']), 'Xe hoặc lịch không còn hợp lệ.', 409)
        db.execute('UPDATE orders SET paid=?, expires=NULL WHERE id=?', (q['deposit'], r['id']))
        new_status, message = 'CONFIRMED', 'Đã ghi nhận khoản giữ chỗ MÔ PHỎNG; không có giao dịch tiền thật.'
    elif action == 'cancel':
        need(status in ('REQUESTED','QUOTED','AWAITING_PAYMENT','CONFIRMED'), 'Không thể hủy ở trạng thái này.', 409)
        need(now < r['start'] or admin, 'Đã đến giờ nhận. Liên hệ quản trị để xử lý.')
        reason = text(data.get('reason', ''), 500)
        need(len(reason) >= 3, 'Nhập lý do hủy.')
        db.execute('UPDATE orders SET refund_due=paid-refunded,expires=NULL WHERE id=?', (r['id'],))
        new_status, message = 'CANCELLED', 'Hủy đơn: '+reason+'. Khoản giữ chỗ đã ghi nhận được chuyển sang chờ hoàn.'
    elif action == 'reject':
        need(admin, 'Không có quyền.', 403)
        need(status in ('REQUESTED','QUOTED','AWAITING_PAYMENT'), 'Không thể từ chối trạng thái này.', 409)
        reason = text(data.get('reason', ''), 500)
        need(len(reason) >= 3, 'Cần lý do từ chối.')
        new_status, message = 'REJECTED', 'Không thể đáp ứng: '+reason
    elif action == 'refund':
        need(admin and status == 'CANCELLED', 'Chỉ quản trị xử lý hoàn đơn đã hủy.', 403)
        need(r['refund_due'] > 0 and data.get('demo_confirm') is True, 'Không có khoản chờ hoàn hoặc chưa xác nhận mô phỏng.')
        db.execute('UPDATE orders SET refunded=refunded+refund_due,refund_due=0 WHERE id=?', (r['id'],))
        message = 'Đã đối soát hoàn khoản giữ chỗ MÔ PHỎNG.'
    elif action in ('handover','return'):
        need(admin, 'Chỉ quản trị ghi nhận bàn giao.', 403)
        need(status == ('CONFIRMED' if action == 'handover' else 'RENTING'), 'Trạng thái không phù hợp.', 409)
        need(now >= r['start'] if action == 'handover' else True, 'Chưa đến giờ nhận xe.')
        report = {'odometer':integer(data.get('odometer'),0,3000000), 'fuel':integer(data.get('fuel'),0,100),
                  'condition':text(data.get('condition', ''),2000), 'at':now,
                  'acknowledged': data.get('acknowledged') is True, 'demo':True}
        need(len(report['condition']) >= 5 and report['acknowledged'], 'Cần mô tả tình trạng và xác nhận hai bên đã đối chiếu trong kịch bản demo.')
        if action == 'handover':
            need(available(db,r['vehicle_id'],r['start'],r['end'],r['id']), 'Xe chưa được trả hoặc chưa sẵn sàng bàn giao. Quản trị cần xử lý lịch xung đột.',409)
            need(data.get('documents_checked') is True, 'Cần kiểm tra giấy tờ trước khi giao xe.')
            report['documents_checked'] = True
            report['remaining_paid_demo'] = q['remaining']
            report['security_received_demo'] = q['security_deposit']
            need(data.get('money_checked') is True, 'Cần xác nhận tiền thuê còn lại và tiền bảo đảm mô phỏng.')
            new_status, message = 'RENTING', 'Đã lập biên bản nhận xe và ghi nhận tiền thuê còn lại, tiền bảo đảm MÔ PHỎNG.'
        else:
            old = json.loads(db.execute("SELECT data FROM reports WHERE order_id=? AND kind='handover'", (r['id'],)).fetchone()['data'])
            need(report['odometer'] >= old['odometer'], 'Số km trả phải không nhỏ hơn số km nhận.')
            report['distance'] = report['odometer']-old['odometer']
            report['extra_km'] = max(0,report['distance']-q['days']*q['policy']['included_km_per_day'])
            late = now - r['end']
            grace = q['policy'].get('late_grace_minutes', 0) * 60  # old quotes: no grace
            report['late_hours'] = math.ceil(late/3600) if late > grace else 0
            report['other_fee'] = integer(data.get('other_fee',0),0,100000000)
            report['fee_reason'] = text(data.get('fee_reason',''),1000)
            need(not report['other_fee'] or len(report['fee_reason'])>=5, 'Phụ phí phải có lý do đối soát.')
            report['extra_total'] = report['extra_km']*q['policy']['extra_km_rate'] + report['late_hours']*q['policy']['late_hour_rate']+report['other_fee']
            report['security_refund_due'] = max(0,q['security_deposit']-report['extra_total'])
            report['additional_due'] = max(0,report['extra_total']-q['security_deposit'])
            report['settled'] = False
            new_status, message = 'COMPLETED', 'Đã lập biên bản trả xe; còn chờ đối soát tiền bảo đảm và phụ phí.'
        db.execute('INSERT INTO reports VALUES(?,?,?)', (r['id'],action,json.dumps(report,ensure_ascii=False)))
    elif action == 'settle':
        need(admin and status == 'COMPLETED', 'Không có quyền đối soát trạng thái này.', 403)
        report = json.loads(db.execute("SELECT data FROM reports WHERE order_id=? AND kind='return'", (r['id'],)).fetchone()['data'])
        need(not report['settled'] and data.get('demo_confirm') is True, 'Đã đối soát hoặc chưa xác nhận mô phỏng.')
        report['settled'], report['settled_at'] = True, now
        db.execute("UPDATE reports SET data=? WHERE order_id=? AND kind='return'", (json.dumps(report,ensure_ascii=False),r['id']))
        message = 'Đã đối soát tiền bảo đảm và phụ phí MÔ PHỎNG, hoàn tất đơn.'
    else:
        raise Problem('Thao tác không hợp lệ.')
    db.execute('UPDATE orders SET status=?,version=version+1,updated=? WHERE id=?', (new_status, now, r['id']))
    event(db, r['id'], who, message)
    return order_json(db, get_order(db, r['id'], user))


class Handler(BaseHTTPRequestHandler):
    server_version = 'CARVIA'

    def log_message(self, fmt, *args):
        # Do not log personal data, request bodies or session cookies.
        pass

    def send_json(self, data, status=200, cookie=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def session(self, db):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie',''))
            token = cookie['carvia_session'].value
        except (KeyError, ValueError):
            return None
        return db.execute('''SELECT users.*,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id
                          WHERE sessions.token=? AND sessions.expires>?''',
                          (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()

    def do_GET(self):
        try:
            self.check_host()
            if self.path.startswith('/api/'):
                with transaction() as db:
                    self.send_json(self.get_api(db))
            else:
                self.static_file()
        except Problem as e:
            self.send_json({'error':e.message},e.status)
        except (sqlite3.Error, ValueError, TypeError, KeyError):
            self.send_json({'error':'Không thể xử lý dữ liệu. Thử tải lại trang.'},500)

    def check_host(self):
        host = self.headers.get('Host','')
        need(host in (f'localhost:{self.server.server_port}',f'127.0.0.1:{self.server.server_port}'), 'Máy chủ chỉ phục vụ trên localhost.', 403)

    def do_POST(self):
        try:
            self.check_host()
            need(self.headers.get('X-Carvia-Request') == '1', 'Yêu cầu không hợp lệ.',403)
            origin = self.headers.get('Origin')
            need(not origin or origin == 'http://'+self.headers.get('Host'), 'Nguồn yêu cầu không hợp lệ.',403)
            need(self.headers.get('Content-Type','').startswith('application/json'), 'Yêu cầu phải là JSON.',415)
            length = int(self.headers.get('Content-Length','0'))
            need(0 < length <= 20000, 'Yêu cầu quá lớn hoặc rỗng.',413)
            data = json.loads(self.rfile.read(length))
            need(isinstance(data,dict), 'Nội dung không hợp lệ.')
            with transaction() as db:
                result, cookie = self.post_api(db,data)
            self.send_json(result, cookie=cookie)
        except Problem as e:
            self.send_json({'error':e.message},e.status)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            self.send_json({'error':'Dữ liệu gửi lên không hợp lệ.'},400)
        except sqlite3.IntegrityError:
            self.send_json({'error':'Dữ liệu đã tồn tại hoặc vừa thay đổi. Tải lại để kiểm tra.'},409)
        except sqlite3.Error:
            self.send_json({'error':'Cơ sở dữ liệu bận. Vui lòng thử lại.'},503)

    def require_user(self, db, csrf=False):
        user = self.session(db)
        need(user is not None, 'Vui lòng đăng nhập.',401)
        if csrf:
            need(hmac.compare_digest(self.headers.get('X-CSRF-Token',''),user['csrf']), 'Phiên đã thay đổi. Tải lại trang.',403)
        return user

    def get_api(self,db):
        path = urlsplit(self.path).path
        args = parse_qs(urlsplit(self.path).query)
        if path == '/api/session':
            user = self.session(db)
            return {'user':{k:user[k] for k in ['id','name','email','role']} if user else None,
                    'csrf':user['csrf'] if user else None, 'demo':True}
        if path == '/api/policy':
            return POLICY
        if path == '/api/vehicles':
            a = b = None
            if args.get('start') or args.get('end'):
                a,b = schedule(args.get('start',[''])[0],args.get('end',[''])[0])
            rows = db.execute('SELECT * FROM vehicles ORDER BY id').fetchall()
            result = []
            for r in rows:
                v = dict(r)
                if args.get('model') and v['model_id'] != args['model'][0]:
                    continue
                v['available'] = available(db,v['id'],a,b) if a else bool(v['active'] and v['daily_price'] is not None)
                result.append(v)
            return {'vehicles':result, 'demo':True}
        user = self.require_user(db)
        if path == '/api/draft':
            row = db.execute('SELECT * FROM drafts WHERE owner=?',(user['id'],)).fetchone()
            return {'draft':json.loads(row['payload']) if row else {}, 'version':row['version'] if row else 0}
        if path == '/api/orders':
            rows = db.execute('SELECT * FROM orders WHERE owner=? ORDER BY created DESC',(user['id'],)).fetchall()
            return {'orders':[order_json(db,r) for r in rows]}
        if path.startswith('/api/orders/'):
            return order_json(db,get_order(db,path.split('/')[-1],user))
        if path == '/api/admin':
            need(user['role']=='admin','Không có quyền quản trị.',403)
            return {'orders':[order_json(db,r) for r in db.execute('SELECT * FROM orders ORDER BY created DESC')],
                    'vehicles':[dict(r) for r in db.execute('SELECT * FROM vehicles ORDER BY id')],
                    'blocks':[dict(r) for r in db.execute('SELECT * FROM blocks ORDER BY start')]}
        raise Problem('Không tìm thấy API.',404)

    def post_api(self, db, data):
        path = urlsplit(self.path).path
        if path in ('/api/login','/api/register'):
            address = email(data.get('email',''))
            pw = text(data.get('password',''),200)
            need(10 <= len(pw) <= 200, 'Mật khẩu cần từ 10 đến 200 ký tự.')
            # Persist failed-attempt counters even if authentication is rejected.
            key = hashlib.sha256((self.client_address[0]+'|'+address).encode()).hexdigest()
            rate = db.execute('SELECT * FROM login_limits WHERE key=?',(key,)).fetchone()
            need(not rate or rate['reset']<time.time() or rate['attempts']<8, 'Thử quá nhiều lần. Chờ 15 phút.',429)
            if path == '/api/register':
                name = text(data.get('name',''),80)
                need(len(name)>=2,'Nhập họ tên từ 2 ký tự.')
                need(not db.execute('SELECT 1 FROM users WHERE email=?',(address,)).fetchone(),'Email đã được sử dụng.',409)
                salt = secrets.token_hex(16)
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(str(uuid.uuid4()),name,address,salt,password_hash(pw,salt),'customer'))
            user = db.execute('SELECT * FROM users WHERE email=?',(address,)).fetchone()
            valid = user and hmac.compare_digest(user['password_hash'],password_hash(pw,user['salt']))
            if not valid:
                if rate and rate['reset']>time.time():
                    db.execute('UPDATE login_limits SET attempts=attempts+1 WHERE key=?',(key,))
                else:
                    db.execute('INSERT OR REPLACE INTO login_limits VALUES(?,?,?)',(key,1,time.time()+900))
                db.commit()
                raise Problem('Email hoặc mật khẩu không đúng.',401)
            db.execute('DELETE FROM login_limits WHERE key=?',(key,))
            token, csrf = secrets.token_urlsafe(32),secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES(?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user['id'],csrf,time.time()+8*3600))
            return {'ok':True},f'carvia_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'
        user = self.require_user(db,csrf=True)
        if path == '/api/logout':
            db.execute('DELETE FROM sessions WHERE user_id=? AND csrf=?',(user['id'],user['csrf']))
            return {'ok':True},'carvia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
        if path == '/api/draft':
            old = db.execute('SELECT * FROM drafts WHERE owner=?',(user['id'],)).fetchone()
            need(data.get('version') == (old['version'] if old else 0), 'Bản nháp đã đổi ở cửa sổ khác. Tải lại trước khi sửa.',409)
            allowed = ['name','phone','email','vehicle_id','model_id','start','end','delivery','address','promo','note','request_key']
            incoming = data.get('draft', {})
            need(isinstance(incoming, dict), 'Bản nháp không hợp lệ.')
            draft = {k:text(incoming.get(k,''),500) for k in allowed}
            version = (old['version'] if old else 0)+1
            db.execute('INSERT OR REPLACE INTO drafts VALUES(?,?,?,?)',(user['id'],json.dumps(draft,ensure_ascii=False),version,time.time()))
            return {'version':version},None
        if path == '/api/estimate':
            return estimate(db,data,user['id']),None
        if path == '/api/orders':
            key = text(data.get('request_key',''),100)
            need(re.fullmatch(r'[a-zA-Z0-9-]{20,100}',key),'Thiếu khóa chống gửi trùng.')
            old = db.execute('SELECT * FROM orders WHERE owner=? AND request_key=?',(user['id'],key)).fetchone()
            if old:
                return order_json(db,old),None
            need(data.get('agree') is True,'Cần đồng ý gửi yêu cầu và điều kiện demo.')
            name = text(data.get('name',''),80)
            need(len(name)>=2,'Nhập họ tên hợp lệ.')
            p = {'name':name,'phone':phone(data.get('phone','')),'email':email(data.get('email','')),
                 'vehicle_id':text(data.get('vehicle_id',''),50),'start':text(data.get('start',''),35),
                 'end':text(data.get('end',''),35),'delivery':data.get('delivery','station'),
                 'address':text(data.get('address',''),250),'promo':text(data.get('promo',''),30).upper(),
                 'note':text(data.get('note',''),500)}
            q = estimate(db,p,user['id'])
            simple = data.get('booking_mode') == 'simple'
            if simple:
                p['booking_mode'] = 'simple'
                q = estimate(db,p,user['id'])
                need(data.get('expected_total') == q['total'] and data.get('policy_version') == q['policy']['version'],
                     'Giá hoặc điều kiện đã thay đổi. Xem lại tổng tiền trước khi đặt.',409)
                q['insurance'] = POLICY['insurance']
                q['issued_at'] = time.time()
            # Do not hold inventory merely because someone submitted a request.
            id = 'CV-'+uuid.uuid4().hex.upper()
            now = time.time()
            db.execute('''INSERT INTO orders(id,owner,request_key,vehicle_id,start,end,status,payload,created,updated)
                        VALUES(?,?,?,?,?,?,?,?,?,?)''', (id,user['id'],key,p['vehicle_id'],q['start'],q['end'],'REQUESTED',json.dumps(p,ensure_ascii=False),now,now))
            if simple:
                db.execute("UPDATE orders SET status='CONFIRMED',quote=? WHERE id=?",(json.dumps(q,ensure_ascii=False),id))
            db.execute('DELETE FROM drafts WHERE owner=?',(user['id'],))
            event(db,id,'Hệ thống' if simple else 'Khách hàng',
                  'Đã xác nhận xe tự động theo lịch trống. Thanh toán khi nhận xe; chưa thu tiền.' if simple else
                  'Đã gửi yêu cầu; chưa giữ xe, chưa thanh toán. Số điện thoại chưa xác minh OTP.')
            return order_json(db,get_order(db,id,user)),None
        if path.startswith('/api/orders/'):
            r = get_order(db,path.split('/')[-1],user)
            if data.get('action') == 'revise':
                need(r['owner']==user['id'],'Chỉ người đặt được sửa yêu cầu.',403)
                need(data.get('version')==r['version'],'Đơn vừa thay đổi. Tải lại.',409)
                need(r['status'] in ('REQUESTED','QUOTED','AWAITING_PAYMENT','EXPIRED'),'Đơn đã xác nhận: hủy theo chính sách rồi tạo yêu cầu mới.',409)
                p = json.loads(r['payload'])
                for field in ['start','end','vehicle_id','delivery','address','promo','note']:
                    if field in data:
                        p[field] = text(data[field],500)
                q = estimate(db,p,user['id'],r['id'])
                db.execute("UPDATE orders SET vehicle_id=?,start=?,end=?,payload=?,quote=NULL,expires=NULL,status='REQUESTED',version=version+1,updated=? WHERE id=?",
                           (p['vehicle_id'],q['start'],q['end'],json.dumps(p,ensure_ascii=False),time.time(),r['id']))
                event(db,r['id'],'Khách hàng','Đã sửa yêu cầu. Báo giá cũ và giữ chỗ bị hủy; cần báo giá mới.')
                return order_json(db,get_order(db,r['id'],user)),None
            return apply_action(db,r,user,data),None
        need(user['role']=='admin','Không có quyền quản trị.',403)
        if path == '/api/admin/vehicle':
            id = text(data.get('id',''),50)
            v = db.execute('SELECT * FROM vehicles WHERE id=?',(id,)).fetchone()
            need(v is not None,'Không tìm thấy xe.',404)
            price = data.get('daily_price')
            if price is not None:
                integer(price,100000,20000000)
            label = text(data.get('label',''),180)
            need(len(label)>=5 and isinstance(data.get('active'),bool),'Tên xe hoặc trạng thái không hợp lệ.')
            db.execute('UPDATE vehicles SET daily_price=?,label=?,active=? WHERE id=?',(price,label,int(data['active']),id))
            return {'ok':True},None
        if path == '/api/admin/block':
            vehicle_id = text(data.get('vehicle_id',''),50)
            need(db.execute('SELECT 1 FROM vehicles WHERE id=?',(vehicle_id,)).fetchone(),'Không tìm thấy xe.')
            a,b = parse_time(data.get('start','')),parse_time(data.get('end',''))
            need(b>a and b>time.time(),'Thời gian bảo dưỡng không hợp lệ.')
            reason = text(data.get('reason',''),250)
            need(len(reason)>=3,'Nhập lý do khóa lịch.')
            buffer = POLICY['buffer_hours']*3600
            conflict = db.execute("SELECT 1 FROM orders WHERE vehicle_id=? AND status IN ('QUOTED','AWAITING_PAYMENT','CONFIRMED','RENTING') AND start<? AND end>?",(vehicle_id,b+buffer,a-buffer)).fetchone()
            need(not conflict,'Lịch bảo dưỡng xung đột với đơn đang giữ/đã xác nhận.',409)
            db.execute('INSERT INTO blocks VALUES(?,?,?,?,?)',(str(uuid.uuid4()),vehicle_id,a,b,reason))
            return {'ok':True},None
        if path == '/api/admin/unblock':
            db.execute('DELETE FROM blocks WHERE id=?',(text(data.get('id',''),50),))
            return {'ok':True},None
        raise Problem('Không tìm thấy thao tác.',404)

    def static_file(self):
        relative = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        p = (ROOT/relative).resolve()
        need(p.is_relative_to(ROOT) and p.is_file(),'Không tìm thấy tệp.',404)
        # Explicit public allowlist keeps database, passwords, source and config private.
        allowed = ((p.parent == ROOT and p.suffix in ('.html','.js','.css')) or
                   (p.is_relative_to(ROOT/'assets') and p.suffix.lower() in ('.png','.jpg','.jpeg','.svg','.webp','.ico')))
        need(allowed,'Không tìm thấy tệp.',404)
        body = p.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type',mimetypes.guess_type(p.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Referrer-Policy','same-origin')
        self.send_header('Cache-Control','no-cache')
        self.end_headers()
        self.wfile.write(body)


def create_admin():
    address = email(input('Email quản trị: '))
    password = getpass.getpass('Mật khẩu (ít nhất 12 ký tự): ')
    need(len(password)>=12,'Mật khẩu quản trị cần ít nhất 12 ký tự.')
    need(password==getpass.getpass('Nhập lại mật khẩu: '),'Mật khẩu không khớp.')
    salt = secrets.token_hex(16)
    with connection() as db:
        need(not db.execute('SELECT 1 FROM users WHERE email=?',(address,)).fetchone(),'Email đã tồn tại. Dùng email riêng cho quản trị.')
        db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(str(uuid.uuid4()),'Quản trị CARVIA',address,salt,password_hash(password,salt),'admin'))
    print('Đã tạo tài khoản quản trị. Không có mật khẩu mặc định.')


if __name__ == '__main__':
    # Console Windows (cp1252) hoặc output bị chuyển hướng không in được tiếng Việt → tránh crash khi khởi động.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8000)
    parser.add_argument('--create-admin',action='store_true')
    args = parser.parse_args()
    init_db()
    if args.create_admin:
        try:
            create_admin()
        except Problem as e:
            raise SystemExit(e.message)
    else:
        print(f'CARVIA demo: http://localhost:{args.port} — Ctrl+C để dừng.')
        ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
