import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import { WheneverClient, LaunchUncertain, parseInput, outputText, resultUrl } from '../src/api.ts';

type RpcRequest = {
	id: number;
	params: { name: string; arguments: Record<string, unknown> };
};
type Answer = { status?: number; raw?: unknown; result?: unknown };

async function service(t: TestContext, respond: (request: RpcRequest, count: number) => Answer) {
	const requests: Array<{ body: RpcRequest; authorization?: string }> = [];
	const server = createServer(async (req, res) => {
		let data = '';
		for await (const chunk of req) data += chunk;
		const body: RpcRequest = JSON.parse(data);
		requests.push({ body, authorization: req.headers.authorization });
		const acceptsMcp =
			req.headers.accept?.includes('application/json') &&
			req.headers.accept?.includes('text/event-stream');
		const answer = acceptsMcp ? respond(body, requests.length) : { status: 406 };
		res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify(
				answer.raw ?? {
					jsonrpc: '2.0',
					id: body.id,
					result: { structuredContent: { result: answer.result } },
				},
			),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(
		() =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	);
	const address = server.address();
	assert.ok(address && typeof address === 'object');
	const endpoint = `http://127.0.0.1:${address.port}`;
	const client = new WheneverClient(
		async () => 'account-token',
		(url, options) => {
			assert.equal(url, 'https://mcp.whenever.dev/');
			return fetch(endpoint, options);
		},
	);
	return { client, requests };
}
const workflow = { id: 'workflow-1', name: 'Summarize text', deployedVersion: 2 };
const run = {
	runId: 'run-1',
	workflowId: 'workflow-1',
	version: '3',
	status: 'succeeded',
	startedAt: 100,
	lastSeq: 2,
	triggerType: 'manual',
};

test('lists owned workflows and preserves incomplete-list evidence', async (t) => {
	const { client, requests } = await service(t, () => ({
		result: { workflows: [workflow], completeness: 'truncated' },
	}));
	assert.deepEqual(await client.workflows(), { workflows: [workflow], completeness: 'truncated' });
	assert.equal(requests[0].authorization, 'Bearer account-token');
	assert.equal(requests[0].body.params.name, 'list_workflows');
});

test('rejects malformed tool replies instead of showing an empty workflow list', async (t) => {
	const { client } = await service(t, () => ({ result: { workflows: [{ id: 'broken' }] } }));
	await assert.rejects(client.workflows(), /invalid/i);
});

test('pins manual execution to the reviewed saved version and sends one confirmed launch', async (t) => {
	const id = '00000000-0000-4000-8000-000000000001';
	const { client, requests } = await service(t, () => ({
		result: { runId: id, workflowId: 'workflow-1', version: 3, launchState: 'launched' },
	}));
	const result = await client.start({
		workflowId: 'workflow-1',
		version: 3,
		runId: id,
		input: { text: 'hello' },
		triggerKey: 'manual',
	});
	assert.equal(result.runId, id);
	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0].body.params.arguments, {
		workflow_id: 'workflow-1',
		expected_version: 3,
		run_id: id,
		confirm_external_side_effects: true,
		input: { text: 'hello' },
		trigger_key: 'manual',
	});
});

for (const answer of [
	{ status: 500, raw: { error: 'lost' } },
	{ result: { status: 'launch_uncertain', runId: 'other', message: 'uncertain' } },
	{ result: { runId: 'different', workflowId: 'workflow-1', version: 3, launchState: 'launched' } },
]) {
	test('keeps an uncertain launch addressable without retrying', async (t) => {
		const { client, requests } = await service(t, () => answer);
		await assert.rejects(
			client.start({ workflowId: 'workflow-1', version: 3, runId: 'stable-id', input: null }),
			(error) => error instanceof LaunchUncertain && error.runId === 'stable-id',
		);
		assert.equal(requests.length, 1);
	});
}

