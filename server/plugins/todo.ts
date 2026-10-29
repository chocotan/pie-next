import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
	defineDoc,
	defineExtension,
	defineTool,
	section,
	type ConversationId,
	type Harness,
} from "@earendil-works/pi-durable";

export type TodoItem = {
	id: string;
	content: string;
	status: "pending" | "in_progress" | "completed" | "cancelled";
	assignedConversationId?: number;
};

type TodoState = {
	items: TodoItem[];
	updatedAt: number;
};

type TodoWriteReceipt = {
	applied: boolean;
	output: string;
};

export const TodoDoc = defineDoc<TodoState>({
	kind: "app.todos",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ items: [], updatedAt: 0 }),
	checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export const TodoReceipt = defineDoc<TodoWriteReceipt>({
	kind: "app.todo-write-receipt",
	version: 1,
	scope: "task",
	initial: () => ({ applied: false, output: "" }),
	checkpointWhen: () => false,
});

const TodoItemSchema = Type.Object({
	id: Type.String(),
	content: Type.String(),
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("in_progress"),
		Type.Literal("completed"),
		Type.Literal("cancelled"),
	]),
	assignedConversationId: Type.Optional(Type.Number()),
});

function formatTodos(items: readonly TodoItem[]): string {
	if (items.length === 0) return "No todos.";
	return items
		.map((item) => {
			const assignment = item.assignedConversationId === undefined ? "" : ` → conversation ${item.assignedConversationId}`;
			return `- [${item.status}] (${item.id}) ${item.content}${assignment}`;
		})
		.join("\n");
}

function textResult(text: string) {
	return { output: [{ type: "text" as const, text }] };
}

export const TodoExtension = defineExtension({
	name: "core.todo",
	tools: [
		defineTool({
			name: "todo_read",
			description: "Read the current conversation's complete todo list.",
			parameters: Type.Object({}),
			replay: "safe",
			execute: async (_args, api, context) => {
				const todos = await api.snapshot(TodoDoc, api.conversationId, context);
				return textResult(formatTodos(todos?.items ?? []));
			},
		}),
		defineTool({
			name: "todo_write",
			description: "Replace the current conversation's complete todo list.",
			parameters: Type.Object({ items: Type.Array(TodoItemSchema) }),
			replay: "safe",
			execute: async (args, api, context) => {
				const output = await api.commit(async (tx) => {
					const receipt = await tx.doc(TodoReceipt, api.taskId);
					if (receipt.applied) return receipt.output;

					const todos = await tx.doc(TodoDoc, api.conversationId);
					todos.items = args.items;
					todos.updatedAt = api.now();
					receipt.applied = true;
					receipt.output = `Updated ${args.items.length} todo item${args.items.length === 1 ? "" : "s"}.`;
					return receipt.output;
				}, context);
				return textResult(output);
			},
		}),
	],
	sections: [
		section("todos", async (input, context) => {
			const todos = await input.read.snapshot(TodoDoc, input.conversationId, context);
			return todos === undefined || todos.items.length === 0 ? undefined : formatTodos(todos.items);
		}),
	],
});

export async function updateTodos(
	harness: Harness,
	conversationId: ConversationId,
	items: TodoItem[],
	context: Context,
): Promise<void> {
	await harness.commit(async (tx) => {
		const todos = await tx.doc(TodoDoc, conversationId);
		todos.items = items;
		todos.updatedAt = Date.now();
	}, context);
}
