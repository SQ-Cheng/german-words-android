# 德语单词 Android

独立 Android Studio 项目，来自「德语单词记忆助手 4.0」。原版 HTML 和词库未修改。

[下载安装包](https://github.com/SQ-Cheng/german-words-android/releases/latest) · [PDF 使用说明](output/pdf/GermanWordsAndroid-User-Guide.pdf) · [图片使用说明](output/pdf/GermanWordsAndroid-User-Guide.png) · [问题与建议](https://github.com/SQ-Cheng/german-words-android/issues)

## 使用

应用名称：**德语单词**，当前版本 **1.0.1**（versionCode 2）。首次打开直接进入 E1；课程标题右侧的菜单可选择 E1–E7 或「虚词大盘点」。内置 8 份 Excel、460 个词条及全部对应录音，安装后无需联网。

| 网页版功能 | Android 版本 |
| --- | --- |
| 导入整个文件夹、导入 XLSX | 系统文件选择器；递归读取子文件夹并保存到应用内部存储 |
| 多工作表、表头别名、例句 | 保留原版解析规则；原生 Java 解压，不依赖新版浏览器解压接口 |
| 普通 / 中文 / 德语自测 | 卡片和列表均支持；列表逐条显示或隐藏答案 |
| 名词冠词、复数、背景颜色 | 保留 der / die / das 对应颜色；答案揭晓前不泄露颜色 |
| 卡片、列表、乱序、星标筛选 | 手机列表改为纵向词条；再次点击乱序恢复 Excel 顺序，筛选保留乱序 |
| 音频匹配、手动及自动播放 | 保留路径、大小写、变音字符和同名单元匹配；Android MediaPlayer 播放 |
| 星标保存、键盘快捷键 | 保留；新增每词表位置与乱序顺序保存、左右滑动、进度备份和恢复 |

词库菜单中「导入文件夹」可选择包含 Excel 和音频的文件夹。也可多选单个 `.xlsx` 和音频文件。导入后复制到应用内部存储，之后不依赖原始文件路径。旧版 `.xls` 与网页版一样需在 Excel/WPS 中另存为 `.xlsx`。

「备份学习进度」导出星标和学习设置 JSON；通过「导入 Excel / 音频 / 备份」恢复。备份不包含自定义 Excel 和音频，需要另行保留原文件。

## 兼容与架构

- 最低 Android 6.0（API 23）；compileSdk / targetSdk 35。
- 纯 Java Android 宿主 + 本地 HTML/CSS/JavaScript 学习引擎，不含 CPU 架构专属原生库，适用于 ARM、ARM64 和 x86 设备。
- 支持手机、横屏、平板、刘海和系统栏边距。跟随系统字体大小，大字体使用可滚动页面并允许控件换行；真机已测试 100%–200% 文本缩放及 320dp 窄屏。建议使用可更新的 Android System WebView；页面布局需要 Chromium 87 及以上，Android 6.0 的原始旧 WebView 应先更新。
- 不申请互联网和整个存储空间权限。使用系统文件选择器授权读取；固定 HTTPS 本地域名的资源由应用拦截提供，禁止外部页面、file:// 和内容 URI 浏览。
- 发音使用本地录音，不要求设备安装德语 TTS。音频格式支持程度取决于设备解码器；内置 MP3 全部完成匹配检查。
- 原生文件选择器与本地 WebView 资源的做法参考 [Android 文件访问文档](https://developer.android.com/training/data-storage/shared/documents-files) 和 [加载应用内网页内容](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)。

## 开发与编译

用 Android Studio 打开本文件夹。当前电脑使用 `E:\Android Studio\jbr` 与 `E:\Android\SDK`；其他电脑需修改 `local.properties`。项目使用 Android Gradle Plugin 8.8.0、Gradle 8.11.1，Gradle Wrapper 已包含。

PowerShell：

```powershell
$env:JAVA_HOME = 'E:\Android Studio\jbr'
.\gradlew.bat assembleDebug lintDebug
node .\tools\test-engine.mjs
```

APK：`app/build/outputs/apk/debug/app-debug.apk`。这是使用 Android 默认开发签名的可安装测试版本；上架或正式发布需要独立发布签名。

`engine.js`、`index.html`、`mobile.css`、`mobile.js` 直接维护 Android 版本，已移除容易覆盖修改的 HTML 字符串替换生成器。更新内置 `words` 文件后执行 `python tools/index-assets.py` 重建资源索引。

本文件夹独立使用 Git 管理；`v1.0.0` 保留初始实现，`v1.0.1` 包含本次修复。构建目录、APK、设备截图、日志和本机 SDK 路径不入库。

## 验证

- `tools/test-engine.mjs`：读取实际 8 份 Excel；460/460 词条都匹配录音；覆盖乱序切换与恢复、筛选后的完整顺序保存、列表双向自测、自动发音计时器、失效或失败的异步读取、星标、空筛选及特殊字符。
- `app/src/androidTest/`：在手机真实 WebView 中测试同一学习引擎、每词表位置恢复、列表、返回操作与触控布局；测试原生 MediaPlayer 和文件内容 URI 导入流程。测试专用内容提供器只在测试 APK 中存在。
- 真机：小米 14（23127PN0CC），Android 16 / API 36，1200 × 2670，Android System WebView 143。实际测试范围以 `artifacts/verification.md` 为准；没有在所有旧手机或所有厂商设备上测试。

运行真机测试：

```powershell
.\gradlew.bat assembleDebug assembleDebugAndroidTest
& 'E:\Android\SDK\platform-tools\adb.exe' install -r .\app\build\outputs\apk\debug\app-debug.apk
& 'E:\Android\SDK\platform-tools\adb.exe' install -r .\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
& 'E:\Android\SDK\platform-tools\adb.exe' shell am instrument -w cn.study.germanwords.test/cn.study.germanwords.SmokeInstrumentation
```

部分小米系统需要在运行测试时另行启动应用，并允许 USB 安装。测试会恢复原有星标、学习设置和导入目录。

当前电脑可直接运行 `python .\tools\device-test.py 52ec00da`，脚本会安装两个 APK、启动测试提供器并处理前台启动。测试结束后，可用 `adb uninstall cn.study.germanwords.test` 移除测试辅助包；主应用保留。

## GitHub 项目与反馈

公开仓库：[SQ-Cheng/german-words-android](https://github.com/SQ-Cheng/german-words-android)。源代码、更新记录与 PDF 使用说明在仓库中；[Releases](https://github.com/SQ-Cheng/german-words-android/releases) 提供可安装 APK 和说明书下载。

遇到问题或有改进建议，请登录 GitHub，在 [Issues](https://github.com/SQ-Cheng/german-words-android/issues) 中点击 **New issue**。描述操作步骤、预期结果、实际情况，并提供手机型号、Android 版本和应用版本；需要时附截图。

也可扫描使用说明末尾的问卷星二维码填写反馈；说明书提供 PDF 和高清 PNG 两种格式。
