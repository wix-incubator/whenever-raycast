import { List } from '@raycast/api';

export function FilterDropdown<T extends { value: string; title: string }>({
	tooltip,
	options,
	value,
	onChange,
}: {
	tooltip: string;
	options: readonly T[];
	value: T;
	onChange: (option: T) => void;
}) {
	return (
		<List.Dropdown
			tooltip={tooltip}
			value={value.value}
			onChange={(selected) => {
				const option = options.find((item) => item.value === selected);
				if (option) onChange(option);
			}}
		>
			{options.map((option) => (
				<List.Dropdown.Item key={option.value} title={option.title} value={option.value} />
			))}
		</List.Dropdown>
	);
}
