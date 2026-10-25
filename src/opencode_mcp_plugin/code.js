// This is the main code file for the OpenCode Figma MCP plugin
// It handles Figma API commands

// Plugin state
const state = {
  serverPort: 3055, // Default port
};

// Helper function for progress updates
async function sendProgressUpdate(
  commandId,
  commandType,
  status,
  progress,
  totalItems,
  processedItems,
  message,
  payload = null,
) {
  const update = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  // Add optional chunk information if present
  if (payload) {
    if (
      payload.currentChunk !== undefined &&
      payload.totalChunks !== undefined
    ) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  // Send to UI
  figma.ui.postMessage(update);
  console.log(`Progress update: ${status} - ${progress}% - ${message}`);

  // Yield so the Figma plugin sandbox flushes postMessage to ui.html
  // before the next iteration begins
  await new Promise((resolve) => setTimeout(resolve, 0));

  return update;
}

// Show UI
figma.showUI(__html__, { width: 350, height: 600 });

// Initialize anonymous analytics client_id (persisted via clientStorage)
(async () => {
  try {
    let clientId = await figma.clientStorage.getAsync("analyticsClientId");
    if (!clientId) {
      clientId =
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 10);
      await figma.clientStorage.setAsync("analyticsClientId", clientId);
    }
    figma.ui.postMessage({ type: "analytics-client-id", clientId });
  } catch (e) {
    console.error("analytics init failed:", e);
  }
})();

// Plugin commands from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "save-channel":
      saveChannel(msg.channel);
      break;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: error.message || "Error executing command",
        });
      }
      break;
  }
};

// Listen for plugin commands from menu
figma.on("run", ({ command }) => {
  figma.ui.postMessage({ type: "auto-connect", channel: loadChannel() });
});

// The channel is stored per file so a restarted plugin rejoins the channel the
// MCP server already joined, and two open files never share a channel.
const CHANNEL_KEY = "mcpChannel";

function loadChannel() {
  try {
    const channel = figma.root.getPluginData(CHANNEL_KEY);
    return /^[a-z0-9]{8}$/.test(channel) ? channel : null;
  } catch (error) {
    return null;
  }
}

function saveChannel(channel) {
  if (typeof channel !== "string" || !/^[a-z0-9]{8}$/.test(channel)) return;
  try {
    if (figma.root.getPluginData(CHANNEL_KEY) !== channel) {
      figma.root.setPluginData(CHANNEL_KEY, channel);
    }
  } catch (error) {
    // read-only files (view access) cannot store plugin data; keep the session channel
    console.warn("Could not persist channel:", error);
  }
}

// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// Handle commands from UI
async function handleCommand(command, params) {
  switch (command) {
    case "get_document_info":
      return await getDocumentInfo();
    case "get_selection":
      return await getSelection();
    case "get_node_info":
      if (!params || !params.nodeId) {
        throw new Error("Missing nodeId parameter");
      }
      return await getNodeInfo(params.nodeId, params.detail);
    case "get_nodes_info":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getNodesInfo(params.nodeIds, params.detail);
    case "read_my_design":
      return await readMyDesign();
    case "create_rectangle":
      return await createRectangle(params);
    case "create_frame":
      return await createFrame(params);
    case "create_text":
      return await createText(params);
    case "create_node_from_svg":
      return await createNodeFromSvg(params);
    case "set_fill_color":
      return await setFillColor(params);
    case "set_stroke_color":
      return await setStrokeColor(params);
    case "move_node":
      return await moveNode(params);
    case "resize_node":
      return await resizeNode(params);
    case "delete_node":
      return await deleteNode(params);
    case "delete_multiple_nodes":
      return await deleteMultipleNodes(params);
    case "get_styles":
      return await getStyles();
    case "get_local_components":
      return await getLocalComponents(params);
    // case "get_team_components":
    //   return await getTeamComponents();
    case "create_component_instance":
      return await createComponentInstance(params);
    case "export_node_as_image":
      return await exportNodeAsImage(params);
    case "set_corner_radius":
      return await setCornerRadius(params);
    case "set_text_content":
      return await setTextContent(params);
    case "clone_node":
      return await cloneNode(params);
    case "scan_text_nodes":
      return await scanTextNodes(params);
    case "set_multiple_text_contents":
      return await setMultipleTextContents(params);
    case "get_annotations":
      return await getAnnotations(params);
    case "set_annotation":
      return await setAnnotation(params);
    case "scan_nodes_by_types":
      return await scanNodesByTypes(params);
    case "set_multiple_annotations":
      return await setMultipleAnnotations(params);
    case "get_instance_overrides":
      // Check if instanceNode parameter is provided
      if (params && params.instanceNodeId) {
        // Get the instance node by ID
        const instanceNode = await figma.getNodeByIdAsync(
          params.instanceNodeId,
        );
        if (!instanceNode) {
          throw new Error(
            `Instance node not found with ID: ${params.instanceNodeId}`,
          );
        }
        return await getInstanceOverrides(instanceNode);
      }
      // Call without instance node if not provided
      return await getInstanceOverrides();

    case "set_instance_overrides":
      // Check if instanceNodeIds parameter is provided
      if (params && params.targetNodeIds) {
        // Validate that targetNodeIds is an array
        if (!Array.isArray(params.targetNodeIds)) {
          throw new Error("targetNodeIds must be an array");
        }

        // Get the instance nodes by IDs
        const targetNodes = await getValidTargetInstances(params.targetNodeIds);
        if (!targetNodes.success) {
          figma.notify(targetNodes.message);
          return { success: false, message: targetNodes.message };
        }

        if (params.sourceInstanceId) {
          // get source instance data
          let sourceInstanceData = null;
          sourceInstanceData = await getSourceInstanceData(
            params.sourceInstanceId,
          );

          if (!sourceInstanceData.success) {
            figma.notify(sourceInstanceData.message);
            return { success: false, message: sourceInstanceData.message };
          }
          return await setInstanceOverrides(
            targetNodes.targetInstances,
            sourceInstanceData,
          );
        } else {
          throw new Error("Missing sourceInstanceId parameter");
        }
      }
    case "set_layout_mode":
      return await setLayoutMode(params);
    case "set_padding":
      return await setPadding(params);
    case "set_axis_align":
      return await setAxisAlign(params);
    case "set_layout_sizing":
      return await setLayoutSizing(params);
    case "set_item_spacing":
      return await setItemSpacing(params);
    case "get_reactions":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getReactions(params.nodeIds);
    case "set_default_connector":
      return await setDefaultConnector(params);
    case "create_connections":
      return await createConnections(params);
    case "set_focus":
      return await setFocus(params);
    case "set_selections":
      return await setSelections(params);
    case "set_image_fill":
      return await setImageFill(params);
    case "rename_node":
      return await renameNode(params);
    case "create_section":
      return await createSection(params);
    case "set_parent":
      return await setParent(params);
    case "create_component_from_node":
      return await createComponentFromNode(params);
    case "combine_as_variants":
      return await combineAsVariants(params);
    case "add_component_property":
      return await addComponentProperty(params);
    case "swap_instance":
      return await swapInstance(params);
    case "get_local_variables":
      return await getLocalVariables();
    case "get_design_context":
      return await getDesignContext(params);
    case "export_node_assets":
      return await exportNodeAssets(params);
    case "create_variable_collection":
      return await createVariableCollection(params);
    case "create_variable":
      return await createVariable(params);
    case "set_variable_value":
      return await setVariableValue(params);
    case "delete_variable":
      return await deleteVariable(params);
    case "delete_variable_collection":
      return await deleteVariableCollection(params);
    case "bind_variable":
      return await bindVariable(params);
    case "add_interaction":
      return await addInteraction(params);
    case "set_reactions":
      return await setReactions(params);
    case "remove_interactions":
      return await removeInteractions(params);
    case "get_flow_starting_points":
      return await getFlowStartingPoints();
    case "set_flow_starting_point":
      return await setFlowStartingPoint(params);
    case "remove_flow_starting_point":
      return await removeFlowStartingPoint(params);
    case "set_overlay_settings":
      return await setOverlaySettings(params);
    case "set_scroll_behavior":
      return await setScrollBehavior(params);
    case "set_frame_properties":
      return await setFrameProperties(params);
    case "create_text_style":
      return await createTextStyle(params);
    case "update_text_style":
      return await updateTextStyle(params);
    case "apply_text_style":
      return await applyTextStyle(params);
    case "set_text_decoration":
      return await setTextDecoration(params);
    case "set_visible":
      return await setVisible(params);
    case "get_main_component":
      return await getMainComponent(params);
    case "delete_style":
      return await deleteStyle(params);
    case "set_effects":
      return await setEffects(params);
    case "create_effect_style":
      return await createEffectStyle(params);
    case "update_effect_style":
      return await updateEffectStyle(params);
    case "apply_effect_style":
      return await applyEffectStyle(params);
    case "create_ellipse":
      return await createEllipse(params);
    case "create_line":
      return await createLine(params);
    case "create_polygon":
      return await createPolygon(params);
    case "create_star":
      return await createStar(params);
    case "create_vector":
      return await createVector(params);
    case "group_nodes":
      return await groupNodes(params);
    case "ungroup_node":
      return await ungroupNode(params);
    case "boolean_operation":
      return await booleanOperation(params);
    case "flatten_nodes":
      return await flattenNodes(params);
    case "set_text_properties":
      return await setTextProperties(params);
    case "set_node_properties":
      return await setNodeProperties(params);
    case "set_gradient_fill":
      return await setGradientFill(params);
    case "create_paint_style":
      return await createPaintStyle(params);
    case "update_paint_style":
      return await updatePaintStyle(params);
    case "apply_paint_style":
      return await applyPaintStyle(params);
    case "set_stroke_properties":
      return await setStrokeProperties(params);
    case "get_pages":
      return await getPages();
    case "create_page":
      return await createPage(params);
    case "set_current_page":
      return await setCurrentPage(params);
    case "detach_instance":
      return await detachInstance(params);
    case "set_constraints":
      return await setConstraints(params);
    case "set_layout_grids":
      return await setLayoutGrids(params);
    case "reorder_node":
      return await reorderNode(params);
    case "get_node_css":
      return await getNodeCss(params);
    case "find_nodes":
      return await findNodes(params);
    case "create_sticky":
      return await createSticky(params);
    case "create_shape_with_text":
      return await createShapeWithText(params);
    case "create_table":
      return await createTable(params);
    case "set_shared_plugin_data":
      return await setSharedPluginDataCommand(params);
    case "get_shared_plugin_data":
      return await getSharedPluginDataCommand(params);
    case "update_variable":
      return await updateVariable(params);
    case "update_variable_collection":
      return await updateVariableCollection(params);
    case "manage_variable_modes":
      return await manageVariableModes(params);
    case "set_variable_mode":
      return await setVariableMode(params);
    case "import_style_by_key":
      return await importStyleByKey(params);
    case "import_variable_by_key":
      return await importVariableByKey(params);
    case "get_library_variable_collections":
      return await getLibraryVariableCollections();
    case "get_library_variables":
      return await getLibraryVariables(params);
    case "edit_component_property":
      return await editComponentProperty(params);
    case "delete_component_property":
      return await deleteComponentProperty(params);
    case "reset_instance_overrides":
      return await resetInstanceOverrides(params);
    case "set_fills":
      return await setFills(params);
    case "get_available_fonts":
      return await getAvailableFonts(params);
    case "set_layout_child":
      return await setLayoutChild(params);
    case "create_grid_style":
      return await createGridStyle(params);
    case "update_grid_style":
      return await updateGridStyle(params);
    case "apply_grid_style":
      return await applyGridStyle(params);
    case "set_export_settings":
      return await setExportSettings(params);
    case "create_slice":
      return await createSlice(params);
    case "save_version":
      return await saveVersion(params);
    case "set_image_properties":
      return await setImageProperties(params);
    case "duplicate_page":
      return await duplicatePage(params);
    case "get_style_usage":
      return await getStyleUsage(params);
    case "get_viewport":
      return getViewport();
    case "set_viewport":
      return await setViewport(params);
    case "reorder_style":
      return await reorderStyle(params);
    case "reorder_style_folder":
      return reorderStyleFolder(params);
    case "create_code_block":
      return await createCodeBlock(params);
    case "create_link_preview":
      return await createLinkPreview(params);
    case "extend_library_collection":
      return await extendLibraryCollection(params);
    case "get_dev_resources":
      return await getDevResources(params);
    case "add_dev_resource":
      return await addDevResource(params);
    case "edit_dev_resource":
      return await editDevResource(params);
    case "delete_dev_resource":
      return await deleteDevResource(params);
    case "get_annotation_categories":
      return await getAnnotationCategories();
    case "create_annotation_category":
      return await createAnnotationCategory(params);
    case "get_measurements":
      return await getMeasurements(params);
    case "add_measurement":
      return await addMeasurement(params);
    case "edit_measurement":
      return await editMeasurement(params);
    case "delete_measurement":
      return await deleteMeasurement(params);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Command implementations

async function getDocumentInfo() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
}

async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

function rgbaToHex(color) {
  var r = Math.round(color.r * 255);
  var g = Math.round(color.g * 255);
  var b = Math.round(color.b * 255);
  var a = color.a !== undefined ? Math.round(color.a * 255) : 255;

  if (a === 255) {
    return (
      "#" +
      [r, g, b]
        .map((x) => {
          return x.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  return (
    "#" +
    [r, g, b, a]
      .map((x) => {
        return x.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

// liveIndex (id -> live node) is only passed for detail "full"
function filterFigmaNode(node, liveIndex) {
  if (node.type === "VECTOR" && !liveIndex) {
    return null;
  }

  var filtered = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      var processedFill = Object.assign({}, fill);
      if (!liveIndex) delete processedFill.boundVariables;
      delete processedFill.imageRef;

      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map(
          (stop) => {
            var processedStop = Object.assign({}, stop);
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            if (!liveIndex) delete processedStop.boundVariables;
            return processedStop;
          },
        );
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      var processedStroke = Object.assign({}, stroke);
      if (!liveIndex) delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  if (liveIndex && liveIndex[node.id]) {
    Object.assign(filtered, collectFullNodeProps(liveIndex[node.id]));
  }

  if (node.children) {
    filtered.children = node.children
      .map((child) => {
        return filterFigmaNode(child, liveIndex);
      })
      .filter((child) => {
        return child !== null;
      });
  }

  return filtered;
}

async function getNodeInfo(nodeId, detail) {
  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const response = await node.exportAsync({
    format: "JSON_REST_V1",
  });

  return filterFigmaNode(response.document, liveIndexForDetail(node, detail));
}

function liveIndexForDetail(node, detail) {
  if (detail === undefined || detail === "basic") return null;
  if (detail !== "full") {
    throw new Error('detail must be "basic" or "full"');
  }
  return indexLiveNodes(node, {});
}

function indexLiveNodes(node, index) {
  index[node.id] = node;
  if ("children" in node) {
    for (const child of node.children) {
      indexLiveNodes(child, index);
    }
  }
  return index;
}

// Live-node properties added by get_node_info with detail "full"
const FULL_DETAIL_KEYS = [
  "visible",
  "locked",
  "opacity",
  "rotation",
  "blendMode",
  "isMask",
  "constraints",
  "effects",
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "boundVariables",
  "explicitVariableModes",
  "componentProperties",
  "componentPropertyDefinitions",
  "componentPropertyReferences",
  "layoutMode",
  "layoutWrap",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "itemSpacing",
  "counterAxisSpacing",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutPositioning",
  "layoutGrow",
  "layoutAlign",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "clipsContent",
  "strokeWeight",
  "strokeAlign",
  "dashPattern",
];

const MAX_VECTOR_PATH_DATA = 200;

// figma.mixed is a symbol and cannot be posted to the UI
function serializeFigmaValue(value) {
  if (value === figma.mixed) return "mixed";
  if (typeof value === "symbol" || typeof value === "function") {
    return undefined;
  }
  if (Array.isArray(value)) return value.map(serializeFigmaValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      const serialized = serializeFigmaValue(value[key]);
      if (serialized !== undefined) out[key] = serialized;
    }
    return out;
  }
  return value;
}

function collectFullNodeProps(node) {
  const source = /** @type {any} */ (node);
  const props = {};
  for (const key of FULL_DETAIL_KEYS) {
    if (!(key in source)) continue;
    let value;
    try {
      value = source[key];
    } catch (error) {
      // e.g. componentPropertyDefinitions on a variant inside a component set
      continue;
    }
    const serialized = serializeFigmaValue(value);
    if (serialized !== undefined) props[key] = serialized;
  }
  if (Array.isArray(source.vectorPaths)) {
    props.vectorPathCount = source.vectorPaths.length;
    props.vectorPaths = source.vectorPaths.map((path) => ({
      windingRule: path.windingRule,
      data:
        path.data.length > MAX_VECTOR_PATH_DATA
          ? path.data.slice(0, MAX_VECTOR_PATH_DATA) + "…"
          : path.data,
    }));
  }
  return props;
}

async function getNodesInfo(nodeIds, detail) {
  try {
    // Load all nodes in parallel
    const nodes = await Promise.all(
      nodeIds.map((id) => figma.getNodeByIdAsync(id)),
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(
            response.document,
            liveIndexForDetail(node, detail),
          ),
        };
      }),
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function getReactions(nodeIds) {
  try {
    const commandId = generateCommandId();
    sendProgressUpdate(
      commandId,
      "get_reactions",
      "started",
      0,
      nodeIds.length,
      0,
      `Starting deep search for reactions in ${nodeIds.length} nodes and their children`,
    );

    // Function to find nodes with reactions from the node and all its children
    async function findNodesWithReactions(
      node,
      processedNodes = new Set(),
      depth = 0,
      results = [],
    ) {
      // Skip already processed nodes (prevent circular references)
      if (processedNodes.has(node.id)) {
        return results;
      }

      processedNodes.add(node.id);

      // Check if the current node has reactions
      let filteredReactions = [];
      if (node.reactions && node.reactions.length > 0) {
        // Filter out reactions with navigation === 'CHANGE_TO'
        filteredReactions = node.reactions.filter((r) => {
          // Some reactions may have action or actions array
          if (r.action && r.action.navigation === "CHANGE_TO") return false;
          if (Array.isArray(r.actions)) {
            // If any action in actions array is CHANGE_TO, exclude
            return !r.actions.some((a) => a.navigation === "CHANGE_TO");
          }
          return true;
        });
      }
      const hasFilteredReactions = filteredReactions.length > 0;

      // If the node has filtered reactions, add it to results and apply highlight effect
      if (hasFilteredReactions) {
        results.push({
          id: node.id,
          name: node.name,
          type: node.type,
          depth: depth,
          hasReactions: true,
          reactions: filteredReactions,
          path: getNodePath(node),
        });
        // Apply highlight effect (orange border)
        await highlightNodeWithAnimation(node);
      }

      // If node has children, recursively search them
      if (node.children) {
        for (const child of node.children) {
          await findNodesWithReactions(
            child,
            processedNodes,
            depth + 1,
            results,
          );
        }
      }

      return results;
    }

    // Function to apply animated highlight effect to a node
    async function highlightNodeWithAnimation(node) {
      // Save original stroke properties
      const originalStrokeWeight = node.strokeWeight;
      const originalStrokes = node.strokes ? [...node.strokes] : [];

      try {
        // Apply orange border stroke
        node.strokeWeight = 4;
        node.strokes = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 }, // Orange color
            opacity: 0.8,
          },
        ];

        // Set timeout for animation effect (restore to original after 1.5 seconds)
        setTimeout(() => {
          try {
            // Restore original stroke properties
            node.strokeWeight = originalStrokeWeight;
            node.strokes = originalStrokes;
          } catch (restoreError) {
            console.error(
              `Error restoring node stroke: ${restoreError.message}`,
            );
          }
        }, 1500);
      } catch (highlightError) {
        console.error(`Error highlighting node: ${highlightError.message}`);
        // Continue even if highlighting fails
      }
    }

    // Get node hierarchy path as a string
    function getNodePath(node) {
      const path = [];
      let current = node;

      while (current && current.parent) {
        path.unshift(current.name);
        current = current.parent;
      }

      return path.join(" > ");
    }

    // Array to store all results
    let allResults = [];
    let processedCount = 0;
    const totalCount = nodeIds.length;

    // Iterate through each node and its children to search for reactions
    for (let i = 0; i < nodeIds.length; i++) {
      try {
        const nodeId = nodeIds[i];
        const node = await figma.getNodeByIdAsync(nodeId);

        if (!node) {
          processedCount++;
          sendProgressUpdate(
            commandId,
            "get_reactions",
            "in_progress",
            processedCount / totalCount,
            totalCount,
            processedCount,
            `Node not found: ${nodeId}`,
          );
          continue;
        }

        // Search for reactions in the node and its children
        const processedNodes = new Set();
        const nodeResults = await findNodesWithReactions(node, processedNodes);

        // Add results
        allResults = allResults.concat(nodeResults);

        // Update progress
        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Processed node ${processedCount}/${totalCount}, found ${nodeResults.length} nodes with reactions`,
        );
      } catch (error) {
        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Error processing node: ${error.message}`,
        );
      }
    }

    // Completion update
    sendProgressUpdate(
      commandId,
      "get_reactions",
      "completed",
      1,
      totalCount,
      totalCount,
      `Completed deep search: found ${allResults.length} nodes with reactions.`,
    );

    return {
      nodesCount: nodeIds.length,
      nodesWithReactions: allResults.length,
      nodes: allResults,
    };
  } catch (error) {
    throw new Error(`Failed to get reactions: ${error.message}`);
  }
}

async function readMyDesign() {
  try {
    // Load all selected nodes in parallel
    const nodes = await Promise.all(
      figma.currentPage.selection.map((node) =>
        figma.getNodeByIdAsync(node.id),
      ),
    );

    // Filter out any null values (nodes that weren't found)
    /** @type {any} */
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(response.document),
        };
      }),
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function createRectangle(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Rectangle",
    parentId,
  } = params || {};

  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.name = name;

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    /** @type {any} */
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  return {
    id: rect.id,
    name: rect.name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    parentId: rect.parent ? rect.parent.id : undefined,
  };
}

async function createFrame(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Frame",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode = "NONE",
    layoutWrap = "NO_WRAP",
    paddingTop = 10,
    paddingRight = 10,
    paddingBottom = 10,
    paddingLeft = 10,
    primaryAxisAlignItems = "MIN",
    counterAxisAlignItems = "MIN",
    layoutSizingHorizontal = "FIXED",
    layoutSizingVertical = "FIXED",
    itemSpacing = 0,
  } = params || {};

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  // Set layout mode if provided
  if (layoutMode !== "NONE") {
    frame.layoutMode = layoutMode;
    frame.layoutWrap = layoutWrap;

    // Set padding values only when layoutMode is not NONE
    frame.paddingTop = paddingTop;
    frame.paddingRight = paddingRight;
    frame.paddingBottom = paddingBottom;
    frame.paddingLeft = paddingLeft;

    // Set axis alignment only when layoutMode is not NONE
    frame.primaryAxisAlignItems = primaryAxisAlignItems;
    frame.counterAxisAlignItems = counterAxisAlignItems;

    // Set layout sizing only when layoutMode is not NONE
    frame.layoutSizingHorizontal = layoutSizingHorizontal;
    frame.layoutSizingVertical = layoutSizingVertical;

    // Set item spacing only when layoutMode is not NONE
    frame.itemSpacing = itemSpacing;
  }

  // Set fill color if provided
  if (fillColor) {
    /** @type {any} */
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    frame.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    /** @type {any} */
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    frame.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    frame.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    /** @type {any} */
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(frame);
  } else {
    figma.currentPage.appendChild(frame);
  }

  return {
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    fills: frame.fills,
    strokes: frame.strokes,
    strokeWeight: frame.strokeWeight,
    layoutMode: frame.layoutMode,
    layoutWrap: frame.layoutWrap,
    parentId: frame.parent ? frame.parent.id : undefined,
  };
}

async function createText(params) {
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontSize = 14,
    fontWeight = 400,
    fontColor = { r: 0, g: 0, b: 0, a: 1 }, // Default to black
    name = "",
    parentId,
    fontFamily,
    fontStyle,
  } = params || {};

  // Map common font weights to Figma font styles
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  };

  let fontName = {
    family: fontFamily || "Inter",
    style: fontStyle || getFontStyle(fontWeight),
  };
  // An explicitly requested font must load; check before creating the node
  if (fontStyle) {
    await loadFontOrThrow(fontName);
  } else if (fontFamily) {
    // Families differ in naming ("Semi Bold" vs "SemiBold"); try variants
    const weightStyle = fontName.style;
    const candidates = [weightStyle];
    const compact = weightStyle.replace(/ /g, "");
    if (candidates.indexOf(compact) === -1) candidates.push(compact);
    if (candidates.indexOf("Regular") === -1) candidates.push("Regular");
    let loaded = null;
    for (const style of candidates) {
      try {
        await figma.loadFontAsync({ family: fontFamily, style });
        loaded = { family: fontFamily, style };
        break;
      } catch (error) {
        // try the next candidate style
      }
    }
    if (!loaded) {
      throw new Error(
        `Font "${fontFamily}" is not available in styles: ${candidates.join(", ")}`,
      );
    }
    fontName = loaded;
  }

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name || text;
  try {
    await figma.loadFontAsync(fontName);
    textNode.fontName = fontName;
    textNode.fontSize = parseInt(fontSize);
  } catch (error) {
    console.error("Error setting font size", error);
  }
  await setCharacters(textNode, text);

  // Set text color
  /** @type {any} */
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(fontColor.r) || 0,
      g: parseFloat(fontColor.g) || 0,
      b: parseFloat(fontColor.b) || 0,
    },
    opacity: parseFloat(fontColor.a) || 1,
  };
  textNode.fills = [paintStyle];

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    /** @type {any} */
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontWeight: fontWeight,
    fontColor: fontColor,
    fontName: textNode.fontName,
    fills: textNode.fills,
    parentId: textNode.parent ? textNode.parent.id : undefined,
  };
}

async function createNodeFromSvg(params) {
  const { svg, name, parentId, x, y } = params || {};

  if (typeof svg !== "string" || svg.trim() === "") {
    throw new Error("Missing svg parameter");
  }
  if (svg.toLowerCase().indexOf("<svg") === -1) {
    throw new Error("svg parameter must contain an <svg> element");
  }

  // Resolve the parent before creating anything
  /** @type {any} */
  let parent = figma.currentPage;
  if (parentId) {
    parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parent)) {
      throw new Error(
        `Parent node ${parentId} (${parent.type}) does not support children`,
      );
    }
  }

  let node;
  try {
    node = figma.createNodeFromSvg(svg);
  } catch (error) {
    throw new Error(`Invalid SVG, Figma could not parse it: ${error.message}`);
  }

  try {
    if (name !== undefined && name !== null) {
      node.name = String(name);
    }
    parent.appendChild(node);
    if (typeof x === "number") {
      node.x = x;
    }
    if (typeof y === "number") {
      node.y = y;
    }
  } catch (error) {
    // Do not leave a half-placed node behind
    let rollbackNote = "";
    try {
      node.remove();
    } catch (removeError) {
      rollbackNote = ` (rollback failed, node ${node.id} may remain: ${removeError.message})`;
    }
    throw new Error(`Cannot place SVG node: ${error.message}${rollbackNote}`);
  }

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    parentId: node.parent ? node.parent.id : undefined,
  };
}

async function setFillColor(params) {
  console.log("setFillColor", params);
  const {
    nodeId,
    color: { r, g, b, a },
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Create RGBA color
  /** @type {any} */
  const rgbColor = {
    r: parseFloat(r) || 0,
    g: parseFloat(g) || 0,
    b: parseFloat(b) || 0,
    a: parseFloat(a) || 1,
  };

  // Set fill
  /** @type {any} */
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(rgbColor.r),
      g: parseFloat(rgbColor.g),
      b: parseFloat(rgbColor.b),
    },
    opacity: parseFloat(rgbColor.a),
  };

  console.log("paintStyle", paintStyle);

  node.fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

