import { SignInRequired } from './api.ts';

export const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : 'The request failed. Try again.';
export const md = (value: string) => value.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&');
export const code = (value: string) => '```json\n' + value.replace(/```/g, '`​``') + '\n```';
export const humanize = (value: string) => value.replaceAll('_', ' ');
export function errorMarkdown(error: unknown, hint?: string) {
	const title = error instanceof SignInRequired ? 'Connect Whenever' : 'Could not load Whenever';
	return [`# ${title}`, md(errorMessage(error)), ...(hint ? [hint] : [])].join('\n\n');
}
