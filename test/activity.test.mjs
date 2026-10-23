import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Activity, launchRun } from '../src/activity.ts';
import { LaunchUncertain } from '../src/api.ts';
function storage() {
	const values = new Map();
	return {
		get: async (key) => values.get(key),
		set: async (key, value) => {
			values.set(key, value);
		},
	};
}
test('favorites persist within the connected session and do not cross sessions', async () => {
	const db = storage();
	const first = new Activity(db, 'first');
	await first.toggleFavorite('workflow-1');
	assert.deepEqual((await new Activity(db, 'first').read()).favorites, ['workflow-1']);
	assert.deepEqual((await new Activity(db, 'second').read()).favorites, []);
	await first.toggleFavorite('workflow-1');
	assert.deepEqual((await first.read()).favorites, []);
});
test('remembers a lost launch before dispatch and prevents a second launch for that workflow', async () => {
	const activity = new Activity(storage(), 'first');
	let calls = 0;
	const client = {
		start: async (request) => {
			calls++;
			assert.equal((await activity.read()).runs[0].runId, request.runId);
			throw new LaunchUncertain(request.runId);
		},
	};
	const request = {
		workflowId: 'workflow-1',
		version: 3,
		runId: 'stable',
		input: { text: 'private input' },
	};
	await assert.rejects(launchRun(client, activity, request), LaunchUncertain);
	await assert.rejects(launchRun(client, activity, { ...request, runId: 'second' }), /Inspect/);
	assert.equal(calls, 1);
	assert.equal(JSON.stringify(await activity.read()).includes('private input'), false);
});
test('releases an inspected launch for a deliberate new run', async () => {
	const activity = new Activity(storage(), 'first');
	await activity.rememberRun({
		runId: 'first',
		workflowId: 'workflow-1',
		version: 3,
		pending: true,
	});
	await activity.observed('first');
	await launchRun(
		{ start: async (request) => ({ runId: request.runId, launchState: 'launched' }) },
		activity,
		{ workflowId: 'workflow-1', version: 3, runId: 'second', input: null },
	);
	assert.equal((await activity.read()).runs[0].pending, false);
});

test('preserves a pending run while recording overlapping navigation', async () => {
	const activity = new Activity(storage(), 'first');
	await Promise.all([
		activity.rememberRun({ runId: 'pending', workflowId: 'workflow-1', version: 3, pending: true }),
		activity.visit('workflow-2'),
	]);
	const saved = await activity.read();
	assert.equal(saved.runs[0]?.runId, 'pending');
	assert.deepEqual(saved.workflows, ['workflow-2']);
});
