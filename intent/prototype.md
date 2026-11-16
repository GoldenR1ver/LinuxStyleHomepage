# 原型设计描述：构建期草稿守卫

- 项目：INT-HOME
- 轮次：5
- 步骤：5 / 9（prototype）
- 负责人：李禹江
- 上游：`intent/intent.yaml`、`spec/spec.yaml`、`spec/decisionTable/decisions.csv`、`spec/const.yaml`
- 下游：`tests/MANIFEST.yaml`、`spec/gates/gate.yaml`、`uml/README.md`

---

## 1. 一句话

把"草稿不进站点"从一句习惯变成一道构建期检查：`content/` 里出现草稿痕迹时
`npm run build` 直接失败，`npm run dev` 给出警告，草稿在站点上的可访问路径数为 0。

## 2. 为什么是这种改法

1. **习惯会失效，检查不会。** 第 4 轮只给了 `drafts/` 一个位置；一次 `cp` 就可能
   把草稿带进 `content/`，而构建照常成功。
2. **一处实现，两个入口。** 判定写在 `tools/gates/draftCheck.mjs` 的 `check()` 里；
   vite 插件与 G-DRAFT-01 都调它，不存在两份规则各自漂移。
3. **标记是可判的。** `DRAFT: unpublished` 是一行字，不是意图。发布因此变成一个有
   意识的动作：把文件拷进 `content/` 并删掉那一行。
4. **构建期拦，而不是部署后拦。** 拦在 emit 之前，产物里一个字节都不会有。
5. **dev 只警告。** 预览是写草稿时的常态，不能在编辑途中就阻塞。

## 3. 一次泄漏事件的处理路径

```text
写草稿
  │
  ├─ drafts/note.md              首行 DRAFT: unpublished，git 忽略，无 URL
  │     │
  │     └─ 不小心 cp 进 content/
  │           │
  │           ├─ npm run dev    日志警告，页面仍可预览
  │           │
  │           └─ npm run build  失败
  │                 "G-DRAFT-01: content/home/owner/note.md: 前五行含草稿标记"
  │                 修法：移回 drafts/，或删掉标记行确认发布
  │
  └─ 决定发布
        ├─ cp 到 content/ 并删掉首行标记
        ├─ npm run build        通过，此刻它第一次有 URL
        └─ git commit
```

## 4. 判定规则

`check(root)` 扫描 `<root>/content` 下的每个文件，两条探测器回答同一个问题
"这里有没有草稿痕迹"：

| 探测器 | 命中条件 | 读什么 |
| --- | --- | --- |
| 路径段 | 相对路径中任一段等于 `drafts` | 只读文件名 |
| 标记 | 文本文件前五行含 `DRAFT: unpublished` | 只读文本文件的前五行 |

文本扩展名白名单：`.md .txt .log .json .csv .html .yml .yaml` 与无扩展名。
二进制不读，所以一个 PDF 草稿只能靠路径段被抓到。

## 5. 三个入口

| 入口 | 行为 | 时机 |
| --- | --- | --- |
| `vite/content.ts` 的 `buildStart` | 发现问题就 `this.error`，构建停止 | `npm run build` |
| `vite/content.ts` 的 `configureServer` | 发现问题就 `logger.warn`，服务照常 | `npm run dev` |
| `node tools/gates/draftCheck.mjs` | 打印 `G-DRAFT-01` 与命中行，退出码 1 | 手动 / `npm run gate` |

三处调用同一个 `check`，`J2` 要求实现文件只有 1 个。

## 6. 第一屏

不改。站点与第 4 轮逐字一致：登录屏、motd、`ls`、`cat`、`wget`、`vim`、tmux、
留言板。本轮没有新增命令，也没有新增入口。

## 7. 草稿的可访问性

| 位置 | 在 manifest 里 | 有 URL | 服务请求 /fs/... |
| --- | --- | --- | --- |
| `drafts/x.md` | 否 | 否 | 404 |
| `content/x.md` 未提交 | 否 | 否 | 404 |
| `content/x.md` 带标记 | 构建失败，无产物 | 否 | 404 |
| `content/x.md` 无标记且已构建 | 是 | 是 | 200 |

