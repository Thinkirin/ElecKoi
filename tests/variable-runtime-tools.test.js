import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apply as applyVariableTools } from "../apps/desktop/resources/dsh/variable-tools.mjs";

const directories = [];

afterEach(() => {
  delete process.env.ELECKOI_SESSION_SNAPSHOT_ROOT;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function tools({ extraCount = 0, mapMarkerCount = 0, configured = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "eleckoi-variable-tools-"));
  directories.push(directory);
  const file = join(directory, "state.json");
  const extraNames = Array.from({ length: extraCount }, (_, index) => `指标${index}`);
  const mapMarkers = Object.fromEntries(Array.from({ length: mapMarkerCount }, (_, index) => [
    `marker-${index}`,
    { title: `地点 ${index}`, description: `地点说明 ${index} `.repeat(900), image: `https://example.invalid/${index}.webp` },
  ]));
  writeFileSync(file, JSON.stringify(configured ? {
    enabled: true,
    config: {
      initialState: {
        状态: { 好感度: 0, 称呼: "陌生人", ...Object.fromEntries(extraNames.map((name) => [name, 0])) },
        ...(mapMarkerCount ? { 地图标记: mapMarkers } : {}),
      },
      schemaCode: "const Schema = z.object({ 状态: z.object({ 好感度: z.number().max(100), 称呼: z.string() }) })",
      objects: [
        { id: "status", name: "状态", parentId: "", enabled: true, description: "角色状态", updateRule: "仅在剧情明确变化时更新", dynamicKey: false },
      ],
      variables: [
        { id: "affinity", title: "好感度", objectId: "status", enabled: true, type: "number", defaultValue: "0", description: "当前好感", updateRule: "按互动结果小幅增减", readMode: "required" },
        { id: "address", title: "称呼", objectId: "status", enabled: true, type: "string", defaultValue: "陌生人", description: "当前称呼", updateRule: "关系变化后更新", readMode: "on_demand" },
        ...extraNames.map((name, index) => ({ id: `extra-${index}`, title: name, objectId: "status", enabled: true, type: "number", defaultValue: "0", description: "测试指标", updateRule: "按规则更新", readMode: "on_demand" })),
        ...(mapMarkerCount ? [{ id: "map-markers", title: "地图标记", objectId: "", enabled: true, type: "object", defaultValue: "{}", description: "地图资料", updateRule: "按剧情更新", readMode: "on_demand" }] : []),
      ],
    },
    state: {
      状态: { 好感度: 10, 称呼: "朋友" },
      ...(mapMarkerCount ? { 地图标记: mapMarkers } : {}),
    },
  } : { enabled: false, config: null, state: {} }, null, 2));
  const sessionId = "variable-tool-test-session";
  const snapshotRoot = join(directory, "session-snapshots");
  mkdirSync(snapshotRoot);
  writeFileSync(join(snapshotRoot, `${sessionId}.json`), JSON.stringify({
    variableStateFile: file,
    variablesEnabled: configured,
  }));
  process.env.ELECKOI_SESSION_SNAPSHOT_ROOT = snapshotRoot;
  const registered = [];
  applyVariableTools({ tools: { register: (definition) => { registered.push(definition); return () => undefined; } } });
  const execution = { agent: { session: { id: sessionId } } };
  return {
    file,
    byName: new Map(registered.map((definition) => [definition.name, {
      ...definition,
      execute: (args) => definition.execute(args, execution),
    }])),
  };
}

describe("DSH character variable tools", () => {
  it("keeps every enabled preset tool registered when the character has no variable configuration", async () => {
    const runtime = await tools({ configured: false });
    const calls = [
      ["eleckoi_glob_variables", {}, { status: "ok", paths: [] }],
      ["eleckoi_grep_variables", { pattern: "状态" }, { status: "no_matches", matches: [] }],
      ["eleckoi_read_variables", { paths: ["/状态"] }, { status: "ok", variables: [] }],
      ["eleckoi_apply_variable_patch", { operations: [{ op: "replace", path: "/状态", value: {} }] }, { status: "ok", applied_operations: 0 }],
    ];
    expect([...runtime.byName.keys()]).toHaveLength(4);
    for (const [name, args, expected] of calls) {
      await expect(runtime.byName.get(name).execute(args)).resolves.toMatchObject(expected);
    }
  });

  it("discovers required variables and reads complete author metadata", async () => {
    const runtime = await tools();
    const found = await runtime.byName.get("eleckoi_glob_variables").execute({ pattern: "**" });
    expect(found.paths).toContain("/状态/好感度");
    expect(found.required_variables).toEqual([{ path: "/状态/好感度", read_mode: "required", title: "好感度" }]);
    const read = await runtime.byName.get("eleckoi_read_variables").execute({ paths: ["/状态/好感度"] });
    expect(read.variables[0]).toMatchObject({ default: 0, current: 10, current_present: true, update_rule: "按互动结果小幅增减" });

    const grep = await runtime.byName.get("eleckoi_grep_variables").execute({
      pattern: "description:[\\s\\S]*update_rule",
      multiline: true,
      output_mode: "count",
    });
    expect(grep).toMatchObject({ status: "ok", output_mode: "count" });
    expect(grep.matches.length).toBeGreaterThan(0);
  });

  it("lists every variable with the default Glob and reads more than 16 paths together", async () => {
    const runtime = await tools({ extraCount: 120 });
    const glob = runtime.byName.get("eleckoi_glob_variables");
    const found = await glob.execute({});
    expect(found.paths).toHaveLength(123);
    expect(found.required_variables.map((item) => item.path)).toEqual(["/状态/好感度"]);

    const scoped = await glob.execute({ path: "/状态", pattern: "**/不存在" });
    expect(scoped.paths).toEqual([]);
    expect(scoped.required_variables.map((item) => item.path)).toEqual(["/状态/好感度"]);

    const read = await runtime.byName.get("eleckoi_read_variables").execute({ paths: found.paths.slice(0, 20) });
    expect(read.variables).toHaveLength(20);
    expect(read.variables.map((item) => item.path)).toEqual(found.paths.slice(0, 20));
  });

  it("pages large object values and exposes exact child paths without logging the full state", async () => {
    const runtime = await tools({ mapMarkerCount: 60 });
    const readTool = runtime.byName.get("eleckoi_read_variables");
    const first = await readTool.execute({ paths: ["/地图标记"], limit: 10 });

    expect(first.variables[0].current).toMatchObject({
      kind: "object_page", total: 60, offset: 0, limit: 10, returned: 10, has_more: true, next_offset: 10,
    });
    expect(JSON.stringify(first).length).toBeLessThan(30_000);
    const child = first.variables[0].current.entries[0];
    expect(child).toMatchObject({ path: "/地图标记/marker-0", value_omitted: true });

    const detail = await readTool.execute({ paths: [child.path], limit: 2 });
    expect(detail.variables[0]).toMatchObject({ configured_path: "/地图标记" });
    expect(detail.variables[0].current).toMatchObject({ kind: "object_page", total: 3, returned: 2, has_more: true });
    expect(JSON.stringify(detail).length).toBeLessThan(20_000);

    const description = await readTool.execute({ paths: [`${child.path}/description`], char_limit: 500 });
    expect(description.variables[0].current).toMatchObject({ kind: "text_page", char_offset: 0, char_limit: 500, returned_chars: 500, has_more: true });
    expect(description.variables[0].current.text).toHaveLength(500);
  });

  it("commits valid patches to the bridge and rejects Zod-invalid changes atomically", async () => {
    const runtime = await tools();
    const patch = runtime.byName.get("eleckoi_apply_variable_patch");
    const accepted = await patch.execute({ operations: [{ op: "delta", path: "/状态/好感度", value: 5 }] });
    expect(accepted).toMatchObject({ status: "ok", applied_operations: 1 });
    expect(JSON.parse(readFileSync(runtime.file, "utf8")).state.状态.好感度).toBe(15);

    const rejected = await patch.execute({ operations: [{ op: "replace", path: "/状态/好感度", value: 101 }] });
    expect(rejected).toMatchObject({ status: "validation_error", state_unchanged: true });
    expect(JSON.parse(readFileSync(runtime.file, "utf8")).state.状态.好感度).toBe(15);

    const stripped = await patch.execute({ operations: [{
      op: "replace",
      path: "/状态",
      value: { 好感度: 20, 称呼: "朋友", 未声明字段: true },
    }] });
    expect(stripped).toMatchObject({ status: "normalization_conflict", state_unchanged: true });
    expect(stripped.paths).toContain("/状态/未声明字段");
    expect(JSON.parse(readFileSync(runtime.file, "utf8")).state.状态).toEqual({ 好感度: 15, 称呼: "朋友" });
  });
});
