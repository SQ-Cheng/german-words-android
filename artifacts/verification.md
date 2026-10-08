# 开发与真机验证记录

日期：2026-10-08（Asia/Shanghai）

交付：`GermanWords-1.0.0.apk`，4,458,216 字节；包名 `cn.study.germanwords`，版本 1.0.0，开发签名。

SHA-256：`63ee3e5154608bd85ec3e36cd542c90236574bc854b7377c4ccac4ae2766ba83`

## 结果

| 检查 | 结果 |
| --- | --- |
| Gradle assembleDebug / assembleDebugAndroidTest | 通过 |
| Android lintDebug | 通过，0 错误、3 警告 |
| 实际 8 份内置 Excel | 460 个词条全部读取 |
| 内置音频匹配 | 460 / 460 词条匹配录音 |
| Node 学习引擎测试 | 通过：Java 解压桥接的等价实现、列名映射、模式、导航、乱序、星标与空筛选；同名导入音频优先级回归测试 |
| 真实 WebView 测试 | 通过：原生 Java 解压、三种模式、答案与音频隐藏、星标保存、空筛选、翻页、词表位置恢复、列表、返回操作和字面文本 |
| Android MediaPlayer | 内置 MP3 与导入 MP3 都进入实际播放状态 |
| 文件导入 | 通过：文件夹递归读取、嵌套音频匹配、单独 XLSX 导入、导入后自动选择新词表 |
| 手机布局 | 竖屏截图检查；横屏布局断言通过；系统栏重叠已修复 |
| APK 签名 | apksigner 验证通过，v1 / v2 签名 |
| 安装 | 小米 14 安装成功，版本及包名已确认 |
| 手机 APK | `/sdcard/Download/GermanWords-1.0.0.apk`，手机与电脑 SHA-256 一致 |
| 测试清理 | 测试辅助包已卸载；导入测试文件已清理；原有星标与设置已恢复；主应用已启动 |

设备：小米 14（23127PN0CC / houji），Android 16 / API 36，1200 × 2670，480 dpi，Android System WebView 143。

三个 Lint 警告分别涉及 targetSdk 35、仅新系统使用的返回手势属性及启用 JavaScript。返回行为在新系统上显式使用 Activity 返回处理；WebView 只允许固定本地域名、禁止外部页面及文件访问，导入文本使用 textContent。

完整测试输出在 `device-test.log`，最终竖屏截图在 `phone-portrait.png`。导入测试通过测试专用内容提供器向 Activity 提供 content URI，执行实际递归读取、复制、保存索引和播放流程；未自动点击每种厂商的文件选择器。旧系统和不同厂商设备没有逐一实测；最低 Android 6.0，需可运行现代脚本的 Android System WebView（Chromium 70+）。
