import { useEffect, useRef, useState } from 'react';
import { Action, ActionPanel, Detail, Icon } from '@raycast/api';
import type { Activity } from './activity.ts';
import { outputText, resultUrl } from './api.ts';
import { api } from './auth.ts';
import { observe, runMarkdown, unobserved } from './run-observation.ts';
import { workflowUrl } from './urls.ts';

function useRunObservation(workflowId: string, runId: string, activity: Activity) {
	const [observation, setObservation] = useState(unobserved);
	const [auto, setAuto] = useState(true);
	const [revision, setRevision] = useState(0);
	const cursor = useRef(0);
	useEffect(() => {
		let current = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const read = async () => {
			setObservation((state) => ({ ...state, reading: true, error: undefined }));
			try {
				const page = await api.run(runId, cursor.current);
				if (!current) return;
				if (page.run.workflowId !== workflowId)
					throw new Error('The run belongs to a different workflow.');
				await activity.observed(runId);
				if (!current) return;
				cursor.current = page.nextSeq;
				setObservation((state) => observe(state, page));
				if (auto && !page.complete && !page.truncated) timer = setTimeout(() => void read(), 2500);
			} catch (error) {
				if (current) setObservation((state) => ({ ...state, reading: false, error }));
			}
		};
		void read();
		return () => {
			current = false;
			if (timer) clearTimeout(timer);
		};
	}, [workflowId, runId, activity, auto, revision]);
	return {
		observation,
		auto,
		toggleAuto: () => setAuto((value) => !value),
		readNext: () => setRevision((value) => value + 1),
	};
}
export function RunDetail({
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
	const { observation, auto, toggleAuto, readNext } = useRunObservation(
		workflowId,
		runId,
		activity,
	);
	const content = outputText(observation.output);
	const url = resultUrl(observation.output);
	return (
		<Detail
			isLoading={observation.reading}
			markdown={runMarkdown(observation, runId, uncertain)}
			actions={
				<ActionPanel>
					<Action
						title={observation.more ? 'Load Next Events' : 'Refresh Run'}
						icon={Icon.ArrowClockwise}
						onAction={readNext}
					/>
					{!observation.complete && (
						<Action
							title={auto ? 'Pause Automatic Refresh' : 'Resume Automatic Refresh'}
							onAction={toggleAuto}
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
