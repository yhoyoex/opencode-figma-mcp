# OpenCode Figma MCP

**OpenCode Figma MCP** is a Model Context Protocol (MCP) server that connects AI coding agents — [OpenCode](https://opencode.ai) and Claude Code — to Figma. It works in both directions:

- **Design → Code**: read a frame, component, or a Figma URL and get a compact, code-oriented spec (layout, auto-layout, typography, colors, effects, variables, component props) plus downloadable SVG/PNG assets, so the agent can generate UI code that matches the design.
- **Code → Design**: create and edit Figma content from the agent — frames, shapes, text, auto-layout, components, instances, variables, annotations, prototypes, and more (133 tools).

```
OpenCode / Claude Code ←(stdio)→ MCP Server ←(WebSocket)→ Relay (localhost:3055) ←(WebSocket)→ Figma Plugin
```

### Highlights

- **Two ways to read designs**: live from the open Figma file via the plugin (`get_design_context`), or straight from a Figma link via the REST API (`get_figma_design_from_url`, needs `FIGMA_ACCESS_TOKEN`) — no plugin required.
- **Asset export**: `download_design_assets` saves icons and images (SVG/PNG/JPG/PDF) directly into your project.
- **Full editing toolkit**: batch text replacement, instance override propagation, auto-layout sizing, components & variants, variables, image fills, sections, and prototype connections.
- **Local & private**: the WebSocket relay binds to localhost and the plugin talks only to your machine.
- **One-command setup**: `bun setup` builds the server and writes MCP config for OpenCode (`opencode.json`) and Claude Code (`.mcp.json`).

## Project Structure

- `src/opencode_figma_mcp/` - TypeScript MCP server for Figma integration
- `src/opencode_mcp_plugin/` - Figma plugin for communicating with OpenCode
- `src/socket.ts` - WebSocket server that facilitates communication between the MCP server and Figma plugin

## Quick start with npm

No clone needed for the MCP server and relay — only Node.js 18+.

1. Start the WebSocket relay (keep it running):

```bash
npx -y -p opencode-figma-mcp opencode-figma-relay
```

2. Add the MCP server to OpenCode (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opencode-figma": {
      "type": "local",
      "command": ["npx", "-y", "opencode-figma-mcp@latest"],
      "enabled": true,
      "environment": {
        "FIGMA_ACCESS_TOKEN": "{env:FIGMA_ACCESS_TOKEN}"
      }
    }
  }
}
```

Or for Claude Code:

```bash
claude mcp add opencode-figma -e FIGMA_ACCESS_TOKEN=<token> -- npx -y opencode-figma-mcp@latest
```

To install straight from GitHub instead of npm, replace `opencode-figma-mcp@latest` with `github:yhoyoex/opencode-figma-mcp` (the package is built on install). The relay works the same way: `npx -y -p github:yhoyoex/opencode-figma-mcp opencode-figma-relay`.

3. Install the Figma plugin: download or clone this repository and import `src/opencode_mcp_plugin/manifest.json` in Figma (see [Figma Plugin](#figma-plugin)).

## How to use (from source)

1. Install Bun if you haven't already:

```bash
curl -fsSL https://bun.sh/install | bash
```

2. Run setup, this will build the server and write MCP config for OpenCode (`opencode.json`) and Claude Code (`.mcp.json`)

```bash
bun setup
```

3. Start the Websocket server

```bash
bun socket
```

4. Install the Figma plugin [locally](#figma-plugin)

## Design Automation Example

**Bulk text content replacement**

Thanks to [@dusskapark](https://github.com/dusskapark) for contributing the bulk text replacement feature. Here is the [demo video](https://www.youtube.com/watch?v=j05gGT3xfCs).

**Instance Override Propagation**
Another contribution from [@dusskapark](https://github.com/dusskapark)
Propagate component instance overrides from a source instance to multiple target instances with a single command. This feature dramatically reduces repetitive design work when working with component instances that need similar customizations. Check out our [demo video](https://youtu.be/uvuT8LByroI).

## Manual Setup and Installation

### MCP Server: Integration with OpenCode

Build the server (`bun run build`), then add it to your OpenCode config (`opencode.json` in the project or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opencode-figma": {
      "type": "local",
      "command": ["bun", "/path/to/figma-mcp/dist/server.js"],
      "enabled": true,
      "environment": {
        "FIGMA_ACCESS_TOKEN": "{env:FIGMA_ACCESS_TOKEN}"
      }
    }
  }
}
```