async function setStrokeColor(params) {
  const {
    nodeId,
    color: { r, g, b, a },
    weight = 1,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  // Create RGBA color
  const rgbColor = {
    r: r !== undefined ? r : 0,
    g: g !== undefined ? g : 0,
    b: b !== undefined ? b : 0,
    a: a !== undefined ? a : 1,
  };

  // Set stroke
  /** @type {any} */
  const paintStyle = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  node.strokes = [paintStyle];

  // Set stroke weight if available
  if ("strokeWeight" in node) {
    node.strokeWeight = weight;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: node.strokes,
    strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
  };
}

async function setImageFill(params) {
  const { nodeId, imageBase64, scaleMode = "FILL" } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!imageBase64) {
    throw new Error("Missing imageBase64 parameter");
  }

  const validScaleModes = ["FILL", "FIT", "CROP", "TILE"];
  if (validScaleModes.indexOf(scaleMode) === -1) {
    throw new Error(
      `Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(", ")}`,
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Validate the optional crop/filter options before uploading the image
  const imageOptions = buildImagePaintOptions(params || {}, scaleMode, null);

  const bytes = base64ToUint8Array(imageBase64);

  let image;
  try {
    image = figma.createImage(bytes);
  } catch (error) {
    throw new Error(
      `Figma rejected the image (supported: PNG/JPG/GIF/WEBP up to 4096x4096): ${error.message}`,
    );
  }

  node.fills = [
    Object.assign(
      {
        type: "IMAGE",
        imageHash: image.hash,
        scaleMode: scaleMode,
      },
      imageOptions,
    ),
  ];

  let imageWidth;
  let imageHeight;
  try {
    const size = await image.getSizeAsync();
    imageWidth = size.width;
    imageHeight = size.height;
  } catch (sizeError) {
    // Size lookup is informational only
  }

  return {
    id: node.id,
    name: node.name,
    imageHash: image.hash,
    scaleMode: scaleMode,
    imageWidth: imageWidth,
    imageHeight: imageHeight,
    imageTransform: imageOptions.imageTransform,
    scalingFactor: imageOptions.scalingFactor,
    rotation: imageOptions.rotation,
    filters: imageOptions.filters,
  };
}

const IMAGE_FILTER_KEYS = [
  "exposure",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "highlights",
  "shadows",
];
const IDENTITY_IMAGE_TRANSFORM = [
  [1, 0, 0],
  [0, 1, 0],
];

function parseImageTransform(value) {
  const valid =
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 3 &&
        row.every((n) => typeof n === "number" && isFinite(n)),
    );
  if (!valid) {
    throw new Error("imageTransform must be a 2x3 matrix [[a, b, tx], [c, d, ty]]");
  }
  return [value[0].slice(), value[1].slice()];
}

// Builds the scaleMode-specific IMAGE paint fields (imageTransform, scalingFactor,
// rotation, filters). `current` is an existing IMAGE paint whose applicable
// fields are kept unless overridden; pass null for a new paint.
function buildImagePaintOptions(p, scaleMode, current) {
  /** @type {any} */
  const options = {};
  /** @type {any} */
  const base = current || {};
  if (p.imageTransform !== undefined && scaleMode !== "CROP") {
    throw new Error("imageTransform only applies to scaleMode CROP");
  }
  if (p.scalingFactor !== undefined && scaleMode !== "TILE") {
    throw new Error("scalingFactor only applies to scaleMode TILE");
  }
  if (p.rotation !== undefined && scaleMode === "CROP") {
    throw new Error("rotation does not apply to scaleMode CROP (rotate via imageTransform)");
  }

  if (scaleMode === "CROP") {
    if (p.imageTransform !== undefined) {
      options.imageTransform = parseImageTransform(p.imageTransform);
    } else if (base.scaleMode === "CROP" && base.imageTransform) {
      options.imageTransform = parseImageTransform(base.imageTransform);
    } else {
      // CROP requires a transform; identity shows the whole image unscaled
      options.imageTransform = parseImageTransform(IDENTITY_IMAGE_TRANSFORM);
    }
  }
  if (scaleMode === "TILE") {
    const factor =
      p.scalingFactor !== undefined ? Number(p.scalingFactor) : base.scalingFactor;
    if (factor !== undefined) {
      if (!(factor > 0) || !isFinite(factor)) {
        throw new Error("scalingFactor must be a number > 0");
      }
      options.scalingFactor = factor;
    }
  }
  if (scaleMode !== "CROP") {
    const rotation = p.rotation !== undefined ? Number(p.rotation) : base.rotation;
    if (rotation !== undefined) {
      if ([0, 90, 180, 270].indexOf(rotation) === -1) {
        throw new Error("rotation must be 0, 90, 180 or 270");
      }
      options.rotation = rotation;
    }
  }

  const filters = Object.assign({}, base.filters || {});
  if (p.filters !== undefined) {
    if (!p.filters || typeof p.filters !== "object" || Array.isArray(p.filters)) {
      throw new Error("filters must be an object");
    }
    for (const key of Object.keys(p.filters)) {
      if (IMAGE_FILTER_KEYS.indexOf(key) === -1) {
        throw new Error(
          `Unknown image filter "${key}". Use: ${IMAGE_FILTER_KEYS.join(", ")}`,
        );
      }
      const value = Number(p.filters[key]);
      if (!(value >= -1 && value <= 1)) {
        throw new Error(`filters.${key} must be between -1 and 1`);
      }
      filters[key] = value;
    }
  }
  if (Object.keys(filters).length) options.filters = filters;
  return options;
}

// Decode base64 in the plugin sandbox, where atob is not available
function base64ToUint8Array(base64) {
  if (typeof figma.base64Decode === "function") {
    return figma.base64Decode(base64);
  }

  const base64Chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const length = clean.length;
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));

  let byteIndex = 0;
  for (let i = 0; i < length; i += 4) {
    const a = base64Chars.indexOf(clean[i]);
    const b = base64Chars.indexOf(clean[i + 1]);
    const c = base64Chars.indexOf(clean[i + 2]);
    const d = base64Chars.indexOf(clean[i + 3]);

    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (c !== -1) bytes[byteIndex++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) bytes[byteIndex++] = ((c & 3) << 6) | d;
  }

  return bytes.slice(0, byteIndex);
}

async function renameNode(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (name === undefined || name === null) {
    throw new Error("Missing name parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const previousName = node.name;
  try {
    node.name = String(name);
  } catch (error) {
    throw new Error(`Cannot rename node: ${error.message}`);
  }

  return {
    id: node.id,
    previousName: previousName,
    name: node.name,
  };
}

async function createSection(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Section",
  } = params || {};

  const section = figma.createSection();
  section.name = name;
  section.x = x;
  section.y = y;
  section.resizeWithoutConstraints(width, height);

  return {
    id: section.id,
    name: section.name,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
  };
}

async function setParent(params) {
  const { nodeId, parentId, x, y, index } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!parentId) {
    throw new Error("Missing parentId parameter");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  /** @type {any} */
  const parentNode = await figma.getNodeByIdAsync(parentId);
  if (!parentNode) {
    throw new Error(`Parent node not found with ID: ${parentId}`);
  }

  if (!("appendChild" in parentNode)) {
    throw new Error(`Parent node does not support children: ${parentId}`);
  }

  // Refuse to create a cycle
  let ancestor = parentNode;
  while (ancestor) {
    if (ancestor.id === node.id) {
      throw new Error("Cannot move a node into its own subtree");
    }
    ancestor = ancestor.parent;
  }

  // Capture the absolute position so it can be preserved across the move
  const hasAbsolute = "absoluteTransform" in node;
  const absoluteX = hasAbsolute ? node.absoluteTransform[0][2] : undefined;
  const absoluteY = hasAbsolute ? node.absoluteTransform[1][2] : undefined;

  if (index !== undefined) {
    parentNode.insertChild(index, node);
  } else {
    parentNode.appendChild(node);
  }

  if (x !== undefined && y !== undefined) {
    node.x = x;
    node.y = y;
  } else if (hasAbsolute && "x" in node) {
    const parentAbsoluteX =
      "absoluteTransform" in parentNode
        ? parentNode.absoluteTransform[0][2]
        : 0;
    const parentAbsoluteY =
      "absoluteTransform" in parentNode
        ? parentNode.absoluteTransform[1][2]
        : 0;
    node.x = absoluteX - parentAbsoluteX;
    node.y = absoluteY - parentAbsoluteY;
  }

  return {
    id: node.id,
    name: node.name,
    parentId: parentNode.id,
    parentName: parentNode.name,
    x: "x" in node ? node.x : undefined,
    y: "y" in node ? node.y : undefined,
    index: parentNode.children.indexOf(node),
  };
}

async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (x === undefined || y === undefined) {
    throw new Error("Missing x or y parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("x" in node) || !("y" in node)) {
    throw new Error(`Node does not support position: ${nodeId}`);
  }

  node.x = x;
  node.y = y;

  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
  };
}

async function resizeNode(params) {
  const { nodeId, width, height } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (width === undefined || height === undefined) {
    throw new Error("Missing width or height parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("resize" in node)) {
    throw new Error(`Node does not support resizing: ${nodeId}`);
  }

  node.resize(width, height);

  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
  };
}

async function deleteNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Save node info before deleting
  const nodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  node.remove();

  return nodeInfo;
}

async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

function fontStyleFromWeight(fontWeight) {
  switch (Number(fontWeight)) {
    case 100:
      return "Thin";
    case 200:
      return "Extra Light";
    case 300:
      return "Light";
    case 500:
      return "Medium";
    case 600:
      return "Semi Bold";
    case 700:
      return "Bold";
    case 800:
      return "Extra Bold";
    case 900:
      return "Black";
    default:
      return "Regular";
  }
}

function serializeTextStyle(style) {
  return {
    id: style.id,
    name: style.name,
    key: style.key,
    description: style.description,
    fontName: style.fontName,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textCase: style.textCase,
    textDecoration: style.textDecoration,
    paragraphSpacing: style.paragraphSpacing,
  };
}

// Apply typography props shared by create_text_style and update_text_style
async function applyTextStyleProps(style, params) {
  const {
    name,
    description,
    fontFamily,
    fontStyle,
    fontWeight,
    fontSize,
    lineHeight,
    letterSpacing,
    textCase,
    textDecoration,
    paragraphSpacing,
  } = params;

  if (
    fontFamily !== undefined ||
    fontStyle !== undefined ||
    fontWeight !== undefined
  ) {
    const fontName = {
      family: fontFamily || style.fontName.family || "Inter",
      style:
        fontStyle ||
        (fontWeight !== undefined
          ? fontStyleFromWeight(fontWeight)
          : style.fontName.style),
    };
    await figma.loadFontAsync(fontName);
    style.fontName = fontName;
  } else {
    await figma.loadFontAsync(style.fontName);
  }

  if (name !== undefined) style.name = name;
  if (description !== undefined) style.description = description;
  if (fontSize !== undefined) style.fontSize = Number(fontSize);
  if (lineHeight !== undefined) {
    // Accept a number (pixels), "AUTO", or { unit, value }
    if (typeof lineHeight === "number") {
      style.lineHeight = { unit: "PIXELS", value: lineHeight };
    } else if (
      lineHeight === "AUTO" ||
      (lineHeight && lineHeight.unit === "AUTO")
    ) {
      style.lineHeight = { unit: "AUTO" };
    } else {
      style.lineHeight = {
        unit: lineHeight.unit,
        value: Number(lineHeight.value),
      };
    }
  }
  if (letterSpacing !== undefined) {
    // Accept a number (pixels) or { unit, value }
    style.letterSpacing =
      typeof letterSpacing === "number"
        ? { unit: "PIXELS", value: letterSpacing }
        : { unit: letterSpacing.unit, value: Number(letterSpacing.value) };
  }
  if (textCase !== undefined) style.textCase = textCase;
  if (textDecoration !== undefined) style.textDecoration = textDecoration;
  if (paragraphSpacing !== undefined)
    style.paragraphSpacing = Number(paragraphSpacing);
}

async function createTextStyle(params) {
  const { name } = params || {};
  if (!name) {
    throw new Error("Missing name parameter");
  }

  const style = figma.createTextStyle();
  try {
    await applyTextStyleProps(style, params);
  } catch (error) {
    style.remove();
    throw new Error(`Error creating text style: ${error.message}`);
  }
  return serializeTextStyle(style);
}

async function updateTextStyle(params) {
  const { styleId } = params || {};
  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== "TEXT") {
    throw new Error(`Text style with ID ${styleId} not found`);
  }
  await applyTextStyleProps(style, params);
  return serializeTextStyle(style);
}

async function applyTextStyle(params) {
  const { styleId } = params || {};
  const nodeIds =
    (params && params.nodeIds) ||
    (params && params.nodeId ? [params.nodeId] : []);
  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }
  if (!nodeIds.length) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }

  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== "TEXT") {
    throw new Error(`Text style with ID ${styleId} not found`);
  }
  await figma.loadFontAsync(style.fontName);

  const results = [];
  for (const nodeId of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("Node not found");
      if (node.type !== "TEXT")
        throw new Error(`Node type ${node.type} is not TEXT`);
      if (node.fontName !== figma.mixed) {
        await figma.loadFontAsync(node.fontName);
      } else {
        const fonts = node.getRangeAllFontNames(0, node.characters.length);
        await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
      }
      if (typeof node.setTextStyleIdAsync === "function") {
        await node.setTextStyleIdAsync(style.id);
      } else {
        node.textStyleId = style.id;
      }
      results.push({ nodeId, success: true });
    } catch (error) {
      results.push({ nodeId, success: false, error: error.message });
    }
  }

  return {
    styleId: style.id,
    styleName: style.name,
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function setVisible(params) {
  const { visible } = params || {};
  const nodeIds =
    (params && params.nodeIds) ||
    (params && params.nodeId ? [params.nodeId] : []);
  if (typeof visible !== "boolean") {
    throw new Error("visible must be a boolean");
  }
  if (!nodeIds.length) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }

  const results = [];
  for (const nodeId of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("Node not found");
      if (!("visible" in node))
        throw new Error(`Node type ${node.type} has no visibility`);
      node.visible = visible;
      results.push({ nodeId, name: node.name, success: true });
    } catch (error) {
      results.push({ nodeId, success: false, error: error.message });
    }
  }

  return {
    visible,
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function getMainComponent(params) {
  const nodeIds =
    (params && params.nodeIds) ||
    (params && params.nodeId ? [params.nodeId] : []);
  if (!nodeIds.length) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }

  const results = [];
  for (const nodeId of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("Node not found");
      if (node.type !== "INSTANCE")
        throw new Error(`Node type ${node.type} is not INSTANCE`);
      const main = await node.getMainComponentAsync();
      if (!main) throw new Error("Main component not found");
      const set =
        main.parent && main.parent.type === "COMPONENT_SET"
          ? main.parent
          : null;
      results.push({
        nodeId,
        name: node.name,
        visible: node.visible,
        mainComponentId: main.id,
        mainComponentName: main.name,
        componentSetId: set ? set.id : null,
        componentSetName: set ? set.name : null,
        success: true,
      });
    } catch (error) {
      results.push({ nodeId, success: false, error: error.message });
    }
  }

  return { count: results.length, results };
}

async function setTextDecoration(params) {
  const { decoration, start, end } = params || {};
  const nodeIds =
    (params && params.nodeIds) ||
    (params && params.nodeId ? [params.nodeId] : []);
  const allowed = ["NONE", "UNDERLINE", "STRIKETHROUGH"];
  if (!allowed.includes(decoration)) {
    throw new Error(`decoration must be one of ${allowed.join(", ")}`);
  }
  if (!nodeIds.length) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }

  const results = [];
  for (const nodeId of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("Node not found");
      if (node.type !== "TEXT")
        throw new Error(`Node type ${node.type} is not TEXT`);
      const length = node.characters.length;
      const fonts = node.getRangeAllFontNames(0, length);
      await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
      const hasRange = start !== undefined || end !== undefined;
      if (hasRange) {
        const from = Math.max(0, start || 0);
        const to = Math.min(length, end === undefined ? length : end);
        if (from >= to) throw new Error(`Invalid range ${from}-${to}`);
        node.setRangeTextDecoration(from, to, decoration);
      } else {
        node.textDecoration = decoration;
      }
      results.push({ nodeId, success: true });
    } catch (error) {
      results.push({ nodeId, success: false, error: error.message });
    }
  }

  return {
    decoration,
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function deleteStyle(params) {
  const { styleId } = params || {};
  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  const style = await figma.getStyleByIdAsync(styleId);
  if (!style) {
    throw new Error(`Style with ID ${styleId} not found`);
  }
  const info = { id: style.id, name: style.name, type: style.type };
  style.remove();
  return Object.assign({ deleted: true }, info);
}

async function setEffects(params) {
  const { nodeId, effects } = params || {};
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!Array.isArray(effects)) {
    throw new Error("effects must be an array (use [] to clear)");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }
  if (!("effects" in node)) {
    throw new Error(`Node type ${node.type} does not support effects`);
  }

  node.effects = normalizeEffects(effects);

  return { id: node.id, name: node.name, effects: node.effects };
}

// Convert loose effect input (set_effects / *_effect_style) to Plugin API effects
function normalizeEffects(effects) {
  return effects.map((effect) => {
    const visible = effect.visible !== false;
    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      const color = effect.color || { r: 0, g: 0, b: 0, a: 0.1 };
      const shadow = {
        type: effect.type,
        color: {
          r: Number(color.r),
          g: Number(color.g),
          b: Number(color.b),
          a: color.a === undefined ? 1 : Number(color.a),
        },
        offset: {
          x: Number((effect.offset && effect.offset.x) || 0),
          y: Number((effect.offset && effect.offset.y) || 0),
        },
        radius: Number(effect.radius || 0),
        spread: Number(effect.spread || 0),
        visible,
        blendMode: effect.blendMode || "NORMAL",
      };
      if (
        effect.type === "DROP_SHADOW" &&
        effect.showShadowBehindNode !== undefined
      ) {
        shadow.showShadowBehindNode = Boolean(effect.showShadowBehindNode);
      }
      return shadow;
    }
    if (effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR") {
      return { type: effect.type, radius: Number(effect.radius || 0), visible };
    }
    throw new Error(`Unsupported effect type: ${effect.type}`);
  });
}

function serializeEffectStyle(style) {
  return {
    id: style.id,
    key: style.key,
    name: style.name,
    description: style.description,
    effects: style.effects,
  };
}

async function createEffectStyle(params) {
  const { name, effects, description } = params || {};
  if (!name) {
    throw new Error("Missing name parameter");
  }
  if (!Array.isArray(effects) || !effects.length) {
    throw new Error("effects must be a non-empty array");
  }

  const normalized = normalizeEffects(effects);
  const style = figma.createEffectStyle();
  try {
    style.name = name;
    style.effects = normalized;
    if (description !== undefined) style.description = description;
  } catch (error) {
    style.remove();
    throw new Error(`Error creating effect style: ${error.message}`);
  }
  return serializeEffectStyle(style);
}

async function updateEffectStyle(params) {
  const { styleId, name, effects, description } = params || {};
  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== "EFFECT") {
    throw new Error(`Effect style with ID ${styleId} not found`);
  }
  if (effects !== undefined) {
    if (!Array.isArray(effects)) {
      throw new Error("effects must be an array");
    }
    style.effects = normalizeEffects(effects);
  }
  if (name !== undefined) style.name = name;
  if (description !== undefined) style.description = description;
  return serializeEffectStyle(style);
}

async function applyEffectStyle(params) {
  const { styleId } = params || {};
  const nodeIds =
    (params && params.nodeIds) ||
    (params && params.nodeId ? [params.nodeId] : []);
  if (styleId === undefined) {
    throw new Error("Missing styleId parameter (use '' to detach)");
  }
  if (!nodeIds.length) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }

  let style = null;
  if (styleId) {
    style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== "EFFECT") {
      throw new Error(`Effect style with ID ${styleId} not found`);
    }
  }

  const results = [];
  for (const nodeId of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("Node not found");
      if (!("effectStyleId" in node))
        throw new Error(`Node type ${node.type} does not support effects`);
      const id = style ? style.id : "";
      if (typeof node.setEffectStyleIdAsync === "function") {
        await node.setEffectStyleIdAsync(id);
      } else {
        node.effectStyleId = id;
      }
      results.push({ nodeId, success: true });
    } catch (error) {
      results.push({ nodeId, success: false, error: error.message });
    }
  }

  return {
    styleId: style ? style.id : "",
    styleName: style ? style.name : null,
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

// ---------------------------------------------------------------------------
// Shapes, boolean ops, text/node/stroke properties, gradients & paint styles
// ---------------------------------------------------------------------------

/** @returns {any} */
function makeSolidPaint(color) {
  return {
    type: "SOLID",
    color: {
      r: Number(color.r) || 0,
      g: Number(color.g) || 0,
      b: Number(color.b) || 0,
    },
    opacity: color.a === undefined ? 1 : Number(color.a),
  };
}

// Resolve the parent for a new node before creating it, so a bad parentId
// does not leave an orphan node on the page.
/** @returns {Promise<any>} */
async function resolveNewNodeParent(parentId) {
  if (!parentId) return figma.currentPage;
  const parentNode = await figma.getNodeByIdAsync(parentId);
  if (!parentNode) {
    throw new Error(`Parent node not found with ID: ${parentId}`);
  }
  if (!("appendChild" in parentNode)) {
    throw new Error(`Parent node does not support children: ${parentId}`);
  }
  return parentNode;
}

function applyNewShapePaints(node, params) {
  const { fillColor, strokeColor, strokeWeight } = params;
  if (fillColor) node.fills = [makeSolidPaint(fillColor)];
  if (strokeColor) node.strokes = [makeSolidPaint(strokeColor)];
  if (strokeWeight !== undefined) node.strokeWeight = Number(strokeWeight);
}

function serializeNewShape(node) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    parentId: node.parent ? node.parent.id : undefined,
  };
}

function createBasicShape(node, params, defaultName) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = defaultName,
  } = params;
  node.x = Number(x);
  node.y = Number(y);
  node.resize(Number(width), Number(height));
  node.name = name;
  applyNewShapePaints(node, params);
}

async function createEllipse(params) {
  const p = params || {};
  const parent = await resolveNewNodeParent(p.parentId);
  const ellipse = figma.createEllipse();
  try {
    createBasicShape(ellipse, p, "Ellipse");
    if (p.arcData) {
      ellipse.arcData = {
        startingAngle:
          p.arcData.startingAngle === undefined
            ? 0
            : Number(p.arcData.startingAngle),
        endingAngle:
          p.arcData.endingAngle === undefined
            ? 2 * Math.PI
            : Number(p.arcData.endingAngle),
        innerRadius:
          p.arcData.innerRadius === undefined
            ? 0
            : Number(p.arcData.innerRadius),
      };
    }
    parent.appendChild(ellipse);
  } catch (error) {
    ellipse.remove();
    throw new Error(`Error creating ellipse: ${error.message}`);
  }
  return Object.assign(serializeNewShape(ellipse), {
    arcData: ellipse.arcData,
  });
}

async function createLine(params) {
  const {
    x = 0,
    y = 0,
    length,
    rotation,
    name = "Line",
    parentId,
    strokeColor,
    strokeWeight = 1,
  } = params || {};
  if (typeof length !== "number" || length <= 0) {
    throw new Error("length must be a positive number");
  }
  const parent = await resolveNewNodeParent(parentId);
  const line = figma.createLine();
  try {
    line.x = Number(x);
    line.y = Number(y);
    line.resize(length, 0);
    line.name = name;
    line.strokes = [makeSolidPaint(strokeColor || { r: 0, g: 0, b: 0, a: 1 })];
    line.strokeWeight = Number(strokeWeight);
    if (rotation !== undefined) line.rotation = Number(rotation);
    parent.appendChild(line);
  } catch (error) {
    line.remove();
    throw new Error(`Error creating line: ${error.message}`);
  }
  return Object.assign(serializeNewShape(line), {
    strokeWeight: line.strokeWeight,
  });
}

async function createPolygon(params) {
  const p = params || {};
  const pointCount = p.pointCount === undefined ? 3 : Number(p.pointCount);
  if (!Number.isInteger(pointCount) || pointCount < 3) {
    throw new Error("pointCount must be an integer >= 3");
  }
  const parent = await resolveNewNodeParent(p.parentId);
  const polygon = figma.createPolygon();
  try {
    createBasicShape(polygon, p, "Polygon");
    polygon.pointCount = pointCount;
    parent.appendChild(polygon);
  } catch (error) {
    polygon.remove();
    throw new Error(`Error creating polygon: ${error.message}`);
  }
  return Object.assign(serializeNewShape(polygon), {
    pointCount: polygon.pointCount,
  });
}

async function createStar(params) {
  const p = params || {};
  const pointCount = p.pointCount === undefined ? 5 : Number(p.pointCount);
  const innerRadius =
    p.innerRadius === undefined ? 0.382 : Number(p.innerRadius);
  if (!Number.isInteger(pointCount) || pointCount < 3) {
    throw new Error("pointCount must be an integer >= 3");
  }
  if (!(innerRadius >= 0 && innerRadius <= 1)) {
    throw new Error("innerRadius must be between 0 and 1");
  }
  const parent = await resolveNewNodeParent(p.parentId);
  const star = figma.createStar();
  try {
    createBasicShape(star, p, "Star");
    star.pointCount = pointCount;
    star.innerRadius = innerRadius;
    parent.appendChild(star);
  } catch (error) {
    star.remove();
    throw new Error(`Error creating star: ${error.message}`);
  }
  return Object.assign(serializeNewShape(star), {
    pointCount: star.pointCount,
    innerRadius: star.innerRadius,
  });
}

async function createVector(params) {
  const {
    x = 0,
    y = 0,
    name = "Vector",
    parentId,
    paths,
    fillColor,
    strokeColor,
    strokeWeight,
  } = params || {};
  if (!Array.isArray(paths) || !paths.length) {
    throw new Error("paths must be a non-empty array of { data, windingRule }");
  }
  for (const path of paths) {
    if (!path || typeof path.data !== "string" || !path.data.trim()) {
      throw new Error("Each path needs a non-empty SVG path string in data");
    }
  }
  const parent = await resolveNewNodeParent(parentId);
  const vector = figma.createVector();
  try {
    vector.vectorPaths = paths.map((path) => ({
      windingRule: path.windingRule || "NONZERO",
      data: path.data,
    }));
    vector.name = name;
    // Without explicit paints, fill black so the vector is visible
    if (!fillColor && !strokeColor) {
      vector.fills = [makeSolidPaint({ r: 0, g: 0, b: 0, a: 1 })];
    }
    applyNewShapePaints(vector, { fillColor, strokeColor, strokeWeight });
    parent.appendChild(vector);
    vector.x = Number(x);
    vector.y = Number(y);
  } catch (error) {
    vector.remove();
    throw new Error(`Error creating vector: ${error.message}`);
  }
  return Object.assign(serializeNewShape(vector), {
    pathCount: vector.vectorPaths.length,
  });
}

// Load nodes for group/boolean/flatten and require one shared parent
async function getSiblingNodes(nodeIds, minCount) {
  if (!Array.isArray(nodeIds) || nodeIds.length < minCount) {
    throw new Error(`nodeIds must contain at least ${minCount} node ID(s)`);
  }
  const nodes = [];
  for (const nodeId of nodeIds) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
    if (!node.parent) throw new Error(`Node ${nodeId} has no parent`);
    nodes.push(node);
  }
  /** @type {any} */
  const parent = nodes[0].parent;
  for (const node of nodes) {
    if (node.parent.id !== parent.id) {
      throw new Error(
        `All nodes must share the same parent (${node.id} is in ${node.parent.id}, expected ${parent.id})`,
      );
    }
  }
  // Lowest input index: children below it are untouched by the operation, so
  // the result can be reinserted there to keep its slot in the layer order.
  const minIndex = Math.min.apply(
    null,
    nodes.map((node) => parent.children.indexOf(node)),
  );
  return { nodes, parent, minIndex };
}

// figma.group/union/flatten put the result on top of the parent; move it back
function placeAtIndex(parent, result, index) {
  parent.insertChild(index, result);
  return parent.children.indexOf(result);
}

async function groupNodes(params) {
  const { nodeIds, name } = params || {};
  const { nodes, parent, minIndex } = await getSiblingNodes(nodeIds, 1);
  const group = figma.group(nodes, parent);
  const index = placeAtIndex(parent, group, minIndex);
  if (name) group.name = name;
  return Object.assign(serializeNewShape(group), {
    index,
    childIds: group.children.map((child) => child.id),
  });
}

async function ungroupNode(params) {
  const { nodeId } = params || {};
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (node.type !== "GROUP") {
    throw new Error(`Node type ${node.type} is not GROUP`);
  }
  const groupName = node.name;
  const children = figma.ungroup(node);
  return {
    ungroupedId: nodeId,
    name: groupName,
    childIds: children.map((child) => child.id),
    children: children.map((child) => ({
      id: child.id,
      name: child.name,
      type: child.type,
    })),
  };
}

async function booleanOperation(params) {
  const { nodeIds, operation, name } = params || {};
  const operations = {
    UNION: "union",
    SUBTRACT: "subtract",
    INTERSECT: "intersect",
    EXCLUDE: "exclude",
  };
  if (!operations[operation]) {
    throw new Error(
      `operation must be one of ${Object.keys(operations).join(", ")}`,
    );
  }
  const { nodes, parent, minIndex } = await getSiblingNodes(nodeIds, 2);
  const result = figma[operations[operation]](nodes, parent);
  const index = placeAtIndex(parent, result, minIndex);
  if (name) result.name = name;
  return Object.assign(serializeNewShape(result), {
    index,
    booleanOperation: result.booleanOperation,
    childIds: result.children.map((child) => child.id),
  });
}

async function flattenNodes(params) {
  const { nodeIds, name } = params || {};
  const { nodes, parent, minIndex } = await getSiblingNodes(nodeIds, 1);
  const vector = figma.flatten(nodes, parent);
  const index = placeAtIndex(parent, vector, minIndex);
  if (name) vector.name = name;
  return Object.assign(serializeNewShape(vector), { index });
}

async function loadFontOrThrow(fontName) {
  try {
    await figma.loadFontAsync(fontName);
  } catch (error) {
    throw new Error(
      `Font "${fontName.family} ${fontName.style}" is not available: ${error.message}`,
    );
  }
}

function toFiniteValue(field, spec) {
  const value = Number(spec.value);
  if (spec.value === undefined || spec.value === null || !isFinite(value)) {
    throw new Error(
      `${field}.value must be a finite number for unit ${spec.unit}`,
    );
  }
  return value;
}

function toLineHeight(lineHeight) {
  if (lineHeight.unit === "AUTO") return { unit: "AUTO" };
  return {
    unit: lineHeight.unit,
    value: toFiniteValue("lineHeight", lineHeight),
  };
}

