import unittest
from src.backend_patches import reminder_routing as subject


class ReminderEmailLayoutTests(unittest.TestCase):
    def render(self, kind, fields, **values):
        return subject.render_recipient_message({'event_type':kind, **values},
            {'event_type':kind,'content_fields':fields,'recipient':'receiver@example.test'},'sender@example.test')

    def test_mobile_label_and_zero_supplier_count_are_preserved(self):
        message = self.render('supplier_shortage',['project_name','supplier_count','registration_deadline'],
                              project_name='示例采购项目',supplier_count=0,registration_deadline='2026-10-12 17:30')
        body = message.get_body(('html',)).get_content()
        self.assertIn('white-space:nowrap',body)
        self.assertIn('2026-10-12 17:30',body)
        self.assertIn('>0</div>',body)
        self.assertEqual(body.count('示例采购项目'),1)
        self.assertIn('当前供应商数：0',message.get_body(('plain',)).get_content())

    def test_unselected_header_deadline_and_counts_never_leak(self):
        for kind in subject.EVENT_TYPES:
            with self.subTest(kind=kind):
                message=self.render(kind,['project_number'],project_number='PRJ-001',project_name='hidden-title',
                    supplier_count='hidden-count',registration_deadline='hidden-deadline',purchaser='hidden-buyer')
                for body in (message.get_body(('plain',)),message.get_body(('html',))):
                    self.assertNotIn('hidden-',body.get_content())
                    self.assertIn('PRJ-001',body.get_content())

    def test_html_injection_is_escaped_in_header_metric_and_details(self):
        marker='<img src=x onerror=alert(1)>'
        message=self.render('supplier_shortage',['project_name','supplier_count','purchaser'],
                            project_name=marker,supplier_count=marker,purchaser=marker)
        body=message.get_body(('html',)).get_content()
        self.assertNotIn('<img',body)
        self.assertEqual(body.count('&lt;img'),3)

    def test_empty_selection_still_has_plain_and_html_without_event_values(self):
        message=self.render('project_complete',[],project_name='hidden-title')
        self.assertEqual(message.get_body(('plain',)).get_content(),'\n')
        self.assertIn('项目完成提醒',message.get_body(('html',)).get_content())
        self.assertNotIn('hidden-title',message.as_string())