### WebSocket Server

Start the WebSocket server:

```bash
bun socket
```

### Figma Plugin

1. In Figma, go to Plugins > Development > New Plugin
2. Choose "Link existing plugin"
3. Select the `src/opencode_mcp_plugin/manifest.json` file
4. The plugin should now be available in your Figma development plugins

## Windows + WSL Guide

1. Install bun via powershell

```bash
powershell -c "irm bun.sh/install.ps1|iex"
```

2. Start the websocket, listening on all interfaces so WSL can reach it

```bash
HOST=0.0.0.0 bun socket
```

Set `RELAY_DEBUG=1` untuk mencetak payload lengkap ke log relay (default mati).

## Usage

1. Start the WebSocket server
2. Install the MCP server in OpenCode
3. Open Figma and run the OpenCode Figma MCP plugin
4. Connect the plugin to the WebSocket server by joining a channel using `join_channel`
5. Use OpenCode to communicate with Figma using the MCP tools

## Local Development Setup

To develop, update your mcp config to direct to your local directory.

```json
{
  "mcpServers": {
    "opencode-figma": {
      "command": "bun",
      "args": ["/path-to-repo/src/opencode_figma_mcp/server.ts"]
    }
  }
}
```

## MCP Tools

The MCP server provides the following tools for interacting with Figma:

### Design to Code

Read a design as a compact, code-oriented spec (CSS-like layout, shared style references, text, components, design tokens, assets) so OpenCode can generate UI code from it.

- `get_design_context` - Read the current selection (or given node IDs) through the plugin. No token needed; Figma and the plugin must be open.
- `get_figma_design_from_url` - Read a design from a Figma link through the REST API, without the plugin. Without `node-id` it returns the page/frame outline. Requires `FIGMA_ACCESS_TOKEN`.
- `download_design_assets` - Save icons (SVG), illustrations and image fills to a local folder, via the plugin or the REST API.
- `export_node_as_image` - Get a PNG of a node as a visual reference.

To use the REST API tools, create a personal access token in Figma (Settings → Security → Personal access tokens, scope `file_content:read`) and export it before starting OpenCode:

```bash
export FIGMA_ACCESS_TOKEN=figd_...
```

The `opencode.json` written by `bun setup` passes it to the server with `"environment": { "FIGMA_ACCESS_TOKEN": "{env:FIGMA_ACCESS_TOKEN}" }`. `FIGMA_API_KEY` and `FIGMA_TOKEN` are also accepted.

Example prompt in OpenCode: *"Buat komponen React untuk https://www.figma.com/design/AbC123/App?node-id=12-345, simpan ikon ke src/assets/icons."*

### Document & Selection

- `get_document_info` - Get information about the current Figma document
- `get_selection` - Get information about the current selection
- `read_my_design` - Get detailed node information about the current selection without parameters
- `get_node_info` - Get detailed information about a specific node (`detail: "full"` adds visibility/opacity, constraints, effects, style ids, bound variables, component properties, auto-layout & sizing fields and stroke details)
- `get_nodes_info` - Get detailed information about multiple nodes by providing an array of node IDs (also supports `detail: "full"`)
- `set_focus` - Set focus on a specific node by selecting it and scrolling viewport to it
- `set_selections` - Set selection to multiple nodes and scroll viewport to show them

### Annotations

- `get_annotations` - Get all annotations in the current document or specific node
- `set_annotation` - Create or update an annotation with markdown support
- `set_multiple_annotations` - Batch create/update multiple annotations efficiently
- `scan_nodes_by_types` - Scan for nodes with specific types (useful for finding annotation targets)

### Prototyping & Connections

- `get_reactions` - Get all prototype reactions from nodes with visual highlight animation
- `set_default_connector` - Set a copied FigJam connector as the default connector style for creating connections (must be set before creating connections)
- `create_connections` - Create FigJam connector lines between nodes, based on prototype flows or custom mapping
- `add_interaction` - Add a prototype interaction (trigger, action such as NAVIGATE/OVERLAY/SWAP/SCROLL_TO/CHANGE_TO/BACK/CLOSE/URL, transition) to a node
- `set_reactions` - Replace all reactions of a node with raw Plugin API `Reaction` objects (advanced: variables, conditionals, key triggers)
- `remove_interactions` - Remove all interactions of a node, or only those with a given trigger type
- `get_flow_starting_points` - List prototype flow starting points of the current page
- `set_flow_starting_point` - Add or rename a flow starting point on a top-level frame
- `remove_flow_starting_point` - Remove a frame's flow starting point
- `set_overlay_settings` - Read overlay settings of a frame (read-only in the Plugin API; change requests return an error with the current values)
- `set_scroll_behavior` - Set a frame's overflow (scroll) direction and make a child FIXED or SCROLLS (STICKY_SCROLLS unsupported by the Plugin API)
- `set_frame_properties` - Set absolute positioning inside auto-layout (`layoutPositioning`), auto-layout stacking order (`itemReverseZIndex`), clip content, and x/y

