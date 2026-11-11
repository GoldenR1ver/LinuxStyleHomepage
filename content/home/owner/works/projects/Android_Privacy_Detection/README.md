# Android 隐私检测系统（Privacy Audit Toolkit）

在 Android 应用上自动比对**隐私政策声明**与**多源技术证据**（APK 静态扫描、设备动态取证、历史实验数据、法律知识库推断），输出三项权利的审计报告：

- **知情权**：政策声明了什么，代码和运行时实际做了什么？
- **同意权**：用户关闭开关/撤回同意后，采集和传输是否真的停止？
- **访问权**：用户导出的数据副本，是否覆盖了应用实际采集的字段？

> 课堂实验里曾用 `Lab4-1`、`Stage2`、`Stage3` 这类按实验顺序命名的编号。现在代码、CLI 和文档统一改为**按职责命名**；旧实验产物目录仍可被自动识别，见[命名对照](#2-命名对照旧--新)。

---

## 1. 设计目标

1. **证据优先**：每条结论都能追溯到政策原文、静态 API、运行时事件、网络字段或副本文件。
2. **规则可复现**：最终 verdict 由规则引擎产生，LLM 只做路径建议与解释，不参与裁决。
3. **多轨取证**：静态、UI、Frida、mitm 四条轨道按 App 能力自动选择，单轨失败不阻断整个实验。
4. **批量可交付**：支持多 App 调度、失败重试、断点续跑、日志归档和结构化报告。

---

## 2. 命名对照（旧 → 新）

| 直观名称 | CLI 命令 | 代码模块 | 旧实验名 |
| --- | --- | --- | --- |
| 知情权审计 | `audit-disclosure` | `workflows/disclosure_audit.py` | Lab4-1 |
| 同意权审计 | `audit-consent` | `workflows/consent_audit.py` | Lab4-2 |
| 访问权审计 | `audit-access` | `workflows/access_audit.py` | Lab4-3 |
| 静态取证 | `scan-static` | `workflows/static_scan.py` | Stage2 |
| 动态取证 | `capture-dynamic` | `workflows/dynamic_capture.py` | Stage3 |
| 证据包构建 | `build-evidence` | `ingestion/evidence_loader.py` | build-evidence-bundles |
| 历史数据导入 | `import-legacy` | `ingestion/legacy_importer.py` | import-oldsrc-evidence |
| 批量编排 | `batch` / `batch-status` | `workflows/batch_runner.py` | Stage7 batch |
| 法律知识库 | `kb-build` | `privacy_knowledgebase/` | Knowledge Base |
| 声明-证据比对 | —（引擎内部） | `engine/compare_engine.py` | compare_engine |

**报告文件也从实验编号改为职责名：**

| 旧文件 | 新文件 |
| --- | --- |
| `<App>_lab4_1_report.json` | `<App>_disclosure_report.json` |
| `<App>_lab4_2_result.json` | `<App>_consent_result.json` |
| `<App>_lab4_3_result.json` | `<App>_access_result.json` |
| `batch_lab4-1_<job>_summary.json` | `batch_disclosure_<job>_summary.json` |

历史目录（`output/lab4_1*`、`output/stage2_*`、`output/stage3_*`）不会被删除；证据加载器会按新目录优先、旧目录兜底的顺序查找。

---

## 3. 系统架构

```text
┌────────────────────────── input/ ──────────────────────────┐
│ 隐私政策文本  App/包名映射  APK  用户副本  历史实验数据  追踪器库 │
└──────────────────────────────┬─────────────────────────────┘
                               ▼
┌────────────────────── 取证层 analyzers/ ───────────────────┐
│ 政策解析   静态扫描   动态取证（Appium/Frida）   网络取证（mitm）│
│ policy     static     dynamic                   network    │
└──────────────────────────────┬─────────────────────────────┘
                               ▼
┌────────────────────── 汇聚层 ingestion/ ───────────────────┐
│ 多源证据合并 · provenance · 历史数据导入 · 法律知识库增强       │
└──────────────────────────────┬─────────────────────────────┘
                               ▼
┌────────────────────── 判定层 engine/ ──────────────────────┐
│ 声明 vs 观测 · 判定规则 · SDK 披露 · 知识库可行证据            │
└──────────────────────────────┬─────────────────────────────┘
                               ▼
┌──────────── 工作流层 workflows/ + 报告层 reporting/ ────────┐
│ 知情权审计  同意权审计  访问权审计  批量编排   JSON / Excel     │
└────────────────────────────────────────────────────────────┘
```

| 层 | 职责 | 入口 |
| --- | --- | --- |
| 取证层 | 从政策、APK、设备、网络中产生原始证据 | `scan-static`、`capture-dynamic` |
| 汇聚层 | 把多源证据合并成统一的 `observed_pii` 与 `provenance` | `build-evidence`、`import-legacy` |
| 判定层 | 按规则比较声明与观测，输出 `consistent` 等 verdict | 各审计工作流内部调用 |
| 工作流/报告层 | 单 App 审计、批量调度、JSON/Excel 报告 | `audit-*`、`batch`、`export-excel` |

---

## 4. 目录结构

```text
project/
├── README.md                       # 本文件：总览与命令速查
├── src/
│   ├── README.md                   # src 包索引
│   ├── privacy_audit/              # 主审计包
│   │   ├── cli.py                  # 统一命令入口
│   │   ├── analyzers/              # 政策/静态/动态/网络取证
│   │   ├── ingestion/              # 多源证据合并、历史导入
│   │   ├── engine/                 # 声明-证据比对、判定规则
│   │   ├── workflows/              # 三项审计、取证、批量编排
│   │   ├── reporting/              # JSON / Excel 报告
│   │   ├── config/                 # PII 分类、判定规则、标签映射
│   │   └── utils/                  # adb、日志、重试、UI 层级等
│   ├── privacy_knowledgebase/      # 法律矩阵 + Android 信号映射
│   ├── scripts/                     # 批量/探针/同步等辅助脚本
│   ├── input/                       # 政策、APK、App 列表、用户副本
│   ├── output/                      # 取证与审计产物（可重建）
│   └── tests/                       # 单元/集成/E2E 测试
├── oldsrc/                          # 历史 Lab3 实验产物（只读）
├── reference/                       # 设计文档、法律参考、汇报材料
├── tools/frida/                     # 与 PC 端版本一致的 frida-server
└── utils/                           # 开源参考仓库（androguard/exodus/frida 等）
```

---

## 5. 环境准备

- **Python 3.10+**，建议使用虚拟环境。
- 依赖：`androguard`、`PyYAML`、`mitmproxy`、`Appium-Python-Client`、`frida` 等，按实际 `pip` 环境安装。
- **静态取证**：准备 APK，放在 `src/input/apk/`。
- **动态取证（可选）**：
  - Android 模拟器/真机，`adb connect` 可用；
  - Appium Server，默认 `http://127.0.0.1:4723`；
  - 设备内 `frida-server`，架构与版本需匹配 PC 端，见 `tools/frida/`；
  - 需要 HTTPS 抓包时，配置 mitmproxy 证书与 `adb` 代理。

所有命令都在 `project/src` 下执行：

```powershell
cd project/src
python -m privacy_audit.cli --help
```

---

## 6. 五分钟快速开始

### 6.1 重建法律知识库（修改 `privacy_knowledgebase/input.md` 后执行）

```powershell
python -m privacy_audit.cli kb-build
```

### 6.2 静态取证

```powershell
# 扫描 input/apk/ 下全部 APK
python -m privacy_audit.cli scan-static --apk-dir input/apk --output-dir output/static

# 单个 APK（--fast 跳过完整 Androguard 分析，适合批量初筛）
python -m privacy_audit.cli scan-static --apk-file input/apk/keep.apk --output-dir output/static --fast
```

输出：`output/static/<apk名>/static_evidence.json`

### 6.3 动态取证（可选，需设备 + Appium）

```powershell
# 默认 mitm 优先；需要 Frida 时加 --enable-frida 或 --dynamic-track frida
python -m privacy_audit.cli capture-dynamic --app-name Keep --app-package com.gotokeep.keep --policy-text-dir input/pii_text --static-evidence-file output/static/keep/static_evidence.json --output-dir output/dynamic --real-run --enable-frida
```

输出：`output/dynamic/<App>/dynamic_evidence.json`、截图、`capture_run.log`

### 6.4 构建证据包

```powershell
# 从静态/动态/历史数据合并出每个 App 的扁平证据包
python -m privacy_audit.cli build-evidence --apps-file input/apps_audit_batch.txt --output-dir output/evidence
```

输出：`output/evidence/<App>.json`（含 `observed_pii`、`sources`、`provenance`、`knowledge_base.feasible_evidence`）

### 6.5 单 App 知情权审计

```powershell
python -m privacy_audit.cli audit-disclosure --app-name Keep --policy-file input/pii_text/Keep.txt --evidence-file output/evidence/Keep.json --output-dir output/disclosure
```

输出：`output/disclosure/Keep_disclosure_report.json`

### 6.6 批量知情权审计

```powershell
python -m privacy_audit.cli batch --apps-file input/apps_audit_batch.txt --mode disclosure --policy-dir input/pii_text --evidence-dir output/evidence --output-dir output/disclosure --job-id keep_batch_005 --retry-count 2
```

查看进度与结果：

```powershell
python -m privacy_audit.cli batch-status --output-dir output/disclosure --job-id keep_batch_005
```

### 6.7 同意权审计

```powershell
python -m privacy_audit.cli audit-consent --app-name Keep --before-off-file input/consent_before/Keep.json --after-off-file input/consent_after/Keep.json --output-dir output/consent
```

批量：

```powershell
python -m privacy_audit.cli batch --apps-file input/apps_consent_four.txt --mode consent --before-dir input/consent_before --after-dir input/consent_after --output-dir output/consent --job-id consent_001
```

### 6.8 访问权审计

先把用户导出的副本整理成 JSON 对象（字段名 → 值），放在 `input/access_copy/<App>.json`；运行时证据放在 `input/access_runtime/<App>.json`。

```powershell
python -m privacy_audit.cli audit-access --app-name 小荷健康 --policy-file input/pii_text/小荷健康.txt --dynamic-evidence-file input/access_runtime/小荷健康.json --copy-file input/access_copy/小荷健康.json --output-dir output/access
```

批量：

```powershell
python -m privacy_audit.cli batch --apps 小荷健康,世纪佳缘 --mode access --policy-dir input/pii_text --dynamic-dir input/access_runtime --copy-dir input/access_copy --output-dir output/access --job-id access_001
```

---

## 7. 三项权利审计说明

### 知情权 `audit-disclosure`

**问题**：政策声明的个人信息类型，与静态/动态证据观测到的类型是否一致？

- 输入：政策文本 + 证据包（或现场合并静态/动态/历史证据）。
- 判定：
  - `consistent`：声明且观测到；
  - `inconsistent_high_risk`：证据观测到但政策未声明；
  - `declared_not_observed`：政策声明但当前证据未观测到（**不等于未采集**）。
- 额外输出：`sdk_disclosure`（政策声明的第三方 SDK vs APK 内嵌 SDK）、`feasible_evidence`（知识库给出的可引用法律证据）。

### 同意权 `audit-consent`

**问题**：关闭开关/撤回同意前后，同一 App 的采集行为是否变化？

- 输入：`before_off` 与 `after_off` 两份动态证据。
- 对比轨道：
  - Frida 运行时 API 事件：`effective_off` / `still_collecting_after_off`；
  - mitm 网络轨：tracker 域名与 `network_keys` 字段是否仍在传输。
- 注意：`before=0, after=0` 属于**观测不足**，不能据此判定开关有效。

### 访问权 `audit-access`

**问题**：用户导出的数据副本，是否覆盖运行时观测到的字段？

- 输入：政策文本 + 运行时证据 + 用户副本 JSON。
- 输出：
  - `declared_pii`：政策声明字段；
  - `runtime_observed_pii`：Frida + mitm 合并的运行时字段；
  - `copy_covered_pii` / `missing_from_copy`：副本覆盖与缺失；
  - `manual_copy_audit`：字段级人工复核建议（自动匹配只作提示，不作最终结论）。

---

## 8. 命令速查

| 命令 | 用途 |
| --- | --- |
| `kb-build` | 由 `privacy_knowledgebase/input.md` 生成知识库 JSON |
| `scan-static` | APK 静态扫描（Exodus + Androguard + SDK 签名） |
| `capture-dynamic` | Appium + Frida + mitm 动态取证 |
| `build-evidence` | 合并静态/动态/历史证据为扁平证据包 |
| `import-legacy` | 导入 oldsrc Lab3 数据，生成静态/动态派生证据 |
| `audit-disclosure` | 单 App 知情权审计 |
| `audit-consent` | 单 App 同意权审计 |
| `audit-access` | 单 App 访问权审计 |
| `batch` | 批量运行三项审计之一，支持重试/续跑/日志 |
| `batch-status` | 查看 batch manifest 与任务状态 |
| `compare-verdicts` | 比较两次知情权审计的 verdict 差异 |
| `export-excel` | 导出 PMA 风格 Excel（API / 堆栈 / 政策声明） |
| `import-legacy-claims` | 把旧人工标注导入为统一 claim |
| `refine-label-mapping` | 聚类未知标签并给出映射建议 |

每个命令的完整参数：

```powershell
python -m privacy_audit.cli <command> --help
```

---

## 9. 输入与输出

### 输入

| 路径 | 用途 |
| --- | --- |
| `input/pii_text/<App>.txt` | 隐私政策纯文本 |
| `input/app_packages.json` | App 名 → Android 包名（及代码前缀） |
| `input/apps_audit_batch.txt` | 当前批量 App 列表 |
| `input/apk/` | 待扫描 APK |
| `input/consent_before/`、`input/consent_after/` | 同意权前后动态证据 |
| `input/access_copy/<App>.json` | 用户导出的数据副本（规范化 JSON） |
| `input/access_runtime/<App>.json` | 访问权审计用的运行时证据 |
| `input/user_copy/` | 原始副本（格式可不统一） |
| `input/user_copy_normalized/` | `scripts/normalize_user_copy.py` 生成的扁平 JSON |
| `input/frida_tier.json` | 每 App 的 Frida 可注入等级与偏好轨道 |
| `input/navigation_bridges.json` | 学习到的 UI 导航中间桥 |
| `input/tracker_blocklist/` | tracker 域名与 SDK 签名库 |

### 输出

| 路径 | 内容 |
| --- | --- |
| `output/static/<slug>/static_evidence.json` | 单 App 静态证据 |
| `output/dynamic/<App>/dynamic_evidence.json` | 单 App 动态证据 |
| `output/evidence/<App>.json` | 合并证据包 |
| `output/disclosure/<App>_disclosure_report.json` | 知情权报告 |
| `output/consent/<App>_consent_result.json` | 同意权报告 |
| `output/access/<App>_access_result.json` | 访问权报告 |
| `output/<audit>/batch_jobs/<job_id>/` | batch manifest、summary、日志、归档报告 |
| `output/<audit>/batch_<mode>_<job_id>_summary.json` | 批量汇总（快速查看） |
| `output/knowledge_base/` | 知识库 JSON 镜像 |
| `output/frida_probe/` | Frida 注入探针结果 |

**旧目录兼容**：`output/lab4_1*`、`output/stage2_*`、`output/stage3_*` 仍会被扫描；新运行默认写入新目录。

---

## 10. 组件文档

| 组件 | 文档 |
| --- | --- |
| 主审计包与分层 | [`src/privacy_audit/README.md`](src/privacy_audit/README.md) |
| 取证分析器（政策/静态/动态/网络） | [`src/privacy_audit/analyzers/README.md`](src/privacy_audit/analyzers/README.md) |
| 证据汇聚与历史导入 | [`src/privacy_audit/ingestion/README.md`](src/privacy_audit/ingestion/README.md) |
| 判定引擎与规则 | [`src/privacy_audit/engine/README.md`](src/privacy_audit/engine/README.md) |
| 工作流与批量编排 | [`src/privacy_audit/workflows/README.md`](src/privacy_audit/workflows/README.md) |
| 报告导出 | [`src/privacy_audit/reporting/README.md`](src/privacy_audit/reporting/README.md) |
| 配置与 PII 分类 | [`src/privacy_audit/config/README.md`](src/privacy_audit/config/README.md) |
| 工具函数 | [`src/privacy_audit/utils/README.md`](src/privacy_audit/utils/README.md) |
| 法律知识库 | [`src/privacy_knowledgebase/README.md`](src/privacy_knowledgebase/README.md) |
| 辅助脚本 | [`src/scripts/README.md`](src/scripts/README.md) |
| 输入目录 | [`src/input/README.md`](src/input/README.md) |
| 输出目录 | [`src/output/README.md`](src/output/README.md) |
| 历史实验数据 | [`oldsrc/README.md`](oldsrc/README.md) |
| frida-server | [`tools/README.md`](tools/README.md) |
| 开源参考仓库 | [`utils/README.md`](utils/README.md) |
| 设计文档与法律参考 | [`reference/`](reference/) |

---

## 11. 推荐工作流

### 单 App 深度验证

```powershell
python -m privacy_audit.cli kb-build
python -m privacy_audit.cli scan-static --apk-file input/apk/keep.apk --output-dir output/static
python -m privacy_audit.cli capture-dynamic --app-name Keep --app-package com.gotokeep.keep --real-run --enable-frida --output-dir output/dynamic --static-evidence-file output/static/keep/static_evidence.json
python -m privacy_audit.cli build-evidence --apps Keep --output-dir output/evidence
python -m privacy_audit.cli audit-disclosure --app-name Keep --policy-file input/pii_text/Keep.txt --evidence-file output/evidence/Keep.json --output-dir output/disclosure
```

### 批量知情权（课堂交付主线）

```powershell
python -m privacy_audit.cli import-legacy --apps-file input/apps_audit_batch.txt --rebuild-bundles
python -m privacy_audit.cli batch --apps-file input/apps_audit_batch.txt --mode disclosure --policy-dir input/pii_text --evidence-dir output/evidence --output-dir output/disclosure --job-id keep_batch_005 --retry-count 2
python -m privacy_audit.cli batch-status --output-dir output/disclosure --job-id keep_batch_005
```

### 同意权 A/B

1. 开启状态运行一次 `capture-dynamic`，产物复制到 `input/consent_before/<App>.json`；
2. 在设备上手动关闭开关/撤回同意；
3. 同样参数再运行一次，产物复制到 `input/consent_after/<App>.json`；
4. 运行 `audit-consent` 或 `batch --mode consent`。

---

## 12. 证据强度与判定

报告和汇报中建议区分证据强度（S0–S5）：

| 级别 | 含义 | 典型来源 |
| --- | --- | --- |
| S0 | 仅政策文本 | `policy_parser` |
| S1 | 具备采集能力 | Exodus 权限、Androguard API、内嵌 SDK |
| S2 | 用户可触达相关界面/开关 | Appium 步骤、截图、keyword checks |
| S3 | 观测到运行时 API 调用 | Frida `frida_runtime_events > 0` |
| S4 | 观测到网络外传 | mitm tracker 域名、`network_keys` 命中 |
| S5 | 用户访问权产物 | 用户导出副本 |

**判定建议**：

- 「未声明但采集」：至少 S1 + S3 或 S1 + S4，才标高风险；仅 S1 标「待验证」。
- 「关闭无效」：需要 S2 确认已关闭，且 before > 0、after > 0（S3/S4）。
- 「副本不完整」：需要 S5 与 S3/S1 的字段差集非空。

---

## 13. 已知限制

- **Frida 不是万能的**：商业 App 常见反注入、进程瞬杀、壳与多进程；`capture-dynamic` 默认 mitm 优先，Frida 为可选项。
- **attach 晚于冷启动**：IMEI/Android ID 可能在 `Application.onCreate` 阶段读取；需要时使用 `--frida-mode spawn` 或延长 `--frida-grace-sec`。
- **UI 自动化路径脆弱**：页面改版会导致导航失败；`input/navigation_bridges.json` 与 LLM 路径建议只用于辅助，最终以截图和日志为准。
- **副本收集是访问权瓶颈**：邮箱/异步导出无法被 Frida 直接观测，`audit-access` 的自动覆盖率需配合 `manual_copy_audit` 人工复核。
- **dry-run 数据不能作为结论**：`--real-run` 缺失时产生的是模拟事件，不应进入同意权对比。

---

## 14. 与 oldsrc 的关系

| | `oldsrc/` | `src/`（主路径） |
| --- | --- | --- |
| 角色 | 历史 Lab3 实验产出与 LLM 审计 | 证据驱动 + 规则引擎 + 法律知识库 |
| 使用方式 | 只读 `analyzer/output/`，经 `import-legacy` 导入 | `python -m privacy_audit.cli ...` |
| 不宜 | 作为主执行入口 | 用 oldsrc 代码跑主流程 |

---

## 15. 常见问题

**Q: `ModuleNotFoundError: No module named 'privacy_audit'`**  
A: 必须在 `project/src` 下执行命令。

**Q: batch 全是 `declared_not_observed`**  
A: 先运行 `build-evidence`（或 `import-legacy --rebuild-bundles`），并让 batch 使用 `--evidence-dir output/evidence`。

**Q: 报告里看不到 `feasible_evidence`**  
A: 查看 `output/evidence/<App>.json` 的 `knowledge_base` 字段；确保证据包重建时未加 `--no-knowledge-base`。

**Q: 动态取证终端长时间无输出**  
A: 确认 ① 在 `project/src` 下执行；② Appium `/status` 可访问；③ 加 `--real-run`；④ 加 `-v` 查看实时日志；⑤ 日志在 `output/dynamic/<App>/capture_run.log`。

**Q: Frida 只有 `hook_loaded`，没有运行时事件**  
A: 确认使用 `--real-run --enable-frida`；在 grace 窗口或 Appium 进入权限/定位页面时触发 API；查看 `summary.frida_runtime_events` 是否大于 0。

**Q: 如何关闭法律知识库**  
A: `build-evidence`、`import-legacy`、`batch` 均可加 `--no-knowledge-base`。

**Q: 旧实验数据还能用吗？**  
A: 可以。证据加载器会扫描旧目录；也可以在命令中显式指定旧路径。新报告文件名与旧报告不同，旧报告不会被覆盖。
