import { GATE_CUSTOM_TYPE } from "./ambiguity";
import { describeError } from "./client";
import type { ExtensionAPI, HostNode, HostSpan } from "./host";
import { SPEC_NOTE_CUSTOM_TYPE } from "./pipeline/spec";
import { ADVERSARY_CUSTOM_TYPE, ADVISORY_CUSTOM_TYPE } from "./reviewer";

export interface ParsedNote { tag: string; attrs: [string, string][]; body: string }

export function parseNote(content: string): ParsedNote | null {
	const match = /^<([a-z][a-z-]*)((?:\s+[a-z_]+="[^"]*")*)>\n([\s\S]*?)\n<\/\1>$/.exec(content);
	if (!match) return null;
	const attrs: [string, string][] = [];
	for (const attr of match[2].matchAll(/([a-z_]+)="([^"]*)"/g)) {
		attrs.push([attr[1], attr[2].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&")]);
	}
	return { tag: match[1], attrs, body: match[3] };
}

export function noteNode(note: ParsedNote): HostNode | null {
	const labels: Record<string, string> = {
		"adversarial-note": "adversary",
		advisory: "advisory",
		"ambiguity-gate": "ambiguity gate",
		"pipeline-check": "pipeline check",
	};
	if (!Object.hasOwn(labels, note.tag)) return null;
	const label = labels[note.tag];
	const severity = note.attrs.find(([name]) => name === "severity")?.[1];
	const tone = severity === "blocker" ? "error" : severity === "concern" ? "warning" : severity === "nit" ? "muted" : note.tag === "pipeline-check" ? "warning" : "info";
	const head: HostSpan[] = [{ t: "TypeSafe", s: "strong" }, { t: " · ", s: "muted" }, { t: label, s: "muted" }];
	if (severity !== undefined) head.push({ t: " · ", s: "muted" }, { t: severity, s: `${tone} strong` });
	const children: HostNode[] = [{ k: "md", p: { text: note.body } }];
	const items = note.attrs.filter(([name, value]) => value !== "" && name !== "severity" && name !== "guidance" && name !== "advisor")
		.map(([name, value]) => ({ k: [{ t: name.replaceAll("_", " "), s: "muted" }], v: value }));
	if (items.length) children.push({ k: "kv", p: { items } });
	return { k: "card", p: { head, tone }, c: children };
}

export function noteText(node: HostNode & { k: "card" }): string {
	const parts = [node.p.head.map((span) => span.t).join(""), ...node.c.filter((child) => child.k === "md").map((child) => child.p.text)];
	const kv = node.c.find((child) => child.k === "kv");
	if (kv?.k === "kv") parts.push(kv.p.items.map((item) => `${item.k.map((span) => span.t).join("")}: ${item.v}`).join("\n"));
	return parts.join("\n\n");
}

export const NOTE_TYPES = [ADVERSARY_CUSTOM_TYPE, ADVISORY_CUSTOM_TYPE, GATE_CUSTOM_TYPE, SPEC_NOTE_CUSTOM_TYPE] as const;

export function registerNoteRenderers(pi: ExtensionAPI): void {
	const Text = pi.pi?.Text;
	if (!pi.registerMessageRenderer || !Text) return;
	for (const type of NOTE_TYPES) {
		pi.registerMessageRenderer(type, (message) => {
			try {
				if (typeof message.content !== "string") return undefined;
				const note = parseNote(message.content);
				const node = note && noteNode(note);
				if (!node || node.k !== "card") return undefined;
				let text: InstanceType<typeof Text> | undefined;
				return { describe: () => node, render: (width) => (text ??= new Text(noteText(node), 1, 0)).render(width) };
			} catch (err) {
				pi.logger?.debug?.(`[typesafe] note render skipped: ${describeError(err)}`);
				return undefined;
			}
		});
	}
}
