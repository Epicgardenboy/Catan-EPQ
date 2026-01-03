"""
Advisor API endpoint for recommending moves based on a custom board state.
"""

import json
import logging
import traceback
from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict

from flask import Response, Blueprint, jsonify, abort, request

from catanatron.models.player import Color, Player
from catanatron.models.board import Board
from catanatron.models.map import CatanMap, LandTile, Port, Water, BASE_MAP_TEMPLATE, get_nodes_and_edges, Direction
from catanatron.models.enums import (
    RESOURCES,
    DEVELOPMENT_CARDS,
    SETTLEMENT,
    CITY,
    Action,
    ActionType,
    ActionPrompt,
    WOOD,
    BRICK,
    SHEEP,
    WHEAT,
    ORE,
)
from catanatron.models.actions import generate_playable_actions
from catanatron.state import State, PLAYER_INITIAL_STATE
from catanatron.game import Game
from catanatron.json import GameEncoder
from catanatron.players.minimax import AlphaBetaPlayer
from catanatron.state_functions import player_key

bp = Blueprint("advisor", __name__, url_prefix="/api")

# Coordinate to node ID mapping for standard board
# This maps (cube_coord, direction) -> node_id based on standard board layout
DIRECTION_TO_INDEX = {
    "NORTH": 0,
    "NORTHEAST": 1, 
    "SOUTHEAST": 2,
    "SOUTH": 3,
    "SOUTHWEST": 4,
    "NORTHWEST": 5,
}

# Resource string to FastResource mapping (FastResource is just string literals)
RESOURCE_MAP = {
    "WOOD": WOOD,
    "BRICK": BRICK,
    "SHEEP": SHEEP,
    "WHEAT": WHEAT,
    "ORE": ORE,
}

# Dev card type to enum mapping  
DEV_CARD_MAP = {
    "KNIGHT": "KNIGHT",
    "VICTORY_POINT": "VICTORY_POINT",
    "ROAD_BUILDING": "ROAD_BUILDING",
    "YEAR_OF_PLENTY": "YEAR_OF_PLENTY",
    "MONOPOLY": "MONOPOLY",
}


def create_custom_board(tiles_data: List[Dict], ports_data: List[Dict]) -> CatanMap:
    """Create a CatanMap from the provided tile and port configuration."""
    all_tiles = {}
    node_autoinc = 0
    tile_autoinc = 0
    port_autoinc = 0
    
    # First pass: create land tiles in a specific order to ensure proper node/edge sharing
    # Sort by coordinate to ensure consistent processing
    sorted_tiles = sorted(tiles_data, key=lambda t: (t["coordinate"][0], t["coordinate"][1], t["coordinate"][2]))
    
    for tile_info in sorted_tiles:
        coord = tuple(tile_info["coordinate"])
        resource = tile_info.get("resource")
        number = tile_info.get("number")
        
        # Get nodes and edges, attaching to any existing neighboring tiles
        nodes, edges, node_autoinc = get_nodes_and_edges(all_tiles, coord, node_autoinc)
        
        if resource is None:
            # Desert tile
            land_tile = LandTile(tile_autoinc, None, None, nodes, edges)
        else:
            fast_resource = RESOURCE_MAP.get(resource)
            land_tile = LandTile(tile_autoinc, fast_resource, number, nodes, edges)
        
        all_tiles[coord] = land_tile
        tile_autoinc += 1
    
    # Create ports (water tiles with port info)
    for port_info in ports_data:
        coord = tuple(port_info["coordinate"])
        direction_str = port_info["direction"]
        resource = port_info.get("resource")
        
        # Get nodes and edges
        nodes, edges, node_autoinc = get_nodes_and_edges(all_tiles, coord, node_autoinc)
        
        fast_resource = RESOURCE_MAP.get(resource) if resource else None
        direction = Direction[direction_str] if isinstance(direction_str, str) else direction_str
        port = Port(port_autoinc, fast_resource, direction, nodes, edges)
        all_tiles[coord] = port
        port_autoinc += 1
    
    # Add water tiles for remaining outer ring positions
    water_coords = [
        (3, -3, 0), (2, -3, 1), (1, -3, 2), (0, -3, 3),
        (-1, -2, 3), (-2, -1, 3), (-3, 0, 3), (-3, 1, 2),
        (-3, 2, 1), (-3, 3, 0), (-2, 3, -1), (-1, 3, -2),
        (0, 3, -3), (1, 2, -3), (2, 1, -3), (3, 0, -3),
        (3, -1, -2), (3, -2, -1),
    ]
    for coord in water_coords:
        if coord not in all_tiles:
            nodes, edges, node_autoinc = get_nodes_and_edges(all_tiles, coord, node_autoinc)
            all_tiles[coord] = Water(nodes, edges)
    
    return CatanMap.from_tiles(all_tiles)


