import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import HomeIcon from "@mui/icons-material/Home";
import { GridLoader } from "react-spinners";

import "./AdvisorScreen.scss";
import AdvisorBoard from "./AdvisorBoard";
import { 
  getAdvisorRecommendation, 
  getBoardTemplate,
  type AdvisorRequest, 
  type AdvisorResponse,
  type BoardTemplate,
} from "../utils/advisorClient";
import type { Color, ResourceCard, TileCoordinate, Building } from "../utils/api.types";

const RESOURCE_TYPES: (ResourceCard | "DESERT")[] = ["WOOD", "BRICK", "SHEEP", "WHEAT", "ORE", "DESERT"];
const VALID_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const PLAYER_COLORS: Color[] = ["RED", "BLUE", "ORANGE", "WHITE"];
const DEVELOPMENT_CARD_TYPES = ["KNIGHT", "VICTORY_POINT", "ROAD_BUILDING", "YEAR_OF_PLENTY", "MONOPOLY"] as const;
type DevelopmentCardType = typeof DEVELOPMENT_CARD_TYPES[number];

export type TileConfig = {
  resource: ResourceCard | "DESERT" | null;
  number: number | null;
};

export type PortConfig = {
  resource: ResourceCard | null; // null means 3:1 port
};

export type NodeState = {
  color: Color | null;
  building: Building | null;
};

export type EdgeState = {
  color: Color | null;
};

export type PlayerResources = {
  [K in ResourceCard]: number;
};

export type PlayerDevCards = {
  [K in DevelopmentCardType]: number;
};

export type PlayerState = {
  resources: PlayerResources;
  devCards: PlayerDevCards;
  knightsPlayed: number;
};

type SetupPhase = "tiles" | "ports" | "pieces" | "resources";

function createEmptyPlayerResources(): PlayerResources {
  return { WOOD: 0, BRICK: 0, SHEEP: 0, WHEAT: 0, ORE: 0 };
}

function createEmptyDevCards(): PlayerDevCards {
  return { KNIGHT: 0, VICTORY_POINT: 0, ROAD_BUILDING: 0, YEAR_OF_PLENTY: 0, MONOPOLY: 0 };
}

function createEmptyPlayerState(): PlayerState {
  return {
    resources: createEmptyPlayerResources(),
    devCards: createEmptyDevCards(),
    knightsPlayed: 0,
  };
}

