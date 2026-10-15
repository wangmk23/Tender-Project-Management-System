import copy
import sqlite3
import unittest
from types import SimpleNamespace
from src.backend_patches import consortium_registration as subject
from src.backend_patches import tender_guarantee
from tests import test_consortium_registration as fixtures


class ConsortiumDetailsTests(unittest.TestCase):
    def setUp(self):
        self.connection=sqlite3.connect(':memory:')
        self.connection.execute('PRAGMA foreign_keys=ON')
        self.connection.execute('CREATE TABLE supplier_registrations(id INTEGER PRIMARY KEY,company_name TEXT)')
        self.connection.execute("INSERT INTO supplier_registrations VALUES(1,'模拟牵头')")
        self.connection.commit()
        self.db=SimpleNamespace(session=fixtures.ConsortiumRegistrationPersistenceTests.RawSession(self.connection))
        self.details=dict(company_name='模拟成员',company_address='模拟地址',legal_representative='模拟法人',
                          bid_manager='模拟联系人',manager_phone='010-12345678',manager_email='member@example.test',notes='模拟备注')

    def tearDown(self):
        self.connection.close()

    def test_optional_details_validate_and_round_trip_with_parent_only_attachments(self):
        data=subject.validate_payload(dict(bidder_type='consortium',company_name='模拟牵头',consortium_members=[self.details]))
        self.assertEqual(data['consortium_members'][0],self.details)
        subject.replace_members(self.db,1,'consortium',data['consortium_members']);self.connection.commit()
        value=subject.enrich_registration(self.db,dict(id=1,attachments=[dict(id=5)]))
        self.assertEqual(value['consortium_members'],[self.details])
        self.assertEqual(value['attachments'],[dict(id=5)])

    def test_names_only_old_client_preserves_details_but_explicit_empty_clears(self):
        subject.replace_members(self.db,1,'consortium',[self.details,dict(company_name='模拟成员二',manager_phone='123')])
        subject.replace_members(self.db,1,'consortium',[dict(company_name='模拟成员二'),dict(company_name='模拟成员')])
        value=subject.enrich_registration(self.db,dict(id=1))['consortium_members']
        self.assertEqual(value[0]['manager_phone'],'123');self.assertEqual(value[1]['manager_email'],'member@example.test')
        subject.replace_members(self.db,1,'consortium',[dict(company_name='模拟成员',manager_email='')])
        value=subject.enrich_registration(self.db,dict(id=1))['consortium_members'][0]
        self.assertNotIn('manager_email',value);self.assertEqual(value['manager_phone'],'010-12345678')

    def test_incremental_schema_keeps_old_member_and_supports_idempotent_upgrade(self):
        self.connection.execute("ALTER TABLE supplier_registrations ADD COLUMN bidder_type TEXT DEFAULT 'standalone'")
        self.connection.execute('CREATE TABLE registration_consortium_members(id INTEGER PRIMARY KEY,registration_id INTEGER,company_name TEXT,sort_order INTEGER)')
        self.connection.execute("INSERT INTO registration_consortium_members VALUES(10,1,'旧成员',0)")
        self.connection.execute("UPDATE supplier_registrations SET bidder_type='consortium'");self.connection.commit()
        subject.ensure_schema(self.db);subject.ensure_schema(self.db)
        self.assertEqual(subject.enrich_registration(self.db,dict(id=1))['consortium_members'],[dict(company_name='旧成员')])
        cols={row[1] for row in self.connection.execute('PRAGMA table_info(registration_consortium_members)')}
        self.assertTrue(set(self.details)-{'company_name'}<=cols)

    def test_bad_email_and_oversize_details_are_rejected_before_write(self):
        for change in (dict(manager_email='broken-address'),dict(company_address='地'*1001),dict(notes='记'*5001),dict(manager_phone=['bad'])):
            with self.subTest(change=next(iter(change))):
                with self.assertRaises(subject.ValidationError):
                    subject.validate_payload(dict(bidder_type='consortium',company_name='模拟牵头',consortium_members=[dict(self.details,**change)]))

    def test_contact_only_changes_keep_old_bidder_fingerprint(self):
        old=[dict(id=1,company_name='模拟牵头',lot_id=None,bidder_type='consortium',consortium_members=[dict(company_name='模拟成员')])]
        updated=copy.deepcopy(old);updated[0]['consortium_members']=[self.details]
        self.assertEqual(tender_guarantee.roster_fingerprint(old),tender_guarantee.roster_fingerprint(updated))
        updated[0]['consortium_members'][0]['company_name']='其他成员'
        self.assertNotEqual(tender_guarantee.roster_fingerprint(old),tender_guarantee.roster_fingerprint(updated))


if __name__=='__main__':unittest.main()