async function setTextProperties(params) {
  const {
    nodeId,
    start,
    end,
    fontFamily,
    fontStyle,
    fontSize,
    lineHeight,
    letterSpacing,
    textCase,
    fillColor,
    paragraphSpacing,
    textAlignHorizontal,
    textAlignVertical,
    textAutoResize,
    hyperlink,
    listType,
    indentation,
    textTruncation,
    maxLines,
  } = params || {};
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (node.type !== "TEXT") {
    throw new Error(`Node type ${node.type} is not TEXT`);
  }
  // Validate before any mutation so a bad value doesn't leave partial edits
  if (hyperlink !== undefined && hyperlink !== null) {
    if (
      (hyperlink.type !== "URL" && hyperlink.type !== "NODE") ||
      typeof hyperlink.value !== "string" ||
      hyperlink.value === ""
    ) {
      throw new Error(
        'hyperlink must be { type: "URL" | "NODE", value } or null to remove it',
      );
    }
    if (hyperlink.type === "URL" && !/^(https?:|mailto:)/i.test(hyperlink.value)) {
      throw new Error("hyperlink URL must start with http:, https: or mailto:");
    }
    if (hyperlink.type === "NODE") {
      const target = await figma.getNodeByIdAsync(hyperlink.value);
      if (!target) {
        throw new Error(`hyperlink target node not found: ${hyperlink.value}`);
      }
    }
  }
  if (
    listType !== undefined &&
    ["NONE", "ORDERED", "UNORDERED"].indexOf(listType) === -1
  ) {
    throw new Error(`Invalid listType: ${listType}`);
  }
  if (
    indentation !== undefined &&
    !(Number.isInteger(indentation) && indentation >= 0)
  ) {
    throw new Error("indentation must be an integer >= 0");
  }
  if (
    textTruncation !== undefined &&
    textTruncation !== "DISABLED" &&
    textTruncation !== "ENDING"
  ) {
    throw new Error(`Invalid textTruncation: ${textTruncation}`);
  }
  if (
    maxLines !== undefined &&
    maxLines !== null &&
    !(Number.isInteger(maxLines) && maxLines >= 1)
  ) {
    throw new Error("maxLines must be an integer >= 1, or null to disable it");
  }
  if (typeof maxLines === "number" && textTruncation === "DISABLED") {
    throw new Error('maxLines needs textTruncation "ENDING", not "DISABLED"');
  }
  /** @type {any} */
  const lineHeightValue =
    lineHeight !== undefined ? toLineHeight(lineHeight) : undefined;
  const letterSpacingValue =
    letterSpacing !== undefined
      ? {
          unit: letterSpacing.unit,
          value: toFiniteValue("letterSpacing", letterSpacing),
        }
      : undefined;

  await loadTextNodeFonts(node);

  const length = node.characters.length;
  const hasRange = start !== undefined || end !== undefined;
  const from = hasRange ? Math.max(0, start || 0) : 0;
  const to = hasRange
    ? Math.min(length, end === undefined ? length : end)
    : length;
  if (hasRange && from >= to) {
    throw new Error(`Invalid range ${from}-${to}`);
  }
  if ((listType !== undefined || indentation !== undefined) && length === 0) {
    throw new Error("listType/indentation need a non-empty text node");
  }

  if (fontFamily !== undefined || fontStyle !== undefined) {
    const current =
      length > 0 ? node.getRangeFontName(from, from + 1) : node.fontName;
    const currentFont =
      current && current !== figma.mixed
        ? current
        : { family: "Inter", style: "Regular" };
    const family = fontFamily || currentFont.family;
    let fontName = { family, style: fontStyle || currentFont.style };
    if (fontStyle) {
      await loadFontOrThrow(fontName);
    } else {
      // New family without explicit style: keep current style, else Regular
      try {
        await figma.loadFontAsync(fontName);
      } catch (error) {
        fontName = { family, style: "Regular" };
        await loadFontOrThrow(fontName);
      }
    }
    if (hasRange) node.setRangeFontName(from, to, fontName);
    else node.fontName = fontName;
  }

  if (fontSize !== undefined) {
    if (hasRange) node.setRangeFontSize(from, to, Number(fontSize));
    else node.fontSize = Number(fontSize);
  }
  if (lineHeightValue !== undefined) {
    if (hasRange) node.setRangeLineHeight(from, to, lineHeightValue);
    else node.lineHeight = lineHeightValue;
  }
  if (letterSpacingValue !== undefined) {
    if (hasRange) node.setRangeLetterSpacing(from, to, letterSpacingValue);
    else node.letterSpacing = letterSpacingValue;
  }
  if (textCase !== undefined) {
    if (hasRange) node.setRangeTextCase(from, to, textCase);
    else node.textCase = textCase;
  }
  if (fillColor !== undefined) {
    const fills = [makeSolidPaint(fillColor)];
    if (hasRange) node.setRangeFills(from, to, fills);
    else node.fills = fills;
  }
  if (hyperlink !== undefined) {
    const link = hyperlink
      ? { type: hyperlink.type, value: hyperlink.value }
      : null;
    if (hasRange) node.setRangeHyperlink(from, to, link);
    else node.hyperlink = link;
  }
  // List options and indentation only have range setters
  if (listType !== undefined || indentation !== undefined) {
    if (listType !== undefined)
      node.setRangeListOptions(from, to, { type: listType });
    if (indentation !== undefined)
      node.setRangeIndentation(from, to, indentation);
  }

  // Node-level only properties
  if (paragraphSpacing !== undefined)
    node.paragraphSpacing = Number(paragraphSpacing);
  if (textAlignHorizontal !== undefined)
    node.textAlignHorizontal = textAlignHorizontal;
  if (textAlignVertical !== undefined)
    node.textAlignVertical = textAlignVertical;
  if (textAutoResize !== undefined) node.textAutoResize = textAutoResize;
  // maxLines only applies with ENDING truncation, so set truncation first
  if (textTruncation !== undefined) node.textTruncation = textTruncation;
  else if (typeof maxLines === "number" && node.textTruncation !== "ENDING")
    node.textTruncation = "ENDING";
  if (maxLines !== undefined) node.maxLines = maxLines;

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    range: hasRange ? { start: from, end: to } : null,
    fontName: node.fontName === figma.mixed ? "mixed" : node.fontName,
    fontSize: node.fontSize === figma.mixed ? "mixed" : node.fontSize,
    lineHeight: node.lineHeight === figma.mixed ? "mixed" : node.lineHeight,
    letterSpacing:
      node.letterSpacing === figma.mixed ? "mixed" : node.letterSpacing,
    textCase: node.textCase === figma.mixed ? "mixed" : node.textCase,
    paragraphSpacing: node.paragraphSpacing,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    textAutoResize: node.textAutoResize,
    hyperlink: node.hyperlink === figma.mixed ? "mixed" : node.hyperlink,
    textTruncation: node.textTruncation,
    maxLines: node.maxLines,
  };
}

async function setNodeProperties(params) {
  const p = params || {};
  const nodeIds = p.nodeIds || (p.nodeId ? [p.nodeId] : []);
  if (!nodeIds.length) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }
  if (p.opacity !== undefined && !(p.opacity >= 0 && p.opacity <= 1)) {
    throw new Error("opacity must be between 0 and 1");
  }
  const keys = [
    "opacity",
    "rotation",
    "blendMode",
    "locked",
    "isMask",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
  ].filter((key) => p[key] !== undefined);
  if (!keys.length) {
    throw new Error("No properties to set");
  }

  const results = [];
  for (const nodeId of nodeIds) {
    const applied = {};
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("Node not found");
      const skipped = [];
      for (const key of keys) {
        if (!(key in node)) {
          skipped.push(key);
          continue;
        }
        try {
          node[key] = p[key];
        } catch (error) {
          throw new Error(`Failed to set ${key}: ${error.message}`);
        }
        applied[key] = node[key];
      }
      results.push({
        nodeId,
        name: node.name,
        type: node.type,
        applied,
        skipped,
        success: true,
      });
    } catch (error) {
      // Properties set before the failure stay applied; report them
      results.push({ nodeId, success: false, error: error.message, applied });
    }
  }

  return {
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

// Gradient transform for an angle in degrees (0 = left→right, 90 = top→bottom),
// rotating around the node center (0.5, 0.5) in normalized node space.
function gradientTransformFromAngle(angle) {
  const rad = (Number(angle) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
  ];
}

function makeGradientPaint(gradient) {
  const { gradientType, stops, angle, gradientTransform } = gradient || {};
  const types = [
    "GRADIENT_LINEAR",
    "GRADIENT_RADIAL",
    "GRADIENT_ANGULAR",
    "GRADIENT_DIAMOND",
  ];
  if (!types.includes(gradientType)) {
    throw new Error(`gradientType must be one of ${types.join(", ")}`);
  }
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error("stops must contain at least 2 color stops");
  }
  let transform;
  if (gradientTransform) {
    if (
      !Array.isArray(gradientTransform) ||
      gradientTransform.length !== 2 ||
      gradientTransform[0].length !== 3 ||
      gradientTransform[1].length !== 3
    ) {
      throw new Error("gradientTransform must be a 2x3 matrix");
    }
    transform = gradientTransform.map((row) => row.map(Number));
  } else {
    transform = gradientTransformFromAngle(angle || 0);
  }
  return {
    type: gradientType,
    gradientTransform: transform,
    gradientStops: stops.map((stop) => ({
      position: Number(stop.position),
      color: {
        r: Number(stop.color.r),
        g: Number(stop.color.g),
        b: Number(stop.color.b),
        a: stop.color.a === undefined ? 1 : Number(stop.color.a),
      },
    })),
  };
}

async function setGradientFill(params) {
  const p = params || {};
  const target = p.target || "fill";
  if (!p.nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (target !== "fill" && target !== "stroke") {
    throw new Error('target must be "fill" or "stroke"');
  }
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${p.nodeId}`);
  }
  const prop = target === "fill" ? "fills" : "strokes";
  if (!(prop in node)) {
    throw new Error(`Node type ${node.type} does not support ${prop}`);
  }
  const paint = makeGradientPaint(p);
  if (p.append) {
    const existing = node[prop];
    if (existing === figma.mixed) {
      throw new Error(`Node has mixed ${prop}; use append: false to replace`);
    }
    node[prop] = [...existing, paint];
  } else {
    node[prop] = [paint];
  }
  return { id: node.id, name: node.name, type: node.type, [prop]: node[prop] };
}

function serializePaintStyle(style) {
  return {
    id: style.id,
    key: style.key,
    name: style.name,
    description: style.description,
    paints: style.paints,
  };
}

/** @returns {any} */
function paintFromStyleParams(params) {
  if (params.color && params.gradientType) {
    throw new Error("Provide either color or a gradient, not both");
  }
  if (params.color) return makeSolidPaint(params.color);
  if (params.gradientType) return makeGradientPaint(params);
  return null;
}

async function createPaintStyle(params) {
  const p = params || {};
  if (!p.name) {
    throw new Error("Missing name parameter");
  }
  const paint = paintFromStyleParams(p);
  if (!paint) {
    throw new Error("Provide color or gradientType + stops");
  }
  const style = figma.createPaintStyle();
  try {
    style.name = p.name;
    style.paints = [paint];
    if (p.description !== undefined) style.description = p.description;
  } catch (error) {
    style.remove();
    throw new Error(`Error creating paint style: ${error.message}`);
  }
  return serializePaintStyle(style);
}

async function updatePaintStyle(params) {
  const p = params || {};
  if (!p.styleId) {
    throw new Error("Missing styleId parameter");
  }
  const style = await figma.getStyleByIdAsync(p.styleId);
  if (!style || style.type !== "PAINT") {
    throw new Error(`Paint style with ID ${p.styleId} not found`);
  }
  const paint = paintFromStyleParams(p);
  if (paint) style.paints = [paint];
  if (p.name !== undefined) style.name = p.name;
  if (p.description !== undefined) style.description = p.description;
  return serializePaintStyle(style);
}

async function applyPaintStyle(params) {
  const { nodeId, styleId } = params || {};
  const target = (params && params.target) || "fill";
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }
  if (target !== "fill" && target !== "stroke") {
    throw new Error('target must be "fill" or "stroke"');
  }
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== "PAINT") {
    throw new Error(`Paint style with ID ${styleId} not found`);
  }
  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  const prop = target === "fill" ? "fillStyleId" : "strokeStyleId";
  if (!(prop in node)) {
    throw new Error(`Node type ${node.type} does not support ${target} styles`);
  }
  if (target === "fill") {
    if (typeof node.setFillStyleIdAsync === "function") {
      await node.setFillStyleIdAsync(style.id);
    } else {
      node.fillStyleId = style.id;
    }
  } else if (typeof node.setStrokeStyleIdAsync === "function") {
    await node.setStrokeStyleIdAsync(style.id);
  } else {
    node.strokeStyleId = style.id;
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    target,
    styleId: style.id,
    styleName: style.name,
  };
}

async function setStrokeProperties(params) {
  const p = params || {};
  if (!p.nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${p.nodeId}`);
  }
  if (!("strokes" in node)) {
    throw new Error(`Node type ${node.type} does not support strokes`);
  }
  const keys = [
    "strokeWeight",
    "strokeAlign",
    "dashPattern",
    "strokeCap",
    "strokeJoin",
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
  ].filter((key) => p[key] !== undefined);
  if (!keys.length) {
    throw new Error("No stroke properties to set");
  }
  const unsupported = keys.filter((key) => !(key in node));
  if (unsupported.length) {
    throw new Error(
      `Node type ${node.type} does not support: ${unsupported.join(", ")}`,
    );
  }
  const applied = {};
  for (const key of keys) {
    try {
      node[key] = key === "dashPattern" ? p[key].map(Number) : p[key];
    } catch (error) {
      const done = Object.keys(applied);
      throw new Error(
        `Failed to set ${key}: ${error.message}. Already applied: ${
          done.length ? done.join(", ") : "none"
        }`,
      );
    }
    applied[key] = node[key] === figma.mixed ? "mixed" : node[key];
  }
  return { id: node.id, name: node.name, type: node.type, applied };
}

// ---------------------------------------------------------------------------
// Pages, constraints, layout grids, ordering, search, FigJam & plugin data
// ---------------------------------------------------------------------------

/** @returns {Promise<any>} */
async function requireNode(nodeId) {
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  return node;
}

function requireFigJam(command) {
  if (figma.editorType !== "figjam") {
    throw new Error(`${command} is only available in FigJam`);
  }
}

async function getPages() {
  await figma.currentPage.loadAsync();
  const currentId = figma.currentPage.id;
  return figma.root.children.map((page) => {
    const info = { id: page.id, name: page.name, isCurrent: page.id === currentId };
    if (info.isCurrent) info.childCount = page.children.length;
    return info;
  });
}

async function createPage(params) {
  const p = params || {};
  const page = figma.createPage();
  if (p.name) page.name = p.name;
  if (p.switchTo) await figma.setCurrentPageAsync(page);
  return {
    id: page.id,
    name: page.name,
    isCurrent: figma.currentPage.id === page.id,
  };
}

async function setCurrentPage(params) {
  const p = params || {};
  if (!p.pageId) {
    throw new Error("Missing pageId parameter");
  }
  const page = await figma.getNodeByIdAsync(p.pageId);
  if (!page || page.type !== "PAGE") {
    throw new Error(`Page not found with ID: ${p.pageId}`);
  }
  await figma.setCurrentPageAsync(page);
  return { id: page.id, name: page.name };
}

async function detachInstance(params) {
  const node = await requireNode((params || {}).nodeId);
  if (node.type !== "INSTANCE") {
    throw new Error(`Node ${node.id} is ${node.type}, expected INSTANCE`);
  }
  const frame = node.detachInstance();
  return { id: frame.id, name: frame.name, type: frame.type };
}

async function setConstraints(params) {
  const p = params || {};
  const node = await requireNode(p.nodeId);
  if (!("constraints" in node)) {
    throw new Error(`Node type ${node.type} does not support constraints`);
  }
  const current = node.constraints;
  node.constraints = {
    horizontal: p.horizontal || current.horizontal,
    vertical: p.vertical || current.vertical,
  };
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    constraints: node.constraints,
  };
}

function makeLayoutGrid(grid) {
  const src = grid.color || { r: 1, g: 0, b: 0, a: 0.1 };
  const color = {
    r: Number(src.r) || 0,
    g: Number(src.g) || 0,
    b: Number(src.b) || 0,
    a: src.a === undefined ? 1 : Number(src.a),
  };
  const visible = grid.visible === undefined ? true : Boolean(grid.visible);
  if (grid.pattern === "GRID") {
    return {
      pattern: "GRID",
      sectionSize: Number(grid.sectionSize),
      visible,
      color,
    };
  }
  if (grid.pattern !== "COLUMNS" && grid.pattern !== "ROWS") {
    throw new Error(`Invalid grid pattern: ${grid.pattern}`);
  }
  const result = {
    pattern: grid.pattern,
    alignment: grid.alignment,
    // "AUTO" maps to Infinity (columns/rows fill the frame)
    count: grid.count === "AUTO" ? Infinity : Number(grid.count),
    gutterSize: Number(grid.gutterSize),
    visible,
    color,
  };
  if (grid.alignment !== "STRETCH") {
    if (grid.sectionSize === undefined) {
      throw new Error(
        `sectionSize is required for ${grid.pattern} grids with alignment ${grid.alignment}`,
      );
    }
    result.sectionSize = Number(grid.sectionSize);
  }
  if (grid.alignment !== "CENTER") {
    result.offset = Number(grid.offset) || 0;
  }
  return result;
}

async function setLayoutGrids(params) {
  const p = params || {};
  const node = await requireNode(p.nodeId);
  if (!("layoutGrids" in node)) {
    throw new Error(`Node type ${node.type} does not support layout grids`);
  }
  if (!Array.isArray(p.grids)) {
    throw new Error("grids must be an array");
  }
  node.layoutGrids = p.grids.map(makeLayoutGrid);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    layoutGrids: node.layoutGrids,
  };
}

async function reorderNode(params) {
  const p = params || {};
  const node = await requireNode(p.nodeId);
  const parent = node.parent;
  if (!parent || !("insertChild" in parent)) {
    throw new Error(`Node ${node.id} has no reorderable parent`);
  }
  const lastIndex = parent.children.length - 1;
  const oldIndex = parent.children.indexOf(node);
  let target;
  if (p.position === "FRONT") target = lastIndex;
  else if (p.position === "BACK") target = 0;
  else if (p.position === "FORWARD") target = oldIndex + 1;
  else if (p.position === "BACKWARD") target = oldIndex - 1;
  else if (p.position === "INDEX") {
    if (p.index === undefined || p.index === null) {
      throw new Error("index is required when position is INDEX");
    }
    target = Number(p.index);
  } else {
    throw new Error(`Invalid position: ${p.position}`);
  }
  target = Math.max(0, Math.min(lastIndex, target));
  if (target !== oldIndex) {
    if (target === lastIndex) {
      parent.appendChild(node);
    } else {
      parent.insertChild(target, node);
      // insertChild may resolve the index before removing the node from its
      // old slot; correct for that when moving towards the front.
      if (parent.children.indexOf(node) !== target && target > oldIndex) {
        parent.insertChild(target + 1, node);
      }
    }
  }
  return {
    id: node.id,
    name: node.name,
    oldIndex,
    newIndex: parent.children.indexOf(node),
    siblingCount: parent.children.length,
  };
}

async function getNodeCss(params) {
  const node = await requireNode((params || {}).nodeId);
  if (typeof node.getCSSAsync !== "function") {
    throw new Error(`Node type ${node.type} does not support getCSSAsync`);
  }
  let css;
  try {
    css = await node.getCSSAsync();
  } catch (error) {
    throw new Error(
      `getCSSAsync failed (it may be unavailable in this editor mode): ${
        error && error.message ? error.message : String(error)
      }`,
    );
  }
  return { id: node.id, name: node.name, type: node.type, css };
}

function isVisibleWithin(node, root) {
  let current = node;
  while (current && current !== root) {
    if ("visible" in current && !current.visible) return false;
    current = current.parent;
  }
  return true;
}

async function findNodes(params) {
  const p = params || {};
  if (p.allPages && p.parentId) {
    throw new Error("Use either parentId or allPages, not both");
  }
  let roots;
  if (p.allPages) {
    await figma.loadAllPagesAsync();
    roots = figma.root.children.slice();
  } else if (p.parentId) {
    roots = [await requireNode(p.parentId)];
  } else {
    roots = [figma.currentPage];
  }
  const root = /** @type {any} */ (roots[0]);
  if (!p.allPages) {
    if (root.type === "PAGE") await root.loadAsync();
    if (typeof root.findAll !== "function") {
      throw new Error(`Node type ${root.type} cannot be searched`);
    }
  }
  const limit = Math.max(1, Math.min(1000, Number(p.limit) || 100));
  const includeHidden = p.includeHidden === undefined ? true : Boolean(p.includeHidden);
  const nameNeedle = p.nameContains ? String(p.nameContains).toLowerCase() : null;
  let nameRegex = null;
  if (p.nameRegex) {
    if (String(p.nameRegex).length > 200) {
      throw new Error("nameRegex must be at most 200 characters");
    }
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(String(p.nameRegex))) {
      throw new Error("nameRegex rejected: nested quantifiers are not allowed");
    }
    try {
      nameRegex = new RegExp(p.nameRegex);
    } catch (error) {
      throw new Error(`Invalid nameRegex: ${error.message}`);
    }
  }
  const types = Array.isArray(p.types) && p.types.length ? p.types : null;

  const findIn = (searchRoot) => {
    let found;
    if (types && !nameNeedle && !nameRegex) {
      found = searchRoot.findAllWithCriteria({ types });
    } else {
      found = searchRoot.findAll((node) => {
        if (types && types.indexOf(node.type) === -1) return false;
        if (nameNeedle && node.name.toLowerCase().indexOf(nameNeedle) === -1) {
          return false;
        }
        if (nameRegex && !nameRegex.test(node.name)) return false;
        return true;
      });
    }
    if (!includeHidden) {
      found = found.filter((node) => isVisibleWithin(node, searchRoot));
    }
    return found;
  };

  let matches = [];
  const pageOf = new Map();
  let pagesScanned = 0;
  for (const searchRoot of roots) {
    const found = findIn(searchRoot);
    pagesScanned++;
    if (p.allPages) {
      for (const node of found) pageOf.set(node.id, searchRoot);
    }
    matches = matches.concat(found);
    // Across pages, stop once the result is known to be truncated.
    if (p.allPages && matches.length > limit) break;
  }
  const nodes = matches.slice(0, limit).map((node) => {
    /** @type {any} */
    const info = {
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parent ? node.parent.id : undefined,
      x: "x" in node ? node.x : undefined,
      y: "y" in node ? node.y : undefined,
      width: "width" in node ? node.width : undefined,
      height: "height" in node ? node.height : undefined,
    };
    if (p.allPages) {
      const page = pageOf.get(node.id);
      info.pageId = page.id;
      info.pageName = page.name;
    }
    return info;
  });
  if (p.allPages) {
    const stoppedEarly = pagesScanned < roots.length;
    return {
      rootId: figma.root.id,
      total: matches.length,
      totalIsLowerBound: stoppedEarly,
      pagesScanned,
      pageCount: roots.length,
      truncated: matches.length > limit,
      nodes,
    };
  }
  return {
    rootId: root.id,
    total: matches.length,
    truncated: matches.length > limit,
    nodes,
  };
}

// Load every font used by a FigJam text sublayer so its characters can change.
async function loadSublayerFonts(sublayer) {
  if (sublayer.fontName !== figma.mixed) {
    await figma.loadFontAsync(sublayer.fontName);
    return;
  }
  const fonts = sublayer.getRangeAllFontNames(0, sublayer.characters.length);
  for (const font of fonts) {
    await figma.loadFontAsync(font);
  }
}

async function createSticky(params) {
  requireFigJam("create_sticky");
  const p = params || {};
  const parent = await resolveNewNodeParent(p.parentId);
  const sticky = figma.createSticky();
  try {
    parent.appendChild(sticky);
    sticky.x = Number(p.x) || 0;
    sticky.y = Number(p.y) || 0;
    if (p.color) sticky.fills = [makeSolidPaint(p.color)];
    if (p.authorVisible !== undefined) sticky.authorVisible = Boolean(p.authorVisible);
    await loadSublayerFonts(sticky.text);
    sticky.text.characters = String(p.text === undefined ? "" : p.text);
  } catch (error) {
    sticky.remove();
    throw new Error(`Error creating sticky: ${error.message}`);
  }
  return {
    id: sticky.id,
    name: sticky.name,
    type: sticky.type,
    x: sticky.x,
    y: sticky.y,
    width: sticky.width,
    height: sticky.height,
    parentId: sticky.parent ? sticky.parent.id : undefined,
  };
}

async function createShapeWithText(params) {
  requireFigJam("create_shape_with_text");
  const p = params || {};
  if (!p.shapeType) {
    throw new Error("Missing shapeType parameter");
  }
  const parent = await resolveNewNodeParent(p.parentId);
  const shape = figma.createShapeWithText();
  try {
    parent.appendChild(shape);
    shape.shapeType = p.shapeType;
    shape.x = Number(p.x) || 0;
    shape.y = Number(p.y) || 0;
    if (p.width !== undefined || p.height !== undefined) {
      const width = p.width !== undefined ? Number(p.width) : shape.width;
      const height = p.height !== undefined ? Number(p.height) : shape.height;
      if (typeof shape.resize === "function") {
        shape.resize(width, height);
      } else {
        shape.rescale(width / shape.width);
      }
    }
    if (p.fillColor) shape.fills = [makeSolidPaint(p.fillColor)];
    if (p.text !== undefined) {
      await loadSublayerFonts(shape.text);
      shape.text.characters = String(p.text);
    }
  } catch (error) {
    shape.remove();
    throw new Error(`Error creating shape with text: ${error.message}`);
  }
  return {
    id: shape.id,
    name: shape.name,
    type: shape.type,
    shapeType: shape.shapeType,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    parentId: shape.parent ? shape.parent.id : undefined,
  };
}

async function createTable(params) {
  requireFigJam("create_table");
  const p = params || {};
  const rows = p.rows === undefined ? 2 : Number(p.rows);
  const columns = p.columns === undefined ? 2 : Number(p.columns);
  if (!(rows >= 1) || !(columns >= 1)) {
    throw new Error("rows and columns must be at least 1");
  }
  const cells = Array.isArray(p.cells) ? p.cells : [];
  if (
    cells.length > rows ||
    cells.some((row) => !Array.isArray(row) || row.length > columns)
  ) {
    throw new Error(`cells must fit within ${rows} rows x ${columns} columns`);
  }
  const parent = await resolveNewNodeParent(p.parentId);
  const table = figma.createTable(rows, columns);
  try {
    parent.appendChild(table);
    table.x = Number(p.x) || 0;
    table.y = Number(p.y) || 0;
    for (let r = 0; r < cells.length; r++) {
      for (let c = 0; c < cells[r].length; c++) {
        const value = cells[r][c];
        if (value === undefined || value === null) continue;
        const cellText = table.cellAt(r, c).text;
        await loadSublayerFonts(cellText);
        cellText.characters = String(value);
      }
    }
  } catch (error) {
    table.remove();
    throw new Error(`Error creating table: ${error.message}`);
  }
  return {
    id: table.id,
    name: table.name,
    type: table.type,
    rows: table.numRows,
    columns: table.numColumns,
    x: table.x,
    y: table.y,
    width: table.width,
    height: table.height,
    parentId: table.parent ? table.parent.id : undefined,
  };
}

function validatePluginDataNamespace(namespace) {
  if (!namespace || !/^[A-Za-z0-9]{3,}$/.test(namespace)) {
    throw new Error(
      "namespace is required and must be at least 3 alphanumeric characters",
    );
  }
}

async function setSharedPluginDataCommand(params) {
  const p = params || {};
  validatePluginDataNamespace(p.namespace);
  if (!p.key) {
    throw new Error("Missing key parameter");
  }
  const node = await requireNode(p.nodeId);
  const value = p.value === undefined || p.value === null ? "" : String(p.value);
  node.setSharedPluginData(p.namespace, p.key, value);
  return {
    id: node.id,
    namespace: p.namespace,
    key: p.key,
    value,
    deleted: value === "",
  };
}

async function getSharedPluginDataCommand(params) {
  const p = params || {};
  validatePluginDataNamespace(p.namespace);
  const node = await requireNode(p.nodeId);
  if (p.key) {
    return {
      id: node.id,
      namespace: p.namespace,
      key: p.key,
      value: node.getSharedPluginData(p.namespace, p.key),
    };
  }
  const data = {};
  for (const key of node.getSharedPluginDataKeys(p.namespace)) {
    data[key] = node.getSharedPluginData(p.namespace, key);
  }
  return { id: node.id, namespace: p.namespace, data };
}

async function getLocalComponents(params) {
  const commandId = (params && params.commandId) || generateCommandId();
  const pages = figma.root.children;
  const totalPages = pages.length;

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "started",
    0,
    totalPages,
    0,
    "Starting component scan across " + totalPages + " pages...",
    null,
  );

  var allComponents = [];

  for (var i = 0; i < totalPages; i++) {
    var page = pages[i];
    await page.loadAsync();

    var pageComponents = page.findAllWithCriteria({ types: ["COMPONENT"] });

    for (var j = 0; j < pageComponents.length; j++) {
      var component = pageComponents[j];
      allComponents.push({
        id: component.id,
        name: component.name,
        key: "key" in component ? component.key : null,
      });
    }

    var progress = Math.round(((i + 1) / totalPages) * 100);
    await sendProgressUpdate(
      commandId,
      "get_local_components",
      "in_progress",
      progress,
      totalPages,
      i + 1,
      "Scanned " +
        page.name +
        ": " +
        pageComponents.length +
        " components (total so far: " +
        allComponents.length +
        ")",
      null,
    );
  }

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "completed",
    100,
    totalPages,
    totalPages,
    "Found " +
      allComponents.length +
      " components across " +
      totalPages +
      " pages",
    null,
  );

  return {
    count: allComponents.length,
    components: allComponents,
  };
}

