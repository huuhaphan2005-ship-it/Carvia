"""Contact persistence, privacy and inventory label migration."""
import unittest
import uuid
import test_booking

class ContactTests(unittest.TestCase):
    setUp = test_booking.BookingTests.setUp
    tearDown = test_booking.BookingTests.tearDown

    def payload(self, **changes):
        return {'name':'Khach Lien He','email':'support-test@example.test',
                'message':'Toi can tu van lich thue xe.',
                'request_key':str(uuid.uuid4()), **changes}

    def test_persist_idempotency_and_admin_only(self):
        data=self.payload(message='<script>alert(1)</script>')
        anonymous=test_booking.Client(self.base)
        code,result=anonymous.call('contact',data)
        self.assertEqual(code,200)
        self.assertEqual(self.customer.call('contact',data)[1]['id'],result['id'])
        self.assertEqual(self.customer.call('admin')[0],403)
        code,admin=self.admin.call('admin')
        self.assertEqual(code,200)
        self.assertEqual(len(admin['contacts']),1)
        self.assertEqual(admin['contacts'][0]['message'],data['message'])
        self.assertNotIn('sender_hash',admin['contacts'][0])
        with test_booking.app.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM contact_requests').fetchone()[0],1)

    def test_invalid_requests_and_rate_limit(self):
        self.assertEqual(self.customer.call('contact',self.payload(message='x'))[0],400)
        self.assertEqual(self.customer.call('contact',self.payload(email='invalid'))[0],400)
        for _ in range(5):
            self.assertEqual(self.customer.call('contact',self.payload())[0],200)
        self.assertEqual(self.customer.call('contact',self.payload())[0],429)

    def test_label_migration_preserves_business_data(self):
        app=test_booking.app
        with app.connection() as db:
            row=db.execute('SELECT * FROM vehicles ORDER BY id LIMIT 1').fetchone()
            db.execute('UPDATE vehicles SET label=?,daily_price=? WHERE id=?',
                       ('Toyota Wigo · CVT · xe mô phỏng 01',777000,row['id']))
            second=db.execute('SELECT id FROM vehicles ORDER BY id LIMIT 1 OFFSET 1').fetchone()['id']
            db.execute('UPDATE vehicles SET label=? WHERE id=?',('Xe được quản trị đặt tên',second))
        app.init_db()
        app.init_db()
        with app.connection() as db:
            updated=db.execute('SELECT * FROM vehicles WHERE id=?',(row['id'],)).fetchone()
            self.assertEqual(updated['label'],'Toyota Wigo · CVT')
            self.assertEqual(updated['daily_price'],777000)
            self.assertEqual(updated['id'],row['id'])
            self.assertEqual(db.execute('SELECT label FROM vehicles WHERE id=?',(second,)).fetchone()[0],'Xe được quản trị đặt tên')
