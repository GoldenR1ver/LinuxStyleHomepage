# DoJot 麻将 AI：策略逻辑概览与优化方向

本文档面向 **DoJot**（以 `DoJot_1.7.1.user.js` 为代表）这套路径：以 **启发式 + 可调权重** 为核心的雀魂脚本 AI，说明其决策管线、关键模块与你在实战中遇到的退化现象之间的对应关系，并给出可落地的优化方向。

---

## 1. 总体架构

### 1.1 配置层

- 顶层对象 **`DoJot_1_0_0_PARAMS`**（脚本内注释称与 `Parameter/recommendedBlendTileEff.importable.json` 等对齐）集中存放：
  - **攻守平衡**：`HAND_EVALUATION`（`EFFICIENCY` / `SAFETY` / `SAKIGIRI`）
  - **副露与杠**：`CALL`、`PUSH_FOLD`、`FOLD_THRESHOLD`、`DISCARD_FOLD`
  - **立直**：`RIICHI_DECISION`、`STRATEGY.RIICHI`
  - **切牌优先级**：`TILE_PRIORITY`、`DISCARD_TILE`、`TILE_HOLDING`
  - **防守**：`ADVANCED_DEFENSE`、`HELPER_STYLE_DEFENSE`（与 mahjong-helper 风格铳率表对接）

仓库内另有 **贝叶斯优化器**（`Optimizer/BayesianOptimizer.py`）可对参数做离线搜索；新增逻辑若未纳入目标函数或与环境脱节，容易出现「越改越差」。

### 1.2 策略状态机

脚本维护全局 **`strategy`**，主要包括：

| 取值 | 含义 |
|------|------|
| `GENERAL` | 通常面子手（默认） |
| `CHIITOITSU` | 七对子路线 |
| `THIRTEEN_ORPHANS` | 国士路线 |
| `FOLD` | 全局弃和（可由 `shouldFold` 在极端情况下激活） |

`determineStrategy()` 按手牌形状在七对 / 国士 / 通用之间切换；**点棒处于末位（或并列末位）时，若当前为 `FOLD` 会强制回到 `GENERAL`**，以避免末位「一直弃和」——这与「四位也要防守」等不同场景会产生张力，见下文 **§4**。

---

## 2. 进攻：牌效与估值核心

### 2.1 候选生成与排序

- **`getTilePriorities`**：对每个切牌候选调用 **`getHandValues`**，得到一组 `{ priority, shanten, efficiency, score, danger, … }`。
- **`getHandValues`**（注释说明）：在性能约束下近似 **未来两巡** 的改良空间（组合枚举 + 合并重复路径），产出期望 **向听、役、宝牌、听牌形、符** 等。
- 排序默认按 **`priority` 降序**；若开启 **`TILE_HOLDING`**，在向听相同且优先级差距不大时，用 **保留牌（retention）** 作为次要排序，偏向留住待ち质量更高的牌。

### 2.2 优先级公式（`calculateTilePriorityWithBreakdown`）

核心思想：**牌效（加权效率） × 扣分后的期望打点**。

- **效率项**：对 `efficiency` 取 `abs` 后再做 **`WEIGHTED_EFFICIENCY_EXPONENT_BASE + EFFICIENCY * placementFactor`** 次幂；效率为负（退向听）时有 **`NEGATIVE_EFFICIENCY_HOTFIX_BASE_SCORE`** 的大数修正，避免乘积符号混乱。
- **打点项**：门清用 `expectedScore.closed`，副露用 `open`。
- **危险项**：`dangerForPriority = danger - sakigiri`，再乘以 **`DANGER_PENALTY_MULTIPLIER * SAFETY`**。
- **顺位因子**：仅在 **All Last 且自家为一位**（`getDistanceToFirst() < 0`）时，`placementFactor = FIRST_PLACE_LAST_GAME_FACTOR`，放大指数使攻击倾向变化。

### 2.3 小结

进攻侧本质是 **「两巡近似期望 + 非线性加权 + 危险扣分」**。牌效下滑的常见来源包括：新增规则改变 `efficiency/score` 分布、`TILE_HOLDING` 与主目标冲突、或参数与 **`EFFICIENCY`/`SAFETY` 耦合** 失衡。

---

## 3. 防守：危险度、弃和阈值与混合弃和

### 3.1 单张危险度（`getTileDanger`）

- 按对手循环 **`getDealInChanceForTileAndPlayer`**，再汇总；自家视角下会乘以 **`getExpectedDealInValue`**（对手听牌概率 × 期望打点）。
- 启用了 **`HELPER_STYLE_DEFENSE`** 时，数牌侧可主要使用 **mahjong-helper 风险表**（`MahjongHelperRisk.calculateRiskTiles34`），并与旧版启发式 **`BLEND_LEGACY_BASE`** 混合。
- **`getTileDanger`** 末尾还会根据 **`getCurrentDangerLevel()`**、巡目等做缩放/加成（低危险全场时压低 danger、巡目 bracket 修正等）。