// async function getTeamComponents() {
//   try {
//     const teamComponents =
//       await figma.teamLibrary.getAvailableComponentsAsync();

//     return {
//       count: teamComponents.length,
//       components: teamComponents.map((component) => ({
//         key: component.key,
//         name: component.name,
//         description: component.description,
//         libraryName: component.libraryName,
//       })),
//     };
//   } catch (error) {
//     throw new Error(`Error getting team components: ${error.message}`);
//   }
// }

async function createComponentInstance(params) {
  const { componentKey, componentId, x = 0, y = 0, parentId } = params || {};

  if (!componentKey && !componentId) {
    throw new Error(
      "Missing componentKey or componentId parameter. Use componentId for local components (from get_local_components), or componentKey for published library components.",
    );
  }

  try {
    let component;

    if (componentId) {
      // Local component: get node directly by ID
      const node = await figma.getNodeByIdAsync(componentId);
      if (!node) {
        throw new Error(`Component node not found with id: ${componentId}`);
      }
      if (node.type !== "COMPONENT") {
        throw new Error(
          `Node ${componentId} is not a COMPONENT (got type: ${node.type}). Use get_local_components to find valid component IDs.`,
        );
      }
      component = node;
    } else {
      // Published library component: import by key
      component = await figma.importComponentByKeyAsync(componentKey);
    }

    const instance = component.createInstance();
    instance.x = x;
    instance.y = y;

    if (parentId) {
      /** @type {any} */
      const parent = await figma.getNodeByIdAsync(parentId);
      if (parent && "appendChild" in parent) {
        parent.appendChild(instance);
      } else {
        figma.currentPage.appendChild(instance);
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    const mainComponent = await instance.getMainComponentAsync();

    return {
      id: instance.id,
      name: instance.name,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
      mainComponentId: mainComponent ? mainComponent.id : undefined,
    };
  } catch (error) {
    throw new Error(`Error creating component instance: ${error.message}`);
  }
}

async function exportNodeAsImage(params) {
  const { nodeId, scale = 1 } = params || {};

  /** @type {string} */
  const format = "PNG";

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("exportAsync" in node)) {
    throw new Error(`Node does not support exporting: ${nodeId}`);
  }

  try {
    /** @type {any} */
    const settings = {
      format: format,
      constraint: { type: "SCALE", value: scale },
    };

    const bytes = await node.exportAsync(settings);

    let mimeType;
    switch (format) {
      case "PNG":
        mimeType = "image/png";
        break;
      case "JPG":
        mimeType = "image/jpeg";
        break;
      case "SVG":
        mimeType = "image/svg+xml";
        break;
      case "PDF":
        mimeType = "application/pdf";
        break;
      default:
        mimeType = "application/octet-stream";
    }

    // Proper way to convert Uint8Array to base64
    const base64 = customBase64Encode(bytes);
    // const imageData = `data:${mimeType};base64,${base64}`;

    return {
      nodeId,
      format,
      scale,
      mimeType,
      imageData: base64,
    };
  } catch (error) {
    throw new Error(`Error exporting node as image: ${error.message}`);
  }
}
function customBase64Encode(bytes) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
    d = chunk & 63; // 63 = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3 = 2^2 - 1

    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15 = 2^4 - 1

    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}

async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (radius === undefined) {
    throw new Error("Missing radius parameter");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if node supports corner radius
  if (!("cornerRadius" in node)) {
    throw new Error(`Node does not support corner radius: ${nodeId}`);
  }

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      // Node supports individual corner radii
      if (corners[0]) node.topLeftRadius = radius;
      if (corners[1]) node.topRightRadius = radius;
      if (corners[2]) node.bottomRightRadius = radius;
      if (corners[3]) node.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      node.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    node.cornerRadius = radius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius:
      "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius:
      "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };
}

async function setTextContent(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (text === undefined) {
    throw new Error("Missing text parameter");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);

    await setCharacters(node, text);

    return {
      id: node.id,
      name: node.name,
      characters: node.characters,
      fontName: node.fontName,
    };
  } catch (error) {
    throw new Error(`Error setting text content: ${error.message}`);
  }
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: "init-settings",
      settings: {
        serverPort: state.serverPort,
      },
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();

function uniqBy(arr, predicate) {
  const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);

        map.has(key) || map.set(key, item);

        return map;
      }, new Map())
      .values(),
  ];
}
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  try {
    if (node.fontName === figma.mixed) {
      if (options && options.smartStrategy === "prevail") {
        const fontHashTree = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i);
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1],
        )[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont = {
          family,
          style,
        };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (options && options.smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (options && options.smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1);
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err,
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`Failed to set characters. Skipped.`, err);
    return false;
  }
};

const setCharactersWithStrictMatchFont = async (
  node,
  characters,
  fallbackFont,
) => {
  const fontHashTree = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i);
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i);
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  console.log(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      console.log(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont = {
        family,
        style,
      };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    }),
  );
  return true;
};

const getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
  const indices = [];
  let temp = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  temp !== endIdx && indices.push([temp, endIdx]);
  return indices.filter(Boolean);
};

const buildLinearOrder = (node) => {
  const fontTree = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd], n) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd,
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        " ",
        newLinesRangeStart,
        newLinesRangeEnd,
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd], s) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd,
        );
        if (spacesRangeFont === figma.mixed) {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart[0],
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: newLinesRangeFont.family,
        style: newLinesRangeFont.style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithSmartMatchFont = async (
  node,
  characters,
  fallbackFont,
) => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }) => `${family}::${style}`,
  ).map(({ family, style }) => ({
    family,
    style,
  }));

  await Promise.all([...fontsToLoad, fallbackFont].map(figma.loadFontAsync));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos =
        delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont = {
        family,
        style,
      };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

// Add the cloneNode function implementation
async function cloneNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Clone the node
  const clone = node.clone();

  // If x and y are provided, move the clone to that position
  if (x !== undefined && y !== undefined) {
    if (!("x" in clone) || !("y" in clone)) {
      throw new Error(`Cloned node does not support position: ${nodeId}`);
    }
    clone.x = x;
    clone.y = y;
  }

  // Add the clone to the same parent as the original node
  if (node.parent) {
    node.parent.appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  return {
    id: clone.id,
    name: clone.name,
    x: "x" in clone ? clone.x : undefined,
    y: "y" in clone ? clone.y : undefined,
    width: "width" in clone ? clone.width : undefined,
    height: "height" in clone ? clone.height : undefined,
  };
}

async function scanTextNodes(params) {
  console.log(`Starting to scan text nodes from node ID: ${params.nodeId}`);
  const {
    nodeId,
    useChunking = true,
    chunkSize = 10,
    commandId = generateCommandId(),
  } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    console.error(`Node with ID ${nodeId} not found`);
    // Send error progress update
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "error",
      0,
      0,
      0,
      `Node with ID ${nodeId} not found`,
      { error: `Node not found: ${nodeId}` },
    );
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // If chunking is not enabled, use the original implementation
  if (!useChunking) {
    const textNodes = [];
    try {
      // Send started progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "started",
        0,
        1, // Not known yet how many nodes there are
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null,
      );

      await findTextNodes(node, [], 0, textNodes);

      // Send completed progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "completed",
        100,
        textNodes.length,
        textNodes.length,
        `Scan complete. Found ${textNodes.length} text nodes.`,
        { textNodes },
      );

      return {
        success: true,
        message: `Scanned ${textNodes.length} text nodes.`,
        count: textNodes.length,
        textNodes: textNodes,
        commandId,
      };
    } catch (error) {
      console.error("Error scanning text nodes:", error);

      // Send error progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "error",
        0,
        0,
        0,
        `Error scanning text nodes: ${error.message}`,
        { error: error.message },
      );

      throw new Error(`Error scanning text nodes: ${error.message}`);
    }
  }

  // Chunked implementation
  console.log(`Using chunked scanning with chunk size: ${chunkSize}`);

  // First, collect all nodes to process (without processing them yet)
  const nodesToProcess = [];

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "started",
    0,
    0, // Not known yet how many nodes there are
    0,
    `Starting chunked scan of node "${node.name || nodeId}"`,
    { chunkSize },
  );

  await collectNodesToProcess(node, [], 0, nodesToProcess);

  const totalNodes = nodesToProcess.length;
  console.log(`Found ${totalNodes} total nodes to process`);

  // Calculate number of chunks needed
  const totalChunks = Math.ceil(totalNodes / chunkSize);
  console.log(`Will process in ${totalChunks} chunks`);

  // Send update after node collection
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "in_progress",
    5, // 5% progress for collection phase
    totalNodes,
    0,
    `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
    {
      totalNodes,
      totalChunks,
      chunkSize,
    },
  );

  // Process nodes in chunks
  const allTextNodes = [];
  let processedNodes = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, totalNodes);
    console.log(
      `Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${
        chunkEnd - 1
      })`,
    );

    // Send update before processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
      {
        currentChunk: chunksProcessed + 1,
        totalChunks,
        textNodesFound: allTextNodes.length,
      },
    );

    const chunkNodes = nodesToProcess.slice(i, chunkEnd);
    const chunkTextNodes = [];

    // Process each node in this chunk
    for (const nodeInfo of chunkNodes) {
      if (nodeInfo.node.type === "TEXT") {
        try {
          const textNodeInfo = await processTextNode(
            nodeInfo.node,
            nodeInfo.parentPath,
            nodeInfo.depth,
          );
          if (textNodeInfo) {
            chunkTextNodes.push(textNodeInfo);
          }
        } catch (error) {
          console.error(`Error processing text node: ${error.message}`);
          // Continue with other nodes
        }
      }

      // Brief delay to allow UI updates and prevent freezing
      await delay(5);
    }

    // Add results from this chunk
    allTextNodes.push(...chunkTextNodes);
    processedNodes += chunkNodes.length;
    chunksProcessed++;

    // Send update after processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
      {
        currentChunk: chunksProcessed,
        totalChunks,
        processedNodes,
        textNodesFound: allTextNodes.length,
        chunkResult: chunkTextNodes,
      },
    );

    // Small delay between chunks to prevent UI freezing
    if (i + chunkSize < totalNodes) {
      await delay(50);
    }
  }

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "completed",
    100,
    totalNodes,
    processedNodes,
    `Scan complete. Found ${allTextNodes.length} text nodes.`,
    {
      textNodes: allTextNodes,
      processedNodes,
      chunks: chunksProcessed,
    },
  );

  return {
    success: true,
    message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
    totalNodes: allTextNodes.length,
    processedNodes: processedNodes,
    chunks: chunksProcessed,
    textNodes: allTextNodes,
    commandId,
  };
}

// Helper function to collect all nodes that need to be processed
async function collectNodesToProcess(
  node,
  parentPath = [],
  depth = 0,
  nodesToProcess = [],
) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  // Add this node to the processing list
  nodesToProcess.push({
    node: node,
    parentPath: nodePath,
    depth: depth,
  });

  // Recursively add children
  if ("children" in node) {
    for (const child of node.children) {
      await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess);
    }
  }
}

// Process a single text node
async function processTextNode(node, parentPath, depth) {
  if (node.type !== "TEXT") return null;

  try {
    // Safely extract font information
    let fontFamily = "";
    let fontStyle = "";

    if (node.fontName) {
      if (typeof node.fontName === "object") {
        if ("family" in node.fontName) fontFamily = node.fontName.family;
        if ("style" in node.fontName) fontStyle = node.fontName.style;
      }
    }

    // Create a safe representation of the text node
    const safeTextNode = {
      id: node.id,
      name: node.name || "Text",
      type: node.type,
      characters: node.characters,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily: fontFamily,
      fontStyle: fontStyle,
      x: typeof node.x === "number" ? node.x : 0,
      y: typeof node.y === "number" ? node.y : 0,
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
      path: parentPath.join(" > "),
      depth: depth,
    };

    // Highlight the node briefly (optional visual feedback)
    try {
      const originalFills = JSON.parse(JSON.stringify(node.fills));
      node.fills = [
        {
          type: "SOLID",
          color: { r: 1, g: 0.5, b: 0 },
          opacity: 0.3,
        },
      ];

      // Brief delay for the highlight to be visible
      await delay(100);

      try {
        node.fills = originalFills;
      } catch (err) {
        console.error("Error resetting fills:", err);
      }
    } catch (highlightErr) {
      console.error("Error highlighting text node:", highlightErr);
      // Continue anyway, highlighting is just visual feedback
    }

    return safeTextNode;
  } catch (nodeErr) {
    console.error("Error processing text node:", nodeErr);
    return null;
  }
}

// A delay function that returns a promise
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep the original findTextNodes for backward compatibility
async function findTextNodes(node, parentPath = [], depth = 0, textNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node including its name
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  if (node.type === "TEXT") {
    try {
      // Safely extract font information to avoid Symbol serialization issues
      let fontFamily = "";
      let fontStyle = "";

      if (node.fontName) {
        if (typeof node.fontName === "object") {
          if ("family" in node.fontName) fontFamily = node.fontName.family;
          if ("style" in node.fontName) fontStyle = node.fontName.style;
        }
      }

      // Create a safe representation of the text node with only serializable properties
      const safeTextNode = {
        id: node.id,
        name: node.name || "Text",
        type: node.type,
        characters: node.characters,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
        path: nodePath.join(" > "),
        depth: depth,
      };

      // Only highlight the node if it's not being done via API
      try {
        // Safe way to create a temporary highlight without causing serialization issues
        const originalFills = JSON.parse(JSON.stringify(node.fills));
        node.fills = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 },
            opacity: 0.3,
          },
        ];

        // Promise-based delay instead of setTimeout
        await delay(500);

        try {
          node.fills = originalFills;
        } catch (err) {
          console.error("Error resetting fills:", err);
        }
      } catch (highlightErr) {
        console.error("Error highlighting text node:", highlightErr);
        // Continue anyway, highlighting is just visual feedback
      }

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      // Skip this node but continue with others
    }
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findTextNodes(child, nodePath, depth + 1, textNodes);
    }
  }
}

// Replace text in a specific node
async function setMultipleTextContents(params) {
  const { nodeId, text } = params || {};
  const commandId = params.commandId || generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";

    // Send error progress update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg },
    );

    throw new Error(errorMsg);
  }

  console.log(
    `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`,
  );

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "started",
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length },
  );

  // Define the results array and counters
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Split text replacements into chunks of 5
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${text.length} replacements into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "in_progress",
    5, // 5% progress for planning phase
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    {
      totalReplacements: text.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    },
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${
        chunk.length
      } replacements`,
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      },
    );

    // Process replacements within a chunk in parallel
    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        console.error(`Missing nodeId or text for replacement`);
        return {
          success: false,
          nodeId: replacement.nodeId || "unknown",
          error: "Missing nodeId or text in replacement entry",
        };
      }

      try {
        console.log(
          `Attempting to replace text in node: ${replacement.nodeId}`,
        );

        // Get the text node to update (just to check it exists and get original text)
        const textNode = await figma.getNodeByIdAsync(replacement.nodeId);

        if (!textNode) {
          console.error(`Text node not found: ${replacement.nodeId}`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node not found: ${replacement.nodeId}`,
          };
        }

        if (textNode.type !== "TEXT") {
          console.error(
            `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          );
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          };
        }

        // Save original text for the result
        const originalText = textNode.characters;
        console.log(`Original text: "${originalText}"`);
        console.log(`Will translate to: "${replacement.text}"`);

        // Highlight the node before changing text
        let originalFills;
        try {
          // Save original fills for restoration later
          originalFills = JSON.parse(JSON.stringify(textNode.fills));
          // Apply highlight color (orange with 30% opacity)
          textNode.fills = [
            {
              type: "SOLID",
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3,
            },
          ];
        } catch (highlightErr) {
          console.error(
            `Error highlighting text node: ${highlightErr.message}`,
          );
          // Continue anyway, highlighting is just visual feedback
        }

        // Use the existing setTextContent function to handle font loading and text setting
        await setTextContent({
          nodeId: replacement.nodeId,
          text: replacement.text,
        });

        // Keep highlight for a moment after text change, then restore original fills
        if (originalFills) {
          try {
            // Use delay function for consistent timing
            await delay(500);
            textNode.fills = originalFills;
          } catch (restoreErr) {
            console.error(`Error restoring fills: ${restoreErr.message}`);
          }
        }

        console.log(
          `Successfully replaced text in node: ${replacement.nodeId}`,
        );
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText: originalText,
          translatedText: replacement.text,
        };
      } catch (error) {
        console.error(
          `Error replacing text in node ${replacement.nodeId}: ${error.message}`,
        );
        return {
          success: false,
          nodeId: replacement.nodeId,
          error: `Error applying replacement: ${error.message}`,
        };
      }
    });

    // Wait for all replacements in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update with partial results
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${
        chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      },
    );

    // Add a small delay between chunks to avoid overloading Figma
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks to avoid overloading Figma...");
      await delay(1000); // 1 second delay between chunks
    }
  }

  console.log(
    `Replacement complete: ${successCount} successful, ${failureCount} failed`,
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "completed",
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    },
  );

  return {
    success: successCount > 0,
    nodeId: nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  };
}

