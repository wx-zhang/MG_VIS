# 室内模型来源

从用户指定的本地 agentcity（qee@64ae5aa）迁移独立 Three.js 室内渲染模块。使用原版玻璃光学、办公桌面、软包座椅、键盘、灯具、杯具、植物、地板纹理与窗户反射环境。未导入 Vue、Mock、Task 或机构业务模型。

适配项：officeShell 可关闭参考城市窗外背景与前侧入口，适合现有 Device 房间和 Actor 坐标；React 包装组件负责资源生命周期。材质素材随项目本地加载，见 public/maps/marlow-green/office/REFERENCE-ASSET-SOURCES.md 的来源与授权记录。
