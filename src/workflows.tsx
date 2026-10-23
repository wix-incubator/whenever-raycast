import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Action, ActionPanel, Detail, Icon, List, useNavigation, type Image } from '@raycast/api';
import type { Activity } from './activity.ts';
import type { Workflow } from './api.ts';
import { activityFor, api } from './auth.ts';
import { ErrorView } from './error-view.tsx';
import { FilterDropdown } from './filter-dropdown.tsx';
import { md } from './format.ts';
import { RunDetail } from './run-detail.tsx';
import { RunForm } from './run-form.tsx';
import { Runs } from './runs.tsx';
import { useLoad } from './use-load.ts';
import { APP_URL, workflowUrl } from './urls.ts';

export type Destination = 'details' | 'run' | 'runs';
const DESTINATIONS: Record<
	Destination,
	{
		title: string;
		icon: Image.ImageLike;
		placeholder: string;
		view: (workflow: Workflow, activity: Activity) => ReactElement;
	}
> = {
	details: {
		title: 'View Workflow',
		icon: Icon.Eye,
		placeholder: 'Search your workflows…',
		view: (workflow, activity) => <WorkflowDetail workflow={workflow} activity={activity} />,
	},
	run: {
		title: 'Review and Run',
		icon: Icon.Play,
		placeholder: 'Choose a workflow to run…',
		view: (workflow, activity) => <RunForm workflow={workflow} activity={activity} />,
	},
	runs: {
		title: 'View Runs',
		icon: Icon.Clock,
		placeholder: 'Choose a workflow to view its runs…',
		view: (workflow, activity) => <Runs workflow={workflow} activity={activity} />,
	},
};
type WorkflowFilter = {
	value: string;
	title: string;
	keep: (workflow: Workflow, favorites: string[]) => boolean;
};
const FILTERS: WorkflowFilter[] = [
	{ value: 'all', title: 'All Workflows', keep: () => true },
	{
		value: 'favorites',
		title: 'Favorites',
		keep: (item, favorites) => favorites.includes(item.id),
	},
	{
		value: 'published',
		title: 'Published Version',
		keep: (item) => item.deployedVersion !== undefined,
	},
	{
		value: 'unpublished',
		title: 'No Published Version',
		keep: (item) => item.deployedVersion === undefined,
	},
];
export function Workflows({ account, primary }: { account: string; primary: Destination }) {
	const { push } = useNavigation();
	const [filter, setFilter] = useState(FILTERS[0]);
	const activity = useMemo(() => activityFor(account), [account]);
	const list = useLoad(useCallback(() => api.workflows(), []));
	const local = useLoad(useCallback(() => activity.read(), [activity]));
	const error = list.error ?? local.error;
	const reload = () => {
		list.reload();
		local.reload();
	};
	if (error) return <ErrorView error={error} retry={reload} />;
	const all = list.data?.workflows ?? [];
	const favorites = local.data?.favorites ?? [];
	const recent = (id: string) => {
		const index = local.data?.workflows.indexOf(id) ?? -1;
		return index < 0 ? 1000 : index;
	};
	const favorite = (item: Workflow) => favorites.includes(item.id);
	const items = all
		.filter((item) => filter.keep(item, favorites))
		.sort(
			(a, b) =>
				Number(favorite(b)) - Number(favorite(a)) ||
				recent(a.id) - recent(b.id) ||
				a.name.localeCompare(b.name),
		);
	const open = async (item: Workflow, destination: Destination) => {
		local.set(await activity.visit(item.id));
		push(DESTINATIONS[destination].view(item, activity));
	};
	const destinations = [primary, ...(['run', 'runs'] as const).filter((item) => item !== primary)];
	return (
		<List
			isLoading={list.busy || local.busy}
			searchBarPlaceholder={DESTINATIONS[primary].placeholder}
			searchBarAccessory={
				<FilterDropdown
					tooltip="Filter workflows"
					options={FILTERS}
					value={filter}
					onChange={setFilter}
				/>
			}
		>
			<List.EmptyView
				title={list.busy ? 'Loading workflows…' : 'No matching workflows'}
				description="Create workflows in Whenever, or choose another filter."
				actions={
					<ActionPanel>
						<Action title="Refresh" onAction={reload} />
						<Action.OpenInBrowser title="Open Whenever" url={APP_URL} />
					</ActionPanel>
				}
			/>
			{list.data && list.data.completeness !== 'complete' && (
				<List.Section
					title="Partial workflow list"
					subtitle="Refresh or open Whenever to find other workflows"
				/>
			)}
			<List.Section title="Workflows">
				{items.map((item) => (
					<List.Item
						key={item.id}
						title={item.name}
						keywords={[item.id]}
						icon={favorite(item) ? Icon.Star : Icon.Bolt}
						accessories={[
							{
								text:
									item.deployedVersion === undefined
										? 'No published version'
										: `Published v${item.deployedVersion}`,
							},
						]}
						actions={
							<ActionPanel>
								{destinations.map((destination) => (
									<Action
										key={destination}
										title={DESTINATIONS[destination].title}
										icon={DESTINATIONS[destination].icon}
										onAction={() => open(item, destination)}
									/>
								))}
								<Action
									title={favorite(item) ? 'Remove Favorite' : 'Add Favorite'}
									icon={Icon.Star}
									onAction={async () => local.set(await activity.toggleFavorite(item.id))}
								/>
								<Action.OpenInBrowser
									title="Open Workflow in Whenever"
									url={workflowUrl(item.id)}
								/>
								<Action.CopyToClipboard title="Copy Workflow Link" content={workflowUrl(item.id)} />
								<Action title="Refresh" onAction={reload} />
							</ActionPanel>
						}
					/>
				))}
			</List.Section>
			{primary === 'runs' && filter === FILTERS[0] && (
				<List.Section title="Runs Started from Raycast">
					{local.data?.runs.map((item) => (
						<List.Item
							key={item.runId}
							title={all.find((w) => w.id === item.workflowId)?.name ?? item.workflowId}
							subtitle={item.runId}
							accessories={[{ text: item.pending ? 'Launch uncertain' : `Saved v${item.version}` }]}
							actions={
								<ActionPanel>
									<Action
										title="Inspect Run"
										onAction={() =>
											push(
												<RunDetail
													workflowId={item.workflowId}
													runId={item.runId}
													activity={activity}
												/>,
											)
										}
									/>
								</ActionPanel>
							}
						/>
					))}
				</List.Section>
			)}
		</List>
	);
}
function WorkflowDetail({ workflow, activity }: { workflow: Workflow; activity: Activity }) {
	const { push } = useNavigation();
	const state = useLoad(useCallback(() => api.workflow(workflow.id), [workflow.id]));
	if (state.error) return <ErrorView error={state.error} retry={state.reload} />;
	return (
		<Detail
			isLoading={state.busy}
			markdown={`# ${md(workflow.name)}\n\nLatest saved version: **${state.data?.version ?? 'None'}**\n\nPublished version: **${state.data?.deployedVersion ?? 'None'}**\n\nManual execution runs the latest saved version. That version can differ from the published version.`}
			actions={
				<ActionPanel>
					{(['run', 'runs'] as const).map((destination) => (
						<Action
							key={destination}
							title={DESTINATIONS[destination].title}
							icon={DESTINATIONS[destination].icon}
							onAction={() => push(DESTINATIONS[destination].view(workflow, activity))}
						/>
					))}
					<Action.OpenInBrowser title="Open Workflow in Whenever" url={workflowUrl(workflow.id)} />
				</ActionPanel>
			}
		/>
	);
}
