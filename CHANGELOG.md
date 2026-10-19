# Changelog

Semua perubahan penting pada fork Kaktua (branch `kaktua-ext`) dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi mengikuti SemVer dengan sufiks `-kaktua.N` di atas versi upstream.

## [Unreleased]

Target rilis: `0.3.5-kaktua.1` (berbasis upstream `grab/cursor-talk-to-figma-mcp` 0.3.5).

### Added
- Tool `create_component_from_node`: mengubah node (mis. frame) menjadi main Component.
- Tool `combine_as_variants`: menggabungkan beberapa Component bernama `Prop=Value, Prop2=Value` menjadi Component Set (variant).
- Tool `add_component_property`: menambah property TEXT/BOOLEAN/INSTANCE_SWAP ke Component atau Component Set, opsional langsung ditautkan ke node anak (teks, visibilitas, atau instance).
- Tool `swap_instance`: mengganti main component sebuah instance.
- Tool `get_local_variables`: daftar koleksi variable beserta mode, dan semua variable lokal (warna dalam hex, alias sebagai `{ aliasOf }`).
- Tool `create_variable_collection`: membuat koleksi variable dengan nama mode; mode yang ditolak batas paket Figma dilaporkan sebagai peringatan.
- Tool `create_variable` dan `set_variable_value`: membuat variable COLOR/FLOAT/STRING/BOOLEAN dan mengisi nilainya per mode, termasuk alias ke variable lain.
- Tool `bind_variable`: menautkan atau melepas variable pada fills/strokes, ukuran, spacing, padding, corner radius, stroke weight, opacity, teks, dan visibilitas node.

### Security
- Relay WebSocket (`src/socket.ts`) hanya listen di `127.0.0.1`, tidak lagi terbuka ke jaringan.
- Plugin Figma tidak lagi mengizinkan koneksi ke Google Analytics (`manifest.json`), sehingga tidak ada data penggunaan yang dikirim keluar.
