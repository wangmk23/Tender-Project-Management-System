'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'source', 'frontend', '10-chart-board.js'),
    'utf8',
);
const context = {console, URLSearchParams, result: null};
vm.createContext(context);
vm.runInContext(`${source}\nresult = {buildChartBoardData, safeRatio};`, context);
const {buildChartBoardData, safeRatio} = context.result;
const plain = value => JSON.parse(JSON.stringify(value));
const now = new Date('2026-07-20T09:00:00+08:00');

assert.equal(safeRatio(5, 0), 0);
assert.equal(safeRatio('bad', 2), 0);
assert.equal(safeRatio(3, 4), 0.75);

const empty = plain(buildChartBoardData([], now));
assert.deepEqual(empty.kpis, {total: 0, active: 0, overdue: 0, completed: 0});
assert.equal(empty.monthlyTrend.length, 6);
assert.deepEqual(empty.statusDistribution, []);
assert.deepEqual(empty.methodDistribution, []);
assert.deepEqual(empty.riskDistribution, []);

const projects = [
    {
        id: 1, number: 'P-001', name: '逾期项目', method: '公开招标', progress: 30,
        created_at: '2026-05-02', is_terminated: false,
        stages: [{key: 'announcement', completed: false, planned_at: '2026-07-10'}],
    },
    {
        id: 2, number: 'P-002', name: '近期项目', method: '竞争性磋商', progress: 60,
        created_at: '2026-07-01', is_terminated: false,
        stages: [{key: 'bid_opening', completed: false, planned_at: '2026-07-23'}],
    },
    {
        id: 3, number: 'P-003', name: '已完成', method: '公开招标', progress: 100,
        created_at: '2026-02-01', completed_at: '2026-07-18', is_terminated: false,
        stages: [],
    },
    {
        id: 4, number: 'P-004', name: '已终止', method: '邀请招标', progress: 10,
        created_at: '2026-04-01', is_terminated: true, stages: [],
    },
    {
        id: 5, number: 'P-005', name: '质疑项目', method: '竞争性磋商', progress: 20,
        created_at: '2026-06-01', is_terminated: false, challenge_state: '质疑中', stages: [],
    },
];
const snapshot = JSON.stringify(projects);
const data = plain(buildChartBoardData(projects, now));

assert.equal(JSON.stringify(projects), snapshot, 'aggregation must not mutate projects');
assert.deepEqual(data.kpis, {total: 5, active: 3, overdue: 1, completed: 1});
assert.deepEqual(data.monthlyTrend.map(item => item.month), ['2月', '3月', '4月', '5月', '6月', '7月']);
assert.deepEqual(data.monthlyTrend.map(item => item.created), [1, 0, 1, 1, 1, 1]);
assert.deepEqual(data.monthlyTrend.map(item => item.completed), [0, 0, 0, 0, 0, 1]);
assert.deepEqual(data.statusDistribution, [
    {name: '进行中', count: 3},
    {name: '已完成', count: 1},
    {name: '已终止', count: 1},
]);
assert.deepEqual(data.methodDistribution, [
    {name: '竞争性磋商', count: 2},
    {name: '公开招标', count: 2},
    {name: '邀请招标', count: 1},
]);
assert.deepEqual(data.riskDistribution, [
    {name: '逾期', count: 1},
    {name: '7天内', count: 1},
    {name: '质疑投诉', count: 1},
    {name: '已终止', count: 1},
]);
assert.equal(JSON.stringify(data).includes('NaN'), false);
assert.equal(JSON.stringify(data).includes('Infinity'), false);

const reversed = plain(buildChartBoardData([...projects].reverse(), now));
assert.deepEqual(reversed, data, 'aggregation order is deterministic');

console.log('chart board data tests passed');
