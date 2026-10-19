import unittest
from decimal import Decimal
from html.parser import HTMLParser
from src.backend_patches import guarantee_delivery as delivery, reminder_routing as routing


class Tables(HTMLParser):
    def __init__(self, body):
        super().__init__(); self.rows = []; self.active = None; self.feed(body)
    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self.active = []
    def handle_data(self, data):
        if self.active is not None: self.active.append(data)
    def handle_endtag(self, tag):
        if tag == 'tr' and self.active is not None:
            self.rows.append(' '.join(self.active)); self.active = None


class GuaranteeMailRowsTests(unittest.TestCase):
    def event(self, identity, company, balance, **extra):
        return dict(event_type='deposit_refund', event_key=f'refund:1:{identity}:2026-10-19',
            project_id=1, project_name='项目', supplier_name=company, deposit_balance=balance,
            lot_identity=extra.get('lot_identity', '包1'), refund_deadline=extra.get('refund_deadline', '2026-10-20'),
            refund_status=extra.get('refund_status', '待退还'))

    def message(self, event, fields=('supplier_name', 'deposit_balance', 'lot_identity', 'refund_deadline', 'refund_status')):
        return routing.render_recipient_message(event, dict(event_type=event['event_type'],
            content_fields=list(fields), recipient='preview@example.test'), 'sender@example.test')

    def test_summary_keeps_company_balance_pairs_and_excludes_settled_rows(self):
        events = [self.event('a', '甲公司', '10000.10'), self.event('b', '乙公司', '2500.25'),
                  self.event('c', '已退清公司', '0.00')]
        summary, = delivery.aggregate_events(events)
        self.assertEqual(summary['deposit_balance'], '12500.35')
        self.assertEqual([(row['supplier_name'], row['deposit_balance']) for row in summary['deposit_items']],
                         [('甲公司', '10000.10'), ('乙公司', '2500.25')])
        self.assertEqual(delivery.aggregate_events([events[-1]]), [])

    def test_plain_email_has_each_company_on_its_own_line_then_total(self):
        summary, = delivery.aggregate_events([self.event('a', '甲公司', '10000'), self.event('b', '乙公司', '2000.50')])
        plain = self.message(summary).get_body(('plain',)).get_content()
        self.assertIn('甲公司：10000.00 元', plain)
        self.assertIn('乙公司：2000.50 元', plain)
        self.assertIn('合计：12000.50 元', plain)
        self.assertGreater(plain.index('合计：'), plain.index('乙公司：'))
        self.assertNotEqual(next(i for i, s in enumerate(plain.splitlines()) if '甲公司' in s),
                            next(i for i, s in enumerate(plain.splitlines()) if '乙公司' in s))

    def test_same_name_rows_retain_their_lot_deadline_status_and_decimal_amount(self):
        events = [self.event('a', '同名公司', '100.01', lot_identity='包A', refund_deadline='2026-10-20', refund_status='暂缓处理'),
                  self.event('b', '同名公司', '200.02', lot_identity='包B', refund_deadline='2026-11-01', refund_status='待退还')]
        summary, = delivery.aggregate_events(events)
        body = self.message(summary).get_body(('html',)).get_content()
        rows = [row for row in Tables(body).rows if '同名公司' in row]
        self.assertEqual(len(rows), 2)
        self.assertTrue(any(all(value in row for value in ('同名公司', '100.01', '包A', '2026-10-20', '暂缓处理')) for row in rows))
        self.assertTrue(any(all(value in row for value in ('同名公司', '200.02', '包B', '2026-11-01', '待退还')) for row in rows))
        self.assertEqual(sum(Decimal(row['deposit_balance']) for row in summary['deposit_items']), Decimal('300.03'))

    def test_amount_selection_includes_company_and_escapes_html_without_unselected_scope(self):
        summary, = delivery.aggregate_events([self.event('a', '<img src=x>', '50', lot_identity='隐藏采购包')])
        message = self.message(summary, ('deposit_balance',))
        plain = message.get_body(('plain',)).get_content()
        body = message.get_body(('html',)).get_content()
        self.assertIn('<img src=x>：50.00 元', plain)
        self.assertIn('&lt;img src=x&gt;', body)
        self.assertNotIn('<img', body)
        self.assertNotIn('隐藏采购包', body)

    def test_mobile_layout_keeps_two_columns_with_scope_under_each_company(self):
        summary, = delivery.aggregate_events([self.event('a','示例公司','10000',lot_identity='包A')])
        body=self.message(summary).get_body(('html',)).get_content()
        header=body.split('<thead>',1)[1].split('</thead>',1)[0]
        self.assertEqual(header.count('<th '),2)
        self.assertIn('采购包：包A',body)

    def test_legacy_preview_event_uses_single_company_row_and_total(self):
        message = self.message(self.event('preview', '示例供应商', '1000.25'), ('deposit_balance',))
        self.assertIn('示例供应商：1000.25 元', message.get_body(('plain',)).get_content())
        self.assertIn('合计：1000.25 元', message.get_body(('plain',)).get_content())

    def test_summary_isolated_by_project_event_type_and_day(self):
        a = self.event('a', '甲公司', '1')
        events = [a, dict(a, project_id=2), dict(a, event_type='deposit_review'),
                  dict(a, event_key='refund:1:a:2026-10-20')]
        self.assertEqual(len(delivery.aggregate_events(events)), 4)

    def test_legacy_summary_never_invents_a_company_amount_split(self):
        legacy = dict(self.event('old', '甲公司、乙公司', '150'), event_key='guarantee-summary:deposit_refund:1:2026-10-19')
        message = self.message(legacy)
        for part in ('plain', 'html'):
            body = message.get_body((part,)).get_content()
            self.assertIn('历史汇总：逐家公司金额未记录', body)
            self.assertIn('150', body)
            self.assertNotIn('甲公司、乙公司：150', body)

    def test_pending_pre_upgrade_summary_refreshes_rows_without_changing_delivery_identity(self):
        from tests import test_guarantee_mail as fixtures
        from sqlalchemy import text
        case = fixtures.GuaranteeDeliveryTests(); case.setUp()
        try:
            original, = delivery.aggregate_events([self.event('a', '甲公司', '100'), self.event('b', '乙公司', '50')])
            legacy = dict(original); legacy.pop('deposit_items')
            delivery.enqueue(case.db, [legacy], [case.group], case.now); case.db.session.commit()
            old_key = case.db.session.execute(text('SELECT delivery_key FROM tender_mail')).scalar()
            refreshed, = delivery.aggregate_events([self.event('a', '甲公司', '25.50')])
            delivery.enqueue(case.db, [refreshed], [case.group], case.now); case.db.session.commit()
            due, = delivery.claim(case.db, [refreshed], [case.group], case.now)
            self.assertEqual(due['delivery_key'], old_key)
            body = routing.render_recipient_message(due['event'], due['delivery'], 'sender@example.test').get_body(('plain',)).get_content()
            self.assertIn('甲公司：25.50 元', body)
            self.assertNotIn('乙公司', body)
            self.assertIn('合计：25.50 元', body)
        finally:
            case.db.session.close(); case.engine.dispose()