## 8. 发布决策表

`DT-PUBLISH` 保持五个区。`drafts` 区仍是不发布；本轮新增的是"泄漏进 content 的
草稿"这一情形，由构建前的 G-DRAFT-01 拦下，不由决策表分派——它根本不该出现在
`content/` 里，属于输入错误，不是一种去向。

## 9. 权限与角色

不变。`drafts/` 不在虚拟文件系统里，guest 与 root 都碰不到它。

## 10. 页面清单

站点侧不变。架构侧新增：

| 路径 | 作用 | 上游 |
| --- | --- | --- |
| `tools/gates/draftCheck.mjs` | 唯一的判定实现，导出 `MARKER` 与 `check` | `spec/const.yaml` 的 FORB-07、FORB-08 |
| `tools/gates/draftCheck.d.mts` | 给 vite 插件与测试的类型声明 | 同上 |
| `tests/gates/test_draft_gate.test.ts` | 门的负向测 | `G-DRAFT-01` |
| `tests/acc/test_draft_guard.test.ts` | 构建期行为与零可访问路径 | `REQ-SG-16`、`REQ-SG-17`、`REQ-SG-19` |

## 11. 与九步的映射

| 步 | 动作 | 产物 | 出口 | 谁 | 本轮 |
| --- | --- | --- | --- | --- | --- |
| 1 | intent | `intent/intent.yaml` | 五块齐；question 有 owner | 人 | ok |
| 2 | spec | `spec/spec.yaml` | 每条 rule 有 shall；无模糊词 | 人 + AI | ok |
| 3 | 决策表 | `spec/decisionTable/decisions.csv` | 每个组合有行；无 otherwise | AI + 人 | ok |
| 4 | const | `spec/const.yaml` | 每条有 check | AI | ok |
| 5 | 原型 | `intent/prototype.md` | 决策表每行有可见结果 | AI | ok |
| 6 | 测试 | `tests/MANIFEST.yaml` + 测试文件 | 每条 const 有断言 | AI | ok |
| 7 | 门 | `spec/gates/gate.yaml` | 每门有负向测与复审日 | AI + 人 | ok |
| 8 | UML | `uml/` | 三图与原型一致 | AI | ok |
| 9 | 下一轮 | 新的 `intent.yaml` | 新的 intent 单 | 人 | next |

## 12. 验收

对应 `intent/intent.yaml` 的 J1–J4：

1. **J1 草稿不会因疏忽进站点。** 泄漏样本下构建退出码非 0；干净树上 0；
   manifest 含 draft 的条目 0 条。
2. **J2 边界只有一处实现。** 构建与 G-DRAFT-01 调同一个 `check`；实现文件 1 个。
3. **J3 无回归。** `npm test` 失败数 0；`git diff src/` 相对上一轮 0 字节。
4. **J4 单向往交接。** spec 引 intent 外的条件 0 条；const 引 spec 与决策表外的
   条件 0 条。

## 13. 风险

| 风险 | 触发条件 | 处理 |
| --- | --- | --- |
| 标记被忘掉 | 草稿没写首行 | `drafts/README.txt` 把它写成第一条规矩；路径段检查仍兜底 |
| 二进制草稿漏过 | PDF 不含可读标记 | 路径段检查覆盖；Q1 讨论再加同名比对 |
| 测试互相污染 | 一个测试往真实 `content/` 写泄漏样本 | 已发生一次：并行测试互踩。改为用临时目录驱动 `check()` 与 `buildStart()`，不碰真实树 |
| 插件与门规则漂移 | 各写一份判定 | 只有一份实现，`J2` 用断言守住 |
| shebang 让 import 失败 | 被 import 的模块带 `#!` | `draftCheck.mjs` 故意不带 shebang，用 `node` 调用；已实测 esbuild 会报 Invalid token |

## 14. 下一轮

- Q1 关闭后，决定是否增加 drafts/ 与 content/ 的同名比对；`REQ-SG-14` 保持
  `undecided`。
- Q2 关闭后，决定草稿若真要访问控制走哪条路；`REQ-SG-15` 保持 `undecided`。
- 第 9 步：改 `intent/intent.yaml` 开第 6 轮。
