'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'source', 'frontend', '09-command-center.js');
assert.ok(fs.existsSync(modulePath), 'command center module must exist');

const source = fs.readFileSync(modulePath, 'utf8');
const context = {console};
vm.createContext(context);
vm.runInContext(source, context, {filename: '09-command-center.js'});

assert.equal(typeof context.rankCommandActions, 'function');
assert.equal(typeof context.invalidateCommandCenterData, 'function');
assert.equal(typeof context.commandCountdownParts, 'function');
assert.equal(context.commandDateOrdinal('2026-02-31'), null);
assert.equal(context.commandDateOrdinal('2026-04-31'), null);
assert.equal(context.commandDateOrdinal('2026-02-29'), null);
assert.notEqual(context.commandDateOrdinal('2028-02-29'), null);
assert.equal(context.commandDeadline('2026-07-20T25:00'), null);
assert.equal(context.commandDeadline('2026-02-31'), null);
assert.equal(
    JSON.stringify(context.commandCountdownParts('2026-07-21T10:02:03', new Date('2026-07-20T09:00:00'))),
    JSON.stringify({overdue: false, days: 1, hours: 1, minutes: 2, seconds: 3}),
);
assert.equal(
    JSON.stringify(context.commandCountdownParts('2026-07-20T08:59:58', new Date('2026-07-20T09:00:00'))),
    JSON.stringify({overdue: true, days: 0, hours: 0, minutes: 0, seconds: 2}),
);
assert.equal(
    JSON.stringify(context.commandCountdownParts('2026-07-20', new Date('2026-07-20T23:59:58'))),
    JSON.stringify({overdue: false, days: 0, hours: 0, minutes: 0, seconds: 1}),
    'date-only plans should count down to the end of that day',
);
assert.equal(
    context.commandDateOrdinal('2026-03-03') === context.commandDateOrdinal('2026-02-31'),
    false,
    'an invalid date must not alias a later valid calendar day',
);

const projects = [
    {
        id: 1,
        number: 'SIM-001',
        name: '园区设备更新项目',
        method: '公开招标',
        progress: 55,
        current_stage_key: 'doc_review',
        challenge_state: '质疑中',
        stages: [
            {key: 'doc_review', name: '采购文件审核', completed: false, skipped: false, planned_at: '2026-07-18'},
        ],
    },
    {
        id: 2,
        number: 'SIM-002',
        name: '办公服务采购',
        method: '公开招标',
        progress: 70,
        current_stage_key: 'announcement',
        stages: [
            {key: 'announcement', name: '公告发布', completed: false, skipped: false, planned_at: '2026-07-20'},
        ],
    },
    {
        id: 3,
        number: 'SIM-003',
        name: '归档项目',
        method: '询价',
        progress: 100,
        stages: [],
    },
];

const model = context.commandCenterModel(
    projects,
    {total: 3, in_progress: 2, completed: 1},
    new Date('2026-07-20T09:00:00'),
);

assert.equal(model.metrics.total, 3);
assert.equal(model.metrics.active, 2);
assert.equal(model.metrics.completed, 1);
assert.equal(model.metrics.overdue, 1);
assert.equal(model.actions[0].urgency, 'overdue');
assert.equal(model.actions[0].projectId, 1);
assert.equal(model.actions[1].urgency, 'today');
assert.equal(model.insights.methods['公开招标'], 2);
assert.equal(model.insights.riskProjects.length, 1);
assert.equal(model.insights.stageCounts.doc_review, 1);

const timedActions = context.rankCommandActions([{
    id: 30,
    number: 'TIMED',
    progress: 10,
    stages: [
        {key: 'date-only', planned_at: '2026-07-20'},
        {key: 'future', planned_at: '2026-07-20T09:00:01'},
        {key: 'passed', planned_at: '2026-07-20T08:59:59'},
    ],
}], new Date('2026-07-20T09:00:00'));
assert.equal(timedActions[0].urgency, 'overdue', 'a passed time on the current day must be overdue');
assert.equal(timedActions[0].stageKey, 'passed', 'passed times must rank before pending times on the same day');
assert.equal(timedActions[1].urgency, 'today');
assert.equal(timedActions[1].stageKey, 'future');
assert.equal(timedActions[2].urgency, 'today', 'date-only plans remain due today until day end');

const repeated = context.commandCenterModel(
    projects,
    {total: 3, in_progress: 2, completed: 1},
    new Date('2026-07-20T09:00:00'),
);
assert.deepEqual(JSON.parse(JSON.stringify(repeated)), JSON.parse(JSON.stringify(model)));
assert.equal(repeated, model, 'same data version and minute should reuse the view model');
const crossedDeadline = context.commandCenterModel(
    projects,
    {total: 3, in_progress: 2, completed: 1},
    new Date('2026-07-20T09:01:00'),
);
assert.notEqual(crossedDeadline, model, 'minute changes must refresh time-sensitive urgency');

context.invalidateCommandCenterData();
const refreshed = context.commandCenterModel(
    projects,
    {total: 3, in_progress: 2, completed: 1},
    new Date('2026-07-20T09:00:00'),
);
assert.notEqual(refreshed, model, 'derived-state invalidation must release the cached model');

const tiedProjects = [
    {
        id: 9,
        number: 'SAME',
        progress: 10,
        stages: [
            {key: 'first', name: '第一项', planned_at: '2026-07-20'},
            {key: 'second', name: '第二项', planned_at: '2026-07-20'},
        ],
    },
    {
        id: 8,
        number: 'SAME',
        progress: 10,
        stages: [{key: 'third', name: '第三项', planned_at: '2026-07-20'}],
    },
];
const tiedSnapshot = JSON.stringify(tiedProjects);
assert.deepEqual(
    Array.from(context.rankCommandActions(tiedProjects, new Date('2026-07-20T09:00:00')), item => item.stageKey),
    ['first', 'second', 'third'],
    'equal priorities must preserve the source project and stage order',
);
assert.equal(JSON.stringify(tiedProjects), tiedSnapshot, 'ranking must not mutate project input');

assert.deepEqual(
    Array.from(context.rankCommandActions([
        {id: 20, progress: 100, stages: [{key: 'done-project', planned_at: '2026-07-01'}]},
        {id: 21, progress: 10, is_terminated: true, stages: [{key: 'terminated', planned_at: '2026-07-01'}]},
        {id: 22, progress: 10, stages: [
            {key: 'done-stage', completed: true, planned_at: '2026-07-01'},
            {key: 'skipped-stage', skipped: true, planned_at: '2026-07-01'},
            {key: 'invalid-date', planned_at: 'not-a-date'},
            {key: 'invalid-calendar-date', planned_at: '2026-02-31'},
        ]},
    ], new Date('2026-07-20T09:00:00'))),
    [],
    'completed, terminated, skipped and invalid-date work must not become actions',
);

console.log('command center model tests passed');
