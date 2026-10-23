import { outputText, type Output, type Run, type RunEvent, type RunPage } from './api.ts';
import { code, errorMessage, humanize, md } from './format.ts';

const EVENT_LIMIT = 500;
export type Observation = {
	run?: Run;
	events: RunEvent[];
	output: Output;
	complete: boolean;
	more: boolean;
	reading: boolean;
	error?: unknown;
};
export const unobserved: Observation = {
	events: [],
	output: { kind: 'not-observed' },
	complete: false,
	more: false,
	reading: false,
};
export function observe(state: Observation, page: RunPage): Observation {
	const last = state.events.at(-1)?.seq ?? -1;
	return {
		run: page.run,
		events: [...state.events, ...page.events.filter((event) => event.seq > last)].slice(
			-EVENT_LIMIT,
		),
		output: page.output.kind === 'not-observed' ? state.output : page.output,
		complete: page.complete,
		more: page.truncated,
		reading: false,
	};
}
function status({ run, complete }: Observation, uncertain: boolean) {
	if (!run) return uncertain ? 'Launch uncertain' : 'Awaiting run evidence';
	if (run.status === 'succeeded' && !complete) return 'Success reported · observation incomplete';
	return humanize(run.status);
}
function outputNotice(output: Output) {
	switch (output.kind) {
		case 'omitted':
			return `Output omitted: ${humanize(output.reason)}.`;
		case 'none':
			return 'The run returned no output.';
		case 'not-observed':
			return 'Output has not been observed.';
		case 'available':
			return code(outputText(output) ?? '');
	}
}
function eventLine(event: RunEvent) {
	return [
		`${event.seq}. ${md(humanize(event.type))}`,
		...(event.name ? [md(event.name)] : []),
		...(event.message ? [md(event.message)] : []),
	].join(' · ');
}
export function runMarkdown(state: Observation, runId: string, uncertain: boolean) {
	const { run, error, events } = state;
	return [
		`# ${md(status(state, uncertain))}`,
		`Run: ${md(runId)}`,
		...(run ? [`Saved version: **${md(run.version ?? 'Unknown')}**`] : []),
		...(run?.failure ? [`**Failure:** ${md(run.failure)}`] : []),
		...(error
			? [`**Read failed:** ${md(errorMessage(error))}`, 'Inspect this run before starting another.']
			: []),
		...(state.more ? ['More recorded events are available. Load the next page.'] : []),
		'## Output',
		outputNotice(state.output),
		'## Recorded events',
		...(events.length ? events.map(eventLine) : ['No events have been read yet.']),
		`Showing up to the latest ${EVENT_LIMIT} loaded events.`,
	].join('\n\n');
}
