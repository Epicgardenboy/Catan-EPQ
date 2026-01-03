import { useMemo } from "react";
import classnames from "classnames";
import Paper from "@mui/material/Paper";

import { SQRT3, tilePixelVector, getNodeDelta } from "../utils/coordinates";
import type { TileCoordinate, Direction, ResourceCard } from "../utils/api.types";
import type { TileConfig, PortConfig, NodeState, EdgeState } from "./AdvisorScreen";
import type { BoardTemplate } from "../utils/advisorClient";

import brickTile from "../assets/tile_brick.svg";
import desertTile from "../assets/tile_desert.svg";
import grainTile from "../assets/tile_wheat.svg";
import lumberTile from "../assets/tile_wood.svg";
import oreTile from "../assets/tile_ore.svg";
import woolTile from "../assets/tile_sheep.svg";
import maritimeTile from "../assets/tile_maritime.svg";

import "./AdvisorBoard.scss";

const RESOURCES: { [K in ResourceCard]: string } = {
  BRICK: brickTile,
  SHEEP: woolTile,
  ORE: oreTile,
  WOOD: lumberTile,
  WHEAT: grainTile,
};

// Number token component
function NumberToken({ number, flashing }: { number: number; flashing?: boolean }) {
  const pips = getPips(number);
  return (
    <Paper
      elevation={3}
      className={classnames("number-token", { flashing })}
    >
      <div>{number}</div>
      <div className="pips">{pips}</div>
    </Paper>
  );
}

function getPips(number: number): string {
  switch (number) {
    case 2:
    case 12:
      return "•";
    case 3:
    case 11:
      return "••";
    case 4:
    case 10:
      return "•••";
    case 5:
    case 9:
      return "••••";
    case 6:
    case 8:
      return "•••••";
    default:
      return "";
  }
}

type AdvisorBoardProps = {
  boardTemplate: BoardTemplate;
  tileConfigs: Map<string, TileConfig>;
  portConfigs: Map<string, PortConfig>;
  nodeStates: Map<number, NodeState>;
  edgeStates: Map<string, EdgeState>; // "nodeA,nodeB" format
  robberCoordinate: TileCoordinate | null;
  onTileClick: (coordinate: TileCoordinate) => void;
  onPortClick: (coordinate: TileCoordinate) => void;
  onNodeClick: (nodeId: number) => void;
  onEdgeClick: (edgeId: [number, number]) => void;
  setupPhase: string;
  highlightNodes: boolean;
  highlightEdges: boolean;
  recommendedNode?: number | null;
  recommendedEdge?: [number, number] | null;
  recommendedTile?: TileCoordinate | null;
};

