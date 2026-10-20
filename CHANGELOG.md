# Changelog

Semua perubahan penting pada fork Kaktua (branch `kaktua-ext`) dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi mengikuti SemVer dengan sufiks `-kaktua.N` di atas versi upstream.

## [Unreleased]

Target rilis: `0.3.5-kaktua.1`.

### Added

- Tool `create_node_from_svg`: membuat node vector yang bisa diedit dari markup SVG (mis. mengganti ikon PNG dengan vector), opsional di dalam parent dan posisi tertentu.
- Tool `create_component_from_node`: mengubah node (mis. frame) menjadi main Component.
- Tool `combine_as_variants`: menggabungkan beberapa Component bernama `Prop=Value, Prop2=Value` menjadi Component Set (variant).
- Tool `add_component_property`: menambah property TEXT/BOOLEAN/INSTANCE_SWAP ke Component atau Component Set, opsional langsung ditautkan ke node anak (teks, visibilitas, atau instance).
- Tool `swap_instance`: mengganti main component sebuah instance.
- Tool `get_local_variables`: daftar koleksi variable beserta mode, dan semua variable lokal (warna dalam hex, alias sebagai `{ aliasOf }`).
- Tool `create_variable_collection`: membuat koleksi variable dengan nama mode; mode yang ditolak batas paket Figma dilaporkan sebagai peringatan.
- Tool `create_variable` dan `set_variable_value`: membuat variable COLOR/FLOAT/STRING/BOOLEAN dan mengisi nilainya per mode, termasuk alias ke variable lain.
- Tool `delete_variable` dan `delete_variable_collection`: menghapus permanen sebuah variable, atau satu koleksi beserta seluruh variable dan mode di dalamnya (destruktif), misalnya untuk membersihkan sisa uji coba.
- Tool `bind_variable`: menautkan atau melepas variable pada fills/strokes, ukuran, spacing, padding, corner radius, stroke weight, opacity, teks, dan visibilitas node.
- Tool `add_interaction`: menambah interaksi prototype (trigger, aksi NAVIGATE/OVERLAY/SWAP/SCROLL_TO/CHANGE_TO/BACK/CLOSE/URL, dan transisi) dengan validasi tujuan dan arah transisi.
- Tool `set_reactions` dan `remove_interactions`: mengganti seluruh reaction dengan objek Plugin API mentah, atau menghapus interaksi (semua atau per jenis trigger).
- Tool `get_flow_starting_points`, `set_flow_starting_point`, `remove_flow_starting_point`: mengelola titik awal flow prototype per page.
- Tool `set_overlay_settings`: membaca pengaturan overlay sebuah frame; permintaan perubahan ditolak dengan pesan jelas karena properti ini read-only di Plugin API.
- Tool `set_scroll_behavior`: mengatur arah scroll frame dan menjadikan child FIXED atau SCROLLS (STICKY_SCROLLS belum didukung Plugin API).
- Tool `set_frame_properties`: mengatur posisi absolute di dalam auto-layout, urutan tumpukan auto-layout (first on top), clip content, dan posisi x/y.
- Tool `create_text_style` dan `update_text_style`: membuat dan mengubah Text Style lokal (font, ukuran, line height, letter spacing, text case, dekorasi, paragraph spacing).
- Tool `apply_text_style`: menerapkan Text Style ke satu atau banyak node teks (termasuk teks di dalam instance) dengan hasil per node.
- Tool `delete_style`: menghapus style lokal (text, paint, effect, grid) berdasarkan ID.
- Tool `set_effects`: mengatur drop/inner shadow serta layer/background blur pada node, atau mengosongkannya.
- Tool `create_effect_style` dan `update_effect_style`: membuat dan mengubah Effect Style lokal (shadow/blur) beserta nama dan deskripsinya.
- Tool `apply_effect_style`: menerapkan Effect Style ke satu atau banyak node, atau melepasnya dengan `styleId` kosong, dengan hasil per node.
- Tool `set_text_decoration`: memberi garis bawah, coret, atau menghapusnya pada satu/banyak node teks (termasuk teks di dalam instance), opsional hanya untuk rentang karakter tertentu.
- Tool `set_visible`: menampilkan atau menyembunyikan satu/banyak node, termasuk elemen di dalam instance (override visibilitas).
- Tool `get_design_context`: membaca seleksi (atau node tertentu) lewat plugin dan mengembalikan spec desain ringkas yang siap dijadikan kode: layout ala CSS (flex, gap, padding, sizing fill/hug/fixed), style yang dideduplikasi, teks termasuk rich text, instance component beserta property, nama style/variable (design token), serta daftar ikon dan gambar.
- Tool `get_figma_design_from_url`: membaca desain dari link Figma lewat REST API tanpa perlu membuka plugin (butuh `FIGMA_ACCESS_TOKEN`); tanpa `node-id` mengembalikan daftar page dan frame teratas.
- Tool `download_design_assets`: menyimpan ikon (SVG), ilustrasi, dan gambar fill ke folder lokal, lewat plugin atau REST API.
- Prompt `design_to_code`: alur kerja membuat kode dari desain Figma (baca spec, petakan ke token proyek, ekspor aset, verifikasi).
- Tool `get_main_component`: membaca main component dan varian dari instance langsung lewat plugin, tanpa REST API Figma (tidak terkena batas kuota).

