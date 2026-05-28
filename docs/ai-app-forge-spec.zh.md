# AI App Forge 需求理解与产品 Spec

## 1. 需求理解

AI App Forge，中文名为“一句话应用工厂”，目标是让用户通过一句自然语言描述，快速生成一个可运行、可预览、可分享、可继续修改的小工具或小游戏。

这个产品的第一价值不是直接展示“AI 会写代码”，而是让用户先看到 AI 创造出的有趣结果。用户输入一个想法，系统把它转成规格文档、代码、测试和可访问页面。用户体验上像一个创作玩具，工程实现上则是一个完整的 AI coding 流水线。

MVP 聚焦两类生成结果：

- 小工具：番茄钟、倒计时、预算计算器、抽奖转盘、投票器、Markdown 排版器、BMI 计算器等。
- 小游戏：躲避游戏、接水果、记忆翻牌、点击挑战、答题闯关、2048 变体、文字冒险等。

用户的核心路径是：

1. 用户输入一句话需求。
2. 系统识别应用类型和意图。
3. AI 生成结构化 Spec。
4. AI 根据 Spec 生成代码。
5. 系统构建、测试并自动修复。
6. 用户进入预览页体验应用。
7. 用户继续用自然语言修改。
8. 用户保存、分享或 Remix。

## 2. 产品定位

### 2.1 一句话定位

用户用一句自然语言描述想法，AI App Forge 自动生成可运行、可分享、可继续修改的小工具或小游戏。

### 2.2 目标用户

- 普通用户：想快速做一个好玩或实用的小应用。
- 学生和创作者：想把创意变成可玩的互动作品。
- 产品经理：想快速验证一个交互想法。
- 独立开发者：想快速生成小工具原型。
- AI 初学者：想通过可见结果理解 AI coding 的能力。

### 2.3 核心价值

- 降低创作门槛：用户不需要懂代码。
- 快速获得反馈：生成结果可以马上预览和使用。
- 提升传播性：每个应用都可以分享或 Remix。
- 展示 AI coding 能力：从自然语言到 Spec、代码、测试、预览的完整闭环。

## 3. MVP 范围

### 3.1 必须支持

- 一句话提交需求。
- 自动判断生成“小工具”或“小游戏”。
- 自动生成应用 Spec。
- 自动生成前端代码。
- 自动构建并生成预览。
- 自动执行基础测试。
- 测试失败后进行有限次数自动修复。
- 支持自然语言二次修改。
- 支持保存版本。
- 支持分享公开预览链接。

### 3.2 暂不支持

- 复杂后端业务系统。
- 用户自定义数据库表。
- 支付系统。
- 多人实时协作。
- 插件市场。
- 企业级权限管理。
- 原生移动应用生成。

## 4. 核心页面

### 4.1 首页 / Prompt 输入页

目标：让用户立即输入一句想法。

主要元素：

- 产品名称：AI App Forge / 一句话应用工厂。
- Prompt 输入框。
- 应用类型快捷选项：小工具、小游戏、自动判断。
- 风格快捷选项：简洁、可爱、像素、赛博、清新、专业。
- 示例 Prompt。
- 生成按钮。

验收标准：

- 用户可以输入自然语言需求。
- 用户可以直接点击示例填入输入框。
- 用户点击生成后进入生成任务页。

### 4.2 生成进度页

目标：让用户理解 AI 正在做什么，并降低等待焦虑。

步骤展示：

- 理解需求。
- 生成 Spec。
- 规划文件结构。
- 编写代码。
- 构建应用。
- 运行测试。
- 自动修复。
- 生成预览。

验收标准：

- 显示当前步骤和状态。
- 失败时显示可理解的错误信息。
- 成功后自动进入预览页。

### 4.3 应用预览页

目标：让用户直接使用生成结果。

布局建议：

- 左侧或主区域：应用预览 iframe。
- 右侧：修改对话框。
- 顶部：应用名称、保存、分享、Remix、版本切换。
- 可选 Tab：预览、Spec、代码、测试结果。

验收标准：

- 用户可以操作生成应用。
- 用户可以输入修改要求。
- 用户可以查看 Spec。
- 用户可以查看测试结果。
- 用户可以复制分享链接。

### 4.4 作品广场页

目标：增强传播和灵感发现。

主要元素：

- 热门作品。
- 最新作品。
- 小工具分类。
- 小游戏分类。
- Remix 按钮。