def create_game_from_advisor_request(data: Dict) -> Tuple[Game, Color]:
    """Create a Game object from the advisor request data."""
    num_players = data.get("num_players", 2)
    advised_player_str = data.get("advised_player", "RED")
    advised_color = Color[advised_player_str]
    
    # Create players
    colors = [Color.RED, Color.BLUE, Color.ORANGE, Color.WHITE][:num_players]
    players = []
    for color in colors:
        # Use AlphaBetaPlayer for AI decisions
        player = AlphaBetaPlayer(color, 2, True)
        players.append(player)
    
    # Create custom map
    tiles_data = data.get("tiles", [])
    ports_data = data.get("ports", [])
    
    if tiles_data:
        catan_map = create_custom_board(tiles_data, ports_data)
    else:
        catan_map = None  # Use default
    
    # Create game
    game = Game(players=players, catan_map=catan_map)
    
    # Override the random seating order to match expected colors
    game.state.players = players
    game.state.colors = tuple(colors)
    game.state.color_to_index = {color: i for i, color in enumerate(colors)}
    
    # Set up buildings
    buildings_data = data.get("buildings", [])
    for building_info in buildings_data:
        node_id = building_info["node_id"]
        color = Color[building_info["color"]]
        building_type = SETTLEMENT if building_info["building"] == "SETTLEMENT" else CITY
        
        # Directly set the building (bypassing validation for advisor mode)
        game.state.board.buildings[node_id] = (color, building_type)
        game.state.buildings_by_color[color][building_type].append(node_id)
        
        # Update board buildable IDs
        game.state.board.board_buildable_ids.discard(node_id)
        from catanatron.models.board import STATIC_GRAPH
        for n in STATIC_GRAPH.neighbors(node_id):
            game.state.board.board_buildable_ids.discard(n)
        
        # Update player state
        p_key = player_key(game.state, color)
        if building_type == SETTLEMENT:
            game.state.player_state[f"{p_key}_SETTLEMENTS_AVAILABLE"] -= 1
            game.state.player_state[f"{p_key}_VICTORY_POINTS"] += 1
            game.state.player_state[f"{p_key}_ACTUAL_VICTORY_POINTS"] += 1
        else:
            game.state.player_state[f"{p_key}_CITIES_AVAILABLE"] -= 1
            game.state.player_state[f"{p_key}_VICTORY_POINTS"] += 2
            game.state.player_state[f"{p_key}_ACTUAL_VICTORY_POINTS"] += 2
    
    # Set up roads
    roads_data = data.get("roads", [])
    for road_info in roads_data:
        edge_id = tuple(road_info["edge_id"])
        color = Color[road_info["color"]]
        
        # Directly set the road
        game.state.board.roads[edge_id] = color
        game.state.board.roads[(edge_id[1], edge_id[0])] = color
        
        # Update player state
        p_key = player_key(game.state, color)
        game.state.player_state[f"{p_key}_ROADS_AVAILABLE"] -= 1
    
    # Set robber coordinate
    robber_coord = data.get("robber_coordinate")
    if robber_coord:
        game.state.board.robber_coordinate = tuple(robber_coord)
    
    # Set advised player as current player
    advised_index = game.state.color_to_index[advised_color]
    game.state.current_player_index = advised_index
    game.state.current_turn_index = advised_index
    
    # Set resources for advised player
    player_resources = data.get("player_resources", {})
    p_key = player_key(game.state, advised_color)
    for resource_str, count in player_resources.items():
        if resource_str in RESOURCE_MAP:
            game.state.player_state[f"{p_key}_{resource_str}_IN_HAND"] = count
    
    # Set development cards for advised player
    player_dev_cards = data.get("player_dev_cards", {})
    for card_type, count in player_dev_cards.items():
        if card_type in DEV_CARD_MAP:
            game.state.player_state[f"{p_key}_{card_type}_IN_HAND"] = count
    
    # Set played knights for other players
    players_knights = data.get("players_knights", {})
    for color_str, count in players_knights.items():
        other_color = Color[color_str]
        other_p_key = player_key(game.state, other_color)
        game.state.player_state[f"{other_p_key}_PLAYED_KNIGHT"] = count
    
    # Mark as not initial build phase (post-setup game)
    game.state.is_initial_build_phase = False
    game.state.current_prompt = ActionPrompt.PLAY_TURN
    
    # Set HAS_ROLLED to true (assuming turn is after rolling)
    game.state.player_state[f"{p_key}_HAS_ROLLED"] = True
    
    # Generate playable actions
    game.state.playable_actions = generate_playable_actions(game.state)
    
    return game, advised_color