test('reads bounded run pages and distinguishes omitted output from success without output', async (t) => {
	const { client, requests } = await service(t, () => ({
		result: {
			run,
			events: [
				{ runId: 'run-1', seq: 2, ts: 102, type: 'run_succeeded', outputOmitted: 'too_large' },
			],
			nextSeq: 2,
			truncated: false,
			observationComplete: true,
		},
	}));
	const page = await client.run('run-1', 0);
	assert.equal(page.output.kind, 'omitted');
	assert.equal(page.output.reason, 'too_large');
	assert.equal(page.complete, true);
	assert.deepEqual(requests[0].body.params.arguments, {
		run_id: 'run-1',
		after_seq: 0,
		limit: 100,
	});
});

test('does not claim completion from an incomplete terminal observation', async (t) => {
	const { client } = await service(t, () => ({
		result: { run, events: [], nextSeq: 0, truncated: false, observationComplete: false },
	}));
	assert.equal((await client.run('run-1', 0)).complete, false);
});

test('refuses events for another run', async (t) => {
	const { client } = await service(t, () => ({
		result: {
			run,
			events: [
				{ runId: 'another-run', seq: 1, ts: 101, type: 'run_succeeded', outputJson: '"wrong"' },
			],
			nextSeq: 1,
			truncated: false,
		},
	}));
	await assert.rejects(client.run('run-1', 0), /invalid/i);
});

test('preserves failure details and accepts an unknown run version', async (t) => {
	const { client } = await service(t, () => ({
		result: {
			run: { ...run, version: '', status: 'failed', failure: { message: 'Connection expired' } },
			events: [
				{ runId: 'run-1', seq: 1, type: 'step_failed', failure: { message: 'Permission denied' } },
			],
			nextSeq: 1,
			truncated: false,
			observationComplete: true,
		},
	}));
	const page = await client.run('run-1', 0);
	assert.equal(page.run.version, undefined);
	assert.equal(page.run.failure, 'Connection expired');
	assert.equal(page.events[0].message, 'Permission denied');
});

test('requires inspection when the server reports an unknown launch', async (t) => {
	const { client } = await service(t, () => ({
		result: {
			runId: 'stable',
			workflowId: 'workflow-1',
			version: 3,
			launchState: 'launch_unknown',
		},
	}));
	await assert.rejects(
		client.start({ workflowId: 'workflow-1', version: 3, runId: 'stable', input: null }),
		LaunchUncertain,
	);
});

test('reads the initial event at sequence zero', async (t) => {
	const { client } = await service(t, () => ({
		result: {
			run,
			events: [
				{ runId: 'run-1', seq: 0, type: 'run_started' },
				{ runId: 'run-1', seq: 1, type: 'run_succeeded', outputJson: '"done"' },
			],
			nextSeq: 1,
			truncated: false,
		},
	}));
	const page = await client.run('run-1', 0);
	assert.deepEqual(
		page.events.map((event) => event.seq),
		[0, 1],
	);
	assert.equal(page.output.kind, 'available');
	assert.equal(page.output.value, 'done');
});

test('validates editable JSON before a launch request can be built', () => {
	assert.equal(parseInput('  '), undefined);
	assert.deepEqual(parseInput('{"text":"reviewed"}'), { text: 'reviewed' });
	assert.throws(() => parseInput('{'), /valid JSON/);
	assert.throws(() => parseInput('"' + 'x'.repeat(100000) + '"'), /100 KB/);
});

test('preserves copyable JSON and restricts result links to ordinary web URLs', () => {
	assert.equal(outputText({ kind: 'available', value: { answer: 42 } }), '{\n  "answer": 42\n}');
	assert.equal(
		resultUrl({ kind: 'available', value: 'https://example.com/result' }),
		'https://example.com/result',
	);
	for (const value of [
		'javascript:alert(1)',
		'file:///etc/passwd',
		'https://user:secret@example.com',
		{ url: 'https://example.com' },
	]) {
		assert.equal(resultUrl({ kind: 'available', value }), undefined);
	}
	assert.equal(outputText({ kind: 'omitted', reason: 'too_large' }), undefined);
});
