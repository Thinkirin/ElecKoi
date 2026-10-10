import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply as applySettingLibraryTools } from "../apps/desktop/resources/dsh/setting-library-tools.mjs";
import { requiredSettingCache } from "../apps/desktop/resources/dsh/required-setting-cache.mjs";
import { settingLibraryEntrySchema } from "../packages/product-shared/src/contracts/settingLibrary/schemas.ts";

const directories = [];

afterEach(() => {
  delete process.env.ELECKOI_SESSION_SNAPSHOT_ROOT;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function tools({ extraEntries = [], history = [], variableState = {}, liveVariableState = false, configured = true, commit } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "eleckoi-setting-library-tools-"));
  directories.push(directory);
  const file = join(directory, "state.json");
  const variableFile = join(directory, "variables.json");
  if (liveVariableState) writeFileSync(variableFile, JSON.stringify({ enabled: true, state: variableState }));
  writeFileSync(file, JSON.stringify(configured ? {
    enabled: true,
    library: {
      characterId: 'synthetic-character',
      groups: [
        { id: "world", name: "世界", parentId: "", order: 1 },
        { id: "city", name: "城市", parentId: "world", order: 1 },
      ],
      entries: [
        entry({ id: "required", title: "总览", groupId: "world", content: "王都是晴天。", agentReadStrategy: "required" }),
        entry({ id: "city", title: "港口", groupId: "city", content: "港口终年多雾。", agentSelectionHint: "抵达港口时读取" }),
        entry({ id: "always", title: "自动注入", groupId: "", content: "不应出现在工具目录。", triggerMode: "always" }),
        entry({ id: "disabled", title: "已停用", groupId: "", content: "不可读取。", enabled: false }),
        ...extraEntries,
      ],
    },
    history,
    variableState,
  } : { enabled: false, library: null, frozenLibrary: null, history: [] }, null, 2));
  const sessionId = "setting-tool-test-session";
  const snapshotRoot = join(directory, "session-snapshots");
  mkdirSync(snapshotRoot);
  writeFileSync(join(snapshotRoot, `${sessionId}.json`), JSON.stringify({
    conversationId: 'synthetic-chat',
    settingLibraryBaseline: { source: JSON.parse(readFileSync(file, 'utf8')).library,
      projected: JSON.parse(readFileSync(file, 'utf8')).library },
    settingStateFile: file,
    settingLibraryEnabled: configured,
    ...(liveVariableState ? { variableStateFile: variableFile, variablesEnabled: true } : {}),
  }));
  process.env.ELECKOI_SESSION_SNAPSHOT_ROOT = snapshotRoot;
  const registered = [];
  const commitConversationRuntime = vi.fn(commit || (() => {}));
  const publish = vi.fn();
  applySettingLibraryTools({
    tools: { register: (definition) => { registered.push(definition); return () => undefined; } },
    eleckoiProductData: { commitConversationRuntime },
    eleckoiCharacterConfigurationChanges: { publish },
  });
  const execution = { agent: { session: { id: sessionId } } };
  return {
    file,
    variableFile,
    commitConversationRuntime,
    publish,
    byName: new Map(registered.map((definition) => [definition.name, {
      ...definition,
      execute: (args) => definition.execute(args, execution),
    }])),
  };
}

function entry(overrides) {
  return {
    id: "entry",
    title: "设定",
    iconId: "setting",
    kind: "normal",
    groupId: "",
    content: "",
    agentSelectionHint: "",
    agentReadStrategy: "normal",
    dynamicMode: "standard",
    contentMode: "plain_text",
    triggerMode: "agent_tool",
    enabled: true,
    order: 1,
    ...overrides,
  };
}

