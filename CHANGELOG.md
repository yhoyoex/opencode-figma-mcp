# Changelog

Semua perubahan penting pada OpenCode Figma MCP dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi mengikuti SemVer.

## [Unreleased]

### Added

- 30 tool baru (total 109):
  - Bentuk: `create_ellipse`, `create_line`, `create_polygon`, `create_star`, `create_vector`.
  - Struktur layer: `group_nodes`, `ungroup_node`, `boolean_operation`, `flatten_nodes`, `reorder_node`, `detach_instance`.
  - Teks dan properti node: `set_text_properties` (font, line height, letter spacing, text case, fill, alignment; bisa per range), `set_node_properties`, `set_stroke_properties`, `set_gradient_fill`, `set_constraints`, `set_layout_grids`.
  - Paint style: `create_paint_style`, `update_paint_style`, `apply_paint_style`.
  - Halaman: `get_pages`, `create_page`, `set_current_page`.
  - Inspeksi: `get_node_css`, `find_nodes`.
  - FigJam: `create_sticky`, `create_shape_with_text`, `create_table`.
  - Shared plugin data: `set_shared_plugin_data`, `get_shared_plugin_data`.
- 24 tool baru (total 133):
  - Variable: `update_variable` (nama, deskripsi, scopes, hiddenFromPublishing, code syntax), `update_variable_collection`, `manage_variable_modes` (tambah/ganti nama/hapus mode), `set_variable_mode` (mode eksplisit per node, mis. frame ke Dark).
  - Team library: `get_library_variable_collections`, `get_library_variables`, `import_variable_by_key`, `import_style_by_key`.
  - Component: `edit_component_property`, `delete_component_property`, `reset_instance_overrides`.
  - Styling dan layout: `set_fills` (ganti seluruh fills/strokes dengan daftar paint), `set_layout_child` (perilaku child di auto-layout, termasuk posisi sel GRID), `create_grid_style`, `update_grid_style`, `apply_grid_style`.
  - Teks: `get_available_fonts` (daftar font yang tersedia di plugin).
  - Export: `set_export_settings` (pengaturan Export panel di node), `create_slice`.
  - REST API (butuh `FIGMA_ACCESS_TOKEN`): `get_comments`, `post_comment`, `get_file_versions`, `get_team_components`, `get_team_styles`. `post_comment` menulis komentar sungguhan yang langsung terlihat semua kolaborator.
- 26 tool baru (total 159):
  - Plugin: `save_version`, `set_image_properties` (ubah scaleMode, crop, skala tiling, rotasi, atau filter image fill tanpa upload ulang), `duplicate_page`, `get_style_usage`, `get_viewport`, `set_viewport`, `reorder_style`, `reorder_style_folder`.
  - FigJam: `create_code_block`, `create_link_preview`.
  - Variable: `extend_library_collection` (hanya paket Enterprise).
  - Dev resources di plugin: `get_dev_resources`, `add_dev_resource`, `edit_dev_resource`, `delete_dev_resource`.
  - Anotasi: `get_annotation_categories`, `create_annotation_category`.
  - Measurement: `get_measurements`, `add_measurement`, `edit_measurement`, `delete_measurement`. Add/edit/delete hanya berjalan di Dev Mode, dan manifest plugin belum mendeklarasikan Dev Mode.
  - REST API (butuh `FIGMA_ACCESS_TOKEN`): `get_team_projects`, `get_project_files`, `get_file_dev_resources`, `create_file_dev_resources`, `delete_file_dev_resource`. Create/delete mengubah dev resource sungguhan yang langsung terlihat semua kolaborator.
