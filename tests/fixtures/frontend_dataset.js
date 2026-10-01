'use strict';

const METHODS = ['公开招标', '竞争性磋商', '竞争性谈判', '网上竞价'];

function createProjects(count, stageCount = 14) {
    if (!Number.isInteger(count) || count < 0) {
        throw new TypeError('count must be a non-negative integer');
    }
    if (!Number.isInteger(stageCount) || stageCount < 1) {
        throw new TypeError('stageCount must be a positive integer');
    }
    return Array.from({length: count}, (_, projectIndex) => {
        const id = projectIndex + 1;
        const completed = id % (stageCount + 1);
        const stages = Array.from({length: stageCount}, (_, stageIndex) => ({
            key: `stage_${stageIndex + 1}`,
            name: `模拟阶段-${stageIndex + 1}`,
            icon: '●',
            completed: stageIndex < completed,
            skipped: false,
            planned_date: `2026-08-${String((stageIndex % 28) + 1).padStart(2, '0')}`,
        }));
        const current = stages[Math.min(completed, stageCount - 1)];
        return {
            id,
            number: `SIM-${String(id).padStart(5, '0')}`,
            name: `模拟项目-${String(id).padStart(5, '0')}`,
            purchaser: `模拟采购人-${(id % 20) + 1}`,
            method: METHODS[id % METHODS.length],
            progress: Math.round((completed / stageCount) * 100),
            current_stage_key: current.key,
            current_stage_name: current.name,
            is_terminated: false,
            stages,
        };
    });
}

module.exports = {createProjects};