def format_action(action: Action) -> str:
    """Format an action for display."""
    action_type = action.action_type.name if hasattr(action.action_type, 'name') else str(action.action_type)
    if action.value is not None:
        return f"{action_type}: {action.value}"
    return action_type


def calculate_victory_points(game: Game) -> Dict[str, int]:
    """Calculate victory points for each player."""
    vps = {}
    for color in game.state.colors:
        p_key = player_key(game.state, color)
        vp = game.state.player_state[f"{p_key}_ACTUAL_VICTORY_POINTS"]
        vps[color.value] = vp
    return vps


@bp.route("/advisor", methods=["POST"])
def advisor_endpoint():
    """Get AI recommendation for a custom board state."""
    logging.info("Advisor request received")
    
    if not request.is_json or request.json is None:
        abort(400, description="Missing or invalid JSON body")
    
    try:
        data = request.json
        
        # Create game from request data
        game, advised_color = create_game_from_advisor_request(data)
        
        # Get playable actions
        playable_actions = game.state.playable_actions
        
        if len(playable_actions) == 0:
            return Response(
                response=json.dumps({
                    "success": True,
                    "action_type": "NO_ACTIONS",
                    "action_value": None,
                    "explanation": "No legal actions available in this state.",
                    "victory_points": calculate_victory_points(game),
                    "all_actions": [],
                }),
                status=200,
                mimetype="application/json",
            )
        
        # Get AI recommendation
        advised_player = game.state.players[game.state.color_to_index[advised_color]]
        recommended_action = advised_player.decide(game, playable_actions)
        
        # Format the response
        action_type = recommended_action.action_type.name if hasattr(recommended_action.action_type, 'name') else str(recommended_action.action_type)
        
        explanation = generate_explanation(recommended_action, game, advised_color)
        
        return Response(
            response=json.dumps({
                "success": True,
                "action_type": action_type,
                "action_value": recommended_action.value,
                "explanation": explanation,
                "victory_points": calculate_victory_points(game),
                "all_actions": [format_action(a) for a in playable_actions],
            }),
            status=200,
            mimetype="application/json",
        )
    
    except Exception as e:
        logging.error(f"Error in advisor endpoint: {str(e)}")
        logging.error(traceback.format_exc())
        return Response(
            response=json.dumps({
                "success": False,
                "error": str(e),
                "trace": traceback.format_exc(),
            }),
            status=500,
            mimetype="application/json",
        )