// Function to generate simple UUIDs for command IDs
function generateCommandId() {
  return (
    "cmd_" +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

async function getAnnotations(params) {
  try {
    const { nodeId, includeCategories = true } = params;

    // Get categories first if needed
    let categoriesMap = {};
    if (includeCategories) {
      const categories = await figma.annotations.getAnnotationCategoriesAsync();
      categoriesMap = categories.reduce((map, category) => {
        map[category.id] = {
          id: category.id,
          label: category.label,
          color: category.color,
          isPreset: category.isPreset,
        };
        return map;
      }, {});
    }

    if (nodeId) {
      // Get annotations for a specific node
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found: ${nodeId}`);
      }

      if (!("annotations" in node)) {
        throw new Error(`Node type ${node.type} does not support annotations`);
      }

      // Collect annotations from this node and all its descendants
      const mergedAnnotations = [];
      const collect = async (n) => {
        if ("annotations" in n && n.annotations && n.annotations.length > 0) {
          for (const a of n.annotations) {
            mergedAnnotations.push({ nodeId: n.id, annotation: a });
          }
        }
        if ("children" in n) {
          for (const child of n.children) {
            await collect(child);
          }
        }
      };
      await collect(node);

      const result = {
        nodeId: node.id,
        name: node.name,
        annotations: mergedAnnotations,
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    } else {
      // Get all annotations in the current page
      const annotations = [];
      const processNode = async (node) => {
        if (
          "annotations" in node &&
          node.annotations &&
          node.annotations.length > 0
        ) {
          annotations.push({
            nodeId: node.id,
            name: node.name,
            annotations: node.annotations,
          });
        }
        if ("children" in node) {
          for (const child of node.children) {
            await processNode(child);
          }
        }
      };

      // Start from current page
      await processNode(figma.currentPage);

      const result = {
        annotatedNodes: annotations,
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    }
  } catch (error) {
    console.error("Error in getAnnotations:", error);
    throw error;
  }
}

async function setAnnotation(params) {
  try {
    console.log("=== setAnnotation Debug Start ===");
    console.log("Input params:", JSON.stringify(params, null, 2));

    const { nodeId, annotationId, labelMarkdown, categoryId, properties } =
      params;

    // Validate required parameters
    if (!nodeId) {
      console.error("Validation failed: Missing nodeId");
      return { success: false, error: "Missing nodeId" };
    }

    if (!labelMarkdown) {
      console.error("Validation failed: Missing labelMarkdown");
      return { success: false, error: "Missing labelMarkdown" };
    }

    console.log("Attempting to get node:", nodeId);
    // Get and validate node
    const node = await figma.getNodeByIdAsync(nodeId);
    console.log("Node lookup result:", {
      id: nodeId,
      found: !!node,
      type: node ? node.type : undefined,
      name: node ? node.name : undefined,
      hasAnnotations: node ? "annotations" in node : false,
    });

    if (!node) {
      console.error("Node lookup failed:", nodeId);
      return { success: false, error: `Node not found: ${nodeId}` };
    }

    // Validate node supports annotations
    if (!("annotations" in node)) {
      console.error("Node annotation support check failed:", {
        nodeType: node.type,
        nodeId: node.id,
      });
      return {
        success: false,
        error: `Node type ${node.type} does not support annotations`,
      };
    }

    // Create the annotation object
    const newAnnotation = {
      labelMarkdown,
    };

    // Validate and add categoryId if provided
    if (categoryId) {
      console.log("Adding categoryId to annotation:", categoryId);
      newAnnotation.categoryId = categoryId;
    }

    // Validate and add properties if provided
    if (properties && Array.isArray(properties) && properties.length > 0) {
      console.log(
        "Adding properties to annotation:",
        JSON.stringify(properties, null, 2),
      );
      newAnnotation.properties = properties;
    }

    // Log current annotations before update
    console.log("Current node annotations:", node.annotations);

    // Overwrite annotations
    console.log(
      "Setting new annotation:",
      JSON.stringify(newAnnotation, null, 2),
    );
    node.annotations = [newAnnotation];

    // Verify the update
    console.log("Updated node annotations:", node.annotations);
    console.log("=== setAnnotation Debug End ===");

    return {
      success: true,
      nodeId: node.id,
      name: node.name,
      annotations: node.annotations,
    };
  } catch (error) {
    console.error("=== setAnnotation Error ===");
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      params: JSON.stringify(params, null, 2),
    });
    return { success: false, error: error.message };
  }
}

/**
 * Scan for nodes with specific types within a node
 * @param {Object} params - Parameters object
 * @param {string} params.nodeId - ID of the node to scan within
 * @param {Array<string>} params.types - Array of node types to find (e.g. ['COMPONENT', 'FRAME'])
 * @returns {Promise<Object>} - Object containing found nodes
 */
async function scanNodesByTypes(params) {
  console.log(`Starting to scan nodes by types from node ID: ${params.nodeId}`);
  const { nodeId, types = [] } = params || {};

  if (!types || types.length === 0) {
    throw new Error("No types specified to search for");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Simple implementation without chunking
  const matchingNodes = [];

  // Send a single progress update to notify start
  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "started",
    0,
    1,
    0,
    `Starting scan of node "${node.name || nodeId}" for types: ${types.join(
      ", ",
    )}`,
    null,
  );

  // Recursively find nodes with specified types
  await findNodesByTypes(node, types, matchingNodes);

  // Send completion update
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "completed",
    100,
    matchingNodes.length,
    matchingNodes.length,
    `Scan complete. Found ${matchingNodes.length} matching nodes.`,
    { matchingNodes },
  );

  return {
    success: true,
    message: `Found ${matchingNodes.length} matching nodes.`,
    count: matchingNodes.length,
    matchingNodes: matchingNodes,
    searchedTypes: types,
  };
}

/**
 * Helper function to recursively find nodes with specific types
 * @param {SceneNode} node - The root node to start searching from
 * @param {Array<string>} types - Array of node types to find
 * @param {Array} matchingNodes - Array to store found nodes
 */
async function findNodesByTypes(node, types, matchingNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Check if this node is one of the specified types
  if (types.includes(node.type)) {
    // Create a minimal representation with just ID, type and bbox
    matchingNodes.push({
      id: node.id,
      name: node.name || `Unnamed ${node.type}`,
      type: node.type,
      // Basic bounding box info
      bbox: {
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
      },
    });
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findNodesByTypes(child, types, matchingNodes);
    }
  }
}

// Set multiple annotations with async progress updates
async function setMultipleAnnotations(params) {
  console.log("=== setMultipleAnnotations Debug Start ===");
  console.log("Input params:", JSON.stringify(params, null, 2));

  const { nodeId, annotations } = params;

  if (!annotations || annotations.length === 0) {
    console.error("Validation failed: No annotations provided");
    return { success: false, error: "No annotations provided" };
  }

  console.log(
    `Processing ${annotations.length} annotations for node ${nodeId}`,
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Process annotations sequentially
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i];
    console.log(
      `\nProcessing annotation ${i + 1}/${annotations.length}:`,
      JSON.stringify(annotation, null, 2),
    );

    try {
      console.log("Calling setAnnotation with params:", {
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      const result = await setAnnotation({
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      console.log("setAnnotation result:", JSON.stringify(result, null, 2));

      if (result.success) {
        successCount++;
        results.push({ success: true, nodeId: annotation.nodeId });
        console.log(`✓ Annotation ${i + 1} applied successfully`);
      } else {
        failureCount++;
        results.push({
          success: false,
          nodeId: annotation.nodeId,
          error: result.error,
        });
        console.error(`✗ Annotation ${i + 1} failed:`, result.error);
      }
    } catch (error) {
      failureCount++;
      const errorResult = {
        success: false,
        nodeId: annotation.nodeId,
        error: error.message,
      };
      results.push(errorResult);
      console.error(`✗ Annotation ${i + 1} failed with error:`, error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
      });
    }
  }

  const summary = {
    success: successCount > 0,
    annotationsApplied: successCount,
    annotationsFailed: failureCount,
    totalAnnotations: annotations.length,
    results: results,
  };

  console.log("\n=== setMultipleAnnotations Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=== setMultipleAnnotations Debug End ===");

  return summary;
}

async function deleteMultipleNodes(params) {
  const { nodeIds } = params || {};
  const commandId = generateCommandId();

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    const errorMsg = "Missing or invalid nodeIds parameter";
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg },
    );
    throw new Error(errorMsg);
  }

  console.log(`Starting deletion of ${nodeIds.length} nodes`);

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "started",
    0,
    nodeIds.length,
    0,
    `Starting deletion of ${nodeIds.length} nodes`,
    { totalNodes: nodeIds.length },
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Process nodes in chunks of 5 to avoid overwhelming Figma
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
    chunks.push(nodeIds.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${nodeIds.length} deletions into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "in_progress",
    5,
    nodeIds.length,
    0,
    `Preparing to delete ${nodeIds.length} nodes using ${chunks.length} chunks`,
    {
      totalNodes: nodeIds.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    },
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${
        chunk.length
      } nodes`,
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Processing deletion chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      },
    );

    // Process deletions within a chunk in parallel
    const chunkPromises = chunk.map(async (nodeId) => {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);

        if (!node) {
          console.error(`Node not found: ${nodeId}`);
          return {
            success: false,
            nodeId: nodeId,
            error: `Node not found: ${nodeId}`,
          };
        }

        // Save node info before deleting
        const nodeInfo = {
          id: node.id,
          name: node.name,
          type: node.type,
        };

        // Delete the node
        node.remove();

        console.log(`Successfully deleted node: ${nodeId}`);
        return {
          success: true,
          nodeId: nodeId,
          nodeInfo: nodeInfo,
        };
      } catch (error) {
        console.error(`Error deleting node ${nodeId}: ${error.message}`);
        return {
          success: false,
          nodeId: nodeId,
          error: error.message,
        };
      }
    });

    // Wait for all deletions in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${
        chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      },
    );

    // Add a small delay between chunks
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks...");
      await delay(1000);
    }
  }

  console.log(
    `Deletion complete: ${successCount} successful, ${failureCount} failed`,
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "completed",
    100,
    nodeIds.length,
    successCount + failureCount,
    `Node deletion complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalNodes: nodeIds.length,
      nodesDeleted: successCount,
      nodesFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    },
  );

  return {
    success: successCount > 0,
    nodesDeleted: successCount,
    nodesFailed: failureCount,
    totalNodes: nodeIds.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  };
}

// Implementation for getInstanceOverrides function
async function getInstanceOverrides(instanceNode = null) {
  console.log("=== getInstanceOverrides called ===");

  let sourceInstance = null;

  // Check if an instance node was passed directly
  if (instanceNode) {
    console.log("Using provided instance node");

    // Validate that the provided node is an instance
    if (instanceNode.type !== "INSTANCE") {
      console.error("Provided node is not an instance");
      figma.notify("Provided node is not a component instance");
      return {
        success: false,
        message: "Provided node is not a component instance",
      };
    }

    sourceInstance = instanceNode;
  } else {
    // No node provided, use selection
    console.log("No node provided, using current selection");

    // Get the current selection
    const selection = figma.currentPage.selection;

    // Check if there's anything selected
    if (selection.length === 0) {
      console.log("No nodes selected");
      figma.notify("Please select at least one instance");
      return { success: false, message: "No nodes selected" };
    }

    // Filter for instances in the selection
    const instances = selection.filter((node) => node.type === "INSTANCE");

    if (instances.length === 0) {
      console.log("No instances found in selection");
      figma.notify("Please select at least one component instance");
      return { success: false, message: "No instances found in selection" };
    }

    // Take the first instance from the selection
    sourceInstance = instances[0];
  }

  try {
    console.log(`Getting instance information:`);
    console.log(sourceInstance);

    // Get component overrides and main component
    const overrides = sourceInstance.overrides || [];
    console.log(`  Raw Overrides:`, overrides);

    // Get main component
    const mainComponent = await sourceInstance.getMainComponentAsync();
    if (!mainComponent) {
      console.error("Failed to get main component");
      figma.notify("Failed to get main component");
      return { success: false, message: "Failed to get main component" };
    }

    // return data to MCP server
    const returnData = {
      success: true,
      message: `Got component information from "${sourceInstance.name}" for overrides.length: ${overrides.length}`,
      sourceInstanceId: sourceInstance.id,
      mainComponentId: mainComponent.id,
      overridesCount: overrides.length,
    };

    console.log("Data to return to MCP server:", returnData);
    figma.notify(`Got component information from "${sourceInstance.name}"`);

    return returnData;
  } catch (error) {
    console.error("Error in getInstanceOverrides:", error);
    figma.notify(`Error: ${error.message}`);
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Helper function to validate and get target instances
 * @param {string[]} targetNodeIds - Array of instance node IDs
 * @returns {Promise<any>} - { success, message, targetInstances } with the valid target instances
 */
async function getValidTargetInstances(targetNodeIds) {
  let targetInstances = [];

  // Handle array of instances or single instance
  if (Array.isArray(targetNodeIds)) {
    if (targetNodeIds.length === 0) {
      return { success: false, message: "No instances provided" };
    }
    for (const targetNodeId of targetNodeIds) {
      const targetNode = await figma.getNodeByIdAsync(targetNodeId);
      if (targetNode && targetNode.type === "INSTANCE") {
        targetInstances.push(targetNode);
      }
    }
    if (targetInstances.length === 0) {
      return { success: false, message: "No valid instances provided" };
    }
  } else {
    return { success: false, message: "Invalid target node IDs provided" };
  }

  return {
    success: true,
    message: "Valid target instances provided",
    targetInstances,
  };
}

/**
 * Helper function to validate and get saved override data
 * @param {string} sourceInstanceId - Source instance ID
 * @returns {Promise<Object>} - Validation result with source instance data or error
 */
async function getSourceInstanceData(sourceInstanceId) {
  if (!sourceInstanceId) {
    return { success: false, message: "Missing source instance ID" };
  }

  // Get source instance by ID
  const sourceInstance = await figma.getNodeByIdAsync(sourceInstanceId);
  if (!sourceInstance) {
    return {
      success: false,
      message:
        "Source instance not found. The original instance may have been deleted.",
    };
  }

  // Verify it's an instance
  if (sourceInstance.type !== "INSTANCE") {
    return {
      success: false,
      message: "Source node is not a component instance.",
    };
  }

  // Get main component
  const mainComponent = await sourceInstance.getMainComponentAsync();
  if (!mainComponent) {
    return {
      success: false,
      message: "Failed to get main component from source instance.",
    };
  }

  return {
    success: true,
    sourceInstance,
    mainComponent,
    overrides: sourceInstance.overrides || [],
  };
}

/**
 * Sets saved overrides to the selected component instance(s)
 * @param {InstanceNode[] | null} targetInstances - Array of instance nodes to set overrides to
 * @param {Object} sourceResult - Source instance data from getSourceInstanceData
 * @returns {Promise<Object>} - Result of the set operation
 */
async function setInstanceOverrides(targetInstances, sourceResult) {
  try {
    const { sourceInstance, mainComponent, overrides } = sourceResult;

    console.log(
      `Processing ${targetInstances.length} instances with ${overrides.length} overrides`,
    );
    console.log(
      `Source instance: ${sourceInstance.id}, Main component: ${mainComponent.id}`,
    );
    console.log(`Overrides:`, overrides);

    // Process all instances
    const results = [];
    let totalAppliedCount = 0;

    for (const targetInstance of targetInstances) {
      try {
        // // Skip if trying to apply to the source instance itself
        // if (targetInstance.id === sourceInstance.id) {
        //   console.log(`Skipping source instance itself: ${targetInstance.id}`);
        //   results.push({
        //     success: false,
        //     instanceId: targetInstance.id,
        //     instanceName: targetInstance.name,
        //     message: "This is the source instance itself, skipping"
        //   });
        //   continue;
        // }

        // Swap component
        try {
          targetInstance.swapComponent(mainComponent);
          console.log(
            `Swapped component for instance "${targetInstance.name}"`,
          );
        } catch (error) {
          console.error(
            `Error swapping component for instance "${targetInstance.name}":`,
            error,
          );
          results.push({
            success: false,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            message: `Error: ${error.message}`,
          });
        }

        // Prepare overrides by replacing node IDs
        let appliedCount = 0;

        // Apply each override
        for (const override of overrides) {
          // Skip if no ID or overriddenFields
          if (
            !override.id ||
            !override.overriddenFields ||
            override.overriddenFields.length === 0
          ) {
            continue;
          }

          // Replace source instance ID with target instance ID in the node path
          const overrideNodeId = override.id.replace(
            sourceInstance.id,
            targetInstance.id,
          );
          /** @type {any} */
          const overrideNode = await figma.getNodeByIdAsync(overrideNodeId);

          if (!overrideNode) {
            console.log(`Override node not found: ${overrideNodeId}`);
            continue;
          }

          // Get source node to copy properties from
          /** @type {any} */
          const sourceNode = await figma.getNodeByIdAsync(override.id);
          if (!sourceNode) {
            console.log(`Source node not found: ${override.id}`);
            continue;
          }

          // Apply each overridden field
          let fieldApplied = false;
          for (const field of override.overriddenFields) {
            try {
              if (field === "componentProperties") {
                // Apply component properties
                if (
                  sourceNode.componentProperties &&
                  overrideNode.componentProperties
                ) {
                  const properties = {};
                  for (const key in sourceNode.componentProperties) {
                    // if INSTANCE_SWAP use id, otherwise use value
                    if (
                      sourceNode.componentProperties[key].type ===
                      "INSTANCE_SWAP"
                    ) {
                      properties[key] =
                        sourceNode.componentProperties[key].value;
                    } else {
                      properties[key] =
                        sourceNode.componentProperties[key].value;
                    }
                  }
                  overrideNode.setProperties(properties);
                  fieldApplied = true;
                }
              } else if (
                field === "characters" &&
                overrideNode.type === "TEXT"
              ) {
                // For text nodes, need to load fonts first
                await figma.loadFontAsync(overrideNode.fontName);
                overrideNode.characters = sourceNode.characters;
                fieldApplied = true;
              } else if (field in overrideNode) {
                // Direct property assignment
                overrideNode[field] = sourceNode[field];
                fieldApplied = true;
              }
            } catch (fieldError) {
              console.error(`Error applying field ${field}:`, fieldError);
            }
          }

          if (fieldApplied) {
            appliedCount++;
          }
        }

        if (appliedCount > 0) {
          totalAppliedCount += appliedCount;
          results.push({
            success: true,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            appliedCount,
          });
          console.log(
            `Applied ${appliedCount} overrides to "${targetInstance.name}"`,
          );
        } else {
          results.push({
            success: false,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            message: "No overrides were applied",
          });
        }
      } catch (instanceError) {
        console.error(
          `Error processing instance "${targetInstance.name}":`,
          instanceError,
        );
        results.push({
          success: false,
          instanceId: targetInstance.id,
          instanceName: targetInstance.name,
          message: `Error: ${instanceError.message}`,
        });
      }
    }

    // Return results
    if (totalAppliedCount > 0) {
      const instanceCount = results.filter((r) => r.success).length;
      const message = `Applied ${totalAppliedCount} overrides to ${instanceCount} instances`;
      figma.notify(message);
      return {
        success: true,
        message,
        totalCount: totalAppliedCount,
        results,
      };
    } else {
      const message = "No overrides applied to any instance";
      figma.notify(message);
      return { success: false, message, results };
    }
  } catch (error) {
    console.error("Error in setInstanceOverrides:", error);
    const message = `Error: ${error.message}`;
    figma.notify(message);
    return { success: false, message };
  }
}

async function setLayoutMode(params) {
  const { nodeId, layoutMode = "NONE", layoutWrap = "NO_WRAP" } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports layoutMode
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support layoutMode`);
  }

  const p = params || {};
  const isGrid = layoutMode === "GRID";
  const isFlex = layoutMode === "HORIZONTAL" || layoutMode === "VERTICAL";
  // Validate before any mutation so a bad value doesn't leave partial edits
  const gridKeys = [
    "gridRowCount",
    "gridColumnCount",
    "gridRowGap",
    "gridColumnGap",
    "gridRowSizes",
    "gridColumnSizes",
    "gridAutoTracks",
  ];
  for (const key of gridKeys) {
    if (p[key] !== undefined && !isGrid) {
      throw new Error(`${key} requires layoutMode GRID`);
    }
  }
  if (p.counterAxisAlignContent !== undefined) {
    if (!isFlex || layoutWrap !== "WRAP") {
      throw new Error(
        "counterAxisAlignContent requires a HORIZONTAL/VERTICAL layout with layoutWrap WRAP",
      );
    }
    if (["AUTO", "SPACE_BETWEEN"].indexOf(p.counterAxisAlignContent) === -1) {
      throw new Error(
        `Invalid counterAxisAlignContent: ${p.counterAxisAlignContent}`,
      );
    }
  }
  if (p.strokesIncludedInLayout !== undefined && layoutMode === "NONE") {
    throw new Error("strokesIncludedInLayout requires an auto-layout mode");
  }
  const rowSizes =
    p.gridRowSizes !== undefined
      ? makeGridTrackSizes("gridRowSizes", p.gridRowSizes)
      : undefined;
  const columnSizes =
    p.gridColumnSizes !== undefined
      ? makeGridTrackSizes("gridColumnSizes", p.gridColumnSizes)
      : undefined;
  let rowCount;
  let columnCount;
  if (isGrid) {
    const checkCount = (key) => {
      if (p[key] !== undefined && !(Number.isInteger(p[key]) && p[key] >= 1)) {
        throw new Error(`${key} must be an integer >= 1`);
      }
    };
    checkCount("gridRowCount");
    checkCount("gridColumnCount");
    for (const key of ["gridRowGap", "gridColumnGap"]) {
      if (p[key] !== undefined && !(isFinite(Number(p[key])) && p[key] >= 0)) {
        throw new Error(`${key} must be a number >= 0`);
      }
    }
    if (
      p.gridAutoTracks !== undefined &&
      ["NONE", "ROWS"].indexOf(p.gridAutoTracks) === -1
    ) {
      throw new Error(`Invalid gridAutoTracks: ${p.gridAutoTracks}`);
    }
    // With ROWS the row count is managed by Figma and its setter throws
    const autoRows =
      p.gridAutoTracks !== undefined
        ? p.gridAutoTracks === "ROWS"
        : node.layoutMode === "GRID" && node.gridAutoTracks === "ROWS";
    if (autoRows && (p.gridRowCount !== undefined || rowSizes)) {
      throw new Error(
        'gridRowCount/gridRowSizes cannot be set while gridAutoTracks is "ROWS"; pass gridAutoTracks "NONE"',
      );
    }
    rowCount =
      p.gridRowCount !== undefined
        ? p.gridRowCount
        : rowSizes
          ? rowSizes.length
          : undefined;
    columnCount =
      p.gridColumnCount !== undefined
        ? p.gridColumnCount
        : columnSizes
          ? columnSizes.length
          : undefined;
    if (rowSizes && rowSizes.length !== rowCount) {
      throw new Error(
        `gridRowSizes has ${rowSizes.length} entries but gridRowCount is ${rowCount}`,
      );
    }
    if (columnSizes && columnSizes.length !== columnCount) {
      throw new Error(
        `gridColumnSizes has ${columnSizes.length} entries but gridColumnCount is ${columnCount}`,
      );
    }
  }

  // Set layout mode
  node.layoutMode = layoutMode;

  // layoutWrap only exists for HORIZONTAL/VERTICAL auto-layout
  if (isFlex) {
    node.layoutWrap = layoutWrap;
  }
  if (p.counterAxisAlignContent !== undefined) {
    node.counterAxisAlignContent = p.counterAxisAlignContent;
  }
  if (p.strokesIncludedInLayout !== undefined) {
    node.strokesIncludedInLayout = Boolean(p.strokesIncludedInLayout);
  }

  if (isGrid) {
    if (p.gridAutoTracks !== undefined) node.gridAutoTracks = p.gridAutoTracks;
    // Track counts first, so the size arrays below match them
    if (rowCount !== undefined) node.gridRowCount = Number(rowCount);
    if (columnCount !== undefined) node.gridColumnCount = Number(columnCount);
    if (p.gridRowGap !== undefined) node.gridRowGap = Number(p.gridRowGap);
    if (p.gridColumnGap !== undefined)
      node.gridColumnGap = Number(p.gridColumnGap);
    if (rowSizes) applyGridTrackSizes(node.gridRowSizes, rowSizes, "row");
    if (columnSizes)
      applyGridTrackSizes(node.gridColumnSizes, columnSizes, "column");
  }

  /** @type {any} */
  const result = {
    id: node.id,
    name: node.name,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
    strokesIncludedInLayout: node.strokesIncludedInLayout,
  };
  if (isFlex && node.layoutWrap === "WRAP") {
    result.counterAxisAlignContent = node.counterAxisAlignContent;
  }
  if (isGrid) {
    result.gridRowCount = node.gridRowCount;
    result.gridColumnCount = node.gridColumnCount;
    result.gridRowGap = node.gridRowGap;
    result.gridColumnGap = node.gridColumnGap;
    result.gridAutoTracks = node.gridAutoTracks;
    result.gridRowSizes = serializeGridTrackSizes(node.gridRowSizes);
    result.gridColumnSizes = serializeGridTrackSizes(node.gridColumnSizes);
  }
  return result;
}

const GRID_TRACK_TYPES = ["FLEX", "FIXED", "HUG"];

function makeGridTrackSizes(field, sizes) {
  if (!Array.isArray(sizes) || sizes.length === 0) {
    throw new Error(`${field} must be a non-empty array`);
  }
  return sizes.map((size, index) => {
    if (!size || GRID_TRACK_TYPES.indexOf(size.type) === -1) {
      throw new Error(
        `${field}[${index}].type must be one of ${GRID_TRACK_TYPES.join(", ")}`,
      );
    }
    if (size.type === "FIXED" && !(Number(size.value) > 0)) {
      throw new Error(`${field}[${index}].value must be > 0 for FIXED tracks`);
    }
    return { type: size.type, value: size.value };
  });
}

// GridTrackSize objects are live setters on the node, see GridLayoutMixin
function applyGridTrackSizes(tracks, sizes, label) {
  if (tracks.length !== sizes.length) {
    throw new Error(
      `Grid has ${tracks.length} ${label}s but ${sizes.length} ${label} sizes were given`,
    );
  }
  for (let i = 0; i < sizes.length; i++) {
    tracks[i].type = sizes[i].type;
    if (sizes[i].type !== "HUG" && sizes[i].value !== undefined) {
      tracks[i].value = Number(sizes[i].value);
    }
  }
}

function serializeGridTrackSizes(tracks) {
  return tracks.map((track) =>
    track.value === undefined
      ? { type: track.type }
      : { type: track.type, value: track.value },
  );
}

async function setPadding(params) {
  const { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft } =
    params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports padding
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support padding`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Padding can only be set on auto-layout frames (layoutMode must not be NONE)",
    );
  }

  // Set padding values if provided
  if (paddingTop !== undefined) node.paddingTop = paddingTop;
  if (paddingRight !== undefined) node.paddingRight = paddingRight;
  if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
  if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;

  return {
    id: node.id,
    name: node.name,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
  };
}

async function setAxisAlign(params) {
  const { nodeId, primaryAxisAlignItems, counterAxisAlignItems } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports axis alignment
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support axis alignment`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Axis alignment can only be set on auto-layout frames (layoutMode must not be NONE)",
    );
  }

  // Validate and set primaryAxisAlignItems if provided
  if (primaryAxisAlignItems !== undefined) {
    if (
      !["MIN", "MAX", "CENTER", "SPACE_BETWEEN"].includes(primaryAxisAlignItems)
    ) {
      throw new Error(
        "Invalid primaryAxisAlignItems value. Must be one of: MIN, MAX, CENTER, SPACE_BETWEEN",
      );
    }
    node.primaryAxisAlignItems = primaryAxisAlignItems;
  }

  // Validate and set counterAxisAlignItems if provided
  if (counterAxisAlignItems !== undefined) {
    if (!["MIN", "MAX", "CENTER", "BASELINE"].includes(counterAxisAlignItems)) {
      throw new Error(
        "Invalid counterAxisAlignItems value. Must be one of: MIN, MAX, CENTER, BASELINE",
      );
    }
    // BASELINE is only valid for horizontal layout
    if (
      counterAxisAlignItems === "BASELINE" &&
      node.layoutMode !== "HORIZONTAL"
    ) {
      throw new Error(
        "BASELINE alignment is only valid for horizontal auto-layout frames",
      );
    }
    node.counterAxisAlignItems = counterAxisAlignItems;
  }

  return {
    id: node.id,
    name: node.name,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    layoutMode: node.layoutMode,
  };
}

async function setLayoutSizing(params) {
  const { nodeId, layoutSizingHorizontal, layoutSizingVertical } = params || {};

  // Get the target node
  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame-like node or text that supports layout sizing
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE" &&
    node.type !== "TEXT"
  ) {
    throw new Error(`Node type ${node.type} does not support layout sizing`);
  }

  // HUG needs the node itself to be auto-layout (frame, component, component
  // set or instance) or a text node. FILL/FIXED only depend on the parent.
  const canHug = node.type === "TEXT" || node.layoutMode !== "NONE";

  // Validate and set layoutSizingHorizontal if provided
  if (layoutSizingHorizontal !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingHorizontal)) {
      throw new Error(
        "Invalid layoutSizingHorizontal value. Must be one of: FIXED, HUG, FILL",
      );
    }
    if (layoutSizingHorizontal === "HUG" && !canHug) {
      throw new Error(
        "HUG sizing is only valid on auto-layout frames/components/instances and text nodes",
      );
    }
    // FILL is only valid on auto-layout children
    if (
      layoutSizingHorizontal === "FILL" &&
      (!node.parent || node.parent.layoutMode === "NONE")
    ) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
    node.layoutSizingHorizontal = layoutSizingHorizontal;
  }

  // Validate and set layoutSizingVertical if provided
  if (layoutSizingVertical !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingVertical)) {
      throw new Error(
        "Invalid layoutSizingVertical value. Must be one of: FIXED, HUG, FILL",
      );
    }
    if (layoutSizingVertical === "HUG" && !canHug) {
      throw new Error(
        "HUG sizing is only valid on auto-layout frames/components/instances and text nodes",
      );
    }
    // FILL is only valid on auto-layout children
    if (
      layoutSizingVertical === "FILL" &&
      (!node.parent || node.parent.layoutMode === "NONE")
    ) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
    node.layoutSizingVertical = layoutSizingVertical;
  }

  return {
    id: node.id,
    name: node.name,
    layoutSizingHorizontal: node.layoutSizingHorizontal,
    layoutSizingVertical: node.layoutSizingVertical,
    layoutMode: node.layoutMode,
  };
}

async function setItemSpacing(params) {
  const { nodeId, itemSpacing, counterAxisSpacing } = params || {};

  // Validate that at least one spacing parameter is provided
  if (itemSpacing === undefined && counterAxisSpacing === undefined) {
    throw new Error(
      "At least one of itemSpacing or counterAxisSpacing must be provided",
    );
  }

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports item spacing
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support item spacing`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Item spacing can only be set on auto-layout frames (layoutMode must not be NONE)",
    );
  }

  // Set item spacing if provided
  if (itemSpacing !== undefined) {
    if (typeof itemSpacing !== "number") {
      throw new Error("Item spacing must be a number");
    }
    node.itemSpacing = itemSpacing;
  }

  // Set counter axis spacing if provided
  if (counterAxisSpacing !== undefined) {
    if (typeof counterAxisSpacing !== "number") {
      throw new Error("Counter axis spacing must be a number");
    }
    // counterAxisSpacing only applies when layoutWrap is WRAP
    if (node.layoutWrap !== "WRAP") {
      throw new Error(
        "Counter axis spacing can only be set on frames with layoutWrap set to WRAP",
      );
    }
    node.counterAxisSpacing = counterAxisSpacing;
  }

  return {
    id: node.id,
    name: node.name,
    itemSpacing: node.itemSpacing || undefined,
    counterAxisSpacing: node.counterAxisSpacing || undefined,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
  };
}

async function setDefaultConnector(params) {
  const { connectorId } = params || {};

  // If connectorId is provided, search and set by that ID (do not check existing storage)
  if (connectorId) {
    // Get node by specified ID
    const node = await figma.getNodeByIdAsync(connectorId);
    if (!node) {
      throw new Error(`Connector node not found with ID: ${connectorId}`);
    }

    // Check node type
    if (node.type !== "CONNECTOR") {
      throw new Error(`Node is not a connector: ${connectorId}`);
    }

    // Set the found connector as the default connector
    await figma.clientStorage.setAsync("defaultConnectorId", connectorId);

    return {
      success: true,
      message: `Default connector set to: ${connectorId}`,
      connectorId: connectorId,
    };
  }
  // If connectorId is not provided, check existing storage
  else {
    // Check if there is an existing default connector in client storage
    try {
      const existingConnectorId =
        await figma.clientStorage.getAsync("defaultConnectorId");

      // If there is an existing connector ID, check if the node is still valid
      if (existingConnectorId) {
        try {
          const existingConnector =
            await figma.getNodeByIdAsync(existingConnectorId);

          // If the stored connector still exists and is of type CONNECTOR
          if (existingConnector && existingConnector.type === "CONNECTOR") {
            return {
              success: true,
              message: `Default connector is already set to: ${existingConnectorId}`,
              connectorId: existingConnectorId,
              exists: true,
            };
          }
          // The stored connector is no longer valid - find a new connector
          else {
            console.log(
              `Stored connector ID ${existingConnectorId} is no longer valid, finding a new connector...`,
            );
          }
        } catch (error) {
          console.log(
            `Error finding stored connector: ${error.message}. Will try to set a new one.`,
          );
        }
      }
    } catch (error) {
      console.log(`Error checking for existing connector: ${error.message}`);
    }

    // If there is no stored default connector or it is invalid, find one in the current page
    try {
      // Find CONNECTOR type nodes in the current page
      const currentPageConnectors = figma.currentPage.findAllWithCriteria({
        types: ["CONNECTOR"],
      });

      if (currentPageConnectors && currentPageConnectors.length > 0) {
        // Use the first connector found
        const foundConnector = currentPageConnectors[0];
        const autoFoundId = foundConnector.id;

        // Set the found connector as the default connector
        await figma.clientStorage.setAsync("defaultConnectorId", autoFoundId);

        return {
          success: true,
          message: `Automatically found and set default connector to: ${autoFoundId}`,
          connectorId: autoFoundId,
          autoSelected: true,
        };
      } else {
        // If no connector is found in the current page, show a guide message
        throw new Error(
          "No connector found in the current page. Please create a connector in Figma first or specify a connector ID.",
        );
      }
    } catch (error) {
      // Error occurred while running findAllWithCriteria
      throw new Error(`Failed to find a connector: ${error.message}`);
    }
  }
}

async function createCursorNode(targetNodeId) {
  const svgString = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 8V35.2419L22 28.4315L27 39.7823C27 39.7823 28.3526 40.2722 29 39.7823C29.6474 39.2924 30.2913 38.3057 30 37.5121C28.6247 33.7654 25 26.1613 25 26.1613H32L16 8Z" fill="#202125" />
  </svg>`;
  try {
    /** @type {any} */
    const targetNode = await figma.getNodeByIdAsync(targetNodeId);
    if (!targetNode) throw new Error("Target node not found");

    // The targetNodeId has semicolons since it is a nested node.
    // So we need to get the parent node ID from the target node ID and check if we can appendChild to it or not.
    let parentNodeId = targetNodeId.includes(";")
      ? targetNodeId.split(";")[0]
      : targetNodeId;
    if (!parentNodeId) throw new Error("Could not determine parent node ID");

    // Find the parent node to append cursor node as child
    /** @type {any} */
    let parentNode = await figma.getNodeByIdAsync(parentNodeId);
    if (!parentNode) throw new Error("Parent node not found");

    // If the parent node is not eligible to appendChild, set the parentNode to the parent of the parentNode
    if (
      parentNode.type === "INSTANCE" ||
      parentNode.type === "COMPONENT" ||
      parentNode.type === "COMPONENT_SET"
    ) {
      parentNode = parentNode.parent;
      if (!parentNode) throw new Error("Parent node not found");
    }

    // Create the cursor node
    /** @type {any} */
    const importedNode = await figma.createNodeFromSvg(svgString);
    if (!importedNode || !importedNode.id) {
      throw new Error("Failed to create imported cursor node");
    }
    importedNode.name = "TTF_Connector / Mouse Cursor";
    importedNode.resize(48, 48);

    /** @type {any} */
    const cursorNode = importedNode.findOne((node) => node.type === "VECTOR");
    if (cursorNode) {
      cursorNode.fills = [
        {
          type: "SOLID",
          color: { r: 0, g: 0, b: 0 },
          opacity: 1,
        },
      ];
      cursorNode.strokes = [
        {
          type: "SOLID",
          color: { r: 1, g: 1, b: 1 },
          opacity: 1,
        },
      ];
      cursorNode.strokeWeight = 2;
      cursorNode.strokeAlign = "OUTSIDE";
      cursorNode.effects = [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.3 },
          offset: { x: 1, y: 1 },
          radius: 2,
          spread: 0,
          visible: true,
          blendMode: "NORMAL",
        },
      ];
    }

    // Append the cursor node to the parent node
    parentNode.appendChild(importedNode);

    // if the parentNode has auto-layout enabled, set the layoutPositioning to ABSOLUTE
    if ("layoutMode" in parentNode && parentNode.layoutMode !== "NONE") {
      importedNode.layoutPositioning = "ABSOLUTE";
    }

    // Adjust the importedNode's position to the targetNode's position
    if (targetNode.absoluteBoundingBox && parentNode.absoluteBoundingBox) {
      // if the targetNode has absoluteBoundingBox, set the importedNode's absoluteBoundingBox to the targetNode's absoluteBoundingBox
      console.log(
        "targetNode.absoluteBoundingBox",
        targetNode.absoluteBoundingBox,
      );
      console.log(
        "parentNode.absoluteBoundingBox",
        parentNode.absoluteBoundingBox,
      );
      importedNode.x =
        targetNode.absoluteBoundingBox.x -
        parentNode.absoluteBoundingBox.x +
        targetNode.absoluteBoundingBox.width / 2 -
        48 / 2;
      importedNode.y =
        targetNode.absoluteBoundingBox.y -
        parentNode.absoluteBoundingBox.y +
        targetNode.absoluteBoundingBox.height / 2 -
        48 / 2;
    } else if (
      "x" in targetNode &&
      "y" in targetNode &&
      "width" in targetNode &&
      "height" in targetNode
    ) {
      // if the targetNode has x, y, width, height, calculate center based on relative position
      console.log(
        "targetNode.x/y/width/height",
        targetNode.x,
        targetNode.y,
        targetNode.width,
        targetNode.height,
      );
      importedNode.x = targetNode.x + targetNode.width / 2 - 48 / 2;
      importedNode.y = targetNode.y + targetNode.height / 2 - 48 / 2;
    } else {
      // Fallback: Place at top-left of target if possible, otherwise at (0,0) relative to parent
      if ("x" in targetNode && "y" in targetNode) {
        console.log("Fallback to targetNode x/y");
        importedNode.x = targetNode.x;
        importedNode.y = targetNode.y;
      } else {
        console.log("Fallback to (0,0)");
        importedNode.x = 0;
        importedNode.y = 0;
      }
    }

    // get the importedNode ID and the importedNode
    console.log("importedNode", importedNode);

    return { id: importedNode.id, node: importedNode };
  } catch (error) {
    console.error("Error creating cursor from SVG:", error);
    return { id: null, node: null, error: error.message };
  }
}

