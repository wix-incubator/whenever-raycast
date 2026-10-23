import { useCallback, useState } from 'react';
import { Action, ActionPanel, Icon, List, useNavigation } from '@raycast/api';
import type { Activity } from './activity.ts';
import type { Run, Workflow } from './api.ts';
import { api } from './auth.ts';
import { ErrorView } from './error-view.tsx';
import { FilterDropdown } from './filter-dropdown.tsx';
import { humanize } from './format.ts';
import { RunDetail } from './run-detail.tsx';
import { useLoad } from './use-load.ts';
import { workflowUrl } from './urls.ts';

type RunFilter = { value: string; title: string; keep: (run: Run) => boolean };
const FILTERS: RunFilter[] = [
	{ value: 'all', title: 'All Runs', keep: () => true },
	{
		value: 'failed',
		title: 'Failed or Timed Out',
		keep: (run) => run.status === 'failed' || run.status === 'timed_out',
	},
	{ value: 'running', title: 'Running', keep: (run) => run.status === 'running' },
	{ value: 'succeeded', title: 'Succeeded', keep: (run) => run.status === 'succeeded' },
];
export function Runs({ workflow, activity }: { workflow: Workflow; activity: Activity }) {
	const { push } = useNavigation();
	const [filter, setFilter] = useState(FILTERS[0]);
	const state = useLoad(useCallback(() => api.runs(workflow.id), [workflow.id]));
	if (state.error) return <ErrorView error={state.error} retry={state.reload} />;
	const runs = (state.data?.runs ?? [])
		.filter(filter.keep)
		.sort((a, b) => b.startedAt - a.startedAt);
	return (
		<List
			isLoading={state.busy}
			navigationTitle={`${workflow.name} · Runs`}
			searchBarPlaceholder="Search run IDs…"
			searchBarAccessory={
				<FilterDropdown
					tooltip="Run status"
					options={FILTERS}
					value={filter}
					onChange={setFilter}
				/>
			}
		>
			<List.EmptyView
				title={state.busy ? 'Loading runs…' : 'No matching runs'}
				actions={
					<ActionPanel>
						<Action title="Refresh" onAction={state.reload} />
						<Action.OpenInBrowser
							title="Open Workflow in Whenever"
							url={workflowUrl(workflow.id)}
						/>
					</ActionPanel>
				}
			/>
			{state.data && state.data.completeness !== 'complete' && (
				<List.Section
					title="Partial run history"
					subtitle="More runs may be available in Whenever"
				/>
			)}
			{runs.map((run) => (
				<List.Item
					key={run.runId}
					title={humanize(run.status)}
					subtitle={`${run.version === undefined ? 'Unknown version' : `v${run.version}`} · ${run.runId}`}
					keywords={[run.runId]}
					icon={
						run.status === 'succeeded'
							? Icon.CheckCircle
							: run.status === 'running'
								? Icon.Clock
								: Icon.ExclamationMark
					}
					accessories={[{ date: new Date(run.startedAt) }]}
					actions={
						<ActionPanel>
							<Action
								title="Inspect Run"
								onAction={() =>
									push(<RunDetail workflowId={workflow.id} runId={run.runId} activity={activity} />)
								}
							/>
							<Action.CopyToClipboard title="Copy Run ID" content={run.runId} />
							<Action title="Refresh" onAction={state.reload} />
						</ActionPanel>
					}
				/>
			))}
		</List>
	);
}
