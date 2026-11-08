# 第三方组件说明

DSH Task Shelf 自有代码使用 MIT 许可证，见 LICENSE。

插件通过 package.json 中声明的 @deepseek-ai peerDependencies 使用 DSH 官方接口；React 由宿主提供。这些外部组件不随本项目安装包分发，其许可证以各自组件附带的声明为准。本项目的 MIT 声明不替代第三方组件的许可证。

## Feather 界面图标

1.1.0 的界面图标来自 [Feather](https://github.com/feathericons/feather)，采用 MIT 许可证。仅将以下官方 SVG 的图形节点转换为 React createElement 数据，未修改图形几何，不需要运行时下载或额外依赖。

- 来源目录：https://github.com/feathericons/feather/tree/main/icons
- 获取日期：2026-11-08
- 本地文件：src/icons.js；构建后包含于 lib/client.js
- 图标：folder、message-square、arrow-up-right、arrow-right、arrow-left、more-horizontal、plus、search、chevron-down、trash-2、check、edit-3、info、x
- 每个源文件的 Git blob SHA 记录在 src/icons.js 顶部。
- 许可证来源：https://github.com/feathericons/feather/blob/main/LICENSE
- 许可证 Git blob SHA：1f4f4336baff1185dc78ae9e78cac46628dcc869

```text
The MIT License (MIT)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 历史主题资源

仓库中的 icon.svg 是项目内生成的 SVG。1.0.1–1.0.3 使用了基于作者提供的“大肥鱼”角色截图、经 AI 编辑整理的主题图片（assets/fat-fish-sky.png）。1.1.0 界面已移除此主题图，不再内嵌或打包该图片；源码仓库保留历史资源。代码的 MIT 许可不代表授予第三方角色或原始参考图的权利。

安装包不包含原始手机截图、宿主运行时、用户聊天或模型凭据。后续新增第三方图片、字体或代码时，应在此补充来源与许可。