### Creating Elements

- `create_rectangle` - Create a new rectangle with position, size, and optional name
- `create_frame` - Create a new frame with position, size, and optional name
- `create_section` - Create a section to group related content on the canvas
- `create_text` - Create a new text node with customizable font properties (`fontFamily`/`fontStyle`; see `get_available_fonts`)
- `create_node_from_svg` - Create editable vector nodes from SVG markup (e.g. replace PNG icons with vectors), optionally inside a parent at a given position
- `create_ellipse` - Create an ellipse (circle/oval)
- `create_line` - Create a line
- `create_polygon` - Create a polygon with a given number of sides
- `create_star` - Create a star with a given number of points
- `create_vector` - Create a vector node from path data
- `create_slice` - Create a slice (an export region independent of layers). Add export formats to it with `set_export_settings`

### Modifying text content

- `scan_text_nodes` - Scan text nodes with intelligent chunking for large designs
- `set_text_content` - Set the text content of a single text node
- `set_multiple_text_contents` - Batch update multiple text nodes efficiently
- `set_text_properties` - Set font family/style/size, line height, letter spacing, text case, fill and alignment, optionally for a character range; also hyperlinks (http/https/mailto), list type, indentation, text truncation and max lines
- `get_available_fonts` - List fonts available to the Figma plugin (same as the font picker), grouped by family with their style names. Use the exact family/style with `create_text`, `set_text_properties` or text styles

### Auto Layout & Spacing

- `set_layout_mode` - Set the layout mode and wrap behavior of a frame (NONE, HORIZONTAL, VERTICAL, GRID with row/column count, gaps, track sizes and auto tracks), plus `counterAxisAlignContent` and `strokesIncludedInLayout`
- `set_layout_child` - Set how a node behaves inside its auto-layout parent: `layoutGrow`/`layoutAlign` for HORIZONTAL/VERTICAL parents, cell position, spans and cell alignment for GRID parents
- `set_padding` - Set padding values for an auto-layout frame (top, right, bottom, left)
- `set_axis_align` - Set primary and counter axis alignment for auto-layout frames
- `set_layout_sizing` - Set horizontal and vertical sizing modes (FIXED, HUG, FILL) for frames, components, instances and text; HUG needs auto-layout or text, FILL needs an auto-layout parent
- `set_item_spacing` - Set distance between children in an auto-layout frame

### Styling

- `set_fill_color` - Set the fill color of a node (RGBA)
- `set_stroke_color` - Set the stroke color and weight of a node
- `set_corner_radius` - Set the corner radius of a node with optional per-corner control
- `set_image_fill` - Fill a node with an image from a local file path, URL, or base64 data (FILL, FIT, CROP, or TILE)
- `set_gradient_fill` - Fill a node with a linear, radial, angular or diamond gradient
- `set_stroke_properties` - Set stroke weight, alignment, dash pattern, caps and joins
- `set_node_properties` - Set opacity, rotation, blend mode, locked, mask, and min/max size
- `set_constraints` - Set horizontal and vertical constraints of a node
- `set_layout_grids` - Set layout grids (columns, rows, grid) on a frame
- `set_fills` - Replace all fills or strokes of a node with a list of paints (solid, gradient, image); index 0 is the bottom-most paint, `paints: []` removes all
- `set_export_settings` - Replace the export settings stored on a node (the Export panel in Figma); `settings: []` removes all. To export now use `export_node_as_image` or `download_design_assets`

### Layout & Organization

- `move_node` - Move a node to a new position
- `resize_node` - Resize a node with new dimensions
- `delete_node` - Delete a node
- `delete_multiple_nodes` - Delete multiple nodes at once efficiently
- `clone_node` - Create a copy of an existing node with optional position offset
- `rename_node` - Rename a node
- `set_parent` - Move a node into a new parent (section, frame or group), preserving its absolute position by default
- `group_nodes` - Group nodes
- `ungroup_node` - Ungroup a group, keeping its children
- `boolean_operation` - Combine nodes with UNION, SUBTRACT, INTERSECT or EXCLUDE
- `flatten_nodes` - Flatten nodes into a single vector
- `reorder_node` - Change a node's layer order (z-index) within its parent
- `detach_instance` - Detach an instance from its main component into a frame

