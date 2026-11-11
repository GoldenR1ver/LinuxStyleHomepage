# DoJot

面向雀魂对局的 AI 托管脚本。单文件 userscript，基于 AlphaJong 1.3.2_beta 改写，当前版本 `4.0.0`。

需要注意的是，目前的雀魂前端网页元素进行了更新，使用Unity元素。因此当前脚本的前端暂时无法使用。

---

## 构建

源码在 `src/`，产物是根目录的 `DoJot_4.0.0.user.js`。不打包、无依赖，build.js 按文件名顺序把 16 个模块拼回一个 userscript：

```bash
node build.js            # 生成 DoJot_4.0.0.user.js
node build.js --check    # 只比对产物是否与 src 同步
```

- **改参数**：`src/01_parameters.js` 里的 `DoJot_4_0_0_PARAMS` 是唯一入口，下面那行 `var PERFORMANCE_MODE = ...` 只是映射成全局变量。改完记得重新构建。
- **改逻辑**：按模块找对应文件，模块划分见 [src/README.md](src/README.md)。
- **语法自检**：`node --check DoJot_4.0.0.user.js`（只需 Node，无需 `npm install`）。
- **改版本**：`src/00_header.js` 的 `@name` / `@namespace` / `@version`，以及 `src/14_main.js` 里 `toggleRun()` 的两处 `DoJot 4.0.0` 文案。
- **发版**：构建后另存为 `DoJot_X.Y.Z.user.js`，旧文件移进 `OldReleaseVersion/`，并在那里的 README 记一笔。

---

## 挂载到浏览器

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox 都行）。
2. 装脚本，二选一：
  - 把 `DoJot_4.0.0.user.js` 拖进浏览器窗口，弹出安装页后点「安装」；
  - 或 Tampermonkey 面板 → 添加新脚本 → 全选粘贴 → `Ctrl+S` 保存。
3. 确认脚本头的 `@match` 覆盖你用的域名，默认已包含：
  - `mahjongsoul.game.yo-star.com`
  - `majsoul.com`
  - `game.maj-soul.net`
  - `game.maj-soul.com`
  - `majsoul.union-game.com`
  - `game.mahjongsoul.com`
4. 打开雀魂，右下角会出现 DoJot 面板：
  - **Room**：选场次（Auto 模式启动后自动进这个场）
  - **AI Mode**：`Auto` 自动打牌 / `Help` 只给推荐、不动鼠标
  - **Start Bot**：启动
5. 面板被隐藏后，按数字键盘 `+` 或 `A` 唤回。
6. 三处配置写在 localStorage，key 前缀 `dojot40`（`dojot40Autorun` / `dojot40Room` / `dojot40AIMode`）。换大版本号会换前缀，所以升级后要重设一次。大版本更新频率平均为三个月一次。

`Help` 模式会高亮推荐打的牌，并提供一些需要注意的参数，需要自己看推荐牌打；  
`Auto` 是托管。使用Autorun挂机连续对局。

---

## 组件

| 路径                    | 作用                                      | 文档                                    |
| --------------------- | --------------------------------------- | ------------------------------------- |
| `src/`                | **源码**：按模块拆成 16 个文件                       | [README](src/README.md)               |
| `build.js`            | 把 `src/` 拼回单文件脚本                         | —                                     |
| `DoJot_4.0.0.user.js` | **构建产物**，装进 Tampermonkey 的就是这个           | [设计说明](Tile_Discard_Function.md)      |
| `OldReleaseVersion/`  | 历史公开发行版（1.0.0 → 3.0.0）与各版本变更记录          | [README](OldReleaseVersion/README.md) |
| `Parameter/`          | 参数模板、推荐配置、历史优化结果                        | [README](Parameter/README.md)         |
| `GameData/`           | 对局统计的导出文件与字段说明                          | [README](GameData/README.md)          |
| `Optimizer/`          | 离线贝叶斯优化器（GPR + EI）及耦合分组                 | [README](Optimizer/README.md)         |
| `HandsTable/`         | hu 表算法（查表法和牌判定）的原始 JS 实现，4.0 的和牌判定从这里移植 | [README](HandsTable/README.md)        |
| `Reference/`          | 策略参考资料：push/fold 表、立直判断、有效牌概率           | [README](Reference/README.md)         |
| `Example/`            | 下面「效果展示」用的截图                            | [README](Example/README.md)           |

根目录还有三份设计笔记：

| 文件                                   | 内容                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Tile_Discard_Function.md`           | 切牌决策链逐层拆解：`discard()` → `getTilePriorities` → `sortOutUnsafeTiles` → `getDiscardTile` / `discardFold`，以及 priority 公式 |
| `Advanced_Mahjong_Parameters.md`     | 筋 / 早巡 / 壁 / 留牌这几种读牌手段的经验总结，`ADVANCED_DEFENSE` 的由来                                                                   |
| `DoJot_Strategy_and_Optimization.md` | 2.x 时期的策略总览与优化方向笔记（文中称 `1.7.1`，对应现在的 2.2.0）                                                                          |

两点需要说明：

- **「对局 → 导出 gameData → 优化 → 导入参数」这条闭环，只在** `2.2.0` **里有完整实现。** 3.0.0 精简掉了参数导入导出和数据采集，4.0.0 沿用这个精简版。所以要跑调参流程，请装 `OldReleaseVersion/DoJot_2.2.0.user.js`。
- `Parameter/` 里的 JSON 仍保留 2.2.0 的参数分组（`WAIT_QUALITY`、`RIICHI_DECISION`、`TILE_PRIORITY`、`TILE_HOLDING`、`HONOR_BALANCE`），4.0.0 不认这些组；细节见 [Parameter/README.md](Parameter/README.md)。

---

## 效果展示

### 最有定力的兜牌

因为在金之间训练的，金之间最大的特点就是2位加分非常多，3位扣分非常少，总而言之，只要不是4位，一直打下去都是能上分的。

所以为了不掉到4位，兜牌的权重训练以后变的相当高。

比较有代表性的一把：末巡拒听两次一气通贯

![](Example/noTen1.png)

![](Example/noTen2.png)

看看总牌河

![](Example/allDiscard.png)

这是因为我的防守逻辑是选择一名玩家统计其危险值，在认为某个玩家非常危险的时候相当于根据他的牌河单防他。只会打他打过的现物。

来看看日志：

![](Example/bad3m.png)

日志里面没有3m 5p，认为这都是危险牌/高价值牌，尽可能不要打出去。

太能兜了我天哪，有这个定力做什么都会成功的（

### 非常高牌效的切牌

![](Example/45779-45579.png)

一个简单的例子：45779->45579

确实牌效高，确实如果自己打就会顺手打5m，甚至为了碰牌多一点会打9m，如果那么打后面很不舒服了

![](Example/ron.png)

当然这把奶奶发牌也没有什么影响（

## 一些特殊役种的危险系数很高

比如说大四喜，小四喜，大三元，清一色，混一色，字一色

![](Example/dangerousMeld.png)

上家保底混一色自风场风四番满贯，不能点，放铳的输分期望太高了

兜了好久好久的西风北风，这时候AI已经弃胡了，最后没有点炮也算胜利。

### AI打了4天麻将的结果

用AI收集数据打了4天麻将

![](Example/result2.png)

![](Example/result1.png)

四麻段位从雀杰1星200分到三星1361分，感觉再挂一晚上能上雀豪啊。

事已至此，先发布吧。
