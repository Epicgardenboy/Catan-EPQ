import axios from "axios";
import { API_URL } from "../configuration";
import type { Color, ResourceCard, TileCoordinate, Direction, Building } from "./api.types";

export type AdvisorRequest = {
  num_players: number;
  advised_player: Color;
  tiles: Array<{
    coordinate: TileCoordinate;
    resource: ResourceCard | null;
    number: number | null;
  }>;
  ports: Array<{
    coordinate: TileCoordinate;
    direction: Direction;
    resource: ResourceCard | null;
  }>;
  buildings: Array<{
    node_id: number;
    color: Color;
    building: Building;
  }>;
  roads: Array<{
    edge_id: [number, number];
    color: Color;
  }>;
  robber_coordinate: TileCoordinate;
  player_resources: {
    [K in ResourceCard]: number;
  };
  player_dev_cards: {
    KNIGHT: number;
    VICTORY_POINT: number;
    ROAD_BUILDING: number;
    YEAR_OF_PLENTY: number;
    MONOPOLY: number;
  };
  players_knights: {
    [K in Color]?: number;
  };
};

export type AdvisorResponse = {
  success: boolean;
  action_type: string;
  action_value: any;
  explanation: string;
  victory_points?: {
    [K in Color]?: number;
  };
  all_actions?: string[];
  error?: string;
};

export type BoardTemplateNode = {
  id: number;
  tile_coordinates: TileCoordinate[];
  direction: Direction;
};

export type BoardTemplateEdge = {
  node_ids: [number, number];
  tile_coordinate: TileCoordinate;
  direction: Direction;
};

export type BoardTemplateTile = {
  coordinate: TileCoordinate;
  id: number;
  type: "RESOURCE_TILE" | "DESERT" | "PORT";
  resource: ResourceCard | null;
  number: number | null;
  direction?: Direction;
};

export type BoardTemplate = {
  success: boolean;
  tiles: BoardTemplateTile[];
  nodes: BoardTemplateNode[];
  edges: BoardTemplateEdge[];
};

export async function getAdvisorRecommendation(request: AdvisorRequest): Promise<AdvisorResponse> {
  try {
    const response = await axios.post<AdvisorResponse>(
      `${API_URL}/api/advisor`,
      request
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(error.response.data.error || "Failed to get advice");
    }
    throw error;
  }
}

export async function getBoardTemplate(): Promise<BoardTemplate> {
  try {
    const response = await axios.get<BoardTemplate>(
      `${API_URL}/api/advisor/board-template`
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(error.response.data.error || "Failed to get board template");
    }
    throw error;
  }
}