### 3.2 全场危险度（`getCurrentDangerLevel`）

定义为多家 **`getExpectedDealInValue`** 的加权组合，并突出 **最危险的一家**。用于：

- 立直判断中与手牌价值比较；
- `getFoldThreshold` / `shouldFold` 分支（例如极高危险时返回 0 阈值）；
- 多处魔法数字判定（如 Kan、保留安牌逻辑中的阈值）。

### 3.3 弃和判定（`shouldFold` → `getFoldThreshold`）

- **`getFoldThreshold`**：综合听牌/一向听时的形状、打点、剩余墙、All Last 顺位、`SAFETY`、手中「相对安牌」数量等，得到 **危险度阈值**。
- **`shouldFold`**：
  - **末位 (`isOwnSeatLastPlace`) 直接不弃和**；
  - **All Last 且一位** 也不弃和；
  - **`shanten * 4 > tilesLeft`** 时进入 **全局 `FOLD` 策略** 并禁止副露；
  - 否则若 **`tile.danger > foldThreshold`** 则该候选标记为 **不安全**。

### 3.4 切牌管线（`discard` → `sortOutUnsafeTiles` → `getDiscardTile` / `discardFold`）

1. **`sortOutUnsafeTiles`**：对每个候选调用 `shouldFold`，设置 **`tile.safe`**（仅标注，不改变排序）。
2. 若 **非末位** 且 **`strategy === FOLD` 或没有任何 safe 候选**，则进入 **`discardFold`**：
   - **非全局 FOLD**：先试 **混合弃和**——在 **最小向听** 前提下选危险度不超过倍数阈值的牌；
   - 否则看 **priority 前三** 是否有 **极低危险** 的逃逸切；
   - 最后 **按危险度升序全弃**。

### 3.5 小结

防守「失效」往往不是没有算危险度，而是：

- **阈值链**（`PUSH_FOLD`、`FOLD_THRESHOLD`、`DISCARD_FOLD`、`DANGER_CRITICAL`）与 **helper 风险标度 `RISK_SCALE`** 不匹配；
- **`getExpectedDealInValue` / `isPlayerTenpai` 等估计偏差** 导致 `getCurrentDangerLevel` 失真；
- **末位强制不走 `discardFold`** 与 **分数落后仍过度兜牌** 可能同时存在——取决于当时是否被判定为「点棒末位」以及是否触发全局 FOLD。

---

## 4. 立直决策（`shouldRiichi`）

流程要点：

- 用 **`BAD_WAIT_BASE`** 等区分「愚形」；七对子用 **`BAD_WAIT_BASE_CHIITOITSU`**。
- **终盘巡目**、**无听**、**默听改良（damaten）** 等分支会压低立直概率。
- **All Last** 下：大领先或高打点 enough yaku 会 **不立**；末位且「立直棒价值能拉近顺位」时提高接受度。
- **他家已立直** 时 **`finalizeRiichiProbability(0.6)`**，显著提高立直倾向——若当前待ち差/打点估计不准，容易表现为 **立直后铳率偏高**。
- 默认 **`finalizeRiichiProbability(0.2)`**：整体是 **概率立直**，不是确定性最优。

---

## 5. 顺位与「场况」在你代码中的现状

当前与 **顺位 / 得分表** 强相关的逻辑主要集中在：

- **All Last**：`FIRST_PLACE_LAST_GAME_FACTOR`、`getFoldThreshold` 中的前后差、`shouldRiichi` 末位/一位分支。
- **点棒末位**：`isOwnSeatLastPlace()` 放弃弃和主线。

尚 **未充分建模** 的典型场况包括：

- **东风 / 南入 / 本场数 / 供托** 对风险和进攻的定量影响；
- **2 位 vs 3 位 vs 4 位**（非 All Last）的动态攻防切换；
- **与 Top 的点差阶梯**（例如「满贯不够逆转」→ 冒险进攻 vs 「点到也不掉顺位」→ 收紧）。

这也是你感受到 **「对整个对局的场况没有了解」「没有基于当前顺位调整策略」** 的根因：**框架里顺位因子介入点偏少**，且多在 All Last。

---

## 6. 现象与代码层面的对应（便于对症下药）