def generate_explanation(action: Action, game: Game, advised_color: Color) -> str:
    """Generate a human-readable explanation for the recommended action."""
    action_type = action.action_type
    value = action.value
    
    if action_type == ActionType.END_TURN:
        return "End your turn. No better moves available with current resources."
    
    elif action_type == ActionType.BUILD_SETTLEMENT:
        return f"Build a settlement at node {value}. This expands your resource production."
    
    elif action_type == ActionType.BUILD_CITY:
        return f"Upgrade settlement at node {value} to a city. This doubles resource production from that location."
    
    elif action_type == ActionType.BUILD_ROAD:
        return f"Build a road at edge {value}. This helps connect settlements and work toward longest road."
    
    elif action_type == ActionType.BUY_DEVELOPMENT_CARD:
        return "Buy a development card. Development cards provide powerful abilities and potential victory points."
    
    elif action_type == ActionType.PLAY_KNIGHT_CARD:
        return "Play a knight card. This allows you to move the robber and steal a resource."
    
    elif action_type == ActionType.MARITIME_TRADE:
        if value:
            give_resource = value[0] if len(value) > 0 else "resources"
            get_resource = value[-1] if len(value) > 1 else "resources"
            return f"Trade {give_resource} for {get_resource} using a port or bank trade."
        return "Make a maritime/bank trade to get the resources you need."
    
    elif action_type == ActionType.MOVE_ROBBER:
        if value:
            coord = value[0] if len(value) > 0 else "a tile"
            return f"Move the robber to {coord}. This blocks resource production and lets you steal."
        return "Move the robber to block an opponent's production."
    
    elif action_type == ActionType.PLAY_ROAD_BUILDING:
        return "Play Road Building card to build two roads for free."
    
    elif action_type == ActionType.PLAY_YEAR_OF_PLENTY:
        return f"Play Year of Plenty to get free resources: {value}"
    
    elif action_type == ActionType.PLAY_MONOPOLY:
        return f"Play Monopoly to take all {value} from other players."
    
    else:
        return f"Recommended action: {action_type}"


@bp.route("/advisor/board-template", methods=["GET"])
def get_board_template():
    """Get the standard board template with node and edge IDs."""
    try:
        catan_map = CatanMap.from_template(BASE_MAP_TEMPLATE)
        
        # Build nodes info - collect all tiles that share each node
        node_tiles: Dict[int, List[Tuple[tuple, str]]] = defaultdict(list)  # node_id -> [(coord, direction), ...]
        edges = {}
        tiles_info = []
        
        for coordinate, tile in catan_map.tiles.items():
            if isinstance(tile, LandTile):
                tile_info = {
                    "coordinate": coordinate,
                    "id": tile.id,
                    "type": "DESERT" if tile.resource is None else "RESOURCE_TILE",
                    "resource": tile.resource if tile.resource else None,
                    "number": tile.number,
                }
                tiles_info.append(tile_info)
                
                # Add nodes for this tile - track all tiles that share this node
                for direction, node_id in tile.nodes.items():
                    # direction might be an enum or string, handle both
                    dir_name = direction.name if hasattr(direction, 'name') else str(direction)
                    node_tiles[node_id].append((coordinate, dir_name))
                
                # Add edges for this tile
                for direction, edge in tile.edges.items():
                    edge_id = tuple(sorted(edge))
                    if edge_id not in edges:
                        # direction might be an enum or string, handle both
                        dir_name = direction.name if hasattr(direction, 'name') else str(direction)
                        edges[edge_id] = {
                            "node_ids": list(edge),
                            "tile_coordinate": coordinate,
                            "direction": dir_name,
                        }
            
            elif isinstance(tile, Port):
                # direction might be an enum or string, handle both
                port_dir_name = tile.direction.name if hasattr(tile.direction, 'name') else str(tile.direction)
                tile_info = {
                    "coordinate": coordinate,
                    "id": tile.id,
                    "type": "PORT",
                    "direction": port_dir_name,
                    "resource": tile.resource if tile.resource else None,
                }
                tiles_info.append(tile_info)
        
        # Build final nodes list with all tile coordinates
        nodes_list = []
        for node_id, tile_list in node_tiles.items():
            # Get all tile coordinates that share this node
            tile_coordinates = [coord for coord, _ in tile_list]
            # Use the first tile's direction for reference
            first_tile_coord, first_direction = tile_list[0]
            nodes_list.append({
                "id": node_id,
                "tile_coordinates": tile_coordinates,
                "direction": first_direction,  # Direction on first tile
            })
        
        return Response(
            response=json.dumps({
                "success": True,
                "tiles": tiles_info,
                "nodes": nodes_list,
                "edges": list(edges.values()),
            }),
            status=200,
            mimetype="application/json",
        )
    
    except Exception as e:
        logging.error(f"Error getting board template: {str(e)}")
        logging.error(traceback.format_exc())
        return Response(
            response=json.dumps({
                "success": False,
                "error": str(e),
            }),
            status=500,
            mimetype="application/json",
        )
