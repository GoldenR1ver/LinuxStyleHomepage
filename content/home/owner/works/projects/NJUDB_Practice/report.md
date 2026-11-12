# NJUDB 数据库内核实践：从存储引擎到索引引擎

> **作者**：Yujiang Adam Li 
> **技术栈**：C++17 · CMake · GoogleTest · 数据库内核  
> **代码仓库**：`NJU_DBPractice`（基于 [nju-websoft/NJU_DBPractice](https://github.com/nju-websoft/NJU_DBPractice) 教学框架）

---

## 1. 作品概述

NJUDB 是一个用 C++ 实现的教学型关系数据库，支持 SQL 子集，整体分为解析、查询计划、优化、执行、存储、索引、并发与恢复等模块。

在这个项目中，我主要完成了数据库最底层的两个核心部分：

| 模块 | 我实现的内容 | 关键技术点 |
| --- | --- | --- |
| **存储与缓冲池** | LRU / LRU-K 页面置换器、Buffer Pool Manager、TableHandle、行存 NAryPageHandle、列存 PAXPageHandle | 页式存储、脏页回写、Pin/Unpin 引用计数、位图槽位管理、PAX 列偏移计算 |
| **索引引擎** | B+ 树索引、IndexHandle、索引扫描算子 IdxScanExecutor、哈希索引 | B+ 树分裂/合并/重分配、范围查询、叶子链表迭代器、最左前缀匹配、桶溢出链 |

在必做内容之外，我还额外实现了 **PAX 列式页存储** 与 **哈希索引** 两个扩展模块，用于对比行存/列存在投影查询上的差异，并补齐索引类型。

### 1.1 我在系统中的位置

```
SQL 文本
   │
   ▼
Parser → Planner → Optimizer → Executor
                                   ├─ SeqScan / Filter / Join / Aggregate
                                   └─ IdxScan ── IndexHandle ── B+Tree / HashIndex
                                            │
                                      TableHandle
                                            │
                                   PageHandle（NAry / PAX）
                                            │
                                   BufferPoolManager
                                     ├─ LRU / LRU-K Replacer
                                     └─ Frame[] + free_list_ + page→frame 映射
                                            │
                                       DiskManager
```

本文重点说明 **BufferPoolManager 以下的存储层** 与 **IndexHandle 以下的索引层** 是如何实现的，以及这些实现体现出的工程能力。

---

## 2. 存储与缓冲池（Lab01）

### 2.1 设计目标

数据库文件按固定大小的页（Page）组织，内存中被划分为同样大小的物理帧（Frame）。缓冲池管理器负责：

- 将磁盘页按需载入内存帧；
- 在内存不足时按置换策略淘汰页面；
- 保证脏页在淘汰前写回磁盘；
- 用引用计数保证正在被使用的页面不会被淘汰；
- 对上层提供统一的页读写接口。

我实现的调用链是：

```
TableHandle → PageHandle → BufferPoolManager → DiskManager
```

### 2.2 LRU 与 LRU-K 置换器

LRU 置换器的核心是 **双向链表 + 哈希表**：

- `std::list` 维护访问顺序，链表头部是最久未使用的帧；
- `std::unordered_map<frame_id_t, iterator>` 支持 O(1) 定位链表节点；
- `Pin()` 把帧移到链表尾部并标记为不可淘汰；
- `Unpin()` 把帧标记为可淘汰；
- `Victim()` 从头部找到第一个可淘汰帧并摘除；
- 所有操作都用 `std::mutex` 保护，保证多线程下的状态一致。

LRU-K 在此基础上为每个帧维护一个访问时间戳队列：

```cpp
class LRUKNode {
  std::list<timestamp_t> history_;  // 最近 K 次访问时间
  frame_id_t fid_;
  bool is_evictable_;
  size_t k_;
};
```

淘汰时计算 **反向 K 距离**（当前时间戳与第 K 次访问时间戳之差）：

```cpp
auto GetBackwardKDistance(timestamp_t cur_ts) -> unsigned long long {
  if (history_.size() < k_) return ULLONG_MAX;  // 访问次数不足 K 次
  return cur_ts - history_.front();
}
```

访问次数不足 K 次的帧优先被淘汰；距离相同时再按最早访问时间打破平局。这样既保留了 LRU 的简单性，又能抵抗一次性扫描造成的缓存污染。

### 2.3 Buffer Pool Manager

BPM 的核心数据结构：

| 结构 | 作用 |
| --- | --- |
| `Frame frames_[BUFFER_POOL_SIZE]` | 固定大小的物理帧数组 |
| `std::list<frame_id_t> free_list_` | 空闲帧链表 |
| `std::unordered_map<fid_pid_t, frame_id_t> page_frame_lookup_` | `(文件号, 页号) → 帧号` 的 O(1) 映射 |
| `Replacer` | LRU 或 LRU-K 置换策略 |

`FetchPage` 的命中/未命中路径：

```cpp
Page *FetchPage(file_id_t fid, page_id_t pid) {
  std::lock_guard<std::mutex> lock(latch_);

  auto it = page_frame_lookup_.find({fid, pid});
  if (it != page_frame_lookup_.end()) {     // 命中
    Frame &frame = frames_[it->second];
    frame.Pin();
    replacer_->Pin(it->second);
    return frame.GetPage();
  }

  frame_id_t frame_id = GetAvailableFrame(); // 未命中：取空闲帧或淘汰
  UpdateFrame(frame_id, fid, pid);           // 从磁盘读入并建立映射
  return frames_[frame_id].GetPage();
}
```

我重点处理了以下不变量：

1. **引用计数与置换器同步**：只有 `pin_count_` 降到 0 的帧才会进入可淘汰集合；`FetchPage` 命中时同时增加帧引用计数并调用 `replacer_->Pin()`。
2. **脏页回写**：淘汰帧前检查 `is_dirty_`，若为脏则先 `WritePage` 再 `Reset()`，避免数据丢失。
3. **无空闲帧异常**：当 `free_list_` 为空且 `Victim()` 也找不到可淘汰帧时，抛出 `NJUDB_NO_FREE_FRAME`，而不是返回空指针。
4. **删除与清理**：`DeletePage` / `DeleteAllPages` 会先把脏页写回，再从映射表移除并归还 `free_list_`，同时把该帧从置换器候选中移除。
5. **刷盘接口**：`FlushPage` / `FlushAllPages` 按文件粒度选择性写回，供关库和测试使用。

此外，我实现了 `FetchPageRead` / `FetchPageWrite` 返回 `ReadPageGuard` / `WritePageGuard`，用 RAII 保证页面在离开作用域时自动 Unpin，减少手工漏写 Unpin 导致的缓冲池泄漏。

### 2.4 页面句柄与记录布局

`PageHandle` 负责把页内的序列化字节解释为记录：

- 页头保存 `last_lsn`、`next_free_page_id`、`record_num`；
- 位图（Bitmap）标记每个槽位是否被占用；
- 槽位区存放记录数据。

我实现了两种页布局：

**NAry（行存）**：一条记录的所有字段连续存放。

```
| Page Header | Bitmap | Record 1 | Record 2 | ... | Record n |
```

**PAX（列存）**：同一列的字段连续存放，投影查询只需读取涉及的列。

```
| Page Header | Bitmap | NullMap 区 | Column 1 | Column 2 | ... | Column m |
```

PAX 的关键是列偏移计算：在 `TableHandle` 构造时，根据 `nullmap_size_`、`rec_per_page_` 和各字段宽度预先算出每一列的起始偏移，之后 `WriteSlot` / `ReadSlot` 只需按 `field_offset_[i] + slot_id * field_size` 定位。这样避免了每次读写都重新扫描 schema。

`ReadChunk` 进一步把“多行、少列”的读取做成一次页内遍历，只反序列化 `chunk_schema` 指定的列，体现列存对投影查询的优势。

### 2.5 TableHandle：记录级抽象

`TableHandle` 封装表头、记录模式和页句柄，向上提供记录级 CRUD 与遍历：

- **GetRecord(RID)**：检查页号和槽位位图，读取槽位数据构造 `Record`，最后 Unpin；
- **InsertRecord**：从空闲页链表中找页，用 `BitMap::FindFirst` 找空槽，写槽位、置位图、更新页头和表头计数；页满时从空闲链表摘除；
- **DeleteRecord**：清位图、更新计数；页从满变不满时重新挂回空闲页链表头部；
- **UpdateRecord**：原地覆盖槽位数据；
- **GetFirstRID / GetNextRID**：逐页扫描位图实现全表遍历，每次 Fetch 后都确保 Unpin。

空闲页链表是这里的关键设计：表头保存 `first_free_page_`，每个页保存 `next_free_page_id`，插入时 O(1) 找到有空槽的页，避免全表扫描。

### 2.6 这一部分的工程难点

- **页内偏移与内存布局**：所有读写都基于 `char*` 和手工偏移，必须保证页头、位图、槽位区、PAX 列区互不重叠。
- **Pin/Unpin 配对**：任何 `FetchPage` 都必须有对应的 `UnpinPage`，异常路径也要保证释放，否则缓冲池会被逐步耗尽。
- **脏页语义**：读操作不能误标脏，写操作必须标脏；淘汰和删除路径要先写回再重置。
- **边界条件**：空表、空页、满页、最后一个槽位、页号为 `INVALID_PAGE_ID` 等情况都需要显式处理。

---

## 3. 索引引擎（Lab04）

### 3.1 B+ 树索引

B+ 树索引由三类页面组成：

| 页面 | 内容 |
| --- | --- |
| 头部页 | `root_page_id_`、`first_free_page_id_`、`tree_height_`、`page_num_`、`key_size_`、`value_size_`、`leaf_max_size_`、`internal_max_size_`、`num_entries_` |
| 叶子页 | 有序键数组 + RID 数组 + `next_page_id_`（叶子链表） |
| 内部页 | 子页面 ID 数组 + 分隔键数组 + `parent_page_id_` |

所有键和 RID 都以定长二进制形式存放在页面数据区，通过 `KeyAt(i)` / `ValueAt(i)` 按偏移访问，避免反序列化整个节点。

#### 插入与分裂

插入路径：

1. 从根开始，按内部页的分隔键找到目标叶子；
2. 若键已存在则返回；
3. 叶子未满直接插入；
4. 叶子已满则分配新叶子，把一半数据搬到新叶子，维护叶子链表；
5. 取新叶子的第一个键作为提升键，递归插入父节点；
6. 父节点也满时继续分裂，直到根节点；
7. 根节点分裂时创建新根，树高加一。

核心流程可以概括为：

```
Insert(key, rid)
  └─ FindLeafPage(key)
       ├─ 有空间 → LeafPage::Insert
       └─ 已满   → 分裂叶子 → InsertIntoParent(promoted_key)
                        └─ 父节点满 → 分裂父节点 → 递归
                             └─ 根分裂 → InsertIntoNewRoot
```

#### 删除与合并

删除路径：

1. 定位叶子并删除键值对；
2. 若叶子仍然“安全”（删除后不少于最小填充度），直接返回；
3. 否则调用 `CoalesceOrRedistribute`：
   - 若兄弟节点可以借出元素，执行 `Redistribute`，并更新父节点分隔键；
   - 否则执行 `Coalesce`，把两个节点合并，从父节点删除对应键和指针，释放被合并页面；
4. 父节点因此变得不安全时递归向上处理；
5. 根节点为空或只剩一个子节点时，通过 `AdjustRoot` 降低树高。

`IsSafe(bool is_insert)` 把“插入后是否溢出 / 删除后是否下溢”的判断集中在一个函数里，使分裂与合并的触发条件保持一致。

#### 查询、范围查询与迭代器

- `Search(key)`：从根走到叶子，在叶子内二分查找，返回所有匹配 RID；
- `SearchRange(low, high)`：用 `FindLeafPageForRange` 找到 `low` 所在叶子，然后沿 `next_page_id_` 遍历叶子链表，用 `LowerBound` 定位起点，直到键超过 `high`；
- `Begin()` / `Begin(key)`：构造指向最左叶子或第一个 `>= key` 位置的迭代器；
- `BPTreeIterator::Next()`：页内索引加一，越界时跳到下一个叶子，最后一个叶子之后置为无效。

范围查询的时间复杂度是 `O(log n + k)`（`k` 为结果数量），不会退化为全表扫描。

#### 并发控制

索引层使用 `std::shared_mutex index_latch_`：

- `Insert`、`Delete`、`Clear` 等修改操作获取 `std::unique_lock`；
- `Search`、`SearchRange`、`Begin` 等只读操作获取 `std::shared_lock`；
- 利用 RAII 在函数返回或异常时自动释放锁。

这是粗粒度但正确的并发方案：实现简单、语义清晰，适合当前阶段；后续可以演进为 latch coupling / crabbing 以降低锁竞争。

### 3.2 IndexHandle：索引与记录的桥接

B+ 树和哈希索引只认识“键 + RID”，而执行器手里是完整记录。`IndexHandle` 负责两者之间的转换：

- **ExtractKeyFromRecord**：按索引键的 schema，从完整记录中取出对应字段，构造索引键；
- **InsertRecord / DeleteRecord**：抽取键后调用底层索引；
- **UpdateRecord**：比较新旧键，只有键发生变化时才删除旧键、插入新键，避免无谓的索引维护；
- **CheckRecordExists**：在唯一索引上执行一次 `Search`，用于插入/更新前的唯一性校验。

```cpp
void IndexHandle::UpdateRecord(const Record &old_rec, const Record &new_rec) {
  Record old_key = ExtractKeyFromRecord(old_rec);
  Record new_key = ExtractKeyFromRecord(new_rec);
  if (Record::Compare(old_key, new_key) != 0) {
    index_->Delete(old_key);
    index_->Insert(new_key, new_rec.GetRID());
  }
}
```

这段逻辑体现了“索引是表的派生结构”这一设计原则：索引的维护由句柄统一负责，执行器不需要关心底层是 B+ 树还是哈希表。

### 3.3 IdxScanExecutor：把谓词变成索引范围

优化器根据 **最左前缀匹配** 判断某个索引能否被使用，并把条件分成“索引条件”和“剩余条件”。`IdxScanExecutor` 接收全部条件，但只用车索引条件生成边界：

- `OP_EQ`：同时设置下界和上界；
- `OP_GT` / `OP_GE`：更新下界；
- `OP_LT` / `OP_LE`：更新上界；
- 未指定的列用该类型的最小值/最大值填充；
- 若下界大于上界，直接判定为空范围。

生成边界后调用 `SearchRange` 得到候选 RID，再逐条回表并用 `CheckAllConditions` 校验 **所有** 条件（包括非索引条件）。这样即使 `SearchRange` 返回的是闭区间结果，开区间谓词（如 `salary > 50000`）也会在回表阶段被正确过滤。

扫描方向由 `is_ascending_` 控制：降序时把 RID 列表反转即可复用同一套范围查询逻辑。

### 3.4 哈希索引（附加模块）

哈希索引采用三级页面结构：

| 页面 | 作用 |
| --- | --- |
| `HashHeaderPage` | 桶数量、总条目数、下一个可分配页面 ID |
| `HashBucketDirectory` | 每个桶的头页面 ID |
| `HashBucketPage` | 实际键值对 + 溢出链指针 + 条目数 |

插入时计算 `key.Hash() % bucket_count_` 定位桶；桶页满时分配新页并挂到溢出链上。删除时采用 **与末尾条目交换** 的方式，避免移动大量数据。迭代器按“桶 → 页面链 → 页内条目”的顺序遍历。

哈希索引的等值查询是 O(1) 期望复杂度，但不支持高效范围查询；因此 `SearchRange` 退化为扫描所有桶。这一取舍在实现中是显式的：用等值查询性能换范围查询能力，和 B+ 树形成互补。

### 3.5 测试与结果

B+ 树测试使用 GoogleTest，覆盖 19 个用例，包括：

| 测试 | 规模/内容 | 结果 |
| --- | --- | --- |
| `InsertBatch` | 10,000 条随机顺序插入 | 通过（816 ms） |
| `DeleteBatch` | 10,000 条插入后删除全部偶数键 | 通过（906 ms） |
| `LargeDataset` | 100,000 条插入 + 大范围查询 | 通过（31.2 s） |
| `MixedOperations` | 10,000 次随机插入/删除/查询 | 通过（1.26 s） |
| `GeneralizedRangeSearch` | 开区间、闭区间、越界、单元素范围 | 通过 |
| `BoundedIteratorTest` | 有界迭代与跨页边界 | 通过 |
| `DeleteBatchDebug` | 每隔一个删除并逐步校验 | 通过 |

`MixedOperations` 的具体负载：

```
Inserts: 452
Deletes: 2939
Searches: 3327
Final keys in tree: 7513
```

最终 **19/19 全部通过**，测试结果日志见 [`reports/lab04-bptree-test.log`](reports/lab04-bptree-test.log)（已省略 10 万条插入进度输出）。

Lab01 的 LRU、LRU-K、BufferPoolManager、TableHandle、NAryPageHandle、PAXPageHandle 测试也全部通过；其中 PAX 的 `ReadChunk` 通过投影读取验证了列存路径的正确性。

---

## 4. 这份作品体现的工程能力

| 能力维度 | 具体体现 |
| --- | --- |
| **系统级 C++** | 直接操作 `char*` 页面内存，手工计算页头/位图/槽位/列偏移；用定长序列化避免额外分配 |
| **数据结构与算法** | 双向链表 + 哈希表实现 O(1) LRU；时间戳队列实现 LRU-K；B+ 树分裂/合并/重分配；哈希桶 + 溢出链 |
| **并发编程** | `std::mutex` 保护置换器；`std::shared_mutex` 区分索引读写；RAII 锁与页面 Guard 保证异常安全 |
| **资源管理** | Pin/Unpin 引用计数、脏页写回、空闲帧链表、页面 Guard 自动释放，避免缓冲池泄漏 |
| **性能意识** | 哈希表 O(1) 页查找、叶子链表范围扫描、PAX 投影下推、删除时交换末尾元素、减少无用拷贝 |
| **测试与调试** | 19 个 GoogleTest 用例覆盖分裂、合并、边界、10 万级数据与随机混合负载；用 trace 宏定位递归分裂/合并问题 |
| **抽象与分层** | `PageHandle` / `TableHandle` / `Index` / `IndexHandle` 接口清晰，行存与列存、B+ 树与哈希索引可替换 |
| **工程规范** | CMake 组织模块、GoogleTest 回归、Git 版本管理、异常类型与错误信息统一 |

### 4.1 我遇到的最大挑战

1. **B+ 树分裂/合并的指针维护**：叶子分裂要同时更新 `next_page_id_`、父节点分隔键和新节点的 `parent_page_id_`；内部节点合并还要把父节点的分隔键下移到合并后的节点。任何一个指针漏更新，都会在后续范围查询或删除时暴露为死循环/丢数据。
2. **删除后的下溢传播**：删除可能触发连锁合并，直到根节点。`CoalesceOrRedistribute` 的递归终止条件、根节点特判、兄弟节点选择（左兄弟优先）必须严格对应。
3. **缓冲池生命周期**：最初容易漏掉异常路径的 Unpin；后来统一用 PageGuard 和“每个 Fetch 必须配对 Unpin”的检查习惯解决。
4. **范围查询边界**：开区间/闭区间、`LowerBound`/`UpperBound`、空树、越界范围等组合很多，最终用参数化测试逐条覆盖。

### 4.2 可继续演进的方向

- 将索引的全局读写锁细化为 latch coupling / crabbing，降低高并发下的锁竞争；
- 为哈希索引增加有序桶或跳表，使范围查询不必全桶扫描；
- 引入 WAL 与 ARIES 恢复，让缓冲池的脏页回写与崩溃恢复协同；
- 为执行器增加向量化批处理，进一步发挥 PAX 列存的优势。

---

## 5. 代码导航

| 路径 | 内容 |
| --- | --- |
| `src/storage/buffer/replacer/lru_replacer.cpp` | LRU 置换器：链表 + 哈希表 |
| `src/storage/buffer/replacer/lru_k_replacer.cpp` | LRU-K 置换器：访问历史与反向 K 距离 |
| `src/storage/buffer/buffer_pool_manager.cpp` | 缓冲池：Fetch/Unpin/Delete/Flush、空闲帧与淘汰 |
| `src/storage/buffer/frame.h`、`page_guard.*` | 物理帧与 RAII 页面守卫 |
| `src/system/handle/page_handle.cpp` | 页内位图、槽位读写、NAry/PAX 布局 |
| `src/system/handle/table_handle.cpp` | 表头、空闲页链表、记录 CRUD、全表遍历 |
| `src/storage/index/index_bptree.cpp` | B+ 树：插入、删除、分裂、合并、范围查询、迭代器 |
| `src/storage/index/index_hash.cpp` | 哈希索引：目录页、桶页、溢出链、迭代器 |
| `src/system/handle/index_handle.cpp` | 索引键抽取、索引维护、唯一性检查 |
| `src/execution/executor_idxscan.cpp` | 索引扫描：边界生成、回表过滤、升降序 |

> 说明：本仓库以课程提供的 NJUDB 框架为底座，本文描述的两个模块为本人实现；其余模块保留框架原始接口或占位实现。

---

## 附录：原始实验报告

- [Lab01 实验报告（PDF）](reports/lab01_231220013_Li_Yujiang.pdf)
- [Lab04 实验报告（PDF）](reports/lab04_231220013_Li_Yujiang.pdf)
- [Lab04 B+ 树测试日志](reports/lab04-bptree-test.log)
