"""Verify packaged mail settings using isolated data; real mail requires explicit flags."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'authorization'))
import license_issuer
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port

FIELDS = ('project_number', 'project_name', 'purchaser', 'stage_name', 'planned_at', 'registration_count')


def verify(candidate, mail_settings=None, mail_credential=None, test_recipient=None, legacy_license_dir=None):
    checks = []
    real_count = 0
    original_spawn = subprocess.Popen
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        with patch.dict(os.environ, {'PM_TEST_LICENSE_DIR': str(legacy_license_dir or temp/'empty'), 'PROCUREMENT_ISSUER_HOME': str(temp/'keys')}):
            client = PackagedClient(Path(candidate).resolve(), temp, 'mail', unused_port())
            if legacy_license_dir is None:
                license_issuer.initialize_keys('isolated-verification-password', client.data_root)
                license_issuer.issue(target_dir=client.data_root, organization='示例单位', expires=None, password='isolated-verification-password')
            def spawn(args, **kwargs):
                return original_spawn([args[0], '--headless'], **kwargs)
            try:
                with patch.object(subprocess, 'Popen', side_effect=spawn):
                    client.start()
                    settings = client.request('GET', '/api/settings')
                    stage_keys = list(dict.fromkeys(stage['id'] for template in settings['stage_templates'].values() for stage in template))
                    base = {'smtp_host':'smtp.example.test','smtp_port':465,'smtp_security':'ssl', 'smtp_username':'sample@example.test','smtp_sender':'sample@example.test','reminder_recipients':['sample@example.test'], 'reminder_weekdays':list(range(7)), 'reminder_content':dict.fromkeys(FIELDS, True), 'reminder_stage_keys':stage_keys,'reminder_enabled':False,'event_reminder_create_enabled':False,'event_reminder_complete_enabled':False}
                    client.patch_settings(base)
                    loaded = client.request('GET', '/api/settings')
                    assert loaded['reminder_weekdays'] == list(range(7))
                    assert all(loaded['reminder_content'][key] for key in FIELDS)
                    assert 'online_quotation' in loaded['reminder_stage_keys']
                    checks.extend(['all seven weekdays persisted', 'all six content fields persisted', 'competitive and configured stage keys accepted'])
                    for field in FIELDS:
                        selected = dict.fromkeys(FIELDS, False) | {field:True}
                        client.patch_settings({'reminder_content':selected})
                        got = client.request('GET', '/api/settings')['reminder_content']
                        assert all(got[key] == selected[key] for key in FIELDS)
                    checks.append('each of six content fields toggles independently')
                    client.patch_settings({'reminder_content':dict.fromkeys(FIELDS,True)})
                    before = (client.data_root/'app_settings.json').read_bytes()
                    preview = client.patch_settings({'reminder_action':'preview','reminder_subject':'草稿 {date}','reminder_content':{'project_number':True,'stage_name':False,'planned_at':False}})
                    assert '开标' not in preview['preview']['body'] and '报名截止' not in preview['preview']['body']
                    assert (client.data_root/'app_settings.json').read_bytes() == before
                    checks.append('preview honors hidden fields without saving draft')
                    group = {'id':'legacy-default','name':'默认组','enabled':True,'order':0,'recipients':['sample@example.test'],'event_types':['daily_stage','project_create','project_complete','supplier_shortage'],'content_fields':dict.fromkeys(FIELDS,True),'subject_prefix':'隔离验证'}
                    for event_type in group['event_types']:
                        response = client.patch_settings({'reminder_action':'preview_group','reminder_recipient_groups':[group],'reminder_group_id':group['id'],'reminder_event_type':event_type})
                        assert response['preview']['body'] and response['preview']['subject']
                        assert (client.data_root/'app_settings.json').read_bytes() == before
                    checks.append('all four event types preview without saving group draft')
                    client.patch_settings({'reminder_recipient_groups':[group]})
                    client.patch_settings({'reminder_enabled':False,'event_reminder_create_enabled':False,'event_reminder_complete_enabled':False,'supplier_shortage_email_enabled':False,'reminder_content':dict.fromkeys(FIELDS,True)})
                    loaded = client.request('GET','/api/settings')
                    assert not loaded['reminder_enabled'] and not loaded['event_reminder_create_enabled'] and not loaded['event_reminder_complete_enabled']
                    assert all(loaded['reminder_recipient_groups'][0]['content_fields'][key] for key in FIELDS)
                    checks.append('default group follows fields and global event switches remain off')
                    client.restart()
                    loaded = client.request('GET','/api/settings')
                    assert loaded['reminder_weekdays'] == list(range(7)) and not loaded['reminder_enabled']
                    assert all(loaded['reminder_content'][key] for key in FIELDS)
                    checks.append('settings survive actual EXE restart')
                    if test_recipient:
                        import win32crypt
                        configured = json.loads(Path(mail_settings).read_text('utf-8-sig'))
                        # Do not use configured groups or their actual business data.
                        assert configured['smtp_sender'].casefold() == test_recipient.casefold()
                        assert configured['smtp_username'].casefold() == test_recipient.casefold()
                        secret = win32crypt.CryptUnprotectData(Path(mail_credential).read_bytes(),None,None,None,0)[1].decode('utf-8')
                        transport = {key:configured[key] for key in ('smtp_host','smtp_port','smtp_security','smtp_username','smtp_sender')}
                        transport |= {'smtp_password':secret,'reminder_recipients':[test_recipient],'reminder_enabled':False,'event_reminder_create_enabled':False,'event_reminder_complete_enabled':False,'supplier_shortage_email_enabled':False}
                        client.patch_settings({'reminder_recipient_groups':[]})
                        for action in ('send_test','send_group_test'):
                            payload = transport | {'reminder_action':action}
                            if action == 'send_group_test':
                                test_group = group | {'id':'isolated-test','recipients':[test_recipient],'event_types':['daily_stage'],'content_fields':{'project_number':True,'planned_at':True},'subject_prefix':'项目管理系统功能验证'}
                                payload |= {'reminder_recipient_groups':[test_group],'reminder_group_id':test_group['id'],'reminder_event_type':'daily_stage'}
                            response = client.session.patch(client.base_url+'/api/settings',json=payload,headers={'X-CSRFToken':client.csrf_token},timeout=35)
                            assert response.status_code == 200, f'{action}: HTTP {response.status_code}'
                            assert response.json()['message'] == '测试邮件已发送'
                            real_count += 1
                        del secret
                        loaded = client.request('GET','/api/settings')
                        assert not loaded['reminder_enabled'] and not loaded['event_reminder_create_enabled'] and not loaded['event_reminder_complete_enabled']
                        assert 'smtp_password' not in loaded
                        checks.append('global and recipient-group SSL tests accepted by real SMTP server; secrets redacted')
            finally:
                client.stop()
    return {'candidate_sha256':hashlib.sha256(Path(candidate).read_bytes()).hexdigest(),'checks':checks,'count':len(checks),'real_test_messages_accepted':real_count,'production_data_modified':False,'production_credentials_modified':False,'native_desktop_verified':False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--mail-settings')
    parser.add_argument('--mail-credential')
    parser.add_argument('--test-recipient')
    parser.add_argument('--legacy-license-dir', help='Copy existing license fixtures into isolated data; never write originals')
    args = parser.parse_args()
    if any((args.mail_settings,args.mail_credential,args.test_recipient)) and not all((args.mail_settings,args.mail_credential,args.test_recipient)):
        parser.error('real tests require --mail-settings, --mail-credential and --test-recipient together')
    result = verify(args.candidate,args.mail_settings,args.mail_credential,args.test_recipient,args.legacy_license_dir)
    Path(args.report).write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(result,ensure_ascii=False))
