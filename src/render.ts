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
	const children: HostNode[] = [{ k: "md", p: { text: note.body } }];
	let hasDetails = false;
	let hasEvidence = false;
	for (const [name, value] of note.attrs) {
		if (value === "" || name === "severity" || name === "guidance" || name === "advisor") continue;
		if (name === "evidence") {
			children.push({ k: "rule", p: { label: "Evidence" } });
			hasEvidence = true;
		} else if (!hasDetails || hasEvidence) {
			children.push({ k: "rule", p: { label: "Details" } });
			hasDetails = true;
			hasEvidence = false;
		}
		children.push({ k: "text", p: { spans: [{ t: `${name.replaceAll("_", " ")}: `, s: "muted" }, { t: value }], wrap: "word" } });
	}
	return { k: "tool", p: { role: "omp.tool.typesafe", name: "typesafe", title: `TypeSafe · ${label}`, status: "done", frame: "card", ...(severity !== undefined ? { badges: [{ text: severity, tone }] } : {}) }, c: children };
}

export function noteText(node: HostNode & { k: "tool" }): string {
	const parts = [[node.p.title, ...(node.p.badges ?? []).map((badge) => badge.text)].join(" · "), ...node.c.filter((child) => child.k === "md").map((child) => child.p.text)];
	for (const child of node.c) {
		if (child.k === "text") parts.push(child.p.spans.map((span) => span.t).join(""));
	}
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
				if (!node || node.k !== "tool") return undefined;
				const head: HostSpan[] = [{ t: node.p.title, s: "strong" }];
				for (const badge of node.p.badges ?? []) head.push({ t: " · ", s: "muted" }, { t: badge.text, s: `${badge.tone} strong` });
				const fallback: HostNode = { k: "card", p: { role: "omp.tool", head, tone: "neutral" }, c: node.c };
				let text: InstanceType<typeof Text> | undefined;
				return { describe: (cx) => cx?.supports("tool") === false ? fallback : node, render: (width) => (text ??= new Text(noteText(node), 1, 0)).render(width) };
			} catch (err) {
				pi.logger?.debug?.(`[typesafe] note render skipped: ${describeError(err)}`);
				return undefined;
			}
		});
	}
}
