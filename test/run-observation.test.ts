import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunPage } from '../src/api.ts';
import { observe, runMarkdown, unobserved } from '../src/run-observation.ts';

function page(overrides: Partial<RunPage> = {}): RunPage {
	return {
		run: {
			runId: 'run-1',
			workflowId: 'workflow-1',
			version: '3',
			status: 'running',
			startedAt: 100,
		},
		events: [],
		nextSeq: 0,
		truncated: false,
		complete: false,
		output: { kind: 'not-observed' },
		...overrides,
	};
}

test('a re-read from the start does not repeat events already shown', () => {
	const first = observe(
		unobserved,
		page({ events: [{ runId: 'run-1', seq: 0, type: 'run_started' }] }),
	);
	const second = observe(
		first,
		page({
			events: [
				{ runId: 'run-1', seq: 0, type: 'run_started' },
				{ runId: 'run-1', seq: 1, type: 'step_started', name: 'fetch' },
			],
		}),
	);
	assert.deepEqual(
		second.events.map((event) => event.seq),
		[0, 1],
	);
});

test('keeps observed output when a later page carries none', () => {
	const done = observe(unobserved, page({ output: { kind: 'available', value: 'done' } }));
	assert.deepEqual(observe(done, page()).output, { kind: 'available', value: 'done' });
});

test('does not present a success as final until observation is complete', () => {
	const run = { ...page().run, status: 'succeeded' as const };
	const incomplete = observe(unobserved, page({ run, complete: false }));
	assert.match(
		runMarkdown(incomplete, 'run-1', false),
		/^# Success reported · observation incomplete/,
	);
	const complete = observe(unobserved, page({ run, complete: true }));
	assert.match(runMarkdown(complete, 'run-1', false), /^# succeeded\n/);
});

test('names an uncertain launch until the run is read', () => {
	assert.match(runMarkdown(unobserved, 'run-1', true), /^# Launch uncertain/);
	assert.match(runMarkdown(unobserved, 'run-1', false), /^# Awaiting run evidence/);
});
