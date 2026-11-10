// model-schema.ts 单元测试
import {
    upgradeChannelModel,
    validateParamsAgainstSchema,
    migrateLegacyParams,
    type ParameterSchema,
} from "../model-schema";

console.log("=== Model Schema 单元测试 ===\n");

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (e) { console.log(`  ❌ ${name}: ${(e as Error).message}`); failed++; }
}
function assert(c: boolean, m?: string) { if (!c) throw new Error(m || "断言失败"); }

// 测试 1：旧模型没有 Schema → 返回 null
test("旧模型无 Schema → 返回 null，走旧面板", () => {
    const def = upgradeChannelModel("default", { name: "gpt-3.5-turbo", capability: "text" });
    assert(def === null, "应该返回 null");
});

// 测试 2：豆包 Seedance 2.5 有 Schema
test("豆包 Seedance 2.5 → 返回完整 ModelDefinition", () => {
    const def = upgradeChannelModel("builtin-doubao", { name: "Seedance 2.5", capability: "video" });
    assert(def !== null, "应该有定义");
    assert(def!.modelId === "builtin-doubao::Seedance 2.5", "modelId 正确");
    assert(def!.parameterSchema!.length >= 2, "应该有至少 2 个参数");
    assert(def!.supportedFeatures?.referenceImage === true, "支持参考图");
});

// 测试 3：OpenAI gpt-image-1 有 Schema
test("OpenAI gpt-image-1 → 返回完整 ModelDefinition", () => {
    const def = upgradeChannelModel("my-openai", { name: "gpt-image-1", capability: "image" });
    assert(def !== null, "应该有定义");
    assert(def!.defaults?.size === "1024x1024", "默认尺寸正确");
});

// 测试 4：参数校验 — 超出范围
test("参数校验：超出范围自动截断", () => {
    const schema: ParameterSchema[] = [
        { key: "duration", type: "slider", label: "时长", min: 3, max: 15, defaultValue: 5 },
    ];
    const result = validateParamsAgainstSchema({ duration: 30 }, schema);
    assert(result.duration === 15, "应该截断到最大值 15");
});

// 测试 5：参数校验 — select 不合法
test("参数校验：select 选项不合法 → 用默认值", () => {
    const schema: ParameterSchema[] = [
        {
            key: "ratio", type: "select", label: "比例", defaultValue: "16:9",
            options: [{ value: "16:9", label: "横屏" }],
        },
    ];
    const result = validateParamsAgainstSchema({ ratio: "21:9" }, schema);
    assert(result.ratio === "16:9", "应该用默认值 16:9");
});

// 测试 6：参数校验 — 没值时用默认值
test("参数校验：没传值 → 用默认值", () => {
    const schema: ParameterSchema[] = [
        { key: "ratio", type: "select", label: "比例", defaultValue: "9:16" },
    ];
    const result = validateParamsAgainstSchema({}, schema);
    assert(result.ratio === "9:16", "应该用默认值");
});

// 测试 7：旧参数迁移
test("旧参数迁移：ratio/duration/videoSeconds", () => {
    const legacy = { ratio: "16:9", videoSeconds: 10, videoMode: "text-to-video" };
    const params = migrateLegacyParams(legacy);
    assert(params.ratio === "16:9", "ratio 迁移正确");
    assert(params.duration === 10, "duration 从 videoSeconds 迁移");
    assert(params.mode === "text-to-video", "mode 迁移正确");
});

// 测试 8：豆包 Seedream 图片模型
test("豆包 Seedream 5.0 → 图片模型 Schema", () => {
    const def = upgradeChannelModel("builtin-doubao", { name: "Seedream 5.0", capability: "image" });
    assert(def !== null, "应该有定义");
    assert(def!.defaults?.ratio === "1:1", "默认比例正确");
});

// 总结
console.log(`\n=== 总结 ===`);
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