export default function AdvisorBoard({
  boardTemplate,
  tileConfigs,
  portConfigs,
  nodeStates,
  edgeStates,
  robberCoordinate,
  onTileClick,
  onPortClick,
  onNodeClick,
  onEdgeClick,
  setupPhase,
  highlightNodes,
  highlightEdges,
  recommendedNode,
  recommendedEdge,
  recommendedTile,
}: AdvisorBoardProps) {
  // Calculate board dimensions
  const containerWidth = 600;
  const containerHeight = 580;
  const center: [number, number] = [containerWidth / 2, containerHeight / 2];
  
  // Calculate hex size based on container
  const numLevels = 6;
  const maxSizeThatRespectsHeight = (4 * containerHeight) / (3 * numLevels + 1) / 2;
  const correspondingWidth = SQRT3 * maxSizeThatRespectsHeight;
  const size = numLevels * correspondingWidth < containerWidth
    ? maxSizeThatRespectsHeight
    : containerWidth / numLevels / SQRT3;

  const w = SQRT3 * size;
  const h = 2 * size;
  
  // Get land tiles and port tiles from template
  const landTiles = useMemo(() => {
    return boardTemplate.tiles.filter(t => t.type !== "PORT");
  }, [boardTemplate]);
  
  const portTiles = useMemo(() => {
    return boardTemplate.tiles.filter(t => t.type === "PORT");
  }, [boardTemplate]);

  // Calculate pixel positions for nodes from template
  const nodePositions = useMemo(() => {
    const positions = new Map<number, { x: number; y: number }>();
    
    boardTemplate.nodes.forEach(node => {
      // Use the first tile coordinate and the direction from the backend
      const tileCoords = node.tile_coordinates;
      if (tileCoords && tileCoords.length > 0 && node.direction) {
        // Use the first tile as reference
        const coord = tileCoords[0] as TileCoordinate;
        const [tileX, tileY] = tilePixelVector(coord, size, center[0], center[1]);
        
        // Use the direction from the backend (relative to first tile)
        const direction = node.direction as Direction;
        const [deltaX, deltaY] = getNodeDelta(direction, w, h);
        
        positions.set(node.id, { x: tileX + deltaX, y: tileY + deltaY });
      }
    });
    
    return positions;
  }, [boardTemplate, size, center, w, h]);
  
  // Calculate edge positions from template
  const edgePositions = useMemo(() => {
    const positions: { edgeId: [number, number]; x: number; y: number; rotation: number }[] = [];
    
    boardTemplate.edges.forEach(edge => {
      const node1Pos = nodePositions.get(edge.node_ids[0]);
      const node2Pos = nodePositions.get(edge.node_ids[1]);
      
      if (node1Pos && node2Pos) {
        const midX = (node1Pos.x + node2Pos.x) / 2;
        const midY = (node1Pos.y + node2Pos.y) / 2;
        
        // Calculate the actual angle between the two nodes
        const dx = node2Pos.x - node1Pos.x;
        const dy = node2Pos.y - node1Pos.y;
        const rotation = Math.atan2(dy, dx) * (180 / Math.PI);
        
        positions.push({
          edgeId: edge.node_ids,
          x: midX,
          y: midY,
          rotation,
        });
      }
    });
    
    return positions;
  }, [boardTemplate, nodePositions]);

  return (
    <div 
      className="advisor-board" 
      style={{ width: containerWidth, height: containerHeight }}
    >
      {/* Render land tiles */}
      {landTiles.map(tile => {
        const coordStr = tile.coordinate.toString();
        const config = tileConfigs.get(coordStr);
        const [x, y] = tilePixelVector(tile.coordinate, size, center[0], center[1]);
        
        let resourceTile = null;
        let contents = null;
        
        if (config?.resource) {
          if (config.resource === "DESERT") {
            resourceTile = desertTile;
          } else {
            resourceTile = RESOURCES[config.resource];
            if (config.number) {
              contents = <NumberToken number={config.number} />;
            }
          }
        }
        
        const isHighlighted = setupPhase === "tiles";
        // Only make tiles clickable in tiles phase (for setting resources)
        // NOT in pieces phase (which is for settlements/roads)
        const isClickable = setupPhase === "tiles";
        
        return (
          <div
            key={coordStr}
            className={classnames("tile", { 
              clickable: isClickable,
              empty: !config?.resource,
              highlighted: isHighlighted,
            })}
            style={{
              left: x - w / 2,
              top: y - h / 2,
              width: w,
              height: h,
              backgroundImage: resourceTile ? `url("${resourceTile}")` : undefined,
              backgroundSize: "contain",
            }}
            onClick={() => isClickable && onTileClick(tile.coordinate)}
          >
            {contents}
            {!config?.resource && (
              <div className="empty-tile-label">Click to set</div>
            )}
          </div>
        );
      })}

      {/* Render ports */}
      {portTiles.map(tile => {
        const coordStr = tile.coordinate.toString();
        const config = portConfigs.get(coordStr);
        const [x, y] = tilePixelVector(tile.coordinate, size, center[0], center[1]);
        
        let portTile = maritimeTile;
        let portLabel = "3:1";
        
        if (config?.resource) {
          portTile = RESOURCES[config.resource];
          portLabel = "2:1";
        }
        
        const isHighlighted = setupPhase === "ports";
        
        return (
          <div
            key={`port-${coordStr}`}
            className={classnames("port-tile", { 
              clickable: isHighlighted,
              highlighted: isHighlighted,
            })}
            style={{
              left: x - w / 3,
              top: y - h / 3,
              width: w * 0.66,
              height: h * 0.66,
              backgroundImage: `url("${portTile}")`,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
            }}
            onClick={() => onPortClick(tile.coordinate)}
          >
            <span className="port-label">{portLabel}</span>
          </div>
        );
      })}

      {/* Render edges (roads) */}
      {edgePositions.map(({ edgeId, x, y, rotation }) => {
        const edgeKey = `${Math.min(edgeId[0], edgeId[1])},${Math.max(edgeId[0], edgeId[1])}`;
        const edgeState = edgeStates.get(edgeKey);
        const isRecommended = recommendedEdge && 
          Math.min(recommendedEdge[0], recommendedEdge[1]) === Math.min(edgeId[0], edgeId[1]) &&
          Math.max(recommendedEdge[0], recommendedEdge[1]) === Math.max(edgeId[0], edgeId[1]);
        
        return (
          <div
            key={edgeKey}
            className={classnames("edge", {
              clickable: highlightEdges,
              highlighted: highlightEdges,
              recommended: isRecommended,
            })}
            style={{
              left: x,
              top: y,
              width: size * 0.85,
              height: size * 0.35, // Taller hitbox for easier clicking
              transform: `translateX(-50%) translateY(-50%) rotate(${rotation}deg)`,
            }}
            onClick={() => onEdgeClick(edgeId)}
          >
            {edgeState?.color && (
              <div className={classnames("road", edgeState.color)} />
            )}
            {highlightEdges && !edgeState?.color && (
              <div className="pulse" />
            )}
            {isRecommended && !edgeState?.color && (
              <div className="recommended-marker" />
            )}
          </div>
        );
      })}

      {/* Render nodes (settlements/cities) */}
      {boardTemplate.nodes.map(node => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        
        const nodeState = nodeStates.get(node.id);
        const isRecommended = recommendedNode === node.id;
        
        return (
          <div
            key={node.id}
            className={classnames("node", {
              clickable: highlightNodes,
              highlighted: highlightNodes,
              recommended: isRecommended,
            })}
            style={{
              left: pos.x,
              top: pos.y,
              width: size * 0.5,
              height: size * 0.5,
              transform: "translateY(-50%) translateX(-50%)",
            }}
            onClick={() => onNodeClick(node.id)}
          >
            {nodeState?.building && nodeState?.color && (
              <div className={classnames(nodeState.color, nodeState.building.toLowerCase())} />
            )}
            {highlightNodes && !nodeState?.building && (
              <div className="pulse" />
            )}
            {isRecommended && (
              <div className="recommended-marker">⭐</div>
            )}
          </div>
        );
      })}

      {/* Render robber - only visible and interactive when setting tiles or in certain phases */}
      {robberCoordinate && setupPhase !== "pieces" && (
        <Robber center={center} size={size} coordinate={robberCoordinate} />
      )}
    </div>
  );
}

function Robber({ 
  center, 
  size, 
  coordinate 
}: { 
  center: [number, number]; 
  size: number; 
  coordinate: TileCoordinate;
}) {
  const [x, y] = tilePixelVector(coordinate, size, center[0], center[1]);
  const robberSize = size * 0.4;
  
  return (
    <Paper
      elevation={3}
      className="robber"
      style={{
        left: x - robberSize / 2,
        top: y - robberSize / 2 + size * 0.3,
        width: robberSize,
        height: robberSize,
        borderRadius: "50%",
      }}
    >
      👤
    </Paper>
  );
}
