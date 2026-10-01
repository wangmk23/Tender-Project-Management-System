# 编译运行时许可提取

这些原文与 cryptography 的 SBOM 由构建基线归档直接提取，仅覆盖归档携带的许可资产。提取过程不包含原部署路径、数据库或密钥。包版本来自同一归档的 dist-info 元数据。

| 包 | 版本 | 元数据许可 |
| --- | --- | --- |
| click | 8.3.3 | BSD-3-Clause |
| cryptography | 48.0.0 | Apache-2.0 OR BSD-3-Clause |
| Flask | 3.1.3 | BSD-3-Clause |
| Flask-SQLAlchemy | 3.1.1 | see original license |
| itsdangerous | 2.2.0 | see original license |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| numpy | 2.4.6 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| importlib_metadata | 8.7.1 | Apache-2.0 |
| Werkzeug | 3.1.8 | BSD-3-Clause |

此表不是完整运行时物料清单。部分编译组件与 Python 标准库、Tk/Tcl、OpenSSL、SQLCipher及其绑定、PyInstaller引导程序、其他归档包可能不携带 dist-info；需要继续逐组件核对。

## 补充包许可

以下版本由归档代码中的版本常量，或同版本官方源码编译后的函数签名比对确认。比对忽略文件路径；不把本机安装版本直接当作归档版本。许可来自同版本安装包/官方wheel，未附dist-info的包因此单独记录。

| 包 | 版本 | 确认依据 |
| --- | --- | --- |
| Pillow | 12.2.0 | 归档版本常量；许可由对应版本包提取 |
| bottle | 0.13.4 | 归档版本常量；许可由对应版本包提取 |
| cffi | 2.0.0 | 归档版本常量；许可由对应版本包提取 |
| charset-normalizer | 3.4.7 | 归档版本常量；许可由对应版本包提取 |
| colorama | 0.4.6 | 归档版本常量；许可由对应版本包提取 |
| greenlet | 3.5.3 | 归档版本常量；许可由对应版本包提取 |
| Jinja2 | 3.1.6 | 归档版本常量；许可由对应版本包提取 |
| packaging | 26.2 | 归档版本常量；许可由对应版本包提取 |
| psutil | 7.2.2 | 归档版本常量；许可由对应版本包提取 |
| pycparser | 3.0 | 归档版本常量；许可由对应版本包提取 |
| six | 1.17.0 | 归档版本常量；许可由对应版本包提取 |
| SQLAlchemy | 2.0.51 | 归档版本常量；许可由对应版本包提取 |
| threadpoolctl | 3.6.0 | 归档版本常量；许可由对应版本包提取 |
| PyYAML | 6.0.3 | 归档版本常量；许可由对应版本包提取 |
| more-itertools | 11.1.0 | 归档版本常量；许可由对应版本包提取 |
| blinker | 1.9.0 | 归档模块与对应源码递归编译签名相同 |
| clr_loader | 0.3.1 | 归档模块与对应源码递归编译签名相同 |
| python-dotenv | 1.2.1 | 归档模块与对应源码递归编译签名相同 |
| proxy-tools | 0.1.0 | 归档模块与对应源码递归编译签名相同 |
| pystray | 0.19.5 | 归档模块与对应源码递归编译签名相同 |
| pythonnet | 3.1.0 | 归档模块与对应源码递归编译签名相同 |
| setuptools | 81.0.0 | 归档模块与对应源码递归编译签名相同 |
| sqlcipher3 | 0.6.2 | 归档模块与对应源码递归编译签名相同 |
| typing_extensions | 4.15.0 | 归档模块与对应源码递归编译签名相同 |
| pywebview | 6.2.1 | 归档模块与对应源码递归编译签名相同 |
| jaraco.context | 6.1.2 | 归档模块与对应源码递归编译签名相同 |
| jaraco.functools | 4.5.0 | 归档模块与对应源码递归编译签名相同 |

proxy-tools 的发行元数据标注 MIT，但官方 LICENSE.txt 写 BSD 条款；此处保留实际许可全文与两位上游作者归属，不重写其条款。

## 编译组件

- Python 3.12.9：归档 DLL 的版本字符串，许可来自 CPython v3.12.9。
- SQLCipher 4.12.0 community / SQLite 3.51.1：提取归档扩展，在内存数据库执行 `PRAGMA cipher_version` 及读取 `sqlite_version`；未读取业务数据库。
- OpenSSL 3.6.0：上述 SQLCipher 扩展内版本字符串。
- OpenSSL 3.0.15：归档 libcrypto-3.dll 内版本字符串。
- OpenSSL 4.0.0：cryptography 的 Rust扩展内版本字符串，另有原始 SBOM。
- Python.Runtime 3.1.0.0：归档 DLL 的 PE 版本，适用 pythonnet 许可。

上述 OpenSSL 与 SQLCipher 原文来自对应上游版本标签。BSD 与 Apache 条款未要求将项目原创代码改为其许可；仍须随发布保留相应通知。其他原生组件的许可保留在各包全文中；.NET runtime 的上游 MIT 与第三方通知一并保存。