describe("DSH character setting-library tools", () => {
  it("keeps every enabled preset tool registered when the character has no setting library", async () => {
    const runtime = await tools({ configured: false });
    const calls = [
      ["eleckoi_glob_setting_files", {}, { status: "ok", files: [] }],
      ["eleckoi_grep_setting_files", { pattern: "世界" }, { status: "no_matches", matches: [] }],
      ["eleckoi_read_setting_files", { paths: ["世界"] }, { status: "ok", files: [] }],
      ["eleckoi_apply_setting_patch", { operation: "make_directory", path: "世界" }, { status: "ok", changed: false }],
    ];
    expect([...runtime.byName.keys()]).toHaveLength(4);
    for (const [name, args, expected] of calls) {
      await expect(runtime.byName.get(name).execute(args)).resolves.toMatchObject(expected);
    }
  });

  it("caches only readable fixed required bodies in directory order", () => {
    const cache = requiredSettingCache({ entries: [
      entry({ id: "regular", title: "正文", content: "正文内容", agentReadStrategy: "required", treeViewOrder: 2 }),
      entry({ id: "reference", title: "引用", content: "引用内容", agentReadStrategy: "required", dynamicMode: "ejs_reference" }),
      entry({ id: "timeline", title: "时间线", kind: "hidden_tool_timeline", content: "时间线内容", agentReadStrategy: "required", treeViewOrder: 1 }),
      entry({ id: "timeline", title: "重复", kind: "hidden_tool_timeline", content: "重复内容", agentReadStrategy: "required" }),
      entry({ id: "opening", title: "开场", kind: "opening", content: "开场内容", agentReadStrategy: "required" }),
    ] });
    expect(cache.map(({ id, reference }) => [id, reference])).toEqual([["timeline", "#S01"], ["regular", "#S02"]]);
  });

  it("exposes only enabled Agent-readable files and returns required-file metadata", async () => {
    const runtime = await tools();
    expect([...runtime.byName.keys()]).toEqual([
      "eleckoi_glob_setting_files",
      "eleckoi_grep_setting_files",
      "eleckoi_read_setting_files",
      "eleckoi_apply_setting_patch",
    ]);
    for (const name of ["eleckoi_glob_setting_files", "eleckoi_grep_setting_files"]) {
      const description = runtime.byName.get(name).description;
      expect(description).toContain("仅搜索不算读取");
      expect(description).toContain("即使固定必读项标记为 cached_reference");
      expect(description).toContain("把本轮尚未读取或已失效的 path 一次传入 paths");
    }

    const found = await runtime.byName.get("eleckoi_glob_setting_files").execute({});
    expect(found.files.map((file) => file.path)).toEqual(["世界/总览", "世界/城市/港口"]);
    expect(found.required_entries).toEqual([{
      path: "世界/总览",
      title: "总览",
      read_strategy: "required",
      selection_hint: "",
      content_delivery: "cached_reference",
      cached_reference: "#S01",
    }]);

    const scoped = await runtime.byName.get("eleckoi_glob_setting_files").execute({ path: "世界/城市", pattern: "**/不存在" });
    expect(scoped.files).toEqual([]);
    expect(scoped.required_entries).toEqual(found.required_entries);

    const searched = await runtime.byName.get("eleckoi_grep_setting_files").execute({
      pattern: "多雾",
      path: "世界/城市",
      output_mode: "content",
    });
    expect(searched.matches).toEqual([expect.objectContaining({ path: "世界/城市/港口", text: "港口终年多雾。" })]);

    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["世界/城市/港口"] });
    expect(read.files[0]).toMatchObject({
      path: "世界/城市/港口",
      selection_hint: "抵达港口时读取",
      content: "港口终年多雾。",
    });
    const required = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["世界/总览"] });
    expect(required.files[0]).toMatchObject({ cached_reference: "#S01", content_delivery: "cached_reference" });
    expect(required.files[0].content).toContain("#S01「总览」");
    expect(required.files[0].content).not.toContain("王都是晴天。");
  });

  it("keeps fixed required references stable across search and read while returning dynamic bodies", async () => {
    const runtime = await tools({ extraEntries: [
      entry({ id: "second-required", title: "城规", groupId: "city", content: "城门傍晚关闭。", agentReadStrategy: "required", treeViewOrder: 2 }),
      entry({ id: "dynamic", title: "本轮天气", content: "今日有雾。", agentReadStrategy: "keyword", keywords: ["天气"] }),
    ], history: [{ role: "user", content: "看看天气。" }] });
    const glob = await runtime.byName.get("eleckoi_glob_setting_files").execute({ pattern: "**" });
    const grep = await runtime.byName.get("eleckoi_grep_setting_files").execute({ pattern: "城门" });
    expect(glob.required_entries.map((item) => item.cached_reference)).toEqual(["#S01", "#S02", undefined]);
    expect(glob.required_entries.at(-1).content_delivery).toBe("tool_result");
    expect(grep.required_entries).toEqual(glob.required_entries);

    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["世界/总览", "世界/城市/城规", "本轮天气"] });
    expect(read.files.map((item) => item.content)).toEqual([
      expect.stringContaining("#S01「总览」"),
      expect.stringContaining("#S02「城规」"),
      "今日有雾。",
    ]);
    expect(read.files[0].content).not.toContain("王都是晴天。");
    expect(read.files[1].content).not.toContain("城门傍晚关闭。");
  });

  it("returns every matched setting and complete file content without artificial limits", async () => {
    const longContent = "长".repeat(130_001);
    const bulkEntries = Array.from({ length: 2_101 }, (_, index) => entry({
      id: `bulk-${index}`,
      title: `批量设定-${String(index).padStart(4, "0")}`,
      content: `无限搜索命中-${index}`,
      order: index + 10,
    }));
    const runtime = await tools({
      extraEntries: [
        ...bulkEntries,
        entry({ id: "long", title: "超长正文", content: longContent, order: 2_000 }),
      ],
    });

    const found = await runtime.byName.get("eleckoi_glob_setting_files").execute({ pattern: "**" });
    expect(found.files).toHaveLength(2_104);
    expect(found).not.toHaveProperty("truncated");
    expect(found).not.toHaveProperty("omitted");

    const searched = await runtime.byName.get("eleckoi_grep_setting_files").execute({ pattern: "无限搜索命中" });
    expect(searched.matches).toHaveLength(100);
    expect(searched.omitted).toBe(2_001);
    const widerSearch = await runtime.byName.get("eleckoi_grep_setting_files").execute({ pattern: "无限搜索命中", limit: 2_101 });
    expect(widerSearch.matches).toHaveLength(1_000);
    expect(widerSearch.omitted).toBe(1_101);

    const paths = bulkEntries.slice(0, 17).map((item) => item.title).concat("超长正文");
    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths });
    expect(read.files).toHaveLength(18);
    expect(read.files.at(-1).content).toBe(longContent);
    expect(read.files.at(-1)).not.toHaveProperty("truncated");
  });

  it("supports the structured patch operation set on the conversation snapshot", async () => {
    const runtime = await tools();
    const patch = runtime.byName.get("eleckoi_apply_setting_patch");

    await expect(patch.execute({ operation: "make_directory", path: "世界/支线" }))
      .resolves.toMatchObject({ status: "ok", operation: "make_directory" });
    await expect(patch.execute({ operation: "write_file", path: "世界/支线/天气", content: "小雨。" }))
      .resolves.toMatchObject({ status: "ok", created: true });
    await expect(patch.execute({ operation: "edit_file", path: "世界/支线/天气", old_string: "小雨", new_string: "暴雨" }))
      .resolves.toMatchObject({ status: "ok", replacements: 1 });
    await expect(patch.execute({ operation: "move_file", path: "世界/支线/天气", destination: "世界/支线/气候" }))
      .resolves.toMatchObject({ status: "ok", destination: "世界/支线/气候" });
    await expect(patch.execute({ operation: "move_directory", path: "世界/支线", destination: "资料/支线" }))
      .resolves.toMatchObject({ status: "ok", destination: "资料/支线" });

    const afterMove = JSON.parse(readFileSync(runtime.file, "utf8"));
    const movedEntry = afterMove.library.entries.find((item) => item.title === "气候");
    expect(movedEntry.content).toBe("暴雨。");

    await expect(patch.execute({ operation: "delete_file", path: "资料/支线/气候" }))
      .resolves.toMatchObject({ status: "ok", operation: "delete_file" });
    await expect(patch.execute({ operation: "delete_directory", path: "资料" }))
      .resolves.toMatchObject({ status: "ok", operation: "delete_directory" });

    const finalState = JSON.parse(readFileSync(runtime.file, "utf8"));
    expect(finalState.library.entries.some((item) => item.title === "气候")).toBe(false);
    expect(finalState.library.groups.some((group) => group.name === "资料")).toBe(false);
  });

  it('commits a complete new entry before returning success and exposes it to search and read', async () => {
    const runtime = await tools({ commit: (_chat, variables, raw, baseline) => {
      expect(variables).toBeUndefined();
      expect(baseline.source.characterId).toBe('synthetic-character');
      const created = JSON.parse(raw).entries.find(item => item.title === '偏好');
      expect(settingLibraryEntrySchema.parse(created).contentMode).toBe('plain_text');
    } });
    expect(runtime.commitConversationRuntime).not.toHaveBeenCalled();
    const result = await runtime.byName.get('eleckoi_apply_setting_patch').execute({
      operation: 'write_file', path: '偏好', content: '喜欢温热的茶。'
    });
    expect(result).toMatchObject({ status: 'ok', changed: true, created: true });
    expect(runtime.commitConversationRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.publish).toHaveBeenCalledWith({
      kind: 'configuration', domain: 'settingLibraries', characterId: 'synthetic-character'
    });
    const found = await runtime.byName.get('eleckoi_glob_setting_files').execute({});
    expect(found.files.some(file => file.path === '偏好')).toBe(true);
    const read = await runtime.byName.get('eleckoi_read_setting_files').execute({ paths: ['偏好'] });
    expect(read.files[0].content).toBe('喜欢温热的茶。');
  });

  it('rolls back rejected persistence without publishing a phantom branch', async () => {
    const runtime = await tools({ commit: () => { throw new Error('synthetic transaction failure'); } });
    const before = readFileSync(runtime.file, 'utf8');
    const result = await runtime.byName.get('eleckoi_apply_setting_patch').execute({
      operation: 'write_file', path: '偏好', content: '喜欢茶。'
    });
    expect(result).toMatchObject({ status: 'change_rejected', state_unchanged: true });
    expect(readFileSync(runtime.file, 'utf8')).toBe(before);
    expect(runtime.publish).not.toHaveBeenCalled();
    const found = await runtime.byName.get('eleckoi_glob_setting_files').execute({});
    expect(found.files.some(file => file.path === '偏好')).toBe(false);
  });

  it('does not persist reads, no-op writes, existing directories or invalid edits', async () => {
    const runtime = await tools();
    const patch = runtime.byName.get('eleckoi_apply_setting_patch');
    const before = readFileSync(runtime.file, 'utf8');
    await runtime.byName.get('eleckoi_glob_setting_files').execute({});
    await expect(patch.execute({ operation: 'write_file', path: '世界/城市/港口', content: '港口终年多雾。' }))
      .resolves.toMatchObject({ status: 'ok', changed: false });
    await expect(patch.execute({ operation: 'make_directory', path: '世界' }))
      .resolves.toMatchObject({ status: 'ok', changed: false });
    await expect(patch.execute({ operation: 'edit_file', path: '世界/城市/港口', old_string: '不存在', new_string: '替换' }))
      .resolves.toMatchObject({ status: 'change_rejected' });
    expect(runtime.commitConversationRuntime).not.toHaveBeenCalled();
    expect(runtime.publish).not.toHaveBeenCalled();
    // Search may resolve a cache, but no setting entry is changed.
    expect(JSON.parse(readFileSync(runtime.file, 'utf8')).library).toEqual(JSON.parse(before).library);
  });

  it("treats a hidden timeline configured for Agent reading as a readable setting", async () => {
    const runtime = await tools({
      extraEntries: [entry({
        id: "built-in-hidden-tool-timeline",
        title: "隐藏工具时间线",
        kind: "hidden_tool_timeline",
        content: "按需读取的时间线协议。",
      })],
    });

    const found = await runtime.byName.get("eleckoi_glob_setting_files").execute({ pattern: "**" });
    expect(found.files.map((file) => file.path)).toContain("隐藏工具时间线");
    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["隐藏工具时间线"] });
    expect(read.files[0].content).toBe("按需读取的时间线协议。");
  });

  it("filters keyword entries by recent messages and promotes direct and recursive matches to required", async () => {
    const runtime = await tools({
      history: [{ role: "user", content: "暴雨快来了。" }],
      extraEntries: [
        entry({
          id: "weather",
          title: "天气警报",
          content: "地下港口即将关闭。",
          agentReadStrategy: "keyword",
          keywords: ["暴雨"],
          keywordScanDepth: 1,
          keywordRecursionDepth: 1,
        }),
        entry({ id: "tunnel", title: "密道", content: "密道入口在钟楼。", agentReadStrategy: "keyword", keywords: ["地下港口"] }),
        entry({ id: "hidden-keyword", title: "晴天活动", content: "广场开放。", agentReadStrategy: "keyword", keywords: ["晴天"] }),
      ],
    });

    const found = await runtime.byName.get("eleckoi_glob_setting_files").execute({ pattern: "**" });
    expect(found.files.map((file) => file.path)).toEqual([
      "世界/总览",
      "世界/城市/港口",
      "天气警报",
      "密道",
    ]);
    expect(found.required_entries.map((file) => file.path)).toEqual(["世界/总览", "天气警报", "密道"]);
    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["天气警报", "密道"] });
    expect(read.files.map((file) => file.content)).toEqual(["地下港口即将关闭。", "密道入口在钟楼。"]);
  });

  it("keeps unmatched keywords hidden when the latest user turn does not match the prior assistant", async () => {
    const runtime = await tools({
      history: [
        { role: "user", content: "请介绍世界。" },
        { role: "assistant", content: "世界中有商店和属性。" },
        { role: "user", content: "我在哪里？" },
      ],
      extraEntries: [
        entry({ id: "shop", title: "商店", content: "商店设定。", agentReadStrategy: "keyword", keywords: ["世界", "商店"] }),
        entry({ id: "stats", title: "属性", content: "属性设定。", agentReadStrategy: "keyword", keywords: ["属性"] }),
      ],
    });
    const glob = await runtime.byName.get("eleckoi_glob_setting_files").execute({ pattern: "**" });
    const grep = await runtime.byName.get("eleckoi_grep_setting_files").execute({ pattern: "设定" });
    expect(glob.files.map((file) => file.path)).toEqual(["世界/总览", "世界/城市/港口"]);
    expect(glob.required_entries.map((file) => file.path)).toEqual(["世界/总览"]);
    expect(grep.matches.map((file) => file.path)).not.toContain("商店");
    expect(grep.required_entries.map((file) => file.path)).toEqual(["世界/总览"]);
    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["商店"] });
    expect(read.status).toBe("not_found");
  });

  it("renders EJS controllers as dynamic required files and resolves references", async () => {
    const runtime = await tools({
      history: [{ role: "user", content: "继续故事。" }],
      variableState: { 剧情: { 章节: 2 } },
      extraEntries: [
        entry({
          id: "chapter-reference",
          title: "章节素材",
          content: "第二章隐藏线索。",
          agentReadStrategy: "normal",
          dynamicMode: "ejs_reference",
        }),
        entry({
          id: "chapter-controller",
          title: "章节控制器",
          content: "<% if (getvar('剧情.章节') === 2) { %><%- await getwi(null, '章节素材') %>｜<%= Math.random() %><% } %>",
          agentReadStrategy: "normal",
          contentMode: "ejs",
        }),
      ],
    });

    const found = await runtime.byName.get("eleckoi_glob_setting_files").execute({ pattern: "**" });
    expect(found.files.map((file) => file.path)).toEqual([
      "世界/总览",
      "世界/城市/港口",
      "章节控制器",
    ]);
    expect(found.required_entries.map((file) => file.path)).toEqual(["世界/总览", "章节控制器"]);
    expect(found.required_entries[1].content_delivery).toBe("tool_result");

    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["章节控制器"] });
    expect(read.files[0].content).toMatch(/^第二章隐藏线索。｜0\./);
    expect(read.files[0].resolved_references).toEqual([{ title: "章节素材" }]);
    expect(JSON.stringify(read.files[0])).not.toContain("chapter-reference");
    const referenceRead = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["章节素材"] });
    expect(referenceRead.status).toBe("not_found");
    const reread = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["章节控制器"] });
    expect(reread.files[0].content).toBe(read.files[0].content);
  });

  it("exposes the latest user message to EJS setting controllers", async () => {
    const runtime = await tools({
      history: [
        { role: "user", content: "上一轮用户消息" },
        { role: "assistant", content: "上一轮助手回复" },
        { role: "user", content: "当前轮用户消息" },
      ],
      extraEntries: [entry({
        id: "message-controller",
        title: "消息控制器",
        content: "<%= lastUserMessage %>",
        contentMode: "ejs",
      })],
    });

    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["消息控制器"] });
    expect(read.files[0].content).toBe("当前轮用户消息");
  });

  it("maps the local-variable EJS helper to the current conversation state", async () => {
    const runtime = await tools({
      variableState: { 剧情: { 章节: 3 } },
      extraEntries: [entry({
        id: "local-variable-controller",
        title: "本地变量控制器",
        content: "<%= getLocalVar('剧情.章节') %>",
        contentMode: "ejs",
      })],
    });

    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["本地变量控制器"] });
    expect(read.files[0].content).toBe("3");
  });

  it("reads message-scoped EJS variables from the selected message snapshot", async () => {
    const runtime = await tools({
      variableState: { 剧情: { 章节: 9 } },
      history: [
        { id: "older", role: "assistant", content: "旧回复", variableState: { 剧情: { 章节: 2 } } },
        { id: "latest", role: "user", content: "当前输入", variableState: { 剧情: { 章节: 3 } } },
      ],
      extraEntries: [entry({
        id: "message-variable-controller",
        title: "消息变量控制器",
        content: "<%= getMessageVar('剧情.章节', { withMsg: { id: 'older' } }) %>",
        contentMode: "ejs",
      })],
    });

    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["消息变量控制器"] });
    expect(read.files[0].content).toBe("2");
  });

  it("isolates a failed EJS controller without blocking other required or keyword files", async () => {
    const runtime = await tools({
      history: [{ role: "user", content: "暴雨快来了。" }],
      extraEntries: [
        entry({
          id: "broken-controller",
          title: "坏掉的控制器",
          content: "<%= missingCompatibilityHelper() %>",
          contentMode: "ejs",
        }),
        entry({
          id: "matched-keyword",
          title: "暴雨设定",
          content: "暴雨设定正文。",
          agentReadStrategy: "keyword",
          keywords: ["暴雨"],
        }),
      ],
    });

    const found = await runtime.byName.get("eleckoi_glob_setting_files").execute({});
    expect(found.files.map((file) => file.path)).toContain("暴雨设定");
    expect(found.files.find((file) => file.path === "坏掉的控制器")).toMatchObject({
      content_delivery: "error",
      error: { code: "ejs_render_failed" },
    });

    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({
      paths: ["坏掉的控制器", "暴雨设定"],
    });
    expect(read.status).toBe("partial");
    expect(read.files.find((file) => file.path === "坏掉的控制器")).toMatchObject({
      content_delivery: "error",
      error: { code: "ejs_render_failed" },
    });
    expect(read.files.find((file) => file.path === "暴雨设定").content).toBe("暴雨设定正文。");
  });

  it("refreshes the required list when a variable changes during the same turn", async () => {
    const runtime = await tools({
      variableState: { 剧情: { 章节: 1 } },
      liveVariableState: true,
      extraEntries: [entry({
        id: "chapter-controller",
        title: "章节控制器",
        content: "<% if (getvar('剧情.章节') === 2) { %>第二章已开启。<% } %>",
        agentReadStrategy: "normal",
        contentMode: "ejs",
      })],
    });
    const glob = runtime.byName.get("eleckoi_glob_setting_files");
    const before = await glob.execute({});
    expect(before.required_entries.map((item) => item.path)).toEqual(["世界/总览"]);

    writeFileSync(runtime.variableFile, JSON.stringify({ enabled: true, state: { 剧情: { 章节: 2 } } }));
    const after = await glob.execute({});
    expect(after.required_entries.map((item) => item.path)).toEqual(["世界/总览", "章节控制器"]);
    const read = await runtime.byName.get("eleckoi_read_setting_files").execute({ paths: ["章节控制器"] });
    expect(read.files[0].content).toBe("第二章已开启。");
  });

  it("rejects invalid edits and unsafe paths without changing persisted state", async () => {
    const runtime = await tools();
    const patch = runtime.byName.get("eleckoi_apply_setting_patch");
    const before = readFileSync(runtime.file, "utf8");

    await expect(patch.execute({ operation: "edit_file", path: "世界/总览", old_string: "不存在", new_string: "改写" }))
      .resolves.toMatchObject({ status: "change_rejected", state_unchanged: true });
    await expect(patch.execute({ operation: "write_file", path: "../越界", content: "禁止" }))
      .resolves.toMatchObject({ status: "change_rejected", state_unchanged: true });
    await expect(patch.execute({ operation: "write_file", path: "世界/非法:名称", content: "禁止" }))
      .resolves.toMatchObject({ status: "change_rejected", state_unchanged: true });
    await expect(patch.execute({ operation: "edit_file", path: "世界/总览", old_string: "晴天", new_string: "晴天" }))
      .resolves.toMatchObject({ status: "change_rejected", state_unchanged: true });
    expect(readFileSync(runtime.file, "utf8")).toBe(before);
  });

  it("matches Android no-op and path-conflict semantics", async () => {
    const runtime = await tools();
    const patch = runtime.byName.get("eleckoi_apply_setting_patch");

    await expect(patch.execute({ operation: "make_directory", path: "世界/城市" }))
      .resolves.toMatchObject({ status: "ok", changed: false });
    await expect(patch.execute({ operation: "move_file", path: "世界/总览", destination: "世界/总览" }))
      .resolves.toMatchObject({ status: "ok", changed: false });
    await expect(patch.execute({ operation: "move_directory", path: "世界/城市", destination: "世界/城市" }))
      .resolves.toMatchObject({ status: "ok", changed: false });
    await expect(patch.execute({ operation: "write_file", path: "世界/城市", content: "禁止覆盖目录" }))
      .resolves.toMatchObject({ status: "change_rejected", state_unchanged: true });
    await expect(patch.execute({ operation: "move_file", path: "世界/总览", destination: "世界/城市" }))
      .resolves.toMatchObject({ status: "change_rejected", state_unchanged: true });
  });
});