async function createConnections(params) {
  if (!params || !params.connections || !Array.isArray(params.connections)) {
    throw new Error("Missing or invalid connections parameter");
  }

  const { connections } = params;

  // Command ID for progress tracking
  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "create_connections",
    "started",
    0,
    connections.length,
    0,
    `Starting to create ${connections.length} connections`,
  );

  // Get default connector ID from client storage
  const defaultConnectorId =
    await figma.clientStorage.getAsync("defaultConnectorId");
  if (!defaultConnectorId) {
    throw new Error(
      'No default connector set. Please try one of the following options to create connections:\n1. Create a connector in FigJam and copy/paste it to your current page, then run the "set_default_connector" command.\n2. Select an existing connector on the current page, then run the "set_default_connector" command.',
    );
  }

  // Get the default connector
  const defaultConnector = await figma.getNodeByIdAsync(defaultConnectorId);
  if (!defaultConnector) {
    throw new Error(
      `Default connector not found with ID: ${defaultConnectorId}`,
    );
  }
  if (defaultConnector.type !== "CONNECTOR") {
    throw new Error(`Node is not a connector: ${defaultConnectorId}`);
  }

  // Results array for connection creation
  const results = [];
  let processedCount = 0;
  const totalCount = connections.length;

  // Preload fonts (used for text if provided)
  let fontLoaded = false;

  for (let i = 0; i < connections.length; i++) {
    try {
      const {
        startNodeId: originalStartId,
        endNodeId: originalEndId,
        text,
      } = connections[i];
      let startId = originalStartId;
      let endId = originalEndId;

      // Check and potentially replace start node ID
      if (startId.includes(";")) {
        console.log(
          `Nested start node detected: ${startId}. Creating cursor node.`,
        );
        const cursorResult = await createCursorNode(startId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(
            `Failed to create cursor node for nested start node: ${startId}`,
          );
        }
        startId = cursorResult.id;
      }

      const startNode = await figma.getNodeByIdAsync(startId);
      if (!startNode)
        throw new Error(`Start node not found with ID: ${startId}`);

      // Check and potentially replace end node ID
      if (endId.includes(";")) {
        console.log(
          `Nested end node detected: ${endId}. Creating cursor node.`,
        );
        const cursorResult = await createCursorNode(endId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(
            `Failed to create cursor node for nested end node: ${endId}`,
          );
        }
        endId = cursorResult.id;
      }
      const endNode = await figma.getNodeByIdAsync(endId);
      if (!endNode) throw new Error(`End node not found with ID: ${endId}`);

      // Clone the default connector
      const clonedConnector = defaultConnector.clone();

      // Update connector name using potentially replaced node names
      clonedConnector.name = `TTF_Connector/${startNode.id}/${endNode.id}`;

      // Set start and end points using potentially replaced IDs
      clonedConnector.connectorStart = {
        endpointNodeId: startId,
        magnet: "AUTO",
      };

      clonedConnector.connectorEnd = {
        endpointNodeId: endId,
        magnet: "AUTO",
      };

      // Add text (if provided)
      if (text) {
        try {
          // Try to load the necessary fonts
          try {
            // First check if default connector has font and use the same
            if (defaultConnector.text && defaultConnector.text.fontName) {
              /** @type {any} */
              const fontName = defaultConnector.text.fontName;
              await figma.loadFontAsync(fontName);
              clonedConnector.text.fontName = fontName;
            } else {
              // Try default Inter font
              await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            }
          } catch (fontError) {
            // If first font load fails, try another font style
            try {
              await figma.loadFontAsync({ family: "Inter", style: "Medium" });
            } catch (mediumFontError) {
              // If second font fails, try system font
              try {
                await figma.loadFontAsync({
                  family: "System",
                  style: "Regular",
                });
              } catch (systemFontError) {
                // If all font loading attempts fail, throw error
                throw new Error(
                  `Failed to load any font: ${fontError.message}`,
                );
              }
            }
          }

          // Set the text
          clonedConnector.text.characters = text;
        } catch (textError) {
          console.error("Error setting text:", textError);
          // Continue with connection even if text setting fails
          results.push({
            id: clonedConnector.id,
            startNodeId: originalStartId,
            endNodeId: originalEndId,
            text: "",
            textError: textError.message,
          });

          // Continue to next connection
          continue;
        }
      }

      // Add to results (using the *original* IDs for reference if needed)
      results.push({
        id: clonedConnector.id,
        originalStartNodeId: originalStartId,
        originalEndNodeId: originalEndId,
        usedStartNodeId: startId, // ID actually used for connection
        usedEndNodeId: endId, // ID actually used for connection
        text: text || "",
      });

      // Update progress
      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Created connection ${processedCount}/${totalCount}`,
      );
    } catch (error) {
      console.error("Error creating connection", error);
      // Continue processing remaining connections even if an error occurs
      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Error creating connection: ${error.message}`,
      );

      results.push({
        error: error.message,
        connectionInfo: connections[i],
      });
    }
  }

  // Completion update
  sendProgressUpdate(
    commandId,
    "create_connections",
    "completed",
    1,
    totalCount,
    totalCount,
    `Completed creating ${results.length} connections`,
  );

  return {
    success: true,
    count: results.length,
    connections: results,
  };
}

// Set focus on a specific node
async function setFocus(params) {
  if (!params || !params.nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) {
    throw new Error(`Node with ID ${params.nodeId} not found`);
  }

  // Set selection to the node
  figma.currentPage.selection = [node];

  // Scroll and zoom to show the node in viewport
  figma.viewport.scrollAndZoomIntoView([node]);

  return {
    success: true,
    name: node.name,
    id: node.id,
    message: `Focused on node "${node.name}"`,
  };
}

// Set selection to multiple nodes
async function setSelections(params) {
  if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
    throw new Error("Missing or invalid nodeIds parameter");
  }

  if (params.nodeIds.length === 0) {
    throw new Error("nodeIds array cannot be empty");
  }

  // Get all valid nodes
  /** @type {any} */
  const nodes = [];
  const notFoundIds = [];

  for (const nodeId of params.nodeIds) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node) {
      nodes.push(node);
    } else {
      notFoundIds.push(nodeId);
    }
  }

  if (nodes.length === 0) {
    throw new Error(
      `No valid nodes found for the provided IDs: ${params.nodeIds.join(", ")}`,
    );
  }

  // Set selection to the nodes
  figma.currentPage.selection = nodes;

  // Scroll and zoom to show all nodes in viewport
  figma.viewport.scrollAndZoomIntoView(nodes);

  const selectedNodes = nodes.map((node) => ({
    name: node.name,
    id: node.id,
  }));

  return {
    success: true,
    count: nodes.length,
    selectedNodes: selectedNodes,
    notFoundIds: notFoundIds,
    message: `Selected ${nodes.length} nodes${notFoundIds.length > 0 ? ` (${notFoundIds.length} not found)` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Components (create, variants, properties, swap)
// ---------------------------------------------------------------------------

async function createComponentFromNode(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    throw new Error(`Node ${nodeId} is already a ${node.type}`);
  }
  if (node.type === "DOCUMENT" || node.type === "PAGE") {
    throw new Error(`Cannot convert a ${node.type} node into a component`);
  }

  let component;
  try {
    component = figma.createComponentFromNode(node);
  } catch (error) {
    throw new Error(
      `Cannot create component from node ${nodeId}: ${error.message}`,
    );
  }

  if (name !== undefined && name !== null) {
    component.name = String(name);
  }

  return {
    id: component.id,
    name: component.name,
    key: component.key,
  };
}

async function combineAsVariants(params) {
  const { componentIds, name, parentId } = params || {};

  if (!Array.isArray(componentIds) || componentIds.length === 0) {
    throw new Error("Missing or empty componentIds parameter");
  }

  const components = [];
  for (const id of componentIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      throw new Error(`Component node not found with ID: ${id}`);
    }
    if (node.type !== "COMPONENT") {
      throw new Error(`Node ${id} is not a COMPONENT (got type: ${node.type})`);
    }
    components.push(node);
  }

  /** @type {any} */
  let parent;
  if (parentId) {
    parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parent)) {
      throw new Error(
        `Parent node ${parentId} (${parent.type}) does not support children`,
      );
    }
  } else {
    parent = components[0].parent || figma.currentPage;
  }

  let componentSet;
  try {
    componentSet = figma.combineAsVariants(components, parent);
  } catch (error) {
    throw new Error(`Cannot combine components as variants: ${error.message}`);
  }

  if (name !== undefined && name !== null) {
    componentSet.name = String(name);
  }

  // combineAsVariants keeps the original child positions, which can stack
  // variants on top of each other; lay them out in a grid instead
  if (componentSet.layoutMode === "NONE") {
    const VARIANT_GAP = 24;
    const VARIANT_PADDING = 24;
    const MAX_COLUMNS = 4;
    const variants = componentSet.children;
    const columns = Math.min(variants.length, MAX_COLUMNS);
    const cellWidth = Math.max.apply(
      null,
      variants.map((child) => child.width),
    );
    const cellHeight = Math.max.apply(
      null,
      variants.map((child) => child.height),
    );

    variants.forEach((child, index) => {
      child.x = VARIANT_PADDING + (index % columns) * (cellWidth + VARIANT_GAP);
      child.y =
        VARIANT_PADDING +
        Math.floor(index / columns) * (cellHeight + VARIANT_GAP);
    });

    const rows = Math.ceil(variants.length / columns);
    componentSet.resizeWithoutConstraints(
      VARIANT_PADDING * 2 + columns * cellWidth + (columns - 1) * VARIANT_GAP,
      VARIANT_PADDING * 2 + rows * cellHeight + (rows - 1) * VARIANT_GAP,
    );
  }

  let variantGroupProperties = null;
  try {
    variantGroupProperties = componentSet.variantGroupProperties;
  } catch (error) {
    // Invalid variant names (not "Prop=Value") make this getter throw
    variantGroupProperties = { error: error.message };
  }

  return {
    id: componentSet.id,
    name: componentSet.name,
    key: componentSet.key,
    variantGroupProperties: variantGroupProperties,
    variants: componentSet.children.map((child) => ({
      id: child.id,
      name: child.name,
    })),
  };
}

function isDescendantOf(node, ancestor) {
  let current = node.parent;
  while (current) {
    if (current.id === ancestor.id) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

async function loadTextNodeFonts(textNode) {
  if (textNode.fontName === figma.mixed) {
    const fonts = textNode.getRangeAllFontNames(0, textNode.characters.length);
    for (const font of fonts) {
      await figma.loadFontAsync(font);
    }
  } else {
    await figma.loadFontAsync(textNode.fontName);
  }
}

async function addComponentProperty(params) {
  const { componentId, name, type, defaultValue, targetNodeId } = params || {};

  if (!componentId) {
    throw new Error("Missing componentId parameter");
  }
  if (!name) {
    throw new Error("Missing name parameter");
  }
  if (["TEXT", "BOOLEAN", "INSTANCE_SWAP"].indexOf(type) === -1) {
    throw new Error(
      `Invalid type: ${type}. Must be TEXT, BOOLEAN or INSTANCE_SWAP`,
    );
  }

  const component = await figma.getNodeByIdAsync(componentId);
  if (!component) {
    throw new Error(`Component node not found with ID: ${componentId}`);
  }
  if (component.type !== "COMPONENT" && component.type !== "COMPONENT_SET") {
    throw new Error(
      `Node ${componentId} is not a COMPONENT or COMPONENT_SET (got type: ${component.type})`,
    );
  }

  if (type === "TEXT" && typeof defaultValue !== "string") {
    throw new Error("defaultValue must be a string for TEXT properties");
  }
  if (type === "BOOLEAN" && typeof defaultValue !== "boolean") {
    throw new Error("defaultValue must be a boolean for BOOLEAN properties");
  }
  if (type === "INSTANCE_SWAP") {
    if (typeof defaultValue !== "string") {
      throw new Error(
        "defaultValue must be a component ID for INSTANCE_SWAP properties",
      );
    }
    const swapComponent = await figma.getNodeByIdAsync(defaultValue);
    if (!swapComponent || swapComponent.type !== "COMPONENT") {
      throw new Error(
        `defaultValue ${defaultValue} is not a valid COMPONENT ID`,
      );
    }
  }

  // Validate the target before mutating the component
  /** @type {any} */
  let target = null;
  let referenceField = null;
  if (targetNodeId) {
    target = await figma.getNodeByIdAsync(targetNodeId);
    if (!target) {
      throw new Error(`Target node not found with ID: ${targetNodeId}`);
    }
    if (!isDescendantOf(target, component)) {
      throw new Error(
        `Target node ${targetNodeId} is not inside component ${componentId}`,
      );
    }
    if (type === "TEXT") {
      if (target.type !== "TEXT") {
        throw new Error(
          `Target node ${targetNodeId} must be a TEXT node for TEXT properties (got ${target.type})`,
        );
      }
      referenceField = "characters";
    } else if (type === "BOOLEAN") {
      referenceField = "visible";
    } else {
      if (target.type !== "INSTANCE") {
        throw new Error(
          `Target node ${targetNodeId} must be an INSTANCE for INSTANCE_SWAP properties (got ${target.type})`,
        );
      }
      referenceField = "mainComponent";
    }
  }

  let propertyKey;
  try {
    propertyKey = component.addComponentProperty(name, type, defaultValue);
  } catch (error) {
    throw new Error(
      `Cannot add component property "${name}": ${error.message}`,
    );
  }

  if (target) {
    try {
      if (target.type === "TEXT") {
        await loadTextNodeFonts(target);
      }
      const references = Object.assign(
        {},
        target.componentPropertyReferences || {},
      );
      references[referenceField] = propertyKey;
      target.componentPropertyReferences = references;
    } catch (error) {
      throw new Error(
        `Property "${propertyKey}" was added but linking to node ${targetNodeId} failed: ${error.message}`,
      );
    }
  }

  return {
    componentId: component.id,
    propertyKey: propertyKey,
    type: type,
    targetNodeId: target ? target.id : undefined,
    referenceField: referenceField || undefined,
  };
}

async function swapInstance(params) {
  const { instanceId, componentId } = params || {};

  if (!instanceId) {
    throw new Error("Missing instanceId parameter");
  }
  if (!componentId) {
    throw new Error("Missing componentId parameter");
  }

  const instance = await figma.getNodeByIdAsync(instanceId);
  if (!instance) {
    throw new Error(`Instance node not found with ID: ${instanceId}`);
  }
  if (instance.type !== "INSTANCE") {
    throw new Error(
      `Node ${instanceId} is not an INSTANCE (got type: ${instance.type})`,
    );
  }

  const component = await figma.getNodeByIdAsync(componentId);
  if (!component) {
    throw new Error(`Component node not found with ID: ${componentId}`);
  }
  if (component.type !== "COMPONENT") {
    throw new Error(
      `Node ${componentId} is not a COMPONENT (got type: ${component.type})`,
    );
  }

  try {
    instance.swapComponent(component);
  } catch (error) {
    throw new Error(`Cannot swap instance: ${error.message}`);
  }

  const mainComponent = await instance.getMainComponentAsync();

  return {
    id: instance.id,
    name: instance.name,
    mainComponentId: mainComponent ? mainComponent.id : undefined,
    mainComponentName: mainComponent ? mainComponent.name : undefined,
  };
}

// ---------------------------------------------------------------------------
// Variables (collections, values, bindings)
// ---------------------------------------------------------------------------

function formatVariableValue(value) {
  if (value && typeof value === "object") {
    if (value.type === "VARIABLE_ALIAS") {
      return { aliasOf: value.id };
    }
    if ("r" in value && "g" in value && "b" in value) {
      return rgbaToHex(value);
    }
  }
  return value;
}

async function getLocalVariables() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();

  return {
    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      defaultModeId: collection.defaultModeId,
      modes: collection.modes.map((mode) => ({
        modeId: mode.modeId,
        name: mode.name,
      })),
    })),
    variables: variables.map((variable) => {
      const valuesByMode = {};
      for (const modeId of Object.keys(variable.valuesByMode)) {
        valuesByMode[modeId] = formatVariableValue(
          variable.valuesByMode[modeId],
        );
      }
      return {
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        collectionId: variable.variableCollectionId,
        scopes: variable.scopes,
        valuesByMode: valuesByMode,
      };
    }),
  };
}

function collectVariableAliasIds(value, ids) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectVariableAliasIds(item, ids);
    return;
  }
  if (value.type === "VARIABLE_ALIAS" && typeof value.id === "string") {
    ids.add(value.id);
    return;
  }
  for (const key of Object.keys(value)) {
    collectVariableAliasIds(value[key], ids);
  }
}

async function resolveVariablesForDesign(ids) {
  const variables = {};
  const collectionCache = {};
  for (const id of ids) {
    try {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (!variable) continue;
      let collection = collectionCache[variable.variableCollectionId];
      if (collection === undefined) {
        collection = await figma.variables.getVariableCollectionByIdAsync(
          variable.variableCollectionId,
        );
        collectionCache[variable.variableCollectionId] = collection;
      }
      const modeNames = {};
      if (collection) {
        for (const mode of collection.modes) {
          modeNames[mode.modeId] = mode.name;
        }
      }
      const valuesByMode = {};
      for (const modeId of Object.keys(variable.valuesByMode)) {
        valuesByMode[modeNames[modeId] || modeId] = formatVariableValue(
          variable.valuesByMode[modeId],
        );
      }
      variables[id] = {
        name: variable.name,
        collection: collection ? collection.name : undefined,
        resolvedType: variable.resolvedType,
        valuesByMode: valuesByMode,
      };
    } catch (error) {
      // Remote/unavailable variables are reported by id only
    }
  }
  return variables;
}

async function getDesignContext(params) {
  const { nodeIds, maxDepth, includeHidden, commandId } = params || {};
  let nodes;
  if (Array.isArray(nodeIds) && nodeIds.length > 0) {
    nodes = [];
    for (const id of nodeIds) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node) {
        throw new Error(`Node not found with ID: ${id}`);
      }
      nodes.push(node);
    }
  } else {
    nodes = figma.currentPage.selection.slice();
    if (nodes.length === 0) {
      throw new Error(
        "Nothing selected. Select a frame in Figma or pass nodeIds.",
      );
    }
  }

  const pruneOptions = {
    maxDepth: Number.isInteger(maxDepth) && maxDepth >= 0 ? maxDepth : undefined,
    includeHidden: includeHidden === true,
  };
  const bundles = [];
  const aliasIds = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!("exportAsync" in node)) {
      throw new Error(`Node cannot be exported: ${node.id} (${node.type})`);
    }
    // Progress resets the MCP server timeout and yields between heavy exports
    await sendProgressUpdate(
      commandId,
      "get_design_context",
      i === 0 ? "started" : "in_progress",
      Math.round((i / nodes.length) * 100),
      nodes.length,
      i,
      `Exporting ${node.name} (${i + 1}/${nodes.length})`,
    );
    /** @type {any} */
    const response = await node.exportAsync({ format: "JSON_REST_V1" });
    // Shrink the payload before it is cloned to the UI and sent over the socket
    const document = pruneDesignNode(response.document, 0, pruneOptions);
    collectVariableAliasIds(document, aliasIds);
    bundles.push({
      document: document,
      components: response.components,
      componentSets: response.componentSets,
      styles: response.styles,
    });
  }

  await sendProgressUpdate(
    commandId,
    "get_design_context",
    "completed",
    100,
    nodes.length,
    nodes.length,
    `Exported ${nodes.length} node(s)`,
  );

  return {
    fileName: figma.root.name,
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    bundles: bundles,
    variables: await resolveVariablesForDesign(aliasIds),
  };
}

// Nodes the server's simplifier never renders (hidden ones, or ones deeper than
// maxDepth) are reduced to the fields it still inspects for icon detection and
// childrenTruncated: type, visibility, fills, layoutMode and children.
function pruneDesignNode(node, depth, options) {
  if (!node || typeof node !== "object") return node;
  const skeleton =
    (node.visible === false && !options.includeHidden) ||
    (options.maxDepth !== undefined && depth > options.maxDepth);
  if (skeleton) return skeletonDesignNode(node);
  if (!Array.isArray(node.children)) return node;
  const pruned = Object.assign({}, node);
  pruned.children = node.children.map((child) =>
    pruneDesignNode(child, depth + 1, options),
  );
  return pruned;
}

function skeletonDesignNode(node) {
  const out = { id: node.id, type: node.type };
  if (node.visible === false) out.visible = false;
  if (node.layoutMode) out.layoutMode = node.layoutMode;
  if (Array.isArray(node.fills)) {
    out.fills = node.fills.map((p) => ({ type: p.type, visible: p.visible }));
  }
  if (Array.isArray(node.children)) {
    out.children = node.children.map(skeletonDesignNode);
  }
  return out;
}

async function exportNodeAssets(params) {
  const { items } = params || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing items parameter");
  }

  const mimeTypes = {
    PNG: "image/png",
    JPG: "image/jpeg",
    SVG: "image/svg+xml",
    PDF: "application/pdf",
  };
  const results = [];
  for (const item of items) {
    try {
      let bytes;
      let mimeType;
      if (item.imageRef) {
        const image = figma.getImageByHash(item.imageRef);
        if (!image) {
          throw new Error(`Image not found for hash: ${item.imageRef}`);
        }
        bytes = await image.getBytesAsync();
        mimeType = "application/octet-stream";
      } else {
        const node = await figma.getNodeByIdAsync(item.nodeId);
        if (!node) {
          throw new Error(`Node not found with ID: ${item.nodeId}`);
        }
        if (!("exportAsync" in node)) {
          throw new Error(`Node does not support exporting: ${item.nodeId}`);
        }
        const format = (item.format || "PNG").toUpperCase();
        const settings = { format: format };
        if (format === "PNG" || format === "JPG") {
          settings.constraint = { type: "SCALE", value: item.scale || 1 };
        }
        if (format === "SVG") {
          settings.svgOutlineText = true;
          settings.svgIdAttribute = false;
        }
        bytes = await node.exportAsync(settings);
        mimeType = mimeTypes[format] || "application/octet-stream";
      }
      results.push({
        nodeId: item.nodeId,
        imageRef: item.imageRef,
        success: true,
        mimeType: mimeType,
        data: customBase64Encode(bytes),
      });
    } catch (error) {
      results.push({
        nodeId: item.nodeId,
        imageRef: item.imageRef,
        success: false,
        error: error.message,
      });
    }
  }
  return { results: results };
}

async function createVariableCollection(params) {
  const { name, modes } = params || {};

  if (!name) {
    throw new Error("Missing name parameter");
  }

  const collection = figma.variables.createVariableCollection(String(name));
  const warnings = [];

  if (Array.isArray(modes) && modes.length > 0) {
    collection.renameMode(collection.modes[0].modeId, String(modes[0]));
    for (let i = 1; i < modes.length; i++) {
      try {
        collection.addMode(String(modes[i]));
      } catch (error) {
        warnings.push(
          `Could not add mode "${modes[i]}": ${error.message} (the current Figma plan may limit the number of modes per collection)`,
        );
      }
    }
  }

  return {
    id: collection.id,
    name: collection.name,
    defaultModeId: collection.defaultModeId,
    modes: collection.modes.map((mode) => ({
      modeId: mode.modeId,
      name: mode.name,
    })),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// Convert a tool value into a Figma VariableValue for the given variable
async function toVariableValue(variable, value) {
  if (value && typeof value === "object" && "aliasOf" in value) {
    const target = await figma.variables.getVariableByIdAsync(value.aliasOf);
    if (!target) {
      throw new Error(
        `Alias target variable not found with ID: ${value.aliasOf}`,
      );
    }
    return figma.variables.createVariableAlias(target);
  }

  switch (variable.resolvedType) {
    case "COLOR":
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.r !== "number" ||
        typeof value.g !== "number" ||
        typeof value.b !== "number"
      ) {
        throw new Error(
          "COLOR value must be an object {r, g, b, a?} with components 0-1",
        );
      }
      return {
        r: value.r,
        g: value.g,
        b: value.b,
        a: typeof value.a === "number" ? value.a : 1,
      };
    case "FLOAT":
      if (typeof value !== "number") {
        throw new Error("FLOAT value must be a number");
      }
      return value;
    case "STRING":
      if (typeof value !== "string") {
        throw new Error("STRING value must be a string");
      }
      return value;
    case "BOOLEAN":
      if (typeof value !== "boolean") {
        throw new Error("BOOLEAN value must be a boolean");
      }
      return value;
    default:
      throw new Error(`Unsupported variable type: ${variable.resolvedType}`);
  }
}

async function resolveModeId(variable, modeId) {
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId,
  );
  if (!collection) {
    throw new Error(
      `Variable collection not found with ID: ${variable.variableCollectionId}`,
    );
  }
  if (!modeId) {
    return collection.defaultModeId;
  }
  const exists = collection.modes.some((mode) => mode.modeId === modeId);
  if (!exists) {
    throw new Error(
      `Mode ${modeId} not found in collection "${collection.name}". Available: ${collection.modes
        .map((mode) => `${mode.name} (${mode.modeId})`)
        .join(", ")}`,
    );
  }
  return modeId;
}

async function createVariable(params) {
  const { collectionId, name, resolvedType, value, modeId, scopes } =
    params || {};

  if (!collectionId) {
    throw new Error("Missing collectionId parameter");
  }
  if (!name) {
    throw new Error("Missing name parameter");
  }
  if (["COLOR", "FLOAT", "STRING", "BOOLEAN"].indexOf(resolvedType) === -1) {
    throw new Error(
      `Invalid resolvedType: ${resolvedType}. Must be COLOR, FLOAT, STRING or BOOLEAN`,
    );
  }

  const collection =
    await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    throw new Error(`Variable collection not found with ID: ${collectionId}`);
  }

  let variable;
  try {
    variable = figma.variables.createVariable(
      String(name),
      collection,
      resolvedType,
    );
  } catch (error) {
    throw new Error(`Cannot create variable "${name}": ${error.message}`);
  }

  try {
    if (Array.isArray(scopes)) {
      variable.scopes = scopes;
    }

    let targetModeId;
    if (value !== undefined && value !== null) {
      targetModeId = await resolveModeId(variable, modeId);
      variable.setValueForMode(
        targetModeId,
        await toVariableValue(variable, value),
      );
    }

    return {
      id: variable.id,
      name: variable.name,
      key: variable.key,
      resolvedType: variable.resolvedType,
      collectionId: variable.variableCollectionId,
      scopes: variable.scopes,
      modeId: targetModeId,
      value: targetModeId
        ? formatVariableValue(variable.valuesByMode[targetModeId])
        : undefined,
    };
  } catch (error) {
    // Do not leave a half-configured variable behind
    let rollbackNote = "";
    try {
      variable.remove();
    } catch (removeError) {
      rollbackNote = ` (rollback failed, variable ${variable.id} may remain: ${removeError.message})`;
    }
    throw new Error(
      `Variable "${name}" was not created: ${error.message}${rollbackNote}`,
    );
  }
}

async function setVariableValue(params) {
  const { variableId, value, modeId } = params || {};

  if (!variableId) {
    throw new Error("Missing variableId parameter");
  }
  if (value === undefined || value === null) {
    throw new Error("Missing value parameter");
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found with ID: ${variableId}`);
  }

  const targetModeId = await resolveModeId(variable, modeId);
  variable.setValueForMode(
    targetModeId,
    await toVariableValue(variable, value),
  );

  return {
    id: variable.id,
    name: variable.name,
    modeId: targetModeId,
    value: formatVariableValue(variable.valuesByMode[targetModeId]),
  };
}

