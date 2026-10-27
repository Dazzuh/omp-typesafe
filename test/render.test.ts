import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, HostMessageRenderer } from "../src/host";
import { NOTE_TYPES, noteNode, noteText, parseNote, registerNoteRenderers } from "../src/render";
import { escapeAttr } from "../src/text";

const field = (name: string, value: string) => ({ k: "text" as const, p: { spans: [{ t: `${name}: `, s: "muted" }, { t: value }], wrap: "word" as const } });

describe("note rendering", () => {
	test("adversary uses a tool frame with compact details and evidence", () => {
		const evidence = `3 uncommitted files; commands: bash: tern ctl a11y 2>&1 | grep -o '"role"'`;
		const content = `<adversarial-note severity="concern" defect="unclassified" guidance="weigh, don't blindly obey" weak_verification="0.81" unnecessary_complexity="0.59" confidence="0.31" evidence="${escapeAttr(evidence)}">\nReview this.\n</adversarial-note>`;
		const node = noteNode(parseNote(content)!);
		expect(node).toEqual({ k: "tool", p: { role: "omp.tool.typesafe", name: "typesafe", title: "TypeSafe · adversary", badges: [{ text: "concern", tone: "warning" }], status: "done", frame: "card" }, c: [
			{ k: "md", p: { text: "Review this." } },
			{ k: "rule", p: { label: "Details" } },
			field("defect", "unclassified"), field("weak verification", "0.81"), field("unnecessary complexity", "0.59"), field("confidence", "0.31"),
			{ k: "rule", p: { label: "Evidence" } }, field("evidence", evidence),
		] });
		if (!node || node.k !== "tool") throw new Error("expected tool");
		expect(noteText(node)).toStartWith("TypeSafe · adversary · concern\n\nReview this.");
		expect(noteText(node)).toContain(`evidence: ${evidence}`);
	});

	test("pipeline retains quoted paths and markdown", () => {
		const node = noteNode(parseNote('<pipeline-check spec="x.md&quot; injected=&quot;1" problems="2">\nSummary\n- &lt;example&gt;\n</pipeline-check>')!);
		if (!node || node.k !== "tool") throw new Error("expected tool");
		expect(node.p.title).toBe("TypeSafe · pipeline check");
		expect(node.c).toEqual([{ k: "md", p: { text: "Summary\n- &lt;example&gt;" } }, { k: "rule", p: { label: "Details" } }, field("spec", 'x.md" injected="1'), field("problems", "2")]);
	});

	test("advisory and ambiguity retain their fields", () => {
		const advisory = noteNode(parseNote('<advisory advisor="TypeSafe" severity="blocker" guidance="advice" theme="update_callers" related_update_needed="0.81" evidence="">\nConsider this.\n</advisory>')!);
		const gate = noteNode(parseNote('<ambiguity-gate score="0.46" threshold="0.20" weakest="constraints" gap="non_goals">\nAsk the user.\n</ambiguity-gate>')!);
		if (!advisory || advisory.k !== "tool" || !gate || gate.k !== "tool") throw new Error("expected tools");
		expect(advisory.p.badges).toContainEqual({ text: "blocker", tone: "error" });
		expect(advisory.c).toEqual([{ k: "md", p: { text: "Consider this." } }, { k: "rule", p: { label: "Details" } }, field("theme", "update_callers"), field("related update needed", "0.81")]);
		expect(gate.c).toEqual([{ k: "md", p: { text: "Ask the user." } }, { k: "rule", p: { label: "Details" } }, field("score", "0.46"), field("threshold", "0.20"), field("weakest", "constraints"), field("gap", "non_goals")]);
	});

	test("rejects malformed or unknown notes", () => {
		for (const content of ["plain text", "<a>\nx", "<a>\nx\n</b>"]) expect(parseNote(content)).toBeNull();
		expect(noteNode(parseNote('<other x="1">\nx\n</other>')!)).toBeNull();
		expect(noteNode(parseNote('<constructor>\nx\n</constructor>')!)).toBeNull();
	});

	test("registers all types and provides native and terminal fallbacks", () => {
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
		expect(component.describe({ supports: () => false }).k).toBe("card");
		expect(component.describe({ supports: () => true }).k).toBe("tool");
		expect(component.render(80)).toEqual(["TypeSafe · adversary · nit\n\nCheck."]);
		const gate = renderers.get(NOTE_TYPES[2])!({ content: '<ambiguity-gate score="0.46" gap="non_goals">\nAsk the user.\n</ambiguity-gate>' }, options, null)!;
		expect(gate.render(80)).toEqual(["TypeSafe · ambiguity gate\n\nAsk the user.\n\nscore: 0.46\n\ngap: non_goals"]);
		registerNoteRenderers({} as ExtensionAPI);
	});
});
