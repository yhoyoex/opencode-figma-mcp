# OpenCode Figma MCP

**OpenCode Figma MCP** is a Model Context Protocol (MCP) server that connects AI coding agents — [OpenCode](https://opencode.ai) and Claude Code — to Figma. It works in both directions:

- **Design → Code**: read a frame, component, or a Figma URL and get a compact, code-oriented spec (layout, auto-layout, typography, colors, effects, variables, component props) plus downloadable SVG/PNG assets, so the agent can generate UI code that matches the design.
- **Code → Design**: create and edit Figma content from the agent — frames, shapes, text, auto-layout, components, instances, variables, annotations, prototypes, and more (79 tools).

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

## How to use

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

2. Uncomment the hostname `0.0.0.0` in `src/socket.ts`

```typescript
// uncomment this to allow connections in windows wsl
hostname: "0.0.0.0",
```

3. Start the websocket

```bash
bun socket
```

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
- `get_node_info` - Get detailed information about a specific node
- `get_nodes_info` - Get detailed information about multiple nodes by providing an array of node IDs
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
- `create_text` - Create a new text node with customizable font properties
- `create_node_from_svg` - Create editable vector nodes from SVG markup (e.g. replace PNG icons with vectors), optionally inside a parent at a given position

### Modifying text content

- `scan_text_nodes` - Scan text nodes with intelligent chunking for large designs
- `set_text_content` - Set the text content of a single text node
- `set_multiple_text_contents` - Batch update multiple text nodes efficiently

### Auto Layout & Spacing

- `set_layout_mode` - Set the layout mode and wrap behavior of a frame (NONE, HORIZONTAL, VERTICAL)
- `set_padding` - Set padding values for an auto-layout frame (top, right, bottom, left)
- `set_axis_align` - Set primary and counter axis alignment for auto-layout frames
- `set_layout_sizing` - Set horizontal and vertical sizing modes (FIXED, HUG, FILL) for frames, components, instances and text; HUG needs auto-layout or text, FILL needs an auto-layout parent
- `set_item_spacing` - Set distance between children in an auto-layout frame

### Styling

- `set_fill_color` - Set the fill color of a node (RGBA)
- `set_stroke_color` - Set the stroke color and weight of a node
- `set_corner_radius` - Set the corner radius of a node with optional per-corner control
- `set_image_fill` - Fill a node with an image from a local file path, URL, or base64 data (FILL, FIT, CROP, or TILE)

### Layout & Organization

- `move_node` - Move a node to a new position
- `resize_node` - Resize a node with new dimensions
- `delete_node` - Delete a node
- `delete_multiple_nodes` - Delete multiple nodes at once efficiently
- `clone_node` - Create a copy of an existing node with optional position offset
- `rename_node` - Rename a node
- `set_parent` - Move a node into a new parent (section, frame or group), preserving its absolute position by default

### Components & Styles

- `get_styles` - Get information about local styles
- `create_text_style` - Create a local text style (font, size, line height, letter spacing, case, decoration)
- `update_text_style` - Update an existing local text style
- `apply_text_style` - Apply a text style to one or more text nodes (including text inside instances)
- `set_text_decoration` - Set underline, strikethrough or none on text nodes, optionally for a character range
- `set_visible` - Show or hide nodes, including children inside instances (visibility override)
- `get_main_component` - Read the main component / variant of instances directly in the plugin (no REST API)
- `delete_style` - Delete a local text, paint, effect or grid style
- `set_effects` - Set drop/inner shadows and layer/background blur on a node (empty array clears)
- `create_effect_style` - Create a local effect style (shadow/blur token)
- `update_effect_style` - Update the name, description or effects of an effect style
- `apply_effect_style` - Apply an effect style to one or more nodes (`''` detaches)
- `get_local_components` - Get information about local components
- `create_component_instance` - Create an instance of a component
- `get_instance_overrides` - Extract override properties from a selected component instance
- `set_instance_overrides` - Apply extracted overrides to target instances
- `create_component_from_node` - Convert an existing node (e.g. a frame) into a main Component
- `combine_as_variants` - Combine components named `Prop=Value, Prop2=Value` into a Component Set (variants)
- `add_component_property` - Add a TEXT, BOOLEAN or INSTANCE_SWAP property to a component/component set, optionally linked to a child node
- `swap_instance` - Swap the main component of an instance

### Variables

- `get_local_variables` - List local variable collections (with modes) and variables; colors returned as hex
- `create_variable_collection` - Create a variable collection with named modes (extra modes may require a paid plan)
- `create_variable` - Create a COLOR, FLOAT, STRING or BOOLEAN variable, with optional value and scopes
- `set_variable_value` - Set a variable value for a mode (literal or alias via `{ aliasOf: variableId }`)
- `delete_variable` - Permanently delete a variable (destructive; bound nodes lose the binding)
- `delete_variable_collection` - Permanently delete a collection with all its variables and modes (destructive)
- `bind_variable` - Bind (or unbind with `variableId: null`) a variable to fills/strokes, size, spacing, padding, corner radius, stroke weight, opacity, characters or visibility

### Export & Advanced

- `export_node_as_image` - Export a node as an image (PNG, JPG, SVG, or PDF) - limited support on image currently returning base64 as text

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