### Changed

- `set_layout_sizing`: HUG kini bisa dipakai pada component, component set, dan instance yang memakai auto-layout (sebelumnya hanya frame/teks); FILL/FIXED tidak lagi mensyaratkan node itu sendiri auto-layout, cukup parent-nya; node teks kini didukung.
- `set_flow_starting_point`: frame di dalam section (termasuk section bertingkat) kini bisa dijadikan flow starting point, sama seperti di UI Figma; sebelumnya hanya frame yang langsung berada di page.
- Nama aplikasi diganti dari Cursor menjadi OpenCode: plugin Figma kini bernama "OpenCode MCP Plugin" dan dipindah ke `src/opencode_mcp_plugin/` (plugin development di Figma perlu di-link ulang ke `manifest.json` baru).
- `bun setup` kini ikut menjalankan build dan menulis `opencode.json` (format MCP OpenCode, menunjuk ke `dist/server.js` lokal) menggantikan `.cursor/mcp.json`; `.mcp.json` untuk Claude Code juga menjalankan build lokal menggantikan paket npm upstream.
- Konfigurasi MCP yang ditampilkan di UI plugin kini berformat `opencode.json`, dan petunjuk menjalankan relay memakai `bun socket`.
- Nama proyek menjadi `opencode-figma-mcp`: nama paket/bin npm, nama server MCP, key config MCP `opencode-figma` (sebelumnya `TalkToFigma`, config lama perlu disesuaikan), dan nama plugin Figma "OpenCode Figma MCP".
- Source server MCP dipindah dari `src/talk_to_figma_mcp/` ke `src/opencode_figma_mcp/`; config yang menjalankan `server.ts` langsung dari source perlu memperbarui path-nya.
- Config OpenCode dari `bun setup` dan UI plugin kini meneruskan `FIGMA_ACCESS_TOKEN` dari environment ke server MCP.
- Proyek berdiri sendiri: link "GitHub" di tab About plugin, petunjuk clone di dokumentasi, dan metadata `repository`/`homepage` paket kini mengarah ke repo publik `https://github.com/yhoyoex/opencode-figma-mcp`; instalasi plugin hanya lewat manifest lokal (plugin Figma Community upstream tidak lagi dirujuk).

### Security

- Relay WebSocket (`src/socket.ts`) hanya listen di `127.0.0.1`, tidak lagi terbuka ke jaringan.
- Plugin Figma tidak lagi mengizinkan koneksi ke Google Analytics (`manifest.json`), sehingga tidak ada data penggunaan yang dikirim keluar.
