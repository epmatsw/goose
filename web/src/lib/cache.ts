import { del, get, set } from "idb-keyval";

const DATASET_KEY = "goose-dataset";

export interface GooseDataset {
	fetchedAt: string;
	shows: any[];
	setlists: any[];
}

export async function loadDataset(): Promise<GooseDataset | undefined> {
	const value = await get<GooseDataset>(DATASET_KEY);
	return value ?? undefined;
}

export async function saveDataset(dataset: GooseDataset): Promise<void> {
	await set(DATASET_KEY, dataset);
}

export async function clearDataset(): Promise<void> {
	await del(DATASET_KEY);
}