| 现象 | 可能的主要机制 |
|------|----------------|
| 牌效下滑 | `TILE_HOLDING` / retention 惩罚与 `priority` 主目标冲突；或 `EFFICIENCY`/`WEIGHTED_EFFICIENCY_EXPONENT_BASE` 与新逻辑叠加导致排序扭曲 |
| 防守失效 | helper 与 legacy 混合比例、`RISK_SCALE`、`DANGER_FLOOR`、fold 阈值链互不匹配；对手听牌/打点估计误差 |
| 立直后铳率高 | 概率立直 + 他家已立 **0.6** _boost_；待ち质量/打点未与立直绑定优化（`riichiPriority` 仍用近似公式） |
| 落后仍在兜牌 | **非末位** 时仍可走 `discardFold`；或 **safe 为空** 强制弃和通道；与「该攻」的目标冲突 |
| 末位仍进四位 | **末位禁用弃和** 设计本意是 forcing 进攻，但若估值认为手牌无望，会在 **进攻与乱打** 之间摇摆；需独立的 **四位生存/逆转 EV** |

---

## 7. 推荐优化方向（按性价比排序）

### 7.1 架构与调试

1. **决策日志结构化**：你已有多处 `log`；建议对每一打输出固定字段：`strategy`、`foldThreshold`、`chosen.danger`、`getCurrentDangerLevel()`、是否走了 `discardFold` 分支。便于回归对比。
2. **分离「模型」与「策略」**：把「危险度」「期望打点」定为中间量，上层只做一个清晰目标函数（例如最小化期望顺位损失），减少 if-else 堆叠导致的相互抵消。
3. **参数分区调优**：新增一组参数后，用现有 Optimizer **固定其它块** 只调新块，避免维度爆炸。

### 7.2 攻守与标度

4. **统一危险度标度**：检查 `getTileDanger` → `foldThreshold` → `DANGER_CRITICAL` 是否在同一量级；/helper 模式下重点扫 **`RISK_SCALE`、`ISDANGER_CRITICAL`、`SAFE_RISK_THRESHOLD`**。
5. **重构 `shouldFold` 末位特例**：末位未必永远「不弃」；更合理的是 **极大降低 fold 阈值** 或改用 **期望顺位 EV** 决定是否值得全弃。
6. **审慎调整「他家立直 → 立直概率 0.6」**：可改为与 **`badWait`、打点、`getCurrentDangerLevel()`** 联动，避免愚形强立对日。

### 7.3 顺位与场况（扩展切口）

7. **非 All Last 引入轻度顺位因子**：例如在 `placementFactor` 或单独加减项中引入 `getDistanceToFirst()` / `getDistanceToLast()` 的分段函数（不必连续处处可微）。
8. **桌况摘要特征**：各家副露色系、筋毒读、剩余巡数，压缩成少量 **scenario id**（例如「两家立直 + 自家一向听」），对不同 scenario 独立调一组权重。

### 7.4 立直与听牌

9. **立直宣言牌选择**：当前 `callRiichi` 与 `riichiPriority` 排序绑定；可对 **宣言后的听牌强度** 单独打分（避免为了priority切导致听愚形）。
10. **Damaten / 改良**：已有 damaten 分支；可与 **`tenpaiWaitTilesRemaining`**、`WAIT_QUALITY` 更紧耦合。

### 7.5 长期方向

11. **仿真或分布式自对弈**：启发式天花板明显时，用日志 + 离线回放估计各改动的 **期望顺位**，再写回参数或小型查找表。
12. **防守对手建模**：对「副露速度型」「暗听型」分开调整 `getExpectedDealInValue` 权重。

---

## 8. 文档与代码索引（便于维护）

| 主题 | 脚本中的入口 |
|------|----------------|
| 参数块 | `DoJot_1_0_0_PARAMS` |
| 策略切换 | `determineStrategy()` |
| 手牌估值核心 | `getHandValues()`、`calculateTilePriorityWithBreakdown()` |
| 弃和阈值 | `getFoldThreshold()`、`shouldFold()` |
| 切牌总入口 | `discard()`、`sortOutUnsafeTiles()`、`discardFold()`、`getDiscardTile()` |
| 危险度 | `getTileDanger()`、`getTileDangerForPlayer()`、`getCurrentDangerLevel()` |
| 立直 | `shouldRiichi()`、`finalizeRiichiProbability()`、`callRiichi()` |
| Helper 铳率 | `MahjongHelperRisk`、`HELPER_STYLE_DEFENSE`、`mjHelperGetRiskForTile()` |

---

## 9. 结语

DoJot 的路线是 **可解释的加权启发式**：优点是可调、可日志；缺点是规则与权重 **相互作用强**，新分支容易破坏原有平衡。建议每次只改一条「决策主轴」（攻、守、立直、顺位其一），并用 **同一批谱面/日志** 对比 **立直率、放铳率、平均顺位、末位率** 再合并。

---

*文档生成说明：基于仓库内 `DoJot_1.7.1.user.js` 的结构阅读整理；若你后续重命名参数块或拆分模块，请同步更新 §8 索引。*
