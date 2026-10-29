import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";

export type ProviderProtocol = "openai-completions" | "openai-responses" | "anthropic-messages";

export interface ProviderProfile {
	id: string;
	name: string;
	protocol: ProviderProtocol;
	baseUrl: string;
	models: string;
	enabled: boolean;
	hasKey: boolean;
}

export interface StoredProvider extends Omit<ProviderProfile, "hasKey"> {
	apiKey?: string;
	modelsCatalog?: Model<Api>[];
}

export interface ModelSelection {
	provider: string;
	modelId: string;
}

const protocols = new Set<ProviderProtocol>([
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
]);
const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function modelIds(models: string): string[] {
	return [...new Set(models.split(",").map((id) => id.trim()).filter(Boolean))];
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function validateProfile(profile: ProviderProfile, requireModels = true): string[] {
	if (!/^[a-z][a-z0-9-]*$/.test(profile.id)) throw new Error("Invalid provider ID");
	if (!profile.name.trim()) throw new Error("Provider name is required");
	if (!protocols.has(profile.protocol)) throw new Error("Unsupported provider protocol");
	if (!isHttpUrl(profile.baseUrl.trim())) throw new Error("Provider base URL must be HTTP(S)");
	if (typeof profile.enabled !== "boolean") throw new Error("Provider enabled state must be boolean");
	const ids = modelIds(profile.models);
	if (requireModels && ids.length === 0) throw new Error("At least one model ID is required");
	return ids;
}

function toProfile(provider: StoredProvider): ProviderProfile {
	return {
		id: provider.id,
		name: provider.name,
		protocol: provider.protocol,
		baseUrl: provider.baseUrl,
		models: provider.models,
		enabled: provider.enabled,
		hasKey: Boolean(provider.apiKey),
	};
}

function toModel(provider: StoredProvider, id: string, catalog?: Model<Api>): Model<Api> {
	return {
		...catalog,
		id,
		name: catalog?.name || id,
		api: provider.protocol,
		provider: provider.id,
		baseUrl: provider.baseUrl,
		reasoning: catalog?.reasoning ?? false,
		input: catalog?.input?.length ? catalog.input : ["text"],
		cost: { ...zeroCost, ...catalog?.cost },
		contextWindow: catalog?.contextWindow ?? 128_000,
		maxTokens: catalog?.maxTokens ?? 16_384,
	};
}

function catalogFor(provider: StoredProvider): Model<Api>[] {
	return modelIds(provider.models).map((id) =>
		toModel(provider, id, provider.modelsCatalog?.find((model) => model.id === id)),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importPieConfig(value: unknown): StoredProvider[] {
	if (!isRecord(value) || !isRecord(value.providers)) throw new Error("Invalid Pie models configuration");
	const imported: StoredProvider[] = [];
	for (const [id, candidateProvider] of Object.entries(value.providers)) {
		if (!isRecord(candidateProvider) || !/^[a-z][a-z0-9-]*$/.test(id)) continue;
		const protocol = candidateProvider.api;
		const baseUrl = typeof candidateProvider.baseUrl === "string" ? candidateProvider.baseUrl.trim() : "";
		if (typeof protocol !== "string" || !protocols.has(protocol as ProviderProtocol) || !isHttpUrl(baseUrl)) continue;
		if (!Array.isArray(candidateProvider.models)) continue;
		const provider: StoredProvider = {
			id,
			name: typeof candidateProvider.name === "string" && candidateProvider.name.trim() ? candidateProvider.name.trim() : id,
			protocol: protocol as ProviderProtocol,
			baseUrl,
			models: "",
			enabled: true,
			...(typeof candidateProvider.apiKey === "string" && candidateProvider.apiKey ? { apiKey: candidateProvider.apiKey } : {}),
		};
		const catalog = candidateProvider.models.flatMap((candidate) => {
			if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.trim()) return [];
			const model = toModel(provider, candidate.id.trim(), candidate as unknown as Model<Api>);
			return [model];
		});
		if (catalog.length === 0) continue;
		provider.models = catalog.map((model) => model.id).join(", ");
		provider.modelsCatalog = catalog;
		imported.push(provider);
	}
	return imported;
}

function parseStoredProviders(value: unknown): StoredProvider[] {
	if (!Array.isArray(value)) throw new Error("Invalid provider configuration");
	for (const provider of value) {
		if (!isRecord(provider)) throw new Error("Invalid provider configuration");
		validateProfile(provider as unknown as ProviderProfile);
	}
	return value as StoredProvider[];
}

export class ProviderStore {
	private providers: StoredProvider[];
	private writeQueue: Promise<void> = Promise.resolve();

	private constructor(
		private readonly dataDir: string,
		providers: StoredProvider[],
	) {
		this.providers = providers;
	}

	static async open(dataDir: string): Promise<ProviderStore> {
		const file = join(dataDir, "providers.json");
		let providers: StoredProvider[];
		let initialize = false;
		try {
			const source = await readFile(file, "utf8");
			try {
				providers = parseStoredProviders(JSON.parse(source));
			} catch {
				throw new Error("Unable to parse provider configuration");
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			let pieConfig: unknown = { providers: {} };
			try {
				const source = await readFile(join(homedir(), ".pie", "models.json"), "utf8");
				try {
					pieConfig = JSON.parse(source);
				} catch {
					throw new Error("Unable to parse Pie models configuration");
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			providers = importPieConfig(pieConfig);
			initialize = true;
		}
		const store = new ProviderStore(dataDir, providers);
		if (initialize) await store.persist(providers);
		return store;
	}

	list(): ProviderProfile[] {
		return this.providers.map(toProfile);
	}

	async save(profile: ProviderProfile, apiKey?: string): Promise<ProviderProfile> {
		const ids = validateProfile(profile);
		const normalizedKey = apiKey?.trim();
		return this.update((current) => {
			const existing = current.find((provider) => provider.id === profile.id);
			const next: StoredProvider = {
				id: profile.id,
				name: profile.name.trim(),
				protocol: profile.protocol,
				baseUrl: profile.baseUrl.trim(),
				models: ids.join(", "),
				enabled: profile.enabled,
				...(existing?.apiKey ? { apiKey: existing.apiKey } : {}),
				...(normalizedKey ? { apiKey: normalizedKey } : {}),
				...(existing?.modelsCatalog ? { modelsCatalog: existing.modelsCatalog } : {}),
			};
			const providers = existing
				? current.map((provider) => (provider.id === profile.id ? next : provider))
				: [...current, next];
			return { providers, result: toProfile(next) };
		});
	}

	async discoverModels(profile: ProviderProfile, apiKey?: string): Promise<string[]> {
		validateProfile(profile, false);
		const key = apiKey?.trim() || this.providers.find((provider) => provider.id === profile.id)?.apiKey;
		const baseUrl = profile.baseUrl.trim().replace(/\/+$/, "");
		const path = profile.protocol === "anthropic-messages" && !baseUrl.endsWith("/v1") ? "/v1/models" : "/models";
		const headers: Record<string, string> = { Accept: "application/json" };
		if (profile.protocol === "anthropic-messages") {
			headers["anthropic-version"] = "2023-06-01";
			if (key) headers["x-api-key"] = key;
		} else if (key) {
			headers.Authorization = `Bearer ${key}`;
		}
		const response = await fetch(`${baseUrl}${path}`, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) throw new Error(`Provider model sync failed with HTTP ${response.status}`);
		const body: unknown = await response.json();
		if (!isRecord(body) || !Array.isArray(body.data)) throw new Error("Provider returned an invalid model list");
		const ids = body.data.map((model) => {
			if (!isRecord(model) || typeof model.id !== "string" || !model.id.trim()) {
				throw new Error("Provider returned an invalid model list");
			}
			return model.id.trim();
		});
		return [...new Set(ids)].slice(0, 1000);
	}

	async setEnabled(id: string, enabled: boolean): Promise<ProviderProfile> {
		if (typeof enabled !== "boolean") throw new Error("Provider enabled state must be boolean");
		return this.update((current) => {
			const existing = current.find((provider) => provider.id === id);
			if (!existing) throw new Error("Provider not found");
			const next = { ...existing, enabled };
			return {
				providers: current.map((provider) => (provider.id === id ? next : provider)),
				result: toProfile(next),
			};
		});
	}

	models(): ModelSelection[] {
		return this.providers.flatMap((provider) =>
			provider.enabled
				? modelIds(provider.models).map((modelId) => ({ provider: provider.id, modelId }))
				: [],
		);
	}

	defaultSelection(): ModelSelection | undefined {
		const available = this.models();
		return available.find((model) => model.modelId === "deepseek-v4.1-flash") ?? available[0];
	}

	createModels(): MutableModels {
		const models = createModels();
		this.syncModels(models);
		return models;
	}

	syncModels(models: MutableModels): void {
		const enabledIds = new Set(this.providers.filter(provider => provider.enabled).map(provider => provider.id));
		for (const current of models.getProviders()) {
			if (!enabledIds.has(current.id)) models.deleteProvider(current.id);
		}
		for (const provider of this.providers) {
			if (!provider.enabled) continue;
			const apiKey = provider.apiKey;
			const api =
				provider.protocol === "openai-completions"
					? openAICompletionsApi()
					: provider.protocol === "openai-responses"
						? openAIResponsesApi()
						: anthropicMessagesApi();
			models.setProvider(
				createProvider({
					id: provider.id,
					name: provider.name,
					baseUrl: provider.baseUrl,
					auth: {
						apiKey: {
							name: `${provider.name} API key`,
							resolve: async () => ({
								// pi-ai requires an Authorization header even for keyless endpoints.
								auth: apiKey ? { apiKey } : { headers: { authorization: "Bearer unused" } },
								source: apiKey ? "providers.json" : "keyless endpoint",
							}),
						},
					},
					models: catalogFor(provider),
					api,
				}),
			);
		}
	}

	private update<T>(mutate: (current: StoredProvider[]) => { providers: StoredProvider[]; result: T }): Promise<T> {
		const operation = this.writeQueue.then(async () => {
			const { providers, result } = mutate(this.providers);
			await this.persist(providers);
			this.providers = providers;
			return result;
		});
		this.writeQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private async persist(providers: StoredProvider[]): Promise<void> {
		await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
		const file = join(this.dataDir, "providers.json");
		const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(providers, null, 2)}\n`, { mode: 0o600 });
			await rename(temporary, file);
			await chmod(file, 0o600);
		} catch (error) {
			await unlink(temporary).catch(() => undefined);
			throw error;
		}
	}
}