async function deleteVariable(params) {
  const { variableId } = params || {};

  if (!variableId) {
    throw new Error("Missing variableId parameter");
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found with ID: ${variableId}`);
  }
  if (variable.remote) {
    throw new Error(
      `Variable ${variableId} is from a library and cannot be deleted from this file`,
    );
  }

  const deleted = {
    id: variable.id,
    name: variable.name,
    collectionId: variable.variableCollectionId,
  };

  try {
    variable.remove();
  } catch (error) {
    throw new Error(
      `Cannot delete variable "${variable.name}": ${error.message}`,
    );
  }

  return Object.assign({ deleted: true }, deleted);
}

async function deleteVariableCollection(params) {
  const { collectionId } = params || {};

  if (!collectionId) {
    throw new Error("Missing collectionId parameter");
  }

  const collection =
    await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    throw new Error(`Variable collection not found with ID: ${collectionId}`);
  }
  if (collection.remote) {
    throw new Error(
      `Variable collection ${collectionId} is from a library and cannot be deleted from this file`,
    );
  }

  const deleted = {
    id: collection.id,
    name: collection.name,
    deletedVariableCount: collection.variableIds.length,
  };

  try {
    collection.remove();
  } catch (error) {
    throw new Error(
      `Cannot delete variable collection "${collection.name}": ${error.message}`,
    );
  }

  return Object.assign({ deleted: true }, deleted);
}

const BINDABLE_NODE_FIELDS = [
  "width",
  "height",
  "itemSpacing",
  "counterAxisSpacing",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
  "strokeWeight",
  "opacity",
  "characters",
  "visible",
];

const BINDABLE_FIELD_SHORTCUTS = {
  padding: ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"],
  cornerRadius: [
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
  ],
};

async function bindVariable(params) {
  const { nodeId, field, variableId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!field) {
    throw new Error("Missing field parameter");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  let variable = null;
  if (variableId) {
    variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      throw new Error(`Variable not found with ID: ${variableId}`);
    }
  }

  if (field === "fills" || field === "strokes") {
    if (!(field in node)) {
      throw new Error(
        `Node ${nodeId} (${node.type}) does not support ${field}`,
      );
    }
    if (variable && variable.resolvedType !== "COLOR") {
      throw new Error(
        `Variable ${variable.name} is ${variable.resolvedType}; ${field} requires a COLOR variable`,
      );
    }
    if (node[field] === figma.mixed) {
      throw new Error(
        `Node ${nodeId} has mixed ${field}; cannot bind a variable`,
      );
    }

    const paints = node[field].slice();
    if (paints.length === 0) {
      if (!variable) {
        return {
          id: node.id,
          name: node.name,
          field: field,
          boundFields: [],
          variableId: null,
        };
      }
      paints.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
    }
    if (paints[0].type !== "SOLID") {
      throw new Error(
        `First ${field} paint of node ${nodeId} is ${paints[0].type}; only SOLID paints can be bound`,
      );
    }

    paints[0] = figma.variables.setBoundVariableForPaint(
      paints[0],
      "color",
      variable,
    );
    node[field] = paints;

    return {
      id: node.id,
      name: node.name,
      field: field,
      boundFields: [field],
      variableId: variable ? variable.id : null,
    };
  }

  const fields = BINDABLE_FIELD_SHORTCUTS[field] || [field];
  for (const f of fields) {
    if (BINDABLE_NODE_FIELDS.indexOf(f) === -1) {
      throw new Error(`Unsupported field: ${f}`);
    }
    if (!(f in node) || typeof node.setBoundVariable !== "function") {
      throw new Error(
        `Node ${nodeId} (${node.type}) does not support binding ${f}`,
      );
    }
  }

  if (node.type === "TEXT" && fields.indexOf("characters") !== -1) {
    await loadTextNodeFonts(node);
  }

  const boundFields = [];
  const failedFields = [];
  for (const f of fields) {
    try {
      node.setBoundVariable(f, variable);
      boundFields.push(f);
    } catch (error) {
      failedFields.push({ field: f, error: error.message });
    }
  }

  if (failedFields.length > 0) {
    const failedSummary = failedFields
      .map((item) => `${item.field} (${item.error})`)
      .join(", ");
    throw new Error(
      `Cannot bind ${field} on node ${nodeId}. Failed: ${failedSummary}. Succeeded: ${
        boundFields.length > 0 ? boundFields.join(", ") : "none"
      }`,
    );
  }

  return {
    id: node.id,
    name: node.name,
    field: field,
    boundFields: boundFields,
    variableId: variable ? variable.id : null,
  };
}

// ---------------------------------------------------------------------------
// Prototyping (interactions, flows, overlays, scrolling)
// ---------------------------------------------------------------------------

const NODE_NAVIGATIONS = [
  "NAVIGATE",
  "OVERLAY",
  "SWAP",
  "SCROLL_TO",
  "CHANGE_TO",
];
const DIRECTIONAL_TRANSITIONS = [
  "MOVE_IN",
  "MOVE_OUT",
  "PUSH",
  "SLIDE_IN",
  "SLIDE_OUT",
];
const SIMPLE_TRANSITIONS = ["DISSOLVE", "SMART_ANIMATE"];
const INTERACTION_TRIGGERS = [
  "ON_CLICK",
  "ON_HOVER",
  "ON_PRESS",
  "ON_DRAG",
  "AFTER_TIMEOUT",
  "MOUSE_ENTER",
  "MOUSE_LEAVE",
];
const INTERACTION_EASINGS = [
  "LINEAR",
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_AND_OUT",
  "GENTLE",
  "QUICK",
  "BOUNCY",
  "SLOW",
];

function getPageOf(node) {
  let current = node;
  while (current && current.type !== "PAGE") {
    current = current.parent;
  }
  return current;
}

// Returns the ancestor (or the node itself) placed directly on the page
function getTopLevelNode(node) {
  let current = node;
  while (current && current.parent && current.parent.type !== "PAGE") {
    current = current.parent;
  }
  return current && current.parent ? current : null;
}

// Returns the variant (COMPONENT inside a COMPONENT_SET) containing the node
function getContainingVariant(node) {
  let current = node;
  while (current) {
    if (
      current.type === "COMPONENT" &&
      current.parent &&
      current.parent.type === "COMPONENT_SET"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

// With "dynamic-page" document access, pages other than the current one
// must be loaded before their properties are read or written
async function ensurePageLoaded(page) {
  if (page.id !== figma.currentPage.id) {
    await page.loadAsync();
  }
}

async function getReactionNode(nodeId) {
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (!("reactions" in node) || typeof node.setReactionsAsync !== "function") {
    throw new Error(
      `Node ${nodeId} (${node.type}) does not support prototype interactions`,
    );
  }
  return node;
}

function buildTrigger(trigger, timeout) {
  if (INTERACTION_TRIGGERS.indexOf(trigger) === -1) {
    throw new Error(
      `Invalid trigger: ${trigger}. Must be one of ${INTERACTION_TRIGGERS.join(", ")}`,
    );
  }
  if (trigger === "AFTER_TIMEOUT") {
    if (typeof timeout !== "number" || timeout <= 0) {
      throw new Error(
        "AFTER_TIMEOUT trigger requires a positive timeout (seconds)",
      );
    }
    // Figma stores trigger timeouts in milliseconds
    return { type: "AFTER_TIMEOUT", timeout: Math.round(timeout * 1000) };
  }
  if (timeout !== undefined && timeout !== null) {
    throw new Error(
      `timeout is only valid for the AFTER_TIMEOUT trigger (got ${trigger})`,
    );
  }
  if (trigger === "MOUSE_ENTER" || trigger === "MOUSE_LEAVE") {
    return { type: trigger, delay: 0, deprecatedVersion: false };
  }
  return { type: trigger };
}

function buildTransition(transition) {
  if (!transition || transition.type === "INSTANT") {
    return null;
  }

  const { type, direction, duration = 0.3, easing = "EASE_OUT" } = transition;
  if (INTERACTION_EASINGS.indexOf(easing) === -1) {
    throw new Error(
      `Invalid easing: ${easing}. Must be one of ${INTERACTION_EASINGS.join(", ")}`,
    );
  }
  if (typeof duration !== "number" || duration <= 0) {
    throw new Error("Transition duration must be a positive number of seconds");
  }

  if (DIRECTIONAL_TRANSITIONS.indexOf(type) !== -1) {
    if (["LEFT", "RIGHT", "TOP", "BOTTOM"].indexOf(direction) === -1) {
      throw new Error(
        `${type} transition requires a direction: LEFT, RIGHT, TOP or BOTTOM`,
      );
    }
    return {
      type: type,
      direction: direction,
      matchLayers: false,
      easing: { type: easing },
      duration: duration,
    };
  }

  if (SIMPLE_TRANSITIONS.indexOf(type) !== -1) {
    if (direction) {
      throw new Error(`${type} transition does not take a direction`);
    }
    return { type: type, easing: { type: easing }, duration: duration };
  }

  throw new Error(`Invalid transition type: ${type}`);
}

async function validateDestination(node, action, destinationId) {
  if (!destinationId) {
    throw new Error(`${action} action requires destinationId`);
  }
  const destination = await figma.getNodeByIdAsync(destinationId);
  if (!destination) {
    throw new Error(`Destination node not found with ID: ${destinationId}`);
  }
  if (destination.id === node.id) {
    throw new Error("Destination cannot be the node itself");
  }

  const nodePage = getPageOf(node);
  const destinationPage = getPageOf(destination);
  if (!nodePage || !destinationPage || nodePage.id !== destinationPage.id) {
    throw new Error("Destination must be on the same page as the node");
  }

  if (action === "NAVIGATE" || action === "SWAP" || action === "OVERLAY") {
    if (
      !destination.parent ||
      destination.parent.type !== "PAGE" ||
      destination.type === "SECTION"
    ) {
      throw new Error(
        `${action} destination must be a top-level frame on the page (got ${destination.type} "${destination.name}" inside ${destination.parent ? destination.parent.type : "nothing"})`,
      );
    }
  } else if (action === "SCROLL_TO") {
    const nodeTop = getTopLevelNode(node);
    const destinationTop = getTopLevelNode(destination);
    if (
      !nodeTop ||
      !destinationTop ||
      nodeTop.id !== destinationTop.id ||
      destinationTop.id === destination.id
    ) {
      throw new Error(
        "SCROLL_TO destination must be a node inside the same top-level frame as the source node",
      );
    }
  } else if (action === "CHANGE_TO") {
    if (
      destination.type !== "COMPONENT" ||
      !destination.parent ||
      destination.parent.type !== "COMPONENT_SET"
    ) {
      throw new Error(
        `CHANGE_TO destination must be a variant inside a component set (got ${destination.type})`,
      );
    }
    const sourceVariant = getContainingVariant(node);
    if (sourceVariant) {
      if (sourceVariant.parent.id !== destination.parent.id) {
        throw new Error(
          "CHANGE_TO destination must be a variant of the same component set as the source",
        );
      }
    } else if (node.type !== "INSTANCE") {
      throw new Error(
        "CHANGE_TO can only be added to an instance or to a node inside a variant",
      );
    }
  }

  return destination;
}

async function addInteraction(params) {
  const {
    nodeId,
    trigger = "ON_CLICK",
    timeout,
    action = "NAVIGATE",
    destinationId,
    url,
    openInNewTab,
    transition,
    preserveScrollPosition,
    replace = false,
  } = params || {};

  const node = await getReactionNode(nodeId);
  const reactionTrigger = buildTrigger(trigger, timeout);

  /** @type {any} */
  let reactionAction;
  if (NODE_NAVIGATIONS.indexOf(action) !== -1) {
    await validateDestination(node, action, destinationId);
    reactionAction = {
      type: "NODE",
      destinationId: destinationId,
      navigation: action,
      transition: buildTransition(transition),
    };
    if (
      preserveScrollPosition !== undefined &&
      preserveScrollPosition !== null
    ) {
      reactionAction.resetScrollPosition = !preserveScrollPosition;
    }
  } else if (action === "URL") {
    if (!url) {
      throw new Error("URL action requires url");
    }
    reactionAction = {
      type: "URL",
      url: String(url),
      openInNewTab: openInNewTab !== false,
    };
  } else if (action === "BACK" || action === "CLOSE") {
    if (destinationId || url) {
      throw new Error(`${action} action does not take destinationId or url`);
    }
    reactionAction = { type: action };
  } else {
    throw new Error(`Invalid action: ${action}`);
  }

  if (
    reactionAction.type !== "NODE" &&
    (transition || preserveScrollPosition !== undefined)
  ) {
    throw new Error(
      `transition and preserveScrollPosition are only valid for node actions (got ${action})`,
    );
  }

  /** @type {any} */
  const reaction = { trigger: reactionTrigger, actions: [reactionAction] };
  const reactions = replace ? [reaction] : node.reactions.concat([reaction]);

  try {
    await node.setReactionsAsync(reactions);
  } catch (error) {
    throw new Error(`Cannot set reactions on node ${nodeId}: ${error.message}`);
  }

  return {
    id: node.id,
    name: node.name,
    reaction: reaction,
    reactionCount: node.reactions.length,
  };
}

async function setReactions(params) {
  const { nodeId, reactions } = params || {};

  if (!Array.isArray(reactions)) {
    throw new Error("reactions must be an array of Reaction objects");
  }

  const node = await getReactionNode(nodeId);
  try {
    await node.setReactionsAsync(reactions);
  } catch (error) {
    throw new Error(`Cannot set reactions on node ${nodeId}: ${error.message}`);
  }

  return {
    id: node.id,
    name: node.name,
    reactionCount: node.reactions.length,
    reactions: node.reactions,
  };
}

async function removeInteractions(params) {
  const { nodeId, triggerType } = params || {};

  if (triggerType && INTERACTION_TRIGGERS.indexOf(triggerType) === -1) {
    throw new Error(
      `Invalid triggerType: ${triggerType}. Must be one of ${INTERACTION_TRIGGERS.join(", ")}`,
    );
  }

  const node = await getReactionNode(nodeId);
  const before = node.reactions.length;
  const remaining = triggerType
    ? node.reactions.filter(
        (reaction) =>
          !reaction.trigger || reaction.trigger.type !== triggerType,
      )
    : [];

  try {
    await node.setReactionsAsync(remaining);
  } catch (error) {
    throw new Error(
      `Cannot remove reactions on node ${nodeId}: ${error.message}`,
    );
  }

  return {
    id: node.id,
    name: node.name,
    removed: before - node.reactions.length,
    remaining: node.reactions.length,
  };
}

async function getFlowStartingPoints() {
  const page = figma.currentPage;
  const flows = [];
  for (const flow of page.flowStartingPoints) {
    const node = await figma.getNodeByIdAsync(flow.nodeId);
    flows.push({
      nodeId: flow.nodeId,
      name: flow.name,
      nodeName: node ? node.name : null,
    });
  }

  return {
    pageId: page.id,
    pageName: page.name,
    flows: flows,
  };
}

async function setFlowStartingPoint(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!name) {
    throw new Error("Missing name parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  // Frames directly on the page or inside (nested) sections are valid flow
  // starting points, same as in Figma's UI.
  let page = node.parent;
  while (page && page.type === "SECTION") {
    page = page.parent;
  }
  if (!page || page.type !== "PAGE") {
    throw new Error(
      `Flow starting point must be a top-level frame on a page or inside a section (node ${nodeId} is inside ${node.parent ? node.parent.type : "nothing"})`,
    );
  }

  await ensurePageLoaded(page);
  const existing = page.flowStartingPoints.some(
    (flow) => flow.nodeId === node.id,
  );
  const flows = existing
    ? page.flowStartingPoints.map((flow) =>
        flow.nodeId === node.id
          ? { nodeId: flow.nodeId, name: String(name) }
          : flow,
      )
    : page.flowStartingPoints.concat([{ nodeId: node.id, name: String(name) }]);

  page.flowStartingPoints = flows;

  return {
    pageId: page.id,
    nodeId: node.id,
    name: String(name),
    updated: existing,
    flowCount: page.flowStartingPoints.length,
  };
}

async function removeFlowStartingPoint(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const page = getPageOf(node);
  if (!page) {
    throw new Error(`Node ${nodeId} is not on a page`);
  }
  await ensurePageLoaded(page);

  const before = page.flowStartingPoints.length;
  page.flowStartingPoints = page.flowStartingPoints.filter(
    (flow) => flow.nodeId !== node.id,
  );
  if (page.flowStartingPoints.length === before) {
    throw new Error(`Node ${nodeId} is not a flow starting point`);
  }

  return {
    pageId: page.id,
    nodeId: node.id,
    removed: true,
    flowCount: page.flowStartingPoints.length,
  };
}

async function setOverlaySettings(params) {
  const { nodeId, position, background, closeOnClickOutside } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (!("overlayPositionType" in node)) {
    throw new Error(`Node ${nodeId} (${node.type}) has no overlay settings`);
  }

  const current = {
    position: node.overlayPositionType,
    background:
      node.overlayBackground.type === "SOLID_COLOR"
        ? { color: rgbaToHex(node.overlayBackground.color) }
        : "NONE",
    closeOnClickOutside:
      node.overlayBackgroundInteraction === "CLOSE_ON_CLICK_OUTSIDE",
  };

  const requested = [];
  if (position !== undefined) requested.push("position");
  if (background !== undefined) requested.push("background");
  if (closeOnClickOutside !== undefined) requested.push("closeOnClickOutside");

  // overlayPositionType, overlayBackground and overlayBackgroundInteraction
  // are read-only in the Plugin API
  if (requested.length > 0) {
    throw new Error(
      `Overlay settings are read-only in the Figma Plugin API; cannot change ${requested.join(", ")}. ` +
        `Set them in Figma's Prototype panel. Current settings of "${node.name}": ${JSON.stringify(current)}`,
    );
  }

  return {
    id: node.id,
    name: node.name,
    readOnly: true,
    current: current,
  };
}

