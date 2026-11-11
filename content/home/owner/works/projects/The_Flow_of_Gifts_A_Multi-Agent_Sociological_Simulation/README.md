# 礼物的流动 · Gift Flow Sim

> 基于阎云翔《礼物的流动》的**多智能体社会学仿真**：把"人情"写成可开关的机制，把"社会"变成可计量、可回放的实验装置。

`TypeScript` · `Node ≥ 20` · `React 18` · `PixiJS 7` · `DeepSeek / OpenAI 兼容接口`

仓库：[GoldenR1ver/AI-town](https://github.com/GoldenR1ver/AI-town) · 实验结果与组件详解见 [ExamResult.md](./ExamResult.md)

```text
事务触发 → 对话叙事 → RuleEngine 改关系 / 经济 / 礼物 → JSONL + 快照 → 像素步进回放
```

**主跑一句话**：100 Agents · 365 天 · DeepSeek · seed=42 → 互惠率 **0.90**、违约率 **0.022**、平均回礼延迟 **~17 slots**、礼物—声望相关 **0.51**、礼物—财富相关 **0.07**。

---

## 预览

**像素回放界面**：事件时间轴、村庄场景、关系网络与 BDIE 分析面板同屏，支持步进回放与角色聚焦。

![像素回放界面](ppt/pic1.png)

**演示配图**

![演示配图](ppt/pic2.png)

汇报幻灯片成品：[`ppt/gift_flow_report.pdf`](./ppt/gift_flow_report.pdf)

---

## 1. 项目在做什么

在一个 100 人的村庄里，每个 Agent 拥有职业、收入、BigFive 性格、BDIE 状态与主观记忆。公共事务、社交拜访与回礼窗口触发互动；LLM 只产出话语与意图提案，**世界状态只能经 RuleEngine 写入**。

要检验的是阎云翔的四条民族志模式与一个分层面貌：

| 假说         | 现象                 | 判据                                     |
| ---------- | ------------------ | -------------------------------------- |
| H1 声望吸引    | 礼物流向高声望节点，而非富人     | `gift_prestige_corr > 0` 且强于财富相关       |
| H2 互惠中态    | 多数还、少数欠、非即时对等      | reciprocity 0.7–0.95，default 0.02–0.20 |
| H3 纵向不对称   | 向上"进贡"不进一对一债窗      | 高地位者收礼多且不因礼崩面子                         |
| H4 延迟互惠    | 欠情—还情跨时段           | `avg_repay_delay` 显著 > 0               |
| H5 状态—行为一致 | 高压不请客、临窗优先还、讨厌驱动闲话 | 话语/决策与情绪、礼债同向                          |

与"纯聊天 Agent"的核心区别：**规则负责承诺与结算，LLM 负责表达**。因此每个现象都能通过关闭某个组件来反证，而不是靠调出一个好看的数字。

---

## 2. 总体框架

### 2.1 分层结构

九个组件按数据流分为五层：触发 → 表达 → 记忆 → 认知 → 结算，结构层与约束层作为结算层的输入。

```text
触发层   8 事件系统（公共事务 / 社交 / 回礼驱动）
           ↓
表达层   6 LLM 对话（只产出文本与意图，不写世界）
           ↓
记忆层   5 PET 个人事件表  →  4 认知树（主观关系记忆）
           ↓
认知层   3 BDIE  +  9 性格派生  →  行动优先级
           ↓
结算层   1 RuleEngine + 礼单账本（唯一写世界）
           ↑
        2 关系图 · 7 经济 / 日活力（作为约束输入结算层）
```

### 2.2 三条设计原则

1. **LLM 只产出文本与意图提案**，不直接写世界状态——避免"声称已改现金"这类不可结算的输出。
2. **所有状态变更经 `RuleEngine`**，写入 append-only 日志（含 `before / after / reason / formula`）。
3. **前端只读日志与快照**，JSONL 与 Snapshot 是唯一回放真理源，回放不推进仿真。

### 2.3 一次 tick 里发生什么

```text
时钟推进 → 事件生成 → 对话（可选） → PET/信念更新 → Goal→D/I
        → 目标执行（拒绝判定 / 送礼 / 回礼 / 捐款 / 出席）
        → RuleEngine 结算 → 写日志 → 周期快照
```

---

## 3. 九个组件（总览）

编号与 [ExamResult.md](./ExamResult.md)、结题报告、汇报 PPT 完全一致。此处只列定位与职责，**实现细节、参数与实验证据见 [ExamResult.md](./ExamResult.md)**。

| #   | 组件                    | 模拟人类的哪一块     | 核心职责                                    | 代码位置                                  |
| --- | --------------------- | ------------ | --------------------------------------- | ------------------------------------- |
| 1   | **RuleEngine + 礼单账本** | 人情规范与结算      | 唯一写世界闸门；礼单状态机与回礼窗口 W4–W10               | `backend/rules/`                      |
| 2   | **关系图**               | 社会结构与情感取向    | 有向边存信任/亲密/喜恶/礼债，标注纵向轴与亲缘基础              | `backend/systems/relationship/`       |
| 3   | **BDIE**              | 当下身心状态与行动优先级 | 信念 / 欲望 / 意图 + 情绪，把"手头紧、高压、欠情临窗"变成可计算驱动 | `backend/cognition/bdi.ts`            |
| 4   | **认知树**               | 主观记忆与关系叙事    | 四层认知结构，对话摘要累积晋升为"主观关系记忆"                | `backend/cognition/cognitive_tree.ts` |
| 5   | **PET 个人事件表**         | 近期显著事件记忆     | 每个 Agent 自己"记得什么"，同步为信念                 | `backend/systems/event/pet.ts`        |
| 6   | **LLM 对话系统**          | 自然语言表达与局部态度  | 多模式对话，受个人状态叙事约束，只产文本                    | `backend/systems/dialogue/`           |
| 7   | **经济系统 / 日活力**        | 生存约束与压力底噪    | 日生活成本、月薪结算、存款负债、礼期望检查                   | `backend/systems/economy/`            |
| 8   | **事件系统**              | 事务触发         | 公共事务 / 社交驱动 / 回礼驱动三类，决定"何时有事、谁和谁互动"     | `backend/systems/event/`              |
| 9   | **性格 / 人格派生**         | 个体异质性        | BigFive 派生内向、挑剔、记仇，驱动拒绝与闲话              | `backend/cognition/personality.ts`    |

**为什么九个都不能省**：关掉任一组件，对应的社会现象就会系统性变差——例如无认知树则地位差异下礼物单向流动增强，无限资金则礼期望膨胀、分层扭曲。完整反证见 [ExamResult.md §5 消融反证](./ExamResult.md)。

---

## 4. 主要工作流

以下四个流程覆盖了从"事件发生"到"结果可回放"的完整路径。命令与文件路径均可直接对照代码。

### 工作流 A · 一场婚礼：从事件到结算

```text
事件生成 → 角色绑定 → PET/信念 → Goal→D/I → 对话 → 送礼提案 → 裁剪 → RuleEngine 结算 → 日志/快照
```

| 步   | 发生什么                                                       | 关键代码                                   |
| --- | ---------------------------------------------------------- | -------------------------------------- |
| 1   | 事件系统按日程生成 `private.wedding`，绑定 `host / kin / guests`       | `event/generator.ts`                   |
| 2   | PET 向可见 Agent 传播事件，同步为 Belief                              | `event/pet.ts`                         |
| 3   | 目标模板生成 `attend` / `give_gift` 等 Goal，转成 Desire 与 Intention | `event/pipeline.ts`、`cognition/bdi.ts` |
| 4   | 主持人模式对话，话语受个人状态约束（不得声称改状态）                                 | `systems/dialogue/`                    |
| 5   | 送礼提案：目标由 `pairScore` 决定，金额被现金与场合下限裁剪                       | `gift/strategy.ts`                     |
| 6   | `RuleEngine` 一次性提交：转账、写礼单、改关系、加声望/面子                       | `rules/rule_engine.ts`                 |
| 7   | 写入 `gift.given` / `relationship.delta` 日志，slot 末落快照        | `log/`、`store/`                        |

**可观察结果**：6 笔随礼入账，主办声望从 70 升到约 83.8，礼单出现 `closed`（婚礼是主办收礼，不进一对一债窗）。

### 工作流 B · 一笔人情债的延迟偿还

```text
送礼 → pending_reply + 窗口 → 每 slot 尝试概率 → 临窗抬升 Intention → 回礼 → 或超窗违约
```

| 步   | 发生什么                                         | 关键代码                   |
| --- | -------------------------------------------- | ---------------------- |
| 1   | 横向礼物入账，状态 `pending_reply`，按类型与关系调制回礼窗口       | `gift/norms.ts`        |
| 2   | 每个 slot 由回礼驱动按概率尝试，窗口前 35% 几乎不动作             | `event/repay_drive.ts` |
| 3   | 债务逼近窗口时，被提升为高优先级 Intention（95–99）            | `cognition/bdi.ts`     |
| 4   | 尝试成功 → 生成回礼事件 → `repay_gift` 结算，记录回礼延迟       | `rules/rule_engine.ts` |
| 5   | 始终未还 → 窗检标记 `defaulted`，按 severity 扣信任、写公共记忆 | `rules/rule_engine.ts` |

**可观察结果**：回礼发生在送礼之后若干 slot，`avg_repay_delay` 显著大于 0；少数债务转为违约，形成"多数还、少数欠"的中态。

### 工作流 C · 声望吸引与分层的形成

```text
收礼 → 声望/面子上升 → 被选为送礼目标的概率上升 → 收更多礼（正反馈）
     ↑                                    ↓
   经济约束与批次折减（负反馈，防止赢者通吃）
```

| 步   | 发生什么                                          | 关键代码                               |
| --- | --------------------------------------------- | ---------------------------------- |
| 1   | 仪式场合收礼 → `prestige` 与 `face` 上升（按金额、表达性与批次折减） | `gift/flow_effects.ts`             |
| 2   | 下一轮目标选择时，声望拉力为线性、财富拉力为对数                      | `event/social_drive.ts`            |
| 3   | 经济约束限制单笔上限与回礼能力，抑制无上限膨胀                       | `gift/strategy.ts`                 |
| 4   | 365 天后统计声望/财富与收礼额的相关性                         | `engine/analyze_stratification.ts` |

**可观察结果**：声望—收礼相关 0.51，财富—收礼相关仅 0.07；声望 gini 0.16，Top10 占 27%——有分层但不极端。

### 工作流 D · 改代码 → 验证 → 回放（开发闭环）

```powershell
# 1) 改动规则或组件后，先跑类型检查
npm run typecheck

# 2) 重跑剧情 demo（16 人 10 幕），生成新 run
npm run sim:demo

# 3) 校验语义 steps 与 checkpoint 能由日志重建
$env:RUN_ID = "<新 runId>"
npm run verify:frontend

# 4) 导出回放数据并本地预览
npm run frontend:export
npm run frontend:dev        # http://127.0.0.1:5177/
```

**判定标准**：`typecheck` 与 `verify:frontend` 都通过，才说明日志、快照与前端回放三者一致。若只改前端样式，用 `frontend:dev` 热更新即可，无需重跑仿真。

---

## 5. 快速开始

**环境**：Node.js ≥ 20（建议 22 LTS）

```bash
git clone https://github.com/GoldenR1ver/AI-town.git
cd AI-town
npm install
```

### 只看回放（推荐）

```bash
npm run demo              # 跑 10 幕剧情 → 导出 → 构建前端
npm run frontend:serve    # 打开 http://127.0.0.1:5177/
```

16 人村庄 · 10 幕 · 约 5 天剧情，默认 mock 对话、可复现（seed=7）：

| 幕   | 事件           | 演示点                |
| --- | ------------ | ------------------ |
| 1   | 赵家婚礼         | 6 笔随礼，主办声望 70→83.8 |
| 2   | 邻里冲突调解       | 主持人模式对话            |
| 3   | 周强→钱大伟 工具性送礼 | 礼单出现 pending 债     |
| 4   | 道路养护         | 公共捐款 + 群聊          |
| 5   | 钱大伟回礼        | 延迟互惠（跨 2 slot）     |
| 6   | 郑浩→李建国 短窗礼   | 窗口 = 2 slot，为违约埋伏笔 |
| 7   | 卫生宣传 + 族亲礼   | 认知树加深，留下可回礼债       |
| 8   | 主办回礼         | 亲缘人情债下一 slot 偿还    |
| 9   | 窗检结算         | 违约落地，违约计数 +1       |
| 10  | 收束           | 指标与认知树快照           |

**回放操作**：`Space` / `→` 下一步 · `←` 上一步 · `Home` / `End` 首尾 · 点角色看 BDIE · 「开启聚焦」只看一人 · 「重播本幕」回到本幕开头。

### 切 live 对话

```powershell
$env:DEMO_LLM_MODE = "live"
npm run demo
```

现场演示建议**提前生成、离线回放**，不要临场调 API。

---

## 6. 常用命令

### 仿真

| 命令                                            | 用途                                             |
| --------------------------------------------- | ---------------------------------------------- |
| `npm run demo`                                | 剧情 demo → 导出 → 构建前端                            |
| `npm run sim:demo`                            | 只生成 demo run                                   |
| `npm run sim:empty`                           | 空跑时钟，验证 JSONL / 快照管线                           |
| `npm run sim:run -- --preset baseline_16_30d` | 16 人 × 30 天 mock                               |
| `npm run sim:run:tune30`                      | 100 人 × 30 天对齐短跑                               |
| `npm run sim:run:live100`                     | 100 人 × 365 天 live 主跑（`live100_365d_baseline`） |
| `npm run sim:run:final365`                    | 100 人 × 365 天复跑（`final_align_100_365d`）        |
| `npm run sim:contrast`                        | E1–E4 规则对照                                     |
| `npm run sim:ablation`                        | A0–A3 架构消融                                     |

### 前端

| 命令                        | 用途                                      |
| ------------------------- | --------------------------------------- |
| `npm run frontend:export` | 从 run 生成 `game/public/replay_data.json` |
| `npm run frontend:dev`    | Vite 热更新，`http://127.0.0.1:5177/`       |
| `npm run frontend:build`  | 构建到 `sim/frontend/dist/`                |
| `npm run frontend:serve`  | 服务 dist                                 |
| `npm run frontend:start`  | export + build + serve                  |

指定 run（PowerShell）：`$env:RUN_ID = "<runId>"; npm run frontend:export`

### 分析

| 命令                               | 用途             |
| -------------------------------- | -------------- |
| `npm run analyze:stratification` | 声望 / 财富分层与收礼相关 |
| `npm run analyze:discourse`      | 话语与状态对齐        |
| `npm run analyze:convergence`    | 指标收敛           |
| `npm run analyze:final365`       | 主跑汇总           |

### 验收

```bash
npm run typecheck
npm run verify:frontend   # 语义 steps + checkpoint 重建
npm run verify:p0         # 契约 / 空跑 / 模板库
npm run verify:p1         # 事务管线 + PET/BDI + 送礼
npm run verify:p2         # 对话多模式 / 摘要 / BDIE
npm run verify:p3         # 关系三通道 / 认知树
npm run verify:p4         # 经济礼物闭环 / 场合规范
npm run verify:p5         # 主时钟串联 / 批跑 / 指标
npm run verify:systems    # 九层核心系统汇总
```

---

## 7. LLM 配置

默认 **mock**，不消耗 API。live 需 OpenAI 兼容接口（已验证 DeepSeek）。**不要提交真实密钥。**

```powershell
$env:AGENTSOCIETY_LLM_API_BASE = "https://api.deepseek.com/v1"
$env:AGENTSOCIETY_LLM_API_KEY  = "你的 Key"
$env:AGENTSOCIETY_LLM_MODEL    = "deepseek-chat"
npm run llm:ping
```

| 场景      | 环境变量                                                                       |
| ------- | -------------------------------------------------------------------------- |
| 剧情 demo | `DEMO_LLM_MODE=live`                                                       |
| 标准批跑    | `P5_LLM_MODE=live`                                                         |
| 365 天实跑 | `--preset live100_365d_baseline`（主跑）或 `final_align_100_365d`（复跑），预设均为 live |

`API_BASE` 只写到 `/v1`。实现见 `sim/backend/llm/client.ts`。

---

## 8. 实验产物与像素回放

每次仿真落在 `sim/data/runs/<runId>/`：

| 文件                                   | 含义                         |
| ------------------------------------ | -------------------------- |
| `event_log.jsonl`                    | 追加式因果日志（真理源之一）             |
| `snapshots/D{n}-{AM\|PM\|EVE}.json`  | 每 slot 世界快照（真理源之二）         |
| `conversation_table.jsonl`           | 对话全文                       |
| `metrics.json`                       | 汇总指标                       |
| `config.json`                        | 当次配置（llmMode、variant、seed） |
| `DEMO_STORY.md` / `demo_report.json` | demo 的提词卡与剧本报告             |

`runs/*/` 默认不提交 git；共享时传整个 `<runId>` 文件夹。

**回放机制**：`steps[]` 语义步进 + slot checkpoint 校准，前端只读、不推进仿真。
**面板**：事件时间轴、对话气泡、关系网络、村民排序、BDIE Inspector、角色聚焦与轨迹图。
**素材**：复用 [AI-town](https://github.com/a16z-infra/ai-town) 像素地图与角色（许可见 `public/AI_TOWN_LICENSE.txt`）。

---

## 9. 仓库结构

```text
.
├── sim/
│   ├── backend/
│   │   ├── engine/       # 实验入口、调度、导出、分析、verify
│   │   ├── rules/        # RuleEngine（唯一状态变更闸门）
│   │   ├── systems/      # event / dialogue / gift / relationship / economy / person
│   │   ├── cognition/    # BDIE、认知树、性格派生、决策与拒绝
│   │   ├── store/        # WorldState、ReplayEngine、快照
│   │   └── llm/          # OpenAI 兼容客户端（mock / live）
│   ├── frontend/
│   │   ├── game/         # React + Vite + PixiJS 像素回放
│   │   └── serve.ts      # 静态服务器 → dist/
│   ├── shared/
│   │   ├── types/        # 数据契约
│   │   └── replay/       # 语义 steps、日志 reducer
│   └── data/
│       ├── agents.json / agents_100.json
│       ├── event_templates/       # 事务模板
│       ├── experiment_params/     # 实验预设
│       └── runs/                  # 实验产物（git 忽略）
├── reference/            # 规格、结题报告、方法总结
├── ppt/                  # 汇报材料（Beamer）
└── package.json
```

---

## 10. 局限与边界

1. **宏观—微观解离**：群体指标像民族志，不等于每个 Agent 的心理过程像人。
2. **人类数据对齐仍浅**：尚未做问卷边际 / 分布级 KS 对照。
3. **时序简化**：同步 slot ≠ 真实 burstiness。
4. **模型敏感性**：主结果基于单一 live 模型（DeepSeek）。
5. **伦理边界**：用于机制探索、假说筛选与教学演示，不替代田野因果识别。

---

## 11. 延伸阅读

| 文档                                                                                                           | 内容                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- |
| [**ExamResult.md**](./ExamResult.md)                                                                         | **实验结果、九个组件详解、机制解释与消融证据** |
| [`reference/Gift_Flow_Simulation_Final_Report.md`](./reference/Gift_Flow_Simulation_Final_Report.md)         | 结题报告全文                    |
| [`reference/Gift_Flow_Simulation_Outline.md`](./reference/Gift_Flow_Simulation_Outline.md)                   | 汇报大纲与讲稿建议                 |
| [`reference/Multi_Agent_Social_Simulation_Methods.md`](./reference/Multi_Agent_Social_Simulation_Methods.md) | 方法总结：效度 / 机制 / 可证伪 / 伦理   |
| [`reference/rule-of-return-gift.md`](./reference/rule-of-return-gift.md)                                     | 回礼规则 W4–W10               |
| [`reference/yan-yunxiang-gift-flow-reproduction.md`](./reference/yan-yunxiang-gift-flow-reproduction.md)     | 与阎云翔文本的逐条对应与取舍            |
| [`ppt/gift_flow_report.tex`](./ppt/gift_flow_report.tex)                                                     | 汇报幻灯源码                    |

---

## 12. 常见问题

**Q: clone 后打开回放是空的？**
先 `npm run demo`，或指定 `RUN_ID` 后执行 `frontend:export`，再 `frontend:serve`。

**Q: `frontend:export` 用了错误的 run？**
设置 `$env:RUN_ID="<runId>"`，或查看 `sim/data/runs/LATEST_DEMO_RUN.txt`。

**Q: 改前端样式不生效？**
开发用 `frontend:dev`；预览构建结果用 `frontend:build` + `frontend:serve`。

**Q: typecheck 过了但前端报错？**
另跑 `npx tsc -p sim/frontend/game/tsconfig.json --noEmit`。

**Q: demo 里违约数为 0？**
检查 Act 6 的送礼双方是否为横向关系。向上送礼（如声望差 ≥18）按 H3 直接 `closed`，不会违约。