MVP 可以后置，但数据结构需要预留。

## 5. AI 生成流水线

### 5.1 总流程

```text
User Prompt
  -> Intent Classification
  -> App Spec Generation
  -> Implementation Plan
  -> Code Generation
  -> Build
  -> Test
  -> Auto Fix
  -> Preview
  -> Publish / Share
```

### 5.2 Agent 分工

#### Intent Agent

输入：用户的一句话需求。

输出：

- 应用类型：tool 或 game。
- 应用名称。
- 核心目标。
- 复杂度等级。
- 是否需要澄清。

#### Spec Agent

输入：用户 Prompt 和 Intent。

输出：

- 结构化 App Spec。
- UI Spec。
- 测试 Spec。

#### Planner Agent

输入：App Spec。

输出：

- 文件树。
- 组件拆分。
- 状态设计。
- 测试计划。

#### Coder Agent

输入：Implementation Plan。

输出：

- 代码文件列表。
- 静态资源占位方案。
- package.json。

#### Test Agent

输入：App Spec 和代码。

输出：

- 单元测试。
- 冒烟测试。
- Playwright 行为测试。

#### Fix Agent

输入：构建日志、测试日志、失败截图、当前代码。

输出：

- 修复后的文件 diff。
- 修复说明。

## 6. Spec 数据结构

### 6.1 App Spec

```json
{
  "id": "app_123",
  "appType": "tool",
  "name": "旅行预算计算器",
  "description": "帮助用户估算多人旅行总预算和人均费用",
  "targetUser": "普通旅行用户",
  "features": [
    "输入人数、天数、交通费、住宿费、餐饮费、娱乐费",
    "自动计算总费用和人均费用",
    "显示费用占比",
    "支持重置"
  ],
  "style": {
    "tone": "clean",
    "theme": "colorful",
    "responsive": true
  },
  "persistence": {
    "type": "localStorage",
    "required": true
  },
  "constraints": [
    "必须是单页应用",
    "必须支持移动端",
    "不得依赖复杂后端"
  ]
}
```

### 6.2 Tool Spec

```json
{
  "tool": {
    "inputs": [
      {
        "name": "people",
        "label": "人数",
        "type": "number",
        "required": true,
        "defaultValue": 2
      }
    ],
    "outputs": [
      {
        "name": "totalCost",
        "label": "总预算",
        "type": "currency"
      }
    ],
    "actions": ["calculate", "reset"],
    "validation": [
      "人数必须大于 0",
      "费用不能小于 0"
    ]
  }
}
```

### 6.3 Game Spec

```json
{
  "game": {
    "genre": "dodge",
    "objective": "控制角色躲避下落障碍并获得高分",
    "mechanics": [
      "玩家左右移动",
      "障碍物从顶部下落",
      "碰撞后游戏结束",
      "分数随存活时间增加"
    ],
    "controls": ["keyboard", "touch"],
    "screens": ["start", "playing", "gameOver"],
    "difficulty": {
      "scaling": "speed_increases_over_time"
    }
  }
}
```

### 6.4 Test Spec

```json
{
  "tests": {
    "build": [
      "项目可以成功安装依赖",
      "项目可以成功构建"
    ],
    "smoke": [
      "页面可以打开",
      "页面不是白屏",
      "主要交互控件可见"
    ],
    "behavior": [
      "用户完成核心操作后得到正确反馈",
      "重置或重新开始功能可用",
      "移动端布局无明显溢出"
    ]
  }
}
```

## 7. 技术架构

### 7.1 前端

推荐：

- Next.js
- TypeScript
- Tailwind CSS
- Monaco Editor
- iframe Preview

前端职责：

- Prompt 输入。
- 生成任务状态展示。
- 应用预览。
- Spec 展示。
- 代码展示。
- 测试结果展示。
- 修改对话。
- 分享和 Remix。

### 7.2 后端

推荐：

- Node.js + NestJS，或 Python + FastAPI。
- PostgreSQL 存储项目、版本、任务、Spec。
- Redis + 队列系统处理异步生成。
- Docker 沙箱执行构建和测试。
- 对象存储保存构建产物。

后端职责：

- 创建生成任务。
- 调用 AI 模型。
- 管理 Spec 和代码版本。
- 写入生成文件。
- 执行构建和测试。
- 自动修复失败结果。
- 发布静态预览。

### 7.3 生成应用技术栈

MVP 推荐：

