import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, HostMessageRenderer } from "../src/host";
import { NOTE_TYPES, noteNode, noteText, parseNote, registerNoteRenderers } from "../src/render";
import { escapeAttr } from "../src/text";

describe("note rendering", () => {
	test("adversary card decodes attributes and preserves their order", () => {
		const evidence = `3 uncommitted files; commands: bash: tern ctl a11y 2>&1 | grep -o '"role"'`;
		const content = `<adversarial-note severity="concern" defect="unclassified" guidance="weigh, don't blindly obey" weak_verification="0.81" unnecessary_complexity="0.59" confidence="0.31" evidence="${escapeAttr(evidence)}">\nAdversarial review of the last turn flags unclassified (weak_verification, unnecessary_complexity). Verify or refute before building on this.\n</adversarial-note>`;
		const card = noteNode(parseNote(content)!);
		expect(card).toEqual({
			k: "card", p: { head: [{ t: "TypeSafe", s: "strong" }, { t: " · ", s: "muted" }, { t: "adversary", s: "muted" }, { t: " · ", s: "muted" }, { t: "concern", s: "warning strong" }], tone: "warning" },
			c: [
				{ k: "md", p: { text: "Adversarial review of the last turn flags unclassified (weak_verification, unnecessary_complexity). Verify or refute before building on this." } },
				{ k: "kv", p: { items: [
					{ k: [{ t: "defect", s: "muted" }], v: "unclassified" },
					{ k: [{ t: "weak verification", s: "muted" }], v: "0.81" },
					{ k: [{ t: "unnecessary complexity", s: "muted" }], v: "0.59" },
					{ k: [{ t: "confidence", s: "muted" }], v: "0.31" },
					{ k: [{ t: "evidence", s: "muted" }], v: evidence },
				] } },
			],
		});
		if (!card || card.k !== "card") throw new Error("expected card");
		expect(noteText(card)).toStartWith("TypeSafe · adversary · concern\n\nAdversarial review");
		expect(noteText(card)).toContain(`evidence: ${evidence}`);
	});

	test("pipeline card decodes quoted paths and keeps markdown body", () => {
		const card = noteNode(parseNote('<pipeline-check spec="x.md&quot; injected=&quot;1" problems="2">\nSummary\n- &lt;example&gt;\n</pipeline-check>')!);
		expect(card).toEqual({ k: "card", p: { head: [{ t: "TypeSafe", s: "strong" }, { t: " · ", s: "muted" }, { t: "pipeline check", s: "muted" }], tone: "warning" }, c: [
			{ k: "md", p: { text: "Summary\n- &lt;example&gt;" } },
			{ k: "kv", p: { items: [{ k: [{ t: "spec", s: "muted" }], v: 'x.md" injected="1' }, { k: [{ t: "problems", s: "muted" }], v: "2" }] } },
		] });
	});

	test("rejects malformed or unknown notes", () => {
		for (const content of ["plain text", "<a>\nx", "<a>\nx\n</b>"]) expect(parseNote(content)).toBeNull();
		expect(noteNode(parseNote('<other x="1">\nx\n</other>')!)).toBeNull();
		expect(noteNode(parseNote('<constructor>\nx\n</constructor>')!)).toBeNull();
	});

	test("advisory and ambiguity notes use their own labels and scores", () => {
		const advisory = noteNode(parseNote('<advisory advisor="TypeSafe" severity="blocker" guidance="advice" theme="update_callers" related_update_needed="0.81" evidence="">\nConsider this.\n</advisory>')!);
		expect(advisory).toEqual({ k: "card", p: { head: [{ t: "TypeSafe", s: "strong" }, { t: " · ", s: "muted" }, { t: "advisory", s: "muted" }, { t: " · ", s: "muted" }, { t: "blocker", s: "error strong" }], tone: "error" }, c: [
			{ k: "md", p: { text: "Consider this." } },
			{ k: "kv", p: { items: [{ k: [{ t: "theme", s: "muted" }], v: "update_callers" }, { k: [{ t: "related update needed", s: "muted" }], v: "0.81" }] } },
		] });
		const gate = noteNode(parseNote('<ambiguity-gate score="0.46" threshold="0.20" weakest="constraints" gap="non_goals">\nAsk the user.\n</ambiguity-gate>')!);
		expect(gate).toEqual({ k: "card", p: { head: [{ t: "TypeSafe", s: "strong" }, { t: " · ", s: "muted" }, { t: "ambiguity gate", s: "muted" }], tone: "info" }, c: [
			{ k: "md", p: { text: "Ask the user." } },
			{ k: "kv", p: { items: [{ k: [{ t: "score", s: "muted" }], v: "0.46" }, { k: [{ t: "threshold", s: "muted" }], v: "0.20" }, { k: [{ t: "weakest", s: "muted" }], v: "constraints" }, { k: [{ t: "gap", s: "muted" }], v: "non_goals" }] } },
		] });
	});

	test("registers all types, falls back for unsupported content, and keeps node identity", () => {
		const renderers = new Map<string, HostMessageRenderer>();
		class Text {
			constructor(private text = "") {}
			render(_width: number): string[] { return [this.text]; }
		}
		const pi = { pi: { Text }, registerMessageRenderer: (type: string, renderer: HostMessageRenderer) => renderers.set(type, renderer) } as unknown as ExtensionAPI;
		registerNoteRenderers(pi);
		expect([...renderers.keys()]).toEqual([...NOTE_TYPES]);
		const renderer = renderers.get(NOTE_TYPES[0])!;
		const options = { expanded: false };
		expect(renderer({ content: [] }, options, null)).toBeUndefined();
		expect(renderer({ content: "plain" }, options, null)).toBeUndefined();
		expect(renderer({ content: "<other>\nx\n</other>" }, options, null)).toBeUndefined();
		const component = renderer({ content: '<adversarial-note severity="nit">\nCheck.\n</adversarial-note>' }, options, null)!;
		expect(component.describe()).toBe(component.describe());
		expect(component.render(80)).toEqual(["TypeSafe · adversary · nit\n\nCheck."]);
		registerNoteRenderers({} as ExtensionAPI);
	});
});
