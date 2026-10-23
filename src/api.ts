export const MCP_URL = 'https://mcp.whenever.dev/';
export type Workflow = { id: string; name: string; deployedVersion: number; updatedAt?: string };
export type Run = {
	runId: string;
	workflowId: string;
	version: string;
	status: 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
	startedAt: number;
	endedAt?: number;
	failure?: string;
};
export type RunEvent = {
	runId: string;
	seq: number;
	type: string;
	name?: string;
	message?: string;
};
export type Output =
	| { kind: 'not-observed' | 'none' }
	| { kind: 'omitted'; reason: string }
	| { kind: 'available'; value: unknown };
export type RunPage = {
	run: Run;
	events: RunEvent[];
	nextSeq: number;
	truncated: boolean;
	complete: boolean;
	output: Output;
};
export type Start = {
	workflowId: string;
	version: number;
	runId: string;
	input: unknown;
	triggerKey?: string;
};
class RequestRefused extends Error {}
export class SignInRequired extends Error {
	constructor() {
		super('Connect your Whenever account to continue.');
	}
}
export class LaunchUncertain extends Error {
	runId: string;
	constructor(runId: string) {
		super('The launch outcome is uncertain. Inspect this run before starting another.');
		this.runId = runId;
	}
}
export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(field = 'response'): never {
	throw new Error(`Whenever returned invalid ${field} data. Refresh to try the read again.`);
}
function data(value: unknown): Record<string, unknown> {
	if (!object(value)) invalid();
	return value;
}
function text(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 20000) invalid();
	return value;
}
function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
	return value;
}
function completeness(value: unknown): 'complete' | 'truncated' | 'not-evidenced' {
	if (value === undefined || value === 'not-evidenced') return 'not-evidenced';
	if (value !== 'complete' && value !== 'truncated') invalid();
	return value;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) invalid();
	return value;
}
function workflow(value: unknown): Workflow {
	const item = data(value);
	return {
		id: text(item.id),
		name: text(item.name),
		deployedVersion: item.deployedVersion === undefined ? 0 : integer(item.deployedVersion),
		...(item.updatedAt === undefined ? {} : { updatedAt: text(item.updatedAt) }),
	};
}
function run(value: unknown): Run {
	const item = data(value);
	const status = item.status;
	if (
		status !== 'running' &&
		status !== 'succeeded' &&
		status !== 'failed' &&
		status !== 'timed_out' &&
		status !== 'cancelled'
	)
		invalid();
	return {
		runId: text(item.runId),
		workflowId: text(item.workflowId),
		version: item.version === '' ? '' : text(item.version),
		status,
		startedAt: integer(item.startedAt),
		...(item.endedAt === undefined ? {} : { endedAt: integer(item.endedAt) }),
		...(item.failure === undefined ? {} : { failure: text(data(item.failure).message) }),
	};
}
export function outputText(output: Output): string | undefined {
	if (output.kind !== 'available') return undefined;
	return typeof output.value === 'string' ? output.value : JSON.stringify(output.value, null, 2);
}
export function resultUrl(output: Output): string | undefined {
	if (output.kind !== 'available' || typeof output.value !== 'string') return undefined;
	try {
		const url = new URL(output.value);
		return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}
export function parseInput(input: string): unknown {
	if (input.trim() === '') return undefined;
	if (Buffer.byteLength(input) > 100000) throw new Error('Input must be smaller than 100 KB.');
	try {
		return JSON.parse(input);
	} catch {
		throw new Error('Enter valid JSON, or leave the input empty.');
	}
}
export class WheneverClient {
	private token: () => Promise<string>;
	private fetcher: typeof fetch;
	private sequence = 0;
	constructor(token: () => Promise<string>, fetcher: typeof fetch = fetch) {
		this.token = token;
		this.fetcher = fetcher;
	}
	private async call(
		name: string,
		args: Record<string, unknown> = {},
		authorizedToken?: string,
	): Promise<Record<string, unknown>> {
		const token = authorizedToken ?? (await this.token());
		const id = ++this.sequence;
		const response = await this.fetcher(MCP_URL, {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': '2025-03-26',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id,
				method: 'tools/call',
				params: { name, arguments: args },
			}),
		});
		if (response.status === 401) throw new SignInRequired();
		if (!response.ok) {
			const message = `Whenever request failed (HTTP ${response.status}).`;
			if (response.status >= 400 && response.status < 500 && response.status !== 408)
				throw new RequestRefused(message);
			throw new Error(message);
		}
		const reply = data(await response.json());
		if (reply.jsonrpc !== '2.0' || reply.id !== id || reply.error !== undefined) invalid();
		const result = data(reply.result);
		const payload = data(data(result.structuredContent).result);
		if (result.isError === true) {
			if (name === 'run_workflow_manual' && payload.status === 'launch_uncertain')
				throw new LaunchUncertain(String(args.run_id));
			throw new RequestRefused(
				typeof payload.message === 'string'
					? payload.message.slice(0, 4000)
					: 'Whenever refused this request. Check the workflow setup in Whenever.',
			);
		}
		return payload;
	}
	async workflows() {
		const result = await this.call('list_workflows');
		return {
			workflows: array(result.workflows).map(workflow),
			completeness: completeness(result.completeness),
		};
	}
	async profile() {
		const result = await this.call('get_current_user');
		if (result.isLoggedIn === false) throw new SignInRequired();
		return {
			name:
				typeof result.displayName === 'string' ? result.displayName : 'Connected Whenever account',
			email: typeof result.email === 'string' ? result.email : undefined,
		};
	}
	async workflow(id: string) {
		const result = await this.call('get_workflow', { workflow_id: id });
		const item = workflow(result.workflow);
		if (item.id !== id) invalid();
		const source = data(result.source);
		return {
			workflow: item,
			version: source.latestVersion === null ? null : integer(source.latestVersion),
			deployedVersion: integer(source.deployedVersion),
		};
	}
	async runs(workflowId: string) {
		const result = await this.call('list_runs', { workflow_id: workflowId });
		const runs = array(result.runs).map(run);
		if (runs.some((item) => item.workflowId !== workflowId)) invalid();
		return { runs, completeness: completeness(result.completeness) };
	}
	async start(request: Start) {
		const token = await this.token();
		// The run id is chosen before dispatch. A lost answer never authorizes a second launch.
		try {
			const result = await this.call(
				'run_workflow_manual',
				{
					workflow_id: request.workflowId,
					expected_version: request.version,
					run_id: request.runId,
					confirm_external_side_effects: true,
					...(request.input === undefined ? {} : { input: request.input }),
					...(request.triggerKey ? { trigger_key: request.triggerKey } : {}),
				},
				token,
			);
			if (
				result.runId !== request.runId ||
				result.workflowId !== request.workflowId ||
				result.version !== request.version ||
				!['claimed', 'launched', 'launch_unknown', 'not_started'].includes(
					String(result.launchState),
				)
			)
				throw new LaunchUncertain(request.runId);
			if (result.launchState === 'launch_unknown') throw new LaunchUncertain(request.runId);
			return { runId: request.runId, launchState: String(result.launchState) };
		} catch (error) {
			if (error instanceof SignInRequired) throw error;
			if (error instanceof RequestRefused) throw error;
			throw new LaunchUncertain(request.runId);
		}
	}
	async run(runId: string, afterSeq: number): Promise<RunPage> {
		const result = await this.call('get_run', { run_id: runId, after_seq: afterSeq, limit: 100 });
		const summary = run(result.run);
		const nextSeq = integer(result.nextSeq);
		if (
			summary.runId !== runId ||
			nextSeq < afterSeq ||
			typeof result.truncated !== 'boolean' ||
			(result.truncated && nextSeq === afterSeq) ||
			(result.observationComplete !== undefined && typeof result.observationComplete !== 'boolean')
		)
			invalid('run page or cursor');
		const raw = array(result.events);
		if (raw.length > 100) invalid();
		let previous = afterSeq === 0 ? -1 : afterSeq;
		let output: Output = { kind: 'not-observed' };
		const events = raw.map((value) => {
			const event = data(value);
			const seq = integer(event.seq);
			if (event.runId !== runId || seq <= previous || seq > nextSeq)
				invalid('event identity or order');
			previous = seq;
			const type = text(event.type);
			if (type === 'run_succeeded') {
				if (output.kind !== 'not-observed') invalid();
				if (event.outputOmitted !== undefined) {
					if (
						event.outputJson !== undefined ||
						!['too_large', 'unserializable'].includes(String(event.outputOmitted))
					)
						invalid();
					output = { kind: 'omitted', reason: String(event.outputOmitted) };
				} else if (event.outputJson !== undefined) {
					if (typeof event.outputJson !== 'string' || event.outputJson.length > 20000) invalid();
					output = { kind: 'available', value: JSON.parse(event.outputJson) };
				} else output = { kind: 'none' };
			}
			return {
				runId,
				seq,
				type,
				...(event.name === undefined ? {} : { name: text(event.name) }),
				...(event.failure !== undefined
					? { message: text(data(event.failure).message) }
					: event.message === undefined
						? {}
						: { message: text(event.message) }),
			};
		});
		return {
			run: summary,
			events,
			nextSeq,
			truncated: result.truncated,
			complete:
				summary.status !== 'running' && result.observationComplete !== false && !result.truncated,
			output,
		};
	}
}