### Components & Styles

- `get_styles` - Get information about local styles
- `create_text_style` - Create a local text style (font, size, line height, letter spacing, case, decoration)
- `update_text_style` - Update an existing local text style
- `apply_text_style` - Apply a text style to one or more text nodes (including text inside instances)
- `set_text_decoration` - Set underline, strikethrough or none on text nodes, optionally for a character range
- `set_visible` - Show or hide nodes, including children inside instances (visibility override)
- `get_main_component` - Read the main component / variant of instances directly in the plugin (no REST API)
- `create_paint_style` - Create a local paint (color) style
- `update_paint_style` - Update the name, description or paints of a paint style
- `apply_paint_style` - Apply a paint style to the fills or strokes of one or more nodes
- `delete_style` - Delete a local text, paint, effect or grid style
- `set_effects` - Set drop/inner shadows and layer/background blur on a node (empty array clears)
- `create_effect_style` - Create a local effect style (shadow/blur token)
- `update_effect_style` - Update the name, description or effects of an effect style
- `apply_effect_style` - Apply an effect style to one or more nodes (`''` detaches)
- `create_grid_style` - Create a local grid style (layout grid token), e.g. `Grid/12 columns`, using the same grid format as `set_layout_grids`
- `update_grid_style` - Update the name, description or layout grids of a local grid style
- `apply_grid_style` - Apply a grid style to one or more frames, components or instances (`''` detaches)
- `import_style_by_key` - Import a published library style (paint, text, effect or grid) by its key so it can be applied locally
- `get_local_components` - Get information about local components
- `create_component_instance` - Create an instance of a component
- `get_instance_overrides` - Extract override properties from a selected component instance
- `set_instance_overrides` - Apply extracted overrides to target instances
- `create_component_from_node` - Convert an existing node (e.g. a frame) into a main Component
- `combine_as_variants` - Combine components named `Prop=Value, Prop2=Value` into a Component Set (variants)
- `add_component_property` - Add a TEXT, BOOLEAN or INSTANCE_SWAP property to a component/component set, optionally linked to a child node
- `swap_instance` - Swap the main component of an instance
- `edit_component_property` - Rename a BOOLEAN, TEXT or INSTANCE_SWAP component property or change its default value, preferred values or description (VARIANT properties not supported)
- `delete_component_property` - Delete a BOOLEAN, TEXT or INSTANCE_SWAP property from a component or component set
- `reset_instance_overrides` - Reset all overrides on one or more instances back to the main component

### Variables

