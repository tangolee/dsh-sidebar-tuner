# 第三方资源

## Lucide 图标

`index.js` 里 `RAIL_ICONS` 的四枚图标（`palette` / `sliders-horizontal` / `swatch-book` / `paintbrush`）内联自
[Lucide](https://lucide.dev)，取的是 `lucide-static` v1.73.0 的 SVG 路径，未做改动（只把 `stroke-width` 调到 1.8 以对齐 DSH 侧栏的线宽）。

这些路径直接写进了插件源码，运行时**不联网**：没有 CDN、没有远程字体、没有图片外链，断网状态下面板与图标都正常。

Lucide 采用 ISC 许可，其中源自 Feather 的部分为 MIT：

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