- React
- TypeScript
- Vite
- CSS Modules 或普通 CSS
- Vitest
- Playwright

小游戏可以先使用：

- Canvas 2D
- 后续再支持 Phaser

## 8. 数据模型

### 8.1 Project

```text
id
name
description
owner_id
visibility
created_at
updated_at
```

### 8.2 AppGeneration

```text
id
project_id
prompt
app_type
status
current_step
error_message
created_at
updated_at
```

### 8.3 AppVersion

```text
id
project_id
version_number
spec_json
source_snapshot_path
build_artifact_path
preview_url
test_result_json
created_at
```

### 8.4 GenerationRun

```text
id
project_id
version_id
run_type
status
logs
started_at
finished_at
```

### 8.5 PublicShare

```text
id
project_id
version_id
slug
is_active
created_at
```

## 9. API 草案

### 9.1 创建生成任务

```http
POST /api/generations
```

Request:

```json
{
  "prompt": "做一个像素风躲避 bug 的小游戏",
  "appType": "auto",
  "style": "pixel"
}
```

Response:

```json
{
  "generationId": "gen_123",
  "projectId": "proj_123",
  "status": "queued"
}
```

### 9.2 查询生成状态

```http
GET /api/generations/{generationId}
```

Response:

```json
{
  "generationId": "gen_123",
  "status": "running",
  "currentStep": "code_generation",
  "progress": 60
}
```

### 9.3 获取应用版本

```http
GET /api/projects/{projectId}/versions/{versionId}
```

Response:

```json
{
  "projectId": "proj_123",
  "versionId": "ver_1",
  "spec": {},
  "previewUrl": "https://preview.example.com/app_123",
  "testResult": {}
}
```

### 9.4 提交修改需求

```http
POST /api/projects/{projectId}/modify
```

Request:

```json
{
  "baseVersionId": "ver_1",
  "prompt": "把难度提高一点，并加一个重新开始按钮"
}
```

Response:

```json
{
  "generationId": "gen_456",
  "status": "queued"
}
```

### 9.5 创建分享链接

```http
POST /api/projects/{projectId}/share
```

Response:

```json
{
  "shareUrl": "https://appforge.example.com/s/bug-dodge"
}
```

## 10. 验收标准

### 10.1 MVP 验收

- 用户可以输入一句话生成一个小工具。
- 用户可以输入一句话生成一个小游戏。
- 生成应用可以在浏览器中运行。
- 生成应用支持桌面端和移动端基本使用。
- 生成过程可视化展示。
- 每次生成都保存 Spec。
- 生成失败时显示失败原因。
- 系统至少执行构建测试和冒烟测试。
- 用户可以通过一句话修改已生成应用。
- 用户可以分享生成结果。

### 10.2 质量标准

- 生成应用首屏不能白屏。
- 主要按钮和输入框不能溢出。
- 小工具计算结果必须符合 Spec。
- 小游戏必须有开始、进行中、结束或重新开始状态。
- 自动修复最多执行 3 次。
- 每次 AI 修改必须生成新版本，不覆盖旧版本。

## 11. 后续开发路线

### V0.1 本地原型

- 命令行输入 Prompt。
- 生成 Spec。
- 生成 Vite React 项目。
- 本地构建和测试。
- 输出本地预览地址。

### V0.2 Web MVP

- Web 输入 Prompt。
- 后端异步任务生成。
- 展示生成进度。
- 提供 iframe 预览。
- 支持查看 Spec 和测试结果。

### V0.3 二次修改

- 支持对已有版本提交修改。
- 显示版本历史。
- 支持回滚。
- 支持代码 diff。

### V0.4 分享与 Remix

- 公开分享链接。
- 作品广场。
- 用户 Remix 他人作品。
- 热门模板。

## 12. 首个 Demo 建议

建议第一个 Demo 做成：

```text
输入：做一个像素风躲避 bug 的小游戏，主角是程序员，吃咖啡可以加分。
输出：一个可玩的 Canvas 小游戏，支持键盘和触摸操作，有开始页、得分页、结束页和重新开始按钮。
```

第二个 Demo 做成：

```text
输入：做一个旅行预算计算器，可以输入人数、天数、交通、住宿、餐饮和娱乐费用。
输出：一个移动端友好的预算小工具，显示总费用、人均费用和费用占比。
```

这两个 Demo 可以同时证明“好玩”和“实用”，非常适合展示 AI App Forge 的产品方向。