- MCP resources baca-saja: `figma://document`, `figma://selection`, `figma://styles`, `figma://variables`, `figma://pages`.
- `set_image_fill` menerima `imageTransform`, `scalingFactor`, `rotation`, dan `filters`; `find_nodes` menerima `allPages` untuk mencari di semua halaman.
- Unit test `bun test` (`tests/simplify.test.ts`, `tests/figma_rest.test.ts`), `bun run lint` (`scripts/check-plugin.mjs`), dan `tsconfig.test.json`.
- Pemeriksaan tipe: devDependency `@figma/plugin-typings`, `tsconfig.plugin.json`, serta script `bun run typecheck` (server) dan `bun run typecheck:plugin` (plugin; kini 0 error).

### Changed

- `get_nodes_info` kini mengambil semua node dalam satu panggilan batch ke plugin, bukan satu panggilan per node; output tidak berubah.
- `get_node_info` dan `get_nodes_info` menerima `detail: "full"` untuk data node yang lebih lengkap (constraints, effects, style id, bound variables, properti component, field auto-layout, detail stroke).
- `create_text` menerima `fontFamily` dan `fontStyle`.
- `set_layout_mode` mendukung mode `GRID` (`gridRowCount`, `gridColumnCount`, gap, ukuran track, `gridAutoTracks`), serta `counterAxisAlignContent` dan `strokesIncludedInLayout`.
- `set_text_properties` mendukung hyperlink (http/https/mailto), `listType`, indentasi, `textTruncation`, dan `maxLines`.
- Manifest plugin kini meminta permission `teamlibrary`; plugin harus di-reload atau di-link ulang di Figma.

### Fixed

- `create_connections` tidak lagi melempar `ReferenceError` di blok catch (sebelumnya memakai variabel `startNodeId` yang tidak terdefinisi).
- `create_text` kini menunggu `setCharacters` selesai sebelum mengembalikan hasil.

- Instalasi langsung dari GitHub (`npx -p github:yhoyoex/opencode-figma-mcp opencode-figma-relay`) kini menyertakan relay; sebelumnya gagal dengan `command not found` karena paket tidak dibangun saat diinstal.
- Relay tidak lagi mencetak payload lengkap ke log kecuali `RELAY_DEBUG=1`; log sebelumnya bisa membengkak puluhan GB karena node tree Figma berukuran MB.
- Plugin Figma kini menyambung ulang sendiri saat koneksi ke relay putus (jeda bertahap 1–15 detik); sebelumnya plugin diam di status "Disconnected" sampai tombol Connect ditekan.
- Plugin memakai channel yang sama per file Figma, juga setelah reconnect atau plugin dibuka ulang, sehingga agent tidak perlu `join_channel` lagi.
- Server MCP otomatis bergabung kembali ke channel terakhir setelah relay di-restart.
- Relay mengirim ping setiap 30 detik dan memutus koneksi yang tidak merespons, sehingga plugin yang sudah mati tidak lagi tertinggal di channel.
- `get_design_context` mengirim data lebih kecil dari plugin (layer tersembunyi dan layer di bawah `maxDepth` dipangkas sebelum dikirim) dan mengirim progres per node, sehingga beban plugin dan socket untuk frame besar berkurang. Hasil spec tidak berubah.

## [1.1.1] - 2026-10-20

### Fixed

- Server MCP kini berhenti sendiri saat client menutup stdio atau mengirim SIGINT/SIGTERM; sebelumnya proses tetap hidup karena terus mencoba menyambung ulang ke relay.

## [1.1.0] - 2026-10-20

### Added

- Perintah `opencode-figma-relay` di paket npm: relay WebSocket kini bisa dijalankan dengan `npx -y -p opencode-figma-mcp opencode-figma-relay` tanpa clone repo dan tanpa Bun.

### Changed

- Relay WebSocket kini berjalan di Node.js (juga tetap lewat `bun socket`); port dan host bisa diatur lewat env `PORT` dan `HOST` (default `127.0.0.1:3055`), sehingga untuk WSL cukup `HOST=0.0.0.0` tanpa mengedit source.

## [1.0.0] - 2026-10-20

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
- Tool `get_main_component`: membaca main component dan varian dari instance langsung lewat plugin, tanpa REST API Figma (tidak terkena batas kuota).