async function setScrollBehavior(params) {
  const { nodeId, overflowDirection, scrollBehavior } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (overflowDirection === undefined && scrollBehavior === undefined) {
    throw new Error("Provide overflowDirection and/or scrollBehavior");
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (scrollBehavior === "STICKY_SCROLLS") {
    throw new Error(
      "STICKY_SCROLLS is not supported by the Figma Plugin API; set it in Figma's Prototype panel",
    );
  }
  if (
    scrollBehavior !== undefined &&
    ["SCROLLS", "FIXED"].indexOf(scrollBehavior) === -1
  ) {
    throw new Error(`Invalid scrollBehavior: ${scrollBehavior}`);
  }
  if (overflowDirection !== undefined) {
    if (
      ["NONE", "HORIZONTAL", "VERTICAL", "BOTH"].indexOf(overflowDirection) ===
      -1
    ) {
      throw new Error(`Invalid overflowDirection: ${overflowDirection}`);
    }
    if (!("overflowDirection" in node)) {
      throw new Error(
        `Node ${nodeId} (${node.type}) does not support overflowDirection`,
      );
    }
  }

  let parent = null;
  if (scrollBehavior !== undefined) {
    parent = node.parent;
    if (!parent || !("numberOfFixedChildren" in parent)) {
      throw new Error(
        `scrollBehavior requires the node to be inside a frame (parent is ${parent ? parent.type : "nothing"})`,
      );
    }
  }

  if (overflowDirection !== undefined) {
    node.overflowDirection = overflowDirection;
  }

  if (parent) {
    // Fixed children are the last numberOfFixedChildren children of the frame
    const fixedCount = parent.numberOfFixedChildren;
    const fixedStart = parent.children.length - fixedCount;
    const index = parent.children.indexOf(node);
    const isFixed = index >= fixedStart;

    if (scrollBehavior === "FIXED" && !isFixed) {
      parent.appendChild(node);
      parent.numberOfFixedChildren = fixedCount + 1;
    } else if (scrollBehavior === "SCROLLS" && isFixed) {
      parent.insertChild(fixedStart, node);
      parent.numberOfFixedChildren = fixedCount - 1;
    }
  }

  return {
    id: node.id,
    name: node.name,
    overflowDirection:
      "overflowDirection" in node ? node.overflowDirection : undefined,
    scrollBehavior: parent
      ? parent.children.indexOf(node) >=
        parent.children.length - parent.numberOfFixedChildren
        ? "FIXED"
        : "SCROLLS"
      : undefined,
  };
}

async function setFrameProperties(params) {
  const { nodeId, layoutPositioning, itemReverseZIndex, clipsContent, x, y } =
    params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (
    layoutPositioning === undefined &&
    itemReverseZIndex === undefined &&
    clipsContent === undefined &&
    x === undefined &&
    y === undefined
  ) {
    throw new Error(
      "Provide layoutPositioning, itemReverseZIndex, clipsContent, x and/or y",
    );
  }

  /** @type {any} */
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (layoutPositioning !== undefined) {
    if (["AUTO", "ABSOLUTE"].indexOf(layoutPositioning) === -1) {
      throw new Error(`Invalid layoutPositioning: ${layoutPositioning}`);
    }
    const parent = node.parent;
    if (
      !("layoutPositioning" in node) ||
      !parent ||
      !("layoutMode" in parent) ||
      parent.layoutMode === "NONE"
    ) {
      throw new Error(
        `layoutPositioning requires the node to be inside an auto-layout frame`,
      );
    }
    node.layoutPositioning = layoutPositioning;
  }

  if (itemReverseZIndex !== undefined) {
    if (!("itemReverseZIndex" in node) || node.layoutMode === "NONE") {
      throw new Error(
        `Node ${nodeId} (${node.type}) is not an auto-layout frame; itemReverseZIndex needs auto-layout`,
      );
    }
    node.itemReverseZIndex = Boolean(itemReverseZIndex);
  }

  if (clipsContent !== undefined) {
    if (!("clipsContent" in node)) {
      throw new Error(
        `Node ${nodeId} (${node.type}) does not support clipsContent`,
      );
    }
    node.clipsContent = Boolean(clipsContent);
  }

  // Applied last so an ABSOLUTE child can be positioned in the same call
  if (x !== undefined) node.x = x;
  if (y !== undefined) node.y = y;

  return {
    id: node.id,
    name: node.name,
    layoutPositioning:
      "layoutPositioning" in node ? node.layoutPositioning : undefined,
    itemReverseZIndex:
      "itemReverseZIndex" in node ? node.itemReverseZIndex : undefined,
    clipsContent: "clipsContent" in node ? node.clipsContent : undefined,
    x: node.x,
    y: node.y,
  };
}

// ---------------------------------------------------------------------------
// Variable metadata & modes, team library, component properties, paints
// ---------------------------------------------------------------------------

async function requireVariable(variableId) {
  if (!variableId) {
    throw new Error("Missing variableId parameter");
  }
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found with ID: ${variableId}`);
  }
  return variable;
}

async function requireVariableCollection(collectionId) {
  if (!collectionId) {
    throw new Error("Missing collectionId parameter");
  }
  const collection =
    await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    throw new Error(`Variable collection not found with ID: ${collectionId}`);
  }
  return collection;
}

function requireModeId(collection, modeId) {
  if (!modeId) {
    throw new Error("Missing modeId parameter");
  }
  const exists = collection.modes.some((mode) => mode.modeId === modeId);
  if (!exists) {
    throw new Error(
      `Mode ${modeId} not found in collection "${collection.name}". Available: ${collection.modes
        .map((mode) => `${mode.name} (${mode.modeId})`)
        .join(", ")}`,
    );
  }
  return modeId;
}

function serializeVariableCollectionMeta(collection) {
  return {
    id: collection.id,
    name: collection.name,
    hiddenFromPublishing: collection.hiddenFromPublishing,
    defaultModeId: collection.defaultModeId,
    modes: collection.modes.map((mode) => ({
      modeId: mode.modeId,
      name: mode.name,
    })),
  };
}

async function updateVariable(params) {
  const p = params || {};
  const variable = await requireVariable(p.variableId);

  if (p.name !== undefined) variable.name = String(p.name);
  if (p.description !== undefined) variable.description = String(p.description);
  if (p.scopes !== undefined) {
    if (!Array.isArray(p.scopes)) {
      throw new Error("scopes must be an array of VariableScope values");
    }
    variable.scopes = p.scopes;
  }
  if (p.hiddenFromPublishing !== undefined) {
    variable.hiddenFromPublishing = Boolean(p.hiddenFromPublishing);
  }
  if (p.codeSyntax) {
    /** @type {CodeSyntaxPlatform[]} */
    const platforms = ["WEB", "ANDROID", "iOS"];
    for (const platform of platforms) {
      const value = p.codeSyntax[platform];
      if (value === undefined) continue;
      if (value === "") {
        variable.removeVariableCodeSyntax(platform);
      } else {
        variable.setVariableCodeSyntax(platform, String(value));
      }
    }
  }

  return {
    id: variable.id,
    name: variable.name,
    description: variable.description,
    resolvedType: variable.resolvedType,
    variableCollectionId: variable.variableCollectionId,
    scopes: variable.scopes,
    hiddenFromPublishing: variable.hiddenFromPublishing,
    codeSyntax: variable.codeSyntax,
  };
}

async function updateVariableCollection(params) {
  const p = params || {};
  const collection = await requireVariableCollection(p.collectionId);
  if (p.name !== undefined) collection.name = String(p.name);
  if (p.hiddenFromPublishing !== undefined) {
    collection.hiddenFromPublishing = Boolean(p.hiddenFromPublishing);
  }
  return serializeVariableCollectionMeta(collection);
}

async function manageVariableModes(params) {
  const p = params || {};
  const collection = await requireVariableCollection(p.collectionId);
  let modeId = p.modeId;

  switch (p.action) {
    case "add":
      if (!p.name) throw new Error("Missing name parameter for action add");
      modeId = collection.addMode(String(p.name));
      break;
    case "rename":
      if (!p.name) throw new Error("Missing name parameter for action rename");
      requireModeId(collection, modeId);
      collection.renameMode(modeId, String(p.name));
      break;
    case "remove":
      requireModeId(collection, modeId);
      if (collection.modes.length <= 1) {
        throw new Error("Cannot remove the only mode of a collection");
      }
      collection.removeMode(modeId);
      break;
    default:
      throw new Error('action must be "add", "rename" or "remove"');
  }

  const result = serializeVariableCollectionMeta(collection);
  return Object.assign(
    { collectionId: collection.id, action: p.action, modeId: modeId },
    result,
  );
}

async function setVariableMode(params) {
  const p = params || {};
  const node = await requireNode(p.nodeId);
  if (!("setExplicitVariableModeForCollection" in node)) {
    throw new Error(
      `Node type ${node.type} does not support explicit variable modes`,
    );
  }
  const collection = await requireVariableCollection(p.collectionId);
  if (p.clear) {
    node.clearExplicitVariableModeForCollection(collection);
  } else {
    requireModeId(collection, p.modeId);
    node.setExplicitVariableModeForCollection(collection, p.modeId);
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    explicitVariableModes: node.explicitVariableModes,
  };
}

function requireKey(key) {
  if (!key || typeof key !== "string") {
    throw new Error("Missing key parameter");
  }
  return key;
}

async function importStyleByKey(params) {
  const style = await figma.importStyleByKeyAsync(
    requireKey((params || {}).key),
  );
  return { id: style.id, key: style.key, name: style.name, type: style.type };
}

async function importVariableByKey(params) {
  const variable = await figma.variables.importVariableByKeyAsync(
    requireKey((params || {}).key),
  );
  return {
    id: variable.id,
    key: variable.key,
    name: variable.name,
    resolvedType: variable.resolvedType,
    variableCollectionId: variable.variableCollectionId,
  };
}

const TEAM_LIBRARY_UNAVAILABLE =
  "teamLibrary not available — enable team library permission and re-run the plugin";

function requireTeamLibrary() {
  let api;
  try {
    api = figma.teamLibrary;
  } catch (error) {
    api = undefined;
  }
  if (!api) {
    throw new Error(TEAM_LIBRARY_UNAVAILABLE);
  }
  return api;
}

async function getLibraryVariableCollections() {
  const collections =
    await requireTeamLibrary().getAvailableLibraryVariableCollectionsAsync();
  return collections.map((collection) => ({
    key: collection.key,
    name: collection.name,
    libraryName: collection.libraryName,
  }));
}

async function getLibraryVariables(params) {
  const p = params || {};
  if (!p.libraryCollectionKey) {
    throw new Error("Missing libraryCollectionKey parameter");
  }
  const teamLibrary = requireTeamLibrary();
  const collectionKey = String(p.libraryCollectionKey);
  const variables =
    await teamLibrary.getVariablesInLibraryCollectionAsync(collectionKey);
  if (variables.length === 0) {
    // Empty result is ambiguous: distinguish an unknown key from an empty collection.
    const collections =
      await teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    const exists = collections.some(
      (collection) => collection.key === collectionKey,
    );
    if (!exists) {
      throw new Error(
        `Library variable collection not found: ${collectionKey}. Use get_library_variable_collections to list available keys`,
      );
    }
  }
  return variables.map((variable) => ({
    key: variable.key,
    name: variable.name,
    resolvedType: variable.resolvedType,
  }));
}

async function requireComponentWithProperty(nodeId, propertyName) {
  const node = await requireNode(nodeId);
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(
      `Node ${node.id} is ${node.type}, expected COMPONENT or COMPONENT_SET`,
    );
  }
  if (!propertyName) {
    throw new Error("Missing propertyName parameter");
  }
  const definitions = node.componentPropertyDefinitions;
  if (!(propertyName in definitions)) {
    throw new Error(
      `Component property "${propertyName}" not found. Available: ${Object.keys(
        definitions,
      ).join(", ")}`,
    );
  }
  return node;
}

async function editComponentProperty(params) {
  const p = params || {};
  const node = await requireComponentWithProperty(p.nodeId, p.propertyName);
  const newValues = p.newValues || {};
  const update = {};
  if (newValues.name !== undefined) update.name = String(newValues.name);
  if (newValues.defaultValue !== undefined) {
    update.defaultValue = newValues.defaultValue;
  }
  if (newValues.preferredValues !== undefined) {
    update.preferredValues = newValues.preferredValues;
  }
  if (newValues.description !== undefined) {
    update.description = String(newValues.description);
  }
  if (Object.keys(update).length === 0) {
    throw new Error(
      "newValues must include at least one of name, defaultValue, preferredValues, description",
    );
  }
  const propertyName = node.editComponentProperty(p.propertyName, update);
  return {
    id: node.id,
    name: node.name,
    propertyName: propertyName,
    definition: node.componentPropertyDefinitions[propertyName],
  };
}

async function deleteComponentProperty(params) {
  const p = params || {};
  const node = await requireComponentWithProperty(p.nodeId, p.propertyName);
  node.deleteComponentProperty(p.propertyName);
  return {
    id: node.id,
    name: node.name,
    deleted: p.propertyName,
    remainingProperties: Object.keys(node.componentPropertyDefinitions),
  };
}

async function resetInstanceOverrides(params) {
  const p = params || {};
  const ids = Array.isArray(p.nodeIds) ? p.nodeIds : p.nodeId ? [p.nodeId] : [];
  if (ids.length === 0) {
    throw new Error("Provide nodeId or nodeIds");
  }
  const results = [];
  for (const id of ids) {
    try {
      const node = await requireNode(id);
      if (node.type !== "INSTANCE") {
        throw new Error(`Node ${node.id} is ${node.type}, expected INSTANCE`);
      }
      node.resetOverrides();
      results.push({ nodeId: id, success: true, name: node.name });
    } catch (error) {
      results.push({ nodeId: id, success: false, error: error.message });
    }
  }
  const applied = results.filter((result) => result.success).length;
  return { applied: applied, failed: results.length - applied, results };
}

// CROP is left out: it needs an imageTransform, which set_fills doesn't take
const IMAGE_SCALE_MODES = ["FILL", "FIT", "TILE"];

function makePaintFromInput(input, index) {
  if (!input || typeof input !== "object") {
    throw new Error(`paints[${index}] must be an object`);
  }
  /** @type {any} */
  let paint;
  if (input.type === "SOLID") {
    if (!input.color) throw new Error(`paints[${index}].color is required`);
    paint = makeSolidPaint(input.color);
  } else if (input.type === "IMAGE") {
    if (!input.imageHash || !figma.getImageByHash(input.imageHash)) {
      throw new Error(`paints[${index}].imageHash is missing or unknown`);
    }
    const scaleMode = input.scaleMode || "FILL";
    if (IMAGE_SCALE_MODES.indexOf(scaleMode) === -1) {
      throw new Error(
        `paints[${index}].scaleMode must be one of ${IMAGE_SCALE_MODES.join(", ")}`,
      );
    }
    paint = { type: "IMAGE", imageHash: input.imageHash, scaleMode: scaleMode };
  } else {
    paint = makeGradientPaint({
      gradientType: input.type,
      stops: input.stops,
      angle: input.angle,
    });
  }
  if (input.opacity !== undefined) paint.opacity = Number(input.opacity);
  if (input.visible !== undefined) paint.visible = Boolean(input.visible);
  if (input.blendMode !== undefined) paint.blendMode = input.blendMode;
  return paint;
}

async function setFills(params) {
  const p = params || {};
  const target = p.target || "fills";
  if (target !== "fills" && target !== "strokes") {
    throw new Error('target must be "fills" or "strokes"');
  }
  if (!Array.isArray(p.paints)) {
    throw new Error("paints must be an array (use [] to remove all paints)");
  }
  const node = /** @type {any} */ (await requireNode(p.nodeId));
  if (!(target in node)) {
    throw new Error(`Node type ${node.type} does not support ${target}`);
  }
  node[target] = p.paints.map(makePaintFromInput);
  return { id: node.id, name: node.name, type: node.type, [target]: node[target] };
}

// ---------------------------------------------------------------------------
// Fonts, auto-layout children, grid styles, export settings & slices
// ---------------------------------------------------------------------------

async function getAvailableFonts(params) {
  const p = params || {};
  const limit = p.limit === undefined ? 200 : Number(p.limit);
  if (!(Number.isInteger(limit) && limit > 0)) {
    throw new Error("limit must be a positive integer");
  }
  const filter = p.family ? String(p.family).toLowerCase() : "";
  const fonts = await figma.listAvailableFontsAsync();
  const families = new Map();
  for (const font of fonts) {
    const family = font.fontName.family;
    if (filter && family.toLowerCase().indexOf(filter) === -1) continue;
    if (!families.has(family)) families.set(family, []);
    const styles = families.get(family);
    if (styles.indexOf(font.fontName.style) === -1) {
      styles.push(font.fontName.style);
    }
  }
  const names = Array.from(families.keys()).sort();
  const returned = names.slice(0, limit);
  return {
    totalFamilies: names.length,
    returned: returned.length,
    truncated: names.length > returned.length,
    families: returned.map((family) => ({
      family,
      styles: families.get(family),
    })),
  };
}

const LAYOUT_ALIGN_VALUES = ["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"];
const GRID_CHILD_ALIGN_VALUES = ["MIN", "CENTER", "MAX", "AUTO"];

async function setLayoutChild(params) {
  const p = params || {};
  const node = /** @type {any} */ (await requireNode(p.nodeId));
  const parent = node.parent;
  const parentMode =
    parent && "layoutMode" in parent ? parent.layoutMode : "NONE";
  const flexKeys = ["layoutGrow", "layoutAlign"];
  const gridKeys = [
    "gridRow",
    "gridColumn",
    "gridRowSpan",
    "gridColumnSpan",
    "gridChildHorizontalAlign",
    "gridChildVerticalAlign",
  ];
  const given = flexKeys.concat(gridKeys).filter((key) => p[key] !== undefined);
  if (given.length === 0) {
    throw new Error(`Provide at least one of ${flexKeys.concat(gridKeys).join(", ")}`);
  }
  if (!("layoutGrow" in node)) {
    throw new Error(`Node type ${node.type} cannot be an auto-layout child`);
  }

  // Validate before any mutation so a bad value doesn't leave partial edits
  const usesFlex = flexKeys.some((key) => p[key] !== undefined);
  const usesGrid = gridKeys.some((key) => p[key] !== undefined);
  if (usesFlex && parentMode !== "HORIZONTAL" && parentMode !== "VERTICAL") {
    throw new Error(
      "layoutGrow/layoutAlign require a parent with HORIZONTAL or VERTICAL auto-layout",
    );
  }
  if (usesGrid && parentMode !== "GRID") {
    throw new Error("Grid child properties require a parent with layoutMode GRID");
  }
  if (p.layoutGrow !== undefined && !(Number(p.layoutGrow) >= 0)) {
    throw new Error("layoutGrow must be >= 0 (0 = fixed, 1 = fill)");
  }
  if (
    p.layoutAlign !== undefined &&
    LAYOUT_ALIGN_VALUES.indexOf(p.layoutAlign) === -1
  ) {
    throw new Error(`layoutAlign must be one of ${LAYOUT_ALIGN_VALUES.join(", ")}`);
  }
  if ((p.gridRow === undefined) !== (p.gridColumn === undefined)) {
    throw new Error("gridRow and gridColumn must be given together");
  }
  for (const key of ["gridChildHorizontalAlign", "gridChildVerticalAlign"]) {
    if (p[key] !== undefined && GRID_CHILD_ALIGN_VALUES.indexOf(p[key]) === -1) {
      throw new Error(`${key} must be one of ${GRID_CHILD_ALIGN_VALUES.join(", ")}`);
    }
  }

  if (p.layoutGrow !== undefined) node.layoutGrow = Number(p.layoutGrow);
  if (p.layoutAlign !== undefined) node.layoutAlign = p.layoutAlign;
  if (p.gridRow !== undefined) {
    node.setGridChildPosition(Number(p.gridRow), Number(p.gridColumn));
  }
  if (p.gridRowSpan !== undefined) node.gridRowSpan = Number(p.gridRowSpan);
  if (p.gridColumnSpan !== undefined)
    node.gridColumnSpan = Number(p.gridColumnSpan);
  if (p.gridChildHorizontalAlign !== undefined)
    node.gridChildHorizontalAlign = p.gridChildHorizontalAlign;
  if (p.gridChildVerticalAlign !== undefined)
    node.gridChildVerticalAlign = p.gridChildVerticalAlign;

  /** @type {any} */
  const result = {
    id: node.id,
    name: node.name,
    type: node.type,
    parentLayoutMode: parentMode,
  };
  if (parentMode === "GRID") {
    result.gridRowAnchorIndex = node.gridRowAnchorIndex;
    result.gridColumnAnchorIndex = node.gridColumnAnchorIndex;
    result.gridRowSpan = node.gridRowSpan;
    result.gridColumnSpan = node.gridColumnSpan;
    result.gridChildHorizontalAlign = node.gridChildHorizontalAlign;
    result.gridChildVerticalAlign = node.gridChildVerticalAlign;
  } else {
    result.layoutGrow = node.layoutGrow;
    result.layoutAlign = node.layoutAlign;
  }
  return result;
}

function serializeGridStyle(style) {
  return {
    id: style.id,
    key: style.key,
    name: style.name,
    description: style.description,
    layoutGrids: style.layoutGrids,
  };
}

async function createGridStyle(params) {
  const { name, grids, description } = params || {};
  if (!name) {
    throw new Error("Missing name parameter");
  }
  if (!Array.isArray(grids) || !grids.length) {
    throw new Error("grids must be a non-empty array");
  }

  const layoutGrids = /** @type {any} */ (grids.map(makeLayoutGrid));
  const style = figma.createGridStyle();
  try {
    style.name = name;
    style.layoutGrids = layoutGrids;
    if (description !== undefined) style.description = description;
  } catch (error) {
    style.remove();
    throw new Error(`Error creating grid style: ${error.message}`);
  }
  return serializeGridStyle(style);
}

async function updateGridStyle(params) {
  const { styleId, name, grids, description } = params || {};
  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  const style = await figma.getStyleByIdAsync(styleId);
  if (!style || style.type !== "GRID") {
    throw new Error(`Grid style with ID ${styleId} not found`);
  }
  if (grids !== undefined) {
    if (!Array.isArray(grids)) {
      throw new Error("grids must be an array");
    }
    style.layoutGrids = /** @type {any} */ (grids.map(makeLayoutGrid));
  }
  if (name !== undefined) style.name = name;
  if (description !== undefined) style.description = description;
  return serializeGridStyle(style);
}

async function applyGridStyle(params) {
  const { styleId } = params || {};
  const nodeIds =
    (params && params.nodeIds) ||
    (params && params.nodeId ? [params.nodeId] : []);
  if (styleId === undefined) {
    throw new Error("Missing styleId parameter (use '' to detach)");
  }
  if (!nodeIds.length) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }

  let style = null;
  if (styleId) {
    style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== "GRID") {
      throw new Error(`Grid style with ID ${styleId} not found`);
    }
  }

  const results = [];
  for (const nodeId of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("Node not found");
      if (!("gridStyleId" in node))
        throw new Error(`Node type ${node.type} does not support layout grids`);
      await node.setGridStyleIdAsync(style ? style.id : "");
      results.push({ nodeId, success: true });
    } catch (error) {
      results.push({ nodeId, success: false, error: error.message });
    }
  }

  return {
    styleId: style ? style.id : "",
    styleName: style ? style.name : null,
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

const EXPORT_FORMATS = ["PNG", "JPG", "SVG", "PDF"];
const EXPORT_CONSTRAINT_TYPES = ["SCALE", "WIDTH", "HEIGHT"];
const EXPORT_COLOR_PROFILES = ["DOCUMENT", "SRGB", "DISPLAY_P3_V4"];

function makeExportSetting(input, index) {
  if (!input || EXPORT_FORMATS.indexOf(input.format) === -1) {
    throw new Error(
      `settings[${index}].format must be one of ${EXPORT_FORMATS.join(", ")}`,
    );
  }
  /** @type {any} */
  const setting = { format: input.format };
  if (input.suffix !== undefined) setting.suffix = String(input.suffix);
  if (input.contentsOnly !== undefined)
    setting.contentsOnly = Boolean(input.contentsOnly);
  if (input.useAbsoluteBounds !== undefined)
    setting.useAbsoluteBounds = Boolean(input.useAbsoluteBounds);
  if (input.colorProfile !== undefined) {
    if (EXPORT_COLOR_PROFILES.indexOf(input.colorProfile) === -1) {
      throw new Error(
        `settings[${index}].colorProfile must be one of ${EXPORT_COLOR_PROFILES.join(", ")}`,
      );
    }
    setting.colorProfile = input.colorProfile;
  }
  if (input.constraint !== undefined) {
    if (input.format !== "PNG" && input.format !== "JPG") {
      throw new Error(`settings[${index}].constraint is only valid for PNG/JPG`);
    }
    const c = input.constraint;
    if (!c || EXPORT_CONSTRAINT_TYPES.indexOf(c.type) === -1 || !(Number(c.value) > 0)) {
      throw new Error(
        `settings[${index}].constraint must be { type: SCALE | WIDTH | HEIGHT, value > 0 }`,
      );
    }
    setting.constraint = { type: c.type, value: Number(c.value) };
  }
  if (input.format === "SVG") {
    for (const key of ["svgOutlineText", "svgIdAttribute", "svgSimplifyStroke"]) {
      if (input[key] !== undefined) setting[key] = Boolean(input[key]);
    }
  }
  return setting;
}

async function setExportSettings(params) {
  const p = params || {};
  if (!Array.isArray(p.settings)) {
    throw new Error("settings must be an array (use [] to remove all)");
  }
  const node = /** @type {any} */ (await requireNode(p.nodeId));
  if (!("exportSettings" in node)) {
    throw new Error(`Node type ${node.type} does not support export settings`);
  }
  node.exportSettings = p.settings.map(makeExportSetting);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    exportSettings: node.exportSettings,
  };
}

async function createSlice(params) {
  const p = params || {};
  const width = Number(p.width);
  const height = Number(p.height);
  if (!(width > 0) || !(height > 0)) {
    throw new Error("width and height must be > 0");
  }
  const parent = /** @type {any} */ (await resolveNewNodeParent(p.parentId));
  const slice = figma.createSlice();
  try {
    slice.x = Number(p.x) || 0;
    slice.y = Number(p.y) || 0;
    slice.resize(width, height);
    if (p.name) slice.name = p.name;
    parent.appendChild(slice);
  } catch (error) {
    slice.remove();
    throw new Error(`Error creating slice: ${error.message}`);
  }
  return serializeNewShape(slice);
}

// ---------------------------------------------------------------------------
// Versions, image paints, pages, style usage/order, viewport, FigJam blocks,
// extended collections, dev resources, annotation categories & measurements
// ---------------------------------------------------------------------------

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function requireHttpUrl(value, field) {
  const url = String(value === undefined || value === null ? "" : value).trim();
  if (!/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(url)) {
    throw new Error(`${field} must be an http(s) URL`);
  }
  return url;
}

async function saveVersion(params) {
  const p = params || {};
  const title = String(p.title === undefined ? "" : p.title).trim();
  if (!title) {
    throw new Error("title must be a non-empty string");
  }
  const result =
    p.description !== undefined
      ? await figma.saveVersionHistoryAsync(title, String(p.description))
      : await figma.saveVersionHistoryAsync(title);
  return { id: result ? result.id : null, title };
}

async function setImageProperties(params) {
  const p = params || {};
  const node = /** @type {any} */ (await requireNode(p.nodeId));
  if (!("fills" in node) || node.fills === figma.mixed) {
    throw new Error(`Node type ${node.type} does not have editable fills`);
  }
  const fills = node.fills.slice();
  let index;
  if (p.paintIndex !== undefined) {
    index = Number(p.paintIndex);
    if (!Number.isInteger(index) || index < 0 || index >= fills.length) {
      throw new Error(`paintIndex must be between 0 and ${fills.length - 1}`);
    }
    if (fills[index].type !== "IMAGE") {
      throw new Error(`Paint ${index} is ${fills[index].type}, expected IMAGE`);
    }
  } else {
    index = fills.findIndex((paint) => paint.type === "IMAGE");
    if (index === -1) {
      throw new Error(`Node ${node.id} has no IMAGE fill`);
    }
  }
  const current = fills[index];
  const scaleMode = p.scaleMode !== undefined ? p.scaleMode : current.scaleMode;
  if (["FILL", "FIT", "CROP", "TILE"].indexOf(scaleMode) === -1) {
    throw new Error("scaleMode must be one of FILL, FIT, CROP, TILE");
  }
  const options = buildImagePaintOptions(p, scaleMode, current);
  /** @type {any} */
  const paint = { type: "IMAGE", imageHash: current.imageHash, scaleMode: scaleMode };
  for (const key of ["visible", "opacity", "blendMode"]) {
    if (current[key] !== undefined) paint[key] = current[key];
  }
  fills[index] = Object.assign(paint, options);
  node.fills = fills;
  return {
    id: node.id,
    name: node.name,
    paintIndex: index,
    paint: node.fills[index],
  };
}

async function duplicatePage(params) {
  const p = params || {};
  if (!p.pageId) {
    throw new Error("Missing pageId parameter");
  }
  const page = await figma.getNodeByIdAsync(p.pageId);
  if (!page || page.type !== "PAGE") {
    throw new Error(`Page not found with ID: ${p.pageId}`);
  }
  await page.loadAsync();
  const copy = page.clone();
  await copy.loadAsync();
  try {
    if (p.name) copy.name = String(p.name);
  } catch (error) {
    copy.remove();
    throw new Error(`Error duplicating page: ${errorMessage(error)}`);
  }
  return {
    id: copy.id,
    name: copy.name,
    sourcePageId: page.id,
    childCount: copy.children.length,
  };
}

async function requireStyle(styleId) {
  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style) {
    throw new Error(`Style not found with ID: ${styleId}`);
  }
  return style;
}

async function getStyleUsage(params) {
  const p = params || {};
  const limit = p.limit === undefined ? 200 : Number(p.limit);
  if (!(Number.isInteger(limit) && limit > 0 && limit <= 1000)) {
    throw new Error("limit must be an integer between 1 and 1000");
  }
  const style = await requireStyle(p.styleId);
  const consumers = await style.getStyleConsumersAsync();
  return {
    styleId: style.id,
    styleName: style.name,
    styleType: style.type,
    total: consumers.length,
    truncated: consumers.length > limit,
    consumers: consumers.slice(0, limit).map((consumer) => ({
      nodeId: consumer.node.id,
      name: consumer.node.name,
      type: consumer.node.type,
      fields: consumer.fields,
    })),
  };
}

function getViewport() {
  const viewport = figma.viewport;
  return {
    pageId: figma.currentPage.id,
    center: { x: viewport.center.x, y: viewport.center.y },
    zoom: viewport.zoom,
    bounds: viewport.bounds,
  };
}

async function setViewport(params) {
  const p = params || {};
  if (p.center === undefined && p.zoom === undefined) {
    throw new Error("Provide center and/or zoom");
  }
  let center;
  if (p.center !== undefined) {
    const x = Number(p.center && p.center.x);
    const y = Number(p.center && p.center.y);
    if (!isFinite(x) || !isFinite(y)) {
      throw new Error("center must be { x: number, y: number }");
    }
    center = { x, y };
  }
  let zoom;
  if (p.zoom !== undefined) {
    zoom = Number(p.zoom);
    if (!(zoom > 0) || !isFinite(zoom)) {
      throw new Error("zoom must be a number > 0 (1 = 100%)");
    }
  }
  if (zoom !== undefined) figma.viewport.zoom = zoom;
  if (center) figma.viewport.center = center;
  return getViewport();
}

const STYLE_ORDER_API = {
  PAINT: {
    list: "getLocalPaintStylesAsync",
    move: "moveLocalPaintStyleAfter",
    moveFolder: "moveLocalPaintFolderAfter",
  },
  TEXT: {
    list: "getLocalTextStylesAsync",
    move: "moveLocalTextStyleAfter",
    moveFolder: "moveLocalTextFolderAfter",
  },
  EFFECT: {
    list: "getLocalEffectStylesAsync",
    move: "moveLocalEffectStyleAfter",
    moveFolder: "moveLocalEffectFolderAfter",
  },
  GRID: {
    list: "getLocalGridStylesAsync",
    move: "moveLocalGridStyleAfter",
    moveFolder: "moveLocalGridFolderAfter",
  },
  CUSTOM_ANIMATION: {
    list: "getLocalCustomAnimationStylesAsync",
    move: "moveLocalCustomAnimationStyleAfter",
    moveFolder: "moveLocalCustomAnimationFolderAfter",
  },
};

function requireStyleOrderApi(styleType, method) {
  if (figma.editorType !== "figma") {
    throw new Error("Reordering styles is only available in Figma Design");
  }
  const api = STYLE_ORDER_API[styleType];
  const fn = api ? /** @type {any} */ (figma)[api[method]] : undefined;
  if (typeof fn !== "function") {
    throw new Error(`Reordering ${styleType} styles is not supported by this Figma version`);
  }
  return api;
}

async function reorderStyle(params) {
  const p = params || {};
  const style = await requireStyle(p.styleId);
  if (style.remote) {
    throw new Error(`Style ${style.id} is a library style; only local styles can be reordered`);
  }
  const api = requireStyleOrderApi(style.type, "move");
  let reference = null;
  if (p.afterStyleId) {
    reference = await requireStyle(p.afterStyleId);
    if (reference.type !== style.type) {
      throw new Error(
        `afterStyleId is a ${reference.type} style, expected ${style.type}`,
      );
    }
    if (reference.id === style.id) {
      throw new Error("afterStyleId must differ from styleId");
    }
  }
  /** @type {any} */ (figma)[api.move](style, reference);
  const styles = await /** @type {any} */ (figma)[api.list]();
  return {
    id: style.id,
    name: style.name,
    styleType: style.type,
    afterStyleId: reference ? reference.id : null,
    index: styles.findIndex((item) => item.id === style.id),
    order: styles.map((item) => ({ id: item.id, name: item.name })),
  };
}

function reorderStyleFolder(params) {
  const p = params || {};
  if (!p.folder) {
    throw new Error("Missing folder parameter");
  }
  const api = requireStyleOrderApi(p.styleType, "moveFolder");
  const after = p.afterFolder ? String(p.afterFolder) : null;
  /** @type {any} */ (figma)[api.moveFolder](String(p.folder), after);
  return { styleType: p.styleType, folder: String(p.folder), afterFolder: after };
}

const CODE_BLOCK_LANGUAGES = [
  "TYPESCRIPT",
  "CPP",
  "RUBY",
  "CSS",
  "JAVASCRIPT",
  "HTML",
  "JSON",
  "GRAPHQL",
  "PYTHON",
  "GO",
  "SQL",
  "SWIFT",
  "KOTLIN",
  "RUST",
  "BASH",
  "PLAINTEXT",
  "DART",
];

async function createCodeBlock(params) {
  requireFigJam("create_code_block");
  const p = params || {};
  if (
    p.codeLanguage !== undefined &&
    CODE_BLOCK_LANGUAGES.indexOf(p.codeLanguage) === -1
  ) {
    throw new Error(`codeLanguage must be one of ${CODE_BLOCK_LANGUAGES.join(", ")}`);
  }
  const parent = /** @type {any} */ (await resolveNewNodeParent(p.parentId));
  const block = figma.createCodeBlock();
  try {
    parent.appendChild(block);
    block.x = Number(p.x) || 0;
    block.y = Number(p.y) || 0;
    block.code = String(p.code === undefined ? "" : p.code);
    if (p.codeLanguage !== undefined) block.codeLanguage = p.codeLanguage;
  } catch (error) {
    block.remove();
    throw new Error(`Error creating code block: ${errorMessage(error)}`);
  }
  return {
    id: block.id,
    name: block.name,
    type: block.type,
    codeLanguage: block.codeLanguage,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    parentId: block.parent ? block.parent.id : undefined,
  };
}

async function createLinkPreview(params) {
  requireFigJam("create_link_preview");
  const p = params || {};
  const url = requireHttpUrl(p.url, "url");
  const parent = /** @type {any} */ (await resolveNewNodeParent(p.parentId));
  const node = await figma.createLinkPreviewAsync(url);
  try {
    if (node.parent !== parent) parent.appendChild(node);
    if (p.x !== undefined) node.x = Number(p.x) || 0;
    if (p.y !== undefined) node.y = Number(p.y) || 0;
  } catch (error) {
    node.remove();
    throw new Error(`Error placing link preview: ${errorMessage(error)}`);
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    parentId: node.parent ? node.parent.id : undefined,
  };
}

async function extendLibraryCollection(params) {
  const p = params || {};
  const name = String(p.name === undefined ? "" : p.name).trim();
  if (!name) {
    throw new Error("Missing name parameter");
  }
  if (Boolean(p.collectionKey) === Boolean(p.collectionId)) {
    throw new Error("Provide exactly one of collectionKey or collectionId");
  }
  let collection;
  if (p.collectionKey) {
    collection = await figma.variables.extendLibraryCollectionByKeyAsync(
      String(p.collectionKey),
      name,
    );
  } else {
    const base = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (!base) {
      throw new Error(`Variable collection not found with ID: ${p.collectionId}`);
    }
    if (base.remote) {
      throw new Error(
        "collectionId must be a local collection; use collectionKey for library collections",
      );
    }
    collection = base.extend(name);
  }
  return {
    id: collection.id,
    key: collection.key,
    name: collection.name,
    isExtension: collection.isExtension,
    parentVariableCollectionId: collection.parentVariableCollectionId,
    rootVariableCollectionId: collection.rootVariableCollectionId,
    modes: collection.modes,
    variableCount: collection.variableIds.length,
  };
}

async function requireDevResourceNode(nodeId) {
  const node = /** @type {any} */ (await requireNode(nodeId));
  if (typeof node.getDevResourcesAsync !== "function") {
    throw new Error(`Node type ${node.type} does not support dev resources`);
  }
  return node;
}

// Dev resource APIs may be restricted by editor mode or plan; keep Figma's reason
async function runDevResourceCall(action, fn) {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`${action} failed: ${errorMessage(error)}`);
  }
}

async function getDevResources(params) {
  const p = params || {};
  const node = await requireDevResourceNode(p.nodeId);
  const resources = await runDevResourceCall("getDevResourcesAsync", () =>
    node.getDevResourcesAsync({ includeChildren: Boolean(p.includeChildren) }),
  );
  return {
    id: node.id,
    name: node.name,
    devResources: resources.map((resource) => ({
      nodeId: resource.nodeId,
      name: resource.name,
      url: resource.url,
      inheritedNodeId: resource.inheritedNodeId,
    })),
  };
}

async function addDevResource(params) {
  const p = params || {};
  const url = requireHttpUrl(p.url, "url");
  const node = await requireDevResourceNode(p.nodeId);
  await runDevResourceCall("addDevResourceAsync", () =>
    p.name !== undefined
      ? node.addDevResourceAsync(url, String(p.name))
      : node.addDevResourceAsync(url),
  );
  return getDevResources({ nodeId: node.id });
}

async function editDevResource(params) {
  const p = params || {};
  const currentUrl = requireHttpUrl(p.currentUrl, "currentUrl");
  /** @type {any} */
  const update = {};
  if (p.url !== undefined) update.url = requireHttpUrl(p.url, "url");
  if (p.name !== undefined) update.name = String(p.name);
  if (!Object.keys(update).length) {
    throw new Error("Provide url and/or name to change");
  }
  const node = await requireDevResourceNode(p.nodeId);
  await runDevResourceCall("editDevResourceAsync", () =>
    node.editDevResourceAsync(currentUrl, update),
  );
  return getDevResources({ nodeId: node.id });
}

async function deleteDevResource(params) {
  const p = params || {};
  const url = requireHttpUrl(p.url, "url");
  const node = await requireDevResourceNode(p.nodeId);
  await runDevResourceCall("deleteDevResourceAsync", () =>
    node.deleteDevResourceAsync(url),
  );
  return getDevResources({ nodeId: node.id });
}

const ANNOTATION_CATEGORY_COLORS = [
  "yellow",
  "orange",
  "red",
  "pink",
  "violet",
  "blue",
  "teal",
  "green",
];

function serializeAnnotationCategory(category) {
  return {
    id: category.id,
    label: category.label,
    color: category.color,
    isPreset: category.isPreset,
  };
}

async function getAnnotationCategories() {
  const categories = await figma.annotations.getAnnotationCategoriesAsync();
  return categories.map(serializeAnnotationCategory);
}

async function createAnnotationCategory(params) {
  const p = params || {};
  const label = String(p.label === undefined ? "" : p.label).trim();
  if (!label) {
    throw new Error("Missing label parameter");
  }
  if (ANNOTATION_CATEGORY_COLORS.indexOf(p.color) === -1) {
    throw new Error(`color must be one of ${ANNOTATION_CATEGORY_COLORS.join(", ")}`);
  }
  const category = await figma.annotations.addAnnotationCategoryAsync({
    label,
    color: p.color,
  });
  return serializeAnnotationCategory(category);
}

const MEASUREMENT_SIDES = ["TOP", "RIGHT", "BOTTOM", "LEFT"];

function requireDevMode(command) {
  if (figma.editorType !== "dev") {
    throw new Error(
      `${command} is only available in Dev Mode (current editor: ${figma.editorType})`,
    );
  }
}

function serializeMeasurement(measurement) {
  return {
    id: measurement.id,
    start: {
      nodeId: measurement.start.node.id,
      nodeName: measurement.start.node.name,
      side: measurement.start.side,
    },
    end: {
      nodeId: measurement.end.node.id,
      nodeName: measurement.end.node.name,
      side: measurement.end.side,
    },
    offset: measurement.offset,
    freeText: measurement.freeText,
  };
}

function parseMeasurementOffset(offset) {
  if (!offset || typeof offset !== "object") {
    throw new Error("offset must be an object");
  }
  if (offset.type === "INNER") {
    const relative = Number(offset.relative);
    if (!isFinite(relative)) {
      throw new Error("offset.relative must be a number");
    }
    return { type: "INNER", relative };
  }
  if (offset.type === "OUTER") {
    const fixed = Number(offset.fixed);
    if (!isFinite(fixed)) {
      throw new Error("offset.fixed must be a number");
    }
    return { type: "OUTER", fixed };
  }
  throw new Error('offset.type must be "INNER" or "OUTER"');
}

function measurementOptions(p) {
  /** @type {any} */
  const options = {};
  if (p.offset !== undefined) options.offset = parseMeasurementOffset(p.offset);
  if (p.freeText !== undefined) options.freeText = String(p.freeText);
  return options;
}

async function getMeasurements(params) {
  const p = params || {};
  const page = figma.currentPage;
  await page.loadAsync();
  let measurements;
  if (p.nodeId) {
    const node = await requireNode(p.nodeId);
    if (node.type === "PAGE" || node.type === "DOCUMENT") {
      throw new Error("nodeId must be a scene node on the current page");
    }
    measurements = page.getMeasurementsForNode(/** @type {any} */ (node));
  } else {
    measurements = page.getMeasurements();
  }
  return {
    pageId: page.id,
    measurements: measurements.map(serializeMeasurement),
  };
}

function isHorizontalSide(side) {
  return side === "LEFT" || side === "RIGHT";
}

async function addMeasurement(params) {
  requireDevMode("add_measurement");
  const p = params || {};
  for (const key of ["startSide", "endSide"]) {
    if (MEASUREMENT_SIDES.indexOf(p[key]) === -1) {
      throw new Error(`${key} must be one of ${MEASUREMENT_SIDES.join(", ")}`);
    }
  }
  if (isHorizontalSide(p.startSide) !== isHorizontalSide(p.endSide)) {
    throw new Error(
      "startSide and endSide must be on the same axis (LEFT/RIGHT or TOP/BOTTOM)",
    );
  }
  const options = measurementOptions(p);
  const start = await requireNode(p.startNodeId);
  const end = await requireNode(p.endNodeId);
  for (const node of [start, end]) {
    if (node.type === "PAGE" || node.type === "DOCUMENT") {
      throw new Error(`Node ${node.id} must be a scene node, not ${node.type}`);
    }
  }
  const measurement = figma.currentPage.addMeasurement(
    { node: /** @type {any} */ (start), side: p.startSide },
    { node: /** @type {any} */ (end), side: p.endSide },
    options,
  );
  return serializeMeasurement(measurement);
}

async function editMeasurement(params) {
  requireDevMode("edit_measurement");
  const p = params || {};
  if (!p.measurementId) {
    throw new Error("Missing measurementId parameter");
  }
  const options = measurementOptions(p);
  if (!Object.keys(options).length) {
    throw new Error("Provide offset and/or freeText to change");
  }
  const measurement = figma.currentPage.editMeasurement(p.measurementId, options);
  return serializeMeasurement(measurement);
}

async function deleteMeasurement(params) {
  requireDevMode("delete_measurement");
  const p = params || {};
  if (!p.measurementId) {
    throw new Error("Missing measurementId parameter");
  }
  figma.currentPage.deleteMeasurement(p.measurementId);
  return { deleted: p.measurementId };
}
