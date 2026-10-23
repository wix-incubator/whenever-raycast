import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Workflow } from '../src/api.ts';
import {
	formatClock,
	formatDuration,
	formatTimestamp,
	runDescription,
	workflowPresentation,
} from '../src/presentation.ts';

const draft: Workflow = {
	id: 'workflow-1',
	name: 'Summarize',
	deployedVersion: undefined,
	activation: undefined,
	planPaused: false,
	planPauseCauses: [],
	pinned: false,
	lastActivityAt: undefined,
};

test('labels workflows with the same lifecycle statuses as the web app sidebar', () => {
	const published = { ...draft, deployedVersion: 2 };
	assert.deepEqual(
		[
			draft,
			published,
			{ ...published, activation: 'active' as const },
			{ ...published, activation: 'setup-required' as const },
			{ ...published, activation: 'active' as const, planPaused: true },
		].map((workflow) => [
			workflowPresentation(workflow).label,
			workflowPresentation(workflow).tone,
		]),
		[
			['Draft', 'neutral'],
			['Turned On', 'neutral'],
			['Active', 'success'],
			['Setup required', 'warning'],
			['Paused — plan limit', 'warning'],
		],
	);
});

test('explains a plan pause by its recorded cause', () => {
	const paused = { ...draft, planPaused: true, planPauseCauses: ['schedule-limit' as const] };
	assert.match(workflowPresentation(paused).description ?? '', /one scheduled run per day/);
});

test('describes a run as status, trigger and version, and a refused start as did not start', () => {
	const run = {
		runId: 'run-1',
		workflowId: 'workflow-1',
		startedAt: 0,
		triggerType: 'webhook',
	};
	assert.equal(
		runDescription({ ...run, version: '1', status: 'succeeded' }),
		'Succeeded · Webhook · v1',
	);
	assert.equal(
		runDescription({ ...run, version: undefined, status: 'failed' }),
		'Did not start · Webhook',
	);
});

test('formats durations and times as the web app does', () => {
	assert.deepEqual([584, 2865, 125000].map(formatDuration), ['584ms', '2.9s', '2m 5s']);
	assert.equal(formatTimestamp(Date.UTC(2026, 9, 23, 12, 10), 'UTC'), 'Oct 23, 12:10 UTC');
	assert.equal(formatClock(Date.UTC(2026, 9, 23, 12, 10, 44, 48), 'UTC'), '12:10:44.048 UTC');
});
