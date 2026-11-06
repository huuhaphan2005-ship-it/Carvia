"""Integration tests with an isolated SQLite database and local HTTP server.
Run from carvia: python -m unittest discover -s tests -v
"""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
import http.cookiejar
from datetime import datetime, timezone
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('carvia_server',Path(__file__).resolve().parents[1]/'server/app.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf = ''

    def call(self, path, data=None, headers=None):
        h={'Content-Type':'application/json','X-Carvia-Request':'1','X-CSRF-Token':self.csrf}
        h.update(headers or {})
        req=urllib.request.Request(self.base+'/api/'+path,data=json.dumps(data).encode() if data is not None else None,headers=h)
        try:
            with self.opener.open(req) as r:
                return r.status,json.load(r)
        except urllib.error.HTTPError as e:
            return e.code,json.load(e)

    def register(self,email):
        code,data=self.call('register',{'name':'Khach Thu','email':email,'password':'DemoTestOnly123!'})
        assert code==200,(code,data)
        self.csrf=self.call('session')[1]['csrf']
        return self.call('session')[1]['user']

class BookingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        app.DATA=Path(self.tmp.name);app.DB=app.DATA/'test.sqlite3';app.init_db()
        self.server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:'+str(self.server.server_port)
        self.customer=Client(self.base);self.user=self.customer.register('customer@example.test')
        self.other=Client(self.base);self.other.register('other@example.test')
        self.admin=Client(self.base);self.admin_user=self.admin.register('admin@example.test')
        with app.connection() as db:db.execute("UPDATE users SET role='admin' WHERE id=?",(self.admin_user['id'],))
        self.start=time.time()+3*3600+60
        self.data={'request_key':'test-request-key-0000000001','name':'Khach Thu','phone':'0900000000','email':'customer@example.test','vehicle_id':'DEMO-001','start':datetime.fromtimestamp(self.start,timezone.utc).isoformat(),'end':datetime.fromtimestamp(self.start+86400,timezone.utc).isoformat(),'delivery':'station','address':'','promo':'','note':'','agree':True}

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()

    def order(self,client=None,**changes):
        c=client or self.customer
        code,o=c.call('orders',{**self.data,**changes});self.assertEqual(code,200,o);return o

    def action(self,o,action,client=None,**extra):
        return (client or self.admin).call('orders/'+o['id'],{'action':action,'version':o['version'],**extra})

    def quoted(self,o=None):
        o=o or self.order()
        code,o=self.action(o,'quote',contact_checked=True,insurance='Demo: chưa cung cấp bảo hiểm; chỉ mô phỏng nghiệp vụ.')
        self.assertEqual(code,200,o);return o

    def confirmed(self):
        o=self.quoted()
        code,o=self.action(o,'accept',self.customer,agree=True);self.assertEqual(code,200,o)
        code,o=self.action(o,'record_demo_payment',amount=o['quote']['deposit'],demo_confirm=True);self.assertEqual(code,200,o)
        return o

    def test_idempotent_request(self):
        a=self.order();b=self.order();self.assertEqual(a['id'],b['id'])
        self.assertEqual(len(self.customer.call('orders')[1]['orders']),1)

    def test_invalid_draft_type(self):
        for value in [None, [], 'invalid']:
            self.assertEqual(self.customer.call('draft', {'version':0, 'draft':value})[0],400)
        self.assertEqual(self.customer.call('draft', {'version':0, 'draft':{'name':'Khach Thu'}})[0],200)

    def test_auth_and_order_ownership(self):
        o=self.order()
        self.assertEqual(self.other.call('orders/'+o['id'])[0],404)
        self.assertEqual(self.customer.call('admin')[0],403)
        self.assertEqual(Client(self.base).call('orders')[0],401)
        self.assertEqual(self.action(o,'quote',self.customer)[0],403)

    def test_csrf_and_origin(self):
        self.assertEqual(self.customer.call('orders',self.data,{'X-CSRF-Token':'bad'})[0],403)
        self.assertEqual(self.customer.call('orders',self.data,{'Origin':'https://other.invalid'})[0],403)

    def test_phone_and_dates(self):
        for changes in [{'phone':'         '},{'phone':'++++++++++'},{'start':'2020-01-01T10:00:00+07:00'},{'end':self.data['start']},{'start':'2027-02-30T10:00:00+07:00'}]:
            self.assertEqual(self.customer.call('orders',{**self.data,**changes})[0],400)

    def test_server_controls_price(self):
        o=self.order(total=1,daily_price=1)
        o=self.quoted(o)
        self.assertEqual(o['quote']['daily_price'],600000)
        self.assertEqual(o['quote']['total'],600000)
        self.assertEqual(o['quote']['deposit'],180000)
        self.assertEqual(o['quote']['remaining'],420000)

    def test_quote_holds_prevent_overlap(self):
        o=self.order();other=self.order(self.other)
        self.quoted(o)
        self.assertEqual(self.action(other,'quote',contact_checked=True,insurance='Demo không cung cấp bảo hiểm.')[0],409)

    def test_concurrent_quote_only_one_wins(self):
        a=self.order();b=self.order(self.other)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(self.action,o,'quote',contact_checked=True,insurance='Demo không cung cấp bảo hiểm.') for o in [a,b]]
            statuses=sorted(f.result()[0] for f in futures)
        self.assertEqual(statuses,[200,409])

    def test_buffer_and_maintenance(self):
        o=self.quoted();self.data['request_key']='test-request-key-0000000002'
        end=self.start+86400
        too_close=datetime.fromtimestamp(end+3600,timezone.utc).isoformat()
        later=datetime.fromtimestamp(end+90000,timezone.utc).isoformat()
        self.assertEqual(self.customer.call('estimate',{**self.data,'start':too_close,'end':later})[0],409)
        ok=datetime.fromtimestamp(end+7200,timezone.utc).isoformat()
        self.assertEqual(self.customer.call('estimate',{**self.data,'start':ok,'end':datetime.fromtimestamp(end+93600,timezone.utc).isoformat()})[0],200)
        self.assertEqual(self.admin.call('admin/block',{'vehicle_id':'DEMO-001','start':self.data['start'],'end':self.data['end'],'reason':'Bảo dưỡng'})[0],409)
        self.assertEqual(self.admin.call('admin/block',{'vehicle_id':'DEMO-002','start':self.data['start'],'end':self.data['end'],'reason':'Bảo dưỡng'})[0],200)
        self.assertEqual(self.customer.call('estimate',{**self.data,'vehicle_id':'DEMO-002'})[0],409)

    def test_expiry_releases_hold(self):
        o=self.quoted()
        with app.connection() as db:db.execute('UPDATE orders SET expires=? WHERE id=?',(time.time()-1,o['id']))
        o=self.customer.call('orders/'+o['id'])[1];self.assertEqual(o['status'],'EXPIRED')
        self.assertEqual(self.action(o,'accept',self.customer,agree=True)[0],409)
        self.assertEqual(self.other.call('estimate',self.data)[0],200)

    def test_quote_snapshot_after_rate_change(self):
        o=self.quoted()
        self.admin.call('admin/vehicle',{'id':'DEMO-001','label':'Toyota Wigo CVT DEMO','daily_price':900000,'active':True})
        saved=self.customer.call('orders/'+o['id'])[1]
        self.assertEqual(saved['quote']['daily_price'],600000)

    def test_revision_invalidates_quote_preserves_customer(self):
        o=self.quoted()
        code,o=self.action(o,'revise',self.customer,note='Đổi lịch',start=datetime.fromtimestamp(self.start+3*86400,timezone.utc).isoformat(),end=datetime.fromtimestamp(self.start+4*86400,timezone.utc).isoformat())
        self.assertEqual(code,200,o);self.assertEqual(o['status'],'REQUESTED');self.assertIsNone(o['quote']);self.assertEqual(o['payload']['phone'],'0900000000')

    def test_payment_cancel_refund_exactly_once(self):
        o=self.confirmed();self.assertEqual(o['status'],'CONFIRMED')
        code,again=self.action(o,'record_demo_payment',amount=o['paid'],demo_confirm=True)
        self.assertEqual(code,200);self.assertEqual(o['paid'],again['paid']);self.assertEqual(len(o['history']),len(again['history']))
        code,o=self.action(o,'cancel',self.customer,reason='Thay đổi kế hoạch');self.assertEqual(code,200,o)
        self.assertEqual(o['refund_due'],180000)
        code,o=self.action(o,'refund',demo_confirm=True);self.assertEqual(code,200,o)
        self.assertEqual(o['refunded'],180000);self.assertEqual(o['refund_due'],0)
        code,again=self.action(o,'refund',demo_confirm=True);self.assertEqual(code,200);self.assertEqual(again['refunded'],180000)

    def rent_and_return(self, late_seconds):
        o=self.confirmed()
        self.assertEqual(self.action(o,'handover')[0],400)
        with patch.object(app.time,'time',return_value=self.start+1):
            code,o=self.action(o,'handover',odometer=1000,fuel=90,condition='Xe nguyên trạng, đủ phụ kiện.',acknowledged=True,documents_checked=True,money_checked=True)
            self.assertEqual(code,200,o);self.assertEqual(o['status'],'RENTING')
        # Extend test sessions only, to inspect return at the scheduled next day.
        with app.connection() as db:db.execute('UPDATE sessions SET expires=?',(self.start+3*86400,))
        with patch.object(app.time,'time',return_value=self.start+86400+late_seconds):
            # Browser cookie expires after 8h, so sign in again for the next-day return.
            self.admin.call('login',{'email':'admin@example.test','password':'DemoTestOnly123!'})
            self.admin.csrf=self.admin.call('session')[1]['csrf']
            code,o=self.action(o,'return',odometer=1300,fuel=90,condition='Đã kiểm tra, không thêm hư hỏng.',acknowledged=True,other_fee=0)
            self.assertEqual(code,200,o);self.assertEqual(o['status'],'COMPLETED')
            self.assertEqual(o['reports']['return']['extra_km'],50)
            return o

    def test_handover_return_settlement(self):
        # 40 phút trễ: quá 30 phút ân hạn → tính tròn 1 giờ (100.000) + 50 km vượt (150.000).
        o=self.rent_and_return(2400)
        self.assertEqual(o['reports']['return']['late_hours'],1)
        self.assertEqual(o['reports']['return']['extra_total'],250000)
        self.assertEqual(o['reports']['return']['security_refund_due'],2750000)
        with patch.object(app.time,'time',return_value=self.start+86400+2400):
            code,o=self.action(o,'settle',demo_confirm=True);self.assertEqual(code,200,o);self.assertTrue(o['reports']['return']['settled'])

    def test_late_return_within_grace(self):
        # 25 phút trễ: còn trong 30 phút ân hạn, chỉ tính km vượt.
        o=self.rent_and_return(1500)
        self.assertEqual(o['reports']['return']['late_hours'],0)
        self.assertEqual(o['reports']['return']['extra_total'],150000)

    def test_overdue_car_and_actual_return_buffer(self):
        o=self.confirmed()
        with app.connection() as db:
            db.execute("UPDATE orders SET status='RENTING',end=? WHERE id=?",(time.time()-60,o['id']))
        self.assertEqual(self.other.call('estimate',{**self.data,'start':datetime.fromtimestamp(self.start+86400,timezone.utc).isoformat(),'end':datetime.fromtimestamp(self.start+2*86400,timezone.utc).isoformat()})[0],409)
        with app.connection() as db:
            db.execute("UPDATE orders SET status='COMPLETED' WHERE id=?",(o['id'],))
            db.execute('INSERT INTO reports VALUES(?,?,?)',(o['id'],'return',json.dumps({'at':self.start-1800})))
            self.assertFalse(app.available(db,'DEMO-001',self.start,self.start+86400))
            self.assertTrue(app.available(db,'DEMO-001',self.start+7200,self.start+93600))

    def test_drafts_conflict_and_recovery(self):
        d={'draft':self.data,'version':0}
        code,r=self.customer.call('draft',d);self.assertEqual(code,200)
        self.assertEqual(self.customer.call('draft',d)[0],409)
        self.assertEqual(self.customer.call('draft')[1]['draft']['phone'],'0900000000')
        self.order();self.assertEqual(self.customer.call('draft')[1]['draft'],{})

    def test_promo_quota_and_unknown_price(self):
        o=self.order(promo='CARVIA10');self.quoted(o)
        data={**self.data,'vehicle_id':'DEMO-002','promo':'CARVIA10'}
        self.assertEqual(self.customer.call('estimate',data)[0],400)
        jazz=next(c['id'] for c in app.CATALOG if c['id']=='honda-jazz')
        with app.connection() as db:v=db.execute('SELECT id FROM vehicles WHERE model_id=?',(jazz,)).fetchone()['id']
        self.assertEqual(self.customer.call('estimate',{**self.data,'vehicle_id':v})[0],409)

    def simple_data(self, **changes):
        data={**self.data, 'booking_mode':'simple', **changes}
        code,q=self.customer.call('estimate',data)
        self.assertEqual(code,200,q)
        return {**data,'expected_total':q['total'],'policy_version':q['policy']['version']}

    def test_simple_booking_immediate_and_idempotent(self):
        data=self.simple_data()
        code,o=self.customer.call('orders',data)
        self.assertEqual(code,200,o)
        self.assertEqual(o['status'],'CONFIRMED')
        self.assertIsNone(o['expires'])
        self.assertEqual(o['paid'],0)
        self.assertEqual(o['quote']['deposit'],0)
        self.assertEqual(o['quote']['remaining'],o['quote']['total'])
        self.assertEqual(self.customer.call('orders',data)[1]['id'],o['id'])
        self.assertEqual(self.other.call('orders',{**data,'request_key':'another-simple-request-00001'})[0],409)
        with app.connection() as db:db.execute('UPDATE vehicles SET daily_price=900000 WHERE id=?',(o['vehicle_id'],))
        saved=self.customer.call('orders/'+o['id'])[1]
        self.assertEqual(saved['quote']['total'],o['quote']['total'])

    def test_simple_booking_stale_price_and_policy_rejected(self):
        data=self.simple_data()
        self.assertEqual(self.customer.call('orders',{**data,'expected_total':1})[0],409)
        self.assertEqual(self.customer.call('orders',{**data,'policy_version':'old-policy'})[0],409)
        self.assertEqual(len(self.customer.call('orders')[1]['orders']),0)

    def test_simple_booking_concurrent_single_confirmation(self):
        data=self.simple_data()
        other={**data,'request_key':'second-simple-request-00001'}
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda args:args[0].call('orders',args[1]),[(self.customer,data),(self.other,other)]))
        self.assertEqual(sorted(r[0] for r in results),[200,409])

    def test_simple_booking_handover_and_cancellation(self):
        data=self.simple_data()
        o=self.customer.call('orders',data)[1]
        code,cancelled=self.action(o,'cancel',self.customer,reason='Doi lich thu nghiem')
        self.assertEqual(code,200,cancelled)
        self.assertEqual(cancelled['refund_due'],0)
        self.assertEqual(self.customer.call('estimate',data)[0],200)
        o=self.customer.call('orders',{**data,'request_key':'second-order-simple-00001'})[1]
        future=self.start+60
        with patch.object(app.time,'time',return_value=future):
            self.admin.call('login',{'email':'admin@example.test','password':'DemoTestOnly123!'})
            self.admin.csrf=self.admin.call('session')[1]['csrf']
            code,handed=self.action(o,'handover',odometer=100,fuel=80,condition='Xe tot, du phu kien',acknowledged=True,documents_checked=True,money_checked=True)
            self.assertEqual(code,200,handed)
            self.assertEqual(handed['reports']['handover']['remaining_paid_demo'],o['quote']['total'])

    def test_static_private_files_not_exposed(self):
        for path in ['/server/data/carvia.sqlite3','/server/app.py','/server/policy.json','/%2e%2e/save-images.json']:
            with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(self.base+path)
            self.assertEqual(err.exception.code,404)

if __name__=='__main__':unittest.main()