export default function AdvisorScreen() {
  // Board template from server
  const [boardTemplate, setBoardTemplate] = useState<BoardTemplate | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  
  // Setup state
  const [numPlayers, setNumPlayers] = useState<2 | 3 | 4>(2);
  const [advisedPlayer, setAdvisedPlayer] = useState<Color>("RED");
  const [setupPhase, setSetupPhase] = useState<SetupPhase>("tiles");
  
  // Board configuration - keyed by coordinate string
  const [tileConfigs, setTileConfigs] = useState<Map<string, TileConfig>>(new Map());
  const [portConfigs, setPortConfigs] = useState<Map<string, PortConfig>>(new Map());
  
  // Piece placements - using actual node/edge IDs
  const [nodeStates, setNodeStates] = useState<Map<number, NodeState>>(new Map());
  const [edgeStates, setEdgeStates] = useState<Map<string, EdgeState>>(new Map()); // "nodeA,nodeB" format
  
  // Robber location
  const [robberCoordinate, setRobberCoordinate] = useState<TileCoordinate | null>(null);
  
  // Player states (resources, dev cards, etc.)
  const [playerStates, setPlayerStates] = useState<Map<Color, PlayerState>>(() => {
    const map = new Map<Color, PlayerState>();
    PLAYER_COLORS.forEach(color => {
      map.set(color, createEmptyPlayerState());
    });
    return map;
  });
  
  // Other players' played knights
  const [otherPlayersKnights, setOtherPlayersKnights] = useState<Map<Color, number>>(() => {
    const map = new Map<Color, number>();
    PLAYER_COLORS.forEach(color => map.set(color, 0));
    return map;
  });
  
  // UI state
  const [selectedTile, setSelectedTile] = useState<TileCoordinate | null>(null);
  const [selectedPort, setSelectedPort] = useState<TileCoordinate | null>(null);
  const [placementColor, setPlacementColor] = useState<Color>("RED");
  const [placementType, setPlacementType] = useState<"SETTLEMENT" | "CITY" | "ROAD">("SETTLEMENT");
  
  // Dialog state
  const [tileDialogOpen, setTileDialogOpen] = useState(false);
  const [portDialogOpen, setPortDialogOpen] = useState(false);
  
  // Local state for tile dialog editing
  const [dialogResource, setDialogResource] = useState<ResourceCard | "DESERT" | null>(null);
  const [dialogNumber, setDialogNumber] = useState<number | null>(null);
  
  // Advice state
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState<AdvisorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch board template on mount
  useEffect(() => {
    async function fetchTemplate() {
      try {
        setTemplateLoading(true);
        const template = await getBoardTemplate();
        setBoardTemplate(template);
        
        // Initialize EMPTY tile configs from template - user will fill them in
        const newTileConfigs = new Map<string, TileConfig>();
        const newPortConfigs = new Map<string, PortConfig>();
        
        template.tiles.forEach(tile => {
          const coordStr = tile.coordinate.toString();
          if (tile.type === "PORT") {
            // Initialize ports as empty (3:1 by default, null)
            newPortConfigs.set(coordStr, { resource: null });
          } else {
            // Initialize land tiles as empty (no resource, no number)
            newTileConfigs.set(coordStr, { 
              resource: null,
              number: null 
            });
          }
        });
        
        setTileConfigs(newTileConfigs);
        setPortConfigs(newPortConfigs);
        setRobberCoordinate(null);  // No robber initially
        setTemplateError(null);
      } catch (err) {
        setTemplateError(err instanceof Error ? err.message : "Failed to load board");
      } finally {
        setTemplateLoading(false);
      }
    }
    
    fetchTemplate();
  }, []);

  // Get active player colors based on number of players
  const activeColors = useMemo(() => PLAYER_COLORS.slice(0, numPlayers), [numPlayers]);
  
  // Get land tiles (non-port tiles)
  const landTiles = useMemo(() => {
    if (!boardTemplate) return [];
    return boardTemplate.tiles.filter(t => t.type !== "PORT");
  }, [boardTemplate]);
  
  // Get port tiles
  const portTiles = useMemo(() => {
    if (!boardTemplate) return [];
    return boardTemplate.tiles.filter(t => t.type === "PORT");
  }, [boardTemplate]);
  
  // Check if board setup is complete
  const isBoardComplete = useMemo(() => {
    let allTilesSet = true;
    let desertCount = 0;
    
    tileConfigs.forEach((config) => {
      if (config.resource === null) {
        allTilesSet = false;
      }
      if (config.resource === "DESERT") {
        desertCount++;
      } else if (config.resource !== null && config.number === null) {
        allTilesSet = false;
      }
    });
    
    return allTilesSet && desertCount === 1 && tileConfigs.size > 0;
  }, [tileConfigs]);

  // Extract recommended node/edge from advice for highlighting on board
  const recommendedNode = useMemo(() => {
    if (!advice?.action_value) return null;
    // BUILD_SETTLEMENT, BUILD_CITY actions have node_id as value
    if (advice.action_type === "BUILD_SETTLEMENT" || advice.action_type === "BUILD_CITY") {
      return typeof advice.action_value === "number" ? advice.action_value : null;
    }
    return null;
  }, [advice]);
  
  const recommendedEdge = useMemo((): [number, number] | null => {
    if (!advice?.action_value) return null;
    // BUILD_ROAD action has edge as [node1, node2] tuple
    if (advice.action_type === "BUILD_ROAD") {
      if (Array.isArray(advice.action_value) && advice.action_value.length === 2) {
        return advice.action_value as [number, number];
      }
    }
    return null;
  }, [advice]);

  // Update tile configuration
  const updateTileConfig = useCallback((resource: ResourceCard | "DESERT" | null, number: number | null) => {
    if (!selectedTile) return;
    
    setTileConfigs(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedTile.toString(), { 
        resource, 
        number: resource === "DESERT" ? null : number 
      });
      return newMap;
    });
    
    // Auto-set robber on desert
    if (resource === "DESERT") {
      setRobberCoordinate(selectedTile);
    }
  }, [selectedTile]);
  
  // Handle tile dialog open - initialize local state from current config
  const openTileDialog = useCallback((coordinate: TileCoordinate) => {
    setSelectedTile(coordinate);
    const config = tileConfigs.get(coordinate.toString());
    setDialogResource(config?.resource || null);
    setDialogNumber(config?.number || null);
    setTileDialogOpen(true);
  }, [tileConfigs]);
  
  // Handle tile dialog confirm
  const confirmTileDialog = useCallback(() => {
    if (selectedTile) {
      updateTileConfig(dialogResource, dialogNumber);
    }
    setTileDialogOpen(false);
    setSelectedTile(null);
  }, [selectedTile, dialogResource, dialogNumber, updateTileConfig]);
  
  // Handle tile dialog cancel
  const cancelTileDialog = useCallback(() => {
    setTileDialogOpen(false);
    setSelectedTile(null);
  }, []);

  // Handle tile click during setup
  const handleTileClick = useCallback((coordinate: TileCoordinate) => {
    if (setupPhase === "tiles") {
      openTileDialog(coordinate);
    } else if (setupPhase === "pieces") {
      // Place robber
      setRobberCoordinate(coordinate);
    }
  }, [setupPhase, openTileDialog]);
  
  // Handle port click
  const handlePortClick = useCallback((coordinate: TileCoordinate) => {
    if (setupPhase === "ports") {
      setSelectedPort(coordinate);
      setPortDialogOpen(true);
    }
  }, [setupPhase]);

  // Handle node click for placing settlements/cities
  const handleNodeClick = useCallback((nodeId: number) => {
    if (setupPhase !== "pieces") return;
    
    setNodeStates(prev => {
      const newMap = new Map<number, NodeState>(prev);
      const current = newMap.get(nodeId);
      
      if (placementType === "SETTLEMENT" || placementType === "CITY") {
        if (current && current.color === placementColor && current.building === placementType) {
          // Remove if clicking same piece
          newMap.delete(nodeId);
        } else {
          newMap.set(nodeId, { color: placementColor, building: placementType });
        }
      }
      return newMap;
    });
  }, [setupPhase, placementColor, placementType]);

  // Handle edge click for placing roads
  const handleEdgeClick = useCallback((edgeId: [number, number]) => {
    if (setupPhase !== "pieces" || placementType !== "ROAD") return;
    
    const edgeKey = `${Math.min(edgeId[0], edgeId[1])},${Math.max(edgeId[0], edgeId[1])}`;
    
    setEdgeStates(prev => {
      const newMap = new Map<string, EdgeState>(prev);
      const current = newMap.get(edgeKey);
      
      if (current && current.color === placementColor) {
        // Remove if clicking same road
        newMap.delete(edgeKey);
      } else {
        newMap.set(edgeKey, { color: placementColor });
      }
      return newMap;
    });
  }, [setupPhase, placementColor, placementType]);

  // Update port configuration
  const updatePortConfig = useCallback((resource: ResourceCard | null) => {
    if (!selectedPort) return;
    
    setPortConfigs(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedPort.toString(), { resource });
      return newMap;
    });
    
    setPortDialogOpen(false);
    setSelectedPort(null);
  }, [selectedPort]);

  // Update player resources
  const updatePlayerResource = useCallback((color: Color, resource: ResourceCard, delta: number) => {
    setPlayerStates(prev => {
      const newMap = new Map<Color, PlayerState>(prev);
      const existing = newMap.get(color);
      if (!existing) return newMap;
      const playerState: PlayerState = { 
        ...existing,
        resources: { ...existing.resources }
      };
      playerState.resources[resource] = Math.max(0, playerState.resources[resource] + delta);
      newMap.set(color, playerState);
      return newMap;
    });
  }, []);

  // Update player dev cards
  const updatePlayerDevCard = useCallback((color: Color, cardType: DevelopmentCardType, delta: number) => {
    setPlayerStates(prev => {
      const newMap = new Map<Color, PlayerState>(prev);
      const existing = newMap.get(color);
      if (!existing) return newMap;
      const playerState: PlayerState = {
        ...existing,
        devCards: { ...existing.devCards }
      };
      playerState.devCards[cardType] = Math.max(0, playerState.devCards[cardType] + delta);
      newMap.set(color, playerState);
      return newMap;
    });
  }, []);

  // Update other players' played knights
  const updateOtherPlayerKnights = useCallback((color: Color, delta: number) => {
    setOtherPlayersKnights(prev => {
      const newMap = new Map<Color, number>(prev);
      const currentValue = newMap.get(color) ?? 0;
      newMap.set(color, Math.max(0, currentValue + delta));
      return newMap;
    });
  }, []);

  // Generate a random board and game state for testing
  const generateRandomBoard = useCallback(() => {
    if (!boardTemplate) return;
    
    // Standard Catan resources: 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert
    const resourcePool: (ResourceCard | "DESERT")[] = [
      "WOOD", "WOOD", "WOOD", "WOOD",
      "SHEEP", "SHEEP", "SHEEP", "SHEEP", 
      "WHEAT", "WHEAT", "WHEAT", "WHEAT",
      "BRICK", "BRICK", "BRICK",
      "ORE", "ORE", "ORE",
      "DESERT"
    ];
    
    // Standard Catan numbers
    const numberPool = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
    
    // Shuffle arrays
    const shuffleArray = <T,>(arr: T[]): T[] => {
      const result = [...arr];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    };
    
    const shuffledResources = shuffleArray(resourcePool);
    const shuffledNumbers = shuffleArray(numberPool);
    
    // Assign resources and numbers to tiles
    const newTileConfigs = new Map<string, TileConfig>();
    let desertCoord: TileCoordinate | null = null;
    let resourceIdx = 0;
    let numberIdx = 0;
    
    const landTilesList = boardTemplate.tiles.filter(t => t.type !== "PORT");
    landTilesList.forEach(tile => {
      const coordStr = tile.coordinate.toString();
      const resource = shuffledResources[resourceIdx++];
      
      if (resource === "DESERT") {
        newTileConfigs.set(coordStr, { resource: "DESERT", number: null });
        desertCoord = tile.coordinate;
      } else {
        newTileConfigs.set(coordStr, { 
          resource: resource, 
          number: shuffledNumbers[numberIdx++] 
        });
      }
    });
    
    setTileConfigs(newTileConfigs);
    setRobberCoordinate(desertCoord);
    
    // Random port configuration: 4 resource ports (one each of wood, brick, sheep, wheat, ore - but only 4), 4 generic 3:1
    const portResources: (ResourceCard | null)[] = [
      "WOOD", "BRICK", "SHEEP", "WHEAT", "ORE", null, null, null, null
    ];
    const shuffledPortResources = shuffleArray(portResources);
    
    const newPortConfigs = new Map<string, PortConfig>();
    const portTilesList = boardTemplate.tiles.filter(t => t.type === "PORT");
    portTilesList.forEach((tile, idx) => {
      const coordStr = tile.coordinate.toString();
      newPortConfigs.set(coordStr, { resource: shuffledPortResources[idx] || null });
    });
    setPortConfigs(newPortConfigs);
    
    // Generate random pieces for each active player
    const newNodeStates = new Map<number, NodeState>();
    const newEdgeStates = new Map<string, EdgeState>();
    
    // Get all node IDs that are on land
    const landNodeIds = new Set<number>();
    boardTemplate.nodes.forEach(node => {
      // Check if node is on any land tile
      const isOnLand = node.tile_coordinates?.some(coord => {
        const coordStr = coord.toString();
        return newTileConfigs.has(coordStr);
      });
      if (isOnLand) {
        landNodeIds.add(node.id);
      }
    });
    
    const availableNodes = shuffleArray(Array.from(landNodeIds));
    const usedNodes = new Set<number>();
    
    // Place 2 settlements per player (respecting distance rule roughly)
    activeColors.forEach(color => {
      let settlementsPlaced = 0;
      for (const nodeId of availableNodes) {
        if (settlementsPlaced >= 2) break;
        if (usedNodes.has(nodeId)) continue;
        
        // Check distance rule (no adjacent settlements) - simplified check
        const node = boardTemplate.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        
        // Find adjacent nodes via edges
        const adjacentNodes = new Set<number>();
        boardTemplate.edges.forEach(edge => {
          if (edge.node_ids[0] === nodeId) adjacentNodes.add(edge.node_ids[1]);
          if (edge.node_ids[1] === nodeId) adjacentNodes.add(edge.node_ids[0]);
        });
        
        const hasAdjacentSettlement = Array.from(adjacentNodes).some(adjId => usedNodes.has(adjId));
        if (hasAdjacentSettlement) continue;
        
        newNodeStates.set(nodeId, { color, building: "SETTLEMENT" });
        usedNodes.add(nodeId);
        // Also mark adjacent nodes as "used" for distance rule
        adjacentNodes.forEach(adjId => usedNodes.add(adjId));
        settlementsPlaced++;
        
        // Place a road from this settlement
        const connectedEdges = boardTemplate.edges.filter(
          e => e.node_ids[0] === nodeId || e.node_ids[1] === nodeId
        );
        if (connectedEdges.length > 0) {
          const randomEdge = connectedEdges[Math.floor(Math.random() * connectedEdges.length)];
          const edgeKey = `${Math.min(randomEdge.node_ids[0], randomEdge.node_ids[1])},${Math.max(randomEdge.node_ids[0], randomEdge.node_ids[1])}`;
          if (!newEdgeStates.has(edgeKey)) {
            newEdgeStates.set(edgeKey, { color });
          }
        }
      }
    });
    
    setNodeStates(newNodeStates);
    setEdgeStates(newEdgeStates);
    
    // Give the advised player some random resources
    setPlayerStates(prev => {
      const newMap = new Map(prev);
      const playerState = { ...newMap.get(advisedPlayer)! };
      playerState.resources = {
        WOOD: Math.floor(Math.random() * 4),
        BRICK: Math.floor(Math.random() * 4),
        SHEEP: Math.floor(Math.random() * 4),
        WHEAT: Math.floor(Math.random() * 4),
        ORE: Math.floor(Math.random() * 4),
      };
      newMap.set(advisedPlayer, playerState);
      return newMap;
    });
    
  }, [boardTemplate, activeColors, advisedPlayer]);

  // Get advice from AI
  const handleGetAdvice = useCallback(async () => {
    if (!boardTemplate) return;
    
    setLoading(true);
    setError(null);
    setAdvice(null);
    
    try {
      // Build the request
      const tiles: AdvisorRequest["tiles"] = [];
      tileConfigs.forEach((config, coordStr) => {
        const coord = coordStr.split(",").map(Number) as TileCoordinate;
        if (config.resource && config.resource !== "DESERT") {
          tiles.push({
            coordinate: coord,
            resource: config.resource,
            number: config.number!,
          });
        } else if (config.resource === "DESERT") {
          tiles.push({
            coordinate: coord,
            resource: null,
            number: null,
          });
        }
      });
      
      const ports: AdvisorRequest["ports"] = [];
      portConfigs.forEach((config, coordStr) => {
        const coord = coordStr.split(",").map(Number) as TileCoordinate;
        const portTile = portTiles.find(p => p.coordinate.toString() === coordStr);
        if (portTile && portTile.direction) {
          ports.push({
            coordinate: coord,
            direction: portTile.direction,
            resource: config.resource,
          });
        }
      });
      
      const buildings: AdvisorRequest["buildings"] = [];
      nodeStates.forEach((state, nodeId) => {
        if (state.color && state.building) {
          buildings.push({
            node_id: nodeId,
            color: state.color,
            building: state.building,
          });
        }
      });
      
      const roads: AdvisorRequest["roads"] = [];
      edgeStates.forEach((state, edgeKey) => {
        if (state.color) {
          const [a, b] = edgeKey.split(",").map(Number);
          roads.push({
            edge_id: [a, b],
            color: state.color,
          });
        }
      });
      
      const advisedPlayerState = playerStates.get(advisedPlayer)!;
      
      const playersKnights: AdvisorRequest["players_knights"] = {};
      activeColors.forEach(color => {
        if (color !== advisedPlayer) {
          playersKnights[color] = otherPlayersKnights.get(color) || 0;
        }
      });
      
      const request: AdvisorRequest = {
        num_players: numPlayers,
        advised_player: advisedPlayer,
        tiles,
        ports,
        buildings,
        roads,
        robber_coordinate: robberCoordinate || [0, 0, 0],
        player_resources: advisedPlayerState.resources,
        player_dev_cards: advisedPlayerState.devCards,
        players_knights: playersKnights,
      };
      
      const response = await getAdvisorRecommendation(request);
      setAdvice(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get advice");
    } finally {
      setLoading(false);
    }
  }, [boardTemplate, tileConfigs, portConfigs, portTiles, nodeStates, edgeStates, robberCoordinate, numPlayers, advisedPlayer, playerStates, otherPlayersKnights, activeColors]);

  // Get current tile config for dialog
  const currentTileConfig = selectedTile ? tileConfigs.get(selectedTile.toString()) : null;
  const currentPortConfig = selectedPort ? portConfigs.get(selectedPort.toString()) : null;

  if (templateLoading) {
    return (
      <div className="advisor-screen">
        <div className="advisor-header">
          <Link to="/">
            <IconButton className="home-button">
              <HomeIcon />
            </IconButton>
          </Link>
          <h1>Catan Advisor</h1>
        </div>
        <div className="loading-screen">
          <GridLoader color="#1976d2" size={20} />
          <p>Loading board template...</p>
        </div>
      </div>
    );
  }

  if (templateError || !boardTemplate) {
    return (
      <div className="advisor-screen">
        <div className="advisor-header">
          <Link to="/">
            <IconButton className="home-button">
              <HomeIcon />
            </IconButton>
          </Link>
          <h1>Catan Advisor</h1>
        </div>
        <div className="error-screen">
          <p>Error loading board: {templateError || "Unknown error"}</p>
          <Button variant="contained" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="advisor-screen">
      <div className="advisor-header">
        <Link to="/">
          <IconButton className="home-button">
            <HomeIcon />
          </IconButton>
        </Link>
        <h1>Catan Advisor</h1>
      </div>

      <div className="advisor-content">
        <div className="setup-panel">
          <Paper className="setup-section">
            <h3>Game Setup</h3>
            
            <FormControl fullWidth size="small" className="form-control">
              <InputLabel>Number of Players</InputLabel>
              <Select
                value={numPlayers}
                label="Number of Players"
                onChange={(e) => setNumPlayers(e.target.value as 2 | 3 | 4)}
              >
                <MenuItem value={2}>2 Players</MenuItem>
                <MenuItem value={3}>3 Players</MenuItem>
                <MenuItem value={4}>4 Players</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small" className="form-control">
              <InputLabel>Advise For</InputLabel>
              <Select
                value={advisedPlayer}
                label="Advise For"
                onChange={(e) => setAdvisedPlayer(e.target.value as Color)}
              >
                {activeColors.map(color => (
                  <MenuItem key={color} value={color}>
                    <span className={`color-dot ${color}`}></span>
                    {color}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Button 
              variant="outlined" 
              fullWidth 
              onClick={generateRandomBoard}
              style={{ marginTop: 8 }}
            >
              Generate Random Board
            </Button>
          </Paper>

          <Paper className="setup-section">
            <h3>Setup Phase <span className="scroll-hint">(scroll for more tabs →)</span></h3>
            <Tabs
              value={setupPhase}
              onChange={(_, v) => setSetupPhase(v)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab label="Tiles" value="tiles" />
              <Tab label="Ports" value="ports" />
              <Tab label="Pieces" value="pieces" />
              <Tab label="Resources" value="resources" />
            </Tabs>

            {setupPhase === "tiles" && (
              <div className="phase-instructions">
                <p>Click on each hex tile to set its resource type and number token. You need exactly one desert tile.</p>
              </div>
            )}

            {setupPhase === "ports" && (
              <div className="phase-instructions">
                <p>Click on each port to set its type (3:1 or 2:1).</p>
              </div>
            )}

            {setupPhase === "pieces" && (
              <div className="phase-instructions">
                <p>Select a piece type and player color, then click on the board to place it (select it again with the same piece to delete):</p>
                <ul className="piece-instructions">
                  <li><strong>Settlement/City:</strong> Click on intersection points (vertices)</li>
                  <li><strong>Road:</strong> Click on edges between hexes</li>
                  <li><strong>Robber:</strong> Click on a tile to move the robber</li>
                </ul>
                
                <FormControl fullWidth size="small" className="form-control">
                  <InputLabel>Player Color</InputLabel>
                  <Select
                    value={placementColor}
                    label="Player Color"
                    onChange={(e) => setPlacementColor(e.target.value as Color)}
                  >
                    {activeColors.map(color => (
                      <MenuItem key={color} value={color}>
                        <span className={`color-dot ${color}`}></span>
                        {color}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <div className="placement-buttons">
                  <Button
                    variant={placementType === "SETTLEMENT" ? "contained" : "outlined"}
                    onClick={() => setPlacementType("SETTLEMENT")}
                    size="small"
                  >
                    Settlement
                  </Button>
                  <Button
                    variant={placementType === "CITY" ? "contained" : "outlined"}
                    onClick={() => setPlacementType("CITY")}
                    size="small"
                  >
                    City
                  </Button>
                  <Button
                    variant={placementType === "ROAD" ? "contained" : "outlined"}
                    onClick={() => setPlacementType("ROAD")}
                    size="small"
                  >
                    Road
                  </Button>
                </div>
              </div>
            )}

            {setupPhase === "resources" && (
              <div className="phase-instructions">
                <p>Set resources and development cards for the advised player.</p>
              </div>
            )}
          </Paper>

          {setupPhase === "resources" && (
            <>
              <Paper className="setup-section">
                <h3>
                  <span className={`color-dot ${advisedPlayer}`}></span>
                  {advisedPlayer}'s Resources
                </h3>
                <div className="resource-grid">
                  {(["WOOD", "BRICK", "SHEEP", "WHEAT", "ORE"] as ResourceCard[]).map(resource => (
                    <div key={resource} className="resource-row">
                      <span className={`resource-name ${resource.toLowerCase()}`}>{resource}</span>
                      <div className="resource-controls">
                        <IconButton 
                          size="small" 
                          onClick={() => updatePlayerResource(advisedPlayer, resource, -1)}
                        >
                          <RemoveIcon />
                        </IconButton>
                        <span className="resource-count">
                          {playerStates.get(advisedPlayer)?.resources[resource] || 0}
                        </span>
                        <IconButton 
                          size="small" 
                          onClick={() => updatePlayerResource(advisedPlayer, resource, 1)}
                        >
                          <AddIcon />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              </Paper>

              <Paper className="setup-section">
                <h3>
                  <span className={`color-dot ${advisedPlayer}`}></span>
                  {advisedPlayer}'s Development Cards
                </h3>
                <div className="resource-grid">
                  {DEVELOPMENT_CARD_TYPES.map(cardType => (
                    <div key={cardType} className="resource-row">
                      <span className="resource-name">{cardType.replace(/_/g, " ")}</span>
                      <div className="resource-controls">
                        <IconButton 
                          size="small" 
                          onClick={() => updatePlayerDevCard(advisedPlayer, cardType, -1)}
                        >
                          <RemoveIcon />
                        </IconButton>
                        <span className="resource-count">
                          {playerStates.get(advisedPlayer)?.devCards[cardType] || 0}
                        </span>
                        <IconButton 
                          size="small" 
                          onClick={() => updatePlayerDevCard(advisedPlayer, cardType, 1)}
                        >
                          <AddIcon />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              </Paper>

              <Paper className="setup-section">
                <h3>Other Players' Played Knights</h3>
                <div className="resource-grid">
                  {activeColors.filter(c => c !== advisedPlayer).map(color => (
                    <div key={color} className="resource-row">
                      <span className="resource-name">
                        <span className={`color-dot ${color}`}></span>
                        {color}
                      </span>
                      <div className="resource-controls">
                        <IconButton 
                          size="small" 
                          onClick={() => updateOtherPlayerKnights(color, -1)}
                        >
                          <RemoveIcon />
                        </IconButton>
                        <span className="resource-count">
                          {otherPlayersKnights.get(color) || 0}
                        </span>
                        <IconButton 
                          size="small" 
                          onClick={() => updateOtherPlayerKnights(color, 1)}
                        >
                          <AddIcon />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              </Paper>
            </>
          )}
        </div>

        <div className="board-panel">
          <AdvisorBoard
            boardTemplate={boardTemplate}
            tileConfigs={tileConfigs}
            portConfigs={portConfigs}
            nodeStates={nodeStates}
            edgeStates={edgeStates}
            robberCoordinate={robberCoordinate}
            onTileClick={handleTileClick}
            onPortClick={handlePortClick}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            setupPhase={setupPhase}
            highlightNodes={setupPhase === "pieces" && placementType !== "ROAD"}
            highlightEdges={setupPhase === "pieces" && placementType === "ROAD"}
            recommendedNode={recommendedNode}
            recommendedEdge={recommendedEdge}
          />
        </div>

        <div className="advice-panel">
          <Paper className="advice-section">
            <h3>AI Recommendation</h3>
            
            <Button
              variant="contained"
              color="primary"
              onClick={handleGetAdvice}
              disabled={loading || !isBoardComplete}
              fullWidth
              className="get-advice-button"
            >
              {loading ? "Analyzing..." : "Get Advice"}
            </Button>

            {!isBoardComplete && (
              <p className="warning">Complete the board setup first (all tiles need resources and numbers, exactly one desert).</p>
            )}

            {loading && (
              <div className="loading-container">
                <GridLoader color="#1976d2" size={15} />
              </div>
            )}

            {error && (
              <div className="error-message">
                <p>Error: {error}</p>
              </div>
            )}

            {advice && (
              <div className="advice-content">
                <h4>Recommended Action</h4>
                <div className="recommended-action">
                  <p className="action-type">{advice.action_type.replace(/_/g, " ")}</p>
                  {advice.action_value !== null && advice.action_value !== undefined && (
                    <p className="action-value">
                      {advice.action_type === "BUILD_SETTLEMENT" || advice.action_type === "BUILD_CITY" 
                        ? `Location marked with gold circle on the board`
                        : advice.action_type === "BUILD_ROAD"
                        ? `Location marked in gold on the board`
                        : JSON.stringify(advice.action_value)}
                    </p>
                  )}
                </div>
                
                {advice.explanation && (
                  <>
                    <h4>Explanation</h4>
                    <p className="explanation">{advice.explanation}</p>
                  </>
                )}

                {advice.victory_points && (
                  <>
                    <h4>Victory Points</h4>
                    <div className="vp-grid">
                      {Object.entries(advice.victory_points).map(([color, vp]) => (
                        <div key={color} className="vp-row">
                          <span className={`color-dot ${color}`}></span>
                          <span>{color}: {vp} VP</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {advice.all_actions && advice.all_actions.length > 0 && (
                  <>
                    <h4>All Available Actions</h4>
                    <div className="actions-list">
                      {advice.all_actions.slice(0, 10).map((action, idx) => (
                        <div key={idx} className="action-item">
                          {action}
                        </div>
                      ))}
                      {advice.all_actions.length > 10 && (
                        <p className="more-actions">...and {advice.all_actions.length - 10} more</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Paper>
        </div>
      </div>

      {/* Tile Configuration Dialog */}
      <Dialog open={tileDialogOpen} onClose={cancelTileDialog}>
        <DialogTitle>Configure Tile</DialogTitle>
        <DialogContent>
          <FormControl fullWidth className="dialog-form-control">
            <InputLabel>Resource Type</InputLabel>
            <Select
              value={dialogResource || ""}
              label="Resource Type"
              onChange={(e) => {
                const resource = e.target.value as ResourceCard | "DESERT" | "";
                if (resource === "") {
                  setDialogResource(null);
                } else {
                  setDialogResource(resource);
                  // Clear number if selecting desert
                  if (resource === "DESERT") {
                    setDialogNumber(null);
                  }
                }
              }}
            >
              <MenuItem value="">-- Select --</MenuItem>
              {RESOURCE_TYPES.map(type => (
                <MenuItem key={type} value={type}>{type}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth className="dialog-form-control" disabled={!dialogResource || dialogResource === "DESERT"}>
            <InputLabel>Number Token</InputLabel>
            <Select
              value={dialogNumber || ""}
              label="Number Token"
              onChange={(e) => {
                const num = e.target.value as number | "";
                setDialogNumber(num === "" ? null : num);
              }}
            >
              <MenuItem value="">-- Select --</MenuItem>
              {VALID_NUMBERS.map(num => (
                <MenuItem key={num} value={num}>{num}</MenuItem>
              ))}
            </Select>
          </FormControl>
          
          {dialogResource === "DESERT" && (
            <p className="dialog-hint">Desert tiles don't have a number token.</p>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelTileDialog}>Cancel</Button>
          <Button onClick={confirmTileDialog} variant="contained" color="primary">OK</Button>
        </DialogActions>
      </Dialog>

      {/* Port Configuration Dialog */}
      <Dialog open={portDialogOpen} onClose={() => setPortDialogOpen(false)}>
        <DialogTitle>Configure Port</DialogTitle>
        <DialogContent>
          <FormControl fullWidth className="dialog-form-control">
            <InputLabel>Port Type</InputLabel>
            <Select
              value={currentPortConfig?.resource === null ? "3:1" : currentPortConfig?.resource || ""}
              label="Port Type"
              onChange={(e) => {
                const value = e.target.value;
                if (value === "3:1") {
                  updatePortConfig(null);
                } else {
                  updatePortConfig(value as ResourceCard);
                }
              }}
            >
              <MenuItem value="">-- Select --</MenuItem>
              <MenuItem value="3:1">3:1 (Any Resource)</MenuItem>
              <MenuItem value="WOOD">2:1 Wood</MenuItem>
              <MenuItem value="BRICK">2:1 Brick</MenuItem>
              <MenuItem value="SHEEP">2:1 Sheep</MenuItem>
              <MenuItem value="WHEAT">2:1 Wheat</MenuItem>
              <MenuItem value="ORE">2:1 Ore</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPortDialogOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
