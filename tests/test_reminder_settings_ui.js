'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source', 'frontend', '06-admin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');

assert.match(source, /function renderReminderSettingsCard\(/);
assert.match(source, /function collectReminderSettings\(/);
assert.match(source, /function saveReminderSettings\(/);
assert.match(source, /function sendReminderTestEmail\(/);
assert.match(source, /function previewReminderEmail\(/);
assert.match(source, /function openRecipientGroupDrawer\(groupId\)/);
assert.match(source, /function closeRecipientGroupDrawer\(\)/);
assert.match(source, /function saveRecipientGroupDraft\(\)/);
assert.match(source, /function copyRecipientGroup\(groupId\)/);
assert.match(source, /function moveRecipientGroup\(groupId, delta\)/);
assert.match(source, /function toggleRecipientGroup\(groupId\)/);
assert.match(source, /function deleteRecipientGroup\(groupId\)/);
assert.match(source, /function previewRecipientGroup\(groupId\)/);
assert.match(source, /function sendRecipientGroupTest\(groupId\)/);
assert.match(source, /function renderRecipientDuplicateWarning\(/);
assert.match(source, /escHtml\(group\.name\)/);
assert.match(source, /reminder_recipient_groups/);
assert.match(source, /preview_group/);
assert.match(source, /send_group_test/);
assert.match(source, /TEST_EMAIL_RATE_LIMITED/);
assert.match(source, /操作过于频繁，请 60 秒后重试/);
assert.match(source, />发件服务</);
assert.match(source, />收件组</);
assert.match(source, />运行状态</);
assert.match(source, /id="reminderRecipients"/);
assert.match(source, /id="smtpPassword"[^>]*type="password"[^>]*autocomplete="new-password"/);
assert.match(source, /id="reminderSubject"/);
assert.match(source, /id="reminderAdvanceDays"/);
assert.match(source, /data-reminder-weekday/);
assert.match(source, /reminderPreviewPanel/);
assert.match(source, /reminder-preview-field/);
assert.match(source, /reminder_action:\s*'preview'/);
assert.match(source, /smtp_password_configured/);
assert.match(source, /reminder_action:\s*'send_test'/);
assert.match(source, /已重新排队.*有效阶段提醒/);
assert.match(source, /smtp-mail\.outlook\.com/);
assert.match(source, /Outlook\/Hotmail.*OAuth2/);
assert.match(source, /function reminderStageDefinitions\(/);
assert.match(source, /normalizeClientStageTemplates\(settings\.stage_templates, settings\)/);
assert.match(source, /const reminderStages = reminderStageDefinitions\(settings\)/);
assert.match(source, /data-reminder-content/);
assert.match(source, /\{date\}.*\{count\}/);
assert.doesNotMatch(source, /settings\.smtp_password(?!_configured)/);
assert.doesNotMatch(source, /emailjs|sendgrid|mailgun|postmark/i);
assert.match(css, /\.reminder-settings-grid/);
assert.match(css, /\.reminder-stage-grid/);
assert.match(css, /\.reminder-preview-panel/);
assert.match(css, /\.recipient-group-drawer/);
assert.match(css, /\.recipient-group-row/);
assert.match(css, /@media \(max-width: 768px\)/);

// Duplicate recipients are displayed as one effective delivery: fields merge,
// while the first matching group keeps ownership of the subject prefix.
assert.match(source, /同一邮箱最终只发送一封/);
assert.match(source, /首个匹配组的主题前缀/);
assert.match(source, /mergedFields/);

const duplicateHelperStart = source.indexOf('const REMINDER_EVENT_META');
const duplicateHelperEnd = source.indexOf('function renderRecipientGroupRows');
assert.ok(duplicateHelperStart >= 0 && duplicateHelperEnd > duplicateHelperStart);
const context = {
    escHtml(value) {
        return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
    },
};
vm.createContext(context);
vm.runInContext(`${source.slice(duplicateHelperStart, duplicateHelperEnd)}\nglobalThis.renderWarning = renderRecipientDuplicateWarning;`, context);
const groups = [
    {name: '第一组', enabled: true, recipients: ['Same@Example.test'], subject_prefix: '优先', content_fields: {project_name: true}},
    {name: '第二组', enabled: true, recipients: ['same@example.test'], subject_prefix: '忽略', content_fields: {supplier_missing: true}},
];
const warning = context.renderWarning(groups[0], groups);
assert.match(warning, /same@example\.test/);
assert.match(warning, /项目名称/);
assert.match(warning, /缺少数量/);
assert.match(warning, /首个匹配组的主题前缀“优先”/);
assert.equal((warning.match(/same@example\.test/g) || []).length, 1);

console.log('reminder settings UI tests passed');
