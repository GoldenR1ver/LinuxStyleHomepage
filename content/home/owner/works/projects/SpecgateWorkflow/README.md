![Python](https://img.shields.io/badge/python-3.11%2B-informational?style=for-the-badge&logo=python&logoColor=white)
![pytest](https://img.shields.io/badge/tests-pytest-informational?style=for-the-badge)
![hypothesis](https://img.shields.io/badge/property-hypothesis-informational?style=for-the-badge)
![Spec:EARS](https://img.shields.io/badge/spec-EARS-informational?style=for-the-badge)
![License:MIT](https://img.shields.io/badge/license-MIT-informational?style=for-the-badge)
![Stars](https://img.shields.io/github/stars/GoldenR1ver/Specgate-An-agile-development-architecture-for-human-AI-collaboration?style=for-the-badge)
![Issues](https://img.shields.io/github/issues/GoldenR1ver/Specgate-An-agile-development-architecture-for-human-AI-collaboration?style=for-the-badge)

# specgate

一套本地敏捷开发的人机协同架构模板  
以 intent、spec、决策表、不变量为骨架，用门守住产出  
主要面向独立开发者，也适合小团队

**[看主线 »](docs/OverallWorkflow.txt)**

[流程主线](docs/OverallWorkflow.txt) · [测试设计](tests/about.txt) · [门清单](docs/spec/gates/gate.yaml) · [定位](#定位)

**目录**

1. [关于本项目](#关于本项目)
  - [定位](#定位)
  - [为什么是这套结构](#为什么是这套结构)
  - [工具链](#工具链)
2. [架构](#架构)
  - [目录](#目录)
3. [开始](#开始)
  - [依赖](#依赖)
  - [安装](#安装)
4. [使用方法](#使用方法)
  - [单轮开发九步](#单轮开发九步)
  - [常用命令](#常用命令)
  - [门](#门)
5. [边界](#边界)
6. [路线图](#路线图)
7. [贡献](#贡献)
8. [许可证](#许可证)
9. [联系我们](#联系我们)
10. [致谢](#致谢)



## 关于本项目

随着 AI 参与开发成为常态，怎么设计人机协同流程、怎么把 AI 的产出约束在可验证的范围里，成了绕不开的问题。

本仓库给出一套本地敏捷开发的人机协同架构，以模板形式提供。

这份架构的用处：

1. **以需求和规范为主。** 人不必盯着具体实现，只需要修改 intent， spec，与测试样例，实现由LLM掌握。
2. **自然语言与结构化语言并用。** 说不清的写 NL，要机器判的写 YAML。
3. **副产物对人友好。** 决策表、不变量清单、UML 图、用例清单都适合人读，方便新人上手与多人协作。
4. **最小实现，结构扁平。** 只用几个目录、几个 YAML、几个脚本。更多的是开发指导思路。



### 定位

本实验理论来源为 **南京大学教授蒋炎岩《生成式软件工程》** 的课程思路，结合工程实践的 **Spec-Driven Development** 思路，在学术意义上，将工程知识外化为模型，实现**模型驱动的 Agent 治理**。

本仓库不提供新理论。主要工作是为 Spec-Driven Development 和模型驱动 Agent 治理已经成立的共识提供最小实现。

### 为什么是这套结构

- **从设计到产品，尽早发现漏洞** 基于intent->spec.->impl.的工程逻辑设计。intent 说"要什么"，spec 说"什么时候必须发生什么"，决策表说"每种情况做什么"。三段各有一个出口条件，不合格就往回退，不往下流。
- **用测试划定边界。** 每条不变量都指到一个 check，每条规则都进决策表，每个门都有负向测。判断标准不写在人脑里。
- **文件即交接。** 每份文件只读它上游的产出，别处不开口。想加新条件，回 intent 写 question，不在下游就地补。



### 工具链

- [Python](https://www.python.org/) 3.11+
- [pytest](https://docs.pytest.org/)
- [Hypothesis](https://hypothesis.readthedocs.io/)
- [PyYAML](https://pyyaml.org/)
- [ruff](https://docs.astral.sh/ruff/)（可选）

([返回顶部](#specgate))

## 架构

我的基础架构结合线性的工作流，体现为：

```text
intent(人设计)
──▶ spec(人设计 + AI规范)
──▶ 决策表(AI + 人修正)
──▶ const(AI)
──▶ 原型(AI)
──▶ 测试(人设计 + AI)
──▶ 门(AI设置 + 人审核)
──▶ UML(AI)
──▶ 下一轮...
```



### 目录

```text
docs/                          人写与共写的东西
  OverallWorkflow.txt          主线：九步、交接、出口
  intent/                      intent.yaml + 填写法
  spec/                        specForm.yaml + const.yaml + 填写法
  spec/decisionTable/          决策表 + 填写法
  spec/gates/                  gate.yaml + 填写法
  prompt/                      三段提示词 + 填写法
  ai_gen/                      AI 写给人看的归档
  UML/                         状态图、时序图、依赖图
tests/                         按 oracle 分层
  acc/  prop/  diff/  meta/  bench/  e2e/  gates/
  MANIFEST.yaml                一行一文件，写清来源 id
  about.txt                    测试设计
tools/gates/                   门的判定逻辑，一门一脚本
schemas/                       请求与数据的 JSON Schema
ops/alerts/                    运行时门的告警规则
src/                           原型（本模板留空）
```

每个目录都有 `about.txt` 讲怎么填。改流程先改 `OverallWorkflow.txt`，再改各目录的填写法。

([返回顶部](#specgate))

## 开始



### 依赖

```sh
python --version        # 3.11+
pip install pytest hypothesis pyyaml
pip install ruff       # 可选
```



### 安装

1. 取一份模板
  ```sh
   git clone https://github.com/GoldenR1ver/Specgate-An-agile-development-architecture-for-human-AI-collaboration.git my-project
   cd my-project
  ```
2. 跑检查确认环境
  ```sh
   python -m pytest
   python tools/gates/dt_check.py
   python tools/gates/constraint_coverage.py
  ```
   预期：`32 passed, 108 skipped`。等原型的用例在这里被跳过。
3. 把示例换成自己的。示例是"学生退课"，编号 `INT-DROP`、`REQ-DROP-*`、`DT-DROP`，可整体替换。

([返回顶部](#specgate))

## 使用方法



### 单轮开发九步


| 步   | 做什么    | 谁      | 产出                                      | 出口                   |
| --- | ------ | ------ | --------------------------------------- | -------------------- |
| 1   | intent | 人      | `docs/intent/intent.yaml`               | 五块齐；question 有 owner |
| 2   | spec   | 人 + AI | `docs/spec/specForm.yaml`               | 每条 rule 有 shall；无模糊词 |
| 3   | 决策表    | AI + 人 | `docs/spec/decisionTable/decisions.csv` | 每个组合有行；无 otherwise   |
| 4   | const  | AI     | `docs/spec/const.yaml`                  | 每条有 check            |
| 5   | 原型     | AI     | `src/`                                  | 决策表每行能跑              |
| 6   | 测试     | 人 + AI | `tests/`                                | 每条 const 有断言         |
| 7   | 门      | AI + 人 | `docs/spec/gates/gate.yaml`             | 每门有负向测与复审日           |
| 8   | UML    | AI     | `docs/UML/`                             | 三图与原型一致              |
| 9   | 下一轮    | 人      | `docs/intent/intent.yaml`               | 新的 intent 单          |


细节见 [docs/OverallWorkflow.txt](docs/OverallWorkflow.txt)。

### 常用命令


| 想做什么    | 命令                                          |
| ------- | ------------------------------------------- |
| 跑全部     | `python -m pytest`                          |
| 日常，不跑计时 | `python -m pytest -m "not bench"`           |
| 只跑门     | `python -m pytest tests/gates`              |
| 查决策表    | `python tools/gates/dt_check.py`            |
| 查不变量覆盖  | `python tools/gates/constraint_coverage.py` |
| 查模糊词    | `python tools/gates/banned_words.py`        |
| 查文档断链   | `python tools/gates/refs_check.py`          |
| 查依赖方向   | `python tools/gates/dep_check.py`           |




### 门


| 门         | 位          | 延迟   | 查什么                               |
| --------- | ---------- | ---- | --------------------------------- |
| G-FMT-01  | save       | 0.3s | 格式                                |
| G-WORD-01 | pre-commit | 0.5s | 模糊词                               |
| G-REF-01  | pre-commit | 0.5s | 文档路径可达                            |
| G-DEP-01  | pr         | 8s   | `src/domain` 不 import `src/infra` |
| G-INV-01  | pr         | 2s   | 不变量有 check                        |
| G-DT-01   | merge      | 3s   | 决策表无漏无重                           |
| G-MTX-01  | merge      | 4m   | 多版本全测                             |
| G-MIG-01  | release    | 6m   | 迁移 dry-run                        |
| G-RUN-01  | runtime    | 持续   | 错误率告警                             |


门按照成本和约束力。加门参考 `docs/spec/gates/about.txt`。

([返回顶部](#specgate))

## 边界

- `src/` 是空的。等到第 5 步补全，测试会 skip 直到 `app.domain.testing` 出现。
- 框架门只覆盖文档与结构，业务正确性靠测试层。
- `pytest.ini` 内容需要全为 ASCII。
- 用例清单 `tests/MANIFEST.yaml` 是手写的。加了测试文件要同步加一行，G-REF-01 会查路径通不通。

([返回顶部](#specgate))

## 路线图

- [x] intent 单与填写法
- [x] spec 单、const、填写法
- [x] 决策表与查漏门
- [x] 按 oracle 分层的测试目录
- [x] 九道门 + 判定脚本 + 负向测
- [x] 用例清单与断链门
- [ ] 原型 `src/`，把 108 个 skip 跑起来
- [ ] UML 三图的实际产出
- [ ] CI 配置，把 merge 位的门接上
- [ ] 第二套示例，验证编号与目录可整体替换

已知问题见 [issues](https://github.com/GoldenR1ver/Specgate-An-agile-development-architecture-for-human-AI-collaboration/issues)。

([返回顶部](#specgate))

## 贡献

这份模板的价值在于被改成别人的流程。下面列出大概的贡献方向：

1. **补一门。** 照 `docs/spec/gates/about.txt` 的十步，设计新的门类型。
2. **补一段填写法。** 某个 `about.txt` 含混的地方，改成能照着做的步骤。
3. **换一个示例。** 换业务域，验证哪些地方还有耦合。

**流程：**

1. fork 本仓库
2. 建分支 `git checkout -b feature/your-gate`
3. 改完跑 `python -m pytest` 与 `python tools/gates/*.py`
4. 提拉取请求，说明改了哪个文件、动了哪条硬规则。

([返回顶部](#specgate))

## 许可证

MIT。见 [LICENSE](LICENSE)。

([返回顶部](#specgate))

## 联系我们

维护者：李禹江

仓库：[GoldenR1ver/Specgate](https://github.com/GoldenR1ver/Specgate-An-agile-development-architecture-for-human-AI-collaboration)

议题：[issues](https://github.com/GoldenR1ver/Specgate-An-agile-development-architecture-for-human-AI-collaboration/issues)

欢迎开议题介绍您用这份模板做了什么。

([返回顶部](#specgate))

## 致谢

流程设计参考了 [JYY 生成式软件工程 (2026 秋)](https://jyywiki.cn/GSE/2026/) 的讲义，尤其是需求与架构、Agent Native 开发、软件质量保障三部分。

同类工作在 [定位](#定位) 一节列出。

软件工程的判断来自这些文献：

- Frederick P. Brooks, *No Silver Bullet — Essence and Accident in Software Engineering*, 1986.
- Peter Naur, *Programming as Theory Building*, 1985.
- E. W. Dijkstra, *Notes on Structured Programming* (EWD 249), 1970.
- Guy L. Steele Jr., *Growing a Language*, 1998.
- O.-J. Dahl, C. A. R. Hoare, *Hierarchical Program Structures*, 1972.
- Trygve Reenskaug, *Models – Views – Controllers*, 1979.
- Ben Moseley, Peter Marks, *Out of the Tar Pit*, 2006.
- Richard Sutton, *The Bitter Lesson*, 2019.

([返回顶部](#specgate))