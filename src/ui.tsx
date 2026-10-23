import { randomUUID } from 'node:crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Action,
	ActionPanel,
	Alert,
	Clipboard,
	Detail,
	Form,
	Icon,
	List,
	LocalStorage,
	Toast,
	confirmAlert,
	getSelectedText,
	showToast,
	useNavigation,
} from '@raycast/api';
import { api, accountKey, connect, disconnect } from './auth';
import { Activity, launchRun, type ActivityData } from './activity';
import {
	LaunchUncertain,
	SignInRequired,
	outputText,
	parseInput,
	resultUrl,
	type Output,
	type Run,
	type RunEvent,
	type Workflow,
} from './api';

const workflowUrl = (id: string) => `https://app.whenever.dev/workflows/${encodeURIComponent(id)}`;
const message = (error: unknown) =>
	error instanceof Error ? error.message : 'The request failed. Try again.';
const md = (value: string) => value.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&');
const code = (value: string) => '```json\n' + value.replace(/```/g, '`\u200b``') + '\n```';
function useLoad<T>(load: () => Promise<T>) {
	const [data, setData] = useState<T>();
	const [error, setError] = useState<unknown>();
	const [busy, setBusy] = useState(true);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let current = true;
		setBusy(true);
		setError(undefined);
		setData(undefined);
		load()
			.then((value) => {
				if (current) setData(value);
			})
			.catch((value) => {
				if (current) setError(value);
			})
			.finally(() => {
				if (current) setBusy(false);
			});
		return () => {
			current = false;
		};
	}, [load, revision]);
	return { data, error, busy, reload: () => setRevision((value) => value + 1) };
}
async function signOut(reload: () => void) {
	if (
		!(await confirmAlert({
			title: 'Sign Out of Whenever?',
			message: 'Local favorites and recent-run links for this connection will be cleared.',
			primaryAction: { title: 'Sign Out', style: Alert.ActionStyle.Destructive },
		}))
	)
		return;
	try {
		await disconnect();
	} catch (error) {
		await showToast({
			style: Toast.Style.Failure,
			title: 'Revocation not confirmed',
			message: message(error),
		});
	} finally {
		reload();
	}
}
function ErrorView({
	error,
	retry,
	allowConnect = false,
}: {
	error: unknown;
	retry: () => void;
	allowConnect?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const reconnect = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await connect();
			retry();
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: 'Could not connect',
				message: message(error),
			});
		} finally {
			setBusy(false);
		}
	};
	return (
		<Detail
			isLoading={busy}
			markdown={`# ${error instanceof SignInRequired ? 'Connect Whenever' : 'Could not load Whenever'}\n\n${md(message(error))}${!allowConnect && error instanceof SignInRequired ? '\n\nClose and reopen the command to reconnect your account.' : ''}`}
			actions={
				<ActionPanel>
					{allowConnect && (
						<Action title="Connect Account" icon={Icon.Person} onAction={reconnect} />
					)}
					{allowConnect && (
						<Action title="Disconnect Account" icon={Icon.Logout} onAction={() => signOut(retry)} />
					)}
					<Action title="Retry Read" icon={Icon.ArrowClockwise} onAction={retry} />
					<Action.OpenInBrowser title="Open Whenever" url="https://app.whenever.dev" />
				</ActionPanel>
			}
		/>
	);
}
export type Mode = 'search' | 'run' | 'history' | 'account';
export function Companion({ mode }: { mode: Mode }) {
	const load = useCallback(async () => {
		const key = await accountKey();
		const profile = await api.profile();
		return { key, profile };
	}, []);
	const state = useLoad(load);
	if (state.error) return <ErrorView error={state.error} retry={state.reload} allowConnect />;
	if (!state.data) return <List isLoading searchBarPlaceholder="Loading your Whenever account…" />;
	if (mode === 'account') return <Account profile={state.data.profile} reload={state.reload} />;
	return <Workflows key={state.data.key} account={state.data.key} mode={mode} />;
}
function Account({
	profile,
	reload,
}: {
	profile: { name: string; email?: string };
	reload: () => void;
}) {
	return (
		<Detail
			markdown={`# Connected to Whenever\n\n${md(profile.name)}\n\n${md(profile.email ?? '')}\n\nYour account is connected through browser sign-in. Favorites and recent links are stored locally for this connection.`}
			actions={
				<ActionPanel>
					<Action
						title="Disconnect Account"
						icon={Icon.Logout}
						style={Action.Style.Destructive}
						onAction={() => signOut(reload)}
					/>
					<Action.OpenInBrowser title="Open Whenever" url="https://app.whenever.dev" />
				</ActionPanel>
			}
		/>
	);
}
function Workflows({ account, mode }: { account: string; mode: Exclude<Mode, 'account'> }) {
	const { push } = useNavigation();
	const [filter, setFilter] = useState('all');
	const activity = useMemo(
		() =>
			new Activity(
				{
					get: (key) => LocalStorage.getItem<string>(key),
					set: (key, value) => LocalStorage.setItem(key, value),
				},
				account,
			),
		[account],
	);
	const load = useCallback(
		async () => ({ list: await api.workflows(), local: await activity.read() }),
		[activity],
	);
	const state = useLoad(load);
	const [local, setLocal] = useState<ActivityData>();
	useEffect(() => {
		setLocal(state.data?.local);
	}, [state.data]);
	if (state.error) return <ErrorView error={state.error} retry={state.reload} />;
	const all = state.data?.list.workflows ?? [];
	const items = all.filter((item) =>
		filter === 'favorites'
			? local?.favorites.includes(item.id)
			: filter === 'active'
				? item.deployedVersion > 0
				: filter === 'inactive'
					? item.deployedVersion === 0
					: true,
	);
	const favorite = (item: Workflow) => Boolean(local?.favorites.includes(item.id));
	const recent = (id: string) => {
		const index = local?.workflows.indexOf(id) ?? -1;
		return index < 0 ? 1000 : index;
	};
	items.sort(
		(a, b) =>
			Number(favorite(b)) - Number(favorite(a)) ||
			recent(a.id) - recent(b.id) ||
			a.name.localeCompare(b.name),
	);
	const open = async (item: Workflow, destination: Mode) => {
		setLocal(await activity.visit(item.id));
		push(
			destination === 'run' ? (
				<RunForm workflow={item} activity={activity} />
			) : destination === 'history' ? (
				<Runs workflow={item} activity={activity} />
			) : (
				<WorkflowDetail workflow={item} activity={activity} />
			),
		);
	};
	return (
		<List
			isLoading={state.busy}
			searchBarPlaceholder={
				mode === 'run'
					? 'Choose a workflow to run…'
					: mode === 'history'
						? 'Choose a workflow to view its runs…'
						: 'Search your workflows…'
			}
			searchBarAccessory={
				<List.Dropdown tooltip="Filter workflows" value={filter} onChange={setFilter}>
					<List.Dropdown.Item title="All Workflows" value="all" />
					<List.Dropdown.Item title="Favorites" value="favorites" />
					<List.Dropdown.Item title="Published Version" value="active" />
					<List.Dropdown.Item title="No Published Version" value="inactive" />
				</List.Dropdown>
			}
		>
			<List.EmptyView
				title={state.busy ? 'Loading workflows…' : 'No matching workflows'}
				description="Create workflows in Whenever, or choose another filter."
				actions={
					<ActionPanel>
						<Action title="Refresh" onAction={state.reload} />
						<Action.OpenInBrowser title="Open Whenever" url="https://app.whenever.dev" />
					</ActionPanel>
				}
			/>
			{state.data?.list.completeness !== 'complete' && state.data && (
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
									item.deployedVersion > 0
										? `Published v${item.deployedVersion}`
										: 'No published version',
							},
						]}
						actions={
							<ActionPanel>
								<Action
									title={
										mode === 'run'
											? 'Review and Run'
											: mode === 'history'
												? 'View Runs'
												: 'View Workflow'
									}
									onAction={() => open(item, mode)}
								/>
								{mode !== 'run' && (
									<Action
										title="Review and Run"
										icon={Icon.Play}
										onAction={() => open(item, 'run')}
									/>
								)}
								{mode !== 'history' && (
									<Action
										title="View Runs"
										icon={Icon.Clock}
										onAction={() => open(item, 'history')}
									/>
								)}
								<Action
									title={favorite(item) ? 'Remove Favorite' : 'Add Favorite'}
									icon={Icon.Star}
									onAction={async () => setLocal(await activity.toggleFavorite(item.id))}
								/>
								<Action.OpenInBrowser
									title="Open Workflow in Whenever"
									url={workflowUrl(item.id)}
								/>
								<Action.CopyToClipboard title="Copy Workflow Link" content={workflowUrl(item.id)} />
								<Action title="Refresh" onAction={state.reload} />
							</ActionPanel>
						}
					/>
				))}
			</List.Section>
			{filter === 'all' && mode === 'history' && (
				<List.Section title="Runs Started from Raycast">
					{local?.runs.map((item) => (
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
	const load = useCallback(() => api.workflow(workflow.id), [workflow.id]);
	const state = useLoad(load);
	if (state.error) return <ErrorView error={state.error} retry={state.reload} />;
	return (
		<Detail
			isLoading={state.busy}
			markdown={`# ${md(workflow.name)}\n\nLatest saved version: **${state.data?.version ?? 'None'}**\n\nPublished version: **${state.data?.deployedVersion || 'None'}**\n\nManual execution runs the latest saved version. That version can differ from the published version.`}
			actions={
				<ActionPanel>
					<Action
						title="Review and Run"
						icon={Icon.Play}
						onAction={() => push(<RunForm workflow={workflow} activity={activity} />)}
					/>
					<Action
						title="View Runs"
						icon={Icon.Clock}
						onAction={() => push(<Runs workflow={workflow} activity={activity} />)}
					/>
					<Action.OpenInBrowser title="Open Workflow in Whenever" url={workflowUrl(workflow.id)} />
				</ActionPanel>
			}
		/>
	);
}
function RunForm({ workflow, activity }: { workflow: Workflow; activity: Activity }) {
	const { push, pop } = useNavigation();
	const load = useCallback(() => api.workflow(workflow.id), [workflow.id]);
	const state = useLoad(load);
	const [input, setInput] = useState('');
	const [trigger, setTrigger] = useState('');
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const dispatching = useRef(false);
	const importText = async (source: 'clipboard' | 'selection') => {
		try {
			const value = source === 'clipboard' ? await Clipboard.readText() : await getSelectedText();
			if (!value) throw new Error('No text is available.');
			setInput(JSON.stringify({ text: value }, null, 2));
			setError(undefined);
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: 'Could not read text',
				message: message(error),
			});
		}
	};
	const submit = async () => {
		if (dispatching.current || !state.data?.version) return;
		let parsed: unknown;
		try {
			parsed = parseInput(input);
			setError(undefined);
		} catch (error) {
			setError(message(error));
			return;
		}
		dispatching.current = true;
		setBusy(true);
		try {
			const version = state.data.version;
			if (
				!(await confirmAlert({
					title: `Run ${workflow.name}?`,
					message: `Run saved version ${version}${version !== state.data.deployedVersion ? ' (different from the published version)' : ''}. This may change external accounts. Review the input before confirming.`,
					primaryAction: { title: 'Run Saved Version' },
				}))
			)
				return;
			const result = await launchRun(api, activity, {
				workflowId: workflow.id,
				version,
				runId: randomUUID(),
				input: parsed,
				...(trigger.trim() ? { triggerKey: trigger.trim() } : {}),
			});
			pop();
			push(<RunDetail workflowId={workflow.id} runId={result.runId} activity={activity} />);
		} catch (error) {
			if (error instanceof LaunchUncertain) {
				pop();
				push(
					<RunDetail workflowId={workflow.id} runId={error.runId} activity={activity} uncertain />,
				);
			} else
				await showToast({
					style: Toast.Style.Failure,
					title: 'Run was not started',
					message: message(error),
				});
		} finally {
			dispatching.current = false;
			setBusy(false);
		}
	};
	if (state.error) return <ErrorView error={state.error} retry={state.reload} />;
	return (
		<Form
			isLoading={state.busy || busy}
			navigationTitle={`Run ${workflow.name}`}
			actions={
				<ActionPanel>
					<Action.SubmitForm title="Review and Run" icon={Icon.Play} onSubmit={submit} />
					<Action
						title="Use Clipboard as Text Input"
						icon={Icon.Clipboard}
						onAction={() => importText('clipboard')}
					/>
					<Action
						title="Use Selected Text as Input"
						icon={Icon.Text}
						onAction={() => importText('selection')}
					/>
					<Action title="Refresh Saved Version" onAction={state.reload} />
					<Action.OpenInBrowser title="Open Workflow in Whenever" url={workflowUrl(workflow.id)} />
				</ActionPanel>
			}
		>
			<Form.Description
				title="Version"
				text={
					state.data?.version
						? `Saved version ${state.data.version} · published version ${state.data.deployedVersion || 'none'}`
						: 'No saved version. Save the workflow in Whenever before running it.'
				}
			/>
			<Form.Description
				title="Execution"
				text="This runs the saved draft and may change external accounts. Clipboard and selected text are inserted as { text: … }; adjust the JSON to match your workflow."
			/>
			<Form.TextArea
				id="input"
				title="JSON Input"
				value={input}
				onChange={(value) => {
					setInput(value);
					setError(undefined);
				}}
				error={error}
				placeholder={'{ "text": "Hello" }'}
			/>
			<Form.TextField
				id="trigger"
				title="Trigger Key"
				value={trigger}
				onChange={setTrigger}
				placeholder="Optional for a single trigger"
				info="For workflows with multiple triggers, enter the declared trigger key from your workflow."
			/>
		</Form>
	);
}
function Runs({ workflow, activity }: { workflow: Workflow; activity: Activity }) {
	const { push } = useNavigation();
	const [filter, setFilter] = useState('all');
	const load = useCallback(() => api.runs(workflow.id), [workflow.id]);
	const state = useLoad(load);
	if (state.error) return <ErrorView error={state.error} retry={state.reload} />;
	const runs = [...(state.data?.runs ?? [])]
		.filter(
			(run) =>
				filter === 'all' ||
				(filter === 'failed'
					? ['failed', 'timed_out'].includes(run.status)
					: run.status === filter),
		)
		.sort((a, b) => b.startedAt - a.startedAt);
	return (
		<List
			isLoading={state.busy}
			navigationTitle={`${workflow.name} · Runs`}
			searchBarPlaceholder="Search run IDs…"
			searchBarAccessory={
				<List.Dropdown tooltip="Run status" value={filter} onChange={setFilter}>
					<List.Dropdown.Item title="All Runs" value="all" />
					<List.Dropdown.Item title="Failed or Timed Out" value="failed" />
					<List.Dropdown.Item title="Running" value="running" />
					<List.Dropdown.Item title="Succeeded" value="succeeded" />
				</List.Dropdown>
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
					title={run.status.replaceAll('_', ' ')}
					subtitle={`${run.version ? `v${run.version}` : 'Unknown version'} · ${run.runId}`}
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
function RunDetail({
	workflowId,
	runId,
	activity,
	uncertain = false,
}: {
	workflowId: string;
	runId: string;
	activity: Activity;
	uncertain?: boolean;
}) {
	const [run, setRun] = useState<Run>();
	const [events, setEvents] = useState<RunEvent[]>([]);
	const [output, setOutput] = useState<Output>({ kind: 'not-observed' });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>();
	const [complete, setComplete] = useState(false);
	const [more, setMore] = useState(false);
	const [auto, setAuto] = useState(true);
	const [revision, setRevision] = useState(0);
	const cursor = useRef(0);
	useEffect(() => {
		let current = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const read = async () => {
			setBusy(true);
			setError(undefined);
			try {
				const page = await api.run(runId, cursor.current);
				if (!current) return;
				if (page.run.workflowId !== workflowId)
					throw new Error('The run belongs to a different workflow.');
				await activity.observed(runId);
				if (!current) return;
				cursor.current = page.nextSeq;
				setRun(page.run);
				setEvents((old) =>
					[...old, ...page.events.filter((event) => event.seq > (old.at(-1)?.seq ?? -1))].slice(
						-500,
					),
				);
				if (page.output.kind !== 'not-observed') setOutput(page.output);
				setComplete(page.complete);
				setMore(page.truncated);
				if (auto && !page.complete && !page.truncated) timer = setTimeout(() => void read(), 2500);
			} catch (error) {
				if (current) setError(error);
			} finally {
				if (current) setBusy(false);
			}
		};
		void read();
		return () => {
			current = false;
			if (timer) clearTimeout(timer);
		};
	}, [workflowId, runId, activity, auto, revision]);
	const content = outputText(output);
	const url = resultUrl(output);
	const status = run
		? run.status === 'succeeded' && !complete
			? 'Success reported · observation incomplete'
			: run.status.replaceAll('_', ' ')
		: uncertain
			? 'Launch uncertain'
			: 'Awaiting run evidence';
	const outputNotice =
		output.kind === 'omitted'
			? `Output omitted: ${output.reason.replaceAll('_', ' ')}.`
			: output.kind === 'none'
				? 'The run returned no output.'
				: output.kind === 'not-observed'
					? 'Output has not been observed.'
					: code(content ?? '');
	const markdown = `# ${md(status)}\n\nRun: ${md(runId)}\n\n${run ? `Saved version: **${md(run.version || 'Unknown')}**\n\n` : ''}${run?.failure ? `**Failure:** ${md(run.failure)}\n\n` : ''}${error ? `**Read failed:** ${md(message(error))}\n\nInspect this run before starting another.\n\n` : ''}${more ? 'More recorded events are available. Load the next page.\n\n' : ''}## Output\n\n${outputNotice}\n\n## Recorded events\n\n${events.length ? events.map((event) => `${event.seq}. ${md(event.type.replaceAll('_', ' '))}${event.name ? ` · ${md(event.name)}` : ''}${event.message ? ` · ${md(event.message)}` : ''}`).join('\n\n') : 'No events have been read yet.'}\n\nShowing up to the latest 500 loaded events.`;
	return (
		<Detail
			isLoading={busy}
			markdown={markdown}
			actions={
				<ActionPanel>
					<Action
						title={more ? 'Load Next Events' : 'Refresh Run'}
						icon={Icon.ArrowClockwise}
						onAction={() => setRevision((value) => value + 1)}
					/>
					{!complete && (
						<Action
							title={auto ? 'Pause Automatic Refresh' : 'Resume Automatic Refresh'}
							onAction={() => setAuto((value) => !value)}
						/>
					)}
					{content !== undefined && (
						<Action.CopyToClipboard title="Copy Result" content={content} />
					)}
					{content !== undefined && <Action.Paste title="Paste Result" content={content} />}
					{url && <Action.OpenInBrowser title="Open Result Link" url={url} />}
					<Action.CopyToClipboard title="Copy Run ID" content={runId} />
					<Action.OpenInBrowser title="Open Workflow in Whenever" url={workflowUrl(workflowId)} />
				</ActionPanel>
			}
		/>
	);
}