- `get_local_variables` - List local variable collections (with modes) and variables; colors returned as hex
- `create_variable_collection` - Create a variable collection with named modes (extra modes may require a paid plan)
- `create_variable` - Create a COLOR, FLOAT, STRING or BOOLEAN variable, with optional value and scopes
- `set_variable_value` - Set a variable value for a mode (literal or alias via `{ aliasOf: variableId }`)
- `delete_variable` - Permanently delete a variable (destructive; bound nodes lose the binding)
- `delete_variable_collection` - Permanently delete a collection with all its variables and modes (destructive)
- `bind_variable` - Bind (or unbind with `variableId: null`) a variable to fills/strokes, size, spacing, padding, corner radius, stroke weight, opacity, characters or visibility
- `update_variable` - Update variable metadata: name, description, scopes, hiddenFromPublishing and code syntax (WEB/ANDROID/iOS)
- `update_variable_collection` - Rename a variable collection or change whether it is hidden from publishing
- `manage_variable_modes` - Add, rename or remove a mode of a variable collection (e.g. Light/Dark)
- `set_variable_mode` - Set the explicit variable mode of a node for a collection (e.g. switch a frame to Dark mode); `clear: true` makes it inherit from its parent
- `get_library_variable_collections` - List variable collections available from enabled team libraries (requires the plugin's `teamlibrary` permission)
- `get_library_variables` - List variables (key, name, resolvedType) in a team library variable collection
- `import_variable_by_key` - Import a published library variable by its key so it can be bound locally

### Pages

- `get_pages` - List pages of the document
- `create_page` - Create a new page
- `set_current_page` - Switch to another page

### Inspection

- `get_node_css` - Get the CSS of a node generated by Figma
- `find_nodes` - Find nodes by name and/or type

### FigJam

- `create_sticky` - Create a sticky note
- `create_shape_with_text` - Create a FigJam shape with text
- `create_table` - Create a FigJam table

### Plugin Data

- `set_shared_plugin_data` - Store shared plugin data (namespace/key/value) on a node
- `get_shared_plugin_data` - Read shared plugin data from a node

### Export & Advanced

- `export_node_as_image` - Export a node as an image (PNG, JPG, SVG, or PDF) - limited support on image currently returning base64 as text

### Comments, Versions & Team Library (REST API)

These tools use the Figma REST API and require `FIGMA_ACCESS_TOKEN` (no plugin needed).

- `get_comments` - Read the comments of a Figma file (scope `file_comments:read`)
- `post_comment` - Post a **real** comment or reply to a Figma file, visible to every collaborator under the token owner's account (scope `file_comments:write`); use only when explicitly asked
- `get_file_versions` - List the version history of a Figma file, newest first (paginated)
- `get_team_components` - List the published components of a team library (scope `team_library_content:read`); use the key with `create_component_instance`
- `get_team_styles` - List the published styles of a team library (scope `team_library_content:read`); use the key with `import_style_by_key`

### Connection Management

- `join_channel` - Join a specific channel to communicate with Figma

### MCP Prompts

The MCP server includes several helper prompts to guide you through complex design tasks:

- `design_to_code` - Workflow for turning a Figma design into code (read spec, map tokens, export assets, verify)
- `design_strategy` - Best practices for working with Figma designs
- `read_design_strategy` - Best practices for reading Figma designs
- `text_replacement_strategy` - Systematic approach for replacing text in Figma designs
- `annotation_conversion_strategy` - Strategy for converting manual annotations to Figma's native annotations
- `swap_overrides_instances` - Strategy for transferring overrides between component instances in Figma
- `reaction_to_connector_strategy` - Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions', and guiding the use 'create_connections' in sequence

## Development

### Building the Figma Plugin

1. Navigate to the Figma plugin directory:

   ```
   cd src/opencode_mcp_plugin
   ```

2. Edit code.js and ui.html

### Type checking

```bash
bun run typecheck          # MCP server (tsc --noEmit)
bun run typecheck:plugin   # Figma plugin code.js against @figma/plugin-typings (tsconfig.plugin.json)
```

The plugin was granted the `teamlibrary` permission in `manifest.json`; reload (or re-link) the plugin in Figma after updating.

## Best Practices

When working with the Figma MCP:

1. Always join a channel before sending commands
2. Get document overview using `get_document_info` first
3. Check current selection with `get_selection` before modifications
4. Use appropriate creation tools based on needs:
   - `create_frame` for containers
   - `create_rectangle` for basic shapes
   - `create_text` for text elements
5. Verify changes using `get_node_info`
6. Use component instances when possible for consistency
7. Handle errors appropriately as all commands can throw exceptions
8. For large designs:
   - Use chunking parameters in `scan_text_nodes`
   - Monitor progress through WebSocket updates
   - Implement appropriate error handling
9. For text operations:
   - Use batch operations when possible
   - Consider structural relationships
   - Verify changes with targeted exports
10. For converting legacy annotations:
    - Scan text nodes to identify numbered markers and descriptions
    - Use `scan_nodes_by_types` to find UI elements that annotations refer to
    - Match markers with their target elements using path, name, or proximity
    - Categorize annotations appropriately with `get_annotations`
    - Create native annotations with `set_multiple_annotations` in batches
    - Verify all annotations are properly linked to their targets
    - Delete legacy annotation nodes after successful conversion
11. Visualize prototype noodles as FigJam connectors:

- Use `get_reactions` to extract prototype flows,
- set a default connector with `set_default_connector`,
- and generate connector lines with `create_connections` for clear visual flow mapping.

## Support

If this project helps you, consider buying me a coffee ☕

<a href="https://www.buymeacoffee.com/yhoyoex"><img src="assets/buymeacoffee-qr.png" alt="Buy Me a Coffee QR code" width="200"></a>

[buymeacoffee.com/yhoyoex](https://www.buymeacoffee.com/yhoyoex)

## Credits

This project is based on [cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp) by [Sonny Lazuardi](https://github.com/sonnylazuardi) and its contributors. Many thanks to the original authors for the MCP server, WebSocket relay, and Figma plugin that this project builds upon.

## License

MIT — see [LICENSE](LICENSE). The original copyright notice from the upstream project is retained.
