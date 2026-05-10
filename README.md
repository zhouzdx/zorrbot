# Zorr Bot

zorr.pro 自动挂机浏览器扩展。自动打怪、收集花瓣、躲避伤害、跟随玩家，支持多区域识别与撞墙脱困。

## 安装

### Chrome 扩展方式（推荐）

1. 打开 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `release\v2.0\zorr-bot-extension\` 文件夹

或者从 [GitHub Releases](https://github.com/zhouzdx/zorrbot/releases) 下载 `zorr-bot-extension.zip` 解压后加载。

### 项目依赖（仅测试脚本需要）

```bash
npm install
```

## 使用

1. 打开 [zorr.pro](https://zorr.pro)
2. 点击浏览器工具栏的 Zorr Bot 图标打开控制面板
3. 点击 **启动挂机**

### 控制面板说明

| 功能 | 说明 |
|---|---|
| 自动攻击 | 自动检测并攻击范围内的怪物 |
| 自动拾取 | 自动收集掉落的花瓣 |
| 躲避伤害 | 近距离威胁自动远离 |
| 攻击范围 | 设置攻击距离（50-300px） |
| 扫描半径 | 设置视野范围（100-500px） |
| 跟随玩家 | 开启后自动跟随最近或指定玩家 |
| 区域显示 | 底部实时显示当前所在区域 |

## 功能特性

### 视觉检测模型 v2.0

基于 Canvas 像素分析的视觉系统，可识别：
- **草地/石径/泥地** — 背景过滤，不误判
- **红色/棕色/绿色怪物** — 分类为威胁目标
- **金色掉落物** — 分类为战利品
- **蓝色玩家** — 分类为友方
- **深绿色灌木/墙壁** — 分类为障碍物，不攻击

### 撞墙检测

通过 8 方向像素指纹判断是否卡住，自动尝试垂直滑行脱困。

### 出生安全

前 6 秒只逃跑不攻击，避免出生点 Target Dummy 击杀。

### 平滑移动

方向不变时不重复释放按键，移动不卡顿。

### 区域识别

根据地形颜色自动识别当前所在区域（平原/泥地/岩石区等）。

### 死亡处理

自动点击 Continue 按钮或按 Escape 键复活。

## 项目结构

```
D:\z计划\
├── zorr-bot-extension\          ← 当前开发中的扩展源码
│   ├── manifest.json            ← Chrome 扩展清单
│   ├── content.js               ← 核心逻辑（视觉检测+决策引擎）
│   ├── background.js            ← Service Worker（CDP 事件转发）
│   ├── bridge.js                ← 消息桥接（ISOLATED world）
│   ├── popup.html / .js / .css  ← 控制面板
│   └── icons\                   ← 扩展图标
│
├── versions\                    ← 历史版本快照
│   └── v2.0\zorr-bot-extension\
│
├── release\                     ← 发布版本
│   └── v2.0\
│       ├── zorr-bot-extension\  ← 解压即用
│       └── zorr-bot-extension.zip
│
├── bump-version.ps1             ← 版本升级脚本
├── *.mjs                        ← Playwright 测试脚本
└── README.md
```

## 版本升级

```powershell
.\bump-version.ps1              # 自动 +1 小版本
.\bump-version.ps1 -NewVersion v3.0  # 指定版本
```

脚本会自动：更新版本号 → 归档到 `versions\` → 创建 `release\` + zip。

## 发布流程

```bash
git add -A
git commit -m "v2.1 新功能说明"
git push
gh release create v2.1 --title "v2.1" --notes "更新内容" release/v2.1/zorr-bot-extension.zip
```

## 技术栈

- Chrome Extension (Manifest V3)
- Chrome Debugger API (CDP) — 发送受信任的键盘/鼠标事件
- Canvas 2D API — 像素级游戏状态分析
- Playwright — 浏览器自动化测试

## 链接

- 游戏: https://zorr.pro
- 仓库: https://github.com/zhouzdx/zorrbot
- Release: https://github.com/zhouzdx/zorrbot/releases
